// GSTR-3B Computation Engine
// Summary return with ITC claims — the other half of GST filing
// Reference: GSTN GSTR-3B format

import { formatDate } from "date-fns"
import { INDIAN_STATES } from "./indian-states"
import { transactionToGSTR1, generateGSTR1Report, GSTR1Summary } from "./gstr1"
import { matchesKeyword } from "./utils"

// ─── Types ───────────────────────────────────────────────────────────

// Table 3.1 — Outward supplies
export type Table31Row = {
  description: string
  taxableValue: number
  igst: number
  cgst: number
  sgst: number
  cess: number
}

// Table 4 — ITC
export type Table4Row = {
  description: string
  igst: number
  cgst: number
  sgst: number
  cess: number
}

// Table 5 — Exempt/Nil/Non-GST inward supplies
export type Table5Row = {
  description: string
  interState: number
  intraState: number
}

// Table 6 — Payment of tax
export type Table6Row = {
  description: string
  igst: number
  cgst: number
  sgst: number
  cess: number
}

export type GSTR3BSummary = {
  table31: Table31Row[]      // Outward supplies
  table4: {
    available: Table4Row[]   // 4(A) ITC available
    reversed: Table4Row[]    // 4(B) ITC reversed
    netITC: Table4Row        // 4(C) Net ITC
  }
  table5: Table5Row[]        // Exempt/Nil/Non-GST inward
  table6: Table6Row[]        // Payment of tax
  filingPeriod: string       // MMYYYY
  gstin: string
}

// ─── Section 17(5) — blocked ITC defaults ───────────────────────────
//
// Keywords that trigger an "ITC blocked" default classification when the
// user hasn't explicitly configured a category. Matching is substring +
// case-insensitive, so a category code like "Food_Beverage" or
// "OUTDOOR_CATERING" still gets flagged. Users can override per-category
// via the existing itcBlockedCategories parameter — these defaults only
// affect users who leave their categories unconfigured.
//
// The list is a best-effort heuristic, not a legal substitute. It maps
// to clauses (a) through (i) of Section 17(5) as in force for the 2025-26
// FY, including:
//   - clause (a):  motor vehicles for passenger transport (≤13 seats)
//   - clause (aa): vessels & aircraft for personal transport
//   - clause (ab): services of general insurance / servicing / repair
//                  & maintenance on (a) and (aa) above
//   - clause (b)(i): food & beverages, outdoor catering, beauty treatment,
//                    health services, cosmetic/plastic surgery, leasing/
//                    rent-a-cab, life & health insurance (with carve-outs
//                    the tool cannot detect automatically)
//   - clause (b)(ii): membership of clubs, health & fitness centres
//   - clause (b)(iii): travel benefits to employees on vacation (LTA)
//   - clause (c):  works contract services for construction of immovable
//                  property (other than plant & machinery)
//   - clause (d):  goods/services for own construction of immovable
//                  property (other than plant and machinery — note the
//                  "and" per Budget 2024 retrospective amendment)
//   - clause (e):  tax paid under composition scheme
//   - clause (f):  supplies to non-resident taxable person (with carve-out)
//   - clause (fa): CSR activities (2026 clarification — CSR is mandatory
//                  under Companies Act but ITC on it is explicitly blocked)
//   - clause (g):  goods/services for personal consumption
//   - clause (h):  lost, stolen, destroyed, written-off, or disposed of
//                  as gifts or free samples
//   - clause (i):  tax paid in pursuance of Section 74 (fraud cases)
//                  — retained for demands up to FY 2023-24 per Budget 2024
export const DEFAULT_ITC_BLOCKED_KEYWORDS = [
  // clause (a), (aa), (ab) — motor vehicles, vessels, aircraft
  "motor_vehicle", "vehicle", "car", "vessel", "aircraft",
  "fuel", "petrol", "diesel",
  // clause (b)(i) — food, beverages, personal-care services
  "food", "beverage", "catering", "restaurant",
  "beauty", "cosmetic", "health_service", "spa",
  "rent_a_cab", "cab_rental",
  // clause (b)(ii), (iii) — clubs, fitness, LTA
  "club", "membership", "fitness", "gym",
  "lta", "leave_travel",
  // clause (b) — insurance (life/health). Excludes general biz insurance;
  // users should whitelist specific business insurance categories if needed.
  "life_insurance", "health_insurance",
  // clause (c), (d) — works contract, construction of immovable property
  "construction", "works_contract", "immovable_property",
  "building_material", "civil_work",
  // clause (e), (f) — composition tax, NRTP inputs
  "composition_tax",
  // clause (fa) — CSR (2026 clarification)
  "csr", "corporate_social",
  // clause (g) — personal consumption
  "personal", "entertainment",
  // clause (h) — gifts, free samples, written-off
  "gift", "free_sample", "sample",
  "donation", "written_off",
  // clause (i) — Section 74 demand tax. Also fines/penalties are never
  // ITC-eligible regardless of Section 17(5) — kept here for the default
  // heuristic.
  "penalty", "fine", "section_74",
]

// ─── Core Computation ────────────────────────────────────────────────

export function generateGSTR3B(
  dbTransactions: any[],
  businessStateCode: string | null,
  businessGSTIN: string,
  filingPeriod: string,
  itcBlockedCategories: string[] = []
): GSTR3BSummary {
  // Separate income (outward) and expense (inward)
  const incomeTransactions = dbTransactions.filter(tx => tx.type === "income")
  const expenseTransactions = dbTransactions.filter(tx => tx.type === "expense")

  // ─── Table 3.1: Outward Supplies ────────────────────────────────
  // Reuse GSTR-1 report for outward supply totals
  const gstr1 = generateGSTR1Report(incomeTransactions, businessStateCode)
  const table31 = computeTable31(gstr1, expenseTransactions)

  // ─── Table 4: ITC from Inward Supplies ──────────────────────────
  const table4 = computeTable4(expenseTransactions, itcBlockedCategories)

  // ─── Table 5: Exempt/Nil/Non-GST Inward ────────────────────────
  const table5 = computeTable5(expenseTransactions, businessStateCode)

  // ─── Table 6: Payment of Tax ────────────────────────────────────
  const table6 = computeTable6(table31, table4)

  return {
    table31,
    table4,
    table5,
    table6,
    filingPeriod,
    gstin: businessGSTIN,
  }
}

// ─── Table 3.1: Outward Supplies ─────────────────────────────────────

function computeTable31(gstr1: GSTR1Summary, expenses: any[]): Table31Row[] {
  const rows: Table31Row[] = []

  // (a) Outward taxable supplies (other than zero rated, nil rated, exempted)
  const taxableB2B = gstr1.sectionCounts.b2b
  const taxableB2CL = gstr1.sectionCounts.b2cl
  const taxableB2CS = gstr1.sectionCounts.b2cs

  const taxableTotal = {
    value: taxableB2B.value + taxableB2CL.value + taxableB2CS.value,
    igst: 0, cgst: 0, sgst: 0, cess: 0,
  }

  // Aggregate tax amounts from classified transactions
  for (const tx of gstr1.classified.filter(t => ["b2b", "b2cl", "b2cs"].includes(t.section))) {
    taxableTotal.igst += tx.igst
    taxableTotal.cgst += tx.cgst
    taxableTotal.sgst += tx.sgst
    taxableTotal.cess += tx.cess
  }

  rows.push({
    description: "(a) Outward taxable supplies (other than zero rated, nil rated, exempted)",
    taxableValue: round(taxableTotal.value),
    igst: round(taxableTotal.igst),
    cgst: round(taxableTotal.cgst),
    sgst: round(taxableTotal.sgst),
    cess: round(taxableTotal.cess),
  })

  // (b) Outward taxable supplies (zero rated)
  const zeroRated = gstr1.sectionCounts.exp
  rows.push({
    description: "(b) Outward taxable supplies (zero rated)",
    taxableValue: round(zeroRated.value),
    igst: 0, cgst: 0, sgst: 0, cess: 0,
  })

  // (c) Other outward supplies (nil rated, exempted)
  const nilExempt = gstr1.sectionCounts.nil.value + gstr1.sectionCounts.exempt.value
  rows.push({
    description: "(c) Other outward supplies (nil rated, exempted)",
    taxableValue: round(nilExempt),
    igst: 0, cgst: 0, sgst: 0, cess: 0,
  })

  // (d) Inward supplies liable to reverse charge
  const rcmTransactions = expenses
    .map(tx => transactionToGSTR1(tx))
    .filter(tx => tx.reverseCharge)
  const rcmTotals = rcmTransactions.reduce(
    (sum, tx) => {
      const taxableValue = tx.taxableAmount
      sum.taxableValue += taxableValue
      sum.igst += tx.igst
      sum.cgst += tx.cgst
      sum.sgst += tx.sgst
      sum.cess += tx.cess
      return sum
    },
    { taxableValue: 0, igst: 0, cgst: 0, sgst: 0, cess: 0 }
  )

  rows.push({
    description: "(d) Inward supplies (liable to reverse charge)",
    taxableValue: round(rcmTotals.taxableValue),
    igst: round(rcmTotals.igst),
    cgst: round(rcmTotals.cgst),
    sgst: round(rcmTotals.sgst),
    cess: round(rcmTotals.cess),
  })

  // (e) Non-GST outward supplies
  const nonGSTTransactions = gstr1.classified.filter(
    tx => tx.gstRate === 0 && (
      (tx.categoryCode || "").toLowerCase().includes("non_gst") ||
      (tx.categoryCode || "").toLowerCase().includes("non-gst") ||
      (tx.supplyType || "").toUpperCase() === "NON_GST"
    )
  )
  const nonGSTTotal = nonGSTTransactions.reduce((sum, tx) => sum + tx.taxableAmount, 0)

  rows.push({
    description: "(e) Non-GST outward supplies",
    taxableValue: round(nonGSTTotal),
    igst: 0, cgst: 0, sgst: 0, cess: 0,
  })

  // Adjust row (c) so nil/exempt totals do not double-count non-GST outward supplies.
  const nilExemptTotal = gstr1.sectionCounts.nil.value + gstr1.sectionCounts.exempt.value
  const otherOutwardValue = Math.max(0, nilExemptTotal - nonGSTTotal)
  rows[2].taxableValue = round(otherOutwardValue)

  return rows
}

// ─── Table 4: ITC ────────────────────────────────────────────────────

function computeTable4(
  expenses: any[],
  itcBlockedCategories: string[]
): { available: Table4Row[]; reversed: Table4Row[]; netITC: Table4Row } {
  // Build full blocked list = default keywords + user-configured categories
  const blockedCodes = new Set(itcBlockedCategories)

  let availableIGST = 0, availableCGST = 0, availableSGST = 0, availableCess = 0
  let reversedIGST = 0, reversedCGST = 0, reversedSGST = 0, reversedCess = 0

  for (const tx of expenses) {
    const gstTx = transactionToGSTR1(tx)
    if (gstTx.gstRate <= 0) continue

    // User-configured category codes in itcBlockedCategories are matched
    // exactly (they come from the same category table the category code
    // lives in, so they're case-consistent already). Default keywords use
    // the shared matchesKeyword helper for case-insensitive matching.
    // Guard: only check if categoryCode is non-empty to prevent empty-string false positive matches.
    const isBlocked = (tx.categoryCode && blockedCodes.has(tx.categoryCode)) ||
      matchesKeyword(tx.categoryCode || "", DEFAULT_ITC_BLOCKED_KEYWORDS)

    if (isBlocked) {
      reversedIGST += gstTx.igst
      reversedCGST += gstTx.cgst
      reversedSGST += gstTx.sgst
      reversedCess += gstTx.cess
    } else {
      availableIGST += gstTx.igst
      availableCGST += gstTx.cgst
      availableSGST += gstTx.sgst
      availableCess += gstTx.cess
    }
  }

  const available: Table4Row[] = [{
    description: "(A) ITC Available — from eligible inward supplies",
    igst: round(availableIGST),
    cgst: round(availableCGST),
    sgst: round(availableSGST),
    cess: round(availableCess),
  }]

  const reversed: Table4Row[] = [{
    description: "(B) ITC Reversed — blocked under Section 17(5)",
    igst: round(reversedIGST),
    cgst: round(reversedCGST),
    sgst: round(reversedSGST),
    cess: round(reversedCess),
  }]

  const netITC: Table4Row = {
    description: "(C) Net ITC Available = (A) - (B)",
    igst: round(availableIGST - reversedIGST),
    cgst: round(availableCGST - reversedCGST),
    sgst: round(availableSGST - reversedSGST),
    cess: round(availableCess - reversedCess),
  }

  return { available, reversed, netITC }
}

// ─── Table 5: Exempt/Nil/Non-GST Inward ─────────────────────────────

function computeTable5(expenses: any[], businessStateCode: string | null): Table5Row[] {
  let nilInter = 0, nilIntra = 0
  let exemptInter = 0, exemptIntra = 0
  let nonGSTInter = 0, nonGSTIntra = 0

  for (const tx of expenses) {
    const gstTx = transactionToGSTR1(tx)
    if (gstTx.gstRate > 0) continue // Only zero-rated

    const taxableValue = gstTx.taxableAmount
    const isInterState = isInterStateSupply(gstTx, businessStateCode)
    const category = tx.categoryCode || ""

    if (matchesKeyword(category, ["exempt"])) {
      if (isInterState) exemptInter += taxableValue
      else exemptIntra += taxableValue
    } else if (matchesKeyword(category, ["non_gst", "non-gst"])) {
      if (isInterState) nonGSTInter += taxableValue
      else nonGSTIntra += taxableValue
    } else {
      // Default zero-rate to nil
      if (isInterState) nilInter += taxableValue
      else nilIntra += taxableValue
    }
  }

  return [
    { description: "Nil Rated Supplies", interState: round(nilInter), intraState: round(nilIntra) },
    { description: "Exempted Supplies", interState: round(exemptInter), intraState: round(exemptIntra) },
    { description: "Non-GST Supplies", interState: round(nonGSTInter), intraState: round(nonGSTIntra) },
  ]
}

// ─── Table 6: Payment of Tax ─────────────────────────────────────────

function computeTable6(table31: Table31Row[], table4: { netITC: Table4Row }): Table6Row[] {
  // Total output tax from Table 3.1
  const outputIGST = table31.reduce((sum, r) => sum + r.igst, 0)
  const outputCGST = table31.reduce((sum, r) => sum + r.cgst, 0)
  const outputSGST = table31.reduce((sum, r) => sum + r.sgst, 0)
  const outputCess = table31.reduce((sum, r) => sum + r.cess, 0)

  // Net payable = Output - ITC
  return [{
    description: "Tax Payable",
    igst: round(Math.max(0, outputIGST - table4.netITC.igst)),
    cgst: round(Math.max(0, outputCGST - table4.netITC.cgst)),
    sgst: round(Math.max(0, outputSGST - table4.netITC.sgst)),
    cess: round(Math.max(0, outputCess - table4.netITC.cess)),
  }, {
    description: "ITC Credit Balance (carry forward)",
    igst: round(Math.max(0, table4.netITC.igst - outputIGST)),
    cgst: round(Math.max(0, table4.netITC.cgst - outputCGST)),
    sgst: round(Math.max(0, table4.netITC.sgst - outputSGST)),
    cess: round(Math.max(0, table4.netITC.cess - outputCess)),
  }]
}

// ─── GSTR-3B JSON (GST Portal Format) ───────────────────────────────

export function generateGSTR3BJSON(report: GSTR3BSummary): object {
  return {
    gstin: report.gstin,
    ret_period: report.filingPeriod,
    sup_details: {
      osup_det: {
        txval: report.table31[0]?.taxableValue || 0,
        iamt: report.table31[0]?.igst || 0,
        camt: report.table31[0]?.cgst || 0,
        samt: report.table31[0]?.sgst || 0,
        csamt: report.table31[0]?.cess || 0,
      },
      osup_zero: {
        txval: report.table31[1]?.taxableValue || 0,
        iamt: 0, camt: 0, samt: 0, csamt: 0,
      },
      osup_nil_exmp: {
        txval: report.table31[2]?.taxableValue || 0,
        iamt: 0, camt: 0, samt: 0, csamt: 0,
      },
      rcm_sup: {
        txval: report.table31[3]?.taxableValue || 0,
        iamt: report.table31[3]?.igst || 0,
        camt: report.table31[3]?.cgst || 0,
        samt: report.table31[3]?.sgst || 0,
        csamt: report.table31[3]?.cess || 0,
      },
      non_gst_sup: {
        txval: report.table31[4]?.taxableValue || 0,
        iamt: 0, camt: 0, samt: 0, csamt: 0,
      },
    },
    itc_elg: {
      itc_avl: [{
        ty: "OTH",
        iamt: report.table4.available[0]?.igst || 0,
        camt: report.table4.available[0]?.cgst || 0,
        samt: report.table4.available[0]?.sgst || 0,
        csamt: report.table4.available[0]?.cess || 0,
      }],
      itc_rev: [{
        ty: "RUL",
        iamt: report.table4.reversed[0]?.igst || 0,
        camt: report.table4.reversed[0]?.cgst || 0,
        samt: report.table4.reversed[0]?.sgst || 0,
        csamt: report.table4.reversed[0]?.cess || 0,
      }],
      itc_net: {
        iamt: report.table4.netITC.igst,
        camt: report.table4.netITC.cgst,
        samt: report.table4.netITC.sgst,
        csamt: report.table4.netITC.cess,
      },
    },
    inward_sup: {
      isup_details: report.table5.map(row => ({
        ty: row.description.includes("Nil") ? "NILL" : row.description.includes("Exempt") ? "EXPT" : "NONGST",
        inter: row.interState,
        intra: row.intraState,
      })),
    },
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────

function round(n: number): number {
  return Math.round(n * 100) / 100
}

function isInterStateSupply(tx: any, businessStateCode: string | null): boolean {
  if (!businessStateCode || !tx.placeOfSupply) return false
  const posCode = Object.entries(INDIAN_STATES).find(
    ([, name]) => name.toLowerCase() === tx.placeOfSupply?.toLowerCase()
  )?.[0]
  return posCode ? posCode !== businessStateCode : false
}
