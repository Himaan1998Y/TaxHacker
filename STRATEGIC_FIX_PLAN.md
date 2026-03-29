# TaxHacker India — Strategic Fix Plan

**Premise:** Before the 100X vision (WhatsApp, voice, predictions), the foundation must be legally sound. This plan fixes everything in the right order — compliance first, then hardening, then market readiness.

**Thinking framework:** Aristotle's First Principles — what is the minimum irreducible foundation a financial software product needs to legally exist in India?

**Answer:** It needs 5 things: (1) an audit trail, (2) encrypted data, (3) data stored in India, (4) a privacy policy, (5) incident response capability. Everything else is features.

---

## PHASE 0: LEGAL FOUNDATION (Week 1) — "Permission to Exist"

*Without these, the product is legally inoperable for any Indian business.*

### 0.1 Immutable Audit Trail

**Why:** Companies Act 2023 — mandatory since April 1, 2023 for ALL companies. Personal liability for directors. Fine ₹50K-₹5L + up to 1 year imprisonment.

**What to build:**

New table `audit_logs`:
```sql
CREATE TABLE audit_logs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES users(id),
  entity_type   TEXT NOT NULL,        -- 'transaction', 'file', 'setting', 'category'
  entity_id     UUID NOT NULL,
  action        TEXT NOT NULL,        -- 'create', 'update', 'delete'
  old_value     JSONB,               -- snapshot before change
  new_value     JSONB,               -- snapshot after change
  ip_address    TEXT,
  user_agent    TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- CRITICAL: No UPDATE or DELETE permissions on this table
-- Only INSERT allowed. This makes it legally immutable.
CREATE INDEX idx_audit_entity ON audit_logs(entity_type, entity_id);
CREATE INDEX idx_audit_user ON audit_logs(user_id);
CREATE INDEX idx_audit_date ON audit_logs(created_at);
```

**Implementation approach:**
- Add Prisma `audit_logs` model (insert-only)
- Create `lib/audit.ts` with `logAudit(userId, entityType, entityId, action, oldValue, newValue)`
- Hook into every model mutation: `createTransaction`, `updateTransaction`, `deleteTransaction`, `updateSettings`, `updateUser`
- Middleware captures `ip_address` and `user_agent` from request headers
- **No soft deletes** — transactions get `status: 'reversed'` instead of being deleted
- Add `/settings/audit-log` page showing read-only audit history with filters

**Files to create:**
- `prisma/migrations/XXX_add_audit_trail.sql`
- `lib/audit.ts`
- `app/(app)/settings/audit-log/page.tsx`
- `components/settings/audit-log-viewer.tsx`

**Files to modify:**
- `prisma/schema.prisma` — add AuditLog model
- `models/transactions.ts` — wrap create/update/delete with audit logging
- `models/settings.ts` — audit log on setting changes
- `models/files.ts` — audit log on file operations

**Verification:**
1. Create a transaction → audit_logs has entry with action='create', new_value={...}
2. Edit the transaction → audit_logs has entry with action='update', old_value and new_value
3. Delete transaction → audit_logs has entry with action='delete', old_value={...}
4. Try `DELETE FROM audit_logs` via psql → fails (if using RLS) or at least never called from app code
5. Audit log viewer shows chronological history with entity links

**Effort:** 2-3 days

---

### 0.2 Encryption at Rest

**Why:** DPDP Act 2023 + IT Act Section 43A require "reasonable security practices" including encryption. Financial data (invoices, bank details, tax numbers) is classified as "sensitive personal data."

**What to build:**

Two layers:

**Layer 1: PostgreSQL-level (TDE)**
- Coolify's PostgreSQL doesn't support native TDE
- Alternative: Use LUKS full-disk encryption on the VPS data volume
- `ssh root@vps → cryptsetup luksFormat /dev/sdb → mount encrypted`

**Layer 2: Application-level field encryption (for sensitive fields)**
- Encrypt these fields before writing to DB: `businessBankDetails`, `businessAddress`, all API keys in `settings`
- Use `aes-256-gcm` with a master key from environment variable
- Create `lib/encryption.ts`:

```typescript
import crypto from 'crypto'

const ALGORITHM = 'aes-256-gcm'
const KEY = Buffer.from(process.env.ENCRYPTION_KEY!, 'hex') // 32 bytes

export function encrypt(text: string): string {
  const iv = crypto.randomBytes(16)
  const cipher = crypto.createCipheriv(ALGORITHM, KEY, iv)
  let encrypted = cipher.update(text, 'utf8', 'hex')
  encrypted += cipher.final('hex')
  const tag = cipher.getAuthTag().toString('hex')
  return `${iv.toString('hex')}:${tag}:${encrypted}`
}

export function decrypt(data: string): string {
  const [ivHex, tagHex, encrypted] = data.split(':')
  const decipher = crypto.createDecipheriv(ALGORITHM, KEY, Buffer.from(ivHex, 'hex'))
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'))
  let decrypted = decipher.update(encrypted, 'hex', 'utf8')
  decrypted += decipher.final('utf8')
  return decrypted
}
```

**Files to create:**
- `lib/encryption.ts`

**Files to modify:**
- `models/settings.ts` — encrypt API key values on write, decrypt on read
- `models/users.ts` — encrypt businessBankDetails on write
- `lib/config.ts` — add `ENCRYPTION_KEY` env var requirement
- `docker-entrypoint.sh` — generate key if not provided

**Env var to add in Coolify:**
- `ENCRYPTION_KEY` — 64 hex chars (32 bytes). Generate: `openssl rand -hex 32`

**Verification:**
1. Set a Google API key in settings → check DB: value is `iv:tag:ciphertext`, not plaintext
2. Settings page still shows the key correctly (decrypted in app)
3. `psql → SELECT value FROM settings WHERE code='google_api_key'` → encrypted gibberish

**Effort:** 1-2 days

---

### 0.3 Data Localization — Move VPS to India

**Why:** RBI mandate (2018) — payment data must be in India. Companies Act — financial records must be in India. DPDP Act — allowed but restricted cross-border transfers. Our VPS is currently in France (OVH Gravelines).

**What to do:**

**Option A: OVH Mumbai (cheapest, same provider)**
- OVH has a Mumbai datacenter (BOM1)
- Same VPS plan, same Coolify setup
- Migration: export Coolify config → provision new VPS → import → update DNS

**Option B: DigitalOcean Bangalore (BLR1)**
- ₹2,800/mo for 8GB droplet
- Better India connectivity
- Managed PostgreSQL available

**Option C: Hetzner (no India DC) — NOT COMPLIANT**

**Recommended:** Option A (OVH Mumbai) — same provider, same tools, same price.

**Migration steps:**
1. Provision OVH VPS in Mumbai (same specs: 8 cores, 22GB RAM)
2. Install Coolify on new VPS
3. Export PostgreSQL dump from old VPS: `pg_dump > taxhacker_backup.sql`
4. Transfer backup + upload files via rsync
5. Import on new VPS: `psql < taxhacker_backup.sql`
6. Deploy TaxHacker on new Coolify
7. Update DNS to point to new IP
8. Verify everything works
9. Decommission old VPS after 48hr monitoring

**Effort:** 1 day (provisioning + migration)

---

### 0.4 Privacy Policy + Consent

**Why:** DPDP Act 2023 — mandatory privacy policy. Must explain what data is collected, why, how long it's retained, and user rights.

**What to build:**

Create `/docs/privacy` page with:
- What data we collect (transactions, files, business info)
- Why we collect it (accounting, tax compliance)
- How long we keep it (8 years per Companies Act, then deleted)
- Who has access (only the user; self-hosted = user controls everything)
- Third-party services (LLM APIs: data sent for analysis only, not stored by providers)
- User rights (access, correction, deletion — within retention requirements)
- Data breach notification (within 72 hours to user, 6 hours to CERT-In)
- Contact information

**For self-hosted mode:** Add a first-login consent screen:
- "Your data is stored on this server only. AI analysis sends document images to [selected LLM provider] for processing. By continuing, you consent to this data processing."
- Checkbox required before first use
- Store consent timestamp in settings table

**Files to create:**
- `app/docs/privacy/page.tsx` — full privacy policy
- `components/auth/consent-screen.tsx` — first-use consent

**Files to modify:**
- `app/(auth)/actions.ts` — add consent recording on first setup
- `models/settings.ts` — store `consent_timestamp` and `consent_version`

**Effort:** 1 day

---

### 0.5 Incident Response Plan

**Why:** CERT-In Directions 2022 — mandatory 6-hour incident reporting for all organizations. Up to 1 year imprisonment for non-compliance.

**What to build:**

This is a document, not code. Create `INCIDENT_RESPONSE.md`:

```
INCIDENT RESPONSE PLAN — TaxHacker India

1. DETECTION
   - Monitor: Sentry alerts, VPS monitoring, Coolify health checks
   - Classify: Data breach / unauthorized access / malware / DDoS / other

2. CONTAINMENT (Within 1 hour)
   - Isolate affected containers
   - Rotate all API keys and secrets
   - Block suspicious IPs

3. REPORTING (Within 6 hours — CERT-In mandatory)
   - Report to: incident@cert-in.org.in
   - Include: nature of incident, systems affected, data potentially exposed
   - Use CERT-In reporting format

4. NOTIFICATION (Within 72 hours — DPDP Act)
   - Notify all affected users
   - Explain what data was potentially exposed
   - Explain remediation steps

5. RECOVERY
   - Restore from last clean backup
   - Patch vulnerability
   - Update all credentials

6. POST-MORTEM
   - Root cause analysis
   - Update security controls
   - Document lessons learned
```

**Also configure:**
- Sentry alerts → email notification
- VPS monitoring (Coolify built-in) → alert on anomalies
- Add `security@taxhackerindia.in` email alias

**Effort:** 0.5 day

---

### 0.6 Data Retention Policy

**Why:** Companies Act — financial records must be retained for 8 years. Audit trail must be retained for 8 years. Cannot delete financial data before this period.

**What to build:**

Add to privacy policy page:
- Financial transactions: retained for 8 years from creation
- Audit logs: retained for 8 years from creation (immutable)
- Uploaded files: retained for 8 years
- User account data: retained until deletion request + 8 years for financial records
- AI analysis cache: retained with associated file

In code:
- **Prevent deletion of transactions older than current FY** (or add warning)
- Add `models/retention.ts` with `isWithinRetentionPeriod(date)` check
- Hook into delete actions: warn if trying to delete within retention period

**Files to create:**
- `lib/retention.ts`

**Files to modify:**
- `models/transactions.ts` — check retention before hard delete
- Transaction delete UI — show warning

**Effort:** 0.5 day

---

## PHASE 0 TOTAL: ~6-7 days

**Deliverable:** A legally compliant financial software product that can serve real Indian businesses.

---

## PHASE 1: SECURITY HARDENING (Week 2) — "Lock the Doors"

*These don't have specific legal penalties but are professional security standards.*

### 1.1 TLS Verification

- Verify Traefik auto-provisions Let's Encrypt certificates
- Test: `curl -vI https://[domain]` → TLS 1.3
- Add HSTS header in Next.js config: `Strict-Transport-Security: max-age=31536000`
- Add to `next.config.ts`:
```typescript
headers: async () => [{
  source: '/(.*)',
  headers: [
    { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
    { key: 'X-Content-Type-Options', value: 'nosniff' },
    { key: 'X-Frame-Options', value: 'DENY' },
    { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  ]
}]
```

**Effort:** 0.5 day

### 1.2 Rate Limiting Hardening

Current state: auth endpoints have 5/min limit. Agent API has 60/min.

**Add:**
- Global rate limit: 100 req/min per IP on all routes
- File upload limit: 10/min per user
- AI analysis limit: 20/min per user (protect LLM API costs)

**Modify:** `lib/rate-limit.ts` — add per-route configs

**Effort:** 0.5 day

### 1.3 Input Sanitization Audit

- Verify all user inputs go through Zod validation (already true for forms)
- Check: file upload MIME type validation (already in place)
- Check: filename sanitization for path traversal (`safePathJoin` exists)
- Add CSP header to prevent XSS: `Content-Security-Policy: default-src 'self'`

**Effort:** 0.5 day

### 1.4 Backup Automation

- Add daily PostgreSQL backup cron on VPS
- `pg_dump --format=custom > /backups/taxhacker_$(date +%Y%m%d).dump`
- Retain 30 daily + 12 monthly backups
- Test restore procedure quarterly

**Effort:** 0.5 day

### 1.5 Security Logging

- Log all auth attempts (success + failure) with IP and user-agent
- Log all file uploads with filename and size
- Log all API key usage
- Retain logs for 180 days (CERT-In requirement)
- Store in separate `security_logs` table (not mixed with app logs)

**Effort:** 1 day

---

## PHASE 1 TOTAL: ~3 days

---

## PHASE 2: PRODUCT HARDENING (Week 3) — "Make It Reliable"

### 2.1 Error Handling Audit

- Every server action should return `{ success: boolean, error?: string }` (most already do)
- Add global error boundary component
- Configure Sentry with proper DSN
- Add user-visible error messages (not raw stack traces)

**Effort:** 1 day

### 2.2 Transaction Amount Storage

**Current issue:** `Transaction.total` is `Int` (paise). Amounts stored as integer cents. But `form` converts `total * 100` on save and `/ 100` on display. This is correct but fragile.

**Verify:** All import/export paths handle the paise conversion consistently:
- CSV export: divide by 100
- CSV import: multiply by 100
- Agent API: document whether API accepts rupees or paise
- Embeddings: already fixed (no longer divides by 100)

**Effort:** 0.5 day (audit only, fix if inconsistent)

### 2.3 Testing Foundation

- Add at least smoke tests for critical paths:
  - `POST /api/health` returns 200
  - `POST /api/self-hosted-auth` with correct password returns cookie
  - Transaction CRUD operations work
  - GSTIN validation returns correct results
  - GST calculation produces correct numbers
- Use Vitest (compatible with Next.js)
- Run in CI before deploy

**Effort:** 2-3 days

### 2.4 Transaction Reversal (Not Deletion)

Per audit trail compliance, posted financial data should NOT be deleted — only reversed.

- Change `deleteTransaction` to create a reversal entry (negative amount, same details)
- Mark original as `status: 'reversed'`
- Add `status` field to Transaction schema: `'active' | 'reversed'`
- Filter reversed transactions from default views
- Show reversed transactions with strikethrough in audit view

**Effort:** 1-2 days

---

## PHASE 2 TOTAL: ~5-6 days

---

## PHASE 3: MARKET READINESS (Week 4) — "Ship It"

### 3.1 Tally XML Export

Already designed in sprint plans. Build the `lib/tally-export.ts`:
- Map transaction types to Tally voucher types
- Generate proper ledger entries for GST
- Export as valid Tally Prime XML

**Effort:** 2-3 days

### 3.2 E-Invoice QR Code

For businesses with AATO ≥ ₹10Cr:
- Generate e-invoice JSON in IRP format
- Generate QR code (290x290px minimum) with required parameters
- Add QR to invoice PDF export

**Effort:** 2-3 days

### 3.3 Landing Page + SEO

- robots.txt + sitemap.xml
- JSON-LD structured data
- OG image for social sharing
- Feature-complete landing page with Indian positioning

**Effort:** 1-2 days

### 3.4 Onboarding Flow

First-time user experience:
1. Login → consent screen → accept
2. Set business name, GSTIN, PAN, state
3. Choose LLM provider (or use env var default)
4. Upload first invoice → AI demo
5. Show GSTR-1 preview

**Effort:** 1-2 days

---

## PHASE 3 TOTAL: ~7-8 days

---

## EXECUTION TIMELINE

```
Week 1: PHASE 0 — Legal Foundation
├── Day 1-3: Audit trail (schema + model hooks + viewer)
├── Day 3-4: Encryption at rest (lib + field-level)
├── Day 4:   VPS migration to India (Mumbai)
├── Day 5:   Privacy policy + consent screen
├── Day 5:   Incident response plan + retention policy
└── MILESTONE: Legally compliant product

Week 2: PHASE 1 — Security Hardening
├── Day 1: TLS + security headers + CSP
├── Day 2: Rate limiting + input sanitization
├── Day 3: Backup automation + security logging
└── MILESTONE: Production-grade security

Week 3: PHASE 2 — Product Hardening
├── Day 1: Error handling + Sentry
├── Day 2: Amount storage audit
├── Day 2-4: Testing foundation (smoke tests)
├── Day 4-5: Transaction reversal (not deletion)
└── MILESTONE: Reliable, testable product

Week 4: PHASE 3 — Market Readiness
├── Day 1-3: Tally XML export
├── Day 3-4: E-invoice QR code
├── Day 4-5: Landing page + SEO + onboarding
└── MILESTONE: Ready for first 10 users

Week 5+: 100X VISION begins
├── WhatsApp integration
├── Hindi voice
├── Chandra OCR (self-hosted)
├── Prediction engine
└── CA platform
```

---

## WHAT THIS UNLOCKS

After 4 weeks:

| Before | After |
|--------|-------|
| Legally risky | Companies Act compliant |
| Data in France | Data in India |
| No audit trail | Immutable 8-year audit log |
| Plaintext sensitive data | AES-256 encrypted |
| No privacy policy | DPDP Act compliant |
| No incident plan | CERT-In ready |
| Can't serve real users | **Ready for first 10 CA pilot users** |
| No tests | Smoke tests on critical paths |
| Hard delete of transactions | Reversals (accounting standard) |

Then the 100X vision (WhatsApp, voice, predictions) builds on a **solid, legal, professional foundation** — not a house of cards.

---

## THE ONE RULE

**Never ship a feature before fixing a compliance gap.** Features attract users. Compliance gaps attract lawsuits. Fix the foundation first, always.

---

*This plan should be re-evaluated weekly. Compliance landscape changes. Check CERT-In, MCA, and GSTN portals for updates.*
