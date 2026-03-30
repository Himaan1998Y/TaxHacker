"use client"

import { CheckCircle2, Circle, ChevronDown, ChevronUp } from "lucide-react"
import Link from "next/link"
import { useState } from "react"

export interface OnboardingStep {
  id: string
  label: string
  done: boolean
  href?: string
}

interface OnboardingChecklistProps {
  steps: OnboardingStep[]
}

export function OnboardingChecklist({ steps }: OnboardingChecklistProps) {
  const [collapsed, setCollapsed] = useState(false)
  const doneCount = steps.filter((s) => s.done).length
  const total = steps.length
  const allDone = doneCount === total

  if (allDone) return null

  return (
    <div className="rounded-xl border border-border bg-card p-4 mb-4">
      <button
        className="flex items-center justify-between w-full"
        onClick={() => setCollapsed(!collapsed)}
      >
        <div className="flex items-center gap-3">
          <span className="font-semibold text-sm">Get Started</span>
          <span className="text-xs text-muted-foreground">
            {doneCount}/{total} complete
          </span>
          <div className="w-24 h-1.5 rounded-full bg-muted overflow-hidden">
            <div
              className="h-full bg-primary rounded-full transition-all"
              style={{ width: `${(doneCount / total) * 100}%` }}
            />
          </div>
        </div>
        {collapsed ? (
          <ChevronDown className="h-4 w-4 text-muted-foreground" />
        ) : (
          <ChevronUp className="h-4 w-4 text-muted-foreground" />
        )}
      </button>

      {!collapsed && (
        <ul className="mt-3 space-y-2">
          {steps.map((step) => (
            <li key={step.id} className="flex items-center gap-2 text-sm">
              {step.done ? (
                <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" />
              ) : (
                <Circle className="h-4 w-4 text-muted-foreground shrink-0" />
              )}
              {step.href && !step.done ? (
                <Link href={step.href} className="text-primary hover:underline">
                  {step.label}
                </Link>
              ) : (
                <span className={step.done ? "line-through text-muted-foreground" : ""}>
                  {step.label}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
