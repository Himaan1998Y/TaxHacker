import { Button } from "@/components/ui/button"
import { Card, CardDescription, CardTitle } from "@/components/ui/card"
import { ColoredText } from "@/components/ui/colored-text"
import { getCurrentUser } from "@/lib/auth"
import { getSettings, updateSettings } from "@/models/settings"
import { Banknote, ChartBarStacked, FolderOpenDot, Key, TextCursorInput, X } from "lucide-react"
import { revalidatePath } from "next/cache"
import Image from "next/image"
import Link from "next/link"

type OnboardingSteps = {
  hasApiKey: boolean
  hasChangedCurrency: boolean
  hasFirstUpload: boolean
  hasFirstAnalysis: boolean
  hasViewedGSTR1: boolean
}

type WelcomeWidgetProps = {
  onboardingSteps?: OnboardingSteps
  completedCount?: number
}

function ChecklistItem({ done, href, label }: { done: boolean; href: string; label: string }) {
  return (
    <Link href={href} className="flex items-center gap-2 text-sm hover:text-foreground transition-colors">
      {done ? (
        <span className="text-green-500">✓</span>
      ) : (
        <span className="text-muted-foreground">○</span>
      )}
      <span className={done ? "line-through text-muted-foreground" : ""}>{label}</span>
    </Link>
  )
}

export async function WelcomeWidget({ onboardingSteps, completedCount }: WelcomeWidgetProps = {}) {
  const user = await getCurrentUser()
  const settings = await getSettings(user.id)

  const hasAnyLLMKey = settings.google_api_key || settings.openai_api_key || settings.openrouter_api_key

  return (
    <Card className="flex flex-col lg:flex-row items-start gap-10 p-10 w-full">
      <Image src="/logo/1024.png" alt="Logo" width={256} height={256} className="w-64 h-64" />
      <div className="flex flex-col">
        <CardTitle className="flex items-center justify-between">
          <span className="text-2xl font-bold">
            <ColoredText>Welcome to TaxHacker India</ColoredText>
          </span>
          <Button
            variant="outline"
            size="icon"
            onClick={async () => {
              "use server"
              await updateSettings(user.id, "is_welcome_message_hidden", "true")
              revalidatePath("/")
            }}
          >
            <X className="h-4 w-4" />
          </Button>
        </CardTitle>
        <CardDescription className="mt-5">
          <p className="mb-3">
            Your AI-powered Indian tax assistant. Upload receipts and invoices — I&apos;ll extract GST, TDS, GSTIN, HSN codes and more automatically.
          </p>
          <ul className="mb-5 list-disc pl-5 space-y-1">
            <li>
              <strong>Upload a photo or PDF</strong> of any Indian invoice, receipt, or bill — I&apos;ll extract GSTIN, HSN/SAC, GST breakdowns, and categorize it.
            </li>
            <li>
              <strong>GST intelligence built-in</strong>: CGST/SGST/IGST auto-detection, inter-state identification, and GST summary dashboard.
            </li>
            <li>
              <strong>TDS tracking</strong>: Auto-suggest TDS rates for sections 194C, 194H, 194I, 194J, and more.
            </li>
            <li>
              <strong>Indian Financial Year</strong>: Filter by FY (April-March), quarters (Q1-Q4), and generate FY-wise reports.
            </li>
            <li>
              <strong>Multi-currency with INR</strong>: Automatic currency conversion with historical rates. Crypto supported.
            </li>
            <li>
              <strong>Fully customizable</strong>: Edit LLM prompts, categories, projects, and custom fields in Settings.
            </li>
            <li>
              <strong>Export to CSV</strong> with all Indian tax fields for your CA.
            </li>
          </ul>
          <p className="mb-3">
            While I save you hours on data entry and categorization, always verify AI-extracted tax data before filing with your CA.
          </p>
        </CardDescription>
        <div className="mt-2">
          <Link href="https://github.com/Himaan1998Y/TaxHacker" className="text-blue-500 hover:underline">
            Source Code
          </Link>
          <span className="mx-2">|</span>
          <Link href="https://github.com/Himaan1998Y/TaxHacker/issues" className="text-blue-500 hover:underline">
            Report a Bug
          </Link>
        </div>
        <div className="flex flex-wrap gap-2 mt-8">
          {!hasAnyLLMKey && (
            <Link href="/settings/llm">
              <Button>
                <Key className="h-4 w-4" />
                Set up your AI provider (Gemini / OpenRouter / OpenAI)
              </Button>
            </Link>
          )}
          <Link href="/settings">
            <Button variant="outline">
              <Banknote className="h-4 w-4" />
              Default Currency: {settings.default_currency}
            </Button>
          </Link>
          <Link href="/settings/categories">
            <Button variant="outline">
              <ChartBarStacked className="h-4 w-4" />
              Categories
            </Button>
          </Link>
          <Link href="/settings/projects">
            <Button variant="outline">
              <FolderOpenDot className="h-4 w-4" />
              Projects
            </Button>
          </Link>
          <Link href="/settings/fields">
            <Button variant="outline">
              <TextCursorInput className="h-4 w-4" />
              Custom Fields
            </Button>
          </Link>
        </div>
        {onboardingSteps && (
          <div className="mt-4 border-t pt-4">
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm font-medium">Getting Started ({completedCount}/5)</span>
              <span className="text-xs text-muted-foreground">{completedCount === 5 ? "All done! 🎉" : `${5 - (completedCount ?? 0)} remaining`}</span>
            </div>
            <div className="space-y-2">
              <ChecklistItem done={onboardingSteps.hasApiKey} href="/settings/llm" label="Set up AI provider" />
              <ChecklistItem done={onboardingSteps.hasChangedCurrency} href="/settings" label="Set default currency to INR" />
              <ChecklistItem done={onboardingSteps.hasFirstUpload} href="/unsorted" label="Upload your first invoice" />
              <ChecklistItem done={onboardingSteps.hasFirstAnalysis} href="/unsorted" label="Run AI analysis on an invoice" />
              <ChecklistItem done={onboardingSteps.hasViewedGSTR1} href="/apps/gstr1" label="View your first GSTR-1 report" />
            </div>
          </div>
        )}
      </div>
    </Card>
  )
}
