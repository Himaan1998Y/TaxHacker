import { prisma } from "@/lib/db"
import { Transaction } from "@/prisma/client"
import { getSettings } from "@/models/settings"

const EMBEDDING_DIMENSION = 768

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
 */
export async function storeTransactionEmbedding(
  transactionId: string,
  embedding: number[]
): Promise<void> {
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
export async function findSimilarTransactions(
  embedding: number[],
  userId: string,
  limit: number = 5,
  excludeId?: string
): Promise<Array<{ id: string; name: string; merchant: string; total: number; similarity: number }>> {
  const vectorStr = `[${embedding.join(",")}]`

  let query = `
    SELECT id, name, merchant, total,
           1 - ("embedding" <=> $1::vector) as similarity
    FROM "transactions"
    WHERE "user_id" = $2::uuid
      AND "embedding" IS NOT NULL
  `
  const params: any[] = [vectorStr, userId]

  if (excludeId) {
    query += ` AND "id" != $3::uuid`
    params.push(excludeId)
  }

  query += ` ORDER BY "embedding" <=> $1::vector LIMIT $${params.length + 1}`
  params.push(limit)

  const results = await prisma.$queryRawUnsafe(query, ...params)
  return results as any[]
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
