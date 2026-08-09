# Cross-organisation collaboration and resource access model (ADR)

**Status:** Approved architecture (development) · Task `RBa6Ykx9AbBFrkrX5sAg`
**Spec:** Internal document `9EllFp0EYw7MVkn89jbB` version `abNUeVejjujN14L8Kl4C` (approved gate `Mx3iThWlZ4nJNAvCh4lC`)
**Project:** Cross-organisation collaboration and resource access hardening (`JZ7TSJjnGYjv87h6OAst`)
**Hard gates:** development branch only · no production deploy · no client-visible sends · legacy aliases are read-only compatibility inputs until migration evidence proves safe removal · every module stays unsupported for cross-org collaboration until its adapter and denial tests pass.

## Decision

Adopt one canonical decision model for every cross-organisation access decision:

```
actor
  -> active membership (orgMembers row; role; module access policy)
  -> reciprocal live partner link (both mirrored businessRelationships rows active)
  -> capability (shared on the link, negotiated per direction)
  -> resource grant (PartnerResourceGrant; owner, recipient orgs, users/teams, role, actions, fields/items, expiry, provenance, approval basis)
  -> user/team role on the resource
  -> action/field
  -> lifecycle state (active, not revoked/expired/paused)
```

All five contracts are persisted in canonical Firestore collections (below). Existing
`businessRelationships` rows remain the persisted reciprocal link record, but access
authority comes only from the canonical link contract (`partnerLinkId` + both rows
`active`), never from CRM convenience pointers. `linkedOrgId` / `linkedUserId` /
`allowedOrgIds` / `allowedUserIds` on CRM rows are **compatibility inputs only** —
they never grant access by themselves.

## Contracts

### 1. PartnerLink (bilateral, reciprocal)

Collection: `partnerLinks` (canonical id = `partnerLinkId`, shared by both sides).

The link is the mutual consent contract between exactly two organisations. It is
bilateral: both relationship rows (one per org in `businessRelationships`) must be
`status === 'active'`, non-deleted, and share the same `partnerLinkId` before any
capability or grant can be evaluated. There is exactly one canonical link doc; the
two `businessRelationships` rows reference it and remain the per-tenant mirror used
by existing UI.

Fields: `partnerLinkId`, `orgA`, `orgB`, `relationshipIdA`, `relationshipIdB`,
`status` (`active` | `paused` | `revoked` | `archived`), `schemaVersion`,
`createdAt`, `updatedAt`, `revokedAt?`, `revokedByRef?`, `revokeReason?`.

Capabilities and field policy are **directional** — they live on the scope
agreement, not as a single flat list on the link. The link only asserts *that* the
two orgs are linked and *which* capability families are open for negotiation
(`negotiableCapabilities`).

### 2. PartnerScopeAgreement (directional)

Collection: `partnerScopeAgreements` (one doc per direction: A→B and B→A are
separate agreements sharing the same `partnerLinkId`).

A scope agreement states what the *grantor* org exposes to the *grantee* org in one
direction. Status: `draft` | `proposed` | `active` | `paused` | `revoked` |
`expired`. A directional agreement may not be `active` until the link is `active`.

Fields: `id`, `partnerLinkId`, `direction: { grantorOrgId, granteeOrgId }`,
`capabilities: SharedBusinessCapability[]`, `fieldSharingPolicy:
FieldSharingPolicy`, `status`, `version`, `schemaVersion`, `proposedByRef`,
`acceptedByRef?`, `effectiveAt?`, `expiresAt?`, `createdAt`, `updatedAt`,
`revokedAt?`, `revokeReason?`.

Capability reduction is a first-class event: lowering `capabilities` or narrowing
`fieldSharingPolicy` immediately invalidates every downstream grant that depends on
the removed capability/field (cascade, see lifecycle).

### 3. PartnerResourceGrant

Collection: `partnerResourceGrants` (canonical replacement for ad-hoc shares).

A grant gives a specific recipient access to one resource under a role. Recipients
may be organisations, named users, or teams; provenance and approval basis are
mandatory so every grant is auditable back to a decision.

Fields: `id`, `partnerLinkId?`, `scopeAgreementId?`, `ownerOrgId`, `resourceType`
(`project` | `document` | `invoice` | `quote` | `conversation` | `deal` |
`campaign` | `social_post` | `email` | `seo` | `ads` | `support` | `service` |
`research` | `property` | `custom`), `resourceId`, `grantee: { orgIds: string[],
userIds: string[], teamIds: string[] }`, `role` (project/org/module role string),
`actions: string[]`, `fields?: string[]` (field-level allowlist when set),
`items?: string[]` (item-level allowlist when set), `status` (`active` | `paused`
| `revoked` | `expired`), `expiresAt?`, `provenance: { sourceDocumentId?,
sourceDocumentSectionId?, approvalGateTaskId?, sourceResearchItemId?,
sourceShareId? }`, `approvalBasis: { type: 'partner_link' | 'scope_agreement' |
'approval_task' | 'system', refId? }`, `createdByRef`, `createdAt`, `updatedAt`,
`revokedAt?`, `revokedByRef?`, `revokeReason?`, `schemaVersion`.

A grant is only effective when: link active (when `partnerLinkId` set), scope
agreement active (when `scopeAgreementId` set), grant itself `active`, and
`expiresAt` not passed. Grants never outlive their link or agreement.

### 4. PartnerIdentityLink (many-to-many)

Collection: `partnerIdentityLinks`.

Associates CRM companies/contacts with organisations/users in many-to-many form.
Convenience pointers (`linkedOrgId`, `linkedUserId`) may be derived from these rows
for compatibility but never grant access. Acceptance records the **approver** (the
admin who accepted), not the recipient identity — identity is verified through an
active membership or a verified link row.

Fields: `id`, `linkType` (`company_org` | `contact_user` | `company_user` |
`contact_org`), `sourceRef: { kind: 'company' | 'contact', id }`, `targetRef: {
kind: 'org' | 'user', id }`, `status` (`verified` | `unverified` | `revoked`),
`verifiedByRef?`, `verifiedAt?`, `revokedByRef?`, `revokedAt?`, `provenance: {
sourceInviteId?, sourceDocumentId?, approvalGateTaskId? }`, `schemaVersion`,
`createdAt`, `updatedAt`.

### 5. PartnerAuditEvent (append-only)

Collection: `partnerAuditEvents` (write-once; no update, no delete).

Every invite, consent, grant, access, mutation, capability reduction, unlink and
settlement records an append-only event with reconciliation evidence.

Fields: `id`, `eventType` (`partner_link.invited` | `partner_link.accepted` |
`partner_link.unlinked` | `scope_agreement.proposed` | `scope_agreement.accepted`
| `scope_agreement.revoked` | `resource_grant.created` | `resource_grant.revoked`
| `resource_grant.expired` | `access.decided` | `identity_link.created` |
`identity_link.verified` | `identity_link.revoked` | `capability.reduced` |
`settlement.approved` | `reconciliation.ran`), `partnerLinkId?`,
`scopeAgreementId?`, `resourceGrantId?`, `identityLinkId?`, `actorRef`,
`actorOrgId`, `resourceType?`, `resourceId?`, `decision?` (`allowed` | `denied` |
`applied` | `rejected`), `reason?`, `metadata`, `reconciliationKey?`, `hash?`
(content hash for tamper-evidence), `createdAt`.

The existing `crmAuditEvents` collection stays for CRM-level events; canonical
cross-org policy events go to `partnerAuditEvents`.

## Decision evaluation rules

`evaluatePartnerAccess(input)` (pure, unit-testable) walks the chain and returns
`{ allowed, reason, chain: DecisionStep[] }` where each step records
`{ step, passed, detail }`:

1. **Actor identity** — `actor.userId` present, actor not deleted/suspended.
2. **Active membership** — an active `orgMembers` row exists for `(actor.orgId,
   actor.userId)` using the central `isActiveOrgMembershipRow` predicate (rejects
   disabled, revoked, deleted, inactive rows; no global-admin fallback on the
   org-scoped surface).
3. **Reciprocal link** — when the resource is cross-org (`partnerLinkId` supplied),
   both `businessRelationships` rows for the pair are `active`, not deleted, and
   share the supplied `partnerLinkId`; the link doc is `active`.
4. **Capability** — the action requires a `SharedBusinessCapability`; the
   directional scope agreement for `(grantor, actorOrgId)` includes it and the
   field policy covers the field when the action is field-scoped.
5. **Resource grant** — an `active` `PartnerResourceGrant` exists for
   `(resourceType, resourceId)` whose grantee covers the actor's org, uid, or team.
6. **User/team role on the resource** — the actor's role (project member role /
   module role / team membership) meets the grant's `role` requirement
   (rank-based).
7. **Action/field** — `actions` includes the action (or is empty = all); `fields`
   / `items` include the field/item when restricted.
8. **Lifecycle state** — grant not expired/revoked; agreement not revoked/expired;
   link not paused/revoked; offboarding invalidates immediately.

Any failed step denies with the step name in `reason`. Denials are recorded as
append-only `access.decided` audit events when `recordDecision` is requested.

## Lifecycle evaluation and cascade

- **Unlink** revokes both relationship rows, the canonical link, every scope
  agreement on the link, every resource grant on the link/agreements, and derived
  identity links — atomically in the same mutation.
- **Capability reduction / field narrowing** on a scope agreement immediately
  re-evaluates all downstream grants; grants that required the removed
  capability/field are revoked with `revokeReason: 'capability.reduced'` and
  `access.decided` events are appended. `revoke` (permanent) vs `freeze`
  (temporary pause) vs `reconcile` (evidence run) semantics are per-module: the
  reconciler emits `reconciliation.ran` events and never silently resurrects a
  revoked grant.
- **Expiry** is evaluated lazily at decision time and by a reconciler that flips
  `expired` and emits `resource_grant.expired` / `scope_agreement.expired`.
- **Offboarding** (membership revoked/deleted/disabled) invalidates step 2
  immediately; no grant can restore it.
- **Migration compatibility**: legacy `businessRelationships` rows that already
  carry a `partnerLinkId` and `status === 'active'` are promoted to canonical
  links; `partner_record_shares` rows are promoted to `PartnerResourceGrant`
  rows with provenance `sourceShareId`; `linkedOrgId`/`linkedUserId` pointers are
  read-only compatibility inputs used only to seed `PartnerIdentityLink` rows
  during backfill — they never grant access and may be removed once migration
  evidence proves the canonical rows are complete.

## Collection inventory

| Collection | Access |
| --- | --- |
| `partnerLinks` | Server-only (API-mediated), no client SDK |
| `partnerScopeAgreements` | Server-only |
| `partnerResourceGrants` | Server-only |
| `partnerIdentityLinks` | Server-only |
| `partnerAuditEvents` | Server-only, append-only |
| `businessRelationships` (existing) | Mirrored per-tenant rows, link authority only via canonical contract |

## Module conformance

A module is only "cross-org capable" when: (a) it reads access through
`evaluatePartnerAccess` for cross-org paths; (b) it has denial tests for revoked
membership, revoked link, missing capability, missing/expired grant, and unrelated
tenant; (c) it records `access.decided` events. Marketing surfaces (campaigns,
social, email, SEO, ads, analytics delegation) stay unsupported until their
adapter and approval-gate work lands.
