# TaxHacker India — Complete Product DNA

*Generated: 2026-03-29 | Version: 0.5.5 | Author: Himanshu Jain + Claude Code*

---

## 1. WHAT IS TAXHACKER (In Layman Terms)

TaxHacker is like having a **smart accountant inside your computer** that never sleeps.

You upload a photo of a bill, receipt, or invoice. The AI reads it, understands what it says (even in Hindi or mixed languages), figures out the GST amounts, the merchant name, the date, and puts it all into a clean, organized database. Then it can automatically generate your GSTR-1 filing report, calculate your tax liability, and export everything in formats that your CA can directly use.

**The key difference from Tally/Zoho:** You own your data. It runs on YOUR server. No monthly SaaS fees. No vendor lock-in. And AI does the data entry that humans hate.

---

## 2. ARCHITECTURE (Visual Map)

```
                    [Browser / Mobile]
                          |
                    [Traefik Proxy]
                          |
              +-----------+-----------+
              |    Next.js 15 App     |
              |   (React 19 + RSC)    |
              +-----------+-----------+
              |           |           |
         [Server      [API        [Middleware]
         Components]  Routes]     Auth + Rate Limit
              |           |           |
              +-----+-----+-----+----+
                    |           |
              [Prisma ORM]  [AI Layer]
                    |        LangChain
              [PostgreSQL]   |     |     |
                            Gemini OpenAI Mistral
                                         OpenRouter
              [File System]
              /app/data/uploads/
```

### Layer Architecture

| Layer | Purpose | Key Files |
|-------|---------|-----------|
| **UI** | React 19 components, Tailwind CSS, Radix UI, Lucide icons | `components/` |
| **Pages** | Next.js App Router, Server Components | `app/(app)/`, `app/(auth)/` |
| **API** | REST endpoints, Agent API, Health | `app/api/` |
| **Business Logic** | Models, validation, calculations | `models/`, `lib/`, `forms/` |
| **AI** | LLM orchestration, prompts, schemas | `ai/` |
| **Data** | PostgreSQL via Prisma, file storage | `prisma/`, uploads |
| **Infra** | Docker, Coolify, OVH VPS | `Dockerfile`, `docker-entrypoint.sh` |

---

## 3. COMPLETE FEATURE INVENTORY

### 3.1 Core Accounting
- Multi-currency transaction tracking (INR default, 150+ currencies)
- Income/expense classification with categories and projects
- File attachments per transaction (images, PDFs, docs)
- Drag-and-drop file upload with image optimization (Sharp)
- CSV import and export
- Date-range filtering with Indian Financial Year support
- Dashboard with spending charts and GST summary widget

### 3.2 AI Analysis Engine
- **4 LLM providers:** Google Gemini, OpenAI, Mistral, OpenRouter
- **Automatic failover:** If one provider fails, tries next
- **Retry logic:** Single retry per provider before moving on
- **Structured output:** JSON schema forces consistent field extraction
- **Vision capability:** Reads images/PDFs of invoices via multimodal LLM
- **PDF processing:** Ghostscript + GraphicsMagick convert pages to images
- **60+ merchant patterns** for Indian UPI/bank statement parsing
- **Personal vs business detection** in AI prompts

### 3.3 Indian Tax Features
- **GSTIN validation** with Luhn mod-36 checksum
- **PAN validation** with entity type detection
- **GST calculation** engine (inclusive/exclusive, CGST/SGST/IGST/Cess)
- **TDS rate lookup** for 10 sections (194C, 194H, 194I, 194J, etc.)
- **GSTR-1 report** with B2B/B2CL/B2CS/HSN classification
- **GSTR-3B summary** return generation
- **Place of supply** auto-detection from GSTIN
- **Inter-state vs intra-state** auto-classification
- **HSN/SAC code** extraction and grouping
- **Reverse charge** flag support

### 3.4 Invoice Generator
- Create professional invoices with business logo
- PDF export via @react-pdf/renderer
- Auto-populate from business settings

### 3.5 Agent API (External Integration)
- 9 REST endpoints with X-Agent-Key authentication
- Constant-time key comparison (timing attack resistant)
- Rate limiting (60 req/min)
- Endpoints: transactions CRUD, file upload, AI analyze, GSTR-1, GSTR-3B, daily digest, semantic search, embeddings

### 3.6 Embeddings & Semantic Search (Optional — requires pgvector)
- Google Gemini text-embedding-004 (768 dimensions)
- Duplicate transaction detection (cosine similarity > 0.92)
- Semantic search across all transactions
- Auto-embed on create/update (fire-and-forget)

### 3.7 Auth & Multi-tenancy
- **Self-hosted mode:** Single user, password-protected (SHA-256 hashed cookie)
- **Cloud mode:** Email OTP via Resend, JWT sessions, Stripe billing
- Better Auth library with Prisma adapter
- Rate limiting on auth endpoints (5 req/min per IP)

### 3.8 Infrastructure
- Docker multi-stage build (node:23-slim, standalone output)
- Health endpoint for Docker healthcheck
- Auto-migration on container start
- OVH VPS deployment via Coolify (Traefik reverse proxy)
- Sharp for image optimization
- Ghostscript + GraphicsMagick for PDF processing

---

## 4. DATABASE SCHEMA (11 Tables)

| Table | Records | Purpose |
|-------|---------|---------|
| `users` | 1 (self-hosted) | User profile, business info, storage limits |
| `sessions` | N | JWT session tokens (Better Auth) |
| `account` | N | OAuth provider accounts |
| `verification` | N | Email OTP codes |
| `settings` | ~20 per user | Key-value config (API keys, defaults, prompts) |
| `categories` | ~25 default | Expense/income categories with LLM hints |
| `projects` | ~8 default | Business projects (construction, ecommerce, etc.) |
| `fields` | ~25 default | Configurable form fields (standard + GST/TDS extras) |
| `files` | N | Uploaded documents (path, mimetype, cached AI results) |
| `transactions` | N | Core financial records with extra JSON for GST fields |
| `currencies` | ~150 | Currency definitions |
| `app_data` | N | Per-app persistent data (invoices, reports) |
| `progress` | N | Long-running task progress tracking |

**Key design decisions:**
- GST/TDS fields stored in `transactions.extra` JSON (not separate columns) — flexible schema
- `fields` table defines what the AI extracts — fully configurable per user
- `categories` and `projects` have `llm_prompt` to guide AI classification
- `files` has `cachedParseResult` to avoid re-analyzing

---

## 5. TECH STACK

| Component | Technology | Why |
|-----------|-----------|-----|
| Framework | Next.js 15, App Router | Server components, streaming, built-in API routes |
| UI | React 19, Tailwind CSS, Radix UI | Modern, accessible, performant |
| Database | PostgreSQL 18 | JSONB for flexible fields, pgvector for embeddings |
| ORM | Prisma 6.6 | Type-safe queries, migration management |
| AI | LangChain + 4 providers | Provider abstraction, structured output, retry logic |
| Auth | Better Auth | Lightweight, Prisma-native, email OTP |
| Payments | Stripe | Cloud billing (not used in self-hosted) |
| Email | Resend | Transactional emails |
| Image | Sharp + Ghostscript + GraphicsMagick | PDF→image, optimization, thumbnails |
| PDF Gen | @react-pdf/renderer | Invoice PDF generation |
| CSV | @fast-csv/format + @fast-csv/parse | Import/export |
| Validation | Zod | Schema validation (forms, config, API) |
| Monitoring | Sentry (optional) | Error tracking |
| Deploy | Docker + Coolify + OVH VPS | Self-hosted, no vendor dependency |

---

## 6. WHAT WE CHANGED (Session Summary)

| Change | Impact |
|--------|--------|
| Added Agent API (9 endpoints, 748 lines) | External agent integration |
| Added pgvector embeddings layer | Semantic search + duplicate detection |
| Added 11 new categories + 4 new projects | Better Indian SME coverage |
| Rewrote bank statement prompt (60+ patterns) | Accurate UPI/NEFT parsing |
| Enhanced invoice analysis prompt | Personal vs business detection |
| Fixed BigInt overflow (storageUsed > 2.1GB) | Schema: Int → BigInt |
| Fixed all BigInt type errors (5 files) | Number() at every boundary |
| Fixed healthcheck (created /api/health) | Deployment reliability |
| Fixed login cookie (HTTPS auto-detect) | Works behind Traefik proxy |
| Fixed login redirect (window.location.href) | Cookie race condition |
| Fixed standalone build crash (static app registry) | No fs.readdir at runtime |
| Fixed Gemini truncated JSON (maxOutputTokens 65536) | AI analysis works |
| Added raw text fallback for LLM parsing | Handles malformed structured output |
| Added env var fallback for LLM API keys | Self-hosted mode works |
| Removed required[] from items schema | Root cause of AI truncation |
| Hashed auth cookie (SHA-256) | Security: no raw password in cookie |
| Removed cache() from updateSettings | Settings mutations actually work |
| Fixed embedding amount (/100 removed) | Correct embedding text |
| Added production warning for default auth secret | Dev safety net |

---

## 7. SECURITY AUDIT — CURRENT STATE

### What We Have (Green)
- SHA-256 hashed auth cookie (just fixed)
- Constant-time API key comparison (timing attack resistant)
- Rate limiting on auth (5/min) and Agent API (60/min)
- Parameterized SQL queries (no SQL injection)
- httpOnly, sameSite cookies
- Non-root Docker user (uid 1001)
- Environment variable secrets (not in code)
- HTTPS auto-detection for secure cookies

### What We're Missing (Red — Compliance Gaps)

| Gap | Legal Requirement | Risk |
|-----|------------------|------|
| **No audit trail** | Companies Act 2023: mandatory immutable edit logs | Fine ₹50K-₹5L + imprisonment |
| **No encryption at rest** | DPDP Act + IT Act 43A: AES-256 required | Fine up to ₹250 crore |
| **No TLS enforcement** | Encryption in transit mandatory | DPDP violation |
| **VPS in France** | Financial data must be stored in India | RBI + Companies Act violation |
| **No incident response plan** | CERT-In: 6-hour reporting mandatory | Imprisonment + ₹1L fine |
| **No data retention policy** | Companies Act: 8-year retention | Companies Act violation |
| **No consent management** | DPDP Act: explicit consent required | Fine up to ₹200 crore |
| **No privacy policy** | DPDP Act + IT Act: mandatory | Fine + civil liability |
| **Tokens/keys in plaintext DB** | Should be encrypted | Data breach risk |

### What Should Be Added (Priority Order)

1. **Immutable audit trail** — Add `audit_log` table: `{id, userId, entityType, entityId, action, oldValue, newValue, createdAt}`. Every create/update/delete recorded. Cannot be modified or deleted.

2. **Data at rest encryption** — PostgreSQL TDE (Transparent Data Encryption) or application-level encryption for sensitive fields (API keys, business details).

3. **Move VPS to India** — OVH has Mumbai datacenter. Or use DigitalOcean/AWS Mumbai. Financial data localization is legally required.

4. **Privacy policy page** — Required by law. Must explain what data is collected, how it's used, retention period.

5. **TLS 1.3 enforcement** — Traefik already handles this via Coolify, but should be verified and enforced.

---

## 8. COMPLIANCE SCORECARD

| Requirement | Status | Priority |
|-------------|--------|----------|
| DPDP Act 2023 consent | NOT COMPLIANT | P0 |
| Immutable audit trail (Companies Act) | NOT COMPLIANT | P0 |
| AES-256 encryption at rest | NOT COMPLIANT | P0 |
| Data localization (India) | NOT COMPLIANT (VPS in France) | P0 |
| CERT-In incident reporting capability | NOT COMPLIANT | P1 |
| 8-year data retention | NOT IMPLEMENTED | P1 |
| Privacy policy | NOT PRESENT | P1 |
| TLS 1.3 in transit | PARTIAL (via Traefik) | P2 |
| E-invoice QR code (AATO ≥ ₹10Cr) | NOT IMPLEMENTED | P2 |
| GSTN API integration | NOT IMPLEMENTED | P2 |
| ISO 27001 certification | NOT APPLICABLE (self-hosted) | P3 |
| SOC 2 Type II | NOT APPLICABLE (self-hosted) | P3 |

---

## 9. COMPETITIVE POSITIONING

### Where TaxHacker Wins

| Advantage | TaxHacker | Tally (₹22,500) | Zoho Books (₹749/mo) | ClearTax |
|-----------|-----------|------|------|----------|
| AI invoice scanning | YES (4 providers) | NO (needs addon) | Basic automation | NO |
| Self-hosted/open-source | YES | NO | NO | NO |
| No recurring cost | YES (free) | One-time license | Monthly SaaS | Per-filing |
| GST auto-extraction from images | YES | NO | NO | NO |
| Multi-provider AI failover | YES | NO | NO | NO |
| Agent API for automation | YES | NO | Limited API | NO |
| Semantic search | YES (pgvector) | NO | NO | NO |
| Indian language support | YES (via LLM) | Hindi UI only | English only | Hindi UI |

### Where TaxHacker Loses

| Gap | Tally | Zoho Books |
|-----|-------|-----------|
| Offline-first | YES (desktop) | Mobile app |
| Payroll | YES | YES (Premium) |
| Inventory management | YES (advanced) | YES |
| Bank reconciliation | YES | YES |
| E-way bill generation | YES | YES |
| E-invoice IRP integration | YES | YES |
| Multi-user collaboration | YES (Gold) | YES |
| CA ecosystem/training | 70% trained on Tally | Growing |
| Audit trail | YES | YES |
| Payment gateway integration | YES | YES |

---

## 10. SCOPE — WHAT CAN BE ADDED

### Tier 1: Compliance Must-Haves (Before any users)

| Feature | Effort | Why |
|---------|--------|-----|
| Immutable audit trail | 2-3 days | Legally mandatory since April 2023 |
| Data-at-rest encryption | 1-2 days | DPDP Act requirement |
| Privacy policy + consent | 1 day | DPDP Act requirement |
| Move VPS to India (Mumbai) | 1 day | Financial data localization |
| Data retention policy | 0.5 day | Companies Act (8 years) |

### Tier 2: Market Parity (Compete with Zoho/Tally)

| Feature | Effort | Impact |
|---------|--------|--------|
| Bank statement CSV import (auto-reconciliation) | 3-4 days | Replaces manual entry |
| E-invoice generation (IRP JSON + QR code) | 3-4 days | Mandatory for ≥₹10Cr AATO |
| E-way bill generation | 2-3 days | Required for goods movement |
| Tally XML voucher export | 2-3 days | CA workflow integration |
| Multi-user support | 3-5 days | Team accounting |
| Offline-first PWA | 5-7 days | India's connectivity reality |
| Inventory management (basic) | 5-7 days | Retailers need this |

### Tier 3: Differentiation (What nobody else does)

| Feature | Effort | Moat |
|---------|--------|------|
| Chandra OCR (self-hosted, no API costs) | 3-5 days | Free unlimited scanning |
| WhatsApp receipt forwarding | 3-5 days | Forward receipt → auto-process |
| Hindi/regional language UI | 3-5 days | 60%+ Indians prefer Hindi |
| Account Aggregator (Setu API) | 5-7 days | Auto-fetch bank data |
| Predictive tax liability | 2-3 days | "You'll owe ₹X this quarter" |
| CA collaboration portal | 5-7 days | Share reports with CA securely |
| Mobile app (React Native) | 10-15 days | On-the-go receipt capture |
| Voice input ("paid ₹500 to Swiggy") | 2-3 days | Low-literacy users |

### Tier 4: VyapaarAI Vision (Long-term)

| Feature | What It Means |
|---------|---------------|
| CRM integration (Twenty) | Track customers alongside finances |
| ERP integration (ERPNext) | Full business operations |
| Payroll engine | Salary, PF, ESI calculations |
| GST filing via GSTN API | File directly from app |
| Razorpay payment collection | Accept payments + auto-reconcile |
| Multi-entity (group companies) | One dashboard, multiple GSTINs |

---

## 11. CONSTRAINTS

| Constraint | Impact | Mitigation |
|-----------|--------|------------|
| **Solo developer** | Can't build everything at once | Ship ugly, iterate fast |
| **VPS resources** (8 cores, 22GB RAM) | Can't run large AI models locally | Use API-based LLMs; Chandra 4B model fits |
| **No revenue yet** | Can't afford expensive APIs | Gemini free tier; self-hosted models |
| **Tally's 70% market lock** | CAs trained on Tally, resist switching | Don't replace Tally — complement it (Tally export) |
| **India's offline reality** | Cloud-only loses rural/tier-2 market | PWA + offline-first architecture |
| **Regulatory complexity** | GST rules change quarterly | Modular tax engine, configurable rules |
| **LLM hallucination risk** | AI might extract wrong GST amounts | Yellow warnings, never auto-file, human-in-loop |
| **No formal legal entity** | Can't get ISO/SOC certifications yet | Self-hosted model shifts liability to user |

---

## 12. PRODUCT VALIDATION CHECKLIST

### Before First Real User

- [ ] Audit trail implemented and immutable
- [ ] VPS moved to India (Mumbai datacenter)
- [ ] Privacy policy page exists
- [ ] Data retention policy documented
- [ ] TLS verified end-to-end
- [ ] Upload 10 real invoices → verify extraction accuracy > 80%
- [ ] Generate GSTR-1 → compare with manual calculation
- [ ] Export to Tally XML → import succeeds in Tally Prime trial
- [ ] Login/logout flow works behind reverse proxy
- [ ] File upload works for PDFs, images, docs
- [ ] AI analysis completes without errors for 10 consecutive files

### Before 10 Users

- [ ] Multi-user support tested
- [ ] Rate limiting verified under load
- [ ] Backup/restore procedure documented
- [ ] Error monitoring (Sentry) configured
- [ ] CERT-In incident response plan written
- [ ] Load test: 100 concurrent requests

### Before 100 Users

- [ ] ISO 27001 gap assessment
- [ ] Penetration test by third party
- [ ] GSTN API integration
- [ ] E-invoice IRP integration
- [ ] CA pilot program (5 CAs using it for their clients)

---

## 13. RECOMMENDED README/ABOUT REWRITE

### One-Liner
> AI-powered GST & tax assistant for Indian freelancers, MSMEs, and CAs — self-hosted, free, and privacy-first.

### Elevator Pitch (30 seconds)
> TaxHacker India is a self-hosted accounting tool that uses AI to read your invoices, receipts, and bank statements, automatically extract GST details, and generate GSTR-1/GSTR-3B reports. Unlike Tally (₹22,500) or Zoho Books (₹749/month), TaxHacker is free, runs on your own server, and your data never leaves your control. It supports 4 AI providers, validates GSTIN/PAN, calculates TDS, and exports in formats your CA can directly use.

### Feature Highlights (for README)
```
- Scan invoices with AI (Gemini, GPT-4, Mistral, OpenRouter)
- Auto-extract GST, TDS, HSN codes, merchant names
- Generate GSTR-1 and GSTR-3B reports
- Validate GSTIN (with checksum) and PAN numbers
- Calculate GST (CGST/SGST/IGST) automatically
- Export for Tally Prime, CA CSV, GST portal JSON
- 60+ UPI/bank narration patterns for statement parsing
- Semantic search across all transactions (pgvector)
- Agent API for automation (9 REST endpoints)
- Self-hosted: your data, your server, your rules
- Supports Hindi and mixed-language documents
- Free and open-source (fork of TaxHacker)
```

---

*This document should be updated every sprint. It is the single source of truth for what TaxHacker is, what it can do, and where it's going.*
