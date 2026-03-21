import { getCurrentUser } from "@/lib/auth"
import { getSettings } from "@/models/settings"
import { getTransactions } from "@/models/transactions"
import { manifest } from "./manifest"
import { GSTR3BReport } from "./components/gstr3b-report"

export default async function GSTR3BApp() {
  const user = await getCurrentUser()
  const settings = await getSettings(user.id)
  const { transactions } = await getTransactions(user.id)

  const serializedTransactions = transactions.map(tx => ({
    ...tx,
    issuedAt: tx.issuedAt?.toISOString() || null,
    createdAt: tx.createdAt.toISOString(),
    updatedAt: tx.updatedAt.toISOString(),
  }))

  return (
    <div>
      <header className="flex flex-wrap items-center justify-between gap-2 mb-8">
        <h2 className="flex flex-row gap-3 md:gap-5">
          <span className="text-3xl font-bold tracking-tight">
            {manifest.icon} {manifest.name}
          </span>
        </h2>
      </header>
      <GSTR3BReport
        transactions={serializedTransactions}
        businessGSTIN={settings.business_gstin || ""}
        businessStateCode={settings.business_state_code || ""}
      />
    </div>
  )
}
