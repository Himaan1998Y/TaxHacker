import { prisma } from "@/lib/db"
import { headers } from "next/headers"
import { matchesKeyword } from "@/lib/utils"

export type AuditAction = "create" | "update" | "delete"
export type AuditEntityType = "transaction" | "file" | "setting" | "category" | "project" | "user"

/**
 * Log an audit event. Insert-only — audit logs are immutable.
 * Required by Companies Act 2023 (mandatory since April 1, 2023).
 * Records must be retained for 8 years.
 */
export async function logAudit(
  userId: string,
  entityType: AuditEntityType,
  entityId: string,
  action: AuditAction,
  oldValue?: Record<string, unknown> | null,
  newValue?: Record<string, unknown> | null
): Promise<void> {
  try {
    let ipAddress: string | null = null
    let userAgent: string | null = null

    try {
      const hdrs = await headers()
      ipAddress = hdrs.get("x-forwarded-for")?.split(",")[0]?.trim() || hdrs.get("x-real-ip") || null
      userAgent = hdrs.get("user-agent") || null
    } catch {
      // headers() not available outside request context (e.g., cron jobs)
    }

    await prisma.auditLog.create({
      data: {
        userId,
        entityType,
        entityId,
        action,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        oldValue: oldValue as any,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        newValue: newValue as any,
        ipAddress,
        userAgent,
      },
    })
  } catch (error) {
    // Audit logging must never break the main operation
    console.error("Audit log failed:", error)
  }
}

/**
 * Sanitize a record for audit logging — remove large blobs and sensitive data.
 */
export function sanitizeForAudit(record: Record<string, unknown>): Record<string, unknown> {
  const sanitized = { ...record }

  // Remove binary/blob fields
  delete sanitized.cachedParseResult
  delete sanitized.embedding

  // Mask sensitive settings (case-insensitive to avoid the same bug
  // fixed in Tier 1.7 ITC blocker and Tier 2.12 audit sanitizer)
  const SENSITIVE_KEYWORDS = [
    "api_key", "secret", "password", "gstin", "_pan",
    "pan_", "token", "bank", "account_number",
  ] as const
  if (sanitized.code && typeof sanitized.value === "string") {
    if (matchesKeyword(sanitized.code as string, SENSITIVE_KEYWORDS)) {
      sanitized.value = sanitized.value ? "***" : null
    }
  }

  return sanitized
}

/**
 * Get audit logs for a specific entity.
 */
export async function getAuditLogs(
  userId: string,
  filters?: {
    entityType?: string
    entityId?: string
    dateFrom?: Date
    dateTo?: Date
  },
  limit: number = 50,
  offset: number = 0
) {
  const where: Record<string, unknown> = { userId }

  if (filters?.entityType) where.entityType = filters.entityType
  if (filters?.entityId) where.entityId = filters.entityId
  if (filters?.dateFrom || filters?.dateTo) {
    where.createdAt = {
      ...(filters.dateFrom && { gte: filters.dateFrom }),
      ...(filters.dateTo && { lte: filters.dateTo }),
    }
  }

  const [logs, total] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: limit,
      skip: offset,
    }),
    prisma.auditLog.count({ where }),
  ])

  return { logs, total }
}
