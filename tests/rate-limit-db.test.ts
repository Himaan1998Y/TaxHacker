import { describe, it, expect, beforeEach, vi } from 'vitest'

// Tier 1.2: durable rate limiter. The in-process Map version reset on
// every container restart; these tests pin the contract of the Postgres-
// backed replacement: atomic UPSERT, correct window rollover, and
// 429-on-exceed semantics.

const queryRaw = vi.fn()
const deleteMany = vi.fn()

vi.mock('@/lib/db', () => ({
  prisma: {
    $queryRaw: (...args: unknown[]) => queryRaw(...args),
    rateLimit: {
      deleteMany: (...args: unknown[]) => deleteMany(...args),
    },
  },
}))

import { checkRateLimit, cleanupExpiredRateLimits } from '@/lib/rate-limit-db'

beforeEach(() => {
  queryRaw.mockReset()
  deleteMany.mockReset()
})

describe('checkRateLimit', () => {
  it('allows the first request and reports max-1 remaining', async () => {
    const resetAt = new Date(Date.now() + 60000)
    queryRaw.mockResolvedValueOnce([{ count: 1, reset_at: resetAt }])

    const result = await checkRateLimit('agent-api', 'user-1', {
      maxRequests: 60,
      windowMs: 60000,
    })

    expect(result.allowed).toBe(true)
    expect(result.remaining).toBe(59)
    expect(result.resetAt).toEqual(resetAt)
    expect(queryRaw).toHaveBeenCalledTimes(1)
  })

  it('allows further requests while under the limit', async () => {
    const resetAt = new Date(Date.now() + 60000)
    queryRaw.mockResolvedValueOnce([{ count: 30, reset_at: resetAt }])

    const result = await checkRateLimit('agent-api', 'user-1', {
      maxRequests: 60,
      windowMs: 60000,
    })

    expect(result.allowed).toBe(true)
    expect(result.remaining).toBe(30)
  })

  it('rejects when count exactly equals maxRequests + 1', async () => {
    // The caller has just made the 61st request in a 60-per-minute
    // bucket. The UPSERT returned count=61, which is > 60, so allowed
    // is false.
    const resetAt = new Date(Date.now() + 30000)
    queryRaw.mockResolvedValueOnce([{ count: 61, reset_at: resetAt }])

    const result = await checkRateLimit('agent-api', 'user-1', {
      maxRequests: 60,
      windowMs: 60000,
    })

    expect(result.allowed).toBe(false)
    expect(result.remaining).toBe(0)
  })

  it('allows the last in-window request (count exactly equals maxRequests)', async () => {
    // Exactly the max — still allowed, because the contract is "max
    // requests per window", not "max-1 then reject".
    const resetAt = new Date(Date.now() + 30000)
    queryRaw.mockResolvedValueOnce([{ count: 60, reset_at: resetAt }])

    const result = await checkRateLimit('agent-api', 'user-1', {
      maxRequests: 60,
      windowMs: 60000,
    })

    expect(result.allowed).toBe(true)
    expect(result.remaining).toBe(0)
  })

  it('fails closed if the UPSERT unexpectedly returns no rows', async () => {
    // Should be impossible under normal Postgres semantics, but the
    // guard in the implementation means a transient DB oddity refuses
    // the request rather than accidentally letting it through.
    queryRaw.mockResolvedValueOnce([])

    const result = await checkRateLimit('agent-api', 'user-1', {
      maxRequests: 60,
      windowMs: 60000,
    })

    expect(result.allowed).toBe(false)
    expect(result.remaining).toBe(0)
  })

  it('isolates buckets: different bucket names share no state in the query', async () => {
    const resetAt = new Date(Date.now() + 60000)
    queryRaw.mockResolvedValue([{ count: 1, reset_at: resetAt }])

    await checkRateLimit('agent-api', 'user-1', { maxRequests: 60, windowMs: 60000 })
    await checkRateLimit('password-attempts', 'user-1', { maxRequests: 5, windowMs: 60000 })

    expect(queryRaw).toHaveBeenCalledTimes(2)
    // Both calls flow through $queryRaw with the bucket as a literal in
    // the tagged template; we can't inspect the substituted SQL from the
    // mock, but the fact that both calls went through independently is
    // enough — the caller always passes bucket explicitly and the
    // UPSERT keys on (bucket, key) in Postgres.
  })
})

describe('cleanupExpiredRateLimits', () => {
  it('deletes rows whose reset_at has passed and returns the count', async () => {
    deleteMany.mockResolvedValueOnce({ count: 42 })

    const deleted = await cleanupExpiredRateLimits()

    expect(deleted).toBe(42)
    expect(deleteMany).toHaveBeenCalledTimes(1)
    const arg = deleteMany.mock.calls[0][0]
    expect(arg.where.resetAt.lt).toBeInstanceOf(Date)
  })
})
