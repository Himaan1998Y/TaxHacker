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
import { Metadata } from "next"

export const metadata: Metadata = {
  title: "Dashboard",
  description: config.app.description,
}

export default async function Dashboard({ searchParams }: { searchParams: Promise<TransactionFilters> }) {
  const filters = await searchParams
  const user = await getCurrentUser()
  const unsortedFiles = await getUnsortedFiles(user.id)
  const settings = await getSettings(user.id)

  // Compute onboarding steps via shared helper
  const onboardingStatus = await getOnboardingStatus(user.id)

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

      <StatsWidget filters={filters} />

      <GSTSummaryWidget filters={filters} />
    </div>
  )
}
