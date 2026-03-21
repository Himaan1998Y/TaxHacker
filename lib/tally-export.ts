// Tally Prime XML Voucher Export
// Generates importable XML for Tally Prime / Tally ERP 9
// Reference: Tally XML import format

import { formatDate } from "date-fns"
import { transactionToGSTR1 } from "./gstr1"

// ─── Types ───────────────────────────────────────────────────────────

type TallyVoucher = {
  voucherType: "Sales" | "Purchase" | "Journal" | "Payment" | "Receipt"
  date: string          // YYYYMMDD
  voucherNumber: string
  partyName: string
  narration: string
  ledgerEntries: TallyLedgerEntry[]
}

type TallyLedgerEntry = {
  ledgerName: string
  amount: number       // Negative = credit (income), Positive = debit (expense)
  isDeemedPositive: boolean
}

// ─── GST Ledger Name Mapping ─────────────────────────────────────────

function getGSTLedgerName(type: "cgst" | "sgst" | "igst" | "cess", rate: number): string {
  const halfRate = rate / 2
  switch (type) {
    case "cgst": return `CGST @ ${halfRate}%`
    case "sgst": return `SGST @ ${halfRate}%`
    case "igst": return `IGST @ ${rate}%`
    case "cess": return `GST Cess`
  }
}

function getSalesLedgerName(rate: number): string {
  return rate > 0 ? `Sales @ ${rate}%` : "Sales - Exempt"
}

function getPurchaseLedgerName(rate: number): string {
  return rate > 0 ? `Purchase @ ${rate}%` : "Purchase - Exempt"
}

// ─── Convert Transaction to Tally Voucher ────────────────────────────

function transactionToVoucher(tx: any): TallyVoucher {
  const gstTx = transactionToGSTR1(tx)
  const isIncome = tx.type === "income"
  const voucherType = isIncome ? "Sales" : "Purchase"

  const date = gstTx.issuedAt
    ? formatDate(gstTx.issuedAt, "yyyyMMdd")
    : formatDate(new Date(), "yyyyMMdd")

  const partyName = gstTx.merchant || gstTx.name || "Cash"
  const voucherNumber = gstTx.invoiceNumber || `TH-${tx.id.substring(0, 8)}`

  // Calculate taxable value (total minus all taxes)
  const totalTax = gstTx.cgst + gstTx.sgst + gstTx.igst + gstTx.cess
  const taxableValue = gstTx.total - totalTax
  const effectiveTaxable = taxableValue > 0 ? taxableValue : gstTx.total

  const entries: TallyLedgerEntry[] = []

  if (isIncome) {
    // Sales voucher: Party debited, Sales + GST credited
    // Party (Debit)
    entries.push({
      ledgerName: partyName,
      amount: -gstTx.total, // Negative = debit in Tally for sales
      isDeemedPositive: true,
    })

    // Sales ledger (Credit)
    entries.push({
      ledgerName: getSalesLedgerName(gstTx.gstRate),
      amount: effectiveTaxable,
      isDeemedPositive: false,
    })

    // GST entries (Credit)
    if (gstTx.cgst > 0) {
      entries.push({
        ledgerName: getGSTLedgerName("cgst", gstTx.gstRate),
        amount: gstTx.cgst,
        isDeemedPositive: false,
      })
    }
    if (gstTx.sgst > 0) {
      entries.push({
        ledgerName: getGSTLedgerName("sgst", gstTx.gstRate),
        amount: gstTx.sgst,
        isDeemedPositive: false,
      })
    }
    if (gstTx.igst > 0) {
      entries.push({
        ledgerName: getGSTLedgerName("igst", gstTx.gstRate),
        amount: gstTx.igst,
        isDeemedPositive: false,
      })
    }
    if (gstTx.cess > 0) {
      entries.push({
        ledgerName: getGSTLedgerName("cess", gstTx.gstRate),
        amount: gstTx.cess,
        isDeemedPositive: false,
      })
    }
  } else {
    // Purchase voucher: Purchase + GST debited, Party credited
    // Purchase ledger (Debit)
    entries.push({
      ledgerName: getPurchaseLedgerName(gstTx.gstRate),
      amount: effectiveTaxable,
      isDeemedPositive: true,
    })

    // GST entries (Debit — input credit)
    if (gstTx.cgst > 0) {
      entries.push({
        ledgerName: `Input ${getGSTLedgerName("cgst", gstTx.gstRate)}`,
        amount: gstTx.cgst,
        isDeemedPositive: true,
      })
    }
    if (gstTx.sgst > 0) {
      entries.push({
        ledgerName: `Input ${getGSTLedgerName("sgst", gstTx.gstRate)}`,
        amount: gstTx.sgst,
        isDeemedPositive: true,
      })
    }
    if (gstTx.igst > 0) {
      entries.push({
        ledgerName: `Input ${getGSTLedgerName("igst", gstTx.gstRate)}`,
        amount: gstTx.igst,
        isDeemedPositive: true,
      })
    }
    if (gstTx.cess > 0) {
      entries.push({
        ledgerName: `Input ${getGSTLedgerName("cess", gstTx.gstRate)}`,
        amount: gstTx.cess,
        isDeemedPositive: true,
      })
    }

    // Party (Credit)
    entries.push({
      ledgerName: partyName,
      amount: -gstTx.total,
      isDeemedPositive: false,
    })
  }

  const narration = [
    gstTx.invoiceNumber ? `Inv: ${gstTx.invoiceNumber}` : "",
    gstTx.gstin ? `GSTIN: ${gstTx.gstin}` : "",
    gstTx.hsnCode ? `HSN: ${gstTx.hsnCode}` : "",
    tx.description || "",
  ].filter(Boolean).join(" | ")

  return {
    voucherType,
    date,
    voucherNumber,
    partyName,
    narration,
    ledgerEntries: entries,
  }
}

// ─── Generate Tally XML ──────────────────────────────────────────────

export function generateTallyXML(dbTransactions: any[]): string {
  const vouchers = dbTransactions.map(transactionToVoucher)

  const voucherXML = vouchers.map(v => {
    const entries = v.ledgerEntries.map(e => `
          <ALLLEDGERENTRIES.LIST>
            <LEDGERNAME>${escapeXML(e.ledgerName)}</LEDGERNAME>
            <ISDEEMEDPOSITIVE>${e.isDeemedPositive ? "Yes" : "No"}</ISDEEMEDPOSITIVE>
            <AMOUNT>${e.amount.toFixed(2)}</AMOUNT>
          </ALLLEDGERENTRIES.LIST>`).join("")

    return `
        <TALLYMESSAGE xmlns:UDF="TallyUDF">
          <VOUCHER VCHTYPE="${v.voucherType}" ACTION="Create" OBJVIEW="Accounting Voucher View">
            <DATE>${v.date}</DATE>
            <VOUCHERTYPENAME>${v.voucherType}</VOUCHERTYPENAME>
            <VOUCHERNUMBER>${escapeXML(v.voucherNumber)}</VOUCHERNUMBER>
            <PARTYLEDGERNAME>${escapeXML(v.partyName)}</PARTYLEDGERNAME>
            <NARRATION>${escapeXML(v.narration)}</NARRATION>
            <EFFECTIVEDATE>${v.date}</EFFECTIVEDATE>${entries}
          </VOUCHER>
        </TALLYMESSAGE>`
  }).join("\n")

  return `<?xml version="1.0" encoding="UTF-8"?>
<ENVELOPE>
  <HEADER>
    <TALLYREQUEST>Import Data</TALLYREQUEST>
  </HEADER>
  <BODY>
    <IMPORTDATA>
      <REQUESTDESC>
        <REPORTNAME>Vouchers</REPORTNAME>
        <STATICVARIABLES>
          <SVCURRENTCOMPANY>##SVCURRENTCOMPANY##</SVCURRENTCOMPANY>
        </STATICVARIABLES>
      </REQUESTDESC>
      <REQUESTDATA>${voucherXML}
      </REQUESTDATA>
    </IMPORTDATA>
  </BODY>
</ENVELOPE>`
}

function escapeXML(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;")
}
