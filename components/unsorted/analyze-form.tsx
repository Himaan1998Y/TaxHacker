"use client"

import { useNotification } from "@/app/(app)/context"
import { analyzeFileAction, deleteUnsortedFileAction, saveFileAsTransactionAction } from "@/app/(app)/unsorted/actions"
import { CurrencyConverterTool } from "@/components/agents/currency-converter"
import { GSTCalculatorTool } from "@/components/agents/gst-calculator"
import { ItemsDetectTool } from "@/components/agents/items-detect"
import ToolWindow from "@/components/agents/tool-window"
import { FormError } from "@/components/forms/error"
import { FormSelectCategory } from "@/components/forms/select-category"
import { FormSelectCurrency } from "@/components/forms/select-currency"
import { FormSelectProject } from "@/components/forms/select-project"
import { FormSelectType } from "@/components/forms/select-type"
import { FormInput, FormTextarea } from "@/components/forms/simple"
import { validateGSTIN } from "@/lib/indian-tax-utils"
import { stateNameFromGSTIN } from "@/lib/indian-states"
import { getTDSRate } from "@/lib/indian-tax-utils"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Category, Currency, Field, File, Project } from "@/prisma/client"
import { format } from "date-fns"
import { AlertTriangle, ArrowDownToLine, Brain, ChevronDown, ChevronRight, CheckCircle2, Loader2, Trash2, XCircle } from "lucide-react"
import { startTransition, useActionState, useEffect, useMemo, useState } from "react"

// Field grouping for collapsible sections
const GST_FIELD_CODES = new Set(["gstin", "gst_rate", "cgst", "sgst", "igst", "cess", "hsn_sac_code", "place_of_supply", "supply_type", "reverse_charge"])
const TDS_FIELD_CODES = new Set(["pan_number", "tds_section", "tds_rate", "tds_amount"])
const INVOICE_FIELD_CODES = new Set(["invoice_number"])

export default function AnalyzeForm({
  file,
  categories,
  projects,
  currencies,
  fields,
  settings,
}: {
  file: File
  categories: Category[]
  projects: Project[]
  currencies: Currency[]
  fields: Field[]
  settings: Record<string, string>
}) {
  const { showNotification } = useNotification()
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [analyzeStep, setAnalyzeStep] = useState<string>("")
  const [analyzeError, setAnalyzeError] = useState<string>("")
  const [deleteState, deleteAction, isDeleting] = useActionState(deleteUnsortedFileAction, null)
  const [isSaving, setIsSaving] = useState(false)
  const [saveError, setSaveError] = useState("")

  // Collapsible section state
  const [gstOpen, setGstOpen] = useState(false)
  const [tdsOpen, setTdsOpen] = useState(false)
  const [otherOpen, setOtherOpen] = useState(false)

  const fieldMap = useMemo(() => {
    return fields.reduce(
      (acc, field) => {
        acc[field.code] = field
        return acc
      },
      {} as Record<string, Field>
    )
  }, [fields])

  const extraFields = useMemo(() => fields.filter((field) => field.isExtra), [fields])

  // Group extra fields into sections
  const invoiceFields = useMemo(() => extraFields.filter((f) => INVOICE_FIELD_CODES.has(f.code)), [extraFields])
  const gstFields = useMemo(() => extraFields.filter((f) => GST_FIELD_CODES.has(f.code)), [extraFields])
  const tdsFields = useMemo(() => extraFields.filter((f) => TDS_FIELD_CODES.has(f.code)), [extraFields])
  const otherExtraFields = useMemo(
    () => extraFields.filter((f) => !GST_FIELD_CODES.has(f.code) && !TDS_FIELD_CODES.has(f.code) && !INVOICE_FIELD_CODES.has(f.code)),
    [extraFields]
  )

  const initialFormState = useMemo(() => {
    const baseState = {
      name: file.filename,
      merchant: "",
      description: "",
      type: settings.default_type,
      total: 0.0,
      currencyCode: settings.default_currency,
      convertedTotal: 0.0,
      convertedCurrencyCode: settings.default_currency,
      categoryCode: settings.default_category,
      projectCode: settings.default_project,
      issuedAt: "",
      note: "",
      text: "",
      items: [],
    }

    const extraFieldsState = extraFields.reduce(
      (acc, field) => {
        acc[field.code] = ""
        return acc
      },
      {} as Record<string, string>
    )

    const cachedResults = file.cachedParseResult
      ? Object.fromEntries(
          Object.entries(file.cachedParseResult as Record<string, string>).filter(
            ([_, value]) => value !== null && value !== undefined && value !== ""
          )
        )
      : {}

    return {
      ...baseState,
      ...extraFieldsState,
      ...cachedResults,
    }
  }, [file.filename, settings, extraFields, file.cachedParseResult])
  const [formData, setFormData] = useState(initialFormState)

  // Auto-open sections when AI fills them
  useEffect(() => {
    if (formData.gstin || formData.gst_rate) setGstOpen(true)
    if (formData.tds_section || formData.tds_amount) setTdsOpen(true)
  }, [formData.gstin, formData.gst_rate, formData.tds_section, formData.tds_amount])

  // GSTIN validation state
  const gstinValidation = useMemo(() => {
    const val = formData.gstin as string
    if (!val) return null
    return validateGSTIN(val)
  }, [formData.gstin])

  // Auto-populate place_of_supply from GSTIN
  useEffect(() => {
    const gstin = formData.gstin as string
    if (gstin && gstinValidation?.valid) {
      const stateName = stateNameFromGSTIN(gstin)
      if (stateName && !formData.place_of_supply) {
        setFormData((prev) => ({ ...prev, place_of_supply: stateName }))
      }
    }
  }, [formData.gstin, gstinValidation])

  // TDS rate auto-suggest
  useEffect(() => {
    const section = formData.tds_section as string
    if (section) {
      const rate = getTDSRate(section)
      if (rate > 0 && !formData.tds_rate) {
        setFormData((prev) => ({ ...prev, tds_rate: rate }))
      }
    }
  }, [formData.tds_section])

  async function saveAsTransaction(formData: FormData) {
    setSaveError("")
    setIsSaving(true)
    startTransition(async () => {
      const result = await saveFileAsTransactionAction(null, formData)
      setIsSaving(false)

      if (result.success) {
        showNotification({ code: "global.banner", message: "Saved!", type: "success" })
        showNotification({ code: "sidebar.transactions", message: "new" })
        setTimeout(() => showNotification({ code: "sidebar.transactions", message: "" }), 3000)
      } else {
        setSaveError(result.error ? result.error : "Something went wrong...")
        showNotification({ code: "global.banner", message: "Failed to save", type: "failed" })
      }
    })
  }

  const startAnalyze = async () => {
    setIsAnalyzing(true)
    setAnalyzeError("")
    try {
      setAnalyzeStep("Analyzing...")
      const results = await analyzeFileAction(file, settings, fields, categories, projects)

      console.log("Analysis results:", results)

      if (!results.success) {
        setAnalyzeError(results.error ? results.error : "Something went wrong...")
      } else {
        const nonEmptyFields = Object.fromEntries(
          Object.entries(results.data?.output || {}).filter(
            ([_, value]) => value !== null && value !== undefined && value !== ""
          )
        )
        setFormData({ ...formData, ...nonEmptyFields })
      }
    } catch (error) {
      console.error("Analysis failed:", error)
      setAnalyzeError(error instanceof Error ? error.message : "Analysis failed")
    } finally {
      setIsAnalyzing(false)
      setAnalyzeStep("")
    }
  }

  // Render a group of extra fields
  const renderExtraField = (field: Field) => {
    const value = formData[field.code as keyof typeof formData]

    // Special rendering for GSTIN with inline validation
    if (field.code === "gstin") {
      return (
        <div key={field.code} className="space-y-1">
          <div className="flex items-center gap-2">
            <FormInput
              type="text"
              title={field.name}
              name={field.code}
              value={value}
              onChange={(e) => setFormData((prev) => ({ ...prev, [field.code]: e.target.value }))}
              hideIfEmpty={!field.isVisibleInAnalysis}
              required={field.isRequired}
              className="flex-1"
            />
            {value && gstinValidation && (
              <div className="mt-5">
                {gstinValidation.valid ? (
                  <CheckCircle2 className="h-5 w-5 text-green-600" />
                ) : (
                  <XCircle className="h-5 w-5 text-red-500" />
                )}
              </div>
            )}
          </div>
          {value && gstinValidation && !gstinValidation.valid && (
            <p className="text-xs text-red-500 ml-1">{gstinValidation.error}</p>
          )}
          {value && gstinValidation?.valid && gstinValidation.stateName && (
            <p className="text-xs text-green-600 ml-1">{gstinValidation.stateName}</p>
          )}
        </div>
      )
    }

    return (
      <FormInput
        key={field.code}
        type={field.type === "number" ? "number" : "text"}
        step={field.type === "number" ? "0.01" : undefined}
        title={field.name}
        name={field.code}
        value={value}
        onChange={(e) => setFormData((prev) => ({ ...prev, [field.code]: e.target.value }))}
        hideIfEmpty={!field.isVisibleInAnalysis}
        required={field.isRequired}
      />
    )
  }

  // Collapsible section component
  const CollapsibleSection = ({
    title,
    isOpen,
    onToggle,
    count,
    children,
  }: {
    title: string
    isOpen: boolean
    onToggle: () => void
    count?: number
    children: React.ReactNode
  }) => (
    <div className="border rounded-md overflow-hidden">
      <button
        type="button"
        onClick={onToggle}
        className="flex items-center gap-2 w-full px-3 py-2 text-sm font-medium bg-muted/50 hover:bg-muted transition-colors text-left"
      >
        {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        <span>{title}</span>
        {count !== undefined && count > 0 && (
          <Badge variant="secondary" className="ml-auto text-xs">{count} filled</Badge>
        )}
      </button>
      {isOpen && <div className="p-3 space-y-3">{children}</div>}
    </div>
  )

  // Count filled fields in a section
  const countFilled = (fieldCodes: Set<string>) => {
    return Array.from(fieldCodes).filter((code) => {
      const val = formData[code as keyof typeof formData]
      return val !== undefined && val !== null && val !== "" && val !== 0
    }).length
  }

  return (
    <>
      {file.isSplitted ? (
        <div className="flex justify-end">
          <Badge variant="outline">This file has been split up</Badge>
        </div>
      ) : (
        <Button className="w-full mb-6 py-6 text-lg" onClick={startAnalyze} disabled={isAnalyzing} data-analyze-button>
          {isAnalyzing ? (
            <>
              <Loader2 className="mr-1 h-4 w-4 animate-spin" />
              <span>{analyzeStep}</span>
            </>
          ) : (
            <>
              <Brain className="mr-1 h-4 w-4" />
              <span>Analyze with AI</span>
            </>
          )}
        </Button>
      )}

      <div>{analyzeError && <FormError>{analyzeError}</FormError>}</div>

      <form className="space-y-4" action={saveAsTransaction}>
        <input type="hidden" name="fileId" value={file.id} />
        <FormInput
          title={fieldMap.name.name}
          name="name"
          value={formData.name}
          onChange={(e) => setFormData((prev) => ({ ...prev, name: e.target.value }))}
          required={fieldMap.name.isRequired}
        />

        <FormInput
          title={fieldMap.merchant.name}
          name="merchant"
          value={formData.merchant}
          onChange={(e) => setFormData((prev) => ({ ...prev, merchant: e.target.value }))}
          hideIfEmpty={!fieldMap.merchant.isVisibleInAnalysis}
          required={fieldMap.merchant.isRequired}
        />

        <FormInput
          title={fieldMap.description.name}
          name="description"
          value={formData.description}
          onChange={(e) => setFormData((prev) => ({ ...prev, description: e.target.value }))}
          hideIfEmpty={!fieldMap.description.isVisibleInAnalysis}
          required={fieldMap.description.isRequired}
        />

        <div className="flex flex-wrap gap-4">
          <FormInput
            title={fieldMap.total.name}
            name="total"
            type="number"
            step="0.01"
            value={formData.total || ""}
            onChange={(e) => {
              const newValue = parseFloat(e.target.value || "0")
              !isNaN(newValue) && setFormData((prev) => ({ ...prev, total: newValue }))
            }}
            className="w-32"
            required={fieldMap.total.isRequired}
          />

          <FormSelectCurrency
            title={fieldMap.currencyCode.name}
            currencies={currencies}
            name="currencyCode"
            value={formData.currencyCode}
            onValueChange={(value) => setFormData((prev) => ({ ...prev, currencyCode: value }))}
            hideIfEmpty={!fieldMap.currencyCode.isVisibleInAnalysis}
            required={fieldMap.currencyCode.isRequired}
          />

          <FormSelectType
            title={fieldMap.type.name}
            name="type"
            value={formData.type}
            onValueChange={(value) => setFormData((prev) => ({ ...prev, type: value }))}
            hideIfEmpty={!fieldMap.type.isVisibleInAnalysis}
            required={fieldMap.type.isRequired}
          />
        </div>

        {formData.total != 0 && formData.currencyCode && formData.currencyCode !== settings.default_currency && (
          <ToolWindow title={`Exchange rate on ${format(new Date(formData.issuedAt || Date.now()), "LLLL dd, yyyy")}`}>
            <CurrencyConverterTool
              originalTotal={formData.total}
              originalCurrencyCode={formData.currencyCode}
              targetCurrencyCode={settings.default_currency}
              date={new Date(formData.issuedAt || Date.now())}
              onChange={(value) => setFormData((prev) => ({ ...prev, convertedTotal: value }))}
            />
            <input type="hidden" name="convertedCurrencyCode" value={settings.default_currency} />
          </ToolWindow>
        )}

        <div className="flex flex-row gap-4">
          <FormInput
            title={fieldMap.issuedAt.name}
            type="date"
            name="issuedAt"
            value={formData.issuedAt}
            onChange={(e) => setFormData((prev) => ({ ...prev, issuedAt: e.target.value }))}
            hideIfEmpty={!fieldMap.issuedAt.isVisibleInAnalysis}
            required={fieldMap.issuedAt.isRequired}
          />
        </div>

        <div className="flex flex-row gap-4">
          <FormSelectCategory
            title={fieldMap.categoryCode.name}
            categories={categories}
            name="categoryCode"
            value={formData.categoryCode}
            onValueChange={(value) => setFormData((prev) => ({ ...prev, categoryCode: value }))}
            placeholder="Select Category"
            hideIfEmpty={!fieldMap.categoryCode.isVisibleInAnalysis}
            required={fieldMap.categoryCode.isRequired}
          />

          {projects.length > 0 && (
            <FormSelectProject
              title={fieldMap.projectCode.name}
              projects={projects}
              name="projectCode"
              value={formData.projectCode}
              onValueChange={(value) => setFormData((prev) => ({ ...prev, projectCode: value }))}
              placeholder="Select Project"
              hideIfEmpty={!fieldMap.projectCode.isVisibleInAnalysis}
              required={fieldMap.projectCode.isRequired}
            />
          )}
        </div>

        <FormInput
          title={fieldMap.note.name}
          name="note"
          value={formData.note}
          onChange={(e) => setFormData((prev) => ({ ...prev, note: e.target.value }))}
          hideIfEmpty={!fieldMap.note.isVisibleInAnalysis}
          required={fieldMap.note.isRequired}
        />

        {/* Invoice fields — always visible */}
        {invoiceFields.map(renderExtraField)}

        {/* GST Details — collapsible */}
        {gstFields.length > 0 && (
          <CollapsibleSection
            title="GST Details"
            isOpen={gstOpen}
            onToggle={() => setGstOpen(!gstOpen)}
            count={countFilled(GST_FIELD_CODES)}
          >
            {(gstOpen && (formData.gstin || formData.gst_rate || formData.tds_section)) && (
              <div className="flex items-center gap-2 p-2 bg-yellow-50 border border-yellow-200 rounded text-xs text-yellow-800">
                <AlertTriangle className="h-4 w-4 flex-shrink-0" />
                <span>AI-extracted tax data — please verify before using for compliance</span>
              </div>
            )}
            {gstFields.map(renderExtraField)}
          </CollapsibleSection>
        )}

        {/* GST Calculator Widget */}
        {formData.gst_rate && Number(formData.gst_rate) > 0 && formData.total > 0 && (
          <ToolWindow title="GST Breakdown Calculator">
            <GSTCalculatorTool
              total={formData.total}
              gstRate={Number(formData.gst_rate)}
              supplierGSTIN={formData.gstin as string}
              businessStateCode={settings.business_state_code || ""}
              existingCGST={Number(formData.cgst) || 0}
              existingSGST={Number(formData.sgst) || 0}
              existingIGST={Number(formData.igst) || 0}
              onChange={(values) => setFormData((prev) => ({ ...prev, ...values }))}
            />
          </ToolWindow>
        )}

        {/* TDS Details — collapsible */}
        {tdsFields.length > 0 && (
          <CollapsibleSection
            title="TDS Details"
            isOpen={tdsOpen}
            onToggle={() => setTdsOpen(!tdsOpen)}
            count={countFilled(TDS_FIELD_CODES)}
          >
            {tdsFields.map(renderExtraField)}
          </CollapsibleSection>
        )}

        {/* Other extra fields — collapsible */}
        {otherExtraFields.length > 0 && (
          <CollapsibleSection
            title="Other Details"
            isOpen={otherOpen}
            onToggle={() => setOtherOpen(!otherOpen)}
            count={countFilled(new Set(otherExtraFields.map((f) => f.code)))}
          >
            {otherExtraFields.map(renderExtraField)}
          </CollapsibleSection>
        )}

        {formData.items && formData.items.length > 0 && (
          <ToolWindow title="Detected items">
            <ItemsDetectTool file={file} data={formData} />
          </ToolWindow>
        )}

        <div className="hidden">
          <input type="text" name="items" value={JSON.stringify(formData.items)} readOnly />
          <FormTextarea
            title={fieldMap.text.name}
            name="text"
            value={formData.text}
            onChange={(e) => setFormData((prev) => ({ ...prev, text: e.target.value }))}
            hideIfEmpty={!fieldMap.text.isVisibleInAnalysis}
          />
        </div>

        <div className="flex justify-between gap-4 pt-6">
          <Button
            type="button"
            onClick={() => startTransition(() => deleteAction(file.id))}
            variant="destructive"
            disabled={isDeleting}
          >
            <Trash2 className="h-4 w-4" />
            {isDeleting ? "Deleting..." : "Delete"}
          </Button>

          <Button type="submit" disabled={isSaving} data-save-button>
            {isSaving ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Saving...
              </>
            ) : (
              <>
                <ArrowDownToLine className="h-4 w-4" />
                Save as Transaction
              </>
            )}
          </Button>
        </div>

        <div>
          {deleteState?.error && <FormError>{deleteState.error}</FormError>}
          {saveError && <FormError>{saveError}</FormError>}
        </div>
      </form>
    </>
  )
}
