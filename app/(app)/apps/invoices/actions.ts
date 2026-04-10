"use server"

import { getCurrentUser, isSubscriptionExpired } from "@/lib/auth"
import {
  getTransactionFileUploadPath,
  getUserUploadsDirectory,
  safePathJoin,
} from "@/lib/files"
import config from "@/lib/config"
import { prisma } from "@/lib/db"
import { parseLocalDate } from "@/lib/utils"
import { getAppData, setAppData } from "@/models/apps"
import { createFileWithinTransaction } from "@/models/files"
import { Transaction, TransactionStatus, TransactionType } from "@/prisma/client"
import { renderToBuffer } from "@react-pdf/renderer"
import { randomUUID } from "crypto"
import { mkdir, writeFile, unlink } from "fs/promises"
import { revalidatePath } from "next/cache"
import path from "path"
import { createElement } from "react"
import { InvoiceFormData } from "./components/invoice-page"
import { InvoicePDF } from "./components/invoice-pdf"
import { InvoiceTemplate } from "./default-templates"
import { InvoiceAppData } from "./page"

export async function generateInvoicePDF(data: InvoiceFormData): Promise<Uint8Array> {
  const pdfElement = createElement(InvoicePDF, { data })
  const buffer = await renderToBuffer(pdfElement as any)
  return new Uint8Array(buffer)
}

export async function addNewTemplateAction(template: InvoiceTemplate) {
  // SECURITY: Use getCurrentUser() — never trust a caller-supplied user.
  const user = await getCurrentUser()
  if (!user) {
    return { success: false, error: "Unauthorized" }
  }

  const appData = (await getAppData(user, "invoices")) as InvoiceAppData | null
  const updatedTemplates = [...(appData?.templates || []), template]
  const appDataResult = await setAppData(user, "invoices", { ...appData, templates: updatedTemplates })
  return { success: true, data: appDataResult }
}

export async function deleteTemplateAction(templateId: string) {
  // SECURITY: Use getCurrentUser() — never trust a caller-supplied user.
  const user = await getCurrentUser()
  if (!user) {
    return { success: false, error: "Unauthorized" }
  }

  const appData = (await getAppData(user, "invoices")) as InvoiceAppData | null
  if (!appData) return { success: false, error: "No app data found" }

  const updatedTemplates = appData.templates.filter((t) => t.id !== templateId)
  const appDataResult = await setAppData(user, "invoices", { ...appData, templates: updatedTemplates })
  return { success: true, data: appDataResult }
}

export async function saveInvoiceAsTransactionAction(
  formData: InvoiceFormData
): Promise<{ success: boolean; error?: string; data?: Transaction }> {
  let createdFilePath: string | null = null

  try {
    const user = await getCurrentUser()

    if (isSubscriptionExpired(user)) {
      return {
        success: false,
        error: "Your subscription has expired, please upgrade your account or buy new subscription plan",
      }
    }

    // Generate PDF first so we know the exact byte size before opening the
    // DB transaction. This is CPU/network-bound and has no DB side-effects.
    const pdfBuffer = await generateInvoicePDF(formData)
    const fileSize = pdfBuffer.length

    // Derive stable path components before the transaction so they can be
    // referenced both for the disk write and for the DB file record.
    const fileUuid = randomUUID()
    const fileName = `invoice-${formData.invoiceNumber}.pdf`

    // Calculate total amount from items (pure computation, outside TX).
    const subtotal = formData.items.reduce((sum, item) => sum + item.subtotal, 0)
    const taxes = formData.additionalTaxes.reduce((sum, tax) => sum + tax.amount, 0)
    const fees = formData.additionalFees.reduce((sum, fee) => sum + fee.amount, 0)
    const totalAmount = (formData.taxIncluded ? subtotal : subtotal + taxes) + fees

    // ── Atomic storage-check + write ───────────────────────────────────────
    // Use a serializable transaction so that two concurrent requests cannot
    // both observe the same (pre-upload) storageUsed value and both conclude
    // they have enough space. PostgreSQL will abort one of them with a
    // serialization error, which Prisma surfaces as an exception.
    //
    // Inside the transaction we:
    //   1. Re-read the user row (acquires a snapshot-level lock under
    //      Serializable isolation — any concurrent write to this row causes
    //      a conflict and one transaction is rolled back automatically).
    //   2. Validate storage quota against the fresh value.
    //   3. Create the transaction row.
    //   4. Create the file record row.
    //   5. Increment user.storageUsed atomically.
    //
    // The disk write happens BEFORE the transaction opens so that the DB
    // commit is not blocked by I/O. If the transaction is rolled back (quota
    // exceeded or serialization conflict) the disk file is cleaned up in the
    // catch block below.

    const userUploadsDirectory = getUserUploadsDirectory(user)

    // Derive the file path deterministically from formData before opening the
    // DB transaction — this avoids needing a pre-created DB row for the path.
    const issuedAt = parseLocalDate(formData.date)

    // getTransactionFileUploadPath needs a Transaction-shaped object for the
    // issuedAt field only.
    const relativeFilePath = getTransactionFileUploadPath(fileUuid, fileName, { issuedAt } as Transaction)

    const fullFilePath = safePathJoin(userUploadsDirectory, relativeFilePath)
    await mkdir(path.dirname(fullFilePath), { recursive: true })
    await writeFile(fullFilePath, pdfBuffer)
    createdFilePath = fullFilePath

    // Open the serializable transaction AFTER the disk write.
    const { transaction } = await prisma.$transaction(
      async (tx) => {
        // Step 1 — re-read user with a fresh snapshot under Serializable
        // isolation. Any concurrent TX that also modifies this user's
        // storageUsed will cause a serialization conflict and one will be
        // retried/aborted by PostgreSQL.
        const freshUser = await tx.user.findUnique({ where: { id: user.id } })
        if (!freshUser) {
          throw new Error("User not found")
        }

        // Step 2 — validate quota with the live storageUsed value.
        const isSelfHosted = config.selfHosted.isEnabled
        const unlimited = isSelfHosted || Number(freshUser.storageLimit) < 0
        if (!unlimited) {
          const wouldUse = Number(freshUser.storageUsed) + fileSize
          if (wouldUse > Number(freshUser.storageLimit)) {
            throw new Error("Insufficient storage to save invoice PDF")
          }
        }

        // Step 3 — create the transaction row.
        // We call prisma.transaction.create directly with tx so it participates
        // in the same serializable snapshot. We cannot call createTransaction()
        // because it uses the top-level prisma client.
        const newTransaction = await tx.transaction.create({
          data: {
            name: `Invoice #${formData.invoiceNumber || "unknown"}`,
            merchant: `${formData.billTo.split("\n")[0]}`,
            total: totalAmount * 100,
            currencyCode: formData.currency,
            issuedAt,
            categoryCode: null,
            projectCode: null,
            type: TransactionType.income,
            status: TransactionStatus.active,
            userId: user.id,
            extra: {},
            items: [],
          },
        })

        // Step 4 — create the file record row.
        const newFileRecord = await createFileWithinTransaction(tx, user.id, {
          id: fileUuid,
          filename: fileName,
          path: relativeFilePath,
          mimetype: "application/pdf",
          isReviewed: true,
          metadata: {
            size: fileSize,
            lastModified: Date.now(),
          },
        })

        // Link file to transaction.
        await tx.transactionFile.create({
          data: {
            transactionId: newTransaction.id,
            fileId: newFileRecord.id,
            userId: user.id,
          },
        })

        await tx.transaction.update({
          where: { id: newTransaction.id, userId: user.id },
          data: { files: [newFileRecord.id] },
        })

        // Step 5 — increment storageUsed atomically (BigInt increment).
        await tx.user.update({
          where: { id: user.id },
          data: { storageUsed: { increment: fileSize } },
        })

        return { transaction: newTransaction }
      },
      { isolationLevel: "Serializable" }
    )

    revalidatePath("/transactions")

    return { success: true, data: transaction }
  } catch (error) {
    // Best-effort cleanup of the PDF written to disk before the transaction.
    if (createdFilePath) {
      try {
        await unlink(createdFilePath)
      } catch {
        // Ignore cleanup failures — orphaned disk file is recoverable.
      }
    }

    // Surface quota / serialization errors as user-facing messages.
    if (error instanceof Error) {
      if (error.message === "Insufficient storage to save invoice PDF") {
        return { success: false, error: "Insufficient storage to save invoice PDF" }
      }
      // Prisma serialization failure (P2034) — another concurrent request won.
      if ((error as any).code === "P2034") {
        return {
          success: false,
          error: "Another upload is in progress. Please try again.",
        }
      }
    }

    console.error("Failed to save invoice as transaction:", error)
    return {
      success: false,
      // SECURITY: Generic message — do not leak ${error} stack to client.
      error: "Failed to save invoice. Please try again.",
    }
  }
}
