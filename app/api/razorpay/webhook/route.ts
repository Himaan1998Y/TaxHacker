import crypto from "crypto"
import { getOrCreateCloudUser, updateUser } from "@/models/users"
import { PLANS } from "@/lib/razorpay"
import { NextResponse } from "next/server"

export async function POST(request: Request) {
  const body = await request.text()
  const signature = request.headers.get("x-razorpay-signature")
  const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET

  if (!webhookSecret || !signature) {
    return new NextResponse("Webhook secret or signature missing", { status: 400 })
  }

  const expected = crypto.createHmac("sha256", webhookSecret).update(body).digest("hex")
  if (signature !== expected) {
    return new NextResponse("Invalid signature", { status: 400 })
  }

  let event: { event: string; payload: any }
  try {
    event = JSON.parse(body)
  } catch {
    return new NextResponse("Invalid JSON", { status: 400 })
  }

  try {
    switch (event.event) {
      case "subscription.activated":
      case "subscription.charged": {
        const sub = event.payload.subscription?.entity
        const payment = event.payload.payment?.entity
        if (!sub) break

        const plan = Object.values(PLANS).find((p) => p.razorpayPlanId === sub.plan_id)
        if (!plan) break

        const email = payment?.email || sub.customer_notify_info?.customer_email || ""
        if (!email) break

        const user = await getOrCreateCloudUser(email, {
          email,
          name: email,
          razorpayCustomerId: sub.customer_id,
        })

        const expiresAt = new Date(sub.current_end * 1000)
        await updateUser(user.id, {
          membershipPlan: plan.code,
          membershipExpiresAt: expiresAt,
          storageLimit: plan.limits.storage,
          aiBalance: plan.limits.ai,
          razorpayCustomerId: sub.customer_id,
          updatedAt: new Date(),
        })
        break
      }

      case "subscription.cancelled":
      case "subscription.paused": {
        const sub = event.payload.subscription?.entity
        if (!sub?.customer_id) break
        // Let membership expire naturally — don't revoke immediately
        console.log("Subscription cancelled/paused for customer:", sub.customer_id ? "[redacted]" : "unknown")
        break
      }

      default:
        // Unhandled event — return 200 so Razorpay doesn't retry
        break
    }

    return new NextResponse("OK", { status: 200 })
  } catch (error) {
    console.error("[razorpay/webhook] processing error:", error)
    return new NextResponse("Webhook processing failed", { status: 500 })
  }
}
