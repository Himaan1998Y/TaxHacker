import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { formatNumber } from "@/lib/utils"
import { getCurrentUser } from "@/lib/auth"
import { getTransactions, TransactionFilters } from "@/models/transactions"
import { IndianRupee } from "lucide-react"

type GSTSlabSummary = {
  rate: number
  inputGST: number
  outputGST: number
}

function aggregateGST(transactions: any[]): {
  slabs: GSTSlabSummary[]
  totalInput: number
  totalOutput: number
  netPayable: number
} {
  const slabMap: Record<number, { input: number; output: number }> = {}

  for (const tx of transactions) {
    const extra = tx.extra as Record<string, any> | null
    if (!extra) continue

    const gstRate = Number(extra.gst_rate) || 0
    if (gstRate <= 0) continue

    const cgst = Number(extra.cgst) || 0
    const sgst = Number(extra.sgst) || 0
    const igst = Number(extra.igst) || 0
    const totalGST = cgst + sgst + igst

    if (totalGST <= 0) continue

    if (!slabMap[gstRate]) {
      slabMap[gstRate] = { input: 0, output: 0 }
    }

    if (tx.type === "expense") {
      slabMap[gstRate].input += totalGST
    } else {
      slabMap[gstRate].output += totalGST
    }
  }

  const slabs = Object.entries(slabMap)
    .map(([rate, data]) => ({
      rate: Number(rate),
      inputGST: Math.round(data.input * 100) / 100,
      outputGST: Math.round(data.output * 100) / 100,
    }))
    .sort((a, b) => a.rate - b.rate)

  const totalInput = slabs.reduce((sum, s) => sum + s.inputGST, 0)
  const totalOutput = slabs.reduce((sum, s) => sum + s.outputGST, 0)

  return {
    slabs,
    totalInput: Math.round(totalInput * 100) / 100,
    totalOutput: Math.round(totalOutput * 100) / 100,
    netPayable: Math.round((totalOutput - totalInput) * 100) / 100,
  }
}

export async function GSTSummaryWidget({ filters }: { filters: TransactionFilters }) {
  const user = await getCurrentUser()
  const { transactions } = await getTransactions(user.id, filters)

  const gst = aggregateGST(transactions)

  // Don't render if no GST data
  if (gst.slabs.length === 0) return null

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <IndianRupee className="h-4 w-4" />
          GST Summary
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {/* Slab breakdown */}
          <div className="grid grid-cols-4 gap-2 text-xs text-muted-foreground font-medium">
            <div>Rate</div>
            <div className="text-right">Input (Paid)</div>
            <div className="text-right">Output (Collected)</div>
            <div className="text-right">Net</div>
          </div>

          {gst.slabs.map((slab) => (
            <div key={slab.rate} className="grid grid-cols-4 gap-2 text-sm">
              <div className="font-medium">{slab.rate}%</div>
              <div className="text-right text-red-600">₹{formatNumber(slab.inputGST)}</div>
              <div className="text-right text-green-600">₹{formatNumber(slab.outputGST)}</div>
              <div className={`text-right font-medium ${slab.outputGST - slab.inputGST >= 0 ? "text-red-600" : "text-green-600"}`}>
                ₹{formatNumber(Math.abs(slab.outputGST - slab.inputGST))}
              </div>
            </div>
          ))}

          {/* Totals */}
          <div className="border-t pt-2 grid grid-cols-4 gap-2 text-sm font-semibold">
            <div>Total</div>
            <div className="text-right text-red-600">₹{formatNumber(gst.totalInput)}</div>
            <div className="text-right text-green-600">₹{formatNumber(gst.totalOutput)}</div>
            <div className={`text-right ${gst.netPayable >= 0 ? "text-red-600" : "text-green-600"}`}>
              ₹{formatNumber(Math.abs(gst.netPayable))}
            </div>
          </div>

          {/* Net payable summary */}
          <div className="bg-muted/50 rounded-md p-3 text-sm">
            {gst.netPayable >= 0 ? (
              <span>GST Payable: <strong className="text-red-600">₹{formatNumber(gst.netPayable)}</strong></span>
            ) : (
              <span>ITC Refundable: <strong className="text-green-600">₹{formatNumber(Math.abs(gst.netPayable))}</strong></span>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
