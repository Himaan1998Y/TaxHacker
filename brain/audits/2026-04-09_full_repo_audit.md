# TaxHacker — Full Repo Audit

**Date**: 2026-04-09
**Method**: 5 parallel specialised agents (security, typescript, database, indian-tax-domain, architecture/docker/tests), each briefed on a non-overlapping slice. Findings cross-confirmed where multiple agents flagged the same issue.
**Branch reviewed**: `main` @ commit `28882c5` (post Dockerfile fix)

---

## TIER 0 — Ship-blockers (legal / data-loss / silent compromise)

| # | Issue | File:Line | Source |
|---|---|---|---|
| **0.1** | **B2CL threshold is ₹2.5L; legally must be ₹1L since Aug 2024** (Notification 12/2024-CT). Every user filing GSTR-1 with inter-state ₹1L–₹2.5L invoices has been mis-classifying B2CL as B2CS. The one finding that could get a customer audited. | `lib/gstr1.ts:185` | tax |
| **0.2** | **`ENCRYPTION_KEY` absent → all PII (GSTIN, PAN, API keys) stored in plaintext.** `lib/config.ts:51` *warns* but boots anyway. Throw in production. | `lib/encryption.ts:8-21` | security |
| **0.3** | **Cross-tenant data leak in CSV import.** `findFirst` for category/project omits `userId` filter — user A's import can attach to user B's records. | `models/export_and_import.ts:208-234` | db |
| **0.4** | **Tests are theater — CI builds Docker images but never runs `vitest`.** 17 test files exist; zero gate the deploy. Every regression we've ever fixed can silently re-break. | `.github/workflows/docker-*.yml` | arch |
| **0.5** | **`"use server"` on `models/files.ts`** marks every exported function as a publicly-callable Server Action endpoint. Server-side internals exposed as RPC. | `models/files.ts:1` | ts |

---

## TIER 1 — High (auth bypass risk, integrity, repeat-bug patterns)

| # | Issue | File:Line |
|---|---|---|
| 1.1 | `getOrCreateSelfHostedUser` wrapped in `cache()` — same mutation-in-cache bug we already fixed for `updateSettings`. Subsequent calls in one request silently no-op. | `models/users.ts:23` |
| 1.2 | Agent API rate-limit is an in-process `Map` — resets on every container restart, making the API key brute-forceable. | `app/api/agent/auth.ts:11-136` |
| 1.3 | Razorpay webhook signature compared with `!==` (timing leak). Use `crypto.timingSafeEqual`. | `app/api/razorpay/webhook/route.ts:16` |
| 1.4 | Self-hosted cookie `secure` flag derived from attacker-controlled `x-forwarded-proto` header. Tie to `NODE_ENV`. | `app/api/self-hosted-auth/route.ts:76-84` |
| 1.5 | `syncTransactionFiles` writes to 3 tables outside `$transaction` — crash mid-call orphans the join table. | `models/transactions.ts:251-291` |
| 1.6 | Missing composite index `(userId, status)` on Transaction — the most-scanned filter pair in the entire app has no covering index. | `prisma/schema.prisma:224-225` |
| 1.7 | ITC Section 17(5) blocking only matches a tiny default keyword list. Real-world expense categories (cosmetics, club membership, jewellery, employee food) leak through as claimable ITC → tax underpayment risk. | `lib/gstr3b.ts:59-65` |
| 1.8 | pgvector setup is named `optional_pgvector_setup.sql` and lives **outside** `prisma/migrations/` → never applied. `storeTransactionEmbedding` errors are silently swallowed by a fire-and-forget call. Embeddings have *never worked in production* and we'd never know. | `lib/embeddings.ts` + `prisma/optional_pgvector_setup.sql` |

---

## TIER 2 — Medium (correctness / observability)

| # | Issue | File:Line |
|---|---|---|
| 2.1 | `saveSettingsAction` runs N sequential awaits in a `for...in` — N round-trips for one form save. Use `Promise.all`. | `app/(app)/settings/actions.ts:43-48` |
| 2.2 | Invoice action `new Date(formData.date)` re-introduces the timezone bug we already fixed in `forms/transactions.ts` — IST users see Apr 8 invoices when they entered Apr 9. | `app/(app)/apps/invoices/actions.ts:114` |
| 2.3 | `gst_rate` is `Float`; `models/stats.ts:499` raw SQL casts it to `::bigint` → 18.5% silently truncates to 18%. Change to `Decimal`/`::numeric`. | `prisma/schema.prisma:202` + `models/stats.ts:499` |
| 2.4 | Audit log writes are fire-and-forget with `console.error` on failure. Companies Act 2023 requires immutable audit trail; a DB blip drops events. | `lib/audit.ts:46-49` |
| 2.5 | `hasCurrencySet` checks `=== "INR"` — USD users permanently see "currency setup" as incomplete in onboarding. | `lib/onboarding.ts:27` |
| 2.6 | Sentry init runs even when DSN is empty → silent no-op. We have *no* error visibility in production unless DSN is set, but the app gives no signal it's broken. | `sentry.server.config.ts` + `sentry.edge.config.ts` |
| 2.7 | Middleware uses `bcryptjs` + Node `crypto` but doesn't `export const config = { runtime: 'nodejs' }`. On any Edge deployment this breaks login. Build log already warns. | `middleware.ts` |
| 2.8 | `console.log("uploadedFiles", ...)` left in Server Action → leaks server filesystem paths to logs. | `app/(app)/files/actions.ts:92` |
| 2.9 | Embeddings `$queryRawUnsafe` returns `as any[]`; query string assembled with `+=`. Parameters are positional today but the pattern is one refactor away from injection. | `lib/embeddings.ts:160-177` |
| 2.10 | Legacy SHA-256 auth cookie has comment "30-day migration window" but no code-enforced cutoff. Stolen legacy cookies valid forever. | `lib/self-hosted-auth.ts:52-57` + `middleware.ts:67` |
| 2.11 | `error.message` from Prisma/Postgres leaked to client in agent embeddings catch block. Schema/extension state exposed. | `app/api/agent/embeddings/route.ts:84` |
| 2.12 | `audit.ts` sanitize masks `api_key`/`secret`/`password` but **not** `gstin`, `pan`, `token`. Setting writes for those leak into the audit log raw. | `lib/audit.ts:39-41` |
| 2.13 | Duplicate `GSTSummaryResult` type with **different shapes** in `models/transactions.ts:164` and `models/stats.ts:468`. Cross-confirmed by DB + TS agents. | both files |

---

## TIER 3 — Low / cleanup

- `gm` / `graphicsmagick` system libs installed in Dockerfile but no JS code uses `gm` (transitive of `pdf2pic`).
- `.next/cache` missing from `.dockerignore` (~100MB build context bloat).
- Stripe routes (`app/api/stripe/checkout|portal|webhook`) still present as 410 stubs — dead code, delete.
- `duplicateTransaction` uses `as unknown as Prisma.TransactionCreateInput` — silently breaks on schema additions (`models/transactions.ts:383`).
- `transaction.extra` accessed via `as any` four times in `components/transactions/list.tsx:175,185,195,205`.
- `reverseCharge` is `Boolean` in schema but import handler returns `"Yes"`/`"No"` strings (`models/export_and_import.ts:198`).
- GSTR-1 nil section JSON uses ambiguous `INTRB2B` vs `INTRAB2B` labels — visual confusability, portal rejection risk (`lib/gstr1.ts:816-838`).
- GSTIN checksum implementation never validated against a real GSTN-issued GSTIN in tests.
- `prisma migrate deploy` failure in `docker-entrypoint.sh:17` not caught — container starts with broken schema.
- No backup orchestration in `docker-compose.yml`. Volume loss = data loss.
- N+1 in `deleteTransaction` loop, missing `(userId, issuedAt)` composite index — scaling cliffs, not current bugs.

---

## Patterns worth naming

1. **"Silent degradation"** is the dominant failure class: encryption key, pgvector, embeddings, Sentry DSN, audit log writes, agent rate-limit. Every one of these *boots fine and lies about working*. Shared root cause: warn-don't-throw at startup. **Fix**: build a single `assertProductionInvariants()` called from `instrumentation.ts` that throws on missing keys, missing extensions, missing DSN.
2. **Mutation-in-`cache()`** is now a recurring bug class (updateSettings, getOrCreateSelfHostedUser). Add an ESLint rule or grep gate forbidding `cache(` wrapping any function containing `prisma.*.create|update|upsert|delete`.
3. **Tests that don't run** is the meta-bug enabling everything else. Fixing CI is the highest-leverage one-line change in this whole audit.
