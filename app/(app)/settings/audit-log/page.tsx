import { getCurrentUser } from "@/lib/auth"
import { getAuditLogs } from "@/lib/audit"
import { Card } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { formatDate } from "date-fns"
import { Metadata } from "next"
import { Shield } from "lucide-react"

export const metadata: Metadata = {
  title: "Audit Log",
  description: "Immutable record of all changes (Companies Act 2023 compliant)",
}

export default async function AuditLogPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; entity?: string }>
}) {
  const user = await getCurrentUser()
  const params = await searchParams
  const page = parseInt(params.page || "1")
  const limit = 50
  const offset = (page - 1) * limit

  const { logs, total } = await getAuditLogs(
    user.id,
    { entityType: params.entity || undefined },
    limit,
    offset
  )

  const totalPages = Math.ceil(total / limit)

  const actionColors: Record<string, string> = {
    create: "bg-green-100 text-green-800",
    update: "bg-blue-100 text-blue-800",
    delete: "bg-red-100 text-red-800",
  }

  return (
    <>
      <header className="flex items-center gap-3">
        <Shield className="h-6 w-6" />
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Audit Log</h2>
          <p className="text-sm text-muted-foreground">
            Immutable record of all changes. Required by Companies Act 2023. Retained for 8 years.
          </p>
        </div>
      </header>

      <div className="text-sm text-muted-foreground">
        {total} total entries
        {totalPages > 1 && ` | Page ${page} of ${totalPages}`}
      </div>

      <div className="space-y-2">
        {logs.map((log) => (
          <Card key={log.id} className="p-3">
            <div className="flex items-center gap-3 text-sm">
              <Badge className={actionColors[log.action] || "bg-gray-100"}>
                {log.action}
              </Badge>
              <span className="font-medium">{log.entityType}</span>
              <span className="text-muted-foreground font-mono text-xs">
                {log.entityId.slice(0, 8)}...
              </span>
              <span className="ml-auto text-muted-foreground text-xs">
                {formatDate(log.createdAt, "yyyy-MM-dd HH:mm:ss")}
              </span>
              {log.ipAddress && (
                <span className="text-muted-foreground text-xs">
                  {log.ipAddress}
                </span>
              )}
            </div>

            {log.action === "update" && log.oldValue && log.newValue && (
              <details className="mt-2 text-xs">
                <summary className="cursor-pointer text-muted-foreground">Show changes</summary>
                <div className="mt-1 grid grid-cols-2 gap-2">
                  <div>
                    <strong className="text-red-600">Before:</strong>
                    <pre className="mt-1 bg-red-50 p-2 rounded overflow-x-auto max-h-40">
                      {JSON.stringify(log.oldValue, null, 2)}
                    </pre>
                  </div>
                  <div>
                    <strong className="text-green-600">After:</strong>
                    <pre className="mt-1 bg-green-50 p-2 rounded overflow-x-auto max-h-40">
                      {JSON.stringify(log.newValue, null, 2)}
                    </pre>
                  </div>
                </div>
              </details>
            )}

            {log.action === "create" && log.newValue && (
              <details className="mt-2 text-xs">
                <summary className="cursor-pointer text-muted-foreground">Show data</summary>
                <pre className="mt-1 bg-green-50 p-2 rounded overflow-x-auto max-h-40">
                  {JSON.stringify(log.newValue, null, 2)}
                </pre>
              </details>
            )}

            {log.action === "delete" && log.oldValue && (
              <details className="mt-2 text-xs">
                <summary className="cursor-pointer text-muted-foreground">Show deleted data</summary>
                <pre className="mt-1 bg-red-50 p-2 rounded overflow-x-auto max-h-40">
                  {JSON.stringify(log.oldValue, null, 2)}
                </pre>
              </details>
            )}
          </Card>
        ))}

        {logs.length === 0 && (
          <div className="text-center py-12 text-muted-foreground">
            No audit entries yet. Changes will be recorded automatically.
          </div>
        )}
      </div>

      {totalPages > 1 && (
        <div className="flex justify-center gap-2 pt-4">
          {page > 1 && (
            <a href={`?page=${page - 1}${params.entity ? `&entity=${params.entity}` : ""}`} className="text-sm underline">
              Previous
            </a>
          )}
          <span className="text-sm text-muted-foreground">Page {page} of {totalPages}</span>
          {page < totalPages && (
            <a href={`?page=${page + 1}${params.entity ? `&entity=${params.entity}` : ""}`} className="text-sm underline">
              Next
            </a>
          )}
        </div>
      )}
    </>
  )
}
