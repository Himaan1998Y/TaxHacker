import { NextResponse } from "next/server"

export async function POST() {
  return new NextResponse("Stripe webhooks are no longer processed.", { status: 410 })
}
