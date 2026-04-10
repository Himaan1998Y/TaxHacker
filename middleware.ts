import { default as globalConfig } from "@/lib/config"
import { computeCookieToken, hashSelfHostedToken, timingSafeEqual } from "@/lib/self-hosted-auth"
import { rateLimit } from "@/lib/rate-limit"
import { getSessionCookie } from "better-auth/cookies"
import { NextRequest, NextResponse } from "next/server"

// Routes that require authentication checks (rate limiting + session/self-hosted guard).
// Public routes (landing, pricing, auth pages, static assets) skip auth checks.
const AUTH_PROTECTED_PREFIXES = [
  "/api/",
  "/transactions/",
  "/settings/",
  "/export/",
  "/import/",
  "/unsorted/",
  "/files/",
  "/dashboard/",
  "/apps/",
  "/self-hosted-login",
]

function isAuthProtected(pathname: string): boolean {
  return AUTH_PROTECTED_PREFIXES.some((prefix) => pathname.startsWith(prefix))
}

/**
 * Build the Content-Security-Policy header value for a given nonce.
 * The nonce replaces 'unsafe-inline' for scripts.
 * 'unsafe-eval' is retained only in development for Next.js Turbopack HMR.
 */
function buildCSP(nonce: string): string {
  const isDev = process.env.NODE_ENV !== "production"
  const scriptSrc = isDev
    ? `script-src 'self' 'nonce-${nonce}' 'unsafe-eval'`
    : `script-src 'self' 'nonce-${nonce}'`

  return [
    "default-src 'self'",
    scriptSrc,
    "style-src 'self' 'unsafe-inline'",     // Tailwind / Next.js inline styles
    "img-src 'self' data: blob:",            // data: for base64, blob: for previews
    "font-src 'self' data:",
    "connect-src 'self' https://*.sentry.io",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
  ].join("; ")
}

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

  // ── Nonce generation (runs on every request for CSP header) ──
  // crypto.randomUUID() is available in the Next.js edge runtime.
  const nonce = crypto.randomUUID().replace(/-/g, "")
  const csp = buildCSP(nonce)

  // Clone request headers so the nonce is available to Server Components via headers()
  const requestHeaders = new Headers(request.headers)
  requestHeaders.set("x-nonce", nonce)

  // Helper: create a NextResponse that carries both the mutated request headers
  // and the CSP response header. Used at every return point below.
  function nextWithCSP(response?: NextResponse): NextResponse {
    const res = response ?? NextResponse.next({ request: { headers: requestHeaders } })
    res.headers.set("Content-Security-Policy", csp)
    return res
  }

  // ── Auth checks only run for protected routes ──
  if (!isAuthProtected(pathname)) {
    return nextWithCSP()
  }

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
      // 429 responses don't need a nonce — no scripts execute on error pages.
      return new NextResponse("Too many requests. Try again later.", {
        status: 429,
        headers: {
          "Retry-After": String(Math.ceil((resetAt - Date.now()) / 1000)),
          "X-RateLimit-Remaining": "0",
          "Content-Security-Policy": csp,
        },
      })
    }

    // For auth endpoints, return immediately (don't check session).
    // Other API routes continue to the session checks below.
    if (pathname.startsWith("/api/auth/") || pathname === "/api/self-hosted-auth") {
      const rateLimitedResponse = nextWithCSP()
      rateLimitedResponse.headers.set("X-RateLimit-Remaining", String(remaining))
      return rateLimitedResponse
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
          return nextWithCSP()
        }
        // Redirect to password page — redirects don't render scripts, but include CSP anyway
        if (pathname !== "/self-hosted-login") {
          return NextResponse.redirect(new URL("/self-hosted-login", request.url))
        }
      }
    }
    return nextWithCSP()
  }

  // ── Normal auth mode ──
  const sessionCookie = getSessionCookie(request, { cookiePrefix: "taxhacker" })
  if (!sessionCookie) {
    return NextResponse.redirect(new URL(globalConfig.auth.loginUrl, request.url))
  }
  return nextWithCSP()
}

export const config = {
  // Middleware uses bcryptjs and Node crypto, so must run on Node runtime.
  // On self-hosted (Coolify), this is a no-op (always Node). On Vercel Edge,
  // this ensures the middleware doesn't try to run in Edge Runtime.
  runtime: "nodejs" as const,
  // Run on all routes so every response gets a nonce-based CSP header.
  // Static file paths (_next/static, _next/image, favicons) are excluded
  // because Next.js serves them without running middleware anyway.
  matcher: [
    "/((?!_next/static|_next/image|favicon\\.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|woff2?|ttf|otf)).*)",
  ],
}
