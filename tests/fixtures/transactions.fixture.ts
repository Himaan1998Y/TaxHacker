export const validGSTIN = '27AAPFU0939F1ZV'
export const invalidGSTIN = 'INVALIDGSTIN'
export const businessStateCode = '27'

export const sampleDbB2BTransaction = {
  id: 'tx-b2b-001',
  name: 'Customer A',
  merchant: 'Merchant A',
  invoiceNumber: 'INV-B2B-001',
  gstin: validGSTIN,
  total: 1180000,        // ₹11,800.00 total (inclusive of GST)
  taxableAmount: 1000000, // ₹10,000.00
  gstRate: 18,
  cgst: 90000,           // ₹900.00
  sgst: 90000,           // ₹900.00
  igst: 0,
  cess: 0,
  hsnCode: '1001',
  placeOfSupply: '27 - Maharashtra',
  supplyType: 'B2B',
  reverseCharge: false,
  issuedAt: new Date('2026-03-15').toISOString(),
  type: 'income',
  categoryCode: 'sales',
}

export const sampleDbB2CLTransaction = {
  id: 'tx-b2cl-001',
  name: 'Customer B',
  merchant: 'Merchant B',
  invoiceNumber: 'INV-B2CL-001',
  gstin: null,
  total: 26000000,        // ₹2,60,000.00 total
  taxableAmount: 24745763, // ₹2,47,457.63
  gstRate: 5,
  cgst: 0,
  sgst: 0,
  igst: 13054237,         // ₹1,30,542.37
  cess: 0,
  hsnCode: null,
  placeOfSupply: '29 - Karnataka',
  supplyType: null,
  reverseCharge: false,
  issuedAt: new Date('2026-03-15').toISOString(),
  type: 'income',
  categoryCode: 'sales',
}

export const sampleDbB2CSTransaction = {
  id: 'tx-b2cs-001',
  name: 'Customer C',
  merchant: 'Merchant C',
  invoiceNumber: null,
  gstin: null,
  total: 1000000,        // ₹10,000.00 total
  taxableAmount: 892857, // ₹8,928.57
  gstRate: 12,
  cgst: 53571,           // ₹535.71
  sgst: 53571,           // ₹535.71
  igst: 0,
  cess: 0,
  hsnCode: null,
  placeOfSupply: '27 - Maharashtra',
  supplyType: null,
  reverseCharge: false,
  issuedAt: new Date('2026-03-15').toISOString(),
  type: 'income',
  categoryCode: 'sales',
}

export const sampleDbNilTransaction = {
  id: 'tx-nil-001',
  name: 'Customer D',
  merchant: 'Merchant D',
  invoiceNumber: 'INV-NIL-001',
  gstin: '27ABCDE1234F1Z0',
  total: 500000,         // ₹5,000.00 total
  taxableAmount: 500000, // ₹5,000.00
  gstRate: 0,
  cgst: 0,
  sgst: 0,
  igst: 0,
  cess: 0,
  hsnCode: null,
  placeOfSupply: '27 - Maharashtra',
  supplyType: null,
  reverseCharge: false,
  issuedAt: new Date('2026-03-15').toISOString(),
  type: 'income',
  categoryCode: 'gst_nil_rated',
}

export const sampleDbExemptTransaction = {
  id: 'tx-exempt-001',
  name: 'Customer E',
  merchant: 'Customer E',
  invoiceNumber: null,
  gstin: null,
  total: 200000,         // ₹2,000.00 total
  taxableAmount: 200000, // ₹2,000.00
  gstRate: 0,
  cgst: 0,
  sgst: 0,
  igst: 0,
  cess: 0,
  hsnCode: null,
  placeOfSupply: '07 - Delhi',
  supplyType: null,
  reverseCharge: false,
  issuedAt: new Date('2026-03-15').toISOString(),
  type: 'income',
  categoryCode: 'gst_exempt',
}

export const sampleDbCDNRTransaction = {
  id: 'tx-cdnr-001',
  name: 'Customer F',
  merchant: 'Customer F',
  invoiceNumber: 'CN-001',
  gstin: validGSTIN,
  total: 50000,          // ₹500.00
  taxableAmount: 42373,  // ₹423.73
  gstRate: 18,
  cgst: 3813,
  sgst: 3813,
  igst: 0,
  cess: 0,
  hsnCode: null,
  placeOfSupply: '27 - Maharashtra',
  supplyType: 'CREDIT_NOTE',
  reverseCharge: false,
  issuedAt: new Date('2026-03-15').toISOString(),
  type: 'income',
  categoryCode: 'credit_note',
}

export const sampleDbRCMTransaction = {
  id: 'tx-rcm-001',
  name: 'Supplier G',
  merchant: 'Supplier G',
  invoiceNumber: 'PUR-RCM-001',
  gstin: '29SUPPLIER1234Z0',
  total: 118000,         // ₹1,180.00 total
  taxableAmount: 100000, // ₹1,000.00
  gstRate: 18,
  cgst: 0,
  sgst: 0,
  igst: 18000,
  cess: 0,
  hsnCode: null,
  placeOfSupply: '29 - Karnataka',
  supplyType: 'PURCHASE',
  reverseCharge: true,
  issuedAt: new Date('2026-03-15').toISOString(),
  type: 'expense',
  categoryCode: 'office',
}

export const sampleDbNonGSTTransaction = {
  id: 'tx-nongst-001',
  name: 'Customer H',
  merchant: 'Customer H',
  invoiceNumber: null,
  gstin: null,
  total: 700000,
  taxableAmount: 700000,
  gstRate: 0,
  cgst: 0,
  sgst: 0,
  igst: 0,
  cess: 0,
  hsnCode: null,
  placeOfSupply: '27 - Maharashtra',
  supplyType: null,
  reverseCharge: false,
  issuedAt: new Date('2026-03-15').toISOString(),
  type: 'income',
  categoryCode: 'non_gst',
}

export const sampleDbIncomeTransactions = [
  sampleDbB2BTransaction,
  sampleDbB2CLTransaction,
  sampleDbB2CSTransaction,
  sampleDbNilTransaction,
  sampleDbExemptTransaction,
  sampleDbCDNRTransaction,
  sampleDbNonGSTTransaction,
]

export const sampleDbExpenseTransactions = [sampleDbRCMTransaction]

type TransactionOverrides = Partial<typeof sampleDbB2BTransaction>

export function createGSTTransaction(overrides: TransactionOverrides = {}) {
  return {
    ...sampleDbB2BTransaction,
    id: overrides.id ?? `tx-gst-${Math.random().toString(36).slice(2, 10)}`,
    invoiceNumber: overrides.invoiceNumber ?? 'INV-GST-001',
    issuedAt: overrides.issuedAt ?? new Date('2026-03-15').toISOString(),
    ...overrides,
  }
}

export function createExportScenario() {
  return [
    createGSTTransaction({
      id: 'tx-export-001',
      merchant: 'ABC Corp',
      placeOfSupply: '07 - Delhi',
      igst: 180000,
      cgst: 0,
      sgst: 0,
      total: 1180000,
      taxableAmount: 1000000,
    }),
    createGSTTransaction({
      id: 'tx-export-002',
      merchant: 'XYZ Ltd',
      type: 'expense',
      categoryCode: 'office',
      total: 236000,
      taxableAmount: 200000,
      cgst: 18000,
      sgst: 18000,
      igst: 0,
    }),
  ]
}
