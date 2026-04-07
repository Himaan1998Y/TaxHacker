import { SettingsMap } from "@/models/settings"
import { User } from "@/prisma/client"
import { addDays, format } from "date-fns"
import { InvoiceFormData } from "./components/invoice-page"

export interface InvoiceTemplate {
  id?: string
  name: string
  formData: InvoiceFormData
}

export default function defaultTemplates(user: User, settings: SettingsMap): InvoiceTemplate[] {
  const defaultTemplate: InvoiceFormData = {
    title: "INVOICE",
    businessLogo: user.businessLogo,
    invoiceNumber: "",
    date: format(new Date(), "yyyy-MM-dd"),
    dueDate: format(addDays(new Date(), 30), "yyyy-MM-dd"),
    currency: settings.default_currency || "INR",
    companyDetails: `${user.businessName}\n${user.businessAddress || ""}`,
    companyDetailsLabel: "Bill From",
    billTo: "",
    billToLabel: "Bill To",
    items: [{ name: "", subtitle: "", showSubtitle: false, quantity: 1, unitPrice: 0, subtotal: 0 }],
    taxIncluded: true,
    additionalTaxes: [{ name: "GST", rate: 18, amount: 0 }],
    additionalFees: [],
    notes: "",
    bankDetails: settings.business_bank_details || "",
    issueDateLabel: "Issue Date",
    dueDateLabel: "Due Date",
    itemLabel: "Item",
    quantityLabel: "Quantity",
    unitPriceLabel: "Unit Price",
    subtotalLabel: "Subtotal",
    summarySubtotalLabel: "Subtotal:",
    summaryTotalLabel: "Total:",
  }

  const indianGSTTemplate: InvoiceFormData = {
    title: "TAX INVOICE",
    businessLogo: user.businessLogo,
    invoiceNumber: "",
    date: format(new Date(), "yyyy-MM-dd"),
    dueDate: format(addDays(new Date(), 30), "yyyy-MM-dd"),
    currency: "INR",
    companyDetails: `${user.businessName || "Your Business Name"}\nGSTIN: ${settings.business_gstin || "________________"}\nPAN: ${settings.business_pan || "__________"}\n${user.businessAddress || "Your Business Address"}`,
    companyDetailsLabel: "Supplier Details",
    billTo: "",
    billToLabel: "Buyer Details",
    items: [{ name: "", subtitle: "", showSubtitle: false, quantity: 1, unitPrice: 0, subtotal: 0 }],
    taxIncluded: false,
    additionalTaxes: [
      { name: "CGST", rate: 9, amount: 0 },
      { name: "SGST", rate: 9, amount: 0 },
    ],
    additionalFees: [],
    notes: "Terms & Conditions:\n1. Payment due within 30 days\n2. Subject to jurisdiction of local courts",
    bankDetails: settings.business_bank_details || "Bank Name:\nAccount No:\nIFSC Code:\nBranch:",
    issueDateLabel: "Invoice Date",
    dueDateLabel: "Payment Due Date",
    itemLabel: "Description of Goods/Services",
    quantityLabel: "Qty",
    unitPriceLabel: "Rate",
    subtotalLabel: "Amount",
    summarySubtotalLabel: "Taxable Value:",
    summaryTotalLabel: "Total (incl. GST):",
  }

  const indianIGSTTemplate: InvoiceFormData = {
    title: "TAX INVOICE",
    businessLogo: user.businessLogo,
    invoiceNumber: "",
    date: format(new Date(), "yyyy-MM-dd"),
    dueDate: format(addDays(new Date(), 30), "yyyy-MM-dd"),
    currency: "INR",
    companyDetails: `${user.businessName || "Your Business Name"}\nGSTIN: ${settings.business_gstin || "________________"}\nPAN: ${settings.business_pan || "__________"}\n${user.businessAddress || "Your Business Address"}`,
    companyDetailsLabel: "Supplier Details",
    billTo: "",
    billToLabel: "Buyer Details",
    items: [{ name: "", subtitle: "", showSubtitle: false, quantity: 1, unitPrice: 0, subtotal: 0 }],
    taxIncluded: false,
    additionalTaxes: [{ name: "IGST", rate: 18, amount: 0 }],
    additionalFees: [],
    notes: "Terms & Conditions:\n1. Payment due within 30 days\n2. Subject to jurisdiction of local courts\n3. E&OE (Errors and Omissions Excepted)",
    bankDetails: settings.business_bank_details || "Bank Name:\nAccount No:\nIFSC Code:\nBranch:",
    issueDateLabel: "Invoice Date",
    dueDateLabel: "Payment Due Date",
    itemLabel: "Description of Goods/Services",
    quantityLabel: "Qty",
    unitPriceLabel: "Rate",
    subtotalLabel: "Amount",
    summarySubtotalLabel: "Taxable Value:",
    summaryTotalLabel: "Total (incl. IGST):",
  }

  const germanTemplate: InvoiceFormData = {
    title: "RECHNUNG",
    businessLogo: user.businessLogo,
    invoiceNumber: "",
    date: format(new Date(), "yyyy-MM-dd"),
    dueDate: format(addDays(new Date(), 30), "yyyy-MM-dd"),
    currency: "EUR",
    companyDetails: `${user.businessName}\n${user.businessAddress || ""}`,
    companyDetailsLabel: "Rechnungssteller",
    billTo: "",
    billToLabel: "Rechnungsempfänger",
    items: [{ name: "", subtitle: "", showSubtitle: false, quantity: 1, unitPrice: 0, subtotal: 0 }],
    taxIncluded: true,
    additionalTaxes: [{ name: "MwSt", rate: 19, amount: 0 }],
    additionalFees: [],
    notes: "",
    bankDetails: settings.business_bank_details || "",
    issueDateLabel: "Rechnungsdatum",
    dueDateLabel: "Fälligkeitsdatum",
    itemLabel: "Position",
    quantityLabel: "Menge",
    unitPriceLabel: "Einzelpreis",
    subtotalLabel: "Zwischensumme",
    summarySubtotalLabel: "Zwischensumme:",
    summaryTotalLabel: "Gesamtbetrag:",
  }

  return [
    { name: "India (CGST+SGST)", formData: indianGSTTemplate },
    { name: "India (IGST)", formData: indianIGSTTemplate },
    { name: "Default", formData: defaultTemplate },
    { name: "DE", formData: germanTemplate },
  ]
}
