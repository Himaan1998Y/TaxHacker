import { describe, it, expect } from 'vitest'
import { generateTallyXML } from '@/lib/tally-export'
import { createExportZIP, generateTransactionCSV, sanitizeCSVValue } from '@/lib/export'
import { sampleDbB2BTransaction, sampleDbRCMTransaction } from './fixtures/transactions.fixture'

describe('Tally XML export', () => {
  it('renders valid Tally XML with sales and purchase vouchers', () => {
    const xml = generateTallyXML([sampleDbB2BTransaction, sampleDbRCMTransaction])

    expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>')
    expect(xml).toContain('<TALLYMESSAGE')
    expect(xml).toContain('<VOUCHER VCHTYPE="Sales"')
    expect(xml).toContain('<VOUCHER VCHTYPE="Purchase"')
    expect(xml).toContain('<LEDGERNAME>CGST @ 9%</LEDGERNAME>')
    expect(xml).toContain('<LEDGERNAME>Input IGST @ 18%</LEDGERNAME>')
    expect(xml).toContain('<PARTYLEDGERNAME>Supplier G</PARTYLEDGERNAME>')
  })
})

describe('CSV export helpers', () => {
  it('sanitizes formula values with a leading quote', () => {
    expect(sanitizeCSVValue('=1+1')).toBe("'=1+1")
    expect(sanitizeCSVValue('+SUM(A1:A2)')).toBe("'+SUM(A1:A2)")
    expect(sanitizeCSVValue('-CMD')).toBe("'-CMD")
    expect(sanitizeCSVValue('@FORM')).toBe("'@FORM")
    expect(sanitizeCSVValue('normal text')).toBe('normal text')
  })

  it('generates valid CSV from transaction rows', () => {
    const rows = [
      { id: '1', name: 'Alice', amount: '=100' },
      { id: '2', name: 'Bob', amount: '200' },
    ]
    const csv = generateTransactionCSV(rows, ['id', 'name', 'amount'])

    expect(csv).toContain('"id","name","amount"')
    expect(csv).toContain('"1","Alice","\'=100"')
    expect(csv).toContain('"2","Bob","200"')
  })

  it('packages CSV and attachments into a ZIP archive', async () => {
    const csv = generateTransactionCSV([
      { id: '1', name: 'Alice' },
    ], ['id', 'name'])
    const zipBuffer = await createExportZIP([
      { filename: 'transactions.csv', content: csv },
      { filename: 'readme.txt', content: 'export file' },
    ])

    expect(zipBuffer).toBeInstanceOf(Buffer)
    expect(zipBuffer.length).toBeGreaterThan(0)
  })

  it('sanitizes varied formula injection values', () => {
    expect(sanitizeCSVValue('=SUM(A1:A2)')).toBe("'=SUM(A1:A2)")
    expect(sanitizeCSVValue("+CMD|'\/C calc'!A0")).toBe("'+CMD|'\/C calc'!A0")
    expect(sanitizeCSVValue("-2+3+cmd|' /C calc'!D2")).toBe("'-2+3+cmd|' /C calc'!D2")
    expect(sanitizeCSVValue("@SUM(1+1)*cmd|' /C calc'!A0")).toBe("'@SUM(1+1)*cmd|' /C calc'!A0")
  })

  it('preserves safe text without formula prefixes', () => {
    expect(sanitizeCSVValue('Sharma & Sons Pvt Ltd')).toBe('Sharma & Sons Pvt Ltd')
  })

  it('preserves rupee symbol values', () => {
    expect(sanitizeCSVValue('₹12,500.00')).toBe('₹12,500.00')
  })
})
