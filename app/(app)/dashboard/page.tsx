import DashboardDropZoneWidget from "@/components/dashboard/drop-zone-widget"
import { GSTSummaryWidget } from "@/components/dashboard/gst-summary-widget"
import { OnboardingChecklist } from "@/components/dashboard/onboarding-checklist"
import { StatsWidget } from "@/components/dashboard/stats-widget"
import DashboardUnsortedWidget from "@/components/dashboard/unsorted-widget"
import { WelcomeWidget } from "@/components/dashboard/welcome-widget"
import { Separator } from "@/components/ui/separator"
import { getCurrentUser } from "@/lib/auth"
import config from "@/lib/config"
import { getOnboardingStatus } from "@/lib/onboarding"
import { getUnsortedFiles } from "@/models/files"
import { getSettings } from "@/models/settings"
import { TransactionFilters } from "@/models/transactions"
import { getGSTSummary } from "@/models/stats"
import { Metadata } from "next"
import { Suspense } from "react"

export const metadata: Metadata = {
  title: "Dashboard",
  description: config.app.description,
}

// Simple placeholder card matching the rough footprint of the widgets
// so the page doesn't reflow when they stream in.
function WidgetSkeleton({ height = "h-40" }: { height?: string }) {
  return <div className={`w-full rounded-lg border bg-muted/30 animate-pulse ${height}`} />
}

export default async function Dashboard({ searchParams }: { searchParams: Promise<TransactionFilters> }) {
  const filters = await searchParams
  const user = await getCurrentUser()

  // PERFORMANCE: Fetch the above-the-fold widgets' data in parallel
  // instead of awaiting each call serially (the old code made three
  // sequential round-trips before rendering anything).
  const [unsortedFiles, settings, onboardingStatus, gstSummary] = await Promise.all([
    getUnsortedFiles(user.id),
    getSettings(user.id),
    getOnboardingStatus(user.id),
    getGSTSummary(user.id, filters),
  ])

  const onboardingSteps = [
    { id: "api_key", label: "Set up an AI API key", done: onboardingStatus.hasApiKey, href: "/settings/llm" },
    { id: "currency", label: "Set your currency to INR", done: onboardingStatus.hasCurrencySet, href: "/settings" },
    { id: "upload", label: "Upload your first invoice", done: onboardingStatus.hasTransaction, href: "/unsorted" },
    { id: "analyze", label: "Run AI analysis on an invoice", done: onboardingStatus.hasAnalyzedTransaction, href: "/unsorted" },
    { id: "gstr", label: "View your GSTR-1 report", done: false, href: "/apps/gstr1" },
  ]

  // Legacy shape kept for WelcomeWidget (uses hasChangedCurrency / hasViewedGSTR1 keys)
  const welcomeOnboardingSteps = {
    hasApiKey: onboardingStatus.hasApiKey,
    hasChangedCurrency: onboardingStatus.hasCurrencySet,
    hasFirstUpload: onboardingStatus.hasTransaction,
    hasFirstAnalysis: onboardingStatus.hasAnalyzedTransaction,
    hasViewedGSTR1: false,
  }
  const completedCount = Object.values(welcomeOnboardingSteps).filter(Boolean).length

  return (
    <div className="flex flex-col gap-5 p-5 w-full max-w-7xl self-center">
      <OnboardingChecklist steps={onboardingSteps} />

      <div className="flex flex-col sm:flex-row gap-5 items-stretch h-full">
        <DashboardDropZoneWidget />

        <DashboardUnsortedWidget files={unsortedFiles} />
      </div>

      {settings.is_welcome_message_hidden !== "true" && (
        <WelcomeWidget onboardingSteps={welcomeOnboardingSteps} completedCount={completedCount} />
      )}

      <Separator />

      {/*
        PERFORMANCE: Each widget streams independently via Suspense.
        The above-the-fold content renders immediately (~200ms) and
        the heavier aggregation queries (stats, GST summary) are
        hydrated as they complete instead of blocking the whole page.
      */}
      <Suspense fallback={<WidgetSkeleton height="h-48" />}>
        <StatsWidget filters={filters} />
      </Suspense>

      <GSTSummaryWidget gst={gstSummary} />
    </div>
  )
}
