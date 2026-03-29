import config from "@/lib/config"

export default async function PrivacyPolicy() {
  return (
    <div className="prose prose-slate max-w-none">
      <h2 className="text-3xl font-bold mb-6 text-slate-900 border-b pb-2">
        <strong>Privacy Policy</strong>
      </h2>

      <p className="bg-slate-50 p-4 rounded-lg border border-slate-200 mb-6">
        <strong className="text-slate-700">Effective Date</strong>: March 29, 2026
        <br />
        <strong className="text-slate-700">Applicable Laws</strong>: Digital Personal Data Protection Act 2023 (India), IT Act 2000 Section 43A, Companies Act 2013
        <br />
        <strong className="text-slate-700">Contact</strong>:{" "}
        <a href={`mailto:${config.app.supportEmail}`} className="text-blue-600 hover:text-blue-800">
          {config.app.supportEmail}
        </a>
      </p>

      <p className="text-slate-700 mb-6 leading-relaxed">
        TaxHacker India (&quot;we&quot;, &quot;our&quot;, &quot;us&quot;) is committed to protecting your personal data in compliance with Indian data protection laws. This Privacy Policy describes how we collect, use, store, and protect your data.
      </p>

      <p className="text-slate-700 mb-6 leading-relaxed bg-blue-50 p-3 border-l-4 border-blue-400">
        <strong className="text-slate-800">Self-Hosted Users:</strong> When you self-host TaxHacker, your data stays entirely on YOUR server. We have no access to it. This policy primarily applies to our cloud service. For self-hosted instances, YOU are the data controller and responsible for compliance.
      </p>

      <hr className="my-8 border-slate-200" />

      <h3 className="text-2xl font-semibold text-slate-800 mb-4">1. <strong>What Data We Collect</strong></h3>
      <ul className="list-disc pl-6 mb-6 space-y-2 text-slate-700">
        <li><strong className="text-slate-800">Account Data</strong>: Email address, display name, optional avatar.</li>
        <li><strong className="text-slate-800">Business Data</strong>: Business name, address, GSTIN, PAN (as provided by you for tax compliance).</li>
        <li><strong className="text-slate-800">Financial Records</strong>: Transaction data, invoices, receipts, and uploaded documents containing financial information.</li>
        <li><strong className="text-slate-800">Session Data</strong>: IP address, browser type, timestamps for security and audit trail (retained for 8 years per Companies Act 2013).</li>
        <li><strong className="text-slate-800">AI Processing Metadata</strong>: Token usage counts (not the content analyzed).</li>
      </ul>

      <p className="text-slate-700 mb-6 leading-relaxed">
        Under the IT Act 2000 (Section 43A), financial data including GSTIN, PAN, bank details, and transaction records are classified as <strong>sensitive personal data</strong>. We implement reasonable security practices to protect this data.
      </p>

      <hr className="my-8 border-slate-200" />

      <h3 className="text-2xl font-semibold text-slate-800 mb-4">2. <strong>How We Use Your Data</strong></h3>
      <ul className="list-disc pl-6 mb-6 space-y-2 text-slate-700">
        <li>Provide accounting and tax compliance services (GSTR-1, GSTR-3B generation)</li>
        <li>AI-powered document analysis (invoice scanning, data extraction)</li>
        <li>Generate reports for CA/auditor use</li>
        <li>Maintain immutable audit trails (legally required)</li>
        <li>Communicate service updates</li>
      </ul>

      <hr className="my-8 border-slate-200" />

      <h3 className="text-2xl font-semibold text-slate-800 mb-4">3. <strong>AI Processing &amp; Third-Party Services</strong></h3>
      <p className="text-slate-700 mb-3">When you use AI analysis, document images are sent to your configured LLM provider:</p>
      <ul className="list-disc pl-6 mb-4 space-y-2 text-slate-700">
        <li><strong>Google Gemini</strong> — processed per Google&apos;s data usage policies</li>
        <li><strong>OpenAI</strong> — processed per OpenAI&apos;s API data usage policy (not used for training)</li>
        <li><strong>Mistral AI</strong> — processed per Mistral&apos;s terms</li>
        <li><strong>OpenRouter</strong> — routed to selected model provider</li>
      </ul>
      <p className="text-slate-700 mb-6 leading-relaxed bg-yellow-50 p-3 border-l-4 border-yellow-400">
        <strong>Important:</strong> Document images containing financial data are transmitted to these external AI services for processing. The AI provider processes the data to extract information and does not retain it beyond the API request. By using AI analysis, you consent to this data transfer.
      </p>

      <hr className="my-8 border-slate-200" />

      <h3 className="text-2xl font-semibold text-slate-800 mb-4">4. <strong>Data Storage &amp; Security</strong></h3>
      <ul className="list-disc pl-6 mb-4 space-y-2 text-slate-700">
        <li>Data is stored in PostgreSQL with AES-256 encryption for sensitive fields (API keys, business details)</li>
        <li>All connections use TLS 1.2+ encryption in transit</li>
        <li>Authentication uses SHA-256 hashed tokens (never plaintext passwords in cookies)</li>
        <li>Application runs as non-root user in Docker containers</li>
        <li>Rate limiting protects against brute-force attacks</li>
      </ul>

      <hr className="my-8 border-slate-200" />

      <h3 className="text-2xl font-semibold text-slate-800 mb-4">5. <strong>Audit Trail</strong></h3>
      <p className="text-slate-700 mb-6 leading-relaxed">
        Per the Companies Act 2013 (as amended), we maintain an <strong>immutable audit trail</strong> of all financial record changes. This includes: what was changed, when, by whom, and the before/after values. Audit records are retained for a minimum of <strong>8 years</strong> and cannot be modified or deleted.
      </p>

      <hr className="my-8 border-slate-200" />

      <h3 className="text-2xl font-semibold text-slate-800 mb-4">6. <strong>Data Retention</strong></h3>
      <ul className="list-disc pl-6 mb-4 space-y-2 text-slate-700">
        <li><strong>Financial records &amp; audit logs</strong>: 8 years minimum (Companies Act requirement)</li>
        <li><strong>Uploaded documents</strong>: Retained with associated transactions for 8 years</li>
        <li><strong>Account data</strong>: Until account deletion (financial records retained per above)</li>
        <li><strong>Security logs</strong>: 180 days minimum (CERT-In requirement)</li>
      </ul>

      <hr className="my-8 border-slate-200" />

      <h3 className="text-2xl font-semibold text-slate-800 mb-4">7. <strong>Your Rights (DPDP Act 2023)</strong></h3>
      <p className="text-slate-700 mb-3">As a Data Principal under the DPDP Act, you have the right to:</p>
      <ul className="list-disc pl-6 mb-4 space-y-2 text-slate-700">
        <li>Access your personal data and obtain a summary</li>
        <li>Correct inaccurate or incomplete data</li>
        <li>Erase personal data (subject to legal retention requirements)</li>
        <li>Download a complete backup of your data (Settings → Backups)</li>
        <li>Withdraw consent for AI processing at any time</li>
        <li>Nominate another person to exercise your rights</li>
        <li>File a grievance with us or the Data Protection Board of India</li>
      </ul>
      <p className="text-slate-700 mb-6">
        Contact{" "}
        <a href={`mailto:${config.app.supportEmail}`} className="text-blue-600 hover:text-blue-800">{config.app.supportEmail}</a>
        {" "}to exercise your rights. We will respond within 30 days.
      </p>

      <hr className="my-8 border-slate-200" />

      <h3 className="text-2xl font-semibold text-slate-800 mb-4">8. <strong>Cookies</strong></h3>
      <p className="text-slate-700 mb-6 leading-relaxed">
        TaxHacker uses <strong>only essential cookies</strong> for authentication (session management). We do not use tracking cookies, analytics cookies, or third-party advertising. No data is shared with advertisers.
      </p>

      <hr className="my-8 border-slate-200" />

      <h3 className="text-2xl font-semibold text-slate-800 mb-4">9. <strong>Data Breach Notification</strong></h3>
      <p className="text-slate-700 mb-6 leading-relaxed">
        In the event of a data breach, we will: (1) report to CERT-In within 6 hours as required by law, (2) notify affected users within 72 hours, and (3) take immediate containment and remediation actions per our Incident Response Plan.
      </p>

      <hr className="my-8 border-slate-200" />

      <h3 className="text-2xl font-semibold text-slate-800 mb-4">10. <strong>Children</strong></h3>
      <p className="text-slate-700 mb-6 leading-relaxed">
        TaxHacker is not intended for users under 18. We do not knowingly collect data from minors. Per the DPDP Act, processing children&apos;s data requires verifiable parental consent, which we do not implement.
      </p>

      <hr className="my-8 border-slate-200" />

      <h3 className="text-2xl font-semibold text-slate-800 mb-4">11. <strong>Changes to This Policy</strong></h3>
      <p className="text-slate-700 mb-6 leading-relaxed">
        We may update this policy to reflect legal changes or product updates. Changes are published on this page with an updated effective date. Continued use after changes constitutes acceptance.
      </p>
    </div>
  )
}
