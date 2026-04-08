import { LoginForm } from "@/components/auth/login-form"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardFooter, CardTitle } from "@/components/ui/card"
import { ColoredText } from "@/components/ui/colored-text"
import { razorpayClient, PLANS } from "@/lib/razorpay"
import { createUserDefaults, isDatabaseEmpty } from "@/models/defaults"
import { getOrCreateCloudUser } from "@/models/users"
import { Cake, Ghost } from "lucide-react"
import Link from "next/link"
import { redirect } from "next/navigation"

export default async function CloudPaymentSuccessPage({
  searchParams,
}: {
  searchParams: Promise<{ payment_id?: string; subscription_id?: string }>
}) {
  const { payment_id: paymentId, subscription_id: subscriptionId } = await searchParams

  if (!paymentId || !subscriptionId || !razorpayClient) {
    redirect("/cloud")
  }

  try {
    const subscription = await (razorpayClient.subscriptions as any).fetch(subscriptionId)
    const payment = await razorpayClient.payments.fetch(paymentId)

    if (payment.status !== "captured" && payment.status !== "authorized") {
      throw new Error("Payment not successful")
    }

    const plan = Object.values(PLANS).find((p) => p.razorpayPlanId === subscription.plan_id)
    const email = (payment as any).email || ""

    if (!email) {
      throw new Error("No email found in payment")
    }

    const user = await getOrCreateCloudUser(email, {
      email,
      name: (payment as any).contact || email,
      razorpayCustomerId: subscription.customer_id,
      membershipPlan: plan?.code,
      membershipExpiresAt: subscription.current_end ? new Date(subscription.current_end * 1000) : undefined,
      storageLimit: plan?.limits.storage,
      aiBalance: plan?.limits.ai,
    })

    if (await isDatabaseEmpty(user.id)) {
      await createUserDefaults(user.id)
    }

    return (
      <Card className="w-full max-w-xl mx-auto p-8 flex flex-col items-center justify-center gap-4">
        <Cake className="w-36 h-36" />
        <CardTitle className="text-3xl font-bold">
          <ColoredText>Payment Successful</ColoredText>
        </CardTitle>
        <CardDescription className="text-center text-xl">
          Welcome to TaxHacker, {user.name}. You can login to your account now.
        </CardDescription>
        <CardContent className="w-full">
          <LoginForm defaultEmail={user.email} />
        </CardContent>
      </Card>
    )
  } catch {
    return (
      <Card className="w-full max-w-xl mx-auto p-8 flex flex-col items-center justify-center gap-4">
        <Ghost className="w-36 h-36" />
        <CardTitle className="text-3xl font-bold">Payment Failed</CardTitle>
        <CardDescription className="text-center text-xl">Please try again...</CardDescription>
        <CardFooter>
          <Button asChild>
            <Link href="/cloud">Go Back</Link>
          </Button>
        </CardFooter>
      </Card>
    )
  }
}
