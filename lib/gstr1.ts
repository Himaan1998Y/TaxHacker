// GSTR-1 Classification & Aggregation Engine
// Pure logic — no React, no DB calls
// Reference: GSTN GSTR-1 filing format

import { formatDate } from "date-fns"
import { INDIAN_STATES, stateCodeFromGSTIN } from "./indian-states"
import { validateGSTIN } from "./indian-tax-utils"

// ─── Types ───────────────────────────────────────────────────────────

export type GSTR1Section = "b2b" | "b2cl" | "b2cs" | "exp" | "nil" | "exempt" | "skip"

export type GSTR1Transaction = {
  id: string
  name: string | null
  merchant: string | null
  invoiceNumber: string | null
  gstin: string | null
  total: number            // in rupees (already divided by 100)
  gstRate: number
  cgst: number
  sgst: number
  igst: number
  cess: number
  hsnCode: string | null
  placeOfSupply: string | null
  supplyType: string | null
  reverseCharge: boolean
  issuedAt: Date | null
  type: string             // "expense" | "income"
  categoryCode: string | null
}

export type ClassifiedTransaction = GSTR1Transaction & {
  section: GSTR1Section
  warnings: string[]
}

// ─── B2B Aggregated Types ────────────────────────────────────────────

export type B2BInvoice = {
  invoiceNumber: string
  invoiceDate: string
  invoiceValue: number
  placeOfSupply: string
  reverseCharge: string
  rate: number
  taxableValue: number
  cgst: number
  sgst: number
  igst: number
  cess: number
}

export type B2BEntry = {
  gstin: string
  receiverName: string
  invoices: B2BInvoice[]
  totalValue: number
}

// ─── B2CL Types ──────────────────────────────────────────────────────

export type B2CLInvoice = {
  invoiceNumber: string
  invoiceDate: string
  invoiceValue: number
  placeOfSupply: string
  rate: number
  taxableValue: number
  igst: number
  cess: number
}

// ─── B2CS Types (Aggregated) ─────────────────────────────────────────

export type B2CSEntry = {
  placeOfSupply: string
  supplyType: "Intra-State" | "Inter-State"
  rate: number
  taxableValue: number
  cgst: number
  sgst: number
  igst: number
  cess: number
}

// ─── HSN Types ───────────────────────────────────────────────────────

export type HSNEntry = {
  hsnCode: string
  description: string
  totalQuantity: number
  totalValue: number
  taxableValue: number
  igst: number
  cgst: number
  sgst: number
  cess: number
}

// ─── Nil/Exempt Types ────────────────────────────────────────────────

export type NilExemptEntry = {
  description: string
  nilRatedInter: number
  nilRatedIntra: number
  exemptedInter: number
  exemptedIntra: number
}

// ─── Summary ─────────────────────────────────────────────────────────

export type GSTR1Summary = {
  b2b: B2BEntry[]
  b2cl: B2CLInvoice[]
  b2cs: B2CSEntry[]
  hsn: HSNEntry[]
  nil: NilExemptEntry[]
  classified: ClassifiedTransaction[]
  totalWarnings: number
  sectionCounts: Record<GSTR1Section, { count: number; value: number; warnings: number }>
}

// ─── Constants ───────────────────────────────────────────────────────

const B2CL_THRESHOLD = 250000 // ₹2,50,000 — B2C Large threshold for inter-state

const NIL_CATEGORIES = ["gst_nil_rated", "nil_rated"]
const EXEMPT_CATEGORIES = ["gst_exempt", "exempt"]
const EXPORT_SUPPLY_TYPES = ["export", "Export", "EXPORT"]

// ─── Classification ──────────────────────────────────────────────────

export function classifyTransaction(
  tx: GSTR1Transaction,
  businessStateCode: string | null
): ClassifiedTransaction {
  const warnings: string[] = []

  // Only outward supplies (income) go into GSTR-1
  if (tx.type === "expense") {
    return { ...tx, section: "skip", warnings: ["Expense transaction — not included in GSTR-1 (outward supplies only)"] }
  }

  // Check for export
  if (tx.supplyType && EXPORT_SUPPLY_TYPES.includes(tx.supplyType)) {
    if (!tx.invoiceNumber) warnings.push("Missing invoice number")
    return { ...tx, section: "exp", warnings }
  }

  // Check for nil/exempt
  if (tx.gstRate === 0 || !tx.gstRate) {
    if (tx.categoryCode && NIL_CATEGORIES.some(c => tx.categoryCode?.includes(c))) {
      return { ...tx, section: "nil", warnings }
    }
    if (tx.categoryCode && EXEMPT_CATEGORIES.some(c => tx.categoryCode?.includes(c))) {
      return { ...tx, section: "exempt", warnings }
    }
    // Default zero-rate to nil
    if (tx.gstRate === 0) {
      return { ...tx, section: "nil", warnings }
    }
  }

  // If explicit supply type from AI, use it
  if (tx.supplyType) {
    const st = tx.supplyType.toUpperCase()
    if (st === "B2B") {
      if (!tx.gstin) warnings.push("Supply type is B2B but GSTIN is missing")
      if (!tx.invoiceNumber) warnings.push("Missing invoice number")
      if (!tx.placeOfSupply) warnings.push("Missing place of supply")
      if (!tx.hsnCode) warnings.push("Missing HSN/SAC code (needed for HSN summary)")
      return { ...tx, section: "b2b", warnings }
    }
    if (st === "B2CL") {
      if (!tx.invoiceNumber) warnings.push("Missing invoice number")
      if (!tx.placeOfSupply) warnings.push("Missing place of supply")
      return { ...tx, section: "b2cl", warnings }
    }
    if (st === "B2CS") {
      if (!tx.placeOfSupply) warnings.push("Missing place of supply")
      return { ...tx, section: "b2cs", warnings }
    }
  }

  // Auto-classify based on data
  if (tx.gstin && validateGSTIN(tx.gstin).valid) {
    // Has valid GSTIN → B2B
    if (!tx.invoiceNumber) warnings.push("Missing invoice number")
    if (!tx.placeOfSupply) warnings.push("Missing place of supply")
    if (!tx.hsnCode) warnings.push("Missing HSN/SAC code")
    return { ...tx, section: "b2b", warnings }
  }

  // No GSTIN — determine B2CL vs B2CS
  if (!businessStateCode && tx.total > B2CL_THRESHOLD) {
    warnings.push("Business state code not set in Settings — cannot determine if this is B2CL (inter-state). Set it in Settings → Tax Identity.")
  }
  const isInterState = determineInterState(tx, businessStateCode)

  if (isInterState && tx.total > B2CL_THRESHOLD) {
    // Inter-state + > ₹2.5L → B2CL
    if (!tx.invoiceNumber) warnings.push("Missing invoice number for B2CL")
    if (!tx.placeOfSupply) warnings.push("Missing place of supply")
    return { ...tx, section: "b2cl", warnings }
  }

  // Default: B2CS (aggregated)
  if (!tx.placeOfSupply) warnings.push("Missing place of supply")
  return { ...tx, section: "b2cs", warnings }
}

function determineInterState(tx: GSTR1Transaction, businessStateCode: string | null): boolean {
  if (!businessStateCode || !tx.placeOfSupply) return false

  // Try to get state code from place of supply
  const posCode = Object.entries(INDIAN_STATES).find(
    ([, name]) => name.toLowerCase() === tx.placeOfSupply?.toLowerCase()
  )?.[0]

  if (!posCode) return false
  return posCode !== businessStateCode
}

// ─── Transform DB Transaction → GSTR1Transaction ────────────────────

export function transactionToGSTR1(tx: any): GSTR1Transaction {
  const extra = (tx.extra as Record<string, any>) || {}
  return {
    id: tx.id,
    name: tx.name,
    merchant: tx.merchant,
    invoiceNumber: extra.invoice_number || null,
    gstin: extra.gstin || null,
    total: (tx.total || 0) / 100, // cents → rupees
    gstRate: Number(extra.gst_rate) || 0,
    cgst: Number(extra.cgst) || 0,
    sgst: Number(extra.sgst) || 0,
    igst: Number(extra.igst) || 0,
    cess: Number(extra.cess) || 0,
    hsnCode: extra.hsn_sac_code || null,
    placeOfSupply: extra.place_of_supply || null,
    supplyType: extra.supply_type || null,
    reverseCharge: extra.reverse_charge === "Yes" || extra.reverse_charge === "yes",
    issuedAt: tx.issuedAt ? new Date(tx.issuedAt) : null,
    type: tx.type || "expense",
    categoryCode: tx.categoryCode || null,
  }
}

// ─── Aggregation Functions ───────────────────────────────────────────

export function aggregateB2B(transactions: ClassifiedTransaction[]): B2BEntry[] {
  const b2bTxns = transactions.filter(tx => tx.section === "b2b")
  const grouped: Record<string, B2BEntry> = {}

  for (const tx of b2bTxns) {
    const gstin = tx.gstin || "UNKNOWN"
    if (!grouped[gstin]) {
      grouped[gstin] = {
        gstin,
        receiverName: tx.merchant || tx.name || "Unknown",
        invoices: [],
        totalValue: 0,
      }
    }

    const taxableValue = tx.total - tx.cgst - tx.sgst - tx.igst - tx.cess
    grouped[gstin].invoices.push({
      invoiceNumber: tx.invoiceNumber || "",
      invoiceDate: tx.issuedAt ? formatDate(tx.issuedAt, "dd/MM/yyyy") : "",
      invoiceValue: round(tx.total),
      placeOfSupply: tx.placeOfSupply || "",
      reverseCharge: tx.reverseCharge ? "Y" : "N",
      rate: tx.gstRate,
      taxableValue: round(taxableValue > 0 ? taxableValue : tx.total),
      cgst: round(tx.cgst),
      sgst: round(tx.sgst),
      igst: round(tx.igst),
      cess: round(tx.cess),
    })
    grouped[gstin].totalValue += tx.total
  }

  return Object.values(grouped)
}

export function aggregateB2CL(transactions: ClassifiedTransaction[]): B2CLInvoice[] {
  return transactions
    .filter(tx => tx.section === "b2cl")
    .map(tx => {
      const taxableValue = tx.total - tx.igst - tx.cess
      return {
        invoiceNumber: tx.invoiceNumber || "",
        invoiceDate: tx.issuedAt ? formatDate(tx.issuedAt, "dd/MM/yyyy") : "",
        invoiceValue: round(tx.total),
        placeOfSupply: tx.placeOfSupply || "",
        rate: tx.gstRate,
        taxableValue: round(taxableValue > 0 ? taxableValue : tx.total),
        igst: round(tx.igst),
        cess: round(tx.cess),
      }
    })
}

export function aggregateB2CS(
  transactions: ClassifiedTransaction[],
  businessStateCode: string | null
): B2CSEntry[] {
  const b2csTxns = transactions.filter(tx => tx.section === "b2cs")
  const grouped: Record<string, B2CSEntry> = {}

  for (const tx of b2csTxns) {
    const pos = tx.placeOfSupply || "Unknown"
    const isIntra = !determineInterState(tx, businessStateCode)
    const supplyType = isIntra ? "Intra-State" : "Inter-State"
    const rate = tx.gstRate || 0
    const key = `${pos}|${supplyType}|${rate}`

    if (!grouped[key]) {
      grouped[key] = {
        placeOfSupply: pos,
        supplyType,
        rate,
        taxableValue: 0,
        cgst: 0,
        sgst: 0,
        igst: 0,
        cess: 0,
      }
    }

    const taxableValue = tx.total - tx.cgst - tx.sgst - tx.igst - tx.cess
    grouped[key].taxableValue += taxableValue > 0 ? taxableValue : tx.total
    grouped[key].cgst += tx.cgst
    grouped[key].sgst += tx.sgst
    grouped[key].igst += tx.igst
    grouped[key].cess += tx.cess
  }

  return Object.values(grouped).map(entry => ({
    ...entry,
    taxableValue: round(entry.taxableValue),
    cgst: round(entry.cgst),
    sgst: round(entry.sgst),
    igst: round(entry.igst),
    cess: round(entry.cess),
  }))
}

export function aggregateHSN(transactions: ClassifiedTransaction[]): HSNEntry[] {
  const taxable = transactions.filter(tx => tx.section !== "skip" && tx.hsnCode)
  const grouped: Record<string, HSNEntry> = {}

  for (const tx of taxable) {
    const hsn = tx.hsnCode!
    if (!grouped[hsn]) {
      grouped[hsn] = {
        hsnCode: hsn,
        description: "", // Could be populated from HSN master
        totalQuantity: 0,
        totalValue: 0,
        taxableValue: 0,
        igst: 0,
        cgst: 0,
        sgst: 0,
        cess: 0,
      }
    }

    const taxableValue = tx.total - tx.cgst - tx.sgst - tx.igst - tx.cess
    grouped[hsn].totalQuantity += 1
    grouped[hsn].totalValue += tx.total
    grouped[hsn].taxableValue += taxableValue > 0 ? taxableValue : tx.total
    grouped[hsn].igst += tx.igst
    grouped[hsn].cgst += tx.cgst
    grouped[hsn].sgst += tx.sgst
    grouped[hsn].cess += tx.cess
  }

  return Object.values(grouped).map(entry => ({
    ...entry,
    totalValue: round(entry.totalValue),
    taxableValue: round(entry.taxableValue),
    igst: round(entry.igst),
    cgst: round(entry.cgst),
    sgst: round(entry.sgst),
    cess: round(entry.cess),
  }))
}

export function aggregateNil(
  transactions: ClassifiedTransaction[],
  businessStateCode: string | null
): NilExemptEntry[] {
  const nilTxns = transactions.filter(tx => tx.section === "nil")
  const exemptTxns = transactions.filter(tx => tx.section === "exempt")

  let nilInter = 0, nilIntra = 0, exemptInter = 0, exemptIntra = 0

  for (const tx of nilTxns) {
    if (determineInterState(tx, businessStateCode)) {
      nilInter += tx.total
    } else {
      nilIntra += tx.total
    }
  }

  for (const tx of exemptTxns) {
    if (determineInterState(tx, businessStateCode)) {
      exemptInter += tx.total
    } else {
      exemptIntra += tx.total
    }
  }

  return [{
    description: "Nil Rated / Exempt Supplies",
    nilRatedInter: round(nilInter),
    nilRatedIntra: round(nilIntra),
    exemptedInter: round(exemptInter),
    exemptedIntra: round(exemptIntra),
  }]
}

// ─── Full GSTR-1 Report Generation ──────────────────────────────────

export function generateGSTR1Report(
  dbTransactions: any[],
  businessStateCode: string | null
): GSTR1Summary {
  // Transform and classify all transactions
  const classified = dbTransactions.map(tx => {
    const gstr1Tx = transactionToGSTR1(tx)
    return classifyTransaction(gstr1Tx, businessStateCode)
  })

  // Aggregate by section
  const b2b = aggregateB2B(classified)
  const b2cl = aggregateB2CL(classified)
  const b2cs = aggregateB2CS(classified, businessStateCode)
  const hsn = aggregateHSN(classified)
  const nil = aggregateNil(classified, businessStateCode)

  // Count by section
  const sectionCounts: Record<GSTR1Section, { count: number; value: number; warnings: number }> = {
    b2b: { count: 0, value: 0, warnings: 0 },
    b2cl: { count: 0, value: 0, warnings: 0 },
    b2cs: { count: 0, value: 0, warnings: 0 },
    exp: { count: 0, value: 0, warnings: 0 },
    nil: { count: 0, value: 0, warnings: 0 },
    exempt: { count: 0, value: 0, warnings: 0 },
    skip: { count: 0, value: 0, warnings: 0 },
  }

  let totalWarnings = 0
  for (const tx of classified) {
    sectionCounts[tx.section].count++
    sectionCounts[tx.section].value += tx.total
    sectionCounts[tx.section].warnings += tx.warnings.length
    totalWarnings += tx.warnings.length
  }

  // Round values in section counts
  for (const key of Object.keys(sectionCounts) as GSTR1Section[]) {
    sectionCounts[key].value = round(sectionCounts[key].value)
  }

  return {
    b2b,
    b2cl,
    b2cs,
    hsn,
    nil,
    classified,
    totalWarnings,
    sectionCounts,
  }
}

// ─── GSTR-1 JSON (GST Portal Format) ────────────────────────────────

export function generateGSTR1JSON(
  report: GSTR1Summary,
  businessGSTIN: string,
  filingPeriod: string // "MMYYYY" format
): object {
  return {
    gstin: businessGSTIN,
    fp: filingPeriod,
    b2b: report.b2b.map(entry => ({
      ctin: entry.gstin,
      inv: entry.invoices.map(inv => ({
        inum: inv.invoiceNumber,
        idt: inv.invoiceDate,
        val: inv.invoiceValue,
        pos: getStateCode(inv.placeOfSupply),
        rchrg: inv.reverseCharge,
        inv_typ: "R", // Regular
        itms: [{
          num: 1,
          itm_det: {
            rt: inv.rate,
            txval: inv.taxableValue,
            camt: inv.cgst,
            samt: inv.sgst,
            iamt: inv.igst,
            csamt: inv.cess,
          }
        }]
      }))
    })),
    b2cl: report.b2cl.map(inv => ({
      pos: getStateCode(inv.placeOfSupply),
      inv: [{
        inum: inv.invoiceNumber,
        idt: inv.invoiceDate,
        val: inv.invoiceValue,
        itms: [{
          num: 1,
          itm_det: {
            rt: inv.rate,
            txval: inv.taxableValue,
            iamt: inv.igst,
            csamt: inv.cess,
          }
        }]
      }]
    })),
    b2cs: report.b2cs.map(entry => ({
      sply_ty: entry.supplyType === "Intra-State" ? "INTRA" : "INTER",
      pos: getStateCode(entry.placeOfSupply),
      rt: entry.rate,
      txval: entry.taxableValue,
      camt: entry.cgst,
      samt: entry.sgst,
      iamt: entry.igst,
      csamt: entry.cess,
    })),
    hsn: {
      data: report.hsn.map(entry => ({
        hsn_sc: entry.hsnCode,
        desc: entry.description || "",
        uqc: "NOS",
        qty: entry.totalQuantity,
        val: entry.totalValue,
        txval: entry.taxableValue,
        iamt: entry.igst,
        camt: entry.cgst,
        samt: entry.sgst,
        csamt: entry.cess,
      }))
    },
    nil: {
      inv: report.nil.map(entry => ({
        sply_ty: "INTRB2B",
        nil_amt: entry.nilRatedIntra,
        expt_amt: entry.exemptedIntra,
        ngsup_amt: 0,
      }))
    },
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────

function round(n: number): number {
  return Math.round(n * 100) / 100
}

function getStateCode(stateName: string): string {
  if (!stateName) return ""
  const entry = Object.entries(INDIAN_STATES).find(
    ([, name]) => name.toLowerCase() === stateName.toLowerCase()
  )
  return entry ? entry[0] : ""
}
