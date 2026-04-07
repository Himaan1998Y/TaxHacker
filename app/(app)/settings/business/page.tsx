import BusinessSettingsForm from "@/components/settings/business-settings-form"
import TaxIdentityForm from "@/components/settings/tax-identity-form"
import { Separator } from "@/components/ui/separator"
import { getCurrentUser } from "@/lib/auth"
import { getSettings } from "@/models/settings"

export default async function BusinessSettingsPage() {
  const user = await getCurrentUser()
  const settings = await getSettings(user.id)

  // SECURITY: Prefer encrypted `business_bank_details` from the Settings
  // table over the legacy plaintext `User.businessBankDetails` column.
  // getSettings() transparently decrypts sensitive entries.
  const bankDetails = settings["business_bank_details"] || user.businessBankDetails || ""

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
