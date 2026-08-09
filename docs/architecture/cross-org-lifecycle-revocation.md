# Cross-org lifecycle: bilateral scope acceptance and capability-reduction cascade

**Status:** Approved architecture (development) · Task `16ApXwE6lY7j6prYFKxZ`
**Spec:** Internal document `9EllFp0EYw7MVkn89jbB` version `abNUeVejjujN14L8Kl4C` (approved gate `Mx3iThWlZ4nJNAvCh4lC`)
**Project:** Cross-organisation collaboration and resource access hardening (`JZ7TSJjnGYjv87h6OAst`)
**Depends on:** canonical contracts ADR `RBa6Ykx9AbBFrkrX5sAg`, central policy service `YKa9DWMexJ8Cx3yuRdgz`
**Hard gates:** development branch only · no production deploy · no client-visible sends · per-module rules below are canonical for adapters and the reconciler.

This document specifies two lifecycle behaviours on top of the canonical
cross-org access model (`docs/architecture/cross-org-access-model.md`):

1. **Bilateral directional scope acceptance** — a directional scope agreement
   becomes active only when BOTH the grantor and the grantee have accepted it.
2. **Capability-reduction state machine** — turning off a capability (or
   unlinking) immediately revokes / freezes / reconciles the affected module
   artifacts (shares, project grants, catalogues, open orders, settlements,
   attachment URLs, Messages context, agent caches) according to per-module
   rules, with idempotent replay and orphan detection.

The pure implementation lives in `lib/cross-org/lifecycle.ts` (acceptance
helpers, `MODULE_CASCADE_RULES`, `planModuleCascade`,
`shouldApplyModuleAction`, `moduleCascadeReplayKey`,
`detectOrphanedModuleRecords`) and `lib/cross-org/types.ts` (contract shapes).
The Firestore-backed reconciler (migration task `ub12qgO1AMb3WQeLIPSB` and
module adapters) hydrates the affected records and applies the produced plan;
the planning functions are pure and deterministic.

## 1. Bilateral directional scope acceptance

A `PartnerScopeAgreement` is directional: `direction.grantorOrgId ->
direction.granteeOrgId`. Acceptance is bilateral — the agreement may not become
`active` until both sides have recorded acceptance:

- `acceptance.grantor` — the org exposing the capabilities accepts what it
  shares (usually the same org that proposed, recorded in `proposedByRef`).
- `acceptance.grantee` — the receiving org accepts what it is granted.
- `acceptedByRef` remains as a legacy single-side pointer (migration
  compatibility); `hasBilateralAcceptance()` requires both sides of
  `acceptance`.

### State machine

```
draft ──propose──▶ proposed ──grantor accept + grantee accept──▶ active
  ▲                   │                                            │
  │                   ▼                                            ▼
  └─────────────── revoked ◀─────────────────────────────────── paused
                                    (or expired)
```

Transitions (from `SCOPE_AGREEMENT_TRANSITIONS`):

| From | To | Condition |
| --- | --- | --- |
| draft, proposed | proposed | propose (record `proposedByRef`) |
| draft, proposed, paused | **active** | `recordScopeAgreementAcceptance` with BOTH sides recorded |
| active | paused | capability temporarily withdrawn |
| draft, proposed, active, paused | revoked | permanent withdrawal / unlink cascade |
| draft, proposed, active, paused | expired | `expiresAt` passed (lazy expiry) |

`recordScopeAgreementAcceptance({ agreement, side, byRef, at })` returns the
next snapshot plus `fullyAccepted` and `canActivate`. It is idempotent:
accepting the same side twice keeps the first record. A revoked or expired
agreement can never be reactivated, even if both sides later accept.

## 2. Capability-reduction state machine (per-module cascade)

The core rule: **turning off a capability or unlinking must immediately
revoke / freeze / reconcile the affected module artifacts.** The three actions
are:

- **revoke** — permanent; the artifact stops working and cannot be restored by
  re-adding the capability. Used for access surfaces that must never outlive
  their justification (shares, project grants, attachment URLs).
- **freeze** — temporary pause; the artifact is disabled for new activity but
  retained for reconciliation, and can be unfrozen by restoring the capability
  (catalogues, open orders, settlements, Messages threads).
- **reconcile** — evidence run only; no state change. Used for derived surfaces
  (agent caches) where the correct action is cache invalidation + an audit
  event.

### Canonical per-module rules (`MODULE_CASCADE_RULES`)

| Module | Artifact (collection) | Unlink | Capability removed | Field narrowed |
| --- | --- | --- | --- | --- |
| shares | `partner_record_shares` | revoke | revoke | reconcile |
| project_grants | `projectOrganizations` | revoke | revoke (projects) | reconcile |
| catalogues | `partner_catalog_items` | freeze | freeze (orders) | reconcile |
| open_orders | `orders` | freeze | freeze (orders) | reconcile |
| settlements | invoice settlement state | freeze | freeze (invoices) | reconcile |
| attachments | attachment URLs | revoke | revoke (documents) | **revoke** |
| messages | `partner_link_messages` | freeze | freeze | reconcile |
| agent_caches | derived cache keys | reconcile | reconcile | reconcile |

Rules bound to a capability (`project_grants -> projects`, `catalogues ->
orders`, `open_orders -> orders`, `settlements -> invoices`, `attachments ->
documents`) only participate when that capability is the one being removed.
Rules without a capability binding (`shares`, `messages`, `agent_caches`)
participate whenever the adapter supplies affected record ids — the adapter is
responsible for passing only shares/threads/caches that were actually tied to
the removed capability.

### Planning

`planModuleCascade({ trigger, resourcesByModule })` produces a
`ModuleCascadePlan`:

```
trigger: {
  type: 'link.unlinked' | 'capability.reduced' | 'field.narrowed' | 'membership.offboarded'
  partnerLinkId?, scopeAgreementId?, capability?, field?
}
targets: [{ module, action, resourceIds, trigger? }]
events:  [{ eventType: 'module.revoked' | 'module.frozen' | 'module.reconciled', reason, metadata }]
```

`actionForModule({ module, trigger })` resolves the action for a module and
trigger type. Offboarding (`membership.offboarded`) always revokes.

### Idempotent replay

Replaying a cascade must not double-revoke or double-freeze:

- `shouldApplyModuleAction({ action, recordId, alreadyInState })` returns false
  when the record is already in the target state (already revoked/frozen);
  `reconcile` actions always replay (evidence-only).
- `moduleCascadeReplayKey({ trigger, targets })` is a deterministic key over
  trigger + sorted targets; the reconciler uses it to deduplicate audit events
  and make replay a no-op for records already handled.

### Orphan detection

`detectOrphanedModuleRecords({ trigger, records })` returns every module record
that still references a dead trigger (e.g. a share whose link was revoked
before the canonical cascade ran). The reconciler reports orphans as
`orphan.detected` audit events and applies the module rule to them, closing the
gap left by pre-canonical unlinks.

## 3. Audit events

The cascade emits append-only `PartnerAuditEvent`s:

- `module.revoked` — a module artifact was permanently revoked.
- `module.frozen` — a module artifact was frozen (temporary).
- `module.reconciled` — an evidence-only reconcile run.
- `orphan.detected` — an orphaned record found during reconciliation.
- `capability.reduced` — the capability reduction itself (already defined).

Metadata carries `module`, `action`, `resourceIds`, and the rule `rationale` —
never foreign resource payloads.

## 4. Adapter contract

A module becomes cross-org lifecycle capable when its adapter:

1. Reads access through the central policy service (`CrossOrgPolicyService`)
   for cross-org paths, or denies.
2. Supplies affected record ids to `planModuleCascade` when the module is
   touched by unlink / capability reduction / field narrowing.
3. Applies the produced action (revoke/freeze/reconcile) with the module's own
   Firestore mutation, guarding with `shouldApplyModuleAction` for idempotency.
4. Records `module.*` and `orphan.detected` audit events with the replay key.
5. Has denial tests for revoked link, missing capability, missing/expired
   grant, and unrelated tenant.

## 5. Migration compatibility

Legacy unlinks that ran before the canonical cascade existed may have left
orphans (active shares / project grants / attachments on a revoked link). The
migration task runs `detectOrphanedModuleRecords` across module collections
keyed by `partnerLinkId`, reports `orphan.detected`, then applies the module
rules to reconcile the stragglers. Legacy single-side `acceptedByRef` rows are
not treated as bilaterally accepted; migration must backfill the missing
grantor/grantee acceptance side from the mirrored business relationship rows
before canonical activation is claimed.
