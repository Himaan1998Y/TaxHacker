import { getCurrentUser } from "@/lib/auth"
import { generateTallyXML } from "@/lib/tally-export"
import { getTransactions } from "@/models/transactions"
import { NextResponse } from "next/server"

export async function GET(request: Request) {
  const url = new URL(request.url)
  const filters = Object.fromEntries(url.searchParams.entries())

  const user = await getCurrentUser()
  const { transactions } = await getTransactions(user.id, filters)

  const xml = generateTallyXML(transactions)

  return new NextResponse(xml, {
    headers: {
      "Content-Type": "application/xml",
      "Content-Disposition": `attachment; filename="TaxHacker_Tally_Export.xml"`,
    },
  })
}
