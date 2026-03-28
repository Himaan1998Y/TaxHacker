import { NextRequest, NextResponse } from "next/server"
import { authenticateAgent } from "../auth"
import { semanticSearch } from "@/lib/embeddings"

/**
 * GET /api/agent/search?q=office+supplies — Semantic search across transactions
 *
 * Uses pgvector cosine similarity to find transactions by meaning, not just keywords.
 * "office supplies" will find "stationery", "printer cartridge", etc.
 *
 * Query params:
 *   q: search query (required)
 *   limit: max results (default 20, max 100)
 */
export async function GET(req: NextRequest) {
  const authResult = await authenticateAgent(req)
  if (authResult instanceof NextResponse) return authResult
  const { user } = authResult

  const params = req.nextUrl.searchParams
  const query = params.get("q")
  const limit = Math.min(100, Math.max(1, parseInt(params.get("limit") || "20")))

  if (!query) {
    return NextResponse.json(
      { error: "Query parameter 'q' is required" },
      { status: 400 }
    )
  }

  try {
    const results = await semanticSearch(query, user.id, limit)
    return NextResponse.json({
      query,
      results,
      count: results.length,
    })
  } catch (error: any) {
    // pgvector not enabled yet — fall back gracefully
    if (error.message?.includes("vector") || error.code === "42883") {
      return NextResponse.json(
        { error: "Embeddings not yet configured. Run the pgvector migration first." },
        { status: 501 }
      )
    }
    console.error("Agent API: search error:", error)
    return NextResponse.json(
      { error: "Search failed" },
      { status: 500 }
    )
  }
}
