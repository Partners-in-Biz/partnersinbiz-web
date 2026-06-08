# Book Studio V1 Operator Workspace Control Model

**Date:** 2026-06-08
**Status:** Design-only operator model; not a UI implementation, route map, component spec, Firestore schema, API contract, Hermes runtime plan, or Phase 1 task list.
**Authoritative dossier:** `docs/superpowers/specs/2026-06-07-book-studio-research-dossier.md`
**Decision packet:** `docs/superpowers/specs/2026-06-08-book-studio-v1-approval-packet.md`
**Workflow map:** `docs/superpowers/specs/2026-06-08-book-studio-v1-platform-workflow-map.md`
**Domain record/state model:** `docs/superpowers/specs/2026-06-08-book-studio-v1-domain-record-state-model.md`
**Portal access model:** `docs/superpowers/specs/2026-06-08-book-studio-v1-portal-access-promotion-model.md`
**Market evidence model:** `docs/superpowers/specs/2026-06-08-book-studio-v1-market-evidence-model.md`

## Purpose

This model describes how a PiB operator should control Book Studio V1 day to day if Peet approves the V1 record. It turns the record/state model into an admin-facing operating spine without designing actual screens or writing implementation tasks.

The key product rule is simple: Book Studio should feel like a production command center, not a blank prompt that says "write me a book" and not a compliance database with no next action.

This file does not create runtime routes, UI components, navigation entries, database collections, DTOs, API handlers, Hermes skills, direct publishing integrations, analytics importers, or a Phase 1 implementation plan.

## Workspace Spine

The admin workspace should be organized around the current safest next action for each book project.

| Surface | Operator job | Primary object | Must show | Must not show as an available V1 control |
| --- | --- | --- | --- | --- |
| Book Studio index | Find work needing attention. | `bookProject` summary. | Lifecycle state, blocker count, next action, owner, client/org, family, channel packet status, portal review status, analytics confidence. | "Generate book", "publish", or "email client" bulk actions. |
| New project intake | Create the gate profile before production starts. | `bookProject` plus `bookGateProfile`. | Org, owner model, book family, formats, channels, series posture, client involvement, first evidence needs. | A blank manuscript prompt or upload-ready shortcut. |
| Project command center | Run one project from idea to analytics. | `bookProject`. | Stage rail, current blockers, next safe command, evidence lanes, artifact versions, packet state, portal promotion state. | Direct store upload, credential capture, raw client exposure. |
| Evidence lane | Keep claims source-backed. | `bookResearchPacketLink`. | Source freshness, confidence, unresolved claims, internal-only notes, refresh tasks. | Client-visible research conclusions without reviewed brief wording. |
| Market evidence lane | Decide whether the candidate is worth producing before Book Brief or production work. | `bookMarketEvidencePacket`. | Audience/buyer use case, competitive shelf observations, discoverability hypotheses, price/margin posture, channel fit, PiB fit, pass/warn/block decision. | Sales forecasts, rank promises, automated market scraping, copied competitor positioning, or production selection without reviewer decision. |
| Brief and approval lane | Turn research into a reviewable promise. | `bookBriefVersion` and `bookPortalPromotion`. | Audience, promise, scope, assumptions, decisions, safe client approval state. | Approval for unsupported claims or stale source assumptions. |
| Series and structure lane | Keep continuity and volume order controlled. | `bookSeries`. | Volume order, continuity facts, shared style/metadata, future-volume warnings. | Claim that later volumes or external series pages are already approved. |
| Production lane | Coordinate manuscript, proof, assets, and tasks. | `bookProductionArtifact`. | Current artifact versions, checksum, editorial/proof tasks, Projects/Kanban links, Hermes review artifacts. | Raw Hermes output as final copy or client-visible proof. |
| Rights and provenance lane | Prove every asset and generated artifact is usable. | `bookRightsAssetLedger` and `bookGenerationRun`. | Asset-level evidence, territories, AI disclosure inputs, reviewer decisions, unresolved rights blockers. | Project-wide "rights ok" toggle. |
| Publishing packet lane | Prepare manual handoff separately for each channel. | `bookPublishingPacket`. | KDP packet state, Google packet state, metadata, files, pricing, territories, disclosure, account authority, source freshness. | Direct publishing, credential storage, or cross-channel approval inheritance. |
| Manual upload lane | Record what happened outside PiB. | `bookManualUploadEvent` and `bookChannelListing`. | Operator, packet version, external IDs, live/review status, revision requests, evidence references. | Pretending PiB uploaded automatically. |
| Analytics lane | Interpret reports without overclaiming. | `bookAnalyticsImport` and `bookAnalyticsSummary`. | Source, period, timezone, confidence, refunds, adjustments, unmatched rows, reconciliation tasks. | One blended revenue total with no confidence label. |
| Decision log lane | Explain how the project moved. | `bookDecisionLog`. | Approvals, waivers, blockers, revisions, ownership/commercial decisions, version links. | Hidden or developer-only audit state. |

## Stage Rail

The project command center should use the domain states as an operator rail. Each stage needs one clear command, one clear blocker path, and one clear "not allowed yet" explanation.

| Stage | Operator should see | Safe next commands | Forbidden shortcut |
| --- | --- | --- | --- |
| `intake` | Missing gate choices and ownership/channel assumptions. | Complete intake, derive gate profile, create/link Research packet. | Draft manuscript before gates exist. |
| `researching` | Source lanes, confidence, unresolved facts, refresh needs. | Request/refresh research, ask Hermes for bounded research recommendations, mark blocker. | Promote raw research to client. |
| `market_review` | Candidate pass/warn/block state, weak evidence, margin/relevance risks, and next-evidence needs. | Mark production-selectable, mark selectable with warnings, block/retire candidate, or create next-evidence task. | Start Book Brief or production from search rank, shelf screenshots, generic AI ideas, or negative/unknown margin. |
| `brief_review` | Brief version, assumptions, approval questions, client-safe wording. | Internal approve, request changes, promote reviewed brief to portal. | Ask client to approve unsupported or internal-only claims. |
| `production` | Active manuscript/proof/assets/tasks and artifact versions. | Create Projects/Kanban tasks, attach proof, request bounded Hermes review, send artifact to internal review. | Generate full book as final artifact from one prompt. |
| `proof_review` | Editorial, accessibility, rights, provenance, and checksum evidence. | Approve current proof, request revision, invalidate stale approvals. | Keep approval after file or asset changes. |
| `packet_review` | KDP and Google readiness states side by side. | Approve one channel packet, request channel-specific fixes, create manual upload instructions. | Mark both channels ready because one passed. |
| `manual_handoff_ready` | Approved packet version and human upload instructions. | Record manual upload evidence, mark upload delayed, reopen packet. | Directly publish or request credentials. |
| `uploaded_external_review` | Store review, external IDs, revision requests, live links. | Record store status, create revision task, promote safe live-status update. | Claim live status without external evidence. |
| `live` | Live channels, packet version, analytics readiness, lifecycle tasks. | Import reports, create lifecycle task, request revision with invalidation. | Start ads, review outreach, price changes, or public sends without approval. |
| `revision_needed` | Reason, affected version, required evidence, owner. | Create revision tasks, invalidate dependent approvals, return to review stage. | Patch live copy without versioning. |
| `blocked` | Blocker owner, evidence gap, risk, and safe explanation. | Resolve blocker, defer, archive, or create internal task. | Hide blocker behind a polished client update. |

## Command Contract

Every visible admin command should be defined by a contract before implementation planning:

| Contract field | Why it matters |
| --- | --- |
| Preconditions | Prevents commands from appearing when gates, source freshness, rights, or packet evidence are missing. |
| Version affected | Makes approvals, promotions, checksums, and invalidation precise. |
| State transition | Explains what project, artifact, packet, analytics, or portal state changes. |
| Audit event | Ensures the decision log stays human-readable. |
| Portal exposure | Declares whether the result is internal only, client-reviewable, or client-approved. |
| Hermes involvement | Separates a suggestion/check/report from runtime execution or final action. |
| Failure message | Gives the operator the exact reason a command is unavailable. |

Commands that fit V1 design:

- Complete intake and derive gate profile.
- Link or create Research packet.
- Review market evidence pass/warn/block state.
- Mark candidate production-selectable with accepted warnings.
- Block or retire weak candidate.
- Request source refresh.
- Draft internal Book Brief from reviewed market evidence and source-backed research.
- Promote reviewed Book Brief version to portal.
- Create Projects/Kanban production tasks.
- Attach manuscript/proof/package artifact.
- Request bounded Hermes check or recommendation.
- Record rights/provenance evidence.
- Mark channel packet warning or blocker with owner/date.
- Approve one channel packet for manual handoff.
- Record manual upload evidence.
- Record store review/live/revision status.
- Import manual analytics report.
- Promote reconciled client analytics summary.
- Revoke or invalidate a portal promotion.

Commands that should not exist in V1:

- Generate full book and mark ready.
- Publish to KDP, Google, Apple, Kobo, Draft2Digital, IngramSpark, ACX, or ads.
- Store or request sensitive publishing account credentials.
- Send review outreach or public launch messages.
- Start ad spend or change live price/promotion.
- Show raw Hermes output to the client.
- Approve all packets across channels.
- Mark analytics as settled without report/payment evidence.

## Empty, Disabled, And Error States

| State | Operator-facing behavior |
| --- | --- |
| Module not approved yet | Admin sees no runtime module. Current docs remain review artifacts only. |
| Future module disabled for an org | Portal has no Book Studio navigation and portal/API access returns a disabled-module state. Admin can still manage internal work if V1 approval permits it. |
| No projects | Index invites creating a gated intake, not generating a manuscript. |
| Missing Research packet | Project command center blocks brief promotion and shows "Create or link Research packet" as the next action. |
| Missing market evidence | Project command center blocks Book Brief and production selection and shows "Review market evidence" as the next action. |
| Stale source | Packet readiness and client summary promotion are blocked until refresh. |
| Missing rights evidence | Proof/package approval is blocked at asset level. |
| Channel packet warning | Packet may be reviewed internally, but manual handoff needs owner/date/waiver or resolution. |
| Analytics partial import | Summary remains internal or warning-labeled until reconciliation. |
| Client-visible artifact invalidated | Portal promotion is revoked or marked invalidated with safe wording. |

## Existing PiB Surface Bridges

The operator workspace should use existing PiB surfaces instead of becoming a separate app:

| Bridge | Role in Book Studio |
| --- | --- |
| Research | Holds source-backed market, category, rights, policy, and evidence findings. |
| Client Documents | Hosts promoted Book Briefs, proof summaries, packet summaries, and analytics summaries. |
| Projects/Kanban | Tracks human and Hermes production tasks, blockers, owners, and due dates. |
| Artifacts/files | Stores manuscript, proof, cover, package, import, and evidence attachments with version references. |
| CRM/company workspace | Keeps client/org context and commercial ownership visible. |
| Portal shell | Shows only reviewed artifact promotions when the module is enabled. |
| Admin org settings | Future module switch and permissions live alongside other client portal modules. |

## Review Scenarios

A future implementation demo should prove the operator model with these cases after approval:

| Scenario | Must prove |
| --- | --- |
| Business nonfiction project | Intake derives gates before drafting, research links to the brief, and the next safe action is visible at every stage. |
| Market evidence gate | Candidate reaches pass/warn/block before Book Brief; weak candidates block without sales or rank promises. |
| Activity/low-content warning case | Kindle/print/channel suitability warnings block upload-ready claims until resolved or explicitly waived. |
| Series scaffold | The operator sees volume order, continuity, and future-volume warnings without treating the full series as approved. |
| Public-domain/companion block | The blocker lane stops production and gives a safe internal/client explanation. |
| Hermes recommendation | Hermes output lands as a reviewable artifact or task, not a final client-visible action. |
| KDP pass and Google warning | One channel packet can be approved without marking the other channel ready. |
| Manual analytics import | Partial reports remain confidence-labeled and do not become a single revenue claim. |

## Devil's Advocate

- If the index emphasizes "create with AI", operators will skip evidence and use Book Studio as a prompt wrapper.
- If the workspace emphasizes compliance tables only, operators will avoid it and run the real work in chats and files. The command center needs useful next actions.
- If every lane becomes a tab with its own local state, Book Studio will duplicate PiB's existing Research, Documents, Projects, and artifact systems.
- If commands are visible before preconditions are met, the UI will teach operators that warnings are optional.
- If the decision log is not readable by non-developers, approvals and waivers will exist but not be operationally trustworthy.
- If portal status is a passive mirror of admin state, clients will see uncertainty before PiB has interpreted it.

## Current Review State

This model supports the existing V1 approval gate by clarifying how operators should control Book Studio work after approval. It does not authorize implementation, UI design, route naming, component work, schema mapping, Hermes runtime dispatch, direct publishing, analytics automation, or a Phase 1 task list.

The next product decision remains Peet approving, revising, rejecting, or requesting more design detail on the Book Studio V1 approval record.
