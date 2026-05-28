# Platform-Owned Client Document Links Design

Date: 2026-05-28
Status: Approved direction; implementation pending

## Context

Many polished client documents were created by `pib-platform-owner`. That source ownership is correct: Partners in Biz created the documents, so their primary `client_documents.orgId` should remain the platform owner org.

The missing relationship is that those documents must also be connected to:

- the CRM company record that represents the client inside the platform-owner CRM, and
- the linked client organisation that should see client-visible versions in its portal.

CRM companies already support this model through `companies.orgId = pib-platform-owner` and `companies.linkedOrgId = <client organisation id>`.

## Decisions

1. Do not move PiB-created documents into the client org.
2. Add relationship fields to `client_documents.linked`:
   - `companyId`: the platform-owner CRM company id.
   - `clientOrgId`: the linked client organisation id.
3. Client portal visibility is relationship-based:
   - documents owned by the active client org still show as before.
   - documents owned by `pib-platform-owner` also show when `linked.clientOrgId` matches the active client org and the status is client-visible.
4. Internal statuses remain internal:
   - `internal_draft` and `internal_review` must not appear in the client portal.
   - `client_review`, `changes_requested`, `approved`, and `accepted` are client-visible.
5. Historical repair must be reviewable before writes:
   - the backfill runs dry-run by default.
   - commit mode writes only after the dry-run report is checked.

## Data Model

Extend `ClientDocumentLinkSet`:

```ts
export interface ClientDocumentLinkSet {
  companyId?: string
  clientOrgId?: string
  projectId?: string
  campaignId?: string
  reportId?: string
  dealId?: string
  seoSprintId?: string
  geoWorkspaceId?: string
  geoAuditId?: string
  geoTaskIds?: string[]
  researchItemIds?: string[]
  socialPostIds?: string[]
  invoiceId?: string
}
```

For a PiB-created document linked to a client:

```ts
{
  orgId: "pib-platform-owner",
  linked: {
    companyId: "<companies doc owned by pib-platform-owner>",
    clientOrgId: "<organizations doc for the client>"
  }
}
```

`companies.linkedOrgId` remains the canonical CRM-to-client-org relationship. The document fields are denormalized links for filtering, rendering, and backfill safety.

## API And Query Behaviour

`POST /api/v1/client-documents` and `PATCH /api/v1/client-documents/[id]` should accept `linked.companyId` and `linked.clientOrgId`.

Validation should ensure:

- both fields are strings when supplied,
- if `companyId` is supplied, the company exists and belongs to the document source org,
- if `clientOrgId` is supplied, the organisation exists and is active,
- for platform-owned docs, `company.linkedOrgId` should match `linked.clientOrgId` when both are present.

`GET /api/v1/client-documents` should stay index-safe by using small equality queries and in-memory merge/filtering:

- source-owned query: `orgId == activeOrgId`
- platform-linked query: `orgId == platformOwnerOrgId`
- merge, de-duplicate by document id, then filter platform-linked rows in memory by `linked.clientOrgId == activeOrgId`

The portal page already filters to client-visible statuses. The API may return a broader set for admin clients, but portal rendering must preserve the current client-visible status filter.

Admin selected-client document views should include both:

- documents owned directly by the client org, and
- PiB-owned documents linked to that client org.

## Backfill

Add a dry-run-first script, for example:

```bash
npx tsx scripts/backfill-platform-client-document-links.ts
npx tsx scripts/backfill-platform-client-document-links.ts --commit
```

The script should:

1. Resolve the platform owner org id from `organizations.type == "platform_owner"` with fallback `pib-platform-owner`.
2. Load platform-owned CRM companies where `linkedOrgId` is present.
3. Load `client_documents` where `orgId == platformOwnerOrgId`.
4. Skip documents already carrying both `linked.companyId` and `linked.clientOrgId`.
5. Match in this order:
   - existing linked work object that can resolve to a company or client org,
   - exact client/company name in title,
   - normalized client domain/name hints from the linked company record.
6. Output a CSV report under `scripts/crm-backfill-reports/` with action, confidence, document id, title, company id, client org id, and reason.
7. In commit mode, write only high-confidence matches and leave ambiguous rows as `review_required`.

No apply-mode migration should be run without a reviewed dry-run report.

## UI

Admin document cards should make the relationship visible:

- client organisation name,
- CRM company name,
- linked status such as `Linked to CRM company` or `Standalone`.

CRM company detail should surface related client documents in the command center/documents area, using `linked.companyId == company.id` or `linked.clientOrgId == company.linkedOrgId`.

Client portal documents should not show source ownership noise. A PiB-owned linked document should read like a normal shared document for that client.

## Testing

Focused tests should cover:

- `ClientDocumentLinkSet` validation accepts `companyId` and `clientOrgId`.
- invalid linked fields still fail.
- portal/client document listing includes platform-owned docs linked to the active client org.
- portal/client listing excludes unrelated platform-owned docs.
- internal statuses are not rendered in the client portal.
- admin selected-client document view includes linked PiB-owned documents.
- the backfill planner matches high-confidence rows and refuses ambiguous rows.

## Rollout

1. Implement schema/type validation and API query behaviour.
2. Add UI relationship labels on admin document surfaces.
3. Add and test the dry-run backfill script.
4. Run dry-run only and review the report.
5. Run commit mode only after Peet approves the dry-run result.
6. Re-run focused tests and push to `origin/development`.

