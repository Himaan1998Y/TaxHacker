// Simple in-memory rate limiter for Edge middleware — no external dependencies
// Uses lazy cleanup (on access) instead of setInterval (not reliable in Edge)

type RateLimitEntry = {
  count: number
  resetAt: number
}

const store = new Map<string, RateLimitEntry>()

export function rateLimit(
  ip: string,
  { maxRequests = 5, windowMs = 60 * 1000 }: { maxRequests?: number; windowMs?: number } = {}
): { allowed: boolean; remaining: number; resetAt: number } {
  const now = Date.now()

  // Lazy cleanup — remove expired entries when store gets large
  if (store.size > 10000) {
    for (const [key, entry] of store) {
      if (now > entry.resetAt) store.delete(key)
    }
  }

  const entry = store.get(ip)

  if (!entry || now > entry.resetAt) {
    store.set(ip, { count: 1, resetAt: now + windowMs })
    return { allowed: true, remaining: maxRequests - 1, resetAt: now + windowMs }
  }

  if (entry.count >= maxRequests) {
    return { allowed: false, remaining: 0, resetAt: entry.resetAt }
  }

  entry.count++
  return { allowed: true, remaining: maxRequests - entry.count, resetAt: entry.resetAt }
}
