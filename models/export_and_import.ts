import { prisma } from "@/lib/db"
import { codeFromName } from "@/lib/utils"
import { formatDate } from "date-fns"
import { createCategory, getCategoryByCode } from "./categories"
import { createProject, getProjectByCode } from "./projects"
import { TransactionFilters } from "./transactions"

export type ExportFilters = TransactionFilters

export type ExportFields = string[]

export type ExportImportFieldSettings = {
  code: string
  type: string
  export?: (userId: string, value: any) => Promise<any>
  import?: (userId: string, value: any) => Promise<any>
}

export const EXPORT_AND_IMPORT_FIELD_MAP: Record<string, ExportImportFieldSettings> = {
  name: {
    code: "name",
    type: "string",
  },
  description: {
    code: "description",
    type: "string",
  },
  merchant: {
    code: "merchant",
    type: "string",
  },
  total: {
    code: "total",
    type: "number",
    export: async function (userId: string, value: number) {
      return value / 100
    },
    import: async function (userId: string, value: string) {
      const num = parseFloat(value)
      return isNaN(num) ? 0.0 : num * 100
    },
  },
  currencyCode: {
    code: "currencyCode",
    type: "string",
  },
  convertedTotal: {
    code: "convertedTotal",
    type: "number",
    export: async function (userId: string, value: number | null) {
      if (!value) {
        return null
      }
      return value / 100
    },
    import: async function (userId: string, value: string) {
      const num = parseFloat(value)
      return isNaN(num) ? 0.0 : num * 100
    },
  },
  convertedCurrencyCode: {
    code: "convertedCurrencyCode",
    type: "string",
  },
  type: {
    code: "type",
    type: "string",
    export: async function (userId: string, value: string | null) {
      return value ? value.toLowerCase() : ""
    },
    import: async function (userId: string, value: string) {
      return value.toLowerCase()
    },
  },
  note: {
    code: "note",
    type: "string",
  },
  categoryCode: {
    code: "categoryCode",
    type: "string",
    export: async function (userId: string, value: string | null) {
      if (!value) {
        return null
      }
      const category = await getCategoryByCode(userId, value)
      return category?.name
    },
    import: async function (userId: string, value: string) {
      const category = await importCategory(userId, value)
      return category?.code
    },
  },
  projectCode: {
    code: "projectCode",
    type: "string",
    export: async function (userId: string, value: string | null) {
      if (!value) {
        return null
      }
      const project = await getProjectByCode(userId, value)
      return project?.name
    },
    import: async function (userId: string, value: string) {
      const project = await importProject(userId, value)
      return project?.code
    },
  },
  issuedAt: {
    code: "issuedAt",
    type: "date",
    export: async function (userId: string, value: Date | null) {
      if (!value || isNaN(value.getTime())) {
        return null
      }

      try {
        return formatDate(value, "yyyy-MM-dd")
      } catch (error) {
        return null
      }
    },
    import: async function (userId: string, value: string) {
      try {
        return new Date(value)
      } catch (error) {
        return null
      }
    },
  },
  // Indian GST/TDS extra fields — pass-through (no transform needed)
  invoice_number: { code: "invoice_number", type: "string" },
  gstin: { code: "gstin", type: "string" },
  gst_rate: {
    code: "gst_rate",
    type: "number",
    import: async (_userId: string, value: string) => {
      const num = parseFloat(value)
      return isNaN(num) ? 0 : num
    },
  },
  cgst: {
    code: "cgst",
    type: "number",
    import: async (_userId: string, value: string) => {
      const num = parseFloat(value)
      return isNaN(num) ? 0 : num
    },
  },
  sgst: {
    code: "sgst",
    type: "number",
    import: async (_userId: string, value: string) => {
      const num = parseFloat(value)
      return isNaN(num) ? 0 : num
    },
  },
  igst: {
    code: "igst",
    type: "number",
    import: async (_userId: string, value: string) => {
      const num = parseFloat(value)
      return isNaN(num) ? 0 : num
    },
  },
  hsn_sac_code: { code: "hsn_sac_code", type: "string" },
  place_of_supply: { code: "place_of_supply", type: "string" },
  supply_type: { code: "supply_type", type: "string" },
  pan_number: { code: "pan_number", type: "string" },
  tds_section: { code: "tds_section", type: "string" },
  tds_amount: {
    code: "tds_amount",
    type: "number",
    import: async (_userId: string, value: string) => {
      const num = parseFloat(value)
      return isNaN(num) ? 0 : num
    },
  },
}

export const importProject = async (userId: string, name: string) => {
  const code = codeFromName(name)

  const existingProject = await prisma.project.findFirst({
    where: {
      OR: [{ code }, { name }],
    },
  })

  if (existingProject) {
    return existingProject
  }

  return await createProject(userId, { code, name })
}

export const importCategory = async (userId: string, name: string) => {
  const code = codeFromName(name)

  const existingCategory = await prisma.category.findFirst({
    where: {
      OR: [{ code }, { name }],
    },
  })

  if (existingCategory) {
    return existingCategory
  }

  return await createCategory(userId, { code, name })
}
