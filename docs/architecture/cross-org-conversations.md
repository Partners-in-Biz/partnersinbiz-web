# Cross-organisation Conversations

Normal `conversations` remain the Messages product surface. A cross-organisation thread is an explicit, bilateral binding on a normal Conversation; it is never created by an organisation-wide share mode or a legacy CRM pointer.

## Binding

`Conversation.crossOrg` contains the canonical partner-link id, source owner organisation, exactly two participant organisation ids, and a thread reference:

- `relationship`: bilateral relationship work
- `project`: a project resource shared by the two organisations
- `resource`: any separately granted module resource

It also stores an incrementing `accessEpoch`, retention policy, and explicit user/agent principals. Each agent has a human `memberUid` used for membership and audit checks. Removed principals remain historical records with removal metadata and cannot access the thread.

## Access rule

A foreign caller must pass all three gates on every protected request:

1. It is an active, explicitly named thread principal from one of the two participant organisations.
2. The thread status is active.
3. `CrossOrgPolicyService` allows the matching `PartnerLink`, directional `messages` scope agreement, active membership, and `PartnerResourceGrant(resourceType: "conversation")` action/item.

This is fail closed. A third organisation, an unlisted user, a removed principal, a frozen/revoked thread, or a revoked link/grant is denied before any Message or attachment payload is returned. Owner-org access retains the normal Conversation checks.

## Surfaces

- Message listing filters every cross-org message against its explicit principal audience and a per-item policy decision.
- Cross-org messages and uploaded attachments receive an active-principal visibility list by default. Attachment downloads re-check both the conversation grant and attachment audience.
- Read state uses the qualified cross-org principal id, and may only advance to a message visible to that principal; it does not rely on the global latest-message marker.
- A foreign user may contribute a user message when granted, but owner-org workspace-agent dispatch is deliberately disabled. A foreign agent requires a separately approved sanitized execution context; the owner workspace paths, runtime, compressed context, and history must not be reused.
- Cross-org participant/agent management is limited to the active source-org owner principal. Cross-org mutations must update the explicit `crossOrg.participants` record and increment `accessEpoch`; generic single-org participant mutation must not be used for that purpose.

## Revocation and retention

Policy is re-evaluated at request time, so a changed membership/link/scope/grant denies foreign access immediately. `accessEpoch` exists to fence cached context, queued work, and realtime indexes when the lifecycle executor receives the revocation event. Historical owner-side records remain subject to the configured retention policy; foreign access is never retained merely because a historical record exists.

## Verification

`__tests__/lib/conversations/cross-org.test.ts` proves the A/B/C matrix: named organisation-B participant allowed only through canonical policy, organisation C and unlisted B member denied, grant/thread revocation deny immediately, A-only message hidden from B, and management remains source-owner-only.
