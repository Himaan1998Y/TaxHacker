import { prisma } from "@/lib/db"
import { NextResponse } from "next/server"

/**
 * Health check endpoint for Coolify/Docker healthcheck
 * Returns 200 if app is healthy, 500 if database is unreachable
 */
export async function GET() {
  try {
    // Verify database connectivity
    await prisma.$queryRaw`SELECT 1`

    return NextResponse.json(
      {
        status: "healthy",
        timestamp: new Date().toISOString(),
      },
      { status: 200 }
    )
  } catch (error) {
    console.error("[health] Database check failed:", error instanceof Error ? error.message : String(error))

    return NextResponse.json(
      {
        status: "unhealthy",
        error: error instanceof Error ? error.message : "Unknown error",
        timestamp: new Date().toISOString(),
      },
      { status: 500 }
    )
  }
}
