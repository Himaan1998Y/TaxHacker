import { describe, it, expect } from 'vitest'
import { validateGSTIN, validatePAN, calculateGST, getTDSRate, TDS_RATES } from '@/lib/indian-tax-utils'

// ─── GSTIN Validation ────────────────────────────────────────────────

describe('validateGSTIN', () => {
  it('returns error for empty input', () => {
    const result = validateGSTIN('')
    expect(result.valid).toBe(false)
    expect(result.error).toBe('GSTIN is empty')
  })

  it('returns error for wrong length', () => {
    const result = validateGSTIN('07AADCT1234')
    expect(result.valid).toBe(false)
    expect(result.error).toContain('Must be 15 characters')
  })

  it('returns error for invalid format', () => {
    // lowercase / wrong pattern
    const result = validateGSTIN('07aadct1234a1z5')
    // After uppercasing it becomes 07AADCT1234A1Z5, which may pass format.
    // Use a truly invalid format instead.
    const result2 = validateGSTIN('00AAAAA0000A0A0')
    expect(result2.valid).toBe(false)
  })

  it('returns error for invalid state code (00)', () => {
    // State code 00 does not exist in INDIAN_STATES
    // Build a string that passes regex but has state code 00
    const result = validateGSTIN('00AADCT1234A1Z5')
    expect(result.valid).toBe(false)
  })

  it('validates a correctly formed GSTIN with valid checksum', () => {
    // We need a GSTIN that passes the Luhn mod-36 checksum.
    // Let's compute one: state=07 (Delhi), PAN=AADCT1234A, entity=1, Z, then checksum.
    // Instead of manually computing, let's test with a known valid GSTIN.
    // 27AAPFU0939F1ZV is a well-known test GSTIN for Maharashtra.
    const result = validateGSTIN('27AAPFU0939F1ZV')
    expect(result.valid).toBe(true)
    expect(result.stateName).toBe('Maharashtra')
  })

  it('returns checksum mismatch for altered GSTIN', () => {
    // Take valid GSTIN and change last digit
    const result = validateGSTIN('27AAPFU0939F1ZA')
    expect(result.valid).toBe(false)
    expect(result.error).toBe('Checksum mismatch')
  })

  it('trims and uppercases input', () => {
    // If the GSTIN is valid after trim+uppercase, it should work
    const result = validateGSTIN('  27aapfu0939f1zv  ')
    expect(result.valid).toBe(true)
  })
})

// ─── PAN Validation ──────────────────────────────────────────────────

describe('validatePAN', () => {
  it('returns error for empty input', () => {
    const result = validatePAN('')
    expect(result.valid).toBe(false)
    expect(result.error).toBe('PAN is empty')
  })

  it('returns error for wrong length', () => {
    const result = validatePAN('ABCDE')
    expect(result.valid).toBe(false)
    expect(result.error).toContain('Must be 10 characters')
  })

  it('returns error for invalid format', () => {
    const result = validatePAN('1234567890')
    expect(result.valid).toBe(false)
    expect(result.error).toContain('Invalid format')
  })

  it('validates a correct PAN and detects Individual entity type', () => {
    const result = validatePAN('ABCPE1234F')
    expect(result.valid).toBe(true)
    expect(result.entityType).toBe('Individual')
  })

  it('detects Company entity type (4th char = C)', () => {
    const result = validatePAN('ABCCE1234F')
    expect(result.valid).toBe(true)
    expect(result.entityType).toBe('Company')
  })

  it('detects Firm/LLP entity type (4th char = F)', () => {
    const result = validatePAN('ABCFE1234F')
    expect(result.valid).toBe(true)
    expect(result.entityType).toBe('Firm / LLP')
  })

  it('detects HUF entity type (4th char = H)', () => {
    const result = validatePAN('ABCHE1234F')
    expect(result.valid).toBe(true)
    expect(result.entityType).toBe('HUF')
  })

  it('trims and uppercases input', () => {
    const result = validatePAN('  abcpe1234f  ')
    expect(result.valid).toBe(true)
    expect(result.entityType).toBe('Individual')
  })
})

// ─── GST Calculation ─────────────────────────────────────────────────

describe('calculateGST', () => {
  it('calculates tax-inclusive intra-state GST at 18%', () => {
    const result = calculateGST(11800, 18, false, 0, true)
    expect(result.taxableAmount).toBe(10000)
    expect(result.cgst).toBe(900)
    expect(result.sgst).toBe(900)
    expect(result.igst).toBe(0)
    expect(result.totalTax).toBe(1800)
    expect(result.grandTotal).toBe(11800)
  })

  it('calculates tax-inclusive inter-state GST at 18%', () => {
    const result = calculateGST(11800, 18, true, 0, true)
    expect(result.taxableAmount).toBe(10000)
    expect(result.cgst).toBe(0)
    expect(result.sgst).toBe(0)
    expect(result.igst).toBe(1800)
    expect(result.totalTax).toBe(1800)
    expect(result.grandTotal).toBe(11800)
  })

  it('calculates tax-exclusive GST', () => {
    const result = calculateGST(10000, 18, false, 0, false)
    expect(result.taxableAmount).toBe(10000)
    expect(result.cgst).toBe(900)
    expect(result.sgst).toBe(900)
    expect(result.totalTax).toBe(1800)
    expect(result.grandTotal).toBe(11800)
  })

  it('includes cess in calculation', () => {
    // 10000 taxable, 18% GST + 5% cess, tax-exclusive, intra-state
    const result = calculateGST(10000, 18, false, 5, false)
    expect(result.taxableAmount).toBe(10000)
    expect(result.cgst).toBe(900)
    expect(result.sgst).toBe(900)
    expect(result.cess).toBe(500)
    expect(result.totalTax).toBe(2300)
    expect(result.grandTotal).toBe(12300)
  })

  it('calculates tax-inclusive with cess', () => {
    // Amount 12300 inclusive of 18% GST + 5% cess
    const result = calculateGST(12300, 18, false, 5, true)
    expect(result.taxableAmount).toBe(10000)
    expect(result.cess).toBe(500)
    expect(result.totalTax).toBe(2300)
  })

  it('handles 0% GST rate', () => {
    const result = calculateGST(10000, 0, false, 0, false)
    expect(result.taxableAmount).toBe(10000)
    expect(result.cgst).toBe(0)
    expect(result.sgst).toBe(0)
    expect(result.igst).toBe(0)
    expect(result.totalTax).toBe(0)
    expect(result.grandTotal).toBe(10000)
  })
})

// ─── TDS Rate Lookup ─────────────────────────────────────────────────

describe('getTDSRate', () => {
  it('returns 1 for section 194C (individual contractor)', () => {
    expect(getTDSRate('194C')).toBe(1)
  })

  it('returns 5 for section 194H (commission/brokerage)', () => {
    expect(getTDSRate('194H')).toBe(5)
  })

  it('returns 10 for section 194I_land (rent)', () => {
    expect(getTDSRate('194I_land')).toBe(10)
  })

  it('returns 30 for section 194B (lottery/gambling)', () => {
    expect(getTDSRate('194B')).toBe(30)
  })

  it('returns 0 for unknown section', () => {
    expect(getTDSRate('999X')).toBe(0)
  })

  it('returns 0 for empty string', () => {
    expect(getTDSRate('')).toBe(0)
  })

  it('TDS_RATES has company rate for 194C as 2', () => {
    expect(TDS_RATES['194C'].rateCompany).toBe(2)
  })
})
