# Dimension 2: Architecture & API Design Findings
**Date**: 2026-03-31
**Files Reviewed**: models/transactions.ts, prisma/schema.prisma, lib/auth.ts, lib/db.ts, models/settings.ts, app/(app)/layout.tsx, app/(app)/transactions/actions.ts, app/(app)/settings/actions.ts, app/api/agent/analyze/route.ts, ai/providers/llmProvider.ts

---

## CRITICAL (1)

### C1 — Server Actions accept userId as client-supplied parameter
**File**: `app/(app)/settings/actions.ts:101,119,136,146,162,174,184,213,230,240,262,282`
**Issue**: 12 out of ~15 server actions take `userId: string` as a function argument. In Next.js, Server Action arguments are serialized and POSTed from the browser — they are fully client-controlled. There is NO check that the `userId` parameter matches the authenticated session user.

**Impact**: Any authenticated user could call `addProjectAction(victimUserId, {...})` and create/read/update/delete another user's data. This is a complete authorization bypass affecting Projects, Currencies, Categories, Fields.

**Correct pattern** (already used in `transactions/actions.ts:35`):
```ts
const user = await getCurrentUser()  // session — not from args
```

**Wrong pattern** (in settings/actions.ts):
```ts
export async function addProjectAction(userId: string, ...) {
  // no getCurrentUser() — userId is trusted from caller
```

---

## HIGH (3)

### H1 — Prisma logs ALL queries in production
**File**: `lib/db.ts:7`
**Issue**: `log: ["query", "info", "warn", "error"]` — every SQL query is printed to stdout in production, including queries containing user emails, API keys, financial data. In a containerised deploy (Coolify), these logs are accessible to anyone with server access.
**Fix**: `log: process.env.NODE_ENV === "production" ? ["error"] : ["query", "info", "warn", "error"]`

### H2 — Business bank details stored as plaintext on User model
**File**: `prisma/schema.prisma:37` (`businessBankDetails String?`)
**Issue**: Bank account numbers, IFSC codes stored as a plain `String` column on the `users` table. Settings table has encryption logic for sensitive values — the User model bypasses it entirely.
**Fix**: Move `businessBankDetails` to the `settings` table (where it would be encrypted) or explicitly encrypt before writing.

### H3 — File associations stored as JSON array, not a relation
**File**: `prisma/schema.prisma:184` (`files Json @default("[]")`)
**Issue**: File IDs on Transaction are stored as a JSON array rather than a proper junction table. Consequences:
- No foreign key integrity — deleted file IDs can remain as orphaned references
- Cannot do JOIN queries like "all transactions linked to file X" efficiently (currently uses `array_contains`)
- No cascade behavior — requires manual cleanup logic in `deleteTransaction`
**Fix**: Add a `TransactionFile` junction table with proper FK relations.

---

## MEDIUM (4)

### M1 — `type` and `status` fields have no DB-level enum constraint
**File**: `prisma/schema.prisma:182,194`
**Issue**: `type String?` and `status String @default("active")` are free-form strings. Any value could be written to these columns. App logic assumes `type ∈ {income, expense, transfer}` and `status ∈ {active, reversed}` — but this is not enforced at the DB level.
**Fix**: Use Prisma enums or add `@@check` constraints.

### M2 — Dual auth architecture doubles attack surface
**Files**: `lib/auth.ts`, `lib/self-hosted-auth.ts`, `middleware.ts`
**Issue**: Two entirely separate auth systems exist: Better Auth (cloud) and custom SHA-256 cookie (self-hosted). Different code paths for session, middleware checks, and `getCurrentUser()`. Any auth-related fix must be applied twice. The self-hosted path is significantly weaker (see Security D1-H1).
**Note**: This is a known architectural trade-off for self-hosted vs cloud. But the self-hosted auth should at minimum use the same session infrastructure.

### M3 — `any` types throughout AI provider layer
**File**: `ai/providers/llmProvider.ts:14,35,71`
**Issue**: `attachments?: any[]`, `let model: any`, `message_content: any` — TypeScript's type safety is completely bypassed in the AI layer. Errors in LangChain API changes won't be caught at compile time.
**Fix**: Define typed interfaces for each provider model and message content.

### M4 — `TransactionData` has open index signature
**File**: `models/transactions.ts:32`
**Issue**: `[key: string]: unknown` on the TransactionData type means arbitrary unknown keys are allowed. Combined with `splitTransactionDataExtraFields` which uses `Object.entries`, this could silently accept and store unexpected fields from AI extraction results.
**Fix**: Remove the index signature; make the type closed. Handle extra fields explicitly.

---

## LOW (3)

### L1 — React `cache()` used on model functions
**File**: `models/transactions.ts:51`, `models/settings.ts:56`
**Issue**: `cache()` from React is a per-request memoization tool designed for React Server Components. Using it in model layer files that are also called from API routes or Server Actions can create unexpected deduplication behavior. It also creates a hard dependency on React in the data layer.
**Fix**: For reuse across non-RSC contexts, use manual memoization or just call the DB directly (Prisma is fast enough for the volumes involved).

### L2 — `uploadTransactionFilesAction` leaks error details to client
**File**: `app/(app)/transactions/actions.ts:200`
**Issue**: `` return { success: false, error: `File upload failed: ${error}` } `` — `${error}` stringifies the full error object including stack trace, file paths, Prisma error codes.
**Fix**: Return a generic message; log the full error server-side.

### L3 — PrismaClient constructed with global singleton but not guarded in edge runtime
**File**: `lib/db.ts`
**Issue**: The global singleton pattern works for Node.js runtime. But if any DB code is ever accidentally imported in an Edge route (middleware), it would fail. Currently `middleware.ts` does not import from `lib/db.ts` — this is good and should be documented as a constraint.

---

## What's Done Well ✓

- Clean separation between `models/` (DB layer), `app/(app)/...actions.ts` (server actions), and `app/api/agent/` (API routes)
- `reverseTransaction` pattern instead of hard delete — correct for financial apps
- Proper `logAudit` on every create/update/reverse in transactions model
- `sanitizeForAudit` removes sensitive fields before writing to audit log
- Settings encryption is well-architected — transparent encrypt/decrypt with `SENSITIVE_SETTINGS` set
- LLM failover chain across 4 providers with retry logic
- pgvector integration for semantic search is forward-thinking
- `safePathJoin` used consistently across all file path operations

---

## Summary

| Severity | Count |
|----------|-------|
| Critical | 1 |
| High | 3 |
| Medium | 4 |
| Low | 3 |
| **Total** | **11** |

**Top fix:** C1 (userId in Server Action args) — easy fix, critical impact. Replace `userId: string` param with `const user = await getCurrentUser()` inside each action. ~30 min of work.
