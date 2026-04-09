import { describe, it, expect } from 'vitest'
import {
  classifyTransaction,
  transactionToGSTR1,
  aggregateB2B,
  aggregateB2CL,
  aggregateB2CS,
  aggregateHSN,
  aggregateNil,
  aggregateAT,
  aggregateCDNR,
  aggregateCDNUR,
  generateGSTR1Report,
  generateGSTR1JSON,
  GSTR1Transaction,
} from '@/lib/gstr1'
import { validateGSTIN } from '@/lib/indian-tax-utils'
import {
  validGSTIN,
  invalidGSTIN,
  businessStateCode,
  sampleDbB2BTransaction,
  sampleDbB2CLTransaction,
  sampleDbB2CSTransaction,
  sampleDbNilTransaction,
  sampleDbExemptTransaction,
  sampleDbCDNRTransaction,
  sampleDbRCMTransaction,
  sampleDbNonGSTTransaction,
} from './fixtures/transactions.fixture'

function makeBaseTx(overrides: Partial<GSTR1Transaction & { section?: string }> = {}): GSTR1Transaction {
  return {
    id: 'tx1',
    name: 'Test Customer',
    merchant: 'Test Merchant',
    invoiceNumber: 'INV-001',
    gstin: null,
    total: 0,
    taxableAmount: 0,
    gstRate: 18,
    cgst: 0,
    sgst: 0,
    igst: 0,
    cess: 0,
    hsnCode: '1001',
    placeOfSupply: 'Karnataka',
    supplyType: null,
    reverseCharge: false,
    issuedAt: new Date(),
    type: 'income',
    categoryCode: 'sales',
    ...overrides,
  }
}

describe('GSTR-1 core helpers', () => {
  it('classifies valid GSTIN income as b2b', () => {
    const tx = makeBaseTx({ gstin: validGSTIN, supplyType: null })
    const result = classifyTransaction(tx, '29')
    expect(result.section).toBe('b2b')
  })

  it('classifies inter-state large supply without GSTIN as b2cl', () => {
    const tx = makeBaseTx({
      gstin: null,
      total: 260000,
      taxableAmount: 260000,
      placeOfSupply: 'Delhi',
      supplyType: null,
    })
    const result = classifyTransaction(tx, '29')
    expect(result.section).toBe('b2cl')
  })

  // Regression for B2CL threshold reduction (Notification 12/2024-CT,
  // effective 1 Aug 2024). Under the old ₹2.5L threshold a ₹1.5L inter-state
  // B2C invoice would have aggregated into B2CS. Under the current ₹1L
  // threshold it must be reported invoice-wise in B2CL (Table 5A).
  it('classifies inter-state ₹1.5L B2C as b2cl under the post-Aug-2024 ₹1L threshold', () => {
    const tx = makeBaseTx({
      gstin: null,
      total: 150000,
      taxableAmount: 150000,
      placeOfSupply: 'Delhi',
      supplyType: null,
    })
    const result = classifyTransaction(tx, '29')
    expect(result.section).toBe('b2cl')
  })

  // Boundary: exactly ₹1L should still be B2CS because the GST rule says
  // "exceeding ₹1 lakh" (strict >, not >=).
  it('keeps an inter-state invoice at exactly ₹1L as b2cs (threshold is strict)', () => {
    const tx = makeBaseTx({
      gstin: null,
      total: 100000,
      taxableAmount: 100000,
      placeOfSupply: 'Delhi',
      supplyType: null,
    })
    const result = classifyTransaction(tx, '29')
    expect(result.section).toBe('b2cs')
  })

  it('classifies default outward supply as b2cs', () => {
    const tx = makeBaseTx({
      gstin: null,
      total: 100000,
      taxableAmount: 100000,
      placeOfSupply: 'Karnataka',
      supplyType: null,
    })
    const result = classifyTransaction(tx, '29')
    expect(result.section).toBe('b2cs')
  })

  it('classifies expense transactions as skip', () => {
    const tx = makeBaseTx({ type: 'expense' })
    const result = classifyTransaction(tx, '29')
    expect(result.section).toBe('skip')
  })

  it('transforms raw DB transaction paise values into rupees and preserves reverse charge', () => {
    const mapped = transactionToGSTR1(sampleDbRCMTransaction)
    expect(mapped.total).toBe(1180)
    expect(mapped.taxableAmount).toBe(1000)
    expect(mapped.igst).toBe(180)
    expect(mapped.reverseCharge).toBe(true)
  })

  it('falls back to reconstructed taxableAmount when promoted field is missing', () => {
    const dbTx = {
      id: 'tx3',
      name: 'Test Customer',
      merchant: 'Test Merchant',
      invoiceNumber: 'INV-003',
      gstin: validGSTIN,
      total: 10000,
      gstRate: 18,
      cgst: 900,
      sgst: 900,
      igst: 0,
      cess: 0,
      hsnCode: '1001',
      placeOfSupply: 'Karnataka',
      supplyType: 'B2B',
      reverseCharge: false,
      issuedAt: new Date().toISOString(),
      type: 'income',
      categoryCode: 'sales',
    }

    const mapped = transactionToGSTR1(dbTx as any)
    expect(mapped.taxableAmount).toBe(82)
  })

  it('skips invalid GSTIN B2B rows during B2B aggregation', () => {
    const classified = [
      {
        ...makeBaseTx({
          gstin: invalidGSTIN,
          total: 100000,
          taxableAmount: 100000,
          gstRate: 18,
          cgst: 900,
          sgst: 900,
          igst: 0,
          cess: 0,
          invoiceNumber: 'INV-004',
          placeOfSupply: 'Karnataka',
          supplyType: 'B2B',
        }),
        section: 'b2b',
        warnings: [] as string[],
      },
    ] as any

    const result = aggregateB2B(classified)
    expect(result).toHaveLength(0)
    expect(classified[0].warnings).toContain('B2B row skipped for JSON export: invalid or missing GSTIN')
  })

  it('generates a GSTR-1 report with correct section counts and nil/exempt totals', () => {
    const report = generateGSTR1Report(
      [
        sampleDbB2BTransaction,
        sampleDbB2CLTransaction,
        sampleDbB2CSTransaction,
        sampleDbNilTransaction,
        sampleDbExemptTransaction,
        sampleDbCDNRTransaction,
        sampleDbNonGSTTransaction,
      ],
      businessStateCode
    )

    expect(report.sectionCounts.b2b.count).toBe(1)
    expect(report.sectionCounts.b2cl.count).toBe(1)
    expect(report.sectionCounts.b2cs.count).toBe(1)
    expect(report.sectionCounts.nil.count).toBe(2) // nil + non_gst both go through nil section logic
    expect(report.sectionCounts.exempt.count).toBe(1)
    expect(report.sectionCounts.skip.count).toBe(0)
    expect(report.nil[0].nilRatedIntraB2B).toBe(5000)
    expect(report.nil[0].exemptedInterB2C).toBe(2000)
    expect(report.nil[0].nonGSTIntraB2C).toBe(7000)
  })

  it('validates the sample GSTIN helper implementation', () => {
    expect(validateGSTIN(validGSTIN).valid).toBe(true)
  })

  describe('CDNR/CDNUR classification', () => {
    it('classifies a credit note with GSTIN as cdnr', () => {
      const tx = makeBaseTx({
        supplyType: 'credit_note',
        gstin: validGSTIN,
        total: -295000,
        taxableAmount: -250000,
        cgst: -22500,
        sgst: -22500,
        invoiceNumber: 'CN-001',
      })
      const result = classifyTransaction(tx, '29')
      expect(result.section).toBe('cdnr')
      expect(result.warnings).toHaveLength(0)
    })

    it('classifies a credit note without GSTIN as cdnur', () => {
      const tx = makeBaseTx({
        supplyType: 'credit_note',
        gstin: null,
        total: -300000,
        taxableAmount: -250000,
        igst: -50000,
        invoiceNumber: 'CN-002',
      })
      const result = classifyTransaction(tx, '29')
      expect(result.section).toBe('cdnur')
    })

    it('warns when note transactions are missing required fields', () => {
      const tx = makeBaseTx({
        supplyType: 'credit_note',
        gstin: validGSTIN,
        invoiceNumber: null,
        placeOfSupply: null,
      })
      const result = classifyTransaction(tx, '29')
      expect(result.section).toBe('cdnr')
      expect(result.warnings.some((w) => w.toLowerCase().includes('invoice'))).toBe(true)
      expect(result.warnings.some((w) => w.toLowerCase().includes('place of supply'))).toBe(true)
    })

    it('classifies export supplies as exp and warns on missing invoice number', () => {
      const tx = makeBaseTx({
        supplyType: 'export',
        gstRate: 0,
        categoryCode: 'export_sales',
        invoiceNumber: null,
      })
      const result = classifyTransaction(tx, '27')
      expect(result.section).toBe('exp')
      expect(result.warnings.some((w) => w.toLowerCase().includes('invoice'))).toBe(true)
    })

    it('classifies nil rated category transactions as nil', () => {
      const tx = makeBaseTx({
        gstRate: 0,
        categoryCode: 'gst_nil_rated',
      })
      const result = classifyTransaction(tx, '27')
      expect(result.section).toBe('nil')
    })
  })

  describe('B2B validation warnings', () => {
    it('warns when B2B transaction has no HSN code', () => {
      const tx = makeBaseTx({
        gstin: validGSTIN,
        supplyType: 'B2B',
        hsnCode: null,
      })
      const result = classifyTransaction(tx, '29')
      expect(result.section).toBe('b2b')
      expect(result.warnings.some((w) => w.toLowerCase().includes('hsn'))).toBe(true)
    })

    it('warns when B2B transaction has no invoice number', () => {
      const tx = makeBaseTx({
        gstin: validGSTIN,
        supplyType: 'B2B',
        invoiceNumber: null,
      })
      const result = classifyTransaction(tx, '29')
      expect(result.warnings.some((w) => w.toLowerCase().includes('invoice'))).toBe(true)
    })
  })

  describe('GSTR-1 aggregation helpers', () => {
    it('aggregates AT and note sections correctly', () => {
      const atSummary = aggregateAT([
        { ...makeBaseTx({ total: 1000, taxableAmount: 1000, supplyType: 'AT', gstRate: 18, placeOfSupply: 'Karnataka' }), section: 'at', warnings: [] },
        { ...makeBaseTx({ total: 500, taxableAmount: 500, supplyType: 'ATADJ', gstRate: 18, placeOfSupply: 'Karnataka' }), section: 'atadj', warnings: [] },
      ] as any, 'at')
      expect(atSummary[0].grossAdvanceReceived).toBe(1000)

      const cdnr = aggregateCDNR([
        { ...makeBaseTx({ total: -500, taxableAmount: -425, igst: -75, supplyType: 'credit_note', gstin: validGSTIN }), section: 'cdnr', warnings: [] },
      ] as any)
      expect(cdnr[0].noteType).toBe('C')
      expect(cdnr[0].noteValue).toBe(-500)

      const cdnur = aggregateCDNUR([
        { ...makeBaseTx({ total: -500, taxableAmount: -425, igst: -75, supplyType: 'credit_note', gstin: null }), section: 'cdnur', warnings: [] },
      ] as any)
      expect(cdnur[0].noteType).toBe('C')
      expect(cdnur[0].noteValue).toBe(-500)
    })

    it('aggregates B2CL, B2CS, HSN, and nil sections correctly', () => {
      const classified: any[] = [
        { ...makeBaseTx({ total: 20000000, taxableAmount: 20000000, gstin: validGSTIN, supplyType: 'B2B', hsnCode: '1001' }), section: 'b2b', warnings: [] },
        { ...makeBaseTx({ total: 26000000, taxableAmount: 26000000, placeOfSupply: 'Delhi', supplyType: null, gstin: null, hsnCode: '1002' }), section: 'b2cl', warnings: [] },
        { ...makeBaseTx({ total: 10000000, taxableAmount: 10000000, placeOfSupply: 'Karnataka', supplyType: null, gstin: null, hsnCode: '1001' }), section: 'b2cs', warnings: [] },
        { ...makeBaseTx({ total: 10000000, taxableAmount: 10000000, gstRate: 0, categoryCode: 'gst_nil_rated', placeOfSupply: 'Karnataka', hsnCode: '1003' }), section: 'nil', warnings: [] },
      ]

      const b2cl = aggregateB2CL(classified)
      const b2cs = aggregateB2CS(classified, '27')
      const hsn = aggregateHSN(classified)
      const nil = aggregateNil(classified, '27')

      expect(b2cl[0].invoiceNumber).toBe('INV-001')
      expect(b2cs.length).toBeGreaterThan(0)
      expect(hsn.some(entry => entry.hsnCode === '1001')).toBe(true)
      expect(nil[0].nilRatedIntraB2C).toBeGreaterThanOrEqual(0)
    })

    it('aggregates multiple B2B invoices under the same receiver', () => {
      const grouped = aggregateB2B([
        { ...makeBaseTx({ gstin: validGSTIN, invoiceNumber: 'INV-001', total: 1000, taxableAmount: 1000 }), section: 'b2b', warnings: [] },
        { ...makeBaseTx({ gstin: validGSTIN, invoiceNumber: 'INV-002', total: 2000, taxableAmount: 2000 }), section: 'b2b', warnings: [] },
      ] as any)
      expect(grouped).toHaveLength(1)
      expect(grouped[0].invoices).toHaveLength(2)
      expect(grouped[0].totalValue).toBe(3000)
    })

    it('assigns D note type for debit notes in CDNR and CDNUR', () => {
      const cdnr = aggregateCDNR([
        { ...makeBaseTx({ total: -500, taxableAmount: -425, igst: -75, supplyType: 'debit_note', gstin: validGSTIN }), section: 'cdnr', warnings: [] },
      ] as any)
      expect(cdnr[0].noteType).toBe('D')

      const cdnur = aggregateCDNUR([
        { ...makeBaseTx({ total: -500, taxableAmount: -425, igst: -75, supplyType: 'debit_note', gstin: null }), section: 'cdnur', warnings: [] },
      ] as any)
      expect(cdnur[0].noteType).toBe('D')
    })

    it('aggregates exempt and non-GST supplies in the nil report', () => {
      const classified: any[] = [
        { ...makeBaseTx({ total: 1000, taxableAmount: 1000, gstRate: 0, categoryCode: 'gst_exempt', placeOfSupply: 'Karnataka' }), section: 'exempt', warnings: [] },
        { ...makeBaseTx({ total: 1000, taxableAmount: 1000, gstRate: 0, categoryCode: 'non_gst', placeOfSupply: 'Delhi' }), section: 'nil', warnings: [] },
      ]
      const nil = aggregateNil(classified, '27')
      expect(nil[0].exemptedIntraB2C).toBeGreaterThanOrEqual(0)
      expect(nil[0].nonGSTInterB2C).toBeGreaterThanOrEqual(0)
    })

    it('classifies explicit supply type flows for B2CL, B2CS, AT, and ATADJ', () => {
      const b2cl = classifyTransaction(makeBaseTx({ supplyType: 'B2CL', gstin: null, total: 100000, taxableAmount: 100000, placeOfSupply: 'Delhi' }), '27')
      const b2cs = classifyTransaction(makeBaseTx({ supplyType: 'B2CS', gstin: null, total: 100000, taxableAmount: 100000, placeOfSupply: 'Karnataka' }), '27')
      const at = classifyTransaction(makeBaseTx({ supplyType: 'AT', gstin: null, total: 100000, taxableAmount: 100000, placeOfSupply: 'Karnataka' }), '27')
      const atadj = classifyTransaction(makeBaseTx({ supplyType: 'ATADJ', gstin: null, total: 100000, taxableAmount: 100000, placeOfSupply: 'Karnataka' }), '27')
      const debitNote = classifyTransaction(makeBaseTx({ supplyType: 'debit_note', gstin: validGSTIN, total: -50000, taxableAmount: -42500, igst: -7500, invoiceNumber: 'DN-001' }), '27')

      expect(b2cl.section).toBe('b2cl')
      expect(b2cs.section).toBe('b2cs')
      expect(at.section).toBe('at')
      expect(atadj.section).toBe('atadj')
      expect(debitNote.section).toBe('cdnr')
    })

    it('transforms extra JSON fields when building GSTR-1 transactions', () => {
      const dbTx = {
        id: 'tx-extra',
        name: 'Extra Customer',
        merchant: 'Extra Merchant',
        extra: {
          invoice_number: 'INV-EXTRA',
          gstin: validGSTIN,
          place_of_supply: 'Karnataka',
          hsn_sac_code: '1002',
          cgst: 900,
          sgst: 900,
          igst: 0,
          cess: 0,
        },
        total: 100000,
        gstRate: 18,
        reverseCharge: false,
        issuedAt: new Date().toISOString(),
        type: 'income',
        categoryCode: 'sales',
      }

      const result = transactionToGSTR1(dbTx as any)
      expect(result.invoiceNumber).toBe('INV-EXTRA')
      expect(result.gstin).toBe(validGSTIN)
      expect(result.hsnCode).toBe('1002')
    })

    it('produces portal JSON for cdnur and B2B report payloads', () => {
      const report = generateGSTR1Report([
        makeBaseTx({ gstin: validGSTIN, supplyType: 'B2B', total: 20000000, taxableAmount: 20000000 }),
        makeBaseTx({ supplyType: 'credit_note', gstin: null, total: -5000000, taxableAmount: -4250000, igst: -750000, invoiceNumber: 'CN-002' }),
      ], '27')

      const json = generateGSTR1JSON(report, validGSTIN, '042026') as any
      expect(json.gstin).toBe(validGSTIN)
      expect(json.b2b[0].ctin).toBe(validGSTIN)
      expect(json.b2b[0].inv[0].inum).toBe('INV-001')
      expect(json.b2b[0].inv[0].pos).toBe('29')
      expect(report.cdnur[0].noteNumber).toBe('CN-002')
    })
  })

  describe('GSTR-1 report generation', () => {
    it('builds a summary report across B2B, B2CL, B2CS, nil, and credit note sections', () => {
      const report = generateGSTR1Report([
        makeBaseTx({ gstin: validGSTIN, supplyType: 'B2B', total: 20000000, taxableAmount: 20000000 }),
        makeBaseTx({ gstin: null, total: 26000000, taxableAmount: 26000000, placeOfSupply: 'Delhi', supplyType: null }),
        makeBaseTx({ gstin: null, total: 10000000, taxableAmount: 10000000, placeOfSupply: 'Karnataka', supplyType: null }),
        makeBaseTx({ gstin: null, gstRate: 0, categoryCode: 'gst_nil_rated', total: 10000000, taxableAmount: 10000000, placeOfSupply: 'Karnataka' }),
        makeBaseTx({ supplyType: 'credit_note', gstin: validGSTIN, total: -5000000, taxableAmount: -4250000, igst: -750000, invoiceNumber: 'CN-001' }),
      ], '27')

      expect(report.sectionCounts.b2b.count).toBe(1)
      expect(report.sectionCounts.b2cl.count).toBe(1)
      expect(report.sectionCounts.b2cs.count).toBe(1)
      expect(report.sectionCounts.nil.count).toBe(1)
      expect(report.sectionCounts.cdnr.count + report.sectionCounts.cdnur.count).toBe(1)
      expect(report.b2b[0].gstin).toBe(validGSTIN)
      expect(report.hsn[0].hsnCode).toBe('1001')
      expect(report.nil[0].nilRatedIntraB2C).toBeGreaterThanOrEqual(0)
    })

    it('formats GSTR-1 report data for portal JSON output', () => {
      const report = generateGSTR1Report([
        makeBaseTx({ gstin: validGSTIN, supplyType: 'B2B', total: 200000, taxableAmount: 200000 }),
      ], '27')
      const json = generateGSTR1JSON(report, '27AAPFU0939F1ZV', '042026') as any

      expect(json.gstin).toBe('27AAPFU0939F1ZV')
      expect(json.fp).toBe('042026')
      expect(json.b2b[0].ctin).toBe(validGSTIN)
      expect(json.b2b[0].inv[0].val).toBe(report.b2b[0].invoices[0].invoiceValue)
    })
  })
})
