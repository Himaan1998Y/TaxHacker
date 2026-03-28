import config from "@/lib/config"
import { hashSelfHostedToken } from "@/lib/self-hosted-auth"
import { NextRequest, NextResponse } from "next/server"

export async function POST(request: NextRequest) {
  if (!config.selfHosted.isEnabled || !config.selfHosted.password) {
    return NextResponse.json({ error: "Not configured" }, { status: 404 })
  }

  try {
    const { password } = await request.json()

    if (password !== config.selfHosted.password) {
      return NextResponse.json({ error: "Invalid password" }, { status: 401 })
    }

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
