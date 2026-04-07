# Dimension 1: Security & Auth Audit Findings
**Date**: 2026-03-31
**Reviewer**: Senior Code Review
**Files Reviewed**: middleware.ts, lib/encryption.ts, lib/self-hosted-auth.ts, lib/config.ts, lib/rate-limit.ts, lib/audit.ts, lib/security-log.ts, lib/files.ts, app/api/agent/auth.ts, app/api/agent/transactions/route.ts, app/api/agent/files/route.ts, app/(app)/files/download/[fileId]/route.ts, docker-entrypoint.sh, next.config.ts

---

## CRITICAL (2)

### C1 — Encryption silently falls back to plaintext in production
**File**: `lib/encryption.ts:6-10`
**Issue**: If `ENCRYPTION_KEY` is missing or not exactly 64 hex chars, `getKey()` returns an empty buffer and `encrypt()` returns the raw plaintext string. There is zero runtime warning in production. Financial/tax data (GST numbers, PAN, bank details in settings) is stored unencrypted with no indication.
**Config**: `lib/config.ts:7` marks `ENCRYPTION_KEY` as `optional()` — Zod will happily parse without it.
**Fix**: Add a startup check: if `NODE_ENV === "production"` and `ENCRYPTION_KEY` is not set, throw an error and refuse to start.

### C2 — Default BETTER_AUTH_SECRET only warns, doesn't block
**File**: `lib/config.ts:31-33`
**Issue**: If deployed with the default secret `"please-set-your-key-here"`, all session JWTs can be forged by anyone who reads the source code. The code only does `console.warn` — it does not throw or exit.
**Fix**: Change to `throw new Error(...)` in production, not `console.warn`.

---

## HIGH (6)

### H1 — SHA-256 used for password hashing (should be bcrypt/argon2)
**File**: `lib/self-hosted-auth.ts:9-14`
**Issue**: `hashSelfHostedToken` uses a single SHA-256 of `password + secret`. SHA-256 is a fast hash — GPUs can compute ~10 billion/sec. An offline attacker who gets the cookie value can brute-force the password in minutes.
**Why it matters**: The cookie token IS the hash. If someone intercepts the cookie (XSS, network sniff), they can crack the original password offline.
**Fix**: Use `bcrypt` (cost 12) or `argon2id`. Store the hash, not derive it live from the password every request.

### H2 — Agent API key stored as plaintext in DB
**File**: `app/api/agent/auth.ts:66-69`
**Issue**: `setting.value` (the stored API key) is compared directly against the incoming `X-Agent-Key`. If the database is compromised, all API keys are immediately usable. There is no rotation mechanism.
**Fix**: Store `sha256(apiKey)` in the database; hash the incoming key before comparison.

### H3 — No file size limit on agent file uploads
**File**: `app/api/agent/files/route.ts` (no size check anywhere)
**Issue**: A caller with a valid API key can upload arbitrarily large files. The `serverActions.bodySizeLimit: "256mb"` in next.config.ts applies only to Server Actions, not API routes. An attacker could exhaust disk in minutes.
**Fix**: Check `file.size` against a max (e.g. 50MB) before writing to disk.

### H4 — MIME type validation is client-controlled
**File**: `app/api/agent/files/route.ts:46-52`
**Issue**: `file.type` in a multipart form is the `Content-Type` value sent by the client — it is trivially spoofable. An HTML file sent as `image/jpeg` passes the check and gets stored. If served back, could lead to XSS.
**Fix**: Use the `file-type` npm package to detect MIME from magic bytes after reading the buffer.

### H5 — Internal file path leaked in 404 error response
**File**: `app/(app)/files/download/[fileId]/route.ts:28`
**Issue**: `return new NextResponse('File not found on disk: ${file.path}', { status: 404 })` sends the server's internal filesystem path to the client. Reveals directory structure.
**Fix**: Return generic `"File not found"` message; log the path server-side only.

### H6 — No Content-Security-Policy header
**File**: `next.config.ts:17-29`
**Issue**: HSTS, X-Frame-Options, X-Content-Type-Options are all set — good. But there is no `Content-Security-Policy`. For a financial app that renders user-supplied content (invoice templates, transaction names), CSP is a critical XSS mitigation layer.
**Fix**: Add a CSP header. Start with `default-src 'self'; script-src 'self' 'unsafe-inline'` and tighten from there.

---

## MEDIUM (5)

### M1 — serverActions.bodySizeLimit set to 256MB
**File**: `next.config.ts:13-15`
**Issue**: 256MB is enormous for a tax app — largest legitimate upload would be a PDF invoice, maybe 10MB. This limit enables a DoS via repeated large Server Action calls.
**Fix**: Reduce to `20mb` or lower.

### M2 — Rate limiter is in-memory, not distributed
**File**: `lib/rate-limit.ts`
**Issue**: The `Map`-based store is per-process. With multiple Node.js workers (or horizontal scaling in cloud mode), each worker has its own counter. A determined attacker gets `N × limit` requests per window where N = worker count.
**Fix**: For self-hosted single instance this is fine. For cloud mode, use Redis-backed rate limiting (the VPS already has Redis running).

### M3 — getUserUploadsDirectory uses email as directory name
**File**: `lib/files.ts:12-14`
**Issue**: `path.join(FILE_UPLOAD_PATH, user.email)` — `safePathJoin` correctly guards against traversal, but emails can contain characters problematic on some filesystems (e.g., `+`, spaces). While not exploitable due to `safePathJoin`, it's fragile.
**Fix**: Use `user.id` (UUID) as the directory name instead of email.

### M4 — Audit log failures silently swallowed
**File**: `lib/audit.ts:47`, `lib/security-log.ts:38-41`
**Issue**: Both functions catch all errors and only `console.error`. For a Companies Act-compliant audit trail, a failed write should alert or at least increment a metric. Silent failure means you lose audit evidence with no awareness.
**Fix**: Re-throw or emit a metric/alert. At minimum, log to a separate file/sink that doesn't depend on DB.

### M5 — No `Cache-Control: no-store` on file downloads
**File**: `app/(app)/files/download/[fileId]/route.ts`
**Issue**: Financial documents (invoices, receipts) served without `Cache-Control: no-store` may be cached by intermediate proxies or browser cache, accessible to other users on shared machines.
**Fix**: Add `Cache-Control: no-store, no-cache` and `Pragma: no-cache` headers to download responses.

---

## LOW (4)

### L1 — ESLint disabled during builds
**File**: `next.config.ts:6-8`
**Issue**: `eslint: { ignoreDuringBuilds: true }` means security-relevant lint rules (`no-eval`, `no-dangerouslySetInnerHTML`, etc.) are skipped in CI/CD.
**Fix**: Fix the lint errors and re-enable, or at minimum run `eslint` as a separate CI step.

### L2 — Console logs in production expose internals
**Files**: Multiple (agent auth, file upload, analyze routes)
**Issue**: `console.error("Agent API: file upload error:", error)` in production may include stack traces, file paths, or DB error messages in server logs accessible to hosting provider.
**Fix**: Use a structured logger (pino/winston) that sanitizes errors. Already using Sentry — ensure Sentry captures these instead.

### L3 — Docker entrypoint runs DB migrations at startup
**File**: `docker-entrypoint.sh:16-17`
**Issue**: `prisma migrate deploy` at startup can be dangerous if multiple replicas start simultaneously (migration race). Fine for single-instance self-hosted, risky for cloud horizontal scaling.
**Fix**: For cloud: run migrations as a separate pre-deploy job, not at app startup.

### L4 — pgvector setup in entrypoint is best-effort
**File**: `docker-entrypoint.sh:20-25`
**Issue**: The `2>/dev/null || echo "pgvector not available"` pattern silently skips embedding indexing. If pgvector IS available but the DDL fails for another reason (permissions, syntax), it's invisible.
**Fix**: Log failures to stdout explicitly, or check pgvector availability before attempting DDL.

---

## What's Done Well ✓

- `safePathJoin` correctly prevents path traversal (lib/files.ts:53-58)
- `crypto.timingSafeEqual` used for API key comparison (agent/auth.ts:69) — prevents timing attacks
- Per-route rate limits in middleware with independent windows per route group
- `X-Content-Type-Options: nosniff` on file downloads
- Comprehensive security event types in security-log.ts
- Sentry integration for error monitoring
- HSTS, X-Frame-Options, Referrer-Policy all set in next.config.ts
- Auth check on download: `file.userId !== user.id` double-check (defense in depth)
- No raw SQL — all queries through Prisma ORM (no SQL injection surface)

---

## Summary

| Severity | Count |
|----------|-------|
| Critical | 2 |
| High | 6 |
| Medium | 5 |
| Low | 4 |
| **Total** | **17** |

**Top 3 fixes (do these before going live with real user data):**
1. **C1** — Make ENCRYPTION_KEY mandatory in production (1 line fix in config.ts)
2. **C2** — Throw on default BETTER_AUTH_SECRET in production (1 line fix in config.ts)
3. **H3** — Add file size limit to agent upload route (3 line fix)
