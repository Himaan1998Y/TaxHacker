import BusinessSettingsForm from "@/components/settings/business-settings-form"
import TaxIdentityForm from "@/components/settings/tax-identity-form"
import { Separator } from "@/components/ui/separator"
import { getCurrentUser } from "@/lib/auth"
import { getSettings } from "@/models/settings"

export default async function BusinessSettingsPage() {
  const user = await getCurrentUser()
  const settings = await getSettings(user.id)

  const bankDetails = settings["business_bank_details"] || ""

  return (
    <>
      <div className="w-full max-w-2xl space-y-8">
        <BusinessSettingsForm user={user} bankDetails={bankDetails} />

        <Separator />

        <TaxIdentityForm settings={settings} />
      </div>
    </>
  )
}
