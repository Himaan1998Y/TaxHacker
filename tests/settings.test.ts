process.env.ENCRYPTION_KEY = 'a'.repeat(64)

import { describe, it, expect } from 'vitest'
import { decrypt, encrypt, isEncrypted } from '@/lib/encryption'

describe('settings encryption integration', () => {
  it('encrypts values with enc: prefix when key is configured', () => {
    const original = 'super-secret-value'
    const encrypted = encrypt(original)
    expect(encrypted).not.toBe(original)
    expect(encrypted.startsWith('enc:')).toBe(true)
  })

  it('decrypts encrypted values back to the original string', () => {
    const original = 'my-api-key-123'
    const encrypted = encrypt(original)
    const decrypted = decrypt(encrypted)
    expect(decrypted).toBe(original)
  })

  it('returns plaintext values unchanged if not prefixed with enc:', () => {
    const plain = 'plain-text-value'
    expect(decrypt(plain)).toBe(plain)
  })

  it('detects encrypted values using isEncrypted', () => {
    const encrypted = encrypt('foo')
    expect(isEncrypted(encrypted)).toBe(true)
    expect(isEncrypted('not-encrypted')).toBe(false)
  })

  it('handles empty string encryption and decryption', () => {
    const encrypted = encrypt('')
    expect(encrypted).not.toBe(undefined)
    expect(decrypt(encrypted)).toBe('')
  })
})
