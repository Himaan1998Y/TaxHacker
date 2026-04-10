import { prisma } from "@/lib/db"
import { Transaction } from "@/prisma/client"
import { getSettings } from "@/models/settings"

const EMBEDDING_DIMENSION = 768

// ─── pgvector capability probe ──────────────────────────────────────
//
// The embedding pipeline depends on three things being present in the
// live database:
//   1. the `vector` extension installed
//   2. the `embedding vector(768)` column on the transactions table
//   3. the `hnsw` search index
//
// docker-entrypoint.sh tries to set all three up on every container boot
// with `|| echo pgvector not available`. If any step fails (Coolify's
// default postgres image doesn't ship pgvector, for example), the boot
// continues but every call into this module would then throw at the
// first $queryRawUnsafe — and before the fix below those throws were
// being silently swallowed by the caller's try/catch, turning the entire
// embeddings feature into a ghost that looked healthy in logs.
//
// This probe does one cheap `SELECT pg_typeof('[0]'::vector)` — if it
// succeeds the column+extension are both present; if it throws we cache
// the negative result for the life of the process and turn every
// embedding operation into a no-op with a visible warning.
let pgvectorAvailable: boolean | null = null
let pgvectorProbePromise: Promise<boolean> | null = null

async function hasPgvector(): Promise<boolean> {
  if (pgvectorAvailable !== null) return pgvectorAvailable
  if (pgvectorProbePromise) return pgvectorProbePromise

  pgvectorProbePromise = (async () => {
    try {
      // The probe uses the extension's own type constructor. If the
      // extension is missing, Postgres errors with "type vector does
      // not exist"; if the column is missing but the extension is
      // installed, this still succeeds — which is the right answer
      // because storeTransactionEmbedding's writer also creates the
      // column via docker-entrypoint.sh on boot. A separate probe for
      // the column would double the warning noise without changing
      // behaviour.
      await prisma.$queryRawUnsafe(`SELECT '[0]'::vector`)
      pgvectorAvailable = true
    } catch {
      pgvectorAvailable = false
      console.warn(
        "[embeddings] pgvector extension not available — semantic search, " +
          "duplicate detection and embedding storage are disabled for this " +
          "process. To enable, run the SQL in prisma/optional_pgvector_setup.sql " +
          "against your database and restart the container."
      )
    } finally {
      pgvectorProbePromise = null
    }
    return pgvectorAvailable!
  })()

  return pgvectorProbePromise
}

// Exported so tests can force a specific probe state without having to
// juggle prisma mocks. Also usable from an admin/settings page later.
export function _resetPgvectorProbe(state: boolean | null = null): void {
  pgvectorAvailable = state
  pgvectorProbePromise = null
}

export async function isPgvectorAvailable(): Promise<boolean> {
  return hasPgvector()
}

/**
 * Build a text representation of a transaction for embedding.
 * Combines the most semantically meaningful fields.
 */
export function transactionToText(tx: {
  name?: string | null
  merchant?: string | null
  description?: string | null
  note?: string | null
  total?: number | null
  type?: string | null
  categoryCode?: string | null
  extra?: Record<string, unknown> | null
}): string {
  const parts: string[] = []

  if (tx.name) parts.push(tx.name)
  if (tx.merchant) parts.push(`merchant: ${tx.merchant}`)
  if (tx.description) parts.push(tx.description)
  if (tx.type) parts.push(`type: ${tx.type}`)
  if (tx.total != null) parts.push(`amount: ${tx.total.toFixed(2)}`)
  if (tx.categoryCode) parts.push(`category: ${tx.categoryCode}`)
  if (tx.note) parts.push(tx.note)

  // Include key GST fields from extra if present
  const extra = tx.extra as Record<string, unknown> | null
  if (extra) {
    if (extra.invoice_number) parts.push(`invoice: ${extra.invoice_number}`)
    if (extra.gstin) parts.push(`GSTIN: ${extra.gstin}`)
    if (extra.hsn_sac_code) parts.push(`HSN: ${extra.hsn_sac_code}`)
  }

  return parts.join(" | ")
}

/**
 * Generate embedding using Gemini Embedding API (free tier).
 * Falls back to a simple hash-based embedding if API fails (for development).
 */
export async function generateEmbedding(text: string, userId?: string): Promise<number[]> {
  // Try Gemini Embedding API first (free, 768 dimensions)
  let apiKey: string | undefined

  if (userId) {
    const settings = await getSettings(userId)
    apiKey = settings.google_api_key
  }

  if (!apiKey) {
    apiKey = process.env.GOOGLE_API_KEY
  }

  if (apiKey) {
    try {
      return await geminiEmbed(text, apiKey)
    } catch (error) {
      console.warn("Gemini embedding failed, using fallback:", error)
    }
  }

  // Fallback: deterministic hash-based embedding (for dev/testing only)
  console.warn("No embedding API available. Using hash fallback (not suitable for production).")
  return hashEmbedding(text)
}

/**
 * Call Gemini Embedding API directly (no LangChain dependency).
 * Free tier: 1500 RPM, model: text-embedding-004
 */
async function geminiEmbed(text: string, apiKey: string): Promise<number[]> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:embedContent?key=${apiKey}`

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "models/text-embedding-004",
      content: { parts: [{ text }] },
      outputDimensionality: EMBEDDING_DIMENSION,
    }),
  })

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`Gemini Embedding API error ${response.status}: ${error}`)
  }

  const data = await response.json()
  return data.embedding.values
}

/**
 * Deterministic hash-based embedding fallback.
 * NOT for production — only for testing without an API key.
 */
function hashEmbedding(text: string): number[] {
  const embedding = new Array(EMBEDDING_DIMENSION).fill(0)
  for (let i = 0; i < text.length; i++) {
    const idx = i % EMBEDDING_DIMENSION
    embedding[idx] += text.charCodeAt(i) / 1000
  }
  // Normalize to unit vector
  const magnitude = Math.sqrt(embedding.reduce((sum: number, val: number) => sum + val * val, 0)) || 1
  return embedding.map((val: number) => val / magnitude)
}

/**
 * Store embedding for a transaction using raw SQL (Prisma doesn't support vector type).
 * No-op (with a one-time warning) when pgvector is not available.
 */
export async function storeTransactionEmbedding(
  transactionId: string,
  embedding: number[]
): Promise<void> {
  if (!(await hasPgvector())) return
  const vectorStr = `[${embedding.join(",")}]`
  await prisma.$executeRawUnsafe(
    `UPDATE "transactions" SET "embedding" = $1::vector WHERE "id" = $2::uuid`,
    vectorStr,
    transactionId
  )
}

/**
 * Embed a transaction: generate + store.
 */
export async function embedTransaction(tx: Transaction): Promise<void> {
  const text = transactionToText({
    ...tx,
    extra: tx.extra as Record<string, unknown> | null,
  })
  if (!text.trim()) return

  try {
    const embedding = await generateEmbedding(text, tx.userId)
    await storeTransactionEmbedding(tx.id, embedding)
  } catch (error) {
    // Non-critical: log and continue. Transaction still saved.
    console.warn(`Failed to embed transaction ${tx.id}:`, error)
  }
}

/**
 * Find similar transactions using cosine similarity.
 * Returns transactions ordered by similarity (most similar first).
 */
type SimilarTransactionRow = {
  id: string
  name: string
  merchant: string
  total: number
  similarity: number
}

export async function findSimilarTransactions(
  embedding: number[],
  userId: string,
  limit: number = 5,
  excludeId?: string
): Promise<SimilarTransactionRow[]> {
  if (!(await hasPgvector())) return []
  const vectorStr = `[${embedding.join(",")}]`

  if (excludeId) {
    // Query with excludeId filter: $3 and $4 for excludeId and limit
    const query = `
      SELECT id, name, merchant, total,
             1 - ("embedding" <=> $1::vector) as similarity
      FROM "transactions"
      WHERE "user_id" = $2::uuid
        AND "embedding" IS NOT NULL
        AND "id" != $3::uuid
      ORDER BY "embedding" <=> $1::vector
      LIMIT $4
    `
    const results = await prisma.$queryRawUnsafe<SimilarTransactionRow[]>(
      query,
      vectorStr,
      userId,
      excludeId,
      limit
    )
    return results
  } else {
    // Query without excludeId filter: $3 for limit
    const query = `
      SELECT id, name, merchant, total,
             1 - ("embedding" <=> $1::vector) as similarity
      FROM "transactions"
      WHERE "user_id" = $2::uuid
        AND "embedding" IS NOT NULL
      ORDER BY "embedding" <=> $1::vector
      LIMIT $3
    `
    const results = await prisma.$queryRawUnsafe<SimilarTransactionRow[]>(
      query,
      vectorStr,
      userId,
      limit
    )
    return results
  }
}

/**
 * Detect potential duplicate transactions.
 * Returns matches with similarity > threshold (default 0.92).
 */
export async function detectDuplicates(
  embedding: number[],
  userId: string,
  threshold: number = 0.92,
  excludeId?: string
): Promise<Array<{ id: string; name: string; merchant: string; total: number; similarity: number }>> {
  const similar = await findSimilarTransactions(embedding, userId, 5, excludeId)
  return similar.filter((s) => s.similarity >= threshold)
}

/**
 * Semantic search across transactions.
 */
export async function semanticSearch(
  query: string,
  userId: string,
  limit: number = 20
): Promise<Array<{ id: string; name: string; merchant: string; total: number; type: string; issuedAt: Date; similarity: number }>> {
  if (!(await hasPgvector())) return []
  const embedding = await generateEmbedding(query, userId)
  const vectorStr = `[${embedding.join(",")}]`

  const results = await prisma.$queryRawUnsafe(
    `
    SELECT id, name, merchant, total, type, issued_at as "issuedAt",
           1 - ("embedding" <=> $1::vector) as similarity
    FROM "transactions"
    WHERE "user_id" = $2::uuid
      AND "embedding" IS NOT NULL
    ORDER BY "embedding" <=> $1::vector
    LIMIT $3
    `,
    vectorStr,
    userId,
    limit
  )

  return results as any[]
}
