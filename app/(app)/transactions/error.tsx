"use client"

import { Button } from "@/components/ui/button"
import { AlertTriangle } from "lucide-react"
import Link from "next/link"

export default function TransactionsError({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center min-h-[400px] gap-4 p-8">
      <AlertTriangle className="w-16 h-16 text-orange-500" />
      <h2 className="text-2xl font-bold">Failed to load transactions</h2>
      <p className="text-muted-foreground text-center max-w-md">
        {"Could not load your transactions. Your data is safe — try refreshing."}
      </p>
      <div className="flex gap-3">
        <Button onClick={reset}>Retry</Button>
        <Button variant="outline" asChild>
          <Link href="/dashboard">Dashboard</Link>
        </Button>
      </div>
    </div>
  )
}
