import { describe, it, expect } from 'vitest'
import { isWithinRetentionPeriod, getRetentionEndDate } from '@/lib/retention'

describe('isWithinRetentionPeriod', () => {
  it('returns true for a date 1 year ago (within 8-year retention)', () => {
    const oneYearAgo = new Date()
    oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1)
    expect(isWithinRetentionPeriod(oneYearAgo)).toBe(true)
  })

  it('returns true for a date 7 years ago (within 8-year retention)', () => {
    const sevenYearsAgo = new Date()
    sevenYearsAgo.setFullYear(sevenYearsAgo.getFullYear() - 7)
    expect(isWithinRetentionPeriod(sevenYearsAgo)).toBe(true)
  })

  it('returns false for a date 9 years ago (past 8-year retention)', () => {
    const nineYearsAgo = new Date()
    nineYearsAgo.setFullYear(nineYearsAgo.getFullYear() - 9)
    expect(isWithinRetentionPeriod(nineYearsAgo)).toBe(false)
  })

  it('returns true for today (beginning of retention period)', () => {
    expect(isWithinRetentionPeriod(new Date())).toBe(true)
  })

  it('accepts string dates', () => {
    const recent = new Date()
    recent.setFullYear(recent.getFullYear() - 2)
    expect(isWithinRetentionPeriod(recent.toISOString())).toBe(true)
  })

  it('returns false for a very old date (20 years ago)', () => {
    const old = new Date()
    old.setFullYear(old.getFullYear() - 20)
    expect(isWithinRetentionPeriod(old)).toBe(false)
  })
})

describe('getRetentionEndDate', () => {
  it('returns a date 8 years after the input', () => {
    const created = new Date('2020-04-01')
    const end = getRetentionEndDate(created)
    expect(end.getFullYear()).toBe(2028)
    expect(end.getMonth()).toBe(3) // April = month 3
    expect(end.getDate()).toBe(1)
  })

  it('accepts string dates', () => {
    const end = getRetentionEndDate('2025-01-15')
    expect(end.getFullYear()).toBe(2033)
  })

  it('returns a Date object', () => {
    const end = getRetentionEndDate(new Date())
    expect(end).toBeInstanceOf(Date)
  })

  it('retention end is exactly 8 years from creation', () => {
    const now = new Date()
    const end = getRetentionEndDate(now)
    const diffYears = end.getFullYear() - now.getFullYear()
    expect(diffYears).toBe(8)
  })
})
