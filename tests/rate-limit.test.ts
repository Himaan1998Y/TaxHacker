import { describe, it, expect, vi, beforeEach } from 'vitest'

// We need a fresh module for each test to reset the in-memory store.
// Use dynamic import with vi.resetModules().

describe('rateLimit', () => {
  let rateLimit: typeof import('@/lib/rate-limit').rateLimit

  beforeEach(async () => {
    // Reset module registry so the store Map is fresh each test
    vi.resetModules()
    const mod = await import('@/lib/rate-limit')
    rateLimit = mod.rateLimit
  })

  it('allows the first request', () => {
    const result = rateLimit('192.168.1.1', { maxRequests: 3, windowMs: 60000 })
    expect(result.allowed).toBe(true)
    expect(result.remaining).toBe(2)
  })

  it('allows up to maxRequests', () => {
    const opts = { maxRequests: 3, windowMs: 60000 }
    const r1 = rateLimit('10.0.0.1', opts)
    const r2 = rateLimit('10.0.0.1', opts)
    const r3 = rateLimit('10.0.0.1', opts)

    expect(r1.allowed).toBe(true)
    expect(r1.remaining).toBe(2)
    expect(r2.allowed).toBe(true)
    expect(r2.remaining).toBe(1)
    expect(r3.allowed).toBe(true)
    expect(r3.remaining).toBe(0)
  })

  it('blocks the request after maxRequests exceeded', () => {
    const opts = { maxRequests: 2, windowMs: 60000 }
    rateLimit('10.0.0.2', opts)
    rateLimit('10.0.0.2', opts)
    const blocked = rateLimit('10.0.0.2', opts)

    expect(blocked.allowed).toBe(false)
    expect(blocked.remaining).toBe(0)
  })

  it('treats different IPs independently', () => {
    const opts = { maxRequests: 1, windowMs: 60000 }
    const r1 = rateLimit('1.1.1.1', opts)
    const r2 = rateLimit('2.2.2.2', opts)

    expect(r1.allowed).toBe(true)
    expect(r2.allowed).toBe(true)

    // Both should now be blocked
    expect(rateLimit('1.1.1.1', opts).allowed).toBe(false)
    expect(rateLimit('2.2.2.2', opts).allowed).toBe(false)
  })

  it('resets after window expires', () => {
    const now = Date.now()
    vi.spyOn(Date, 'now').mockReturnValue(now)

    const opts = { maxRequests: 1, windowMs: 1000 }
    rateLimit('10.0.0.3', opts)
    const blocked = rateLimit('10.0.0.3', opts)
    expect(blocked.allowed).toBe(false)

    // Advance time past the window
    vi.spyOn(Date, 'now').mockReturnValue(now + 1001)
    const afterReset = rateLimit('10.0.0.3', opts)
    expect(afterReset.allowed).toBe(true)
    expect(afterReset.remaining).toBe(0) // maxRequests(1) - count(1) = 0

    vi.restoreAllMocks()
  })

  it('returns a resetAt timestamp in the future', () => {
    const before = Date.now()
    const result = rateLimit('10.0.0.4', { maxRequests: 5, windowMs: 30000 })
    expect(result.resetAt).toBeGreaterThanOrEqual(before + 30000)
  })

  it('uses default maxRequests=5 and windowMs=60000 when no options given', () => {
    const ip = '10.0.0.5'
    for (let i = 0; i < 5; i++) {
      expect(rateLimit(ip).allowed).toBe(true)
    }
    expect(rateLimit(ip).allowed).toBe(false)
  })
})
