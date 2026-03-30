# TaxHacker India: Master Enhancement Plan

**Created:** 2026-03-28 | **Goal:** Fix core issues, then progressively enhance AI intelligence

---

## Phase A: Fix Core (Ship THIS WEEK)

Everything depends on AI analysis working. Fix blockers first.

### A1. Debug + Fix LLM Provider Error
**Priority:** CRITICAL — nothing else works without this
**Effort:** 1-2 hours

- [ ] SSH to VPS, try "Analyze with AI", read container logs for actual error
- [ ] Based on error message:
  - Model not found → change to `gemini-2.0-flash` (proven stable)
  - Structured output fail → update `@langchain/google-genai` to latest
  - Image format → fix Gemini image payload format
  - Quota/auth → regenerate key or add OpenRouter fallback
- [ ] Add OpenRouter key as fallback provider (free tier, OpenAI-compatible format)
- [ ] **Verify:** Upload a test invoice → AI extracts name, merchant, total, GST

### A2. Fix Apps Page (Already Pushed)
- [x] Static app registry instead of dynamic fs.readdir
- [ ] **Verify:** /apps page shows Invoice Generator, GSTR-1, GSTR-3B cards
- [ ] **Verify:** Invoice Generator opens and works

### A3. Add Missing Categories
**Priority:** HIGH — current categories miss 60% of Indian SME transactions
**Effort:** 30 min (just defaults.ts changes)

Add these 11 categories:
```
food_beverages       — meals, restaurants, zomato, swiggy, tea, snacks
vehicle_expenses     — fuel, petrol, diesel, car service, fastag, parking
utilities            — electricity, water, gas, municipal charges
marketing_advertising — Google/Meta ads, pamphlets, SEO, digital marketing
subscription_software — SaaS, cloud hosting, domains, software licenses
raw_materials        — raw materials, wholesale purchases, inventory, packaging
freight_shipping     — courier, Delhivery, BlueDart, logistics, shipping
loan_emi             — loan EMI, business/car/home loan, interest, principal
donations            — donations 80G, CSR, charity, trust
client_entertainment — client meetings, business dinners, hospitality, gifts
ecommerce_fees       — Amazon/Flipkart commission, marketplace fees, payment gateway
```

- [ ] Add to DEFAULT_CATEGORIES in `models/defaults.ts`
- [ ] **Verify:** New categories appear in Settings → Categories after reset

### A4. Add Missing Projects
**Effort:** 10 min

```
construction     — construction, building, property development, site, labor
agriculture      — farming, crops, seeds, fertilizer, tractor, harvest
ecommerce        — online sales, Amazon, Flipkart, marketplace, returns
export_import    — exports, imports, customs duty, foreign trade, SEZ
investments      — mutual funds, stocks, FD, bonds, demat
```

- [ ] Add to DEFAULT_PROJECTS in `models/defaults.ts`
- [ ] **Verify:** New projects appear in dropdown

### A5. Test Agent API on Production
- [ ] Generate API key: `POST /api/agent/setup`
- [ ] List transactions: `GET /api/agent/transactions`
- [ ] Get GST report: `GET /api/agent/gstr3b?period=032026`
- [ ] Get digest: `GET /api/agent/digest?date=today`

### Phase A Checkpoint:
> "Can I upload an invoice, get it AI-analyzed correctly, save it with the right category, and query it via Agent API?"
> If YES → proceed to Phase B. If NO → debug before moving on.

---

## Phase B: Smart Categorization (Week 2)

Make the AI categorize correctly without human intervention.

### B1. UPI Merchant Pattern Matching
**Priority:** HIGH — 80% of Indian transactions are UPI
**Effort:** 2-3 hours

Create `lib/merchant-patterns.ts`:
```typescript
// Pattern → category mapping for auto-categorization
const MERCHANT_PATTERNS: Array<{ patterns: RegExp[]; category: string; project: string }> = [
  // Food & Beverages
  { patterns: [/swiggy/i, /zomato/i, /restaurant/i, /cafe/i, /hotel.*food/i, /dhaba/i,
               /dominos/i, /pizza/i, /mcdonalds/i, /kfc/i, /starbucks/i, /misthan/i,
               /halwai/i, /bakery/i, /sweet/i, /bhojanalaya/i],
    category: "food_beverages", project: "personal" },

  // Vehicle
  { patterns: [/petrol/i, /fuel/i, /\bhp\b/i, /iocl/i, /bpcl/i, /shell/i,
               /fastag/i, /toll/i, /parking/i, /car.*wash/i, /garage/i],
    category: "vehicle_expenses", project: "business" },

  // Groceries (personal)
  { patterns: [/super.*bazaar/i, /grocery/i, /kirana/i, /bigbasket/i, /blinkit/i,
               /dmart/i, /reliance.*fresh/i, /more.*store/i, /departmental/i,
               /general.*store/i, /provision/i],
    category: "food_beverages", project: "personal" },

  // Telecom
  { patterns: [/airtel/i, /\bjio\b/i, /\bvi\b/i, /vodafone/i, /bsnl/i,
               /broadband/i, /internet/i, /wifi/i],
    category: "communication", project: "business" },

  // Utilities
  { patterns: [/electricity/i, /bijli/i, /power.*company/i, /water.*board/i,
               /gas.*connection/i, /municipal/i, /nagar.*nigam/i, /jal.*board/i],
    category: "utilities", project: "business" },

  // Transport
  { patterns: [/uber/i, /ola/i, /rapido/i, /irctc/i, /makemytrip/i,
               /goibibo/i, /redbus/i, /railways/i, /metro/i],
    category: "travel_conveyance", project: "business" },

  // E-commerce
  { patterns: [/amazon/i, /flipkart/i, /myntra/i, /meesho/i, /ajio/i],
    category: "office_supplies", project: "business" },

  // Insurance
  { patterns: [/lic\b/i, /insurance/i, /hdfc.*life/i, /icici.*pru/i,
               /max.*life/i, /sbi.*life/i, /bajaj.*allianz/i, /star.*health/i],
    category: "insurance", project: "personal" },

  // Medical
  { patterns: [/apollo/i, /medplus/i, /pharmacy/i, /hospital/i, /clinic/i,
               /doctor/i, /lab/i, /diagnostic/i, /netmeds/i, /1mg/i, /pharmeasy/i],
    category: "medical", project: "personal" },

  // Education
  { patterns: [/school/i, /college/i, /university/i, /udemy/i, /coursera/i,
               /tuition/i, /coaching/i, /books/i],
    category: "education", project: "personal" },

  // Software
  { patterns: [/google.*workspace/i, /microsoft/i, /adobe/i, /aws/i,
               /azure/i, /vercel/i, /github/i, /notion/i, /slack/i,
               /zoom/i, /canva/i, /chatgpt/i, /openai/i],
    category: "subscription_software", project: "business" },

  // Shipping
  { patterns: [/delhivery/i, /bluedart/i, /dtdc/i, /india.*post/i,
               /fedex/i, /ups/i, /ekart/i, /ecom.*express/i, /xpressbees/i],
    category: "freight_shipping", project: "business" },

  // Bank/ATM
  { patterns: [/atm/i, /cash.*withdrawal/i, /nwd/i, /bank.*charge/i,
               /annual.*fee/i, /sms.*alert/i, /debit.*card/i],
    category: "bank_charges", project: "business" },

  // Self-transfers (NOT a real expense/income)
  { patterns: [/self.*transfer/i, /own.*account/i, /neft.*self/i,
               /imps.*self/i, /fund.*transfer.*self/i],
    category: "miscellaneous", project: "personal" },
]
```

This module:
- Takes merchant name + narration → returns suggested category + project
- Used by the AI prompt as hints AND by a post-processing step
- Runs AFTER AI extraction to override bad categorizations

- [ ] Create `lib/merchant-patterns.ts`
- [ ] Integrate into bank statement analysis (post-processing)
- [ ] Add to AI prompt as examples
- [ ] **Verify:** "Puran Misthan Bhanda" → food_beverages/personal
- [ ] **Verify:** "HDFC Bank ATM" → bank_charges/business
- [ ] **Verify:** "Amazon" → office_supplies/business (or personal based on amount)

### B2. Enhanced Bank Statement Prompt
**Effort:** 1 hour (prompt engineering)

Upgrade `DEFAULT_PROMPT_ANALYSE_BANK_STATEMENT` to:
1. Better UPI narration parsing (extract name from UPI/xxx/NAME/bank format)
2. Auto-detect personal vs business by merchant type
3. Flag recurring transactions (hint: same amount + similar date)
4. Detect self-transfers (credit = debit to own account)
5. Detect salary (monthly, consistent amount, employer name)
6. Detect EMIs (monthly, exact amount, to bank/NBFC)

- [ ] Rewrite prompt in `models/defaults.ts`
- [ ] **Verify:** Upload a bank statement PDF → transactions categorized correctly

### B3. Smart Personal vs Business Detection
**Effort:** 1 hour

Add a post-processing step after AI extraction that:
1. Checks merchant against pattern database
2. Uses amount heuristics (small food = personal, large vendor payment = business)
3. Sets project to "personal" for detected personal expenses
4. Flags uncertain ones as "review needed" in the note field

- [ ] Create `lib/smart-categorize.ts`
- [ ] Hook into `analyzeTransaction()` result
- [ ] **Verify:** Grocery/restaurant/medical auto-marked as personal

### Phase B Checkpoint:
> "Can I upload a bank statement and get 80%+ of transactions correctly categorized as personal/business with the right category?"
> If YES → proceed to Phase C. If NO → refine patterns.

---

## Phase C: New Document Parsers (Week 3-4)

### C1. Credit Card Statement Parser
**Effort:** 2 hours (prompt + testing)

New prompt: `DEFAULT_PROMPT_ANALYSE_CREDIT_CARD`
- Parse statement period, due date, minimum payment
- Extract each transaction: date, merchant, amount, domestic/international
- Apply merchant pattern matching
- Detect cashback/reward points (don't count as income)
- Handle foreign currency transactions

- [ ] Write prompt
- [ ] Add document type detection (credit card vs bank statement vs invoice)
- [ ] **Verify:** Upload HDFC/ICICI credit card statement → all transactions extracted

### C2. Salary Slip Parser
**Effort:** 2 hours

New fields needed (add to defaults):
```
basic_pay, hra, special_allowance, conveyance_allowance,
pf_employee, pf_employer, esi_deduction, professional_tax,
tds_salary, gross_salary, net_salary, uan_number
```

New prompt: `DEFAULT_PROMPT_ANALYSE_SALARY_SLIP`
- Extract all components (basic, HRA, allowances)
- Extract all deductions (PF, ESI, PT, TDS)
- Calculate gross and net if not printed
- Extract UAN, employee ID, pay period

- [ ] Add salary fields to DEFAULT_FIELDS
- [ ] Write prompt
- [ ] **Verify:** Upload a salary slip → all components extracted

### C3. Form 16 / TDS Certificate Parser
**Effort:** 2 hours

New prompt: `DEFAULT_PROMPT_ANALYSE_FORM16`
- Extract: deductor name, TAN, PAN, assessment year
- Extract Part A: quarterly TDS amounts
- Extract Part B: gross salary, deductions under VI-A, tax computed
- Cross-reference with salary data

- [ ] Write prompt
- [ ] **Verify:** Upload Form 16 → deductor, TDS amounts, salary extracted

### C4. Auto Document Type Detection
**Effort:** 1 hour

Before running analysis, detect document type from content:
```
"Tax Invoice" / "Bill of Supply" / "GST" → invoice prompt
"Statement of Account" / "Opening Balance" → bank statement prompt
"Credit Card Statement" / "Billing Period" → credit card prompt
"Pay Slip" / "Salary" / "Basic Pay" / "PF" → salary prompt
"Form 16" / "TDS Certificate" / "TAN" → Form 16 prompt
```

Use first pass with Haiku (cheap) to classify, then full analysis with the right prompt.

- [ ] Create `lib/document-classifier.ts`
- [ ] Integrate into analysis pipeline
- [ ] **Verify:** Upload different documents → correct prompt used for each

### Phase C Checkpoint:
> "Can I upload any common Indian financial document and get it parsed correctly?"
> Bank statement, credit card, salary slip, invoice, Form 16 — all recognized and parsed.

---

## Phase D: Intelligence Layer (Month 2)

### D1. GST Math Verification
**Effort:** 1 hour

After AI extraction, verify:
- taxable_value + CGST + SGST = total (for intra-state)
- taxable_value + IGST = total (for inter-state)
- GST rate × taxable_value = tax amount
- Flag mismatches: "GST math doesn't add up. Check manually."

- [ ] Create `lib/gst-verifier.ts`
- [ ] Run after every analysis
- [ ] Show warnings in UI

### D2. ITC Eligibility Flagging
**Effort:** 1 hour

After categorization, check:
- food_beverages → ITC blocked (Section 17(5))
- client_entertainment → ITC blocked
- vehicle_expenses → ITC blocked (unless transport business)
- personal → ITC blocked
- No supplier GSTIN → ITC cannot be claimed

- [ ] Create `lib/itc-checker.ts`
- [ ] Add warning field to transaction display
- [ ] **Verify:** Restaurant bill flagged as "ITC blocked under S.17(5)"

### D3. Recurring Transaction Detection
**Effort:** 2 hours (needs embeddings)

Using pgvector embeddings:
- Find transactions with same merchant + similar amount + monthly interval
- Group into "recurring" patterns
- Suggest: "This looks like a monthly subscription. ₹499 to Netflix every month."
- Alert if recurring expected transaction is missing

- [ ] Create `lib/recurring-detector.ts`
- [ ] Cron job: run weekly, update recurring flags
- [ ] Agent API: `GET /api/agent/recurring` — list detected patterns

### D4. Self-Transfer Detection
**Effort:** 1 hour

When uploading bank statements from multiple accounts:
- Credit in Account A + Debit in Account B, same amount, same date = self-transfer
- These should NOT count as income or expense
- Flag as "internal transfer" and exclude from reports

- [ ] Detect during bank statement import
- [ ] Auto-flag matching pairs
- [ ] Exclude from GST/tax computations

### D5. Anomaly Alerts
**Effort:** 2 hours

Compare current period vs historical patterns:
- "Expenses 40% higher than last month average"
- "New vendor detected: ABC Corp (first transaction)"
- "Unusual transaction: ₹5L to unknown merchant"
- "3 invoices from same vendor on same day — check for duplicates"

- [ ] Create `lib/anomaly-detector.ts`
- [ ] Agent API: `GET /api/agent/alerts` — list current alerts
- [ ] Run as part of daily digest

### Phase D Checkpoint:
> "Does the system catch errors, flag issues, detect patterns, and proactively warn me?"
> GST math wrong → flagged. ITC blocked → flagged. Recurring missed → alerted. Anomaly → warned.

---

## Phase E: Polish + Ship (Month 2-3)

### E1. Upgrade LangChain Packages
- Update `@langchain/google-genai` to latest (better Gemini support)
- Update `@langchain/openai` to latest
- Test all providers after upgrade

### E2. Add Ollama/Local LLM Support
- Add Ollama as a provider option (zero-cost, runs on VPS)
- Good for: categorization, classification (small model)
- Keep cloud LLM for: OCR/vision tasks (needs multimodal)

### E3. Batch Processing
- Upload 50 files at once → queue them → process in background
- Progress bar for batch operations
- Email/notification when batch complete

### E4. CSV Import Enhancement
- Auto-detect bank: HDFC, SBI, ICICI, Kotak, Axis (different CSV formats)
- Map columns automatically based on header names
- Apply merchant patterns during import

---

## Execution Rules

1. **One phase at a time.** Don't start Phase B until Phase A checkpoint passes.
2. **Test after every step.** Each step has a verify checkbox — don't skip it.
3. **Commit after each step.** Small, atomic commits. Easy to rollback.
4. **Container logs are truth.** If something fails, check logs first, don't guess.
5. **Don't touch working code unnecessarily.** Add new files > modify existing.
6. **Categories/projects are DB data.** Changing defaults only affects NEW users. Existing users need a reset or manual add.

---

## Summary Timeline

| Phase | What | When | Outcome |
|-------|------|------|---------|
| **A** | Fix LLM + categories + apps + test API | This week | Basic AI works, all pages work |
| **B** | Smart categorization + UPI parsing | Week 2 | 80%+ auto-categorization accuracy |
| **C** | Credit card, salary, Form 16 parsers | Week 3-4 | All Indian document types supported |
| **D** | GST verification, ITC flags, anomalies | Month 2 | Proactive error catching |
| **E** | Local LLM, batch processing, CSV import | Month 2-3 | Production polish |
