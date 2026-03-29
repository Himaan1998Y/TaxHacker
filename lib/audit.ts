import { prisma } from "@/lib/db"
import { headers } from "next/headers"

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
        oldValue: oldValue ?? undefined,
        newValue: newValue ?? undefined,
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

  // Mask sensitive settings
  if (sanitized.code && typeof sanitized.value === "string") {
    const code = sanitized.code as string
    if (code.includes("api_key") || code.includes("secret") || code.includes("password")) {
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
