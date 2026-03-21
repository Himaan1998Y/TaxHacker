"use client"

import { saveSettingsAction } from "@/app/(app)/settings/actions"
import { FormError } from "@/components/forms/error"
import { FormInput } from "@/components/forms/simple"
import { Button } from "@/components/ui/button"
import { INDIAN_STATES } from "@/lib/indian-states"
import { validateGSTIN, validatePAN } from "@/lib/indian-tax-utils"
import { CircleCheckBig } from "lucide-react"
import { useActionState, useMemo } from "react"

export default function TaxIdentityForm({ settings }: { settings: Record<string, string> }) {
  const [saveState, saveAction, pending] = useActionState(saveSettingsAction, null)

  const gstinValue = settings.business_gstin || ""
  const panValue = settings.business_pan || ""

  const gstinStatus = useMemo(() => {
    if (!gstinValue) return null
    return validateGSTIN(gstinValue)
  }, [gstinValue])

  const panStatus = useMemo(() => {
    if (!panValue) return null
    return validatePAN(panValue)
  }, [panValue])

  return (
    <div>
      <h3 className="text-lg font-semibold mb-1">Tax Identity</h3>
      <p className="text-sm text-muted-foreground mb-4">
        Used for GST invoice generation and auto-detecting inter-state transactions.
      </p>

      <form action={saveAction} className="space-y-4">
        <div>
          <FormInput
            title="Business GSTIN"
            name="business_gstin"
            placeholder="07AADCT1234A1Z0"
            defaultValue={gstinValue}
          />
          {gstinValue && gstinStatus && (
            <p className={`text-xs mt-1 ${gstinStatus.valid ? "text-green-600" : "text-red-500"}`}>
              {gstinStatus.valid ? `Valid — ${gstinStatus.stateName}` : gstinStatus.error}
            </p>
          )}
        </div>

        <FormInput
          title="Business PAN"
          name="business_pan"
          placeholder="ABCDE1234F"
          defaultValue={panValue}
        />

        <div>
          <label className="text-sm font-medium">State / UT</label>
          <select
            name="business_state_code"
            defaultValue={settings.business_state_code || ""}
            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm mt-1"
          >
            <option value="">Select State</option>
            {Object.entries(INDIAN_STATES).map(([code, name]) => (
              <option key={code} value={code}>
                {code} — {name}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-row items-center gap-4">
          <Button type="submit" disabled={pending}>
            {pending ? "Saving..." : "Save Tax Identity"}
          </Button>
          {saveState?.success && (
            <p className="text-green-500 flex flex-row items-center gap-2">
              <CircleCheckBig className="h-4 w-4" />
              Saved!
            </p>
          )}
        </div>

        {saveState?.error && <FormError>{saveState.error}</FormError>}
      </form>
    </div>
  )
}
