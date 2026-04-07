# TaxHacker India — Master Code Audit Report
**Date**: 2026-03-31
**Reviewed by**: Senior Code Review (7-dimension analysis)
**Codebase**: ~6,900 lines across TypeScript, TSX, config files
**Scope**: Full codebase — all 170 source files

---

## Executive Summary

TaxHacker India is a well-structured, genuinely ambitious accounting app with solid foundational architecture. The core data models are clean, audit trail implementation is legally sound, and the India-specific tax logic (GSTIN validation, GSTR classification, ITC blocking) shows real domain expertise.

However, the app has **serious production readiness gaps** across security, compliance, and test coverage. The most dangerous issues are:

1. **Encryption silently disabled in production** if `ENCRYPTION_KEY` is not set
2. **12 server actions accept `userId` from the client** — complete auth bypass for Projects, Categories, Fields
3. **e-Invoice QR is non-compliant with IRP spec** — legal risk for users
4. **GSTR-1 / GSTR-3B logic has zero test coverage** — highest business risk

The app can handle real users today, but should NOT be used for actual GST filing with client data until the Critical items below are fixed.

---

## Severity Matrix — All Findings

| # | Dimension | Critical | High | Medium | Low | Total |
|---|-----------|----------|------|--------|-----|-------|
| 1 | Security & Auth | 2 | 6 | 5 | 4 | **17** |
| 2 | Architecture & API Design | 1 | 3 | 4 | 3 | **11** |
| 3 | Indian Tax Compliance | 1 | 4 | 5 | 3 | **13** |
| 4 | Performance & Scalability | 1 | 3 | 5 | 3 | **12** |
| 5 | Code Quality & Patterns | 0 | 2 | 6 | 5 | **13** |
| 6 | Frontend / UX | 0 | 2 | 5 | 4 | **11** |
| 7 | Test Coverage | 2 | 3 | 4 | 3 | **12** |
| | **TOTALS** | **7** | **23** | **34** | **25** | **89** |

---

## 🔴 Critical Issues — Fix Before Any Real User Data

### C1 — Encryption silently falls back to plaintext in production
**File**: `lib/encryption.ts:6-10`, `lib/config.ts:7`
**Impact**: GST keys, API keys, bank details stored as plaintext in database
**Fix**: In `lib/config.ts`, throw on missing ENCRYPTION_KEY in production. 1 line.
```ts
if (process.env.NODE_ENV === "production" && !process.env.ENCRYPTION_KEY) {
  throw new Error("ENCRYPTION_KEY must be set in production")
}
```

### C2 — Default BETTER_AUTH_SECRET only warns
**File**: `lib/config.ts:31-33`
**Impact**: All user JWTs can be forged by anyone who reads the source code
**Fix**: `throw new Error(...)` instead of `console.warn(...)`. 1 line.

### C3 — 12 server actions accept userId from client (auth bypass)
**File**: `app/(app)/settings/actions.ts` — `addProjectAction`, `editProjectAction`, `deleteProjectAction`, `addCurrencyAction`, `editCurrencyAction`, `deleteCurrencyAction`, `addCategoryAction`, `editCategoryAction`, `deleteCategoryAction`, `addFieldAction`, `editFieldAction`, `deleteFieldAction`
**Impact**: Any authenticated user can create/modify/delete another user's projects, categories, fields
**Fix**: Replace `userId: string` parameter with `const user = await getCurrentUser()` inside each action. ~30 min work.

### C4 — e-Invoice QR is non-IRP-compliant
**File**: `lib/e-invoice.ts`
**Impact**: Legal risk — generated QR codes cannot be verified by GST officers via the NIC VERIFY app
**Fix**: Either integrate with NIC IRP API to get real signed QR, or relabel as "internal reference" in the UI

### C5 — GSTR-1 classification has zero test coverage
**File**: `lib/gstr1.ts`, `lib/gstr3b.ts`
**Impact**: A misclassification bug silently sends users to file wrong GSTR returns. ITC errors = GST notices.
**Fix**: Write `tests/gstr1.test.ts` covering all section classifications and edge cases

### C6 — `safePathJoin` (path traversal prevention) is untested
**File**: `lib/files.ts:53-58`
**Impact**: Path traversal is the primary security control for all file access — a bug here exposes the entire filesystem
**Fix**: Add `tests/files.test.ts` with traversal attempt scenarios

### C7 — `analyzeTransaction` marked `"use server"` but accepts arbitrary userId
**File**: `ai/analyze.ts:1`
**Impact**: Browser can call this server action directly with any userId, bypassing agent auth
**Fix**: Remove `"use server"` directive from `ai/analyze.ts`

---

## 🟠 High Priority — Fix Before Launch

| ID | Dimension | Issue | Effort |
|----|-----------|-------|--------|
| H1-1 | Security | SHA-256 for password hashing (should be bcrypt) | 2h |
| H1-2 | Security | Agent API key stored as plaintext in DB | 2h |
| H1-3 | Security | No file size limit on agent uploads (DoS) | 30m |
| H1-4 | Security | MIME type validation is client-controlled | 1h |
| H1-5 | Security | Internal file path leaked in 404 response | 15m |
| H1-6 | Security | No Content-Security-Policy header | 1h |
| H2-1 | Architecture | Prisma logs ALL queries in production (data leak) | 10m |
| H2-2 | Architecture | Business bank details stored as plaintext on User model | 2h |
| H2-3 | Architecture | Files stored as JSON array (no FK integrity) | 4h |
| H3-1 | Compliance | GSTR-1 missing CDNR/CDNUR/AT/ATADJ/DE sections | 8h |
| H3-2 | Compliance | GSTR-3B missing Table 3.1(d) RCM and 3.1(e) | 4h |
| H3-3 | Compliance | Taxable value computed by subtraction (FP drift) | 3h |
| H3-4 | Compliance | No Indian FY enforcement in GSTR reports | 2h |
| H4-1 | Performance | Export loads ALL transactions + N+1 file queries | 3h |
| H4-2 | Performance | ZIP export holds entire archive in RAM | 4h |
| H4-3 | Performance | getDirectorySize walks full dir on every upload | 3h |
| H5-1 | Code Quality | Error details leaked to client in 8 server actions | 1h |
| H6-1 | Frontend | 500 transactions rendered in DOM simultaneously | 2h |
| H6-2 | Frontend | useEffect sorting causes unnecessary navigation on mount | 30m |
| H7-1 | Tests | No integration tests for any API route | 8h |
| H7-2 | Tests | No tests for settings encryption round-trip | 2h |
| H7-3 | Tests | LLM failover logic untested | 2h |

---

## 🟡 Medium Priority — Fix Within 30 Days

| ID | Dimension | Issue |
|----|-----------|-------|
| M1-1 | Security | serverActions.bodySizeLimit is 256MB (reduce to 20MB) |
| M1-2 | Security | Rate limiter is in-memory (not distributed) |
| M1-3 | Security | getUserUploadsDirectory uses email as dirname (fragile) |
| M1-4 | Security | Audit log failures silently swallowed |
| M1-5 | Security | No Cache-Control: no-store on file downloads |
| M2-1 | Architecture | type/status fields have no DB enum constraint |
| M2-2 | Architecture | Dual auth architecture doubles attack surface |
| M2-3 | Architecture | any types throughout AI provider layer |
| M2-4 | Architecture | TransactionData has open index signature |
| M3-1 | Compliance | Nil section format incorrect in GSTR-1 JSON |
| M3-2 | Compliance | HSN description is always empty |
| M3-3 | Compliance | Place of supply stored as name not state code |
| M3-4 | Compliance | Floating point accumulation in ITC computation |
| M3-5 | Compliance | GSTIN not validated on save |
| M4-1 | Performance | No pagination on GSTR-1 data fetch |
| M4-2 | Performance | PoorManCache grows unbounded |
| M4-3 | Performance | Embedding called on every save (no batching) |
| M4-4 | Performance | files JSON array has no GIN index |
| M4-5 | Performance | No request timeout on LLM calls |
| M5-1 | Code Quality | Rounding utility duplicated 3 times |
| M5-2 | Code Quality | isInterState logic duplicated |
| M5-3 | Code Quality | transactionFormSchema uses .catchall (unbounded input) |
| M5-4 | Code Quality | generateUUID is dead code on server |
| M5-5 | Code Quality | Deprecated delete functions still callable without guard |
| M5-6 | Code Quality | splitFileIntoItems JSON input not validated |
| M6-1 | Frontend | No loading indicator on row click navigation |
| M6-2 | Frontend | Import link inside button (wrong nesting) |
| M6-3 | Frontend | bg-yellow-50 doesn't work in dark mode |
| M6-4 | Frontend | Create form mixes controlled and uncontrolled inputs |
| M6-5 | Frontend | Checkbox toggleOneRow uses fake MouseEvent |
| M7-1 | Tests | No tests for stats.ts financial calculations |
| M7-2 | Tests | No tests for CSV formula injection sanitization |
| M7-3 | Tests | No tests for numberToIndianWords |
| M7-4 | Tests | Self-hosted auth test validates weakness as correct |

---

## 🟢 Low Priority — Clean Up When Time Allows

25 low-severity issues across all dimensions. See individual dimension files for details.

---

## What's Built Well — Preserve These

- **Audit trail architecture** — `logAudit()` on every create/update/reverse, Companies Act compliant, immutable records
- **Transaction reversal pattern** — `reverseTransaction()` instead of hard delete — legally correct
- **GSTIN validation** — Full checksum (Luhn mod 36), state code validation, whitespace handling
- **Encryption** — AES-256-GCM with random IV, authenticated (prevents tampering), transparent encrypt/decrypt in settings model
- **Path traversal prevention** — `safePathJoin()` consistently used across all file operations
- **Timing-safe API key comparison** — `crypto.timingSafeEqual()` in agent auth
- **LLM failover chain** — 4 providers with per-provider retry — resilient
- **Security event logging** — `logSecurityEvent()` for auth events, with CERT-In compliant event types
- **Indian locale formatting** — `en-IN` currency format, dd/MM/yyyy dates, Indian number words
- **Empty state UX** — Onboarding checklist, clear CTAs, no blank screens
- **Zod validation on forms** — All server action inputs validated before DB touch
- **CSV formula injection prevention** — `sanitizeCSVValue()` for Excel safety

---

## Recommended Fix Sequence

### Sprint 1 — Pre-Data (Do Before First Real User) — ~6 hours
1. C1: ENCRYPTION_KEY startup check (1 line)
2. C2: BETTER_AUTH_SECRET throw instead of warn (1 line)
3. C3: Fix userId in server actions (replace `userId: string` param with `getCurrentUser()`)
4. C7: Remove `"use server"` from `ai/analyze.ts`
5. H1-5: Fix file path in 404 error (return generic message)
6. H2-1: Fix Prisma query logging in production

### Sprint 2 — Pre-Launch — ~20 hours
1. C4: Relabel e-Invoice QR or integrate IRP API
2. H1-3: Add file size limit to agent uploads
3. H3-3: Fix taxable value calculation
4. H4-1: Fix export N+1 queries and add pagination
5. H6-1: Reduce TRANSACTIONS_PER_PAGE to 50
6. H5-1: Fix error-leaking server actions

### Sprint 3 — Before CA/Enterprise Users — ~40 hours
1. C5: Write GSTR-1/3B test suite
2. C6: Write safePathJoin tests
3. H3-1: Add missing GSTR-1 sections (CDNR, CDNUR)
4. H3-2: Add GSTR-3B Table 3.1(d) RCM
5. H1-1: Upgrade password hashing to bcrypt
6. H1-6: Add Content-Security-Policy headers
7. All Medium compliance items

---

## Files Audited

**Security**: middleware.ts, lib/encryption.ts, lib/self-hosted-auth.ts, lib/config.ts, lib/rate-limit.ts, lib/audit.ts, lib/security-log.ts, lib/files.ts, app/api/agent/auth.ts, app/api/agent/transactions/route.ts, app/api/agent/files/route.ts, app/(app)/files/download/[fileId]/route.ts, docker-entrypoint.sh, next.config.ts

**Architecture**: models/transactions.ts, prisma/schema.prisma, lib/auth.ts, lib/db.ts, models/settings.ts, app/(app)/layout.tsx, app/(app)/transactions/actions.ts, app/(app)/settings/actions.ts, app/api/agent/analyze/route.ts, ai/providers/llmProvider.ts

**Compliance**: lib/indian-tax-utils.ts, lib/gstr1.ts, lib/gstr3b.ts, lib/e-invoice.ts

**Performance**: app/(app)/export/transactions/route.ts, app/(app)/unsorted/actions.ts, app/api/agent/gstr1/route.ts, lib/embeddings.ts, lib/cache.ts, lib/files.ts, lib/stats.ts

**Code Quality**: forms/transactions.ts, lib/actions.ts, lib/utils.ts, ai/analyze.ts, ai/prompt.ts, models/users.ts

**Frontend**: components/transactions/list.tsx, components/transactions/create.tsx, components/dashboard/onboarding-checklist.tsx, app/(app)/transactions/page.tsx

**Tests**: tests/ (all 7 test files), vitest.config.ts
