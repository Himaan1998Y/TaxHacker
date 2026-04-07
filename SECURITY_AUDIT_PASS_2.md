# TaxHacker Security Audit — Pass 2

**Date**: 2026-04-07
**Auditor**: Security Reviewer Agent
**Scope**: Race conditions, TOCTOU, memory leaks, error handling, deadlocks, input validation, privilege escalation, information disclosure, resource exhaustion, insecure defaults
**Excludes**: Issues already documented in Pass 1 (better-auth 2FA bypass, plaintext password compare, langchain injection, CSP unsafe-inline)

---

## CRITICAL

### C1 — Invoice Action Creates Transaction Before Checking Storage Quota
**File**: `f:/TaxHacker/app/(app)/apps/invoices/actions.ts`, lines 63–83
**Category**: Logic error / Race condition

`saveInvoiceAsTransactionAction` calls `createTransaction` first, then checks `isEnoughStorageToUploadFile`. If storage is full, the transaction record is committed to the database but no PDF is created, leaving an orphaned transaction with no file and no rollback.

```ts
// Line 63 — DB write happens unconditionally
const transaction = await createTransaction(user.id, { ... })

// Line 76 — storage check comes AFTER the DB write
if (!isEnoughStorageToUploadFile(user, pdfBuffer.length)) {
  return { success: false, error: "Insufficient storage to save invoice PDF" }
}
```

**Fix**: Move both the storage check and the subscription check to before `createTransaction`. Mirror the order used correctly in `uploadTransactionFilesAction` (`transactions/actions.ts:144–154`).

---

### C2 — `danger/actions.ts` Server Actions Accept Caller-Supplied `User` Object
**File**: `f:/TaxHacker/app/(app)/settings/danger/actions.ts`, lines 8 and 22
**Category**: Privilege escalation

`resetLLMSettings(user: User)` and `resetFieldsAndCategories(user: User)` accept a `User` object passed from the caller. They are `"use server"` actions, meaning they are exposed over the network. A crafted client call can pass any `user.id`, resetting another user's settings.

The page (`danger/page.tsx:24, 40`) passes the real user, but Next.js server actions accept arguments serialized over HTTP — a POST to the action endpoint with a fabricated `user.id` is feasible.

**Fix**: Remove the `user` parameter. Call `getCurrentUser()` inside each action, the same pattern used in every other action in the codebase.

```ts
// Current — dangerous
export async function resetLLMSettings(user: User) { ... }

// Fixed
export async function resetLLMSettings() {
  const user = await getCurrentUser()
  ...
}
```

---

### C3 — `addNewTemplateAction` and `deleteTemplateAction` Accept Caller-Supplied `User` Object
**File**: `f:/TaxHacker/app/(app)/apps/invoices/actions.ts`, lines 31 and 38
**Category**: Privilege escalation

Same pattern as C2. Both actions are `"use server"` and accept a `User` parameter, allowing a malicious caller to manipulate templates for any `user.id`.

**Fix**: Same as C2 — remove the `user` parameter and call `getCurrentUser()` internally.

---

## HIGH

### H1 — Race Condition in Concurrent File Uploads (Storage Check → Write Window)
**File**: `f:/TaxHacker/app/(app)/files/actions.ts`, lines 28–61; `f:/TaxHacker/app/(app)/transactions/actions.ts`, lines 144–201
**Category**: Race condition / Resource exhaustion

The storage check and file write are not atomic:

```ts
// files/actions.ts:28-29 — check
if (!isEnoughStorageToUploadFile(user, totalFileSize)) { ... }

// files/actions.ts:41-76 — write (no lock between check and write)
const uploadedFiles = await Promise.all(files.map(async (file) => { ... writeFile ... }))
```

Two concurrent upload requests both read `storageUsed` before either write is committed. Both pass the check and both write, exceeding the quota by up to 50 MB per concurrent request.

**Fix**: Use a database-level advisory lock or a short-lived distributed mutex around the check+write, or switch to an atomic increment: `UPDATE users SET storage_used = storage_used + $size WHERE storage_used + $size <= storage_limit RETURNING id` — if 0 rows updated, reject. Prisma supports this with `$executeRaw`.

---

### H2 — TOCTOU in Backup Restore: Data Deleted Before Files Are Validated
**File**: `f:/TaxHacker/app/(app)/settings/backups/actions.ts`, lines 69–85
**Category**: TOCTOU / Data loss

```ts
// Line 72 — POINT OF NO RETURN: all user data deleted
if (REMOVE_EXISTING_DATA) {
  await cleanupUserTables(user.id)
  await fs.rm(userUploadsDirectory, { recursive: true, force: true })
}

// Line 78 — backup data only loaded AFTER irreversible deletion
for (const backup of MODEL_BACKUP) {
  const jsonFile = zip.file(`data/${backup.filename}`)
  ...
}
```

If the ZIP is valid structurally but contains corrupt JSON inside any model file, `cleanupUserTables` has already deleted all user data. The user loses everything with no recovery path.

**Fix**: Validate and parse all ZIP JSON entries into memory *before* calling `cleanupUserTables`. Only proceed with deletion if all validations pass.

---

### H3 — Backup Restore Counts Failures as Successes
**File**: `f:/TaxHacker/models/backups.ts`, lines 270–281
**Category**: Silent failure / Error handling gap

```ts
let insertedCount = 0
for (const rawRecord of records) {
  try {
    await backupSettings.model.create({ data })
  } catch (error) {
    console.error(`Error importing record:`, error)  // error swallowed
  }
  insertedCount++  // incremented regardless of success or failure
}
```

`insertedCount` is incremented whether `create` succeeded or threw. The UI reports "Restored N records" even when all N failed silently. Users believe their backup was restored when it was not.

**Fix**: Move `insertedCount++` inside the `try` block, after the `create` call. Track a separate `failedCount` and surface it in the return value.

---

### H4 — Information Disclosure: Raw Error Objects Stringified into Client-Visible Responses
**Files**:
- `f:/TaxHacker/app/(app)/unsorted/actions.ts:127` — `` `Failed to save transaction: ${error}` ``
- `f:/TaxHacker/app/(app)/unsorted/actions.ts:218` — `` `Failed to split file into items: ${error}` ``
- `f:/TaxHacker/app/(app)/apps/invoices/actions.ts:123` — `` `Failed to save invoice as transaction: ${error}` ``
- `f:/TaxHacker/app/(app)/transactions/actions.ts:207` — `` `File upload failed: ${error}` ``
- `f:/TaxHacker/app/api/stripe/checkout/route.ts:48` — `` `Failed to create checkout session: ${error}` ``
**Category**: Information disclosure

Template-literal stringification of an `Error` object produces output like:
```
"Failed to save transaction: PrismaClientKnownRequestError: 
  Invalid `prisma.transaction.create()` invocation:
  Unique constraint failed on the fields: (`id`)"
```

This leaks database schema, table names, column names, and constraint names to the client. The Stripe checkout route also leaks Stripe API error payloads which may include internal session identifiers.

**Fix**: Replace `${error}` with `error instanceof Error ? error.message : "Unknown error"`. Log the full error server-side only. For production, consider mapping all DB errors to generic messages.

---

### H5 — `console.log` in Upload Action Leaks File Metadata
**File**: `f:/TaxHacker/app/(app)/files/actions.ts`, line 82
**Category**: Information disclosure / Debug log in production

```ts
console.log("uploadedFiles", uploadedFiles)
```

This is a `"use server"` action. The log line runs server-side and emits the full array of file records (including `path`, `mimetype`, `filename`, `metadata.size`, `metadata.lastModified`, and the internal UUID) to server logs. In a hosted environment these logs may be accessible to platform operators or leaked via log aggregation.

**Fix**: Remove this line. The function already returns the result.

---

### H6 — `console.log` in Stripe Webhook Leaks Customer PII
**Files**: `f:/TaxHacker/app/api/stripe/webhook/route.ts`, lines 74, 88, 110
**Category**: Information disclosure

```ts
console.log(`Updating subscription for customer ${customerId}`)
console.log(`User not found for customer ${customerId}, creating new user with email ${customer.email}`)
console.log(`Updated user ${user.id} with plan ${plan.code} ...`)
```

Stripe customer IDs, email addresses, and internal user IDs are logged at `console.log` level (not `debug`). These appear in production logs.

**Fix**: Remove or replace with a structured logger that masks PII, or use `console.debug` and ensure production log level excludes debug output.

---

### H7 — `console.log(session)` Dumps Full Stripe Session Object on Error
**File**: `f:/TaxHacker/app/api/stripe/checkout/route.ts`, line 41
**Category**: Information disclosure

```ts
if (!session.url) {
  console.log(session)  // dumps entire Stripe Checkout Session object
  return NextResponse.json({ error: `Failed to create checkout session: ${session}` }, { status: 500 })
}
```

A Stripe `Checkout.Session` object contains customer metadata, line items, and payment method configuration. Logging the entire object exposes this data. The response also stringifies the session object into the client error message.

**Fix**: Log only `session.id` and remove from the response body.

---

### H8 — In-Memory Rate Limiter Not Shared Across Workers/Pods
**File**: `f:/TaxHacker/lib/rate-limit.ts`, lines 9–37
**Category**: Security control bypass

The rate limiter uses a module-level `Map` (`const store = new Map()`). In any multi-process or multi-replica deployment (Docker Compose with replicas, Coolify horizontal scaling, PM2 cluster mode), each worker maintains its own independent map. An attacker can send `N * maxRequests` requests per window by distributing them across workers.

The self-hosted deployment is single-process, so this is low-risk there. For cloud/production with >1 replica this is HIGH.

**Fix**: Replace with a Redis-backed counter (`INCR` + `EXPIRE`) via ioredis. The existing Redis instance is already running on the VPS.

---

### H9 — Missing `ENCRYPTION_KEY` in `.env.example` and Docker Compose Files
**File**: `f:/TaxHacker/.env.example` (no `ENCRYPTION_KEY` entry); `f:/TaxHacker/docker-compose.yml`; `f:/TaxHacker/docker-compose.production.yml`
**Category**: Insecure default

`ENCRYPTION_KEY` is enforced only in production at runtime (`lib/config.ts:46–62`). However, it is absent from `.env.example`, so new deployments will launch in `SELF_HOSTED_MODE=true` (development-equivalent) without the key, meaning all sensitive settings (API keys, bank details) are stored in plaintext until the operator manually adds the variable.

The `RESEND_API_KEY` default is `"please-set-your-resend-api-key-here"` (`config.ts:22`) and is never validated at startup — the app starts and email silently fails.

**Fix**: Add `ENCRYPTION_KEY=` to `.env.example` with a generation comment. Add validation for `SELF_HOSTED_MODE=false` (cloud mode) that also enforces `ENCRYPTION_KEY`.

---

## MEDIUM

### M1 — `transactionFormSchema` Uses `.catchall(z.string())` — Unbounded Extra Fields Accepted
**File**: `f:/TaxHacker/forms/transactions.ts`, line 63
**Category**: Missing input validation

```ts
export const transactionFormSchema = z.object({ ... }).catchall(z.string())
```

`.catchall(z.string())` accepts any additional key/value pairs without validation. These pass into `splitTransactionDataExtraFields` which writes them to the `extra` JSON column. An attacker can inject arbitrary large strings to bloat the `extra` column with no size limit.

**Fix**: Add a size check on `catchall` values (e.g., `.catchall(z.string().max(1024))`). Consider removing `.catchall` and explicitly listing all accepted extra field keys.

---

### M2 — `createFile` and `updateFile` Accept `data: any` Without Schema Validation
**File**: `f:/TaxHacker/models/files.ts`, lines 65 and 74
**Category**: Missing input validation

```ts
export const createFile = async (userId: string, data: any) => {
  return await prisma.file.create({ data: { ...data, userId } })
}
```

`data: any` is spread directly into Prisma. Callers (7 across the codebase) can pass any field, including `userId` override — which is mitigated by the explicit `userId` override after the spread, but other protected fields (`createdAt`, internal IDs) could be injected.

**Fix**: Define a typed `FileCreateInput` interface and validate callers at compile time. Alternatively, explicitly destructure only the known safe fields.

---

### M3 — `saveFileAsTransactionAction` Error Leaks Internal Path / State Info
**File**: `f:/TaxHacker/app/(app)/unsorted/actions.ts`, lines 125–128
**Category**: Information disclosure

```ts
} catch (error) {
  return { success: false, error: `Failed to save transaction: ${error}` }
}
```

When the `rename()` call fails (e.g., cross-device link), the error includes the full filesystem paths of both source and destination, exposing the server's upload directory structure.

**Fix**: Wrap specifically the `rename()` call and return a generic message. Log the full path info server-side only.

---

### M4 — `splitFileIntoItemsAction` Uses Unsanitized `item.name` in Filename
**File**: `f:/TaxHacker/app/(app)/unsorted/actions.ts`, line 173
**Category**: Path injection risk

```ts
const fileName = `${originalFile.filename}-part-${item.name}`
const relativeFilePath = unsortedFilePath(fileUuid, fileName)
```

`item.name` comes from LLM-parsed JSON (the AI analysis result) and is not sanitized before being embedded in a filename. Characters like `/`, `..`, `\0`, and `:` in `item.name` could cause issues. `unsortedFilePath` calls `path.extname(filename)` and `safePathJoin` provides traversal protection, but `path.extname` on a name containing `/` will produce unexpected results and could break the stored path.

**Fix**: Sanitize `item.name` before use in filenames: strip path separators and limit length.

```ts
const safeName = (item.name || "item").replace(/[/\\:*?"<>|]/g, "_").slice(0, 64)
const fileName = `${originalFile.filename}-part-${safeName}`
```

---

### M5 — Static File Endpoint Leaks Filename in 404 Response
**File**: `f:/TaxHacker/app/(app)/files/static/[filename]/route.ts`, line 22
**Category**: Information disclosure

```ts
return new NextResponse(`File not found for user: ${filename}`, { status: 404 })
```

The 404 response echoes back the `filename` parameter from the URL. If an attacker probes the endpoint with filenames containing special characters or injection patterns, the server reflects them unescaped in the response body. This is a reflected XSS vector if the response is ever rendered as HTML.

**Fix**: Return a generic `"Not found"` string without reflecting input.

---

### M6 — `Backup Restore` Allows ZIP Bomb / Memory Exhaustion
**File**: `f:/TaxHacker/app/(app)/settings/backups/actions.ts`, lines 37–41
**Category**: Resource exhaustion

```ts
if (file.size > MAX_BACKUP_SIZE) { ... }  // 256MB check on compressed size

const fileBuffer = await file.arrayBuffer()
const fileData = Buffer.from(fileBuffer)
zip = await JSZip.loadAsync(fileData)     // decompresses entire archive into memory
```

The 256 MB limit applies to the compressed ZIP. A ZIP bomb (e.g., 256 MB of zeros compressed to <1 MB) will decompress to gigabytes in memory during `JSZip.loadAsync`. The server has 22 GB RAM on the VPS but a sufficiently large bomb can cause an OOM kill.

**Fix**: After loading the ZIP, check the uncompressed size of entries before decompressing:
```ts
let totalUncompressed = 0
zip.forEach((path, file) => { totalUncompressed += file._data.uncompressedSize })
if (totalUncompressed > MAX_UNCOMPRESSED_SIZE) return { error: "Archive too large" }
```

---

### M7 — Export Endpoint Has No Pagination or Row Limit on Full Export
**File**: `f:/TaxHacker/app/(app)/export/transactions/route.ts`, lines 35–36
**Category**: Resource exhaustion

```ts
const { transactions } = await getTransactions(user.id, filters)
// ...all transactions loaded into memory, then into ZIP
```

`getTransactions` is called without `pagination`, which returns all matching transactions in one query (see `models/transactions.ts:117–126`). A user with 100,000 transactions could export all of them, loading every row into memory simultaneously, then packaging all associated files into a ZIP in memory.

The code processes in chunks of 300 for CSV but all are fetched upfront. Files are added to a `JSZip` instance in memory before the ZIP is streamed.

**Fix**: Add a maximum row limit on the export endpoint (e.g., 10,000 rows), or stream the ZIP using a true streaming ZIP library rather than building it entirely in memory.

---

### M8 — `getDirectorySize` Walks Entire Upload Tree on Every File Operation
**File**: `f:/TaxHacker/lib/files.ts:98–114`; called from `transactions/actions.ts:119,200`; `files/actions.ts:79`; `unsorted/actions.ts:211`
**Category**: Performance / Resource exhaustion (noted in prior audit but not in Pass 1 security findings)

This is a O(n files) filesystem walk triggered on every upload and delete. With 50 MB files and thousands of records, concurrent uploads will each trigger this walk, creating a thundering herd that can spike disk I/O and slow the entire server. Under concurrent load this also creates a race: two concurrent uploads both walk before either updates `storageUsed`, causing `storageUsed` to be written as the same stale value twice.

This compounds the race condition in H1.

**Fix**: Use incremental storage tracking: `UPDATE users SET storage_used = storage_used + $delta WHERE id = $userId`. Remove `getDirectorySize` from the hot path entirely.

---

### M9 — Self-Hosted API Endpoints Bypass Auth When `selfHosted.isEnabled` Is False
**File**: `f:/TaxHacker/app/api/agent/auth.ts`, lines 40–46
**Category**: Authentication logic

```ts
if (!config.selfHosted.isEnabled) {
  return NextResponse.json(
    { error: "Agent API is only available in self-hosted mode" },
    { status: 403 }
  )
}
```

This is the intended design, but when `SELF_HOSTED_MODE=false` (cloud mode), the agent API returns 403 which is correct. However, the middleware (`middleware.ts:84–96`) does not include `/api/agent/` in the matcher for normal auth session checks — it only checks `x-forwarded-for` rate limiting. In cloud mode, a request to `/api/agent/files` will pass through middleware (only rate limited), hit `authenticateAgent`, and get a 403. This is correct but the defense-in-depth is absent: if `authenticateAgent` is ever refactored to skip the self-hosted check, there is no middleware gate.

**Fix**: Add `/api/agent/` to the middleware session validation block so that in cloud mode, missing session cookies are rejected at middleware before reaching any route handler.

---

### M10 — `deleteFile` Resolves Path from `file.path` Without Joining Against User Directory
**File**: `f:/TaxHacker/models/files.ts`, lines 88–95
**Category**: Path traversal (partial)

```ts
const resolvedPath = path.resolve(path.normalize(file.path))
const uploadsBase = path.resolve(FILE_UPLOAD_PATH)
if (!resolvedPath.startsWith(uploadsBase)) {
  console.error("Path traversal blocked on file deletion:", file.id)
  return
}
await unlink(resolvedPath)
```

`file.path` is the value stored in the database. The guard checks against `FILE_UPLOAD_PATH` (the global uploads base), not the *user-specific* uploads directory. A compromised or buggy write that stores a path like `uploads/other-user@example.com/...` would pass the check and allow deleting another user's files. This is mitigated by the fact that all writes go through `safePathJoin(getUserUploadsDirectory(user), ...)`, but the delete path does not re-verify user ownership at the filesystem level.

**Fix**: Change the guard to verify against the user-specific directory:
```ts
const userUploadsDir = path.resolve(FILE_UPLOAD_PATH, file.userId)
if (!resolvedPath.startsWith(userUploadsDir)) { ... }
```

---

## LOW

### L1 — `BETTER_AUTH_SECRET` Default `"please-set-your-key-here"` Is Weak and Not Flagged in Self-Hosted Mode
**File**: `f:/TaxHacker/lib/config.ts`, lines 17–19, 46–55
**Category**: Insecure default

The production check for the default secret only runs when `NODE_ENV === "production"` AND `NEXT_PHASE !== "phase-production-build"`. In self-hosted mode with `NODE_ENV=production` but the check bypassed (e.g., Docker build phase), the default secret may slip through. The `.env.example` uses `"random-secret-key"` which is also weak.

**Fix**: Add the check unconditionally at startup (not gated on `isProductionRuntime`). The `.env.example` should instruct users to generate the secret: `openssl rand -hex 32`.

---

### L2 — `resetFieldsAndCategories` Has No CSRF-Equivalent Confirmation
**File**: `f:/TaxHacker/app/(app)/settings/danger/page.tsx`, lines 20–47
**Category**: Missing destructive action confirmation

The destructive reset actions fire immediately on form submit with no confirmation dialog. A single click (or CSRF-like social engineering via an `<img src="...">` tag that triggers a form post) could wipe all user categories, fields, and currencies. Next.js server actions include CSRF protection via origin header checks, but user-facing destructive actions should still require explicit confirmation.

**Fix**: Add a confirmation dialog (e.g., "Type RESET to confirm") before submitting these forms.

---

### L3 — Template ID Uses `Math.random()` Instead of `crypto.randomUUID()`
**File**: `f:/TaxHacker/app/(app)/apps/invoices/components/invoice-generator.tsx`, line 176
**Category**: Weak randomness

```ts
id: `tmpl_${Math.random().toString(36).substring(2, 15)}`
```

`Math.random()` is not cryptographically secure. While template IDs are not security tokens, the pattern is inconsistent with the rest of the codebase (which uses `randomUUID()`) and could lead to collisions with enough templates.

**Fix**: Replace with `import { randomUUID } from "crypto"` and use `tmpl_${randomUUID()}`.

---

### L4 — `invoice-generator.tsx` Reducer Uses `action: any` Type
**File**: `f:/TaxHacker/app/(app)/apps/invoices/components/invoice-generator.tsx`, line 22
**Category**: Type safety / Code quality

```ts
function invoiceFormReducer(state: InvoiceFormData, action: any): InvoiceFormData {
```

`any` typed reducer actions defeat TypeScript's exhaustiveness checking and could allow unexpected action shapes to reach the reducer silently.

---

### L5 — `Backup Restore` Silently Continues on Per-File Write Errors
**File**: `f:/TaxHacker/app/(app)/settings/backups/actions.ts`, lines 119–126
**Category**: Silent failure

```ts
try {
  await fs.mkdir(...)
  await fs.writeFile(fullFilePath, fileContents)
  restoredFilesCount++
} catch (error) {
  console.error(`Error writing file ${fullFilePath}:`, error)
  continue  // silently skips; prisma.file record still updated below
}

await prisma.file.update({ where: { id: file.id }, data: { path: filePathWithoutPrefix } })
```

If `writeFile` fails for a specific file, the `continue` skips incrementing `restoredFilesCount` correctly, but the `prisma.file.update` on line 128–133 still executes (it's outside the try/catch), updating the DB path to a file that does not exist on disk. Subsequent attempts to read that file will produce 404s with no indication of the restoration failure.

**Fix**: Move the `prisma.file.update` inside the `try` block, after `writeFile`. On catch, log and skip both the FS write and the DB update.

---

## Summary Table

| ID | Severity | Category | File | Line(s) |
|----|----------|----------|------|---------|
| C1 | CRITICAL | Logic error — transaction created before storage check | `apps/invoices/actions.ts` | 63–83 |
| C2 | CRITICAL | Privilege escalation — caller-supplied user in danger actions | `settings/danger/actions.ts` | 8, 22 |
| C3 | CRITICAL | Privilege escalation — caller-supplied user in invoice actions | `apps/invoices/actions.ts` | 31, 38 |
| H1 | HIGH | Race condition — concurrent uploads exceed storage quota | `files/actions.ts`, `transactions/actions.ts` | 28–76 |
| H2 | HIGH | TOCTOU — data deleted before backup validated | `settings/backups/actions.ts` | 69–85 |
| H3 | HIGH | Silent failure — backup counts errors as successes | `models/backups.ts` | 277–280 |
| H4 | HIGH | Info disclosure — raw error objects sent to client | Multiple | See above |
| H5 | HIGH | Debug log in production — file records logged | `files/actions.ts` | 82 |
| H6 | HIGH | PII in logs — customer email/ID in Stripe webhook | `stripe/webhook/route.ts` | 74, 88, 110 |
| H7 | HIGH | Info disclosure — full Stripe session logged and returned | `stripe/checkout/route.ts` | 41–42 |
| H8 | HIGH | Rate limiter bypass in multi-replica deployments | `lib/rate-limit.ts` | 9 |
| H9 | HIGH | `ENCRYPTION_KEY` absent from `.env.example` | `.env.example` | — |
| M1 | MEDIUM | Unbounded extra fields via `.catchall()` | `forms/transactions.ts` | 63 |
| M2 | MEDIUM | `data: any` in file model — no schema validation | `models/files.ts` | 65, 74 |
| M3 | MEDIUM | Filesystem path leaked in error message | `unsorted/actions.ts` | 125–128 |
| M4 | MEDIUM | LLM-generated name used unsanitized in filename | `unsorted/actions.ts` | 173 |
| M5 | MEDIUM | Filename reflected unescaped in 404 response | `files/static/[filename]/route.ts` | 22 |
| M6 | MEDIUM | ZIP bomb risk in backup restore | `settings/backups/actions.ts` | 37–41 |
| M7 | MEDIUM | No row limit on full transaction export | `export/transactions/route.ts` | 35–36 |
| M8 | MEDIUM | `getDirectorySize` race + O(n) walk on hot path | `lib/files.ts` | 98–114 |
| M9 | MEDIUM | Agent API not gated at middleware in cloud mode | `middleware.ts` | 84–96 |
| M10 | MEDIUM | `deleteFile` checks against global base, not user dir | `models/files.ts` | 88–95 |
| L1 | LOW | Weak default auth secret not blocked in all paths | `lib/config.ts` | 17–19 |
| L2 | LOW | No confirmation on destructive reset actions | `settings/danger/page.tsx` | 20–47 |
| L3 | LOW | `Math.random()` for template ID | `invoice-generator.tsx` | 176 |
| L4 | LOW | `action: any` in invoice reducer | `invoice-generator.tsx` | 22 |
| L5 | LOW | Backup restore: DB path updated even when file write fails | `settings/backups/actions.ts` | 119–133 |

---

## Priority Fix Order

1. **C2 + C3** — Privilege escalation in server actions. Fix in < 1 hour. High blast radius if exploited.
2. **C1** — Orphaned transaction creation. Logic fix, low risk of regression.
3. **H2 + H3** — Backup restore data loss. Validate before delete, track failures correctly.
4. **H4 + H5 + H6 + H7** — Information disclosure via logs and error strings. Mechanical find-and-replace, low regression risk.
5. **H1 + M8** — Race condition on storage check; consolidate by switching to atomic DB increment.
6. **M4** — Sanitize LLM-derived filename component before writing to disk.
7. **H9** — Add `ENCRYPTION_KEY` to `.env.example` with generation instructions.
