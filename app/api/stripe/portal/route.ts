import { NextResponse } from "next/server"

export async function GET() {
  return NextResponse.json(
    { error: "Stripe portal is no longer available. Contact support@taxhackerindia.in to manage your subscription." },
    { status: 410 }
  )
}
