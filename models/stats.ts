import { prisma } from "@/lib/db"
import { Prisma } from "@/prisma/client"
import { cache } from "react"
import { TransactionFilters } from "./transactions"

export type DashboardStats = {
  totalIncomePerCurrency: Record<string, number>
  totalExpensesPerCurrency: Record<string, number>
  profitPerCurrency: Record<string, number>
  invoicesProcessed: number
}

// ──────────────────────────────────────────────────────────────────
// Internal helpers
// ──────────────────────────────────────────────────────────────────

/**
 * Build the base where clause used by every stats query.
 * Always filters out reversed transactions so stats reflect only
 * the authoritative "active" ledger.
 */
function buildStatsWhere(userId: string, filters: TransactionFilters): Prisma.TransactionWhereInput {
  const where: Prisma.TransactionWhereInput = { userId, status: "active" }

  if (filters.dateFrom || filters.dateTo) {
    where.issuedAt = {
      gte: filters.dateFrom ? new Date(filters.dateFrom) : undefined,
      lte: filters.dateTo ? new Date(filters.dateTo) : undefined,
    }
  }

  return where
}

type CurrencyTotals = { totalIncomePerCurrency: Record<string, number>; totalExpensesPerCurrency: Record<string, number> }

/**
 * Run a DB-side aggregation that groups transactions by (type, currency)
 * and sums the totals. Two separate groupBy calls — one for the
 * "converted" currency pair and one for the native currency pair. Rows
 * that have a converted amount are aggregated under the converted
 * currency (matching the old JS behaviour in calcTotalPerCurrency).
 *
 * The previous implementation loaded every row into memory and grouped
 * in JavaScript — this version returns the same shape in O(1) network
 * calls and lets PostgreSQL do the sum.
 */
async function aggregateCurrencyTotals(where: Prisma.TransactionWhereInput): Promise<CurrencyTotals> {
  // "converted" bucket — groupBy only rows that have a converted currency code
  const convertedRows = await prisma.transaction.groupBy({
    by: ["type", "convertedCurrencyCode"],
    where: {
      ...where,
      convertedCurrencyCode: { not: null },
    },
    _sum: { convertedTotal: true },
  })

  // "native" bucket — rows without a converted currency, grouped by their own currency
  const nativeRows = await prisma.transaction.groupBy({
    by: ["type", "currencyCode"],
    where: {
      ...where,
      convertedCurrencyCode: null,
    },
    _sum: { total: true },
  })

  const totalIncomePerCurrency: Record<string, number> = {}
  const totalExpensesPerCurrency: Record<string, number> = {}

  const addTo = (bucket: Record<string, number>, currency: string | null, amount: number | null) => {
    if (!currency || amount == null) return
    const key = currency.toUpperCase()
    bucket[key] = (bucket[key] || 0) + amount
  }

  for (const row of convertedRows) {
    const amount = row._sum.convertedTotal ?? 0
    if (row.type === "income") addTo(totalIncomePerCurrency, row.convertedCurrencyCode, amount)
    else if (row.type === "expense") addTo(totalExpensesPerCurrency, row.convertedCurrencyCode, amount)
  }
  for (const row of nativeRows) {
    const amount = row._sum.total ?? 0
    if (row.type === "income") addTo(totalIncomePerCurrency, row.currencyCode, amount)
    else if (row.type === "expense") addTo(totalExpensesPerCurrency, row.currencyCode, amount)
  }

  return { totalIncomePerCurrency, totalExpensesPerCurrency }
}

function profitFromTotals(totals: CurrencyTotals): Record<string, number> {
  const currencies = new Set([
    ...Object.keys(totals.totalIncomePerCurrency),
    ...Object.keys(totals.totalExpensesPerCurrency),
  ])
  return Object.fromEntries(
    Array.from(currencies).map((c) => [
      c,
      (totals.totalIncomePerCurrency[c] || 0) - (totals.totalExpensesPerCurrency[c] || 0),
    ])
  )
}

// ──────────────────────────────────────────────────────────────────
// Public API
// ──────────────────────────────────────────────────────────────────

export const getDashboardStats = cache(
  async (userId: string, filters: TransactionFilters = {}): Promise<DashboardStats> => {
    const where = buildStatsWhere(userId, filters)

    const [totals, invoicesProcessed] = await Promise.all([
      aggregateCurrencyTotals(where),
      prisma.transaction.count({ where }),
    ])

    return {
      ...totals,
      profitPerCurrency: profitFromTotals(totals),
      invoicesProcessed,
    }
  }
)

export type ProjectStats = {
  totalIncomePerCurrency: Record<string, number>
  totalExpensesPerCurrency: Record<string, number>
  profitPerCurrency: Record<string, number>
  invoicesProcessed: number
}

export const getProjectStats = cache(
  async (userId: string, projectId: string, filters: TransactionFilters = {}): Promise<ProjectStats> => {
    const where: Prisma.TransactionWhereInput = {
      ...buildStatsWhere(userId, filters),
      projectCode: projectId,
    }

    const [totals, invoicesProcessed] = await Promise.all([
      aggregateCurrencyTotals(where),
      prisma.transaction.count({ where }),
    ])

    return {
      ...totals,
      profitPerCurrency: profitFromTotals(totals),
      invoicesProcessed,
    }
  }
)

export type TimeSeriesData = {
  period: string
  income: number
  expenses: number
  date: Date
}

export type CategoryBreakdown = {
  code: string
  name: string
  color: string
  income: number
  expenses: number
  transactionCount: number
}

export type DetailedTimeSeriesData = {
  period: string
  income: number
  expenses: number
  date: Date
  categories: CategoryBreakdown[]
  totalTransactions: number
}

export const getTimeSeriesStats = cache(
  async (
    userId: string,
    filters: TransactionFilters = {},
    defaultCurrency: string = "INR"
  ): Promise<TimeSeriesData[]> => {
    const where: Prisma.TransactionWhereInput = { userId, status: "active" }

    if (filters.dateFrom || filters.dateTo) {
      where.issuedAt = {
        gte: filters.dateFrom ? new Date(filters.dateFrom) : undefined,
        lte: filters.dateTo ? new Date(filters.dateTo) : undefined,
      }
    }

    if (filters.categoryCode) {
      where.categoryCode = filters.categoryCode
    }

    if (filters.projectCode) {
      where.projectCode = filters.projectCode
    }

    if (filters.type) {
      where.type = filters.type
    }

    // Determine date range for day-vs-month grouping decision.
    // Use filter bounds when provided; otherwise query the actual min/max
    // from the DB so we don't load all rows just to read two dates.
    let dateFrom: Date
    let dateTo: Date

    if (filters.dateFrom && filters.dateTo) {
      dateFrom = new Date(filters.dateFrom)
      dateTo = new Date(filters.dateTo)
    } else {
      type MinMaxRow = { min_date: Date | null; max_date: Date | null }
      const [bounds] = await prisma.$queryRaw<MinMaxRow[]>`
        SELECT MIN(issued_at) AS min_date, MAX(issued_at) AS max_date
        FROM transactions
        WHERE user_id = ${userId}::uuid
          AND status = 'active'
          ${filters.dateFrom ? Prisma.sql`AND issued_at >= ${new Date(filters.dateFrom)}` : Prisma.empty}
          ${filters.dateTo ? Prisma.sql`AND issued_at <= ${new Date(filters.dateTo)}` : Prisma.empty}
          ${filters.categoryCode ? Prisma.sql`AND category_code = ${filters.categoryCode}` : Prisma.empty}
          ${filters.projectCode ? Prisma.sql`AND project_code = ${filters.projectCode}` : Prisma.empty}
          ${filters.type ? Prisma.sql`AND type = ${filters.type}` : Prisma.empty}
      `
      if (!bounds.min_date || !bounds.max_date) return []
      dateFrom = bounds.min_date
      dateTo = bounds.max_date
    }

    const daysDiff = Math.ceil((dateTo.getTime() - dateFrom.getTime()) / (1000 * 60 * 60 * 24))
    const groupByDay = daysDiff <= 50
    const truncUnit = groupByDay ? Prisma.sql`'day'` : Prisma.sql`'month'`
    const currency = defaultCurrency.toUpperCase()

    type RawTimeSeriesRow = {
      period: Date
      income: bigint
      expenses: bigint
    }

    const rows = await prisma.$queryRaw<RawTimeSeriesRow[]>`
      SELECT
        DATE_TRUNC(${truncUnit}, issued_at) AS period,
        SUM(CASE WHEN type = 'income' THEN
          CASE
            WHEN UPPER(converted_currency_code) = ${currency} THEN COALESCE(converted_total, 0)
            WHEN UPPER(currency_code) = ${currency} THEN COALESCE(total, 0)
            ELSE 0
          END
        ELSE 0 END) AS income,
        SUM(CASE WHEN type = 'expense' THEN
          CASE
            WHEN UPPER(converted_currency_code) = ${currency} THEN COALESCE(converted_total, 0)
            WHEN UPPER(currency_code) = ${currency} THEN COALESCE(total, 0)
            ELSE 0
          END
        ELSE 0 END) AS expenses
      FROM transactions
      WHERE user_id = ${userId}::uuid
        AND status = 'active'
        ${filters.dateFrom ? Prisma.sql`AND issued_at >= ${new Date(filters.dateFrom)}` : Prisma.empty}
        ${filters.dateTo ? Prisma.sql`AND issued_at <= ${new Date(filters.dateTo)}` : Prisma.empty}
        ${filters.categoryCode ? Prisma.sql`AND category_code = ${filters.categoryCode}` : Prisma.empty}
        ${filters.projectCode ? Prisma.sql`AND project_code = ${filters.projectCode}` : Prisma.empty}
        ${filters.type ? Prisma.sql`AND type = ${filters.type}` : Prisma.empty}
      GROUP BY period
      ORDER BY period
    `

    if (rows.length === 0) return []

    return rows.map((row) => {
      const date = new Date(row.period)
      const period = groupByDay
        ? date.toISOString().split("T")[0]
        : `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`
      return {
        period,
        income: Number(row.income),
        expenses: Number(row.expenses),
        date,
      }
    })
  }
)

export const getDetailedTimeSeriesStats = cache(
  async (
    userId: string,
    filters: TransactionFilters = {},
    defaultCurrency: string = "INR"
  ): Promise<DetailedTimeSeriesData[]> => {
    const where: Prisma.TransactionWhereInput = { userId, status: "active" }

    if (filters.dateFrom || filters.dateTo) {
      where.issuedAt = {
        gte: filters.dateFrom ? new Date(filters.dateFrom) : undefined,
        lte: filters.dateTo ? new Date(filters.dateTo) : undefined,
      }
    }

    if (filters.categoryCode) {
      where.categoryCode = filters.categoryCode
    }

    if (filters.projectCode) {
      where.projectCode = filters.projectCode
    }

    if (filters.type) {
      where.type = filters.type
    }

    // Fetch categories separately (small table) for name/color lookup.
    const categories = await prisma.category.findMany({
      where: { userId },
      orderBy: { name: "asc" },
    })

    // Determine date range for day-vs-month grouping decision.
    let dateFrom: Date
    let dateTo: Date

    if (filters.dateFrom && filters.dateTo) {
      dateFrom = new Date(filters.dateFrom)
      dateTo = new Date(filters.dateTo)
    } else {
      type MinMaxRow = { min_date: Date | null; max_date: Date | null }
      const [bounds] = await prisma.$queryRaw<MinMaxRow[]>`
        SELECT MIN(issued_at) AS min_date, MAX(issued_at) AS max_date
        FROM transactions
        WHERE user_id = ${userId}::uuid
          AND status = 'active'
          ${filters.dateFrom ? Prisma.sql`AND issued_at >= ${new Date(filters.dateFrom)}` : Prisma.empty}
          ${filters.dateTo ? Prisma.sql`AND issued_at <= ${new Date(filters.dateTo)}` : Prisma.empty}
          ${filters.categoryCode ? Prisma.sql`AND category_code = ${filters.categoryCode}` : Prisma.empty}
          ${filters.projectCode ? Prisma.sql`AND project_code = ${filters.projectCode}` : Prisma.empty}
          ${filters.type ? Prisma.sql`AND type = ${filters.type}` : Prisma.empty}
      `
      if (!bounds.min_date || !bounds.max_date) return []
      dateFrom = bounds.min_date
      dateTo = bounds.max_date
    }

    const daysDiff = Math.ceil((dateTo.getTime() - dateFrom.getTime()) / (1000 * 60 * 60 * 24))
    const groupByDay = daysDiff <= 50
    const truncUnit = groupByDay ? Prisma.sql`'day'` : Prisma.sql`'month'`
    const currency = defaultCurrency.toUpperCase()
    const categoryLookup = new Map(categories.map((cat) => [cat.code, cat]))

    type RawDetailedRow = {
      period: Date
      category_code: string | null
      income: bigint
      expenses: bigint
      transaction_count: bigint
    }

    const rows = await prisma.$queryRaw<RawDetailedRow[]>`
      SELECT
        DATE_TRUNC(${truncUnit}, issued_at) AS period,
        COALESCE(category_code, 'other') AS category_code,
        SUM(CASE WHEN type = 'income' THEN
          CASE
            WHEN UPPER(converted_currency_code) = ${currency} THEN COALESCE(converted_total, 0)
            WHEN UPPER(currency_code) = ${currency} THEN COALESCE(total, 0)
            ELSE 0
          END
        ELSE 0 END) AS income,
        SUM(CASE WHEN type = 'expense' THEN
          CASE
            WHEN UPPER(converted_currency_code) = ${currency} THEN COALESCE(converted_total, 0)
            WHEN UPPER(currency_code) = ${currency} THEN COALESCE(total, 0)
            ELSE 0
          END
        ELSE 0 END) AS expenses,
        COUNT(*) AS transaction_count
      FROM transactions
      WHERE user_id = ${userId}::uuid
        AND status = 'active'
        ${filters.dateFrom ? Prisma.sql`AND issued_at >= ${new Date(filters.dateFrom)}` : Prisma.empty}
        ${filters.dateTo ? Prisma.sql`AND issued_at <= ${new Date(filters.dateTo)}` : Prisma.empty}
        ${filters.categoryCode ? Prisma.sql`AND category_code = ${filters.categoryCode}` : Prisma.empty}
        ${filters.projectCode ? Prisma.sql`AND project_code = ${filters.projectCode}` : Prisma.empty}
        ${filters.type ? Prisma.sql`AND type = ${filters.type}` : Prisma.empty}
      GROUP BY period, category_code
      ORDER BY period, category_code
    `

    if (rows.length === 0) return []

    // Aggregate rows into per-period buckets in memory.
    // The heavy work (summing, counting) is already done by the DB —
    // this is just a lightweight pivot across a small result set.
    const periodMap = new Map<
      string,
      {
        period: string
        income: number
        expenses: number
        date: Date
        categories: Map<string, CategoryBreakdown>
        totalTransactions: number
      }
    >()

    for (const row of rows) {
      const date = new Date(row.period)
      const periodKey = groupByDay
        ? date.toISOString().split("T")[0]
        : `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`

      if (!periodMap.has(periodKey)) {
        periodMap.set(periodKey, {
          period: periodKey,
          income: 0,
          expenses: 0,
          date,
          categories: new Map<string, CategoryBreakdown>(),
          totalTransactions: 0,
        })
      }

      const bucket = periodMap.get(periodKey)!
      const rowIncome = Number(row.income)
      const rowExpenses = Number(row.expenses)
      const rowCount = Number(row.transaction_count)

      bucket.income += rowIncome
      bucket.expenses += rowExpenses
      bucket.totalTransactions += rowCount

      const catCode = row.category_code ?? "other"
      const catMeta = categoryLookup.get(catCode) || { code: "other", name: "Other", color: "#6b7280" }

      if (!bucket.categories.has(catCode)) {
        bucket.categories.set(catCode, {
          code: catMeta.code,
          name: catMeta.name,
          color: catMeta.color || "#6b7280",
          income: 0,
          expenses: 0,
          transactionCount: 0,
        })
      }

      const catBreakdown = bucket.categories.get(catCode)!
      catBreakdown.income += rowIncome
      catBreakdown.expenses += rowExpenses
      catBreakdown.transactionCount += rowCount
    }

    return Array.from(periodMap.values())
      .map((item) => ({
        ...item,
        categories: Array.from(item.categories.values()).filter((cat) => cat.income > 0 || cat.expenses > 0),
      }))
      .sort((a, b) => a.date.getTime() - b.date.getTime())
  }
)

// ──────────────────────────────────────────────────────────────────
// GST Summary (per-component breakdown for GSTR-3B table 3)
// ──────────────────────────────────────────────────────────────────

export type GSTSummaryResult = {
  totalOutput: number // rupees — output GST collected (income txns)
  totalInput: number // rupees — input GST paid / ITC available (expense txns)
  netPayable: number // rupees — positive = payable, negative = refund
  slabs: Array<{
    rate: number
    inputCGST: number
    inputSGST: number
    inputIGST: number
    outputCGST: number
    outputSGST: number
    outputIGST: number
  }>
}

export async function getGSTSummary(
  userId: string,
  filters?: { dateFrom?: string; dateTo?: string }
): Promise<GSTSummaryResult> {
  type RawGSTRow = {
    type: string
    rate: number
    cgst: bigint
    sgst: bigint
    igst: bigint
  }

  const rows = await prisma.$queryRaw<RawGSTRow[]>`
    SELECT
      type::text AS type,
      COALESCE(gst_rate, 0)::float AS rate,
      SUM(COALESCE(cgst, 0))::bigint AS cgst,
      SUM(COALESCE(sgst, 0))::bigint AS sgst,
      SUM(COALESCE(igst, 0))::bigint AS igst
    FROM transactions
    WHERE user_id = ${userId}::uuid
      AND status = 'active'
      AND gst_rate IS NOT NULL
      AND gst_rate > 0
      ${filters?.dateFrom ? Prisma.sql`AND issued_at >= ${new Date(filters.dateFrom)}` : Prisma.empty}
      ${filters?.dateTo ? Prisma.sql`AND issued_at <= ${new Date(filters.dateTo)}` : Prisma.empty}
    GROUP BY type, gst_rate
    ORDER BY type, gst_rate
  `

  // Merge rows into per-rate slabs
  const slabMap = new Map<
    number,
    {
      inputCGST: number
      inputSGST: number
      inputIGST: number
      outputCGST: number
      outputSGST: number
      outputIGST: number
    }
  >()

  for (const row of rows) {
    const rate = Number(row.rate)
    if (rate <= 0) continue

    const existing = slabMap.get(rate) || {
      inputCGST: 0,
      inputSGST: 0,
      inputIGST: 0,
      outputCGST: 0,
      outputSGST: 0,
      outputIGST: 0,
    }

    // Amounts from DB are in paise — divide by 100 for rupees
    const cgst = Number(row.cgst) / 100
    const sgst = Number(row.sgst) / 100
    const igst = Number(row.igst) / 100

    if (row.type === "expense") {
      existing.inputCGST += cgst
      existing.inputSGST += sgst
      existing.inputIGST += igst
    } else if (row.type === "income") {
      existing.outputCGST += cgst
      existing.outputSGST += sgst
      existing.outputIGST += igst
    }

    slabMap.set(rate, existing)
  }

  const slabs = Array.from(slabMap.entries())
    .map(([rate, data]) => ({ rate, ...data }))
    .sort((a, b) => a.rate - b.rate)

  const totalInput = slabs.reduce((sum, s) => sum + s.inputCGST + s.inputSGST + s.inputIGST, 0)
  const totalOutput = slabs.reduce((sum, s) => sum + s.outputCGST + s.outputSGST + s.outputIGST, 0)

  return {
    totalOutput: Math.round(totalOutput * 100) / 100,
    totalInput: Math.round(totalInput * 100) / 100,
    netPayable: Math.round((totalOutput - totalInput) * 100) / 100,
    slabs,
  }
}
