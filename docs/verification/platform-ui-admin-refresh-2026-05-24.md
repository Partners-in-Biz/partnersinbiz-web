# Platform UI unification — Phase 3 admin refresh notes

Task: 1yiFosiZZ8oE2yg08g8v
Spec: bznoeQWZqhne52ZTZrEC / i7DTI21kAM4jO5FqxHfZ

## Representative before/after notes

### Admin workspace dashboard
Before: custom inline workspace header, mixed `pib-card` sections, and module sections that did not explicitly use the shared PageHeader/Surface primitives introduced in Phase 2.
After: dashboard header now uses `PageHeader`; project, social status, analytics, and quick-action sections use `Surface` while preserving the same fetches and links.

### Projects landing
Before: local header markup and a one-off new-project form card.
After: projects list/board landing uses shared `PageHeader` and `Surface` for the create-project form. Existing Firestore/REST merge, filters, board/list view controls, permissions, and task update flows are unchanged.

### Client documents
Before: hand-rolled header and bespoke status tabs using `bento-card` styling.
After: documents landing uses shared `PageHeader` and the shared `pib-tabs`/`pib-tab` visual grammar with counts preserved for each status filter. Document data flow and delete callback are unchanged.

### Billing
Before: local header, raw table card, ad-hoc invoice status badges, and a custom empty state.
After: billing uses shared `PageHeader`, `Surface` table shell, `StatusPill`, and `EmptyState` while preserving organization lookup, invoice fetching, PDF links, and invoice creation links.

## Route audit notes for requested surfaces

Covered in this chunk:
- Dashboard/org workspace: `app/(admin)/admin/org/[slug]/dashboard/page.tsx`
- Projects landing: `app/(admin)/admin/org/[slug]/projects/page.tsx`
- Client documents: `app/(admin)/admin/org/[slug]/documents/page.tsx`
- Billing: `app/(admin)/admin/org/[slug]/billing/page.tsx`

Already aligned or deferred for separate chunks:
- Project detail/Kanban pages are the current visual baseline and were not refactored in this chunk.
- Research/social pages already use `OrgThemedFrame` and deeper module clients; broad rewrites are better handled in module-specific follow-up chunks to keep data flows safe.
- CRM/deals and properties org routes were not present under `app/(admin)/admin/org/[slug]` in this worktree, so there was no route to refresh in this chunk.
- Settings is present but broad and form-heavy; it should be handled separately to avoid mixing workspace-folder and billing-form risk into this visual chunk.

## Verification commands

- `npx jest --selectProjects jsdom --runTestsByPath __tests__/app/admin-route-visual-system.test.tsx __tests__/components/ui/app-foundation.test.tsx`
- `npx jest --selectProjects jsdom --runTestsByPath __tests__/app/admin-client-projects-board.test.tsx __tests__/app/admin-documents-new.test.tsx __tests__/app/admin-settings-notification-preferences.test.tsx`
- Final Next build result is recorded in the Kanban output.
