"use server"

import { createUserDefaults, isDatabaseEmpty } from "@/models/defaults"
import { updateSettings } from "@/models/settings"
import { getOrCreateSelfHostedUser } from "@/models/users"
import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"

export async function selfHostedGetStartedAction(formData: FormData) {
  const user = await getOrCreateSelfHostedUser()

  if (await isDatabaseEmpty(user.id)) {
    await createUserDefaults(user.id)
  }

  const apiKeys = [
    "openai_api_key",
    "google_api_key",
    "mistral_api_key",
    "openrouter_api_key"
  ]

  for (const key of apiKeys) {
    const value = formData.get(key)
    if (value) {
      await updateSettings(user.id, key, value as string)
    }
  }

  // Save model names if provided
  const modelNames = [
    "openai_model_name",
    "google_model_name",
    "mistral_model_name",
    "openrouter_model_name"
  ]
  for (const key of modelNames) {
    const value = formData.get(key)
    if (value) {
      await updateSettings(user.id, key, value as string)
    }
  }

  const defaultCurrency = formData.get("default_currency")
  if (defaultCurrency) {
    await updateSettings(user.id, "default_currency", defaultCurrency as string)
  }

  // Record consent (DPDP Act 2023 compliance)
  const consentGiven = formData.get("consent_given")
  if (consentGiven === "true") {
    await updateSettings(user.id, "consent_timestamp", new Date().toISOString())
    await updateSettings(user.id, "consent_version", "1.0")
  }

  revalidatePath("/dashboard")
  redirect("/dashboard")
}
