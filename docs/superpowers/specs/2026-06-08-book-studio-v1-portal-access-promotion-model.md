# Book Studio V1 Portal Access And Promotion Model

**Date:** 2026-06-08
**Status:** Design-only portal access and artifact-promotion model; not runtime implementation and not an implementation plan.
**Authoritative dossier:** `docs/superpowers/specs/2026-06-07-book-studio-research-dossier.md`
**Decision packet:** `docs/superpowers/specs/2026-06-08-book-studio-v1-approval-packet.md`
**Workflow map:** `docs/superpowers/specs/2026-06-08-book-studio-v1-platform-workflow-map.md`
**Mock review packet:** `docs/superpowers/specs/2026-06-08-book-studio-v1-mock-review-packet.md`
**Hermes evaluation packet:** `docs/superpowers/specs/2026-06-08-book-studio-v1-hermes-skill-evaluation-packet.md`

## Purpose

Book Studio V1 is meant to be integrated into PiB, but the client portal must not become a mirror of the internal production workspace. This packet defines how a future Book Studio portal module should be enabled, what clients may see, what clients may do, and what must remain internal.

This file does not add `bookStudio` to runtime module settings, create routes, change navigation, define Firestore collections, create APIs, build UI, enable Hermes dispatch, or approve a Phase 1 plan.

## Recommended Module Posture

Book Studio should be admin-first and portal-optional.

Recommended future setting:

```yaml
organizations/{orgId}.settings.portalModules.bookStudio: boolean
```

Recommended default:

- `false` or missing: portal Book Studio is hidden and direct portal access is blocked.
- `true`: portal Book Studio is visible for that client organisation, but only reviewed/promoted artifacts are shown.

Rationale: Mobile Apps and YouTube Studio needed backward-compatible defaults because they already existed in the app. Book Studio is a new, publishing-sensitive module with rights, account, revenue, and AI-output risk. Missing should not make it visible.

Admin Book Studio management remains available to PiB admins regardless of the portal switch. The switch controls only the client portal surface.

## Portal Entitlement Contract

| Area | Future behavior |
| --- | --- |
| Admin settings | Per-client "Client portal modules" section can include Book Studio once implementation is approved. |
| Portal nav | Show Book Studio only when the active org has `portalModules.bookStudio === true`. |
| Portal direct route | Disabled orgs receive a clear unavailable state, not an empty workspace. |
| Portal API | Disabled orgs receive `403` with `{ moduleDisabled: true, module: 'bookStudio' }` before any book records are queried. |
| Org switcher | Module state is resolved per active org so switching clients cannot leak Book Studio nav or counts from another org. |
| Admin API | Admin-side Book Studio management remains unaffected by the portal switch. |
| Backward compatibility | Missing setting defaults to hidden because no existing client depends on Book Studio visibility. |

Devil's advocate: if missing defaults to visible, the first implementation may accidentally expose a new publishing workspace to every client. If disabled routes show an empty list, clients may think PiB has lost their book work rather than understand the module is not enabled.

## Portal Surface States

| State | Client sees | Admin sees | Required guard |
| --- | --- | --- | --- |
| Disabled | No nav item; direct access shows "Book Studio is not enabled for this portal." | Full internal workspace if PiB admin is allowed. | Module guard before data query. |
| Enabled, no promoted artifacts | Empty review state: "No book review packets are ready yet." | Internal projects, drafts, blockers, and tasks. | Safe empty state, no internal counts. |
| Book Brief review | Reviewed brief version, approval/change-request actions, safe comments. | Source packet, raw research, draft history, Hermes notes. | Artifact version promotion. |
| Proof review | Reviewed sample pages, proof notes, client decision request. | Drafts, rejected proofs, generation runs, rights notes. | Proof version and rights/provenance gates. |
| Publishing packet review | Safe KDP/Google packet summary, readiness blockers, client decisions. | Account authority, source freshness, file evidence, pricing/margin, upload checklist. | Packet sanitizer and channel gate. |
| Live status | Store links, status labels, safe next actions. | Upload evidence, external review notes, revision tasks. | Human upload evidence and reviewed summary. |
| Analytics summary | Confidence-labeled period summary after reconciliation. | Raw imports, refunds, unmatched rows, cost recovery, internal margin. | Analytics sanitizer and reconciliation state. |
| Revoked or invalidated | "This packet is being updated" plus last safe version if appropriate. | Invalidated artifact version, reason, owner, next task. | Version invalidation on material changes. |

## Artifact Promotion Model

Book Studio portal visibility should be driven by artifact promotion, not raw record access.

Recommended future artifact states:

| State | Meaning | Portal visibility |
| --- | --- | --- |
| `internal_draft` | Created by admin, Hermes, or production work. | Hidden. |
| `internal_review` | Ready for PiB review. | Hidden. |
| `client_review_ready` | Sanitized and approved by PiB for client review. | Visible if module enabled. |
| `client_changes_requested` | Client has requested changes or answered decision questions. | Visible with status and comments. |
| `client_approved` | Client approved this exact artifact version. | Visible; does not imply publishing readiness unless packet gates pass. |
| `revoked` | Admin removed portal visibility. | Hidden or replaced by safe revoked message. |
| `invalidated` | Underlying evidence, file, source, price, account, or analytics state changed. | Hidden or shown as under revision; no new approval implied. |

Promotion rules:

- Promotion is version-specific.
- A new proof, source refresh failure, file checksum change, ownership change, price change, AI-disclosure change, or analytics reconciliation change invalidates dependent promoted artifacts.
- A client approval approves the artifact they saw, not the whole book project.
- A publishing packet approval does not authorize direct publishing or store mutation.
- A safe blocker can be promoted, but internal rights analysis, account details, and legal speculation stay internal.

## Client Permissions

The future portal should be designed around review and decision actions, not creation or publishing actions.

| Portal user capability | Allowed V1 actions | Forbidden V1 actions |
| --- | --- | --- |
| Viewer | Read promoted Book Briefs, proofs, packet summaries, live status, and analytics summaries. | See raw research, Hermes output, internal rights notes, account details, costs, or raw imports. |
| Commenter | Add comments, ask questions, request changes on promoted artifact versions. | Edit internal records, draft content, or change gates. |
| Approver | Approve or reject a promoted artifact version and answer explicit decision questions. | Mark upload-ready, publish, spend, change listing, request credentials, or approve raw Hermes output. |
| Client admin | Manage client-side reviewers where existing portal team permissions allow it. | Enable the module, bypass PiB review, or access other orgs' book work. |

Future implementation can map these capabilities to existing portal roles or a Book Studio-specific reviewer/approver flag. The design requirement is that approval authority must be explicit and auditable.

## Safe Portal DTO Shape

Future portal responses should be built from allowlisted fields rather than shared admin DTOs.

Safe client fields:

- book project ID, title, family label, status label, and safe summary,
- promoted artifact ID, version, type, status, created/reviewed dates, reviewer names where safe,
- client action requirements,
- safe blocker labels and next-decision requests,
- store links only after human-reviewed live status,
- analytics period, source label, confidence, and reconciliation wording,
- comments on promoted artifacts.

Unsafe fields:

- raw research notes,
- raw Hermes prompts or outputs,
- internal strategy notes,
- source parser errors,
- rights uncertainty and speculative legal analysis,
- account names beyond safe status labels,
- tax, bank, identity, payment, or credential-related text,
- private contract text,
- internal cost, margin, or revenue-share calculations,
- raw report rows,
- unsupported claims, and
- artifacts not promoted for the active org.

## Client Action Model

Allowed client actions should be narrow and auditable.

| Action | Meaning | Must not mean |
| --- | --- | --- |
| Approve Book Brief | Client agrees with the reviewed audience, promise, scope, assumptions, and decision questions in that version. | Book is ready to publish. |
| Request brief changes | Client wants changes to reviewed brief wording or scope. | Client can edit raw source or Hermes notes. |
| Approve proof package | Client approves a reviewed proof version for the next internal step. | All files, rights, or packages are final. |
| Acknowledge blocker | Client understands a safe blocker or supplies a decision. | Blocker is waived without PiB reviewer evidence. |
| Approve publishing packet summary | Client approves safe channel summary and client-owned decisions. | PiB may publish directly or store credentials. |
| Review analytics summary | Client reviews confidence-labeled performance. | Numbers are settled revenue unless reconciliation says so. |

## Invalidation Rules

Portal state should be conservative when evidence changes.

| Change | Required result |
| --- | --- |
| Book Brief promise, audience, channel, ownership, or scope changes. | Invalidate dependent outline, proof, and packet approvals. |
| Manuscript, proof, cover, EPUB, PDF, print file, or checksum changes. | Invalidate proof and publishing packet approval for the affected version. |
| Rights, source freshness, account authority, AI disclosure, or ownership evidence changes. | Recheck dependent client-safe packet states. |
| KDP or Google source key becomes stale. | Remove upload-ready wording and show safe pending-source-refresh state. |
| Manual upload returns store changes needed. | Move live status to revision-needed and create internal task. |
| Analytics import gains refunds, adjustments, missing rows, or settlement mismatch. | Revoke or revise promoted analytics summary. |

Devil's advocate: without invalidation, a client can approve one version while PiB silently changes the file, price, disclosure, or source basis underneath it.

## Org Scope And Isolation

Book Studio portal work must honor the active portal organisation.

Required design rules:

- Every portal read resolves the active org before loading Book Studio records.
- Scoped portal URLs carry org identity the same way existing CRM company workspace routes do when needed.
- Org switcher changes recompute `bookStudio` module visibility and clear stale project counts.
- Portal queries never fall back to the PiB platform org when a requested client org is missing or unauthorized.
- Public/tokenized document views, if used later, must rely on explicit share tokens and cannot imply Book Studio portal module enablement.

## Support And Abuse Boundaries

Portal copy should avoid implying guaranteed publication, approval, ranking, revenue, or legal clearance.

Unsafe claims:

- "Your book is ready for KDP."
- "Google has approved this book."
- "Hermes approved this packet."
- "This book will earn R..."
- "Send us your KDP login."

Safer claims:

- "This reviewed brief is ready for your feedback."
- "The publishing packet still has PiB review blockers."
- "Manual upload will happen outside PiB after packet approval."
- "This report is directional until reconciliation is complete."
- "Account setup is pending; do not share passwords here."

## Future Test Obligations

If Peet approves V1 and a future plan implements this surface, tests should prove:

- missing `settings.portalModules.bookStudio` hides portal nav and blocks portal APIs,
- `bookStudio: true` shows portal nav for that active org only,
- disabled direct API access returns `403` and does not query book records,
- portal org switching recomputes module visibility and does not leak counts,
- safe DTOs exclude raw Hermes, rights, account, cost, and raw analytics fields,
- artifact promotion is version-specific,
- invalidation removes or revises stale client-visible states,
- client actions cannot publish, spend, request secrets, import analytics, or mark upload-ready,
- admin Book Studio management remains available when portal Book Studio is disabled, and
- a public/share-token view cannot bypass portal artifact visibility rules.

## Current Review State

This model strengthens the PiB integration side of the Book Studio decision. It makes the future module switch, portal disabled state, client-safe artifact promotion, role boundaries, and org isolation explicit.

It does not approve runtime implementation. The next required product step remains Peet approving, revising, or rejecting the Book Studio V1 approval record before any Phase 1 implementation plan is written.
