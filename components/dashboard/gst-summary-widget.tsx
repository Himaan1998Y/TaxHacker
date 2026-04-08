import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { formatNumber } from "@/lib/utils"
import { type GSTSummaryResult } from "@/models/transactions"
import { IndianRupee } from "lucide-react"

export function GSTSummaryWidget({ gst }: { gst: GSTSummaryResult }) {

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
