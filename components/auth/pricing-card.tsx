"use client"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Plan } from "@/lib/razorpay"
import { Check, Loader2 } from "lucide-react"
import Script from "next/script"
import { useState } from "react"
import { FormError } from "../forms/error"

export function PricingCard({ plan, hideButton = false }: { plan: Plan; hideButton?: boolean }) {
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleClick = async () => {
    setIsLoading(true)
    setError(null)
    try {
      if (plan.code === "free") {
        window.location.href = "/register"
        return
      }

      const response = await fetch(`/api/razorpay/checkout?code=${plan.code}`, { method: "POST" })
      const data = await response.json()

      if (data.comingSoon) {
        setError("Payments coming soon. Contact support@taxhackerindia.in to upgrade.")
        return
      }

      if (data.error) {
        setError(data.error)
        return
      }

      if (data.free) {
        window.location.href = "/register"
        return
      }

      // Open Razorpay modal
      const RazorpayConstructor = (window as any).Razorpay
      if (!RazorpayConstructor) {
        setError("Payment gateway failed to load. Please refresh and try again.")
        return
      }

      const rzp = new RazorpayConstructor({
        key: data.keyId,
        subscription_id: data.subscriptionId,
        name: "TaxHacker India",
        description: plan.name + " Plan",
        theme: { color: "#6366f1" },
        handler: (response: { razorpay_payment_id: string; razorpay_subscription_id: string }) => {
          window.location.href = `/cloud/payment/success?payment_id=${response.razorpay_payment_id}&subscription_id=${response.razorpay_subscription_id}`
        },
      })
      rzp.open()
    } catch {
      setError("An unexpected error occurred. Please try again.")
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <>
      <Script src="https://checkout.razorpay.com/v1/checkout.js" strategy="lazyOnload" />
      <Card className="w-full max-w-xs relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-primary/10 to-secondary/10" />
        <CardHeader className="relative">
          <CardTitle className="text-3xl">{plan.name}</CardTitle>
          <CardDescription>{plan.description}</CardDescription>
          {plan.price && <div className="text-2xl font-bold mt-4">{plan.price}</div>}
        </CardHeader>
        <CardContent className="relative">
          <ul className="space-y-2">
            {plan.benefits.map((benefit, index) => (
              <li key={index} className="flex items-center gap-2">
                <Check className="h-4 w-4 text-primary" />
                <span>{benefit}</span>
              </li>
            ))}
          </ul>
        </CardContent>
        <CardFooter className="flex flex-col gap-2 relative">
          {!hideButton && (
            <Button className="w-full" onClick={handleClick} disabled={isLoading}>
              {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Get Started"}
            </Button>
          )}
          {error && <FormError>{error}</FormError>}
        </CardFooter>
      </Card>
    </>
  )
}
