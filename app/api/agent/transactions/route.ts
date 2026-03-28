import { NextRequest, NextResponse } from "next/server"
import { authenticateAgent } from "../auth"
import {
  getTransactions,
  createTransaction,
  TransactionFilters,
} from "@/models/transactions"

/**
 * GET /api/agent/transactions — List transactions with filters
 *
 * Query params:
 *   search, dateFrom, dateTo, ordering, categoryCode, projectCode, type
 *   page (default 1), limit (default 50, max 200)
 */
export async function GET(req: NextRequest) {
  const authResult = await authenticateAgent(req)
  if (authResult instanceof NextResponse) return authResult
  const { user } = authResult

  const params = req.nextUrl.searchParams
  const page = Math.max(1, parseInt(params.get("page") || "1"))
  const limit = Math.min(200, Math.max(1, parseInt(params.get("limit") || "50")))

  const filters: TransactionFilters = {
    search: params.get("search") || undefined,
    dateFrom: params.get("dateFrom") || undefined,
    dateTo: params.get("dateTo") || undefined,
    ordering: params.get("ordering") || undefined,
    categoryCode: params.get("categoryCode") || undefined,
    projectCode: params.get("projectCode") || undefined,
    type: params.get("type") || undefined,
  }

  const { transactions, total } = await getTransactions(user.id, filters, {
    limit,
    offset: (page - 1) * limit,
  })

  return NextResponse.json({
    transactions,
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
  })
}

/**
 * POST /api/agent/transactions — Create a new transaction
 *
 * Body: { name, merchant, total, type, currencyCode, categoryCode, projectCode, issuedAt, extra, ... }
 * Note: total is in paisa (integer cents). ₹50,000 = 5000000
 */
export async function POST(req: NextRequest) {
  const authResult = await authenticateAgent(req)
  if (authResult instanceof NextResponse) return authResult
  const { user } = authResult

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  if (!body.name && !body.merchant) {
    return NextResponse.json(
      { error: "At least one of 'name' or 'merchant' is required" },
      { status: 400 }
    )
  }

  try {
    const transaction = await createTransaction(user.id, {
      name: (body.name as string) || null,
      merchant: (body.merchant as string) || null,
      total: body.total != null ? Number(body.total) : null,
      currencyCode: (body.currencyCode as string) || "INR",
      type: (body.type as string) || "expense",
      categoryCode: (body.categoryCode as string) || null,
      projectCode: (body.projectCode as string) || null,
      issuedAt: body.issuedAt ? new Date(body.issuedAt as string) : new Date(),
      description: (body.description as string) || null,
      note: (body.note as string) || null,
      files: body.files as string[] | undefined,
      extra: body.extra as Record<string, unknown> | undefined,
    })

    return NextResponse.json({ transaction }, { status: 201 })
  } catch (error) {
    console.error("Agent API: create transaction error:", error)
    return NextResponse.json(
      { error: "Failed to create transaction" },
      { status: 500 }
    )
  }
}
