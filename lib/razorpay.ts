import Razorpay from "razorpay"

export const razorpayClient: Razorpay | null =
  process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET
    ? new Razorpay({
        key_id: process.env.RAZORPAY_KEY_ID!,
        key_secret: process.env.RAZORPAY_KEY_SECRET!,
      })
    : null

export type Plan = {
  code: string
  name: string
  description: string
  benefits: string[]
  price: string
  razorpayPlanId: string | null
  razorpayYearlyPlanId: string | null
  limits: { storage: number; ai: number }
  isAvailable: boolean
}

export const PLANS: Record<string, Plan> = {
  free: {
    code: "free",
    name: "Free",
    description: "For individuals getting started with GST filing",
    benefits: [
      "25 AI scans/month",
      "1 GB storage",
      "GSTR-1 & GSTR-3B reports",
      "Invoice generator",
      "Tally export",
      "Self-hostable",
    ],
    price: "₹0/month",
    razorpayPlanId: null,
    razorpayYearlyPlanId: null,
    limits: { storage: 1 * 1024 * 1024 * 1024, ai: 25 },
    isAvailable: true,
  },
  pro: {
    code: "pro",
    name: "Pro",
    description: "Unlimited everything for serious filers and businesses",
    benefits: [
      "Unlimited AI scans",
      "Unlimited storage",
      "GSTR-1 & GSTR-3B reports",
      "Invoice QR codes",
      "Tally export",
      "Priority email support",
      "Early access to new features",
    ],
    price: "₹499/month",
    razorpayPlanId: process.env.RAZORPAY_PRO_PLAN_ID || null,
    razorpayYearlyPlanId: process.env.RAZORPAY_PRO_YEARLY_PLAN_ID || null,
    limits: { storage: -1, ai: -1 },
    isAvailable: !!process.env.RAZORPAY_PRO_PLAN_ID,
  },
}
