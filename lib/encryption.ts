import crypto from "crypto"

const ALGORITHM = "aes-256-gcm"

// Defence-in-depth: lib/config.ts already throws at boot in production if
// ENCRYPTION_KEY is missing. This second check lives at the encryption call
// site itself so any code path that reaches encrypt()/decrypt() without a
// valid key in production fails loudly instead of silently storing PII
// (GSTIN, PAN, API keys) in plaintext. In dev/test we preserve the
// plaintext fallback but log it once so it is visible, not silent.
const isProductionRuntime =
  process.env.NODE_ENV === "production" && process.env.NEXT_PHASE !== "phase-production-build"

let devPlaintextWarningLogged = false

function getKey(): Buffer {
  const key = process.env.ENCRYPTION_KEY
  if (!key || key.length !== 64) {
    if (isProductionRuntime) {
      throw new Error(
        "[ENCRYPTION] ENCRYPTION_KEY is missing or malformed in production. " +
          "Expected a 64-character hex string (generate with: openssl rand -hex 32). " +
          "Refusing to encrypt PII as plaintext."
      )
    }
    if (!devPlaintextWarningLogged) {
      devPlaintextWarningLogged = true
      console.warn(
        "[ENCRYPTION] ENCRYPTION_KEY not set — falling back to plaintext storage (development only). " +
          "Set ENCRYPTION_KEY to a 64-character hex string before using real data."
      )
    }
    return Buffer.alloc(0)
  }
  return Buffer.from(key, "hex")
}

/**
 * Encrypt a string using AES-256-GCM.
 * Returns format: iv:authTag:ciphertext (all hex)
 * If no ENCRYPTION_KEY is set, returns plaintext (development fallback).
 */
export function encrypt(text: string): string {
  const key = getKey()
  if (key.length === 0) return text

  const iv = crypto.randomBytes(16)
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv)
  let encrypted = cipher.update(text, "utf8", "hex")
  encrypted += cipher.final("hex")
  const tag = cipher.getAuthTag().toString("hex")
  return `enc:${iv.toString("hex")}:${tag}:${encrypted}`
}

/**
 * Decrypt an AES-256-GCM encrypted string.
 * If the string doesn't start with "enc:", returns it as-is (plaintext/legacy).
 */
export function decrypt(data: string): string {
  if (!data.startsWith("enc:")) return data // plaintext or legacy

  const key = getKey()
  if (key.length === 0) return data // no key, can't decrypt

  const parts = data.split(":")
  if (parts.length !== 4) return data

  const [, ivHex, tagHex, encrypted] = parts
  const decipher = crypto.createDecipheriv(ALGORITHM, key, Buffer.from(ivHex, "hex"))
  decipher.setAuthTag(Buffer.from(tagHex, "hex"))
  let decrypted = decipher.update(encrypted, "hex", "utf8")
  decrypted += decipher.final("utf8")
  return decrypted
}

/**
 * Check if a value is already encrypted.
 */
export function isEncrypted(value: string): boolean {
  return value.startsWith("enc:")
}
