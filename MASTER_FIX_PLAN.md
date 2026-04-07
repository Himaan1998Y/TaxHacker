# TaxHacker — Master Fix Plan (All Issues Combined)

**Date**: 2026-04-07
**Total CRITICAL issues**: 6 (3 from first pass + 3 from second pass)
**Total HIGH issues**: 8
**Total fix time**: ~6 hours for all P0+P1

This is the SINGLE source of truth for what to fix and in what order.

---

## 🔴 CRITICAL ISSUES (Must Fix Before ANY Real User)

### C-1: better-auth 2FA Bypass [Pass 1]
- **File**: `lib/auth.ts:36-43` + `package.json`
- **CVE**: GHSA-xg6x-h9c9-2m83
- **Risk**: 2FA bypass in cloud mode
- **Fix**: Pin `"better-auth": "^1.4.9"`
- **Time**: 5 min

### C-2: Plaintext Password + No Rate Limit on `/api/agent/setup` [Pass 1]
- **File**: `app/api/agent/setup/route.ts:20` + `middleware.ts:57`
- **Risk**: Brute-force attack, full account takeover
- **Fix**: Use `timingSafeEqual()` + remove from middleware whitelist
- **Time**: 15 min

### C-3: LangChain Deserialization Injection [Pass 1]
- **File**: `package.json` (langchain dependency)
- **CVE**: GHSA-r399-636x-v7f6
- **Risk**: ENV variable exfiltration via crafted invoice upload
- **Fix**: Pin `"langchain": "^0.3.37"`
- **Time**: 5 min

### C-4: 🆕 PRIVILEGE ESCALATION — Server actions accept caller-supplied `User` [Pass 2]
- **File**: `app/(app)/settings/danger/actions.ts:8,22`
- **Functions**: `resetLLMSettings`, `resetFieldsAndCategories`
- **Risk**: ANY authenticated user can POST a fabricated `user.id` and reset another user's data
- **Why it matters**: This is multi-tenant boundary failure. A free-tier user could nuke a paying customer's settings.
- **Fix**: Replace `(user: User)` parameter with internal `getCurrentUser()` call:

```typescript
// BEFORE (vulnerable)
"use server"
export async function resetLLMSettings(user: User) {
  await prisma.setting.deleteMany({ where: { userId: user.id } })
  // user.id is whatever the client sent — NO VERIFICATION
}

// AFTER (fixed)
"use server"
export async function resetLLMSettings() {
  const user = await getCurrentUser()  // Authoritative user from session
  if (!user) throw new Error('Unauthorized')
  await prisma.setting.deleteMany({ where: { userId: user.id } })
}
```

**Time**: 10 min

### C-5: 🆕 Same pattern in invoice template actions [Pass 2]
- **File**: `app/(app)/apps/invoices/actions.ts:31,38`
- **Functions**: `addNewTemplateAction`, `deleteTemplateAction`
- **Risk**: Same as C-4 — cross-user data manipulation
- **Fix**: Same — use `getCurrentUser()` internally
- **Time**: 10 min

### C-6: 🆕 Orphaned DB rows in invoice action [Pass 2]
- **File**: `app/(app)/apps/invoices/actions.ts:63-83`
- **Bug**: Creates DB transaction BEFORE checking storage quota
- **Result**: If storage full, transaction row commits with no PDF, no rollback
- **Fix**: Wrap in Prisma transaction OR check storage first

```typescript
// BEFORE
const transaction = await prisma.transaction.create({ data: ... })
if (!isEnoughStorage(user, fileSize)) {
  return { error: 'Storage full' }  // ⚠️ Orphaned row left behind
}

// AFTER
if (!isEnoughStorage(user, fileSize)) {
  return { error: 'Storage full' }  // Check FIRST
}
const transaction = await prisma.$transaction(async (tx) => {
  const t = await tx.transaction.create({ data: ... })
  await tx.file.create({ data: ... })  // All-or-nothing
  return t
})
```

**Time**: 20 min

---

## 🔴 ALSO CRITICAL: The Delete Bug (App-Breaking)

### B-1: Unsorted file delete silently fails [Direct inspection]
- **File**: `models/files.ts:81-103`
- **Symptom**: User clicks delete → button shows "Deleting..." → file never deleted
- **Root cause**: `path.resolve(file.path)` resolves against `process.cwd()` instead of uploads dir → path-traversal check always fails → early `return` skips DB delete
- **Fix**: Resolve relative to user uploads dir + move DB delete OUTSIDE try block

**Time**: 10 min (full plan in `BUG_REPORT_DELETE_UNSORTED.md`)

---

## 🟠 HIGH ISSUES (Fix Before Production)

### H-1: 🆕 Storage Quota Race Condition (TOCTOU) [Pass 2]
- **File**: `app/(app)/files/actions.ts:28-61`, `transactions/actions.ts:144-201`
- **Bug**: Two concurrent uploads both pass `isEnoughStorageToUploadFile()` check before either commits
- **Risk**: Users can exceed quota by spamming uploads in parallel
- **Fix**: Atomic DB increment with constraint:

```typescript
// Atomic check-and-increment
await prisma.$transaction(async (tx) => {
  const result = await tx.user.update({
    where: { 
      id: user.id,
      storageUsed: { lte: user.storageLimit - fileSize }  // Atomic check
    },
    data: { storageUsed: { increment: fileSize } }
  })
  if (!result) throw new Error('Storage quota exceeded')
})
```

**Time**: 30 min

### H-2: 🆕 Backup Restore = Data Loss Risk [Pass 2]
- **File**: `app/(app)/settings/backups/actions.ts:69-85`
- **Bug**: `cleanupUserTables` + `fs.rm` called UNCONDITIONALLY before validating ZIP
- **Scenario**: Upload structurally valid ZIP with corrupt JSON → all user data deleted, no recovery
- **Fix**: Validate ZIP contents BEFORE any cleanup:

```typescript
// BEFORE
await cleanupUserTables(user.id)  // ⚠️ Destructive!
await fs.rm(userDir, { recursive: true })
const data = JSON.parse(zipContents)  // ⚠️ Throws? Data already gone

// AFTER
const data = await validateZipContents(zipFile)  // Throws on bad input
if (!data) return { error: 'Invalid backup file' }

// Now safe to cleanup
await cleanupUserTables(user.id)
await restoreFromData(data)
```

**Time**: 30 min

### H-3: 🆕 Backup Restore Counts Errors as Successes [Pass 2]
- **File**: `models/backups.ts:280`
- **Bug**: `insertedCount++` is OUTSIDE the try block — increments even on failure
- **Result**: UI reports "Restored 100 records" when all 100 failed
- **Fix**: Move increment inside the `try` block, after successful insert:

```typescript
// BEFORE
for (const item of data.transactions) {
  insertedCount++  // ⚠️ Counts before insert
  try {
    await prisma.transaction.create({ data: item })
  } catch (e) { /* swallowed */ }
}

// AFTER
for (const item of data.transactions) {
  try {
    await prisma.transaction.create({ data: item })
    insertedCount++  // ✅ Only counts successful inserts
  } catch (e) {
    failedCount++
    errors.push(e.message)
  }
}
```

**Time**: 10 min

### H-4: 🆕 Error Objects Leaking Schema Info [Pass 2 + Pass 1 H-3]
- **Files**: 5 locations in `app/api/`, `app/(app)/settings/actions.ts`, `app/api/stripe/checkout/route.ts`
- **Bug**: Raw `${error}` returned to client — leaks Prisma table names, constraint names, query details
- **Fix**: Use `logServerError()` + return generic message

**Time**: 30 min

### H-5: CSP `unsafe-inline` + `unsafe-eval` [Pass 1]
- **File**: `next.config.ts:32-33`
- **Risk**: Nullifies all XSS protection
- **Fix**: Remove `unsafe-eval` immediately, switch to nonce-based CSP for production
- **Time**: 15 min (quick) or 2 hours (full nonce-based)

### H-6: Console.log Stripe Session Data [Pass 1]
- **File**: `app/api/stripe/checkout/route.ts:48`
- **Risk**: Customer email + payment IDs in logs
- **Fix**: Remove `console.log(session)`, log only safe identifiers
- **Time**: 5 min

### H-7: HSTS Missing Preload [Pass 1]
- **File**: `next.config.ts`
- **Fix**: Add `; includeSubDomains; preload`
- **Time**: 2 min

### H-8: Plaintext Bank Details Column [Pass 1]
- **File**: `prisma/schema.prisma` (User model)
- **Bug**: Dual-write started but original column never dropped
- **Fix**: Migration to drop column after verifying backfill complete
- **Time**: 30 min

---

## 🐛 PERFORMANCE BUGS (From Performance Audit)

### P-1: Missing index on `files(userId, isReviewed)` — 5 min
### P-2: Stats use unbounded `findMany` — 45 min
### P-3: GST widget loads all transactions — 45 min
### P-4: Images unoptimized — 1 hour
### P-5: No Suspense streaming on dashboard — 1 hour
### P-6: LangChain bundle bloat (180MB+) — 30 min (optional)

**Total performance fix time**: 4 hours
**See**: `PERFORMANCE_FIX_PLAN.md` for details

---

## 📅 EXECUTION ORDER (Priority + Impact)

### 🚨 EMERGENCY FIRST PASS (1 hour) — Do RIGHT NOW

These are exploitable RIGHT NOW and break the app:

| # | Item | Type | Time |
|---|------|------|------|
| 1 | B-1: Delete bug | App-breaking | 10 min |
| 2 | C-4: Privilege escalation in danger actions | Critical security | 10 min |
| 3 | C-5: Privilege escalation in invoice templates | Critical security | 10 min |
| 4 | C-1: Pin better-auth | Critical CVE | 5 min |
| 5 | C-3: Pin langchain | Critical CVE | 5 min |
| 6 | P-1: Add files index | Quick win | 5 min |
| 7 | C-2: Agent setup hardening | Critical security | 15 min |

**Total: ~1 hour. Eliminates all 3 critical CVEs + 2 privilege escalation bugs + delete bug + biggest perf win.**

### 🔧 SECOND PASS (2 hours) — Same Day

| # | Item | Type | Time |
|---|------|------|------|
| 8 | C-6: Invoice orphan rows | Critical | 20 min |
| 9 | H-2: Backup data-loss risk | High | 30 min |
| 10 | H-3: Backup error counting | High | 10 min |
| 11 | H-1: Storage quota race | High | 30 min |
| 12 | H-4: Error message sanitization | High | 30 min |

### 🎨 THIRD PASS (2 hours) — Performance + Polish

| # | Item | Type | Time |
|---|------|------|------|
| 13 | P-2: Stats groupBy refactor | Performance | 45 min |
| 14 | P-5: Dashboard Suspense streaming | Performance | 1 hour |
| 15 | H-5: CSP unsafe-eval removal | Security | 15 min |

### 🧹 FOURTH PASS (1 hour) — Cleanup

| # | Item | Type | Time |
|---|------|------|------|
| 16 | H-6: Stripe console.log | Security | 5 min |
| 17 | H-7: HSTS preload | Security | 2 min |
| 18 | H-8: Drop plaintext bank column | Security | 30 min |
| 19 | P-3: GST widget aggregation | Performance | 45 min |

### 🚀 FIFTH PASS (Optional, 2 hours) — Polish

| # | Item | Type | Time |
|---|------|------|------|
| 20 | P-4: Image optimization | Performance | 1 hour |
| 21 | P-6: LangChain lazy load | Performance | 30 min |
| 22 | Full nonce-based CSP | Security | 1 hour |

---

## 🎯 MINIMUM PATH TO REVENUE (Recommended)

If you're racing to ship:

**Day 1 morning** (1 hour) — Emergency fixes:
- Delete bug + 2 privilege escalations + 2 CVE pins + index + agent setup

**Day 1 afternoon** (2 hours) — Second pass:
- Invoice orphans + backup safety + storage race + error sanitization

**Day 2** (2 hours) — Performance:
- Stats refactor + Suspense streaming + CSP

**Day 3-5** — Compliance fixes from `COMPLIANCE_AUDIT.md`:
- INCIDENT_RESPONSE.md + transaction enums + drop bank column + audit log UI + VPS Mumbai

**Day 6** — Deploy to Lodhi Realty.

**Day 7** — First ₹5K invoice 💰

---

## 📊 SECURITY POSTURE BEFORE/AFTER

### Before (right now)
- 6 CRITICAL bugs (3 CVEs + 2 priv-esc + 1 data-integrity)
- 8 HIGH bugs (data loss, race conditions, info disclosure)
- 6 PERFORMANCE bugs (slow page loads)
- 1 APP-BREAKING bug (delete doesn't work)

### After Emergency Pass (1 hour)
- 0 CRITICAL bugs ✅
- 8 HIGH bugs (still need fixing but not exploitable in single-user mode)
- Slow but functional ✅
- Delete works ✅

### After Full Plan (~6 hours)
- 0 CRITICAL bugs ✅
- 0 HIGH bugs ✅
- 1 MEDIUM bug (image optimization — optional)
- Fast + secure + functional ✅
- **Production-ready for paying customers** 🎯

---

## 🏃 NEXT ACTION

**Recommended right now**: Apply the **Emergency First Pass** (1 hour, 7 fixes).

Order:
1. Apply delete bug fix (10 min) — *unblocks user immediately*
2. Apply C-4 + C-5 priv-esc fixes (20 min) — *closes auth bypass*
3. Pin dependencies (10 min) — *closes 2 CVEs*
4. Add files index (5 min) — *unsorted page becomes instant*
5. Fix agent setup (15 min) — *closes brute force*

**Want me to apply all 7 in sequence?** I can do it now with verification at each step.

---

## 📂 RELATED DOCS

- `BUG_REPORT_DELETE_UNSORTED.md` — Delete bug full analysis + fix
- `SECURITY_FIX_PLAN.md` — Pass 1 security fixes (detailed)
- `SECURITY_AUDIT_FINDINGS.md` — Pass 1 audit findings (full report)
- `SECURITY_AUDIT_PASS_2.md` — Pass 2 audit findings (full report)
- `PERFORMANCE_FIX_PLAN.md` — Performance fixes (detailed)
- `COMPLIANCE_AUDIT.md` — Legal compliance status (Phase 0)
- `EXECUTIVE_SUMMARY.md` — High-level overview
- `REVENUE_ROADMAP.md` — Path to ₹1L/month
- `CLAW_INTEGRATION_ARCHITECTURE.md` — Phase 2 (after revenue)

---

*Generated 2026-04-07 | Single source of truth for all fixes*
*Updates supersede all previous fix plans*
