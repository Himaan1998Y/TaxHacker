import JSZip from 'jszip'

export function sanitizeCSVValue(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null
  }

  const raw = String(value)
  if (raw.length === 0) {
    return raw
  }

  const dangerousPrefixes = ['=', '+', '-', '@']
  const firstChar = raw[0]
  if (dangerousPrefixes.includes(firstChar)) {
    return `'${raw}`
  }

  return raw
}

export function generateTransactionCSV(rows: Record<string, unknown>[], columns?: string[]): string {
  if (!rows || rows.length === 0) {
    return ''
  }

  const headerColumns = columns ?? Object.keys(rows[0])
  const quote = (value: string | null): string => {
    if (value === null) return ''
    const escaped = value.replace(/"/g, '""')
    return `"${escaped}"`
  }

  const header = headerColumns.map((column) => quote(String(column))).join(',')
  const body = rows
    .map((row) =>
      headerColumns
        .map((column) => {
          const raw = row[column]
          const sanitized = sanitizeCSVValue(raw)
          return quote(sanitized === null ? '' : String(sanitized))
        })
        .join(',')
    )
    .join('\n')

  return `${header}\n${body}`
}

export async function createExportZIP(entries: Array<{ filename: string; content: string | Buffer }>): Promise<Buffer> {
  const zip = new JSZip()

  for (const entry of entries) {
    zip.file(entry.filename, entry.content)
  }

  return zip.generateAsync({ type: 'nodebuffer' })
}
