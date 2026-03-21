// Indian States & Union Territories with GST State Codes
// Reference: GSTN Portal — https://services.gst.gov.in/services/searchtp

export const INDIAN_STATES: Record<string, string> = {
  "01": "Jammu & Kashmir",
  "02": "Himachal Pradesh",
  "03": "Punjab",
  "04": "Chandigarh",
  "05": "Uttarakhand",
  "06": "Haryana",
  "07": "Delhi",
  "08": "Rajasthan",
  "09": "Uttar Pradesh",
  "10": "Bihar",
  "11": "Sikkim",
  "12": "Arunachal Pradesh",
  "13": "Nagaland",
  "14": "Manipur",
  "15": "Mizoram",
  "16": "Tripura",
  "17": "Meghalaya",
  "18": "Assam",
  "19": "West Bengal",
  "20": "Jharkhand",
  "21": "Odisha",
  "22": "Chhattisgarh",
  "23": "Madhya Pradesh",
  "24": "Gujarat",
  "25": "Daman & Diu",
  "26": "Dadra & Nagar Haveli",
  "27": "Maharashtra",
  "29": "Karnataka",
  "30": "Goa",
  "31": "Lakshadweep",
  "32": "Kerala",
  "33": "Tamil Nadu",
  "34": "Puducherry",
  "35": "Andaman & Nicobar Islands",
  "36": "Telangana",
  "37": "Andhra Pradesh",
  "38": "Ladakh",
  "97": "Other Territory",
}

// Reverse lookup: state name → code
export const STATE_NAME_TO_CODE: Record<string, string> = Object.fromEntries(
  Object.entries(INDIAN_STATES).map(([code, name]) => [name.toLowerCase(), code])
)

// Get state code (first 2 digits) from a GSTIN
export function stateCodeFromGSTIN(gstin: string): string | null {
  if (!gstin || gstin.length < 2) return null
  const code = gstin.substring(0, 2)
  return INDIAN_STATES[code] ? code : null
}

// Get state name from a GSTIN
export function stateNameFromGSTIN(gstin: string): string | null {
  const code = stateCodeFromGSTIN(gstin)
  return code ? INDIAN_STATES[code] : null
}

// Determine if a transaction is inter-state
// supplierStateCode and buyerStateCode are 2-digit state codes
export function isInterState(supplierStateCode: string, buyerStateCode: string): boolean {
  if (!supplierStateCode || !buyerStateCode) return false
  return supplierStateCode !== buyerStateCode
}

// Get sorted array of states for dropdowns
export function getStateOptions(): { code: string; name: string }[] {
  return Object.entries(INDIAN_STATES)
    .map(([code, name]) => ({ code, name: `${code} - ${name}` }))
    .sort((a, b) => a.code.localeCompare(b.code))
}
