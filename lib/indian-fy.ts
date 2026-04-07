/**
 * Indian financial year helpers.
 * FY runs from April 1 to March 31.
 */

export function getIndianFY(date: Date): { year: string; start: Date; end: Date } {
  const month = date.getMonth()
  const year = date.getFullYear()

  const fyStartYear = month >= 3 ? year : year - 1
  const fyEndYear = fyStartYear + 1

  return {
    year: `${fyStartYear}-${String(fyEndYear).slice(2)}`,
    start: new Date(fyStartYear, 3, 1, 0, 0, 0, 0),
    end: new Date(fyEndYear, 2, 31, 23, 59, 59, 999),
  }
}

export function getGSTRPeriodDates(period: string): { start: Date; end: Date } {
  const month = parseInt(period.slice(0, 2), 10) - 1
  const year = parseInt(period.slice(2), 10)

  return {
    start: new Date(year, month, 1, 0, 0, 0, 0),
    end: new Date(year, month + 1, 0, 23, 59, 59, 999),
  }
}

export function validateGSTRPeriod(period: string): { valid: boolean; error?: string } {
  if (!period || !/^\d{6}$/.test(period)) {
    return { valid: false, error: "Period must be in MMYYYY format (e.g., 032026)" }
  }

  const month = parseInt(period.slice(0, 2), 10)
  const year = parseInt(period.slice(2), 10)

  if (Number.isNaN(month) || Number.isNaN(year)) {
    return { valid: false, error: "Period must contain only digits" }
  }

  if (month < 1 || month > 12) {
    return { valid: false, error: "Month must be between 01 and 12" }
  }

  if (year < 2017) {
    return { valid: false, error: "Year must be 2017 or later" }
  }

  const periodDate = new Date(year, month - 1, 1)
  const today = new Date()
  if (periodDate > today) {
    return { valid: false, error: "Cannot generate a report for a future period" }
  }

  return { valid: true }
}