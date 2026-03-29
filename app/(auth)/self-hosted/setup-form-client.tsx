"use client"
import { useState, useRef, useEffect, useCallback } from "react"
import { FormSelectCurrency } from "@/components/forms/select-currency"
import { FormInput } from "@/components/forms/simple"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { DEFAULT_CURRENCIES, DEFAULT_SETTINGS } from "@/models/defaults"
import { selfHostedGetStartedAction } from "../actions"
import { FormSelect } from "@/components/forms/simple"
import { PROVIDERS } from "@/lib/llm-providers"

type Props = {
  defaultProvider: string
  defaultApiKeys: Record<string, string>
}

export default function SelfHostedSetupFormClient({ defaultProvider, defaultApiKeys }: Props) {
  const [provider, setProvider] = useState(defaultProvider)
  const selected = PROVIDERS.find(p => p.key === provider)!
  const getDefaultApiKey = useCallback((providerKey: string) => defaultApiKeys[providerKey] ?? "", [defaultApiKeys])

  const [apiKey, setApiKey] = useState(getDefaultApiKey(provider))
  const [consent, setConsent] = useState(false)
  const userTyped = useRef(false)

  useEffect(() => {
    if (!userTyped.current) {
      setApiKey(getDefaultApiKey(provider))
    }
    userTyped.current = false
  }, [provider, getDefaultApiKey])

  return (
    <form action={selfHostedGetStartedAction} className="flex flex-col gap-8 pt-8">
      <div className="flex flex-row gap-4 items-center justify-center">
        <FormSelect
          title="LLM provider"
          name="provider"
          value={provider}
          onValueChange={setProvider}
          items={PROVIDERS.map(p => ({
            code: p.key,
            name: p.label,
            logo: p.logo
          }))}
        />
        <FormSelectCurrency
          title="Default Currency"
          name="default_currency"
          defaultValue={DEFAULT_SETTINGS.find((s) => s.code === "default_currency")?.value ?? "EUR"}
          currencies={DEFAULT_CURRENCIES}
        />
      </div>
      <div>
        <FormInput
          title={`${selected.label} API Key`}
          name={selected.apiKeyName}
          value={apiKey ?? ""}
          onChange={e => {
            setApiKey(e.target.value)
            userTyped.current = true
          }}
          placeholder={selected.placeholder}
        />
        <small className="text-xs text-muted-foreground flex justify-center mt-2">
          Get key from
          {"\u00A0"}
          <a href={selected.help.url} target="_blank" className="underline">
            {selected.help.label}
          </a>
        </small>
      </div>
      <div className="flex items-start gap-3 text-left">
        <Checkbox
          id="consent"
          checked={consent}
          onCheckedChange={(checked) => setConsent(checked === true)}
        />
        <label htmlFor="consent" className="text-sm text-muted-foreground leading-relaxed cursor-pointer">
          I understand that AI analysis sends document images to the selected LLM provider for processing.
          I consent to this data processing per the{" "}
          <a href="/docs/privacy_policy" target="_blank" className="underline text-blue-600">Privacy Policy</a>.
          Financial records are retained for 8 years per Indian law.
        </label>
      </div>
      <input type="hidden" name="consent_given" value={consent ? "true" : ""} />
      <Button type="submit" className="w-auto p-6" disabled={!consent}>
        Get Started
      </Button>
    </form>
  )
}