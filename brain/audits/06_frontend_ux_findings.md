# Dimension 6: Frontend / UX Findings
**Date**: 2026-03-31
**Files Reviewed**: components/transactions/list.tsx, components/transactions/create.tsx, components/dashboard/onboarding-checklist.tsx, app/(app)/transactions/page.tsx

---

## HIGH (2)

### H1 — 500 transactions rendered in DOM simultaneously
**File**: `app/(app)/transactions/page.tsx:22`
**Issue**: `TRANSACTIONS_PER_PAGE = 500` — 500 table rows, each with multiple cells and Lucide icons, means ~2000-5000 DOM nodes rendered at once. On mid-range Android devices (the primary Indian market target), this causes 3-6 second initial render and janky scrolling.
**Evidence**: The `total` count is shown in the header — if a user has 3000 transactions, they see page 1 of 6 with 500 rows, each visually painful to scroll through.
**Fix**: Reduce to 50-100 per page. Add infinite scroll or conventional pagination. For power users, virtual scrolling via `@tanstack/virtual`.

### H2 — `useEffect` on `[sorting]` causes infinite/unnecessary navigation loop
**File**: `components/transactions/list.tsx:294-303`
**Issue**: The `useEffect` that syncs sorting state to URL params runs on EVERY change to `sorting`, including the initial mount when `sorting` is initialized from the URL:
```ts
const [sorting, setSorting] = useState(() => {
  // reads from searchParams → initializes state
})

useEffect(() => {
  router.push(`/transactions?${params.toString()}`) // runs on mount too
}, [sorting])
```
On initial page load with an existing `ordering` param (e.g., `/transactions?ordering=-issuedAt`), the effect fires, pushes the same URL again, causing a redundant server round-trip and flickering.
**Fix**: Add a `hasMounted` ref and skip the effect on initial render.

---

## MEDIUM (5)

### M1 — No loading indicator when navigating to transaction detail
**File**: `components/transactions/list.tsx:266-268`
**Issue**: `router.push('/transactions/${id}')` on row click. Between click and navigation, there is no loading state. On slow connections, the UI appears frozen. Users may click the row 2-3 times thinking it didn't register.
**Fix**: Use `useTransition` from React 19 or add a loading state: `const [navigatingId, setNavigatingId] = useState<string | null>(null)`. Show a spinner overlay on the row while navigating.

### M2 — Import link wrapped in non-navigable button
**File**: `components/transactions/create.tsx:116-120`
```tsx
<Button type="button" variant="outline" className="aspect-square">
  <Link href="/import/csv">
    <Import className="h-4 w-4" />
  </Link>
</Button>
```
**Issue**: The outer `<Button>` captures click events but doesn't navigate. Only the `<Import>` icon (the `<Link>` child) navigates. Click target is just the small icon — a tiny hit area on mobile. Keyboard users pressing Enter on the button get nothing.
**Fix**: Wrap `<Button>` inside `<Link>`, not the other way around.

### M3 — `bg-yellow-50` for incomplete transactions doesn't work in dark mode
**File**: `components/transactions/list.tsx:342`
**Issue**: `isTransactionIncomplete(fields, transaction) && "bg-yellow-50"` — hardcoded light yellow. In dark mode, yellow-50 is nearly invisible (it's a very light color on a dark background). The visual distinction between complete and incomplete transactions disappears entirely.
**Fix**: Use semantic color like `className={isIncomplete ? "bg-warning/10" : ""}` and define `warning` in the Tailwind config, or use conditional dark-mode classes.

### M4 — Create form mixes controlled and uncontrolled inputs
**File**: `components/transactions/create.tsx:30-113`
**Issue**: The form has a `useState(formData)` hook, but most inputs use `defaultValue` (uncontrolled), while `FormSelectCurrency` uses `value` (controlled). This creates an inconsistent state management model:
- Changes to `formData.currencyCode` via setState DO update the select (controlled)
- But `formData.name`, `formData.total` etc. are only used as initial values — user changes to these fields are not reflected in React state

The practical result: the `currencyCode !== settings.default_currency` conditional on line 77 works correctly because that field IS controlled. But if you tried to programmatically reset the form, it would fail for all the uncontrolled inputs.

**Fix**: Either go fully controlled (use `value` + `onChange` on all inputs) or fully uncontrolled (use a `ref` on the form and read FormData on submit — which is essentially what the server action does anyway). Remove the unused state for non-reactive fields.

### M5 — Checkbox toggle uses fake MouseEvent object
**File**: `components/transactions/list.tsx:350-355`
```ts
toggleOneRow({ stopPropagation: () => {} } as React.MouseEvent, transaction.id)
```
**Issue**: Creating a fake partial MouseEvent object to satisfy the `toggleOneRow` signature is a code smell. `toggleOneRow` only calls `e.stopPropagation()` anyway.
**Fix**: Refactor `toggleOneRow` to not take a MouseEvent parameter. Call `e.stopPropagation()` in the `onCheckedChange` handler itself.

---

## LOW (4)

### L1 — Transaction rows not keyboard-accessible
**File**: `components/transactions/list.tsx:339-363`
**Issue**: `<TableRow onClick={() => handleRowClick(transaction.id)}>` — clickable rows have no `role="button"`, no `tabIndex={0}`, no `onKeyDown` handler. Keyboard-only users (and screen readers) cannot navigate to a transaction by pressing Enter.
**Impact**: WCAG 2.1 Level A failure (keyboard accessibility). Matters for visually impaired users and tax professionals using keyboard-heavy workflows.
**Fix**: Add `role="button" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && handleRowClick(transaction.id)}`.

### L2 — "other" transaction type uses hardcoded black text
**File**: `components/transactions/list.tsx:95`
**Issue**: `other: "text-black"` — black text on dark mode backgrounds is invisible. Should be `"text-foreground"` (Tailwind semantic color).

### L3 — Empty `<></>` conditional for converted total
**File**: `components/transactions/create.tsx:87-89`
**Issue**:
```tsx
} : (
  <></>
)}
```
An empty fragment returned from a conditional is unnecessary JSX. React 19 allows `null` directly.
**Fix**: Return `null` instead of `<></>`.

### L4 — Header `<h2>` used for page title inside `<main>` context
**File**: `app/(app)/transactions/page.tsx:44`
**Issue**: The page heading uses `<h2>` (not `<h1>`). If the sidebar has an `<h1>` somewhere, this is correct semantic hierarchy. But if no `<h1>` exists on the page, this is an accessibility violation — pages should have exactly one `<h1>`.
**Fix**: Audit heading hierarchy across all pages. Use `<h1>` for main page title.

---

## What's Done Well ✓

- `useActionState` from React 19 for async server action state — correct modern pattern
- `isCreating` loading state on form submit button with spinner icon — good UX
- `Loader2` spinner for form submission feedback
- Empty state for zero transactions — clear with actionable CTAs
- Onboarding checklist: progress bar, collapsible, auto-hides when complete — well designed
- `FormError` component used consistently across forms
- Sort direction cycling (asc → desc → null) is intuitive
- Column sort icons (ArrowUp/ArrowDown) render correctly
- Pagination component for transactions — correct implementation
- `writeBOM: true` in CSV export for Excel compatibility with Indian locale files
- `formatDate(issuedAt, "dd/MM/yyyy")` — correct Indian date format in the UI

---

## Summary

| Severity | Count |
|----------|-------|
| High | 2 |
| Medium | 5 |
| Low | 4 |
| **Total** | **11** |

**Top fixes:**
1. **H1** — Reduce page size to 50-100 (biggest UX impact for Indian market with mid-range phones)
2. **H2** — Fix `useEffect` initial navigation loop
3. **L1** — Keyboard accessibility on table rows (WCAG compliance)
