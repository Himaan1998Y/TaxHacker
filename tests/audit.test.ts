import { describe, it, expect, vi } from 'vitest'

// Mock the modules that audit.ts imports at top level (DB + Next.js headers)
vi.mock('@/lib/db', () => ({
  prisma: {},
}))
vi.mock('next/headers', () => ({
  headers: vi.fn(),
}))

import { sanitizeForAudit } from '@/lib/audit'

describe('sanitizeForAudit', () => {
  it('removes cachedParseResult field', () => {
    const record = {
      id: '123',
      name: 'test',
      cachedParseResult: { huge: 'blob', nested: { data: [1, 2, 3] } },
    }
    const result = sanitizeForAudit(record)
    expect(result).not.toHaveProperty('cachedParseResult')
    expect(result.id).toBe('123')
    expect(result.name).toBe('test')
  })

  it('removes embedding field', () => {
    const record = {
      id: '456',
      embedding: new Array(1536).fill(0.1),
    }
    const result = sanitizeForAudit(record)
    expect(result).not.toHaveProperty('embedding')
    expect(result.id).toBe('456')
  })

  it('masks api_key values when code field contains "api_key"', () => {
    const record = {
      code: 'gemini_api_key',
      value: 'sk-abc123secret',
    }
    const result = sanitizeForAudit(record)
    expect(result.value).toBe('***')
  })

  it('masks secret values when code field contains "secret"', () => {
    const record = {
      code: 'auth_secret',
      value: 'my-super-secret',
    }
    const result = sanitizeForAudit(record)
    expect(result.value).toBe('***')
  })

  it('masks password values when code field contains "password"', () => {
    const record = {
      code: 'db_password',
      value: 'hunter2',
    }
    const result = sanitizeForAudit(record)
    expect(result.value).toBe('***')
  })

  it('sets value to null when sensitive code has empty/null value', () => {
    const record = {
      code: 'api_key_test',
      value: '',
    }
    const result = sanitizeForAudit(record)
    // Empty string is falsy, so sanitized.value becomes null
    expect(result.value).toBe(null)
  })

  it('does not mask when code does not contain sensitive keywords', () => {
    const record = {
      code: 'company_name',
      value: 'Acme Corp',
    }
    const result = sanitizeForAudit(record)
    expect(result.value).toBe('Acme Corp')
  })

  it('passes through normal fields unchanged', () => {
    const record = {
      id: '789',
      name: 'Transaction',
      amount: 10000,
      currency: 'INR',
      isActive: true,
    }
    const result = sanitizeForAudit(record)
    expect(result).toEqual(record)
  })

  it('masks GSTIN values (India-specific PII)', () => {
    const result = sanitizeForAudit({ code: 'business_gstin', value: '07AADCT1234A1Z0' })
    expect(result.value).toBe('***')
  })

  it('masks PAN values', () => {
    const result = sanitizeForAudit({ code: 'owner_pan', value: 'ABCDE1234F' })
    expect(result.value).toBe('***')
  })

  it('masks bank account numbers', () => {
    const result = sanitizeForAudit({ code: 'bank_account_number', value: '1234567890' })
    expect(result.value).toBe('***')
  })

  it('masks case-insensitively (e.g. "API_KEY")', () => {
    const result = sanitizeForAudit({ code: 'Google_API_KEY', value: 'sk-xxx' })
    expect(result.value).toBe('***')
  })

  it('does not mutate the original record', () => {
    const record = {
      id: '123',
      cachedParseResult: { data: 'big' },
      embedding: [0.1, 0.2],
    }
    sanitizeForAudit(record)
    // Original should still have the fields
    expect(record).toHaveProperty('cachedParseResult')
    expect(record).toHaveProperty('embedding')
  })
})
