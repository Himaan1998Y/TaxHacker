import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { logSecurityEvent } from "@/lib/security-log"
import config from "@/lib/config"
import { User } from "@/prisma/client"
import crypto from "crypto"
import { decrypt } from "@/lib/encryption"
import { checkRateLimit } from "@/lib/rate-limit-db"

const RATE_LIMIT_WINDOW_MS = 60 * 1000 // 1 minute
const RATE_LIMIT_MAX = 60 // 60 requests per minute
const RATE_LIMIT_BUCKET = "agent-api"

/** SHA-256 hash of an API key — used for storage and comparison */
function hashApiKey(key: string): string {
  return crypto.createHash("sha256").update(key).digest("hex")
}

/**
 * Authenticate an agent API request.
 * Returns the user if valid, or a NextResponse error.
 *
 * Auth flow:
 * 1. Check X-Agent-Key header
 * 2. Hash it with SHA-256, compare against stored hash in Settings table
 * 3. Rate limit by key
 */
export async function authenticateAgent(
  req: NextRequest
): Promise<{ user: User } | NextResponse> {
  const apiKey = req.headers.get("x-agent-key")

  if (!apiKey) {
    return NextResponse.json(
      { error: "Missing X-Agent-Key header" },
      { status: 401 }
    )
  }

  // In self-hosted mode, resolve the single user
  if (!config.selfHosted.isEnabled) {
    return NextResponse.json(
      { error: "Agent API is only available in self-hosted mode" },
      { status: 403 }
    )
  }

  // Get the self-hosted user
  const user = await prisma.user.findFirst({
    where: { email: "taxhacker@localhost" },
  })

  if (!user) {
    return NextResponse.json(
      { error: "Self-hosted user not found. Complete initial setup first." },
      { status: 403 }
    )
  }

  // Get stored API key hash from settings
  const setting = await prisma.setting.findUnique({
    where: { userId_code: { userId: user.id, code: "agent_api_key" } },
  })

  if (!setting?.value) {
    return NextResponse.json(
      { error: "Agent API key not configured. Set it in Settings → LLM or insert agent_api_key in Settings table." },
      { status: 403 }
    )
  }

  // Decrypt the stored value (settings layer encrypts SENSITIVE_SETTINGS)
  const storedValue = decrypt(setting.value)

  // Migration: detect if stored value is old-format plaintext key (starts with "thk_")
  // vs new-format SHA-256 hash (64 hex chars, no prefix)
  const isLegacyFormat = storedValue.startsWith("thk_")
  let isValid = false

  if (isLegacyFormat) {
    // Legacy: compare directly (timing-safe)
    const storedBuf = Buffer.from(storedValue, "utf8")
    const providedBuf = Buffer.from(apiKey, "utf8")
    if (storedBuf.length === providedBuf.length) {
      isValid = crypto.timingSafeEqual(storedBuf, providedBuf)
    }

    // Auto-migrate: store the hash instead on successful auth
    if (isValid) {
      const hashedKey = hashApiKey(apiKey)
      await prisma.setting.update({
        where: { userId_code: { userId: user.id, code: "agent_api_key" } },
        data: { value: hashedKey },
      })
    }
  } else {
    // New format: compare hashes (both are 64-char hex strings)
    const providedHash = hashApiKey(apiKey)
    const storedBuf = Buffer.from(storedValue, "utf8")
    const providedBuf = Buffer.from(providedHash, "utf8")
    if (storedBuf.length === providedBuf.length) {
      isValid = crypto.timingSafeEqual(storedBuf, providedBuf)
    }
  }

  if (!isValid) {
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || null
    logSecurityEvent("agent.key_rejected", user.id, { keyPrefix: apiKey.slice(0, 8) }, ip, req.headers.get("user-agent"))
    return NextResponse.json(
      { error: "Invalid API key" },
      { status: 401 }
    )
  }

  // Rate limiting — backed by the rate_limits Postgres table so counters
  // survive container restarts and rolling deploys. The previous in-
  // process Map reset on every deploy, meaning a user could burn through
  // 60 requests, trigger a deploy (or wait for one), and repeat forever.
  const rateLimitResult = await checkRateLimit(RATE_LIMIT_BUCKET, user.id, {
    maxRequests: RATE_LIMIT_MAX,
    windowMs: RATE_LIMIT_WINDOW_MS,
  })

  if (!rateLimitResult.allowed) {
    const retryAfterSeconds = Math.max(
      1,
      Math.ceil((rateLimitResult.resetAt.getTime() - Date.now()) / 1000)
    )
    return NextResponse.json(
      {
        error: `Rate limit exceeded. Max ${RATE_LIMIT_MAX} requests per minute.`,
      },
      {
        status: 429,
        headers: {
          "Retry-After": String(retryAfterSeconds),
          "X-RateLimit-Limit": String(RATE_LIMIT_MAX),
          "X-RateLimit-Remaining": "0",
          "X-RateLimit-Reset": String(Math.floor(rateLimitResult.resetAt.getTime() / 1000)),
        },
      }
    )
  }

  return { user }
}

/**
 * Generate a new agent API key.
 * Returns { plainKey, hashedKey }. The plainKey is shown once to the user.
 * Store hashedKey in settings (it will be encrypted at rest by the settings layer).
 */
export function generateAgentApiKey(): { plainKey: string; hashedKey: string } {
  const plainKey = `thk_${crypto.randomBytes(32).toString("hex")}`
  const hashedKey = hashApiKey(plainKey)
  return { plainKey, hashedKey }
}
