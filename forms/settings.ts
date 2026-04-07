import { randomHexColor } from "@/lib/utils"
import { INDIAN_STATES } from "@/lib/indian-states"
import { validateGSTIN } from "@/lib/indian-tax-utils"
import { z } from "zod"

export const settingsFormSchema = z.object({
  default_currency: z.string().max(5).optional(),
  default_type: z.string().optional(),
  default_category: z.string().optional(),
  default_project: z.string().optional(),
  openai_api_key: z.string().optional(),
  openai_model_name: z.string().default('gpt-4o-mini'),
  google_api_key: z.string().optional(),
  google_model_name: z.string().default("gemini-2.5-flash"),
  mistral_api_key: z.string().optional(),
  mistral_model_name: z.string().default("mistral-medium-latest"),
  openrouter_api_key: z.string().optional(),
  openrouter_model_name: z.string().default("google/gemini-2.5-flash"),
  llm_providers: z.string().default('openai,google,mistral,openrouter'),
  prompt_analyse_new_file: z.string().optional(),
  prompt_analyse_bank_statement: z.string().optional(),
  is_welcome_message_hidden: z.string().optional(),
  business_gstin: z.string().max(15).optional().refine((val) => {
    if (!val) return true
    return validateGSTIN(val).valid
  }, { message: "Invalid GSTIN format or checksum" }),
  business_pan: z.string().max(10).optional(),
  business_state_code: z.string().max(2).optional().refine((val) => {
    if (!val) return true
    return INDIAN_STATES[val] !== undefined
  }, { message: "Invalid state code" }),
  business_bank_details: z.string().max(1024).optional(),
})

export const currencyFormSchema = z.object({
  code: z.string().max(5),
  name: z.string().max(32),
})

export const projectFormSchema = z.object({
  name: z.string().max(128),
  llm_prompt: z.string().max(512).nullable().optional(),
  color: z.string().max(7).default(randomHexColor()).nullable().optional(),
})

export const categoryFormSchema = z.object({
  name: z.string().max(128),
  llm_prompt: z.string().max(512).nullable().optional(),
  color: z.string().max(7).default(randomHexColor()).nullable().optional(),
})

export const fieldFormSchema = z.object({
  name: z.string().max(128),
  type: z.string().max(128).default("string"),
  llm_prompt: z.string().max(512).nullable().optional(),
  isVisibleInList: z.boolean().optional(),
  isVisibleInAnalysis: z.boolean().optional(),
  isRequired: z.boolean().optional(),
})
