import { prisma } from "@/lib/db"

/**
 * Durable rate limiter backed by the rate_limits Postgres table.
 *
 * Replaces the previous in-process Map for use cases that must survive
 * container restarts — notably the agent API auth flow, where a simple
 * Map meant every rolling deploy reset the counter and made the rate
 * limit toothless across deploys.
 *
 * Contract:
 *   - `bucket` is a free-form namespace — pick one string per rate
 *     limiter so different callers don't collide on the same key
 *     (e.g. "agent-api" vs "password-attempts").
 *   - `key` is the thing being limited within that bucket (user id,
 *     IP address, API key prefix, etc.)
 *   - Returns { allowed, remaining, resetAt }. When allowed is false
 *     the caller should respond with 429.
 *
 * Concurrency: the UPSERT path is the slow branch on first hit; the
 * fast path is a single atomic UPDATE ... RETURNING that both increments
 * and reads the new count. Under contention, Postgres serializes writes
 * to the same row, so concurrent N requests all see a consistent
 * post-increment count. There is no TOCTOU window between the check and
 * the increment.
 */
export async function checkRateLimit(
  bucket: string,
  key: string,
  {
    maxRequests,
    windowMs,
  }: { maxRequests: number; windowMs: number }
): Promise<{ allowed: boolean; remaining: number; resetAt: Date }> {
  const now = new Date()
  const resetAt = new Date(now.getTime() + windowMs)

  // Atomic upsert: on first hit within a window, INSERT with count=1.
  // On every subsequent hit within the window, increment the count in
  // place. When the window has elapsed (reset_at <= now), reset count
  // back to 1 and move the window forward.
  //
  // All of this is done inside one SQL statement so we never have a
  // read-check-write race where two concurrent callers both read the
  // stale count and both decide "not yet over the limit".
  const rows = await prisma.$queryRaw<Array<{ count: number; reset_at: Date }>>`
    INSERT INTO "rate_limits" ("bucket", "key", "count", "reset_at", "updated_at")
    VALUES (${bucket}, ${key}, 1, ${resetAt}, ${now})
    ON CONFLICT ("bucket", "key") DO UPDATE
      SET "count"      = CASE
                           WHEN "rate_limits"."reset_at" <= ${now} THEN 1
                           ELSE "rate_limits"."count" + 1
                         END,
          "reset_at"   = CASE
                           WHEN "rate_limits"."reset_at" <= ${now} THEN ${resetAt}
                           ELSE "rate_limits"."reset_at"
                         END,
          "updated_at" = ${now}
    RETURNING "count", "reset_at"
  `

  const row = rows[0]
  if (!row) {
    // Should never happen: the UPSERT always produces exactly one row.
    // Fail closed — refuse the request rather than accidentally letting
    // it through when we can't verify the counter.
    return { allowed: false, remaining: 0, resetAt }
  }

  const currentCount = Number(row.count)
  const effectiveResetAt = row.reset_at

  return {
    allowed: currentCount <= maxRequests,
    remaining: Math.max(0, maxRequests - currentCount),
    resetAt: effectiveResetAt,
  }
}

/**
 * Periodic sweep of expired rows. Safe to no-op if called often; safe
 * to never call (expired rows get overwritten on next hit to the same
 * key). This exists so a long-quiet bucket doesn't leave stale rows
 * forever.
 */
export async function cleanupExpiredRateLimits(): Promise<number> {
  const result = await prisma.rateLimit.deleteMany({
    where: { resetAt: { lt: new Date() } },
  })
  return result.count
}
