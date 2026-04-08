"use client"

import { deleteTransactionAction, duplicateTransactionAction, saveTransactionAction } from "@/app/(app)/transactions/actions"
import { ItemsDetectTool } from "@/components/agents/items-detect"
import ToolWindow from "@/components/agents/tool-window"
import { FormError } from "@/components/forms/error"
import { FormSelectCategory } from "@/components/forms/select-category"
import { FormSelectCurrency } from "@/components/forms/select-currency"
import { FormSelectProject } from "@/components/forms/select-project"
import { FormSelectType } from "@/components/forms/select-type"
import { FormInput, FormTextarea } from "@/components/forms/simple"
import { Button } from "@/components/ui/button"
import { TransactionData } from "@/models/transactions"
import { Category, Currency, Field, Project, Transaction } from "@/prisma/client"
import { format } from "date-fns"
import { classifyTransaction, transactionToGSTR1 } from "@/lib/gstr1"
import { AlertTriangle, Copy, Loader2, Save, Trash2 } from "lucide-react"
import { useRouter } from "next/navigation"
import { startTransition, useActionState, useEffect, useMemo, useState } from "react"

const SECTION_LABELS: Record<string, { label: string; color: string }> = {
  b2b: { label: "B2B", color: "bg-blue-100 text-blue-800" },
  b2cl: { label: "B2CL", color: "bg-purple-100 text-purple-800" },
  b2cs: { label: "B2CS", color: "bg-green-100 text-green-800" },
  exp: { label: "Export", color: "bg-orange-100 text-orange-800" },
  nil: { label: "Nil Rated", color: "bg-gray-100 text-gray-700" },
  exempt: { label: "Exempt", color: "bg-gray-100 text-gray-700" },
  skip: { label: "Input (Expense)", color: "bg-yellow-50 text-yellow-700" },
}

export default function TransactionEditForm({
  transaction,
  categories,
  projects,
  currencies,
  fields,
  settings,
}: {
  transaction: Transaction
  categories: Category[]
  projects: Project[]
  currencies: Currency[]
  fields: Field[]
  settings: Record<string, string>
}) {
  const router = useRouter()
  const [deleteState, deleteAction, isDeleting] = useActionState(deleteTransactionAction, null)
  const [saveState, saveAction, isSaving] = useActionState(saveTransactionAction, null)

  const extraFields = fields.filter((field) => field.isExtra)
  const [formData, setFormData] = useState({
    name: transaction.name || "",
    merchant: transaction.merchant || "",
    description: transaction.description || "",
    total: transaction.total ? transaction.total / 100 : 0.0,
    currencyCode: transaction.currencyCode || settings.default_currency,
    convertedTotal: transaction.convertedTotal ? transaction.convertedTotal / 100 : 0.0,
    convertedCurrencyCode: transaction.convertedCurrencyCode,
    type: transaction.type || "expense",
    categoryCode: transaction.categoryCode || settings.default_category,
    projectCode: transaction.projectCode || settings.default_project,
    issuedAt: transaction.issuedAt ? format(transaction.issuedAt, "yyyy-MM-dd") : "",
    note: transaction.note || "",
    items: transaction.items || [],
    ...extraFields.reduce(
      (acc, field) => {
        acc[field.code] = transaction.extra?.[field.code as keyof typeof transaction.extra] || ""
        return acc
      },
      {} as Record<string, any>
    ),
  })

  const fieldMap = useMemo(() => {
    return fields.reduce(
      (acc, field) => {
        acc[field.code] = field
        return acc
      },
      {} as Record<string, Field>
    )
  }, [fields])

  const [isDuplicating, setIsDuplicating] = useState(false)

  const handleDelete = async () => {
    if (confirm("Are you sure? This will delete the transaction with all the files permanently")) {
      startTransition(async () => {
        await deleteAction(transaction.id)
        router.back()
      })
    }
  }

  const handleDuplicate = async () => {
    setIsDuplicating(true)
    try {
      const result = await duplicateTransactionAction(transaction.id)
      if (result.success && result.data) {
        router.push(`/transactions/${result.data.id}`)
      }
    } finally {
      setIsDuplicating(false)
    }
  }

  useEffect(() => {
    if (saveState?.success) {
      router.back()
    }
  }, [saveState, router])

  return (
    <form action={saveAction} className="space-y-4">
      <input type="hidden" name="transactionId" value={transaction.id} />

      {/* GSTR-1 Classification Badge */}
      <GSTR1Badge transaction={transaction} settings={settings} />

      <FormInput
        title={fieldMap.name.name}
        name="name"
        defaultValue={formData.name}
        isRequired={fieldMap.name.isRequired}
      />

      <FormInput
        title={fieldMap.merchant.name}
        name="merchant"
        defaultValue={formData.merchant}
        isRequired={fieldMap.merchant.isRequired}
      />

      <FormInput
        title={fieldMap.description.name}
        name="description"
        defaultValue={formData.description}
        isRequired={fieldMap.description.isRequired}
      />

      <div className="flex flex-row gap-4">
        <FormInput
          title={fieldMap.total.name}
          type="number"
          step="0.01"
          name="total"
          defaultValue={formData.total.toFixed(2)}
          className="w-32"
          isRequired={fieldMap.total.isRequired}
        />

        <FormSelectCurrency
          title={fieldMap.currencyCode.name}
          name="currencyCode"
          value={formData.currencyCode}
          onValueChange={(value) => {
            setFormData({ ...formData, currencyCode: value })
          }}
          currencies={currencies}
          isRequired={fieldMap.currencyCode.isRequired}
        />

        <FormSelectType
          title={fieldMap.type.name}
          name="type"
          defaultValue={formData.type}
          isRequired={fieldMap.type.isRequired}
        />
      </div>

      <div className="flex flex-row flex-grow gap-4">
        <FormInput
          title={fieldMap.issuedAt.name}
          type="date"
          name="issuedAt"
          defaultValue={formData.issuedAt}
          isRequired={fieldMap.issuedAt.isRequired}
        />
        {formData.currencyCode !== settings.default_currency || formData.convertedTotal !== 0 ? (
          <>
            {formData.convertedTotal !== null && (
              <FormInput
                title={`Total converted to ${formData.convertedCurrencyCode || "UNKNOWN CURRENCY"}`}
                type="number"
                step="0.01"
                name="convertedTotal"
                defaultValue={formData.convertedTotal.toFixed(2)}
                isRequired={fieldMap.convertedTotal.isRequired}
                className="max-w-36"
              />
            )}
            {(!formData.convertedCurrencyCode || formData.convertedCurrencyCode !== settings.default_currency) && (
              <FormSelectCurrency
                title="Convert to"
                name="convertedCurrencyCode"
                defaultValue={formData.convertedCurrencyCode || settings.default_currency}
                currencies={currencies}
                isRequired={fieldMap.convertedCurrencyCode.isRequired}
              />
            )}
          </>
        ) : (
          <></>
        )}
      </div>

      <div className="flex flex-row gap-4">
        <FormSelectCategory
          title={fieldMap.categoryCode.name}
          categories={categories}
          name="categoryCode"
          defaultValue={formData.categoryCode}
          isRequired={fieldMap.categoryCode.isRequired}
        />

        <FormSelectProject
          title={fieldMap.projectCode.name}
          projects={projects}
          name="projectCode"
          defaultValue={formData.projectCode}
          isRequired={fieldMap.projectCode.isRequired}
        />
      </div>

      <FormTextarea
        title={fieldMap.note.name}
        name="note"
        defaultValue={formData.note}
        className="h-24"
        isRequired={fieldMap.note.isRequired}
      />

      <div className="flex flex-wrap gap-4">
        {extraFields.map((field) => (
          <FormInput
            key={field.code}
            type="text"
            title={field.name}
            name={field.code}
            defaultValue={(formData[field.code as keyof typeof formData] as string) || ""}
            isRequired={field.isRequired}
            className={field.type === "number" ? "max-w-36" : "max-w-full"}
          />
        ))}
      </div>

      {formData.items && Array.isArray(formData.items) && formData.items.length > 0 && (
        <ToolWindow title="Detected items">
          <ItemsDetectTool data={formData as TransactionData} />
        </ToolWindow>
      )}

      <div className="flex justify-between space-x-4 pt-6">
        <div className="flex gap-2">
          <Button type="button" onClick={handleDelete} variant="destructive" disabled={isDeleting}>
            <>
              <Trash2 className="h-4 w-4" />
              {isDeleting ? "⏳ Deleting..." : "Delete"}
            </>
          </Button>

          <Button type="button" onClick={handleDuplicate} variant="outline" disabled={isDuplicating}>
            {isDuplicating ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Copying...
              </>
            ) : (
              <>
                <Copy className="h-4 w-4" />
                Duplicate
              </>
            )}
          </Button>
        </div>

        <Button type="submit" disabled={isSaving}>
          {isSaving ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Saving...
            </>
          ) : (
            <>
              <Save className="h-4 w-4" />
              Save Transaction
            </>
          )}
        </Button>
      </div>

      <div>
        {deleteState?.error && <FormError>{deleteState.error}</FormError>}
        {saveState?.error && <FormError>{saveState.error}</FormError>}
      </div>
    </form>
  )
}

function GSTR1Badge({ transaction, settings }: { transaction: Transaction; settings: Record<string, string> }) {
  const result = useMemo(() => {
    const gstTx = transactionToGSTR1(transaction)
    return classifyTransaction(gstTx, settings.business_state_code || null)
  }, [transaction, settings])

  const sectionInfo = SECTION_LABELS[result.section] || SECTION_LABELS.skip

  return (
    <div className="flex flex-wrap items-start gap-3 p-3 bg-muted/30 rounded-lg text-sm">
      <div className="flex items-center gap-2">
        <span className="text-muted-foreground">GST Filing:</span>
        <span className={`px-2 py-0.5 rounded text-xs font-medium ${sectionInfo.color}`}>
          {sectionInfo.label}
        </span>
      </div>
      {result.warnings.length > 0 && (
        <div className="flex items-start gap-1.5 text-yellow-700">
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
          <div className="text-xs">
            {result.warnings.map((w, i) => <div key={i}>{w}</div>)}
          </div>
        </div>
      )}
    </div>
  )
}
