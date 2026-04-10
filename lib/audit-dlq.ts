import fs from "fs/promises"
import path from "path"
import { prisma } from "@/lib/db"

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

const DLQ_DIR = "/app/data"
const DLQ_FILE = path.join(DLQ_DIR, "audit-dlq.jsonl")

interface DLQEntry {
  userId: string
  entityType: string
  entityId: string
  action: string
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
    // Ensure directory exists
    await fs.mkdir(DLQ_DIR, { recursive: true })
    // Append one JSON line
    await fs.appendFile(DLQ_FILE, JSON.stringify(entry) + "\n")
  } catch (error) {
    console.error("Failed to write to audit DLQ file:", error)
    throw error
  }
}

/**
 * Drain the DLQ: read all entries, attempt to write them to the DB,
 * and truncate the file on success. Returns count of successfully drained entries.
 */
export async function drainDLQ(): Promise<number> {
  try {
    // Check if file exists
    const stats = await fs.stat(DLQ_FILE).catch(() => null)
    if (!stats) {
      return 0 // No DLQ file to drain
    }

    // Read all entries
    const content = await fs.readFile(DLQ_FILE, "utf-8")
    const lines = content.split("\n").filter((l) => l.trim())

    if (lines.length === 0) {
      // File is empty, delete it
      await fs.unlink(DLQ_FILE).catch(() => {})
      return 0
    }

    let drained = 0

    for (const line of lines) {
      try {
        const entry = JSON.parse(line) as DLQEntry
        // Attempt to write to DB
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
      } catch (error) {
        console.warn("Failed to drain DLQ entry, stopping:", error)
        // Stop on first failure to preserve order and avoid partial drains
        return drained
      }
    }

    // All entries drained successfully — truncate the file
    if (drained > 0) {
      await fs.unlink(DLQ_FILE).catch(() => {})
    }

    return drained
  } catch (error) {
    console.error("Error during DLQ drain:", error)
    return 0
  }
}

/**
 * Check if DLQ file exists and return its size in bytes.
 * Used during startup to warn if audit logs are piling up.
 */
export async function getDLQStats(): Promise<{ exists: boolean; size: number }> {
  try {
    const stats = await fs.stat(DLQ_FILE)
    return { exists: true, size: stats.size }
  } catch {
    return { exists: false, size: 0 }
  }
}
