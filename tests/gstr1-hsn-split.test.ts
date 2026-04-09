import { describe, it, expect } from 'vitest'
import {
  aggregateHSN,
  aggregateHSNSplit,
  generateGSTR1Report,
  generateGSTR1JSON,
  hsnBucketForSection,
  type ClassifiedTransaction,
  type GSTR1Section,
} from '@/lib/gstr1'
import { validGSTIN } from './fixtures/transactions.fixture'

// GSTN Phase-III (April 2025) bifurcated Table 12 into separate B2B and
// B2C tabs. These tests pin down that split so a future refactor cannot
// silently collapse the two tabs into one.

function mkClassified(
  section: GSTR1Section,
  overrides: Partial<ClassifiedTransaction> = {}
): ClassifiedTransaction {
  return {
    id: `tx-${section}-${Math.random()}`,
    name: 'Customer',
    merchant: 'Merchant',
    invoiceNumber: 'INV-1',
    gstin: null,
    total: 118000,
    taxableAmount: 100000,
    gstRate: 18,
    cgst: 9000,
    sgst: 9000,
    igst: 0,
    cess: 0,
    hsnCode: '1001',
    placeOfSupply: 'Karnataka',
    supplyType: null,
    reverseCharge: false,
    issuedAt: new Date('2025-05-10'),
    type: 'income',
    section,
    warnings: [],
    ...overrides,
  } as ClassifiedTransaction
}

describe('hsnBucketForSection — Table 12 routing', () => {
  it('routes b2b and cdnr to the B2B tab', () => {
    expect(hsnBucketForSection('b2b')).toBe('b2b')
    expect(hsnBucketForSection('cdnr')).toBe('b2b')
  })

  it('routes b2cl, b2cs, exp, cdnur, nil and exempt to the B2C tab', () => {
    expect(hsnBucketForSection('b2cl')).toBe('b2c')
    expect(hsnBucketForSection('b2cs')).toBe('b2c')
    expect(hsnBucketForSection('exp')).toBe('b2c')
    expect(hsnBucketForSection('cdnur')).toBe('b2c')
    expect(hsnBucketForSection('nil')).toBe('b2c')
    expect(hsnBucketForSection('exempt')).toBe('b2c')
  })

  it('returns null for sections not reported in Table 12', () => {
    expect(hsnBucketForSection('skip')).toBeNull()
    expect(hsnBucketForSection('at')).toBeNull()
    expect(hsnBucketForSection('atadj')).toBeNull()
  })
})

describe('aggregateHSNSplit — Phase-III Table 12 bifurcation', () => {
  it('sends a B2B invoice to b2b and a B2CS invoice to b2c', () => {
    const classified: ClassifiedTransaction[] = [
      mkClassified('b2b', { hsnCode: '9954', gstin: validGSTIN }),
      mkClassified('b2cs', { hsnCode: '9988', gstin: null }),
    ]

    const split = aggregateHSNSplit(classified)

    expect(split.b2b).toHaveLength(1)
    expect(split.b2b[0].hsnCode).toBe('9954')
    expect(split.b2c).toHaveLength(1)
    expect(split.b2c[0].hsnCode).toBe('9988')
  })

  it('routes exports (exp) to the B2C tab, not B2B', () => {
    // Exports live in Table 6A, which GSTN maps into the B2C side of the
    // Table 12 validation rules. This is easy to get wrong because the
    // buyer is "registered" in the export sense, so pin it explicitly.
    const classified: ClassifiedTransaction[] = [
      mkClassified('exp', { hsnCode: '8471' }),
    ]

    const split = aggregateHSNSplit(classified)

    expect(split.b2b).toHaveLength(0)
    expect(split.b2c).toHaveLength(1)
    expect(split.b2c[0].hsnCode).toBe('8471')
  })

  it('excludes skip / at / atadj rows from both tabs', () => {
    const classified: ClassifiedTransaction[] = [
      mkClassified('skip', { hsnCode: '9999' }),
      mkClassified('at', { hsnCode: '9999' }),
      mkClassified('atadj', { hsnCode: '9999' }),
    ]

    const split = aggregateHSNSplit(classified)

    expect(split.b2b).toHaveLength(0)
    expect(split.b2c).toHaveLength(0)
  })

  it('keeps B2B and B2C totals under the same HSN code independent', () => {
    // Same HSN, one B2B (₹1,00,000 taxable) and one B2CS (₹50,000 taxable).
    // The two tabs must show the HSN twice with its own totals, not merged.
    const classified: ClassifiedTransaction[] = [
      mkClassified('b2b', {
        hsnCode: '1001',
        gstin: validGSTIN,
        taxableAmount: 100000,
        total: 118000,
      }),
      mkClassified('b2cs', {
        hsnCode: '1001',
        gstin: null,
        taxableAmount: 50000,
        total: 59000,
      }),
    ]

    const split = aggregateHSNSplit(classified)

    expect(split.b2b).toHaveLength(1)
    expect(split.b2b[0].taxableValue).toBe(100000)
    expect(split.b2c).toHaveLength(1)
    expect(split.b2c[0].taxableValue).toBe(50000)
  })

  it('aggregateHSN("b2b") matches the split.b2b output', () => {
    const classified: ClassifiedTransaction[] = [
      mkClassified('b2b', { hsnCode: '1001', gstin: validGSTIN, taxableAmount: 100000 }),
      mkClassified('b2cs', { hsnCode: '1002', gstin: null, taxableAmount: 50000 }),
    ]

    const split = aggregateHSNSplit(classified)
    const b2bOnly = aggregateHSN(classified, 'b2b')

    expect(b2bOnly).toEqual(split.b2b)
  })

  it('legacy aggregateHSN() (default "all") still returns both buckets', () => {
    const classified: ClassifiedTransaction[] = [
      mkClassified('b2b', { hsnCode: '1001', gstin: validGSTIN }),
      mkClassified('b2cs', { hsnCode: '1002', gstin: null }),
    ]

    const all = aggregateHSN(classified)

    const codes = all.map(e => e.hsnCode).sort()
    expect(codes).toEqual(['1001', '1002'])
  })
})

describe('GSTR-1 report exposes hsnB2B and hsnB2C alongside the combined hsn field', () => {
  const txBase = {
    name: 'Cust',
    merchant: 'Merch',
    gstRate: 18,
    cgst: 9000,
    sgst: 9000,
    igst: 0,
    cess: 0,
    type: 'income' as const,
    categoryCode: 'sales',
    reverseCharge: false,
    extra: {},
  }

  it('populates hsnB2B and hsnB2C on the generated report', () => {
    const transactions: any[] = [
      {
        ...txBase,
        id: 'b2b-1',
        invoiceNumber: 'INV-B2B-1',
        gstin: validGSTIN,
        total: 118000,
        taxableAmount: 100000,
        supplyType: 'B2B',
        hsnCode: '1001',
        placeOfSupply: 'Karnataka',
        issuedAt: new Date('2025-05-10'),
      },
      {
        ...txBase,
        id: 'b2cs-1',
        invoiceNumber: 'INV-B2CS-1',
        gstin: null,
        total: 59000,
        taxableAmount: 50000,
        supplyType: null,
        hsnCode: '1002',
        placeOfSupply: 'Karnataka',
        issuedAt: new Date('2025-05-10'),
      },
    ]

    const report = generateGSTR1Report(transactions as any, '29')

    expect(report.hsnB2B.map(e => e.hsnCode)).toEqual(['1001'])
    expect(report.hsnB2C.map(e => e.hsnCode)).toEqual(['1002'])
    // Combined field must be B2B first, then B2C (kept deterministic so
    // downstream snapshots and UI ordering stay stable).
    expect(report.hsn.map(e => e.hsnCode)).toEqual(['1001', '1002'])
  })

  it('emits hsn_b2b, hsn_b2c and legacy hsn keys in the JSON export', () => {
    const transactions: any[] = [
      {
        ...txBase,
        id: 'b2b-1',
        invoiceNumber: 'INV-B2B-1',
        gstin: validGSTIN,
        total: 118000,
        taxableAmount: 100000,
        supplyType: 'B2B',
        hsnCode: '1001',
        placeOfSupply: 'Karnataka',
        issuedAt: new Date('2025-05-10'),
      },
      {
        ...txBase,
        id: 'b2cs-1',
        invoiceNumber: 'INV-B2CS-1',
        gstin: null,
        total: 59000,
        taxableAmount: 50000,
        supplyType: null,
        hsnCode: '1002',
        placeOfSupply: 'Karnataka',
        issuedAt: new Date('2025-05-10'),
      },
    ]

    const report = generateGSTR1Report(transactions as any, '29')
    const json = generateGSTR1JSON(report, validGSTIN, '052025') as Record<string, any>

    expect(json.hsn_b2b).toBeDefined()
    expect(json.hsn_b2c).toBeDefined()
    expect(json.hsn).toBeDefined()
    expect(json.hsn_b2b.data.map((r: any) => r.hsn_sc)).toEqual(['1001'])
    expect(json.hsn_b2c.data.map((r: any) => r.hsn_sc)).toEqual(['1002'])
    expect(json.hsn.data.map((r: any) => r.hsn_sc)).toEqual(['1001', '1002'])
  })
})
