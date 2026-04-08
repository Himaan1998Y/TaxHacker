"use server"

import {
  categoryFormSchema,
  currencyFormSchema,
  fieldFormSchema,
  projectFormSchema,
  settingsFormSchema,
} from "@/forms/settings"
import { userFormSchema } from "@/forms/users"
import { ActionState } from "@/lib/actions"
import { getCurrentUser } from "@/lib/auth"
import { uploadStaticImage } from "@/lib/uploads"
import { codeFromName, randomHexColor } from "@/lib/utils"
import { createCategory, deleteCategory, updateCategory } from "@/models/categories"
import { createCurrency, deleteCurrency, updateCurrency } from "@/models/currencies"
import { createField, deleteField, updateField } from "@/models/fields"
import { createProject, deleteProject, updateProject } from "@/models/projects"
import { SettingsMap, updateSettings } from "@/models/settings"
import { updateUser } from "@/models/users"
import { Prisma, User } from "@/prisma/client"
import { revalidatePath } from "next/cache"
import path from "path"

// Server-side logging utility (errors never exposed to client)
function logServerError(context: string, error: unknown, userId?: string) {
  const errorMessage = error instanceof Error ? error.message : String(error)
  const timestamp = new Date().toISOString()
  console.error(`[${timestamp}] ${context}${userId ? ` (user: ${userId})` : ""}: ${errorMessage}`)
}

export async function saveSettingsAction(
  _prevState: ActionState<SettingsMap> | null,
  formData: FormData
): Promise<ActionState<SettingsMap>> {
  const user = await getCurrentUser()
  const validatedForm = settingsFormSchema.safeParse(Object.fromEntries(formData))

  if (!validatedForm.success) {
    return { success: false, error: validatedForm.error.errors.map((e) => e.message).join(", ") }
  }

  for (const key in validatedForm.data) {
    const value = validatedForm.data[key as keyof typeof validatedForm.data]
    if (value !== undefined) {
      await updateSettings(user.id, key, value)
    }
  }

  revalidatePath("/settings")
  return { success: true }
}

export async function saveProfileAction(
  _prevState: ActionState<User> | null,
  formData: FormData
): Promise<ActionState<User>> {
  const user = await getCurrentUser()
  const validatedForm = userFormSchema.safeParse(Object.fromEntries(formData))

  if (!validatedForm.success) {
    return { success: false, error: validatedForm.error.errors.map((e) => e.message).join(", ") }
  }

  // Upload avatar
  let avatarUrl = user.avatar
  const avatarFile = formData.get("avatar") as File | null
  if (avatarFile instanceof File && avatarFile.size > 0) {
    try {
      const uploadedAvatarPath = await uploadStaticImage(user, avatarFile, "avatar.webp", 500, 500)
      avatarUrl = `/files/static/${path.basename(uploadedAvatarPath)}`
    } catch (error) {
      logServerError("Avatar upload failed", error, user.id)
      return { success: false, error: "Failed to upload avatar. Please try again or choose a different image." }
    }
  }

  // Upload business logo
  let businessLogoUrl = user.businessLogo
  const businessLogoFile = formData.get("businessLogo") as File | null
  if (businessLogoFile instanceof File && businessLogoFile.size > 0) {
    try {
      const uploadedBusinessLogoPath = await uploadStaticImage(user, businessLogoFile, "businessLogo.png", 500, 500)
      businessLogoUrl = `/files/static/${path.basename(uploadedBusinessLogoPath)}`
    } catch (error) {
      logServerError("Business logo upload failed", error, user.id)
      return { success: false, error: "Failed to upload business logo. Please try again or choose a smaller file." }
    }
  }

  // SECURITY/DPDP: Bank details now live ONLY in the encrypted Settings
  // table (key `business_bank_details`). The plaintext column on User is
  // preserved read-only as a fallback for unmigrated rows but is never
  // written to anymore. A future migration will drop the column after
  // the backfill is verified across all tenants.
  await updateUser(user.id, {
    name: validatedForm.data.name !== undefined ? validatedForm.data.name : user.name,
    avatar: avatarUrl,
    businessName: validatedForm.data.businessName !== undefined ? validatedForm.data.businessName : user.businessName,
    businessAddress:
      validatedForm.data.businessAddress !== undefined ? validatedForm.data.businessAddress : user.businessAddress,
    businessLogo: businessLogoUrl,
  })

  if (validatedForm.data.businessBankDetails !== undefined) {
    await updateSettings(user.id, "business_bank_details", validatedForm.data.businessBankDetails)
  }

  revalidatePath("/settings/profile")
  revalidatePath("/settings/business")
  return { success: true }
}

export async function addProjectAction(data: Prisma.ProjectCreateInput) {
  const user = await getCurrentUser()
  const validatedForm = projectFormSchema.safeParse(data)

  if (!validatedForm.success) {
    return { success: false, error: validatedForm.error.errors.map((e) => e.message).join(", ") }
  }

  const project = await createProject(user.id, {
    code: codeFromName(validatedForm.data.name),
    name: validatedForm.data.name,
    llm_prompt: validatedForm.data.llm_prompt || null,
    color: validatedForm.data.color || randomHexColor(),
  })
  revalidatePath("/settings/projects")

  return { success: true, project }
}

export async function editProjectAction(code: string, data: Prisma.ProjectUpdateInput) {
  const user = await getCurrentUser()
  const validatedForm = projectFormSchema.safeParse(data)

  if (!validatedForm.success) {
    return { success: false, error: validatedForm.error.errors.map((e) => e.message).join(", ") }
  }

  const project = await updateProject(user.id, code, {
    name: validatedForm.data.name,
    llm_prompt: validatedForm.data.llm_prompt,
    color: validatedForm.data.color || "",
  })
  revalidatePath("/settings/projects")

  return { success: true, project }
}

export async function deleteProjectAction(code: string) {
  const user = await getCurrentUser()
  try {
    await deleteProject(user.id, code)
  } catch (error) {
    logServerError(`Failed to delete project: ${code}`, error, user.id)
    return { success: false, error: "Failed to delete project. Please refresh and try again." }
  }
  revalidatePath("/settings/projects")
  return { success: true }
}

export async function addCurrencyAction(data: Prisma.CurrencyCreateInput) {
  const user = await getCurrentUser()
  const validatedForm = currencyFormSchema.safeParse(data)

  if (!validatedForm.success) {
    return { success: false, error: validatedForm.error.errors.map((e) => e.message).join(", ") }
  }

  const currency = await createCurrency(user.id, {
    code: validatedForm.data.code,
    name: validatedForm.data.name,
  })
  revalidatePath("/settings/currencies")

  return { success: true, currency }
}

export async function editCurrencyAction(code: string, data: Prisma.CurrencyUpdateInput) {
  const user = await getCurrentUser()
  const validatedForm = currencyFormSchema.safeParse(data)

  if (!validatedForm.success) {
    return { success: false, error: validatedForm.error.errors.map((e) => e.message).join(", ") }
  }

  const currency = await updateCurrency(user.id, code, { name: validatedForm.data.name })
  revalidatePath("/settings/currencies")
  return { success: true, currency }
}

export async function deleteCurrencyAction(code: string) {
  const user = await getCurrentUser()
  try {
    await deleteCurrency(user.id, code)
  } catch (error) {
    logServerError(`Failed to delete currency: ${code}`, error, user.id)
    return { success: false, error: "Failed to delete currency. Please refresh and try again." }
  }
  revalidatePath("/settings/currencies")
  return { success: true }
}

export async function addCategoryAction(data: Prisma.CategoryCreateInput) {
  const user = await getCurrentUser()
  const validatedForm = categoryFormSchema.safeParse(data)

  if (!validatedForm.success) {
    return { success: false, error: validatedForm.error.errors.map((e) => e.message).join(", ") }
  }

  const code = codeFromName(validatedForm.data.name)
  try {
    const category = await createCategory(user.id, {
      code,
      name: validatedForm.data.name,
      llm_prompt: validatedForm.data.llm_prompt,
      color: validatedForm.data.color || "",
    })
    revalidatePath("/settings/categories")

    return { success: true, category }
  } catch (error: unknown) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      // Duplicate code error — this is a user-facing message, not an exception leak
      return {
        success: false,
        error: `Category with the code "${code}" already exists. Try a different name.`,
      }
    }
    logServerError("Failed to create category", error, user.id)
    return { success: false, error: "Failed to create category. Please try again." }
  }
}

export async function editCategoryAction(code: string, data: Prisma.CategoryUpdateInput) {
  const user = await getCurrentUser()
  const validatedForm = categoryFormSchema.safeParse(data)

  if (!validatedForm.success) {
    return { success: false, error: validatedForm.error.errors.map((e) => e.message).join(", ") }
  }

  const category = await updateCategory(user.id, code, {
    name: validatedForm.data.name,
    llm_prompt: validatedForm.data.llm_prompt,
    color: validatedForm.data.color || "",
  })
  revalidatePath("/settings/categories")

  return { success: true, category }
}

export async function deleteCategoryAction(code: string) {
  const user = await getCurrentUser()
  try {
    await deleteCategory(user.id, code)
  } catch (error) {
    logServerError(`Failed to delete category: ${code}`, error, user.id)
    return { success: false, error: "Failed to delete category. Please refresh and try again." }
  }
  revalidatePath("/settings/categories")
  return { success: true }
}

export async function addFieldAction(data: Prisma.FieldCreateInput) {
  const user = await getCurrentUser()
  const validatedForm = fieldFormSchema.safeParse(data)

  if (!validatedForm.success) {
    return { success: false, error: validatedForm.error.errors.map((e) => e.message).join(", ") }
  }

  const field = await createField(user.id, {
    code: codeFromName(validatedForm.data.name),
    name: validatedForm.data.name,
    type: validatedForm.data.type,
    llm_prompt: validatedForm.data.llm_prompt,
    isVisibleInList: validatedForm.data.isVisibleInList,
    isVisibleInAnalysis: validatedForm.data.isVisibleInAnalysis,
    isRequired: validatedForm.data.isRequired,
    isExtra: true,
  })
  revalidatePath("/settings/fields")

  return { success: true, field }
}

export async function editFieldAction(code: string, data: Prisma.FieldUpdateInput) {
  const user = await getCurrentUser()
  const validatedForm = fieldFormSchema.safeParse(data)

  if (!validatedForm.success) {
    return { success: false, error: validatedForm.error.errors.map((e) => e.message).join(", ") }
  }

  const field = await updateField(user.id, code, {
    name: validatedForm.data.name,
    type: validatedForm.data.type,
    llm_prompt: validatedForm.data.llm_prompt,
    isVisibleInList: validatedForm.data.isVisibleInList,
    isVisibleInAnalysis: validatedForm.data.isVisibleInAnalysis,
    isRequired: validatedForm.data.isRequired,
  })
  revalidatePath("/settings/fields")

  return { success: true, field }
}

export async function deleteFieldAction(code: string) {
  const user = await getCurrentUser()
  try {
    await deleteField(user.id, code)
  } catch (error) {
    logServerError(`Failed to delete field: ${code}`, error, user.id)
    return { success: false, error: "Failed to delete field. Please refresh and try again." }
  }
  revalidatePath("/settings/fields")
  return { success: true }
}
