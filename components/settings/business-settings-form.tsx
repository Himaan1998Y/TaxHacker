"use client"

import { saveProfileAction } from "@/app/(app)/settings/actions"
import { FormError } from "@/components/forms/error"
import { FormAvatar, FormInput, FormTextarea } from "@/components/forms/simple"
import { Button } from "@/components/ui/button"
import { User } from "@/prisma/client"
import { CircleCheckBig } from "lucide-react"
import { useActionState } from "react"

export default function BusinessSettingsForm({
  user,
  bankDetails = "",
}: {
  user: User
  // SECURITY: bank details are now passed separately from the encrypted
  // Settings table — do not read `user.businessBankDetails` in templates.
  bankDetails?: string
}) {
  const [saveState, saveAction, pending] = useActionState(saveProfileAction, null)

  return (
    <div>
      <form action={saveAction} className="space-y-4">
        <FormInput
          title="Business Name"
          name="businessName"
          placeholder="Acme Inc."
          defaultValue={user.businessName ?? ""}
        />

        <FormTextarea
          title="Business Address"
          name="businessAddress"
          placeholder="Street, City, State, PIN Code"
          defaultValue={user.businessAddress ?? ""}
        />

        <FormTextarea
          title="Bank Details"
          name="businessBankDetails"
          placeholder="Bank Name, Account No., IFSC Code, Branch"
          defaultValue={bankDetails}
        />

        <FormAvatar
          title="Business Logo"
          name="businessLogo"
          className="w-52 h-52"
          defaultValue={user.businessLogo ?? ""}
        />

        <div className="flex flex-row items-center gap-4">
          <Button type="submit" disabled={pending}>
            {pending ? "Saving..." : "Save"}
          </Button>
          {saveState?.success && (
            <p className="text-green-500 flex flex-row items-center gap-2">
              <CircleCheckBig />
              Saved!
            </p>
          )}
        </div>

        {saveState?.error && <FormError>{saveState.error}</FormError>}
      </form>
    </div>
  )
}
