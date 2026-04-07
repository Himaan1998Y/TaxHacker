"use server"

import { prisma } from "@/lib/db"
import { FILE_UPLOAD_PATH, getUserUploadsDirectory, safePathJoin } from "@/lib/files"
import { unlink } from "fs/promises"
import path from "path"
import { cache } from "react"
import { getTransactionById } from "./transactions"
import { getUserById } from "./users"

export const getUnsortedFiles = cache(async (userId: string) => {
  return await prisma.file.findMany({
    where: {
      isReviewed: false,
      userId,
    },
    orderBy: {
      createdAt: "desc",
    },
  })
})

export const getUnsortedFilesCount = cache(async (userId: string) => {
  return await prisma.file.count({
    where: {
      isReviewed: false,
      userId,
    },
  })
})

export const getFileById = cache(async (id: string, userId: string) => {
  return await prisma.file.findFirst({
    where: { id, userId },
  })
})

export const getFilesByTransactionId = cache(async (id: string, userId: string) => {
  const transactionFileLinks = await prisma.transactionFile.findMany({
    where: { transactionId: id, userId },
    include: { file: true },
    orderBy: { createdAt: "asc" },
  })

  if (transactionFileLinks.length > 0) {
    return transactionFileLinks.map((link) => link.file)
  }

  const transaction = await getTransactionById(id, userId)
  if (transaction && transaction.files) {
    return await prisma.file.findMany({
      where: {
        id: {
          in: transaction.files as string[],
        },
        userId,
      },
      orderBy: {
        createdAt: "asc",
      },
    })
  }
  return []
})

export const createFile = async (userId: string, data: any) => {
  return await prisma.file.create({
    data: {
      ...data,
      userId,
    },
  })
}

/**
 * Create a file record using an existing Prisma transaction client.
 * Use this inside a `prisma.$transaction()` block to keep file creation
 * atomic with storage quota checks and user.storageUsed updates.
 */
export const createFileWithinTransaction = async (
  tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
  userId: string,
  data: any
) => {
  return await tx.file.create({
    data: {
      ...data,
      userId,
    },
  })
}

export const updateFile = async (id: string, userId: string, data: any) => {
  return await prisma.file.update({
    where: { id, userId },
    data,
  })
}

export const deleteFile = async (id: string, userId: string) => {
  const file = await getFileById(id, userId)
  if (!file) {
    return
  }

  // Try to remove the disk file. file.path is RELATIVE to the user's uploads
  // directory (e.g. "unsorted/abc.jpg"), so it must be joined with that
  // directory before resolving — otherwise path.resolve() resolves against
  // process.cwd() and the path-traversal check below always fails.
  try {
    const user = await getUserById(userId)
    if (!user) {
      throw new Error(`User ${userId} not found`)
    }

    const userUploadsDir = getUserUploadsDirectory(user)
    const fullPath = safePathJoin(userUploadsDir, file.path)
    const resolvedPath = path.resolve(fullPath)
    const uploadsBase = path.resolve(FILE_UPLOAD_PATH)

    if (!resolvedPath.startsWith(uploadsBase)) {
      console.error("[deleteFile] path traversal blocked", {
        fileId: file.id,
        resolvedPath,
        uploadsBase,
      })
      throw new Error("Invalid file path")
    }

    await unlink(resolvedPath)
  } catch (error) {
    // Disk file may already be gone — log and continue to DB delete
    console.warn("[deleteFile] disk unlink failed (continuing to DB delete)", {
      fileId: file.id,
      error: error instanceof Error ? error.message : String(error),
    })
  }

  // Always delete the DB row, even if the disk file was missing.
  // TransactionFile rows cascade automatically (schema: onDelete: Cascade).
  return await prisma.file.delete({
    where: { id, userId },
  })
}
