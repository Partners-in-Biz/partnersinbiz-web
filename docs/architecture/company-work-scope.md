/**
 * ADR addendum: Company work scope and client projection
 *
 * Complements docs/architecture/cross-org-access-model.md.
 *
 * Status: Accepted (2026-09-02)
 * Branch: development only — no production promote in this program.
 */

# Company work scope and client projection

## Decision

1. Every organisation-self function is usable on a CRM company (linked or not).
2. When a company is linked, company-scoped work projects to the linked org by default.
3. Per-module relationship toggles live on `PartnerResourceGrant` (`resourceType: company_workspace`, `items[]` = modules).
4. Per-record override: `clientVisibility: 'shared' | 'private'` (unset = shared).
5. Linked org rights: view / comment / approve only. Owner-only ops never cross the boundary.
6. Links are pairwise and non-transitive (A↔B and B↔C never imply A sees C).

## Authority model

- Serving book: record `orgId` = serving org, `companyId` set, optional `clientVisibility`.
- Canonical contract: `PartnerLink` + bilateral `businessRelationships` + directional `PartnerScopeAgreement`.
- Projection authority: one `company_workspace` grant per linked company per direction.
- `linkedOrgId` remains a pointer only; access requires the grant + live link.

## Sanctioned read paths

1. `lib/partner-links/shares.ts` — explicit per-record shares
2. Command-center aggregation
3. **`lib/company-work/projection.ts`** — company workspace projection (this ADR)

## Work scope helpers

Canonical: `lib/work-scope/`. Marketing `lib/social/account-scope.ts` re-exports adapters.
Social **accounts** keep `accountVisibleForWorkspace` (org view does not leak company publish identities).

## Platform staff path

`ensurePlatformCompanyForOrg` mints `partnerLinkId` + `company_workspace` grants
(PiB → client modules on; client → PiB modules off by default).

## Write-back (comment / approve)

Linked-org users never edit serving-org records. Two verbs only, via
`lib/company-work/write-back.ts` and
`POST /api/v1/company-work/shared/[module]/[id]/{comments,approve}`:

- Comments land in the serving org's `comments` collection with
  `resourceType: 'company_work'`, `authorOrgId` = viewer org, and bump
  `clientCommentCount` / `clientLastCommentAt` on the record.
- Approvals write a `clientApproval` envelope (`approved` | `changes_requested`,
  `byOrgId`, `byUid`, `note`, `at`) plus `clientApprovalHistory[]`. The serving
  org's own `approvalState` / `status` fields are never touched — the client
  signal is advisory until the serving org acts on it.
- Both are gated by `decideSharedAction` (grant `actions[]` + live PartnerLink)
  and are refused for `clientVisibility: 'private'` records.

## Migration

`lib/cross-org/migration.ts` plans `backfill_company_workspace_grant` dry-run first.
Unset `clientVisibility` needs no write (defaults to shared).

`scripts/backfill-company-workspace-grants.ts` hydrates linked CRM companies,
active PartnerLinks, existing `company_workspace` grants and
`businessRelationships` from Firestore, runs the pure planner, writes evidence
under `tmp/company-workspace-backfill/`, and only writes with `--commit`.

Planner rules added for the backfill:

- Reciprocal linked pairs (A has a company linked to B **and** B has a company
  linked to A) that predate canonical links get a deterministic
  `PartnerLink` `cw-link:<orgA>:<orgB>` plus two `partnerScopeAgreements`;
  `partnerLinkId` is stamped on both companies.
- One-directional linked companies are skipped and reported, never minted.
- An explicit (even empty) `sharedCapabilities` list on the relationship row is
  honoured; only an undefined list falls back to the default module set.
- PiB → client rows carry CRM-era capability lists that predate marketing
  modules; the script unions them with the workspace defaults (serving org's
  work on the client is shared by default). Client → PiB and partner ↔ partner
  rows are taken as-is.

Applied 2026-09-02: 41 links minted, 86 grants created (0 destructive ops),
re-run is all `noop`. One skip (Gundemy company on PiB with no reciprocal row).

## Out of scope

- Co-editing serving-org records from the client side
- Transitive visibility across chained links
- Merging tenants or moving records between books on link
