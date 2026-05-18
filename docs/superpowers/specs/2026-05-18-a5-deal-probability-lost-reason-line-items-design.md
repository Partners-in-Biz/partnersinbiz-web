# A5 Design — Deal Probability + Lost Reason + Line Items (with Product Catalog)

**Date:** 2026-05-18  
**Status:** Approved  
**Tag target:** `crm-sub-a5-complete`

---

## Overview

Extends the Deal entity with three new capabilities:
1. **Probability** — auto-derived from the deal's pipeline stage, manually overridable (0–100)
2. **Lost reason** — freetext field surfaced when a deal is on a "lost" stage
3. **Line items** — per-deal product array backed by a workspace Product catalog

A new `products` Firestore collection stores the workspace catalog. Line items on deals snapshot product data at add time (same pattern as invoices), so edits to the catalog don't retroactively alter closed deals.

---

## Data Model

### `lib/crm/types.ts` additions

```ts
export interface DealLineItem {
  productId?: string    // soft reference; may be absent for ad-hoc items
  name: string
  qty: number
  unitPrice: number
  discount?: number     // percentage 0–100
  total: number
  currency: Currency
}

// Additions to existing Deal interface:
// probability?: number        // 0–100; auto-set from stage.probability, overridable
// lostReason?: string         // freetext; surfaced on "lost" stages
// lineItems?: DealLineItem[]  // snapshot array

// DealInput extends to include the same three optional fields
```

### `lib/products/types.ts` (new)

```ts
export interface Product {
  id: string
  orgId: string
  name: string
  description?: string
  unitPrice: number
  currency: Currency
  unit?: string           // e.g. "hr", "item", "month"
  deleted?: boolean
  createdAt: Timestamp | null
  updatedAt: Timestamp | null
  createdByRef?: MemberRef
  updatedByRef?: MemberRef
}

export type ProductInput = Omit<Product, 'id' | 'createdAt' | 'updatedAt'>
```

**Firestore collection:** `products/{productId}` with `orgId` field (top-level, consistent with contacts/deals).

---

## API Surface

### Products CRUD (new routes)

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| GET | `/api/v1/crm/products` | member | List active workspace products |
| POST | `/api/v1/crm/products` | admin | Create product |
| PUT | `/api/v1/crm/products/[id]` | admin | Update product |
| DELETE | `/api/v1/crm/products/[id]` | admin | Soft-delete |

### Deal route extensions

**PUT `/api/v1/crm/deals/[id]`** — existing route extended to accept:
- `probability?: number` — explicit override; if absent and `stageId` changed, auto-derive from `stage.probability`
- `lostReason?: string` — persisted only when stage name includes "lost" (case-insensitive heuristic; configurable later)
- `lineItems?: DealLineItem[]` — replaces entire array on each PUT (not a patch)

**GET `/api/v1/crm/deals/[id]`** — returns all three new fields alongside existing deal fields.

### Quote pre-fill

**POST `/api/v1/quotes`** — extended to accept optional `dealId`. When provided, pre-populates `lineItems` from the deal's line items. UI shows a "Convert to quote" button on deal detail.

---

## UI

### Deal form / deal detail

Three new sections added to the existing deal slide-over / modal:

1. **Probability** — slider (0–100) + number input. When equal to stage's built-in probability, shows a "from stage" badge. When manually changed, shows "overridden" badge with a reset link.
2. **Lost reason** — text field (freetext). Visible only when the deal's current stage name contains "lost" (case-insensitive).
3. **Line items** — table: Name / Qty / Unit Price / Discount / Total. "+ Add item" opens a product picker (search catalog or type ad-hoc to create a one-off item). Subtotal + total shown below table.

### Products settings page

Route: `/portal/settings/products`  
- Table of workspace products with Name, Unit Price, Currency, Unit columns  
- Inline edit on row click → modal  
- "New product" button → create modal  
- Settings nav gets "Products" link (minRole: `admin`) after the Scoring entry

### Weighted pipeline total

Deals list page header gets a summary chip: **Weighted: [Σ(deal.value × probability / 100)]**. Computed client-side from the loaded deals page. Full pipeline reports deferred to E-phase.

---

## Build Plan — 3 Waves (Parallel Sonnet)

### Wave 1 — Foundation (3 agents in parallel)

**Agent 1A — Types + indexes:**
- `lib/crm/types.ts` — add `DealLineItem`, extend `Deal` + `DealInput` with `probability`, `lostReason`, `lineItems`
- `lib/products/types.ts` — new file with `Product`, `ProductInput`
- `lib/products/store.ts` — CRUD helpers (`listProducts`, `getProduct`, `createProduct`, `updateProduct`, `deleteProduct`) mirroring existing store patterns
- `firestore.indexes.json` — add `products` collection index (`orgId` ASC + `deleted` ASC + `name` ASC)

**Agent 1B — Products API + tests:**
- `app/api/v1/crm/products/route.ts` (GET + POST)
- `app/api/v1/crm/products/[id]/route.ts` (PUT + DELETE)
- `__tests__/api/v1/crm/products/` — full test suite (~20 tests)

**Agent 1C — Deal API extensions + tests:**
- `app/api/v1/crm/deals/[id]/route.ts` — extend PUT to accept + persist `probability`, `lostReason`, `lineItems`; auto-derive probability when stageId changes; extend GET to return new fields
- `lib/crm/deals/store.ts` (or wherever deal store lives) — extend write helpers
- `__tests__/api/v1/crm/deals/` — extend existing tests + add new cases (~15 new tests)

### Wave 2 — UI (2 agents in parallel)

**Agent 2A — Deal form + line items UI:**
- Extend deal create/edit form with probability slider, lost reason field, line items table
- `components/crm/DealLineItemsEditor.tsx` — standalone line items component
- `components/crm/ProductPicker.tsx` — typeahead + catalog picker
- Deal detail page — display probability + lost reason + line items in read mode

**Agent 2B — Products settings page:**
- `app/(portal)/portal/settings/products/page.tsx`
- `components/crm/ProductModal.tsx` — create/edit modal
- `components/settings/SettingsNav.tsx` — add Products nav link

### Wave 3 — Integration (sequential)

- Extend `POST /api/v1/quotes` to accept `dealId` and pre-fill line items
- Deal detail: "Convert to quote" button wired to the extended quotes endpoint
- Deals list: weighted pipeline chip
- `SKILL.md` scoring section + A5 entries
- `hot.md` + session log + `index.md` update
- Tag `crm-sub-a5-complete`

---

## Indexes Required

```json
{ "collectionGroup": "products", "queryScope": "COLLECTION",
  "fields": [
    { "fieldPath": "orgId", "order": "ASCENDING" },
    { "fieldPath": "deleted", "order": "ASCENDING" },
    { "fieldPath": "name", "order": "ASCENDING" }
  ]
}
```

---

## Quality Bar (same as A4)

- `withCrmAuth(minRole)` on all routes
- `MemberRef` attribution on all writes
- `NEVER_FROM_BODY` denylist: `id`, `orgId`, `createdAt`, `createdByRef`
- Store-mock pattern in all tests
- Empty-body guards + best-effort try/catch on external calls
- `next build` must pass before tagging

---

## Acceptance Criteria

- [ ] `probability` auto-populates from stage when stageId changes; manual override shows badge
- [ ] `lostReason` visible + saveable only on "lost" stages
- [ ] Line items add/edit/remove with product catalog picker
- [ ] Ad-hoc line items (no productId) work
- [ ] Products CRUD fully functional in settings
- [ ] "Convert to quote" pre-fills line items from deal
- [ ] Weighted pipeline total visible on deals list
- [ ] All new + extended tests green
- [ ] `next build` clean
- [ ] `crm-sub-a5-complete` tag on main
