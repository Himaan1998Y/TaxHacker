import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest'

// Set encryption key BEFORE importing the module so getKey() picks it up
process.env.ENCRYPTION_KEY = 'a'.repeat(64)

import { encrypt, decrypt, isEncrypted } from '@/lib/encryption'

describe('encrypt / decrypt', () => {
  it('roundtrip: encrypt then decrypt returns original text', () => {
    const original = 'my-super-secret-api-key-12345'
    const encrypted = encrypt(original)
    expect(encrypted).not.toBe(original)
    expect(encrypted.startsWith('enc:')).toBe(true)

    const decrypted = decrypt(encrypted)
    expect(decrypted).toBe(original)
  })

  it('encrypts to enc: prefixed format with 4 colon-separated parts', () => {
    const encrypted = encrypt('hello')
    const parts = encrypted.split(':')
    expect(parts.length).toBe(4)
    expect(parts[0]).toBe('enc')
  })

  it('decrypt returns plaintext as-is when no enc: prefix', () => {
    const plaintext = 'this-is-not-encrypted'
    expect(decrypt(plaintext)).toBe(plaintext)
  })

  it('each encryption produces a different ciphertext (random IV)', () => {
    const text = 'same-input'
    const enc1 = encrypt(text)
    const enc2 = encrypt(text)
    expect(enc1).not.toBe(enc2) // different IVs
    // Both should decrypt to the same value
    expect(decrypt(enc1)).toBe(text)
    expect(decrypt(enc2)).toBe(text)
  })

  it('handles empty string encryption', () => {
    const encrypted = encrypt('')
    const decrypted = decrypt(encrypted)
    expect(decrypted).toBe('')
  })

  it('handles unicode text', () => {
    const text = 'भारत GST ₹10,000'
    const encrypted = encrypt(text)
    const decrypted = decrypt(encrypted)
    expect(decrypted).toBe(text)
  })

  it('handles long text', () => {
    const text = 'x'.repeat(10000)
    const encrypted = encrypt(text)
    const decrypted = decrypt(encrypted)
    expect(decrypted).toBe(text)
  })
})

describe('isEncrypted', () => {
  it('returns true for enc: prefixed strings', () => {
    expect(isEncrypted('enc:abc:def:ghi')).toBe(true)
  })

  it('returns false for plain strings', () => {
    expect(isEncrypted('plain-text-value')).toBe(false)
  })

  it('returns false for empty string', () => {
    expect(isEncrypted('')).toBe(false)
  })

  it('returns true for actual encrypted output', () => {
    const encrypted = encrypt('test')
    expect(isEncrypted(encrypted)).toBe(true)
  })
})

// Regression for Tier 0 audit finding 0.2: the previous behaviour in
// lib/encryption.ts silently stored PII as plaintext if ENCRYPTION_KEY was
// missing. Now, production runs must refuse to encrypt rather than fall
// back. vi.isolateModules() gives us a fresh copy of the module with a
// different env so we can test both branches without leaking state.
describe('encryption invariant (production mode)', () => {
  const originalKey = process.env.ENCRYPTION_KEY
  const originalNodeEnv = process.env.NODE_ENV
  const originalPhase = process.env.NEXT_PHASE

  afterEach(() => {
    if (originalKey === undefined) delete (process.env as Record<string, string | undefined>).ENCRYPTION_KEY
    else process.env.ENCRYPTION_KEY = originalKey
    if (originalNodeEnv === undefined) delete (process.env as Record<string, string | undefined>).NODE_ENV
    else (process.env as Record<string, string>).NODE_ENV = originalNodeEnv
    if (originalPhase === undefined) delete (process.env as Record<string, string | undefined>).NEXT_PHASE
    else process.env.NEXT_PHASE = originalPhase
    vi.resetModules()
  })

  it('throws when ENCRYPTION_KEY is missing in production', async () => {
    vi.resetModules()
    delete (process.env as Record<string, string | undefined>).ENCRYPTION_KEY
    ;(process.env as Record<string, string>).NODE_ENV = 'production'
    delete (process.env as Record<string, string | undefined>).NEXT_PHASE
    const mod = await import('@/lib/encryption')
    expect(() => mod.encrypt('secret')).toThrow(/ENCRYPTION_KEY is missing/)
  })

  it('throws when ENCRYPTION_KEY is the wrong length in production', async () => {
    vi.resetModules()
    process.env.ENCRYPTION_KEY = 'short'
    ;(process.env as Record<string, string>).NODE_ENV = 'production'
    delete (process.env as Record<string, string | undefined>).NEXT_PHASE
    const mod = await import('@/lib/encryption')
    expect(() => mod.encrypt('secret')).toThrow(/missing or malformed/)
  })

  it('falls back to plaintext in development when key is missing', async () => {
    vi.resetModules()
    delete (process.env as Record<string, string | undefined>).ENCRYPTION_KEY
    ;(process.env as Record<string, string>).NODE_ENV = 'development'
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const mod = await import('@/lib/encryption')
    expect(mod.encrypt('hello')).toBe('hello')
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('plaintext storage'))
    warnSpy.mockRestore()
  })
})
