import { prisma } from "@/lib/db"
import { logAudit, sanitizeForAudit } from "@/lib/audit"
import { Field, Prisma, Transaction, TransactionStatus, TransactionType } from "@/prisma/client"
import { cache } from "react"
import { getFields } from "./fields"
import { deleteFile } from "./files"

/** Fire-and-forget embedding — lazy import so it never breaks transaction operations */
function embedTransactionAsync(tx: Transaction) {
  import("@/lib/embeddings")
    .then(({ embedTransaction }) => embedTransaction(tx))
    .catch((err) => console.warn("Background embedding skipped:", err))
}

export type TransactionData = {
  name?: string | null
  description?: string | null
  merchant?: string | null
  total?: number | null
  currencyCode?: string | null
  convertedTotal?: number | null
  convertedCurrencyCode?: string | null
  type?: TransactionType | null
  items?: TransactionData[] | undefined
  note?: string | null
  files?: string[] | undefined
  extra?: Record<string, unknown>
  categoryCode?: string | null
  projectCode?: string | null
  issuedAt?: Date | string | null
  text?: string | null
  [key: string]: unknown
}

export type TransactionFilters = {
  search?: string
  dateFrom?: string
  dateTo?: string
  ordering?: string
  categoryCode?: string
  projectCode?: string
  type?: TransactionType
  page?: number
}

export type TransactionPagination = {
  limit: number
  offset: number
}

export const getTransactions = cache(
  async (
    userId: string,
    filters?: TransactionFilters,
    pagination?: TransactionPagination
  ): Promise<{
    transactions: Transaction[]
    total: number
  }> => {
    const where: Prisma.TransactionWhereInput = { userId, status: TransactionStatus.active }
    let orderBy: Prisma.TransactionOrderByWithRelationInput = { issuedAt: "desc" }

    if (filters) {
      if (filters.search) {
        where.OR = [
          { name: { contains: filters.search, mode: "insensitive" } },
          { merchant: { contains: filters.search, mode: "insensitive" } },
          { description: { contains: filters.search, mode: "insensitive" } },
          { note: { contains: filters.search, mode: "insensitive" } },
          { text: { contains: filters.search, mode: "insensitive" } },
        ]
      }

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

      if (filters.ordering) {
        const ALLOWED_SORT_FIELDS = ["issuedAt", "total", "name", "type", "merchant", "createdAt", "updatedAt"]
        const isDesc = filters.ordering.startsWith("-")
        const field = isDesc ? filters.ordering.slice(1) : filters.ordering
        if (ALLOWED_SORT_FIELDS.includes(field)) {
          orderBy = { [field]: isDesc ? "desc" : "asc" }
        }
      }
    }

    if (pagination) {
      const total = await prisma.transaction.count({ where })
      const transactions = await prisma.transaction.findMany({
        where,
        include: {
          category: true,
          project: true,
        },
        orderBy,
        take: pagination?.limit,
        skip: pagination?.offset,
      })
      return { transactions, total }
    } else {
      const transactions = await prisma.transaction.findMany({
        where,
        include: {
          category: true,
          project: true,
        },
        orderBy,
      })
      return { transactions, total: transactions.length }
    }
  }
)

export const getTransactionById = cache(async (id: string, userId: string): Promise<Transaction | null> => {
  return await prisma.transaction.findUnique({
    where: { id, userId },
    include: {
      category: true,
      project: true,
    },
  })
})

export const getTransactionsByFileId = cache(async (fileId: string, userId: string): Promise<Transaction[]> => {
  const linked = await prisma.transactionFile.findMany({
    where: { fileId, userId },
    select: { transaction: true },
  })

  if (linked.length > 0) {
    return linked.map((entry) => entry.transaction)
  }

  return await prisma.transaction.findMany({
    where: { files: { array_contains: [fileId] }, userId },
  })
})

/**
 * DB-side aggregation for the dashboard GST widget.
 * Groups transactions by gst_rate + type and sums the CGST+SGST+IGST
 * totals. Reads from the first-class GST columns and falls back to the
 * legacy `extra` JSON for transactions that pre-date the migration.
 *
 * This replaces a widget-side pattern that loaded every transaction
 * row into memory just to aggregate a few numeric fields.
 */
export type GSTSummaryResult = {
  slabs: Array<{ rate: number; inputGST: number; outputGST: number }>
  totalInput: number
  totalOutput: number
  netPayable: number
}

export const getGSTSummary = cache(
  async (userId: string, filters: TransactionFilters = {}): Promise<GSTSummaryResult> => {
    const dateFrom = filters.dateFrom ? new Date(filters.dateFrom) : null
    const dateTo = filters.dateTo ? new Date(filters.dateTo) : null

    // COALESCE(column, (extra->>'field')::numeric) reads the typed column
    // first and falls back to the JSON extra field for legacy rows.
    // Only rows with a positive total GST amount participate in the sum.
    const rows = await prisma.$queryRaw<
      Array<{ rate: number; type: string; input_gst: number; output_gst: number }>
    >`
      SELECT
        COALESCE("gst_rate", (extra->>'gst_rate')::numeric, 0)::float AS rate,
        type::text AS type,
        SUM(
          CASE WHEN type = 'expense'
            THEN
              COALESCE("cgst", (extra->>'cgst')::numeric, 0) +
              COALESCE("sgst", (extra->>'sgst')::numeric, 0) +
              COALESCE("igst", (extra->>'igst')::numeric, 0)
            ELSE 0
          END
        )::float AS input_gst,
        SUM(
          CASE WHEN type = 'income'
            THEN
              COALESCE("cgst", (extra->>'cgst')::numeric, 0) +
              COALESCE("sgst", (extra->>'sgst')::numeric, 0) +
              COALESCE("igst", (extra->>'igst')::numeric, 0)
            ELSE 0
          END
        )::float AS output_gst
      FROM "transactions"
      WHERE "user_id" = ${userId}::uuid
        AND "status" = 'active'
        AND (
          "gst_rate" IS NOT NULL
          OR extra ? 'gst_rate'
        )
        ${dateFrom ? Prisma.sql`AND "issued_at" >= ${dateFrom}` : Prisma.empty}
        ${dateTo ? Prisma.sql`AND "issued_at" <= ${dateTo}` : Prisma.empty}
        ${filters.categoryCode ? Prisma.sql`AND "category_code" = ${filters.categoryCode}` : Prisma.empty}
        ${filters.projectCode ? Prisma.sql`AND "project_code" = ${filters.projectCode}` : Prisma.empty}
      GROUP BY rate, type
      HAVING
        COALESCE("gst_rate", (extra->>'gst_rate')::numeric, 0) > 0
    `

    // Merge the income/expense rows into per-slab aggregates
    const slabMap = new Map<number, { input: number; output: number }>()
    for (const row of rows) {
      const rate = Number(row.rate)
      if (rate <= 0) continue
      const slab = slabMap.get(rate) || { input: 0, output: 0 }
      slab.input += Number(row.input_gst) || 0
      slab.output += Number(row.output_gst) || 0
      slabMap.set(rate, slab)
    }

    const slabs = Array.from(slabMap.entries())
      .map(([rate, data]) => ({
        rate,
        inputGST: Math.round(data.input * 100) / 100,
        outputGST: Math.round(data.output * 100) / 100,
      }))
      .filter((s) => s.inputGST > 0 || s.outputGST > 0)
      .sort((a, b) => a.rate - b.rate)

    const totalInput = slabs.reduce((sum, s) => sum + s.inputGST, 0)
    const totalOutput = slabs.reduce((sum, s) => sum + s.outputGST, 0)

    return {
      slabs,
      totalInput: Math.round(totalInput * 100) / 100,
      totalOutput: Math.round(totalOutput * 100) / 100,
      netPayable: Math.round((totalOutput - totalInput) * 100) / 100,
    }
  }
)

async function syncTransactionFiles(id: string, userId: string, fileIds: string[]) {
  const validFiles = await prisma.file.findMany({
    where: { id: { in: fileIds }, userId },
    select: { id: true },
  })
  const validFileIds = validFiles.map((file) => file.id)

  const existingLinks = await prisma.transactionFile.findMany({
    where: { transactionId: id, userId },
    select: { fileId: true },
  })

  const existingFileIds = existingLinks.map((link) => link.fileId)
  const toAdd = validFileIds.filter((fileId) => !existingFileIds.includes(fileId))
  const toRemove = existingFileIds.filter((fileId) => !validFileIds.includes(fileId))

  await prisma.transaction.update({
    where: { id, userId },
    data: { files: validFileIds },
  })

  if (toRemove.length > 0) {
    await prisma.transactionFile.deleteMany({
      where: {
        transactionId: id,
        userId,
        fileId: { in: toRemove },
      },
    })
  }

  for (const fileId of toAdd) {
    await prisma.transactionFile.create({
      data: {
        transactionId: id,
        fileId,
        userId,
      },
    })
  }
}

export const createTransaction = async (userId: string, data: TransactionData): Promise<Transaction> => {
  const { standard, extra } = await splitTransactionDataExtraFields(data, userId)

  const transaction = await prisma.transaction.create({
    data: {
      ...standard,
      extra: extra,
      items: data.items as Prisma.InputJsonValue,
      userId,
      files: data.files as string[] | undefined,
    },
  })

  if (data.files && data.files.length > 0) {
    await syncTransactionFiles(transaction.id, userId, data.files)
  }

  // Audit trail (Companies Act 2023 — immutable record)
  logAudit(userId, "transaction", transaction.id, "create", null, sanitizeForAudit(transaction as unknown as Record<string, unknown>))

  // Generate embedding async (non-blocking, best-effort)
  embedTransactionAsync(transaction)

  return transaction
}

export const updateTransaction = async (id: string, userId: string, data: TransactionData): Promise<Transaction> => {
  // Capture old value for audit trail
  const oldTransaction = await prisma.transaction.findUnique({ where: { id, userId } })

  const { standard, extra } = await splitTransactionDataExtraFields(data, userId)

  const transaction = await prisma.transaction.update({
    where: { id, userId },
    data: {
      ...standard,
      extra: extra,
      items: data.items ? (data.items as Prisma.InputJsonValue) : [],
    },
  })

  // Audit trail (Companies Act 2023 — captures before + after)
  logAudit(
    userId, "transaction", id, "update",
    oldTransaction ? sanitizeForAudit(oldTransaction as unknown as Record<string, unknown>) : null,
    sanitizeForAudit(transaction as unknown as Record<string, unknown>)
  )

  // Re-embed after update (non-blocking)
  embedTransactionAsync(transaction)

  return transaction
}

export const updateTransactionFiles = async (id: string, userId: string, files: string[]): Promise<Transaction> => {
  const transaction = await prisma.transaction.update({
    where: { id, userId },
    data: { files },
  })

  await syncTransactionFiles(id, userId, files)
  return transaction
}

/**
 * Reverse a transaction instead of deleting it (Companies Act 2013 compliance).
 * Financial records must be retained — reversals mark them as 'reversed' without removing data.
 */
export const reverseTransaction = async (id: string, userId: string): Promise<Transaction | undefined> => {
  const transaction = await getTransactionById(id, userId)

  if (transaction && transaction.status === "active") {
    logAudit(userId, "transaction", id, "update",
      sanitizeForAudit(transaction as unknown as Record<string, unknown>),
      { ...sanitizeForAudit(transaction as unknown as Record<string, unknown>), status: "reversed" }
    )

    return await prisma.transaction.update({
      where: { id, userId },
      data: { status: TransactionStatus.reversed },
    })
  }
}

/** @deprecated Use reverseTransaction instead. This permanently deletes data. */
export const deleteTransaction = async (id: string, userId: string): Promise<Transaction | undefined> => {
  const transaction = await getTransactionById(id, userId)
  if (transaction) {
    logAudit(userId, "transaction", id, "delete", sanitizeForAudit(transaction as unknown as Record<string, unknown>), null)
    const files = Array.isArray(transaction.files) ? transaction.files : []
    for (const fileId of files as string[]) {
      if ((await getTransactionsByFileId(fileId, userId)).length <= 1) {
        await deleteFile(fileId, userId)
      }
    }
    return await prisma.transaction.delete({ where: { id, userId } })
  }
}

export const bulkReverseTransactions = async (ids: string[], userId: string) => {
  const transactions = await prisma.transaction.findMany({
    where: { id: { in: ids }, userId, status: TransactionStatus.active },
  })
  for (const tx of transactions) {
    logAudit(userId, "transaction", tx.id, "update",
      sanitizeForAudit(tx as unknown as Record<string, unknown>),
      { ...sanitizeForAudit(tx as unknown as Record<string, unknown>), status: "reversed" }
    )
  }
  return await prisma.transaction.updateMany({
    where: { id: { in: ids }, userId },
    data: { status: TransactionStatus.reversed },
  })
}

/** @deprecated Use bulkReverseTransactions instead. */
export const bulkDeleteTransactions = async (ids: string[], userId: string) => {
  return await prisma.transaction.deleteMany({ where: { id: { in: ids }, userId } })
}

const splitTransactionDataExtraFields = async (
  data: TransactionData,
  userId: string
): Promise<{ standard: TransactionData; extra: Prisma.InputJsonValue }> => {
  const fields = await getFields(userId)
  const fieldMap = fields.reduce(
    (acc, field) => {
      acc[field.code] = field
      return acc
    },
    {} as Record<string, Field>
  )

  const standard: TransactionData = {}
  const extra: Record<string, unknown> = {}

  Object.entries(data).forEach(([key, value]) => {
    const fieldDef = fieldMap[key]
    if (fieldDef) {
      if (fieldDef.isExtra) {
        extra[key] = value
      } else {
        standard[key] = value
      }
    }
  })

  return { standard, extra: extra as Prisma.InputJsonValue }
}
