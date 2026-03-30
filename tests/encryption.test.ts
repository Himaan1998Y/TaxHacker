import { describe, it, expect, beforeAll } from 'vitest'

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
