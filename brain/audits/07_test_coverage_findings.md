# Dimension 7: Test Coverage & Edge Cases Findings
**Date**: 2026-03-31
**Files Reviewed**: tests/indian-tax-utils.test.ts, tests/encryption.test.ts, tests/audit.test.ts, tests/self-hosted-auth.test.ts, tests/rate-limit.test.ts, tests/retention.test.ts, vitest.config.ts
**Test count**: ~89 tests across 7 files

---

## CRITICAL (2)

### C1 — GSTR-1 & GSTR-3B classification logic has ZERO tests
**Files**: `lib/gstr1.ts`, `lib/gstr3b.ts` (0 test files)
**Issue**: The most complex and financially consequential code in the entire app is completely untested:
- `classifyTransaction()` — determines which GSTR-1 section (B2B/B2CL/B2CS/Nil/Exempt/Export) a transaction belongs to. A misclassification means filing the wrong return.
- `aggregateB2B()`, `aggregateB2CL()`, `aggregateB2CS()` — aggregation logic with floating point arithmetic
- `generateGSTR1Report()` — the entire report generation pipeline
- `generateGSTR3B()` — ITC computation (Input Tax Credit). Errors here mean taxpayers over/under-claim ITC — a GST audit risk.
- `computeTable4()` — Section 17(5) ITC blocking logic

**Impact**: A bug in ITC computation could cause users to claim incorrect tax credits, triggering GST scrutiny notices with interest + penalties. This is the highest business risk in the entire codebase.

**Missing test scenarios**:
- B2B classification: transaction with valid GSTIN → should land in B2B
- B2CL classification: inter-state, no GSTIN, total > ₹2.5L
- B2CS default classification: intra-state with no GSTIN
- Nil classification: 0% GST rate
- Export classification: `supplyType = "export"`
- ITC blocked categories (Section 17(5)): transaction with category "food" → should reverse ITC
- Floating point: 100 transactions of ₹180 CGST → total should exactly equal ₹18,000

### C2 — `safePathJoin` (security-critical function) is untested
**File**: `lib/files.ts:53-58` (no test file for `lib/files.ts`)
**Issue**: The path traversal prevention function is the primary security control for file access. It is completely untested. Edge cases that need verification:
- `safePathJoin("/uploads", "../../../etc/passwd")` → should throw
- `safePathJoin("/uploads", "user@example.com", "file.pdf")` → should work
- `safePathJoin("/uploads", "user%2F../evil")` → should throw (URL-encoded traversal)
- Windows-style paths on non-Windows (when deployed on Linux)

---

## HIGH (3)

### H1 — No integration tests for any API route
**Files**: `app/api/agent/*` (0 test files)
**Issue**: The entire Agent API surface — 10+ endpoints for transaction CRUD, file upload, AI analysis, GSTR-1, GSTR-3B, embeddings, search — has zero test coverage. No verification that:
- `authenticateAgent()` actually blocks unauthenticated requests
- GSTIN validation rejection works end-to-end
- File upload correctly creates DB record and disk file
- AI analysis fallback chain fires when primary provider fails

### H2 — No tests for settings encryption/decryption round-trip
**File**: `models/settings.ts` (no test file)
**Issue**: `updateSettings()` encrypts sensitive keys before DB write and `getSettings()` decrypts on read. If the encrypt/decrypt cycle breaks (e.g., due to key rotation or format change), API keys silently become unreadable, breaking all AI functionality. The individual encryption functions ARE tested, but the model-layer integration is not.

### H3 — LLM provider failover logic untested
**File**: `ai/providers/llmProvider.ts` (no test file)
**Issue**: `requestLLM()` implements a failover chain: try provider 1 → retry → try provider 2 → retry → etc. No test verifies:
- That the fallback fires when provider 1 fails
- That the retry happens once before moving to next provider
- That all-providers-failed returns the correct error response
- That structured output failure falls back to raw text parse correctly

---

## MEDIUM (4)

### M1 — No tests for `lib/stats.ts` financial calculations
**File**: `lib/stats.ts` (no test file)
**Issue**: `calcNetTotalPerCurrency()` and `calcTotalPerCurrency()` aggregate financial totals per currency — shown in the dashboard and transactions footer. A sign error here (income treated as expense) would show the user wrong P&L. `isTransactionIncomplete()` determines the yellow warning highlight in the transaction list.

**Missing scenarios**:
- Mixed income/expense transactions — net total should show correct sign
- Multi-currency transactions — should aggregate by currency code
- `isTransactionIncomplete` with required fields missing

### M2 — No tests for CSV formula injection sanitization
**File**: `app/(app)/export/transactions/route.ts:21-27`
**Issue**: `sanitizeCSVValue()` prevents Excel/Sheets formula injection. Missing tests for:
- Strings starting with `=`, `+`, `-`, `@`, `\t`, `\r`
- Non-string values (numbers, dates) — should pass through unchanged
- Empty string — should pass through

### M3 — No tests for `numberToIndianWords` / `amountToIndianWords`
**File**: `lib/utils.ts:160-216`
**Issue**: The Indian number-to-words converter is used on invoices (legal document). Errors produce incorrect invoice amounts in words ("Rupees" section). Missing tests for:
- Crore values: 10,000,000 → "One Crore"
- Lakh values: 100,000 → "One Lakh"
- Complex: 12,345,678 → "One Crore Twenty Three Lakh Forty Five Thousand Six Hundred Seventy Eight"
- Paise: 10000.50 → "One Hundred Rupees and Fifty Paise Only"
- Negative amounts

### M4 — Self-hosted auth test doesn't test weakness
**File**: `tests/self-hosted-auth.test.ts`
**Issue**: The existing tests verify SHA-256 output format and consistency, but don't flag the security concern: there's no test that validates timing-safety of comparison, or documents the known weakness (SHA-256 for password hashing). The test validates the current (broken) behavior as correct.

---

## LOW (3)

### L1 — Test file for `utils.test.ts` not reviewed, may cover/miss items
**File**: `tests/utils.test.ts`
**Issue**: Only 6 of 7 test files were reviewed (the test inventory shows `tests/utils.test.ts`). If it tests `formatCurrency`, `formatBytes`, `codeFromName`, those are reasonably important. But `generateUUID`, `encodeFilename`, and `fetchAsBase64` are likely untested.

### L2 — No test for Tally export format
**File**: `lib/tally-export.ts` (no test file)
**Issue**: Tally XML export is used by Indian accountants/CAs. A format error (wrong XML structure, wrong field mapping) would silently generate corrupt files that Tally would reject. Parsing error messages from Tally are cryptic.

### L3 — No snapshot/regression tests for GSTR-1 JSON output
**Issue**: Once the GSTR-1 JSON format is correct, it should be snapshot-tested to prevent accidental regression. A single wrong field name (e.g., `iamt` vs `igst`) in the GSTN JSON format breaks portal upload.

---

## What's Done Well ✓

- `vi.resetModules()` approach for rate-limit tests — correct for module-scoped state
- `process.env.ENCRYPTION_KEY` set before import — correct env setup for encryption tests
- `vi.spyOn(Date, 'now')` for time-dependent rate limit tests — proper time mocking
- Database mocked with `vi.mock('@/lib/db')` — correct isolation from DB in unit tests
- Known-valid GSTIN `27AAPFU0939F1ZV` used for Maharashtra — tests real checksum algorithm
- Edge cases covered: empty string, unicode text, long text in encryption tests
- Boundary tests in retention: 7 years (within), 9 years (outside) the 8-year window
- TDS test covers both individual and company rates, and unknown section → 0 fallback
- Good use of `beforeEach` to ensure fresh state between rate-limit tests

---

## Summary

| Severity | Count |
|----------|-------|
| Critical | 2 |
| High | 3 |
| Medium | 4 |
| Low | 3 |
| **Total** | **12** |

**Coverage estimate**: ~89 tests cover ~7 library files. The remaining ~170 source files have 0% test coverage. Rough overall coverage: **~10% of codebase tested**.

**Priority tests to write:**
1. **C1** — `tests/gstr1.test.ts`: B2B/B2CL/B2CS/Nil classification + ITC computation (highest business risk)
2. **C2** — Add `safePathJoin` to `tests/files.test.ts` with traversal attempts
3. **M1** — `tests/stats.test.ts`: net total with income/expense mix
