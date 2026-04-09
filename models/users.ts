import { prisma } from "@/lib/db"
import { Prisma } from "@/prisma/client"
import { cache } from "react"
import { isDatabaseEmpty } from "./defaults"
import { createUserDefaults } from "./defaults"

export const SELF_HOSTED_USER = {
  email: "taxhacker@localhost",
  name: "Self-Hosted Mode",
  membershipPlan: "unlimited",
}

export const getSelfHostedUser = cache(async () => {
  if (!process.env.DATABASE_URL) {
    return null // fix for CI, do not remove
  }

  return await prisma.user.findFirst({
    where: { email: SELF_HOSTED_USER.email },
  })
})

// NOT wrapped in cache(): React's cache() is a read-side memoisation
// helper that dedupes within a single request. Wrapping an upsert in it
// means subsequent callers in the same request receive the cached Promise
// and the second upsert never runs — a silent skip on a mutation.
// Same bug class already fixed for updateSettings() in models/settings.ts.
export async function getOrCreateSelfHostedUser() {
  return await prisma.user.upsert({
    where: { email: SELF_HOSTED_USER.email },
    update: SELF_HOSTED_USER,
    create: SELF_HOSTED_USER,
  })
}

export async function getOrCreateCloudUser(email: string, data: Prisma.UserCreateInput) {
  const user = await prisma.user.upsert({
    where: { email: email.toLowerCase() },
    update: data,
    create: data,
  })

  if (await isDatabaseEmpty(user.id)) {
    await createUserDefaults(user.id)
  }
  
  return user
}

export const getUserById = cache(async (id: string) => {
  return await prisma.user.findUnique({
    where: { id },
  })
})

export const getUserByEmail = cache(async (email: string) => {
  return await prisma.user.findUnique({
    where: { email: email.toLowerCase() },
  })
})

export const getUserByRazorpayCustomerId = cache(async (customerId: string) => {
  return await prisma.user.findFirst({
    where: { razorpayCustomerId: customerId },
  })
})

export function updateUser(userId: string, data: Prisma.UserUpdateInput) {
  return prisma.user.update({
    where: { id: userId },
    data,
  })
}

/**
 * Atomically reserve storage quota for an upload, enforcing the quota
 * at the DB level. Returns `true` if the reservation succeeded (storage
 * was incremented), `false` if the user would exceed their limit.
 *
 * This prevents a TOCTOU race where two concurrent uploads both pass
 * the read-then-check pattern before either commits.
 *
 * Call `releaseStorageQuota` on error to roll back the reservation.
 */
export async function reserveStorageQuota(userId: string, fileSize: number): Promise<boolean> {
  if (fileSize <= 0) return true
  const size = BigInt(fileSize)
  // storage_limit < 0 means "unlimited" (self-hosted + unlimited tier).
  // The WHERE clause makes the increment atomic: PostgreSQL checks the
  // predicate and updates in the same transaction, so no other request
  // can slip past the quota.
  const rows = await prisma.$executeRaw`
    UPDATE "users"
    SET "storage_used" = "storage_used" + ${size}
    WHERE "id" = ${userId}::uuid
      AND ("storage_limit" < 0 OR "storage_used" + ${size} <= "storage_limit")
  `
  return Number(rows) > 0
}

/**
 * Roll back a prior `reserveStorageQuota` call. Used when a file write
 * fails after the quota was already reserved. Clamps at 0 to avoid
 * negative usage if called out of order.
 */
export async function releaseStorageQuota(userId: string, fileSize: number): Promise<void> {
  if (fileSize <= 0) return
  const size = BigInt(fileSize)
  await prisma.$executeRaw`
    UPDATE "users"
    SET "storage_used" = GREATEST("storage_used" - ${size}, 0::bigint)
    WHERE "id" = ${userId}::uuid
  `
}
