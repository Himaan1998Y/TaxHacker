import { NextResponse } from "next/server"

export async function POST() {
  return NextResponse.json(
    { error: "Stripe has been replaced with Razorpay. Use /api/razorpay/checkout" },
    { status: 410 }
  )
}
