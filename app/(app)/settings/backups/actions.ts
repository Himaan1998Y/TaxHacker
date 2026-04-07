"use server"

import { ActionState } from "@/lib/actions"
import { getCurrentUser } from "@/lib/auth"
import { prisma } from "@/lib/db"
import { getUserUploadsDirectory, safePathJoin } from "@/lib/files"
import { MODEL_BACKUP, modelFromJSON } from "@/models/backups"
import fs from "fs/promises"
import JSZip from "jszip"
import path from "path"

const SUPPORTED_BACKUP_VERSIONS = ["1.0"]
const REMOVE_EXISTING_DATA = true
const MAX_BACKUP_SIZE = 256 * 1024 * 1024 // 256MB

type BackupRestoreResult = {
  counters: Record<string, number>
}

export async function restoreBackupAction(
  _prevState: ActionState<BackupRestoreResult> | null,
  formData: FormData
): Promise<ActionState<BackupRestoreResult>> {
  const user = await getCurrentUser()
  const userUploadsDirectory = getUserUploadsDirectory(user)
  const file = formData.get("file") as File

  if (!file || file.size === 0) {
    return { success: false, error: "No file provided" }
  }

  if (file.size > MAX_BACKUP_SIZE) {
    return { success: false, error: `Backup file too large. Maximum size is ${MAX_BACKUP_SIZE / 1024 / 1024}MB` }
  }

  // Read zip archive
  let zip: JSZip
  try {
    const fileBuffer = await file.arrayBuffer()
    const fileData = Buffer.from(fileBuffer)
    zip = await JSZip.loadAsync(fileData)
  } catch (error) {
    console.error("[backups/restore] bad zip archive:", error)
    return { success: false, error: "Could not read the backup file. It may be corrupted or not a valid ZIP archive." }
  }

  // Check metadata and start restoring
  try {
    // ─── SAFETY: Validate EVERYTHING before any destructive operation ───
    // Previously `cleanupUserTables` and `fs.rm` ran unconditionally before
    // JSON parsing. A structurally valid ZIP with corrupt model JSON would
    // wipe all user data with no possible recovery. Now we pre-parse every
    // JSON file; only if validation succeeds do we touch the live data.

    // 1. Validate metadata + version
    const metadataFile = zip.file("data/metadata.json")
    if (metadataFile) {
      const metadataContent = await metadataFile.async("string")
      let metadata: { version?: string; timestamp?: string }
      try {
        metadata = JSON.parse(metadataContent)
      } catch {
        return { success: false, error: "Backup metadata.json is corrupt — aborting restore." }
      }
      if (!metadata.version || !SUPPORTED_BACKUP_VERSIONS.includes(metadata.version)) {
        return {
          success: false,
          error: `Incompatible backup version: ${
            metadata.version || "unknown"
          }. Supported versions: ${SUPPORTED_BACKUP_VERSIONS.join(", ")}`,
        }
      }
      console.log(`Restoring backup version ${metadata.version} created at ${metadata.timestamp}`)
    } else {
      console.warn("No metadata found in backup, assuming legacy format")
    }

    // 2. Pre-parse every model JSON file — no writes yet
    const parsedBackups: Array<{ backup: (typeof MODEL_BACKUP)[number]; jsonContent: string }> = []
    for (const backup of MODEL_BACKUP) {
      const jsonFile = zip.file(`data/${backup.filename}`)
      if (!jsonFile) continue
      const jsonContent = await jsonFile.async("string")
      try {
        JSON.parse(jsonContent) // throws on corrupt JSON
      } catch (error) {
        return {
          success: false,
          error: `Backup file ${backup.filename} is corrupt (invalid JSON). Aborting restore — no data touched.`,
        }
      }
      parsedBackups.push({ backup, jsonContent })
    }

    // 3. Validation passed — NOW it is safe to remove existing data
    if (REMOVE_EXISTING_DATA) {
      await cleanupUserTables(user.id)
      await fs.rm(userUploadsDirectory, { recursive: true, force: true })
    }

    const counters: Record<string, number> = {}

    // 4. Restore each table. Individual row failures are tolerated so a
    //    partial restore leaves the user with as much data as possible.
    for (const { backup, jsonContent } of parsedBackups) {
      try {
        const restoredCount = await modelFromJSON(user.id, backup, jsonContent)
        console.log(`Restored ${restoredCount} records from ${backup.filename}`)
        counters[backup.filename] = restoredCount
      } catch (error) {
        console.error(`Error restoring model from ${backup.filename}:`, error)
        counters[backup.filename] = 0
      }
    }

    // Restore files
    try {
      let restoredFilesCount = 0
      const files = await prisma.file.findMany({
        where: {
          userId: user.id,
        },
      })

      const userUploadsDirectory = getUserUploadsDirectory(user)

      for (const file of files) {
        const filePathWithoutPrefix = path.normalize(file.path.replace(/^.*\/uploads\//, ""))
        const zipFilePath = path.join("data/uploads", filePathWithoutPrefix)
        const zipFile = zip.file(zipFilePath)
        if (!zipFile) {
          console.log(`File ${file.path} not found in backup`)
          continue
        }

        const fileContents = await zipFile.async("nodebuffer")
        const fullFilePath = safePathJoin(userUploadsDirectory, filePathWithoutPrefix)
        if (!fullFilePath.startsWith(path.normalize(userUploadsDirectory))) {
          console.error(`Attempted path traversal detected for file ${file.path}`)
          continue
        }

        try {
          await fs.mkdir(path.dirname(fullFilePath), { recursive: true })
          await fs.writeFile(fullFilePath, fileContents)
          restoredFilesCount++
        } catch (error) {
          console.error(`Error writing file ${fullFilePath}:`, error)
          continue
        }

        await prisma.file.update({
          where: { id: file.id },
          data: {
            path: filePathWithoutPrefix,
          },
        })
      }
      counters["Uploaded attachments"] = restoredFilesCount
    } catch (error) {
      console.error("Error restoring uploaded files:", error)
      return {
        success: false,
        error: "Error restoring uploaded files. Check server logs for details.",
      }
    }

    return { success: true, data: { counters } }
  } catch (error) {
    console.error("Error restoring from backup:", error)
    return {
      success: false,
      error: "Error restoring from backup. Check server logs for details.",
    }
  }
}

async function cleanupUserTables(userId: string) {
  // Delete in reverse order to handle foreign key constraints
  for (const { model } of [...MODEL_BACKUP].reverse()) {
    try {
      await model.deleteMany({ where: { userId } })
    } catch (error) {
      console.error(`Error clearing table:`, error)
    }
  }
}
