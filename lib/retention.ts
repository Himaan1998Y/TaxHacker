/**
 * Data Retention Policy — Companies Act 2013
 * Financial records and audit trails must be retained for 8 years.
 */

const RETENTION_YEARS = 8

/**
 * Check if a record is within the mandatory retention period.
 * Returns true if the record MUST be kept (cannot be deleted).
 */
export function isWithinRetentionPeriod(createdAt: Date | string): boolean {
  const created = new Date(createdAt)
  const retentionEnd = new Date(created)
  retentionEnd.setFullYear(retentionEnd.getFullYear() + RETENTION_YEARS)
  return new Date() < retentionEnd
}

/**
 * Get the date when a record can be legally deleted.
 */
export function getRetentionEndDate(createdAt: Date | string): Date {
  const created = new Date(createdAt)
  const retentionEnd = new Date(created)
  retentionEnd.setFullYear(retentionEnd.getFullYear() + RETENTION_YEARS)
  return retentionEnd
}
