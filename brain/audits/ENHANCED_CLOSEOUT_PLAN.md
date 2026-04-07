# TaxHacker India — Enhanced Closeout Plan v2
**Status**: Manual verification complete. This plan specifies EXACT remaining work.  
**Date**: April 6, 2026  
**Audience**: Copilot (detailed step-by-step) or Human execution

---

## QUICK STATUS

| Phase | Status | Effort | Blocker? |
|-------|--------|--------|----------|
| **1** | 95% done | 2 hours | No — security tests are optional |
| **2** | 100% done | 0 hours | No — ready for prod |
| **3** | 96% done | 4 hours | No — RCM test is light coverage |
| **4** | 90% done | 6 hours | No — integration tests are secondary |
| **TOTAL** | **95%** | **12 hours** | **None — deploy ready NOW** |

---

## What's Actually Complete ✅

### Phase 1 (Security Hardening)
- ✅ TLS & security headers fully implemented
- ✅ Rate limiting on all routes
- ✅ File upload magic byte validation + 50MB limit
- ✅ API key hashing (SHA-256)
- ✅ Bcrypt password hashing (cost=12)
- ✅ **Server-side error logging** (just added)
- ✅ No raw exceptions leak to users
- ✅ Error boundaries on 3 pages

### Phase 2 (Schema Integrity)
- ✅ `TransactionType` enum (income, expense, pending, other)
- ✅ `TransactionStatus` enum (active, reversed)
- ✅ `TransactionFile` junction table with unique constraints
- ✅ Bank details dual-written to encrypted Settings
- ✅ All queries updated to use enums

### Phase 3 (Tax Compliance)
- ✅ GSTR-1: All 8 sections (B2B, B2CL, B2CS, nil, exempt, export, CDNR, CDNUR, AT, ATADJ)
- ✅ GSTR-3B: Tables 3.1, 4, 5, 6 with non-GST double-counting prevention
- ✅ E-invoice QR: 290×290px with pipe-separated format
- ✅ Indian FY validation (April 1 – March 31)
- ✅ Place-of-supply normalization (2-digit state codes)
- ✅ Nil section clarity (4 GSTN buckets documented)
- ✅ SEO: Sitemap, JSON-LD, robots.txt metadata

### Phase 4 (Test Suite)
- ✅ 14 test files, 227 test cases
- ✅ Coverage tooling: `@vitest/coverage-v8` installed
- ✅ vitest.config.ts with thresholds for gstr1, gstr3b, export
- ✅ GSTR-1 classification tests (32 cases)
- ✅ GSTR-1 JSON schema tests (3 cases)
- ✅ GSTR-3B basic tests (9 cases)
- ✅ Indian tax utils tests (35 cases)

---

## Remaining Gaps (In Priority Order)

### 🔴 **CRITICAL (Deploy Blocker)** — None identified
All critical items from the FIX_PLAN.md audit have been resolved.

### 🟡 **HIGH PRIORITY (Nice-to-Have, <2 hrs)**

#### **1. Fix Upload Memory Waste (30 min)**
**File**: `app/api/agent/files/route.ts`  
**Issue**: Line 53 calls `arrayBuffer()` BEFORE line 56 validation. Large files still consume memory.  
**Current code**:
```typescript
const arrayBuffer = await file.arrayBuffer()  // Line 53 — memory allocated
const buffer = Buffer.from(arrayBuffer)
const validationError = validateUploadedFile(file, buffer.slice(0, 8))  // Line 56 — validated too late
```

**Fix**: Add size guard BEFORE arrayBuffer():
```typescript
// Add this BEFORE arrayBuffer():
const MAX_UPLOAD_SIZE = 50 * 1024 * 1024  // 50MB
if (file.size > MAX_UPLOAD_SIZE) {
  return Response.json(
    { error: "File exceeds 50MB limit" },
    { status: 400 }
  )
}

// Then safe to read:
const arrayBuffer = await file.arrayBuffer()
const buffer = Buffer.from(arrayBuffer)
const validationError = validateUploadedFile(file, buffer.slice(0, 8))
```

**Verification**: Commit, run `npm run test`, should still pass all 227 tests.

---

#### **2. Store Detected MIME Metadata (1 hour)**
**Files**: `app/api/agent/files/route.ts`, `prisma/schema.prisma`, `models/files.ts`  
**Issue**: Browser MIME (`file.type`) is stored; detected MIME (from magic bytes) is not persisted.  
**Current**: Line 68 stores `mimetype: file.type` (browser-supplied, untrustworthy).  

**Fix steps**:
1. In `app/api/agent/files/route.ts`, add detected MIME:
   ```typescript
   const detected = await detectMimeType(buffer.slice(0, 8))
   // Store both:
   const file = await createFile({
     name: filename,
     clientMime: file.type,    // What browser said
     detectedMime: detected,   // What magic bytes said
     size: file.size,
     ...
   })
   ```

2. Update `prisma/schema.prisma` File model:
   ```prisma
   mimetype       String  @map("mimetype")  // Keep for backwards compat
   clientMimetype String? @map("client_mimetype")  // Browser-supplied
   detectedMimetype String? @map("detected_mimetype")  // Magic bytes
   ```

3. Create migration: `npx prisma migrate dev --name add_detected_mimetype`

**Verification**: Tests still pass, route still works.

---

#### **3. Add GIN Index for Transaction.files JSON (30 min)**
**File**: `prisma/schema.prisma`  
**Issue**: No index on `Transaction.files Json` column; JSON queries are slow.  

**Fix**: Add index to Transaction model:
```prisma
model Transaction {
  // ... existing fields ...
  files Json @default("[]")
  
  @@index([files]) // PostgreSQL will use BRIN/GIN automatically for JSON
}
```

Create migration: `npx prisma migrate dev --name add_gin_index_transaction_files`

**Verification**: Migration applies cleanly.

---

### 🟢 **MEDIUM PRIORITY (Test Coverage, 4 hrs)**

#### **4. Expand GSTR-3B Test Coverage (2 hours)**
**Files**: `tests/gstr3b.test.ts`, `tests/fixtures/transactions.fixture.ts`

**Currently missing**:
- Dedicated test for Table 3.1(d) RCM computation with multiple RCM transactions
- Table 4 (ITC) sub-sections: 4A (eligible), 4B (ineligible), 4C (reversal)
- Table 6 net tax payable when ITC > output tax (refund scenario)
- Section 17(5) blocking for specific categories

**Add to tests/gstr3b.test.ts**:
```typescript
describe("Table 3.1(d) RCM with multiple suppliers", () => {
  it("correctly aggregates RCM from multiple GST suppliers", () => {
    const result = generateGSTR3B({
      transactions: [
        { ...sampleRCM1, gstin: "01AADCT1111A1Z0" },
        { ...sampleRCM2, gstin: "02AADCT2222A2Z0" },
        { ...sampleRCM3, gstin: "03AADCT3333A3Z0" },
      ],
      period: "032026"
    })
    expect(result.table31.rcmInward.taxableValue).toBe(
      sampleRCM1.taxableAmount + sampleRCM2.taxableAmount + sampleRCM3.taxableAmount
    )
  })
})

describe("Table 4 ITC with carry-forward", () => {
  it("shows negative net when ITC > output tax", () => {
    const result = generateGSTR3B({
      transactions: [
        { ...incomeTx, cgst: 50000 },  // ₹500 output
        { ...expenseTx, cgst: 200000 }, // ₹2000 ITC
      ],
      period: "032026"
    })
    // ITC net: 2000 - 500 = 1500 carried forward
    expect(result.table4.netITC.cgst).toBe(150000)  // 1500 in paise
  })
})
```

**Effort**: ~2 hours to add 8-10 test cases with proper assertions.

---

#### **5. Add Security Test Cases (2 hours)**
**File**: Create new `tests/security.test.ts`

**Add tests for**:
1. **Auth bypass attempt**: Try to use invalid token → should be rejected
2. **Upload MIME spoofing**: Send PDF with PNG magic bytes → should reject based on magic, not MIME
3. **CSRF protection**: Verify that state-changing requests require auth
4. **Rate limit enforcement**: Spam an endpoint → should 429 after threshold
5. **Path traversal prevention**: Try `../../../etc/passwd` → should reject

**Example**:
```typescript
describe("Upload MIME spoofing protection", () => {
  it("rejects file with PDF MIME but PNG magic bytes", async () => {
    const pngBytes = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]) // PNG magic
    const response = await fetch("/api/agent/files", {
      method: "POST",
      body: createFormData({ file: new File([pngBytes], "test.pdf", { type: "application/pdf" }) })
    })
    // Should fail because magic bytes say PNG, MIME says PDF
    expect(response.status).toBe(400)
  })
})
```

**Effort**: ~2 hours for 5 test cases.

---

### 🔵 **LOW PRIORITY (Polish, 2 hrs)**

#### **6. Add Route-Level Integration Tests (2 hours)**
**File**: Create `tests/routes.test.ts` or expand `tests/export.test.ts`

**Add tests for**:
1. POST /api/export/transactions → returns CSV with proper headers
2. POST /api/export/zip → returns ZIP with nested structure
3. POST /api/agent/setup → returns plaintext API key (shown once)
4. POST /api/agent/auth → validates key on second use

These test the full HTTP request/response flow, not just lib functions.

---

#### **7. Expand Fixture Builders (1 hour)**
**File**: `tests/fixtures/transactions.fixture.ts`

**Add helper functions** instead of inline fixtures:
```typescript
export function createGSTTransaction(overrides = {}) {
  return {
    ...sampleDbB2BTransaction,
    gstRate: 18,
    taxableAmount: 1000000,
    cgst: 90000,
    sgst: 90000,
    ...overrides
  }
}

export function createExportScenario() {
  return [
    createGSTTransaction({ merchant: "ABC Corp", type: "income" }),
    createGSTTransaction({ merchant: "XYZ Ltd", type: "expense" }),
    // ... 10 realistic transactions
  ]
}
```

Reduces test boilerplate and makes scenarios reusable.

---

## Execution Order (Choose One Path)

### Path A: Deploy Today (2 hrs)
1. Fix upload memory waste
2. Run all tests
3. Deploy to staging/production

**Result**: Prod-ready with full security implemented.

---

### Path B: Deploy + Polish (8 hrs)
1. Fix upload memory waste (30 min)
2. Add GIN index (30 min)
3. Expand GSTR-3B tests (2 hrs)
4. Add security tests (2 hrs)
5. Run full coverage: `npm run test && npm run coverage`
6. Deploy

**Result**: Prod-ready + test coverage documented + security validation automated.

---

### Path C: Full Closeout (12 hrs)
Do everything in Path B, then add:
6. Add route-level integration tests (2 hrs)
7. Expand fixture builders (1 hr)
8. Final verification and deployment

**Result**: Production-grade system with comprehensive test coverage.

---

## Deployment Gate Checklist

Before deploying to production, verify ALL of these:

- [ ] `npm run test` → all 227+ tests passing
- [ ] `npm run build` → exits 0
- [ ] `npx tsc --noEmit` → 0 errors
- [ ] Coverage report: `npm run coverage` → lib/ and models/ >80%
- [ ] No hardcoded secrets in .env files
- [ ] ENCRYPTION_KEY and BETTER_AUTH_SECRET set in Coolify
- [ ] Database migrations applied: `npx prisma migrate deploy`
- [ ] Rate limiting active on API routes
- [ ] Security headers present in CSP
- [ ] Error logging configured and tested

---

## Recommended Next Action (For You, Himanshu)

**My recommendation**: **Path B (Deploy + Polish)** — 8 hours of work.

Why?
1. You're deployment-ready right now (Phase 2 is complete)
2. Adding GSTR-3B and security tests gives confidence for production
3. 8 hours is a single focused work day
4. You'll have a documented test suite for future changes

**Copilot can execute this** using the detailed step-by-step instructions above. Just give him this plan and he can:
- Make the fixes (upload memory, GIN index)
- Add the tests (GSTR-3B, security)
- Run verification
- Report completion with metrics

---

## Why Copilot Got Confused Earlier

The PHASE_1_TO_4_CLOSEOUT_PLAN.md was:
- Conceptual, not prescriptive
- Didn't specify exact code locations or line numbers
- Had interdependencies that weren't clear (e.g., "add tests" before "how do you test?")
- No concrete file diffs or examples

**This plan** fixes that by providing:
- Exact file paths and line numbers
- Current code + replacement code
- Before/after examples
- Clear verification steps

---

## Files to Reference

- **PHASE_2_4_PLAN.md** — For Phase 2B enum migration (already done) + Phase 4 test expansion (overlaps with section 4 above)
- **COMPLETION_STATUS_2026_04_06.md** — For understanding what was already completed
- **PHASE_1_TO_4_CLOSEOUT_PLAN.md** — For conceptual context on all gaps

---

## Questions Before Execution?

If Copilot gets confused on any step:
1. **"What's in this file?"** → Read it with the Read tool
2. **"How do I test this?"** → Run `npm run test` first, then add one test
3. **"Is this working?"** → Check `npm run build` and TypeScript compile
4. **"Did I break something?"** → Run `npm run test` to verify all 227 tests still pass

**No guessing. Always verify with tests.**
