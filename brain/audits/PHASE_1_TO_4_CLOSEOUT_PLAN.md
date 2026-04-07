# Phase 1-4 Closeout Plan
## TaxHacker India - Gap Review and Remediation Plan
**Date**: 2026-04-05
**Purpose**: Close the remaining gaps in phases 1-4, remove risky shortcuts, and upgrade the current implementation from "works" to "safe, migratable, and test-proven".

---

## Status Snapshot

| Phase | Current State | Main Risk | What is already solid |
|-------|---------------|-----------|-----------------------|
| Phase 1 | Mostly done | Residual migration debt and error leakage | Session auth, bcrypt auth, upload validation, CSP headers, agent key hashing |
| Phase 2 | Mostly not done | Schema still allows weak integrity and plain fields | Very little needs to be undone; this is the largest remaining gap |
| Phase 3 | Partially done | One real compliance bug plus missing FY validation | Taxable fields, GSTR helpers, e-invoice relabeling, GSTIN validation |
| Phase 4 | Functionally green, coverage incomplete | Tests pass, but coverage/tooling and edge cases are not closed | Core GST, security, stats, export, and settings tests exist |

**In-progress work**: coverage provider dependency added in `package.json` and user-facing raw error messages in `app/(app)/settings/actions.ts` hardened.

The plan below is ordered by dependency, not by original issue number.

---

## Phase 1 Closeout: Security Hardening

### What is already done
- `lib/config.ts` enforces production checks for `ENCRYPTION_KEY` and `BETTER_AUTH_SECRET`.
- `app/(app)/settings/actions.ts` now resolves the user from session instead of taking `userId` from the browser.
- `lib/self-hosted-auth.ts` uses bcrypt for password hashing and HMAC-based cookie tokens.
- `app/api/agent/auth.ts` hashes API keys before storage and auto-migrates legacy values.
- `app/api/agent/files/route.ts` validates size and magic bytes.
- `next.config.ts` has CSP and security headers.
- `lib/db.ts` no longer logs queries in production.

### Remaining gaps to close

| Gap | File(s) | Why it still matters | Recommended fix |
|-----|---------|----------------------|-----------------|
| Raw error leakage | `app/(app)/settings/actions.ts` | Several branches still concatenate raw exception objects into user-facing errors | Replace with fixed user-safe messages and log details server-side only |
| Legacy cookie fallback | `middleware.ts`, `app/api/self-hosted-auth/route.ts` | SHA-256 cookie fallback remains during migration window | Add a sunset plan, telemetry, and a hard removal date |
| Upload memory waste | `app/api/agent/files/route.ts` | File bytes are buffered before size rejection; large uploads still allocate memory first | Reject oversize uploads before `arrayBuffer()` when possible; keep hard size guard |
| MIME provenance | `app/api/agent/files/route.ts` | Client MIME is stored even though magic bytes are validated | Persist detected MIME, not the browser supplied `file.type` |
| CSP hardening | `next.config.ts` | CSP exists, but `unsafe-eval` and a broad connect-src remain | Tighten CSP after build/lint cleanup; remove `ignoreDuringBuilds` when ready |
| Security regression coverage | tests | Security items are partially covered, but not with enough route-level confidence | Add tests for auth bypass, upload spoofing, cookie migration, and error-message leaks |

### Upgrade path
1. Convert all user-facing error returns in settings actions to fixed strings.
2. Add deprecation telemetry for the legacy self-hosted cookie.
3. Make upload validation reject oversize payloads before buffering.
4. Store detected MIME metadata alongside the client MIME.
5. Tighten CSP after the lint/build path is clean.

### Phase 1 exit gate
- No user-facing response contains raw exception text.
- Legacy self-hosted auth path has a removal date.
- Upload and MIME validation are covered by tests.
- Production security headers remain in place and documented.

---

## Phase 2 Closeout: Architecture and Schema Integrity

### What is already done
- Encryption-backed settings exist.
- Bank details are dual-written into settings during save.
- The current codebase is ready for schema migration work.

### Core gaps

| Gap | File(s) | Severity | Why it matters | Recommended fix |
|-----|---------|----------|----------------|-----------------|
| Transaction enums | `prisma/schema.prisma`, transaction code paths | Critical | `type` and `status` are still free-form strings | Introduce `TransactionType` and `TransactionStatus` enums, migrate data, update TS usage |
| File junction table | `prisma/schema.prisma`, file/transaction models | High | `files Json` has no FK integrity and produces orphan risk | Add `TransactionFile` join table, backfill, switch reads/writes, keep JSON temporarily |
| Bank details migration | `prisma/schema.prisma`, `app/(app)/settings/actions.ts`, `models/settings.ts` | High | `User.businessBankDetails` still exists in plaintext form | Backfill to settings, switch reads to settings only, then schedule column drop |
| Interim index | `prisma/schema.prisma` | Medium | JSON file lookups stay slow until the join table lands | Add a GIN index only if the junction migration is delayed |

### Upgrade path
1. Ship enums first, because Phase 3 and transaction logic should not keep using unconstrained strings.
2. Add the `TransactionFile` table and migrate existing JSON references into it.
3. Keep the bank-details dual-write only long enough to backfill and verify.
4. Drop the legacy plaintext column in a later cleanup window, not during the migration itself.

### Phase 2 exit gate
- Transaction type/status are enum-backed.
- File relationships have FK integrity.
- Bank details are read from encrypted settings only.
- No code path depends on `files Json` for the long-term model.

---

## Phase 3 Closeout: Tax Compliance Core

### What is already done
- Dedicated tax fields exist on transactions.
- GSTR-1 has CDNR, CDNUR, AT, and ATADJ types and JSON output.
- GSTR-3B has table 3.1, table 4, table 5, and table 6 helpers.
- GSTIN validation is wired into settings.
- e-invoice naming has been softened to invoice-reference QR terminology.

### Gaps that still need closure

| Gap | File(s) | Severity | Why it matters | Recommended fix |
|-----|---------|----------|----------------|-----------------|
| Indian FY validation | missing utility | High | Users can generate reports for invalid or future periods | Add `lib/indian-fy.ts` with `validateGSTRPeriod()` and wire it into report generation routes/forms |
| Non-GST double counting | `lib/gstr3b.ts` | High | Table 3.1(c) currently picks up values that are also counted in table 3.1(e) | Exclude non-GST rows from the nil/exempt total and compute 3.1(e) separately |
| Place-of-supply normalization | `lib/gstr1.ts`, ingestion layer | Medium | Export-time conversion is a weak substitute for canonical storage | Normalize to 2-digit state codes at ingestion; make export validation-only |
| Nil JSON clarity | `lib/gstr1.ts`, `tests/gstr1-json.test.ts` | Medium | The nil bucket mapping is easy to misread and easy to regress | Add explicit tests and comments for the 4 GSTN nil buckets |
| GSTR-3B RCM verification | `lib/gstr3b.ts`, `tests/gstr3b.test.ts` | Medium | RCM logic exists in intent but needs dedicated coverage and confirmation | Add table 3.1(d) tests and snapshot validation |
| e-invoice alias cleanup | `lib/e-invoice.ts`, UI labels | Low/Medium | Both old and new names are exposed; label confusion remains | Remove the alias after all callers are migrated |

### Additional upgrades worth making
- Add snapshot tests against the GSTN-shaped JSON for all major sections, not just nil.
- Add a small validation layer that rejects future GSTR periods before any report is built.
- Move state-code cleanup to the write path so exports stop carrying normalization logic.
- Keep integer paise as the source of truth in every compliance calculation.

### Phase 3 exit gate
- GSTR period validation blocks invalid or future periods.
- Non-GST values are not counted twice in GSTR-3B.
- Exported JSON relies on canonical 2-digit state codes.
- All GSTR sections have explicit regression coverage.

---

## Phase 4 Closeout: Test Suite Foundation

### What is already done
- Core functional tests exist for GSTR-1, GSTR-3B, files, stats, export helpers, and encryption primitives.
- TypeScript compile is currently clean.
- The Phase 4 test group passes functionally.

### Remaining gaps

| Gap | File(s) | Severity | Why it matters | Recommended fix |
|-----|---------|----------|----------------|-----------------|
| Coverage tooling missing | package/config | High | `pnpm test --coverage` is blocked until the coverage provider is installed | Add `@vitest/coverage-v8` and wire coverage reporting into the script/CI path |
| GSTR-1 test breadth | `tests/gstr1.test.ts` | High | Current tests do not cover the full classification matrix | Add export, CDNR/CDNUR, AT/ATADJ, missing-warning, and precision cases |
| GSTR-1 JSON breadth | `tests/gstr1-json.test.ts` | Medium | Only a narrow JSON shape is covered right now | Add full schema assertions for B2B, B2CL, B2CS, CDNR, CDNUR, AT, ATADJ |
| GSTR-3B test breadth | `tests/gstr3b.test.ts` | High | Table 4 and table 6 logic are not fully exercised | Add ITC blocked-category tests, table 6 tax payable/carry-forward, and RCM coverage |
| Settings round-trip depth | `tests/settings.test.ts`, `models/settings.ts` | Medium | Crypto is tested, but DB-backed settings behavior is not | Add an integration test for encrypted settings save/read round-trip |
| Export endpoint integration | `app/(app)/export/transactions/route.ts`, tests | High | Helper tests exist, but the actual export route still needs endpoint coverage | Add route-level integration tests for CSV and ZIP responses |
| Fixture reuse | `tests/fixtures/transactions.fixture.ts` | Medium | Fixtures exist, but more scenario-specific builders would reduce duplication | Add dedicated GST, export, and security fixture builders |

### Upgrade path
1. Install the coverage provider first so the phase can be measured instead of guessed.
2. Expand the GSTR test matrix before touching any more production logic.
3. Add integration tests for route behavior, not just helper functions.
4. Add per-file coverage thresholds so regressions are visible immediately.

### Phase 4 exit gate
- `pnpm test --coverage` runs successfully.
- `lib/gstr1.ts`, `lib/gstr3b.ts`, `lib/files.ts`, `lib/stats.ts`, and export-related code are above target coverage.
- GSTR JSON snapshots are locked and reviewed.
- Route-level export and settings round-trip coverage exists.

---

## Recommended Execution Order

### Step 1: Finish schema blockers
1. Add `TransactionType` and `TransactionStatus` enums.
2. Add the `TransactionFile` join table and migration.
3. Backfill bank details into encrypted settings and keep dual-write only during the transition.

### Step 2: Seal tax correctness
1. Add Indian FY validation.
2. Fix GSTR-3B non-GST double counting.
3. Normalize place-of-supply codes at write time.
4. Remove confusion around e-invoice naming.

### Step 3: Close the test gap
1. Add coverage tooling.
2. Expand GSTR-1 and GSTR-3B test matrices.
3. Add route-level integration tests for export and settings.
4. Add snapshot tests for portal-shaped JSON.

### Step 4: Finish security cleanup
1. Remove raw error leakage from settings actions.
2. Sunset the legacy self-hosted cookie fallback.
3. Tighten CSP once the build path is cleaned up.

---

## Definition of Done for Phases 1-4

| Phase | Done means |
|-------|------------|
| Phase 1 | No user-facing raw errors, no unsafe fallback left without a removal date, upload and auth hardening tested |
| Phase 2 | Schema enforces integrity, file relations have FK protection, bank details are encrypted and deduplicated |
| Phase 3 | Reports are period-valid, JSON is GSTN-correct, GSTR-3B no longer double counts non-GST |
| Phase 4 | Coverage is measurable, test scope matches the compliance matrix, helper and route integration both have coverage |

---

## Final Recommendation

Treat the current implementation as "functionally useful but not closeout-complete." The next move is not more feature work; it is finishing the schema migrations, fixing the one real tax-calculation bug, and upgrading the test suite so coverage is measurable and route-level behavior is locked down.
