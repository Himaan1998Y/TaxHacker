import { describe, it, expect, vi } from 'vitest'

// Mock the config module before importing self-hosted-auth
vi.mock('@/lib/config', () => ({
  default: {
    auth: {
      secret: 'test-secret-for-hashing',
    },
  },
}))

import { hashSelfHostedToken } from '@/lib/self-hosted-auth'

describe('hashSelfHostedToken', () => {
  it('returns a hex string', () => {
    const hash = hashSelfHostedToken('my-password')
    expect(hash).toMatch(/^[0-9a-f]{64}$/)
  })

  it('returns consistent hash for same input', () => {
    const hash1 = hashSelfHostedToken('password123')
    const hash2 = hashSelfHostedToken('password123')
    expect(hash1).toBe(hash2)
  })

  it('returns different hashes for different passwords', () => {
    const hash1 = hashSelfHostedToken('password-a')
    const hash2 = hashSelfHostedToken('password-b')
    expect(hash1).not.toBe(hash2)
  })

  it('produces a 64-char SHA-256 hex digest', () => {
    const hash = hashSelfHostedToken('test')
    expect(hash.length).toBe(64)
  })

  it('handles empty password', () => {
    const hash = hashSelfHostedToken('')
    expect(hash).toMatch(/^[0-9a-f]{64}$/)
  })
})
