# TaxHacker — Security Fix Execution Plan

**Date**: 2026-04-07
**Total time**: ~3 hours for all CRITICAL + HIGH (P0+P1)
**Status**: Ready to execute, all fixes have known solutions

---

## EXECUTION ORDER (Do in This Sequence)

### Phase 1: Dependencies (10 min) — Do FIRST
Pin vulnerable packages before touching any code.

```bash
cd f:/TaxHacker
```

1. **Edit `package.json`**:
   ```diff
   - "better-auth": "^1.2.10",
   + "better-auth": "^1.4.9",
   ```
   ```diff
   - "langchain": "^0.3.30",
   + "langchain": "^0.3.37",
   ```

2. **Update lockfile + install**:
   ```bash
   npm install
   npm audit fix
   npm audit  # Verify: 0 vulnerabilities
   ```

3. **Verify versions**:
   ```bash
   node -e "console.log('better-auth:', require('./node_modules/better-auth/package.json').version)"
   node -e "console.log('langchain:', require('./node_modules/langchain/package.json').version)"
   ```

**Acceptance criteria**:
- [ ] `npm audit` returns 0 vulnerabilities
- [ ] better-auth >= 1.4.9
- [ ] langchain >= 0.3.37
- [ ] Tests still pass: `npm test`

**Closes**: C-1, C-3 + transitive langsmith CVE

---

### Phase 2: Agent Setup Endpoint Hardening (30 min)

Three sub-fixes for `/api/agent/setup`:

#### 2.1 Add timing-safe comparison
**File**: `app/api/agent/setup/route.ts`

```diff
+ import { timingSafeEqual } from '@/lib/self-hosted-auth'

  // Around line 20:
- if (body.password !== config.selfHosted.password) {
+ if (!timingSafeEqual(body.password, config.selfHosted.password)) {
    return NextResponse.json({ error: 'Invalid password' }, { status: 401 })
  }
```

#### 2.2 Remove from middleware whitelist
**File**: `middleware.ts` (around line 57)

```diff
- if (pathname.startsWith('/api/agent/')) {
-   return NextResponse.next()  // Skip auth check
- }
+ // Allow read endpoints, gate setup behind rate limit
+ if (pathname.startsWith('/api/agent/') && pathname !== '/api/agent/setup') {
+   return NextResponse.next()
+ }
```

#### 2.3 Add rate limit specifically to setup
**File**: `app/api/agent/setup/route.ts`

```typescript
import { rateLimit } from '@/lib/rate-limit'

export async function POST(req: NextRequest) {
  // Rate limit: 5 attempts per IP per 15 minutes
  const identifier = req.headers.get('x-forwarded-for') ?? 'anonymous'
  const { success } = await rateLimit(identifier, 5, '15m', 'agent-setup')
  
  if (!success) {
    return NextResponse.json(
      { error: 'Too many attempts. Try again in 15 minutes.' },
      { status: 429 }
    )
  }
  
  // ... existing logic
}
```

**Acceptance criteria**:
- [ ] Wrong password takes same time as right password (timing-safe)
- [ ] 6 wrong attempts in 15 min returns 429
- [ ] Right password still works
- [ ] Test: `for i in {1..10}; do curl -X POST http://localhost:3000/api/agent/setup -d '{"password":"wrong"}'; done`

**Closes**: C-2

---

### Phase 3: CSP Hardening — Remove unsafe-inline/unsafe-eval (1-2 hours)

**File**: `next.config.ts` (lines 32-33)

This is the biggest fix. Two approaches:

#### Option A: Quick wins (15 min)
Remove `'unsafe-eval'` immediately (Next.js 15 doesn't require it for production builds):

```diff
- "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
+ "script-src 'self' 'unsafe-inline'",
```

This still allows inline scripts but blocks eval-based XSS payloads.

#### Option B: Nonce-based CSP (2 hours, recommended for production)

1. **Add middleware to generate nonce per request**:
   ```typescript
   // middleware.ts
   import crypto from 'crypto'
   
   export function middleware(req: NextRequest) {
     const nonce = crypto.randomBytes(16).toString('base64')
     const requestHeaders = new Headers(req.headers)
     requestHeaders.set('x-nonce', nonce)
     
     const cspHeader = `
       default-src 'self';
       script-src 'self' 'nonce-${nonce}' 'strict-dynamic';
       style-src 'self' 'unsafe-inline';
       img-src 'self' blob: data: https:;
       font-src 'self';
       connect-src 'self' https://api.openai.com https://generativelanguage.googleapis.com;
       frame-ancestors 'none';
       form-action 'self';
       base-uri 'self';
     `.replace(/\s{2,}/g, ' ').trim()
     
     const response = NextResponse.next({ request: { headers: requestHeaders } })
     response.headers.set('Content-Security-Policy', cspHeader)
     return response
   }
   ```

2. **Pass nonce to scripts** in `app/layout.tsx`:
   ```tsx
   import { headers } from 'next/headers'
   
   export default async function RootLayout() {
     const nonce = (await headers()).get('x-nonce')
     return (
       <html>
         <body>
           <Script nonce={nonce} src="..." />
         </body>
       </html>
     )
   }
   ```

**Recommendation**: Start with Option A (quick win), upgrade to Option B before production.

**Acceptance criteria**:
- [ ] CSP header present in response
- [ ] No `'unsafe-eval'` in production CSP
- [ ] App still loads without console errors
- [ ] Inline event handlers (onclick=) blocked

**Closes**: H-1

---

### Phase 4: Stripe Session Logging Cleanup (5 min)

**File**: `app/api/stripe/checkout/route.ts` (line 48)

```diff
- console.log(session)
+ // Log only non-sensitive identifiers, never full session
+ console.log('[stripe] checkout created:', { id: session.id, status: session.status })
```

Also check for similar issues:
```bash
grep -rn "console.log.*session" app/api/
grep -rn "console.log.*password" app/
grep -rn "console.log.*token" app/
```

**Acceptance criteria**:
- [ ] No full session/token/password in logs
- [ ] Only safe identifiers logged

**Closes**: H-2

---

### Phase 5: Error Message Sanitization (15 min)

**File**: `app/(app)/settings/actions.ts` (multiple locations)

**Pattern to replace**:
```diff
  } catch (error) {
-   return { error: `${error}` }
+   logServerError('settings/actions', error, userId)
+   return { error: 'Failed to update settings. Please try again.' }
  }
```

Apply to ALL catch blocks in:
- `app/(app)/settings/actions.ts`
- `app/(app)/transactions/actions.ts`
- `app/(app)/unsorted/actions.ts`
- `app/api/agent/*/route.ts`

**Acceptance criteria**:
- [ ] No `${error}` interpolation in user-facing responses
- [ ] All errors logged server-side via `logServerError()`
- [ ] User sees fixed, generic messages

**Closes**: H-3

---

### Phase 6: HSTS Preload (2 min)

**File**: `next.config.ts`

```diff
  {
    key: 'Strict-Transport-Security',
-   value: 'max-age=31536000'
+   value: 'max-age=63072000; includeSubDomains; preload'
  }
```

Then submit domain to https://hstspreload.org/

**Acceptance criteria**:
- [ ] `curl -I https://taxhacker.yourdomain.com` shows full HSTS header
- [ ] Submitted to hstspreload.org

**Closes**: H-4

---

### Phase 7: Drop Plaintext Bank Details Column (30 min)

**File**: New migration `prisma/migrations/XXX_drop_plaintext_bank_details/migration.sql`

```sql
-- Verify all bank details are migrated to encrypted settings
DO $$
DECLARE
  unmigrated INTEGER;
BEGIN
  SELECT COUNT(*) INTO unmigrated 
  FROM users u
  WHERE u.business_bank_details IS NOT NULL 
    AND u.business_bank_details != ''
    AND NOT EXISTS (
      SELECT 1 FROM settings s 
      WHERE s.user_id = u.id 
        AND s.code = 'business_bank_details_encrypted'
    );
  
  IF unmigrated > 0 THEN
    RAISE EXCEPTION 'Migration blocked: % users have unmigrated bank details', unmigrated;
  END IF;
END $$;

-- Safe to drop
ALTER TABLE users DROP COLUMN business_bank_details;
```

**Files to update**:
- `prisma/schema.prisma` — remove `businessBankDetails` field from User model
- `models/users.ts` — remove all references to plaintext column
- Any UI that reads from plaintext column → switch to encrypted settings

**Acceptance criteria**:
- [ ] Migration runs cleanly
- [ ] All TypeScript errors resolved
- [ ] Bank details still display correctly (decrypted)
- [ ] DB inspection shows column is GONE

**Closes**: A02 OWASP gap from main audit

---

## VERIFICATION CHECKLIST (Run After All Phases)

### Automated checks
```bash
# 1. Dependency security
npm audit
# Expected: 0 vulnerabilities

# 2. Tests
npm test
# Expected: 121+ passing

# 3. Build succeeds
npm run build
# Expected: Build complete, no errors

# 4. Type check
npm run type-check
# Expected: No type errors
```

### Manual checks
```bash
# 5. CSP header present
curl -I https://taxhacker.yourdomain.com | grep Content-Security-Policy

# 6. HSTS preload
curl -I https://taxhacker.yourdomain.com | grep Strict-Transport

# 7. Rate limit on agent/setup
for i in {1..10}; do
  curl -s -o /dev/null -w "%{http_code}\n" \
    -X POST http://localhost:3000/api/agent/setup \
    -d '{"password":"wrong"}'
done
# Expected: 5x 401, then 429

# 8. Timing safety
time curl -X POST http://localhost:3000/api/agent/setup -d '{"password":"a"}'
time curl -X POST http://localhost:3000/api/agent/setup -d '{"password":"correct_password"}'
# Expected: Same response time (within ~10ms)

# 9. No plaintext bank details in DB
psql $DATABASE_URL -c "\d users" | grep business_bank_details
# Expected: No output (column dropped)
```

---

## TIME ESTIMATE BY PRIORITY

| Phase | Item | Time | Priority |
|-------|------|------|----------|
| 1 | Pin dependencies | 10 min | 🔴 P0 |
| 2 | Agent setup hardening | 30 min | 🔴 P0 |
| 3 | CSP hardening (Option A) | 15 min | 🟠 P1 |
| 4 | Stripe logging cleanup | 5 min | 🟠 P1 |
| 5 | Error message sanitization | 15 min | 🟠 P1 |
| 6 | HSTS preload | 2 min | 🟡 P2 |
| 7 | Drop bank details column | 30 min | 🟡 P2 |
| **Total** | | **~2 hours** | |
| | + CSP Option B (nonces) | +2 hours | 🟡 P2 |
| **With nonce CSP** | | **~4 hours** | |

---

## COMMIT STRATEGY

Make small, focused commits — one per phase:

```bash
git checkout -b security/p0-dependency-pins
# Phase 1
git commit -m "fix(security): pin better-auth ^1.4.9 + langchain ^0.3.37 (CVE GHSA-xg6x-h9c9-2m83, GHSA-r399-636x-v7f6)"

git checkout -b security/p0-agent-setup
# Phase 2
git commit -m "fix(security): timing-safe + rate-limit /api/agent/setup endpoint"

git checkout -b security/p1-csp-hardening
# Phase 3
git commit -m "fix(security): remove unsafe-eval from CSP, add nonce-based script-src"

git checkout -b security/p1-info-disclosure
# Phases 4 + 5
git commit -m "fix(security): sanitize error messages and stop logging full Stripe sessions"

git checkout -b security/p2-hsts-preload
# Phase 6
git commit -m "fix(security): enable HSTS preload + includeSubDomains"

git checkout -b security/p2-drop-plaintext-bank
# Phase 7
git commit -m "fix(security): drop plaintext businessBankDetails column (encrypted in settings)"
```

Each commit gets its own PR for clean review.

---

## ROLLBACK PLAN

If any phase breaks production:

```bash
# Quick rollback
git revert HEAD
npm install  # Restore old node_modules

# Test
npm test
npm run build

# Re-deploy previous version
```

**Risk factors**:
- Phase 1 (deps): Low risk, npm pins are reversible
- Phase 2 (agent setup): Medium risk, test API integration carefully
- Phase 3 (CSP): HIGH risk if scripts break — test in dev mode first
- Phase 7 (DB drop): Cannot rollback easily — verify migration in staging

---

## POST-FIX VALIDATION

After all phases, run security re-audit:

```bash
# 1. Dependency scan
npm audit
snyk test  # If snyk installed

# 2. Header check
curl -I https://taxhacker.yourdomain.com | grep -E "(CSP|HSTS|X-)"

# 3. Test suite
npm test

# 4. Manual smoke test
# - Login flow
# - File upload
# - Transaction CRUD
# - GSTR-1 export
# - Settings updates
```

---

## NEXT STEPS AFTER SECURITY FIXES

1. ✅ Security fixes complete (this doc)
2. 🔜 Read SECURITY_AUDIT_PASS_2.md (additional issues found by 2nd pass)
3. 🔜 Fix unsorted invoice deletion bug (separate plan)
4. 🔜 Performance optimization (separate plan)
5. 🔜 Compliance fixes (COMPLIANCE_AUDIT.md — Phase 0 remaining items)
6. 🔜 Deploy to Lodhi Realty
7. 🔜 First ₹5K invoice

---

*Generated 2026-04-07 | Based on SECURITY_AUDIT_FINDINGS.md*
