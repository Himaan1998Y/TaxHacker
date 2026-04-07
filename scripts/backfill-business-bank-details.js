import { PrismaClient } from "@prisma/client"
import fs from "fs"
import path from "path"

const envPath = path.resolve(process.cwd(), ".env")
if (fs.existsSync(envPath)) {
  const envText = fs.readFileSync(envPath, "utf8")
  for (const line of envText.split(/\r?\n/)) {
    const match = line.match(/^([^#=]+)=([\s\S]*)$/)
    if (match) {
      const key = match[1].trim()
      let value = match[2].trim()
      if (value.startsWith("\"") && value.endsWith("\"")) {
        value = value.slice(1, -1)
      }
      if (!process.env[key]) {
        process.env[key] = value
      }
    }
  }
}

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set. Create a .env file or set DATABASE_URL before running this script.")
  process.exit(1)
}

const prisma = new PrismaClient()

async function backfillBusinessBankDetails() {
  console.log("Starting business bank details backfill...")
  const users = await prisma.user.findMany({
    where: {
      businessBankDetails: {
        not: null,
      },
    },
    select: {
      id: true,
      businessBankDetails: true,
    },
  })

  let count = 0
  for (const user of users) {
    const bankDetails = user.businessBankDetails?.trim()
    if (!bankDetails) continue

    await prisma.setting.upsert({
      where: { userId_code: { userId: user.id, code: "business_bank_details" } },
      update: { value: bankDetails },
      create: {
        userId: user.id,
        code: "business_bank_details",
        name: "business_bank_details",
        value: bankDetails,
      },
    })

    count += 1
  }

  console.log(`Backfilled business_bank_details for ${count} users.`)
}

async function backfillTransactionFiles() {
  console.log("Starting transaction file backfill...")
  const transactions = await prisma.transaction.findMany({
    where: {
      files: {
        not: {
          equals: [],
        },
      },
    },
    select: {
      id: true,
      userId: true,
      files: true,
    },
  })

  let created = 0
  for (const tx of transactions) {
    const fileIds = Array.isArray(tx.files) ? tx.files.filter(Boolean) : []
    if (fileIds.length === 0) continue

    for (const fileId of fileIds) {
      const existing = await prisma.transactionFile.findFirst({
        where: {
          transactionId: tx.id,
          fileId,
          userId: tx.userId,
        },
      })
      if (existing) continue

      await prisma.transactionFile.create({
        data: {
          transactionId: tx.id,
          fileId,
          userId: tx.userId,
        },
      })
      created += 1
    }
  }

  console.log(`Created ${created} new TransactionFile records.`)
}

async function main() {
  try {
    await backfillBusinessBankDetails()
    await backfillTransactionFiles()
    console.log("Phase 2 backfill completed.")
  } catch (error) {
    console.error("Backfill failed:", error)
    process.exitCode = 1
  } finally {
    await prisma.$disconnect()
  }
}

main()
