import bcrypt from "bcryptjs"
import crypto from "crypto"
import config from "@/lib/config"

const BCRYPT_ROUNDS = 12

/**
 * Hash a password for storage using bcrypt.
 * Use this when storing the admin password in the DB.
 */
export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_ROUNDS)
}

/**
 * Verify a submitted password against a stored bcrypt hash.
 */
export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash)
}

/**
 * Compute the cookie token for the self-hosted session.
 * Uses HMAC-SHA256 (cryptographically correct construction vs plain concatenation).
 * Returns a hex string. Deterministic — safe to use in middleware without bcrypt overhead.
 */
export function computeCookieToken(password: string): string {
  return crypto
    .createHmac("sha256", config.auth.secret)
    .update(password)
    .digest("hex")
}

/**
 * Timing-safe comparison of two strings.
 * Prevents timing attacks on cookie/token comparison.
 */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) {
    // Still do a dummy compare to avoid early-exit timing leak
    crypto.timingSafeEqual(Buffer.from(a), Buffer.from(a))
    return false
  }
  return crypto.timingSafeEqual(Buffer.from(a, "utf8"), Buffer.from(b, "utf8"))
}

/**
 * @deprecated Use computeCookieToken instead.
 * Kept for backward compatibility: existing cookies in browsers use this hash.
 * Remove after 30-day migration window.
 */
export function hashSelfHostedToken(password: string): string {
  return crypto
    .createHash("sha256")
    .update(password + config.auth.secret)
    .digest("hex")
}
