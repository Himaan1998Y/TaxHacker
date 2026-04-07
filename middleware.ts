import { default as globalConfig } from "@/lib/config"
import { computeCookieToken, hashSelfHostedToken, timingSafeEqual } from "@/lib/self-hosted-auth"
import { rateLimit } from "@/lib/rate-limit"
import { getSessionCookie } from "better-auth/cookies"
import { NextRequest, NextResponse } from "next/server"

// Route-specific rate limits.
// Order matters: first matching prefix wins. Most specific first.
// windowMs defaults to 60s unless overridden per route.
type RateLimitConfig = { maxRequests: number; windowMs?: number }

const RATE_LIMITS: Record<string, RateLimitConfig> = {
  "/api/auth/": { maxRequests: 5 },
  "/api/self-hosted-auth": { maxRequests: 5 },
  "/api/agent/setup": { maxRequests: 5, windowMs: 15 * 60 * 1000 }, // 15-min window — brute-force guard
  "/api/agent/": { maxRequests: 60 },
  "/api/": { maxRequests: 120 },
}

function getRateLimit(pathname: string): RateLimitConfig | null {
  for (const [prefix, cfg] of Object.entries(RATE_LIMITS)) {
    if (pathname.startsWith(prefix)) return cfg
  }
  return null // no rate limit for non-API routes
}

export default async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  // ── Rate limiting (route-specific) ──
  const rateLimitCfg = getRateLimit(pathname)
  if (rateLimitCfg) {
    const { maxRequests, windowMs = 60 * 1000 } = rateLimitCfg
    const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
      || request.headers.get("x-real-ip")
      || "unknown"
    // Use route prefix as part of the key so limits are independent per route group
    const routeKey = Object.keys(RATE_LIMITS).find(p => pathname.startsWith(p)) || "api"
    const { allowed, remaining, resetAt } = rateLimit(`${ip}:${routeKey}`, { maxRequests, windowMs })

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
      const authCookie = request.cookies.get("taxhacker_sh_auth")?.value ?? ""
      const password = globalConfig.selfHosted.password!
      // Accept both new HMAC token and legacy SHA-256 token during migration window
      const validNew = timingSafeEqual(authCookie, computeCookieToken(password))
      const validLegacy = timingSafeEqual(authCookie, hashSelfHostedToken(password))
      if (!validNew && !validLegacy) {
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
