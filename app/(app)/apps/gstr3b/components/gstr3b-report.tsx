"use client"

import { useState, useMemo } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { formatNumber } from "@/lib/utils"
import { generateGSTR3B, generateGSTR3BJSON, GSTR3BSummary } from "@/lib/gstr3b"
import { AlertTriangle, Download, FileText, IndianRupee } from "lucide-react"

type Props = {
  transactions: any[]
  businessGSTIN: string
  businessStateCode: string
}

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
]

function formatINR(n: number): string {
  if (n >= 10000000) return `₹${(n / 10000000).toFixed(2)} Cr`
  if (n >= 100000) return `₹${(n / 100000).toFixed(2)} L`
  return `₹${formatNumber(n)}`
}

export function GSTR3BReport({ transactions, businessGSTIN, businessStateCode }: Props) {
  const now = new Date()
  const [month, setMonth] = useState(String(now.getMonth()))
  const [year, setYear] = useState(String(now.getFullYear()))

  const periodTransactions = useMemo(() => {
    const m = parseInt(month)
    const y = parseInt(year)
    return transactions.filter((tx: any) => {
      if (!tx.issuedAt) return false
      const d = new Date(tx.issuedAt)
      return d.getMonth() === m && d.getFullYear() === y
    })
  }, [transactions, month, year])

  const filingPeriod = `${String(parseInt(month) + 1).padStart(2, "0")}${year}`

  const report: GSTR3BSummary = useMemo(() => {
    return generateGSTR3B(
      periodTransactions,
      businessStateCode || null,
      businessGSTIN,
      filingPeriod
    )
  }, [periodTransactions, businessStateCode, businessGSTIN, filingPeriod])

  const yearOptions = Array.from({ length: 4 }, (_, i) => String(now.getFullYear() - i))

  const handleExportJSON = () => {
    const json = generateGSTR3BJSON(report)
    const blob = new Blob([JSON.stringify(json, null, 2)], { type: "application/json" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `GSTR3B_${businessGSTIN || "DRAFT"}_${filingPeriod}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  const hasData = periodTransactions.length > 0

  return (
    <div className="space-y-6">
      {/* Warning */}
      <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 flex items-start gap-3">
        <AlertTriangle className="h-5 w-5 text-yellow-600 mt-0.5 shrink-0" />
        <div className="text-sm text-yellow-800">
          <strong>AI-extracted data</strong> — Verify all amounts before using for GSTR-3B filing.
          ITC eligibility is based on category classification — ensure categories are correctly assigned.
        </div>
      </div>

      {/* Period + Export */}
      <div className="flex flex-wrap items-center gap-4">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">Period:</span>
          <Select value={month} onValueChange={setMonth}>
            <SelectTrigger className="w-[140px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              {MONTHS.map((m, i) => <SelectItem key={i} value={String(i)}>{m}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={year} onValueChange={setYear}>
            <SelectTrigger className="w-[100px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              {yearOptions.map(y => <SelectItem key={y} value={y}>{y}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <Button variant="outline" size="sm" onClick={handleExportJSON} disabled={!hasData} className="ml-auto">
          <FileText className="h-4 w-4 mr-2" />
          Export GSTR-3B JSON
        </Button>
      </div>

      {/* GSTIN */}
      {businessGSTIN ? (
        <div className="text-sm text-muted-foreground">
          GSTIN: <strong>{businessGSTIN}</strong> | Period: <strong>{MONTHS[parseInt(month)]} {year}</strong>
        </div>
      ) : (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">
          Business GSTIN not set. Go to Settings → Tax Identity.
        </div>
      )}

      {!hasData ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            <FileText className="h-12 w-12 mx-auto mb-3 opacity-30" />
            <p>No transactions for this period.</p>
            <p className="text-xs mt-1">Upload invoices and receipts to generate GSTR-3B data.</p>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Table 3.1 — Outward Supplies */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Table 3.1 — Details of Outward Supplies</CardTitle>
            </CardHeader>
            <CardContent>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-muted-foreground border-b">
                    <th className="text-left py-2">Nature of Supplies</th>
                    <th className="text-right py-2">Taxable Value</th>
                    <th className="text-right py-2">IGST</th>
                    <th className="text-right py-2">CGST</th>
                    <th className="text-right py-2">SGST</th>
                    <th className="text-right py-2">Cess</th>
                  </tr>
                </thead>
                <tbody>
                  {report.table31.map((row, i) => (
                    <tr key={i} className="border-b last:border-0">
                      <td className="py-2 text-xs">{row.description}</td>
                      <td className="py-2 text-right">{formatINR(row.taxableValue)}</td>
                      <td className="py-2 text-right">₹{formatNumber(row.igst)}</td>
                      <td className="py-2 text-right">₹{formatNumber(row.cgst)}</td>
                      <td className="py-2 text-right">₹{formatNumber(row.sgst)}</td>
                      <td className="py-2 text-right">₹{formatNumber(row.cess)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>

          {/* Table 4 — ITC */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <IndianRupee className="h-4 w-4" />
                Table 4 — Eligible ITC
              </CardTitle>
            </CardHeader>
            <CardContent>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-muted-foreground border-b">
                    <th className="text-left py-2">Details</th>
                    <th className="text-right py-2">IGST</th>
                    <th className="text-right py-2">CGST</th>
                    <th className="text-right py-2">SGST</th>
                    <th className="text-right py-2">Cess</th>
                  </tr>
                </thead>
                <tbody>
                  {report.table4.available.map((row, i) => (
                    <tr key={`a-${i}`} className="border-b text-green-700">
                      <td className="py-2 text-xs">{row.description}</td>
                      <td className="py-2 text-right">₹{formatNumber(row.igst)}</td>
                      <td className="py-2 text-right">₹{formatNumber(row.cgst)}</td>
                      <td className="py-2 text-right">₹{formatNumber(row.sgst)}</td>
                      <td className="py-2 text-right">₹{formatNumber(row.cess)}</td>
                    </tr>
                  ))}
                  {report.table4.reversed.map((row, i) => (
                    <tr key={`b-${i}`} className="border-b text-red-600">
                      <td className="py-2 text-xs">{row.description}</td>
                      <td className="py-2 text-right">₹{formatNumber(row.igst)}</td>
                      <td className="py-2 text-right">₹{formatNumber(row.cgst)}</td>
                      <td className="py-2 text-right">₹{formatNumber(row.sgst)}</td>
                      <td className="py-2 text-right">₹{formatNumber(row.cess)}</td>
                    </tr>
                  ))}
                  <tr className="font-semibold bg-muted/30">
                    <td className="py-2 text-xs">{report.table4.netITC.description}</td>
                    <td className="py-2 text-right">₹{formatNumber(report.table4.netITC.igst)}</td>
                    <td className="py-2 text-right">₹{formatNumber(report.table4.netITC.cgst)}</td>
                    <td className="py-2 text-right">₹{formatNumber(report.table4.netITC.sgst)}</td>
                    <td className="py-2 text-right">₹{formatNumber(report.table4.netITC.cess)}</td>
                  </tr>
                </tbody>
              </table>
            </CardContent>
          </Card>

          {/* Table 5 — Exempt Inward */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Table 5 — Exempt, Nil & Non-GST Inward Supplies</CardTitle>
            </CardHeader>
            <CardContent>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-muted-foreground border-b">
                    <th className="text-left py-2">Nature of Supplies</th>
                    <th className="text-right py-2">Inter-State</th>
                    <th className="text-right py-2">Intra-State</th>
                  </tr>
                </thead>
                <tbody>
                  {report.table5.map((row, i) => (
                    <tr key={i} className="border-b last:border-0">
                      <td className="py-2">{row.description}</td>
                      <td className="py-2 text-right">{formatINR(row.interState)}</td>
                      <td className="py-2 text-right">{formatINR(row.intraState)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>

          {/* Table 6 — Payment of Tax */}
          <Card className="border-2 border-primary/20">
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <IndianRupee className="h-4 w-4" />
                Table 6 — Payment of Tax
              </CardTitle>
            </CardHeader>
            <CardContent>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-muted-foreground border-b">
                    <th className="text-left py-2">Description</th>
                    <th className="text-right py-2">IGST</th>
                    <th className="text-right py-2">CGST</th>
                    <th className="text-right py-2">SGST</th>
                    <th className="text-right py-2">Cess</th>
                  </tr>
                </thead>
                <tbody>
                  {report.table6.map((row, i) => (
                    <tr key={i} className={`border-b last:border-0 ${i === 0 ? "font-semibold text-red-700" : "text-green-700"}`}>
                      <td className="py-3">{row.description}</td>
                      <td className="py-3 text-right">₹{formatNumber(row.igst)}</td>
                      <td className="py-3 text-right">₹{formatNumber(row.cgst)}</td>
                      <td className="py-3 text-right">₹{formatNumber(row.sgst)}</td>
                      <td className="py-3 text-right">₹{formatNumber(row.cess)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {/* Net summary */}
              <div className="mt-4 bg-muted/50 rounded-md p-4 text-center">
                {report.table6[0] && (
                  <div className="text-lg font-semibold">
                    Total Tax Payable: <span className="text-red-600">
                      ₹{formatNumber(report.table6[0].igst + report.table6[0].cgst + report.table6[0].sgst + report.table6[0].cess)}
                    </span>
                  </div>
                )}
                {report.table6[1] && (report.table6[1].igst + report.table6[1].cgst + report.table6[1].sgst) > 0 && (
                  <div className="text-sm text-green-700 mt-1">
                    ITC Credit Carried Forward: ₹{formatNumber(report.table6[1].igst + report.table6[1].cgst + report.table6[1].sgst + report.table6[1].cess)}
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  )
}
