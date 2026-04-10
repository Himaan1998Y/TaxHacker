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

// CONSOLIDATED: GSTSummaryResult and getGSTSummary moved to models/stats.ts
// (Tier 2.13 consolidation) to avoid duplicate type definitions.
// Use models/stats.getGSTSummary instead.

async function syncTransactionFiles(id: string, userId: string, fileIds: string[]) {
  // Reads are safe to run outside the transaction — they only establish
  // the target state. The mutations below must be atomic, though: without
  // $transaction, a crash between the three writes leaves the JSON
  // `files` column on the transaction row out of sync with the
  // TransactionFile join table, and future reads produce ghost files or
  // missing attachments.
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

  // No-op short circuit: if the target state already matches, skip the
  // write transaction entirely. Avoids row lock churn on the common
  // "user edited something unrelated" save path.
  if (toAdd.length === 0 && toRemove.length === 0) {
    // Still update the JSON column to normalise ordering in case the
    // caller passed a reordered list.
    await prisma.transaction.update({
      where: { id, userId },
      data: { files: validFileIds },
    })
    return
  }

  await prisma.$transaction(async (tx) => {
    await tx.transaction.update({
      where: { id, userId },
      data: { files: validFileIds },
    })

    if (toRemove.length > 0) {
      await tx.transactionFile.deleteMany({
        where: {
          transactionId: id,
          userId,
          fileId: { in: toRemove },
        },
      })
    }

    if (toAdd.length > 0) {
      // createMany collapses N round-trips into one SQL INSERT. The join
      // table has no cascading side effects so this is safe.
      await tx.transactionFile.createMany({
        data: toAdd.map((fileId) => ({
          transactionId: id,
          fileId,
          userId,
        })),
      })
    }
  })
}

export type CreateTransactionSuccess = {
  status: "success"
  transaction: Transaction
}

export type CreateTransactionDuplicate = {
  status: "duplicate_found"
  existingTransaction: Transaction
  newTransactionData: TransactionData
}

export type CreateTransactionResult = CreateTransactionSuccess | CreateTransactionDuplicate

export const createTransaction = async (
  userId: string,
  data: TransactionData,
  forceSave: boolean = false
): Promise<CreateTransactionResult> => {
  const { standard, extra } = await splitTransactionDataExtraFields(data, userId)
  const currencyCode = standard.currencyCode || "USD"

  // Deduplication check — skip if forceSave
  if (!forceSave && standard.total && standard.merchant && standard.issuedAt) {
    const existingTransaction = await prisma.transaction.findFirst({
      where: {
        userId,
        total: standard.total,
        merchant: standard.merchant,
        issuedAt: standard.issuedAt,
        currencyCode,
      },
    })

    if (existingTransaction) {
      return {
        status: "duplicate_found" as const,
        existingTransaction,
        newTransactionData: data,
      }
    }
  }

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

  return { status: "success" as const, transaction }
}

export const duplicateTransaction = async (id: string, userId: string): Promise<Transaction> => {
  const original = await getTransactionById(id, userId)
  if (!original) throw new Error("Transaction not found")

  const {
    id: _id,
    createdAt: _createdAt,
    updatedAt: _updatedAt,
    files: _files,
    ...rest
  } = original as Transaction & { category?: unknown; project?: unknown }

  const { category: _category, project: _project, ...transactionData } = rest as typeof rest & {
    category?: unknown
    project?: unknown
  }

  const newTx = await prisma.transaction.create({
    data: {
      ...transactionData,
      name: original.name ? `${original.name} (Copy)` : "Copy",
      files: [],
      items: original.items,
      extra: original.extra,
      user: { connect: { id: userId } },
    } as unknown as Prisma.TransactionCreateInput,
  })

  logAudit(userId, "transaction", newTx.id, "create", null, sanitizeForAudit(newTx as unknown as Record<string, unknown>))
  return newTx
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
