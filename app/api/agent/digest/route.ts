import { NextRequest, NextResponse } from "next/server"
import { authenticateAgent } from "../auth"
import { getDashboardStats } from "@/models/stats"
import { getTransactions } from "@/models/transactions"

/**
 * GET /api/agent/digest — Daily/period business digest
 *
 * Query params:
 *   date: "today", "yesterday", or ISO date (YYYY-MM-DD)
 *   dateFrom: ISO date (for custom range)
 *   dateTo: ISO date (for custom range)
 */
export async function GET(req: NextRequest) {
  const authResult = await authenticateAgent(req)
  if (authResult instanceof NextResponse) return authResult
  const { user } = authResult

  const params = req.nextUrl.searchParams
  const dateParam = params.get("date")
  let dateFrom = params.get("dateFrom")
  let dateTo = params.get("dateTo")

  // Handle shorthand date params
  if (dateParam === "today" || (!dateParam && !dateFrom)) {
    const today = new Date()
    dateFrom = new Date(today.getFullYear(), today.getMonth(), today.getDate()).toISOString()
    dateTo = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 23, 59, 59).toISOString()
  } else if (dateParam === "yesterday") {
    const yesterday = new Date()
    yesterday.setDate(yesterday.getDate() - 1)
    dateFrom = new Date(yesterday.getFullYear(), yesterday.getMonth(), yesterday.getDate()).toISOString()
    dateTo = new Date(yesterday.getFullYear(), yesterday.getMonth(), yesterday.getDate(), 23, 59, 59).toISOString()
  } else if (dateParam) {
    const d = new Date(dateParam)
    dateFrom = new Date(d.getFullYear(), d.getMonth(), d.getDate()).toISOString()
    dateTo = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59).toISOString()
  }

  const filters = {
    dateFrom: dateFrom || undefined,
    dateTo: dateTo || undefined,
  }

  const [stats, { transactions, total }] = await Promise.all([
    getDashboardStats(user.id, filters),
    getTransactions(user.id, filters, { limit: 10, offset: 0 }),
  ])

  // Also get month-to-date stats
  const now = new Date()
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString()
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59).toISOString()

  const mtdStats = await getDashboardStats(user.id, {
    dateFrom: monthStart,
    dateTo: monthEnd,
  })

  return NextResponse.json({
    period: { dateFrom, dateTo },
    stats,
    recentTransactions: transactions,
    transactionCount: total,
    monthToDate: mtdStats,
  })
}
