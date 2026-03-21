import { INDIAN_STATES } from "./indian-states"

// ─── GSTIN Validation ───────────────────────────────────────────────

const GSTIN_REGEX = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/
const GSTIN_CHECKSUM_CHARS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ"

export function validateGSTIN(gstin: string): { valid: boolean; error?: string; stateName?: string } {
  if (!gstin) return { valid: false, error: "GSTIN is empty" }

  const cleaned = gstin.trim().toUpperCase()

  if (cleaned.length !== 15) {
    return { valid: false, error: `Must be 15 characters (got ${cleaned.length})` }
  }

  if (!GSTIN_REGEX.test(cleaned)) {
    return { valid: false, error: "Invalid format" }
  }

  const stateCode = cleaned.substring(0, 2)
  if (!INDIAN_STATES[stateCode]) {
    return { valid: false, error: `Invalid state code: ${stateCode}` }
  }

  // Checksum validation (Luhn mod 36 variant)
  let sum = 0
  for (let i = 0; i < 14; i++) {
    const charIndex = GSTIN_CHECKSUM_CHARS.indexOf(cleaned[i])
    const factor = (i % 2 === 0) ? 1 : 2
    const product = charIndex * factor
    sum += Math.floor(product / 36) + (product % 36)
  }
  const expectedCheck = GSTIN_CHECKSUM_CHARS[(36 - (sum % 36)) % 36]
  if (cleaned[14] !== expectedCheck) {
    return { valid: false, error: "Checksum mismatch" }
  }

  return { valid: true, stateName: INDIAN_STATES[stateCode] }
}

// ─── PAN Validation ─────────────────────────────────────────────────

const PAN_REGEX = /^[A-Z]{5}[0-9]{4}[A-Z]{1}$/

export function validatePAN(pan: string): { valid: boolean; error?: string; entityType?: string } {
  if (!pan) return { valid: false, error: "PAN is empty" }

  const cleaned = pan.trim().toUpperCase()

  if (cleaned.length !== 10) {
    return { valid: false, error: `Must be 10 characters (got ${cleaned.length})` }
  }

  if (!PAN_REGEX.test(cleaned)) {
    return { valid: false, error: "Invalid format (ABCDE1234F)" }
  }

  const entityTypes: Record<string, string> = {
    A: "Association of Persons (AOP)",
    B: "Body of Individuals (BOI)",
    C: "Company",
    F: "Firm / LLP",
    G: "Government",
    H: "HUF",
    L: "Local Authority",
    J: "Artificial Juridical Person",
    P: "Individual",
    T: "Trust",
  }

  const entityCode = cleaned[3]
  return { valid: true, entityType: entityTypes[entityCode] || "Unknown" }
}

// ─── GST Calculation ────────────────────────────────────────────────

export type GSTBreakdown = {
  taxableAmount: number
  cgst: number
  sgst: number
  igst: number
  cess: number
  totalTax: number
  grandTotal: number
}

// Calculate GST breakdown from total (inclusive) or taxable amount (exclusive)
export function calculateGST(
  amount: number,
  gstRate: number,
  isInterStateTransaction: boolean,
  cessRate: number = 0,
  isTaxInclusive: boolean = true
): GSTBreakdown {
  let taxableAmount: number
  let totalTax: number

  if (isTaxInclusive) {
    // Amount includes GST — back-calculate
    taxableAmount = amount / (1 + (gstRate + cessRate) / 100)
    totalTax = amount - taxableAmount
  } else {
    // Amount is taxable value — forward-calculate
    taxableAmount = amount
    totalTax = taxableAmount * ((gstRate + cessRate) / 100)
  }

  const gstAmount = taxableAmount * (gstRate / 100)
  const cessAmount = taxableAmount * (cessRate / 100)

  let cgst = 0
  let sgst = 0
  let igst = 0

  if (isInterStateTransaction) {
    igst = gstAmount
  } else {
    cgst = gstAmount / 2
    sgst = gstAmount / 2
  }

  return {
    taxableAmount: round2(taxableAmount),
    cgst: round2(cgst),
    sgst: round2(sgst),
    igst: round2(igst),
    cess: round2(cessAmount),
    totalTax: round2(gstAmount + cessAmount),
    grandTotal: round2(taxableAmount + gstAmount + cessAmount),
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

// ─── TDS Rate Lookup ────────────────────────────────────────────────

export type TDSInfo = {
  section: string
  description: string
  rateIndividual: number
  rateCompany: number
  threshold: number
  thresholdNote: string
}

export const TDS_RATES: Record<string, TDSInfo> = {
  "194C": {
    section: "194C",
    description: "Payment to Contractors",
    rateIndividual: 1,
    rateCompany: 2,
    threshold: 30000,
    thresholdNote: "Single payment > ₹30K or aggregate > ₹1L in FY",
  },
  "194H": {
    section: "194H",
    description: "Commission / Brokerage",
    rateIndividual: 5,
    rateCompany: 5,
    threshold: 15000,
    thresholdNote: "Aggregate > ₹15K in FY",
  },
  "194I_land": {
    section: "194I",
    description: "Rent — Land & Building",
    rateIndividual: 10,
    rateCompany: 10,
    threshold: 240000,
    thresholdNote: "Aggregate > ₹2.4L in FY",
  },
  "194I_plant": {
    section: "194I",
    description: "Rent — Plant & Machinery",
    rateIndividual: 2,
    rateCompany: 2,
    threshold: 240000,
    thresholdNote: "Aggregate > ₹2.4L in FY",
  },
  "194J_tech": {
    section: "194J",
    description: "Technical Services / Royalty",
    rateIndividual: 2,
    rateCompany: 2,
    threshold: 30000,
    thresholdNote: "Aggregate > ₹30K in FY",
  },
  "194J_prof": {
    section: "194J",
    description: "Professional Services",
    rateIndividual: 10,
    rateCompany: 10,
    threshold: 30000,
    thresholdNote: "Aggregate > ₹30K in FY",
  },
  "194Q": {
    section: "194Q",
    description: "Purchase of Goods",
    rateIndividual: 0.1,
    rateCompany: 0.1,
    threshold: 5000000,
    thresholdNote: "Aggregate > ₹50L in FY, buyer turnover > ₹10Cr",
  },
  "194T": {
    section: "194T",
    description: "Partner Remuneration / Interest",
    rateIndividual: 10,
    rateCompany: 10,
    threshold: 20000,
    thresholdNote: "Aggregate > ₹20K in FY",
  },
  "194A": {
    section: "194A",
    description: "Interest (other than on securities)",
    rateIndividual: 10,
    rateCompany: 10,
    threshold: 40000,
    thresholdNote: "₹40K (banks/co-ops/post) or ₹5K (others) in FY",
  },
  "194B": {
    section: "194B",
    description: "Lottery / Crossword / Gambling",
    rateIndividual: 30,
    rateCompany: 30,
    threshold: 10000,
    thresholdNote: "> ₹10K single payment",
  },
}

// Get TDS rate for individuals (most common use case)
export function getTDSRate(sectionKey: string): number {
  return TDS_RATES[sectionKey]?.rateIndividual ?? 0
}

// Get TDS sections as options for dropdown
export function getTDSSectionOptions(): { key: string; label: string }[] {
  return Object.entries(TDS_RATES).map(([key, info]) => ({
    key,
    label: `${info.section} — ${info.description} (${info.rateIndividual}%)`,
  }))
}

// ─── GST Rate Slabs ─────────────────────────────────────────────────

export const GST_RATE_SLABS = [0, 5, 12, 18, 28] as const
export type GSTRateSlab = (typeof GST_RATE_SLABS)[number]
