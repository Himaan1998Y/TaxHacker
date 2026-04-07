"use server"

import { ActionState } from "@/lib/actions"
import { getCurrentUser, isSubscriptionExpired } from "@/lib/auth"
import {
  getDirectorySize,
  getUserUploadsDirectory,
  safePathJoin,
  unsortedFilePath,
  validateUploadedFile,
} from "@/lib/files"
import { createFile } from "@/models/files"
import { releaseStorageQuota, reserveStorageQuota, updateUser } from "@/models/users"
import { randomUUID } from "crypto"
import { mkdir, writeFile, unlink } from "fs/promises"
import { revalidatePath } from "next/cache"
import path from "path"

export async function uploadFilesAction(formData: FormData): Promise<ActionState<null>> {
  const user = await getCurrentUser()
  const files = formData.getAll("files") as File[]

  const userUploadsDirectory = getUserUploadsDirectory(user)

  if (isSubscriptionExpired(user)) {
    return {
      success: false,
      error: "Your subscription has expired, please upgrade your account or buy new subscription plan",
    }
  }

  // SECURITY/INTEGRITY: Atomically reserve storage quota at the DB level.
  // The previous read-then-check pattern (`isEnoughStorageToUploadFile`)
  // was vulnerable to a TOCTOU race where two concurrent uploads would
  // both pass the check and exceed the quota. reserveStorageQuota uses
  // a WHERE-guarded UPDATE so only one request can cross the boundary.
  const totalFileSize = files.reduce((acc, file) => acc + file.size, 0)
  const reserved = await reserveStorageQuota(user.id, totalFileSize)
  if (!reserved) {
    return { success: false, error: "Insufficient storage to upload these files" }
  }

  const writtenPaths: string[] = []

  try {
    // Process each file
    const uploadedFiles = await Promise.all(
      files.map(async (file) => {
        if (!(file instanceof File)) {
          return { success: false, error: "Invalid file" }
        }

        // Validate size + magic bytes before writing to disk
        const fileUuid = randomUUID()
        const relativeFilePath = unsortedFilePath(fileUuid, file.name)
        const arrayBuffer = await file.arrayBuffer()
        const buffer = Buffer.from(arrayBuffer)

        const validationError = validateUploadedFile(file, buffer.slice(0, 8))
        if (validationError) {
          return { success: false, error: validationError }
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
          metadata: {
            size: file.size,
            lastModified: file.lastModified,
          },
        })

        return fileRecord
      })
    )

    // Reconcile the reserved usage against actual disk usage (handles the
    // rare case where file system writes end up different from the reserved
    // bytes — e.g. platform block alignment on BTRFS).
    const storageUsed = await getDirectorySize(getUserUploadsDirectory(user))
    await updateUser(user.id, { storageUsed })

    console.log("uploadedFiles", uploadedFiles)

    revalidatePath("/unsorted")

    return { success: true, error: null }
  } catch (error) {
    // Roll back: unlink any files already on disk and release the quota.
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
    console.error("uploadFilesAction failed:", error)
    return { success: false, error: "Failed to upload files. Please try again." }
  }
}
