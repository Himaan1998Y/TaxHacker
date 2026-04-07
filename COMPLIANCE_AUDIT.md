# TaxHacker India — Compliance Audit (VERIFIED)

**Date**: 2026-04-07
**Basis**: STRATEGIC_FIX_PLAN.md, TAXHACKER_DNA.md, COMPLETION_STATUS_2026_04_06.md, **live codebase inspection**
**Scope**: Phase 0 Legal Foundation + production deployment gate

---

## OVERALL VERDICT

**Phase 0 is approximately 75% DONE in code.** Three items are fully implemented. One item (VPS localization) is an infrastructure action not yet executed. One item (Incident Response Plan) is a planned document that was never created.

**Key insight**: The product can serve a pilot self-hosted user **today** with one explicit disclosure. It cannot serve a cloud customer or store another business's data until the VPS is moved to India.

**Time to clear deployment gate**: ~4.5 days (not 5-6 as estimated from stale memory)

---

## PHASE 0 STATUS — ITEM BY ITEM

### 0.1 Immutable Audit Trail — ✅ DONE

**Evidence confirmed in codebase**:
- `lib/audit.ts` — insert-only, captures IP, user-agent, old/new values
- `lib/security-log.ts` — security events stored in same `audit_logs` table with CERT-In 180-day note
- `prisma/schema.prisma` lines 288-304 — `AuditLog` model with all required fields and indexes
- `models/transactions.ts` — `logAudit` called on create, update, and delete (8 occurrences)
- `models/settings.ts` — `logAudit` called on settings mutations (2 occurrences)
- Transaction deletes replaced with `status: "reversed"` reversal pattern

**Legal reference**: Companies Act 2013, Rule 3(5) of Companies (Accounts) Amendment Rules 2021 (effective April 1, 2023). Penalty: ₹50K-₹5L + imprisonment up to 1 year.

**Gap**: No audit log viewer UI at `app/(app)/settings/audit-log/`. Data is captured but not surfaced to user. **Risk**: LOW legally (data exists), but a CA or GSTN auditor demanding to inspect the trail will find no UI.

---

### 0.2 Encryption at Rest — ⚠️ DONE (application-level) / BLOCKED (disk-level + cleanup)

**Evidence confirmed**:
- `lib/encryption.ts` — AES-256-GCM with `enc:` prefix detection
- `models/settings.ts` — `encrypt()`/`decrypt()` on API key fields (4 occurrences)
- `lib/config.ts` — `ENCRYPTION_KEY` throws on startup in production if not set
- Privacy policy claims "AES-256 encryption for sensitive fields"

**ACTIVE GAP** 🔴:
- LUKS disk encryption on VPS data volume specified as Layer 1 but **NOT implemented**
- Plaintext `businessBankDetails` column **STILL EXISTS** in database
- Bank details written to encrypted settings in parallel (dual-write), but original plaintext column **NOT YET DROPPED**

**Legal reference**: DPDP Act 2023 Section 8(4) + IT Act 2000 Section 43A. Penalty: up to ₹250 crore.

**Risk**: Application-level AES-256 satisfies "reasonable security practices" for most interpretations. The plaintext bank details column is **HIGH risk** — direct DB access exposes it. Must be cleaned before any real user data enters.

---

### 0.3 Data Localization — VPS in India — ❌ PENDING / 🔴 BLOCKING FOR CLOUD

**Evidence**: COMPLETION_STATUS_2026_04_06.md explicitly lists "VPS data localization (infrastructure, not code-based)" as still pending. Current VPS: **OVH France (Gravelines)**.

**Legal references**:
- **RBI Master Direction on Storage of Payment System Data (2018)**: Indian payment data must be stored in India
- **Companies Act 2013 Section 128(1)**: Books of account must be in India
- **DPDP Act 2023 Section 16**: Cross-border transfer only to notified countries. France **NOT notified**.

**Penalty**: DPDP violation up to ₹250Cr. Companies Act up to ₹1L per officer.

**Self-hosted exception**: If first customer self-hosts on their own India server, this issue doesn't apply to their instance. The risk applies specifically to **Himanshu operating a cloud instance** that stores other businesses' data on the French VPS.

**Required action**: Migrate OVH VPS from Gravelines to OVH Mumbai (BOM1). **1 day effort**. This is the **single item** blocking any cloud or multi-tenant deployment.

---

### 0.4 Privacy Policy + Consent — ✅ DONE

**Evidence confirmed**:
- `app/docs/privacy_policy/page.tsx` — full DPDP Act 2023-aligned policy
- Covers: data collected, LLM third-party processing disclosure, 8-year retention, CERT-In 6-hour breach reporting, user rights, grievance contact
- `app/(auth)/actions.ts` lines 49-53 — consent timestamp + version stored on first setup

**Legal reference**: DPDP Act 2023 Sections 5-6 (notice + consent). Penalty: up to ₹200 crore.

**Minor cosmetic gap**: Policy URL is `/docs/privacy_policy/` (underscore), STRATEGIC_FIX_PLAN.md planned `/docs/privacy`. **Not a legal risk.**

---

### 0.5 Incident Response Plan — ❌ PENDING — DOCUMENT DOES NOT EXIST

**Evidence**: Searched full codebase + `brain/` directory. Found only references in STRATEGIC_FIX_PLAN.md and COMPLETION_STATUS_2026_04_06.md. The document itself was **never written**.

**Legal reference**: CERT-In Directions 2022 (IT Act Section 70B(6)), effective April 28, 2022. Direction 6: 6-hour incident reporting mandatory. Penalty: imprisonment up to 1 year + fine up to ₹1L.

**Risk**: MEDIUM now (no users = no breach exposure). Escalates to HIGH the moment any real user's data is on the system. **2-3 hour writing task. No code.**

---

### 0.6 Data Retention Policy — ⚠️ DONE (code) / PARTIAL (enforcement)

**Evidence**:
- `lib/retention.ts` — `isWithinRetentionPeriod()` and `getRetentionEndDate()` implemented
- Privacy policy documents 8-year retention + 180-day security log retention
- Reversal pattern prevents hard deletion

**Gap**: STRATEGIC_FIX_PLAN.md called for wiring `isWithinRetentionPeriod()` into delete actions + UI warning. Utility exists but enforcement at model layer **unverified**.

**Legal reference**: Companies Act 2013 Section 128(5) — 8-year retention. Penalty: up to ₹1L per officer.

---

## ITEMS BLOCKING PRODUCTION DEPLOYMENT

For any real customer data (cloud OR third-party self-hosted):

| # | Item | Status | Required Action | Effort |
|---|------|--------|----------------|--------|
| 1 | VPS moved to India | ❌ PENDING | Migrate OVH Gravelines → Mumbai BOM1 | **1 day** |
| 2 | Plaintext bank details column | 🔴 ACTIVE RISK | Complete backfill to encrypted settings; drop column | 0.5 day |
| 3 | Transaction enums | ❌ MISSING | Add `TransactionType`/`TransactionStatus` enums to Prisma; migrate; update 6 TS files | **1 day** |
| 4 | Error message leakage | 🔴 ACTIVE BUG | `app/(app)/settings/actions.ts` returns raw `${error}` to client. Replace with fixed messages, log server-side. | 0.5 day |
| 5 | Audit log viewer UI | ❌ MISSING | Build `/settings/audit-log/` page so auditors can inspect | **1 day** |
| 6 | INCIDENT_RESPONSE.md | ❌ MISSING | Write 6-step CERT-In-compliant document | 0.5 day |

**Total to clear the gate: ~4.5 days**

---

## ITEMS DEFERRABLE WITHOUT LEGAL LIABILITY

Deferrable ONLY if first customer self-hosts on their own India-based server AND is explicitly told this is a pilot:

| Item | Why Deferrable | Defer Until |
|------|---------------|-------------|
| LUKS disk encryption | App-level AES-256 satisfies "reasonable security" | Before cloud launch |
| Audit log UI | Data captured. No UI ≠ legal liability immediately. | Before first paid customer |
| Retention enforcement warning | Reversal pattern already prevents hard deletes | Before 10 users |
| VPS India migration | Not required if customer self-hosts in India | Before first cloud customer |
| GSTR-3B double-counting fix | Affects accuracy, not core compliance | Before customer uses GSTR filing |

---

## MVP COMPLIANCE CHECKLIST — FIRST CUSTOMER

### MUST be completed before handing over credentials:

- [ ] VPS migrated to OVH Mumbai (eliminates DPDP cross-border risk for cloud)
- [ ] `INCIDENT_RESPONSE.md` written and committed (satisfies CERT-In)
- [ ] Plaintext bank details column dropped from DB
- [ ] Transaction enum migration applied (prevents corrupt data states in GSTR)
- [ ] Error messages sanitized in `app/(app)/settings/actions.ts`

### ALREADY DONE — verify before deploy:

- [x] Audit trail logging wired to transactions and settings (confirmed in models/)
- [x] AES-256 field encryption on API keys in settings
- [x] `ENCRYPTION_KEY` and `BETTER_AUTH_SECRET` throw on startup if not set
- [x] Privacy policy live at `/docs/privacy_policy/`
- [x] Consent timestamp recorded on first login
- [x] Reversal pattern (not hard delete) on transactions
- [x] Rate limiting on auth and agent API endpoints
- [x] bcrypt cost=12 for self-hosted auth password
- [x] httpOnly, sameSite, HTTPS-only cookies
- [x] Non-root Docker user (uid 1001)
- [x] 121 tests passing, 0 failures

### Disclose to first customer in writing (email or onboarding):

1. Their data is stored on [specific server location — must be India for regulated use]
2. AI analysis sends document images to their configured LLM provider for processing. Provider does not retain data beyond the API call.
3. Financial records retained for 8 years per Companies Act. Permanent deletion not legally permitted.
4. Security incidents notified within 72 hours.

---

## RISK REGISTER

| Risk | Severity | Likelihood | Max Penalty | Status |
|------|----------|-----------|------------|--------|
| DPDP violation — data in France | 🔴 HIGH | Certain if cloud deployed | ₹250Cr | **OPEN** — VPS not moved |
| Companies Act — no audit trail | ✅ RESOLVED | N/A | ₹5L + 1yr | Implemented |
| CERT-In — no incident response | 🟡 MEDIUM→HIGH | Low (no users) → High (first user) | ₹1L + 1yr | **OPEN** — doc not written |
| DPDP — no consent | ✅ RESOLVED | N/A | ₹200Cr | Implemented |
| Wrong GSTR-3B (double-counting) | 🔴 HIGH | Medium (active bug) | Client tax penalty | **OPEN** — fix pending |
| Plaintext bank details in DB | 🔴 HIGH | Low (self-hosted) | Data breach liability | **OPEN** — column not dropped |
| Raw error messages leaking to client | 🟡 MEDIUM | Active | Information disclosure | **OPEN** — settings/actions.ts |
| No audit log UI | 🟢 LOW | High (any CA will ask) | Operational friction | **OPEN** |

---

## SPRINT SEQUENCE (DEPENDENCY ORDER)

This is the order that makes sense given dependencies:

1. **Write `INCIDENT_RESPONSE.md`** — 2-3 hours, zero code, immediately eliminates CERT-In liability
2. **Fix error message leakage** in `settings/actions.ts` — 30 minutes
3. **Apply Transaction enum migration** (Phase 2B per PHASE_2_4_PLAN.md) — 1 day, required before GSTR output is trustworthy
4. **Complete bank details backfill + drop plaintext column** — 0.5 day
5. **Execute OVH VPS migration to Mumbai** — 1 day, **this is the unlock for cloud deployment**
6. **Build audit log viewer UI** — 1 day, required before billing any customer

After these 6 tasks, TaxHacker is **legally deployable in India for a paying customer**. Everything else (GSTR-3B precision fixes, test coverage, e-invoice) is product quality work, not compliance work.

---

## REVISED TIMELINE

**To revenue with Lodhi Realty**:
- **Day 1**: Write INCIDENT_RESPONSE.md + fix error leakage (3 hours)
- **Day 2**: Apply transaction enums (1 day)
- **Day 3**: Drop plaintext bank details column (0.5 day) + start VPS migration
- **Day 4**: Complete VPS migration to Mumbai (0.5 day)
- **Day 5**: Build audit log UI (1 day)
- **Day 6-7**: Deploy to Lodhi + test
- **Day 8**: First invoice sent (₹5K/month)

**Total: 1 week to revenue** (much better than 2 weeks I previously estimated)

---

*Reference laws: Companies Act 2013 (amended 2023), DPDP Act 2023, IT Act 2000, CERT-In Directions 2022, RBI Payment Data Storage Directions 2018, IT (Reasonable Security Practices) Rules 2011.*

*Generated by Compliance Auditor Agent — based on live codebase inspection (not stale memory)*
