import { default as globalConfig } from "@/lib/config"
import { rateLimit } from "@/lib/rate-limit"
import { getSessionCookie } from "better-auth/cookies"
import { NextRequest, NextResponse } from "next/server"

export default async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  // ── Rate limiting on auth endpoints (5 req/min per IP) ──
  if (pathname.startsWith("/api/auth/")) {
    const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
      || request.headers.get("x-real-ip")
      || "unknown"
    const { allowed, remaining, resetAt } = rateLimit(ip, { maxRequests: 5, windowMs: 60 * 1000 })

    if (!allowed) {
      return new NextResponse("Too many requests. Try again later.", {
        status: 429,
        headers: {
          "Retry-After": String(Math.ceil((resetAt - Date.now()) / 1000)),
          "X-RateLimit-Remaining": "0",
        },
      })
    }

    const response = NextResponse.next()
    response.headers.set("X-RateLimit-Remaining", String(remaining))
    return response
  }

  // ── Self-hosted mode ──
  if (globalConfig.selfHosted.isEnabled) {
    // If a password is configured, require it via cookie
    if (globalConfig.selfHosted.password) {
      const authCookie = request.cookies.get("taxhacker_sh_auth")?.value
      if (authCookie !== globalConfig.selfHosted.password) {
        // Allow the password verification endpoint and static assets through
        if (pathname === "/api/self-hosted-auth" || pathname.startsWith("/_next/") || pathname.startsWith("/logo/")) {
          return NextResponse.next()
        }
        // Redirect to password page
        if (pathname !== "/self-hosted-login") {
          return NextResponse.redirect(new URL("/self-hosted-login", request.url))
        }
      }
    }
    return NextResponse.next()
  }

  // ── Normal auth mode ──
  const sessionCookie = getSessionCookie(request, { cookiePrefix: "taxhacker" })
  if (!sessionCookie) {
    return NextResponse.redirect(new URL(globalConfig.auth.loginUrl, request.url))
  }
  return NextResponse.next()
}

export const config = {
  matcher: [
    "/api/auth/:path*",
    "/transactions/:path*",
    "/settings/:path*",
    "/export/:path*",
    "/import/:path*",
    "/unsorted/:path*",
    "/files/:path*",
    "/dashboard/:path*",
    "/apps/:path*",
    "/self-hosted-login",
  ],
}
