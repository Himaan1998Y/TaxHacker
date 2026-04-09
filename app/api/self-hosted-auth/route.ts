import config from "@/lib/config"
import { computeCookieToken, hashPassword, hashSelfHostedToken, timingSafeEqual, verifyPassword } from "@/lib/self-hosted-auth"
import { logSecurityEvent } from "@/lib/security-log"
import { prisma } from "@/lib/db"
import { NextRequest, NextResponse } from "next/server"

const SH_PASSWORD_HASH_KEY = "sh_password_hash"

async function getSelfHostedUserId(): Promise<string> {
  const user = await prisma.user.findFirst({ where: { email: "taxhacker@localhost" }, select: { id: true } })
  return user?.id || "unknown"
}

async function getStoredBcryptHash(userId: string): Promise<string | null> {
  if (userId === "unknown") return null
  const setting = await prisma.setting.findUnique({
    where: { userId_code: { userId, code: SH_PASSWORD_HASH_KEY } },
    select: { value: true },
  })
  return setting?.value || null
}

async function storeBcryptHash(userId: string, password: string): Promise<void> {
  if (userId === "unknown") return
  const hash = await hashPassword(password)
  await prisma.setting.upsert({
    where: { userId_code: { userId, code: SH_PASSWORD_HASH_KEY } },
    update: { value: hash },
    create: { code: SH_PASSWORD_HASH_KEY, name: "Self-hosted password hash", value: hash, userId },
  })
}

export async function POST(request: NextRequest) {
  if (!config.selfHosted.isEnabled || !config.selfHosted.password) {
    return NextResponse.json({ error: "Not configured" }, { status: 404 })
  }

  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || null
  const ua = request.headers.get("user-agent") || null

  try {
    const { password } = await request.json()

    if (typeof password !== "string" || password.length === 0) {
      return NextResponse.json({ error: "Invalid request" }, { status: 400 })
    }

    const userId = await getSelfHostedUserId()
    const storedHash = await getStoredBcryptHash(userId)

    let authenticated = false

    if (storedHash) {
      // ── Modern path: bcrypt comparison ──
      authenticated = await verifyPassword(password, storedHash)
    } else {
      // ── Migration path: direct comparison against env var ──
      // Falls through for first-login on existing deployments
      authenticated = timingSafeEqual(password, config.selfHosted.password!)
    }

    if (!authenticated) {
      logSecurityEvent("auth.login_failed", userId, { reason: "wrong_password" }, ip, ua)
      return NextResponse.json({ error: "Invalid password" }, { status: 401 })
    }

    // On first successful login (no stored hash yet), migrate to bcrypt
    if (!storedHash) {
      await storeBcryptHash(userId, password)
    }

    logSecurityEvent("auth.login_success", userId, {}, ip, ua)

    // Set auth cookie — httpOnly, 30 days. Cookie stores an HMAC token,
    // not the raw password.
    //
    // The `secure` flag must be derived from NODE_ENV, not from the
    // x-forwarded-proto header or request.url. Both are attacker-
    // controlled through a misconfigured proxy: an attacker-controlled
    // ingress could spoof x-forwarded-proto=http and force the cookie
    // to be set without Secure, letting the session cookie leak over
    // plaintext. Production always runs behind HTTPS (Coolify/Traefik
    // terminates TLS, internal hop to the app is still HTTP but the
    // browser talks HTTPS), so NODE_ENV is the right signal.
    const isProduction = process.env.NODE_ENV === "production"
    const response = NextResponse.json({ success: true })
    response.cookies.set("taxhacker_sh_auth", computeCookieToken(password), {
      httpOnly: true,
      secure: isProduction,
      sameSite: "lax",
      maxAge: 30 * 24 * 60 * 60, // 30 days
      path: "/",
    })

    return response
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 })
  }
}
