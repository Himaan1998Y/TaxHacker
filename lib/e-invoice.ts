import QRCode from "qrcode"
import { Transaction } from "@/prisma/client"

/**
 * Generate e-Invoice QR code per GST IRP specification.
 * QR content: Supplier GSTIN | Supplier Name | Invoice No | Invoice Date | Invoice Value | Item Count | HSN | IRN
 * Minimum size: 290x290px per IRP spec.
 */
export async function generateEInvoiceQR(
  transaction: Transaction & { extra?: Record<string, unknown> | null },
  businessGstin: string,
  businessName: string
): Promise<string | null> {
  const extra = (transaction.extra as Record<string, unknown>) ?? {}
  const invoiceNumber = (extra.invoice_number as string) ?? ""
  const hsn = (extra.hsn_sac_code as string) ?? ""
  const irn = (extra.irn as string) ?? ""

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

  // IRP QR content format (pipe-separated)
  const qrContent = [
    businessGstin,
    businessName,
    invoiceNumber,
    invoiceDate,
    invoiceValue,
    "1", // number of items (simplified)
    hsn,
    irn,
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

/**
 * Check if a transaction has enough data to generate a valid e-Invoice QR.
 */
export function canGenerateEInvoiceQR(
  transaction: Transaction & { extra?: Record<string, unknown> | null },
  businessGstin: string
): boolean {
  const extra = (transaction.extra as Record<string, unknown>) ?? {}
  return !!(businessGstin && extra.invoice_number)
}

/**
 * Generate e-Invoice QR code from raw invoice fields (for use in the invoice generator).
 * businessGstin and invoiceNumber are required; all other fields are optional.
 */
export async function generateEInvoiceQRFromFields({
  businessGstin,
  businessName,
  invoiceNumber,
  invoiceDate,
  invoiceValue,
  hsn,
  irn,
}: {
  businessGstin: string
  businessName: string
  invoiceNumber: string
  invoiceDate: string
  invoiceValue: string
  hsn: string
  irn: string
}): Promise<string | null> {
  if (!businessGstin || !invoiceNumber) return null

  const qrContent = [businessGstin, businessName, invoiceNumber, invoiceDate, invoiceValue, "1", hsn, irn].join("|")

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
