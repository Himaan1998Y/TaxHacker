import { prisma } from "@/lib/db"

export type SecurityEvent =
  | "auth.login_success"
  | "auth.login_failed"
  | "auth.session_created"
  | "file.uploaded"
  | "file.deleted"
  | "agent.api_call"
  | "agent.key_rejected"
  | "settings.api_key_changed"
  | "export.data_downloaded"

/**
 * Log a security-relevant event.
 * Stored in audit_logs with entityType='security'.
 * CERT-In requires 180-day minimum retention for security logs.
 */
export async function logSecurityEvent(
  event: SecurityEvent,
  userId: string,
  details?: Record<string, unknown>,
  ipAddress?: string | null,
  userAgent?: string | null
): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        userId,
        entityType: "security",
        entityId: event,
        action: event,
        newValue: details ?? undefined,
        ipAddress: ipAddress ?? undefined,
        userAgent: userAgent ?? undefined,
      },
    })
  } catch (error) {
    // Security logging must never break the main operation
    console.error("Security log failed:", error)
  }
}
