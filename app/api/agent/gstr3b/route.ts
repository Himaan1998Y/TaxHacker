import { NextRequest, NextResponse } from "next/server"
import { authenticateAgent } from "../auth"
import { getTransactions } from "@/models/transactions"
import { getSettings } from "@/models/settings"
import { generateGSTR3B, generateGSTR3BJSON } from "@/lib/gstr3b"

/**
 * GET /api/agent/gstr3b?period=032026 — Generate GSTR-3B summary
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

  const month = parseInt(period.slice(0, 2)) - 1
  const year = parseInt(period.slice(2))

  if (month < 0 || month > 11 || year < 2017) {
    return NextResponse.json(
      { error: "Invalid period. Month must be 01-12, year must be >= 2017." },
      { status: 400 }
    )
  }

  const dateFrom = new Date(year, month, 1)
  const dateTo = new Date(year, month + 1, 0, 23, 59, 59)

  const { transactions } = await getTransactions(user.id, {
    dateFrom: dateFrom.toISOString(),
    dateTo: dateTo.toISOString(),
  })

  const settings = await getSettings(user.id)
  const businessStateCode = settings.business_state_code || null
  const businessGSTIN = settings.business_gstin || ""

  const report = generateGSTR3B(
    transactions,
    businessStateCode,
    businessGSTIN,
    period
  )

  if (format === "json") {
    const portalJSON = generateGSTR3BJSON(report)
    return NextResponse.json({ gstr3b: portalJSON, period })
  }

  return NextResponse.json({ report, period })
}
