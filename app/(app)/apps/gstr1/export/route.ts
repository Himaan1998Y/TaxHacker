import { getCurrentUser } from "@/lib/auth"
import { generateGSTR1Report } from "@/lib/gstr1"
import { getSettings } from "@/models/settings"
import { getTransactions } from "@/models/transactions"
import { format } from "@fast-csv/format"
import JSZip from "jszip"
import { NextResponse } from "next/server"
import { Readable } from "stream"

export async function GET(request: Request) {
  const url = new URL(request.url)
  const monthStr = url.searchParams.get("month") // 1-12
  const yearStr = url.searchParams.get("year")

  if (!monthStr || !yearStr) {
    return NextResponse.json({ error: "month and year required" }, { status: 400 })
  }

  const month = parseInt(monthStr) - 1 // 0-indexed for Date
  const year = parseInt(yearStr)

  const user = await getCurrentUser()
  const settings = await getSettings(user.id)
  const businessStateCode = settings.business_state_code || null
  const businessGSTIN = settings.business_gstin || "DRAFT"

  // Fetch transactions for the period
  const startDate = new Date(year, month, 1)
  const endDate = new Date(year, month + 1, 0) // last day of month

  const { transactions } = await getTransactions(user.id, {
    dateFrom: startDate.toISOString(),
    dateTo: endDate.toISOString(),
  })

  // Generate report
  const report = generateGSTR1Report(transactions, businessStateCode)

  // Build ZIP with CSVs
  const zip = new JSZip()
  const filingPeriod = `${monthStr.padStart(2, "0")}${year}`

  // B2B CSV
  if (report.b2b.length > 0) {
    const csv = await generateCSV(
      ["GSTIN", "Receiver Name", "Invoice Number", "Invoice Date", "Invoice Value",
       "Place of Supply", "Reverse Charge", "Invoice Type", "Rate", "Taxable Value",
       "CGST", "SGST/UTGST", "IGST", "Cess"],
      report.b2b.flatMap(entry =>
        entry.invoices.map(inv => [
          entry.gstin,
          entry.receiverName,
          inv.invoiceNumber,
          inv.invoiceDate,
          inv.invoiceValue,
          inv.placeOfSupply,
          inv.reverseCharge,
          "Regular",
          inv.rate,
          inv.taxableValue,
          inv.cgst,
          inv.sgst,
          inv.igst,
          inv.cess,
        ])
      )
    )
    zip.file("b2b.csv", csv)
  }

  // B2CL CSV
  if (report.b2cl.length > 0) {
    const csv = await generateCSV(
      ["Invoice Number", "Invoice Date", "Invoice Value", "Place of Supply",
       "Rate", "Taxable Value", "IGST", "Cess"],
      report.b2cl.map(inv => [
        inv.invoiceNumber,
        inv.invoiceDate,
        inv.invoiceValue,
        inv.placeOfSupply,
        inv.rate,
        inv.taxableValue,
        inv.igst,
        inv.cess,
      ])
    )
    zip.file("b2cl.csv", csv)
  }

  // B2CS CSV (aggregated)
  if (report.b2cs.length > 0) {
    const csv = await generateCSV(
      ["Place of Supply", "Supply Type", "Rate", "Taxable Value",
       "CGST", "SGST/UTGST", "IGST", "Cess"],
      report.b2cs.map(entry => [
        entry.placeOfSupply,
        entry.supplyType,
        entry.rate,
        entry.taxableValue,
        entry.cgst,
        entry.sgst,
        entry.igst,
        entry.cess,
      ])
    )
    zip.file("b2cs.csv", csv)
  }

  // HSN CSV
  if (report.hsn.length > 0) {
    const csv = await generateCSV(
      ["HSN/SAC", "Description", "UQC", "Total Quantity", "Total Value",
       "Taxable Value", "IGST", "CGST", "SGST", "Cess"],
      report.hsn.map(entry => [
        entry.hsnCode,
        entry.description,
        "NOS",
        entry.totalQuantity,
        entry.totalValue,
        entry.taxableValue,
        entry.igst,
        entry.cgst,
        entry.sgst,
        entry.cess,
      ])
    )
    zip.file("hsn.csv", csv)
  }

  // Nil/Exempt CSV
  if (report.nil.length > 0) {
    const csv = await generateCSV(
      ["Description", "Nil Rated (Inter-State)", "Nil Rated (Intra-State)",
       "Exempted (Inter-State)", "Exempted (Intra-State)"],
      report.nil.map(entry => [
        entry.description,
        entry.nilRatedInter,
        entry.nilRatedIntra,
        entry.exemptedInter,
        entry.exemptedIntra,
      ])
    )
    zip.file("nil_exempt.csv", csv)
  }

  // Summary CSV
  const summaryRows = (["b2b", "b2cl", "b2cs", "exp", "nil", "exempt"] as const).map(section => {
    const data = report.sectionCounts[section]
    return [section.toUpperCase(), data.count, data.value, data.warnings]
  })
  const summaryCSV = await generateCSV(
    ["Section", "Count", "Total Value", "Warnings"],
    summaryRows
  )
  zip.file("summary.csv", summaryCSV)

  // Generate ZIP
  const zipBuffer = await zip.generateAsync({ type: "nodebuffer" })

  return new NextResponse(zipBuffer, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="GSTR1_${businessGSTIN}_${filingPeriod}.zip"`,
    },
  })
}

// ─── CSV Helper ──────────────────────────────────────────────────────

async function generateCSV(headers: string[], rows: any[][]): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: string[] = []
    const csvStream = format({ headers: false, writeBOM: true })

    csvStream.on("data", (chunk: Buffer) => chunks.push(chunk.toString()))
    csvStream.on("end", () => resolve(chunks.join("")))
    csvStream.on("error", reject)

    // Write header
    csvStream.write(headers)

    // Write data rows
    for (const row of rows) {
      csvStream.write(row)
    }

    csvStream.end()
  })
}
