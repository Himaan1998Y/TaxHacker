# Implementation Plan: Fix LLM + Agent API Bridge + Embeddings

## Pre-Flight: Fix Current Issues

### Task 0.1: Deploy Healthcheck Fix (15 min)
- [x] Created `/api/health` endpoint returning `{"status":"ok"}`
- [x] Updated Dockerfile healthcheck to hit `/api/health`
- [x] Updated docker-compose.coolify.yml healthcheck
- [x] Added error logging to LLM provider (shows actual error, not just "failed")
- [x] Added OpenRouter to self-hosted setup form
- [ ] **Commit and push** → redeploy on Coolify
- [ ] Verify container stays healthy (no rollback)

### Task 0.2: Debug LLM Failure (30 min)
After deployment, try "Analyze with AI" and check container logs:
```bash
ssh antigravity@57.129.125.171 -p 49222
docker logs <taxhacker-container> --tail 50
```
The improved logging will now show: `google failed: <ACTUAL ERROR MESSAGE>`

**Likely fixes based on error:**
| Error Message | Fix |
|--------------|-----|
| `model not found` | Change model to `gemini-2.0-flash` (widely supported) |
| `structured output not supported` | Update `@langchain/google-genai` to latest |
| `invalid image format` | Gemini uses different image format than OpenAI |
| `quota exceeded` | Check Google AI Studio dashboard |
| `401 unauthorized` | Key expired, regenerate at aistudio.google.com |

**Quick fallback:** Add OpenRouter key in Settings → LLM. Set model to `google/gemini-2.0-flash-001`. OpenRouter uses OpenAI-compatible format which is most reliable with LangChain.

**Free LLM options you can add RIGHT NOW:**

| Provider | How to Get Key | Model | Cost |
|----------|---------------|-------|------|
| Google Gemini | aistudio.google.com/apikey | gemini-2.0-flash | FREE (15 RPM) |
| OpenRouter | openrouter.ai/keys | google/gemini-2.0-flash-001 | FREE tier available |
| OpenRouter | openrouter.ai/keys | meta-llama/llama-4-scout | FREE |
| OpenRouter | openrouter.ai/keys | deepseek/deepseek-chat-v3-0324 | FREE |
| Mistral | console.mistral.ai | mistral-small-latest | $0.1/M tokens (very cheap) |

**Recommendation:** Get an OpenRouter key (free, 1 min signup) and add it as provider #1. It gives you access to 100+ models through one key and uses the most reliable API format.

---

## Phase 1: Agent API Bridge (Week 1)

### Task 1.1: API Key Auth Middleware (2 hours)
**File:** `app/api/agent/middleware.ts`

Create API key authentication for agent endpoints:
- Generate API key in Settings UI (or manual DB insert for now)
- Store bcrypt hash in Settings table as `agent_api_key_hash`
- Middleware checks `X-Agent-Key` header against hash
- Rate limit: 60 requests/minute per key

**Verification:**
- [ ] Unauthorized request returns 401
- [ ] Valid key returns 200
- [ ] Rate limit returns 429 after 60 requests

### Task 1.2: Transaction CRUD Endpoints (3 hours)
**Files:** `app/api/agent/transactions/route.ts`, `app/api/agent/transactions/[id]/route.ts`

```
GET    /api/agent/transactions?dateFrom=X&dateTo=Y&search=Z&category=X&type=expense
POST   /api/agent/transactions   (body: {name, merchant, total, type, issuedAt, extra})
PATCH  /api/agent/transactions/:id
DELETE /api/agent/transactions/:id
```

Wraps existing `models/transactions.ts` functions. Returns JSON.

**Verification:**
- [ ] GET returns paginated transactions with filters
- [ ] POST creates transaction, returns created record
- [ ] PATCH updates fields, returns updated record
- [ ] DELETE removes, returns success
- [ ] All endpoints require X-Agent-Key

### Task 1.3: File Upload + AI Analysis Endpoints (3 hours)
**Files:** `app/api/agent/files/route.ts`, `app/api/agent/analyze/route.ts`

```
POST /api/agent/files     (multipart: file upload → save → return fileId)
POST /api/agent/analyze   (body: {fileId} → trigger OCR pipeline → return extracted data)
```

Reuses existing `ai/analyze.ts` and file handling logic.

**Verification:**
- [ ] Upload returns fileId
- [ ] Analyze triggers LLM and returns structured output
- [ ] Error returns meaningful message (not just "failed")

### Task 1.4: GST Report Endpoints (2 hours)
**Files:** `app/api/agent/gstr1/route.ts`, `app/api/agent/gstr3b/route.ts`

```
GET /api/agent/gstr1?period=032026    → generateGSTR1Summary()
GET /api/agent/gstr1/json?period=X    → generateGSTR1JSON() (portal-ready)
GET /api/agent/gstr3b?period=032026   → generateGSTR3B()
GET /api/agent/gstr3b/json?period=X   → generateGSTR3BJSON()
```

Wraps existing `lib/gstr1.ts` and `lib/gstr3b.ts`.

**Verification:**
- [ ] Returns correct GSTR-1 summary for a period with test data
- [ ] JSON export matches GSTN portal format
- [ ] Empty period returns empty report (not error)

### Task 1.5: Daily Digest + Stats Endpoint (1 hour)
**File:** `app/api/agent/digest/route.ts`

```
GET /api/agent/digest?date=today     → Today's transactions summary
GET /api/agent/stats?from=X&to=Y     → Period aggregations (income, expense, tax)
```

**Verification:**
- [ ] Returns correct totals for date range
- [ ] Handles empty periods gracefully

### Task 1.6: Integration Test (2 hours)
Create a simple test script that:
1. Creates a transaction via API
2. Uploads a test file
3. Queries GSTR-1
4. Queries daily digest
5. Verifies all responses

**Total Phase 1 effort: ~13 hours across 5-6 sessions**

---

## Phase 2: pgvector + Embeddings (Week 1-2)

### Task 2.1: Enable pgvector Extension (30 min)
**File:** New Prisma migration

```sql
CREATE EXTENSION IF NOT EXISTS vector;
ALTER TABLE "Transaction" ADD COLUMN IF NOT EXISTS embedding vector(768);
CREATE INDEX IF NOT EXISTS transaction_embedding_idx
  ON "Transaction" USING hnsw (embedding vector_cosine_ops);
```

**Verification:**
- [ ] Migration runs without error
- [ ] pgvector extension is active: `SELECT * FROM pg_extension WHERE extname = 'vector'`

### Task 2.2: Embedding Service (2 hours)
**File:** `lib/embeddings.ts`

Wrapper that generates embeddings via:
1. **Gemini Embedding API** (free tier, 768 dimensions) — primary
2. **Local Ollama + Nomic Embed** — fallback (zero cost, runs on VPS)

```typescript
export async function generateEmbedding(text: string): Promise<number[]>
export async function findSimilar(embedding: number[], limit: number): Promise<Transaction[]>
export async function detectDuplicates(embedding: number[], threshold: number): Promise<Transaction[]>
```

**Verification:**
- [ ] Generates 768-dim vector from text
- [ ] Similarity search returns nearest neighbors
- [ ] Duplicate detection works with 0.95 threshold

### Task 2.3: Auto-Embed on Transaction Create/Update (1 hour)
**File:** Modify `models/transactions.ts`

After `createTransaction()` and `updateTransaction()`:
- Build text from: `{name} {merchant} {total} {category} {description}`
- Generate embedding
- Store in `embedding` column

**Verification:**
- [ ] New transactions get embeddings automatically
- [ ] Updated transactions get re-embedded

### Task 2.4: Duplicate Detection on Upload (1 hour)
**File:** Modify `ai/analyze.ts` or create `lib/dedup.ts`

After AI extraction, before saving:
- Generate embedding from extracted data
- Query pgvector for similar (>0.92 cosine similarity)
- If duplicates found → warn user: "This looks similar to INV-234 from March 15"

**Verification:**
- [ ] Upload same invoice twice → duplicate warning shown
- [ ] Different invoices → no false positives

### Task 2.5: Semantic Search Endpoint (1 hour)
**File:** `app/api/agent/search/route.ts`

```
GET /api/agent/search?q=office%20supplies   → semantic vector search
```

Falls back to existing text search if embeddings not available.

**Verification:**
- [ ] "office expenses" finds transactions labeled "stationery" and "printer cartridge"
- [ ] Hindi query finds matching English transactions (if multilingual embedding model)

### Task 2.6: Backfill Existing Transactions (30 min)
**File:** Script or management endpoint

```
POST /api/agent/embeddings/backfill   → Generates embeddings for all existing transactions
```

Rate-limited to avoid hitting API limits.

**Verification:**
- [ ] All existing transactions get embeddings
- [ ] No API rate limit errors

**Total Phase 2 effort: ~6 hours across 3-4 sessions**

---

## Verification Checkpoints

### After Phase 1:
```bash
# Test: Create transaction
curl -X POST http://localhost:7331/api/agent/transactions \
  -H "X-Agent-Key: your-key" \
  -H "Content-Type: application/json" \
  -d '{"name":"Test Invoice","total":5000000,"type":"expense","merchant":"ABC Corp"}'

# Test: Get GST liability
curl http://localhost:7331/api/agent/gstr3b?period=032026 \
  -H "X-Agent-Key: your-key"

# Test: Daily digest
curl http://localhost:7331/api/agent/digest?date=today \
  -H "X-Agent-Key: your-key"
```

### After Phase 2:
```bash
# Test: Semantic search
curl "http://localhost:7331/api/agent/search?q=office+supplies" \
  -H "X-Agent-Key: your-key"

# Test: Upload and check for duplicates
curl -X POST http://localhost:7331/api/agent/files \
  -H "X-Agent-Key: your-key" \
  -F "file=@invoice.pdf"
# Upload same file again → should warn about duplicate
```

---

## Risk Mitigation

| Risk | Mitigation |
|------|-----------|
| pgvector migration fails on Coolify Postgres | Test migration on local Docker first. pgvector is included in postgres:17-alpine. |
| Embedding API rate limits | Use Gemini free tier (1500 RPM) for bulk, Ollama for real-time. Cache embeddings. |
| LangChain version conflicts | Pin versions. Test locally before deploying. |
| API key leaked via logs | Never log request bodies. Only log metadata (endpoint, status, duration). |
| Existing data not embedded | Backfill script runs once. New data auto-embeds. |
