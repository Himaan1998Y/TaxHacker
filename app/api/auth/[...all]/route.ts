import { auth } from "@/lib/auth"
import { toNextJsHandler } from "better-auth/next-js"
import { NextRequest, NextResponse } from "next/server"

// In-memory rate limiter — no external deps, resets on process restart (fine for self-hosted)
const rateLimitStore = new Map<string, { count: number; resetAt: number }>()

const RATE_LIMITS: Record<string, { max: number; windowMs: number }> = {
  "/api/auth/email-otp/send-otp": { max: 5, windowMs: 60 * 60 * 1000 }, // 5 OTPs/hr per IP
  "/api/auth/sign-in/email-otp": { max: 10, windowMs: 60 * 60 * 1000 }, // 10 attempts/hr per IP
}

function getClientIP(req: NextRequest): string {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "unknown"
  )
}

function isRateLimited(key: string, max: number, windowMs: number): boolean {
  const now = Date.now()
  const entry = rateLimitStore.get(key)

  if (!entry || entry.resetAt < now) {
    rateLimitStore.set(key, { count: 1, resetAt: now + windowMs })
    return false
  }

  if (entry.count >= max) {
    return true
  }

  entry.count++
  return false
}

const { POST: authPost, GET } = toNextJsHandler(auth)

async function POST(req: NextRequest) {
  const path = req.nextUrl.pathname
  const limit = RATE_LIMITS[path]

  if (limit) {
    const ip = getClientIP(req)
    if (isRateLimited(`${ip}:${path}`, limit.max, limit.windowMs)) {
      return NextResponse.json({ error: "Too many requests. Please try again later." }, { status: 429 })
    }
  }

  return authPost(req)
}

export { POST, GET }
