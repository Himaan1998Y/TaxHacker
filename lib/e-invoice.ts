import QRCode from "qrcode"
import { Transaction } from "@/prisma/client"

/**
 * Generate invoice reference QR code.
 * QR content: Supplier GSTIN | Supplier Name | Invoice No | Invoice Date | Invoice Value | Item Count | HSN | IRN | Payment Details
 * Minimum size: 290x290px.
 */
export async function generateInvoiceReferenceQR(
  transaction: Transaction & { extra?: Record<string, unknown> | null },
  businessGstin: string,
  businessName: string
): Promise<string | null> {
  const extra = (transaction.extra as Record<string, unknown>) ?? {}
  const invoiceNumber = (extra.invoice_number as string) ?? ""
  const hsn = (extra.hsn_sac_code as string) ?? ""
  const irn = (extra.irn as string) ?? ""
  const paymentDetails = `${(extra.payment_details as string) ?? (extra.upi_id as string) ?? ""}`.replace(/\s+/g, " ").trim()

  // Only generate QR if we have GSTIN and basic invoice data
  if (!businessGstin || !invoiceNumber) return null

  const invoiceDate = transaction.issuedAt
    ? new Date(transaction.issuedAt).toLocaleDateString("en-IN", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
      })
    : ""

  // Amount in rupees (stored as integer paise in DB)
  const invoiceValue = transaction.total != null ? (transaction.total / 100).toFixed(2) : "0.00"

  // Invoice reference QR content format (pipe-separated)
  const qrContent = [
    businessGstin,
    businessName,
    invoiceNumber,
    invoiceDate,
    invoiceValue,
    "1", // number of items (simplified)
    hsn,
    irn,
    paymentDetails,
  ].join("|")

  try {
    const dataUrl = await QRCode.toDataURL(qrContent, {
      width: 290,
      margin: 1,
      errorCorrectionLevel: "M",
    })
    return dataUrl
  } catch (err) {
    console.warn("QR generation failed:", err)
    return null
  }
}

export const generateEInvoiceQR = generateInvoiceReferenceQR

/**
 * Check if a transaction has enough data to generate a valid invoice reference QR.
 */
export function canGenerateInvoiceReferenceQR(
  transaction: Transaction & { extra?: Record<string, unknown> | null },
  businessGstin: string
): boolean {
  const extra = (transaction.extra as Record<string, unknown>) ?? {}
  return !!(businessGstin && extra.invoice_number)
}

export const canGenerateEInvoiceQR = canGenerateInvoiceReferenceQR

/**
 * Generate invoice reference QR code from raw invoice fields (for use in the invoice generator).
 * businessGstin and invoiceNumber are required; all other fields are optional.
 */
export async function generateInvoiceReferenceQRFromFields({
  businessGstin,
  businessName,
  invoiceNumber,
  invoiceDate,
  invoiceValue,
  hsn,
  irn,
  paymentDetails,
}: {
  businessGstin: string
  businessName: string
  invoiceNumber: string
  invoiceDate: string
  invoiceValue: string
  hsn: string
  irn: string
  paymentDetails?: string
}): Promise<string | null> {
  if (!businessGstin || !invoiceNumber) return null

  const normalizedPaymentDetails = `${paymentDetails ?? ""}`.replace(/\s+/g, " ").trim()

  const qrContent = [
    businessGstin,
    businessName,
    invoiceNumber,
    invoiceDate,
    invoiceValue,
    "1",
    hsn,
    irn,
    normalizedPaymentDetails,
  ].join("|")

  try {
    const dataUrl = await QRCode.toDataURL(qrContent, {
      width: 290,
      margin: 1,
      errorCorrectionLevel: "M",
    })
    return dataUrl
  } catch (err) {
    console.warn("QR generation failed:", err)
    return null
  }
}

export const generateEInvoiceQRFromFields = generateInvoiceReferenceQRFromFields
