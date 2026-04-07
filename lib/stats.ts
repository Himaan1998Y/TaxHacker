import { Field, Transaction } from "@/prisma/client"

export function calcTotalPerCurrency(transactions: Transaction[]): Record<string, number> {
  return transactions.reduce(
    (acc, transaction) => {
      if (transaction.convertedCurrencyCode) {
        acc[transaction.convertedCurrencyCode.toUpperCase()] =
          (acc[transaction.convertedCurrencyCode.toUpperCase()] || 0) + (transaction.convertedTotal || 0)
      } else if (transaction.currencyCode) {
        acc[transaction.currencyCode.toUpperCase()] =
          (acc[transaction.currencyCode.toUpperCase()] || 0) + (transaction.total || 0)
      }
      return acc
    },
    {} as Record<string, number>
  )
}

export function calcNetTotalPerCurrency(transactions: Transaction[]): Record<string, number> {
  return transactions.reduce(
    (acc, transaction) => {
      let amount = 0
      let currency: string | undefined
      if (
        transaction.convertedTotal !== null &&
        transaction.convertedTotal !== undefined &&
        transaction.convertedCurrencyCode
      ) {
        amount = transaction.convertedTotal
        currency = transaction.convertedCurrencyCode.toUpperCase()
      } else if (transaction.total !== null && transaction.total !== undefined && transaction.currencyCode) {
        amount = transaction.total
        currency = transaction.currencyCode.toUpperCase()
      }
      if (currency && amount !== 0) {
        const sign = transaction.type === "expense" ? -1 : 1
        acc[currency] = (acc[currency] || 0) + amount * sign
      }
      return acc
    },
    {} as Record<string, number>
  )
}

export const isTransactionIncomplete = (fields: Field[], transaction: Transaction): boolean => {
  const incompleteFields = incompleteTransactionFields(fields, transaction)

  return incompleteFields.length > 0
}

export const incompleteTransactionFields = (fields: Field[], transaction: Transaction): Field[] => {
  const requiredFields = fields.filter((field) => field.isRequired)

  return requiredFields.filter((field) => {
    const value = field.isExtra
      ? (transaction.extra as Record<string, any>)?.[field.code]
      : transaction[field.code as keyof Transaction]

    return value === undefined || value === null || value === ""
  })
}

const INDIAN_NUMBERING_UNITS = [
  ['', ''],
  ['one', 'ten'],
  ['two', 'twenty'],
  ['three', 'thirty'],
  ['four', 'forty'],
  ['five', 'fifty'],
  ['six', 'sixty'],
  ['seven', 'seventy'],
  ['eight', 'eighty'],
  ['nine', 'ninety'],
]

const INDIAN_NUMBERING_TEENS: Record<number, string> = {
  10: 'ten',
  11: 'eleven',
  12: 'twelve',
  13: 'thirteen',
  14: 'fourteen',
  15: 'fifteen',
  16: 'sixteen',
  17: 'seventeen',
  18: 'eighteen',
  19: 'nineteen',
}

const INDIAN_NUMBERING_SCALE = [
  { value: 10000000, label: 'crore' },
  { value: 100000, label: 'lakh' },
  { value: 1000, label: 'thousand' },
]

function numberToWordsUnderThousand(value: number): string {
  const hundreds = Math.floor(value / 100)
  const remainder = value % 100
  const parts: string[] = []

  if (hundreds > 0) {
    parts.push(`${INDIAN_NUMBERING_UNITS[hundreds][0]} hundred`)
  }

  if (remainder >= 10 && remainder < 20) {
    parts.push(INDIAN_NUMBERING_TEENS[remainder])
  } else {
    const tens = Math.floor(remainder / 10)
    const ones = remainder % 10

    if (tens > 0) {
      const tensPart = INDIAN_NUMBERING_UNITS[tens][1]
      if (ones > 0) {
        parts.push(`${tensPart}-${INDIAN_NUMBERING_UNITS[ones][0]}`)
      } else {
        parts.push(tensPart)
      }
    } else if (ones > 0) {
      parts.push(INDIAN_NUMBERING_UNITS[ones][0])
    }
  }

  if (parts.length === 0) {
    return 'zero'
  }

  if (parts.length === 1) {
    return parts[0]
  }

  if (hundreds > 0) {
    return `${parts[0]} and ${parts.slice(1).join(' ')}`
  }

  return parts.join(' ')
}

export function numberToIndianWords(value: number): string {
  if (Number.isNaN(value) || !Number.isFinite(value)) {
    return 'zero'
  }

  if (value === 0) {
    return 'zero'
  }

  const sign = value < 0 ? 'minus ' : ''
  let absoluteValue = Math.abs(Math.floor(value))

  if (absoluteValue < 1000) {
    return `${sign}${numberToWordsUnderThousand(absoluteValue)}`.trim()
  }

  const parts: string[] = []

  for (const { value: scale, label } of INDIAN_NUMBERING_SCALE) {
    if (absoluteValue >= scale) {
      const count = Math.floor(absoluteValue / scale)
      absoluteValue %= scale
      parts.push(`${numberToIndianWords(count)} ${label}`)
    }
  }

  if (absoluteValue > 0) {
    parts.push(numberToWordsUnderThousand(absoluteValue))
  }

  return `${sign}${parts.join(' ')}`.trim()
}

export function amountToIndianWords(amount: number): string {
  if (Number.isNaN(amount) || !Number.isFinite(amount)) {
    return 'Rupees Zero Only'
  }

  const sign = amount < 0 ? 'Minus ' : ''
  const absolute = Math.abs(amount)
  const rupees = Math.floor(absolute)
  const paise = Math.round((absolute - rupees) * 100)

  let result = `${sign}Rupees ${numberToIndianWords(rupees)}`

  if (paise > 0) {
    result += ` and ${numberToIndianWords(paise)} paise`
  }

  result += ' Only'
  return result
}
