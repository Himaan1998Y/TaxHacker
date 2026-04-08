import { PricingCard } from "@/components/auth/pricing-card"
import { ColoredText } from "@/components/ui/colored-text"
import { PLANS } from "@/lib/razorpay"

export default function CloudPage() {
  const plans = Object.values(PLANS)

  return (
    <div className="flex flex-col items-center justify-center min-h-screen gap-8 p-8">
      <div className="text-center">
        <h1 className="text-4xl font-bold mb-4">
          <ColoredText>TaxHacker Cloud</ColoredText>
        </h1>
        <p className="text-muted-foreground text-lg">
          Choose a plan to get started. Free plan available — no credit card required.
        </p>
      </div>
      <div className="flex flex-wrap justify-center gap-6">
        {plans.map((plan) => (
          <PricingCard key={plan.code} plan={plan} />
        ))}
      </div>
    </div>
  )
}
