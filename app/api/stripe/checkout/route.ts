import config from "@/lib/config"
import { PLANS, stripeClient } from "@/lib/stripe"
import { NextRequest, NextResponse } from "next/server"

export async function POST(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const code = searchParams.get("code")

  if (!code) {
    return NextResponse.json({ error: "Missing plan code" }, { status: 400 })
  }

  if (!stripeClient) {
    return NextResponse.json({ error: "Stripe is not enabled" }, { status: 500 })
  }

  const plan = PLANS[code]
  if (!plan || !plan.isAvailable) {
    return NextResponse.json({ error: "Invalid or inactive plan" }, { status: 400 })
  }

  try {
    const session = await stripeClient.checkout.sessions.create({
      billing_address_collection: "auto",
      line_items: [
        {
          price: plan.stripePriceId,
          quantity: 1,
        },
      ],
      mode: "subscription",
      automatic_tax: {
        enabled: true,
      },
      allow_promotion_codes: true,
      success_url: config.stripe.paymentSuccessUrl,
      cancel_url: config.stripe.paymentCancelUrl,
    })

    if (!session.url) {
      // SECURITY: Log only safe identifiers server-side. Do not dump the
      // full Stripe session object (leaks customer email, PII, metadata).
      console.error("[stripe/checkout] session has no url", { id: session.id, status: session.status })
      return NextResponse.json({ error: "Failed to create checkout session" }, { status: 500 })
    }

    return NextResponse.json({ session })
  } catch (error) {
    // SECURITY: Log detailed error server-side only; return generic message.
    console.error("[stripe/checkout] error:", error)
    return NextResponse.json({ error: "Failed to create checkout session" }, { status: 500 })
  }
}
