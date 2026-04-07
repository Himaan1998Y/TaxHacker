import { getCurrentUser } from "@/lib/auth"
import { generateGSTR1Report } from "@/lib/gstr1"
import { getGSTRPeriodDates, validateGSTRPeriod } from "@/lib/indian-fy"
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

  const filingPeriod = `${monthStr.padStart(2, "0")}${yearStr}`
  const validation = validateGSTRPeriod(filingPeriod)
  if (!validation.valid) {
    return NextResponse.json({ error: validation.error || "Invalid period" }, { status: 400 })
  }

  const user = await getCurrentUser()
  const settings = await getSettings(user.id)
  const businessStateCode = settings.business_state_code || null
  const businessGSTIN = settings.business_gstin || "DRAFT"

  // Fetch transactions for the period
  const { start: startDate, end: endDate } = getGSTRPeriodDates(filingPeriod)

  const { transactions } = await getTransactions(user.id, {
    dateFrom: startDate.toISOString(),
    dateTo: endDate.toISOString(),
  })

  // Generate report
  const report = generateGSTR1Report(transactions, businessStateCode)

  // Build ZIP with CSVs
  const zip = new JSZip()

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
        entry.nilRatedInterB2B + entry.nilRatedInterB2C,
        entry.nilRatedIntraB2B + entry.nilRatedIntraB2C,
        entry.exemptedInterB2B + entry.exemptedInterB2C,
        entry.exemptedIntraB2B + entry.exemptedIntraB2C,
      ])
    )
    zip.file("nil_exempt.csv", csv)
  }

  // CDNR CSV
  if (report.cdnr.length > 0) {
    const csv = await generateCSV(
      ["GSTIN", "Note Number", "Note Date", "Note Type", "Note Value", "Place of Supply", "Reverse Charge", "Rate", "Taxable Value", "IGST", "CGST", "SGST", "Cess"],
      report.cdnr.map(entry => [
        entry.gstin,
        entry.noteNumber,
        entry.noteDate,
        entry.noteType,
        entry.noteValue,
        entry.placeOfSupply,
        entry.reverseCharge,
        entry.rate,
        entry.taxableValue,
        entry.igst,
        entry.cgst,
        entry.sgst,
        entry.cess,
      ])
    )
    zip.file("cdnr.csv", csv)
  }

  // CDNUR CSV
  if (report.cdnur.length > 0) {
    const csv = await generateCSV(
      ["Note Number", "Note Date", "Note Type", "Note Value", "Place of Supply", "Rate", "Taxable Value", "IGST", "Cess"],
      report.cdnur.map(entry => [
        entry.noteNumber,
        entry.noteDate,
        entry.noteType,
        entry.noteValue,
        entry.placeOfSupply,
        entry.rate,
        entry.taxableValue,
        entry.igst,
        entry.cess,
      ])
    )
    zip.file("cdnur.csv", csv)
  }

  // AT CSV
  if (report.at.length > 0) {
    const csv = await generateCSV(
      ["Place of Supply", "Rate", "Gross Advance Received", "IGST", "CGST", "SGST", "Cess"],
      report.at.map(entry => [
        entry.placeOfSupply,
        entry.rate,
        entry.grossAdvanceReceived,
        entry.igst,
        entry.cgst,
        entry.sgst,
        entry.cess,
      ])
    )
    zip.file("at.csv", csv)
  }

  // ATADJ CSV
  if (report.atadj.length > 0) {
    const csv = await generateCSV(
      ["Place of Supply", "Rate", "Gross Advance Received", "IGST", "CGST", "SGST", "Cess"],
      report.atadj.map(entry => [
        entry.placeOfSupply,
        entry.rate,
        entry.grossAdvanceReceived,
        entry.igst,
        entry.cgst,
        entry.sgst,
        entry.cess,
      ])
    )
    zip.file("atadj.csv", csv)
  }

  // Summary CSV
  const summaryRows = (["b2b", "b2cl", "b2cs", "cdnr", "cdnur", "at", "atadj", "exp", "nil", "exempt"] as const).map(section => {
    const data = report.sectionCounts[section]
    return [section.toUpperCase(), data.count, data.value, data.warnings]
  })
  const summaryCSV = await generateCSV(
    ["Section", "Count", "Total Value", "Warnings"],
    summaryRows
  )
  zip.file("summary.csv", summaryCSV)

  if (report.totalWarnings > 0) {
    const warningLines = [
      "Transaction ID,Section,Invoice Number,Warnings",
      ...report.classified
        .filter(tx => tx.warnings.length > 0)
        .map(tx => [
          tx.id,
          tx.section,
          tx.invoiceNumber || "N/A",
          tx.warnings.join("; "),
        ].map(value => String(value).replace(/\r?\n/g, " ")).join(",")),
    ]
    zip.file("warnings_summary.txt", warningLines.join("\r\n"))
  }

  // Generate ZIP
  const zipBuffer = await zip.generateAsync({ type: "uint8array" })

  return new NextResponse(Uint8Array.from(zipBuffer).buffer, {
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
