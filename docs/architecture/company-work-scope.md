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

## Migration

`lib/cross-org/migration.ts` plans `backfill_company_workspace_grant` dry-run first.
Unset `clientVisibility` needs no write (defaults to shared).

## Out of scope

- Co-editing serving-org records from the client side
- Transitive visibility across chained links
- Merging tenants or moving records between books on link
