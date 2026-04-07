import { NextRequest, NextResponse } from "next/server"
import { authenticateAgent } from "../auth"
import { getTransactions } from "@/models/transactions"
import { getSettings } from "@/models/settings"
import { generateGSTR1Report, generateGSTR1JSON } from "@/lib/gstr1"
import { getGSTRPeriodDates, validateGSTRPeriod } from "@/lib/indian-fy"

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

  const report = generateGSTR1Report(transactions, businessStateCode)

  if (format === "json") {
    const portalJSON = generateGSTR1JSON(report, settings.business_gstin || "", periodValue)
    return NextResponse.json({ gstr1: portalJSON, period: periodValue })
  }

  return NextResponse.json({ report, period: periodValue })
}
