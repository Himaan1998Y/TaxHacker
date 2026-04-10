# Tier 0 Review — Post-Ship Audit

**Date**: 2026-04-09
**Scope**: Every commit in the Tier 0 wave (28882c5..HEAD), reviewed in isolation against the stated goal from `2026-04-09_tier0_plan.md`, then cross-checked for regressions and latent issues.

## Commit timeline

```
4a8da5c refactor(encryption): evaluate production check per call, not at import  ← review refinement
9d8af3d feat(gstr1): bifurcate Table 12 HSN summary into B2B and B2C tabs        ← 0.6
39731ec fix(security): defence-in-depth throw on missing ENCRYPTION_KEY          ← 0.2
e152f1d feat(gstr3b): clarify Table 3.2 is auto-populated by the portal          ← 0.7
6ea6f89 fix(security): remove "use server" from models/files.ts                  ← 0.5
9b104a3 fix(import): scope CSV import lookups to the calling userId              ← 0.3
27e38dd fix(gstr1): reduce B2CL threshold from ₹2.5L to ₹1L                      ← 0.1
bd42aae ci: run vitest on push and PRs                                           ← 0.4
```

**File footprint**: 13 files changed, +782 / −68.
**Test delta**: 178 → 198 (+20), 15 → 17 test files (+2).
**CI status**: all 8 runs green on GitHub Actions (Ubuntu + Node 22 + pnpm 10).
**Local**: `pnpm test` green, `tsc --noEmit` clean.

---

## Commit-by-commit review

### 0.4 — `bd42aae` ci: run vitest on push and PRs

**Goal**: Gate every commit with vitest so regressions are caught automatically.

**Review**:
- Standalone workflow (`test.yml`) that doesn't touch the existing docker workflows. Good — keeps blast radius minimal.
- Uses `pnpm/action-setup@v4`, `actions/setup-node@v4` with `cache: pnpm`, `actions/checkout@v4`. All current versions.
- Runs on `push` to `main` AND `pull_request` against `main`. Covers both flows.
- Runs `prisma generate` before `pnpm test` — required because some models import types from the generated client.

**Verified**: The workflow has run 8 times (once per Tier 0 commit) and all are green. First-time run validates the CI environment works end-to-end.

**Nit**: no TypeScript check in CI. `tsc --noEmit` is clean locally but isn't verified by CI. **Not a Tier 0 fix — candidate for a Tier 1 CI improvement**.

**Verdict**: ✅ pass

---

### 0.1 — `27e38dd` fix(gstr1): reduce B2CL threshold from ₹2.5L to ₹1L

**Goal**: Legal compliance with Notification 12/2024-CT (1 Aug 2024). Invoices in the ₹1L–₹2.5L inter-state B2C band must be reported as B2CL, not B2CS.

**Review**:
- Constant only; `>` comparison preserved (matches "exceeding ₹1 lakh" rule wording).
- Two regression tests: ₹1.5L inter-state → B2CL (the band that changed); exactly ₹1L → B2CS (boundary).
- Existing test at ₹2.6L still passes — passes under both old and new threshold.
- Notification number and date cited in the source comment and commit message.

**Cross-check**: grepped all uses of `B2CL_THRESHOLD` (2 sites in `lib/gstr1.ts`, strict `>` both times) and all hardcoded `250000` literals in tests (all unrelated to the threshold — they're amounts in rupees or paise for unrelated fixtures).

**Cosmetic nit**: commit message body has literal `\u20b9` escapes instead of ₹. Code is correct, message is stored in git. Not worth rewriting history over.

**Verdict**: ✅ pass

---

### 0.3 — `9b104a3` fix(import): scope CSV import lookups to the calling userId

**Goal**: Close cross-tenant data leak where `findFirst` without a `userId` filter could match another user's row with the same category/project name.

**Review**:
- Added `userId` at the top of both `importProject` and `importCategory` where-clauses. Each branch of the `OR` is still evaluated, but only against rows owned by the calling user.
- 4 regression tests in `tests/export_and_import.test.ts`:
  - Scope tests assert the `userId` field is in the `where` clause (not just the OR).
  - Cross-tenant tests simulate "user-A's row exists" by having `findFirst` return A's row only when called with `userId=user-A`, and null otherwise — verifying the filter actually segregates results.
- Used `vi.hoisted()` correctly (the test initially crashed on hoisting order, fixed before commit).

**Cross-check** — scanned every `findFirst(` call site in `models/**/*.ts`:

| Site | Filter | Status |
|---|---|---|
| `transactions.ts:316` | `userId, total, currencyCode, issuedAt` | ✅ scoped |
| `files.ts:31` | `id, userId` | ✅ scoped |
| `export_and_import.ts:212` | `userId, OR[{code},{name}]` | ✅ fixed in this commit |
| `export_and_import.ts:231` | `userId, OR[{code},{name}]` | ✅ fixed in this commit |
| `progress.ts:26` | `id, userId` | ✅ scoped |
| `users.ts:18` | `email: SELF_HOSTED_USER.email` | ✅ single-tenant self-hosted user |
| `users.ts:58` | `razorpayCustomerId` | ✅ user row *is* the tenant |

No other sites with the same pattern. **The fix is complete across the model layer.**

**Verdict**: ✅ pass

---

### 0.5 — `6ea6f89` fix(security): remove "use server" from models/files.ts

**Goal**: Stop exposing `models/files.ts` functions as publicly-callable Server Action RPC endpoints.

**Review**:
- Two-line diff (delete `"use server"` + blank line). Trivial to verify.
- Every one of the 14 import sites was checked manually before committing — all are server-side (actions.ts, page.tsx server components, route.ts, server libraries).
- Tests + tsc both green after removal.

**Cross-check** — grepped `^"use server"` in `models/**/*.ts`: **zero matches**. No other model files have the same problem. The fix is complete.

**Follow-up observation** (not a Tier 0 regression, noted for Tier 1):
- `models/users.ts:23` still wraps `getOrCreateSelfHostedUser` — a mutation — in `cache()`. This is **audit finding Tier 1.1**, same class of bug we already fixed for `updateSettings`. Still pending as a Tier 1 item.

**Verdict**: ✅ pass

---

### 0.7 — `e152f1d` feat(gstr3b): clarify Table 3.2 is auto-populated by the portal

**Goal**: Inform users that GSTN Phase-III auto-populates Table 3.2 from GSTR-1, so TaxHacker intentionally doesn't compute it.

**Review**:
- UI-only change: adds a blue informational banner under the existing yellow AI-extracted warning.
- No logic change; no test impact (UI component without a snapshot test).
- Imports `Info` from `lucide-react` (same library already in use).

**Gap acknowledged**: we don't actually have a snapshot or component test for the GSTR-3B report page, so the banner's presence isn't asserted by CI. Acceptable for an info-only change.

**Verdict**: ✅ pass

---

### 0.2 — `39731ec` + `4a8da5c` fix(security): ENCRYPTION_KEY invariant

**Goal**: Throw at encryption call sites (not just at boot) if `ENCRYPTION_KEY` is missing in production, so no code path can silently store PII as plaintext.

**Review**:

**Initial commit `39731ec`** added a module-level `const isProductionRuntime` + `getKey()` guard. All 3 new regression tests (plus 11 existing) pass.

**Finding during review** (now fixed in `4a8da5c`): the module-level `const` is captured at import time, which means:
1. Tests depending on `process.env.NODE_ENV` mutation had to rely on `vi.resetModules()` for correctness.
2. Any future import-order scenario where `encryption.ts` is loaded during `NEXT_PHASE=phase-production-build` and reused at runtime would be stuck in dev-mode forever, bypassing the guard silently — the exact class of bug the fix was meant to prevent.

**Refinement commit `4a8da5c`**: extracted `isProductionRuntime()` as a per-call function. Zero behavioural change for the prod-healthy path, but:
- Tests are now correct regardless of module-cache state.
- Runtime always re-reads the env; build-phase imports can never contaminate runtime behavior.
- The guard is robust to Next.js import ordering.

Both commits green in CI and local.

**Deploy risk assessment (re-verified)**: `lib/config.ts:50-55` already throws on missing `ENCRYPTION_KEY` in production at boot time. The currently-running Coolify container **has** the env var — otherwise it would have crash-looped during boot on `bd42aae` or earlier. This commit adds a second check on the same condition; it cannot fail a boot that would not already have failed. The refinement just makes the second check more robust against a latent import-ordering trap.

**Verdict**: ✅ pass (with mid-review improvement)

---

### 0.6 — `9d8af3d` feat(gstr1): Table 12 HSN B2B/B2C bifurcation

**Goal**: Make GSTR-1 exports Phase-III compliant (April 2025+) by splitting Table 12 HSN summary into B2B and B2C tabs.

**Review**:

**Classification correctness**:
- B2B tab = `{b2b, cdnr}` — both carry a GSTIN.
- B2C tab = `{b2cl, b2cs, exp, cdnur, nil, exempt}` — all recipient-unregistered or export (which GSTN maps to Table 6A → B2C).
- Excluded = `{skip, at, atadj}` — advances aren't in Table 12.

Pinned down by a **dedicated test that routes exports to B2C** — this is the most counter-intuitive mapping (exports *sound* like registered transactions because an IEC is involved, but GSTN's validation mapping puts 6A into B2C). If a future dev assumes exp = B2B, this test immediately catches it.

**Back-compat**:
- `GSTR1Summary.hsn` kept as a B2B-first concatenation. All pre-Phase-III callers and the legacy JSON `hsn` key still work.
- `aggregateHSN()` kept as a default-to-"all" function with an optional bucket arg — old call sites are untouched.
- JSON export emits `hsn_b2b` + `hsn_b2c` **and** the legacy `hsn` — offline tools from both eras keep working during rollover.
- CSV export emits `hsn_b2b.csv` + `hsn_b2c.csv` **and** legacy `hsn.csv`.

**DRY**: `hsnJsonRow()` helper ensures all three JSON outputs stay in lockstep. `hsnRowFor()` helper in the CSV route does the same. `finaliseHSNEntries()` and `emptyHSNEntry()` keep the two aggregation paths consistent.

**Tests**: 11 new tests in `tests/gstr1-hsn-split.test.ts`:
- `hsnBucketForSection` routing for every section (covers all 11 GSTR1 sections)
- split correctly separates b2b and b2cs under the same HSN
- exports (exp) land in B2C (the counter-intuitive case)
- skip/at/atadj excluded from both tabs
- `aggregateHSN('b2b')` output matches `aggregateHSNSplit().b2b`
- legacy `aggregateHSN()` with no arg still returns both buckets (back-compat)
- generated report exposes `hsnB2B`, `hsnB2C`, and ordered combined `hsn`
- JSON export emits `hsn_b2b`, `hsn_b2c`, and legacy `hsn` keys

**UI**: two `SectionCard` components with an explanatory blue banner. Each section only renders when its bucket has rows — a user without B2B transactions only sees the B2C card, and vice versa.

**Cross-check**: grepped all consumers of `report.hsn*` — 3 sites in the export route, 3 sites in the report component, and the internal `generateGSTR1JSON` call. All reference the new fields correctly. No stale references.

**Known gaps** (acknowledged, not Tier 0 regressions):
- GSTN Phase-III also requires HSN codes to be selected from a dropdown (not free-text). We still accept free-text HSN from AI extraction and category settings. Users can still enter invalid HSN codes — the portal will reject them at upload time, but our tool doesn't pre-validate. This is a **UX compliance gap**, not a data-correctness bug. Candidate for Tier 1.
- No snapshot/component test for the new UI — same gap as 0.7.

**Verdict**: ✅ pass

---

## Cross-cutting checks

### 1. Tests + typecheck + CI
- `pnpm test` → 17 files / 198 tests pass locally (Windows)
- `tsc --noEmit` → clean
- GitHub Actions `Test` workflow → 8 successful runs (Linux + Node 22 + pnpm 10)
- **Zero platform-specific issues** between local Windows and CI Linux

### 2. Lint
- `next lint` reports 8 pre-existing warnings (in `lib/stats.ts`, `lib/tally-export.ts`, `lib/utils.ts`, `lib/gstr3b.ts`). **None in code touched by Tier 0.** Not a regression.

### 3. `pnpm audit`
- Not run during review; the security audit agent didn't flag any new vulns introduced by Tier 0. Candidate for a standalone check in Tier 1.

### 4. Pattern checks — did the audit agents' flagged patterns recur anywhere else?

| Pattern | Site fixed | Other occurrences | Status |
|---|---|---|---|
| `"use server"` in `models/*` | `models/files.ts` | **0** | ✅ complete |
| Unscoped `findFirst` | `export_and_import.ts` (2 sites) | **0** in model layer | ✅ complete |
| `cache(async ...)` wrapping a mutation | `updateSettings` (pre-Tier-0) | **1** — `models/users.ts:23 getOrCreateSelfHostedUser` | ⚠️ Tier 1.1 still open |
| Silent `ENCRYPTION_KEY` fallback | `lib/encryption.ts` | **0** | ✅ complete |
| HSN aggregated into one bucket | `lib/gstr1.ts` | **0** | ✅ complete |

---

## Issues found during review (now fixed)

1. **0.2 encryption per-call check** — module-level `const` capture was brittle. Fixed in `4a8da5c` by extracting `isProductionRuntime()` as a function. Tests still pass, refactor is mechanical and zero-risk.

## Known gaps (accepted, not regressions)

1. **CI doesn't run `tsc --noEmit`** — only vitest. Should be added in Tier 1.
2. **CI doesn't run `next lint`** — same.
3. **No component/snapshot tests** for the GSTR-1/3B report pages. Banner additions and UI splits are not asserted by CI.
4. **No `pnpm audit` gate in CI**.
5. **HSN dropdown enforcement** (Phase-III requires selection from a master list, not free-text). Tier 1 candidate.
6. **Tier 1.1 mutation-in-`cache()` bug at `models/users.ts:23`** — exact same class we already fixed elsewhere. Still open.
7. **Commit message cosmetic nits**: commits `27e38dd` and `9b104a3` have literal `\u20b9` escapes in their bodies where `₹` was intended. Code is correct; only the stored commit message is cosmetically wrong. Not worth rewriting history.

## Overall verdict

**Tier 0 is complete and clean.** Every commit matches its stated goal, regression tests exist for every behavioural change, CI is green across all 8 runs, and the one issue surfaced during review (the brittle module-level const in 0.2) has already been fixed.

The biggest risks going into Tier 1 are the items we knowingly deferred:
- **1.1** mutation-in-cache (cheap fix, same pattern as one already solved)
- **1.8** pgvector never runs in production (invisible silent failure)
- **1.7** Section 17(5) ITC blocking refresh (needs the Budget 2025-26 CSR/plant amendments)
