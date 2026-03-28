import { NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import config from "@/lib/config"
import { generateAgentApiKey } from "../auth"

/**
 * POST /api/agent/setup — Generate a new agent API key
 *
 * Protected by self-hosted password (same as main app auth).
 * Returns the key ONCE — store it securely, it won't be shown again.
 */
export async function POST(req: Request) {
  if (!config.selfHosted.isEnabled) {
    return NextResponse.json({ error: "Only available in self-hosted mode" }, { status: 403 })
  }

  // Verify self-hosted password if configured
  if (config.selfHosted.password) {
    const body = await req.json().catch(() => ({}))
    if (body.password !== config.selfHosted.password) {
      return NextResponse.json({ error: "Invalid password" }, { status: 401 })
    }
  }

  const user = await prisma.user.findFirst({
    where: { email: "taxhacker@localhost" },
  })

  if (!user) {
    return NextResponse.json({ error: "Complete initial setup first" }, { status: 403 })
  }

  const apiKey = generateAgentApiKey()

  // Store the key in settings
  await prisma.setting.upsert({
    where: { userId_code: { userId: user.id, code: "agent_api_key" } },
    update: { value: apiKey },
    create: {
      code: "agent_api_key",
      name: "Agent API Key",
      value: apiKey,
      userId: user.id,
    },
  })

  return NextResponse.json({
    apiKey,
    message: "Store this key securely. It won't be shown again.",
    usage: 'curl -H "X-Agent-Key: ' + apiKey + '" http://localhost:7331/api/agent/transactions',
  })
}
