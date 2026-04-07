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

    // Only pull the columns actually used by the aggregation below —
    // avoids loading large JSON columns (items, extra, files, text).
    const transactions = await prisma.transaction.findMany({
      where,
      select: {
        type: true,
        total: true,
        convertedTotal: true,
        currencyCode: true,
        convertedCurrencyCode: true,
        issuedAt: true,
      },
      orderBy: { issuedAt: "asc" },
    })

    if (transactions.length === 0) {
      return []
    }

    // Determine if we should group by day or month
    const dateFrom = filters.dateFrom ? new Date(filters.dateFrom) : new Date(transactions[0].issuedAt!)
    const dateTo = filters.dateTo ? new Date(filters.dateTo) : new Date(transactions[transactions.length - 1].issuedAt!)
    const daysDiff = Math.ceil((dateTo.getTime() - dateFrom.getTime()) / (1000 * 60 * 60 * 24))
    const groupByDay = daysDiff <= 50

    // Group transactions by time period
    const grouped = transactions.reduce(
      (acc, transaction) => {
        if (!transaction.issuedAt) return acc

        const date = new Date(transaction.issuedAt)
        const period = groupByDay
          ? date.toISOString().split("T")[0] // YYYY-MM-DD
          : `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}` // YYYY-MM

        if (!acc[period]) {
          acc[period] = { period, income: 0, expenses: 0, date }
        }

        // Get amount in default currency
        const amount =
          transaction.convertedCurrencyCode?.toUpperCase() === defaultCurrency.toUpperCase()
            ? transaction.convertedTotal || 0
            : transaction.currencyCode?.toUpperCase() === defaultCurrency.toUpperCase()
              ? transaction.total || 0
              : 0 // Skip transactions not in default currency for simplicity

        if (transaction.type === "income") {
          acc[period].income += amount
        } else if (transaction.type === "expense") {
          acc[period].expenses += amount
        }

        return acc
      },
      {} as Record<string, TimeSeriesData>
    )

    return Object.values(grouped).sort((a, b) => a.date.getTime() - b.date.getTime())
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

    // Pull only the columns needed for the aggregation. Categories are
    // fetched separately (small table) and joined in-memory via lookup.
    const [transactions, categories] = await Promise.all([
      prisma.transaction.findMany({
        where,
        select: {
          type: true,
          total: true,
          convertedTotal: true,
          currencyCode: true,
          convertedCurrencyCode: true,
          categoryCode: true,
          issuedAt: true,
        },
        orderBy: { issuedAt: "asc" },
      }),
      prisma.category.findMany({
        where: { userId },
        orderBy: { name: "asc" },
      }),
    ])

    if (transactions.length === 0) {
      return []
    }

    // Determine if we should group by day or month
    const dateFrom = filters.dateFrom ? new Date(filters.dateFrom) : new Date(transactions[0].issuedAt!)
    const dateTo = filters.dateTo ? new Date(filters.dateTo) : new Date(transactions[transactions.length - 1].issuedAt!)
    const daysDiff = Math.ceil((dateTo.getTime() - dateFrom.getTime()) / (1000 * 60 * 60 * 24))
    const groupByDay = daysDiff <= 50

    // Create category lookup
    const categoryLookup = new Map(categories.map((cat) => [cat.code, cat]))

    // Group transactions by time period
    const grouped = transactions.reduce(
      (acc, transaction) => {
        if (!transaction.issuedAt) return acc

        const date = new Date(transaction.issuedAt)
        const period = groupByDay
          ? date.toISOString().split("T")[0] // YYYY-MM-DD
          : `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}` // YYYY-MM

        if (!acc[period]) {
          acc[period] = {
            period,
            income: 0,
            expenses: 0,
            date,
            categories: new Map<string, CategoryBreakdown>(),
            totalTransactions: 0,
          }
        }

        // Get amount in default currency
        const amount =
          transaction.convertedCurrencyCode?.toUpperCase() === defaultCurrency.toUpperCase()
            ? transaction.convertedTotal || 0
            : transaction.currencyCode?.toUpperCase() === defaultCurrency.toUpperCase()
              ? transaction.total || 0
              : 0 // Skip transactions not in default currency for simplicity

        const categoryCode = transaction.categoryCode || "other"
        const category = categoryLookup.get(categoryCode) || {
          code: "other",
          name: "Other",
          color: "#6b7280",
        }

        // Initialize category if not exists
        if (!acc[period].categories.has(categoryCode)) {
          acc[period].categories.set(categoryCode, {
            code: category.code,
            name: category.name,
            color: category.color || "#6b7280",
            income: 0,
            expenses: 0,
            transactionCount: 0,
          })
        }

        const categoryData = acc[period].categories.get(categoryCode)!
        categoryData.transactionCount++
        acc[period].totalTransactions++

        if (transaction.type === "income") {
          acc[period].income += amount
          categoryData.income += amount
        } else if (transaction.type === "expense") {
          acc[period].expenses += amount
          categoryData.expenses += amount
        }

        return acc
      },
      {} as Record<
        string,
        {
          period: string
          income: number
          expenses: number
          date: Date
          categories: Map<string, CategoryBreakdown>
          totalTransactions: number
        }
      >
    )

    return Object.values(grouped)
      .map((item) => ({
        ...item,
        categories: Array.from(item.categories.values()).filter((cat) => cat.income > 0 || cat.expenses > 0),
      }))
      .sort((a, b) => a.date.getTime() - b.date.getTime())
  }
)
