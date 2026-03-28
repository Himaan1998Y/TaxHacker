import { NextRequest, NextResponse } from "next/server"
import { authenticateAgent } from "../auth"
import { getTransactions } from "@/models/transactions"
import { getSettings } from "@/models/settings"
import { generateGSTR1Report, generateGSTR1JSON } from "@/lib/gstr1"

/**
 * GET /api/agent/gstr1?period=032026 — Generate GSTR-1 report
 *
 * Query params:
 *   period: MMYYYY format (e.g., "032026" for March 2026)
 *   format: "summary" (default) or "json" (GSTN portal format)
 */
export async function GET(req: NextRequest) {
  const authResult = await authenticateAgent(req)
  if (authResult instanceof NextResponse) return authResult
  const { user } = authResult

  const params = req.nextUrl.searchParams
  const period = params.get("period")
  const format = params.get("format") || "summary"

  if (!period || period.length !== 6) {
    return NextResponse.json(
      { error: "period is required in MMYYYY format (e.g., 032026 for March 2026)" },
      { status: 400 }
    )
  }

  const month = parseInt(period.slice(0, 2)) - 1 // JS months are 0-indexed
  const year = parseInt(period.slice(2))

  if (month < 0 || month > 11 || year < 2017) {
    return NextResponse.json(
      { error: "Invalid period. Month must be 01-12, year must be >= 2017." },
      { status: 400 }
    )
  }

  const dateFrom = new Date(year, month, 1)
  const dateTo = new Date(year, month + 1, 0, 23, 59, 59) // last day of month

  const { transactions } = await getTransactions(user.id, {
    dateFrom: dateFrom.toISOString(),
    dateTo: dateTo.toISOString(),
  })

  const settings = await getSettings(user.id)
  const businessStateCode = settings.business_state_code || null

  const report = generateGSTR1Report(transactions, businessStateCode)

  if (format === "json") {
    const portalJSON = generateGSTR1JSON(report, settings.business_gstin || "", period)
    return NextResponse.json({ gstr1: portalJSON, period })
  }

  return NextResponse.json({ report, period })
}
