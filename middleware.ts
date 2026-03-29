import { default as globalConfig } from "@/lib/config"
import { hashSelfHostedToken } from "@/lib/self-hosted-auth"
import { rateLimit } from "@/lib/rate-limit"
import { getSessionCookie } from "better-auth/cookies"
import { NextRequest, NextResponse } from "next/server"

// Route-specific rate limits (requests per minute)
const RATE_LIMITS: Record<string, number> = {
  "/api/auth/": 5,
  "/api/self-hosted-auth": 5,
  "/api/agent/": 60,
  "/api/": 120,          // general API
}

function getRateLimit(pathname: string): number | null {
  for (const [prefix, limit] of Object.entries(RATE_LIMITS)) {
    if (pathname.startsWith(prefix)) return limit
  }
  return null // no rate limit for non-API routes
}

export default async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  // ── Rate limiting (route-specific) ──
  const maxRequests = getRateLimit(pathname)
  if (maxRequests) {
    const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
      || request.headers.get("x-real-ip")
      || "unknown"
    // Use route prefix as part of the key so limits are independent per route group
    const routeKey = Object.keys(RATE_LIMITS).find(p => pathname.startsWith(p)) || "api"
    const { allowed, remaining, resetAt } = rateLimit(`${ip}:${routeKey}`, { maxRequests, windowMs: 60 * 1000 })

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
    // For auth endpoints, return immediately (don't check session)
    if (pathname.startsWith("/api/auth/") || pathname === "/api/self-hosted-auth") {
      return response
    }
  }

  // ── Self-hosted mode ──
  if (globalConfig.selfHosted.isEnabled) {
    // If a password is configured, require it via cookie
    if (globalConfig.selfHosted.password) {
      const authCookie = request.cookies.get("taxhacker_sh_auth")?.value
      const expectedToken = hashSelfHostedToken(globalConfig.selfHosted.password)
      if (authCookie !== expectedToken) {
        // Allow the password verification endpoint and static assets through
        if (pathname === "/api/self-hosted-auth" || pathname === "/api/health" || pathname.startsWith("/api/agent/") || pathname.startsWith("/_next/") || pathname.startsWith("/logo/")) {
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
    "/api/:path*",
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
