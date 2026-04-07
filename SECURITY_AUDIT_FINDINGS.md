# TaxHacker India — Security Audit Findings

**Audit Date:** 2026-04-07
**Auditor:** Security Reviewer Agent (Claude Sonnet 4.6)
**Scope:** `app/api/`, `lib/`, `models/`, `middleware.ts`, `next.config.ts`
**Codebase Version:** 0.5.5

---

## Executive Summary

The codebase shows meaningful security investment: bcrypt password storage, HMAC cookies, timing-safe comparisons, path traversal guards, magic-byte file validation, AES-256-GCM encryption for API keys, and an audit trail. These are not cosmetic — they reflect deliberate, competent security thinking.

However, **three exploitable vulnerabilities** exist right now, and one critical CVE (GHSA-xg6x-h9c9-2m83) in a pinned dependency directly undermines the cloud-mode authentication system. Both must be fixed before any real user touches this.

---

## CRITICAL — Fix Before Any User

### C-1: Better-Auth 2FA Bypass via Session Cookie Cache (CVE GHSA-xg6x-h9c9-2m83)

**File:** `lib/auth.ts` — lines 36–43
**Installed version:** better-auth 1.5.6 (resolved from `^1.2.10`)
**Vulnerable range:** better-auth < 1.4.9
**Status:** INSTALLED VERSION IS PATCHED (1.5.6 >= 1.4.9) — but `package.json` pins `^1.2.10`, meaning a fresh install with an old lockfile could pull a vulnerable version.

The exploit: when `session.cookieCache` is enabled (it is, at line 39–42 of `lib/auth.ts`), an attacker who bypasses 2FA at the OTP step can reuse a cached cookie from a prior session that has not yet expired. The cached session is returned before the server re-validates 2FA completion. This is a complete authentication bypass for cloud-mode users who enable 2FA.

**Exploitability:** HIGH in cloud mode. Self-hosted mode uses its own cookie path and is not affected by this specific bug, but the installed version must be verified.

**Fix:**
1. Update `package.json` to pin `"better-auth": "^1.4.9"` minimum, or exact `"1.5.6"`.
2. Run `pnpm install` to regenerate lockfile.
3. Verify installed version: `node -e "console.log(require('./node_modules/better-auth/package.json').version)"`.

**Effort:** 15 minutes.

---

### C-2: Plaintext Password Comparison in Agent Setup Endpoint

**File:** `app/api/agent/setup/route.ts` — line 20

```
if (body.password !== config.selfHosted.password) {
```

The agent setup route (`POST /api/agent/setup`) accepts a password from the request body and compares it directly against `config.selfHosted.password` using the `!==` operator. This is a **timing-unsafe** string comparison on a sensitive credential. An attacker can measure response time differences to oracle the password one character at a time.

Additionally, the route has **no rate limiting**. All other auth endpoints are rate-limited at 5 req/min via middleware — but middleware explicitly passes `/api/agent/` paths through without auth checks when the user is unauthenticated (`pathname.startsWith("/api/agent/")` is whitelisted on line 57 of `middleware.ts`). This means the agent setup endpoint is open to unlimited brute-force.

The rate-limit bypass is the more serious issue: `middleware.ts` line 57 allows unauthenticated requests to `/api/agent/` in self-hosted mode when no cookie is present, which means `/api/agent/setup` is fully accessible to an unauthenticated attacker without any rate limit.

**Exploitability:** CRITICAL for anyone who can reach the server. Timing attack is theoretical; brute-force with no rate limit is practical.

**Fix:**
1. Replace `body.password !== config.selfHosted.password` with `timingSafeEqual(body.password, config.selfHosted.password)` — the function already exists in `lib/self-hosted-auth.ts`.
2. Move `/api/agent/setup` out of the middleware whitelist, or add an explicit rate limit check before the password comparison.
3. Alternatively, require the existing `taxhacker_sh_auth` cookie to be valid before allowing access to `/api/agent/setup` (same check used for all other routes).

**Effort:** 30 minutes.

---

### C-3: LangChain Serialization Injection — Secret Extraction (CVE GHSA-r399-636x-v7f6)

**File:** `lib/llm-providers.ts` (via langchain dependency)
**Installed version:** langchain 0.3.37 — this is the **exact** first patched version (`< 0.3.37` is vulnerable). The `package.json` pins `^0.3.30`, which resolves to 0.3.37 today but would pull a vulnerable version if the lockfile is deleted or an old environment is rebuilt.

The exploit: crafted input passed through LangChain's serialization layer can trigger deserialization of untrusted objects, which can extract environment variable secrets (API keys, `BETTER_AUTH_SECRET`, `ENCRYPTION_KEY`) from the process. Since TaxHacker passes user-uploaded file content (invoice images, PDFs) to the LLM pipeline, a maliciously crafted document could trigger this.

**Exploitability:** HIGH if an attacker can upload a crafted file and predict the LangChain serialization code path.

**Fix:**
1. Pin `"langchain": "^0.3.37"` in `package.json`.
2. Also update `@langchain/core` — the installed `@langchain/core` 0.3.64–1.1.6 depends on vulnerable langsmith (GHSA-v34v-rq6j-cj6p). Run `npm audit fix` for the chain.

**Effort:** 30 minutes (mostly testing that AI analysis still works after update).

---

## HIGH — Fix Before First Customer

### H-1: `unsafe-inline` + `unsafe-eval` in Content Security Policy

**File:** `next.config.ts` — lines 32–33

```
"script-src 'self' 'unsafe-inline' 'unsafe-eval'",
```

Both `'unsafe-inline'` and `'unsafe-eval'` are present in the production CSP. These directives completely nullify XSS protection — any injected `<script>` tag or `eval()` call executes freely. The comment says "Next.js requires" these in dev, which is partially true for dev mode, but Next.js 15 supports nonce-based CSP in production that eliminates the need for `'unsafe-inline'`.

TaxHacker handles financial data. An XSS vulnerability that bypasses the CSP can exfiltrate all transactions, API keys stored in settings, and session cookies.

The `dangerouslySetInnerHTML` at `app/layout.tsx:79` (used for JSON-LD structured data) is safe because the content is `JSON.stringify(jsonLd)` where `jsonLd` is a hardcoded server-side object with no user input. This is a false positive. However, the CSP still needs hardening.

**Exploitability:** XSS injections found elsewhere (e.g., a future bug) would be immediately weaponizable. The CSP currently provides zero script execution protection.

**Fix:**
1. Implement per-request nonce in `middleware.ts`.
2. Pass nonce via `headers()` to `app/layout.tsx`.
3. Change `script-src` to `'self' 'nonce-{RANDOM}'` and remove both `unsafe-*` directives.
4. The `app/layout.tsx` JSON-LD script tag needs `nonce={nonce}` added.

**Effort:** 2–4 hours (nonce threading through Next.js App Router requires care).

---

### H-2: Error Object Serialized Directly into API Response

**File:** `app/api/stripe/checkout/route.ts` — line 48

```typescript
return NextResponse.json({ error: `Failed to create checkout session: ${error}` }, { status: 500 })
```

The raw `error` object (a Stripe SDK exception) is serialized via template literal into the JSON response body. Stripe SDK errors contain: HTTP status codes, request IDs, internal error codes, and sometimes partial response bodies from Stripe's API. These are sent directly to the browser.

In production, this leaks internal error details to any client that hits an error condition. This is an information disclosure that assists attackers in fingerprinting the payment stack, understanding server state, and identifying exploitable conditions.

**Exploitability:** MEDIUM-HIGH — not directly exploitable, but provides meaningful reconnaissance.

**Fix:** Replace with a generic message: `return NextResponse.json({ error: "Failed to create checkout session" }, { status: 500 })` and log the full error server-side only.

**Effort:** 10 minutes.

---

### H-3: kysely Dependency — SQL Injection via `sql.lit()` (GHSA-8cpq-38p9-67gx + GHSA-wmrf-hv6w-mr66)

**Installed version:** kysely 0.28.8 (vulnerable range: <= 0.28.13)

kysely is a dependency of `better-auth`. The SQL injection vulnerability affects callers who use `sql.lit(string)` or suppress TypeScript compilation errors with `Kysely<any>`. TaxHacker itself does not call kysely directly — it uses Prisma. However, `better-auth`'s Prisma adapter uses kysely internally for some query construction.

**Exploitability:** LOW-MEDIUM for TaxHacker specifically — the known unsafe patterns (`sql.lit()` with user input, `Kysely<any>`) are in better-auth internals, not called by TaxHacker code. But the attack surface exists if better-auth passes any user-controlled value through kysely's literal injection path.

**Fix:** Run `npm audit fix` — kysely has a fix available. Updating better-auth to the latest version likely pulls an updated kysely transitively.

**Effort:** 15 minutes.

---

### H-4: Prototype Pollution in defu (GHSA-737v-mqg7-c878)

**Installed version:** defu 6.1.4 (vulnerable range: <= 6.1.4)

`defu` is used by better-auth for deep defaults merging. A `__proto__` key in a defaults argument can pollute `Object.prototype`, potentially affecting all objects in the process. If any user-controlled data flows into a `defu()` call inside better-auth (e.g., during session creation with crafted JWT claims), this could modify server-side object behavior.

**Exploitability:** MEDIUM — depends on better-auth's internal usage and whether user-controlled input reaches defu.

**Fix:** Run `npm audit fix`. defu 6.1.5+ is patched.

**Effort:** 10 minutes.

---

### H-5: HSTS Missing `preload` Directive

**File:** `next.config.ts` — line 21

```
{ key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" }
```

The HSTS header is missing the `preload` directive. Without preload, the browser only enforces HTTPS after the first visit — the very first HTTP request to the site is unprotected and vulnerable to SSL stripping (MITM attack that downgrades HTTPS to HTTP). For a financial application handling GST data, MITM on the first request can steal session cookies.

**Exploitability:** MEDIUM — requires network-level MITM (same network, café Wi-Fi, ISP interception). Realistic in India's public Wi-Fi environments.

**Fix:** Change to `"max-age=31536000; includeSubDomains; preload"`. Then submit the domain to hstspreload.org.

**Effort:** 5 minutes.

---

### H-6: In-Memory Rate Limiter Lost on Process Restart / Multi-Instance Deploy

**File:** `lib/rate-limit.ts` — line 9 (`const store = new Map()`)

The rate limiter uses a module-level `Map` in Node.js memory. This is reset every time the process restarts. On Coolify/Docker with health-based restarts, auto-scaling, or rolling deploys, an attacker can reset the rate limit counter by triggering a restart, then replay the brute-force attack. The auth endpoint's 5 req/min protection is neutralized.

For a single-process self-hosted deployment with a stable process, this is acceptable. For any multi-container or auto-restart scenario, it is a bypass.

**Exploitability:** MEDIUM — requires the attacker to trigger restarts (possible via the health endpoint DoS), but in practice the window may be small.

**Fix:** For production, replace the Map with a Redis-based rate limiter (`ioredis` + sliding window). Redis is already available on the OVH VPS (port 6379).

**Effort:** 2–4 hours.

---

## MEDIUM — Fix in Next Sprint

### M-1: Stripe Session Object Logged to Console

**File:** `app/api/stripe/checkout/route.ts` — line 41

```typescript
console.log(session)
```

When a checkout session is created but the URL is missing, the full Stripe session object is logged. This object contains: `customer_id`, `subscription_id`, `payment_intent`, `metadata`, `line_items`, and internal Stripe state. Server logs in Coolify are accessible to anyone with VPS SSH access and are not encrypted.

**Exploitability:** LOW — requires server log access, but logs should never contain payment session data.

**Fix:** Remove `console.log(session)` at line 41. The error is already returned to the caller.

**Effort:** 2 minutes.

---

### M-2: Stripe Webhook Logs Customer PII

**File:** `app/api/stripe/webhook/route.ts` — lines 74, 88, 110

```typescript
console.log(`Updating subscription for customer ${customerId}`)
console.log(`User not found for customer ${customerId}, creating new user with email ${customer.email}`)
console.log(`Updated user ${user.id} with plan ${plan.code} and expires at ${newMembershipExpiresAt}`)
```

`customerId`, `customer.email`, and `user.id` are logged at INFO level in the webhook handler. Under DPDP Act 2023, email addresses are personal data and should not appear in application logs without explicit consent for logging.

**Fix:** Remove or replace with structured log entries that omit email addresses. Log event types and UUIDs only.

**Effort:** 10 minutes.

---

### M-3: `flatted` Prototype Pollution + Unbounded Recursion DoS (GHSA-25h7-pfq9-p65f, GHSA-rf6f-7fwh-wjgh)

**Installed version:** flatted 3.3.3 (vulnerable range: <= 3.4.1)

`flatted` is used by a transitive dependency. The prototype pollution vulnerability requires passing `JSON.parse`-style crafted input to `flatted.parse()`. Unbounded recursion can cause the Node.js process to crash (DoS). This affects any code path that passes user-controlled data through flatted — likely caching layers in LangChain or better-auth.

**Fix:** Run `npm audit fix`. flatted 3.4.2+ is patched.

**Effort:** 10 minutes.

---

### M-4: `$queryRawUnsafe` in Embeddings — Injection Risk is Low but Pattern is Dangerous

**Files:**
- `lib/embeddings.ts` — lines 121, 176, 205
- `app/api/agent/embeddings/route.ts` — lines 27, 70, 104

All six `$queryRawUnsafe` and `$executeRawUnsafe` calls use parameterized inputs (`$1`, `$2`, `$3`) with proper type casting (`::uuid`, `::vector`). The SQL injection risk is currently zero because no user string is concatenated directly into the query template.

However, the `vectorStr` variable is constructed via string interpolation:

```typescript
const vectorStr = `[${embedding.join(",")}]`
await prisma.$executeRawUnsafe(`... $1::vector ...`, vectorStr, ...)
```

`embedding` is a `number[]` generated internally by the Google Gemini API response. If the API response is maliciously crafted or the parsing is wrong, floating-point values are the only expected content. This is safe today.

The risk is the pattern itself: `$queryRawUnsafe` + template literals creates a high-risk footprint that will eventually cause a SQL injection if a future developer adds user input without care.

**Recommendation:** Add a comment block to each `$queryRawUnsafe` call documenting exactly what values are parameterized and confirming no user input is interpolated. This creates an explicit audit checkpoint.

**Effort:** 30 minutes (documentation only).

---

### M-5: Agent Setup Endpoint Leaks API Key in Response Field `usage`

**File:** `app/api/agent/setup/route.ts` — lines 49–52

```typescript
return NextResponse.json({
  apiKey: plainKey,
  message: "Store this key securely. It won't be shown again.",
  usage: 'curl -H "X-Agent-Key: ' + plainKey + '" http://localhost:7331/api/agent/transactions',
})
```

The plain API key is embedded in a `curl` example in the `usage` field of the response. This is a convenience feature, but:

1. The key appears in two separate fields, doubling the chance of being accidentally logged by any middleware, proxy, or monitoring tool that logs response bodies.
2. The hardcoded `http://localhost:7331` in the usage example will confuse users on remote deployments and may lead them to use HTTP when they should use HTTPS.

**Fix:** Remove the `usage` field from the response or replace the URL with `${config.app.baseURL}`.

**Effort:** 10 minutes.

---

### M-6: Audit Log Table Has No Delete/Update Restrictions at Database Level

**File:** `lib/audit.ts` — line 32 (`prisma.auditLog.create`)

The audit log is insert-only by application convention, but there is no database-level constraint enforcing this. A compromised application layer or a direct database connection can `UPDATE` or `DELETE` audit records, violating Companies Act 2023's immutability requirement.

**Fix:** Add a PostgreSQL trigger or RLS policy that blocks `UPDATE` and `DELETE` on the `audit_logs` table. Alternatively, use a separate database user for the audit log connection that only has `INSERT` and `SELECT` privileges.

**Effort:** 2–4 hours (schema + migration).

---

### M-7: Encryption Silently Falls Back to Plaintext in Development

**File:** `lib/encryption.ts` — lines 8–9, 20–21

```typescript
if (key.length === 0) return Buffer.alloc(0)
// ...
if (key.length === 0) return text  // returns plaintext!
```

When `ENCRYPTION_KEY` is not set (any dev environment), `encrypt()` returns the plaintext string unchanged. This is documented as "dev mode" but:

1. `config.ts` only throws on missing `ENCRYPTION_KEY` in `production` with `NODE_ENV === "production"`. A staging environment with `NODE_ENV=development` gets no enforcement.
2. Any settings row written without an encryption key will have API keys stored in plaintext. If the environment later gets an `ENCRYPTION_KEY`, existing plaintext rows are transparently returned by `decrypt()` (line 37: `if (!data.startsWith("enc:")) return data`). But future migrations or DB exports will contain plaintext API keys in the settings table.

**Fix:** Add a startup warning (not throw) in non-production environments when `ENCRYPTION_KEY` is absent and `SENSITIVE_SETTINGS` are being read. Make the silent fallback visible in logs.

**Effort:** 1 hour.

---

## OWASP Top 10 Gap Analysis

| OWASP Category | Status | Notes |
|---|---|---|
| A01: Broken Access Control | PARTIAL | Auth on all routes via middleware. Agent API correctly enforces user scoping. Cookie bypass in middleware for `/api/agent/` (C-2) is the gap. |
| A02: Cryptographic Failures | PARTIAL | AES-256-GCM for API keys. bcrypt for passwords. HMAC cookies. But: plaintext fallback in dev (M-7), ENCRYPTION_KEY not enforced in staging. |
| A03: Injection | LOW RISK | Prisma ORM with parameterized queries. Raw SQL uses `$queryRawUnsafe` with proper params. No string concatenation SQL detected. kysely transitive SQLi (H-3) is the only gap. |
| A04: Insecure Design | MEDIUM | No SSRF protection on LLM API calls. If user-controlled prompts reach the LLM with a URL-fetch tool, SSRF is possible. Low likelihood given current prompts. |
| A05: Security Misconfiguration | HIGH | CSP has `unsafe-inline` + `unsafe-eval` (H-1). HSTS missing preload (H-5). `eslint` disabled during builds in `next.config.ts`. |
| A06: Vulnerable Components | CRITICAL | better-auth < 1.4.9 (GHSA-xg6x-h9c9-2m83, C-1), langchain < 0.3.37 (GHSA-r399-636x-v7f6, C-3), kysely <= 0.28.13 (H-3), defu <= 6.1.4 (H-4), flatted <= 3.4.1 (M-3). |
| A07: Auth Failures | HIGH | C-2 (timing-safe comparison bypass + no rate limit on agent setup). C-1 (2FA bypass via cookie cache). |
| A08: Software Integrity Failures | LOW | Docker build uses pinned base image. Sentry SRI not checked but Sentry is optional. |
| A09: Logging/Monitoring Failures | MEDIUM | Security events logged. Audit trail implemented. But: customer PII in stripe logs (M-2), session data logged (M-1). No alerting on security events. |
| A10: SSRF | LOW RISK | No explicit user-controlled URL fetch detected. Gemini embedding URL is hardcoded. Agent API files are stored locally. |

---

## What Is Actually Solid (No Action Needed)

These were verified and are genuinely well-implemented:

- **bcrypt password storage** (`lib/self-hosted-auth.ts` lines 11–22): 12 rounds, correct.
- **HMAC-SHA256 cookies** (`lib/self-hosted-auth.ts` line 27): `crypto.createHmac` with a proper secret, not plain SHA-256.
- **Timing-safe cookie verification** (`middleware.ts` lines 55–57): `timingSafeEqual` used correctly on the auth cookie path.
- **Magic-byte file validation** (`lib/files.ts` lines 121–165): Content sniffed from buffer, not trusted from `Content-Type` header.
- **Path traversal guard** (`lib/files.ts` lines 70–87): `path.resolve` + `path.relative` check with null-byte detection.
- **Agent API key storage** (`app/api/agent/auth.ts`): SHA-256 hash stored, never the plaintext key. Auto-migration from legacy format.
- **Stripe webhook signature verification** (`app/api/stripe/webhook/route.ts` line 23): `stripeClient.webhooks.constructEvent` with secret verification before processing.
- **SQL parameterization**: All Prisma queries use the ORM safely. Raw SQL calls pass values as proper parameters.
- **SENSITIVE_SETTINGS encryption**: `openai_api_key`, `google_api_key`, `mistral_api_key`, `openrouter_api_key`, `agent_api_key`, `business_bank_details` are encrypted before writing to the database.
- **HSTS + X-Frame-Options + X-Content-Type-Options + Referrer-Policy**: All present in `next.config.ts`.
- **Stripe webhook body not consumed before verification**: `request.text()` is used (not `request.json()`), preserving raw bytes for signature validation.

---

## Remediation Priority

| Priority | Item | Effort | Blocks |
|---|---|---|---|
| P0 — Do now | C-1: Pin better-auth >= 1.4.9 | 15 min | 2FA bypass in cloud mode |
| P0 — Do now | C-2: Fix timing comparison + rate limit agent setup | 30 min | Brute-force of agent key generation |
| P0 — Do now | C-3: Pin langchain >= 0.3.37, run `npm audit fix` | 30 min | Secret extraction via crafted file |
| P1 — Before first user | H-1: Harden CSP (nonce-based, remove unsafe-eval) | 2–4 hrs | XSS protection is currently zero |
| P1 — Before first user | H-2: Sanitize Stripe error response | 10 min | Info disclosure |
| P1 — Before first user | H-3/H-4/M-3: `npm audit fix` for kysely, defu, flatted | 15 min | Transitive injection/pollution |
| P1 — Before first user | H-5: Add HSTS preload | 5 min | SSL stripping on first visit |
| P2 — Next sprint | H-6: Redis-backed rate limiter | 2–4 hrs | Rate limit bypass on restart |
| P2 — Next sprint | M-6: DB-level audit log immutability | 2–4 hrs | Audit trail tamper protection |
| P3 — Sprint after | M-1/M-2: Remove sensitive console.log calls | 15 min | PII/data leakage in logs |
| P3 — Sprint after | M-4: Document raw SQL audit checkpoints | 30 min | Prevent future injection |
| P3 — Sprint after | M-5: Remove API key from usage field | 10 min | Key duplication in response |
| P3 — Sprint after | M-7: Dev fallback encryption warning | 1 hr | Plaintext keys in non-prod DB |

---

## Fast Wins (Do Right Now — Under 1 Hour Total)

```
1. Update package.json: "better-auth": "^1.4.9", "langchain": "^0.3.37"
2. Run: npm audit fix
3. In app/api/agent/setup/route.ts line 20:
   Replace: body.password !== config.selfHosted.password
   With: !timingSafeEqual(body.password, config.selfHosted.password)
   Import: import { timingSafeEqual } from "@/lib/self-hosted-auth"
4. In next.config.ts line 33: add "preload" to HSTS value
5. In app/api/stripe/checkout/route.ts line 48: remove error interpolation
6. Remove console.log(session) at checkout/route.ts line 41
```

That's 6 fixes, 45 minutes of work, removes 2 CRITICAL and 2 HIGH issues.

---

*Deployment decision: Do not put real customer data on this instance until C-1, C-2, and C-3 are resolved. The H-1 CSP issue should be resolved before marketing the product publicly. Everything else can be tracked in a sprint.*
