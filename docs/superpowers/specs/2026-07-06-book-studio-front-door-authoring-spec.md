# Book Studio Front Door + Authoring — Spec

**Date:** 2026-07-06
**Status:** Draft — awaiting Peet's approval
**Repo:** `partnersinbiz-web` (branch `development`)
**Builds on:** `2026-07-05-book-studio-production-canvas-bridge-spec.md` (implemented, merged)
**Supersedes in part:** the "portal is review-only" posture from `2026-06-08-book-studio-v1-portal-access-promotion-model.md` — see Approved Revisions below.

## Problem

The production engine from the 2026-07-05 spec is fully merged (format registry, puzzle generators, PDF/EPUB assembly, canvas bridge, project workspace), but the module is effectively invisible:

1. **No create-book entry point.** The admin index (`app/(admin)/admin/org/[slug]/book-studio/page.tsx`) still renders the Phase-1 governance shell whose "Create book project" button is hardcoded `disabled`. The only way to create a project is a raw `POST /api/v1/book-studio/projects`.
2. **The portal ignores its own governance settings.** The admin governance page already exposes per-role toggles — `settings.modulePolicies.bookStudio.actions.{visibility, create, edit, evidenceRights, approvalGates, publishingPackets, archiveDelete}` × `{owner, admin, member}` (`lib/organizations/module-policies.ts:43`) — including "Create book projects" and "Edit briefs and manuscripts" for portal roles. But `BookStudioPortalWorkspace.tsx` is a hardcoded read-only surface that renders three permanently-disabled buttons.
3. **Chapter editing is a bare `<textarea>`** (`BookProjectChaptersPanel.tsx`) — unusable for real manuscripts.
4. **No category/genre taxonomy anywhere** — the metadata-listing gate requires channel-specific KDP categories and Google genres, but no field, enum, or picker exists at project level.
5. **No research surface** — `bridgeLinks[]` exists on projects but has no UI.
6. **QA fixtures leak into the client portal** — test projects ("QA Round2 — repro", "Prod smoke") are visible on a client-facing page.
7. **Series "create next volume" is not wired** despite the data model (`volumeOrder`, `sharedMetadata`, `sharedStylePrompt`) existing.

## Approved Revisions (Peet, 2026-07-06)

1. **Portal authoring is approved.** Anyone in an organisation whose role passes the governance toggles can create book projects and edit briefs/manuscripts from the portal. The old blanket "review-only portal" posture is replaced by **per-action role governance** (which the admin governance UI already models).
2. **Clients author manually; AI generation stays operator-side.** Portal users get manual writing/editing plus a "Request AI draft" action that creates a task for the PiB team. Canvas generation, assembly, publishing packets, and release gates remain operator actions. Peet (platform operator) can do everything.

## Unchanged Locked Constraints (do NOT violate)

- No direct store publishing, no marketplace API mutation, manual KDP/Google upload only.
- No marketplace credential custody; the forbidden-key sanitizer in `lib/book-studio/sanitize.ts` stays as-is.
- Hermes runtime dispatch for book skills stays blocked. "Request AI draft" creates a *task*, never dispatches generation.
- Version/checksum invalidation: content changes after approval invalidate dependent proofs/packets.
- Canvas sync-back never clobbers chapters/pages with status `edited`/`approved` (`lib/creative-canvas/book-bridge.ts`) — this guard now also protects client edits.
- KDP categories and Google genres are **separate channel-specific fields**; never flatten one into the other.
- Chapter body stays markdown with the ≤900KB guard (ai-story non-port rule: no large manuscripts in ordinary records).
- No single "generate whole book and mark ready" wizard action.

## Architecture Overview

```
Admin index ──┐
              ├─ NewBookDialog (format picker + template presets)
Portal page ──┘         │
                        ▼
        BookProjectWorkspace (SHARED, capability-projected)
        ├── Content tab    → ChapterEditor (TipTap) | PagesPanel
        ├── Metadata tab   → + KDP categories / Google genres pickers
        ├── Research tab   → bridgeLinks list + link/request actions   (NEW)
        └── Assembly tab   → operator-only (portal sees gate status)
```

One workspace component, two mounts. A `BookStudioCapabilities` object — computed server-side from `modulePolicies` for portal users, and all-true for platform admins — decides which actions render.

## 1. Capabilities

**New file: `lib/book-studio/capabilities.ts`**

```ts
export interface BookStudioCapabilities {
  canView: boolean          // action 'visibility'
  canCreate: boolean        // action 'create'
  canEdit: boolean          // action 'edit'  (chapters, pages, metadata, briefs)
  canEvidenceRights: boolean// action 'evidenceRights' (research/rights links)
  canApprovalGates: boolean // action 'approvalGates'
  canPublishingPackets: boolean // action 'publishingPackets'
  canArchiveDelete: boolean // action 'archiveDelete'
  isOperator: boolean       // platform admin: canvas, assemble, puzzles, everything
}

export function resolveBookStudioCapabilities(orgSettings: unknown, role: unknown, isOperator: boolean): BookStudioCapabilities
```

- Implementation delegates to `canRolePerformModuleAction(policies, 'bookStudio', action, role)` from `lib/organizations/module-policies.ts`.
- `isOperator: true` (platform admin console) forces every flag true.
- The existing `bookStudioCapabilities()` helper inside `app/api/v1/portal/book-studio/route.ts` (lines ~74–76) is replaced by this shared module.

**Server enforcement (not just UI):** the generic resource handlers in `lib/book-studio/routes.ts` gain a portal branch. Today they only accept platform-admin / agent-key auth. Add: portal-session auth resolving the caller's org role, then map method → required action:

| Method / route | Required action |
|---|---|
| GET any resource | `visibility` |
| POST `projects` | `create` |
| POST/PATCH `chapters`, `pages`, `briefs`; PATCH `projects` (metadata/title) | `edit` |
| POST/PATCH `artifact-links`, `rights-ledgers` | `evidenceRights` |
| PATCH status → `approved` on chapters/pages; approval-gate mutations | `approvalGates` |
| `publishing-packets`, `package-manifests` reads | `publishingPackets` |
| DELETE any resource | `archiveDelete` |
| `assemble`, `open-in-canvas`, `generate-puzzles` | **operator only — unchanged** |

Portal callers must additionally pass the module switch `isPortalModuleEnabled(org, 'bookStudio')` — same guard the portal GET route already uses.

## 2. Create-book flow ("front door")

**New component: `components/book-studio/NewBookDialog.tsx`**

Two steps:

1. **Format picker.** Cards from `listBookFormats()` (`lib/book-studio/format-registry.ts`), grouped: Text books (story, nonfiction) / Visual books (kids_picture, colouring, comic) / Puzzle books (5 kinds + activity_workbook). Each card shows label, layout type, default trim, and what assembly produces (PDF / PDF+EPUB).
2. **Details.** Title (required), audience (optional, feeds `stylePrompt` seed), trim preset (from `supportedTrims`, default preselected), optional series select (existing series in org, or "New series" inline), optional template preset.

**Template presets:** the governance page's template registry (Non-fiction book, Lead magnet, Case study, Playbook, Publishing packet + org custom templates from `modulePolicies.bookStudio.customItems`) maps to prefills — format + a starter chapter/page scaffold:

```ts
// lib/book-studio/templates.ts
export interface BookTemplatePreset {
  id: string            // 'nonfiction_book' | 'lead_magnet' | 'case_study' | 'playbook' | 'publishing_packet'
  label: string
  format: BookFormatId
  starterChapters?: { title: string }[]   // created as draft chapters after project create
  starterPages?: { kind: BookPageKind; title: string }[]
}
```

Lead magnet → `nonfiction` + chapters ["Hook", "Problem", "Framework", "Next step"]. Case study → `nonfiction` + ["Client context", "Challenge", "Approach", "Results", "Proof"]. Playbook → `nonfiction` + ["Overview", "Process", "Checklists"]. Publishing packet template creates a project with no starter content but `stage: 'publishing_packet'`. Custom org templates create with no scaffold (their `description` becomes the project `safeSummary`).

On submit: `POST /api/v1/book-studio/projects` with `{ title, format, trim: { presetId }, seriesId?, stylePrompt? }`, then batch-create starter chapters/pages, then navigate to the workspace.

**Mount points:**
- Admin index: `app/(admin)/admin/org/[slug]/book-studio/page.tsx` currently renders `AdminBookStudioGovernanceWorkspace` only. Restructure it into two tabs: **"Projects" (new default)** — live "New book" button + project list (title, format label, stage, updatedAt, cover thumbnail) linking to `/admin/org/[slug]/book-studio/[bookId]` — and **"Governance"** — the existing `AdminBookStudioGovernanceWorkspace` content, unchanged. The old always-disabled "Create book project gated" button is deleted.
- Portal: "New book" button on the portal Book Studio page, rendered only when `capabilities.canCreate`.

## 3. Shared workspace, capability-projected

`BookProjectWorkspace` gains a `capabilities: BookStudioCapabilities` prop (admin mounts pass all-true).

**New portal route + page:** `app/(portal)/portal/book-studio/[bookId]/page.tsx` mounting the same workspace with server-resolved capabilities.

Projection rules:

| Surface | Operator | Portal w/ `edit` | Portal w/o `edit` |
|---|---|---|---|
| Chapter/page editing, add, reorder | ✅ | ✅ | read-only |
| Status → `approved` | ✅ | only if `approvalGates` | ✗ |
| Metadata (incl. categories) | ✅ | ✅ | read-only |
| Open in canvas / puzzles / Assemble | ✅ | hidden → "Request AI draft" / gate-status card | hidden |
| Research tab | ✅ | if `evidenceRights` (link/request) else read-only | read list only |
| Delete project/chapter/page | ✅ | only if `archiveDelete` | ✗ |
| Manifest downloads | ✅ | if `publishingPackets` | ✗ |

**"Request AI draft" (portal):** button on a chapter/page → `POST /api/v1/book-studio/projects/[id]/request-draft` `{ unitType: 'chapter'|'page'|'cover', unitId?, note? }` → creates a platform task (existing tasks API) assigned to the org's PiB team, tagged `book-studio`, linking the project/unit, and writes a `book_studio_decision_logs` entry. No generation dispatch. Idempotency: reject when an open request for the same unit exists (409).

## 4. Chapter editor (TipTap)

**New: `components/book-studio/project/ChapterEditor.tsx`**, patterned on `components/blog-editor/BlogEditor.tsx` (TipTap v3 + `tiptap-markdown` round-trip — deps already installed).

- StarterKit + Placeholder + Link + Markdown extensions; stored format stays markdown (`chapter.body`), same PATCH endpoint, 900KB guard untouched.
- Toolbar: H1–H3, bold, italic, lists, blockquote, horizontal rule, undo/redo.
- **Layout:** left sidebar = chapter list (order, title, word count, status chip; drag-reorder writes `order` via the existing swap-PATCH pattern; "Add chapter" at bottom). Main pane = editor for the selected chapter.
- **Autosave:** debounce 2s after last keystroke + save on blur/chapter-switch. Saving a `generated` chapter auto-transitions it to `edited` (this engages the canvas anti-clobber guard). Dirty indicator + "Saved" tick.
- Word count per chapter + project total (sum) in the sidebar footer; write `wordCount` on save (field already whitelisted).
- **Trim-aware preview toggle:** render the markdown into a page-shaped container using the trim preset's aspect ratio and an approximate chars-per-page estimate from `lib/book-studio/trim.ts` geometry — an approximation for authors, clearly labeled "approximate"; assembly remains the source of truth.
- Status control (draft/edited/approved) stays; `approved` requires `approvalGates` capability.

`BookProjectChaptersPanel.tsx` is replaced by this editor (keep the file name or rename — preserve the existing test suite `book-studio-project-workspace.test.tsx` expectations by updating them alongside).

## 5. Categories & genres

**New: `lib/book-studio/taxonomy.ts`** — static data, no API calls:

```ts
export interface BookCategoryOption { code: string; label: string; path: string[] }
export const KDP_CATEGORIES: BookCategoryOption[]   // curated BISAC-style subset (~150 entries covering the pilot families: business, self-help, children's, fiction genres, games/activity)
export const GOOGLE_GENRES: BookCategoryOption[]    // curated Google Play Books genre subset
```

Start curated, not exhaustive — a JSON-backed list we can grow. Codes are stable identifiers (BISAC codes where applicable, e.g. `BUS063000`).

**Metadata extension** (`BookProjectMetadata` in `components/book-studio/project/types.ts` + whitelist in `lib/book-studio/sanitize.ts`):

```ts
kdpCategories?: string[]   // max 3 codes — KDP allows 3 via support, 2 self-serve; UI caps at 3 and warns past 2
kdpKeywords?: string[]     // max 7, per KDP
googleGenres?: string[]    // max 3 codes
```

Sanitizer: `cleanStringArray` + length caps + codes validated against the taxonomy (unknown codes dropped).

**UI:** `BookProjectMetadataPanel` gains a "Store listing" section — two searchable multi-select pickers (grouped by top-level path) + keywords chips input. Channel-specific, side by side, never merged. EPUB assembly (`lib/book-studio/assembly/epub.ts`) may map the first Google genre into OPF `<dc:subject>`; everything else is listing-packet data for the manual upload.

## 6. Research tab

**New: `components/book-studio/project/BookProjectResearchPanel.tsx`** — fourth tab "Research" in the workspace.

- Lists `project.bridgeLinks[]` filtered to types `research` and `evidence`: label, status, `requiredForApproval` badge, href out-link.
- **Link existing research** (needs `evidenceRights`): modal searching the org's Research items (existing research API), appends `{ type: 'research', label, ref, href }` to `bridgeLinks` via PATCH project. `bridgeLinks` is already sanitized (`sanitizeBridgeLinks`).
- **Request research** (needs `evidenceRights`): creates a platform task like request-draft (`unitType: 'research'`).
- Operator extra: toggle `requiredForApproval` per link.
- No Hermes dispatch; the panel is a viewer/linker over existing records.

## 7. Portal listing hygiene

In `app/api/v1/portal/book-studio/route.ts` and the portal list page:

- Exclude soft-deleted projects (already done) **and** projects titled with QA markers only as a stopgap — the real fix: add `isFixture?: boolean` to projects (whitelisted, settable only by operator/agent), set it on QA/smoke fixtures, and filter `isFixture !== true` from the portal query. Backfill: one-off script marks the existing fixtures ("QA Book — Creative Canvas Phase 3", "Untitled canvas", "Book: QA Round2 - Book Board Test 2 (repro)", "Book: Prod smoke 2026-07-03") in the production org.
- The portal list becomes the org's project list (cover thumb, title, format, stage, own "Continue writing" link when `canEdit`) instead of only packet-review cards. Packet/gate review cards remain within the project page (Assembly/gates area) for roles with those capabilities.
- The "Manual release posture" banner and the three disabled-action buttons stay — they truthfully describe generation/publishing governance — but move below the project list and drop from 3 cards to one compact note.

## 8. Series completion

In `BookSeriesWorkspace`:

- **Create next volume:** button → creates a project copying `format`, `trim`, `stylePrompt`, `sharedMetadata` (author/imprint/keywords/categories), sets `seriesId`, `seriesVolumeNumber = max + 1`, appends to `volumeOrder`, navigates to it. Reuses the create endpoint; no new API.
- Volume list renders order with up/down reorder writing `volumeOrder`.
- Portal: series visible read-only when `visibility`; create-next-volume requires `create`.

## 9. Publishing-house essentials

Gap analysis against a real publishing house (Peet, 2026-07-06) added four structural items. The book → marketing "Launch Bridge" was deliberately split into its own follow-up spec (`2026-07-06-book-launch-bridge-outline.md`).

### 9.1 ISBN per format

Print and ebook editions legally require separate ISBNs; a single `isbn` field is wrong.

- `BookProjectMetadata`: replace `isbn` with `isbnPrint?: string` and `isbnEbook?: string`. Legacy migration: when loading a project with `isbn` set and both new fields empty, prefill `isbnPrint` in the panel; on save, write the new fields (leave `isbn` untouched for old records — readers fall back `isbnPrint ?? isbn`).
- Sanitizer: whitelist both; validate shape (10 or 13 chars after stripping hyphens, 13-digit form must start `978`/`979`). Invalid → drop with a 400 field error, not silent.
- Assembly: `epub.ts` OPF identifier uses `isbnEbook ?? isbn`; `interior-pdf.ts` copyright page lists each edition's ISBN when present.
- Metadata panel: two inputs with helper text — "Leave blank to use the store-assigned identifier (KDP assigns a free ASIN/ISBN)."

### 9.2 Front & back matter (reflowable formats)

Project-level config (whitelisted in `sanitize.ts`, rendered by `interior-pdf.ts` and `epub.ts`):

```ts
frontMatter?: {
  dedication?: string        // ≤2KB plain text
  tocEnabled?: boolean       // default true for nonfiction, false for story
  forewordChapterId?: string // marks an existing chapter as foreword (renders before Chapter 1, unnumbered)
}
backMatter?: {
  aboutTheAuthor?: string    // ≤8KB markdown
  alsoByEnabled?: boolean    // auto-renders series volume list when seriesId is set
}
```

Render order: title page → copyright → dedication → TOC → foreword → chapters → about the author → also-by. EPUB nav already exists; the interior PDF gains an optional TOC page (chapter titles + page numbers, computed after pagination). Metadata panel gains a "Book matter" section.

### 9.3 Editorial review comments

A publisher runs developmental edit → copyedit → proofread with margin notes. V1 approximation without track-changes: reuse the platform's existing unified-comments primitives (same collection/API used by tasks/docs — see platform collaboration primitives) targeting `book_studio_chapters/{id}`.

- ChapterEditor: comment drawer per chapter (thread list, add, resolve); unresolved-count chip on the chapter in the sidebar.
- Permissions: `edit` capability to comment and resolve; read-only roles see threads.
- No inline text anchoring in V1 — one thread per chapter. Track-changes is explicitly future scope.

### 9.4 Pricing & territories on the publishing packet

Surface what the packet gates already demand, so the manual-upload packet is complete:

- `book_studio_publishing_packets` records gain (sanitizer-whitelisted): `channelPricing?: Array<{ channel: 'kdp' | 'google_play_books'; listPrice: number; currency: string; territories: 'world' | 'selected'; territoryNotes?: string }>`.
- Assembly tab (operator, and portal roles with `publishingPackets`): read/edit pricing card per channel next to the manifest. Channel-specific, never merged (same locked rule as categories).
- Pure packet data for the human upload — no store mutation.

## 10. API summary (new/changed)

| Route | Change |
|---|---|
| `lib/book-studio/routes.ts` generic handlers | + portal-session auth branch with capability mapping (Section 1) |
| `POST /api/v1/book-studio/projects/[id]/request-draft` | NEW — task-creating request (Section 3) |
| `GET /api/v1/portal/book-studio` | swap inline capability helper for shared module; fixture filter; return full capability set |
| `PATCH projects` | accepts new metadata fields + `isFixture` (operator/agent only) |
| assemble / open-in-canvas / generate-puzzles | unchanged, operator-only |

## 11. Testing

- **Capabilities unit tests:** matrix of role × action → allowed/denied, incl. operator override and module-disabled short-circuit.
- **Route enforcement:** portal session with `edit` can PATCH chapter body; without `edit` gets 403; `approved` status flip requires `approvalGates`; DELETE requires `archiveDelete`; assemble as portal user → 403 always.
- **NewBookDialog:** creates project + starter scaffold per template; format registry drives trim options.
- **ChapterEditor:** markdown round-trip (load → edit → save produces valid markdown), autosave debounce, `generated`→`edited` auto-transition, word-count write.
- **Taxonomy:** sanitizer drops unknown codes, enforces caps (3/7/3).
- **Research panel:** link append preserves existing bridgeLinks; request-research 409 on duplicate open request.
- **Portal hygiene:** `isFixture` projects excluded from portal list, still visible in admin.
- **Series:** next volume inherits format/trim/style/sharedMetadata and increments volume number.
- **ISBN:** shape validation (valid 10/13 accepted, junk rejected with field error), legacy `isbn` fallback in EPUB OPF, copyright page renders per-edition ISBNs.
- **Front/back matter:** render order in interior PDF and EPUB (dedication/TOC/foreword/about/also-by), length guards enforced, also-by lists series volumes.
- **Comments:** thread create/resolve on a chapter, unresolved count, read-only role sees but cannot post.
- **Pricing:** channelPricing sanitized (channel enum, positive price, currency code), rendered per channel in Assembly tab.
- Update existing suites: `book-studio-project-workspace.test.tsx`, `portal-book-studio.test.ts`, `book-studio-admin-command-center.test.tsx`.
- Live QA on :3010 before push: create book from portal member account → write chapter → request AI draft (task appears) → operator opens canvas → sync-back respects `edited` → assemble → portal sees manifest per capability.

## 12. Build order (each slice ships working)

1. Capabilities module + route enforcement + portal-session auth branch (foundation; no UI change).
2. NewBookDialog + templates + admin index project list (front door, admin first).
3. Portal project page mount + capability projection + request-draft route.
4. ChapterEditor (TipTap).
5. Taxonomy + metadata panel store-listing section.
6. Publishing-house metadata: ISBN split + front/back matter (data, sanitizers, assembly, panel) + packet pricing card.
7. Editorial comments on chapters.
8. Research tab.
9. Portal listing hygiene + fixture backfill script.
10. Series create-next-volume + reorder.
11. Skills/docs: update `platform-ops`/`client-manager` skill references + wiki article + this spec marked implemented.

## Out of scope (unchanged / future)

- Direct store publishing, marketplace credentials (locked out).
- Client-triggered AI generation (revisit after operator flow proves out).
- Hermes runtime dispatch for book skills.
- Collaborative real-time editing, track changes, inline-anchored comments (chapter-level threads ARE in scope, Section 9.3).
- Book Launch Bridge (book → campaign/landing page/email/social repurposing) — own follow-up spec: `2026-07-06-book-launch-bridge-outline.md`.
- Typography/interior style presets, ONIX export, ARC/review-copy management — revisit once books ship monthly.
- Fixed-layout EPUB, audiobooks, additional puzzle kinds (already tracked in the 2026-07-05 spec's phase 2).
