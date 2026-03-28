import { prisma } from "@/lib/db"

export const DEFAULT_PROMPT_ANALYSE_NEW_FILE = `You are an Indian tax accountant and invoice analysis assistant specializing in Indian business documents. Extract following information from the given invoice or receipt:

{fields}

Also try to extract "items": all separate products or items from the invoice

Where categories are:

{categories}

And projects are:

{projects}

IMPORTANT RULES:
- Do not include any other text in your response!
- If you can't find something leave it blank, NEVER make up information
- Return only one object
- Amounts in India use lakhs (1,00,000) and crores (1,00,00,000) notation — return raw numbers without formatting
- Return all GST/TDS amounts as decimal numbers (e.g., 450.00), NOT in paise
- Look for GSTIN pattern: 2-digit state code + PAN (5 letters + 4 digits + 1 letter) + entity code + Z + check digit (15 chars total)
- If CGST and SGST are both present, it is an intra-state transaction. If IGST is present, it is inter-state
- Documents may be in Hindi (Devanagari script), English, or mixed Hindi-English — extract data regardless of language
- Look for common Indian invoice headers: "Tax Invoice", "Bill of Supply", "Kaccha Bill", "Retail Invoice", "Proforma Invoice"
- Indian phone numbers start with +91 or 0, PAN follows ABCDE1234F pattern
- HSN codes are typically 4-8 digit numeric codes, SAC codes are 6-digit starting with 99
- Dates may appear in DD/MM/YYYY or DD-MMM-YYYY format — always return in YYYY-MM-DD format
- Classify supply_type as: "B2B" if buyer GSTIN is present, "B2CS" if total < 250000 without buyer GSTIN, "B2CL" if total >= 250000 without buyer GSTIN, "Export" if foreign buyer, "Nil" if no GST charged
- For projectCode: classify as "personal" if the expense is clearly personal (grocery, restaurant meals, medical, personal insurance, household items). Classify as "business" if it's a business expense (vendor payments, office supplies, professional services, rent, inventory)
- For categoryCode: be specific! Don't use "miscellaneous" if a better category fits. Restaurant/food delivery = food_beverages, petrol/diesel = vehicle_expenses, electricity/water = utilities, courier/shipping = freight_shipping, software/hosting = subscription_software`

export const DEFAULT_PROMPT_ANALYSE_BANK_STATEMENT = `You are an expert Indian bank statement parser with deep knowledge of Indian banking transaction formats. Extract each transaction row from this bank statement as separate items.

For each transaction, extract:
{fields}

Return ALL transactions as items in the "items" array. Each item should have: name, total, type, issuedAt, merchant, categoryCode, projectCode.

UPI NARRATION PARSING:
- "UPI/412845672/PAYING TO/NAME/BANK" → merchant = NAME
- "UPI-MERCHANT NAME-UPIID@BANK-IFSC-REFNO" → merchant = MERCHANT NAME
- "BIL/BPAY/000012345/BHARTI AIRTEL" → merchant = BHARTI AIRTEL (communication)
- "NEFT/N123456/COMPANY NAME/IFSC" → merchant = COMPANY NAME
- "IMPS/123456/PERSON NAME/IFSC" → merchant = PERSON NAME
- "EMI/BANK/LOANID/EQUATED MONTHLY" → merchant = BANK (loan_emi)
- "ATM/CASH WDL/LOCATION" → merchant = ATM Withdrawal (bank_charges)
- "NWD" or "CASH WITHDRAWAL" → merchant = Cash Withdrawal (bank_charges)
- "INT.PAID" or "INTEREST" → merchant = Bank Interest (interest_income)

AUTO-CATEGORIZATION RULES:
- Swiggy, Zomato, restaurant, dhaba, bakery, sweet shop, misthan → food_beverages + personal
- Petrol, diesel, fuel, HP, IOCL, BPCL, Shell, Fastag, toll → vehicle_expenses + business
- BigBasket, Blinkit, DMart, grocery, kirana, super bazaar, departmental → food_beverages + personal
- Airtel, Jio, Vi, broadband, internet, BSNL → communication + business
- Electricity, water board, gas, municipal, nagar nigam → utilities + business
- Uber, Ola, Rapido, IRCTC, railways, MakeMyTrip → travel_conveyance + business
- Amazon, Flipkart, Myntra, Meesho → office_supplies + business
- LIC, insurance, HDFC Life, ICICI Pru → insurance + personal
- Apollo, pharmacy, hospital, doctor, diagnostic, 1mg → medical + personal
- Google, AWS, Microsoft, Adobe, Notion, hosting → subscription_software + business
- Delhivery, BlueDart, DTDC, courier, India Post → freight_shipping + business
- ATM, cash withdrawal, bank charges, annual fee → bank_charges + business
- EMI, loan, NBFC → loan_emi + business
- Salary, employer name, monthly consistent credit → salary_wages + business (type: income)

IMPORTANT RULES:
- This is an Indian bank statement (SBI, HDFC, ICICI, Kotak, Axis, PNB, YES Bank, or similar)
- Extract EVERY transaction row — do not skip any
- Debit = expense, Credit = income
- Do NOT include opening/closing balance or summary rows
- Dates: DD-MM-YYYY or DD/MM/YYYY or DD-MMM-YYYY → return as YYYY-MM-DD
- Running balance column = ignore (not a transaction)
- Separate Debit/Credit columns → use non-zero one for amount and type
- Amounts as decimal (15000.00), NOT paise
- NEVER use "miscellaneous" if a specific category fits
- Self-transfers (NEFT/IMPS to own name or own account) → still extract but note it`

export const DEFAULT_SETTINGS = [
  {
    code: "default_currency",
    name: "Default Currency",
    description: "Don't change this setting if you already have multi-currency transactions. I won't recalculate them.",
    value: "INR",
  },
  {
    code: "default_category",
    name: "Default Category",
    description: "",
    value: "miscellaneous",
  },
  {
    code: "default_project",
    name: "Default Project",
    description: "",
    value: "business",
  },
  {
    code: "default_type",
    name: "Default Type",
    description: "",
    value: "expense",
  },
  {
    code: "prompt_analyse_new_file",
    name: "Prompt for Analyze Transaction",
    description: "Allowed variables: {fields}, {categories}, {categories.code}, {projects}, {projects.code}",
    value: DEFAULT_PROMPT_ANALYSE_NEW_FILE,
  },
  {
    code: "prompt_analyse_bank_statement",
    name: "Prompt for Bank Statement Parsing",
    description: "Specialized prompt for extracting transactions from Indian bank statement PDFs. Variables: {fields}",
    value: DEFAULT_PROMPT_ANALYSE_BANK_STATEMENT,
  },
  {
    code: "is_welcome_message_hidden",
    name: "Do not show welcome message on dashboard",
    description: "",
    value: "false",
  },
  {
    code: "business_gstin",
    name: "Your Business GSTIN",
    description: "Your 15-character GSTIN for auto-detecting inter-state transactions",
    value: "",
  },
  {
    code: "business_pan",
    name: "Your PAN",
    description: "Your 10-character PAN number",
    value: "",
  },
  {
    code: "business_state_code",
    name: "Your State Code",
    description: "2-digit state code from your GSTIN (e.g., 06 for Haryana, 07 for Delhi)",
    value: "",
  },
]

export const DEFAULT_CATEGORIES = [
  { code: "gst_taxable_goods", name: "GST Taxable Goods", color: "#064e85", llm_prompt: "goods with GST: raw materials, finished goods, components, inventory purchases" },
  { code: "gst_taxable_services", name: "GST Taxable Services", color: "#8753fb", llm_prompt: "services with GST: consulting, maintenance, SaaS subscriptions, professional services" },
  { code: "gst_exempt", name: "GST Exempt", color: "#2b5a1d", llm_prompt: "GST exempt items: fresh food, vegetables, unprocessed grains, healthcare, education services" },
  { code: "gst_zero_rated", name: "GST Zero-Rated", color: "#0e7d86", llm_prompt: "zero-rated GST: exports, supplies to SEZ, international services" },
  { code: "salary_wages", name: "Salary & Wages", color: "#ce4993", llm_prompt: "salary, wages, bonuses, commissions, stipends, gratuity" },
  { code: "professional_fees", name: "Professional Fees", color: "#6a0d83", llm_prompt: "CA fees, legal fees, consultant fees, advisory, audit fees" },
  { code: "rent", name: "Rent", color: "#050942", llm_prompt: "office rent, warehouse rent, equipment rental, co-working space" },
  { code: "interest_income", name: "Interest & Finance", color: "#c69713", llm_prompt: "bank interest, FD interest, loan EMI, finance charges, bank fees" },
  { code: "travel_conveyance", name: "Travel & Conveyance", color: "#fb9062", llm_prompt: "flights, trains, buses, fuel, tolls, parking, hotel, accommodation, cab, auto" },
  { code: "office_supplies", name: "Office Supplies", color: "#59b0b9", llm_prompt: "stationery, furniture, office equipment, computer peripherals" },
  { code: "communication", name: "Communication", color: "#0e7d86", llm_prompt: "mobile recharge, broadband, internet, postage, courier" },
  { code: "insurance", name: "Insurance", color: "#050942", llm_prompt: "health insurance, fire insurance, vehicle insurance, business insurance, LIC premium" },
  { code: "medical", name: "Medical & Health", color: "#ee5d6c", llm_prompt: "medical expenses, pharmacy, hospital bills, health checkup" },
  { code: "education", name: "Education & Training", color: "#ff8b32", llm_prompt: "courses, training, certifications, books, professional development, seminars" },
  { code: "maintenance_repairs", name: "Maintenance & Repairs", color: "#af7e2e", llm_prompt: "AMC, repairs, maintenance contracts, servicing, spare parts" },
  { code: "capital_expenditure", name: "Capital Expenditure", color: "#882727", llm_prompt: "capital assets: machinery, computers, vehicles, property improvements, plant & equipment" },
  { code: "depreciation", name: "Depreciation", color: "#800000", llm_prompt: "depreciation on fixed assets as per IT Act" },
  { code: "legal_professional", name: "Legal & Compliance", color: "#1e6359", llm_prompt: "legal fees, ROC filing, trademark, compliance, regulatory fees" },
  { code: "bank_charges", name: "Bank Charges", color: "#d40e70", llm_prompt: "bank charges, payment gateway fees, credit card charges, transaction fees" },
  { code: "government_fees", name: "Government Fees & Taxes", color: "#121216", llm_prompt: "stamp duty, property tax, GST payment, TDS payment, advance tax, challan, government fees" },
  { code: "miscellaneous", name: "Miscellaneous", color: "#1e202b", llm_prompt: "other, miscellaneous, uncategorized expenses" },

  // New categories for comprehensive Indian SME coverage
  { code: "food_beverages", name: "Food & Beverages", color: "#e67e22", llm_prompt: "meals, restaurant bills, tea/coffee, snacks, tiffin, canteen, zomato, swiggy, food delivery, dhaba, bakery, sweets" },
  { code: "vehicle_expenses", name: "Vehicle Expenses", color: "#2c3e50", llm_prompt: "fuel, petrol, diesel, car service, vehicle repairs, registration, road tax, fastag recharge, car wash, parking, toll" },
  { code: "utilities", name: "Utilities", color: "#16a085", llm_prompt: "electricity bill, water bill, gas connection, municipal charges, property tax, sewage" },
  { code: "marketing_advertising", name: "Marketing & Advertising", color: "#e74c3c", llm_prompt: "Google Ads, Facebook/Meta Ads, newspaper ads, pamphlets, hoardings, digital marketing, SEO services, social media promotion, influencer" },
  { code: "subscription_software", name: "Subscriptions & Software", color: "#3498db", llm_prompt: "SaaS subscriptions, cloud hosting, domain renewal, software licenses, AWS, Google Workspace, Microsoft 365, Zoho, hosting, server" },
  { code: "raw_materials", name: "Raw Materials & Inventory", color: "#8e44ad", llm_prompt: "raw materials, stock purchases, inventory, wholesale purchases, manufacturing inputs, packaging materials, components, trading goods" },
  { code: "freight_shipping", name: "Freight & Shipping", color: "#d35400", llm_prompt: "shipping charges, courier, Delhivery, BlueDart, DTDC, India Post, freight, logistics, packing charges, transportation of goods" },
  { code: "loan_emi", name: "Loan & EMI", color: "#c0392b", llm_prompt: "loan EMI, car loan, business loan, home loan, personal loan, interest payment, principal repayment, NBFC, bank loan" },
  { code: "donations", name: "Donations & CSR", color: "#27ae60", llm_prompt: "donations under 80G, CSR expenses, charity, trust donations, temple/religious donations, NGO contribution" },
  { code: "client_entertainment", name: "Client Entertainment", color: "#f39c12", llm_prompt: "client meetings, business dinners, hospitality, client gifts, event tickets, business entertainment" },
  { code: "ecommerce_fees", name: "E-Commerce & Platform Fees", color: "#9b59b6", llm_prompt: "Amazon commission, Flipkart fees, marketplace charges, payment gateway fees, Razorpay, Paytm commission, platform deductions" },
]

export const DEFAULT_PROJECTS = [
  { code: "personal", name: "Personal", llm_prompt: "personal expenses, household, non-business", color: "#1e202b" },
  { code: "business", name: "Business", llm_prompt: "business expenses, office operations, company", color: "#064e85" },
  { code: "rental_income", name: "Rental Income", llm_prompt: "rental income, property maintenance, tenant related, house property", color: "#2b5a1d" },
  { code: "capital_gains", name: "Capital Gains", llm_prompt: "investments, stocks, mutual funds, property sale, capital assets", color: "#c69713" },
  { code: "freelance", name: "Freelance / Consulting", llm_prompt: "freelance work, consulting, contract projects, gig work, client projects", color: "#8753fb" },

  // New projects for broader Indian business coverage
  { code: "construction", name: "Construction / Real Estate", llm_prompt: "construction, building, property development, site expenses, labor, material for construction, real estate", color: "#e67e22" },
  { code: "agriculture", name: "Agriculture / Farming", llm_prompt: "farming, agriculture, crop, seeds, fertilizer, tractor, harvest, farm equipment, mandi", color: "#27ae60" },
  { code: "ecommerce", name: "E-Commerce", llm_prompt: "online sales, Amazon, Flipkart, marketplace, e-commerce orders, returns, online store", color: "#3498db" },
  { code: "export_import", name: "Export / Import", llm_prompt: "exports, imports, customs duty, foreign trade, SEZ, international shipping, forex", color: "#9b59b6" },
]

export const DEFAULT_CURRENCIES = [
  { code: "INR", name: "₹" },
  { code: "USD", name: "$" },
  { code: "AED", name: "د.إ" },
  { code: "SGD", name: "$" },
  { code: "GBP", name: "£" },
  { code: "EUR", name: "€" },
  { code: "AUD", name: "$" },
  { code: "CAD", name: "$" },
  { code: "CHF", name: "Fr" },
  { code: "MYR", name: "RM" },
  { code: "JPY", name: "¥" },
  { code: "CNY", name: "¥" },
  { code: "NZD", name: "$" },
  { code: "THB", name: "฿" },
  { code: "HUF", name: "Ft" },
  { code: "HKD", name: "$" },
  { code: "MXN", name: "$" },
  { code: "ZAR", name: "R" },
  { code: "PHP", name: "₱" },
  { code: "SEK", name: "kr" },
  { code: "IDR", name: "Rp" },
  { code: "BRL", name: "R$" },
  { code: "SAR", name: "﷼" },
  { code: "TRY", name: "₺" },
  { code: "KES", name: "KSh" },
  { code: "KRW", name: "₩" },
  { code: "EGP", name: "£" },
  { code: "IQD", name: "ع.د" },
  { code: "NOK", name: "kr" },
  { code: "KWD", name: "د.ك" },
  { code: "RUB", name: "₽" },
  { code: "DKK", name: "kr" },
  { code: "PKR", name: "₨" },
  { code: "ILS", name: "₪" },
  { code: "PLN", name: "zł" },
  { code: "QAR", name: "﷼" },
  { code: "OMR", name: "﷼" },
  { code: "COP", name: "$" },
  { code: "CLP", name: "$" },
  { code: "TWD", name: "NT$" },
  { code: "ARS", name: "$" },
  { code: "CZK", name: "Kč" },
  { code: "VND", name: "₫" },
  { code: "MAD", name: "د.م." },
  { code: "JOD", name: "د.ا" },
  { code: "BHD", name: ".د.ب" },
  { code: "XOF", name: "CFA" },
  { code: "LKR", name: "₨" },
  { code: "UAH", name: "₴" },
  { code: "NGN", name: "₦" },
  { code: "TND", name: "د.ت" },
  { code: "UGX", name: "USh" },
  { code: "RON", name: "lei" },
  { code: "BDT", name: "৳" },
  { code: "PEN", name: "S/" },
  { code: "GEL", name: "₾" },
  { code: "XAF", name: "FCFA" },
  { code: "FJD", name: "$" },
  { code: "VEF", name: "Bs" },
  { code: "VES", name: "Bs.S" },
  { code: "BYN", name: "Br" },
  { code: "UZS", name: "лв" },
  { code: "BGN", name: "лв" },
  { code: "DZD", name: "د.ج" },
  { code: "IRR", name: "﷼" },
  { code: "DOP", name: "RD$" },
  { code: "ISK", name: "kr" },
  { code: "CRC", name: "₡" },
  { code: "SYP", name: "£" },
  { code: "JMD", name: "J$" },
  { code: "LYD", name: "ل.د" },
  { code: "GHS", name: "₵" },
  { code: "MUR", name: "₨" },
  { code: "AOA", name: "Kz" },
  { code: "UYU", name: "$U" },
  { code: "AFN", name: "؋" },
  { code: "LBP", name: "ل.ل" },
  { code: "XPF", name: "₣" },
  { code: "TTD", name: "TT$" },
  { code: "TZS", name: "TSh" },
  { code: "ALL", name: "Lek" },
  { code: "XCD", name: "$" },
  { code: "GTQ", name: "Q" },
  { code: "NPR", name: "₨" },
  { code: "BOB", name: "Bs." },
  { code: "ZWD", name: "Z$" },
  { code: "BBD", name: "$" },
  { code: "CUC", name: "$" },
  { code: "LAK", name: "₭" },
  { code: "BND", name: "$" },
  { code: "BWP", name: "P" },
  { code: "HNL", name: "L" },
  { code: "PYG", name: "₲" },
  { code: "ETB", name: "Br" },
  { code: "NAD", name: "$" },
  { code: "PGK", name: "K" },
  { code: "SDG", name: "ج.س." },
  { code: "MOP", name: "MOP$" },
  { code: "BMD", name: "$" },
  { code: "NIO", name: "C$" },
  { code: "BAM", name: "KM" },
  { code: "KZT", name: "₸" },
  { code: "PAB", name: "B/." },
  { code: "GYD", name: "$" },
  { code: "YER", name: "﷼" },
  { code: "MGA", name: "Ar" },
  { code: "KYD", name: "$" },
  { code: "MZN", name: "MT" },
  { code: "RSD", name: "дин." },
  { code: "SCR", name: "₨" },
  { code: "AMD", name: "֏" },
  { code: "AZN", name: "₼" },
  { code: "SBD", name: "$" },
  { code: "SLL", name: "Le" },
  { code: "TOP", name: "T$" },
  { code: "BZD", name: "BZ$" },
  { code: "GMD", name: "D" },
  { code: "MWK", name: "MK" },
  { code: "BIF", name: "FBu" },
  { code: "HTG", name: "G" },
  { code: "SOS", name: "S" },
  { code: "GNF", name: "FG" },
  { code: "MNT", name: "₮" },
  { code: "MVR", name: "Rf" },
  { code: "CDF", name: "FC" },
  { code: "STN", name: "Db" },
  { code: "TJS", name: "ЅМ" },
  { code: "KPW", name: "₩" },
  { code: "KGS", name: "лв" },
  { code: "LRD", name: "$" },
  { code: "LSL", name: "L" },
  { code: "MMK", name: "K" },
  { code: "GIP", name: "£" },
  { code: "MDL", name: "L" },
  { code: "CUP", name: "₱" },
  { code: "KHR", name: "៛" },
  { code: "MKD", name: "ден" },
  { code: "VUV", name: "VT" },
  { code: "ANG", name: "ƒ" },
  { code: "MRU", name: "UM" },
  { code: "SZL", name: "L" },
  { code: "CVE", name: "$" },
  { code: "SRD", name: "$" },
  { code: "SVC", name: "$" },
  { code: "BSD", name: "$" },
  { code: "RWF", name: "R₣" },
  { code: "AWG", name: "ƒ" },
  { code: "BTN", name: "Nu." },
  { code: "DJF", name: "Fdj" },
  { code: "KMF", name: "CF" },
  { code: "ERN", name: "Nfk" },
  { code: "FKP", name: "£" },
  { code: "SHP", name: "£" },
  { code: "WST", name: "WS$" },
  { code: "JEP", name: "£" },
  { code: "TMT", name: "m" },
  { code: "GGP", name: "£" },
  { code: "IMP", name: "£" },
  { code: "TVD", name: "$" },
  { code: "ZMW", name: "ZK" },
  { code: "ADA", name: "Crypto" },
  { code: "BCH", name: "Crypto" },
  { code: "BTC", name: "Crypto" },
  { code: "CLF", name: "UF" },
  { code: "CNH", name: "¥" },
  { code: "DOGE", name: "Crypto" },
  { code: "DOT", name: "Crypto" },
  { code: "ETH", name: "Crypto" },
  { code: "LINK", name: "Crypto" },
  { code: "LTC", name: "Crypto" },
  { code: "LUNA", name: "Crypto" },
  { code: "SLE", name: "Le" },
  { code: "UNI", name: "Crypto" },
  { code: "XBT", name: "Crypto" },
  { code: "XLM", name: "Crypto" },
  { code: "XRP", name: "Crypto" },
  { code: "ZWL", name: "$" },
]

export const DEFAULT_FIELDS = [
  // --- Standard fields (isExtra: false) — stored in Transaction table columns ---
  {
    code: "name",
    name: "Name",
    type: "string",
    llm_prompt: "human readable name, summarize what is bought or paid for in the invoice",
    isVisibleInList: true,
    isVisibleInAnalysis: true,
    isRequired: true,
    isExtra: false,
  },
  {
    code: "description",
    name: "Description",
    type: "string",
    llm_prompt: "description of the transaction",
    isVisibleInList: false,
    isVisibleInAnalysis: false,
    isRequired: false,
    isExtra: false,
  },
  {
    code: "merchant",
    name: "Merchant",
    type: "string",
    llm_prompt: "merchant or vendor name, use original spelling and language",
    isVisibleInList: true,
    isVisibleInAnalysis: true,
    isRequired: false,
    isExtra: false,
  },
  {
    code: "issuedAt",
    name: "Issued At",
    type: "string",
    llm_prompt: "issued at date in YYYY-MM-DD format. Indian dates are DD/MM/YYYY — convert to YYYY-MM-DD",
    isVisibleInList: true,
    isVisibleInAnalysis: true,
    isRequired: true,
    isExtra: false,
  },
  {
    code: "projectCode",
    name: "Project",
    type: "string",
    llm_prompt: "project code, one of: {projects.code}",
    isVisibleInList: true,
    isVisibleInAnalysis: true,
    isRequired: false,
    isExtra: false,
  },
  {
    code: "categoryCode",
    name: "Category",
    type: "string",
    llm_prompt: "category code, one of: {categories.code}",
    isVisibleInList: true,
    isVisibleInAnalysis: true,
    isRequired: false,
    isExtra: false,
  },
  {
    code: "files",
    name: "Files",
    type: "string",
    llm_prompt: "",
    isVisibleInList: true,
    isVisibleInAnalysis: true,
    isRequired: false,
    isExtra: false,
  },
  {
    code: "total",
    name: "Total",
    type: "number",
    llm_prompt: "grand total amount of the transaction including all taxes",
    isVisibleInList: true,
    isVisibleInAnalysis: true,
    isRequired: true,
    isExtra: false,
  },
  {
    code: "currencyCode",
    name: "Currency",
    type: "string",
    llm_prompt: "currency code, ISO 4217 three letter code like INR, USD, EUR, including crypto codes like BTC, ETH",
    isVisibleInList: false,
    isVisibleInAnalysis: true,
    isRequired: false,
    isExtra: false,
  },
  {
    code: "convertedTotal",
    name: "Converted Total",
    type: "number",
    llm_prompt: "",
    isVisibleInList: false,
    isVisibleInAnalysis: false,
    isRequired: false,
    isExtra: false,
  },
  {
    code: "convertedCurrencyCode",
    name: "Converted Currency Code",
    type: "string",
    llm_prompt: "",
    isVisibleInList: false,
    isVisibleInAnalysis: false,
    isRequired: false,
    isExtra: false,
  },
  {
    code: "type",
    name: "Type",
    type: "string",
    llm_prompt: "",
    isVisibleInList: false,
    isVisibleInAnalysis: true,
    isRequired: false,
    isExtra: false,
  },
  {
    code: "note",
    name: "Note",
    type: "string",
    llm_prompt: "",
    isVisibleInList: false,
    isVisibleInAnalysis: false,
    isRequired: false,
    isExtra: false,
  },
  {
    code: "text",
    name: "Extracted Text",
    type: "string",
    llm_prompt: "extract all recognised text from the document",
    isVisibleInList: false,
    isVisibleInAnalysis: false,
    isRequired: false,
    isExtra: false,
  },

  // --- Indian Tax Extra Fields (isExtra: true) — stored in Transaction.extra JSON ---

  // Invoice identification
  {
    code: "invoice_number",
    name: "Invoice No.",
    type: "string",
    llm_prompt: "invoice number or bill number from the document",
    isVisibleInList: true,
    isVisibleInAnalysis: true,
    isRequired: false,
    isExtra: true,
  },

  // GST fields
  {
    code: "gstin",
    name: "GSTIN",
    type: "string",
    llm_prompt: "GSTIN of the vendor or supplier. 15-character format: 2-digit state code + PAN + entity code + Z + check digit (e.g., 07AADCT1234A1Z0). Extract only if clearly visible.",
    isVisibleInList: true,
    isVisibleInAnalysis: true,
    isRequired: false,
    isExtra: true,
  },
  {
    code: "gst_rate",
    name: "GST Rate %",
    type: "number",
    llm_prompt: "GST rate in percentage. Must be one of: 0, 5, 12, 18, or 28. Determine from invoice line items or tax summary.",
    isVisibleInList: true,
    isVisibleInAnalysis: true,
    isRequired: false,
    isExtra: true,
  },
  {
    code: "cgst",
    name: "CGST Amount",
    type: "number",
    llm_prompt: "CGST (Central GST) amount as decimal number (e.g., 450.00). Present in intra-state transactions.",
    isVisibleInList: false,
    isVisibleInAnalysis: true,
    isRequired: false,
    isExtra: true,
  },
  {
    code: "sgst",
    name: "SGST Amount",
    type: "number",
    llm_prompt: "SGST (State GST) or UTGST amount as decimal number. Present in intra-state transactions.",
    isVisibleInList: false,
    isVisibleInAnalysis: true,
    isRequired: false,
    isExtra: true,
  },
  {
    code: "igst",
    name: "IGST Amount",
    type: "number",
    llm_prompt: "IGST (Integrated GST) amount as decimal number. Present in inter-state transactions.",
    isVisibleInList: false,
    isVisibleInAnalysis: true,
    isRequired: false,
    isExtra: true,
  },
  {
    code: "cess",
    name: "GST Cess",
    type: "number",
    llm_prompt: "GST Compensation Cess amount if applicable (luxury goods, tobacco, aerated drinks, motor vehicles).",
    isVisibleInList: false,
    isVisibleInAnalysis: false,
    isRequired: false,
    isExtra: true,
  },
  {
    code: "hsn_sac_code",
    name: "HSN/SAC Code",
    type: "string",
    llm_prompt: "HSN code (4-8 digit, for goods) or SAC code (6 digit starting with 99, for services). Extract if visible on invoice.",
    isVisibleInList: false,
    isVisibleInAnalysis: true,
    isRequired: false,
    isExtra: true,
  },
  {
    code: "place_of_supply",
    name: "Place of Supply",
    type: "string",
    llm_prompt: "state or union territory where goods/services are supplied (e.g., Haryana, Delhi, Maharashtra). Determine from address or GSTIN state code.",
    isVisibleInList: false,
    isVisibleInAnalysis: true,
    isRequired: false,
    isExtra: true,
  },
  {
    code: "supply_type",
    name: "Supply Type",
    type: "string",
    llm_prompt: "supply type classification: B2B (if buyer GSTIN present), B2CS (B2C small, total < 2.5 lakh without buyer GSTIN), B2CL (B2C large, total >= 2.5 lakh without buyer GSTIN), Export, SEZ, or Nil (no GST charged).",
    isVisibleInList: false,
    isVisibleInAnalysis: true,
    isRequired: false,
    isExtra: true,
  },
  {
    code: "reverse_charge",
    name: "Reverse Charge",
    type: "string",
    llm_prompt: "is reverse charge mechanism (RCM) applicable? Answer Yes or No.",
    isVisibleInList: false,
    isVisibleInAnalysis: false,
    isRequired: false,
    isExtra: true,
  },

  // TDS fields
  {
    code: "pan_number",
    name: "PAN",
    type: "string",
    llm_prompt: "PAN (Permanent Account Number) of vendor if visible. 10-character format: ABCDE1234F.",
    isVisibleInList: false,
    isVisibleInAnalysis: true,
    isRequired: false,
    isExtra: true,
  },
  {
    code: "tds_section",
    name: "TDS Section",
    type: "string",
    llm_prompt: "TDS section applicable if TDS is deducted: 194C (contractors), 194H (commission), 194I (rent), 194J (professional/technical), 194Q (purchase of goods), or other section number.",
    isVisibleInList: false,
    isVisibleInAnalysis: true,
    isRequired: false,
    isExtra: true,
  },
  {
    code: "tds_rate",
    name: "TDS Rate %",
    type: "number",
    llm_prompt: "TDS rate percentage if TDS is deducted.",
    isVisibleInList: false,
    isVisibleInAnalysis: false,
    isRequired: false,
    isExtra: true,
  },
  {
    code: "tds_amount",
    name: "TDS Amount",
    type: "number",
    llm_prompt: "TDS amount deducted as decimal number (e.g., 1000.00).",
    isVisibleInList: false,
    isVisibleInAnalysis: true,
    isRequired: false,
    isExtra: true,
  },

  // E-invoicing
  {
    code: "irn_number",
    name: "IRN (E-Invoice)",
    type: "string",
    llm_prompt: "Invoice Reference Number (IRN) for e-invoicing if present. 64-character hash.",
    isVisibleInList: false,
    isVisibleInAnalysis: false,
    isRequired: false,
    isExtra: true,
  },
]

export async function createUserDefaults(userId: string) {
  // Default projects
  for (const project of DEFAULT_PROJECTS) {
    await prisma.project.upsert({
      where: { userId_code: { code: project.code, userId } },
      update: { name: project.name, color: project.color, llm_prompt: project.llm_prompt },
      create: { ...project, userId },
    })
  }

  // Default categories
  for (const category of DEFAULT_CATEGORIES) {
    await prisma.category.upsert({
      where: { userId_code: { code: category.code, userId } },
      update: { name: category.name, color: category.color, llm_prompt: category.llm_prompt },
      create: { ...category, userId },
    })
  }

  // Default currencies
  for (const currency of DEFAULT_CURRENCIES) {
    await prisma.currency.upsert({
      where: { userId_code: { code: currency.code, userId } },
      update: { name: currency.name },
      create: { ...currency, userId },
    })
  }

  // Default fields
  for (const field of DEFAULT_FIELDS) {
    await prisma.field.upsert({
      where: { userId_code: { code: field.code, userId } },
      update: {
        name: field.name,
        type: field.type,
        llm_prompt: field.llm_prompt,
        isVisibleInList: field.isVisibleInList,
        isVisibleInAnalysis: field.isVisibleInAnalysis,
        isRequired: field.isRequired,
        isExtra: field.isExtra,
      },
      create: { ...field, userId },
    })
  }

  // Default settings
  for (const setting of DEFAULT_SETTINGS) {
    await prisma.setting.upsert({
      where: { userId_code: { code: setting.code, userId } },
      update: { name: setting.name, description: setting.description, value: setting.value },
      create: { ...setting, userId },
    })
  }
}

export async function isDatabaseEmpty(userId: string) {
  const fieldsCount = await prisma.field.count({ where: { userId } })
  return fieldsCount === 0
}
