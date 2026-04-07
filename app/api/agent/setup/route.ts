import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"
import { prisma } from "@/lib/db"
import config from "@/lib/config"
import { timingSafeEqual } from "@/lib/self-hosted-auth"
import { logSecurityEvent } from "@/lib/security-log"
import { generateAgentApiKey } from "../auth"

/**
 * POST /api/agent/setup — Generate a new agent API key
 *
 * Protected by self-hosted password (same as main app auth).
 * Returns the key ONCE — store it securely, it won't be shown again.
 *
 * SECURITY: Rate-limited to 5 req/min per IP (see middleware.ts) +
 * timing-safe password comparison to block brute-force and timing attacks.
 */
export async function POST(req: NextRequest) {
  if (!config.selfHosted.isEnabled) {
    return NextResponse.json({ error: "Only available in self-hosted mode" }, { status: 403 })
  }

  // Verify self-hosted password if configured
  if (config.selfHosted.password) {
    const body = await req.json().catch(() => ({}))
    const submitted = typeof body?.password === "string" ? body.password : ""

    if (!timingSafeEqual(submitted, config.selfHosted.password)) {
      // Audit log: record IP, user-agent, and failure reason
      // userId is unknown at this point (unauthenticated) — use sentinel value
      const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
        || req.headers.get("x-real-ip")
        || null
      const ua = req.headers.get("user-agent") || null
      logSecurityEvent(
        "agent.setup_failed",
        "unauthenticated",
        { reason: "wrong_password", endpoint: "/api/agent/setup" },
        ip,
        ua
      )
      return NextResponse.json({ error: "Invalid password" }, { status: 401 })
    }
  }

  const user = await prisma.user.findFirst({
    where: { email: "taxhacker@localhost" },
  })

  if (!user) {
    return NextResponse.json({ error: "Complete initial setup first" }, { status: 403 })
  }

  const { plainKey, hashedKey } = generateAgentApiKey()

  // Store the HASH — the plain key is only shown once to the user
  await prisma.setting.upsert({
    where: { userId_code: { userId: user.id, code: "agent_api_key" } },
    update: { value: hashedKey },
    create: {
      code: "agent_api_key",
      name: "Agent API Key",
      value: hashedKey,
      userId: user.id,
    },
  })

  return NextResponse.json({
    apiKey: plainKey,
    message: "Store this key securely. It won't be shown again.",
    usage: 'curl -H "X-Agent-Key: ' + plainKey + '" http://localhost:7331/api/agent/transactions',
  })
}
