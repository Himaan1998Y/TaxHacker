import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { logSecurityEvent } from "@/lib/security-log"
import config from "@/lib/config"
import { User } from "@/prisma/client"
import crypto from "crypto"

const RATE_LIMIT_WINDOW_MS = 60 * 1000 // 1 minute
const RATE_LIMIT_MAX = 60 // 60 requests per minute
const rateLimitMap = new Map<string, { count: number; resetAt: number }>()

/**
 * Authenticate an agent API request.
 * Returns the user if valid, or a NextResponse error.
 *
 * Auth flow:
 * 1. Check X-Agent-Key header
 * 2. Compare against agent_api_key stored in Settings table (for self-hosted user)
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

  // Get stored API key from settings
  const setting = await prisma.setting.findUnique({
    where: { userId_code: { userId: user.id, code: "agent_api_key" } },
  })

  if (!setting?.value) {
    return NextResponse.json(
      { error: "Agent API key not configured. Set it in Settings → LLM or insert agent_api_key in Settings table." },
      { status: 403 }
    )
  }

  // Constant-time comparison to prevent timing attacks
  const storedKey = Buffer.from(setting.value, "utf8")
  const providedKey = Buffer.from(apiKey, "utf8")

  if (storedKey.length !== providedKey.length || !crypto.timingSafeEqual(storedKey, providedKey)) {
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || null
    logSecurityEvent("agent.key_rejected", user.id, { keyPrefix: apiKey.slice(0, 8) }, ip, req.headers.get("user-agent"))
    return NextResponse.json(
      { error: "Invalid API key" },
      { status: 401 }
    )
  }

  // Rate limiting
  const now = Date.now()
  const rateKey = user.id
  const entry = rateLimitMap.get(rateKey)

  if (entry && now < entry.resetAt) {
    if (entry.count >= RATE_LIMIT_MAX) {
      return NextResponse.json(
        { error: "Rate limit exceeded. Max 60 requests per minute." },
        { status: 429 }
      )
    }
    entry.count++
  } else {
    rateLimitMap.set(rateKey, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS })
  }

  // Clean up old entries periodically
  if (rateLimitMap.size > 100) {
    for (const [key, val] of rateLimitMap) {
      if (now > val.resetAt) rateLimitMap.delete(key)
    }
  }

  return { user }
}

/**
 * Helper to generate a random API key.
 * Call this from a setup endpoint or manually.
 */
export function generateAgentApiKey(): string {
  return `thk_${crypto.randomBytes(32).toString("hex")}`
}
