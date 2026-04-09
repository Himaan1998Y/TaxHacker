"use client"

import { useState, useMemo } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { formatNumber } from "@/lib/utils"
import { getIndianFY } from "@/lib/indian-fy"
import {
  generateGSTR1Report,
  generateGSTR1JSON,
  GSTR1Section,
  GSTR1Summary,
} from "@/lib/gstr1"
import {
  AlertTriangle,
  ChevronDown,
  Download,
  FileText,
  IndianRupee,
  CheckCircle2,
} from "lucide-react"

type Props = {
  transactions: any[]
  businessGSTIN: string
  businessStateCode: string
}

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
]

const SECTION_LABELS: Record<GSTR1Section, string> = {
  b2b: "B2B — Business to Business",
  b2cl: "B2CL — B2C Large (> ₹2.5L, Inter-State)",
  b2cs: "B2CS — B2C Small (Aggregated)",
  exp: "Export Supplies",
  nil: "Nil Rated Supplies",
  exempt: "Exempt Supplies",
  cdnr: "CDNR — Credit/Debit Notes (Registered)",
  cdnur: "CDNUR — Credit/Debit Notes (Unregistered)",
  at: "AT — Advances Received",
  atadj: "ATADJ — Advances Adjusted",
  skip: "Excluded (Expenses / Input)",
}

function formatINR(n: number): string {
  if (n >= 10000000) return `₹${(n / 10000000).toFixed(2)} Cr`
  if (n >= 100000) return `₹${(n / 100000).toFixed(2)} L`
  return `₹${formatNumber(n)}`
}

export function GSTR1Report({ transactions, businessGSTIN, businessStateCode }: Props) {
  const now = new Date()
  const [month, setMonth] = useState(String(now.getMonth())) // 0-indexed
  const [year, setYear] = useState(String(now.getFullYear()))
  const fy = getIndianFY(new Date(Number(year), parseInt(month), 1))

  // Filter transactions for selected period
  const periodTransactions = useMemo(() => {
    const m = parseInt(month)
    const y = parseInt(year)
    return transactions.filter((tx: any) => {
      if (!tx.issuedAt) return false
      const d = new Date(tx.issuedAt)
      return d.getMonth() === m && d.getFullYear() === y
    })
  }, [transactions, month, year])

  // Generate GSTR-1 report
  const report: GSTR1Summary = useMemo(() => {
    return generateGSTR1Report(periodTransactions, businessStateCode || null)
  }, [periodTransactions, businessStateCode])

  // Filing period in MMYYYY format
  const filingPeriod = `${String(parseInt(month) + 1).padStart(2, "0")}${year}`

  // Year options (last 3 years)
  const yearOptions = Array.from({ length: 4 }, (_, i) => String(now.getFullYear() - i))

  // Export handlers
  const handleExportCSV = async () => {
    const params = new URLSearchParams({
      month: String(parseInt(month) + 1),
      year,
      format: "csv",
    })
    window.open(`/apps/gstr1/export?${params}`, "_blank")
  }

  const handleExportJSON = () => {
    const json = generateGSTR1JSON(report, businessGSTIN, filingPeriod)
    const blob = new Blob([JSON.stringify(json, null, 2)], { type: "application/json" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `GSTR1_${businessGSTIN || "DRAFT"}_${filingPeriod}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  const outwardCount = report.classified.filter(tx => tx.section !== "skip").length
  const warningTransactions = report.classified.filter(tx => tx.warnings.length > 0)

  return (
    <div className="space-y-6">
      {/* Warning banner */}
      <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 flex items-start gap-3">
        <AlertTriangle className="h-5 w-5 text-yellow-600 mt-0.5 shrink-0" />
        <div className="text-sm text-yellow-800">
          <strong>AI-extracted data</strong> — Please verify all amounts, GSTINs, and HSN codes before using this report for GST filing.
          This is a draft report for your CA&apos;s review.
        </div>
      </div>

      {report.totalWarnings > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
          <div className="flex items-center gap-2 text-sm text-amber-900 font-medium mb-3">
            <AlertTriangle className="h-5 w-5" />
            {report.totalWarnings} transactions have data quality issues. Review before filing.
          </div>
          <Collapsible>
            <CollapsibleTrigger className="text-sm text-amber-700 underline underline-offset-2">
              Show warning details
            </CollapsibleTrigger>
            <CollapsibleContent className="mt-3 space-y-2 text-xs text-amber-800">
              {warningTransactions.map((tx, index) => (
                <div key={`${tx.id}-${index}`} className="rounded-md bg-amber-100 p-3">
                  <div className="font-semibold">{tx.invoiceNumber || tx.id} — {tx.section.toUpperCase()}</div>
                  <div className="mt-1">{tx.warnings.join("; ")}</div>
                </div>
              ))}
            </CollapsibleContent>
          </Collapsible>
        </div>
      )}

      {/* Period selector + Export buttons */}
      <div className="flex flex-wrap items-center gap-4">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">Period:</span>
          <Select value={month} onValueChange={setMonth}>
            <SelectTrigger className="w-[140px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {MONTHS.map((m, i) => (
                <SelectItem key={i} value={String(i)}>{m}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={year} onValueChange={setYear}>
            <SelectTrigger className="w-[100px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {yearOptions.map(y => (
                <SelectItem key={y} value={y}>{y}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex gap-2 ml-auto">
          <Button variant="outline" size="sm" onClick={handleExportCSV} disabled={outwardCount === 0}>
            <Download className="h-4 w-4 mr-2" />
            Export CA CSV
          </Button>
          <Button variant="outline" size="sm" onClick={handleExportJSON} disabled={outwardCount === 0}>
            <FileText className="h-4 w-4 mr-2" />
            Export GSTR-1 JSON
          </Button>
        </div>
      </div>

      {/* Business GSTIN display */}
      {businessGSTIN ? (
        <div className="text-sm text-muted-foreground">
          Filing GSTIN: <strong>{businessGSTIN}</strong> | Period: <strong>{MONTHS[parseInt(month)]} {year}</strong>
        </div>
      ) : (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">
          ⚠ Business GSTIN not set. Go to Settings → Tax Identity to configure your GSTIN.
        </div>
      )}

      {/* Summary card */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <IndianRupee className="h-4 w-4" />
            GSTR-1 Summary — {MONTHS[parseInt(month)]} {year} ({fy.year})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {outwardCount === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <FileText className="h-12 w-12 mx-auto mb-3 opacity-30" />
              <p>No outward supply (income) transactions for this period.</p>
              <p className="text-xs mt-1">Upload invoices and mark them as &quot;income&quot; to see GSTR-1 data.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {(["b2b", "b2cl", "b2cs", "cdnr", "cdnur", "at", "atadj", "nil", "exempt", "exp"] as GSTR1Section[]).map(section => {
                const data = report.sectionCounts[section]
                if (data.count === 0) return null
                return (
                  <div key={section} className="flex items-center justify-between text-sm py-1">
                    <span>{SECTION_LABELS[section]}</span>
                    <div className="flex items-center gap-4">
                      <span className="text-muted-foreground">{data.count} items</span>
                      <span className="font-medium w-24 text-right">{formatINR(data.value)}</span>
                      {data.warnings > 0 ? (
                        <span className="text-yellow-600 text-xs flex items-center gap-1">
                          <AlertTriangle className="h-3 w-3" />
                          {data.warnings}
                        </span>
                      ) : (
                        <span className="text-green-600 text-xs flex items-center gap-1">
                          <CheckCircle2 className="h-3 w-3" />
                        </span>
                      )}
                    </div>
                  </div>
                )
              })}

              <div className="border-t pt-2 mt-2 flex items-center justify-between text-sm font-semibold">
                <span>Total Outward Supplies</span>
                <div className="flex items-center gap-4">
                  <span>{outwardCount} items</span>
                  <span className="w-24 text-right">
                    {formatINR(
                      Object.entries(report.sectionCounts)
                        .filter(([k]) => k !== "skip")
                        .reduce((sum, [, v]) => sum + v.value, 0)
                    )}
                  </span>
                  {report.totalWarnings > 0 ? (
                    <span className="text-yellow-600 text-xs">{report.totalWarnings} warnings</span>
                  ) : (
                    <span className="text-green-600 text-xs">All clear</span>
                  )}
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* B2B Section */}
      {report.b2b.length > 0 && (
        <SectionCard title={SECTION_LABELS.b2b} count={report.sectionCounts.b2b.count}>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-muted-foreground border-b">
                <th className="text-left py-2">GSTIN</th>
                <th className="text-left py-2">Receiver</th>
                <th className="text-left py-2">Inv No</th>
                <th className="text-left py-2">Date</th>
                <th className="text-right py-2">Value</th>
                <th className="text-right py-2">Rate</th>
                <th className="text-right py-2">Tax</th>
              </tr>
            </thead>
            <tbody>
              {report.b2b.flatMap(entry =>
                entry.invoices.map((inv, i) => (
                  <tr key={`${entry.gstin}-${i}`} className="border-b last:border-0">
                    <td className="py-2 font-mono text-xs">{entry.gstin}</td>
                    <td className="py-2">{entry.receiverName}</td>
                    <td className="py-2">{inv.invoiceNumber || <WarningBadge text="Missing" />}</td>
                    <td className="py-2">{inv.invoiceDate}</td>
                    <td className="py-2 text-right">₹{formatNumber(inv.invoiceValue)}</td>
                    <td className="py-2 text-right">{inv.rate}%</td>
                    <td className="py-2 text-right">₹{formatNumber(inv.cgst + inv.sgst + inv.igst)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </SectionCard>
      )}

      {/* B2CL Section */}
      {report.b2cl.length > 0 && (
        <SectionCard title={SECTION_LABELS.b2cl} count={report.sectionCounts.b2cl.count}>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-muted-foreground border-b">
                <th className="text-left py-2">Inv No</th>
                <th className="text-left py-2">Date</th>
                <th className="text-left py-2">Place of Supply</th>
                <th className="text-right py-2">Value</th>
                <th className="text-right py-2">Rate</th>
                <th className="text-right py-2">IGST</th>
              </tr>
            </thead>
            <tbody>
              {report.b2cl.map((inv, i) => (
                <tr key={i} className="border-b last:border-0">
                  <td className="py-2">{inv.invoiceNumber || <WarningBadge text="Missing" />}</td>
                  <td className="py-2">{inv.invoiceDate}</td>
                  <td className="py-2">{inv.placeOfSupply}</td>
                  <td className="py-2 text-right">₹{formatNumber(inv.invoiceValue)}</td>
                  <td className="py-2 text-right">{inv.rate}%</td>
                  <td className="py-2 text-right">₹{formatNumber(inv.igst)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </SectionCard>
      )}

      {/* B2CS Section */}
      {report.b2cs.length > 0 && (
        <SectionCard title={SECTION_LABELS.b2cs} count={report.sectionCounts.b2cs.count}>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-muted-foreground border-b">
                <th className="text-left py-2">Place of Supply</th>
                <th className="text-left py-2">Type</th>
                <th className="text-right py-2">Rate</th>
                <th className="text-right py-2">Taxable Value</th>
                <th className="text-right py-2">CGST</th>
                <th className="text-right py-2">SGST</th>
                <th className="text-right py-2">IGST</th>
              </tr>
            </thead>
            <tbody>
              {report.b2cs.map((entry, i) => (
                <tr key={i} className="border-b last:border-0">
                  <td className="py-2">{entry.placeOfSupply}</td>
                  <td className="py-2">{entry.supplyType}</td>
                  <td className="py-2 text-right">{entry.rate}%</td>
                  <td className="py-2 text-right">₹{formatNumber(entry.taxableValue)}</td>
                  <td className="py-2 text-right">₹{formatNumber(entry.cgst)}</td>
                  <td className="py-2 text-right">₹{formatNumber(entry.sgst)}</td>
                  <td className="py-2 text-right">₹{formatNumber(entry.igst)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </SectionCard>
      )}

      {/* HSN Sections — Table 12 is bifurcated into B2B and B2C tabs from
          April 2025 tax period (GSTN Phase-III). We render each tab in its
          own section so what appears here mirrors what you will upload to
          the portal. */}
      {(report.hsnB2B.length > 0 || report.hsnB2C.length > 0) && (
        <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-xs text-blue-800">
          Table 12 is now reported in two tabs — <strong>B2B</strong>{" "}
          (supplies to registered recipients) and <strong>B2C</strong>{" "}
          (supplies to unregistered recipients) — effective from the
          April 2025 tax period. Each HSN row below lands in the tab
          the portal expects.
        </div>
      )}
      {report.hsnB2B.length > 0 && (
        <SectionCard title="HSN Summary — B2B (Table 12)" count={report.hsnB2B.length}>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-muted-foreground border-b">
                <th className="text-left py-2">HSN/SAC</th>
                <th className="text-right py-2">Qty</th>
                <th className="text-right py-2">Total Value</th>
                <th className="text-right py-2">Taxable</th>
                <th className="text-right py-2">CGST</th>
                <th className="text-right py-2">SGST</th>
                <th className="text-right py-2">IGST</th>
              </tr>
            </thead>
            <tbody>
              {report.hsnB2B.map((entry, i) => (
                <tr key={i} className="border-b last:border-0">
                  <td className="py-2 font-mono">{entry.hsnCode}</td>
                  <td className="py-2 text-right">{entry.totalQuantity}</td>
                  <td className="py-2 text-right">₹{formatNumber(entry.totalValue)}</td>
                  <td className="py-2 text-right">₹{formatNumber(entry.taxableValue)}</td>
                  <td className="py-2 text-right">₹{formatNumber(entry.cgst)}</td>
                  <td className="py-2 text-right">₹{formatNumber(entry.sgst)}</td>
                  <td className="py-2 text-right">₹{formatNumber(entry.igst)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </SectionCard>
      )}
      {report.hsnB2C.length > 0 && (
        <SectionCard title="HSN Summary — B2C (Table 12)" count={report.hsnB2C.length}>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-muted-foreground border-b">
                <th className="text-left py-2">HSN/SAC</th>
                <th className="text-right py-2">Qty</th>
                <th className="text-right py-2">Total Value</th>
                <th className="text-right py-2">Taxable</th>
                <th className="text-right py-2">CGST</th>
                <th className="text-right py-2">SGST</th>
                <th className="text-right py-2">IGST</th>
              </tr>
            </thead>
            <tbody>
              {report.hsnB2C.map((entry, i) => (
                <tr key={i} className="border-b last:border-0">
                  <td className="py-2 font-mono">{entry.hsnCode}</td>
                  <td className="py-2 text-right">{entry.totalQuantity}</td>
                  <td className="py-2 text-right">₹{formatNumber(entry.totalValue)}</td>
                  <td className="py-2 text-right">₹{formatNumber(entry.taxableValue)}</td>
                  <td className="py-2 text-right">₹{formatNumber(entry.cgst)}</td>
                  <td className="py-2 text-right">₹{formatNumber(entry.sgst)}</td>
                  <td className="py-2 text-right">₹{formatNumber(entry.igst)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </SectionCard>
      )}

      {/* Warnings detail */}
      {report.totalWarnings > 0 && (
        <SectionCard title={`Validation Warnings (${report.totalWarnings})`} count={report.totalWarnings} defaultOpen>
          <div className="space-y-2">
            {report.classified
              .filter(tx => tx.warnings.length > 0 && tx.section !== "skip")
              .map(tx => (
                <div key={tx.id} className="flex items-start gap-2 text-sm py-1 border-b last:border-0">
                  <AlertTriangle className="h-4 w-4 text-yellow-500 mt-0.5 shrink-0" />
                  <div>
                    <span className="font-medium">{tx.name || tx.merchant || "Unknown"}</span>
                    <span className="text-muted-foreground ml-2">({SECTION_LABELS[tx.section]})</span>
                    <ul className="text-xs text-yellow-700 mt-1">
                      {tx.warnings.map((w, i) => <li key={i}>• {w}</li>)}
                    </ul>
                  </div>
                </div>
              ))}
          </div>
        </SectionCard>
      )}
    </div>
  )
}

// ─── Helper Components ───────────────────────────────────────────────

function SectionCard({
  title,
  count,
  children,
  defaultOpen = false,
}: {
  title: string
  count: number
  children: React.ReactNode
  defaultOpen?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <Card>
        <CollapsibleTrigger asChild>
          <CardHeader className="pb-3 cursor-pointer hover:bg-muted/50 transition-colors">
            <CardTitle className="text-sm flex items-center justify-between">
              <span>{title}</span>
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded">{count}</span>
                <ChevronDown className={`h-4 w-4 transition-transform ${open ? "rotate-180" : ""}`} />
              </div>
            </CardTitle>
          </CardHeader>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <CardContent className="pt-0 overflow-x-auto">
            {children}
          </CardContent>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  )
}

function WarningBadge({ text }: { text: string }) {
  return (
    <span className="inline-flex items-center gap-1 text-yellow-600 text-xs bg-yellow-50 px-1.5 py-0.5 rounded">
      <AlertTriangle className="h-3 w-3" />
      {text}
    </span>
  )
}
