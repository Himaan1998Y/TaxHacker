# Dimension 4: Performance & Scalability Findings
**Date**: 2026-03-31
**Files Reviewed**: app/(app)/export/transactions/route.ts, app/(app)/unsorted/actions.ts, app/api/agent/gstr1/route.ts, lib/embeddings.ts, lib/cache.ts, lib/files.ts, lib/stats.ts, models/transactions.ts, prisma/schema.prisma

---

## CRITICAL (1)

### C1 — Export loads ALL transactions into memory before processing
**File**: `app/(app)/export/transactions/route.ts:36`
**Issue**: `const { transactions } = await getTransactions(user.id, filters)` — no limit, no pagination. ALL matching transactions are loaded into Node.js heap before CSV/ZIP generation begins.

For a user with 50,000 transactions, this means loading potentially hundreds of MB of data at once, likely causing an OOM crash or extreme latency. The chunking on lines 50-78 only controls CSV streaming — the DB load is still fully unbounded.

**Compound problem**: The ZIP path (lines 115-167) then does **N+1 queries** — a `getFilesByTransactionId()` call for each transaction in a second loop:
```ts
for (const transaction of transactions) {
  const transactionFiles = await getFilesByTransactionId(transaction.id, user.id) // N queries
```
With 1000 transactions, this is 1001 database queries just to count total files.

**Fix**:
1. Add hard limit (e.g., 10,000 transactions) and paginate with streaming
2. Replace N+1 with a single query: `WHERE file_id IN (...)` with a JOIN

---

## HIGH (3)

### H1 — ZIP export holds entire archive in memory
**File**: `app/(app)/export/transactions/route.ts:177`
**Issue**: `zip.generateAsync({ type: "uint8array" })` — JSZip builds the entire ZIP in RAM before streaming. With 1000 files averaging 1MB each, this is ~1GB of RAM in a single request. Multiple concurrent exports would exhaust the server.
**Fix**: Use a streaming ZIP library (e.g., `archiver` or `yazl`) that writes to a streaming response.

### H2 — `getDirectorySize` walks entire uploads dir on every file operation
**File**: `lib/files.ts:70-84` called from `transactions/actions.ts:118`, `unsorted/actions.ts:212`
**Issue**: The function recursively stats every file in the user's uploads directory to compute total usage. Called after every upload/delete. For a user with 5000 files, this is 5000+ filesystem stat() calls on the hot path, potentially 500-1000ms per operation.
**Fix**: Track `storageUsed` incrementally — add file size on upload, subtract on delete. Only recalculate from scratch on explicit "recalculate" admin action.

### H3 — `splitFileIntoItems` copies full file content N times
**File**: `app/(app)/unsorted/actions.ts:176-180`
**Issue**: When splitting 1 file into N items, the raw file content (`fileContent`) is read once, then written N times. For a 10MB PDF split into 5 items = 50MB written in a single synchronous action. The sequential `await writeFile()` in a for-loop blocks the entire action.
**Fix**: Store only one copy, reference the same file by ID across all split items.

---

## MEDIUM (5)

### M1 — No pagination on GSTR-1/GSTR-3B data fetch
**File**: `app/api/agent/gstr1/route.ts:43`
**Issue**: `getTransactions(user.id, { dateFrom, dateTo })` — no limit for a full month's transactions. For a large MSME with 2000+ transactions/month, all are loaded into RAM for the GSTR computation.
**Fix**: For the aggregation use case, use a Prisma cursor/batch approach or add a `MAX_GSTR_TRANSACTIONS` limit with a warning.

### M2 — `PoorManCache` grows unbounded (no eviction)
**File**: `lib/cache.ts`
**Issue**: The `cleanup()` method must be called manually. Without external eviction, the Map grows indefinitely. No automatic cleanup on `set()`. No max size cap.
**Fix**: Call `cleanup()` on every `set()` call (with a size threshold check), or add a `maxSize` parameter.

### M3 — Embedding on every transaction create/update (no batching)
**File**: `models/transactions.ts:9-13`
**Issue**: `embedTransactionAsync(transaction)` is called on every create and update. Each call makes an external HTTP request to the Gemini API. Under bulk imports (100+ transactions at once via CSV), this fires 100+ concurrent Gemini requests, likely hitting rate limits (free tier: 1500 RPM).
**Fix**: Batch embedding: use a queue (simple array + `setTimeout`) or process embeddings in a background cron. Mark transactions with `embeddingPending` flag.

### M4 — `files` JSON array has no index for `array_contains` queries
**File**: `prisma/schema.prisma:184`, `models/transactions.ts:140-144`
**Issue**: `getTransactionsByFileId` uses `files: { array_contains: [fileId] }` — this requires a full table scan on the JSON column because PostgreSQL B-tree indexes don't support `@>` operators on plain JSON. On a table with 100k transactions, every file-linked-transactions lookup is a sequential scan.
**Fix**: Add a `@@index([files])` using `gin` index in Prisma, or migrate to a proper junction table (see Architecture D2-H3).

### M5 — No request timeout on LLM calls
**File**: `ai/providers/llmProvider.ts:31-113`
**Issue**: No `AbortController` timeout is set on LangChain model invocations. If the LLM provider hangs (which happens with Mistral/OpenRouter occasionally), the request hangs until the Vercel/Node.js 60s function timeout. All server resources held during this time.
**Fix**: Wrap each `model.invoke()` in a `Promise.race()` with a 30-second timeout.

---

## LOW (3)

### L1 — Prisma `$executeRawUnsafe` for vector storage
**File**: `lib/embeddings.ts:120-125`
**Issue**: The embedding vector (768 floats) is string-interpolated: `` `[${embedding.join(",")}]` `` — this creates a 5KB+ string on every embedding write. While safe (only numbers), it's inefficient. The raw SQL also bypasses Prisma's query logging/tracing.
**Fix**: This is unavoidable until Prisma adds native pgvector support. Comment why raw SQL is necessary here. Already done partially with existing comment.

### L2 — React `cache()` scope mismatch
**File**: `models/transactions.ts:51`, `models/settings.ts:56`
**Issue**: React `cache()` is scoped to a single request render tree. When `getTransactions` is called from a layout Server Component and then from a Server Action (both within the same request), the cache is NOT shared — they are different execution contexts. The cache only helps when the same RSC function is called multiple times in the same render, which is rare in this app.
**Fix**: If cross-context caching is needed, use a request-scoped custom cache (e.g., `AsyncLocalStorage`). Otherwise, remove `cache()` — Prisma queries are fast enough.

### L3 — No HTTP caching headers on static file responses
**File**: `app/(app)/files/static/[filename]/route.ts`
**Issue**: Static assets (avatars, business logos) are served with no `Cache-Control` header. Every page load re-fetches them from disk. These are effectively immutable (content-addressed by UUID).
**Fix**: Add `Cache-Control: public, max-age=31536000, immutable` for static files.

---

## What's Done Well ✓

- Export uses CSV streaming (`@fast-csv/format`) for the CSV-only path — correct
- Chunked processing (300 transactions per chunk) for CSV generation
- Fire-and-forget embedding (`embedTransactionAsync`) doesn't block transaction saves
- Embedding fallback to hash-based (dev mode) prevents API dependency in tests
- `HNSW` index on embedding column in docker-entrypoint.sh — correct index type for cosine similarity
- Progress tracking on export (`progressId` mechanism) is well-designed
- Transaction queries include useful indexes: userId, status, issuedAt, categoryCode, projectCode

---

## Summary

| Severity | Count |
|----------|-------|
| Critical | 1 |
| High | 3 |
| Medium | 5 |
| Low | 3 |
| **Total** | **12** |

**Top performance fix**: C1 — Export N+1 query. With 1000 transactions this is 1001 DB queries. Replace with a single `WHERE transaction_id IN (...)` query. ~2 hour fix.
