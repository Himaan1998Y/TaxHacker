"use client"

import { calculateGST, type GSTBreakdown } from "@/lib/indian-tax-utils"
import { isInterState, stateCodeFromGSTIN } from "@/lib/indian-states"
import { formatNumber } from "@/lib/utils"
import { useEffect, useMemo, useState } from "react"
import { Button } from "../ui/button"

export const GSTCalculatorTool = ({
  total,
  gstRate,
  supplierGSTIN,
  businessStateCode,
  existingCGST,
  existingSGST,
  existingIGST,
  onChange,
}: {
  total: number
  gstRate: number
  supplierGSTIN?: string
  businessStateCode?: string
  existingCGST?: number
  existingSGST?: number
  existingIGST?: number
  onChange?: (values: Record<string, number>) => void
}) => {
  const [isTaxInclusive, setIsTaxInclusive] = useState(true)

  // Detect inter-state from GSTINs
  const supplierStateCode = useMemo(
    () => (supplierGSTIN ? stateCodeFromGSTIN(supplierGSTIN) : null),
    [supplierGSTIN]
  )

  const isInterStateTransaction = useMemo(() => {
    if (supplierStateCode && businessStateCode) {
      return isInterState(supplierStateCode, businessStateCode)
    }
    // If we have existing IGST value, it's inter-state
    if (existingIGST && existingIGST > 0) return true
    // If we have existing CGST/SGST, it's intra-state
    if ((existingCGST && existingCGST > 0) || (existingSGST && existingSGST > 0)) return false
    // Default: intra-state (same state)
    return false
  }, [supplierStateCode, businessStateCode, existingCGST, existingSGST, existingIGST])

  const breakdown: GSTBreakdown = useMemo(
    () => calculateGST(total, gstRate, isInterStateTransaction, 0, isTaxInclusive),
    [total, gstRate, isInterStateTransaction, isTaxInclusive]
  )

  // Don't render if no meaningful data
  if (!total || !gstRate || gstRate <= 0) {
    return <></>
  }

  const handleFillFields = () => {
    onChange?.({
      cgst: breakdown.cgst,
      sgst: breakdown.sgst,
      igst: breakdown.igst,
    })
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2 text-xs">
        <button
          type="button"
          onClick={() => setIsTaxInclusive(true)}
          className={`px-2 py-1 rounded ${isTaxInclusive ? "bg-purple-600 text-white" : "bg-gray-200 text-gray-700"}`}
        >
          Tax Inclusive
        </button>
        <button
          type="button"
          onClick={() => setIsTaxInclusive(false)}
          className={`px-2 py-1 rounded ${!isTaxInclusive ? "bg-purple-600 text-white" : "bg-gray-200 text-gray-700"}`}
        >
          Tax Exclusive
        </button>
        <span className="text-muted-foreground ml-2">
          {isInterStateTransaction ? "Inter-State (IGST)" : "Intra-State (CGST+SGST)"}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
        <div className="text-muted-foreground">Taxable Amount:</div>
        <div className="font-mono text-right">₹{formatNumber(breakdown.taxableAmount)}</div>

        {isInterStateTransaction ? (
          <>
            <div className="text-muted-foreground">IGST @ {gstRate}%:</div>
            <div className="font-mono text-right">₹{formatNumber(breakdown.igst)}</div>
          </>
        ) : (
          <>
            <div className="text-muted-foreground">CGST @ {gstRate / 2}%:</div>
            <div className="font-mono text-right">₹{formatNumber(breakdown.cgst)}</div>
            <div className="text-muted-foreground">SGST @ {gstRate / 2}%:</div>
            <div className="font-mono text-right">₹{formatNumber(breakdown.sgst)}</div>
          </>
        )}

        <div className="font-semibold border-t pt-1 mt-1">Total:</div>
        <div className="font-mono font-semibold text-right border-t pt-1 mt-1">
          ₹{formatNumber(breakdown.grandTotal)}
        </div>
      </div>

      <Button type="button" variant="outline" size="sm" className="text-xs w-fit" onClick={handleFillFields}>
        Fill GST fields
      </Button>
    </div>
  )
}
