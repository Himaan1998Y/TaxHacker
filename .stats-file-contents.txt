import { describe, it, expect } from 'vitest'
import {
  amountToIndianWords,
  calcNetTotalPerCurrency,
  calcTotalPerCurrency,
  incompleteTransactionFields,
  isTransactionIncomplete,
  numberToIndianWords,
} from '@/lib/stats'

describe('stats helpers', () => {
  it('calculates total per currency across converted and native transactions', () => {
    const transactions = [
      { total: 100, currencyCode: 'INR' },
      { total: 200, currencyCode: 'usd' },
      { convertedTotal: 300, convertedCurrencyCode: 'eur', currencyCode: 'INR' },
      { total: 400, currencyCode: 'inr' },
    ] as any

    const result = calcTotalPerCurrency(transactions)

    expect(result).toEqual({
      INR: 500,
      USD: 200,
      EUR: 300,
    })
  })

  it('calculates net totals using expense signs correctly', () => {
    const transactions = [
      { total: 100, currencyCode: 'INR', type: 'income' },
      { total: 50, currencyCode: 'INR', type: 'expense' },
      { convertedTotal: 200, convertedCurrencyCode: 'USD', type: 'expense' },
      { total: 300, currencyCode: 'USD', type: 'income' },
    ] as any

    const result = calcNetTotalPerCurrency(transactions)

    expect(result).toEqual({
      INR: 50,
      USD: 100,
    })
  })

  it('returns required fields that are missing from a transaction', () => {
    const fields = [
      { code: 'merchant', isRequired: true, isExtra: false },
      { code: 'custom_note', isRequired: true, isExtra: true },
      { code: 'invoiceNumber', isRequired: false, isExtra: false },
    ] as any

    const transaction = {
      merchant: '',
      extra: {},
      invoiceNumber: 'INV-001',
    }

    const missing = incompleteTransactionFields(fields, transaction as any)
    expect(missing.map((field) => field.code)).toEqual(['merchant', 'custom_note'])
    expect(isTransactionIncomplete(fields, transaction as any)).toBe(true)
  })

  it('returns false for complete transactions', () => {
    const fields = [
      { code: 'merchant', isRequired: true, isExtra: false },
      { code: 'invoiceNumber', isRequired: true, isExtra: false },
    ] as any

    const transaction = {
      merchant: 'Test Merchant',
      invoiceNumber: 'INV-010',
      extra: {},
    }

    expect(incompleteTransactionFields(fields, transaction as any)).toHaveLength(0)
    expect(isTransactionIncomplete(fields, transaction as any)).toBe(false)
  })

  it('converts numbers into Indian words correctly', () => {
    expect(numberToIndianWords(0)).toBe('zero')
    expect(numberToIndianWords(1)).toBe('one')
    expect(numberToIndianWords(10)).toBe('ten')
    expect(numberToIndianWords(11)).toBe('eleven')
    expect(numberToIndianWords(21)).toBe('twenty-one')
    expect(numberToIndianWords(100)).toBe('one hundred')
    expect(numberToIndianWords(101)).toBe('one hundred and one')
    expect(numberToIndianWords(1000)).toBe('one thousand')
    expect(numberToIndianWords(100000)).toBe('one lakh')
    expect(numberToIndianWords(10000000)).toBe('one crore')
  })

  it('converts amounts into Indian currency words correctly', () => {
    expect(amountToIndianWords(100)).toBe('Rupees one hundred Only')
    expect(amountToIndianWords(100.5)).toBe('Rupees one hundred and fifty paise Only')
    expect(amountToIndianWords(0.75)).toBe('Rupees zero and seventy-five paise Only')
    expect(amountToIndianWords(-12.34)).toBe('Minus Rupees twelve and thirty-four paise Only')
  })
})
