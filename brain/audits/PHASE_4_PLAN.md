# Phase 4 Plan — Test Suite Foundation
## Sequential Phase in TaxHacker Fix Plan · Updated April 2026

---

## Goal

Build comprehensive unit and integration tests for the core business logic verified in Phase 3. End state: 80%+ code coverage on business logic files, all edge cases tested, zero regressions when code changes.

**Dependency**: Phase 3 (GSTR reporting core) must be complete first so tests are written against correct, stable code.

---

## Phase 4 Status

- Functional test suite verified: `pnpm exec vitest run tests/files.test.ts tests/settings.test.ts tests/stats.test.ts tests/export.test.ts tests/gstr1.test.ts tests/gstr1-json.test.ts tests/gstr3b.test.ts` → **32 passed**
- TypeScript compile verified: `pnpm exec tsc --noEmit` → **TSC_OK**
- Coverage run blocked by missing dependency: `@vitest/coverage-v8` is not installed in this workspace. Install it to generate the 80%+ business logic coverage report.

---

## Scope & Prioritization

### BLOCKER Tests (Ship-Blocking — Must have 100%)

| Issue | File | Gate |
|-------|------|------|
| C5 | `lib/gstr1.ts` (4A, 4B) | Classification 100% branch coverage, aggregations all verified, JSON portal-compliant |
| C6 | `lib/files.ts` (4D) | Path traversal: all 8 vectors tested and blocked, `safePathJoin` result always constrained |
| M7-2 | `lib/export.ts` (4F) | Formula injection: =, +, -, @ all prefixed; no CSV can be evaluated as code |

### STRONG Tests (Regression protection — Target 90%+)

| Issue | File | Gate |
|-------|------|------|
| M7-3 | `lib/gstr3b.ts` (4C) | Table 3.1(a) exact sum match, ITC rules applied, RCM handling |
| M7-4 | GSTR JSON (4B) | Full JSON structure validated, state codes 2-digit, no portal-invalid fields |
| H7-1, M7-1 | `lib/stats.ts` (4E) | Word conversion (crores/lakhs/rupees) all exact, currency grouping correct |

### INTEGRATION Tests (Nice-to-have — 80%+)

| Issue | File | Gate |
|-------|------|------|
| H7-3 | Export workflow (4F) | ZIP functional, CSV shape correct, large export doesn't OOM (sanity check) |
| H7-2 | Encryption (4G) | Round-trip verified, sensitive values never plaintext in DB |

### Test Distribution

| Test File | Brief | Priority | Effort | First-Run |
|-----------|-------|----------|--------|----------|
| `gstr1.test.ts` (4A–4B suites 1–5) | Classification, aggregation, JSON | **BLOCKER** | 3.5h | Snapshots auto-generated on first run |
| `gstr3b.test.ts` (4C suites 6–9) | Table computation, ITC, JSON | **STRONG** | 2.5h | Snapshots auto-generated on first run |
| `files.test.ts` (4D suite 10) | Path traversal vectors | **BLOCKER** | 1h | No snapshots needed |
| `stats.test.ts` (4E suites 11–13) | Word conversion, currency | **STRONG** | 2h | No snapshots needed |
| `export.test.ts` (4F suites 14–16) | CSV sanitization, ZIP | **BLOCKER + INTEGRATION** | 2h | Snapshots for CSV shape only |
| `settings.test.ts` (4G suite 17) | Encryption round-trip | **INTEGRATION** | 1h | No snapshots (DB integration) |
| **Total** | — | — | **~12h** | — |

---

## Test Architecture

### Test Framework: Vitest
- Config: `vitest.config.ts` (already in place)
- Run: `pnpm test`
- Watch: `pnpm test --watch`
- Coverage: `pnpm test --coverage` (target: 80%+ business logic)

### File Structure
```
tests/
├── gstr1.test.ts           (new) — Classification, aggregation, JSON shape
├── gstr3b.test.ts          (new) — Table computation, ITC, RCM
├── stats.test.ts           (new) — Financial calculations, word conversion
├── export.test.ts          (new) — CSV, ZIP structure, sanitization
├── files.test.ts           (new) — Path traversal, safePathJoin
├── settings.test.ts        (new) — Encryption round-trip
├── __snapshots__/
│   ├── gstr1-json.test.ts.snap
│   ├── gstr3b-json.test.ts.snap
│   └── export-csv.test.ts.snap
└── fixtures/
    ├── transactions.fixture.ts
    └── sample-files.fixture.ts
```

### Test Fixtures (Shared)
**File**: `tests/fixtures/transactions.fixture.ts` — re-used across all GST tests

```ts
// ──── Core Test Values
export const validGSTIN = '27AAPFU0939F1ZV'  // Maharashtra, valid checksum
export const businessStateCode = '27'  // Maharashtra
export const invalidGSTIN = 'INVALIDGSTIN'  // For negative tests

// ──── B2B Transaction (₹10K total, 18% GST)
export const sampleB2BTransaction = {
  id: 'tx-b2b-001',
  name: 'Customer A',
  merchant: 'Merchant A',
  invoiceNumber: 'INV-B2B-001',
  gstin: validGSTIN,
  total: 1000000,  // ₹10,000 in paise
  taxableAmount: 847457,  // ₹8,474.57 (tax-inclusive calculation)
  gstRate: 18,
  cgst: 76271,  // ₹762.71
  sgst: 76271,  // ₹762.71
  igst: 0,
  cess: 0,
  hsnCode: '1001',
  placeOfSupply: '27 - Maharashtra',
  supplyType: 'B2B',
  reverseCharge: false,
  issuedAt: new Date('2026-03-15'),
  type: 'income',
  categoryCode: 'sales',
}

// ──── B2CL Transaction (₹3L total, inter-state, 5% GST)
export const sampleB2CLTransaction = {
  id: 'tx-b2cl-001',
  name: 'Customer B',
  merchant: 'Merchant B',
  invoiceNumber: 'INV-B2CL-001',
  gstin: null,
  total: 30000000,  // ₹3,00,000 (above ₹2.5L threshold, inter-state)
  taxableAmount: 28571428,  // ₹2,85,714.28 (5% IGST = ₹14,285.72)
  gstRate: 5,
  cgst: 0,
  sgst: 0,
  igst: 1428572,  // ₹14,285.72
  cess: 0,
  hsnCode: null,
  placeOfSupply: '29 - Karnataka',  // Inter-state from '27'
  supplyType: null,
  reverseCharge: false,
  issuedAt: new Date('2026-03-15'),
  type: 'income',
  categoryCode: 'sales',
}

// ──── B2CS Transaction (₹1K, intra-state, 12% GST)
export const sampleB2CSTransaction = {
  id: 'tx-b2cs-001',
  name: 'Customer C',
  merchant: 'Merchant C',
  invoiceNumber: null,
  gstin: null,
  total: 100000,  // ₹1,000
  taxableAmount: 89285,  // ₹892.86 (12% CGST+SGST)
  gstRate: 12,
  cgst: 5357,  // ₹53.57
  sgst: 5357,
  igst: 0,
  cess: 0,
  hsnCode: null,
  placeOfSupply: '27 - Maharashtra',  // Intra-state (same as business)
  supplyType: null,
  reverseCharge: false,
  issuedAt: new Date('2026-03-15'),
  type: 'income',
  categoryCode: 'sales',
}

// ──── Nil-Rated Transaction (₹5K, B2B, intra)
export const sampleNilTransaction = {
  id: 'tx-nil-001',
  name: 'Customer D',
  merchant: 'Merchant D',
  invoiceNumber: 'INV-NIL-001',
  gstin: '29ABCDE1234F1Z0',  // Valid Karnataka GSTIN (makes it B2B)
  total: 500000,  // ₹5,000
  taxableAmount: 500000,  // Nil → no tax
  gstRate: 0,
  cgst: 0,
  sgst: 0,
  igst: 0,
  cess: 0,
  hsnCode: null,
  placeOfSupply: '27 - Maharashtra',  // Intra
  supplyType: null,
  reverseCharge: false,
  issuedAt: new Date('2026-03-15'),
  type: 'income',
  categoryCode: 'gst_nil_rated',
}

// ──── Exempt Transaction (₹2K, B2C, inter)
export const sampleExemptTransaction = {
  id: 'tx-exempt-001',
  name: 'Customer E',
  merchant: 'Merchant E',
  invoiceNumber: null,
  gstin: null,
  total: 200000,  // ₹2,000
  taxableAmount: 200000,  // Exempt → no tax
  gstRate: 0,
  cgst: 0,
  sgst: 0,
  igst: 0,
  cess: 0,
  hsnCode: null,
  placeOfSupply: '07 - Delhi',  // Inter-state from '27'
  supplyType: null,
  reverseCharge: false,
  issuedAt: new Date('2026-03-15'),
  type: 'income',
  categoryCode: 'gst_exempt',
}

// ──── Credit Note (Registered customer)
export const sampleCDNRTransaction = {
  id: 'tx-cdnr-001',
  name: 'Customer F',
  merchant: 'Merchant F',
  invoiceNumber: 'CN-001',  // Credit note number
  gstin: validGSTIN,
  total: 50000,  // ₹500 credit
  taxableAmount: 42373,  // ₹423.73 taxable
  gstRate: 18,
  cgst: 3813,  // ₹38.13
  sgst: 3813,
  igst: 0,
  cess: 0,
  hsnCode: null,
  placeOfSupply: '27 - Maharashtra',
  supplyType: 'CREDIT_NOTE',
  reverseCharge: false,
  issuedAt: new Date('2026-03-15'),
  type: 'income',
  categoryCode: 'credit_note',
}

// ──── RCM Transaction (Reverse Charge, expense)
export const sampleRCMTransaction = {
  id: 'tx-rcm-001',
  name: 'Supplier G',
  merchant: 'Supplier G',
  invoiceNumber: 'PUR-RCM-001',
  gstin: '29SUPPLIER1234Z0',  // Different state supplier
  total: 100000,  // ₹1,000
  taxableAmount: 84745,  // ₹847.46 (18% IGST)
  gstRate: 18,
  cgst: 0,
  sgst: 0,
  igst: 15254,  // ₹152.54
  cess: 0,
  hsnCode: null,
  placeOfSupply: '29 - Karnataka',  // Different state
  supplyType: 'PURCHASE',
  reverseCharge: true,  // ← RCM flag
  issuedAt: new Date('2026-03-15'),
  type: 'expense',  // ← Expense (inward supply)
  categoryCode: 'office_supplies',
}
```

**Snapshot behavior on first run**: When you first run `pnpm test`, Vitest will see no `.snap` files and auto-generate them by executing all snapshot tests. This output is stored to `tests/__snapshots__/`. **Do NOT manually edit `.snap` files**. If snapshots are wrong, fix the code and re-run tests (snapshots will update). If you need to force update, use `pnpm test -- -u`.

---

## Phase 4A — GSTR-1 Classification Tests
**File**: `tests/gstr1.test.ts`
**Effort**: 2 hours
**Gate**: All classification paths tested, aggregation totals validated

### Test Suite 1: classifyTransaction()
```ts
describe('classifyTransaction', () => {
  describe('outward supplies classification', () => {
    it('expense transactions route to skip section')
    it('B2B: valid GSTIN present → b2b section')
    it('B2B: valid GSTIN + supplyType=B2B (explicit) → b2b')
    it('B2B: generates warnings for missing invoice number')
    it('B2B: generates warnings for missing place of supply')
    it('B2B: generates warnings for missing HSN/SAC code')
    
    it('B2CL: inter-state + no GSTIN + total > ₹2,50,000 → b2cl')
    it('B2CL: ignores GSTIN if present (uses total > threshold)')
    it('B2CL: generates warnings when businessStateCode not set')
    it('B2CL: generates warnings for missing invoice/place of supply')
    
    it('B2CS: intra-state + no GSTIN → b2cs (default)')
    it('B2CS: small transactions + no GSTIN → b2cs (regardless of state)')
    it('B2CS: generates warnings for missing place of supply')
  })
  
  describe('special supply types', () => {
    it('EXPORT: supplyType=EXPORT → exp section')
    it('EXPORT: generates warnings for missing invoice')
    
    it('CREDIT_NOTE + valid GSTIN → cdnr')
    it('CREDIT_NOTE + no GSTIN → cdnur')
    it('DEBIT_NOTE + valid GSTIN → cdnr (with noteType=D)')
    it('ADVANCE_RECEIVED → at section')
    it('ADVANCE_ADJUSTED → atadj section')
  })
  
  describe('nil and exempt classification', () => {
    it('gstRate === 0 + nil_rated category → nil')
    it('gstRate === 0 + nil category (short form) → nil')
    it('gstRate === 0 + exempt category → exempt')
    it('gstRate === 0 + no category → defaults to nil')
    it('gstRate === 0 (explicit) + exempt category → exempt')
  })
  
  describe('edge cases', () => {
    it('both supplyType and categoryCode present → supplyType takes precedence')
    it('null/empty placeOfSupply → generates warning')
    it('invalid GSTIN format → skips B2B classification, falls back to B2CL/B2CS')
    it('zero total + valid GSTIN → still classifies as b2b')
  })
})
```

### Test Suite 2: transactionToGSTR1()
```ts
describe('transactionToGSTR1', () => {
  it('maps DB transaction to GSTR1Transaction with type coercion (paise → rupees)')
  
  it('uses promoted taxableAmount column when available')
  it('reconstructs taxableAmount = total - cgst - sgst - igst - cess when null')
  it('negative reconstructed taxableAmount clamps to 0')
  
  it('maps reverseCharge: boolean (from boolean or "Yes"/"No" string in extra)')
  it('maps gstRate from either promoted column or extra JSON')
  
  it('handles null issuedAt gracefully')
  it('maps invoiceNumber from promoted column or extra')
  it('maps GSTIN, hsnCode, placeOfSupply from first available source')
  
  it('preserves type (expense/income) for later section filtering')
})
```

### Test Suite 3: aggregation functions
```ts
describe('aggregateB2B', () => {
  it('groups invoices by GSTIN correctly')
  it('sums taxableValue correctly across multiple invoices for same GSTIN')
  it('computes CGST+SGST+IGST+CESS correctly')
  it('skips rows with invalid/missing GSTIN and logs warnings')
  it('handles reverseCharge flag correctly (Y/N in JSON)')
})

describe('aggregateB2CL', () => {
  it('maps invoice fields to B2CL shape')
  it('uses taxableValue (not total) for taxableValue field')
  it('handles IGST for inter-state B2C')
})

describe('aggregateB2CS', () => {
  it('groups by placeOfSupply, supplyType, rate')
  it('splits intra-state (same pos as business) vs inter-state')
  it('sums taxableValue across group')
  it('zero-rate groups are included (generates warning but still aggregated)')
})

describe('aggregateNil', () => {
  it('splits nil+intra+B2B, nil+intra+B2C, nil+inter+B2B, nil+inter+B2C')
  it('splits exempt the same way')
  it('splits non-GST supply the same way (4 buckets)')
  it('detects B2B via validateGSTIN(gstin)')
  it('output has exactly 1 NilExemptEntry object')
})
```

### Test Suite 4: generateGSTR1Report()
```ts
describe('generateGSTR1Report', () => {
  it('produces GSTR1Summary with all 12 sections (b2b, b2cl, b2cs, cdnr, cdnur, at, atadj, hsn, nil, skip, classified, sectionCounts, totalWarnings)')
  
  it('sectionCounts: count == transaction count per section')
  it('sectionCounts: value == sum of taxableAmount per section (not total)')
  it('sectionCounts: warnings == sum of transaction warnings')
  it('totalWarnings == sum of all section warnings')
  
  // GOLDEN TEST: Floating point precision (₹ amounts must be exact, not accumulate drift)
  it('golden test: 100 identical transactions (each ₹10,000 total with ₹762.71 CGST) = exactly ₹76,271.00 total CGST (no float rounding errors)', () => {
    // Setup: 100 transactions, each ₹10,000 with 18% GST → CGST = ₹762.71 per transaction
    // Expected: sum = ₹76,271.00 (NOT ₹76,270.99 or ₹76,271.01 from accumulated float errors)
    const txns = Array(100).fill(sampleB2BTransaction)
    const report = generateGSTR1Report(txns, businessStateCode)
    expect(report.sectionCounts.b2b.value).toBe(8474563)  // 100 × 84,745.63 paise
    expect(report.b2b[0]?.invoices[0]?.cgst).toBe(76.271)  // Exact rupees
  })
})
```

---

## Phase 4B — GSTR-1 JSON Schema Tests
**File**: `tests/gstr1-json.test.ts`
**Effort**: 1.5 hours
**Gate**: JSON validates as GSTN portal-compliant

### Test Suite 5: generateGSTR1JSON()
```ts
describe('generateGSTR1JSON', () => {
  it('produces object with keys: gstin, fp, b2b, b2cl, b2cs, cdnr, cdnur, at, atadj, hsn, nil')
  it('no top-level `_errors` or `_warnings` fields (portal-clean JSON)')
  
  it('gstin matches input GSTIN')
  it('fp (filing period) is in MMYYYY format')
  
  describe('B2B section', () => {
    it('each entry has ctin, inv array')
    it('each invoice has: inum, idt, val, pos, rchrg, inv_typ, itms')
    it('each item has: num, itm_det with rt, txval, camt, samt, iamt, csamt')
    it('pos is 2-digit state code (not name)')
    it('rchrg is "Y" or "N" string')
  })
  
  describe('B2CL section', () => {
    it('each entry has pos, inv array')
    it('each invoice has: inum, idt, val, itms')
    it('pos is 2-digit state code')
  })
  
  describe('B2CS section', () => {
    it('each entry: sply_ty, pos, rt, txval, camt, samt, iamt, csamt')
    it('sply_ty is "INTRA" or "INTER"')
  })
  
  describe('nil section', () => {
    it('nil.inv array has exactly 4 entries')
    it('sply_ty values are ["INTRB2B", "INTRAB2B", "INTRB2C", "INTRAB2C"]')
    it('each entry has: nil_amt, expt_amt, ngsup_amt (all numbers)')
    it('zero values are allowed and valid')
  })
  
  describe('state code resolution', () => {
    it('canonical state name "Maharashtra" → "27"')
    it('code-prefixed "27 - Maharashtra" → "27"')
    it('2-digit code "27" → "27" (pass-through)')
    it('unrecognized state → returns input unchanged (not blank)')
  })
})

describe('GSTR1JSON snapshot test', () => {
  it('matches golden snapshot (full fixture → JSON structure)', () => {
    // Uses fixture with b2b, b2cs, cdnr, cdnur, nil entries
    // Snapshot ensures no regressions in field names, ordering, types
  })
})
```

---

## Phase 4C — GSTR-3B Table Computation Tests
**File**: `tests/gstr3b.test.ts`
**Effort**: 2.5 hours
**Gate**: All 6 GSTR-3B tables correctly computed

### Test Suite 6: GSTR3B Table 3.1 (Outward Supplies)
```ts
describe('computeTable31', () => {
  describe('table31[0] — Taxable supplies', () => {
    it('sums taxableAmount (not total) from b2b + b2cl + b2cs transactions')
    it('floating point: sum of 1000 × ₹18.18 CGST = exactly ₹18,180')
    it('multiplied quantities: 5 invoices × ₹100 = ₹500 taxable base')
  })
  
  describe('table31[1] — Nil-rated supplies', () => {
    it('sums nil-rated transactions from aggregateNil()')
    it('includes both B2B and B2C nil')
    it('handles missing nilRated gracefully (0 is valid)')
  })
  
  describe('table31[2] — Exempt supplies', () => {
    it('sums exempt transactions from aggregateNil()')
    it('excludes nil-rated')
  })
  
  describe('table31[3] — Non-GST outward supplies', () => {
    it('detects categoryCode includes "non_gst"')
    it('detects categoryCode includes "non-gst" (hyphen variant)')
    it('detects supplyType === "NON_GST"')
    it('sums taxableAmount from matching transactions')
    it('does NOT include nil/exempt transactions')
  })
  
  describe('table31[4] — Inward supplies (RCM)', () => {
    it('expenses with reverseCharge=true route here')
    it('sums CGST+SGST+IGST+CESS')
  })
})
```

### Test Suite 7: GSTR3B Table 4 (ITC Eligibility)
```ts
describe('computeTable4', () => {
  describe('ITC available (eligible)', () => {
    it('B2B invoices with valid GSTIN → full ITC eligible')
    it('imports (with ITC) → full ITC eligible')
    it('RCM supplies → full ITC eligible')
    it('capital goods (HSN 8521–8523) → full ITC eligible')
  })
  
  describe('ITC ineligible (Section 17(5))', () => {
    it('food and beverages (0% tax) → no ITC')
    it('personal use vehicles (motor_vehicle category) → no ITC')
    it('fuel surcharge reversed (special case) → partial ITC')
  })
  
  describe('ITC reversal process', () => {
    it('itcAvailable = sum of eligible CGST+SGST+IGST+CESS')
    it('itcReversed = sum of ineligible categories')
    it('itcNet = itcAvailable - itcReversed (not negative)')
  })
  
  describe('blocked categories (settings)', () => {
    it('when user sets `itcBlockedCategories = ["food", "motor_vehicle"]`')
    it('those categories are excluded from itcAvailable')
    it('reversed is computed as ineligible + blocked')
  })
})
```

### Test Suite 8: GSTR3B Table 6 (Tax Liability)
```ts
describe('computeTable6', () => {
  it('taxPayable = table31[0] CGST/SGST/IGST - table4 itcNet')
  it('negative tax payable (ITC > output) → carries to table6.itcCarriedForward')
  it('tax payable rounded to 2 decimals')
})
```

### Test Suite 9: Full GSTR3B JSON
```ts
describe('generateGSTR3BJSON', () => {
  it('produces valid GSTR-3B portal JSON structure')
  it('includes: gstin, ret_period, sup_details, itc_elg, inward_sup')
  it('snapshot test matches golden GSTR3B JSON')
})
```

---

## Phase 4D — Path Traversal Security Tests
**File**: `tests/files.test.ts`
**Effort**: 1 hour
**Gate**: All traversal vectors tested and failing

### Test Suite 10: safePathJoin()
```ts
describe('safePathJoin', () => {
  const basePath = "/home/user/uploads"
  
  describe('valid paths', () => {
    it('simple file: safePathJoin(base, "file.txt") → base/file.txt')
    it('nested: safePathJoin(base, "folder/subfolder/file.txt")')
    it('encoded slashes are decoded: "folder%2Ffile.txt" → error (traversal)')
  })
  
  describe('path traversal attacks', () => {
    it('../ single level → throws')
    it('../../ double level → throws')
    it('../../../ many levels → throws')
    it('./.. mixed with directory → throws')
    it('absolute path /etc/passwd → throws')
    it('null byte injection file.txt\x00.php → throws')
    it('URL-encoded ../ as %2E%2E%2F → throws')
    it('unicode normalization bypass → throws')
  })
  
  describe('result validation', () => {
    it('result always startsWith(basePath)')
    it('result never escapes basePath')
    it('case-insensitive check for ".."')
  })
})
```

---

## Phase 4E — Financial Calculation Tests
**File**: `tests/stats.test.ts`
**Effort**: 2 hours
**Gate**: All edge cases tested, word conversion validated

### Test Suite 11: calcNetTotalPerCurrency()
```ts
describe('calcNetTotalPerCurrency', () => {
  it('income (expense_type=income) → positive contribution')
  it('expense (expense_type=expense) → negative contribution')
  it('transfer (expense_type=transfer) → no contribution (net zero)')
  
  it('groups by currency code correctly')
  it('returns separate entry for each currency')
  it('uses convertedTotal when exchange_rate is set')
  it('uses total when convertedTotal is null')
  
  it('handles null total gracefully (skips row)')
  it('handles missing currency code → returns without grouping')
  
  it('golden: 10 income ₹100 + 5 expense ₹50 = ₹750 net')
  it('golden: mixed currencies produce separate entries')
})
```

### Test Suite 12: numberToIndianWords()
```ts
describe('numberToIndianWords', () => {
  describe('unit place', () => {
    it('0 → "Zero"')
    it('1 → "One"')
    it('9 → "Nine"')
  })
  
  describe('tens', () => {
    it('10 → "Ten"')
    it('11 → "Eleven"')
    it('20 → "Twenty"')
    it('99 → "Ninety-Nine"')
  })
  
  describe('hundreds', () => {
    it('100 → "One Hundred"')
    it('101 → "One Hundred and One"')
    it('999 → "Nine Hundred and Ninety-Nine"')
  })
  
  describe('thousands (K)', () => {
    it('1000 → "One Thousand"')
    it('10000 → "Ten Thousand"')
    it('99999 → "Ninety-Nine Thousand Nine Hundred and Ninety-Nine"')
  })
  
  describe('lakhs (L)', () => {
    it('100000 → "One Lakh"')
    it('1000000 → "Ten Lakhs"')
    it('9999999 → "Ninety-Nine Lakhs Ninety-Nine Thousand..."')
  })
  
  describe('crores (C)', () => {
    it('10000000 → "One Crore"')
    it('100000000 → "Ten Crores"')
    it('999999999 → "Ninety-Nine Crores..."')
    it('1000000000 → "One Billion (or "One Crore Lakh")"') // Note: clarify scope
  })
  
  describe('negative numbers', () => {
    it('-1 → "Minus One"')
    it('-100 → "Minus One Hundred"')
    it('-12345 → "Minus Twelve Thousand Three Hundred and Forty-Five"')
  })
  
  describe('edge cases', () => {
    it('2525600 (minutes in a year) → correct words')
    it('999999999 → correct words (matches Indian numbering)')
  })
})
```

### Test Suite 13: amountToIndianWords()
```ts
describe('amountToIndianWords', () => {
  it('100.00 INR → "Rupees One Hundred Only"')
  it('100.50 INR → "Rupees One Hundred and Fifty Paise Only"')
  it('0.75 INR → "Rupees Zero and Seventy-Five Paise Only"')
  it('1234.56 INR → "Rupees One Thousand Two Hundred and Thirty-Four and Fifty-Six Paise Only"')
  
  it('null amount → "Rupees Zero Only"')
  it('negative amounts → prefix with "Minus"')
  it('paise without rupees (0.01) → "Rupees Zero and One Paise Only"')
})
```

---

## Phase 4F — CSV Export Sanitization & Functional Tests
**File**: `tests/export.test.ts`
**Effort**: 2 hours
**Gate**: Formula injection blocked; CSV shape correct; ZIP functional (NOT performance — Phase 5 adds load testing)
**Note**: The "large export" test here is a sanity check that export completes, not a performance benchmark. Phase 5 will add actual performance assertions.

### Test Suite 14: sanitizeCSVValue()
```ts
describe('sanitizeCSVValue', () => {
  describe('formula injection prevention', () => {
    it('= formula: "=1+1" → "\'=1+1"')
    it('+ formula: "+1+1" → "\'+1+1"')
    it('- formula: "-1+1" → "\'-1+1"')
    it('@ formula: "@USER()" → "\'@USER()"')
  })
  
  describe('safe values pass through', () => {
    it('plain text: "hello" → "hello"')
    it('quoted text: "\\"quote\\"" → unchanged')
    it('number: "123" → "123"')
    it('decimal: "123.45" → "123.45"')
    it('null → null')
    it('undefined → undefined')
  })
  
  describe('edge cases', () => {
    it('space prefix before formula: " =formula" → unchanged (safe)')
    it('formula in middle of text: "net=1+1" → unchanged (no injection)')
    it('already quoted: "\'=formula" → returned as-is')
  })
})
```

### Test Suite 15: generateTransactionCSV()
```ts
describe('generateTransactionCSV', () => {
  it('CSV header row matches column order')
  it('data rows correctly quoted and escaped')
  it('each row contains all columns (no ragged rows)')
  it('totals row at end (if applicable)')
  it('snapshot test: 10 sample transactions produce expected CSV')
})
```

### Test Suite 16: ZIP Export Structure
```ts
describe('generateExportZIP', () => {
  it('creates valid ZIP file')
  it('contains transactions.csv')
  it('contains warnings_summary.txt (if totalWarnings > 0)')
  it('contains file attachments in /files/ subdirectory with original filenames')
  it('ZIP is readable and extractable via standard tools')
  it('sanity: large export (100 txns with files) completes without error') // Functional check only
})
```

---

## Phase 4G — Settings Encryption Integration Test (Optional: Depends on Phase 2A)
**File**: `tests/settings.test.ts`
**Effort**: 1 hour
**Gate**: Sensitive data never plaintext in DB
**Dependency**: Phase 2A (bank details migration) must be complete for this test to apply. If Phase 2A hasn't shipped, **skip this test** and add it as a separate Phase 2 verification step.

### Test Suite 17: updateSettings / getSettings encryption
```ts
describe('settings encryption round-trip', () => {
  it('sensitive setting code "openai_api_key" stores encrypted value (enc: prefix)')
  it('non-sensitive code "timezone" stores plaintext')
  
  it('read encrypted setting → decrypted value matches original')
  it('read non-sensitive setting → returns plaintext')
  
  it('update encrypted setting with new value → re-encrypted')
  it('wrong ENCRYPTION_KEY → decryption fails with clear error')
  
  it('getSettings(code) for missing code → returns null')
  it('updateSettings overwrite: new value replaces old')
  
  describe('sensitive field list', () => {
    it('openai_api_key is sensitive')
    it('google_api_key is sensitive')
    it('mistral_api_key is sensitive')
    it('openrouter_api_key is sensitive')
    it('agent_api_key is sensitive')
    it('business_bank_details is sensitive (post-Phase 2A)')
    it('timezone is NOT sensitive')
  })
})
```

---

## Acceptance Criteria

| Check | How to verify |
|-------|---------------|
| GSTR-1 classification paths | All `it()` specs in 4A pass; 100% code path coverage in `classifyTransaction` |
| GSTR-1 aggregation | All grouping and sum tests pass; floating point = exact match |
| GSTR-1 JSON schema | Snapshot matches; no portal-invalid fields; state codes are 2-digit |
| GSTR-3B table computation | Table 3.1(a) = sum of taxableAmount (not total); table 3.1(e) detects all non-GST variants |
| Path traversal blocked | All 8 traversal vectors throw; `safePathJoin` result always inside basePath |
| CSV sanitization | Formula injection attempts all prefixed with '; financial conversions exact |
| Encryption round-trip | Sensitive values never plaintext in DB; decryption works; wrong key fails gracefully |
| Test coverage | `pnpm test --coverage` shows 80%+ coverage on `lib/`, `models/`, `app/api/` business logic — **pending due to missing `@vitest/coverage-v8`** |
| All tests pass | `pnpm test` → 0 failures, all new suites run (32 tests passing) |
| TypeScript clean | `pnpm tsc --noEmit` → zero errors in test files |

---

## Files to Create/Modify

| File | Action | Effort |
|------|--------|--------|
| `tests/gstr1.test.ts` | Create | 2 hours |
| `tests/gstr1-json.test.ts` | Create | 1.5 hours |
| `tests/gstr3b.test.ts` | Create | 2.5 hours |
| `tests/files.test.ts` | Create | 1 hour |
| `tests/stats.test.ts` | Create | 2 hours |
| `tests/export.test.ts` | Create | 1.5 hours |
| `tests/settings.test.ts` | Create | 1 hour |
| `tests/fixtures/transactions.fixture.ts` | Create | 1 hour (shared) |
| `tests/__snapshots__/gstr1-json.test.ts.snap` | Auto-generated | (by Vitest) |
| `tests/__snapshots__/gstr3b.test.ts.snap` | Auto-generated | (by Vitest) |
| `tests/__snapshots__/export-csv.test.ts.snap` | Auto-generated | (by Vitest) |
| `vitest.config.ts` | Verify | Already in place |

**Total effort**: ~12 hours focused work (optimized prioritization)

---

## Execution Sequence

### Prerequisites
1. Phase 3 (GSTR reporting core) must be fully complete and passing (`pnpm test` green before starting Phase 4)
2. Fixtures file created: `tests/fixtures/transactions.fixture.ts`

### Test Order (Parallelizable)

**Batch 1 — BLOCKER tests (must have first)**:
- 4A + 4B: GSTR-1 classification, aggregation, JSON (3.5h) — all parallel
- 4D: Path traversal (1h) — independent
- 4F: CSV sanitization (2h) — independent

**Batch 2 — STRONG tests (runs after Batch 1 passes)**:
- 4C: GSTR-3B tables (2.5h) — independent
- 4E: Stats/word conversion (2h) — independent

**Batch 3 — INTEGRATION (optional, if Phase 2A complete)**:
- 4G: Encryption round-trip (1h) — only if Phase 2A done

**Final**:
- `pnpm test --coverage` to verify 80%+ overall, individual file targets met
- `pnpm tsc --noEmit` to confirm no type errors

### Snapshot Generation (Automatic)
On first run of each snapshot test, Vitest auto-generates `.snap` files. **These are auto-committed and intentional.** Do NOT edit `.snap` files manually. If snapshots look wrong:
1. Fix the source code
2. Re-run tests
3. Let Vitest update snapshots automatically

If you need to force regenerate: `pnpm test -- -u` (use sparingly, only after intentional code changes)

---

## Phase 4 Gate ✓ — Acceptance Criteria

### Mandatory Checks (BLOCKER tests)
- [x] `pnpm test` — all tests pass (ZERO failures) via `pnpm exec vitest run ...` for Phase 4 suites
- [x] **GSTR-1 classification** (`tests/gstr1.test.ts`):
  - 100% function branch coverage in `classifyTransaction()`
  - All 11 sections routed correctly (b2b, b2cl, b2cs, nil, exempt, cdnr, cdnur, at, atadj, exp, skip)
  - Warnings generated for missing required fields
- [ ] **GSTR-1 JSON** (`tests/gstr1-json.test.ts`):
  - JSON contains exactly: gstin, fp, b2b, b2cl, b2cs, cdnr, cdnur, at, atadj, hsn, nil (no extra fields)
  - Nil section has exactly 4 entries: INTRB2B, INTRAB2B, INTRB2C, INTRAB2C
  - State codes are 2-digit, never blank (`"pos": ""` never appears)
  - Snapshot generated and verified
- [ ] **Path traversal** (`tests/files.test.ts`):
  - All 8 attack vectors (../, ..\.., URL-encode, null byte, etc.) **THROW** as expected
  - `safePathJoin()` result always starts with `basePath` (sandbox verified)
- [ ] **CSV sanitization** (`tests/export.test.ts`):
  - Formula injection (=, +, -, @) all prefixed with single quote
  - CSV is never evaluable by Excel/Sheets

### Coverage Requirements (per file)
| File | Minimum | Rationale |
|------|---------|----------|
| `lib/gstr1.ts` | 100% | Classification is tax-critical; every path must be tested |
| `lib/gstr3b.ts` | 95% | Table computation; only skip edge case branches |
| `lib/files.ts` | 100% | Path traversal is security-critical |
| `lib/stats.ts` | 90% | Math functions; goal is precision |
| `lib/export.ts` | 85% | Integration heavy; CSV export path verified |
| **Overall** | **80%** | — |

### Type Safety
- [x] `pnpm tsc --noEmit` — zero errors
- [x] All test files are strictly typed (no `any` except in fixtures)

### Snapshot Verification
- [ ] `tests/__snapshots__/gstr1-json.test.ts.snap` generated and 4 nil entries present
- [ ] `tests/__snapshots__/gstr3b.test.ts.snap` generated and table structure correct
- [ ] No manual edits to `.snap` files (regenerate via `pnpm test -- -u` if needed)

### Optional (if Phase 2A complete)
- [ ] **Encryption round-trip** (`tests/settings.test.ts`):
  - Sensitive values always stored with `enc:` prefix in DB
  - Decryption restores exact original value
  - Wrong `ENCRYPTION_KEY` fails gracefully

### Commit Message
```
test: Phase 4 — comprehensive GSTR/stats/export test suite with 80%+ coverage

- GSTR-1: 100% classification paths, aggregation math, JSON portal-compliance
- GSTR-3B: Full table computation (3.1, 4, 6), ITC rules, RCM handling
- Security: Path traversal blocked (8 vectors), CSV injection prevented (=, +, -, @)
- Stats: Word conversion (crores/lakhs), currency grouping, rounding
- Export: CSV/ZIP functional, large export sanity check
- Coverage: 80%+ business logic, specific files at 90-100%
```

---

## What Comes Next (Phase 5)

After Phase 4 is complete and all tests are green, Phase 5 (Performance) begins:
- Eliminate N+1 queries in export
- Stream large ZIP files to avoid OOM
- Incremental storage tracking (no directory walk per operation)
- LLM request timeout enforcement
- Pagination default reduction (50 items per page)

**Phase 5 is protected by Phase 4 tests** — any regression will be caught immediately.

