# TaxHacker India — 90-Day Revenue Roadmap

**Objective**: Launch service-first monetization with Lodhi Real Estate as anchor customer by Monday (2026-04-08). Target ₹1L/month revenue by end of Q2 2026.

---

## 1. Product-Market Fit Hypothesis

### The Buyer Profile
- **Segment**: Real estate SMEs in NCR/Haryana (2-5 properties, 30-100 transactions/month)
- **Current pain**: Manual spreadsheets → GST compliance nightmare → slow accountants
- **Budget**: ₹3-8K/month for convenience
- **Trigger**: GST return deadline (due 10th of next month) → panic → willing to pay

### Why They Buy TaxHacker Service
1. **GSTR-1 deadlines** — Accountants miss deadlines, customers panic
2. **Instant profit visibility** — "How much did my rentals make?" (answered in minutes, not weeks)
3. **No upfront compliance cost** — Tally = ₹22.5K license, Zoho = ₹749/mo subscription
4. **Accountant-lite service** — AI extraction + bookkeeper validation = trust + speed

### Business Model Math
```
Revenue per customer:       ₹5,000/month
Bookkeeper cost:           ₹15,000/month (serves 5 customers)
Margin per customer:       ₹2,000/month

Scaling:
- Month 1:  1 customer (Lodhi)              = ₹5K/month      = ₹5K net (no bookkeeper yet)
- Month 2:  3 customers                     = ₹15K/month    = -₹15K net (hire bookkeeper)
- Month 3:  10 customers (2 bookkeepers)    = ₹50K/month    = ₹20K net
- Month 4:  20 customers (4 bookkeepers)    = ₹100K/month   = ₹40K net

Target: ₹1L revenue = ₹40K net profit at 20 customers
```

### Key Insight
**You're not selling software.** You're selling **"I handle your GST nightmare."** The software is just the efficiency tool for your bookkeeper.

---

## 2. MVP Feature Set (SHIPPED MONDAY)

### What Goes Live
✅ **Invoice upload** — Photos + PDFs
✅ **Claude Vision AI extraction** — Amounts, dates, vendors, GST amounts
✅ **GST categorization** — Automatic based on expense patterns
✅ **Transactions table** — Filterable by date/category
✅ **GSTR-1 export** — JSON + CSV format
✅ **Hardcoded login** — Single user mode, password-protected

### What You DON'T Build (Cut Everything Else)
❌ Custom fields
❌ Multi-currency
❌ Cryptocurrency
❌ GSTR-3B automation (Phase 2)
❌ Tally XML export
❌ Interactive dashboards
❌ Mobile app
❌ Multi-tenant support
❌ User registration
❌ Rate limiting (not needed for 1 user)

### What Already Exists (Don't Rewrite)
✅ Claude Vision OCR pipeline (works!)
✅ GST logic in `/lib/gstr1.ts`
✅ Transaction table UI components
✅ File upload infrastructure

### Target
**2-page app** (upload form + transaction list) live by EOD Monday.

---

## 3. First Customer Onboarding: Lodhi Realty

### Week 1 (Mon Apr 8)
- **Monday EOD**: Deploy to `taxhacker-lodhi.lodhirealestatebuildwell.in`
- **Pitch**: "AI reads invoices, extracts GST data → you get monthly GSTR-1 ready for CA"
- **Test batch**: 10 real invoices from Lodhi's rental portfolio
- **Accuracy target**: &gt;80% extraction (amounts, dates, vendors)

### Week 2 (Mon Apr 15)
- **Show results**: "Look, we processed your 10 invoices, GSTR-1 is ready"
- **Ask for commitment**: "Pay ₹5K/month for this?"
- **If yes** → Hire bookkeeper (₹15K/mo), train on daily uploads
- **If no** → Cut scope further (e.g., CSV exports only, skip GSTR)

### Weeks 3-4 (Mon Apr 22 onwards)
- **Service goes live**
- **Expectation setting**: "24-hour upload turnaround, monthly GSTR-1 by 25th"
- **Ask for referrals**: "Know other builders/realtors struggling with GST?"
- **Monthly invoice**: "TaxHacker Bookkeeping Service — ₹5,000/month"

---

## 4. Pricing Strategy

### Initial (First 5 Customers)
**Fixed price**: ₹5,000/month for complete service

**What's included**:
- Unlimited invoice uploads
- AI extraction + human validation
- Monthly GSTR-1 report generation
- 24-hour upload turnaround
- Bookkeeper review of anomalies

### Future Tiers (Month 2+, Once You Have 5+ Customers)
- **Basic**: ₹3,000/mo — DIY platform, GSTR-1 only, &lt;50 invoices/month
- **Pro**: ₹7,500/mo — Dedicated bookkeeper, unlimited invoices, P&amp;L report

**Why not tier now?** You need data on what works. One customer = one pricing model.

---

## 5. Retention Hooks (What Keeps Them Paying)

### Hook 1: Data Lock-In
After 3 months, customer has ₹15L+ in organized transactions. Migration is expensive.

### Hook 2: Compliance Deadline
GST return due on 10th → You deliver report on 8th → Customer is sticky.

### Hook 3: Weekly "Your Numbers" Email
```
"Hey [Customer],

12 invoices this week, ₹2.3L revenue, ₹41.4K GST collected.

⚠️ Flag: That ₹5L invoice from [Vendor] — legit one-off or recurring monthly?

Next GSTR due: 10 days (47 transactions pending)"
```

**What makes this work**: Takes bookkeeper 10 minutes, feels like magic to customer.

### Hook 4: WhatsApp Check-Ins
Bookkeeper weekly: "That ₹5L invoice — is that recurring monthly or one-time?"
→ Customer feels known + understood

### Hook 5: Compliance Calendar
- Apr 10: "GSTR due. 47 pending txns. Let's finalize."
- May 15: "TDS return due if you've paid contractors."
- Jun 30: "Quarterly GST summary ready."

### Anti-Churn Triggers
- **No uploads for 2 weeks** → Bookkeeper calls: "Haven't seen uploads, everything okay?"
- **No report opens for 30 days** → "Checking in — using the reports?"

---

## 6. 90-Day Revenue Sprint

| Phase | Weeks | Week 1-2 | Week 3-4 | Week 5-6 | Week 7-8 | Week 9-12 |
|-------|--------|----------|---------|----------|---------|-----------|
| **Goal** | Validation | Lodhi + trial | First paying customer | 3 customers | 5 customers | 10 customers |
| **Paying customers** | 0 | 1 | 1 | 3 | 5 | 10 |
| **Revenue** | ₹0 | ₹5K | ₹5K | ₹15K | ₹25K | ₹50K |
| **Invoices processed** | 20 | 100 | 300 | 900 | 1.5K | 3K |
| **Extraction accuracy** | 80% | 85% | 90% | 92% | 93% | 95% |
| **Hours/customer/month** | 30 | 25 | 20 | 15 | 12 | 10 |

---

## 7. Success Metrics (Track Weekly)

| Metric | What It Means | Target |
|--------|--------------|--------|
| **Paying customers** | Revenue is real | 1 by W2, 10 by W12 |
| **Revenue** | Money in bank | ₹5K by W2, ₹50K by W12 |
| **Customer satisfaction** | NPS score | &gt;7 by W4 |
| **Extraction accuracy** | AI working well | &gt;90% by W4 |
| **Churn rate** | Customer retention | &lt;5% monthly by W8 |
| **Referral rate** | Word-of-mouth | 1 referral per 5 customers |
| **Bookkeeper efficiency** | Labor cost | &lt;₹2K per customer/month by W8 |

---

## 8. The Ruthless Cut (What STAYS vs GOES)

### STAYS
- Upload form (simple, tested)
- Claude Vision OCR (working, accurate)
- GST categories (25 defaults, good enough)
- Transactions table (core data view)
- GSTR-1 export (highest-value feature)
- Hardcoded login (no complexity)
- VPS + Coolify (infrastructure proven)

### GOES
- Custom fields (ship later)
- Multi-currency (INR only, ship later)
- Dashboards (CSV reports are fine)
- Mobile app (not needed for service)
- API (not needed for 1 customer)
- GSTR-3B automation (ship in Phase 2)
- Claw integration (Phase 2, after revenue proven)

### OUTSOURCE to Bookkeeper
- Customer support (you answer email, bookkeeper calls)
- Anomaly detection (human review for edge cases)
- Reconciliation (bookkeeper validates AI extraction)
- Monthly report generation (template + fill-in)

---

## 9. Launch Checklist (Monday EOD)

- [ ] Lodhi instance live at `taxhacker-lodhi.lodhirealestatebuildwell.in`
- [ ] 10 real invoices tested, &gt;80% extraction accuracy
- [ ] Transactions table shows all 10 correctly
- [ ] GSTR-1 export works, can be opened in Excel
- [ ] Extraction &gt;80% accurate on amounts, dates, vendors
- [ ] HTTPS/SSL valid, no browser warnings
- [ ] Database backed up daily (automated)
- [ ] Adi shown full flow in-person
- [ ] Verbal commit to trial (or skepticism noted)
- [ ] Invoice template ready for Friday (if yes)

**Rule**: If it's not on this list, don't build it.

---

## 10. If Something Goes Wrong

| Problem | Solution | Time |
|---------|----------|------|
| Extraction crashes on PDF | Fall back to manual entry form | 2 hours coding |
| VPS down | Spin backup on Heroku, restore from S3 | 2 hours total |
| Customer wants custom fields | "After 3 paying customers, that's next phase" | — |
| Lodhi says no | You still own the software. Pivot to accountants or freelancers. | — |
| Accuracy &lt;80% | Add more training data + refine Claude prompt | 3 days |

---

## 11. The Bet

**Hypothesis**: Real estate SMEs in Haryana will pay ₹5K/month for bookkeeping convenience. A ₹3K bookkeeper serving 5 customers at ₹5K each = ₹2K margin that scales.

**Proof point**: If Lodhi uses it daily by Week 2 and converts by Week 4, the model works.

**If stalled by Week 4**: Pivot immediately:
- Option A: Drop to ₹3K/mo DIY tier (Lodhi self-serves)
- Option B: Pivot to accountants (sell to CA firms, not businesses)
- Option C: Offer free trial for bulk invoice processing (fee per invoice instead of monthly)

**Default action if unsure**: Ship Monday, get real data by Friday.

---

## 12. Next Steps (TODAY)

1. ✅ Read this roadmap (done)
2. 🔜 Call Adi in-person to confirm Lodhi as anchor customer
3. 🔜 Confirm he's willing to pay ₹5K/month
4. 🔜 Set Monday 9 AM as deployment deadline
5. 🔜 Identify bookkeeper candidate (₹15K/month budget)
6. 🔜 Collect 10-20 real Lodhi invoices for testing
7. 🔜 Get DNS access ready for `taxhacker-lodhi` subdomain

---

## 13. 90-Day Milestone Calendar

```
Mon Apr 08: MVP shipped, Lodhi testing starts
Fri Apr 11: Results shown to Adi, verbal OK or pivot decision
Mon Apr 15: Second customer identified via Lodhi referral (or cold outreach)
Fri Apr 18: Lodhi invoice processed, monthly service begins
Mon Apr 22: 3 customers total
Fri May 10: First GSTR-1 deadline met for all 3 customers
Mon May 20: 5 customers, hire 1st bookkeeper
Fri Jun 07: 10 customers, hire 2nd bookkeeper
Mon Jun 30: ₹50K/month revenue, ₹20K net profit, 100% service delivery

Target: $500+ MRR by June 30 = sustainable, hirable
```

---

## The Formula (One Page)

**Ship Monday.** Lodhi tests for 1 week. If accuracy &gt;80% and extraction looks good, pitch ₹5K/month service. If yes, hire bookkeeper on Friday to handle it. Get paid, scale to 10 customers by month 3, pocket ₹40K/month. That's real revenue.

**If Lodhi says no:** You still own the software. Iterate with freelancers or accountants instead.

---

*Generated by Product Lead Agent*
*Last updated: 2026-04-07*
