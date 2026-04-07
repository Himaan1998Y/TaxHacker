import { NextRequest, NextResponse } from "next/server"
import { authenticateAgent } from "../auth"
import { getTransactions } from "@/models/transactions"
import { getSettings } from "@/models/settings"
import { generateGSTR3B, generateGSTR3BJSON } from "@/lib/gstr3b"
import { getGSTRPeriodDates, validateGSTRPeriod } from "@/lib/indian-fy"

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
  const periodValue = period || ""

  const validation = validateGSTRPeriod(periodValue)
  if (!validation.valid) {
    return NextResponse.json(
      { error: validation.error || "Invalid period." },
      { status: 400 }
    )
  }

  const { start: dateFrom, end: dateTo } = getGSTRPeriodDates(periodValue)

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
    periodValue,
    (settings as any).itc_blocked_categories || []
  )

  if (format === "json") {
    const portalJSON = generateGSTR3BJSON(report)
    return NextResponse.json({ gstr3b: portalJSON, period: periodValue })
  }

  return NextResponse.json({ report, period: periodValue })
}
