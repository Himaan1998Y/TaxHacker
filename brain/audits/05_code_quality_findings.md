# Dimension 5: Code Quality & Patterns Findings
**Date**: 2026-03-31
**Files Reviewed**: forms/transactions.ts, lib/actions.ts, lib/utils.ts, ai/analyze.ts, ai/prompt.ts, models/users.ts, lib/gstr1.ts, lib/gstr3b.ts, lib/indian-tax-utils.ts, app/(app)/unsorted/actions.ts, app/(app)/settings/actions.ts

---

## HIGH (2)

### H1 — Error details leaked to client across 8+ server actions
**Files**: `app/(app)/unsorted/actions.ts:59,127,218`, `app/(app)/transactions/actions.ts:200`, `app/(app)/settings/actions.ts:139,174,183`
**Issue**: Pattern `` return { success: false, error: `Failed: ${error}` } `` converts the raw error (including Prisma error messages, stack traces, file paths) to a string and sends it to the browser. Inconsistent with the better pattern in other actions: `return { success: false, error: "Failed to reverse transaction" }`.
**Affected locations**:
- `unsorted/actions.ts:59` — `"Failed to retrieve files: " + error`
- `unsorted/actions.ts:127` — `` `Failed to save transaction: ${error}` ``
- `unsorted/actions.ts:218` — `` `Failed to split file into items: ${error}` ``
- `transactions/actions.ts:200` — `` `File upload failed: ${error}` ``
- `settings/actions.ts:139,174,183` — `"Failed to delete project" + error` etc.
**Fix**: Log error server-side, return a generic user-facing message.

### H2 — `analyzeTransaction` marked `"use server"` but is not a form action
**File**: `ai/analyze.ts:1`
**Issue**: The `"use server"` directive at file level marks ALL exported functions as Server Actions — callable directly from the browser. `analyzeTransaction(prompt, schema, attachments, fileId, userId)` accepts a `userId` parameter, allowing a browser client to call it with any `userId` and `fileId`.

This bypasses the `authenticateAgent` auth check in the API route wrapper. A logged-in user could call `analyzeTransaction` with another user's `fileId` via React's server action RPC mechanism.
**Fix**: Remove `"use server"` from `ai/analyze.ts`. It runs on the server anyway (imported only from server-side code). Only add `"use server"` to files that need direct browser invocation.

---

## MEDIUM (6)

### M1 — Rounding utility function duplicated 3 times
**Files**: `lib/indian-tax-utils.ts:134`, `lib/gstr1.ts:568`, `lib/gstr3b.ts:330`
**Issue**: Three identical implementations of `round(n) = Math.round(n * 100) / 100`. One is named `round2`, two are named `round`. Any future change (e.g., switching to banker's rounding for GST compliance) must be made in 3 places.
**Fix**: Export `roundRupees(n)` from `lib/indian-tax-utils.ts` and import in gstr1/gstr3b.

### M2 — `isInterState` business logic duplicated
**Files**: `lib/gstr1.ts:214` (`determineInterState`), `lib/gstr3b.ts:334` (`isInterStateSupply`)
**Issue**: Functionally identical state code lookup logic, different function names, both private (not exported). Used in GSTR-1 and GSTR-3B computations. Risk of divergence.
**Fix**: Export one canonical `isInterState(tx, businessStateCode)` from a shared tax utils file.

### M3 — `transactionFormSchema` uses `.catchall(z.string())` — unbounded input
**File**: `forms/transactions.ts:62`
**Issue**: Any additional field (custom GST fields like `gstin`, `invoice_number`, `gst_rate`) is accepted as a raw string with no validation. A malformed GSTIN, invalid HSN code, or negative `gst_rate` passes silently through to the database.
**Note**: This is intentional for user-defined custom fields but creates a validation gap for the expected GST fields.
**Fix**: Validate known GST extra fields (gstin, gst_rate, hsn_sac_code) explicitly in the schema. Unknown fields can still fall through.

### M4 — `generateUUID` fallback chain is dead code on server
**File**: `lib/utils.ts:106-140`
**Issue**: Three-tier UUID generation with `Math.random()` fallback. On Node.js 24+, `crypto.randomUUID()` never throws. The `Math.random()` fallback generates low-entropy UUIDs. This utility is never used (all call sites import `randomUUID` from `node:crypto` directly). Dead code that could confuse future developers.
**Fix**: Delete `generateUUID` from utils.ts entirely.

### M5 — Deprecated functions still exported and callable
**File**: `models/transactions.ts:222,251`
**Issue**: `deleteTransaction` and `bulkDeleteTransactions` are marked `@deprecated` and bypass the reversal pattern required by Companies Act 2023. They're still accessible to any code that imports from `models/transactions`. No runtime guard or TypeScript error on use.
**Fix**: Add a runtime `throw new Error("Use reverseTransaction instead — hard delete violates Companies Act 2023 audit trail requirement")` in both functions.

### M6 — `splitFileIntoItems` JSON input not validated
**File**: `app/(app)/unsorted/actions.ts:153`
**Issue**: `JSON.parse(formData.get("items") as string) as TransactionData[]` — trusts that the JSON sent from the browser is a valid `TransactionData` array. No Zod validation. A malformed payload could cause Prisma errors with internal error messages returned to the client.
**Fix**: Validate parsed items against a Zod schema before processing.

---

## LOW (5)

### L1 — `buildLLMPrompt` uses fragile string template replacement
**File**: `ai/prompt.ts`
**Issue**: `prompt.replace("{fields}", ...)` — if a user names a category with `{fields}` as its `llm_prompt`, the replacement could produce unexpected results. No escaping or template engine used.
**Fix**: Use a proper template library or replace with regex-based replacement that handles edge cases.

### L2 — `any` types in financial computation functions
**Files**: `lib/gstr1.ts:228,432`, `lib/gstr3b.ts:69,157,216,334`
**Issue**: `dbTransactions: any[]` in GSTR-1 and GSTR-3B generation functions. TypeScript cannot catch field name typos or structural errors in the financial computations. `tx.extra.gstin` would silently return `undefined` on a mis-typed field with no error.
**Fix**: Define a `DBTransaction` type or use the Prisma `Transaction` type with proper type assertion.

### L3 — `getOrCreateCloudUser` upserts without checking all fields
**File**: `models/users.ts:31-43`
**Issue**: `prisma.user.upsert` with `update: data` means every social login updates ALL user fields from the OAuth profile (name, avatar). If a user has manually updated their name in settings, it gets overwritten on next login.
**Fix**: Only update avatar and email verification status on upsert, not all fields.

### L4 — `"use server"` on individual action files lacks co-location
**Issue**: Multiple files have `"use server"` at the top level, exporting many functions. If one function needs to remain a pure server utility (not a server action), the entire file's exports become server actions. Better to colocate server actions with their pages.
**Fix**: Low priority but consider: prefix server action files with `actions.ts` and only put `"use server"` in those. Keep utility functions in separate non-server-action files.

### L5 — Typo in error message
**File**: `forms/transactions.ts:28`
**Issue**: `"Invalid coverted total"` — should be `"Invalid converted total"`.
**Fix**: `s/coverted/converted/`

---

## What's Done Well ✓

- Consistent `ActionState<T>` type for server action return values — clean API contract
- Zod validation on all form submissions before hitting the DB
- `sanitizeCSVValue` for formula injection prevention — correct security practice
- `transactionFormSchema` correctly converts string totals to integer paise (×100)
- `numberToIndianWords` and `amountToIndianWords` — nice India-specific utility
- `formatCurrency` with `en-IN` locale correctly formats ₹ amounts
- `codeFromName` uses `slugify` — clean, dependency-based, not hand-rolled
- Consistent `logAudit` calls on all create/update/delete operations in models

---

## Summary

| Severity | Count |
|----------|-------|
| High | 2 |
| Medium | 6 |
| Low | 5 |
| **Total** | **13** |

**Top fixes:**
1. **H2** — Remove `"use server"` from `ai/analyze.ts` (5-min fix, security impact)
2. **H1** — Fix error-leaking catch blocks across 8 action files (~1 hour)
3. **M1+M2** — Extract shared rounding and inter-state utilities (~30 min)
