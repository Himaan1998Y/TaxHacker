# Phase 3 Plan — GST Reporting Hardening
## Enhanced with full code review findings · Updated April 2026
## ✅ COMPLETE — All 6 steps executed and verified on 2026-04-05

---

## Goal

Finish phase 3 as a defensible reporting pass, not a feature pass. End state: correct GST arithmetic using the promoted DB column, GSTN-shaped nil/exempt JSON, blocked invalid rows, wired ITC categories, and Vitest snapshot coverage before any further payload changes.

---

## Audit Summary: Bugs Found

Six concrete defects discovered in the code review pass. All are mapped to exact lines.

| # | Severity | File | Lines | Problem |
|---|----------|------|-------|---------|
| B1 | HIGH | `lib/gstr1.ts` | 619–635 | `sectionCounts[section].value += tx.total` — accumulates grand total (invoice value), not taxable base. `computeTable31()` in gstr3b uses this value directly for table 3.1(a), overstating GST liability. |
| B2 | HIGH | `lib/gstr1.ts` | 762–769 | `nil` JSON emits a single `{ sply_ty: "INTRB2B" }` bucket with only `nilRatedIntra`. The GSTN portal expects 4 buckets: `INTRB2B`, `INTRAB2B`, `INTRB2C`, `INTRAB2C`. Inter-state nil and non-GST amounts are dropped entirely. |
| B3 | MEDIUM | `lib/gstr1.ts` | 557–562 | `aggregateB2B()` falls back to `gstin = "UNKNOWN"`. `generateGSTR1JSON()` serializes this into `{ ctin: "UNKNOWN" }` — the portal rejects any B2B entry whose `ctin` is not a valid GSTIN. |
| B4 | MEDIUM | `lib/gstr3b.ts` | 177–183 | Table 3.1(e) non-GST outward: only matches `categoryCode.includes("non_gst")`. Misses `"non-gst"` (hyphen) and `supplyType === "NON_GST"`. Same supply that passes `classifyTransaction()` as non-GST may be invisible in 3.1(e). |
| B5 | MEDIUM | `app/api/agent/gstr3b/route.ts` | 44–49 | `generateGSTR3B(transactions, businessStateCode, businessGSTIN, periodValue)` — fifth arg `itcBlockedCategories` is never passed. All user-configured ITC blocking is silently disabled; only DEFAULT_ITC_BLOCKED_KEYWORDS fire. |
| B6 | LOW | `lib/gstr1.ts` | 780–786 | `getStateCode()` returns `""` on no match. Every B2B/B2CL/B2CS/CDNR row with an unrecognised place-of-supply emits `"pos": ""` in the portal JSON — another portal rejection vector. |

### Root cause unifying B1

The promoted `taxableAmount` column was added to the Prisma schema (`schema.prisma:186`) but was never mapped into `GSTR1Transaction` or consumed by `transactionToGSTR1()`. Every taxable-value calculation in the report layer still reconstructs it as `total - cgst - sgst - igst - cess`, which is wrong when any component is zero (e.g. advance receipts) and produces gross total as the taxable base for `sectionCounts`.

---

## What Would Have Been Done Better (Review Retrospective)

1. `taxableAmount` should have been the source of truth from the start — the promoted column exists in the schema but was never plumbed through the type layer.
2. Snapshot tests should have been written before the new CDNR/CDNUR/AT/ATADJ sections were added — without them, payload regressions are invisible.
3. The nil section should have been modelled to GSTN's 4-bucket shape from the start instead of a single intra bucket.
4. B2B rows with no GSTIN should block at the aggregation layer, not reach the JSON serializer.
5. The API route omitting `itcBlockedCategories` should have been caught at the route layer with a settings read.

---

## Step-by-Step Implementation Checklist

Execute in order. Each step has a clear deliverable and a verification gate. Steps 1–3 are prerequisite to steps 4–6 so do not reorder them.

---

### Step 1 — Wire `taxableAmount` through the type layer

**Why first**: Every downstream fix depends on having a correct taxable value on each transaction. If this is wrong, fixing the JSON shape still produces incorrect amounts.

- [ ] **1.1** Add `taxableAmount: number` field to `GSTR1Transaction` type in `lib/gstr1.ts` (after the `total` field, line ~23).
- [ ] **1.2** In `transactionToGSTR1()` (line ~646), read the promoted column: `taxableAmount: tx.taxableAmount != null ? Number(tx.taxableAmount) / 100 : Math.max(0, (tx.total || 0) / 100 - cgst - sgst - igst - cess)`. The fallback reconstructs for legacy rows that predate the migration.
- [ ] **1.3** In `generateGSTR1Report()` (line ~619), change `sectionCounts[tx.section].value += tx.total` to `sectionCounts[tx.section].value += tx.taxableAmount` so section value totals reflect taxable base, not gross.
- [ ] **1.4** In `aggregateB2B()` (~line 560), replace the inline `taxableValue = tx.total - tx.cgst - tx.sgst - tx.igst - tx.cess` computation with `tx.taxableAmount`.
- [ ] **1.5** In `aggregateB2CL()` (~line 363), replace `taxableValue = tx.total - tx.igst - tx.cess` with `tx.taxableAmount`.
- [ ] **1.6** In `aggregateB2CS()` (~line 392), replace `taxableValue = tx.total - tx.cgst - tx.sgst - tx.igst - tx.cess` with `tx.taxableAmount`.
- [ ] **1.7** In `aggregateCDNR()` (~line 548), replace the inline reconstruction with `tx.taxableAmount`.
- [ ] **1.8** In `aggregateCDNUR()` (~line 568), same replacement.
- [ ] **1.9** In `computeTable31()` in `gstr3b.ts`, change table 3.1(d) RCM loop (line ~164) to use `gstTx.taxableAmount` instead of `tx.total - tx.igst - tx.cgst - tx.sgst - tx.cess`.
- [ ] **1.10** Run `pnpm tsc --noEmit` — must compile with zero errors before proceeding.

---

### Step 2 — Fix GSTR-1 nil/exempt JSON shape (B2)

**Why second**: This is the highest-impact user-facing JSON correctness issue. The GSTN portal will reject any filing where the nil section is malformed.

- [ ] **2.1** Extend `NilExemptEntry` type to carry B2B/B2C splits plus non-GST amounts. Replace the current 4-field type with:
  ```ts
  export type NilExemptEntry = {
    description: string
    nilRatedInterB2B: number; nilRatedInterB2C: number
    nilRatedIntraB2B: number; nilRatedIntraB2C: number
    exemptedInterB2B: number; exemptedInterB2C: number
    exemptedIntraB2B: number; exemptedIntraB2C: number
    nonGSTInter: number; nonGSTIntra: number
  }
  ```
- [ ] **2.2** Rewrite `aggregateNil()` to split each nil/exempt/non-GST transaction into B2B (`tx.gstin` is set and `validateGSTIN(tx.gstin).valid`) vs B2C (no valid GSTIN), and intra vs inter as before.
- [ ] **2.3** Fix the `nil` section in `generateGSTR1JSON()` (lines 762–769). Replace the single-bucket emission with 4 GSTN-compliant buckets:
  - `INTRB2B` → `nil_amt: entry.nilRatedIntraB2B`, `expt_amt: entry.exemptedIntraB2B`, `ngsup_amt: entry.nonGSTIntra`
  - `INTRAB2B` → `nil_amt: entry.nilRatedInterB2B`, `expt_amt: entry.exemptedInterB2B`, `ngsup_amt: 0`
  - `INTRB2C` → `nil_amt: entry.nilRatedIntraB2C`, `expt_amt: entry.exemptedIntraB2C`, `ngsup_amt: 0`
  - `INTRAB2C` → `nil_amt: entry.nilRatedInterB2C`, `expt_amt: entry.exemptedInterB2C`, `ngsup_amt: 0`
  Emit only the 4 entries without conditional filtering — a zero-value bucket is valid GSTN JSON; an absent bucket is valid too but 4 fixed entries is the most unambiguous shape.
- [ ] **2.4** Update any CSV export or UI code that reads `nilRatedInter` / `nilRatedIntra` / `exemptedInter` / `exemptedIntra` to use the new field names. Search: `nilRatedIntra|exemptedInter` across `app/`.
- [ ] **2.5** Run `pnpm tsc --noEmit` — must still pass.

---

### Step 3 — Block invalid B2B rows (B3) and fix `getStateCode` fallback (B6)

**Why third**: Once nil is clean, eliminate the other two portal rejection vectors before writing the tests.

- [ ] **3.1** In `aggregateB2B()` (~line 557), add a guard before the fallback: if `!tx.gstin || !validateGSTIN(tx.gstin).valid`, push a warning to `tx.warnings` (it's a `ClassifiedTransaction`) and `continue`. Do not fall back to `"UNKNOWN"` GSTIN.
- [ ] **3.2** After `aggregateB2B()`, the removed rows are not silently swallowed — they are already in `classified` with a warning flag. The report summary will still show a warning count for them.
- [ ] **3.3** In `getStateCode()` (~line 780), instead of returning `""`, return the original input string unchanged if no state code match is found. This preserves the data and avoids `"pos": ""` for numeric state codes (e.g. `"29"`) that are already correct:
  ```ts
  return entry ? entry[0] : stateName
  ```
  Add a comment noting that callers should validate place-of-supply against `INDIAN_STATES` separately.
- [ ] **3.4** Verify `pnpm tsc --noEmit` passes.

---

### Step 4 — Fix GSTR-3B logic gaps (B4, B5)

**Why fourth**: GSTR-3B uses `sectionCounts.value` fixed in step 1 and the corrected nil/non-GST from steps 2–3, so the 3B fixes are cleanest done here.

- [ ] **4.1** In `computeTable31()` in `gstr3b.ts` (~line 177–183), widen the non-GST filter for table 3.1(e):
  ```ts
  const nonGSTTransactions = gstr1.classified.filter(
    tx => tx.gstRate === 0 && (
      (tx.categoryCode || "").toLowerCase().includes("non_gst") ||
      (tx.categoryCode || "").toLowerCase().includes("non-gst") ||
      (tx.supplyType || "").toUpperCase() === "NON_GST"
    )
  )
  ```
  Use `tx.taxableAmount` (now available) instead of `tx.total` for the sum.
- [ ] **4.2** In `app/api/agent/gstr3b/route.ts` (lines 44–49), pass blocked categories from settings as the 5th argument:
  ```ts
  const report = generateGSTR3B(
    transactions,
    businessStateCode,
    businessGSTIN,
    periodValue,
    (settings as any).itc_blocked_categories || []
  )
  ```
  Note: Cast `settings` as `any` only if the settings type doesn't yet have `itc_blocked_categories` — raise a type gap note if so.
- [ ] **4.3** Check whether `settings` model/type has an `itc_blocked_categories` field. If not, add it to the settings type (not the Prisma schema — only the TypeScript shape used post-fetch) and note this as a follow-on schema migration ticket.
- [ ] **4.4** Verify `pnpm tsc --noEmit` passes.

---

### Step 5 — Write Vitest snapshot and unit tests

**Why fifth**: Tests come after structural changes so snapshots capture the corrected shapes, not the broken ones.

- [ ] **5.1** Create `tests/gstr1.test.ts`. Use the existing `tests/indian-tax-utils.test.ts` as the style reference (Vitest, `describe`/`it`/`expect`).
- [ ] **5.2** Add `classifyTransaction()` unit tests:
  - Income + valid GSTIN → `b2b`
  - Income + no GSTIN + inter-state + total > 250000 → `b2cl`
  - Income + no GSTIN + default → `b2cs`
  - Income + `supplyType === "CREDIT_NOTE"` + valid GSTIN → `cdnr`
  - Income + `supplyType === "CREDIT_NOTE"` + no GSTIN → `cdnur`
  - Income + `supplyType === "ADVANCE"` → `at`
  - Income + `supplyType === "ADVANCE_ADJUST"` → `atadj`
  - Income + `supplyType === "EXPORT"` → `exp`
  - Income + `gstRate === 0` + nil category → `nil`
  - Income + `gstRate === 0` + exempt category → `exempt`
  - Expense transaction → `skip`
- [ ] **5.3** Add `transactionToGSTR1()` unit tests:
  - When promoted column `taxableAmount` is set, the mapped field equals `taxableAmount / 100`.
  - When `taxableAmount` is null, the fallback computes `total/100 - cgst - sgst - igst - cess`.
  - When `reverseCharge` is `"Yes"` in `extra`, output `reverseCharge: true`.
- [ ] **5.4** Add `aggregateB2B()` tests:
  - Rows with invalid GSTIN are excluded from the returned array (B3 fix verification).
  - Rows with valid GSTIN group correctly by GSTIN.
- [ ] **5.5** Create `tests/gstr1-json.test.ts`. Add a snapshot test for `generateGSTR1JSON()`:
  - Build a minimal `GSTR1Summary` fixture covering b2b, b2cs, nil (both inter and intra, B2B and B2C), and non-GST.
  - Call `generateGSTR1JSON(fixture, "27AAPFU0939F1ZV", "032026")` and assert `toMatchSnapshot()`.
  - Verify the snapshot has 4 entries in `nil.inv` with the correct `sply_ty` values.
- [ ] **5.6** Create `tests/gstr3b.test.ts`. Add:
  - `computeTable31()` test: table 3.1(a) `taxableValue` must equal sum of `taxableAmount` fields (not `total`) from b2b/b2cl/b2cs transactions.
  - `computeTable31()` test: table 3.1(e) detects `"non-gst"` (hyphen) and `supplyType === "NON_GST"`.
  - Snapshot test for `generateGSTR3BJSON()` with a minimal fixture.
- [ ] **5.7** Run `pnpm test` — all tests must pass including the new ones.

---

### Step 6 — Validation gates and UI surface

**Why last**: Non-breaking quality improvements. Step 6 can be shipped separately without holding up the core fixes.

- [ ] **6.1** In `generateGSTR1JSON()`, add a pre-flight check before iterating sections: collect all `ClassifiedTransaction` items where `section === "b2b"` and `(!gstin || !validateGSTIN(gstin).valid)`. If any exist, add them as error entries in an `_errors` field on the returned object (or throw if called with `strict: true` option). This makes the caller see the problem.
- [ ] **6.2** In the GSTR-1 export route (`app/(app)/apps/gstr1/export/route.ts`), check if `report.totalWarnings > 0` and include a `warnings_summary.txt` in the ZIP that lists each classified transaction with warnings, one per line.
- [ ] **6.3** In the GSTR-1 and GSTR-3B report UI components, add a visible banner when `report.totalWarnings > 0` that says "N transactions have data quality issues. Review before filing." with a link to expand the warning list.
- [ ] **6.4** Verify `pnpm tsc --noEmit` and `pnpm test` both pass for the final time.

---

## Final Verification — PASSED ✅

| Check | Status | Evidence |
|-------|--------|----------|
| TypeScript compiles | ✅ PASS | `pnpm tsc --noEmit` → TSC_OK |
| Test suite passes | ✅ PASS | `pnpm test` → 100 tests (10 files) |
| New GSTR tests pass | ✅ PASS | gstr1-json, gstr1, gstr3b all green |
| Nil JSON shape | ✅ PASS | 4 buckets INTRB2B/INTRAB2B/INTRB2C/INTRAB2C |
| Taxable base wired | ✅ PASS | `aggregateB2CS`, `aggregateB2CL`, all sections use `tx.taxableAmount` |
| No `UNKNOWN` GSTIN | ✅ PASS | `aggregateB2B()` skips invalid rows with warning |
| No blank POS | ✅ PASS | `getStateCode()` preserves unresolved values; handles code-prefixed inputs like "27 - Maharashtra" |
| ITC blocked categories | ✅ PASS | Funneled from settings to route handler |
| Non-GST detection | ✅ PASS | Detects both "non_gst" and "non-gst" and supplyType === "NON_GST" |

---

## Files Modified (Predicted)

| File | Steps |
|------|-------|
| `lib/gstr1.ts` | 1.1–1.8, 2.1–2.3, 3.1–3.3, 6.1 |
| `lib/gstr3b.ts` | 1.9, 4.1 |
| `app/api/agent/gstr3b/route.ts` | 4.2–4.3 |
| `app/(app)/apps/gstr1/export/route.ts` | 6.2 |
| `app/(app)/apps/gstr*-report.tsx` | 6.3 |
| `tests/gstr1.test.ts` *(new)* | 5.1–5.4 |
| `tests/gstr1-json.test.ts` *(new)* | 5.5 |
| `tests/gstr3b.test.ts` *(new)* | 5.6 |

---

## What Is Intentionally Out Of Scope

- Prisma migration for `itc_blocked_categories` column — noted for Phase 4, not touched here.
- Full GSTN portal schema validation (would require importing the GSTN JSON schema — separate hardening ticket).
- UI redesign of the GSTR report pages — only adding a warning banner in 6.3, not restructuring.
- Backfilling historical transactions — `taxableAmount` fallback in `transactionToGSTR1()` handles legacy rows; no migration needed.

