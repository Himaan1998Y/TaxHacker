import { prisma } from "@/lib/db"
import config from "@/lib/config"
import { PROVIDERS } from "@/lib/llm-providers"
import { cache } from "react"
import { LLMProvider } from "@/ai/providers/llmProvider"

export type SettingsMap = Record<string, string>

/**
 * Helper to extract LLM provider settings from SettingsMap.
 * Falls back to environment variables (config.ai.*) when DB settings are empty.
 */
export function getLLMSettings(settings: SettingsMap) {
  const priorities = (settings.llm_providers || "openai,google,mistral,openrouter").split(",").map(p => p.trim()).filter(Boolean)

  const providerLookup: Record<string, () => { provider: LLMProvider; apiKey: string; model: string }> = {
    openai: () => ({
      provider: "openai" as LLMProvider,
      apiKey: settings.openai_api_key || config.ai.openaiApiKey || "",
      model: settings.openai_model_name || config.ai.openaiModelName || PROVIDERS.find(p => p.key === "openai")?.defaultModelName || "gpt-4o-mini",
    }),
    google: () => ({
      provider: "google" as LLMProvider,
      apiKey: settings.google_api_key || config.ai.googleApiKey || "",
      model: settings.google_model_name || config.ai.googleModelName || PROVIDERS.find(p => p.key === "google")?.defaultModelName || "gemini-2.5-flash",
    }),
    mistral: () => ({
      provider: "mistral" as LLMProvider,
      apiKey: settings.mistral_api_key || config.ai.mistralApiKey || "",
      model: settings.mistral_model_name || config.ai.mistralModelName || PROVIDERS.find(p => p.key === "mistral")?.defaultModelName || "mistral-medium-latest",
    }),
    openrouter: () => ({
      provider: "openrouter" as LLMProvider,
      apiKey: settings.openrouter_api_key || config.ai.openrouterApiKey || "",
      model: settings.openrouter_model_name || config.ai.openrouterModelName || PROVIDERS.find(p => p.key === "openrouter")?.defaultModelName || "google/gemini-2.5-flash",
    }),
  }

  const providers = priorities
    .map((key) => providerLookup[key]?.())
    .filter((provider): provider is NonNullable<typeof provider> => provider !== null && provider !== undefined)

  return {
    providers,
  }
}

export const getSettings = cache(async (userId: string): Promise<SettingsMap> => {
  const settings = await prisma.setting.findMany({
    where: { userId },
  })

  return settings.reduce((acc, setting) => {
    acc[setting.code] = setting.value || ""
    return acc
  }, {} as SettingsMap)
})

export async function updateSettings(userId: string, code: string, value: string | undefined) {
  return await prisma.setting.upsert({
    where: { userId_code: { code, userId } },
    update: { value },
    create: {
      code,
      value,
      name: code,
      userId,
    },
  })
}
