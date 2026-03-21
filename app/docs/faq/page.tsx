export const metadata = {
  title: "FAQ — TaxHacker India",
  description: "Frequently asked questions about TaxHacker India — GST, GSTIN, HSN codes, ITC, self-hosting",
}

const faqs = [
  {
    category: "GST Basics",
    questions: [
      {
        q: "What is GSTIN?",
        a: "GSTIN (Goods and Services Tax Identification Number) is a unique 15-character alphanumeric code assigned to every registered GST taxpayer. Format: 22AAAAA0000A1Z5 — first 2 digits are the state code, next 10 are PAN, followed by entity number, Z, and a check digit.",
      },
      {
        q: "How do I find my HSN/SAC code?",
        a: "HSN (Harmonized System of Nomenclature) codes classify goods, while SAC (Service Accounting Codes) classify services. You can search for your HSN/SAC code on the GST portal (services.gst.gov.in) or use the search tool at cbic-gst.gov.in. Common codes: 9954 (Construction), 9971 (Financial services), 9983 (IT services).",
      },
      {
        q: "What is reverse charge (RCM)?",
        a: "Under Reverse Charge Mechanism (RCM), the recipient of goods/services pays the GST instead of the supplier. This applies to specific categories like legal services, transport by GTA, and purchases from unregistered dealers above ₹5,000/day.",
      },
      {
        q: "What's the difference between GSTR-1 and GSTR-3B?",
        a: "GSTR-1 is a detailed return of all outward supplies (sales) with invoice-level data. GSTR-3B is a summary return covering both outward supplies and input tax credit (ITC) claims, used to calculate and pay the net tax liability.",
      },
    ],
  },
  {
    category: "Using TaxHacker India",
    questions: [
      {
        q: "Which AI models work best for Indian invoices?",
        a: "Google Gemini 2.5 Flash is recommended — it handles Hindi, English, and mixed-language documents well, and the free tier is generous. OpenRouter gives you access to 100+ models including Claude and Llama. For best accuracy on handwritten receipts, use GPT-4o via OpenAI.",
      },
      {
        q: "Can the AI read Hindi documents?",
        a: "Yes. The AI prompt is specifically designed to handle Hindi, English, and mixed-language (code-switched) documents. It understands Devanagari script, lakh/crore notation, and Indian date formats (DD/MM/YYYY).",
      },
      {
        q: "How accurate is the GST extraction?",
        a: "Accuracy depends on document quality and the AI model used. For clear typed invoices, expect 90-95% accuracy on amounts and GSTINs. Always review the extracted data before saving — the AI warns you with a yellow banner to verify. Blurry photos or handwritten documents may have lower accuracy.",
      },
      {
        q: "Can I import existing data from Tally or Excel?",
        a: "Yes. Use the CSV Import feature (Import → CSV) to bulk-upload transactions. The import supports all Indian fields including GSTIN, GST rate, CGST, SGST, IGST, HSN code, TDS details, and more. Download the CSV template for the correct format.",
      },
      {
        q: "Can I export data to Tally?",
        a: "Yes. Go to Export → select Tally XML format. This generates Tally Prime-compatible XML vouchers with proper Sales/Purchase entries and GST ledger splits (CGST, SGST, IGST). Import the XML into Tally via Gateway of Tally → Import Data.",
      },
    ],
  },
  {
    category: "Security & Privacy",
    questions: [
      {
        q: "Is my data secure?",
        a: "TaxHacker India is self-hosted — your data stays on YOUR server. Financial documents are never sent to third parties. The only external calls are to the AI provider (OpenAI/Google/OpenRouter) for document analysis, and those are encrypted in transit.",
      },
      {
        q: "Can I self-host this?",
        a: "Yes, that's the primary mode. TaxHacker India runs as a Docker container on any server with PostgreSQL. You control your data completely. Minimum requirements: 2 CPU cores, 4GB RAM, 20GB disk.",
      },
      {
        q: "Where are my uploaded documents stored?",
        a: "Documents are stored locally on your server's filesystem (in the configured UPLOAD_PATH directory). They are never uploaded to any cloud storage unless you explicitly configure it.",
      },
    ],
  },
  {
    category: "GST Filing",
    questions: [
      {
        q: "Can TaxHacker file my GST return directly?",
        a: "No. TaxHacker generates the GSTR-1 and GSTR-3B data in the correct format (JSON/CSV), but actual filing must be done through the GST portal (gst.gov.in) or by your CA. We generate the data — you or your CA files it.",
      },
      {
        q: "What if the AI classifies a transaction incorrectly?",
        a: "You can always edit the transaction and change the supply type (B2B/B2CS/B2CL), GSTIN, HSN code, or any other field. The GSTR-1 report re-classifies automatically when you change the data.",
      },
      {
        q: "Does it handle credit/debit notes?",
        a: "Currently, credit/debit notes are treated as regular transactions. Mark them with appropriate categories. Full CDNR (Credit/Debit Note Registered) support in GSTR-1 is planned for a future update.",
      },
    ],
  },
]

export default function FAQPage() {
  return (
    <div className="max-w-3xl mx-auto py-12 px-6">
      <h1 className="text-3xl font-bold mb-8">Frequently Asked Questions</h1>

      <div className="space-y-10">
        {faqs.map((section) => (
          <div key={section.category}>
            <h2 className="text-lg font-semibold mb-4 text-primary">{section.category}</h2>
            <div className="space-y-4">
              {section.questions.map((faq, i) => (
                <details key={i} className="group border rounded-lg">
                  <summary className="cursor-pointer p-4 font-medium text-sm hover:bg-muted/50 transition-colors list-none flex items-center justify-between">
                    {faq.q}
                    <span className="text-muted-foreground group-open:rotate-180 transition-transform">▼</span>
                  </summary>
                  <div className="px-4 pb-4 text-sm text-muted-foreground">
                    {faq.a}
                  </div>
                </details>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="mt-12 border-t pt-6 text-sm text-muted-foreground text-center">
        <p>
          Can&apos;t find what you&apos;re looking for?{" "}
          <a href="mailto:support@taxhackerindia.in" className="text-primary underline">
            Contact support
          </a>
        </p>
      </div>
    </div>
  )
}
