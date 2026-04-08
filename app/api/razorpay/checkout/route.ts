import { razorpayClient, PLANS } from "@/lib/razorpay"
import { NextRequest, NextResponse } from "next/server"

export async function POST(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code")

  if (!code) {
    return NextResponse.json({ error: "Missing plan code" }, { status: 400 })
  }

  const plan = PLANS[code]

  if (!plan) {
    return NextResponse.json({ error: "Invalid plan" }, { status: 400 })
  }

  // Free plan — no payment needed
  if (plan.code === "free") {
    return NextResponse.json({ free: true })
  }

  if (!plan.isAvailable || !plan.razorpayPlanId) {
    return NextResponse.json({
      error: "Payments coming soon. Contact us at support@taxhackerindia.in to upgrade.",
      comingSoon: true,
    }, { status: 503 })
  }

  if (!razorpayClient) {
    return NextResponse.json({ error: "Payment gateway not configured" }, { status: 500 })
  }

  try {
    const subscription = await (razorpayClient.subscriptions as any).create({
      plan_id: plan.razorpayPlanId,
      total_count: 12,
      quantity: 1,
    })

    return NextResponse.json({
      subscriptionId: subscription.id,
      keyId: process.env.RAZORPAY_KEY_ID,
    })
  } catch (error) {
    console.error("[razorpay/checkout] error creating subscription:", error)
    return NextResponse.json({ error: "Failed to create subscription" }, { status: 500 })
  }
}
