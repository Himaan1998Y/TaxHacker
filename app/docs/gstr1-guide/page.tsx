export const metadata = {
  title: "GSTR-1 Filing Guide",
  description: "How TaxHacker India generates GSTR-1 reports — classification rules, export formats, and filing steps",
}

export default function GSTR1Guide() {
  return (
    <div className="max-w-3xl mx-auto py-12 px-6">
      <h1 className="text-3xl font-bold mb-8">GSTR-1 Filing Guide</h1>

      <div className="prose prose-sm max-w-none space-y-8">
        <section>
          <h2 className="text-xl font-semibold mb-3">What is GSTR-1?</h2>
          <p className="text-muted-foreground">
            GSTR-1 is a monthly/quarterly return for <strong>outward supplies</strong> (sales).
            It must be filed by all GST-registered businesses by the 11th of the following month
            (or 13th for quarterly filers under QRMP scheme).
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold mb-3">How TaxHacker Classifies Invoices</h2>
          <p className="text-muted-foreground mb-3">
            When you open the GSTR-1 Report, TaxHacker automatically classifies each
            income transaction into the correct section:
          </p>
          <table className="w-full text-sm border">
            <thead>
              <tr className="bg-muted/50">
                <th className="text-left p-2 border-b">Section</th>
                <th className="text-left p-2 border-b">Condition</th>
                <th className="text-left p-2 border-b">Details</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b">
                <td className="p-2 font-medium">B2B</td>
                <td className="p-2">Buyer has GSTIN</td>
                <td className="p-2">Per-invoice details required</td>
              </tr>
              <tr className="border-b">
                <td className="p-2 font-medium">B2CL</td>
                <td className="p-2">No GSTIN + invoice &gt; ₹2.5L + inter-state</td>
                <td className="p-2">Per-invoice, inter-state only</td>
              </tr>
              <tr className="border-b">
                <td className="p-2 font-medium">B2CS</td>
                <td className="p-2">No GSTIN + invoice ≤ ₹2.5L</td>
                <td className="p-2">Aggregated by state + rate</td>
              </tr>
              <tr className="border-b">
                <td className="p-2 font-medium">HSN</td>
                <td className="p-2">All transactions with HSN codes</td>
                <td className="p-2">Summary by HSN code</td>
              </tr>
              <tr className="border-b">
                <td className="p-2 font-medium">Nil/Exempt</td>
                <td className="p-2">GST rate = 0%</td>
                <td className="p-2">Inter vs intra-state totals</td>
              </tr>
              <tr>
                <td className="p-2 font-medium">Export</td>
                <td className="p-2">Supply type = Export</td>
                <td className="p-2">With or without payment</td>
              </tr>
            </tbody>
          </table>
          <p className="text-sm text-muted-foreground mt-3">
            <strong>Note:</strong> Only &quot;income&quot; type transactions appear in GSTR-1.
            Expenses are for GSTR-3B (ITC claims).
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold mb-3">Export Formats</h2>

          <h3 className="font-medium mt-4 mb-2">CA CSV (Recommended)</h3>
          <p className="text-sm text-muted-foreground mb-2">
            Downloads a ZIP file with separate CSV files for each section:
          </p>
          <ul className="list-disc pl-6 space-y-1 text-sm">
            <li><code>b2b.csv</code> — B2B invoices with GSTIN, amounts, GST split</li>
            <li><code>b2cl.csv</code> — B2C Large invoices</li>
            <li><code>b2cs.csv</code> — B2C Small aggregated summary</li>
            <li><code>hsn.csv</code> — HSN-wise summary</li>
            <li><code>nil_exempt.csv</code> — Nil rated and exempt supplies</li>
            <li><code>summary.csv</code> — Section-wise totals and warning counts</li>
          </ul>
          <p className="text-sm text-muted-foreground mt-2">
            Your CA can directly paste these into Tally or the GST portal&apos;s offline tool.
          </p>

          <h3 className="font-medium mt-4 mb-2">GSTR-1 JSON (GST Portal Format)</h3>
          <p className="text-sm text-muted-foreground">
            Downloads a JSON file in the exact format accepted by the GST portal for offline upload.
            This is the most direct way to file — no re-typing needed.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold mb-3">Validation Warnings</h2>
          <p className="text-muted-foreground mb-3">
            TaxHacker checks each transaction and warns about common issues:
          </p>
          <ul className="list-disc pl-6 space-y-2 text-sm">
            <li><strong>Missing GSTIN for B2B</strong> — B2B invoices require the buyer&apos;s GSTIN</li>
            <li><strong>Missing invoice number</strong> — Required for B2B and B2CL sections</li>
            <li><strong>Missing place of supply</strong> — Needed to determine inter/intra-state</li>
            <li><strong>Missing HSN code</strong> — Required for HSN summary table</li>
          </ul>
          <p className="text-sm text-muted-foreground mt-3">
            Fix warnings by editing the transaction and adding the missing data.
          </p>
        </section>

        <div className="border-t pt-6 text-sm text-muted-foreground">
          <p>
            For official GSTR-1 filing guidelines, visit the{" "}
            <a href="https://www.gst.gov.in" target="_blank" rel="noopener noreferrer" className="text-primary underline">
              GST Portal
            </a>.
            Always verify AI-extracted data with your CA before filing.
          </p>
        </div>
      </div>
    </div>
  )
}
