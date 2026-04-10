# Tier 1 — Shipped

**Date**: 2026-04-09
**Baseline**: Tier 0 complete at `4a8da5c`
**Tip**: `d26fdde`

## Commits

```
d26fdde perf(transactions): composite (user_id, status) index, non-blocking build   ← 1.6
c2af36d fix(agent-api): durable Postgres-backed rate limiter                         ← 1.2
2a426ea fix(embeddings): graceful degradation when pgvector is unavailable           ← 1.8
05beca2 feat(gstr3b): refresh Section 17(5) blocked-ITC defaults + fix case match    ← 1.7
c4db6eb fix(transactions): make syncTransactionFiles atomic                          ← 1.5
b189801 fix(auth): derive self-hosted cookie Secure flag from NODE_ENV               ← 1.4
361e4b6 fix(razorpay): timing-safe webhook signature comparison                      ← 1.3
09e9483 fix(users): do not cache() the self-hosted user upsert                       ← 1.1
```

- **Files changed**: 16
- **Tests**: 198 → 230 (+32)
- **New test files**: 5 (`razorpay-webhook`, `embeddings-pgvector`, `rate-limit-db`, extensions to `encryption` and `gstr3b`)
- **CI**: 8/8 green
- **Local**: `pnpm test` green, `tsc --noEmit` clean

## What each item changed

### 1.1 — `09e9483` fix(users): cache() removal
Same pattern as the pre-audit updateSettings fix: `cache()` on an `upsert` silently skips the second call within a single request. `getOrCreateSelfHostedUser` is now a plain async function.

### 1.3 — `361e4b6` fix(razorpay): timing-safe signature
`signature !== expected` on a webhook HMAC leaked matching-prefix length through response timing. Replaced with a length check + `crypto.timingSafeEqual`. Added 6 tests — the first route-level tests in the suite, using `vi.mock('@/models/users')` + `vi.mock('@/lib/razorpay')` to keep the route decoupled from Prisma.

### 1.4 — `b189801` fix(auth): NODE_ENV cookie Secure
`secure: request.headers.get("x-forwarded-proto") === "https"` was attacker-controlled through a misconfigured proxy. Now `secure: process.env.NODE_ENV === "production"`. In dev the cookie still works over http://localhost; in prod Secure is always on.

### 1.5 — `c4db6eb` fix(transactions): atomic sync
`syncTransactionFiles` did three writes outside any transaction: a `transaction.update` (JSON `files` column), a `transactionFile.deleteMany`, and N `transactionFile.create` calls. A crash mid-function left the JSON column out of sync with the join table. Now wrapped in `$transaction`; also collapsed the N creates into one `createMany`; added a no-op short-circuit for saves that don't actually change the file set.

### 1.7 — `05beca2` feat(gstr3b): Section 17(5) refresh
- Default `DEFAULT_ITC_BLOCKED_KEYWORDS` expanded from 12 to ~40 keywords covering clauses (a) through (i) of Section 17(5) as in force FY 2025-26.
- Added CSR (2026 clarification), construction of immovable property (clause d, including the Budget 2024 "plant or machinery" → "plant and machinery" retrospective amendment), works contract, LTA, life/health insurance, composition tax, Section 74 demand tax.
- Fixed a case-sensitivity bug: the previous matcher used raw `.includes()` on `tx.categoryCode`, so `"Food_Beverage"` with a capital F slipped through. Now lowercased once before comparison.
- `DEFAULT_ITC_BLOCKED_KEYWORDS` is now exported so the settings UI, tests, and docs reference one source of truth.
- 10 new tests covering each new keyword family + the case-insensitive fix + the user-override path.

### 1.8 — `2a426ea` fix(embeddings): pgvector graceful degradation
The audit said pgvector "silently fails" — half right. `docker-entrypoint.sh` already tries to enable it on every boot with `|| echo pgvector not available`. What was missing was app-side handling: every embedding call would then throw at the first raw SQL vector cast, and the thrown error was being swallowed by callers' try/catches.

Fix: module-level async capability probe (`hasPgvector()`) that runs one `SELECT '[0]'::vector` on first call per process, caches the result, and logs a one-time warning on failure. All four consumers (`storeTransactionEmbedding`, `findSimilarTransactions`, `detectDuplicates`, `semanticSearch`) short-circuit when the probe is negative — writes become no-ops, reads return `[]`. `semanticSearch` short-circuits **before** generating the embedding, so a degraded deployment doesn't even hit the Gemini API for queries that can't possibly return results.

Concurrent callers during the first probe share the same in-flight promise via `pgvectorProbePromise`, so N simultaneous requests on a fresh process fire exactly one probe. 9 new tests.

**Not moved**: `prisma/optional_pgvector_setup.sql` stays where it is. Moving it into `prisma/migrations/` would make `prisma migrate deploy` try to apply it on every boot, which would **fail** on postgres images without the extension and break the entire migrate step — the opposite of graceful. The file is the manual-fallback reference for operators; `docker-entrypoint.sh` covers the happy path; this commit covers the "neither worked" path.

### 1.2 — `c2af36d` fix(agent-api): durable rate limiter
In-process Map → Postgres-backed table (`rate_limits`). Survives container restarts and rolling deploys. New `lib/rate-limit-db.ts` exposes `checkRateLimit(bucket, key, {maxRequests, windowMs})` with a single atomic `INSERT ... ON CONFLICT DO UPDATE ... RETURNING` that both increments the counter and reads the new value in one statement. No TOCTOU window. `bucket` is free-form so the same table can back multiple limiters (per-agent, per-IP, password-attempts, etc.) without key collisions. 7 new tests.

Also added proper `Retry-After`, `X-RateLimit-*` headers on the 429 response — missing before, so well-behaved clients had no way to back off gracefully.

Prisma migration `20260409_add_rate_limits/migration.sql` creates the table on the next boot. Zero downtime, no data migration.

### 1.6 — `d26fdde` perf(transactions): composite (user_id, status) index
`@@index([userId, status])` added to the Prisma schema. Kept the standalone `@@index([userId])` and `@@index([status])` alongside — the audit suggested replacing them, but (a) other queries filter by userId alone and benefit from the standalone, (b) dropping two existing indexes would turn a one-statement migration into three, introducing rebuild risk during deploy.

Migration file `20260409_add_transactions_user_status_index/migration.sql` uses:
- `CREATE INDEX CONCURRENTLY` — builds in two passes holding only brief SHARE UPDATE EXCLUSIVE locks; writes continue throughout.
- `IF NOT EXISTS` — idempotent, recovers from any failed partial build without manual DROP.
- Single statement + `-- prisma-migrate-disable-next-transaction` header — belt and braces, both ways of opting out of Prisma's default `BEGIN`/`COMMIT` wrapping which would otherwise make CONCURRENTLY fail.

No behavioural test (it's a schema/index change, not a logic change). Verified via `prisma generate` clean and `tsc --noEmit` clean.

## Patterns worth naming from Tier 1

1. **"Silent degradation" is the shared root cause** of both 1.8 (pgvector) and the Tier 0 0.2 (ENCRYPTION_KEY) work. The pattern is: a dependency is probed at boot, and a failure is logged but doesn't stop startup. The fix shape is identical: add a call-site guard that short-circuits the operation and logs a **one-time** warning instead of either failing loudly or silently returning wrong answers. Both are now done.

2. **Rate limiters, auth tokens, and sessions should never live in an in-process Map** on a container with rolling deploys. 1.2 was the last one. If a new rate limiter or session cache gets added in future, it should use `lib/rate-limit-db.ts` or a similar Postgres-backed helper.

3. **Case-insensitive string matching is a recurring footgun**. The ITC blocker (`Food_Beverage` slipping through) and earlier audit findings on category/project import (`importProject`/`importCategory` case) are the same shape. Consider adding an ESLint pattern or a convention comment at each such site.

## Known gaps still open after Tier 1

1. **CI doesn't run `tsc --noEmit` or `next lint`** — only vitest. Small Tier 1.5 improvement, deferred for Tier 2.
2. **No component/snapshot tests for the GSTR-1 / GSTR-3B report pages.** UI changes (banners, HSN tab split) are un-asserted by CI.
3. **No `pnpm audit` gate in CI.**
4. **HSN dropdown enforcement** (GSTN Phase-III requires HSN selection from a master list, not free-text). We still accept AI-extracted free-text HSN. Portal catches invalid codes at upload, so this is a UX gap, not a data-correctness bug.
5. **`app/api/stripe/*` legacy routes** still exist as 410 stubs. Dead code; delete in a cleanup pass.
6. **Commit message cosmetics**: two commits in Tier 0 still have literal `\u20b9` escapes instead of `₹`. Accepted as not worth history rewrites.

## What's next

Tier 2 from the original audit (13 items). The biggest wins:
- **2.3** — `gst_rate Float` silently truncates to `::bigint` in `models/stats.ts:499` for decimal rates like 18.5%. One-line fix but affects computation.
- **2.13** — Duplicate `GSTSummaryResult` type in `models/transactions.ts` vs `models/stats.ts` with different shapes. Cross-confirmed by DB + TS agents; silent type drift risk.
- **2.6** — Sentry silent no-op when DSN empty. Same "silent degradation" pattern as 1.8 and Tier 0 0.2.
- **2.4** — Audit log fire-and-forget with `console.error` on failure. Companies Act compliance risk.
