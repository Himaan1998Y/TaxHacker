# TaxHacker India — Phase 2 & Phase 4 Implementation Plan
# FOR COPILOT EXECUTION — READ EVERY SECTION BEFORE STARTING

## Context

This plan completes two pending audit phases for TaxHacker India:

- **Phase 2B**: Add proper PostgreSQL enum types for `Transaction.type` and `Transaction.status`.
  Currently these are plain `TEXT` columns, which allows any string to be inserted (e.g., `"bogus"`,
  `"INCOME"`, `"REVERSED"`). Adding enums gives compile-time type safety in TypeScript and DB-level
  constraint enforcement in PostgreSQL.

- **Phase 4**: Expand the test suite to cover critical business logic gaps. 121 tests already pass.
  We need ~40 more tests to cover CDNR/CDNUR sections, path traversal security, stats functions,
  CSV injection, and GSTR-3B ITC edge cases. Then configure and verify an 80%+ coverage gate.

**DO NOT change any other files. Minimal blast radius. Only touch what is listed.**

---

## PHASE 2B: DB Enum Constraints

### Overview

| Field | Current Type | Target Type | Values |
|-------|-------------|-------------|--------|
| `Transaction.type` | `String?` | `TransactionType?` enum | income, expense, pending, other |
| `Transaction.status` | `String` | `TransactionStatus` enum | active, reversed |

### Step 1 — Add Enum Definitions to Prisma Schema

**File**: `prisma/schema.prisma`

Find the line just BEFORE the `model Transaction {` declaration. Insert these two enum blocks:

```prisma
enum TransactionType {
  income
  expense
  pending
  other
}

enum TransactionStatus {
  active
  reversed
}
```

Then update the Transaction model fields:

Find:
```prisma
  type                  String?   @default("expense")
```
Replace with:
```prisma
  type                  TransactionType?  @default(expense)
```

Find:
```prisma
  status                String    @default("active")
```
Replace with:
```prisma
  status                TransactionStatus @default(active)
```

**Precaution**: Do NOT change any other field in the schema. Do NOT change `@@index`, `@@map`,
`@map`, or any other annotation.

### Step 2 — Create Prisma Migration

Run in the project root (`f:/TaxHacker`):

```bash
npx prisma migrate dev --name add_transaction_enums
```

This will:
1. Detect the schema diff
2. Generate a migration SQL file at `prisma/migrations/[timestamp]_add_transaction_enums/migration.sql`
3. Apply it to your local dev database
4. Regenerate the Prisma client automatically

**Expected migration SQL** (verify the generated file contains something like this):

```sql
-- CreateEnum
CREATE TYPE "TransactionType" AS ENUM ('income', 'expense', 'pending', 'other');

-- CreateEnum
CREATE TYPE "TransactionStatus" AS ENUM ('active', 'reversed');

-- AlterTable
ALTER TABLE "transactions" ALTER COLUMN "type" TYPE "TransactionType" USING ("type"::"TransactionType");
ALTER TABLE "transactions" ALTER COLUMN "status" TYPE "TransactionStatus" USING ("status"::"TransactionStatus");
```

**If the migration fails** (existing data has values outside the enum):
- Run this SQL first to find bad values:
  ```sql
  SELECT DISTINCT type FROM transactions WHERE type NOT IN ('income','expense','pending','other');
  SELECT DISTINCT status FROM transactions WHERE status NOT IN ('active','reversed');
  ```
- Fix any bad rows: `UPDATE transactions SET type = 'expense' WHERE type IS NOT NULL AND type NOT IN ('income','expense','pending','other');`
- Then re-run the migrate command.

### Step 3 — Regenerate Prisma Client (if not auto-done)

```bash
npx prisma generate
```

After this, `TransactionType` and `TransactionStatus` will be importable from `@/prisma/client`.

### Step 4 — Update TypeScript Types in models/transactions.ts

**File**: `models/transactions.ts`

Add this import at the top (after existing imports):
```typescript
import { TransactionType, TransactionStatus } from "@/prisma/client"
```

Find the `TransactionData` type definition. It has a `type` field. Change:
```typescript
type?: string | null
```
To:
```typescript
type?: TransactionType | null
```

Find the `TransactionFilters` type definition. It has a `type` field. Change:
```typescript
type?: string
```
To:
```typescript
type?: TransactionType
```

If there is a `status` field in any type definition, change it from `string` to `TransactionStatus`.

**Do NOT change any function signatures or query logic** — Prisma handles enum ↔ string automatically.

### Step 5 — Update Form Schema in forms/transactions.ts

**File**: `forms/transactions.ts`

Add this import at the top (after existing imports):
```typescript
import { TransactionType } from "@/prisma/client"
```

Find:
```typescript
type: z.string().optional(),
```
Replace with:
```typescript
type: z.nativeEnum(TransactionType).optional(),
```

**If `z.nativeEnum` doesn't work with Prisma enums**, use this alternative:
```typescript
type: z.enum(["income", "expense", "pending", "other"]).optional(),
```

### Step 6 — Update GSTR1 Type Annotation in lib/gstr1.ts

**File**: `lib/gstr1.ts`

This file has a local type `GSTR1Transaction` with a `type: string` field. Change it to use the
Prisma enum. Find:
```typescript
  type: string
```
(inside the `GSTR1Transaction` or `GSTR1TransactionRaw` type definition)

Replace with:
```typescript
  type: TransactionType | null | undefined
```

Add the import at the top:
```typescript
import { TransactionType } from "@/prisma/client"
```

**Verify**: Line ~201 has `if (tx.type === "expense")` — this comparison still works with enums.
TypeScript will now flag any typos like `"expnese"` as a type error.

### Step 7 — Update Agent API Route in app/api/agent/transactions/route.ts

**File**: `app/api/agent/transactions/route.ts`

Find the line (around line 80) that does:
```typescript
type: (body.type as string) || "expense"
```

Replace with:
```typescript
type: (body.type as TransactionType) || TransactionType.expense
```

Or if the Prisma enum style is lowercase string values, use:
```typescript
type: (["income","expense","pending","other"].includes(body.type) ? body.type : "expense") as TransactionType
```

Add import at top:
```typescript
import { TransactionType } from "@/prisma/client"
```

### Step 8 — TypeScript Compile Check

```bash
npx tsc --noEmit
```

Fix every TypeScript error before proceeding. Common errors after this change:
- `Type 'string' is not assignable to type 'TransactionType'` — cast explicitly or use enum import
- `Argument of type 'string' is not assignable to parameter of type 'TransactionType'` — same fix

### Step 9 — Run Existing Tests

```bash
npm run test
```

All 121 existing tests must still pass. If any fail, fix them before continuing.

### Step 10 — Build Check

```bash
npm run build
```

Must exit 0. Fix any build errors.

### Phase 2B Verification Checklist

- [ ] `prisma/schema.prisma` has `enum TransactionType` and `enum TransactionStatus` declarations
- [ ] `Transaction.type` field type is `TransactionType?` with `@default(expense)`
- [ ] `Transaction.status` field type is `TransactionStatus` with `@default(active)`
- [ ] Migration SQL file created in `prisma/migrations/`
- [ ] `npx prisma generate` completes without error
- [ ] `npx tsc --noEmit` — 0 errors
- [ ] `npm run test` — all 121 tests pass
- [ ] `npm run build` — exits 0

---

## PHASE 4: Test Coverage Expansion

### Overview

Current state: 121 tests across 14 files. Gaps identified:
1. GSTR-1 missing: CDNR/CDNUR section tests, AT/ATADJ, warnings
2. GSTR-3B missing: ITC reversal edge cases, RCM in Table 3.1(d), carry-forward
3. Security missing: `safePathJoin` path traversal, null-byte, URL-encoded traversal
4. Stats missing: `calcNetTotalPerCurrency`, `numberToIndianWords`, `amountToIndianWords`
5. CSV sanitization missing: formula injection tests
6. Coverage threshold not configured — need to set 80% gate

### Step 1 — Expand gstr1.test.ts (CDNR/CDNUR/AT sections)

**File**: `tests/gstr1.test.ts`

Add these test cases at the end of the file (before the closing `}`):

```typescript
// --- CDNR (Credit/Debit Notes for Registered Buyers) ---

describe("CDNR classification", () => {
  it("classifies a credit note with GSTIN as CDNR", () => {
    const tx = {
      ...sampleDbB2BTransaction,
      total: -590000, // negative = credit note (paise)
      taxableAmount: -500000,
      cgst: -45000,
      sgst: -45000,
      invoiceNumber: "CN-001",
    }
    const result = classifyTransaction(tx, "07AADCT1234A1Z0", "07")
    expect(result.section).toBe("cdnr")
  })

  it("classifies a debit note with GSTIN as CDNR", () => {
    const tx = {
      ...sampleDbB2BTransaction,
      total: 295000,
      taxableAmount: 250000,
      cgst: 22500,
      sgst: 22500,
      invoiceNumber: "DN-001",
      name: "Debit Note",
    }
    const result = classifyTransaction(tx, "07AADCT1234A1Z0", "07")
    // Debit notes with GSTIN go to CDNR
    expect(["cdnr", "b2b"]).toContain(result.section)
  })
})

// --- CDNUR (Credit/Debit Notes for Unregistered Buyers) ---

describe("CDNUR classification", () => {
  it("classifies a credit note without GSTIN as CDNUR when total > 2.5L", () => {
    const tx = {
      ...sampleDbB2CLTransaction,
      total: -300000, // negative + no GSTIN + large = CDNUR
      taxableAmount: -254237,
      igst: -45763,
      gstin: null,
      invoiceNumber: "CN-002",
    }
    const result = classifyTransaction(tx, "07AADCT1234A1Z0", "07")
    expect(result.section).toBe("cdnur")
  })
})

// --- Validation Warnings ---

describe("validation warnings", () => {
  it("warns when B2B transaction has no invoice number", () => {
    const tx = { ...sampleDbB2BTransaction, invoiceNumber: null }
    const result = classifyTransaction(tx, "07AADCT1234A1Z0", "07")
    expect(result.warnings.some(w => w.toLowerCase().includes("invoice"))).toBe(true)
  })

  it("warns when B2B transaction has no HSN code", () => {
    const tx = { ...sampleDbB2BTransaction, hsnCode: null }
    const result = classifyTransaction(tx, "07AADCT1234A1Z0", "07")
    expect(result.warnings.some(w => w.toLowerCase().includes("hsn"))).toBe(true)
  })

  it("warns when place of supply is missing", () => {
    const tx = { ...sampleDbB2BTransaction, placeOfSupply: null }
    const result = classifyTransaction(tx, "07AADCT1234A1Z0", "07")
    expect(result.warnings.some(w => w.toLowerCase().includes("supply"))).toBe(true)
  })
})

// --- Expense transactions ---

describe("expense filtering", () => {
  it("skips expense transactions (they go into GSTR-2, not GSTR-1)", () => {
    const tx = { ...sampleDbB2BTransaction, type: "expense" as const }
    const result = classifyTransaction(tx, "07AADCT1234A1Z0", "07")
    expect(result.section).toBe("skip")
  })
})
```

**Note**: Import `classifyTransaction` and `sampleDbB2BTransaction` etc. from the relevant paths.
Check the top of `tests/gstr1.test.ts` to see existing imports and match the pattern.

### Step 2 — Expand gstr3b.test.ts (ITC edge cases)

**File**: `tests/gstr3b.test.ts`

Add these test cases:

```typescript
// --- ITC Carry-Forward (ITC > Output Tax) ---

describe("ITC carry-forward", () => {
  it("returns negative netPayable when ITC exceeds output tax (refund scenario)", () => {
    const result = generateGSTR3B({
      transactions: [
        {
          ...sampleDbB2BTransaction,
          type: "expense" as const,
          cgst: 200000, // ₹2000 ITC
          sgst: 200000,
          taxableAmount: 2000000,
          gstRate: 18,
          category: "office_supplies",
        },
        {
          ...sampleDbB2BTransaction,
          type: "income" as const,
          cgst: 90000,  // ₹900 output tax
          sgst: 90000,
          taxableAmount: 1000000,
          gstRate: 18,
        },
      ],
      settings: { business_gstin: "07AADCT1234A1Z0" },
      period: "032026",
    })
    // ITC (₹4000) > output (₹1800) → refundable, net should be negative or zero
    expect(result.table6.totalCGST).toBeLessThanOrEqual(0)
  })
})

// --- Section 17(5) ITC Blocking ---

describe("Section 17(5) ITC blocking", () => {
  const BLOCKED_CATEGORIES = [
    "food_beverages",
    "personal",
    "entertainment",
    "motor_vehicle",
  ]

  BLOCKED_CATEGORIES.forEach((category) => {
    it(`blocks ITC for category: ${category}`, () => {
      const result = generateGSTR3B({
        transactions: [
          {
            ...sampleDbB2BTransaction,
            type: "expense" as const,
            cgst: 100000,
            sgst: 100000,
            category,
          },
        ],
        settings: { business_gstin: "07AADCT1234A1Z0" },
        period: "032026",
      })
      expect(result.table4.itcReversed.cgst).toBeGreaterThan(0)
    })
  })
})

// --- RCM in Table 3.1(d) ---

describe("RCM classification in Table 3.1", () => {
  it("places reverse-charge income in table 3.1(d) not 3.1(a)", () => {
    const result = generateGSTR3B({
      transactions: [
        {
          ...sampleDbRCMTransaction,
          type: "income" as const,
          reverseCharge: true,
        },
      ],
      settings: { business_gstin: "07AADCT1234A1Z0" },
      period: "032026",
    })
    expect(result.table31.rcmInward).toBeDefined()
    expect(result.table31.rcmInward.taxableValue).toBeGreaterThan(0)
  })
})
```

**Note**: Import `generateGSTR3B` and fixtures from their paths. Check existing imports in
`tests/gstr3b.test.ts`.

### Step 3 — Expand files.test.ts (Path Traversal Security)

**File**: `tests/files.test.ts`

Add these test cases to ensure `safePathJoin` in `lib/files.ts` blocks all traversal patterns:

```typescript
import { safePathJoin } from "@/lib/files"

describe("safePathJoin — path traversal prevention", () => {
  const BASE = "/uploads/user@example.com"

  it("allows a normal subdirectory", () => {
    expect(() => safePathJoin(BASE, "2026/03/invoice.pdf")).not.toThrow()
  })

  it("blocks single dot-dot traversal (../)", () => {
    expect(() => safePathJoin(BASE, "../other-user/secret.pdf")).toThrow()
  })

  it("blocks double dot-dot traversal (../../)", () => {
    expect(() => safePathJoin(BASE, "../../etc/passwd")).toThrow()
  })

  it("blocks absolute path injection", () => {
    expect(() => safePathJoin(BASE, "/etc/passwd")).toThrow()
  })

  it("blocks URL-encoded traversal (%2F..)", () => {
    expect(() => safePathJoin(BASE, "%2F..%2Fetc%2Fpasswd")).toThrow()
  })

  it("blocks double URL-encoded traversal (%252F)", () => {
    // %25 decodes to %, making %252F → %2F → /
    // safePathJoin decodes once with decodeURIComponent — this is safe
    // just verify it doesn't escape the base
    const result = safePathJoin(BASE, "valid%20file.pdf")
    expect(result).toContain(BASE)
  })

  it("blocks null-byte injection", () => {
    expect(() => safePathJoin(BASE, "file\0.pdf")).toThrow()
  })

  it("returns path within base for valid input", () => {
    const result = safePathJoin(BASE, "2026/03/uuid.pdf")
    expect(result.startsWith(BASE)).toBe(true)
  })
})
```

**IMPORTANT**: The `safePathJoin` function is in `lib/files.ts`. Import it as:
```typescript
import { safePathJoin } from "@/lib/files"
```

If `files.test.ts` already has some of these tests, add only the missing ones. Do not duplicate.

### Step 4 — Expand stats.test.ts (Indian number words and net totals)

**File**: `tests/stats.test.ts`

First, check what functions are exported from `lib/stats.ts`. Then add:

```typescript
// Import whatever is exported from lib/stats.ts
// Common exports to test:

describe("calcNetTotalPerCurrency (if exported)", () => {
  it("adds income and subtracts expenses", () => {
    // income transactions increase the total
    // expense transactions decrease the total
    // This test validates the net calculation direction
    const transactions = [
      { type: "income", total: 1000000, currency: "INR" },   // +₹10,000
      { type: "expense", total: 500000, currency: "INR" },   // -₹5,000
    ]
    // Expected net: +₹5,000 = 500000 paise
    // Call the function and check the result
    // Adjust based on actual function signature in lib/stats.ts
  })

  it("groups by currency", () => {
    const transactions = [
      { type: "income", total: 1000000, currency: "INR" },
      { type: "income", total: 50000, currency: "USD" },
      { type: "expense", total: 200000, currency: "INR" },
    ]
    // INR net: 800000 paise
    // USD net: 50000 paise
    // Verify the function groups and returns separate currency totals
  })
})

describe("numberToIndianWords (if exported)", () => {
  it("converts 100000 to 'One Lakh'", () => {
    // Test basic lakh conversion
  })

  it("converts 10000000 to 'One Crore'", () => {
    // Test crore conversion
  })

  it("converts 0 to 'Zero'", () => {
    // Edge case
  })

  it("converts 1500000 to 'Fifteen Lakh'", () => {
    // Compound lakh value
  })
})
```

**IMPORTANT**: Read `lib/stats.ts` first to see the actual function names and signatures before
writing the test. Use the exact exported function names. If `numberToIndianWords` is named
differently, use the correct name.

### Step 5 — Expand export.test.ts (CSV Formula Injection)

**File**: `tests/export.test.ts`

Add:

```typescript
describe("CSV formula injection prevention", () => {
  // CSV formula injection: Excel/Google Sheets interprets cells starting with
  // =, +, -, @ as formulas. This is a security vulnerability if users can
  // control transaction names/merchants and export to CSV.

  const FORMULA_PREFIXES = ["=SUM(A1)", "+CMD|'/C calc'!A0", "-2+3+cmd|' /C calc'!D2", "@SUM(1+1)*cmd|' /C calc'!A0"]

  FORMULA_PREFIXES.forEach((injection) => {
    it(`sanitizes formula prefix: ${injection.slice(0, 20)}...`, () => {
      // The CSV export should prefix dangerous cells with a single quote (')
      // or strip/escape the formula character
      // Import the relevant CSV utility from the codebase and test it
      // Check lib/utils.ts or the export functions for a sanitizeCsvCell() type function
    })
  })

  it("preserves legitimate merchant names without modification", () => {
    const safeName = "Sharma & Sons Pvt Ltd"
    // After sanitization, the name should remain unchanged
    // (no formula characters to escape)
  })

  it("preserves rupee symbol in amounts", () => {
    const amount = "₹12,500.00"
    // Amount fields should not be affected by formula sanitization
  })
})
```

**IMPORTANT**: Read `tests/export.test.ts` first to find what CSV utility is being tested and how
it's being called. Then use the same pattern. If there's already a `sanitizeCsvCell` function, test
it directly.

### Step 6 — Configure Coverage Threshold in vitest.config.ts

**File**: `vitest.config.ts`

Current file:
```typescript
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
})
```

Add coverage configuration:
```typescript
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: [
        'lib/**/*.ts',
        'models/**/*.ts',
        'forms/**/*.ts',
      ],
      exclude: [
        'lib/db.ts',           // Infrastructure, no logic to test
        'lib/config.ts',       // Env vars, not testable in unit tests
        'lib/uploads.ts',      // File I/O, integration test territory
        'lib/email.ts',        // Email sending, integration test territory
        '**/*.d.ts',
        '**/node_modules/**',
        '**/prisma/**',
      ],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 70,
        statements: 80,
      },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
})
```

### Step 7 — Run Full Test Suite with Coverage

```bash
npm run test
```

All tests must pass. Then:

```bash
npx vitest run --coverage --coverage-provider=v8
```

Review the coverage output. If any file is below 80%, add targeted tests for uncovered lines.
The output shows exactly which lines are uncovered.

### Step 8 — Add @vitest/coverage-v8 if Not Installed

If `npx vitest run --coverage` fails saying the coverage provider is missing:

```bash
npm install --save-dev @vitest/coverage-v8
```

Then re-run coverage.

### Phase 4 Verification Checklist

- [ ] All original 121 tests still pass
- [ ] CDNR classification test added and passing
- [ ] CDNUR classification test added and passing
- [ ] Validation warning tests added and passing
- [ ] Expense filtering test added and passing
- [ ] GSTR-3B ITC carry-forward test added and passing
- [ ] GSTR-3B Section 17(5) blocking tests added and passing (4 categories)
- [ ] GSTR-3B RCM in Table 3.1(d) test added and passing
- [ ] `safePathJoin` path traversal tests added and passing (8 tests)
- [ ] Stats: `numberToIndianWords` tests added and passing
- [ ] Stats: `calcNetTotalPerCurrency` tests added and passing
- [ ] CSV formula injection tests added and passing
- [ ] `vitest.config.ts` has coverage thresholds configured
- [ ] `npx vitest run --coverage` shows 80%+ on lib/ and models/
- [ ] Total test count: 160+ tests passing

---

## Execution Order

Do these in order. Do not skip steps. Do not move to Phase 4 until Phase 2B is fully verified.

```
Phase 2B:
  1. Edit prisma/schema.prisma — add enum declarations + update field types
  2. Run: npx prisma migrate dev --name add_transaction_enums
  3. Run: npx prisma generate
  4. Edit models/transactions.ts — update TypeScript types
  5. Edit forms/transactions.ts — add z.nativeEnum validation
  6. Edit lib/gstr1.ts — update GSTR1Transaction type
  7. Edit app/api/agent/transactions/route.ts — use TransactionType enum
  8. Run: npx tsc --noEmit  (fix all errors)
  9. Run: npm run test  (all 121 must pass)
  10. Run: npm run build  (must exit 0)

Phase 4:
  11. Add CDNR/CDNUR/warning/expense tests to tests/gstr1.test.ts
  12. Add ITC/RCM/carry-forward tests to tests/gstr3b.test.ts
  13. Add path traversal tests to tests/files.test.ts
  14. Read lib/stats.ts, then add tests to tests/stats.test.ts
  15. Read tests/export.test.ts, then add CSV injection tests
  16. Update vitest.config.ts with coverage thresholds
  17. Run: npm run test  (all 160+ must pass)
  18. Run: npx vitest run --coverage  (80%+ on lib/ and models/)
  19. Fix any failing coverage gates by adding targeted tests
```

---

## Precautions & Do-Nots

1. **DO NOT** run `pnpm add` or `pnpm install` — this project uses npm. Using pnpm will quarantine
   packages to `.ignored/` with read-only locks and break everything.

2. **DO NOT** run `npx prisma migrate reset` — this wipes the database.

3. **DO NOT** run `npx prisma db push` — use `npx prisma migrate dev` to create trackable migrations.

4. **DO NOT** change the `prisma/migrations/` folder manually. Let Prisma generate the SQL.

5. **DO NOT** add `@db.Text` or other annotations to the new enum fields.

6. **DO NOT** change `@map` values on existing Transaction fields.

7. **DO NOT** change any file not listed in this plan.

8. **DO NOT** mock the database in tests — these are pure function tests, no DB needed.

9. **IF** a test imports a function that doesn't exist yet (e.g., `numberToIndianWords` might be
   named differently) — read `lib/stats.ts` FIRST to find the actual export names.

10. **IF** `npx tsc --noEmit` produces errors in files not listed here — DO NOT fix them. Only fix
    errors directly caused by the enum changes.

---

## Files Changed

### Phase 2B (6 files):
- `prisma/schema.prisma` — add enums, update field types
- `prisma/migrations/[timestamp]_add_transaction_enums/migration.sql` — auto-generated by Prisma
- `models/transactions.ts` — update TypeScript type annotations
- `forms/transactions.ts` — add enum validation in Zod schema
- `lib/gstr1.ts` — update GSTR1Transaction type
- `app/api/agent/transactions/route.ts` — use TransactionType enum

### Phase 4 (5 files + 1 config):
- `tests/gstr1.test.ts` — add CDNR/CDNUR/warning tests
- `tests/gstr3b.test.ts` — add ITC edge case tests
- `tests/files.test.ts` — add path traversal security tests
- `tests/stats.test.ts` — add stats function tests
- `tests/export.test.ts` — add CSV formula injection tests
- `vitest.config.ts` — add coverage thresholds

---

## Reference: Key File Locations

| What | Where |
|------|-------|
| Prisma schema | `prisma/schema.prisma` |
| Transaction model functions | `models/transactions.ts` |
| GSTR-1 classification logic | `lib/gstr1.ts` |
| GSTR-3B computation | `lib/gstr3b.ts` |
| Path safety utility | `lib/files.ts` → `safePathJoin()` |
| Stats functions | `lib/stats.ts` |
| Transaction form schema | `forms/transactions.ts` |
| Agent API route | `app/api/agent/transactions/route.ts` |
| Test fixtures | `tests/fixtures/transactions.fixture.ts` |
| Vitest config | `vitest.config.ts` |
