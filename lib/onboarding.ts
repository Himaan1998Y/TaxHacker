import { prisma } from "@/lib/db"
import { getSettings } from "@/models/settings"

export interface OnboardingStatus {
  hasApiKey: boolean
  hasCurrencySet: boolean
  hasTransaction: boolean
  hasAnalyzedTransaction: boolean
}

export async function getOnboardingStatus(userId: string): Promise<OnboardingStatus> {
  const [settings, fileCount, analyzedCount] = await Promise.all([
    getSettings(userId),
    prisma.file.count({ where: { userId } }),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    prisma.file.count({ where: { userId, cachedParseResult: { not: null as any } } }),
  ])

  return {
    hasApiKey: !!(
      settings.google_api_key ||
      settings.openai_api_key ||
      settings.mistral_api_key ||
      settings.openrouter_api_key
    ),
    hasCurrencySet: !!settings.default_currency,
    hasTransaction: fileCount > 0,
    hasAnalyzedTransaction: analyzedCount > 0,
  }
}
