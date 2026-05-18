# B-phase Design — CRM UI Completeness (B1–B7)

**Date:** 2026-05-18  
**Status:** Approved  
**Tag target:** `crm-sub-b-complete`

---

## Overview

Completes the CRM portal UI. Foundation APIs all exist (A1–A6). This phase adds the missing daily-workflow touchpoints: activity logging on contact detail, global search, bulk delete, a CRM mini-dashboard, and a probability-weighted forecast view on deals.

---

## What already exists (do NOT rebuild)

- `GET/POST /api/v1/crm/activities` — fully working, supports `contactId` filter + pagination
- `POST /api/v1/crm/contacts/bulk` — bulk patch (assign/stage/type/tags); just missing `delete` action
- `GET /api/v1/crm/contacts?search=` — contacts search works
- `GET /api/v1/crm/companies?search=` — companies search works  
- `/portal/contacts/[id]` — already fetches + displays activities list (basic). Needs log-activity form + add-deal button.
- `DealDrawer` — already built in A5, accepts pre-filled props

---

## B1–B3: Contact Detail Completions

### B1 — Activity timeline enhancement

The contact detail already shows activities but as a plain list. Enhance:
- Add `type` icon per activity type using `ACTIVITY_ICONS` map (already in the file)
- Add actor name (`createdByRef.displayName`) + formatted relative timestamp
- Show "Load more" button when 50 results returned (suggests more exist)
- No new API needed — `GET /api/v1/crm/activities?contactId=&limit=50` already works

### B2 — Log activity quick actions

Add an action bar above the activity list on contact detail:

```
[📞 Call] [📧 Email] [📝 Note] [📅 Meeting]
```

Each button opens an inline collapsed form:
- `type` pre-filled (hidden)
- `summary` textarea (required)  
- `occurredAt` datetime-local input (defaults to now)
- [Save] [Cancel]

On save: `POST /api/v1/crm/activities` with `{ contactId, type, summary, occurredAt }`. Prepend to activity list on success.

### B3 — Add deal from contact detail

In `ContactDealsPanel`, add a `+ New deal` button (top-right of the panel header).

Clicking it opens `DealDrawer` (already built) with:
- `defaultContactId` prop pre-filled to current contact's ID
- `defaultContactName` prop pre-filled to contact's name

On save, append returned deal to the panel's local deal list.

---

## B4: Global CRM Search

### `components/crm/CrmSearchBar.tsx` (new)

A search input rendered in the CRM portal sidebar or top nav. Triggered by focus or `⌘K`.

On input (debounced 300ms, min 2 chars):
- Fires 3 parallel fetches:
  - `GET /api/v1/crm/contacts?search=q&limit=5`
  - `GET /api/v1/crm/companies?search=q&limit=5`  
  - `GET /api/v1/crm/deals?search=q&limit=5` (NOTE: deals may not have search — add it)
- Groups results: **Contacts** / **Companies** / **Deals** sections
- Each row navigates to the detail page on click
- Keyboard navigable (↑↓ + Enter)
- ESC closes

### Deal search extension

`GET /api/v1/crm/deals` — add `search` param support: filter by `title` containing the search string (client-side post-filter, same pattern as contacts).

Wire `CrmSearchBar` into the portal CRM layout (wherever the CRM nav is rendered).

---

## B5: Bulk Delete

Extend `POST /api/v1/crm/contacts/bulk` to accept `patch: { delete: true }`.

When `patch.delete === true`:
- Soft-delete all matching contact IDs in the org (set `deleted: true, updatedAt`)
- Return `{ updated: number, skipped: number, failed: string[] }`
- No other patch fields allowed when `delete: true` (return 400 if mixed)

Add "Delete selected" to the bulk action menu in `/portal/contacts` page:
- `confirm('Delete X contacts? This cannot be undone.')` guard
- POST bulk with `{ ids, patch: { delete: true } }`
- Remove deleted contacts from local state on success

---

## B6: CRM Mini-Dashboard

### New API: `GET /api/v1/crm/dashboard`

Returns aggregates computed from Firestore (all queries scoped to `orgId`):

```ts
{
  openDealsCount: number
  openDealsValue: number          // sum of deal.value where !deleted and stage not won/lost
  weightedPipelineValue: number   // Σ(deal.value × deal.probability/100) for open deals
  wonThisMonth: { count: number; value: number }
  lostThisMonth: { count: number }
  recentActivities: Activity[]    // last 10 across all contacts
  topOpenDeals: Deal[]            // top 5 by value, open only
}
```

All queries run in parallel (`Promise.all`). Auth: `withCrmAuth('member')`.

### UI: CRM dashboard section

Add a "CRM" section to `/portal/dashboard` page (or a new `/portal/crm` page — prefer adding to existing dashboard to avoid nav clutter).

Layout:
- Row of 4 metric cards: Open Deals (count + value) | Weighted Pipeline | Won This Month | Lost This Month
- "Recent Activity" feed: last 10 activities (type icon + summary + contact name + time)
- "Top Open Deals" mini table: deal title + contact + stage + value

---

## B7: Forecast View

Add a **"Forecast"** tab to `/portal/deals` alongside the existing Kanban tab.

Table columns: Deal · Contact · Pipeline · Stage · Value · Probability · Weighted · Close Date

- Sort by `expectedCloseDate` asc by default
- Grouped by stage (toggle)
- Summary row: total value + total weighted value
- Probability shown as editable inline input (sends PUT to update deal)
- "Close Date" shown as relative date (e.g. "in 3 days", "overdue")

Data: use already-fetched deals from the page state (no new API needed — deals already return `probability` and `lineItems`).

---

## Build Plan — 3 Waves

### Wave 1 — Foundation (3 parallel agents)

**1A**: 
- CRM dashboard API (`GET /api/v1/crm/dashboard`) + tests (~12 tests)
- Deal search param extension (add `search` to `GET /api/v1/crm/deals`) + tests

**1B**:
- Bulk delete extension to `POST /api/v1/crm/contacts/bulk` + tests (~8 new tests)
- Verify `POST /api/v1/crm/activities` accepts `summary` + `occurredAt` correctly (read existing, patch if needed) + smoke tests

**1C**:
- Read existing contact detail page + ContactDealsPanel thoroughly
- Add B2 log-activity quick actions to contact detail page
- Add B3 `+ New deal` button to `ContactDealsPanel`
- Enhance B1 activity timeline display (icons, actor, timestamp, load more)

### Wave 2 — UI (2 parallel agents)

**2A**:
- `CrmSearchBar` component with parallel fetch + grouped results + keyboard nav
- Wire into CRM portal layout
- Bulk delete UI on contacts list page

**2B**:
- CRM dashboard section on `/portal/dashboard` (fetch `GET /api/v1/crm/dashboard`, 4 cards + activity feed + top deals)
- Forecast tab on `/portal/deals` (table view, probability inline edit, stage grouping)

### Wave 3 — Integration

- SKILL.md B-phase section
- `hot.md` update  
- Tag `crm-sub-b-complete`

---

## Quality Bar

- All new API routes: `withCrmAuth`, `NEVER_FROM_BODY`, `dynamic = 'force-dynamic'`
- All UI: TypeScript strict, no `any`, loading + error states
- `next build` clean before tagging
