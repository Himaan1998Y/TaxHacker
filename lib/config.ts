import { z } from "zod"

const envSchema = z.object({
  BASE_URL: z.string().optional(),
  PORT: z.string().default("7331"),
  SELF_HOSTED_MODE: z.enum(["true", "false"]).default("true"),
  ENCRYPTION_KEY: z.string().length(64).optional(),
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_MODEL_NAME: z.string().default("gpt-4o-mini"),
  GOOGLE_API_KEY: z.string().optional(),
  GOOGLE_MODEL_NAME: z.string().default("gemini-2.5-flash"),
  MISTRAL_API_KEY: z.string().optional(),
  MISTRAL_MODEL_NAME: z.string().default("mistral-medium-latest"),
  OPENROUTER_API_KEY: z.string().optional(),
  OPENROUTER_MODEL_NAME: z.string().default("google/gemini-2.5-flash"),
  BETTER_AUTH_SECRET: z
    .string()
    .min(16, "Auth secret must be at least 16 characters")
    .default("please-set-your-key-here"),
  SELF_HOSTED_PASSWORD: z.string().optional(),
  DISABLE_SIGNUP: z.enum(["true", "false"]).default("false"),
  RESEND_API_KEY: z.string().default("please-set-your-resend-api-key-here"),
  RESEND_FROM_EMAIL: z.string().default("TaxHacker <user@localhost>"),
  RESEND_AUDIENCE_ID: z.string().default(""),
  RAZORPAY_KEY_ID: z.string().default(""),
  RAZORPAY_KEY_SECRET: z.string().default(""),
  RAZORPAY_WEBHOOK_SECRET: z.string().default(""),
  RAZORPAY_PRO_PLAN_ID: z.string().default(""),
  RAZORPAY_PRO_YEARLY_PLAN_ID: z.string().default(""),
  NEXT_PUBLIC_RAZORPAY_KEY_ID: z.string().default(""),
})

const rawEnv = envSchema.parse(process.env)

function isValidUrl(value: string): boolean {
  try {
    new URL(value)
    return true
  } catch {
    return false
  }
}

const resolvedBaseUrl = rawEnv.BASE_URL && isValidUrl(rawEnv.BASE_URL)
  ? rawEnv.BASE_URL
  : `http://localhost:${rawEnv.PORT}`

const isProductionRuntime = process.env.NODE_ENV === "production" && process.env.NEXT_PHASE !== "phase-production-build"

if (isProductionRuntime) {
  if (!process.env.ENCRYPTION_KEY) {
    throw new Error(
      "[STARTUP ERROR] ENCRYPTION_KEY is required in production. Generate with: openssl rand -hex 32"
    )
  }
  if (rawEnv.BETTER_AUTH_SECRET === "please-set-your-key-here") {
    throw new Error(
      "[STARTUP ERROR] BETTER_AUTH_SECRET is using the default insecure value. Set a unique secret via environment variable."
    )
  }
  if (rawEnv.BASE_URL && !isValidUrl(rawEnv.BASE_URL)) {
    throw new Error(
      "[STARTUP ERROR] BASE_URL is invalid. Set BASE_URL to a valid absolute URL in production."
    )
  }
}

const env = {
  ...rawEnv,
  BASE_URL: resolvedBaseUrl,
}

const config = {
  app: {
    title: "TaxHacker India",
    description: "AI-powered GST, TDS & Indian tax assistant — GSTR-1, GSTR-3B reports, Tally export, invoice scanner for freelancers, MSMEs & CAs",
    version: process.env.npm_package_version || "0.0.1",
    baseURL: env.BASE_URL || `http://localhost:${env.PORT || "7331"}`,
    supportEmail: "support@taxhackerindia.in",
  },
  upload: {
    acceptedMimeTypes: "image/*,.pdf,.doc,.docx,.xls,.xlsx",
    images: {
      maxWidth: 1800,
      maxHeight: 1800,
      quality: 90,
    },
    pdfs: {
      maxPages: 10,
      dpi: 150,
      quality: 90,
      maxWidth: 1500,
      maxHeight: 1500,
    },
  },
  selfHosted: {
    isEnabled: env.SELF_HOSTED_MODE === "true",
    password: env.SELF_HOSTED_PASSWORD,
    redirectUrl: "/self-hosted/redirect",
    welcomeUrl: "/self-hosted",
  },
  ai: {
    openaiApiKey: env.OPENAI_API_KEY,
    openaiModelName: env.OPENAI_MODEL_NAME,
    googleApiKey: env.GOOGLE_API_KEY,
    googleModelName: env.GOOGLE_MODEL_NAME,
    mistralApiKey: env.MISTRAL_API_KEY,
    mistralModelName: env.MISTRAL_MODEL_NAME,
    openrouterApiKey: env.OPENROUTER_API_KEY,
    openrouterModelName: env.OPENROUTER_MODEL_NAME,
  },
  auth: {
    secret: env.BETTER_AUTH_SECRET,
    loginUrl: "/enter",
    disableSignup: env.DISABLE_SIGNUP === "true" || env.SELF_HOSTED_MODE === "true",
  },
  razorpay: {
    keyId: env.RAZORPAY_KEY_ID,
    keySecret: env.RAZORPAY_KEY_SECRET,
    webhookSecret: env.RAZORPAY_WEBHOOK_SECRET,
    paymentSuccessUrl: `${env.BASE_URL}/cloud/payment/success`,
    paymentCancelUrl: `${env.BASE_URL}/cloud`,
  },
  email: {
    apiKey: env.RESEND_API_KEY,
    from: env.RESEND_FROM_EMAIL,
    audienceId: env.RESEND_AUDIENCE_ID,
  },
} as const

export default config
