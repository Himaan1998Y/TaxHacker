import config from "@/lib/config"
import { hashSelfHostedToken } from "@/lib/self-hosted-auth"
import { logSecurityEvent } from "@/lib/security-log"
import { prisma } from "@/lib/db"
import { NextRequest, NextResponse } from "next/server"

async function getSelfHostedUserId(): Promise<string> {
  const user = await prisma.user.findFirst({ where: { email: "taxhacker@localhost" }, select: { id: true } })
  return user?.id || "unknown"
}

export async function POST(request: NextRequest) {
  if (!config.selfHosted.isEnabled || !config.selfHosted.password) {
    return NextResponse.json({ error: "Not configured" }, { status: 404 })
  }

  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || null
  const ua = request.headers.get("user-agent") || null

  try {
    const { password } = await request.json()

    if (password !== config.selfHosted.password) {
      const userId = await getSelfHostedUserId()
      logSecurityEvent("auth.login_failed", userId, { reason: "wrong_password" }, ip, ua)
      return NextResponse.json({ error: "Invalid password" }, { status: 401 })
    }

    const userId = await getSelfHostedUserId()
    logSecurityEvent("auth.login_success", userId, {}, ip, ua)

    // Set auth cookie — httpOnly, 30 days
    // Cookie stores a hash, never the raw password
    const isSecure = request.headers.get("x-forwarded-proto") === "https"
      || request.url.startsWith("https")
    const response = NextResponse.json({ success: true })
    response.cookies.set("taxhacker_sh_auth", hashSelfHostedToken(password), {
      httpOnly: true,
      secure: isSecure,
      sameSite: "lax",
      maxAge: 30 * 24 * 60 * 60, // 30 days
      path: "/",
    })

    return response
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 })
  }
}
