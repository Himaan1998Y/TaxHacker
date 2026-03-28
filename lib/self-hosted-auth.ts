import crypto from "crypto"
import config from "@/lib/config"

/**
 * Hash a self-hosted password into a cookie token.
 * Uses SHA-256 with the auth secret as salt so the raw password
 * is never stored in the browser cookie.
 */
export function hashSelfHostedToken(password: string): string {
  return crypto
    .createHash("sha256")
    .update(password + config.auth.secret)
    .digest("hex")
}
