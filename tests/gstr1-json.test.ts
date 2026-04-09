import { describe, it, expect } from 'vitest'
import { generateGSTR1JSON, GSTR1Summary } from '@/lib/gstr1'

const validGSTIN = '27AAPFU0939F1ZV'

const fixture: GSTR1Summary = {
  b2b: [{
    gstin: validGSTIN,
    receiverName: 'Customer A',
    totalValue: 100,
    invoices: [{
      invoiceNumber: 'INV-100',
      invoiceDate: '01/04/2026',
      invoiceValue: 100,
      reverseCharge: 'N',
      placeOfSupply: '27 - Maharashtra',
      rate: 18,
      taxableValue: 84,
      cgst: 8,
      sgst: 8,
      igst: 0,
      cess: 0,
    }],
  }],
  b2cl: [],
  b2cs: [{
    supplyType: 'Intra-State',
    rate: 5,
    taxableValue: 50,
    cgst: 2.5,
    placeOfSupply: '29 - Karnataka',
    sgst: 2.5,
    igst: 0,
    cess: 0,
  }],
  cdnr: [],
  cdnur: [],
  at: [],
  atadj: [],
  hsn: [],
  hsnB2B: [],
  hsnB2C: [],
  nil: [{
    description: 'Nil Rated / Exempt Supplies',
    nilRatedInterB2B: 0,
    nilRatedInterB2C: 10,
    nilRatedIntraB2B: 20,
    nilRatedIntraB2C: 30,
    exemptedInterB2B: 0,
    exemptedInterB2C: 5,
    exemptedIntraB2B: 10,
    exemptedIntraB2C: 15,
    nonGSTInterB2B: 1,
    nonGSTInterB2C: 24,
    nonGSTIntraB2B: 11,
    nonGSTIntraB2C: 24,
  }],
  classified: [],
  totalWarnings: 0,
  sectionCounts: {
    b2b: { count: 1, value: 84, warnings: 0 },
    b2cl: { count: 0, value: 0, warnings: 0 },
    b2cs: { count: 1, value: 50, warnings: 0 },
    exp: { count: 0, value: 0, warnings: 0 },
    nil: { count: 1, value: 95, warnings: 0 },
    exempt: { count: 0, value: 0, warnings: 0 },
    cdnr: { count: 0, value: 0, warnings: 0 },
    cdnur: { count: 0, value: 0, warnings: 0 },
    at: { count: 0, value: 0, warnings: 0 },
    atadj: { count: 0, value: 0, warnings: 0 },
    skip: { count: 0, value: 0, warnings: 0 },
  },
}

describe('GSTR-1 JSON export', () => {
  it('produces GSTN-shaped nil section with the 4 expected buckets', () => {
    const json = generateGSTR1JSON(fixture, validGSTIN, '042026') as any
    expect(json.nil.inv.map((item: any) => item.sply_ty)).toEqual([
      'INTRB2B',
      'INTRAB2B',
      'INTRB2C',
      'INTRAB2C',
    ])
    expect(json.b2b[0].inv[0].pos).toBe('27')
    expect(json.b2cs[0].pos).toBe('29')
    expect(json.nil.inv).toEqual([
      expect.objectContaining({ ngsup_amt: 11 }),
      expect.objectContaining({ ngsup_amt: 1 }),
      expect.objectContaining({ ngsup_amt: 24 }),
      expect.objectContaining({ ngsup_amt: 24 }),
    ])
    expect(Object.keys(json).some(key => key.startsWith('_'))).toBe(false)
  })
})
