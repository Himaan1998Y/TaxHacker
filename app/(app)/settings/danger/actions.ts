"use server"

import { getCurrentUser } from "@/lib/auth"
import { prisma } from "@/lib/db"
import { DEFAULT_CATEGORIES, DEFAULT_CURRENCIES, DEFAULT_FIELDS, DEFAULT_SETTINGS } from "@/models/defaults"
import { redirect } from "next/navigation"

export async function resetLLMSettings() {
  // SECURITY: Use getCurrentUser() — never trust a caller-supplied user.
  // Previously took (user: User) which allowed any authenticated user to
  // reset another user's settings by passing a fabricated user.id.
  const user = await getCurrentUser()
  if (!user) {
    throw new Error("Unauthorized")
  }

  const llmSettings = DEFAULT_SETTINGS.filter((setting) => setting.code === "prompt_analyse_new_file")

  for (const setting of llmSettings) {
    await prisma.setting.upsert({
      where: { userId_code: { code: setting.code, userId: user.id } },
      update: { value: setting.value },
      create: { ...setting, userId: user.id },
    })
  }

  redirect("/settings/llm")
}

export async function resetFieldsAndCategories() {
  // SECURITY: Use getCurrentUser() — never trust a caller-supplied user.
  // See resetLLMSettings() above for the same fix.
  const user = await getCurrentUser()
  if (!user) {
    throw new Error("Unauthorized")
  }

  // Reset categories
  for (const category of DEFAULT_CATEGORIES) {
    await prisma.category.upsert({
      where: { userId_code: { code: category.code, userId: user.id } },
      update: { name: category.name, color: category.color, llm_prompt: category.llm_prompt, createdAt: new Date() },
      create: { ...category, userId: user.id, createdAt: new Date() },
    })
  }
  await prisma.category.deleteMany({
    where: { userId: user.id, code: { notIn: DEFAULT_CATEGORIES.map((category) => category.code) } },
  })

  // Reset currencies
  for (const currency of DEFAULT_CURRENCIES) {
    await prisma.currency.upsert({
      where: { userId_code: { code: currency.code, userId: user.id } },
      update: { name: currency.name },
      create: { ...currency, userId: user.id },
    })
  }
  await prisma.currency.deleteMany({
    where: { userId: user.id, code: { notIn: DEFAULT_CURRENCIES.map((currency) => currency.code) } },
  })

  // Reset fields
  for (const field of DEFAULT_FIELDS) {
    await prisma.field.upsert({
      where: { userId_code: { code: field.code, userId: user.id } },
      update: {
        name: field.name,
        type: field.type,
        llm_prompt: field.llm_prompt,
        createdAt: new Date(),
        isVisibleInList: field.isVisibleInList,
        isVisibleInAnalysis: field.isVisibleInAnalysis,
        isRequired: field.isRequired,
        isExtra: field.isExtra,
      },
      create: { ...field, userId: user.id, createdAt: new Date() },
    })
  }
  await prisma.field.deleteMany({
    where: { userId: user.id, code: { notIn: DEFAULT_FIELDS.map((field) => field.code) } },
  })

  redirect("/settings/fields")
}
