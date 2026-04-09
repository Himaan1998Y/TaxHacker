// GSTR-1 Classification & Aggregation Engine
// Pure logic — no React, no DB calls
// Reference: GSTN GSTR-1 filing format

import { TransactionType } from "@/prisma/client"
import { formatDate } from "date-fns"
import { INDIAN_STATES, STATE_NAME_TO_CODE, stateCodeFromGSTIN } from "./indian-states"
import { validateGSTIN } from "./indian-tax-utils"

// ─── Types ───────────────────────────────────────────────────────────

export type GSTR1Section = "b2b" | "b2cl" | "b2cs" | "exp" | "nil" | "exempt" | "cdnr" | "cdnur" | "at" | "atadj" | "skip"

export type GSTR1Transaction = {
  id: string
  name: string | null
  merchant: string | null
  invoiceNumber: string | null
  gstin: string | null
  total: number            // in rupees (already divided by 100)
  taxableAmount: number    // in rupees (preferred source-of-truth)
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
  type: TransactionType | null | undefined
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
  nilRatedInterB2B: number
  nilRatedInterB2C: number
  nilRatedIntraB2B: number
  nilRatedIntraB2C: number
  exemptedInterB2B: number
  exemptedInterB2C: number
  exemptedIntraB2B: number
  exemptedIntraB2C: number
  nonGSTInterB2B: number
  nonGSTInterB2C: number
  nonGSTIntraB2B: number
  nonGSTIntraB2C: number
}

// ─── CDNR Types (Credit/Debit Note — Registered) ─────────────────────

export type CDNREntry = {
  gstin: string
  noteNumber: string
  noteDate: string
  noteType: "C" | "D"           // Credit or Debit
  noteValue: number
  placeOfSupply: string
  reverseCharge: string
  rate: number
  taxableValue: number
  cgst: number
  sgst: number
  igst: number
  cess: number
}

// ─── CDNUR Types (Credit/Debit Note — Unregistered) ──────────────────

export type CDNUREntry = {
  noteNumber: string
  noteDate: string
  noteType: "C" | "D"
  noteValue: number
  placeOfSupply: string
  rate: number
  taxableValue: number
  igst: number
  cess: number
}

// ─── AT Types (Advances Received / Adjusted) ─────────────────────────

export type ATEntry = {
  placeOfSupply: string
  rate: number
  grossAdvanceReceived: number
  igst: number
  cgst: number
  sgst: number
  cess: number
}

// ─── Summary ─────────────────────────────────────────────────────────

export type GSTR1Summary = {
  b2b: B2BEntry[]
  b2cl: B2CLInvoice[]
  b2cs: B2CSEntry[]
  cdnr: CDNREntry[]
  cdnur: CDNUREntry[]
  at: ATEntry[]
  atadj: ATEntry[]
  /**
   * Legacy combined HSN summary (B2B + B2C). Retained for backward
   * compatibility with callers and tests that pre-date Phase-III. New
   * code should prefer hsnB2B and hsnB2C, which map 1:1 onto the two
   * tabs of Table 12 as required by the GST portal from April 2025.
   */
  hsn: HSNEntry[]
  /** Table 12 B2B tab (supplies to registered recipients). */
  hsnB2B: HSNEntry[]
  /** Table 12 B2C tab (supplies to unregistered recipients). */
  hsnB2C: HSNEntry[]
  nil: NilExemptEntry[]
  classified: ClassifiedTransaction[]
  totalWarnings: number
  sectionCounts: Record<GSTR1Section, { count: number; value: number; warnings: number }>
}

// ─── Constants ───────────────────────────────────────────────────────

// B2C Large threshold for inter-state supplies to unregistered persons.
// Reduced from ₹2,50,000 to ₹1,00,000 by Notification No. 12/2024-Central
// Tax (10 Jul 2024), effective 1 Aug 2024. Invoices above this threshold
// must be reported invoice-wise in Table 5A of GSTR-1 (B2CL), not
// aggregated in Table 7 (B2CS).
const B2CL_THRESHOLD = 100000

const NIL_CATEGORIES = ["gst_nil_rated", "nil_rated"]
const CREDIT_DEBIT_NOTE_TYPES = ["credit_note", "debit_note", "CREDIT_NOTE", "DEBIT_NOTE", "CDN", "DNR"]
const EXEMPT_CATEGORIES = ["gst_exempt", "exempt"]
const EXPORT_SUPPLY_TYPES = ["export", "Export", "EXPORT"]

// ─── Classification ──────────────────────────────────────────────────

export function classifyTransaction(
  tx: GSTR1Transaction,
  businessStateCode: string | null
): ClassifiedTransaction {
  const warnings: string[] = []
  const supplyType = tx.supplyType?.trim().toUpperCase() || ""

  // Only outward supplies (income) go into GSTR-1
  if (tx.type === "expense") {
    return { ...tx, section: "skip", warnings: ["Expense transaction — not included in GSTR-1 (outward supplies only)"] }
  }

  // Credit/Debit notes → CDNR (with GSTIN) or CDNUR (without)
  if (supplyType && CREDIT_DEBIT_NOTE_TYPES.some(t => supplyType.includes(t.toUpperCase()))) {
    if (!tx.invoiceNumber) warnings.push("Missing invoice number")
    if (!tx.placeOfSupply) warnings.push("Missing place of supply")
    if (tx.gstin && validateGSTIN(tx.gstin).valid) {
      return { ...tx, section: "cdnr", warnings }
    }
    return { ...tx, section: "cdnur", warnings }
  }

  // Advance receipts / adjustments → AT / ATADJ
  if (supplyType && (supplyType.includes("ADVANCE") || supplyType === "AT" || supplyType === "ATADJ")) {
    if (!tx.placeOfSupply) warnings.push("Missing place of supply")
    if (supplyType.includes("ADJ") || supplyType === "ATADJ") {
      return { ...tx, section: "atadj", warnings }
    }
    return { ...tx, section: "at", warnings }
  }

  // Check for export
  if (supplyType && EXPORT_SUPPLY_TYPES.some(t => supplyType === t.toUpperCase())) {
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

  // Accept either a state name or a 2-digit code for place of supply.
  const posCode = resolveStateCode(tx.placeOfSupply)

  if (!posCode) return false
  return posCode !== businessStateCode
}

// ─── Transform DB Transaction → GSTR1Transaction ────────────────────

export function transactionToGSTR1(tx: any): GSTR1Transaction {
  // Prefer promoted first-class columns; fall back to extra JSON for backward compat
  const extra = (tx.extra as Record<string, any>) || {}
  return {
    id: tx.id,
    name: tx.name,
    merchant: tx.merchant,
    invoiceNumber: tx.invoiceNumber ?? extra.invoice_number ?? null,
    gstin: tx.gstin ?? extra.gstin ?? null,
    total: (tx.total || 0) / 100, // paise → rupees
    taxableAmount: tx.taxableAmount != null
      ? Number(tx.taxableAmount) / 100
      : Math.max(0, (tx.total || 0) / 100 -
          (tx.cgst != null ? Number(tx.cgst) / 100 : Number(extra.cgst) || 0) -
          (tx.sgst != null ? Number(tx.sgst) / 100 : Number(extra.sgst) || 0) -
          (tx.igst != null ? Number(tx.igst) / 100 : Number(extra.igst) || 0) -
          (tx.cess != null ? Number(tx.cess) / 100 : Number(extra.cess) || 0)
        ),
    gstRate: Number(tx.gstRate ?? extra.gst_rate) || 0,
    // Promoted paise columns → rupees; fall back to extra (stored in rupees already)
    cgst: tx.cgst != null ? Number(tx.cgst) / 100 : Number(extra.cgst) || 0,
    sgst: tx.sgst != null ? Number(tx.sgst) / 100 : Number(extra.sgst) || 0,
    igst: tx.igst != null ? Number(tx.igst) / 100 : Number(extra.igst) || 0,
    cess: tx.cess != null ? Number(tx.cess) / 100 : Number(extra.cess) || 0,
    hsnCode: tx.hsnCode ?? extra.hsn_sac_code ?? null,
    placeOfSupply: tx.placeOfSupply ?? extra.place_of_supply ?? null,
    supplyType: tx.supplyType ?? extra.supply_type ?? null,
    reverseCharge: typeof tx.reverseCharge === "boolean"
      ? tx.reverseCharge
      : extra.reverse_charge === "Yes" || extra.reverse_charge === "yes" || extra.reverse_charge === true,
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
    if (!tx.gstin || !validateGSTIN(tx.gstin).valid) {
      tx.warnings.push("B2B row skipped for JSON export: invalid or missing GSTIN")
      continue
    }

    const gstin = tx.gstin
    if (!grouped[gstin]) {
      grouped[gstin] = {
        gstin,
        receiverName: tx.merchant || tx.name || "Unknown",
        invoices: [],
        totalValue: 0,
      }
    }

    const taxableValue = tx.taxableAmount
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
      const taxableValue = tx.taxableAmount
      return {
        invoiceNumber: tx.invoiceNumber || "",
        invoiceDate: tx.issuedAt ? formatDate(tx.issuedAt, "dd/MM/yyyy") : "",
        invoiceValue: round(tx.total),
        placeOfSupply: tx.placeOfSupply || "",
        rate: tx.gstRate,
        taxableValue: round(taxableValue),
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

    const taxableValue = tx.taxableAmount
    grouped[key].taxableValue += taxableValue
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

// HSN section mapping per GSTN Table-12 Phase-III (April 2025).
// B2B tab: supplies to registered recipients — sections that carry a GSTIN.
// B2C tab: supplies to unregistered recipients — B2CL, B2CS, exports,
// unregistered credit/debit notes, nil-rated and exempt.
// Advances (at/atadj) and skipped rows are not reported in Table 12.
const HSN_B2B_SECTIONS: ReadonlySet<GSTR1Section> = new Set<GSTR1Section>(["b2b", "cdnr"])
const HSN_B2C_SECTIONS: ReadonlySet<GSTR1Section> = new Set<GSTR1Section>([
  "b2cl",
  "b2cs",
  "exp",
  "cdnur",
  "nil",
  "exempt",
])

/**
 * Classify a transaction's section into the Table-12 HSN bucket it belongs
 * to. Returns null for sections that are not reported in Table 12 at all
 * (skip, at, atadj).
 */
export function hsnBucketForSection(section: GSTR1Section): "b2b" | "b2c" | null {
  if (HSN_B2B_SECTIONS.has(section)) return "b2b"
  if (HSN_B2C_SECTIONS.has(section)) return "b2c"
  return null
}

function emptyHSNEntry(hsn: string): HSNEntry {
  return {
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

function finaliseHSNEntries(grouped: Record<string, HSNEntry>): HSNEntry[] {
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

/**
 * Aggregate HSN-wise summary for Table-12 of GSTR-1.
 *
 * `bucket` controls which sections are included:
 *   - "b2b":  only supplies to registered recipients (b2b, cdnr)
 *   - "b2c":  only supplies to unregistered recipients (b2cl, b2cs, exp,
 *             cdnur, nil, exempt)
 *   - "all":  both buckets combined (legacy behaviour, retained for the
 *             combined `report.hsn` field and any callers that want a
 *             union view)
 *
 * Default is "all" to preserve backward compatibility with pre-Phase-III
 * callers, but new code should use aggregateHSNSplit() which returns both
 * buckets at once.
 */
export function aggregateHSN(
  transactions: ClassifiedTransaction[],
  bucket: "b2b" | "b2c" | "all" = "all"
): HSNEntry[] {
  const taxable = transactions.filter(tx => {
    if (!tx.hsnCode) return false
    const b = hsnBucketForSection(tx.section)
    if (b === null) return false
    if (bucket === "all") return true
    return b === bucket
  })

  const grouped: Record<string, HSNEntry> = {}
  for (const tx of taxable) {
    const hsn = tx.hsnCode!
    if (!grouped[hsn]) grouped[hsn] = emptyHSNEntry(hsn)

    grouped[hsn].totalQuantity += 1
    grouped[hsn].totalValue += tx.total
    grouped[hsn].taxableValue += tx.taxableAmount
    grouped[hsn].igst += tx.igst
    grouped[hsn].cgst += tx.cgst
    grouped[hsn].sgst += tx.sgst
    grouped[hsn].cess += tx.cess
  }

  return finaliseHSNEntries(grouped)
}

/**
 * Compute both Table-12 HSN buckets in a single pass. Required for
 * Phase-III GSTR-1 filings (April 2025 onward) where Table 12 is
 * bifurcated into B2B and B2C tabs.
 */
export function aggregateHSNSplit(
  transactions: ClassifiedTransaction[]
): { b2b: HSNEntry[]; b2c: HSNEntry[] } {
  const b2bGrouped: Record<string, HSNEntry> = {}
  const b2cGrouped: Record<string, HSNEntry> = {}

  for (const tx of transactions) {
    if (!tx.hsnCode) continue
    const bucket = hsnBucketForSection(tx.section)
    if (bucket === null) continue

    const grouped = bucket === "b2b" ? b2bGrouped : b2cGrouped
    const hsn = tx.hsnCode
    if (!grouped[hsn]) grouped[hsn] = emptyHSNEntry(hsn)

    grouped[hsn].totalQuantity += 1
    grouped[hsn].totalValue += tx.total
    grouped[hsn].taxableValue += tx.taxableAmount
    grouped[hsn].igst += tx.igst
    grouped[hsn].cgst += tx.cgst
    grouped[hsn].sgst += tx.sgst
    grouped[hsn].cess += tx.cess
  }

  return {
    b2b: finaliseHSNEntries(b2bGrouped),
    b2c: finaliseHSNEntries(b2cGrouped),
  }
}

export function aggregateNil(
  transactions: ClassifiedTransaction[],
  businessStateCode: string | null
): NilExemptEntry[] {
  let nilInterB2B = 0, nilInterB2C = 0, nilIntraB2B = 0, nilIntraB2C = 0
  let exemptInterB2B = 0, exemptInterB2C = 0, exemptIntraB2B = 0, exemptIntraB2C = 0
  let nonGSTInterB2B = 0, nonGSTInterB2C = 0, nonGSTIntraB2B = 0, nonGSTIntraB2C = 0

  for (const tx of transactions.filter(item => item.section === "nil" || item.section === "exempt")) {
    const isInter = determineInterState(tx, businessStateCode)
    const isB2B = tx.gstin ? validateGSTIN(tx.gstin).valid : false
    const category = (tx.categoryCode || "").toLowerCase()

    if (category.includes("non_gst") || category.includes("non-gst")) {
      if (isInter) {
        if (isB2B) nonGSTInterB2B += tx.taxableAmount
        else nonGSTInterB2C += tx.taxableAmount
      } else {
        if (isB2B) nonGSTIntraB2B += tx.taxableAmount
        else nonGSTIntraB2C += tx.taxableAmount
      }
      continue
    }

    if (tx.section === "exempt") {
      if (isInter) {
        if (isB2B) exemptInterB2B += tx.taxableAmount
        else exemptInterB2C += tx.taxableAmount
      } else {
        if (isB2B) exemptIntraB2B += tx.taxableAmount
        else exemptIntraB2C += tx.taxableAmount
      }
      continue
    }

    if (tx.section === "nil") {
      if (isInter) {
        if (isB2B) nilInterB2B += tx.taxableAmount
        else nilInterB2C += tx.taxableAmount
      } else {
        if (isB2B) nilIntraB2B += tx.taxableAmount
        else nilIntraB2C += tx.taxableAmount
      }
    }
  }

  return [{
    description: "Nil Rated / Exempt Supplies",
    nilRatedInterB2B: round(nilInterB2B),
    nilRatedInterB2C: round(nilInterB2C),
    nilRatedIntraB2B: round(nilIntraB2B),
    nilRatedIntraB2C: round(nilIntraB2C),
    exemptedInterB2B: round(exemptInterB2B),
    exemptedInterB2C: round(exemptInterB2C),
    exemptedIntraB2B: round(exemptIntraB2B),
    exemptedIntraB2C: round(exemptIntraB2C),
    nonGSTInterB2B: round(nonGSTInterB2B),
    nonGSTInterB2C: round(nonGSTInterB2C),
    nonGSTIntraB2B: round(nonGSTIntraB2B),
    nonGSTIntraB2C: round(nonGSTIntraB2C),
  }]
}

export function aggregateAT(transactions: ClassifiedTransaction[], section: "at" | "atadj"): ATEntry[] {
  const grouped: Record<string, ATEntry> = {}

  for (const tx of transactions.filter(item => item.section === section)) {
    const placeOfSupply = tx.placeOfSupply || "Unknown"
    const rate = tx.gstRate || 0
    const key = `${placeOfSupply}|${rate}`

    if (!grouped[key]) {
      grouped[key] = {
        placeOfSupply,
        rate,
        grossAdvanceReceived: 0,
        igst: 0,
        cgst: 0,
        sgst: 0,
        cess: 0,
      }
    }

    grouped[key].grossAdvanceReceived += tx.total
    grouped[key].igst += tx.igst
    grouped[key].cgst += tx.cgst
    grouped[key].sgst += tx.sgst
    grouped[key].cess += tx.cess
  }

  return Object.values(grouped).map(entry => ({
    ...entry,
    grossAdvanceReceived: round(entry.grossAdvanceReceived),
    igst: round(entry.igst),
    cgst: round(entry.cgst),
    sgst: round(entry.sgst),
    cess: round(entry.cess),
  }))
}

// ─── Full GSTR-1 Report Generation ──────────────────────────────────

export function aggregateCDNR(transactions: ClassifiedTransaction[]): CDNREntry[] {
  return transactions
    .filter(tx => tx.section === "cdnr")
    .map(tx => {
      const noteType = tx.supplyType?.toUpperCase().includes("DEBIT") ? "D" : "C"
      const taxableValue = tx.taxableAmount
      return {
        gstin: tx.gstin || "",
        noteNumber: tx.invoiceNumber || "",
        noteDate: tx.issuedAt ? formatDate(tx.issuedAt, "dd/MM/yyyy") : "",
        noteType,
        noteValue: round(tx.total),
        placeOfSupply: tx.placeOfSupply || "",
        reverseCharge: tx.reverseCharge ? "Y" : "N",
        rate: tx.gstRate,
        taxableValue: round(taxableValue > 0 ? taxableValue : tx.total),
        cgst: round(tx.cgst),
        sgst: round(tx.sgst),
        igst: round(tx.igst),
        cess: round(tx.cess),
      }
    })
}

export function aggregateCDNUR(transactions: ClassifiedTransaction[]): CDNUREntry[] {
  return transactions
    .filter(tx => tx.section === "cdnur")
    .map(tx => {
      const noteType = tx.supplyType?.toUpperCase().includes("DEBIT") ? "D" : "C"
      const taxableValue = tx.taxableAmount
      return {
        noteNumber: tx.invoiceNumber || "",
        noteDate: tx.issuedAt ? formatDate(tx.issuedAt, "dd/MM/yyyy") : "",
        noteType,
        noteValue: round(tx.total),
        placeOfSupply: tx.placeOfSupply || "",
        rate: tx.gstRate,
        taxableValue: round(taxableValue > 0 ? taxableValue : tx.total),
        igst: round(tx.igst),
        cess: round(tx.cess),
      }
    })
}

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
  const cdnr = aggregateCDNR(classified)
  const cdnur = aggregateCDNUR(classified)
  const at = aggregateAT(classified, "at")
  const atadj = aggregateAT(classified, "atadj")
  const hsnSplit = aggregateHSNSplit(classified)
  // Legacy combined field kept in sync with the split: same rows in the
  // same order (B2B first, then B2C) so any pre-Phase-III caller still
  // sees the full HSN summary.
  const hsn: HSNEntry[] = [...hsnSplit.b2b, ...hsnSplit.b2c]
  const nil = aggregateNil(classified, businessStateCode)

  // Count by section
  const sectionCounts: Record<GSTR1Section, { count: number; value: number; warnings: number }> = {
    b2b: { count: 0, value: 0, warnings: 0 },
    b2cl: { count: 0, value: 0, warnings: 0 },
    b2cs: { count: 0, value: 0, warnings: 0 },
    exp: { count: 0, value: 0, warnings: 0 },
    nil: { count: 0, value: 0, warnings: 0 },
    exempt: { count: 0, value: 0, warnings: 0 },
    cdnr: { count: 0, value: 0, warnings: 0 },
    cdnur: { count: 0, value: 0, warnings: 0 },
    at: { count: 0, value: 0, warnings: 0 },
    atadj: { count: 0, value: 0, warnings: 0 },
    skip: { count: 0, value: 0, warnings: 0 },
  }

  let totalWarnings = 0
  for (const tx of classified) {
    sectionCounts[tx.section].count++
    sectionCounts[tx.section].value += tx.taxableAmount
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
    cdnr,
    cdnur,
    at,
    atadj,
    hsn,
    hsnB2B: hsnSplit.b2b,
    hsnB2C: hsnSplit.b2c,
    nil,
    classified,
    totalWarnings,
    sectionCounts,
  }
}

// ─── GSTR-1 JSON (GST Portal Format) ────────────────────────────────

// Single HSN row serializer shared between the legacy combined tab and
// the new B2B/B2C tabs. Keeps all three outputs in lockstep.
function hsnJsonRow(entry: HSNEntry) {
  return {
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
  }
}

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
    cdnr: report.cdnr.map(entry => ({
      ctin: entry.gstin,
      nt_num: entry.noteNumber,
      nt_dt: entry.noteDate,
      ntty: entry.noteType,
      val: entry.noteValue,
      pos: getStateCode(entry.placeOfSupply),
      rchrg: entry.reverseCharge,
      txval: entry.taxableValue,
      iamt: entry.igst,
      camt: entry.cgst,
      samt: entry.sgst,
      csamt: entry.cess,
    })),
    cdnur: report.cdnur.map(entry => ({
      nt_num: entry.noteNumber,
      nt_dt: entry.noteDate,
      ntty: entry.noteType,
      val: entry.noteValue,
      pos: getStateCode(entry.placeOfSupply),
      txval: entry.taxableValue,
      iamt: entry.igst,
      csamt: entry.cess,
    })),
    at: report.at.map(entry => ({
      pos: getStateCode(entry.placeOfSupply),
      rt: entry.rate,
      ad_amt: entry.grossAdvanceReceived,
      iamt: entry.igst,
      camt: entry.cgst,
      samt: entry.sgst,
      csamt: entry.cess,
    })),
    atadj: report.atadj.map(entry => ({
      pos: getStateCode(entry.placeOfSupply),
      rt: entry.rate,
      ad_amt: entry.grossAdvanceReceived,
      iamt: entry.igst,
      camt: entry.cgst,
      samt: entry.sgst,
      csamt: entry.cess,
    })),
    // Table 12 is bifurcated into B2B and B2C tabs from the April 2025
    // tax period onwards (GSTN Phase-III). We emit:
    //  - hsn_b2b / hsn_b2c: the two tabs the portal now expects
    //  - hsn: the legacy combined shape, preserved so that earlier
    //    offline-tool versions and third-party consumers that still read
    //    a single hsn.data array don't break mid-migration.
    hsn_b2b: {
      data: report.hsnB2B.map(hsnJsonRow),
    },
    hsn_b2c: {
      data: report.hsnB2C.map(hsnJsonRow),
    },
    hsn: {
      data: report.hsn.map(hsnJsonRow),
    },
      nil: {
      inv: report.nil.flatMap(entry => [
        {
          sply_ty: "INTRB2B",
          nil_amt: entry.nilRatedIntraB2B,
          expt_amt: entry.exemptedIntraB2B,
            ngsup_amt: entry.nonGSTIntraB2B,
        },
        {
          sply_ty: "INTRAB2B",
          nil_amt: entry.nilRatedInterB2B,
          expt_amt: entry.exemptedInterB2B,
            ngsup_amt: entry.nonGSTInterB2B,
        },
        {
          sply_ty: "INTRB2C",
          nil_amt: entry.nilRatedIntraB2C,
          expt_amt: entry.exemptedIntraB2C,
            ngsup_amt: entry.nonGSTIntraB2C,
        },
        {
          sply_ty: "INTRAB2C",
          nil_amt: entry.nilRatedInterB2C,
          expt_amt: entry.exemptedInterB2C,
            ngsup_amt: entry.nonGSTInterB2C,
        },
      ])
    },
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────

function round(n: number): number {
  return Math.round(n * 100) / 100
}

function getStateCode(stateName: string): string {
  const resolved = resolveStateCode(stateName)
  return resolved || stateName.trim() || ""
}

function resolveStateCode(stateName: string | null | undefined): string | null {
  if (!stateName) return null

  const normalized = stateName.trim()
  if (/^\d{2}$/.test(normalized) && INDIAN_STATES[normalized]) {
    return normalized
  }

  const prefixedCode = normalized.match(/^(\d{2})\s*[-–—:]/)
  if (prefixedCode && INDIAN_STATES[prefixedCode[1]]) {
    return prefixedCode[1]
  }

  const code = STATE_NAME_TO_CODE[normalized.toLowerCase()] ?? NORMALIZED_STATE_NAME_TO_CODE[normalizeStateKey(normalized)]

  if (code) {
    return code
  }

  const embeddedCode = normalized.match(/\b(\d{2})\b/)
  if (embeddedCode && INDIAN_STATES[embeddedCode[1]]) {
    return embeddedCode[1]
  }

  return null
}

const NORMALIZED_STATE_NAME_TO_CODE: Record<string, string> = Object.fromEntries(
  Object.entries(INDIAN_STATES).map(([code, name]) => [normalizeStateKey(name), code])
)

function normalizeStateKey(value: string): string {
  return value
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]/g, "")
}
