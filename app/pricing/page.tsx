import { PLANS } from "@/lib/razorpay"
import { PricingCard } from "@/components/auth/pricing-card"
import { ColoredText } from "@/components/ui/colored-text"
import { Check } from "lucide-react"

export const metadata = {
  title: "Pricing",
  description: "Transparent pricing for Indian businesses — Free plan available, Pro at ₹499/month",
}

export default function PricingPage() {
  const plans = Object.values(PLANS)

  return (
    <div className="min-h-screen bg-gradient-to-b from-background to-muted/20">
      <div className="max-w-5xl mx-auto px-4 py-20">
        {/* Header */}
        <div className="text-center mb-16">
          <h1 className="text-4xl font-bold mb-4">
            Transparent pricing for <ColoredText>Indian businesses</ColoredText>
          </h1>
          <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
            Start free, upgrade when you need more. No hidden fees. Cancel anytime.
          </p>
        </div>

        {/* Plan Cards */}
        <div className="flex flex-wrap justify-center gap-8 mb-16">
          {plans.map((plan) => (
            <PricingCard key={plan.code} plan={plan} />
          ))}
        </div>

        {/* All plans include */}
        <div className="text-center mb-16">
          <p className="text-sm text-muted-foreground mb-4">All plans include:</p>
          <div className="flex flex-wrap justify-center gap-4 text-sm">
            {["GSTIN validation", "Hindi + English OCR", "Tally export", "GSTR-1 & GSTR-3B", "e-Invoice QR codes", "Data export"].map((feature) => (
              <span key={feature} className="flex items-center gap-1">
                <Check className="h-3 w-3 text-primary" />
                {feature}
              </span>
            ))}
          </div>
        </div>

        {/* FAQ */}
        <div className="max-w-2xl mx-auto space-y-6">
          <h2 className="text-2xl font-bold text-center mb-8">Frequently Asked Questions</h2>
          {[
            {
              q: "Can I self-host for free?",
              a: "Yes. TaxHacker is open-source and fully self-hostable via Docker. The free plan applies to the cloud-hosted version.",
            },
            {
              q: "What payment methods are accepted?",
              a: "UPI, credit/debit cards, net banking, and wallets — all via Razorpay. No international card required.",
            },
            {
              q: "What happens to my data if I downgrade?",
              a: "Your data is never deleted when you downgrade. You'll lose access to Pro features but can export everything.",
            },
            {
              q: "Is there a plan for CA firms managing multiple clients?",
              a: "Not yet. Multi-tenant support for CA firms is on our roadmap. Contact us at support@taxhackerindia.in to get early access.",
            },
          ].map(({ q, a }) => (
            <div key={q} className="border rounded-lg p-6">
              <h3 className="font-semibold mb-2">{q}</h3>
              <p className="text-muted-foreground">{a}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
