"use server"

import { transactionFormSchema } from "@/forms/transactions"
import { ActionState } from "@/lib/actions"
import { getCurrentUser, isSubscriptionExpired } from "@/lib/auth"
import {
  getDirectorySize,
  getTransactionFileUploadPath,
  getUserUploadsDirectory,
  safePathJoin,
  validateUploadedFile,
} from "@/lib/files"
import { updateField } from "@/models/fields"
import { createFile, deleteFile } from "@/models/files"
import { parseFilesArray } from "@/lib/db-compat"
import {
  bulkReverseTransactions,
  createTransaction,
  duplicateTransaction,
  reverseTransaction,
  getTransactionById,
  updateTransaction,
  updateTransactionFiles,
} from "@/models/transactions"
import { releaseStorageQuota, reserveStorageQuota, updateUser } from "@/models/users"
import { Transaction } from "@/prisma/client"
import { randomUUID } from "crypto"
import { mkdir, unlink, writeFile } from "fs/promises"
import { revalidatePath } from "next/cache"
import path from "path"

export async function createTransactionAction(
  _prevState: ActionState<Transaction> | null,
  formData: FormData
): Promise<ActionState<Transaction>> {
  try {
    const user = await getCurrentUser()
    const validatedForm = transactionFormSchema.safeParse(Object.fromEntries(formData.entries()))

    if (!validatedForm.success) {
      return { success: false, error: validatedForm.error.errors.map((e) => e.message).join(", ") }
    }

    const result = await createTransaction(user.id, validatedForm.data as import("@/models/transactions").TransactionData)

    if (result.status === "duplicate_found") {
      return { success: false, error: "DUPLICATE_FOUND", duplicateData: { existingTransaction: result.existingTransaction, newTransactionData: result.newTransactionData as Record<string, unknown> } }
    }

    revalidatePath("/transactions")
    return { success: true, data: result.transaction }
  } catch (error) {
    console.error("Failed to create transaction:", error)
    return { success: false, error: "Failed to create transaction" }
  }
}

export async function saveTransactionAction(
  _prevState: ActionState<Transaction> | null,
  formData: FormData
): Promise<ActionState<Transaction>> {
  try {
    const user = await getCurrentUser()
    const transactionId = formData.get("transactionId") as string
    const validatedForm = transactionFormSchema.safeParse(Object.fromEntries(formData.entries()))

    if (!validatedForm.success) {
      return { success: false, error: validatedForm.error.errors.map((e) => e.message).join(", ") }
    }

    const transaction = await updateTransaction(transactionId, user.id, validatedForm.data as import("@/models/transactions").TransactionData)

    revalidatePath("/transactions")
    return { success: true, data: transaction }
  } catch (error) {
    console.error("Failed to update transaction:", error)
    return { success: false, error: "Failed to save transaction" }
  }
}

export async function deleteTransactionAction(
  _prevState: ActionState<Transaction> | null,
  transactionId: string
): Promise<ActionState<Transaction>> {
  try {
    const user = await getCurrentUser()
    const transaction = await getTransactionById(transactionId, user.id)
    if (!transaction) throw new Error("Transaction not found")

    await reverseTransaction(transaction.id, user.id)

    revalidatePath("/transactions")

    return { success: true, data: transaction }
  } catch (error) {
    console.error("Failed to reverse transaction:", error)
    return { success: false, error: "Failed to reverse transaction" }
  }
}

export async function deleteTransactionFileAction(
  transactionId: string,
  fileId: string
): Promise<ActionState<Transaction>> {
  if (!fileId || !transactionId) {
    return { success: false, error: "File ID and transaction ID are required" }
  }

  const user = await getCurrentUser()
  const transaction = await getTransactionById(transactionId, user.id)
  if (!transaction) {
    return { success: false, error: "Transaction not found" }
  }

  await updateTransactionFiles(
    transactionId,
    user.id,
    parseFilesArray(transaction.files).filter((id) => id !== fileId)
  )

  await deleteFile(fileId, user.id)

  // Update user storage used
  const storageUsed = await getDirectorySize(getUserUploadsDirectory(user))
  await updateUser(user.id, { storageUsed })

  revalidatePath(`/transactions/${transactionId}`)
  return { success: true, data: transaction }
}

export async function uploadTransactionFilesAction(formData: FormData): Promise<ActionState<Transaction>> {
  try {
    const transactionId = formData.get("transactionId") as string
    const files = formData.getAll("files") as File[]

    if (!files || !transactionId) {
      return { success: false, error: "No files or transaction ID provided" }
    }

    const user = await getCurrentUser()
    const transaction = await getTransactionById(transactionId, user.id)
    if (!transaction) {
      return { success: false, error: "Transaction not found" }
    }

    const userUploadsDirectory = getUserUploadsDirectory(user)

    if (isSubscriptionExpired(user)) {
      return {
        success: false,
        error: "Your subscription has expired, please upgrade your account or buy new subscription plan",
      }
    }

    // SECURITY/INTEGRITY: Atomic quota reservation (see files/actions.ts
    // for the full explanation of the TOCTOU race this fixes).
    const totalFileSize = files.reduce((acc, file) => acc + file.size, 0)
    const reserved = await reserveStorageQuota(user.id, totalFileSize)
    if (!reserved) {
      return { success: false, error: "Insufficient storage to upload new files" }
    }

    const writtenPaths: string[] = []

    try {
      const fileRecords = await Promise.all(
        files.map(async (file) => {
          const fileUuid = randomUUID()
          const relativeFilePath = getTransactionFileUploadPath(fileUuid, file.name, transaction)
          const arrayBuffer = await file.arrayBuffer()
          const buffer = Buffer.from(arrayBuffer)

          const validationError = validateUploadedFile(file, buffer.slice(0, 8))
          if (validationError) {
            throw new Error(validationError)
          }

          const fullFilePath = safePathJoin(userUploadsDirectory, relativeFilePath)
          await mkdir(path.dirname(fullFilePath), { recursive: true })

          await writeFile(fullFilePath, buffer)
          writtenPaths.push(fullFilePath)

          // Create file record in database
          const fileRecord = await createFile(user.id, {
            id: fileUuid,
            filename: file.name,
            path: relativeFilePath,
            mimetype: file.type,
            isReviewed: true,
            metadata: {
              size: file.size,
              lastModified: file.lastModified,
            },
          })

          return fileRecord
        })
      )

      // Update invoice with the new file ID
      await updateTransactionFiles(
        transactionId,
        user.id,
        [...parseFilesArray(transaction.files), ...fileRecords.map((file) => file.id)]
      )

      // Reconcile reserved usage against actual disk usage
      const storageUsed = await getDirectorySize(getUserUploadsDirectory(user))
      await updateUser(user.id, { storageUsed })

      revalidatePath(`/transactions/${transactionId}`)
      return { success: true }
    } catch (error) {
      // Roll back: delete partial files + release reserved quota
      await Promise.all(
        writtenPaths.map(async (p) => {
          try {
            await unlink(p)
          } catch {
            // ignore cleanup failures
          }
        })
      )
      await releaseStorageQuota(user.id, totalFileSize)
      throw error
    }
  } catch (error) {
    console.error("Upload error:", error)
    return { success: false, error: "File upload failed. Please try again." }
  }
}

export async function bulkDeleteTransactionsAction(transactionIds: string[]) {
  try {
    const user = await getCurrentUser()
    await bulkReverseTransactions(transactionIds, user.id)
    revalidatePath("/transactions")
    return { success: true }
  } catch (error) {
    console.error("Failed to reverse transactions:", error)
    return { success: false, error: "Failed to reverse transactions" }
  }
}

export async function updateFieldVisibilityAction(fieldCode: string, isVisible: boolean) {
  try {
    const user = await getCurrentUser()
    await updateField(user.id, fieldCode, {
      isVisibleInList: isVisible,
    })
    return { success: true }
  } catch (error) {
    console.error("Failed to update field visibility:", error)
    return { success: false, error: "Failed to update field visibility" }
  }
}

export async function duplicateTransactionAction(
  transactionId: string
): Promise<ActionState<Transaction>> {
  try {
    const user = await getCurrentUser()
    const newTransaction = await duplicateTransaction(transactionId, user.id)
    revalidatePath("/transactions")
    return { success: true, data: newTransaction }
  } catch (error) {
    console.error("Failed to duplicate transaction:", error)
    return { success: false, error: "Failed to duplicate transaction" }
  }
}
