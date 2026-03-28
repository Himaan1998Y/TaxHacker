import { NextRequest, NextResponse } from "next/server"
import { authenticateAgent } from "../auth"
import { prisma } from "@/lib/db"
import {
  generateEmbedding,
  storeTransactionEmbedding,
  transactionToText,
} from "@/lib/embeddings"

/**
 * POST /api/agent/embeddings/backfill — Generate embeddings for all transactions without one
 *
 * Processes in batches to avoid rate limits.
 * Query params:
 *   batchSize: number of transactions per batch (default 50, max 200)
 */
export async function POST(req: NextRequest) {
  const authResult = await authenticateAgent(req)
  if (authResult instanceof NextResponse) return authResult
  const { user } = authResult

  const params = req.nextUrl.searchParams
  const batchSize = Math.min(200, Math.max(1, parseInt(params.get("batchSize") || "50")))

  try {
    // Find transactions without embeddings using raw query
    const transactions: any[] = await prisma.$queryRawUnsafe(
      `SELECT id, name, merchant, description, note, total, type, category_code as "categoryCode", extra
       FROM "transactions"
       WHERE "user_id" = $1::uuid AND "embedding" IS NULL
       LIMIT $2`,
      user.id,
      batchSize
    )

    if (transactions.length === 0) {
      return NextResponse.json({
        processed: 0,
        remaining: 0,
        message: "All transactions already have embeddings",
      })
    }

    let processed = 0
    let failed = 0

    for (const tx of transactions) {
      const text = transactionToText(tx)
      if (!text.trim()) {
        failed++
        continue
      }

      try {
        const embedding = await generateEmbedding(text, user.id)
        await storeTransactionEmbedding(tx.id, embedding)
        processed++
      } catch (error) {
        console.warn(`Failed to embed transaction ${tx.id}:`, error)
        failed++
      }

      // Small delay to respect rate limits (Gemini free: 1500 RPM)
      if (processed % 10 === 0) {
        await new Promise((resolve) => setTimeout(resolve, 500))
      }
    }

    // Count remaining
    const remaining: any[] = await prisma.$queryRawUnsafe(
      `SELECT COUNT(*) as count FROM "transactions" WHERE "user_id" = $1::uuid AND "embedding" IS NULL`,
      user.id
    )

    return NextResponse.json({
      processed,
      failed,
      remaining: Number(remaining[0]?.count || 0),
      message: processed > 0
        ? `Embedded ${processed} transactions. ${Number(remaining[0]?.count || 0)} remaining.`
        : "No transactions to process",
    })
  } catch (error: any) {
    if (error.message?.includes("vector") || error.code === "42883") {
      return NextResponse.json(
        { error: "pgvector extension not enabled. Run the migration first." },
        { status: 501 }
      )
    }
    console.error("Agent API: backfill error:", error)
    return NextResponse.json({ error: "Backfill failed" }, { status: 500 })
  }
}

/**
 * GET /api/agent/embeddings — Check embedding status
 */
export async function GET(req: NextRequest) {
  const authResult = await authenticateAgent(req)
  if (authResult instanceof NextResponse) return authResult
  const { user } = authResult

  try {
    const stats: any[] = await prisma.$queryRawUnsafe(
      `SELECT
        COUNT(*) as total,
        COUNT("embedding") as embedded,
        COUNT(*) - COUNT("embedding") as missing
       FROM "transactions"
       WHERE "user_id" = $1::uuid`,
      user.id
    )

    return NextResponse.json({
      total: Number(stats[0]?.total || 0),
      embedded: Number(stats[0]?.embedded || 0),
      missing: Number(stats[0]?.missing || 0),
    })
  } catch (error: any) {
    if (error.message?.includes("embedding") || error.code === "42703") {
      return NextResponse.json({
        total: 0,
        embedded: 0,
        missing: 0,
        note: "pgvector migration not yet applied",
      })
    }
    return NextResponse.json({ error: "Failed to check status" }, { status: 500 })
  }
}
