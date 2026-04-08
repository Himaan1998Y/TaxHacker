import { getCurrentUser } from "@/lib/auth"
import { generateGSTR3B, generateGSTR3BJSON } from "@/lib/gstr3b"
import { getSettings } from "@/models/settings"
import { getTransactions } from "@/models/transactions"
import { NextRequest } from "next/server"

export async function GET(req: NextRequest) {
  const user = await getCurrentUser()
  const month = Number(req.nextUrl.searchParams.get("month"))
  const year = Number(req.nextUrl.searchParams.get("year"))

  if (!month || !year || month < 1 || month > 12) {
    return new Response("Invalid month/year", { status: 400 })
  }

  const [{ transactions }, settings] = await Promise.all([
    getTransactions(user.id),
    getSettings(user.id),
  ])

  const periodTransactions = transactions.filter((tx) => {
    const d = tx.issuedAt ? new Date(tx.issuedAt) : null
    return d && d.getMonth() + 1 === month && d.getFullYear() === year
  })

  const filingPeriod = `${String(month).padStart(2, "0")}${year}`
  const businessGSTIN = settings["business_gstin"] || ""
  const businessStateCode = settings["business_state_code"] || null

  const report = generateGSTR3B(periodTransactions, businessStateCode, businessGSTIN, filingPeriod)
  const json = generateGSTR3BJSON(report)
  const filename = `GSTR3B_${businessGSTIN || "UNKNOWN"}_${filingPeriod}.json`

  return new Response(JSON.stringify(json, null, 2), {
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  })
}
