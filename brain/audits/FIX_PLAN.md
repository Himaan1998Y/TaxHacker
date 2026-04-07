# TaxHacker India — Comprehensive Fix Plan
**Audit date**: 2026-03-31
**Plan version**: 1.0
**Total issues**: 89 (7 Critical, 23 High, 34 Medium, 25 Low)
**Estimated total effort**: ~18–22 days of focused work
**Approach**: Sequential phases, each self-contained and fully testable before moving forward

---

## Guiding Principles for All Fixes

1. **Fix root cause, not symptoms.** No workarounds.
2. **Test as you go.** Every phase has a verification gate.
3. **Never break existing behavior.** Each fix is additive or a drop-in replacement.
4. **One migration at a time.** Never run two schema changes together.
5. **Log everything meaningful.** Every security event, every data migration.
6. **Production-ready means: handles edge cases, has error boundaries, is typed.**
7. **India-first design.** Currency, timezone (IST/UTC), locale always considered.

---

## Phase Overview

| Phase | Name | Issues Fixed | Effort | Gate |
|-------|------|-------------|--------|------|
| **0** | Immediate Safety Net | C1, C2, C7, H2-1 | 30 min | TypeScript compiles, no console.warn in prod |
| **1** | Security Hardening | C3, H1-1 through H1-6 | 2 days | Penetration checklist passes |
| **2** | Architecture: Auth & Schema | C3 (complete), H2-2, H2-3, M2-1, M2-2 | 2 days | All server actions use session auth |
| **3** | Tax Compliance: Core | C4, H3-1 through H3-4 | 3 days | GSTR-1 JSON validates against GSTN schema |
| **4** | Test Suite: Foundation | C5, C6, H7-1 through H7-3, M7-1 through M7-4 | 2 days | 80%+ coverage on business logic |
| **5** | Performance | H4-1 through H4-3, M4-1 through M4-5 | 2 days | Export with 10k txns < 10 seconds |
| **6** | Code Quality | H5-1, M5-1 through M5-6, L5-1 through L5-5 | 1.5 days | TypeScript strict mode zero errors |
| **7** | Compliance: Detail | M3-1 through M3-5, L3-1 through L3-3 | 1.5 days | GSTR-1 portal upload accepted |
| **8** | Frontend / UX | H6-1, H6-2, M6-1 through M6-5, L6-1 through L6-4 | 1 day | Lighthouse accessibility 90+ |
| **9** | Hardening & Polish | All remaining Low items | 1 day | Full test suite green |

---

---

# PHASE 0: Immediate Safety Net
**Time estimate**: 30 minutes
**Must be done before anything else. These are one-liners with massive blast radius if left unfixed.**

---

## Phase 0A — Enforce ENCRYPTION_KEY at startup
**Fixes**: C1 (`lib/encryption.ts`, `lib/config.ts`)
**Why critical**: Without this, all production deployments without ENCRYPTION_KEY store API keys, bank details, PAN in plaintext.

### Changes
**File**: `lib/config.ts` — after line 29 (`const env = envSchema.parse(process.env)`)

```ts
// PRODUCTION SAFETY: Encryption is mandatory for financial data
if (process.env.NODE_ENV === "production") {
  if (!process.env.ENCRYPTION_KEY) {
    throw new Error(
      "[STARTUP ERROR] ENCRYPTION_KEY is required in production. " +
      "Generate with: openssl rand -hex 32"
    )
  }
}
```

**Also**: Change `ENCRYPTION_KEY` in the Zod schema from `.optional()` to:
```ts
ENCRYPTION_KEY: z.string().length(64).optional(), // stays optional for dev
```
Leave optional for dev, but enforce at runtime in production.

### Verification
- `NODE_ENV=production node -e "require('./lib/config')"` without key → should throw
- `NODE_ENV=production ENCRYPTION_KEY=$(openssl rand -hex 32) node -e "require('./lib/config')"` → should succeed
- TypeScript check: `pnpm tsc --noEmit`

### Debugging / Rollback
- If Coolify deployment fails on this check: set `ENCRYPTION_KEY` in Coolify environment variables
- Existing plaintext-stored data: run migration script (Phase 2C) to encrypt existing unencrypted settings

---

## Phase 0B — Enforce BETTER_AUTH_SECRET at startup
**Fixes**: C2 (`lib/config.ts`)

### Changes
**File**: `lib/config.ts` — change lines 31-33:

```ts
// Before (broken):
if (process.env.NODE_ENV === "production" && env.BETTER_AUTH_SECRET === "please-set-your-key-here") {
  console.warn("WARNING: Using default BETTER_AUTH_SECRET...")
}

// After (fixed):
if (process.env.NODE_ENV === "production" && env.BETTER_AUTH_SECRET === "please-set-your-key-here") {
  throw new Error(
    "[STARTUP ERROR] BETTER_AUTH_SECRET must be changed from the default value. " +
    "Generate with: openssl rand -base64 32"
  )
}
```

### Verification
- Same pattern as 0A
- Ensure Coolify has `BETTER_AUTH_SECRET` set

---

## Phase 0C — Remove "use server" from ai/analyze.ts
**Fixes**: C7 (`ai/analyze.ts`)
**Why**: `"use server"` at file level registers ALL exports as browser-callable server actions. `analyzeTransaction(prompt, schema, attachments, fileId, userId)` accepts a user-controlled `userId` — allowing any logged-in user to trigger AI analysis on another user's files.

### Changes
**File**: `ai/analyze.ts` — remove line 1: `"use server"`

The function is imported only by server-side code (API routes, other server actions), so it runs on the server regardless. The directive is only needed for direct browser invocation, which is not desired here.

### Verification
- `pnpm tsc --noEmit` — no type errors
- Test: invoke `analyzeTransaction` from its callers — should work identically
- Negative test: confirm you can NOT call it directly via browser POST to action endpoint

---

## Phase 0D — Fix Prisma query logging in production
**Fixes**: H2-1 (`lib/db.ts`)

### Changes
**File**: `lib/db.ts`:
```ts
// Before:
export const prisma = globalForPrisma.prisma ?? new PrismaClient({ log: ["query", "info", "warn", "error"] })

// After:
const logLevels = process.env.NODE_ENV === "production"
  ? ["warn", "error"] as const
  : ["query", "info", "warn", "error"] as const

export const prisma = globalForPrisma.prisma ?? new PrismaClient({ log: logLevels })
```

### Verification
- Deploy to staging, confirm no SQL queries in stdout logs
- Confirm errors and warnings still appear

---

## Phase 0 Gate ✓
Before moving to Phase 1, verify:
- [ ] `pnpm tsc --noEmit` — zero errors
- [ ] `pnpm build` — builds successfully
- [ ] All 3 config assertions tested in staging
- [ ] Commit: `fix(security): enforce ENCRYPTION_KEY, AUTH_SECRET, disable query logging in prod`

---

---

# PHASE 1: Security Hardening
**Time estimate**: 2 days
**Dependency**: Phase 0 complete

---

## Phase 1A — Fix Server Actions Auth Bypass
**Fixes**: C3 — 12 server actions in `app/(app)/settings/actions.ts`
**This is the biggest auth vulnerability in the app.**

### Root cause
Server Action arguments are serialized and POSTed from the browser. `userId: string` as a parameter = any browser can pass any userId.

### Changes
**File**: `app/(app)/settings/actions.ts`

For each of the 12 affected actions, apply this pattern:

```ts
// BEFORE (vulnerable):
export async function addProjectAction(userId: string, data: Prisma.ProjectCreateInput) {
  const validatedForm = projectFormSchema.safeParse(data)
  // ...
  const project = await createProject(userId, { ... })
}

// AFTER (fixed):
export async function addProjectAction(data: Prisma.ProjectCreateInput) {
  const user = await getCurrentUser()  // session — not from args
  const validatedForm = projectFormSchema.safeParse(data)
  // ...
  const project = await createProject(user.id, { ... })
}
```

**All 12 actions to fix**:
- `addProjectAction(userId, data)` → `addProjectAction(data)`
- `editProjectAction(userId, code, data)` → `editProjectAction(code, data)`
- `deleteProjectAction(userId, code)` → `deleteProjectAction(code)`
- `addCurrencyAction(userId, data)` → `addCurrencyAction(data)`
- `editCurrencyAction(userId, code, data)` → `editCurrencyAction(code, data)`
- `deleteCurrencyAction(userId, code)` → `deleteCurrencyAction(code)`
- `addCategoryAction(userId, data)` → `addCategoryAction(data)`
- `editCategoryAction(userId, code, data)` → `editCategoryAction(code, data)`
- `deleteCategoryAction(userId, code)` → `deleteCategoryAction(code)`
- `addFieldAction(userId, data)` → `addFieldAction(data)`
- `editFieldAction(userId, code, data)` → `editFieldAction(code, data)`
- `deleteFieldAction(userId, code)` → `deleteFieldAction(code)`

**Update all callers**: Search all component files that call these actions and remove the `userId` argument from the call sites.

```bash
# Find all callers:
grep -r "addProjectAction\|editProjectAction\|deleteProjectAction\|addCurrencyAction\|editCurrencyAction\|deleteCurrencyAction\|addCategoryAction\|editCategoryAction\|deleteCategoryAction\|addFieldAction\|editFieldAction\|deleteFieldAction" f:/TaxHacker/components/ f:/TaxHacker/app/
```

### Verification
- TypeScript: all callers updated, no type errors
- Manual test: log in as user A, attempt to call action via browser dev tools with user B's id → 404 or operation on own data only
- Test: normal CRUD operations still work for own data

---

## Phase 1B — Upgrade Self-Hosted Password Hashing to bcrypt
**Fixes**: H1-1 (`lib/self-hosted-auth.ts`)

### Root cause
SHA-256 is a fast hash — attackers can compute billions per second. bcrypt intentionally slow (cost factor).

### Changes

**Install**: `pnpm add bcryptjs && pnpm add -D @types/bcryptjs`

**File**: `lib/self-hosted-auth.ts` — full rewrite:
```ts
import bcrypt from "bcryptjs"

const BCRYPT_ROUNDS = 12

/**
 * Hash a self-hosted password for storage.
 * Returns a bcrypt hash. NOT the old SHA-256 token — migration handled separately.
 */
export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_ROUNDS)
}

/**
 * Verify a password against its bcrypt hash.
 */
export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash)
}

/**
 * Legacy: SHA-256 token for cookie comparison (existing sessions).
 * Kept for backward compatibility during migration.
 * @deprecated Use bcrypt hash stored in DB instead.
 */
export function hashSelfHostedTokenLegacy(password: string, secret: string): string {
  return require("crypto").createHash("sha256").update(password + secret).digest("hex")
}
```

**Migration strategy**:
- Store the bcrypt hash in a new `Settings` record with code `sh_password_hash`
- On login: check bcrypt hash from settings if it exists; fall back to legacy SHA-256 comparison if not (for existing deployments)
- After successful bcrypt login, write bcrypt hash to settings (migration complete)
- After 30 days, remove legacy fallback

**File**: `app/api/self-hosted-auth/route.ts` — update login handler to use bcrypt

**File**: `middleware.ts` — update cookie validation to use bcrypt-validated session token (not the raw SHA-256 hash comparison)

### Verification
- Test: login works with new password on fresh deploy
- Test: login works on existing deploy (migration path)
- Test: wrong password is rejected
- Security test: verify bcrypt hash takes ~100ms (cost=12)

---

## Phase 1C — Add File Size Limit to Agent Uploads
**Fixes**: H1-3 (`app/api/agent/files/route.ts`)

### Changes
**File**: `app/api/agent/files/route.ts` — add after line 43:

```ts
const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024 // 50MB

// Validate file type (existing check)
const allowedPrefixes = ["image/", "application/pdf"]
const isAllowed = allowedPrefixes.some((prefix) => file.type.startsWith(prefix))
if (!isAllowed) {
  return NextResponse.json({ error: `File type '${file.type}' not supported.` }, { status: 400 })
}

// Validate file size — BEFORE reading into memory
if (file.size > MAX_FILE_SIZE_BYTES) {
  return NextResponse.json(
    { error: `File too large. Maximum size is ${MAX_FILE_SIZE_BYTES / 1024 / 1024}MB.` },
    { status: 413 }
  )
}
```

**Also reduce**: `next.config.ts` — `serverActions.bodySizeLimit: "256mb"` → `"50mb"` (M1-1)

### Verification
- Test: upload 1MB file → accepted
- Test: upload 60MB file → 413 rejected
- Test: verify error message is clear

---

## Phase 1D — Validate MIME Type by Magic Bytes
**Fixes**: H1-4 (`app/api/agent/files/route.ts`)

### Root cause
`file.type` is the Content-Type from the multipart form — client-controlled, trivially spoofable.

### Changes
**Install**: `pnpm add file-type`

**File**: `app/api/agent/files/route.ts` — after reading the array buffer:

```ts
import { fileTypeFromBuffer } from "file-type"

// After: const arrayBuffer = await file.arrayBuffer()
const buffer = Buffer.from(arrayBuffer)

// Verify actual content type by magic bytes
const detectedType = await fileTypeFromBuffer(buffer)
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif", "application/pdf"]

if (!detectedType || !ALLOWED_TYPES.includes(detectedType.mime)) {
  return NextResponse.json(
    { error: `File content does not match allowed types. Detected: ${detectedType?.mime ?? "unknown"}` },
    { status: 400 }
  )
}

// Use verified MIME type (not client-supplied)
const verifiedMimeType = detectedType.mime
```

### Verification
- Test: rename `.html` to `.pdf`, upload → rejected (magic bytes mismatch)
- Test: real PDF → accepted
- Test: real JPEG → accepted

---

## Phase 1E — Fix Internal Path Leak in 404
**Fixes**: H1-5 (`app/(app)/files/download/[fileId]/route.ts`)

### Changes
**File**: `app/(app)/files/download/[fileId]/route.ts` — line 28:
```ts
// Before:
return new NextResponse(`File not found on disk: ${file.path}`, { status: 404 })

// After:
console.error(`File missing from disk: ${file.path} (fileId: ${fileId}, userId: ${user.id})`)
return new NextResponse("File not found", { status: 404 })
```

**Same fix in** `app/(app)/files/static/[filename]/route.ts` — find and fix any similar pattern.

### Verification
- Test: request a file whose disk copy was deleted → get "File not found" with no path
- Verify path appears in server logs only

---

## Phase 1F — Add Content-Security-Policy Header
**Fixes**: H1-6 (`next.config.ts`)

### Changes
**File**: `next.config.ts` — add CSP to the headers array:

```ts
{
  key: "Content-Security-Policy",
  value: [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' 'unsafe-eval'",  // unsafe-inline needed for Next.js hydration; tighten after audit
    "style-src 'self' 'unsafe-inline'",  // Tailwind needs unsafe-inline
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    "connect-src 'self' https://generativelanguage.googleapis.com https://api.openai.com https://api.mistral.ai https://openrouter.ai",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
  ].join("; "),
},
```

**Note**: Start with `unsafe-inline` on script/style — these are required by Next.js App Router. Create a tracking issue to tighten with nonces in Phase 9.

### Verification
- Check browser DevTools → Security tab → CSP applied
- Test: inline `<script>alert(1)</script>` injected via transaction name does NOT execute
- Use `https://csp-evaluator.withgoogle.com` to assess strength

---

## Phase 1G — API Key Storage: Hash Before Storing
**Fixes**: H1-2 (`app/api/agent/auth.ts`, `models/settings.ts`)

### Changes

The `agent_api_key` is already going through `updateSettings()` which encrypts `SENSITIVE_SETTINGS`. So the key is already encrypted at rest. The finding was that it's stored in a format that, if decrypted, is immediately usable.

**Enhancement**: When generating the API key, store a SHA-256 hash of the key + compare hashes on auth. The plain key is only shown ONCE to the user at generation time. This way, a database compromise reveals only hashes, not usable keys.

**File**: `app/api/agent/auth.ts` — change comparison logic:
```ts
import { createHash } from "crypto"

function hashApiKey(key: string): string {
  return createHash("sha256").update(key).digest("hex")
}

// When storing a new key:
export function generateAndHashAgentApiKey(): { plainKey: string; hashedKey: string } {
  const plainKey = `thk_${randomBytes(32).toString("hex")}`
  const hashedKey = hashApiKey(plainKey)
  return { plainKey, hashedKey }
}

// When verifying:
const providedHash = hashApiKey(apiKey)
const storedHash = setting.value // stored as hash, not plaintext

// Use timingSafeEqual on hashes (both fixed length)
const storedBuf = Buffer.from(storedHash, "utf8")
const providedBuf = Buffer.from(providedHash, "utf8")
if (storedBuf.length !== providedBuf.length || !crypto.timingSafeEqual(storedBuf, providedBuf)) {
  // ... reject
}
```

**Migration**: Existing stored keys are encrypted plaintext. Add a migration flag: if the stored value starts with `thk_` (after decryption), it's the old format. Re-hash it and store the hash. Show user a one-time warning that they need to re-generate their API key.

### Verification
- Test: generate key → shown once, stored as hash
- Test: use plain key to authenticate → works (hash comparison succeeds)
- Test: database dump shows hashed value, not plaintext key

---

## Phase 1 Gate ✓
- [ ] `pnpm tsc --noEmit` — zero errors
- [ ] All 12 server actions now use `getCurrentUser()`
- [ ] Manual auth bypass test fails
- [ ] bcrypt login works (fresh + migration path)
- [ ] File upload size limit works
- [ ] CSP header visible in browser
- [ ] Commit: `fix(security): server action auth, bcrypt passwords, CSP, file validation`

---

---

# PHASE 2: Architecture Fixes
**Time estimate**: 2 days
**Dependency**: Phase 1 complete

---

## Phase 2A — Move businessBankDetails to Encrypted Settings
**Fixes**: H2-2 (`prisma/schema.prisma`, `models/users.ts`)

### Root cause
Bank account numbers on `User.businessBankDetails` are stored as plain `String` — bypassing the settings encryption layer.

### Changes

**Step 1**: Add migration to move data
```sql
-- Prisma migration
-- Move businessBankDetails to Settings table (where encryption happens)
INSERT INTO settings (id, user_id, code, name, value)
SELECT
  gen_random_uuid()::uuid,
  id,
  'business_bank_details',
  'Business Bank Details',
  "business_bank_details"
FROM users
WHERE "business_bank_details" IS NOT NULL;
```

**Step 2**: Add `business_bank_details` to `SENSITIVE_SETTINGS` in `models/settings.ts`:
```ts
const SENSITIVE_SETTINGS = new Set([
  "openai_api_key", "google_api_key", "mistral_api_key", "openrouter_api_key",
  "agent_api_key", "business_bank_details",  // ← added
])
```

**Step 3**: Remove `businessBankDetails` from Prisma schema (after data migration verified)

**Step 4**: Update all code that reads/writes `user.businessBankDetails` to use `settings.business_bank_details` instead.

**Step 5**: Update `app/(app)/settings/business/page.tsx` and its form to read/write via settings

### Verification
- Existing bank details appear in new settings location
- Bank details are encrypted in DB (value starts with `enc:`)
- Old column removed (schema migration applied)
- Form still works for reading and updating

---

## Phase 2B — Add DB Enum Constraints for type and status
**Fixes**: M2-1 (`prisma/schema.prisma`)

### Changes
**Prisma schema**: Add enums and apply to Transaction model:
```prisma
enum TransactionType {
  income
  expense
  transfer
}

enum TransactionStatus {
  active
  reversed
}

model Transaction {
  // ...
  type   TransactionType?  @default(expense)  // was String?
  status TransactionStatus @default(active)   // was String
}
```

**Migration**: Convert existing string data to enum values:
```sql
-- Validate existing data first
SELECT DISTINCT type FROM transactions;
SELECT DISTINCT status FROM transactions;

-- If clean, run migration:
ALTER TABLE transactions
  ALTER COLUMN type TYPE "TransactionType"
  USING type::"TransactionType";
```

**Code updates**: Update all TS code that compares `transaction.type === "expense"` — TypeScript will now enforce the enum values. Update `TransactionData` type to use the enum. Update `classifyTransaction` in gstr1.ts.

### Verification
- `pnpm prisma generate` succeeds
- `pnpm prisma migrate deploy` succeeds on staging
- TypeScript confirms enum usage at compile time
- Attempt to insert invalid type via Prisma → compile-time error

---

## Phase 2C — Fix File Associations (Junction Table)
**Fixes**: H2-3 (`prisma/schema.prisma`, `models/transactions.ts`)

### Root cause
`files Json @default("[]")` on Transaction has no FK integrity. File IDs in JSON can become orphaned.

### Changes (phased — don't do all at once)

**Step 1**: Add junction table while keeping old JSON column (backward compatible):
```prisma
model TransactionFile {
  id            String      @id @default(uuid()) @db.Uuid
  transactionId String      @map("transaction_id") @db.Uuid
  fileId        String      @map("file_id") @db.Uuid
  transaction   Transaction @relation(fields: [transactionId], references: [id], onDelete: Cascade)
  file          File        @relation(fields: [fileId], references: [id], onDelete: Cascade)
  createdAt     DateTime    @default(now()) @map("created_at")

  @@unique([transactionId, fileId])
  @@index([fileId])
  @@map("transaction_files")
}
```

**Step 2**: Migration script — populate junction table from existing JSON arrays:
```sql
INSERT INTO transaction_files (id, transaction_id, file_id, created_at)
SELECT
  gen_random_uuid()::uuid,
  t.id,
  f.value::uuid,
  NOW()
FROM transactions t,
  jsonb_array_elements_text(t.files::jsonb) AS f(value)
WHERE t.files != '[]'::json
  AND t.files IS NOT NULL
  AND EXISTS (SELECT 1 FROM files WHERE id = f.value::uuid);
```

**Step 3**: Update `getFilesByTransactionId`, `updateTransactionFiles`, etc. to use the junction table

**Step 4**: After validation period (2 weeks), drop the `files` JSON column in a follow-up migration

### Verification
- Old data correctly migrated to junction table
- CRUD operations work: add file to transaction, remove file from transaction
- FK cascade: deleting a transaction removes junction rows
- FK cascade: deleting a file removes junction rows
- Query: find all transactions for a file — now uses a JOIN instead of `array_contains`

---

## Phase 2D — Add GIN Index for files JSON (interim)
**Fixes**: M4-4 — if Phase 2C (junction table) is delayed, add this as a quick win

```prisma
model Transaction {
  // ...
  @@index([files], type: Gin)  // enables efficient array_contains queries
}
```

### Note
This is a stopgap. Phase 2C (junction table) is the correct long-term fix.

---

## Phase 2 Gate ✓
- [ ] All schema migrations applied to staging without data loss
- [ ] Bank details encrypted in DB
- [ ] Transaction type/status are enums — TypeScript enforces
- [ ] File junction table populated from existing data
- [ ] All FK-related queries use joins, not array_contains
- [ ] `pnpm tsc --noEmit` — zero errors
- [ ] Full regression test on transaction CRUD
- [ ] Commit: `fix(architecture): encrypted bank details, enum types, file junction table`

---

---

# PHASE 3: Tax Compliance Fixes
**Time estimate**: 3 days
**Dependency**: Phase 2 complete (enums needed for GSTR classification)

---

## Phase 3A — Fix Taxable Value: Add Dedicated Field to Schema
**Fixes**: H3-3 — taxable value computed by subtraction is fragile

### Root cause
`taxableValue = total - cgst - sgst - igst - cess` works only if total is tax-inclusive. No source-of-truth field.

### Changes

**Prisma schema** — add to Transaction model:
```prisma
model Transaction {
  // existing GST amounts (stored in extra JSON currently) — promote to first-class fields
  gstRate          Float?   @map("gst_rate")
  taxableAmount    Int?     @map("taxable_amount")   // in paise, like total
  cgst             Int?     @map("cgst")             // in paise
  sgst             Int?     @map("sgst")             // in paise
  igst             Int?     @map("igst")             // in paise
  cess             Int?     @map("cess")             // in paise
  invoiceNumber    String?  @map("invoice_number")
  gstin            String?  @map("gstin")
  hsnCode          String?  @map("hsn_code")
  placeOfSupply    String?  @map("place_of_supply")  // 2-digit state code
  supplyType       String?  @map("supply_type")
  reverseCharge    Boolean  @default(false) @map("reverse_charge")
}
```

**Migration**: Backfill new columns from existing `extra` JSON:
```sql
UPDATE transactions
SET
  gst_rate = (extra->>'gst_rate')::float,
  cgst = ((extra->>'cgst')::float * 100)::int,
  sgst = ((extra->>'sgst')::float * 100)::int,
  igst = ((extra->>'igst')::float * 100)::int,
  cess = ((extra->>'cess')::float * 100)::int,
  taxable_amount = (
    CASE WHEN extra->>'taxable_amount' IS NOT NULL
    THEN ((extra->>'taxable_amount')::float * 100)::int
    ELSE total -
      COALESCE(((extra->>'cgst')::float * 100)::int, 0) -
      COALESCE(((extra->>'sgst')::float * 100)::int, 0) -
      COALESCE(((extra->>'igst')::float * 100)::int, 0) -
      COALESCE(((extra->>'cess')::float * 100)::int, 0)
    END
  ),
  invoice_number = extra->>'invoice_number',
  gstin = extra->>'gstin',
  hsn_code = extra->>'hsn_sac_code',
  place_of_supply = extra->>'place_of_supply',
  supply_type = extra->>'supply_type',
  reverse_charge = COALESCE((extra->>'reverse_charge') IN ('yes', 'Yes', 'true'), false)
WHERE extra IS NOT NULL;
```

**Update**: `transactionToGSTR1()` in `lib/gstr1.ts` to use direct fields instead of `extra` lookups.

**Update**: `fieldsToJsonSchema` in `ai/schema.ts` — AI still extracts to `extra` JSON for backward compatibility, but a post-processing step copies known GST fields to dedicated columns.

**Integer arithmetic**: All GSTR computations now use integer paise. Only divide by 100 when rendering.

### Verification
- Migration ran successfully, no NULL violations
- GSTR-1 report produces same output as before (golden test)
- Floating point drift eliminated — test: 1000 transactions of ₹180 CGST = exactly ₹180,000

---

## Phase 3B — Add Missing GSTR-1 Sections: CDNR, CDNUR, AT, ATADJ
**Fixes**: H3-1 (`lib/gstr1.ts`)

### Root cause
GSTN portal requires these sections for a valid GSTR-1. Missing = upload fails.

### Changes

**Add types**:
```ts
export type CDNREntry = {
  gstin: string           // receiver GSTIN
  noteNumber: string      // credit/debit note number
  noteDate: string        // dd/MM/yyyy
  noteType: "C" | "D"     // Credit or Debit
  noteValue: number       // in rupees
  placeOfSupply: string
  reverseCharge: string
  rate: number
  taxableValue: number
  cgst: number; sgst: number; igst: number; cess: number
}

export type CDNUREntry = { /* similar but no GSTIN */ }
export type ATEntry = { /* advance received */ }
```

**Update GSTR1Summary** to include these sections:
```ts
export type GSTR1Summary = {
  b2b: B2BEntry[]
  b2cl: B2CLInvoice[]
  b2cs: B2CSEntry[]
  cdnr: CDNREntry[]    // ← new
  cdnur: CDNUREntry[]  // ← new
  at: ATEntry[]        // ← new
  atadj: ATEntry[]     // ← new
  // ... rest unchanged
}
```

**Classification logic**: Transactions with `supplyType = "credit_note"` or `supplyType = "debit_note"` → route to CDNR (if GSTIN present) or CDNUR.

**`generateGSTR1JSON`**: Add CDNR, CDNUR, AT sections to the JSON output.

**GSTR1Section type**: Add `"cdnr" | "cdnur" | "at"` to the section union type.

### Verification
- Test: classify a credit note transaction → ends up in `cdnr` section
- Test: GSTR-1 JSON contains `cdnr`, `cdnur` keys
- Validate JSON structure against GSTN API spec

---

## Phase 3C — Add GSTR-3B Table 3.1(d) RCM & 3.1(e)
**Fixes**: H3-2 (`lib/gstr3b.ts`)

### Changes
```ts
// In computeTable31():

// ADD: (d) Inward supplies liable to reverse charge
const rcmTransactions = gstr1.classified.filter(t => t.reverseCharge)
const rcmTotals = rcmTransactions.reduce(/* aggregate */)
rows.push({
  description: "(d) Inward supplies (liable to reverse charge)",
  taxableValue: round(rcmTotals.taxableValue),
  igst: round(rcmTotals.igst),
  cgst: round(rcmTotals.cgst),
  sgst: round(rcmTotals.sgst),
  cess: round(rcmTotals.cess),
})

// ADD: (e) Non-GST outward supplies
const nonGSTTransactions = transactions.filter(t => t.type === "income" && t.gstRate === 0 && !isNilOrExempt(t))
```

### Verification
- Test: transaction with `reverseCharge = true` appears in Table 3.1(d)
- Test: GSTR-3B JSON has `inward_sup` section populated

---

## Phase 3D — Fix e-Invoice QR
**Fixes**: C4 (`lib/e-invoice.ts`, `app/(app)/apps/invoices/components/invoice-pdf.tsx`)

### Decision: Relabel (not IRP integration — that requires GSP registration)

**Changes**:
1. Rename `generateEInvoiceQR` → `generateInvoiceReferenceQR`
2. Change QR content to include additional useful fields (payment UPI if set)
3. Update invoice PDF label from "e-Invoice QR" to "Invoice QR (Reference)"
4. Add a tooltip/note on the invoice page: "This QR contains invoice reference data. For IRP-registered e-Invoicing, use a GSP partner."

**Future**: When IRP integration is ready, add `generateIRPQR()` as a separate function that calls the NIC IRP sandbox API.

### Verification
- Invoice PDF shows updated label
- QR still scans correctly
- No misleading "e-Invoice" labeling

---

## Phase 3E — Add Indian Financial Year Enforcement
**Fixes**: H3-4 — no FY validation on GSTR reports

### New utility: `lib/indian-fy.ts`
```ts
/**
 * Indian Financial Year: April 1 to March 31
 */

export function getIndianFY(date: Date): { year: string; start: Date; end: Date } {
  const month = date.getMonth() // 0-indexed
  const year = date.getFullYear()

  const fyStartYear = month >= 3 ? year : year - 1  // April = month 3
  const fyEndYear = fyStartYear + 1

  return {
    year: `${fyStartYear}-${String(fyEndYear).slice(2)}`, // e.g. "2025-26"
    start: new Date(fyStartYear, 3, 1),  // April 1
    end: new Date(fyEndYear, 2, 31, 23, 59, 59),  // March 31
  }
}

export function getGSTRPeriodDates(period: string): { start: Date; end: Date } {
  // period = "MMYYYY"
  const month = parseInt(period.slice(0, 2)) - 1
  const year = parseInt(period.slice(2))
  return {
    start: new Date(year, month, 1),
    end: new Date(year, month + 1, 0, 23, 59, 59),
  }
}

export function validateGSTRPeriod(period: string): { valid: boolean; error?: string } {
  if (!period || period.length !== 6) {
    return { valid: false, error: "Period must be in MMYYYY format (e.g., 032026)" }
  }
  const month = parseInt(period.slice(0, 2))
  const year = parseInt(period.slice(2))
  if (month < 1 || month > 12) {
    return { valid: false, error: "Month must be 01-12" }
  }
  if (year < 2017) {
    return { valid: false, error: "Year must be >= 2017 (GST inception)" }
  }
  const periodDate = new Date(year, month - 1, 1)
  if (periodDate > new Date()) {
    return { valid: false, error: "Cannot generate report for a future period" }
  }
  return { valid: true }
}
```

**Update**: GSTR-1 and GSTR-3B API routes to use `validateGSTRPeriod()`. Update the UI date pickers to show FY context.

---

## Phase 3F — GSTIN Validation on Save
**Fixes**: M3-5 — GSTIN not validated when saving business settings

### Changes
**File**: `forms/settings.ts` — add Zod refinement for GSTIN fields:
```ts
export const settingsFormSchema = z.object({
  // ...
  business_gstin: z.string().optional().refine((val) => {
    if (!val) return true  // optional
    const { valid } = validateGSTIN(val)
    return valid
  }, { message: "Invalid GSTIN format or checksum" }),
  business_state_code: z.string().optional().refine((val) => {
    if (!val) return true
    return INDIAN_STATES[val] !== undefined
  }, { message: "Invalid state code" }),
})
```

### Verification
- Test: save settings with invalid GSTIN → form error shown
- Test: save settings with valid GSTIN → saved successfully

---

## Phase 3 Gate ✓
- [ ] All GSTR-1 sections present in JSON output
- [ ] GSTR-3B has Table 3.1(d) populated for RCM transactions
- [ ] Taxable amounts stored as integers in DB
- [ ] Indian FY utility in use
- [ ] GSTIN validated on save
- [ ] e-Invoice QR relabeled
- [ ] Commit: `fix(compliance): complete GSTR-1 sections, RCM in 3B, taxable value as integer, IFY enforcement`

---

---

# PHASE 4: Test Suite Foundation
**Time estimate**: 2 days
**Dependency**: Phase 3 complete (writing tests against fixed code)

---

## Phase 4A — GSTR-1 Classification Tests
**Fixes**: C5 — `lib/gstr1.ts` has zero test coverage
**New file**: `tests/gstr1.test.ts`

### Test cases to cover (mandatory)
```ts
describe('classifyTransaction', () => {
  it('classifies expense transaction as skip')
  it('classifies export supply as exp')
  it('classifies B2B: valid GSTIN present')
  it('classifies B2CL: inter-state, no GSTIN, total > ₹2.5L')
  it('classifies B2CS: intra-state, no GSTIN (default)')
  it('classifies nil: gstRate === 0 with nil category')
  it('classifies exempt: exempt category code')
  it('warns when B2B missing invoice number')
  it('warns when missing place of supply')
  it('handles missing businessStateCode gracefully')
})

describe('aggregateB2B', () => {
  it('groups invoices by GSTIN')
  it('handles multiple invoices for same GSTIN')
  it('computes taxable value correctly')
})

describe('generateGSTR1Report', () => {
  it('generates all 5 sections from mixed transactions')
  it('section counts match classified transactions')
  it('floating point: 100 × ₹180 CGST = exactly ₹18,000') // critical
})

describe('generateGSTR1JSON', () => {
  it('produces valid GSTN portal JSON structure')
  it('B2B entry has all required fields: ctin, inv, inum, idt, val, pos, rchrg, inv_typ, itms')
  it('state codes in pos are 2-digit numeric, not names')
})
```

---

## Phase 4B — GSTR-3B Tests
**New file**: `tests/gstr3b.test.ts`

### Test cases
```ts
describe('computeTable4 (ITC)', () => {
  it('ITC available for eligible expense (food not included)')
  it('ITC reversed for food/personal category (Section 17(5))')
  it('ITC reversed for motor_vehicle category')
  it('net ITC = available - reversed')
  it('zero ITC when no expenses with GST')
})

describe('generateGSTR3B', () => {
  it('table31(a) matches GSTR-1 taxable B2B+B2CL+B2CS sum')
  it('table6 tax payable = output - ITC (positive)')
  it('table6 ITC carry forward when ITC > output tax')
  it('RCM transaction appears in table31(d)')
})
```

---

## Phase 4C — safePathJoin Security Tests
**Fixes**: C6 — path traversal prevention untested
**Add to**: `tests/files.test.ts` (new file)

```ts
describe('safePathJoin', () => {
  it('allows normal nested path')
  it('throws on ../ traversal')
  it('throws on ../../ double traversal')
  it('throws on URL-encoded traversal (%2F..)')
  it('throws on null-byte injection')
  it('handles email addresses as path components safely')
  it('result always starts with basePath')
})
```

---

## Phase 4D — Stats & Financial Calculation Tests
**Fixes**: M7-1 — `lib/stats.ts` untested
**New file**: `tests/stats.test.ts`

```ts
describe('calcNetTotalPerCurrency', () => {
  it('income adds, expense subtracts')
  it('groups correctly by currency code')
  it('uses convertedTotal when available')
  it('handles null total gracefully')
  it('mixed currencies produce separate entries')
})

describe('numberToIndianWords', () => {
  it('1 crore = "One Crore"')
  it('1 lakh = "One Lakh"')
  it('12,345,678 = correct words')
  it('0 = "Zero"')
  it('negative numbers prefix "Minus"')
})

describe('amountToIndianWords', () => {
  it('100.50 INR → "Rupees One Hundred and Fifty Paise Only"')
  it('1000.00 INR → "Rupees One Thousand Only"')
})
```

---

## Phase 4E — CSV Sanitization Tests
**Fixes**: M7-2 — `sanitizeCSVValue` untested
**Add to**: `tests/export.test.ts` (new file)

```ts
describe('sanitizeCSVValue', () => {
  it('prefixes = formulas with single quote')
  it('prefixes + formulas')
  it('prefixes - formulas (negative number strings)')
  it('prefixes @ formulas')
  it('leaves normal strings unchanged')
  it('leaves numbers unchanged')
  it('leaves null/undefined unchanged')
})
```

---

## Phase 4F — Settings Encryption Integration Test
**Fixes**: H7-2 — encryption round-trip via settings model untested

```ts
describe('updateSettings / getSettings encryption', () => {
  it('sensitive settings are stored encrypted (enc: prefix)')
  it('decrypted value matches original on read')
  it('non-sensitive settings are stored plaintext')
  it('api_key, secret, password codes trigger encryption')
})
```

---

## Phase 4 Gate ✓
- [ ] `pnpm test` — all new tests pass
- [ ] GSTR-1 classification 100% covered (all section types)
- [ ] ITC computation tested for all Section 17(5) categories
- [ ] Path traversal tests all throw correctly
- [ ] `pnpm test --coverage` — business logic files >80%
- [ ] Commit: `test: GSTR-1/3B classification, path traversal, stats, CSV sanitization`

---

---

# PHASE 5: Performance Fixes
**Time estimate**: 2 days
**Dependency**: Phase 4 (tests protect against regression)

---

## Phase 5A — Fix Export: Eliminate N+1 Queries
**Fixes**: H4-1, C1 in Performance (`app/(app)/export/transactions/route.ts`)

### Root cause
```ts
// PROBLEM: N+1 pattern
const { transactions } = await getTransactions(user.id, filters)  // loads ALL
for (const transaction of transactions) {
  const files = await getFilesByTransactionId(transaction.id, user.id)  // 1 query per transaction
}
```

### Fix: Batch file query
```ts
// SOLUTION: Load all files for all matching transactions in ONE query
const transactionIds = transactions.map(t => t.id)
const allFiles = await prisma.transactionFile.findMany({
  where: { transactionId: { in: transactionIds }, file: { userId: user.id } },
  include: { file: true },
})

// Build lookup map: transactionId → File[]
const filesByTransaction = new Map<string, typeof allFiles>()
for (const tf of allFiles) {
  const existing = filesByTransaction.get(tf.transactionId) ?? []
  existing.push(tf)
  filesByTransaction.set(tf.transactionId, existing)
}
```

### Also fix: Add export limit with warning
```ts
const MAX_EXPORT_TRANSACTIONS = 10000

if (!includeAttachments) {
  // CSV-only: paginate via streaming
} else {
  // ZIP with attachments: hard limit
  if (total > MAX_EXPORT_TRANSACTIONS) {
    return NextResponse.json({
      error: `Export limited to ${MAX_EXPORT_TRANSACTIONS} transactions. Apply date filters to reduce the range.`
    }, { status: 400 })
  }
}
```

### Verification
- Test: export 1000 transactions → 2 DB queries total (not 1001)
- Load test: `wrk` or `k6` — export 1000 txns in < 5 seconds

---

## Phase 5B — Fix ZIP Export to Stream
**Fixes**: H4-2 — JSZip holds entire archive in RAM

### Changes
**Install**: `pnpm add archiver`

```ts
import archiver from "archiver"
import { Readable, PassThrough } from "stream"

// Create streaming ZIP:
const archive = archiver("zip", { zlib: { level: 6 } })
const passthrough = new PassThrough()
archive.pipe(passthrough)

// Add CSV
archive.append(csvContent, { name: "transactions.csv" })

// Stream each file as it's added (no full in-memory accumulation)
for (const [path, buffer] of fileBuffers) {
  archive.append(buffer, { name: path })
}

archive.finalize()

return new NextResponse(Readable.from(passthrough) as any, {
  headers: {
    "Content-Type": "application/zip",
    "Content-Disposition": 'attachment; filename="transactions.zip"',
    "Transfer-Encoding": "chunked",
  },
})
```

### Verification
- Test: export 500 files → server RAM usage flat during export (monitor with `process.memoryUsage()`)
- Test: download is received progressively (Transfer-Encoding: chunked)

---

## Phase 5C — Fix getDirectorySize (Incremental Storage Tracking)
**Fixes**: H4-3 — recursive directory walk on every upload

### Changes
**File**: `app/(app)/transactions/actions.ts` — replace:
```ts
// BEFORE: recalculate from scratch
const storageUsed = await getDirectorySize(getUserUploadsDirectory(user))
await updateUser(user.id, { storageUsed })

// AFTER: increment/decrement
await updateUser(user.id, {
  storageUsed: { increment: BigInt(fileSize) }
})

// On delete:
await updateUser(user.id, {
  storageUsed: { decrement: BigInt(fileSize) }
})
```

**Persist file size**: When creating a file record, always store `size` in `metadata`. When deleting, read the stored size from metadata to decrement correctly.

**Periodic recalculation**: Add admin endpoint `POST /api/admin/recalculate-storage` that does the full `getDirectorySize` walk — callable manually, not on every operation.

### Verification
- Test: upload file → `user.storageUsed` increases by exact file size
- Test: delete file → `user.storageUsed` decreases
- Test: upload 100 files rapidly → no perceptible slowdown

---

## Phase 5D — Add LLM Request Timeout
**Fixes**: M4-5 (`ai/providers/llmProvider.ts`)

```ts
const LLM_TIMEOUT_MS = 30_000  // 30 seconds

async function requestWithTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  const timeout = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error(`LLM request timed out after ${timeoutMs}ms`)), timeoutMs)
  )
  return Promise.race([promise, timeout])
}

// In requestLLMUnified:
const response = await requestWithTimeout(
  structuredModel.invoke(messages),
  LLM_TIMEOUT_MS
)
```

### Verification
- Test: mock LLM that hangs for 35s → request resolves with error after 30s
- Test: fast LLM response → completes normally before timeout

---

## Phase 5E — Reduce TRANSACTIONS_PER_PAGE
**Fixes**: H6-1 (`app/(app)/transactions/page.tsx`)

```ts
// Before:
const TRANSACTIONS_PER_PAGE = 500

// After:
const TRANSACTIONS_PER_PAGE = 50
```

**Also add**: URL persistence for page number. Ensure pagination component links include all active filters.

### Verification
- Test: page loads 50 transactions → < 500ms
- Test: pagination navigates correctly
- Test: filters persist across page changes

---

## Phase 5 Gate ✓
- [ ] Export 1000 txns = 2 DB queries total (verified by Prisma query log in dev)
- [ ] ZIP export uses streaming (no OOM on large exports)
- [ ] Storage tracking is incremental (no recursive walk per operation)
- [ ] LLM requests timeout at 30s
- [ ] Transactions page loads 50 items by default
- [ ] All existing tests still pass
- [ ] Commit: `perf: streaming export, incremental storage, LLM timeout, N+1 elimination`

---

---

# PHASE 6: Code Quality
**Time estimate**: 1.5 days
**Dependency**: Phase 5 complete

---

## Phase 6A — Fix Error-Leaking Server Actions
**Fixes**: H5-1 — 8 locations leaking `${error}` to client

### Standard pattern to apply across all affected files:
```ts
// BEFORE (leaks internals):
return { success: false, error: `Failed to split file into items: ${error}` }

// AFTER (safe):
console.error("Failed to split file into items", { error, userId: user.id })
return { success: false, error: "Failed to process file. Please try again." }
```

**Files to fix**:
- `app/(app)/unsorted/actions.ts`: lines 59, 127, 218
- `app/(app)/transactions/actions.ts`: line 200
- `app/(app)/settings/actions.ts`: lines 139, 174, 183

**Standard error messages** (user-friendly):
- File operations: "Failed to process file. Please try again."
- Transaction operations: "Failed to save transaction. Please try again."
- Settings operations: "Failed to save settings. Please try again."

---

## Phase 6B — Extract Shared Financial Utilities
**Fixes**: M5-1 (`lib/indian-tax-utils.ts`), M5-2 — duplicate functions

**Add to** `lib/indian-tax-utils.ts`:
```ts
/**
 * Round to 2 decimal places (standard for GST amounts in rupees).
 * Use this everywhere for GST calculations.
 */
export function roundRupees(n: number): number {
  return Math.round(n * 100) / 100
}

/**
 * Determine if a transaction is inter-state.
 * Canonical implementation — use this in both gstr1.ts and gstr3b.ts.
 */
export function isInterStateSupply(
  placeOfSupply: string | null,
  businessStateCode: string | null
): boolean {
  if (!businessStateCode || !placeOfSupply) return false
  const posCode = Object.entries(INDIAN_STATES).find(
    ([, name]) => name.toLowerCase() === placeOfSupply.toLowerCase()
  )?.[0]
  return posCode ? posCode !== businessStateCode : false
}
```

**Update** `lib/gstr1.ts` and `lib/gstr3b.ts` to import from `lib/indian-tax-utils.ts`.

---

## Phase 6C — Add Runtime Guard on Deprecated Delete Functions
**Fixes**: M5-5 (`models/transactions.ts`)

```ts
/** @deprecated VIOLATES Companies Act 2023 audit trail requirement.
 * Use reverseTransaction() instead.
 * @throws Error in all environments to prevent accidental use.
 */
export const deleteTransaction = async (id: string, userId: string): Promise<never> => {
  throw new Error(
    "deleteTransaction() is prohibited. Use reverseTransaction() — " +
    "hard deletes violate Companies Act 2023 Section 128 audit trail requirement. " +
    `Attempted on transaction ${id}`
  )
}
```

---

## Phase 6D — Remove Dead Code: generateUUID
**Fixes**: M5-4 (`lib/utils.ts`)

- Delete the `generateUUID` function (lines 106-140)
- Search all imports: `grep -r "generateUUID" f:/TaxHacker/` — verify no callers
- All server-side code uses `import { randomUUID } from "crypto"` directly

---

## Phase 6E — Fix TypeScript any in GSTR functions
**Fixes**: L5-2 (`lib/gstr1.ts`, `lib/gstr3b.ts`)

```ts
// After Phase 3A adds dedicated fields to Transaction schema, update:

// Before:
export function transactionToGSTR1(tx: any): GSTR1Transaction

// After:
import { Transaction } from "@/prisma/client"
export function transactionToGSTR1(tx: Transaction): GSTR1Transaction
export function generateGSTR1Report(dbTransactions: Transaction[], businessStateCode: string | null): GSTR1Summary
```

---

## Phase 6F — Fix Typo in Error Message
**Fixes**: L5-5 (`forms/transactions.ts:28`)
```ts
// Before: "Invalid coverted total"
// After:  "Invalid converted total"
```

---

## Phase 6 Gate ✓
- [ ] No `${error}` string interpolation returning to client in server actions
- [ ] `roundRupees` and `isInterStateSupply` exported from `indian-tax-utils.ts`
- [ ] `deleteTransaction` throws immediately
- [ ] `generateUUID` deleted, no callers remain
- [ ] `pnpm tsc --noEmit` — zero `any` warnings in GSTR files
- [ ] All tests still pass
- [ ] Commit: `refactor: error handling, shared utils, remove dead code, fix types`

---

---

# PHASE 7: Compliance Detail Pass
**Time estimate**: 1.5 days
**Dependency**: Phase 6 complete

---

## Phase 7A — Fix Nil Section Format in GSTR-1 JSON
**Fixes**: M3-1 (`lib/gstr1.ts:556-562`)

Replace current hardcoded single entry with correct 4-entry format:
```ts
nil: {
  inv: [
    { sply_ty: "INTRB2B", nil_amt: nilB2BIntra, expt_amt: exemptB2BIntra, ngsup_amt: nonGSTB2BIntra },
    { sply_ty: "INTRAB2B", nil_amt: nilB2BInter, expt_amt: exemptB2BInter, ngsup_amt: nonGSTB2BInter },
    { sply_ty: "INTRB2C", nil_amt: nilB2CIntra, expt_amt: exemptB2CIntra, ngsup_amt: nonGSTB2CIntra },
    { sply_ty: "INTRAB2C", nil_amt: nilB2CInter, expt_amt: exemptB2CInter, ngsup_amt: nonGSTB2CInter },
  ]
}
```

---

## Phase 7B — Add HSN Description Lookup
**Fixes**: M3-2 (`lib/gstr1.ts:360`)

**Option A (quick)**: Use the HSN description stored when the transaction was created (if AI extracted it).

**Option B (complete)**: Bundle a minimal HSN master (just the ~200 most common codes for MSMEs/freelancers) as a JSON file.

```ts
// lib/hsn-master.ts — generated from CBIC HSN master
export const HSN_DESCRIPTIONS: Record<string, string> = {
  "9983": "Other professional, technical and business services",
  "9984": "Telecommunications, broadcasting and information supply services",
  "9985": "Support services",
  // ... top 200 codes
}

// In aggregateHSN():
description: HSN_DESCRIPTIONS[hsn] || (tx.hsnDescription ?? ""),
```

---

## Phase 7C — Store Place of Supply as State Code
**Fixes**: M3-3 — `placeOfSupply` stored as name, needs to be 2-digit code

### Migration
```sql
-- Convert existing name values to state codes
UPDATE transactions
SET place_of_supply = (
  SELECT key
  FROM (VALUES
    ('01', 'Jammu And Kashmir'),
    ('06', 'Haryana'),
    ('27', 'Maharashtra'),
    -- ... all 38 states
  ) AS states(key, name)
  WHERE LOWER(name) = LOWER(transactions.place_of_supply)
)
WHERE place_of_supply IS NOT NULL
  AND place_of_supply NOT ~ '^[0-9]{2}$';  -- not already a code
```

### Update AI prompt
Update the LLM prompt to extract `place_of_supply` as the 2-digit state code, not the state name.

### Update GSTR-1 JSON
`getStateCode()` function becomes a validator, not a converter:
```ts
function validateStateCode(code: string): string {
  if (INDIAN_STATES[code]) return code
  throw new Error(`Invalid state code: ${code}`)
}
```

---

## Phase 7 Gate ✓
- [ ] GSTR-1 JSON nil section has 4 entries (INTRB2B, INTRAB2B, INTRB2C, INTRAB2C)
- [ ] HSN descriptions populated for common codes
- [ ] Place of supply stored as 2-digit codes in DB
- [ ] GSTR-1 JSON validates against GSTN sandbox API
- [ ] Run test exports through GSTN offline tool (GST Suvidha Provider test environment)
- [ ] Commit: `fix(compliance): nil section format, HSN descriptions, place of supply codes`

---

---

# PHASE 8: Frontend / UX
**Time estimate**: 1 day
**Dependency**: Phase 5 complete (pagination already changed)

---

## Phase 8A — Fix useEffect Navigation Loop
**Fixes**: H6-2 (`components/transactions/list.tsx`)

```ts
// Add hasMounted ref to skip initial render
const hasMounted = useRef(false)

useEffect(() => {
  if (!hasMounted.current) {
    hasMounted.current = true
    return  // skip on initial mount
  }
  const params = new URLSearchParams(searchParams.toString())
  if (sorting.field && sorting.direction) {
    params.set("ordering", sorting.direction === "desc" ? `-${sorting.field}` : sorting.field)
  } else {
    params.delete("ordering")
  }
  router.push(`/transactions?${params.toString()}`)
}, [sorting])
```

---

## Phase 8B — Add Row Click Loading State
**Fixes**: M6-1 (`components/transactions/list.tsx`)

```ts
const [navigatingId, setNavigatingId] = useState<string | null>(null)

const handleRowClick = (id: string) => {
  setNavigatingId(id)
  router.push(`/transactions/${id}`)
}

// In TableRow:
<TableRow
  className={cn(
    navigatingId === transaction.id && "opacity-60 pointer-events-none",
    // ...
  )}
  onClick={() => handleRowClick(transaction.id)}
>
  {navigatingId === transaction.id && (
    <TableCell><Loader2 className="h-4 w-4 animate-spin" /></TableCell>
  )}
```

---

## Phase 8C — Fix Import Link Button Nesting
**Fixes**: M6-2 (`components/transactions/create.tsx`)

```tsx
// Before (wrong):
<Button type="button" variant="outline" className="aspect-square">
  <Link href="/import/csv"><Import className="h-4 w-4" /></Link>
</Button>

// After (correct):
<Button type="button" variant="outline" className="aspect-square" asChild>
  <Link href="/import/csv"><Import className="h-4 w-4" /></Link>
</Button>
```
The `asChild` prop on shadcn Button passes behavior to the child Link component.

---

## Phase 8D — Fix Dark Mode Colors
**Fixes**: M6-3, L6-2 (`components/transactions/list.tsx`)

```ts
// Before:
isTransactionIncomplete(fields, transaction) && "bg-yellow-50"
other: "text-black"

// After:
isTransactionIncomplete(fields, transaction) && "bg-yellow-100/50 dark:bg-yellow-900/20"
other: "text-foreground"
```

---

## Phase 8E — Keyboard Accessibility for Table Rows
**Fixes**: L6-1 (`components/transactions/list.tsx`)

```tsx
<TableRow
  role="button"
  tabIndex={0}
  aria-label={`Transaction: ${transaction.name || transaction.merchant || "Unnamed"}`}
  onKeyDown={(e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault()
      handleRowClick(transaction.id)
    }
  }}
  onClick={() => handleRowClick(transaction.id)}
>
```

### Verification
- Tab through rows: each row receives focus
- Press Enter on focused row → navigates
- Screen reader announces row content

---

## Phase 8F — Add Cache-Control Headers for Static Files
**Fixes**: L1-3 (`app/(app)/files/static/[filename]/route.ts`)

```ts
return new NextResponse(fileBuffer, {
  headers: {
    "Content-Type": mimeType,
    "Cache-Control": "public, max-age=31536000, immutable",
    "X-Content-Type-Options": "nosniff",
  },
})
```

---

## Phase 8 Gate ✓
- [ ] Sort click doesn't cause double navigation on fresh page load
- [ ] Row click shows loading indicator
- [ ] Import button navigates on full button click (not just icon)
- [ ] Yellow incomplete highlight visible in both light and dark mode
- [ ] Tab navigation works through transaction list
- [ ] Lighthouse accessibility score ≥ 90
- [ ] Commit: `fix(ux): dark mode colors, keyboard nav, loading states, button nesting`

---

---

# PHASE 9: Hardening & Polish
**Time estimate**: 1 day
**Dependency**: All previous phases complete

---

## Phase 9A — Remove ESLint Disable During Builds
**Fixes**: L1-1 (`next.config.ts`)

```ts
// Remove:
eslint: {
  ignoreDuringBuilds: true,
},

// Fix the lint errors one by one. Run:
// pnpm eslint . --ext .ts,.tsx
```

---

## Phase 9B — Add GSTR-1 Snapshot Tests
**Fixes**: L7-3 — prevent regression in GSTR-1 JSON format

```ts
describe('GSTR-1 JSON snapshot', () => {
  it('produces stable JSON structure (snapshot test)', () => {
    const report = generateGSTR1Report(sampleTransactions, "06")
    const json = generateGSTR1JSON(report, "06AADCT1234A1Z5", "032026")
    expect(json).toMatchSnapshot()
  })
})
```

---

## Phase 9C — Add /health Deep Check
**Update** `app/api/health/route.ts`:
```ts
// Existing: returns OK
// Add: DB connectivity check, encryption key check
export async function GET() {
  const checks = {
    db: false,
    encryption: !!process.env.ENCRYPTION_KEY,
    authSecret: process.env.BETTER_AUTH_SECRET !== "please-set-your-key-here",
  }

  try {
    await prisma.$queryRaw`SELECT 1`
    checks.db = true
  } catch { }

  const healthy = Object.values(checks).every(Boolean)
  return NextResponse.json({ status: healthy ? "ok" : "degraded", checks }, {
    status: healthy ? 200 : 503
  })
}
```

---

## Phase 9D — Add Missing Security Headers (Low)
**Fix `/.well-known/security.txt`**:
```
Add: app/well-known/security.txt/route.ts
Content: Contact: mailto:security@taxhackerindia.in
         Preferred-Languages: en, hi
```

---

## Phase 9 Gate ✓
- [ ] ESLint passes in CI (no `ignoreDuringBuilds`)
- [ ] GSTR-1 JSON snapshot test locks the format
- [ ] /health returns `{ status: "ok" }` on healthy deploy
- [ ] Full test suite green (`pnpm test`)
- [ ] `pnpm build` succeeds
- [ ] Final commit: `chore: enable eslint, health check, security.txt, GSTR snapshot`

---

---

# Debugging Protocols (Cross-Phase)

## DB Migration Debugging
```bash
# Before any migration:
pnpm prisma migrate status          # see pending migrations
pnpm prisma db push --accept-data-loss  # dev only, preview changes

# After migration:
pnpm prisma studio                  # visual inspection
SELECT COUNT(*) FROM transactions WHERE gstin IS NULL AND (extra->>'gstin') IS NOT NULL;  # verify backfill
```

## TypeScript Debugging
```bash
pnpm tsc --noEmit                   # full type check, no output
pnpm tsc --noEmit 2>&1 | head -50  # first 50 errors
```

## Security Debugging
```bash
# Test server action auth bypass:
curl -X POST http://localhost:7331/api/[action-id] \
  -H "Cookie: taxhacker.session=<your-session>" \
  -H "Content-Type: application/json" \
  -d '{"userId": "<other-user-id>", "data": {...}}'
# Expected: operates on your own user, ignores injected userId

# Test MIME bypass:
echo "<script>alert(1)</script>" > evil.html
curl -F "file=@evil.html;type=image/jpeg" http://localhost:7331/api/agent/files
# Expected: 400 - content does not match allowed types
```

## Performance Debugging
```bash
# Count DB queries during export:
# In dev: Prisma logs all queries, count "SELECT" in output

# Memory profiling during ZIP export:
node --max-old-space-size=512 server.js  # restrict heap to catch OOM
```

## GSTR Debugging
```bash
# Validate GSTR-1 JSON structure:
# Use GSTN offline tool: https://tutorial.gst.gov.in/tutorials/returns/

# Check floating point drift:
node -e "
let sum = 0
for(let i = 0; i < 1000; i++) sum += 180
console.log(sum, sum === 180000)  // should log: 180000 true
"
# If false, switch to integer arithmetic (paise throughout)
```

---

# Check & Balance Summary

| After Phase | What to Verify |
|-------------|----------------|
| 0 | `pnpm build` succeeds. Staging deploys. Encryption key check fires. |
| 1 | Auth bypass test fails. bcrypt login works. File upload rejects oversized files. |
| 2 | All schema migrations applied. Bank details encrypted. Enum types enforced. |
| 3 | GSTR-1 JSON passes offline validator. ITC computed correctly for test cases. |
| 4 | `pnpm test --coverage` shows 80%+ on business logic files. |
| 5 | Export 1k transactions < 10s. Memory flat during ZIP. Storage tracking accurate. |
| 6 | Zero `any` in financial logic. Deprecated delete throws. Error messages don't leak. |
| 7 | Nil section has 4 entries. HSN descriptions present. State codes are 2-digit. |
| 8 | Lighthouse accessibility ≥ 90. Dark mode renders correctly. Keyboard nav works. |
| 9 | Full test suite green. ESLint passes. Health endpoint returns `ok`. |

---

# Effort Summary

| Phase | Effort | Cumulative |
|-------|--------|------------|
| 0 — Safety Net | 30 min | 30 min |
| 1 — Security | 2 days | 2.5 days |
| 2 — Architecture | 2 days | 4.5 days |
| 3 — Compliance Core | 3 days | 7.5 days |
| 4 — Tests | 2 days | 9.5 days |
| 5 — Performance | 2 days | 11.5 days |
| 6 — Code Quality | 1.5 days | 13 days |
| 7 — Compliance Detail | 1.5 days | 14.5 days |
| 8 — Frontend/UX | 1 day | 15.5 days |
| 9 — Hardening | 1 day | 16.5 days |

**Total: ~16–17 focused working days**
