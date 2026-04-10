import bcrypt from "bcryptjs"
import crypto from "crypto"
import config from "@/lib/config"

const BCRYPT_ROUNDS = 12

/**
 * After this date, legacy SHA-256 auth cookies are no longer accepted.
 * Users will need to re-authenticate with their password.
 * Set to 2026-05-01 (3 weeks from Tier 2 deployment, 2026-04-10).
 */
export const LEGACY_AUTH_CUTOFF = new Date("2026-05-01T00:00:00Z")

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
 * Always compares fixed-length (64-byte) buffers to prevent length oracle attacks.
 * Both a and b MUST be exactly 64 characters (HMAC-SHA256 or SHA-256 hex digests).
 *
 * CRITICAL: This function ONLY works with 64-char inputs. Do not use with variable-length tokens.
 */
export function timingSafeEqual(a: string, b: string): boolean {
  // CRITICAL: Always compare fixed-size buffers to prevent timing-based length oracle attacks.
  // Pad or truncate both inputs to exactly 64 bytes to ensure constant-time comparison.
  // An attacker cannot distinguish short tokens from long ones via response timing.

  const FIXED_SIZE = 64

  // Pad inputs with null bytes if shorter, truncate if longer
  const bufA = Buffer.alloc(FIXED_SIZE)
  const bufB = Buffer.alloc(FIXED_SIZE)

  Buffer.from(a, "utf-8").copy(bufA, 0, 0, FIXED_SIZE)
  Buffer.from(b, "utf-8").copy(bufB, 0, 0, FIXED_SIZE)

  // Log length mismatches for debugging, but don't skip comparison
  if (a.length !== FIXED_SIZE || b.length !== FIXED_SIZE) {
    if (process.env.NODE_ENV !== "test") {
      console.warn(
        `[Auth] Token length mismatch: expected ${FIXED_SIZE} chars, got ${a.length} and ${b.length}. ` +
        `This usually indicates a malformed cookie or misconfigured token format.`
      )
    }
  }

  // Compare using timing-safe function (constant-time regardless of input length)
  try {
    return crypto.timingSafeEqual(bufA, bufB)
  } catch {
    // timingSafeEqual throws if buffers aren't equal length (shouldn't happen since both are FIXED_SIZE)
    return false
  }
}

// Flag to log deprecation warning only once, not on every request
let deprecationWarningLogged = false

/**
 * @deprecated Use computeCookieToken instead.
 * Kept for backward compatibility: existing cookies in browsers use this hash.
 * Remove after LEGACY_AUTH_CUTOFF date (2026-05-01).
 */
export function hashSelfHostedToken(password: string): string {
  // Log warning only once at first invocation (not on every request)
  if (process.env.NODE_ENV === "production" && !deprecationWarningLogged) {
    deprecationWarningLogged = true
    const daysUntilCutoff = Math.ceil((LEGACY_AUTH_CUTOFF.getTime() - Date.now()) / (1000 * 60 * 60 * 24))
    console.warn(
      `[TaxHacker] Legacy auth token format in use (deprecated). ` +
      `Cutoff date: 2026-05-01 (${daysUntilCutoff} days). ` +
      `Users will need to re-authenticate after this date.`
    )
  }
  return crypto
    .createHash("sha256")
    .update(password + config.auth.secret)
    .digest("hex")
}
