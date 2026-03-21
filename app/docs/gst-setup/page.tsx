import Link from "next/link"

export const metadata = {
  title: "GST Setup Guide",
  description: "Set up TaxHacker India for GST compliance — GSTIN, state code, API key configuration",
}

export default function GSTSetupGuide() {
  return (
    <div className="max-w-3xl mx-auto py-12 px-6">
      <h1 className="text-3xl font-bold mb-8">GST Setup Guide</h1>

      <div className="prose prose-sm max-w-none space-y-8">
        <section>
          <h2 className="text-xl font-semibold mb-3">Step 1: Configure Your Business Identity</h2>
          <p className="text-muted-foreground mb-3">
            Go to <strong>Settings → Business</strong> and fill in your Tax Identity:
          </p>
          <ul className="list-disc pl-6 space-y-2 text-sm">
            <li><strong>GSTIN</strong> — Your 15-character GST Identification Number (e.g., 06AADCT1234A1Z0)</li>
            <li><strong>PAN</strong> — Your 10-character PAN (e.g., AADCT1234A)</li>
            <li><strong>State Code</strong> — Select your state (used for inter-state vs intra-state detection)</li>
          </ul>
          <p className="text-sm text-muted-foreground mt-3">
            The GSTIN is validated automatically — you&apos;ll see a green checkmark when it&apos;s correct,
            along with the detected state name.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold mb-3">Step 2: Set Up AI Provider</h2>
          <p className="text-muted-foreground mb-3">
            Go to <strong>Settings → LLM</strong> and add at least one API key:
          </p>
          <ul className="list-disc pl-6 space-y-2 text-sm">
            <li><strong>Google Gemini</strong> (recommended) — Free tier available, excellent for Indian documents</li>
            <li><strong>OpenRouter</strong> — Access 100+ models including Claude, Llama, DeepSeek</li>
            <li><strong>OpenAI</strong> — GPT-4o-mini for budget, GPT-4o for accuracy</li>
          </ul>
          <p className="text-sm text-muted-foreground mt-3">
            The AI processes uploaded invoices and extracts GSTIN, HSN codes, GST amounts,
            TDS details, and more. It works with Hindi, English, and mixed-language documents.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold mb-3">Step 3: Upload Your First Invoice</h2>
          <ol className="list-decimal pl-6 space-y-2 text-sm">
            <li>Click <strong>Upload</strong> in the sidebar (or drag &amp; drop)</li>
            <li>Upload a photo or PDF of an Indian GST invoice</li>
            <li>The document appears in <strong>Unsorted</strong> — click it to analyze</li>
            <li>Click <strong>Analyze with AI</strong> — the AI extracts all fields</li>
            <li>Review the extracted data — GSTIN, HSN, GST breakdown, TDS</li>
            <li>Fix any errors and click <strong>Save</strong></li>
          </ol>
        </section>

        <section>
          <h2 className="text-xl font-semibold mb-3">Step 4: Generate GST Reports</h2>
          <p className="text-muted-foreground mb-3">
            Once you have transactions, use the GST report tools:
          </p>
          <ul className="list-disc pl-6 space-y-2 text-sm">
            <li>
              <strong><Link href="/apps/gstr1" className="text-primary underline">GSTR-1 Report</Link></strong>
              — Outward supply report. Classifies invoices as B2B, B2CL, B2CS, HSN summary. Export as CA CSV or GST portal JSON.
            </li>
            <li>
              <strong><Link href="/apps/gstr3b" className="text-primary underline">GSTR-3B Summary</Link></strong>
              — Monthly summary with ITC reconciliation. Shows tax payable after ITC adjustment.
            </li>
          </ul>
        </section>

        <section>
          <h2 className="text-xl font-semibold mb-3">Tips for Better Extraction</h2>
          <ul className="list-disc pl-6 space-y-2 text-sm">
            <li>Upload clear, high-resolution images (avoid blurry photos)</li>
            <li>PDFs work better than photos for typed invoices</li>
            <li>The AI handles multiple pages — upload the full invoice</li>
            <li>Always review extracted GSTIN and HSN codes before saving</li>
            <li>Mark transactions as &quot;income&quot; for sales and &quot;expense&quot; for purchases</li>
          </ul>
        </section>

        <div className="border-t pt-6 text-sm text-muted-foreground">
          <p>
            <strong>Important:</strong> AI-extracted data should always be verified before using for GST filing.
            TaxHacker India is a tool to assist your accounting — consult your CA for compliance decisions.
          </p>
        </div>
      </div>
    </div>
  )
}
