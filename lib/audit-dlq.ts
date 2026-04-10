import fs from "fs/promises"
import path from "path"
import { prisma } from "@/lib/db"
import { AuditAction, VALID_AUDIT_ACTIONS } from "@/lib/audit"

/**
 * Dead-Letter Queue for audit logs when the DB write fails.
 * File location: /app/data/audit-dlq.jsonl (mounted volume, survives container restart)
 *
 * Schema: one JSON object per line, matching AuditLog fields
 * {
 *   "userId": "uuid",
 *   "entityType": "transaction|file|...",
 *   "entityId": "string",
 *   "action": "create|update|delete",
 *   "oldValue": {...} | null,
 *   "newValue": {...} | null,
 *   "ipAddress": "string" | null,
 *   "userAgent": "string" | null,
 *   "createdAt": "ISO8601",
 * }
 */

/**
 * Get DLQ file paths from environment or defaults.
 * DLQ_DIR can be overridden for testing via process.env.DLQ_DIR.
 * This function is called lazily (at runtime) to allow tests to stub the env var.
 */
function getDLQPaths() {
  const dir = process.env.DLQ_DIR ?? "/app/data"
  return {
    dir,
    file: path.join(dir, "audit-dlq.jsonl"),
    cursor: path.join(dir, "audit-dlq.cursor"),
    lock: path.join(dir, "audit-dlq.lock"),
  }
}

interface DLQEntry {
  userId: string
  entityType: string
  entityId: string
  action: AuditAction
  oldValue?: Record<string, unknown> | null
  newValue?: Record<string, unknown> | null
  ipAddress?: string | null
  userAgent?: string | null
  createdAt: string
}

/**
 * Append an audit log entry to the DLQ file.
 * Creates the file if it doesn't exist. Throws if the write fails.
 */
export async function appendToDLQ(entry: DLQEntry): Promise<void> {
  try {
    const paths = getDLQPaths()
    // Ensure directory exists
    await fs.mkdir(paths.dir, { recursive: true })
    // Append one JSON line
    await fs.appendFile(paths.file, JSON.stringify(entry) + "\n")
  } catch (error) {
    console.error("Failed to write to audit DLQ file:", error)
    throw error
  }
}

/**
 * Drain the DLQ: read all entries, attempt to write them to the DB,
 * and delete the file on success. Returns count of successfully drained entries.
 *
 * Uses a cursor file to track progress. On container crash mid-drain, the cursor
 * preserves the last-successfully-drained line index. On next startup, drain resumes
 * from the cursor position, preventing duplicate audit log entries.
 *
 * Idempotency: The cursor file ensures re-running drain on the same DLQ doesn't
 * produce duplicate DB entries. Entries already drained are skipped.
 */
export async function drainDLQ(): Promise<number> {
  const paths = getDLQPaths()

  // Acquire exclusive lock to prevent concurrent drain calls
  // If lock already exists, check if it's stale (older than 10 minutes) before giving up
  let lockAcquired = false
  const LOCK_TIMEOUT_MS = 10 * 60 * 1000 // 10 minutes
  try {
    await fs.writeFile(paths.lock, String(Date.now()), { flag: "wx" })
    lockAcquired = true
  } catch {
    // Lock file already exists — check if it's stale
    try {
      const lockContent = await fs.readFile(paths.lock, "utf-8")
      const lockTimestamp = parseInt(lockContent.trim(), 10)
      const lockAge = Date.now() - lockTimestamp
      if (lockAge > LOCK_TIMEOUT_MS) {
        // Lock is stale — likely from a crashed process. Break it and retry.
        console.warn(
          `DLQ lock is stale (${Math.round(lockAge / 1000)}s old). ` +
          `Previous drain likely crashed. Breaking lock and retrying.`
        )
        await fs.unlink(paths.lock).catch(() => {})
        // Retry lock acquisition
        await fs.writeFile(paths.lock, String(Date.now()), { flag: "wx" })
        lockAcquired = true
      } else {
        // Lock is fresh — another drain is in progress
        console.warn(
          `DLQ drain already in progress (lock acquired ${Math.round(lockAge / 1000)}s ago). ` +
          `Skipping to prevent duplicate audit entries.`
        )
        return 0
      }
    } catch (lockCheckError) {
      // Failed to check lock staleness — be conservative and skip
      console.warn(`Failed to check DLQ lock status, skipping drain:`, lockCheckError)
      return 0
    }
  }

  try {

    // Check if file exists
    const stats = await fs.stat(paths.file).catch(() => null)
    if (!stats) {
      return 0 // No DLQ file to drain
    }

    // Guard against unbounded file read (OOM prevention)
    // If DLQ file exceeds 50MB, log warning and bail to prevent container crash
    const MAX_DLQ_SIZE_BYTES = 50 * 1024 * 1024
    if (stats.size > MAX_DLQ_SIZE_BYTES) {
      console.warn(
        `DLQ file exceeds safe size limit (${stats.size} bytes > ${MAX_DLQ_SIZE_BYTES}). ` +
        `Consider investigating DB connectivity issues. Skipping drain to prevent OOM.`
      )
      return 0
    }

    // Read all entries
    const content = await fs.readFile(paths.file, "utf-8")
    const lines = content.split("\n").filter((l) => l.trim())

    if (lines.length === 0) {
      // File is empty, delete it
      await fs.unlink(paths.file).catch(() => {})
      await fs.unlink(paths.cursor).catch(() => {})
      return 0
    }

    // Read cursor (resume position after crash)
    let startIndex = 0
    try {
      const cursorContent = await fs.readFile(paths.cursor, "utf-8")
      startIndex = parseInt(cursorContent.trim(), 10) || 0
    } catch {
      // No cursor file, start from beginning
    }

    let drained = 0

    for (let i = startIndex; i < lines.length; i++) {
      let entry: DLQEntry | null = null

      // Parse JSON — if malformed, skip this entry and continue
      try {
        entry = JSON.parse(lines[i]) as DLQEntry
      } catch (parseError) {
        console.warn(
          `DLQ entry #${i} is not valid JSON (corrupted during crash?), skipping: ${parseError}`
        )
        await fs.writeFile(paths.cursor, String(i + 1))
        continue
      }

      // Validate schema — if invalid, skip and continue
      const validationErrors: string[] = []

      if (typeof entry.userId !== "string" || entry.userId.length === 0) {
        validationErrors.push(`userId is missing or invalid`)
      }
      if (typeof entry.entityType !== "string" || entry.entityType.length === 0) {
        validationErrors.push(`entityType is missing or invalid`)
      }
      if (typeof entry.entityId !== "string" || entry.entityId.length === 0) {
        validationErrors.push(`entityId is missing or invalid`)
      }
      if (typeof entry.createdAt !== "string" || entry.createdAt.length === 0) {
        validationErrors.push(`createdAt is missing or invalid`)
      }

      // Validate action is a valid AuditAction (derived from lib/audit.ts)
      if (!VALID_AUDIT_ACTIONS.includes(entry.action)) {
        validationErrors.push(`action "${entry.action}" is not a valid AuditAction`)
      }

      if (validationErrors.length > 0) {
        console.warn(
          `DLQ entry #${i} failed validation (${validationErrors.join("; ")}), skipping`
        )
        await fs.writeFile(paths.cursor, String(i + 1))
        continue
      }

      // Attempt to write to DB — if DB fails, STOP and retry later
      try {
        await prisma.auditLog.create({
          data: {
            userId: entry.userId,
            entityType: entry.entityType,
            entityId: entry.entityId,
            action: entry.action as any,
            oldValue: entry.oldValue as any,
            newValue: entry.newValue as any,
            ipAddress: entry.ipAddress || null,
            userAgent: entry.userAgent || null,
          },
        })
        drained++
        // Update cursor after each successful write
        // This ensures idempotency: if we crash now, we won't re-process this entry
        await fs.writeFile(paths.cursor, String(i + 1))
      } catch (dbError) {
        console.warn("Failed to write to DB, stopping drain to retry later:", dbError)
        // Stop on DB failure to preserve order and avoid partial drains
        // The cursor file preserves our progress for retry on next startup
        return drained
      }
    }

    // All entries drained successfully — delete both files
    // CRITICAL: Check file size before unlinking to prevent TOCTOU race:
    // If appendToDLQ appended new entries while we were draining, do NOT delete the file.
    // Let the next drain cycle process the tail.
    if (drained > 0) {
      const finalStats = await fs.stat(paths.file).catch(() => null)
      const originalSize = stats.size
      const finalSize = finalStats?.size ?? 0

      if (finalSize === originalSize) {
        // File size unchanged — safe to delete
        await fs.unlink(paths.file).catch(() => {})
        await fs.unlink(paths.cursor).catch(() => {})
      } else {
        // File grew during drain — new entries were appended
        // Keep the file and cursor so next drain processes the tail
        console.info(
          `DLQ file grew during drain (${originalSize} → ${finalSize} bytes). ` +
          `Keeping file for next drain cycle to process appended entries.`
        )
      }
    }

    return drained
  } catch (error) {
    console.error("Error during DLQ drain:", error)
    return 0
  } finally {
    // Release the lock so other drain processes can proceed
    if (lockAcquired) {
      await fs.unlink(paths.lock).catch(() => {})
    }
  }
}

/**
 * Check if DLQ file exists and return its size in bytes.
 * Used during startup to warn if audit logs are piling up.
 */
export async function getDLQStats(): Promise<{ exists: boolean; size: number }> {
  try {
    const paths = getDLQPaths()
    const stats = await fs.stat(paths.file)
    return { exists: true, size: stats.size }
  } catch {
    return { exists: false, size: 0 }
  }
}
