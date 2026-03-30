import { NextRequest, NextResponse } from "next/server"
import { authenticateAgent } from "../../auth"
import {
  getTransactionById,
  updateTransaction,
  reverseTransaction,
} from "@/models/transactions"

/**
 * GET /api/agent/transactions/:id — Get a single transaction
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authResult = await authenticateAgent(req)
  if (authResult instanceof NextResponse) return authResult
  const { user } = authResult

  const { id } = await params
  const transaction = await getTransactionById(id, user.id)

  if (!transaction) {
    return NextResponse.json({ error: "Transaction not found" }, { status: 404 })
  }

  return NextResponse.json({ transaction })
}

/**
 * PATCH /api/agent/transactions/:id — Update a transaction
 *
 * Body: partial transaction fields to update
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authResult = await authenticateAgent(req)
  if (authResult instanceof NextResponse) return authResult
  const { user } = authResult

  const { id } = await params

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  // Verify transaction exists
  const existing = await getTransactionById(id, user.id)
  if (!existing) {
    return NextResponse.json({ error: "Transaction not found" }, { status: 404 })
  }

  try {
    const transaction = await updateTransaction(id, user.id, {
      name: body.name as string | undefined,
      merchant: body.merchant as string | undefined,
      total: body.total != null ? Number(body.total) : undefined,
      currencyCode: body.currencyCode as string | undefined,
      type: body.type as string | undefined,
      categoryCode: body.categoryCode as string | undefined,
      projectCode: body.projectCode as string | undefined,
      issuedAt: body.issuedAt ? new Date(body.issuedAt as string) : undefined,
      description: body.description as string | undefined,
      note: body.note as string | undefined,
      extra: body.extra as Record<string, unknown> | undefined,
    })

    return NextResponse.json({ transaction })
  } catch (error) {
    console.error("Agent API: update transaction error:", error)
    return NextResponse.json(
      { error: "Failed to update transaction" },
      { status: 500 }
    )
  }
}

/**
 * DELETE /api/agent/transactions/:id — Delete a transaction
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authResult = await authenticateAgent(req)
  if (authResult instanceof NextResponse) return authResult
  const { user } = authResult

  const { id } = await params

  const existing = await getTransactionById(id, user.id)
  if (!existing) {
    return NextResponse.json({ error: "Transaction not found" }, { status: 404 })
  }

  try {
    const reversed = await reverseTransaction(id, user.id)
    return NextResponse.json({ success: true, transaction: reversed })
  } catch (error) {
    console.error("Agent API: reverse transaction error:", error)
    return NextResponse.json(
      { error: "Failed to reverse transaction" },
      { status: 500 }
    )
  }
}
