import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'fs/promises'
import path from 'path'
import os from 'os'

// Mock the modules
vi.mock('@/lib/db', () => ({
  prisma: {
    auditLog: {
      create: vi.fn(),
    },
  },
}))

vi.mock('next/headers', () => ({
  headers: vi.fn(),
}))

import { appendToDLQ, drainDLQ, getDLQStats } from '@/lib/audit-dlq'
import { prisma } from '@/lib/db'

describe('audit-dlq', () => {
  let testDLQDir: string

  beforeEach(async () => {
    // Create unique test directory per test to avoid interference
    // Use os.tmpdir() for cross-platform compatibility (Windows, Linux, macOS)
    testDLQDir = path.join(os.tmpdir(), `test-audit-dlq-${Date.now()}-${Math.random()}`)
    vi.stubEnv('DLQ_DIR', testDLQDir)
    vi.clearAllMocks()
    // Clean up any existing test directory
    await fs.rm(testDLQDir, { recursive: true, force: true })
  })

  afterEach(async () => {
    vi.unstubAllEnvs()
    // Clean up test directory
    await fs.rm(testDLQDir, { recursive: true, force: true })
  })

  it('appendToDLQ creates directory and writes valid JSON line', async () => {
    const entry = {
      userId: 'user-123',
      entityType: 'transaction',
      entityId: 'tx-456',
      action: 'create' as const,
      oldValue: null,
      newValue: { amount: 1000 },
      ipAddress: '127.0.0.1',
      userAgent: 'test-agent',
      createdAt: new Date().toISOString(),
    }

    await appendToDLQ(entry)

    // Verify file was created
    const dlqFile = path.join(testDLQDir, 'audit-dlq.jsonl')
    const content = await fs.readFile(dlqFile, 'utf-8')
    const lines = content.split('\n').filter(l => l.trim())

    expect(lines.length).toBe(1)
    const parsed = JSON.parse(lines[0])
    expect(parsed.userId).toBe('user-123')
    expect(parsed.entityId).toBe('tx-456')
    expect(parsed.action).toBe('create')
  })

  it('drainDLQ writes entries to DB and deletes file on success', async () => {
    const mockCreate = vi.fn().mockResolvedValue({ id: 'log-1' })
    ;(prisma.auditLog.create as any) = mockCreate

    // Write test DLQ file with 2 entries
    const dlqDir = testDLQDir
    await fs.mkdir(dlqDir, { recursive: true })
    const dlqFile = path.join(dlqDir, 'audit-dlq.jsonl')

    const entry1 = {
      userId: 'user-1',
      entityType: 'transaction',
      entityId: 'tx-1',
      action: 'create',
      oldValue: null,
      newValue: { amount: 100 },
      ipAddress: '1.1.1.1',
      userAgent: 'agent',
      createdAt: new Date().toISOString(),
    }

    const entry2 = {
      userId: 'user-2',
      entityType: 'file',
      entityId: 'file-2',
      action: 'delete',
      oldValue: { name: 'old' },
      newValue: null,
      ipAddress: null,
      userAgent: null,
      createdAt: new Date().toISOString(),
    }

    await fs.writeFile(dlqFile, JSON.stringify(entry1) + '\n' + JSON.stringify(entry2) + '\n')

    // Drain
    const drained = await drainDLQ()

    // Verify results
    expect(drained).toBe(2)
    expect(mockCreate).toHaveBeenCalledTimes(2)

    // Verify files deleted
    const dlqExists = await fs.stat(dlqFile).catch(() => null)
    const cursorExists = await fs.stat(path.join(dlqDir, 'audit-dlq.cursor')).catch(() => null)
    expect(dlqExists).toBeNull()
    expect(cursorExists).toBeNull()
  })

  it('drainDLQ stops on DB failure and writes cursor for resume', async () => {
    const mockCreate = vi.fn()
    mockCreate.mockResolvedValueOnce({ id: 'log-1' })  // First call succeeds
    mockCreate.mockRejectedValueOnce(new Error('DB connection failed'))  // Second call fails
    ;(prisma.auditLog.create as any) = mockCreate

    // Write test DLQ file with 3 entries
    const dlqDir = testDLQDir
    await fs.mkdir(dlqDir, { recursive: true })
    const dlqFile = path.join(dlqDir, 'audit-dlq.jsonl')

    const entries = [
      { userId: 'u1', entityType: 'tx', entityId: 'e1', action: 'create' as const, oldValue: null, newValue: {}, ipAddress: null, userAgent: null, createdAt: new Date().toISOString() },
      { userId: 'u2', entityType: 'tx', entityId: 'e2', action: 'update' as const, oldValue: {}, newValue: {}, ipAddress: null, userAgent: null, createdAt: new Date().toISOString() },
      { userId: 'u3', entityType: 'tx', entityId: 'e3', action: 'delete' as const, oldValue: {}, newValue: null, ipAddress: null, userAgent: null, createdAt: new Date().toISOString() },
    ]

    const content = entries.map(e => JSON.stringify(e)).join('\n') + '\n'
    await fs.writeFile(dlqFile, content)

    // Drain (should process 1 entry, fail on 2nd)
    const drained = await drainDLQ()

    // Verify
    expect(drained).toBe(1)  // Only first entry drained before failure
    expect(mockCreate).toHaveBeenCalledTimes(2)  // Called twice (once success, once failure)

    // Verify cursor was written (pointing to entry 2)
    const cursorFile = path.join(dlqDir, 'audit-dlq.cursor')
    const cursorContent = await fs.readFile(cursorFile, 'utf-8')
    expect(parseInt(cursorContent.trim())).toBe(1)  // Next to process is entry 1 (0-indexed)

    // Verify DLQ file still exists
    const dlqExists = await fs.stat(dlqFile).catch(() => null)
    expect(dlqExists).not.toBeNull()
  })

  it('drainDLQ resumes from cursor on next call (idempotency)', async () => {
    const mockCreate = vi.fn().mockResolvedValue({ id: 'log-1' })
    ;(prisma.auditLog.create as any) = mockCreate

    // Write test DLQ file with 3 entries
    const dlqDir = testDLQDir
    await fs.mkdir(dlqDir, { recursive: true })
    const dlqFile = path.join(dlqDir, 'audit-dlq.jsonl')
    const cursorFile = path.join(dlqDir, 'audit-dlq.cursor')

    const entries = [
      { userId: 'u1', entityType: 'tx', entityId: 'e1', action: 'create' as const, oldValue: null, newValue: {}, ipAddress: null, userAgent: null, createdAt: new Date().toISOString() },
      { userId: 'u2', entityType: 'tx', entityId: 'e2', action: 'update' as const, oldValue: {}, newValue: {}, ipAddress: null, userAgent: null, createdAt: new Date().toISOString() },
      { userId: 'u3', entityType: 'tx', entityId: 'e3', action: 'delete' as const, oldValue: {}, newValue: null, ipAddress: null, userAgent: null, createdAt: new Date().toISOString() },
    ]

    const content = entries.map(e => JSON.stringify(e)).join('\n') + '\n'
    await fs.writeFile(dlqFile, content)
    // Write cursor pointing to entry 2 (entries 0 and 1 already drained)
    await fs.writeFile(cursorFile, '2')

    // Drain
    const drained = await drainDLQ()

    // Verify only entry 2 was processed (entries 0 and 1 skipped)
    expect(drained).toBe(1)
    expect(mockCreate).toHaveBeenCalledTimes(1)
    expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ entityId: 'e3' }) }))

    // Verify files deleted
    const dlqExists = await fs.stat(dlqFile).catch(() => null)
    const cursorExists = await fs.stat(cursorFile).catch(() => null)
    expect(dlqExists).toBeNull()
    expect(cursorExists).toBeNull()
  })

  it('getDLQStats returns correct structure for both existing and missing file', async () => {
    // Test when file doesn't exist
    let stats = await getDLQStats()
    expect(stats).toHaveProperty('exists')
    expect(stats).toHaveProperty('size')
    expect(stats.exists).toBe(false)
    expect(stats.size).toBe(0)

    // Test when file exists
    const dlqDir = testDLQDir
    await fs.mkdir(dlqDir, { recursive: true })
    const dlqFile = path.join(dlqDir, 'audit-dlq.jsonl')
    await fs.writeFile(dlqFile, '{"userId":"test"}\n')

    stats = await getDLQStats()
    expect(stats.exists).toBe(true)
    expect(stats.size).toBeGreaterThan(0)
  })
})
