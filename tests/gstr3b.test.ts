import { describe, it, expect } from 'vitest'
import { generateGSTR3B, generateGSTR3BJSON } from '@/lib/gstr3b'

const validGSTIN = '27AAPFU0939F1ZV'

const transactions = [
  {
    id: '1',
    name: 'Customer B',
    merchant: 'Merchant B',
    invoiceNumber: 'INV-200',
    gstin: validGSTIN,
    total: 300000,
    taxableAmount: 300000,
    gstRate: 18,
    cgst: 27000,
    sgst: 27000,
    igst: 0,
    cess: 0,
    hsnCode: '1001',
    placeOfSupply: 'Maharashtra',
    supplyType: 'B2B',
    reverseCharge: false,
    issuedAt: new Date().toISOString(),
    type: 'income',
    categoryCode: 'sales',
  },
  {
    id: '2',
    name: 'Customer C',
    merchant: 'Merchant C',
    invoiceNumber: 'INV-201',
    gstin: null,
    total: 260000,
    taxableAmount: 260000,
    gstRate: 18,
    cgst: 0,
    sgst: 0,
    igst: 46800,
    cess: 0,
    hsnCode: '1002',
    placeOfSupply: 'Delhi',
    supplyType: undefined,
    reverseCharge: false,
    issuedAt: new Date().toISOString(),
    type: 'income',
    categoryCode: 'sales',
  },
  {
    id: '3',
    name: 'Customer D',
    merchant: 'Merchant D',
    invoiceNumber: 'INV-202',
    gstin: null,
    total: 100000,
    taxableAmount: 100000,
    gstRate: 12,
    cgst: 6000,
    sgst: 6000,
    igst: 0,
    cess: 0,
    hsnCode: '1003',
    placeOfSupply: 'Maharashtra',
    supplyType: undefined,
    reverseCharge: false,
    issuedAt: new Date().toISOString(),
    type: 'income',
    categoryCode: 'sales',
  },
  {
    id: '4',
    name: 'Supplier E',
    merchant: 'Merchant E',
    invoiceNumber: 'INV-203',
    gstin: validGSTIN,
    total: 50000,
    taxableAmount: 50000,
    gstRate: 18,
    cgst: 4500,
    sgst: 4500,
    igst: 0,
    cess: 0,
    hsnCode: '1004',
    placeOfSupply: 'Maharashtra',
    supplyType: undefined,
    reverseCharge: true,
    issuedAt: new Date().toISOString(),
    type: 'expense',
    categoryCode: 'office',
  },
  {
    id: '5',
    name: 'Customer F',
    merchant: 'Merchant F',
    invoiceNumber: 'INV-204',
    gstin: null,
    total: 100000,
    taxableAmount: 100000,
    gstRate: 0,
    cgst: 0,
    sgst: 0,
    igst: 0,
    cess: 0,
    hsnCode: '1005',
    placeOfSupply: 'Maharashtra',
    supplyType: undefined,
    reverseCharge: false,
    issuedAt: new Date().toISOString(),
    type: 'income',
    categoryCode: 'non_gst',
  },
]

describe('GSTR-3B summary generation', () => {
  it('computes table 3.1(a) from taxableAmount and counts non-GST supplies correctly', () => {
    const report = generateGSTR3B(transactions, '27', validGSTIN, '042026', [])
    expect(report.table31[0].taxableValue).toBe(3000 + 2600 + 1000)
    expect(report.table31[4].taxableValue).toBe(1000)
  })

  it('does not double count non-GST outward supplies in table 3.1(c)', () => {
    const report = generateGSTR3B([
      ...transactions,
      {
        id: '6',
        name: 'Customer G',
        merchant: 'Merchant G',
        invoiceNumber: 'INV-205',
        gstin: null,
        total: 5000,
        taxableAmount: 5000,
        gstRate: 0,
        cgst: 0,
        sgst: 0,
        igst: 0,
        cess: 0,
        hsnCode: '1006',
        placeOfSupply: 'Maharashtra',
        supplyType: undefined,
        reverseCharge: false,
        issuedAt: new Date().toISOString(),
        type: 'income',
        categoryCode: 'gst_nil_rated',
      },
      {
        id: '7',
        name: 'Customer H',
        merchant: 'Merchant H',
        invoiceNumber: 'INV-206',
        gstin: null,
        total: 6000,
        taxableAmount: 6000,
        gstRate: 0,
        cgst: 0,
        sgst: 0,
        igst: 0,
        cess: 0,
        hsnCode: '1007',
        placeOfSupply: 'Maharashtra',
        supplyType: undefined,
        reverseCharge: false,
        issuedAt: new Date().toISOString(),
        type: 'income',
        categoryCode: 'non_gst',
      },
    ], '27', validGSTIN, '042026', [])

    expect(report.table31[2].taxableValue).toBe(50)
    expect(report.table31[4].taxableValue).toBe(1060)
  })

  it('emits a valid GSTR-3B portal JSON payload', () => {
    const report = generateGSTR3B(transactions, '27', validGSTIN, '042026', [])
    const json = generateGSTR3BJSON(report) as any
    expect(json.sup_details.osup_det.txval).toBe(report.table31[0].taxableValue)
    expect(json.sup_details.osup_det.iamt).toBe(report.table31[0].igst)
    expect(json.itc_elg.itc_avl[0].iamt).toBe(report.table4.available[0].igst)
    expect(json.itc_elg.itc_rev[0].iamt).toBe(report.table4.reversed[0].igst)
    expect(json.inward_sup.isup_details).toBeInstanceOf(Array)
    expect(json.gstin).toBe(validGSTIN)
    expect(json.ret_period).toBe('042026')
  })

  it('produces stable GSTR-3B JSON table keys', () => {
    const report = generateGSTR3B(transactions, '27', validGSTIN, '042026', [])
    const json = generateGSTR3BJSON(report) as any
    expect(Object.keys(json.sup_details)).toEqual(['osup_det', 'osup_zero', 'osup_nil_exmp', 'rcm_sup', 'non_gst_sup'])
    expect(Object.keys(json.itc_elg)).toEqual(['itc_avl', 'itc_rev', 'itc_net'])
    expect(json.inward_sup.isup_details).toHaveLength(3)
  })

  it('carries forward ITC when input tax credit exceeds output tax', () => {
    const report = generateGSTR3B([
      {
        id: '10',
        name: 'Supplier X',
        merchant: 'Supplier X',
        invoiceNumber: 'INV-300',
        gstin: null,
        total: 0,
        taxableAmount: 100000,
        gstRate: 18,
        cgst: 9000,
        sgst: 9000,
        igst: 0,
        cess: 0,
        hsnCode: '1001',
        placeOfSupply: 'Maharashtra',
        supplyType: undefined,
        reverseCharge: false,
        issuedAt: new Date().toISOString(),
        type: 'expense',
        categoryCode: 'office',
      },
      {
        id: '11',
        name: 'Customer Y',
        merchant: 'Customer Y',
        invoiceNumber: 'INV-301',
        gstin: validGSTIN,
        total: 50000,
        taxableAmount: 50000,
        gstRate: 18,
        cgst: 4500,
        sgst: 4500,
        igst: 0,
        cess: 0,
        hsnCode: '1002',
        placeOfSupply: 'Maharashtra',
        supplyType: 'B2B',
        reverseCharge: false,
        issuedAt: new Date().toISOString(),
        type: 'income',
        categoryCode: 'sales',
      },
    ], '27', validGSTIN, '042026', [])

    expect(report.table6[1].cgst).toBeGreaterThan(0)
    expect(report.table6[1].igst).toBe(0)
  })

  it('blocks ITC for Section 17(5) categories', () => {
    const report = generateGSTR3B([
      {
        id: '12',
        name: 'Supplier Z',
        merchant: 'Supplier Z',
        invoiceNumber: 'INV-302',
        gstin: null,
        total: 100000,
        taxableAmount: 100000,
        gstRate: 18,
        cgst: 9000,
        sgst: 9000,
        igst: 0,
        cess: 0,
        hsnCode: '1003',
        placeOfSupply: 'Maharashtra',
        supplyType: undefined,
        reverseCharge: false,
        issuedAt: new Date().toISOString(),
        type: 'expense',
        categoryCode: 'food_beverage',
      },
    ], '27', validGSTIN, '042026', [])

    expect(report.table4.reversed[0].cgst).toBe(90)
    expect(report.table4.available[0].cgst).toBe(0)
  })

  it('classifies reverse charge expenses into table 3.1(d)', () => {
    const report = generateGSTR3B([
      {
        id: '13',
        name: 'Supplier R',
        merchant: 'Supplier R',
        invoiceNumber: 'INV-303',
        gstin: validGSTIN,
        total: 100000,
        taxableAmount: 100000,
        gstRate: 18,
        cgst: 0,
        sgst: 0,
        igst: 18000,
        cess: 0,
        hsnCode: '1004',
        placeOfSupply: 'Delhi',
        supplyType: undefined,
        reverseCharge: true,
        issuedAt: new Date().toISOString(),
        type: 'expense',
        categoryCode: 'office',
      },
    ], '27', validGSTIN, '042026', [])

    expect(report.table31[3].description).toContain('reverse charge')
    expect(report.table31[3].taxableValue).toBe(1000)
  })

  it('aggregates table 3.1(d) RCM across multiple suppliers', () => {
    const report = generateGSTR3B([
      {
        id: '14',
        name: 'Supplier R1',
        merchant: 'Supplier R1',
        invoiceNumber: 'INV-RCM-01',
        gstin: '01AADCT1111A1Z0',
        total: 59000,
        taxableAmount: 50000,
        gstRate: 18,
        cgst: 0,
        sgst: 0,
        igst: 9000,
        cess: 0,
        hsnCode: '1004',
        placeOfSupply: 'Delhi',
        supplyType: undefined,
        reverseCharge: true,
        issuedAt: new Date().toISOString(),
        type: 'expense',
        categoryCode: 'office',
      },
      {
        id: '15',
        name: 'Supplier R2',
        merchant: 'Supplier R2',
        invoiceNumber: 'INV-RCM-02',
        gstin: '02AADCT2222A2Z0',
        total: 118000,
        taxableAmount: 100000,
        gstRate: 18,
        cgst: 0,
        sgst: 0,
        igst: 18000,
        cess: 0,
        hsnCode: '1005',
        placeOfSupply: 'Delhi',
        supplyType: undefined,
        reverseCharge: true,
        issuedAt: new Date().toISOString(),
        type: 'expense',
        categoryCode: 'office',
      },
      {
        id: '16',
        name: 'Supplier R3',
        merchant: 'Supplier R3',
        invoiceNumber: 'INV-RCM-03',
        gstin: '03AADCT3333A3Z0',
        total: 236000,
        taxableAmount: 200000,
        gstRate: 18,
        cgst: 0,
        sgst: 0,
        igst: 36000,
        cess: 0,
        hsnCode: '1006',
        placeOfSupply: 'Delhi',
        supplyType: undefined,
        reverseCharge: true,
        issuedAt: new Date().toISOString(),
        type: 'expense',
        categoryCode: 'office',
      },
    ], '27', validGSTIN, '042026', [])

    expect(report.table31[3].taxableValue).toBe(3500)
    expect(report.table31[3].igst).toBe(630)
  })

  it('keeps blocked ITC out of net ITC when category is explicitly configured', () => {
    const report = generateGSTR3B([
      {
        id: '17',
        name: 'Supplier Allowed',
        merchant: 'Supplier Allowed',
        invoiceNumber: 'INV-ITC-01',
        gstin: validGSTIN,
        total: 118000,
        taxableAmount: 100000,
        gstRate: 18,
        cgst: 9000,
        sgst: 9000,
        igst: 0,
        cess: 0,
        hsnCode: '1007',
        placeOfSupply: 'Maharashtra',
        supplyType: undefined,
        reverseCharge: false,
        issuedAt: new Date().toISOString(),
        type: 'expense',
        categoryCode: 'office',
      },
      {
        id: '18',
        name: 'Supplier Blocked',
        merchant: 'Supplier Blocked',
        invoiceNumber: 'INV-ITC-02',
        gstin: validGSTIN,
        total: 118000,
        taxableAmount: 100000,
        gstRate: 18,
        cgst: 9000,
        sgst: 9000,
        igst: 0,
        cess: 0,
        hsnCode: '1008',
        placeOfSupply: 'Maharashtra',
        supplyType: undefined,
        reverseCharge: false,
        issuedAt: new Date().toISOString(),
        type: 'expense',
        categoryCode: 'blocked_custom',
      },
    ], '27', validGSTIN, '042026', ['blocked_custom'])

    expect(report.table4.available[0].cgst).toBe(90)
    expect(report.table4.reversed[0].cgst).toBe(90)
    expect(report.table4.netITC.cgst).toBe(0)
  })

  it('reports carry-forward credit in table 6 when ITC exceeds outward tax', () => {
    const report = generateGSTR3B([
      {
        id: '19',
        name: 'Small output',
        merchant: 'Small output',
        invoiceNumber: 'INV-OUT-01',
        gstin: validGSTIN,
        total: 11800,
        taxableAmount: 10000,
        gstRate: 18,
        cgst: 900,
        sgst: 900,
        igst: 0,
        cess: 0,
        hsnCode: '1009',
        placeOfSupply: 'Maharashtra',
        supplyType: 'B2B',
        reverseCharge: false,
        issuedAt: new Date().toISOString(),
        type: 'income',
        categoryCode: 'sales',
      },
      {
        id: '20',
        name: 'Large input',
        merchant: 'Large input',
        invoiceNumber: 'INV-IN-01',
        gstin: validGSTIN,
        total: 118000,
        taxableAmount: 100000,
        gstRate: 18,
        cgst: 9000,
        sgst: 9000,
        igst: 0,
        cess: 0,
        hsnCode: '1010',
        placeOfSupply: 'Maharashtra',
        supplyType: undefined,
        reverseCharge: false,
        issuedAt: new Date().toISOString(),
        type: 'expense',
        categoryCode: 'office',
      },
    ], '27', validGSTIN, '042026', [])

    expect(report.table6[0].cgst).toBe(0)
    expect(report.table6[0].sgst).toBe(0)
    expect(report.table6[1].cgst).toBeGreaterThan(0)
    expect(report.table6[1].sgst).toBeGreaterThan(0)
  })
})

describe('Table 5: Exempt/Nil/Non-GST inward supplies', () => {
  const baseExpense = {
    id: 'e1',
    name: 'Expense',
    merchant: 'Vendor',
    invoiceNumber: null,
    gstin: null,
    total: 50000,
    taxableAmount: 50000,
    gstRate: 0,
    cgst: 0,
    sgst: 0,
    igst: 0,
    cess: 0,
    hsnCode: null,
    placeOfSupply: 'Delhi',
    supplyType: null,
    reverseCharge: false,
    issuedAt: new Date().toISOString(),
    type: 'expense',
  }

  it('classifies exempt inter-state expenses correctly', () => {
    const report = generateGSTR3B(
      [{ ...baseExpense, categoryCode: 'exempt_services', placeOfSupply: 'Karnataka' }],
      '27', validGSTIN, '042026', []
    )
    const exemptRow = report.table5.find(r => r.description.includes('Exempt'))!
    expect(exemptRow.interState).toBeGreaterThan(0)
    expect(exemptRow.intraState).toBe(0)
  })

  it('classifies exempt intra-state expenses correctly', () => {
    const report = generateGSTR3B(
      [{ ...baseExpense, categoryCode: 'exempt_services', placeOfSupply: 'Maharashtra' }],
      '27', validGSTIN, '042026', []
    )
    const exemptRow = report.table5.find(r => r.description.includes('Exempt'))!
    expect(exemptRow.intraState).toBeGreaterThan(0)
    expect(exemptRow.interState).toBe(0)
  })

  it('classifies non-gst (hyphen) inter-state expenses correctly', () => {
    const report = generateGSTR3B(
      [{ ...baseExpense, categoryCode: 'non-gst_supplies', placeOfSupply: 'Karnataka' }],
      '27', validGSTIN, '042026', []
    )
    const nonGSTRow = report.table5.find(r => r.description.includes('Non-GST'))!
    expect(nonGSTRow.interState).toBeGreaterThan(0)
  })

  it('classifies non_gst (underscore) intra-state expenses correctly', () => {
    const report = generateGSTR3B(
      [{ ...baseExpense, categoryCode: 'non_gst_supplies', placeOfSupply: 'Maharashtra' }],
      '27', validGSTIN, '042026', []
    )
    const nonGSTRow = report.table5.find(r => r.description.includes('Non-GST'))!
    expect(nonGSTRow.intraState).toBeGreaterThan(0)
  })

  it('defaults to nil when category is neither exempt nor non-gst', () => {
    const report = generateGSTR3B(
      [{ ...baseExpense, categoryCode: 'other_zero', placeOfSupply: 'Maharashtra' }],
      '27', validGSTIN, '042026', []
    )
    const nilRow = report.table5.find(r => r.description.includes('Nil'))!
    expect(nilRow.intraState).toBeGreaterThan(0)
  })

  it('skips gst-rated expenses from Table 5', () => {
    const report = generateGSTR3B(
      [{ ...baseExpense, categoryCode: 'exempt', gstRate: 18, cgst: 4500, sgst: 4500 }],
      '27', validGSTIN, '042026', []
    )
    const exemptRow = report.table5.find(r => r.description.includes('Exempt'))!
    expect(exemptRow.intraState).toBe(0)
    expect(exemptRow.interState).toBe(0)
  })
})

describe('isInterStateSupply edge cases', () => {
  const baseExpense = {
    id: 'e1', name: 'E', merchant: 'V', invoiceNumber: null, gstin: null,
    total: 50000, taxableAmount: 50000, gstRate: 0, cgst: 0, sgst: 0, igst: 0, cess: 0,
    hsnCode: null, reverseCharge: false, issuedAt: new Date().toISOString(),
    type: 'expense', categoryCode: 'nil_rated',
  }

  it('treats unknown place-of-supply as intra-state (safe default)', () => {
    const report = generateGSTR3B(
      [{ ...baseExpense, placeOfSupply: 'UnknownState' }],
      '27', validGSTIN, '042026', []
    )
    const nilRow = report.table5.find(r => r.description.includes('Nil'))!
    // posCode not found → returns false → intra-state
    expect(nilRow.intraState).toBeGreaterThan(0)
    expect(nilRow.interState).toBe(0)
  })

  it('treats null businessStateCode as intra-state', () => {
    const report = generateGSTR3B(
      [{ ...baseExpense, placeOfSupply: 'Karnataka' }],
      null, validGSTIN, '042026', []
    )
    const nilRow = report.table5.find(r => r.description.includes('Nil'))!
    expect(nilRow.intraState).toBeGreaterThan(0)
  })

  it('treats null placeOfSupply as intra-state', () => {
    const report = generateGSTR3B(
      [{ ...baseExpense, placeOfSupply: null }],
      '27', validGSTIN, '042026', []
    )
    const nilRow = report.table5.find(r => r.description.includes('Nil'))!
    expect(nilRow.intraState).toBeGreaterThan(0)
  })
})

describe('generateGSTR3BJSON portal shape', () => {
  it('emits EXPT type for Exempt row and NONGST for Non-GST row', () => {
    const report = generateGSTR3B([], '27', validGSTIN, '042026', [])
    const json = generateGSTR3BJSON(report) as any
    const types = json.inward_sup.isup_details.map((r: any) => r.ty)
    expect(types).toContain('NILL')
    expect(types).toContain('EXPT')
    expect(types).toContain('NONGST')
  })

  it('uses || 0 fallback when table31 rows are missing', () => {
    const emptyReport = generateGSTR3B([], '27', validGSTIN, '042026', [])
    const sparseReport = { ...emptyReport, table31: [] }
    const json = generateGSTR3BJSON(sparseReport) as any
    expect(json.sup_details.osup_det.txval).toBe(0)
    expect(json.sup_details.rcm_sup.txval).toBe(0)
    expect(json.sup_details.non_gst_sup.txval).toBe(0)
  })
})
