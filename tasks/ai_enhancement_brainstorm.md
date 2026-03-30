# AI Enhancement Brainstorm: Smarter Data Intake

## What Can Be Uploaded Today

| Document Type | Support Level | Issues |
|--------------|--------------|--------|
| Tax invoices (GST) | Good | Works when LLM is working |
| Receipts (shops, restaurants) | Good | Basic extraction |
| Bank statements (PDF) | Has prompt | Separate prompt, multi-row extraction |
| UPI screenshots | Partial | Treated as generic invoice |
| Credit card statements | Not specific | No dedicated parsing logic |
| Salary slips | Not specific | Missing fields (PF, ESI, etc.) |
| Rent agreements | Not specific | No recurring setup |
| Insurance policies | Not specific | Missing premium/cover fields |
| Stock/MF statements | Not specific | No capital gains fields |
| Property documents | Not specific | No stamp duty/registration fields |
| E-way bills | Not specific | Has IRN but no e-way bill number |
| Government challans | Not specific | TDS/advance tax partially covered |

---

## CATEGORIES TO ADD

### Missing for Indian SMEs:
```
{ code: "food_beverages", name: "Food & Beverages", color: "#e67e22",
  llm_prompt: "meals, restaurant bills, tea/coffee, snacks, tiffin, canteen, zomato, swiggy orders" },

{ code: "vehicle_expenses", name: "Vehicle Expenses", color: "#2c3e50",
  llm_prompt: "fuel, petrol, diesel, car service, vehicle repairs, registration, road tax, fastag recharge, car wash" },

{ code: "utilities", name: "Utilities", color: "#16a085",
  llm_prompt: "electricity bill, water bill, gas connection, municipal charges" },

{ code: "marketing_advertising", name: "Marketing & Advertising", color: "#e74c3c",
  llm_prompt: "Google Ads, Facebook/Meta Ads, newspaper ads, pamphlets, hoardings, digital marketing, SEO services, social media promotion" },

{ code: "subscription_software", name: "Subscriptions & Software", color: "#3498db",
  llm_prompt: "SaaS subscriptions, cloud hosting, domain renewal, software licenses, AWS, Google Workspace, Microsoft 365, Zoho" },

{ code: "raw_materials", name: "Raw Materials & Inventory", color: "#8e44ad",
  llm_prompt: "raw materials, stock purchases, inventory, wholesale purchases, manufacturing inputs, packaging materials" },

{ code: "freight_shipping", name: "Freight & Shipping", color: "#d35400",
  llm_prompt: "shipping charges, courier, Delhivery, BlueDart, India Post, freight, logistics, packing, transportation of goods" },

{ code: "loan_emi", name: "Loan & EMI", color: "#c0392b",
  llm_prompt: "loan EMI, car loan, business loan, home loan, personal loan, interest payment, principal repayment" },

{ code: "donations", name: "Donations & CSR", color: "#27ae60",
  llm_prompt: "donations under 80G, CSR expenses, charity, trust donations, temple/religious donations" },

{ code: "client_entertainment", name: "Client Entertainment", color: "#f39c12",
  llm_prompt: "client meetings, business dinners, hospitality, client gifts, event tickets" },
```

### Missing Projects:
```
{ code: "construction", name: "Construction / Real Estate",
  llm_prompt: "construction, building, property development, site expenses, labor, material for construction", color: "#e67e22" },

{ code: "agriculture", name: "Agriculture / Farming",
  llm_prompt: "farming, agriculture, crop, seeds, fertilizer, tractor, harvest, farm equipment", color: "#27ae60" },

{ code: "ecommerce", name: "E-Commerce",
  llm_prompt: "online sales, Amazon, Flipkart, marketplace, e-commerce orders, returns", color: "#3498db" },

{ code: "export_import", name: "Export / Import",
  llm_prompt: "exports, imports, customs duty, foreign trade, SEZ, shipping international", color: "#9b59b6" },
```

---

## AI PROMPT ENHANCEMENTS

### Problem 1: Bank Statement UPI Parsing Is Too Basic

Current bank statement prompt doesn't understand UPI narration formats well. UPI narrations look like:
```
UPI/412845672/PAYING TO/9876543210@ybl/YES BANK
UPI-PURAN MISTHAN BHANDA-Q659510972@YBL-YESB0YBLUP1-409881329130
NEFT/N123456/ABC CORP/HDFC0001234
IMPS/123456789/RAJESH KUMAR/SBIN0001234
BIL/BPAY/000012345/BHARTI AIRTEL
EMI/HDFC/LOAN123456/EQUATED MONTHLY INSTALLMENT
ATM/CASH WDL/S1AB1234/12-MAR
```

### Enhanced Bank Statement Prompt:
Should add UPI ID extraction, auto-categorization based on narration patterns, and merchant name cleanup.

### Problem 2: Personal vs Business Not Detected

Looking at the screenshot — all UPI payments are categorized as "Business/Miscellaneous". Many of these are personal (Puran Misthan Bhanda = sweets shop, Family Super Bazaar = grocery). The AI should classify based on merchant type.

### Problem 3: Missing Document Types

Need dedicated parsers for:
1. **Credit card statements** — different format than bank statements
2. **Salary slips** — need PF, ESI, professional tax fields
3. **TDS certificates (Form 16/16A)** — need deductor details, tax deducted
4. **Property tax receipts** — need property details, assessment year
5. **Insurance premium receipts** — need policy number, type, cover amount
6. **Stock broker contract notes** — need STT, turnover, brokerage
7. **Mutual fund statements (CAS)** — need folio, NAV, units

---

## SMARTER AUTO-CATEGORIZATION

### By Merchant Name Pattern:
```
UPI patterns → category mapping:
- *SWIGGY*, *ZOMATO*, *RESTAURANT*, *HOTEL*, *CAFE* → food_beverages
- *PETROL*, *FUEL*, *HP*, *IOCL*, *BPCL*, *SHELL*, *FASTAG* → vehicle_expenses
- *AMAZON*, *FLIPKART*, *MYNTRA*, *MEESHO* → office_supplies or personal
- *AIRTEL*, *JIO*, *VI*, *BROADBAND*, *INTERNET* → communication
- *LIC*, *HDFC LIFE*, *ICICI PRUDENTIAL*, *INSURANCE* → insurance
- *APOLLO*, *MEDPLUS*, *PHARMACY*, *HOSPITAL*, *DOCTOR* → medical
- *UBER*, *OLA*, *RAPIDO*, *IRCTC*, *MAKEMYTRIP* → travel_conveyance
- *ELECTRICITY*, *WATER*, *GAS*, *MUNICIPAL* → utilities
- *GOOGLE*, *META*, *FACEBOOK*, *AWS*, *AZURE* → subscription_software
- *DELHIVERY*, *BLUEDART*, *DTDC*, *INDIA POST* → freight_shipping
```

### By Amount Pattern:
- Round amounts (₹5,000, ₹10,000, ₹50,000) → likely professional fees, rent, or EMI
- Small recurring amounts (₹99, ₹199, ₹299, ₹499) → subscriptions
- Very small amounts (<₹500) at food merchants → personal food
- Large amounts at specific intervals → rent, EMI, salary

### By Time Pattern:
- Same merchant, same amount, same day of month → recurring (rent, EMI, subscription)
- Same merchant, varying amounts, multiple times → regular vendor (classify by merchant category)
- One-off large amount → capital expenditure review

---

## WHAT THE ENHANCED PROMPT SHOULD DO

### For Invoice/Receipt Analysis:
1. Extract ALL existing fields (already good)
2. **Auto-detect document type**: tax invoice, bill of supply, receipt, proforma, quotation, delivery challan, debit note, credit note
3. **Verify GST math**: if taxable value + GST = total, flag if doesn't add up
4. **Detect ITC eligibility**: flag if this expense's ITC might be blocked (food, entertainment, personal vehicle)
5. **Suggest missing info**: "Invoice has GST but no GSTIN — ITC cannot be claimed without supplier GSTIN"

### For Bank Statement Analysis:
1. **Parse UPI narration intelligently**: extract payee name, UPI ID, bank reference
2. **Auto-categorize by merchant**: use the pattern matching above
3. **Detect personal vs business**: food/grocery/entertainment = personal, rent/salary/vendor = business
4. **Flag recurring transactions**: same amount + same merchant + monthly interval = recurring
5. **Identify loan EMIs**: same amount, monthly, to bank/NBFC = loan EMI
6. **Separate out transfers**: self-transfers between own accounts should be flagged, not categorized as expense/income
7. **Detect salary credits**: monthly, consistent amount, from employer = income/salary

### For Credit Card Statements:
1. Parse statement date, due date, minimum payment
2. Extract each transaction with date, merchant, amount
3. Auto-categorize by merchant name
4. Separate domestic vs international transactions (currency conversion)
5. Detect reward points/cashback as non-taxable

### For Salary Slips:
1. Extract: basic pay, HRA, special allowance, conveyance, medical
2. Extract deductions: PF (employee + employer), ESI, professional tax, TDS
3. Calculate: gross, net, CTC if visible
4. Store PF number, UAN if present
5. Auto-categorize as salary_wages income

---

## IMPLEMENTATION PRIORITY

### Phase A: Fix AI Analysis (This Week)
1. Debug actual LLM error from container logs
2. Add OpenRouter as fallback provider
3. Test with a sample invoice

### Phase B: Smarter Categorization (Next Week)
1. Add missing categories (food, vehicle, utilities, marketing, subscriptions, freight, EMI)
2. Add missing projects (construction, agriculture, ecommerce)
3. Add UPI merchant pattern matching to bank statement prompt
4. Add personal vs business detection logic

### Phase C: New Document Types (Week 3-4)
1. Credit card statement parser
2. Salary slip parser
3. TDS certificate (Form 16) parser
4. Insurance receipt parser

### Phase D: Smart Verification (Month 2)
1. GST math verification (taxable + tax = total)
2. ITC eligibility flagging
3. Duplicate detection via embeddings
4. Recurring transaction detection
5. Self-transfer detection (same person, opposite amounts)
