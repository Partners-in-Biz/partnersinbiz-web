# Book Studio V2 Phase 2 — ISBN + Channel Metadata Operations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give Book Studio real ISBN data — an org-wide ISBN pool with
transactional assignment, print/ebook ISBN split on project metadata,
front/back matter fields, publishing-packet pricing, and a
`validateChannelMetadata()` gate — so the Phase 1 `submission_ready`
transition (currently unguarded, see `LIFECYCLE_GUARDS` in
`lib/book-studio/lifecycle.ts`) has a real guard, and so Phase 3's
submission-packet builder has real fields to render.

**Scope note (Plan 2 merge — do not duplicate):** this plan is Phase 2 of the
master roadmap (`~/Cowork/Cowork/agents/partners/wiki/book-studio-v2-publishing-house-plan.md`).
It absorbs §9.1 (ISBN split), §9.2 (front/back matter), and §9.4 (packet
pricing) from the "Book Studio Plan 2" source spec
(`docs/superpowers/specs/2026-07-06-book-studio-front-door-authoring-spec.md`).
Two adjacent Plan-2 items are explicitly **NOT** in this plan:
- §5 (KDP categories / Google genres taxonomy + store-listing picker UI) →
  **Phase 3**. `lib/book-studio/taxonomy.ts` and the `kdpCategories` /
  `googleGenres` / `kdpKeywords` fields belong there. Phase 2's
  `validateChannelMetadata()` guard references these fields defensively
  (reads them if present, does not require them) so Phase 3 can wire the
  UI without touching the validator's control flow again — but Phase 2 does
  NOT create the taxonomy module, the fields, or the picker.
- §9.3 (chapter-level editorial comments) → **Phase 5**. Not touched here.

**Architecture:** Two new pure modules —
`lib/book-studio/isbn.ts` (ISBN-13 check-digit math, 10↔13 conversion,
shape validation) and `lib/book-studio/channel-metadata.ts`
(`validateChannelMetadata(project, channel)` — the Phase 1
`submission_ready` guard). One new Firestore-backed CRUD surface for the org
ISBN pool (`book_studio_isbn_pool`, following the exact
`createBookStudioResourceHandlers` pattern already used for every other
`book_studio_*` collection in `lib/book-studio/routes.ts`), plus one bespoke
transactional route (`assign-isbn`) that mirrors the lock-doc/transaction
pattern already proven in
`app/api/v1/portal/book-studio/projects/[id]/request-draft/route.ts` (the
same pattern Phase 1's `executeLifecycleTransition` reused). Metadata
extensions (ISBN split, front/back matter) are additive fields on the
existing `BookProjectMetadata` type and `lib/book-studio/sanitize.ts`'s
`cleanMetadata`, following the exact whitelist-and-clean style already used
for every other metadata field in that function.

**Tech stack:** Next.js App Router route handlers, Firebase Admin Firestore
(`adminDb`, `FieldValue`, `runTransaction`), existing
`apiSuccess`/`apiError` envelope (`lib/api/response.ts`), existing `withAuth`
(`lib/api/auth.ts`), Jest + ts-jest, existing
`lib/book-studio/{sanitize,api,routes}.ts` helpers, Phase 1's
`lib/book-studio/lifecycle.ts` (`LIFECYCLE_GUARDS`, `assertMinState`).

**Verified codebase facts this plan depends on (do not re-derive, just use):**

- `lib/book-studio/lifecycle.ts` (Phase 1, shipped commit `47e1a68c`) exports
  `LIFECYCLE_GUARDS: Partial<Record<BookLifecycleState, (data: unknown) => GuardResult>>`.
  Today `submission_ready` has **no** registered guard (`runLifecycleGuard`
  returns `{ ok: true, blockers: [] }` for it — see the comment "States with
  no guard ... submission_ready validation is Phase 2's channel-metadata
  validator"). Task 4 of this plan registers
  `LIFECYCLE_GUARDS.submission_ready` pointing at
  `channelMetadataLifecycleGuard`, a thin adapter around
  `validateChannelMetadata`. This is the **only** change Phase 2 makes to
  `lifecycle.ts` — do not touch `TRANSITIONS`, `STATE_RANK`, or any other
  guard.
- `GuardResult = { ok: boolean; blockers: string[] }` (already exported from
  `lifecycle.ts`) is the shape every guard function returns. Reuse it
  verbatim for `validateChannelMetadata`'s return type so it slots directly
  into `LIFECYCLE_GUARDS` with no adapter-shape mismatch — the adapter in
  Task 4 exists only to pick *which* channel(s) to validate and merge their
  blockers, not to reshape the result.
- `components/book-studio/project/types.ts:5-13` — `BookProjectMetadata`
  today has a single `isbn?: string` field (line 10), alongside `title`,
  `subtitle`, `authorName`, `imprint`, `description`, `language`,
  `aiDisclosure`. Task 2 replaces `isbn` with `isbnPrint?: string` /
  `isbnEbook?: string`, **keeping** `isbn` in the type (deprecated,
  legacy-read-only) — do not delete the field, old Firestore documents still
  have it and the fallback chain (`isbnEbook ?? isbn`, `isbnPrint ?? isbn`)
  depends on it existing on the type so TypeScript doesn't flag the read.
- `lib/book-studio/sanitize.ts:361-376` (`cleanMetadata`) is the single
  whitelist function for every `BookProjectMetadata` field — it uses
  `cleanString`, `cleanStringArray`, `cleanBoolean`, `compact` helpers
  already defined earlier in the file (`cleanString` around line 100s,
  `cleanStringArray` at line 129). `cleanMetadata`'s current `isbn:
  cleanString(source.isbn)` line (line 370) is what Task 2 replaces with
  `isbnPrint`/`isbnEbook` validated through `lib/book-studio/isbn.ts`'s shape
  validator — invalid input drops the field (returns `undefined`), it does
  not throw; the "400 field error" behavior described in the master plan is
  achieved by the *route* checking for a rejected-but-attempted value, not by
  `cleanMetadata` itself (see Task 2 Step 3 for the exact mechanism, matching
  how `pick()` already reports a rejected field name to
  `BookStudioValidationError` elsewhere in this file for enum fields).
- `lib/book-studio/routes.ts:1-33` (`createBookStudioResourceHandlers`) is a
  factory producing GET/POST/PATCH/DELETE for `BOOK_STUDIO_RESOURCES` keys
  fully generically (org-scoped, sanitized, actor-fielded, decision-logged
  where applicable). Task 1 adds a new key `'isbn-pool'` (collection
  `book_studio_isbn_pool`) to `BOOK_STUDIO_RESOURCES` in
  `lib/book-studio/sanitize.ts` with its own `cleanIsbnPoolEntry` sanitizer
  (same style as `cleanRightsLedger`/`cleanGates`), and mounts
  `createBookStudioResourceHandlers('isbn-pool')` at
  `app/api/v1/book-studio/isbn-pool/route.ts` +
  `app/api/v1/book-studio/isbn-pool/[id]/route.ts` — this reuses the
  existing generic `[resource]/[id]` dynamic route
  (`app/api/v1/book-studio/[resource]/[id]/route.ts`) automatically once
  `isbn-pool` is a valid `BookStudioResourceKey`; the plan's file list below
  still lists a literal `isbn-pool/route.ts` because the master plan's
  Phase 2 file list calls for a *dedicated* top-level route (matching
  `projects/route.ts`'s pattern of a resource-specific top-level file
  alongside the generic `[resource]` catch-all) rather than relying solely
  on the catch-all — Task 1 verifies both work and documents which one the
  UI should call.
- `ensureBookStudioAccess` (`lib/book-studio/api.ts:62-83`) is the org-scoping
  + module-enabled guard every admin Book Studio route calls first — reuse
  verbatim in `assign-isbn/route.ts`, exactly as Phase 1's transition route
  did.
- Firestore transaction + lock-doc pattern to copy for `assign-isbn`: see
  `app/api/v1/portal/book-studio/projects/[id]/request-draft/route.ts:1-90+`
  (dedupe via a sentinel `Error` subclass thrown inside `runTransaction`,
  translated to an HTTP status by the route) — same shape Phase 1's
  `executeLifecycleTransition` in `lib/book-studio/lifecycle.ts:692-751`
  used for the project-doc + decision-log write. `assign-isbn`'s transaction
  reads the ISBN pool doc first (lock target), verifies `status ===
  'available'`, then writes `status: 'assigned'`, `assignedProjectId`,
  `assignedFormat` on the pool doc **and** `isbnPrint`/`isbnEbook` (per
  `format` param) on the project doc, in the same transaction — mirroring
  "one project+format gets one ISBN" from the master plan.
- Decision-log shape (verified in Phase 1, reused here): `{ orgId, projectId,
  decision: string, title, safeSummary, ...actor fields }`
  (`lib/book-studio/sanitize.ts` registers `decision-logs` with
  `titleField: 'decision'`). Task 3's `assign-isbn` route writes
  `decision: 'isbn_assigned'`.
- `apiSuccess`/`apiError` (`lib/api/response.ts:4-21`) — `apiError(message,
  status, extra?)` returns `{ success: false, error: message, ...extra }`;
  the channel-metadata 422 uses `apiError(message, 422, { missing:
  string[], warnings: string[] })`, mirroring
  `apiError('pages are missing required image assets', 422, { missing:
  error.orders })` in `app/api/v1/book-studio/projects/[id]/assemble/route.ts:44`
  and Phase 1's `apiError(error.message, 422, { blockers: error.blockers })`
  pattern.
- `lib/book-studio/assembly/epub.ts` and
  `lib/book-studio/assembly/interior-pdf.ts` exist today and are the two
  files Task 5 (ISBN rendering) and Task 6 (front/back matter rendering)
  modify — **read each file's current OPF-identifier / copyright-page /
  render-order code in full before editing** (this plan does not re-paste
  their current contents verbatim; the master plan already flags this as a
  "modify" file, and Phase 1's precedent — Task 8's note about re-reading
  `AdminBookStudioGovernanceWorkspace.tsx` before editing — is the standard
  to follow here too, since assembly internals are large and this plan's
  research pass did not fully capture them).
- Branch: all work happens directly on `development`. No worktrees, no
  feature branches. Run the mandatory git preflight (checkout
  `development`, `git status --short --branch`, pull/rebase
  `origin/development`) before Task 1.

---

## File Structure

| File | Responsibility |
|---|---|
| `lib/book-studio/isbn.ts` (new) | ISBN-13 check-digit validate/format, ISBN-10↔13 convert, shape validator used by both the pool sanitizer and the metadata sanitizer |
| `__tests__/lib/book-studio-isbn.test.ts` (new) | Unit tests for check-digit math, conversion, shape validation |
| `lib/book-studio/channel-metadata.ts` (new) | `validateChannelMetadata(project, channel)` — the Phase 1 `submission_ready` guard's data-side logic |
| `__tests__/lib/book-studio-channel-metadata.test.ts` (new) | Unit tests for KDP print / KDP ebook / Google Play validation rules |
| `lib/book-studio/sanitize.ts` (modify) | Add `isbn-pool` to `BOOK_STUDIO_RESOURCES`; add `cleanIsbnPoolEntry`; replace `cleanMetadata`'s single `isbn` field with `isbnPrint`/`isbnEbook`; add `frontMatter`/`backMatter` cleaners; add `channelPricing` cleaner for publishing-packet records |
| `lib/book-studio/routes.ts` (modify — additive only) | No structural change expected; `isbn-pool` rides the existing generic factory once registered in `BOOK_STUDIO_RESOURCES` — confirm in Task 1, do not restructure this file |
| `app/api/v1/book-studio/isbn-pool/route.ts` (new) | Org ISBN pool list/create — thin wrapper calling `createBookStudioResourceHandlers('isbn-pool')` |
| `app/api/v1/book-studio/isbn-pool/[id]/route.ts` (new) | Org ISBN pool get/patch/delete — same pattern |
| `app/api/v1/book-studio/projects/[id]/assign-isbn/route.ts` (new) | Transactional ISBN assignment (pool doc + project doc + decision log in one transaction) |
| `__tests__/api/book-studio-isbn-pool.test.ts` (new) | CRUD route tests + the concurrent-double-assignment race test |
| `components/book-studio/project/types.ts` (modify) | `BookProjectMetadata.isbn` → keep as legacy, add `isbnPrint?`/`isbnEbook?`, add `frontMatter?`/`backMatter?` |
| `lib/book-studio/lifecycle.ts` (modify — one line, additive) | Register `LIFECYCLE_GUARDS.submission_ready` |
| `__tests__/lib/book-studio-lifecycle.test.ts` (modify) | Extend with a `submission_ready` guard case (does not touch existing Phase 1 tests) |
| `lib/book-studio/assembly/epub.ts` (modify) | OPF identifier uses `isbnEbook ?? isbn`; front/back matter render order; optional Google-genre OPF subject deferred to Phase 3 |
| `lib/book-studio/assembly/interior-pdf.ts` (modify) | Copyright page lists per-edition ISBN; TOC page; dedication/foreword/about-the-author/also-by render order |
| `__tests__/lib/book-studio-assembly-isbn-frontmatter.test.ts` (new) | Render-order + ISBN-fallback tests for both assembly outputs |
| Publishing-packet pricing: `lib/book-studio/sanitize.ts` (same file as above) | `channelPricing` whitelist on `book_studio_publishing_packets` records |
| `firestore.indexes.json` (modify) | Add compound index for `book_studio_isbn_pool` (orgId + status) if a compound query is used (Task 1 decides based on the actual query shape) |

---

## Task 1: ISBN pool CRUD (sequential — foundation, must land first)

**Files:**
- Modify: `lib/book-studio/sanitize.ts` — register `isbn-pool` resource + `cleanIsbnPoolEntry`
- Create: `lib/book-studio/isbn.ts` (ISBN-13 check-digit + conversion + shape validator — needed by the pool sanitizer immediately, so it lands in this task rather than Task 2)
- Create: `app/api/v1/book-studio/isbn-pool/route.ts`, `app/api/v1/book-studio/isbn-pool/[id]/route.ts`
- Test: `__tests__/lib/book-studio-isbn.test.ts`, `__tests__/api/book-studio-isbn-pool.test.ts` (CRUD portion only — the race-condition test is Task 3)

**Design:**

```ts
// lib/book-studio/isbn.ts
export type IsbnSource = 'bowker' | 'kdp_assigned' | 'other'
export type IsbnPoolStatus = 'available' | 'assigned' | 'retired'

/** Strips hyphens/spaces, uppercases the check character for ISBN-10. */
export function normalizeIsbn(raw: string): string {
  return raw.replace(/[\s-]/g, '').toUpperCase()
}

/** ISBN-13 check digit per ISO 2108 (alternating ×1/×3 weights, mod 10). */
export function isbn13CheckDigit(digits12: string): number {
  const sum = digits12
    .split('')
    .reduce((acc, d, i) => acc + Number(d) * (i % 2 === 0 ? 1 : 3), 0)
  return (10 - (sum % 10)) % 10
}

export function isValidIsbn13(value: string): boolean {
  const normalized = normalizeIsbn(value)
  if (!/^\d{13}$/.test(normalized)) return false
  if (!normalized.startsWith('978') && !normalized.startsWith('979')) return false
  return isbn13CheckDigit(normalized.slice(0, 12)) === Number(normalized[12])
}

/** ISBN-10 check digit: weights 10..1, mod 11, 'X' represents 10. */
export function isbn10CheckDigit(digits9: string): string {
  const sum = digits9.split('').reduce((acc, d, i) => acc + Number(d) * (10 - i), 0)
  const remainder = (11 - (sum % 11)) % 11
  return remainder === 10 ? 'X' : String(remainder)
}

export function isValidIsbn10(value: string): boolean {
  const normalized = normalizeIsbn(value)
  if (!/^\d{9}[\dX]$/.test(normalized)) return false
  return isbn10CheckDigit(normalized.slice(0, 9)) === normalized[9]
}

/** Accepts a valid ISBN-10 or ISBN-13 string (hyphens/spaces tolerated). */
export function isValidIsbn(value: unknown): value is string {
  if (typeof value !== 'string' || !value.trim()) return false
  const normalized = normalizeIsbn(value)
  return isValidIsbn13(normalized) || isValidIsbn10(normalized)
}

/** ISBN-10 → ISBN-13 (978 prefix + recomputed check digit). Returns null for invalid input. */
export function isbn10To13(value: string): string | null {
  const normalized = normalizeIsbn(value)
  if (!isValidIsbn10(normalized)) return null
  const core = `978${normalized.slice(0, 9)}`
  return core + isbn13CheckDigit(core)
}

/** ISBN-13 → ISBN-10 (strips 978 prefix, recomputes check digit). Returns null for
 *  979-prefixed or invalid ISBN-13 — 979 has no ISBN-10 equivalent. */
export function isbn13To10(value: string): string | null {
  const normalized = normalizeIsbn(value)
  if (!isValidIsbn13(normalized) || !normalized.startsWith('978')) return null
  const core = normalized.slice(3, 12)
  return core + isbn10CheckDigit(core)
}

/** Formats with standard hyphenation groups is out of scope (requires the
 *  full registrant-range table) — this returns the normalized 10/13-digit
 *  string only. Documented as a known limitation, not a bug. */
export function formatIsbn(value: string): string {
  return normalizeIsbn(value)
}

export const ISBN_SOURCES: IsbnSource[] = ['bowker', 'kdp_assigned', 'other']
export const ISBN_POOL_STATUSES: IsbnPoolStatus[] = ['available', 'assigned', 'retired']
```

```ts
// lib/book-studio/sanitize.ts — additive changes only

// 1. Add to BOOK_STUDIO_RESOURCES (same object shape as every other entry —
//    read the object literal in full before editing so the new key matches
//    the exact { collection, sanitizeInput, sanitizePatch, titleField? }
//    shape used by 'rights-ledgers' etc.):
//    'isbn-pool': { collection: 'book_studio_isbn_pool', ... }

import { ISBN_SOURCES, ISBN_POOL_STATUSES, isValidIsbn, normalizeIsbn } from './isbn'

function cleanIsbnPoolEntry(source: Record<string, unknown>) {
  const isbn13Raw = cleanString(source.isbn13)
  const isbn13 = isbn13Raw && isValidIsbn(isbn13Raw) ? normalizeIsbn(isbn13Raw) : undefined
  return compact({
    isbn13, // stored normalized (digits only, no hyphens)
    source: pick(source.source, ISBN_SOURCES, 'other', 'isbnPool.source'),
    status: pick(source.status, ISBN_POOL_STATUSES, 'available', 'isbnPool.status'),
    assignedProjectId: cleanString(source.assignedProjectId),
    assignedFormat: cleanString(source.assignedFormat), // 'print' | 'ebook' — free string, validated at assign time
    notes: cleanString(source.notes),
  })
}
```

`cleanIsbnPoolEntry` intentionally drops (rather than throws on) an invalid
`isbn13` — same "invalid → silently absent, caller re-checks required fields"
convention as every other `clean*` helper in this file. The **CSV-paste
import** mentioned in the master plan ("Bowker ISBNs are bought in blocks
and imported via CSV paste → pool") is a client-side concern: the pool
`POST` route accepts one record per call like every other
`createBookStudioResourceHandlers` resource; a bulk-paste UI (Phase 2 or a
follow-up) loops client-side calling `POST` once per row, or a dedicated
bulk-import endpoint can be added later — **not required for this plan's
acceptance criteria**, which only cover the pool CRUD + assignment
mechanics.

- [ ] **Step 1: Write the failing tests**

```ts
// __tests__/lib/book-studio-isbn.test.ts
import {
  isbn13CheckDigit,
  isbn10CheckDigit,
  isValidIsbn13,
  isValidIsbn10,
  isValidIsbn,
  isbn10To13,
  isbn13To10,
  normalizeIsbn,
} from '@/lib/book-studio/isbn'

describe('ISBN validation and conversion', () => {
  // Real published ISBN pair for the same edition: 0-306-40615-2 / 978-0-306-40615-7
  const VALID_ISBN10 = '0306406152'
  const VALID_ISBN13 = '9780306406157'

  it('normalizes hyphens and spaces', () => {
    expect(normalizeIsbn('978-0-306-40615-7')).toBe('9780306406157')
    expect(normalizeIsbn('0 306 40615 2')).toBe('0306406152')
  })

  it('validates a correct ISBN-13 check digit', () => {
    expect(isValidIsbn13(VALID_ISBN13)).toBe(true)
  })

  it('rejects an ISBN-13 with a wrong check digit', () => {
    expect(isValidIsbn13('9780306406158')).toBe(false)
  })

  it('rejects an ISBN-13 not starting 978/979', () => {
    expect(isValidIsbn13('1234567890123')).toBe(false)
  })

  it('validates a correct ISBN-10 check digit, including an X check character', () => {
    expect(isValidIsbn10(VALID_ISBN10)).toBe(true)
    expect(isValidIsbn10('080442957X')).toBe(true) // known ISBN-10 with X check digit
  })

  it('rejects an ISBN-10 with a wrong check digit', () => {
    expect(isValidIsbn10('0306406153')).toBe(false)
  })

  it('isValidIsbn accepts either valid form and rejects junk', () => {
    expect(isValidIsbn(VALID_ISBN10)).toBe(true)
    expect(isValidIsbn(VALID_ISBN13)).toBe(true)
    expect(isValidIsbn('not-an-isbn')).toBe(false)
    expect(isValidIsbn('')).toBe(false)
    expect(isValidIsbn(undefined)).toBe(false)
  })

  it('converts ISBN-10 to ISBN-13 correctly', () => {
    expect(isbn10To13(VALID_ISBN10)).toBe(VALID_ISBN13)
  })

  it('converts ISBN-13 (978-prefixed) to ISBN-10 correctly', () => {
    expect(isbn13To10(VALID_ISBN13)).toBe(VALID_ISBN10)
  })

  it('returns null converting a 979-prefixed ISBN-13 to ISBN-10 (no equivalent exists)', () => {
    // 979-8-... is a valid Bookland EAN with no ISBN-10 form.
    expect(isbn13To10('9798712345678')).toBeNull()
  })

  it('returns null converting invalid input', () => {
    expect(isbn10To13('garbage')).toBeNull()
    expect(isbn13To10('garbage')).toBeNull()
  })
})
```

```ts
// __tests__/api/book-studio-isbn-pool.test.ts (CRUD portion — extend in Task 3 with the race test)
import { NextRequest } from 'next/server'

const mockCollection = jest.fn()

jest.mock('@/lib/firebase/admin', () => ({ adminDb: { collection: mockCollection } }))
jest.mock('@/lib/api/auth', () => ({
  withAuth: (_role: string, handler: (req: NextRequest, user: unknown, ctx: unknown) => unknown) =>
    (req: NextRequest, ctx: unknown) => handler(req, { uid: 'admin-1', role: 'admin' }, ctx),
}))
jest.mock('@/lib/api/platformAdmin', () => ({ canAccessOrg: () => true }))
jest.mock('@/lib/organizations/portal-modules', () => ({ isPortalModuleEnabled: () => true }))

// Follow the exact stageFirestore() scaffold pattern from
// __tests__/api/portal-book-studio-request-draft.test.ts and Phase 1's
// __tests__/api/book-studio-transition-admin.test.ts — build a fake
// per-collection Firestore, mock 'organizations' doc lookup, and mock
// 'book_studio_isbn_pool' as a plain array-backed collection supporting
// add()/where().get()/doc().get()/doc().update()/doc().delete() as needed
// by createBookStudioResourceHandlers's generic implementation.

describe('POST /api/v1/book-studio/isbn-pool', () => {
  it('creates a pool entry with a valid ISBN-13 and default status "available"', async () => {
    // ... stage fake firestore, POST { isbn13: '978-0-306-40615-7', source: 'bowker' },
    // assert 200/201 and response record has isbn13 normalized + status 'available'
  })

  it('rejects (drops the field, does not 500) an invalid isbn13', async () => {
    // ... POST { isbn13: 'not-an-isbn', source: 'bowker' } — assert the created
    // record has no isbn13 field (sanitizer drops it) rather than a crash;
    // route-level validation (Task 3's assign-isbn 400) is where "reject
    // outright" behavior lives for the assignment flow specifically
  })
})

describe('GET /api/v1/book-studio/isbn-pool', () => {
  it('lists only the calling org\'s pool entries', async () => {
    // ... stage two orgs' worth of entries, assert only org-1's are returned
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest __tests__/lib/book-studio-isbn.test.ts __tests__/api/book-studio-isbn-pool.test.ts`
Expected: FAIL — `lib/book-studio/isbn.ts` and the `isbn-pool` route don't exist yet.

- [ ] **Step 3: Implement `lib/book-studio/isbn.ts`**

Use the exact code block from the Design section above.

- [ ] **Step 4: Implement the sanitize.ts additions**

Add `isbn-pool` to `BOOK_STUDIO_RESOURCES` (read the object literal's exact
shape in full first — match every other entry's fields, including whatever
`titleField`/`portalReadable` conventions exist) and add
`cleanIsbnPoolEntry`, wired as that resource's `sanitizeInput`/
`sanitizePatch`.

- [ ] **Step 5: Implement the route files**

```ts
// app/api/v1/book-studio/isbn-pool/route.ts
import { createBookStudioResourceHandlers } from '@/lib/book-studio/routes'
export const dynamic = 'force-dynamic'
const handlers = createBookStudioResourceHandlers('isbn-pool')
export const GET = handlers.GET
export const POST = handlers.POST
```

```ts
// app/api/v1/book-studio/isbn-pool/[id]/route.ts
// Same pattern as app/api/v1/book-studio/[resource]/[id]/route.ts but
// hardcoded to 'isbn-pool' — read that generic file first and mirror its
// GET/PATCH/DELETE handler wiring exactly (context param shape, 404 handling).
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx jest __tests__/lib/book-studio-isbn.test.ts __tests__/api/book-studio-isbn-pool.test.ts`
Expected: PASS.

- [ ] **Step 7: Typecheck**

Run: `npm run typecheck`

- [ ] **Step 8: Firestore index check**

If the pool GET route (or a future "find an available ISBN" query) filters
by `orgId` + `status` in a single `where` chain, add the compound index to
`firestore.indexes.json` now (per the "firebase.json indexes mapping
gotcha" memory — missing entries silently deploy zero indexes). A
single-field `where('orgId', '==', ...)` filtered again in-memory for
`status` needs no compound index; only add one if Task 1's actual query
uses two `.where()` calls.

- [ ] **Step 9: Commit**

```bash
git add lib/book-studio/isbn.ts lib/book-studio/sanitize.ts \
        app/api/v1/book-studio/isbn-pool/route.ts app/api/v1/book-studio/isbn-pool/\[id\]/route.ts \
        __tests__/lib/book-studio-isbn.test.ts __tests__/api/book-studio-isbn-pool.test.ts \
        firestore.indexes.json
git commit -m "feat(book-studio): add ISBN validation module and org ISBN pool CRUD"
```

---

## Task 2: ISBN per format (print/ebook split) on project metadata (parallel-safe with Task 1 once `lib/book-studio/isbn.ts` exists — depends only on Task 1's `isbn.ts`, not on the pool CRUD)

**Files:**
- Modify: `components/book-studio/project/types.ts` — `BookProjectMetadata`
- Modify: `lib/book-studio/sanitize.ts` — `cleanMetadata`
- Test: extend `__tests__/lib/book-studio-isbn.test.ts` is NOT the right place (that file is pure ISBN math) — create `__tests__/lib/book-studio-sanitize-metadata.test.ts` (new) if no existing sanitize-metadata test file covers `cleanMetadata`; otherwise extend the existing one (check `__tests__/lib/` for a `book-studio-sanitize*.test.ts` file before creating a duplicate)

**Design:**

```ts
// components/book-studio/project/types.ts
export type BookProjectMetadata = {
  title?: string
  subtitle?: string
  authorName?: string
  imprint?: string
  /** @deprecated use isbnPrint / isbnEbook. Old records may still have this;
   *  both assembly outputs fall back to it when the split field is empty. */
  isbn?: string
  isbnPrint?: string
  isbnEbook?: string
  description?: string
  language?: string
  aiDisclosure?: string
  // ... existing fields unchanged (keywords, categories, matureContent, etc.)
  frontMatter?: {
    dedication?: string
    tocEnabled?: boolean
    forewordChapterId?: string
  }
  backMatter?: {
    aboutTheAuthor?: string
    alsoByEnabled?: boolean
  }
}
```

```ts
// lib/book-studio/sanitize.ts — cleanMetadata, replacing the single isbn line
import { isValidIsbn, normalizeIsbn } from './isbn'

function cleanIsbnField(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined
  return isValidIsbn(value) ? normalizeIsbn(value) : undefined
}

function cleanFrontMatter(value: unknown) {
  const source = cleanObject(value)
  if (!Object.keys(source).length) return undefined
  const dedication = cleanString(source.dedication)
  return compact({
    dedication: dedication && dedication.length <= 2048 ? dedication : undefined,
    tocEnabled: cleanBoolean(source.tocEnabled),
    forewordChapterId: cleanString(source.forewordChapterId),
  })
}

function cleanBackMatter(value: unknown) {
  const source = cleanObject(value)
  if (!Object.keys(source).length) return undefined
  const aboutTheAuthor = cleanString(source.aboutTheAuthor)
  return compact({
    aboutTheAuthor: aboutTheAuthor && aboutTheAuthor.length <= 8192 ? aboutTheAuthor : undefined,
    alsoByEnabled: cleanBoolean(source.alsoByEnabled),
  })
}

function cleanMetadata(value: unknown) {
  const source = cleanObject(value)
  if (!Object.keys(source).length) return undefined
  return compact({
    title: cleanString(source.title),
    subtitle: cleanString(source.subtitle),
    description: cleanString(source.description),
    authorName: cleanString(source.authorName),
    imprint: cleanString(source.imprint),
    language: cleanString(source.language),
    // isbn: legacy field is intentionally NOT included in the sanitizer's
    // output whitelist going forward for *new* writes — old records keep
    // whatever value they already have in Firestore (this function only
    // controls what a PATCH/POST body can write, not what's already stored).
    // Readers fall back `isbnPrint ?? isbn` / `isbnEbook ?? isbn` by reading
    // the raw stored record, not through this sanitizer.
    isbnPrint: cleanIsbnField(source.isbnPrint),
    isbnEbook: cleanIsbnField(source.isbnEbook),
    keywords: cleanStringArray(source.keywords),
    categories: cleanStringArray(source.categories),
    aiDisclosure: cleanString(source.aiDisclosure),
    matureContent: cleanBoolean(source.matureContent),
    frontMatter: cleanFrontMatter(source.frontMatter),
    backMatter: cleanBackMatter(source.backMatter),
  })
}
```

**Field-level 400 for invalid ISBN input (per master plan "Invalid → drop
with a 400 field error, not silent"):** `cleanMetadata` alone can only drop
silently (matching every other field in this file). To satisfy the
"not silent" requirement, the **route** that accepts metadata PATCHes
(the generic `book_studio_projects` PATCH handler and its portal
counterpart) must additionally detect an *attempted-but-invalid* ISBN
before calling the sanitizer and return 400 — this is the same
"detect an attempted write, act on it before/around the generic sanitize
call" shape Phase 1 used for `findLifecycleStateWriteAttempt`. Add to
`lib/book-studio/sanitize.ts`:

```ts
/** True if the metadata patch attempts to set isbnPrint/isbnEbook to a
 *  non-empty value that fails ISBN validation. Used by the PATCH route to
 *  return 400 instead of silently dropping the field. */
export function findInvalidIsbnFieldAttempt(metadataBody: unknown): string[] {
  const source = cleanObject(metadataBody)
  const invalid: string[] = []
  ;(['isbnPrint', 'isbnEbook'] as const).forEach((field) => {
    const raw = source[field]
    if (typeof raw === 'string' && raw.trim() && !isValidIsbn(raw)) invalid.push(field)
  })
  return invalid
}
```

Wire this into whichever route handler currently calls
`sanitizeBookStudioRecordPatch`/`sanitizeBookStudioRecordInput` for the
`projects` resource (`lib/book-studio/routes.ts`'s generic PATCH, plus the
portal PATCH route) — **read that call site first** to see the exact
shape of `body.metadata` reaching it, then add:
```ts
const invalidIsbnFields = findInvalidIsbnFieldAttempt(body.metadata)
if (invalidIsbnFields.length) {
  return apiError(`Invalid ISBN in field(s): ${invalidIsbnFields.join(', ')}`, 400, { invalidFields: invalidIsbnFields })
}
```
before the sanitize call, for the `projects` resource only (guard on
`resource === 'projects'` in the generic handler, or add this check
specifically in `app/api/v1/book-studio/projects/route.ts` /
`app/api/v1/book-studio/projects/[id]/route.ts` if `projects` already has
resource-specific route files rather than only riding the generic
`[resource]` catch-all — confirm which by checking
`app/api/v1/book-studio/projects/route.ts`'s existing contents before
editing).

- [ ] **Step 1: Write the failing tests**

```ts
// __tests__/lib/book-studio-sanitize-metadata.test.ts (or the existing
// sanitize test file, if one already covers cleanMetadata — check first)
import { sanitizeBookStudioRecordPatch, findInvalidIsbnFieldAttempt } from '@/lib/book-studio/sanitize'

describe('metadata ISBN split', () => {
  it('accepts valid isbnPrint and isbnEbook independently', () => {
    const result = sanitizeBookStudioRecordPatch('projects', {
      metadata: { isbnPrint: '978-0-306-40615-7', isbnEbook: '9780306406157' },
    })
    expect(result.metadata?.isbnPrint).toBe('9780306406157')
    expect(result.metadata?.isbnEbook).toBe('9780306406157')
  })

  it('drops an invalid isbnPrint/isbnEbook from the sanitized output', () => {
    const result = sanitizeBookStudioRecordPatch('projects', {
      metadata: { isbnPrint: 'garbage' },
    })
    expect(result.metadata?.isbnPrint).toBeUndefined()
  })

  it('findInvalidIsbnFieldAttempt flags garbage isbn fields by name', () => {
    expect(findInvalidIsbnFieldAttempt({ isbnPrint: 'garbage', isbnEbook: '9780306406157' }))
      .toEqual(['isbnPrint'])
  })

  it('findInvalidIsbnFieldAttempt returns empty for valid or absent fields', () => {
    expect(findInvalidIsbnFieldAttempt({ isbnPrint: '9780306406157' })).toEqual([])
    expect(findInvalidIsbnFieldAttempt({})).toEqual([])
    expect(findInvalidIsbnFieldAttempt(undefined)).toEqual([])
  })

  it('accepts frontMatter/backMatter with length guards', () => {
    const result = sanitizeBookStudioRecordPatch('projects', {
      metadata: {
        frontMatter: { dedication: 'To my family', tocEnabled: true, forewordChapterId: 'ch-1' },
        backMatter: { aboutTheAuthor: 'An author bio', alsoByEnabled: true },
      },
    })
    expect(result.metadata?.frontMatter).toEqual({ dedication: 'To my family', tocEnabled: true, forewordChapterId: 'ch-1' })
    expect(result.metadata?.backMatter).toEqual({ aboutTheAuthor: 'An author bio', alsoByEnabled: true })
  })

  it('drops an over-length dedication/aboutTheAuthor rather than truncating', () => {
    const result = sanitizeBookStudioRecordPatch('projects', {
      metadata: {
        frontMatter: { dedication: 'x'.repeat(3000) },
        backMatter: { aboutTheAuthor: 'y'.repeat(9000) },
      },
    })
    expect(result.metadata?.frontMatter?.dedication).toBeUndefined()
    expect(result.metadata?.backMatter?.aboutTheAuthor).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest __tests__/lib/book-studio-sanitize-metadata.test.ts`
Expected: FAIL — new exports/fields don't exist yet.

- [ ] **Step 3: Implement** — `types.ts` field additions, `cleanMetadata`
replacement, `cleanFrontMatter`/`cleanBackMatter`/`cleanIsbnField`, and
`findInvalidIsbnFieldAttempt`, plus wiring the 400 check into the
`projects` PATCH route(s) as described above.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest __tests__/lib/book-studio-sanitize-metadata.test.ts`
Expected: PASS.

- [ ] **Step 5: Check for regressions in existing metadata-touching tests**

Run: `npx jest -t metadata` (or grep `__tests__/` for any test asserting the
old single `isbn` field round-trips through `cleanMetadata` — if one exists,
update its assertion to use `isbnPrint` instead, per the same "update, don't
delete" instruction Phase 1 gave for the workspace integration test).

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck`

- [ ] **Step 7: Commit**

```bash
git add components/book-studio/project/types.ts lib/book-studio/sanitize.ts \
        app/api/v1/book-studio/projects/route.ts app/api/v1/book-studio/projects/\[id\]/route.ts \
        __tests__/lib/book-studio-sanitize-metadata.test.ts
git commit -m "feat(book-studio): split ISBN into isbnPrint/isbnEbook and add front/back matter fields"
```

---

## Task 3: Transactional ISBN assignment (sequential — depends on Task 1's pool CRUD + Task 2's metadata fields)

**Files:**
- Create: `app/api/v1/book-studio/projects/[id]/assign-isbn/route.ts`
- Test: extend `__tests__/api/book-studio-isbn-pool.test.ts` with the assignment + race-condition tests

**Design:**

```ts
// app/api/v1/book-studio/projects/[id]/assign-isbn/route.ts
import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { apiError, apiSuccess } from '@/lib/api/response'
import { adminDb } from '@/lib/firebase/admin'
import { FieldValue } from 'firebase-admin/firestore'
import { ensureBookStudioAccess } from '@/lib/book-studio/api'
import { isValidIsbn, normalizeIsbn } from '@/lib/book-studio/isbn'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ id: string }> }

class IsbnAlreadyAssignedError extends Error {}
class IsbnNotFoundError extends Error {}
class ProjectNotFoundError extends Error {}

export const POST = withAuth('admin', async (req: NextRequest, user, context: Ctx) => {
  const { id: projectId } = await context.params

  let body: Record<string, unknown>
  try {
    body = (await req.json()) as Record<string, unknown>
  } catch {
    return apiError('Malformed JSON body', 400)
  }

  const access = await ensureBookStudioAccess(req, user, body, 'write')
  if (access.error) return access.error
  const orgId = access.orgId

  const format = body.format
  if (format !== 'print' && format !== 'ebook') {
    return apiError('format must be "print" or "ebook"', 400)
  }

  // Two supported inputs: assign a specific pool entry by isbnPoolId, OR
  // mark the project as using a KDP-assigned identifier directly (no pool
  // entry — see the "open decision for Peet" note below; this path exists
  // so Phase 2 does not force every KDP user through the Bowker pool).
  const isbnPoolId = typeof body.isbnPoolId === 'string' ? body.isbnPoolId : undefined
  const kdpAssignedIsbn = typeof body.kdpAssignedIsbn === 'string' ? body.kdpAssignedIsbn : undefined

  if (!isbnPoolId && !kdpAssignedIsbn) {
    return apiError('Provide either isbnPoolId (Bowker pool entry) or kdpAssignedIsbn (KDP-assigned identifier)', 400)
  }
  if (kdpAssignedIsbn && !isValidIsbn(kdpAssignedIsbn)) {
    return apiError('kdpAssignedIsbn is not a valid ISBN-10/13', 400)
  }

  const projectRef = adminDb.collection('book_studio_projects').doc(projectId)
  const poolRef = isbnPoolId ? adminDb.collection('book_studio_isbn_pool').doc(isbnPoolId) : null
  const decisionLogRef = adminDb.collection('book_studio_decision_logs').doc()

  const metadataField = format === 'print' ? 'isbnPrint' : 'isbnEbook'
  let assignedIsbn = ''

  try {
    await adminDb.runTransaction(async (tx) => {
      const projectSnap = await tx.get(projectRef)
      if (!projectSnap.exists) throw new ProjectNotFoundError()
      const project = projectSnap.data() ?? {}
      if (project.orgId !== orgId || project.deleted === true) throw new ProjectNotFoundError()

      if (poolRef) {
        const poolSnap = await tx.get(poolRef)
        if (!poolSnap.exists) throw new IsbnNotFoundError()
        const pool = poolSnap.data() ?? {}
        if (pool.orgId !== orgId) throw new IsbnNotFoundError()
        if (pool.status !== 'available') throw new IsbnAlreadyAssignedError()

        assignedIsbn = pool.isbn13 as string
        tx.update(poolRef, {
          status: 'assigned',
          assignedProjectId: projectId,
          assignedFormat: format,
          updatedAt: FieldValue.serverTimestamp(),
        })
      } else {
        assignedIsbn = normalizeIsbn(kdpAssignedIsbn as string)
      }

      tx.update(projectRef, {
        [`metadata.${metadataField}`]: assignedIsbn,
        updatedAt: FieldValue.serverTimestamp(),
      })

      tx.create(decisionLogRef, {
        orgId,
        projectId,
        decision: 'isbn_assigned',
        title: `ISBN assigned (${format})`,
        safeSummary: `Assigned ${format} ISBN ${assignedIsbn} to this project${poolRef ? ' from the ISBN pool' : ' (KDP-assigned)'}.`,
        format,
        isbn: assignedIsbn,
        source: poolRef ? 'pool' : 'kdp_assigned',
        createdBy: user.uid,
        createdByType: 'user',
        updatedBy: user.uid,
        updatedByType: 'user',
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      })
    })
  } catch (error) {
    if (error instanceof ProjectNotFoundError) return apiError('book project not found', 404)
    if (error instanceof IsbnNotFoundError) return apiError('ISBN pool entry not found', 404)
    if (error instanceof IsbnAlreadyAssignedError) return apiError('This ISBN has already been assigned or retired', 409)
    throw error
  }

  return apiSuccess({ projectId, format, isbn: assignedIsbn })
})
```

**Note on `metadata.${metadataField}` dot-path update:** confirm the
existing `book_studio_projects` documents store `metadata` as a nested map
(not a top-level flattened field) before using Firestore's dot-path partial
update syntax — read one existing project-creation code path
(`lib/book-studio/routes.ts`'s POST handler serialization, or
`sanitizeBookStudioRecordInput`'s output shape) to confirm `metadata` is
written as a single nested object field, which is what makes
`tx.update(ref, { 'metadata.isbnPrint': value })` a safe partial-merge
rather than clobbering sibling metadata fields.

- [ ] **Step 1: Write the failing tests** (extend `__tests__/api/book-studio-isbn-pool.test.ts`)

```ts
describe('POST /api/v1/book-studio/projects/[id]/assign-isbn', () => {
  it('assigns an available pool ISBN to a project and marks the pool entry assigned', async () => {
    // stage: pool entry { id: 'pool-1', orgId: 'org-1', isbn13: '9780306406157', status: 'available' }
    //        project { id: 'proj-1', orgId: 'org-1', metadata: {} }
    // POST { format: 'print', isbnPoolId: 'pool-1' }
    // assert 200, response.data.isbn === '9780306406157'
    // assert pool doc updateSpy called with status:'assigned', assignedProjectId:'proj-1', assignedFormat:'print'
    // assert project doc updateSpy called with 'metadata.isbnPrint': '9780306406157'
  })

  it('409s when the pool entry is already assigned (double-assignment race)', async () => {
    // stage pool entry with status: 'assigned' already
    // POST -> assert 409
  })

  it('accepts a kdpAssignedIsbn without touching the pool', async () => {
    // POST { format: 'ebook', kdpAssignedIsbn: '978-0-306-40615-7' }
    // assert 200, no pool collection doc touched
  })

  it('400s a malformed kdpAssignedIsbn', async () => {
    // POST { format: 'ebook', kdpAssignedIsbn: 'garbage' } -> 400
  })

  it('serializes concurrent assignment attempts on the same pool entry — only one succeeds', async () => {
    // Reuse the txChain-style serialization scaffold from
    // __tests__/api/portal-book-studio-request-draft.test.ts: fire two
    // POSTs concurrently against the same pool-1 entry (status: 'available'
    // initially), assert exactly one resolves 200 and the other 409, and
    // the pool doc's final state has assignedProjectId set exactly once.
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest __tests__/api/book-studio-isbn-pool.test.ts -t assign-isbn`
Expected: FAIL — route doesn't exist yet.

- [ ] **Step 3: Implement** the route per the Design block above.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest __tests__/api/book-studio-isbn-pool.test.ts`
Expected: PASS, full file (CRUD from Task 1 + assignment from Task 3).

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`

- [ ] **Step 6: Commit**

```bash
git add app/api/v1/book-studio/projects/\[id\]/assign-isbn/route.ts \
        __tests__/api/book-studio-isbn-pool.test.ts
git commit -m "feat(book-studio): add transactional ISBN pool assignment endpoint"
```

---

## Task 4: Channel metadata validator + `submission_ready` guard wiring (parallel-safe with Task 5/6/7 — depends on Task 2's metadata fields; independent of Task 1/3's pool mechanics beyond reading `isbnPrint`/`isbnEbook`)

**Files:**
- Create: `lib/book-studio/channel-metadata.ts`
- Modify: `lib/book-studio/lifecycle.ts` — register `LIFECYCLE_GUARDS.submission_ready` (one additive entry, do not touch existing guards)
- Test: `__tests__/lib/book-studio-channel-metadata.test.ts` (new)
- Test: extend `__tests__/lib/book-studio-lifecycle.test.ts` with one new case confirming the guard is now registered (does not modify any existing Phase 1 test case)

**Design:**

```ts
// lib/book-studio/channel-metadata.ts
import type { GuardResult } from './lifecycle'

export type PublishChannel = 'kdp_print' | 'kdp_ebook' | 'google_play'

export type ChannelMetadataProjectInput = {
  title?: string
  metadata?: {
    description?: string
    isbnPrint?: string
    isbnEbook?: string
    isbn?: string // legacy fallback
    language?: string
    categories?: string[]
    kdpCategories?: string[] // Phase 3 field — read defensively if present, never required by Phase 2
  }
  trim?: { presetId?: string } | null
  onSaleDate?: string
}

const DESCRIPTION_MIN = 30
const DESCRIPTION_MAX = 4000

/**
 * Validates a project's readiness for a specific publish channel. This is
 * pure data-in/data-out (no Firestore access) so it slots directly into
 * Phase 1's LIFECYCLE_GUARDS registry and is trivially unit-testable.
 *
 * KDP print requires an ISBN (pool-assigned isbnPrint OR the legacy isbn
 * fallback) OR an explicit acknowledgement that KDP will assign a free one
 * — Phase 2 does not force a pool assignment before submission_ready
 * because "KDP-assigned ISBN" is a valid, un-pre-registerable path (see the
 * open decision for Peet at the bottom of this plan). The guard therefore
 * treats a MISSING isbnPrint as a warning, not a blocker, for kdp_print —
 * only an INVALID stored value blocks (which should be impossible given the
 * sanitizer, but the guard re-checks defensively rather than trusting it).
 */
export function validateChannelMetadata(project: ChannelMetadataProjectInput, channel: PublishChannel): GuardResult {
  const missing: string[] = []
  const warnings: string[] = []
  const meta = project.metadata ?? {}
  const title = project.title?.trim()
  const description = meta.description?.trim()

  if (!title) missing.push('title')
  if (!description) {
    missing.push('description')
  } else if (description.length < DESCRIPTION_MIN || description.length > DESCRIPTION_MAX) {
    missing.push(`description must be ${DESCRIPTION_MIN}-${DESCRIPTION_MAX} characters (currently ${description.length})`)
  }

  const categories = meta.categories ?? meta.kdpCategories ?? []
  if (!categories.length) missing.push('at least one category (BISAC code)')

  if (channel === 'kdp_print') {
    if (!project.trim?.presetId) missing.push('trim size')
    const isbn = meta.isbnPrint ?? meta.isbn
    if (!isbn) warnings.push('no print ISBN assigned yet — KDP will assign a free one at submission if left blank')
  }

  if (channel === 'kdp_ebook') {
    // eBooks on KDP use an ASIN, not an ISBN — no ISBN requirement here.
    // isbnEbook is optional metadata (useful for non-KDP ebook channels),
    // never required for kdp_ebook specifically.
  }

  if (channel === 'google_play') {
    const isbn = meta.isbnEbook ?? meta.isbn
    if (!isbn) missing.push('ISBN or GGKEY (Google Play requires one identifier)')
    if (!meta.language) missing.push('language (BCP-47 code)')
    if (!project.onSaleDate) missing.push('on-sale date')
  }

  return { ok: missing.length === 0, blockers: missing.map((m) => `${channel}: ${m}`), }
    as GuardResult & { warnings?: string[] } // see note below on GuardResult shape
}
```

**Note on `warnings` vs `GuardResult`:** Phase 1's `GuardResult` type is
`{ ok: boolean; blockers: string[] }` — it has no `warnings` field. The
master plan's design note calls for `{ok, missing, warnings}`. Reconcile by
keeping `validateChannelMetadata`'s **public** return type as
`{ ok: boolean; blockers: string[]; warnings: string[] }` (a superset,
structurally assignable to `GuardResult` wherever only `ok`/`blockers` are
read) rather than forcing a cast — the code block above shows the cast as
a placeholder; the actual implementation should just declare the return
type honestly:

```ts
export type ChannelMetadataResult = GuardResult & { warnings: string[] }
export function validateChannelMetadata(project: ChannelMetadataProjectInput, channel: PublishChannel): ChannelMetadataResult {
  // ... same logic, ending:
  return { ok: missing.length === 0, blockers: missing, warnings }
}
```

```ts
// lib/book-studio/lifecycle.ts — additive registration only, inside the
// existing LIFECYCLE_GUARDS object literal (do not recreate the object):
import { validateChannelMetadata, type ChannelMetadataProjectInput } from './channel-metadata'

export type SubmissionReadyGuardInput = {
  project: ChannelMetadataProjectInput
  channels: Array<'kdp_print' | 'kdp_ebook' | 'google_play'>
}

/** submission_ready guard: every channel the project intends to publish to
 *  (channels[]) must pass validateChannelMetadata. If channels is empty,
 *  defaults to checking kdp_print + kdp_ebook (the common case) so a
 *  project with no explicit channel selection still gets a real check
 *  rather than silently passing. */
export function checkSubmissionReadyGuard(input: SubmissionReadyGuardInput): GuardResult {
  const channels = input.channels.length ? input.channels : ['kdp_print', 'kdp_ebook']
  const blockers: string[] = []
  channels.forEach((channel) => {
    const result = validateChannelMetadata(input.project, channel)
    blockers.push(...result.blockers)
  })
  return { ok: blockers.length === 0, blockers }
}

// Inside LIFECYCLE_GUARDS:
//   submission_ready: (data) => checkSubmissionReadyGuard(data as SubmissionReadyGuardInput),
```

The admin transition route's `loadGuardData` (Phase 1,
`app/api/v1/book-studio/projects/[id]/transition/route.ts`) needs one
additive branch for `toState === 'submission_ready'`, fetching the project's
`title`, `metadata`, `trim` fields and passing
`{ project: {...}, channels: project.targetChannels ?? [] }` — add a
`targetChannels?: Array<'kdp_print'|'kdp_ebook'|'google_play'>` optional
field to the project (whitelisted in `sanitize.ts` alongside the other
Task 2/4 additions) so an operator can declare intended channels; absent
`targetChannels` falls back to the guard's own default
(`['kdp_print', 'kdp_ebook']`).

- [ ] **Step 1: Write the failing tests**

```ts
// __tests__/lib/book-studio-channel-metadata.test.ts
import { validateChannelMetadata } from '@/lib/book-studio/channel-metadata'

const baseProject = {
  title: 'My Book',
  metadata: {
    description: 'x'.repeat(50),
    categories: ['BUS063000'],
    isbnPrint: '9780306406157',
    isbnEbook: '9780306406157',
    language: 'en',
  },
  trim: { presetId: '6x9' },
  onSaleDate: '2026-08-01',
}

describe('validateChannelMetadata', () => {
  it('passes kdp_print with all required fields present', () => {
    expect(validateChannelMetadata(baseProject, 'kdp_print').ok).toBe(true)
  })

  it('warns (does not block) kdp_print with no ISBN assigned', () => {
    const result = validateChannelMetadata({ ...baseProject, metadata: { ...baseProject.metadata, isbnPrint: undefined, isbn: undefined } }, 'kdp_print')
    expect(result.ok).toBe(true)
    expect(result.warnings.length).toBeGreaterThan(0)
  })

  it('blocks kdp_print missing trim size', () => {
    const result = validateChannelMetadata({ ...baseProject, trim: null }, 'kdp_print')
    expect(result.ok).toBe(false)
    expect(result.blockers.some((b) => b.includes('trim size'))).toBe(true)
  })

  it('blocks on missing title, description, or category regardless of channel', () => {
    const result = validateChannelMetadata({ title: '', metadata: {} }, 'kdp_ebook')
    expect(result.ok).toBe(false)
    expect(result.blockers.some((b) => b.includes('title'))).toBe(true)
    expect(result.blockers.some((b) => b.includes('description'))).toBe(true)
    expect(result.blockers.some((b) => b.includes('category'))).toBe(true)
  })

  it('blocks a too-short or too-long description', () => {
    const short = validateChannelMetadata({ ...baseProject, metadata: { ...baseProject.metadata, description: 'too short' } }, 'kdp_ebook')
    expect(short.ok).toBe(false)
    const long = validateChannelMetadata({ ...baseProject, metadata: { ...baseProject.metadata, description: 'x'.repeat(4001) } }, 'kdp_ebook')
    expect(long.ok).toBe(false)
  })

  it('kdp_ebook never requires an ISBN (KDP uses ASIN for ebooks)', () => {
    const result = validateChannelMetadata({ ...baseProject, metadata: { ...baseProject.metadata, isbnEbook: undefined, isbn: undefined } }, 'kdp_ebook')
    expect(result.ok).toBe(true)
  })

  it('blocks google_play missing ISBN/GGKEY, language, or on-sale date', () => {
    const result = validateChannelMetadata({ title: 'T', metadata: { description: 'x'.repeat(50), categories: ['a'] } }, 'google_play')
    expect(result.ok).toBe(false)
    expect(result.blockers.some((b) => b.includes('ISBN or GGKEY'))).toBe(true)
    expect(result.blockers.some((b) => b.includes('language'))).toBe(true)
    expect(result.blockers.some((b) => b.includes('on-sale date'))).toBe(true)
  })

  it('passes google_play with all required fields present', () => {
    expect(validateChannelMetadata(baseProject, 'google_play').ok).toBe(true)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest __tests__/lib/book-studio-channel-metadata.test.ts`
Expected: FAIL — module doesn't exist yet.

- [ ] **Step 3: Implement** `lib/book-studio/channel-metadata.ts` per the
Design block, then register `LIFECYCLE_GUARDS.submission_ready` in
`lib/book-studio/lifecycle.ts` and add the `loadGuardData` branch +
`targetChannels` field as described.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest __tests__/lib/book-studio-channel-metadata.test.ts __tests__/lib/book-studio-lifecycle.test.ts`
Expected: PASS — including all pre-existing Phase 1 lifecycle tests
(confirm no regression from the additive `LIFECYCLE_GUARDS` entry).

- [ ] **Step 5: Add one transition-route test for the new guard**

Extend `__tests__/api/book-studio-transition-admin.test.ts` (Phase 1's
file) with a case: transitioning to `submission_ready` with an incomplete
project 422s with named blockers, e.g. `"kdp_print: title"`. This confirms
the guard is actually wired end-to-end through the route, not just unit
tested in isolation.

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck`

- [ ] **Step 7: Commit**

```bash
git add lib/book-studio/channel-metadata.ts lib/book-studio/lifecycle.ts \
        lib/book-studio/sanitize.ts \
        app/api/v1/book-studio/projects/\[id\]/transition/route.ts \
        __tests__/lib/book-studio-channel-metadata.test.ts \
        __tests__/lib/book-studio-lifecycle.test.ts \
        __tests__/api/book-studio-transition-admin.test.ts
git commit -m "feat(book-studio): add channel metadata validator and wire it as the submission_ready guard"
```

---

## Task 5: Assembly — ISBN rendering (parallel-safe with Task 6/7 — depends on Task 2's metadata fields)

**Files:**
- Modify: `lib/book-studio/assembly/epub.ts` — OPF identifier
- Modify: `lib/book-studio/assembly/interior-pdf.ts` — copyright page
- Test: `__tests__/lib/book-studio-assembly-isbn-frontmatter.test.ts` (new — ISBN portion; front/back matter portion added in Task 6, same file)

**Design:** Read both files' current identifier/copyright-page code in full
before editing (per the "Verified codebase facts" note above — this plan's
research pass did not capture their current contents verbatim).

- `epub.ts`: wherever the OPF `<dc:identifier>` is currently set from
  `metadata.isbn`, change to `metadata.isbnEbook ?? metadata.isbn`. If no
  ISBN is present at all, fall back to whatever placeholder/UUID scheme the
  file already uses for identifier-less books (read the existing fallback
  before assuming one needs to be added).
- `interior-pdf.ts`: the copyright page should render each present edition's
  ISBN with a label, e.g.:
  ```
  Print ISBN: 978-0-306-40615-7
  eBook ISBN: 978-0-306-40615-7
  ```
  using `metadata.isbnPrint ?? metadata.isbn` and
  `metadata.isbnEbook ?? metadata.isbn` respectively — omit a line entirely
  when neither value is present (do not render "ISBN: (none)").

- [ ] **Step 1: Write the failing tests**

```ts
// __tests__/lib/book-studio-assembly-isbn-frontmatter.test.ts (ISBN portion)
// Follow whatever existing test-harness pattern
// __tests__/lib/book-studio-assembly*.test.ts (if one exists — check
// __tests__/lib/ for existing epub/interior-pdf tests) already uses for
// invoking these two modules; do not invent a new PDF/EPUB assertion
// mechanism if one already exists (e.g. parsing generated EPUB XML or
// pdf-lib output). If no existing assembly test file exists, use the
// smallest reasonable unit: extract just the identifier-selection /
// copyright-line-building logic into an exported pure helper function if
// the current code has it inline (e.g. `resolveEpubIdentifier(metadata)`,
// `buildCopyrightIsbnLines(metadata)`) so it's testable without invoking
// the full pdf-lib/epub generation pipeline — prefer this refactor over
// asserting against raw PDF bytes or EPUB zip contents.

describe('EPUB identifier ISBN fallback', () => {
  it('uses isbnEbook when present', () => { /* ... */ })
  it('falls back to legacy isbn when isbnEbook is absent', () => { /* ... */ })
  it('falls back to the existing placeholder scheme when neither is present', () => { /* ... */ })
})

describe('Interior PDF copyright page ISBN lines', () => {
  it('renders both print and ebook ISBN lines when both are present', () => { /* ... */ })
  it('renders only the print line when isbnEbook/isbn are absent', () => { /* ... */ })
  it('omits both lines when no ISBN is present at all', () => { /* ... */ })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest __tests__/lib/book-studio-assembly-isbn-frontmatter.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement** the fallback chains in both files (extracting a
small named helper first if the current code is inline, per the note
above).

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest __tests__/lib/book-studio-assembly-isbn-frontmatter.test.ts`
Expected: PASS (ISBN portion — front/back matter cases land in Task 6).

- [ ] **Step 5: Regression-check the existing assembly test suite**

Run: `npx jest -t assembly` (or the specific existing assembly test file
paths, once located in Step 1) — confirm no break from the identifier
change.

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck`

- [ ] **Step 7: Commit**

```bash
git add lib/book-studio/assembly/epub.ts lib/book-studio/assembly/interior-pdf.ts \
        __tests__/lib/book-studio-assembly-isbn-frontmatter.test.ts
git commit -m "feat(book-studio): render split print/ebook ISBNs in EPUB OPF and interior PDF copyright page"
```

---

## Task 6: Front & back matter rendering (parallel-safe with Task 5/7 — depends on Task 2's metadata fields; touches the same two assembly files as Task 5, so run Task 5 and Task 6 sequentially if using a single agent, or as two agents on the SAME branch with Task 5 merged first to avoid a merge conflict on `epub.ts`/`interior-pdf.ts`)

**Files:**
- Modify: `lib/book-studio/assembly/epub.ts` — nav/spine ordering for dedication/foreword/about/also-by
- Modify: `lib/book-studio/assembly/interior-pdf.ts` — render order + new TOC page
- Test: extend `__tests__/lib/book-studio-assembly-isbn-frontmatter.test.ts` with a `describe('front/back matter render order', ...)` block

**Design:** Render order (both outputs): title page → copyright → dedication
→ TOC → foreword → chapters → about the author → also-by.

- **Dedication:** a plain-text page/section rendered only when
  `metadata.frontMatter.dedication` is present.
- **TOC:** EPUB nav already exists per the master plan ("EPUB nav already
  exists") — no EPUB change needed for TOC itself, only gating whether it's
  rendered by `frontMatter.tocEnabled` (default true for nonfiction format,
  false for story format — read `lib/book-studio/format-registry.ts` to
  confirm the exact format-id strings used for this default, e.g.
  `'nonfiction'` vs `'story'`). Interior PDF gains a new TOC page: chapter
  titles + page numbers, computed **after** pagination (i.e. this must be
  a second pass over the already-paginated interior — read the current
  pagination code structure first to find the right insertion point; do
  not attempt to precompute page numbers before layout).
- **Foreword:** when `metadata.frontMatter.forewordChapterId` matches an
  existing chapter's id, that chapter renders immediately before Chapter 1,
  unnumbered (excluded from the normal chapter numbering sequence), in both
  outputs.
- **About the author / also-by:** back-matter sections after the last
  chapter. `alsoByEnabled` renders a list of the project's series volumes
  (requires reading `seriesId` + querying sibling projects by `volumeOrder`
  — reuse whatever series-lookup helper already exists, e.g. in
  `lib/book-studio/series.ts` if one exists; check before writing a new
  query) — when `seriesId` is absent, `alsoByEnabled: true` renders nothing
  (not an error).

- [ ] **Step 1: Write the failing tests** (extend the Task 5 test file)

```ts
describe('front/back matter render order', () => {
  it('renders dedication only when present', () => { /* ... */ })
  it('renders the foreword chapter unnumbered before Chapter 1 when forewordChapterId is set', () => { /* ... */ })
  it('excludes the foreword chapter from normal chapter numbering', () => { /* ... */ })
  it('renders about-the-author and also-by after the last chapter', () => { /* ... */ })
  it('also-by lists series volumes in volumeOrder when seriesId is set and alsoByEnabled is true', () => { /* ... */ })
  it('also-by renders nothing (not an error) when alsoByEnabled is true but seriesId is absent', () => { /* ... */ })
  it('interior PDF TOC page lists chapter titles with correct page numbers computed after pagination', () => { /* ... */ })
  it('respects tocEnabled default: true for nonfiction format projects, false for story format, when frontMatter.tocEnabled is unset', () => { /* ... */ })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest __tests__/lib/book-studio-assembly-isbn-frontmatter.test.ts -t "front/back matter"`
Expected: FAIL.

- [ ] **Step 3: Implement** render-order changes in both assembly files per
the Design section (read each file's current pagination/nav-building code
in full first).

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest __tests__/lib/book-studio-assembly-isbn-frontmatter.test.ts`
Expected: PASS, full file (Task 5 + Task 6 cases).

- [ ] **Step 5: Regression-check the existing assembly test suite**

Run the same existing assembly test file(s) located in Task 5 Step 1 —
confirm chapter numbering / EPUB nav regressions are caught here, since this
task is the highest-risk one for silently breaking existing books that have
no `frontMatter`/`backMatter` set (verify: a project with neither field set
renders identically to before this task, byte-for-byte if the existing test
suite does snapshot comparison, or structurally equivalent otherwise).

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck`

- [ ] **Step 7: Commit**

```bash
git add lib/book-studio/assembly/epub.ts lib/book-studio/assembly/interior-pdf.ts \
        __tests__/lib/book-studio-assembly-isbn-frontmatter.test.ts
git commit -m "feat(book-studio): render dedication/TOC/foreword/about-the-author/also-by in interior PDF and EPUB"
```

---

## Task 7: Publishing-packet pricing & territories (parallel-safe with Task 4/5/6 — independent of ISBN/metadata work, touches only the publishing-packets sanitizer + Assembly tab UI)

**Files:**
- Modify: `lib/book-studio/sanitize.ts` — `channelPricing` whitelist on `book_studio_publishing_packets` records (find the existing sanitizer function for this resource — likely near `cleanManifestFiles`/`cleanGates` given the file's naming convention — read it in full before adding a field)
- Modify: Assembly tab UI component (the operator-facing component that
  already renders package-manifest data next to the publishing packet —
  identify the exact file by searching for where `book_studio_publishing_packets`
  records are rendered; the master plan does not name this component
  explicitly and it was not located during this plan's research pass, so
  **locate it as the first step of this task** rather than guessing a path)
- Test: `__tests__/lib/book-studio-sanitize-packet-pricing.test.ts` (new)

**Design:**

```ts
// lib/book-studio/sanitize.ts
const PRICING_CHANNELS = ['kdp', 'google_play_books'] as const

function cleanChannelPricingEntry(value: unknown) {
  const source = cleanObject(value)
  const channel = pick(source.channel, PRICING_CHANNELS as unknown as string[], undefined, 'channelPricing[].channel')
  if (!channel) return null
  const listPrice = typeof source.listPrice === 'number' && source.listPrice > 0 ? source.listPrice : null
  if (listPrice === null) return null
  const currency = cleanString(source.currency)
  if (!currency || !/^[A-Z]{3}$/.test(currency)) return null
  const territories = source.territories === 'selected' ? 'selected' : 'world'
  return compact({
    channel,
    listPrice,
    currency,
    territories,
    territoryNotes: territories === 'selected' ? cleanString(source.territoryNotes) : undefined,
  })
}

function cleanChannelPricing(value: unknown) {
  if (!Array.isArray(value)) return undefined
  const entries = value.map(cleanChannelPricingEntry).filter(Boolean)
  return entries.length ? entries : undefined
}
```

Wire `channelPricing: cleanChannelPricing(source.channelPricing)` into the
publishing-packets resource's existing sanitizer function (whatever it's
currently named — confirm before editing).

**UI:** a pricing card per channel next to the manifest in the Assembly
tab, editable by operator (and portal roles with `publishingPackets`
capability per the existing capability model). Channel-specific fields
side by side, never merged into one shared price field — matches the
"never merged" rule already established for KDP categories vs Google
genres in the master plan (that specific rule is Phase 3's, but the
principle — channel data stays channel-scoped — applies here identically).

- [ ] **Step 1: Locate the Assembly tab / publishing-packet UI component**

Search the codebase (`grep -r "book_studio_publishing_packets" components/`
or search for wherever `packageManifest` is rendered in the project
workspace) to find the exact file and confirm its current props/rendering
approach before writing any test against it.

- [ ] **Step 2: Write the failing sanitizer test**

```ts
// __tests__/lib/book-studio-sanitize-packet-pricing.test.ts
import { sanitizeBookStudioRecordInput } from '@/lib/book-studio/sanitize'

describe('publishing packet channelPricing', () => {
  it('accepts valid per-channel pricing entries', () => {
    const result = sanitizeBookStudioRecordInput('publishing-packets', {
      projectId: 'proj-1',
      channelPricing: [
        { channel: 'kdp', listPrice: 14.99, currency: 'USD', territories: 'world' },
        { channel: 'google_play_books', listPrice: 9.99, currency: 'ZAR', territories: 'selected', territoryNotes: 'South Africa only' },
      ],
    })
    expect(result.channelPricing).toHaveLength(2)
    expect(result.channelPricing?.[0]).toEqual({ channel: 'kdp', listPrice: 14.99, currency: 'USD', territories: 'world' })
  })

  it('drops an entry with an invalid channel enum', () => {
    const result = sanitizeBookStudioRecordInput('publishing-packets', {
      projectId: 'proj-1',
      channelPricing: [{ channel: 'ingram_spark', listPrice: 10, currency: 'USD' }],
    })
    expect(result.channelPricing).toBeUndefined()
  })

  it('drops an entry with a non-positive price or malformed currency code', () => {
    const result = sanitizeBookStudioRecordInput('publishing-packets', {
      projectId: 'proj-1',
      channelPricing: [
        { channel: 'kdp', listPrice: -1, currency: 'USD' },
        { channel: 'kdp', listPrice: 10, currency: 'usd' },
      ],
    })
    expect(result.channelPricing).toBeUndefined()
  })

  it('drops territoryNotes when territories is "world"', () => {
    const result = sanitizeBookStudioRecordInput('publishing-packets', {
      projectId: 'proj-1',
      channelPricing: [{ channel: 'kdp', listPrice: 10, currency: 'USD', territories: 'world', territoryNotes: 'ignored' }],
    })
    expect(result.channelPricing?.[0].territoryNotes).toBeUndefined()
  })
})
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx jest __tests__/lib/book-studio-sanitize-packet-pricing.test.ts`
Expected: FAIL.

- [ ] **Step 4: Implement** the sanitizer changes.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx jest __tests__/lib/book-studio-sanitize-packet-pricing.test.ts`
Expected: PASS.

- [ ] **Step 6: Implement the pricing card UI**

Add a per-channel pricing card to the component located in Step 1, gated
the same way that component already gates operator-vs-portal rendering
(reuse its existing capability-check pattern rather than inventing a new
one). Add a component-level test if the located file already has a
sibling test file (e.g. a `.test.tsx` in the same relative `__tests__/`
path) — extend that one rather than creating a new component test file
from scratch, per the file-discovery step.

- [ ] **Step 7: Typecheck**

Run: `npm run typecheck`

- [ ] **Step 8: Commit**

```bash
git add lib/book-studio/sanitize.ts __tests__/lib/book-studio-sanitize-packet-pricing.test.ts
# plus whatever UI file was located and modified in Step 1/6
git commit -m "feat(book-studio): add per-channel pricing/territories to publishing packets"
```

---

## Parallelization summary

- **Sequential spine:** Task 1 → Task 2 → Task 3. Task 1 creates
  `lib/book-studio/isbn.ts` (needed by Task 2's metadata sanitizer and
  Task 3's assign-isbn route) and the pool CRUD; Task 2 adds the
  `isbnPrint`/`isbnEbook` metadata fields Task 3's assignment route writes
  to; Task 3 needs both.
- **Parallel-safe once Task 2 lands (four independent agents):**
  - Task 4 (channel-metadata validator + `submission_ready` guard) —
    depends only on Task 2's metadata fields.
  - Task 5 (assembly ISBN rendering) — depends only on Task 2's metadata
    fields.
  - Task 6 (assembly front/back matter rendering) — depends only on
    Task 2's metadata fields, but **touches the same two files as Task 5**
    (`epub.ts`, `interior-pdf.ts`). Run Task 5 and Task 6 sequentially
    (Task 5 merged before Task 6 starts) to avoid a merge conflict, even
    though both are logically independent of each other's *data*.
  - Task 7 (publishing-packet pricing) — fully independent of ISBN/metadata
    work; depends on nothing but the base sanitizer file structure. Can run
    at any point, including in parallel with Task 1.
- Every task ends with `npm run typecheck` — do not skip it, per Phase 1's
  established discipline (catching a cross-file type break early, e.g.
  Task 4's `GuardResult` superset shape vs Task 2's metadata type, is
  cheaper than discovering it at final verification).

---

## Final verification (run after all 7 tasks are merged to `development`)

- [ ] **Run the full ISBN/metadata-related test files together**

```bash
npx jest \
  __tests__/lib/book-studio-isbn.test.ts \
  __tests__/lib/book-studio-sanitize-metadata.test.ts \
  __tests__/lib/book-studio-channel-metadata.test.ts \
  __tests__/lib/book-studio-assembly-isbn-frontmatter.test.ts \
  __tests__/lib/book-studio-sanitize-packet-pricing.test.ts \
  __tests__/api/book-studio-isbn-pool.test.ts \
  __tests__/lib/book-studio-lifecycle.test.ts \
  __tests__/api/book-studio-transition-admin.test.ts
```

Expected: all suites PASS.

- [ ] **Run the full existing Book Studio test surface for regressions**

```bash
npx jest __tests__/api/portal-book-studio-request-draft.test.ts \
         __tests__/app/book-studio-project-workspace.test.tsx \
         __tests__/app/book-studio-chapter-editor.test.tsx \
         __tests__/api/book-studio-assemble-lifecycle-gate.test.ts \
         __tests__/components/book-studio-project-header.test.tsx \
         __tests__/components/admin-book-studio-governance-pipeline.test.tsx
```

Expected: PASS, no regressions from Phase 1 or from this phase's metadata/
assembly changes.

- [ ] **Run the entire Jest suite**

```bash
npm test
```

Expected: green, zero failures, zero new skipped tests.

- [ ] **Typecheck the whole project**

```bash
npm run typecheck
```

Expected: zero errors. (Per project memory: `next build` does not catch
type errors due to `ignoreBuildErrors`; `npm run typecheck` via
`tsconfig.typecheck.json` is the real gate.)

- [ ] **Verify each literal acceptance criterion from the master plan's
Phase 2 section:**

  1. "Invalid check digit rejected" — covered by
     `__tests__/lib/book-studio-isbn.test.ts` (`isValidIsbn13`/`isValidIsbn10`
     wrong-check-digit cases) and
     `__tests__/lib/book-studio-sanitize-metadata.test.ts`
     ("drops an invalid isbnPrint/isbnEbook").
  2. "Double-assignment impossible under concurrent requests (race test)" —
     covered by `__tests__/api/book-studio-isbn-pool.test.ts`
     ("serializes concurrent assignment attempts on the same pool entry").
  3. "`submission_ready` transition blocked with named missing fields" —
     covered by `__tests__/api/book-studio-transition-admin.test.ts`'s new
     Task 4 case and `__tests__/lib/book-studio-channel-metadata.test.ts`.
  4. Section 2.1 (ISBN split) acceptance: valid 10/13-digit accepted, junk
     rejected with a field-level error, legacy fallback works in EPUB OPF
     and interior PDF — covered by Task 2 + Task 5 tests.
  5. Section 2.2 (front/back matter) acceptance: render order matches spec
     in both outputs, length guards enforced, also-by lists series volumes,
     foreword renders unnumbered — covered by Task 6 tests.
  6. Section 2.3 (pricing) acceptance: `channelPricing` sanitized correctly,
     rendered per channel, present in the packet — covered by Task 7 tests
     (packet ZIP inclusion is Phase 3's `submission-packet` route and
     cannot be verified until that route exists; note this as a
     Phase-3-carries-forward check, not a Phase 2 gap).

- [ ] **Manual smoke check (recommended before declaring Phase 2 done)**

  1. Start the dev server: `npm run dev` (or use the `run` skill).
  2. Create a `book_studio_isbn_pool` entry via
     `POST /api/v1/book-studio/isbn-pool` with a real valid ISBN-13 and
     `source: 'bowker'` — confirm it appears with `status: 'available'`.
  3. `POST /api/v1/book-studio/projects/{id}/assign-isbn` with
     `{ format: 'print', isbnPoolId: '<the pool entry id>' }` — confirm 200,
     the project's `metadata.isbnPrint` is set, and the pool entry flips to
     `status: 'assigned'`.
  4. Retry the same assignment against the same pool entry from a second
     project — confirm 409.
  5. Open that project's metadata panel (once Phase 3 adds the UI, or via
     direct PATCH for now) and set `frontMatter.dedication` +
     `backMatter.aboutTheAuthor` — run assembly, confirm the generated
     interior PDF includes the dedication page and about-the-author section
     in the right position, and the EPUB validates.
  6. Attempt `POST /api/v1/book-studio/projects/{id}/transition` with
     `{"toState": "submission_ready"}` on a project missing a description —
     confirm 422 with a blocker naming `kdp_print: description` (or similar).

- [ ] **Update the platform API skill(s) if any `/api/v1/book-studio/*`
routes are exposed to agent callers**

Per the standing "auto-update skills on app changes" rule and the master
plan's cross-cutting note: if `isbn-pool` or `assign-isbn` should be
callable by Pip/agents via the platform skill wrapper, update the source
skill file in `partnersinbiz-web/.claude/skills/` and re-run
`scripts/install-platform-skills.sh` to re-symlink. Confirm with Peet
whether ISBN pool management should be agent-accessible before adding it
(it touches real-money-adjacent Bowker purchases — see the open decision
below).

- [ ] **Push to `origin/development`**

```bash
git push origin development
```

(Per project-wide git preflight rules: `development` is the only working
branch, no worktrees, no feature branches. Do not run `vercel --prod` or
promote to `main` — that requires Peet's explicit approval.)

---

## Open decision for Peet (Phase 2 must NOT prematurely decide this)

**Bowker-purchased ISBN blocks vs KDP-assigned ISBNs only.** This plan's
data model and routes support **both** paths without picking one as
canonical:

- The `book_studio_isbn_pool` collection (`source: 'bowker' | 'kdp_assigned'
  | 'other'`) exists for organisations that buy ISBN blocks from Bowker (or
  any other ISBN agency) and want them tracked/assigned centrally.
- The `assign-isbn` route's `kdpAssignedIsbn` parameter exists for the
  simpler path — no pool at all, just record whatever identifier KDP
  assigns after the fact (or leave `isbnPrint`/`isbnEbook` blank entirely,
  which `validateChannelMetadata`'s `kdp_print` check treats as a
  **warning, not a blocker** for exactly this reason — eBooks on KDP don't
  need an ISBN at all, using ASIN instead).
- **What this plan does NOT decide:** whether Partners in Biz (or its
  clients) should actually purchase a Bowker block, how many ISBNs to
  provision upfront, who pays for them, or whether the pool
  CRUD/bulk-CSV-import UI (mentioned as a "Bowker ISBNs are bought in
  blocks and imported via CSV paste" convenience in the master plan) is
  worth building now versus deferring until a client actually needs it.
  Task 1's acceptance criteria only require single-record POST to work —
  bulk CSV import is explicitly **not** built in this plan and should not
  be inferred as already covered.

This decision should be made before Phase 3 (store submission) ships,
since Phase 3's submission checklist will reference whichever path is
actually in use — but Phase 2 itself works correctly either way, and no
code in this plan hardcodes an assumption about which path Peet chooses.
</content>
