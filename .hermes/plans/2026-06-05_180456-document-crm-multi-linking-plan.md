# Document, Project, Company, and Contact Linking Plan

## Goal

Let Peet work inside a document and naturally tag/link CRM contacts and companies, while also allowing documents, projects, and other operational records to be linked to multiple companies and multiple contacts. The design must preserve tenant safety, client organisation visibility, and the current PiB source/recipient model.

## Current context

- Documents already have a `linked` object, but it is mostly single-link oriented:
  - `lib/client-documents/types.ts`: `ClientDocumentLinkSet` supports `companyId`, `clientOrgId`, `projectId`, `dealId`, etc.
  - `lib/client-documents/linkedValidation.ts` only allows a fixed set of scalar string fields and a few array fields (`socialPostIds`, `geoTaskIds`, `researchItemIds`).
- Projects already have richer source/recipient CRM fields, but still scalar for company/contact:
  - `lib/projects/types.ts`: `companyId`, `contactId`, `sourceCompanyId`, `sourceContactId`, `recipientOrgId`, `clientOrgId`, etc.
  - `app/api/v1/projects/route.ts` creates PiB-sourced projects and claimable CRM project shares from a single `companyId` / `contactId` target.
- Contacts and companies are tenant-scoped CRM records:
  - `lib/crm/types.ts`: contacts have `orgId`, `companyId`, `linkedOrgId`, `linkedUserId`, tags, agreement roles.
  - Companies can link to client organisations through `linkedOrgId` based on existing document/project behavior.
- There is already a reusable context-reference system:
  - `lib/context-references/types.ts` supports `contact`, `company`, `project`, `task`, `document`, `research`, `social`, `campaign`, `email`, `support`.
  - Document comments and replies already use `ContextReferencePicker` and `ContextReferenceChips` in `components/client-documents/DocumentReviewRail.tsx`.
  - Inline comments also use `ContextReferencePicker` in `components/inline-comments/CommentComposer.tsx`.
- Plain text mention notifications currently parse only `@user:<id>` and `@agent:<id>` in `lib/comments/mentions.ts`. They do not parse `@contact:` or `@company:` because CRM tags should be context links, not notifications.

## Product answer

Yes: in-document tagging should be supported, but as two separate concepts:

1. People/team mentions
   - `@user` and `@agent` notify people/agents.
   - Existing mention notification behavior should remain.

2. CRM/entity tags
   - `@contact` and `@company` should attach context to the document/comment/block and make the document discoverable from those CRM records.
   - CRM tags should not notify the contact/company. They are internal references.

For multi-company and multi-contact linking, the canonical model should become many-to-many, with a primary link retained for backward compatibility.

## Recommended data model

### 1. Expand document links without breaking old records

Update `ClientDocumentLinkSet` to support both primary and many-to-many fields:

- Keep existing scalar fields:
  - `companyId?: string`
  - `clientOrgId?: string`
  - `projectId?: string`
  - `dealId?: string`
- Add array fields:
  - `companyIds?: string[]`
  - `contactIds?: string[]`
  - `clientOrgIds?: string[]`
  - `projectIds?: string[]`
  - `dealIds?: string[]`

Rules:
- `companyId` remains the primary company for old views, default CRM tab placement, and compatibility.
- `companyIds` includes the primary company plus any additional companies.
- `contactIds` links all relevant CRM contacts.
- `clientOrgId` remains the primary linked organisation for current client visibility behavior.
- `clientOrgIds` enables multi-org visibility only where explicitly allowed.
- On write, normalize arrays: dedupe, trim, cap length, and ensure primary scalar appears in its array.

### 2. Add a reusable cross-resource link envelope

Introduce a small reusable type, likely under `lib/resource-links/types.ts`:

- `resourceType`: `document | project | task | research | campaign | social | email | invoice | quote | support`
- `resourceId`
- `orgId`: source/owner org
- `linkedCompanyIds: string[]`
- `linkedContactIds: string[]`
- `linkedOrgIds: string[]`
- `primaryCompanyId?: string`
- `primaryContactId?: string`
- `primaryOrgId?: string`
- `visibility`: `internal | client_visible | shared | public`
- `createdAt`, `updatedAt`, `updatedBy`, `updatedByType`

This can be embedded on records first, then later indexed into a `resource_links` collection if global reverse lookup/search needs to be faster.

### 3. Apply the same pattern to projects

Extend `Project`:

- Keep `companyId`, `contactId`, `sourceCompanyId`, `sourceContactId`.
- Add `companyIds?: string[]`, `contactIds?: string[]`, `sourceCompanyIds?: string[]`, `sourceContactIds?: string[]`, `recipientOrgIds?: string[]`.
- Keep current claim/share behavior tied to a primary company/contact to avoid ambiguity.
- Let additional companies/contacts be relationship links, not claim-token targets unless a user explicitly creates multiple invitations.

### 4. Context refs remain the UI transport

Use `ContextReference[]` for in-document block/comment tagging:

- `type: 'contact'`, `id: contactId`
- `type: 'company'`, `id: companyId`
- `orgId`: owning CRM org
- `label`: display name
- `href`: admin/portal route
- `metadata`: optional `companyId`, `linkedOrgId`, role, email, etc.

Context refs are ideal for block/comment-level references. Record-level `linked.*Ids` are the canonical searchable links.

## UX plan

### In document editor/viewer

Add a relationships panel near document settings/share:

- Primary company
- Additional companies
- Primary contact
- Additional contacts
- Linked organisation(s)
- Linked project(s)
- Linked deal(s)

Use the existing `ContextReferencePicker` or a focused CRM picker.

### In document comments/review rail

Already close to done:

- Comments/replies support context refs through `ContextReferencePicker`.
- Improve picker copy for documents: “Link contact, company, project, or task”.
- Ensure the selected contact/company refs are also optionally promoted to document-level links if the user chooses “also link to document”.

### In document body blocks

Add block-level references:

- Allow blocks to carry `contextRefs?: ContextReference[]` or add a new `DocumentBlockLinkSet`.
- In the block toolbar: “Link CRM context”.
- Show chips under/above the block, not inline in client-visible copy by default.
- For true inline rich text tagging later, store entity marks in the editor model rather than relying on raw `@company` text.

### CRM company/contact pages

Update Documents and Projects panels to show records where:

- `linked.companyId === companyId`, OR
- `linked.companyIds` contains companyId, OR
- legacy project `companyId/sourceCompanyId === companyId`, OR
- new project arrays contain companyId.

Contact pages should similarly show records where `contactId/sourceContactId` matches or arrays contain the contact.

### Client organisation visibility

Do not automatically expose a document to every company/contact link.

Visibility rules:
- Internal CRM links: safe by default, visible only to PiB/admin agents.
- Client-visible document: still requires status `client_review`, `changes_requested`, `approved`, or `accepted` plus explicit `linked.clientOrgId` / `linked.clientOrgIds` visibility.
- Multi-company links can include non-client CRM businesses without making the document visible to them.
- Multi-org document visibility must be explicit and show a warning before publish: “This document will be visible to N linked organisations.”

## API implementation plan

### Phase 1: schema and validators

Files likely to change:

- `lib/client-documents/types.ts`
- `lib/client-documents/linkedValidation.ts`
- `lib/projects/types.ts`
- `app/api/v1/client-documents/route.ts`
- `app/api/v1/client-documents/[id]/route.ts`
- `app/api/v1/projects/route.ts`
- `app/api/v1/projects/[projectId]/route.ts`

Tasks:

1. Add array fields to document/project types.
2. Update validators to allow `companyIds`, `contactIds`, `clientOrgIds`, `projectIds`, `dealIds`.
3. Add normalization helper:
   - trim strings
   - dedupe arrays
   - cap arrays, e.g. max 50 contacts/companies per record
   - ensure scalar primary is included in the related array
   - reject cross-org CRM IDs unless the user has access and the relationship is allowed
4. Keep all old scalar fields readable and writable.

### Phase 2: read/query behavior

Files likely to change:

- document list APIs
- company detail document/project panel APIs/components
- contact detail panel APIs/components
- project reporting APIs if needed

Tasks:

1. Update reverse lookup filters to include both scalar and array links.
2. Avoid new composite-index-sensitive Firestore queries. Prefer tenant-scoped reads plus in-memory matching where list sizes are bounded, matching existing PiB index-safe patterns.
3. Add helper functions:
   - `documentLinksCompany(doc, companyId)`
   - `documentLinksContact(doc, contactId)`
   - `projectLinksCompany(project, companyId)`
   - `projectLinksContact(project, contactId)`

### Phase 3: UI relationship editing

Files likely to change:

- admin document detail/editor components
- `components/client-documents/DocumentReviewRail.tsx`
- `components/context-references/*`
- CRM company/contact detail panels
- project settings/access components

Tasks:

1. Add relationship panel to document editor.
2. Add multi-select contact/company picker.
3. Show linked chips on document header/admin metadata.
4. Add “also link to document” option from comment context refs.
5. Add company/contact Documents and Projects panel support for multi-link matches.

### Phase 4: block-level context refs

Files likely to change:

- `lib/client-documents/types.ts`
- document editor block components
- document renderer/admin preview components
- document version route validation if block schema is validated there

Tasks:

1. Add `contextRefs?: ContextReference[]` to `DocumentBlock`.
2. Add validation/sanitization on document version creation.
3. Render admin-visible chips on blocks.
4. Decide whether block-level chips are hidden, internal-only, or client-visible per block.

### Phase 5: migration/backfill

Add script:

- `scripts/backfill-document-project-multi-links.ts`

Backfill rules:

- For documents: if `linked.companyId` exists and `linked.companyIds` missing, set `companyIds: [companyId]`.
- If `linked.clientOrgId` exists and `linked.clientOrgIds` missing, set `clientOrgIds: [clientOrgId]`.
- For projects: mirror scalar `companyId/contactId/sourceCompanyId/sourceContactId` into arrays.
- Dry-run first. Write only after Peet approval because it mutates live data.

## Tagging behavior details

### Recommended autocomplete behavior

In a document/comment editor:

- `@peet` or `@agent:theo` should resolve to user/agent mentions and notify.
- `@contact:John` or picker search “John” should attach a contact context ref.
- `@company:Acme` or picker search “Acme” should attach a company context ref.
- Plain `@Acme` should show grouped suggestions: people, agents, contacts, companies.

### Notification rules

- User/agent mentions notify through existing notification system.
- Contact/company tags do not notify external people or client users by default.
- If a tagged contact is linked to a portal user and the doc is client-visible, still do not notify unless Peet explicitly uses a client-send/share action.

## Things beyond documents/projects that should also support multi-linking

Priority order:

1. Tasks
   - Already support `contactId`, `dealId`, `projectId`, `contextRefs`.
   - Add `companyIds/contactIds` or rely on context refs plus standalone task fields.

2. Research items
   - Already have `linked` and comments with context refs.
   - Add `companyIds/contactIds` to research links so research can power CRM account intelligence.

3. Social campaigns/posts
   - For acquisition/prospecting, link content packs to multiple target companies and contacts internally.
   - Must remain approval-gated before public publishing/prospect-visible use.

4. Emails/mailbox threads
   - Link operational email threads to multiple contacts/companies where threads involve more than one stakeholder.
   - Sending remains separately approval/delegation gated.

5. Quotes/invoices/deals
   - Usually need one legal buyer, but should support additional stakeholder contacts and related companies for complex groups/franchises.
   - Keep finance/legal primary entity explicit.

6. Support tickets
   - Useful when one issue affects multiple companies/orgs or multiple contacts at the client.

## Tests and validation

Focused tests to add/update:

- `__tests__/api/v1/client-documents/client-documents.test.ts`
  - accepts `linked.companyIds/contactIds/clientOrgIds`
  - rejects non-string arrays
  - normalizes scalar + array fields
  - preserves old scalar behavior
- company/contact detail tests
  - Documents tab includes array-linked documents
  - Projects tab includes array-linked projects
  - archived filters still work
- project API tests
  - create/update normalizes primary and array links
  - claimable project still uses only primary target
- context-reference tests
  - contact/company context refs attach safely to document comments/replies
  - no notifications are created for CRM entity refs
- visibility tests
  - client org only sees documents with explicit `clientOrgId/clientOrgIds` and client-visible status
  - internal-only linked CRM documents stay hidden from portal users

Verification commands:

- Targeted Jest for document APIs and CRM/project panels.
- Targeted ESLint for changed files.
- `NODE_OPTIONS=--max-old-space-size=8192 npm run build` before final commit.

## Risks and tradeoffs

- Firestore array-contains queries across many filters can become index-heavy. Prefer tenant-scoped reads and in-memory filtering for first version unless a dedicated `resource_links` index collection is introduced.
- Multi-org visibility is sensitive. Do not infer portal visibility from company/contact tags.
- Inline rich text entity tagging is more complex than chips/context refs. Ship record/block/comment context refs first; inline marks can come later.
- Backfill touches live data and needs explicit approval.
- Finance/legal records should retain one primary buyer/signatory even if multiple contacts/companies are linked.

## Recommended rollout

1. Ship schema/validator/read compatibility.
2. Add admin document relationship panel and CRM reverse lookup panels.
3. Add project multi-link fields and project panels.
4. Add block-level context refs.
5. Backfill existing scalar links into arrays after approval.
6. Later, introduce a `resource_links` index collection if search/global reverse lookup becomes slow.

## Open questions for Peet

1. Should multi-org document visibility be allowed at all in V1, or should multiple companies/contacts be internal-only while portal visibility remains one client org?
2. Should contact/company tags inside client-visible documents render to the client, or stay admin/internal metadata only?
3. Should tagging a contact who is also a portal user ever notify them automatically, or should notification always require an explicit share/send action?
4. What cap feels right for linked companies/contacts per document/project: 20, 50, or unlimited with pagination?
