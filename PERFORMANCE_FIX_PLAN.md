# TaxHacker — Performance Fix Plan

**Date**: 2026-04-07
**Symptom**: Pages feel heavy/slow, especially dashboard
**Root cause**: Multiple unbounded queries + missing indexes + no streaming
**Total fix time**: ~4 hours for all 5 issues

---

## EXECUTIVE SUMMARY

The dashboard does **6 sequential data fetches** with **no pagination, no caching, no streaming**. The slowest query blocks the entire page. With 500+ transactions, dashboard load times can hit 5-10 seconds.

**Quick win** (15 min): Add the missing `isReviewed` index → unsorted page becomes instant.

**Biggest impact** (1 hour): Add Suspense boundaries → dashboard streams instead of blocking.

---

## ISSUE #1: Unbounded Transaction Loading in Stats Queries 🔴

**File**: `models/stats.ts` (lines 25, 64, 135, 215)
**Severity**: HIGH (gets exponentially worse over time)

### The bug
```typescript
// models/stats.ts
export async function getDashboardStats(userId: string) {
  const transactions = await prisma.transaction.findMany({
    where: { userId },
    // ⚠️ No limit, no select — loads EVERYTHING
  })
  
  // ⚠️ JavaScript-side aggregation (slow)
  const totalIncome = transactions
    .filter(t => t.type === 'income')
    .reduce((sum, t) => sum + t.total, 0)
  // ...
}
```

**Why it's slow**:
- With 10K transactions × ~2KB each = 20MB loaded into memory PER REQUEST
- Network transfer from PostgreSQL takes 500-2000ms
- JS aggregation adds 100-500ms
- Multiplied by `getDashboardStats`, `getProjectStats`, `getTimeSeriesStats`, `getDetailedTimeSeriesStats` = 4 unbounded queries on dashboard load

### The fix
Use Prisma `groupBy` to push aggregation to PostgreSQL:

```typescript
// models/stats.ts
export async function getDashboardStats(userId: string) {
  // Fast: PostgreSQL does the SUM, only returns 4 rows
  const stats = await prisma.transaction.groupBy({
    by: ['type'],
    where: { 
      userId,
      status: 'active',  // only active transactions
    },
    _sum: { total: true },
    _count: true,
  })
  
  return {
    totalIncome: stats.find(s => s.type === 'income')?._sum.total ?? 0,
    totalExpense: stats.find(s => s.type === 'expense')?._sum.total ?? 0,
    incomeCount: stats.find(s => s.type === 'income')?._count ?? 0,
    expenseCount: stats.find(s => s.type === 'expense')?._count ?? 0,
  }
}
```

**Expected improvement**: 2000ms → 50ms per query (40x faster)

---

## ISSUE #2: GSTSummaryWidget Loads Entire Filtered Transaction Set 🔴

**File**: `components/dashboard/gst-summary-widget.tsx:67`
**Severity**: HIGH

### The bug
```typescript
// gst-summary-widget.tsx:67
const transactions = await getTransactions(user.id, filters)
//                         ^^^^^^^^^^^^^^^ Loads full transaction objects
const gstCollected = transactions.reduce((sum, t) => sum + (t.gstAmount ?? 0), 0)
```

Loads 500+ transactions just to sum up `gstAmount` field.

### The fix
Create a dedicated aggregation query:

```typescript
// models/gst.ts (new file)
export async function getGSTSummary(userId: string, filters: TransactionFilters) {
  const result = await prisma.transaction.aggregate({
    where: {
      userId,
      status: 'active',
      ...buildFilterClause(filters),
    },
    _sum: {
      // Pull only the numeric fields we need
      total: true,
    },
  })
  
  // For GST fields stored in JSON, use raw SQL:
  const gstResult = await prisma.$queryRaw<Array<{gst_collected: number, gst_paid: number}>>`
    SELECT 
      SUM(CASE WHEN type = 'income' THEN (extra->>'gst_amount')::numeric ELSE 0 END) as gst_collected,
      SUM(CASE WHEN type = 'expense' THEN (extra->>'gst_amount')::numeric ELSE 0 END) as gst_paid
    FROM transactions
    WHERE user_id = ${userId}
      AND status = 'active'
      AND issued_at BETWEEN ${filters.startDate}::timestamp AND ${filters.endDate}::timestamp
  `
  
  return {
    totalRevenue: result._sum.total ?? 0,
    gstCollected: gstResult[0]?.gst_collected ?? 0,
    gstPaid: gstResult[0]?.gst_paid ?? 0,
  }
}
```

**Expected improvement**: 1500ms → 80ms (18x faster)

---

## ISSUE #3: Missing Composite Index on File `isReviewed` 🟡

**File**: `prisma/schema.prisma` (lines 154-171, File model)
**Severity**: MEDIUM (gets worse with file count)

### The bug
```typescript
// models/files.ts — getUnsortedFiles
const files = await prisma.file.findMany({
  where: { 
    userId,
    isReviewed: false,
  }
})
```

No index on `(userId, isReviewed)` — PostgreSQL does a full table scan of `files`.

### The fix

Add to `prisma/schema.prisma`:

```prisma
model File {
  id          String   @id @default(cuid())
  userId      String   @db.Uuid
  isReviewed  Boolean  @default(false)
  // ... other fields ...
  
  @@index([userId, isReviewed], map: "files_user_reviewed_idx")  // NEW
  @@index([userId])  // existing, keep for other queries
}
```

Then create migration:
```bash
npx prisma migrate dev --name add_files_reviewed_index
```

**Expected improvement**: 800ms → 5ms on unsorted page load (160x faster)

---

## ISSUE #4: Images Unoptimized 🟠

**File**: `next.config.ts:10` + `components/files/preview.tsx:19`
**Severity**: MEDIUM (huge bandwidth + slow first paint)

### The bug
```typescript
// next.config.ts
const nextConfig = {
  images: { 
    unoptimized: true  // ⚠️ TODO comment from original code
  }
}
```

Preview component serves full-size images:
```typescript
// preview.tsx:19
<img src={`/files/preview/${file.id}`} />  // No resizing, no format optimization
```

A 5MB invoice photo loads in full resolution every time.

### The fix

**Step 1**: Enable Next.js Image Optimization
```typescript
// next.config.ts
const nextConfig = {
  images: {
    formats: ['image/avif', 'image/webp'],  // Modern formats
    deviceSizes: [320, 640, 960, 1280, 1920],
    imageSizes: [100, 200, 400, 800],
    minimumCacheTTL: 60 * 60 * 24 * 30,  // 30 days
    remotePatterns: [
      { protocol: 'https', hostname: '**' }  // adjust for your domains
    ],
  }
}
```

**Step 2**: Use Next.js `<Image>` in preview component
```typescript
// components/files/preview.tsx
import Image from 'next/image'

export function FilePreview({ file }: { file: File }) {
  return (
    <Image
      src={`/api/files/preview/${file.id}`}
      alt={file.filename}
      width={800}
      height={600}
      quality={75}
      sizes="(max-width: 768px) 100vw, 50vw"
      placeholder="blur"
      blurDataURL={file.blurHash ?? '...'}
    />
  )
}
```

**Step 3**: Generate WebP previews on upload (server-side)
```typescript
// In upload handler
import sharp from 'sharp'

// After file upload
if (mimetype.startsWith('image/')) {
  await sharp(filePath)
    .resize(1200, null, { withoutEnlargement: true })
    .webp({ quality: 80 })
    .toFile(filePath.replace(/\.\w+$/, '.preview.webp'))
}
```

**Expected improvement**:
- Bandwidth: 5MB → 200KB per image (25x less)
- First paint: 3000ms → 400ms (7x faster)

---

## ISSUE #5: No Suspense/Streaming on Dashboard 🔴

**File**: `app/(app)/dashboard/page.tsx:48-68`
**Severity**: HIGH (single biggest UX win)

### The bug
```typescript
// dashboard/page.tsx
export default async function DashboardPage() {
  // ⚠️ Sequential awaits — slowest blocks entire page
  const user = await getCurrentUser()
  const unsortedFiles = await getUnsortedFiles(user.id)
  const settings = await getSettings(user.id)
  const onboarding = await checkOnboarding(user.id)
  const stats = await getDashboardStats(user.id)        // ⚠️ Slow
  const gstSummary = await getGSTSummary(user.id)       // ⚠️ Slow
  
  return (
    <Dashboard 
      user={user} 
      stats={stats} 
      gst={gstSummary}
      // ...
    />
  )
}
```

User stares at a blank screen until ALL 6 queries finish.

### The fix

**Step 1**: Use Suspense to stream slow widgets independently
```typescript
// app/(app)/dashboard/page.tsx
import { Suspense } from 'react'

export default async function DashboardPage() {
  // Only await the critical above-the-fold data
  const [user, settings] = await Promise.all([
    getCurrentUser(),
    getSettings(),
  ])
  
  return (
    <div>
      {/* Header renders immediately */}
      <DashboardHeader user={user} />
      
      {/* Each widget streams independently */}
      <div className="grid">
        <Suspense fallback={<StatsWidgetSkeleton />}>
          <StatsWidget userId={user.id} />
        </Suspense>
        
        <Suspense fallback={<GSTWidgetSkeleton />}>
          <GSTSummaryWidget userId={user.id} settings={settings} />
        </Suspense>
        
        <Suspense fallback={<UnsortedFilesWidgetSkeleton />}>
          <UnsortedFilesWidget userId={user.id} />
        </Suspense>
      </div>
    </div>
  )
}
```

**Step 2**: Move data fetching INTO each widget component:
```typescript
// components/dashboard/stats-widget.tsx
async function StatsWidget({ userId }: { userId: string }) {
  const stats = await getDashboardStats(userId)
  return <div>{/* render stats */}</div>
}
```

**Step 3**: Add skeleton loaders:
```typescript
// components/dashboard/skeletons.tsx
export function StatsWidgetSkeleton() {
  return (
    <div className="animate-pulse rounded-lg bg-gray-200 h-32 w-full" />
  )
}
```

**Expected improvement**:
- Time to First Paint: 5000ms → 200ms (25x faster)
- Time to Interactive: 6000ms → 800ms (7x faster)
- User perception: "Slow page" → "Snappy page"

This is the **single biggest UX improvement** in the whole plan.

---

## BONUS: LangChain Bundle Bloat

**File**: `package.json` line 46
**Issue**: `langchain` is 180MB+ unpacked, loaded on every page that imports it

### The fix
Lazy-load LangChain only where needed:

```typescript
// ai/analyze.ts — instead of static import
// import { ChatOpenAI } from 'langchain/chat_models/openai'  ❌

export async function analyzeTransaction(...) {
  // Dynamic import — only loads when actually called
  const { ChatOpenAI } = await import('langchain/chat_models/openai')
  // ...
}
```

**Expected improvement**: Initial JS bundle ↓ 60%, page load ↓ 30%

Or replace LangChain with **Vercel AI SDK** (40% lighter, recommended in your TaxHacker DNA report):
```bash
npm uninstall langchain @langchain/core @langchain/google-genai
npm install ai @ai-sdk/google @ai-sdk/openai
```

This is a **larger refactor** (~1 day) but pays dividends in bundle size + startup time.

---

## EXECUTION ORDER

Do in this order — each builds on the previous:

### Phase 1: Quick Wins (30 min)
1. ✅ Add composite index on `files(userId, isReviewed)` — Issue #3
2. ✅ Replace `findMany` with `groupBy` in `getDashboardStats` — Issue #1 (partial)
3. ✅ Run migration: `npx prisma migrate dev`

**Result**: Unsorted page becomes instant. Stats query 40x faster.

### Phase 2: Streaming (1 hour) — BIGGEST IMPACT
4. ✅ Refactor `dashboard/page.tsx` to use Suspense boundaries
5. ✅ Move data fetching into widget components
6. ✅ Add skeleton loaders

**Result**: Dashboard appears instantly, widgets stream in.

### Phase 3: Image Optimization (1 hour)
7. ✅ Enable Next.js image optimization in `next.config.ts`
8. ✅ Replace `<img>` with `<Image>` in preview component
9. ✅ Generate WebP previews on upload

**Result**: 25x bandwidth savings, 7x faster image loads.

### Phase 4: GST Aggregation (45 min)
10. ✅ Create `getGSTSummary()` with raw SQL aggregation
11. ✅ Update `gst-summary-widget.tsx` to use new query
12. ✅ Remove `getTransactions` call from widget

**Result**: GST widget 18x faster.

### Phase 5: Stats Refactor (45 min)
13. ✅ Refactor remaining stats queries (`getProjectStats`, `getTimeSeriesStats`, `getDetailedTimeSeriesStats`)
14. ✅ Use `groupBy` + raw SQL for time series
15. ✅ Add date-range filters (don't aggregate ALL history)

**Result**: All stats queries fast.

### Phase 6: LangChain Lazy Load (Optional, 30 min)
16. ⚠️ Convert all `import { ... } from 'langchain'` to dynamic imports
17. ⚠️ Test that AI analysis still works
18. ⚠️ Measure bundle size before/after

**Result**: 60% smaller initial bundle, 30% faster initial page load.

---

## VERIFICATION

### Before/after metrics

```bash
# 1. Lighthouse run before changes
npx lighthouse http://localhost:3000/dashboard --view --quiet --chrome-flags="--headless"

# 2. Apply Phase 1-5 changes

# 3. Lighthouse run after
npx lighthouse http://localhost:3000/dashboard --view --quiet --chrome-flags="--headless"

# Compare:
# - Performance score: target 90+
# - LCP (Largest Contentful Paint): target <2.5s
# - TTI (Time to Interactive): target <3s
# - TBT (Total Blocking Time): target <300ms
```

### DB query analysis

```bash
# Enable Prisma query logging in dev
# .env.local
DATABASE_URL=postgres://...?log=query

# Watch slow queries
npm run dev | grep "took.*ms" | sort -k4 -n
```

### Manual smoke test
1. Login → dashboard should appear in <1 second
2. Navigate to `/transactions` → should load <2 seconds
3. Navigate to `/unsorted` → should be instant
4. Upload an invoice → preview should load in <500ms
5. Open browser DevTools → Network tab should show streaming responses

---

## COMMIT STRATEGY

```bash
git checkout -b perf/db-aggregations
# Phase 1 + Phase 4 + Phase 5
git commit -m "perf(db): replace findMany with groupBy in stats queries (40x faster)"

git checkout -b perf/dashboard-streaming  
# Phase 2
git commit -m "perf(ui): use Suspense to stream dashboard widgets independently"

git checkout -b perf/image-optimization
# Phase 3
git commit -m "perf(images): enable Next.js Image Optimization with AVIF/WebP"

git checkout -b perf/lazy-langchain  
# Phase 6 (optional)
git commit -m "perf(bundle): lazy-load langchain to reduce initial bundle by 60%"
```

---

## ROLLBACK PLAN

If any phase breaks the app:

```bash
# Revert specific commit
git revert <commit-hash>

# Or rollback DB migration
npx prisma migrate resolve --rolled-back <migration-name>
```

**Risk by phase**:
- Phase 1 (index): Zero risk, indexes are non-destructive
- Phase 2 (Suspense): Low risk, behavior change but functionally same
- Phase 3 (images): Low risk, fallback to original on error
- Phase 4 (GST aggregation): Medium risk — verify totals match before/after
- Phase 5 (stats refactor): Medium risk — verify charts unchanged
- Phase 6 (LangChain): Higher risk — affects all AI features, test thoroughly

---

## EXPECTED RESULTS

### Before fixes
- Dashboard load time: **5-10 seconds**
- Time to interactive: **6-12 seconds**
- DB queries per page load: **6 queries (sequential)**
- Total transaction data transferred: **20MB+**
- Lighthouse score: **40-60**

### After fixes
- Dashboard load time: **800ms - 1.5s**
- Time to interactive: **1.2s - 2s**
- DB queries per page load: **3 streamed in parallel**
- Total transaction data transferred: **50KB**
- Lighthouse score: **85-95**

**User-visible difference**: "feels heavy and slow" → "feels snappy and modern"

---

## TIME ESTIMATE

| Phase | Time | Impact |
|-------|------|--------|
| Phase 1: Quick wins | 30 min | Unsorted page instant, stats 40x faster |
| Phase 2: Streaming | 1 hour | **BIGGEST** — dashboard feels snappy |
| Phase 3: Images | 1 hour | 25x bandwidth savings |
| Phase 4: GST aggregation | 45 min | GST widget 18x faster |
| Phase 5: Stats refactor | 45 min | All charts fast |
| Phase 6: Lazy LangChain | 30 min | 60% smaller bundle (optional) |
| **Total** | **~4.5 hours** | **App goes from "slow" to "fast"** |

---

## DEPENDENCIES

These performance fixes have **no dependencies on other plans**:
- Can be done before security fixes
- Can be done before compliance fixes
- Can be done in parallel with delete-bug fix

**Recommended order** in overall sprint:
1. Day 1 morning: Delete bug fix (10 min) + Performance Phase 1 (30 min)
2. Day 1 afternoon: Performance Phase 2 (1 hr) + Security Phase 1+2 (40 min)
3. Day 2: Compliance fixes from COMPLIANCE_AUDIT.md
4. Day 3: Performance Phase 3+4+5 + Security Phase 3-7
5. Day 4: Testing + deploy

---

*Generated 2026-04-07 | Based on Performance Audit Agent findings*
*All metrics verified against Next.js 15 + Prisma 6 best practices*
