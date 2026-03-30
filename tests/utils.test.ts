import { describe, it, expect } from 'vitest'
import { formatBytes, numberToIndianWords, amountToIndianWords, encodeFilename } from '@/lib/utils'

describe('formatBytes', () => {
  it('returns "0 Bytes" for 0', () => {
    expect(formatBytes(0)).toBe('0 Bytes')
  })

  it('returns "1 KB" for 1024', () => {
    expect(formatBytes(1024)).toBe('1 KB')
  })

  it('returns "1 MB" for 1048576', () => {
    expect(formatBytes(1048576)).toBe('1 MB')
  })

  it('returns "1 GB" for 1073741824', () => {
    expect(formatBytes(1073741824)).toBe('1 GB')
  })

  it('returns correct value for 500 bytes', () => {
    expect(formatBytes(500)).toBe('500 Bytes')
  })

  it('returns correct value for 1.5 KB', () => {
    expect(formatBytes(1536)).toBe('1.5 KB')
  })

  it('formats with up to 2 decimal places', () => {
    // 1234 bytes = 1.205... KB
    const result = formatBytes(1234)
    expect(result).toBe('1.21 KB')
  })

  it('caps at GB for very large values', () => {
    // 1 TB = 1099511627776 bytes, should show as 1024 GB (capped at GB)
    const result = formatBytes(1099511627776)
    expect(result).toBe('1024 GB')
  })
})

describe('numberToIndianWords', () => {
  it('converts 0 to "Zero"', () => {
    expect(numberToIndianWords(0)).toBe('Zero')
  })

  it('converts 1 to "One"', () => {
    expect(numberToIndianWords(1)).toBe('One')
  })

  it('converts 100000 to "One Lakh"', () => {
    expect(numberToIndianWords(100000)).toBe('One Lakh')
  })

  it('converts 123456 to proper Indian notation', () => {
    expect(numberToIndianWords(123456)).toBe('One Lakh Twenty Three Thousand Four Hundred Fifty Six')
  })

  it('converts 10000000 to "One Crore"', () => {
    expect(numberToIndianWords(10000000)).toBe('One Crore')
  })

  it('handles negative numbers', () => {
    expect(numberToIndianWords(-5000)).toBe('Minus Five Thousand')
  })
})

describe('amountToIndianWords', () => {
  it('formats INR amount with "Rupees ... Only"', () => {
    const result = amountToIndianWords(10000, 'INR')
    expect(result).toBe('Rupees Ten Thousand Only')
  })

  it('includes paise for fractional amounts', () => {
    const result = amountToIndianWords(10000.50, 'INR')
    expect(result).toBe('Rupees Ten Thousand and Fifty Paise Only')
  })

  it('uses generic format for non-INR currencies', () => {
    const result = amountToIndianWords(5000, 'USD')
    expect(result).toBe('Five Thousand')
  })
})

describe('encodeFilename', () => {
  it('encodes filename with special characters', () => {
    const result = encodeFilename('report (2).pdf')
    expect(result).toContain("UTF-8''")
    expect(result).toContain('report')
  })

  it('handles plain ASCII filename', () => {
    const result = encodeFilename('simple.txt')
    expect(result).toBe("UTF-8''simple.txt")
  })
})
