# YouTube Studio operator/client SOPs, onboarding, and demo-data plan

Date: 2026-06-09
Owner: Iris / docs
Project: YouTube Module Production Reality Sprint (`YwVaYJ2N2LvLfnE4ePs3`)
Task: Iris P2 SOP/onboarding/demo plan (`I9C5wEUXElER5lcG52w0`)
Status: Internal operating documentation. Safe for product/demo preparation. Not a production release approval.

## 1. Purpose and boundaries

This document turns the approved YouTube Studio production cockpit into a repeatable operating model for PiB operators, client reviewers, pilot/demo setup, and future seed scripts.

YouTube Studio V1 is a controlled production module:

- PiB admins/operators run channel setup, strategy, production, packet readiness, and publishing control.
- Hermes jobs create reviewable artifacts and lifecycle comments only.
- Clients can request videos, upload/reference source material, comment, approve, request changes, and view client-safe analytics when the portal module is enabled.
- Public publishing, scheduled publishing, paid promotion, credential/account changes, and production deployment remain separate approval gates.
- Large media, raw credentials, binary files, and private storage paths do not belong in Firestore, wiki notes, or client-safe surfaces.

## 2. Roles and permission model

| Role | Primary use | Allowed in V1 | Not allowed in V1 |
| --- | --- | --- | --- |
| PiB admin/operator | Runs workspace and final gates | Create channel workspaces, define strategy, add source-asset metadata, create videos/series/drafts/packets/release plans, dispatch governed Hermes jobs, import analytics, approve internal packets, execute manual handoff/private API release only when readiness gates pass | Production deploy, main merge, secret/config changes, public/client-visible publish without explicit readiness evidence and approval |
| Hermes specialist | Bounded production work | Generate channel strategy, ideation, research brief, script, clipping plan, captions, thumbnail brief, metadata, chapters, compliance/readiness, analytics diagnosis, next-series recommendations as artifacts/comments | Mutate packet approval, schedule, visibility, release plan, live YouTube state, connected-account state, or client-visible output directly |
| Client owner/admin | Review and supply input | Submit video requests, provide source URLs/context, upload/reference approved footage through supported intake, comment, approve/reject visible drafts/packets, view status and summaries | Public publish, connect/change YouTube credentials, override rights/disclosure/made-for-kids/readiness gates, see internal notes/storage paths/execution IDs |
| Client member | Collaborate on production | Request videos, comment, provide context, approve only if org policy allows | Same restrictions as client owner, plus no policy/permission changes |
| Client viewer | Visibility only | View enabled portal workspace, visible production state, published/live summaries | Create requests, approve, upload, comment, or change settings |
| Quinn/QA reviewer | Release/readiness review | Run permission tests, publish-gate smoke checks, policy/error-path checks, large-media evidence checks, client-safe reporting checks | Promote production or publish unless separate release approval exists |

Minimum permission defaults:

- Portal module switch `settings.portalModules.youtubeStudio` defaults disabled until onboarding is approved.
- Client portal write access starts at member level; approval ability should be policy-gated by client role and packet/draft visibility.
- Connected-account and credential metadata are admin-only; portal never receives credential refs, token hints, raw storage paths, raw transcripts unless explicitly client-visible, internal risk notes, or execution IDs.
- Final publish execution requires PiB admin gate plus system readiness. Client approval alone is not enough.

## 3. Operator SOP: connect channel workspace

Goal: create a tenant-safe YouTube channel workspace and make its readiness state explicit before any production work is promised.

Preflight:

1. Resolve the client organisation id and confirm the admin workspace is scoped to that org.
2. Confirm this is the intended client/org before reading or writing module records.
3. Confirm portal visibility should remain disabled until the operator has checked strategy, permissions, and demo/pilot readiness.
4. Confirm no credential, OAuth, or production config change is being performed unless separately approved.

Steps:

1. Create or open the YouTube Studio workspace for the org from `/admin/org/[slug]/youtube-studio`.
2. Create the channel workspace with:
   - channel display name,
   - channel handle or external channel id when known,
   - owner org id,
   - status `setup` or `strategy`,
   - publishing mode default `manual_handoff`,
   - connected-account readiness as `not_connected` or exact safe state,
   - quota/compliance status as `unknown` until verified.
3. Record channel strategy shell before production starts:
   - target audience,
   - offer/positioning,
   - content pillars,
   - upload cadence,
   - avoid list,
   - compliance/claims notes,
   - brand and visual rules,
   - approval policy,
   - publishing policy.
4. Confirm readiness gates are visible:
   - connected account,
   - rights/source ownership,
   - AI/synthetic disclosure,
   - made-for-kids status,
   - metadata complete,
   - thumbnail/caption status,
   - client/internal approval,
   - quota/compliance state,
   - packet latest-version state.
5. If a channel has no approved strategy or missing readiness fields, keep it in setup/strategy and do not mark it publish-ready.

Evidence to leave:

- Channel workspace id and org id.
- Strategy status and missing fields.
- Whether portal module is disabled/enabled.
- Whether connected account is real, manual-only, or not connected.
- Explicit statement that no live YouTube mutation occurred unless a separately approved publish proof exists.

## 4. Operator SOP: define channel strategy

Goal: create the reusable source of truth for every video, packet, and Hermes job.

Required strategy sections:

1. Audience: buyer/user/persona, geography, language, decision stage, pain points.
2. Business objective: awareness, education, lead generation support, client onboarding, support deflection, social proof, or sales enablement.
3. Offers and CTAs: approved offers, banned offers, URLs, lead capture rules, disclaimer requirements.
4. Content pillars: 3-6 recurring themes with sample topics.
5. Series map: recurring formats, cadence, target duration, hook pattern, structure template, thumbnail style, intro/outro rules.
6. Brand rules: tone, vocabulary, visual style, logo/lower-third rules, caption style, do/don't examples.
7. Compliance and claims: regulated statements, proof requirements, client-sensitive topics, testimonial/rights constraints, competitor mention rules.
8. AI policy: synthetic/altered content disclosure rules, AI voice/image/clip usage, client confirmation needed.
9. Approval policy: who can approve, what requires client approval, what requires PiB internal approval, escalation route.
10. Publishing policy: default visibility, manual/API mode, scheduling windows, embargoes, rollback/takedown owner, public publish gate.
11. Analytics policy: reporting cadence, metrics source, freshness labels, client-safe summary rules, next-action conversion rules.

Operator checklist before first production video:

- Strategy owner assigned.
- Client-facing sections reviewed for safe wording.
- Avoid list and proof requirements captured.
- Hermes job packets can reference strategy without exposing internal-only notes to clients.
- Default templates selected for video brief, script, thumbnail brief, metadata, captions, readiness, and analytics recommendation.

## 5. Approval policy

Approval is layered. A lower-level approval never substitutes for a higher-risk gate.

| Approval layer | Required before | Required evidence |
| --- | --- | --- |
| Strategy approval | Starting recurring production or enabling portal demo for a real client | Strategy version/date, approver, unresolved assumptions |
| Client draft approval | Moving a draft/render/packet out of client review | Client identity, artifact id/version/hash, decision, requested changes if any |
| Internal packet approval | Creating a publish-ready packet | Latest packet id/version, approver identity, no blocking checks, immutable audit id |
| Publish execution approval | Manual handoff/private API upload/scheduled/public publish | Release plan id, approved packet, readiness report, target visibility, connected account/quota state, explicit publish mode approval |
| Production release approval | Deploying/promoting module changes | Quinn/Pip release evidence, test/build proof, no open P0 gates, explicit release instruction |

Rules:

- Client approval does not authorize public publishing.
- Admin approval does not override blocking readiness checks.
- Superseded packets cannot be published.
- Open change requests keep publish locked.
- Approval snapshot hashes must represent the client-visible approval substance, not mutable UI copy only.
- Any ambiguity about rights, AI disclosure, made-for-kids, brand safety, factuality, or client publish power becomes a blocker, not a note.

## 6. Publishing policy

Default V1 publishing posture:

1. Manual handoff is the safest default and should remain available for every pilot.
2. Private API upload is allowed only after connected-account and packet gates pass.
3. Scheduled/public publish requires a separate explicit approval and should not be treated as a default demo action.
4. YouTube quota or compliance audit issues create a first-class blocker and manual handoff path.
5. Paid YouTube ads remain outside this module; the module may create ad-ready assets, not launch or spend.

Publish packet must include:

- title,
- description,
- tags,
- category,
- visibility target,
- schedule timestamp if scheduled,
- thumbnail reference,
- captions/chapters status,
- made-for-kids declaration,
- AI/synthetic disclosure declaration,
- rights/source ownership notes,
- factuality/claims proof notes,
- client approval evidence when client-facing,
- internal approval evidence,
- latest-version/supersession status,
- release mode and fallback plan.

Stop conditions:

- Missing connected account for API modes.
- Quota/compliance status `quota_limited`, `audit_required`, `blocked`, or unknown for API modes.
- Any packet check is `block`.
- Missing or stale approval evidence.
- Packet is not latest version.
- Open change request exists.
- Public/scheduled action requested without explicit publish-mode approval.

## 7. Brand rules and default templates

Brand rules to capture per channel:

- Brand voice: tone, directness, level of humour, forbidden phrases.
- Visual system: logo, colours, type, lower-third, thumbnail layout, caption style, end-card style.
- Content rules: pillar list, banned topics, competitor language, claim/proof threshold.
- Accessibility rules: captions required, contrast requirement, no unreadable text, alt/title considerations for thumbnails.
- Localisation: language, spelling, currency, dates, regional references.
- CTA rules: approved links, disclaimers, lead magnet language, no unsupported promises.

Default operator templates:

Video brief template:

- Objective
- Audience
- Topic
- Why now
- Video type
- Target length/aspect ratio
- Hook options
- Story arc
- Required assets
- Claims to verify
- Approval requirements
- Due date/release target

Script template:

- Hook
- Problem/context
- Core teaching/demo/story
- Proof/example
- CTA
- On-screen notes
- B-roll/source references
- Disclosure notes

Clipping plan template:

- Source asset
- Target clip count
- Duration range
- Candidate timestamp range
- Hook line
- Why this clip matters
- Crop/aspect guidance
- Caption/title idea
- Rights/disclosure risk

Thumbnail brief template:

- Thumbnail concept
- Primary emotion/message
- Text overlay
- Subject/image reference
- Brand styling
- Accessibility/contrast notes
- Variants requested

Metadata template:

- Primary title
- Backup titles
- Description
- Tags
- Chapters
- Category
- Hashtags
- CTA link
- Disclosure/made-for-kids notes

Readiness template:

- Rights/source ownership
- AI/synthetic disclosure
- Made-for-kids
- Brand safety
- Factuality/proof
- Thumbnail/captions/chapters
- Metadata complete
- Client approval
- Internal approval
- Connected account/quota
- Latest packet and no open changes

Analytics recommendation template:

- Observation
- Metric/source/freshness
- Interpretation confidence
- Recommended action type: task, brief, clip idea, script change, series experiment
- Owner
- Client-visible summary
- Evidence link

## 8. Client onboarding flow

Client onboarding is a guided setup, not a credential hunt.

Step 1: Welcome and boundaries

- Explain what YouTube Studio does: request, produce, review, approve, and report on YouTube work.
- Explain what it does not do by default: public publish without PiB gate, paid ad launch, unrestricted AI generation, credential changes by portal users.

Step 2: Channel context

Collect:

- Channel URL/handle if existing.
- Business objective for YouTube.
- Priority audiences.
- Top offers/CTAs.
- Existing series or content formats.
- Competitor/example channels they like or dislike.
- Approved website/landing-page links.

Step 3: Brand rules

Collect:

- Voice/tone examples.
- Visual references.
- Logo/brand assets via approved storage, not chat/wiki binaries.
- Words/topics to avoid.
- Compliance or factual claim constraints.
- Testimonial/rights restrictions.

Step 4: Approval policy

Collect:

- Who approves drafts.
- Who approves final packets.
- Which decisions can be made by PiB without client review.
- Expected review turnaround.
- Escalation contact.

Step 5: Publishing policy

Collect:

- Default visibility preference: private, unlisted, scheduled, public.
- Publishing windows and embargoes.
- Whether PiB manual handoff or API upload is preferred.
- Who owns rollback/takedown decisions.
- Any legal/compliance review needed before public release.

Step 6: First video or pilot request

Collect:

- Video goal.
- Topic/source.
- Target format: Short, long-form, series episode, ad-ready asset.
- Required source material.
- Due date.
- What must be client-approved before production continues.

Step 7: Portal enablement

- Enable `youtubeStudio` portal module only after operator validates role permissions, visible sample records, and client-safe field shaping.
- Provide client with a short use guide: request a video, review a draft, approve/request changes, view analytics.

## 9. Client SOP: request, review, approve

Request a video:

1. Open Portal > YouTube Studio.
2. Choose Request video.
3. Select channel/series where applicable.
4. Fill in goal, topic, audience, preferred format, due date, source URL/context, and approval needs.
5. Upload or reference source material only through approved upload/storage flows.
6. Submit. PiB will convert it into production tasks and drafts.

Review a draft:

1. Open the visible video or draft in Portal > YouTube Studio.
2. Check the requested decision: approve, request changes, supply footage, confirm disclosure, or confirm factual accuracy.
3. Comment on specific issue(s), not generic feedback where possible.
4. If requesting changes, state what should change and what proof/input is attached.
5. Approve only when title, script/draft, thumbnail direction, factual claims, and disclosure notes are acceptable.

View analytics:

1. Treat analytics as delayed/partial unless marked fresh and API-imported.
2. Review client-safe summary and next recommended action.
3. Approve converting recommendations into follow-up videos/tasks only when scope and priority are clear.

## 10. Operator SOP: production flow

1. Confirm channel strategy exists and is current.
2. Create or link a series if the work is recurring.
3. Create a video project from client request, source asset, research brief, or operator brief.
4. Add/source durable asset references; never store large binary data in Firestore/wiki.
5. Dispatch Hermes jobs only with locked input packets and clear expected artifacts.
6. Review artifacts before applying them to drafts/packets.
7. Create production drafts for brief/script/storyboard/edit notes.
8. Move client-safe drafts to client review when ready.
9. Capture comments/suggestions/approvals and produce a new version or change request when needed.
10. Create publish packet only from reviewed artifacts.
11. Run readiness checks; resolve or block every required gate.
12. Create release plan with manual handoff/private API/scheduled/public mode as approved.
13. Execute only allowed mode after readiness passes.
14. Import analytics after publish/live proof and convert recommendations into tasks/briefs, not silent mutations.

## 11. Demo and pilot data plan

Demo data must show the module cleanly without creating real client-visible output, touching YouTube, or exposing client-private assets.

Recommended demo org:

- Use a controlled internal/demo org, not a real client unless Peet explicitly approves.
- Suggested demo identity: `PiB Demo Channel Studio` or a similar clearly fake/internal name.
- Do not use real prospect/client names, real credential refs, real private storage paths, or actual YouTube publish actions.

Minimum demo dataset:

1. Organisation and portal module state:
   - demo org id,
   - `portalModules.youtubeStudio: true`,
   - safe member/admin/viewer role fixtures.
2. Channel workspaces:
   - one healthy strategy-ready channel,
   - one blocked/risk channel showing reconnect/quota/disclosure blocker.
3. Strategy data:
   - audience,
   - content pillars,
   - upload cadence,
   - brand rules,
   - approval policy,
   - publishing policy.
4. Series:
   - one weekly tips series,
   - one client-story or demo walkthrough series.
5. Video projects:
   - one client-requested Short in intake,
   - one long-form explainer in production,
   - one draft in client review,
   - one publish-ready but not executed packet,
   - one live/manual-handoff example with analytics summary.
6. Source assets:
   - safe source URL examples,
   - transcript/document metadata examples,
   - placeholder storage/artifact ids clearly marked demo and non-sensitive,
   - no inline binaries.
7. Clip candidates:
   - 3-5 timestamped demo clips with hook/reason/crop notes.
8. Production drafts:
   - video brief,
   - outline/script,
   - thumbnail brief,
   - metadata draft.
9. Render jobs:
   - one queued/edit-package job,
   - one completed placeholder output linked to a safe demo artifact id.
10. Publishing packet:
   - metadata complete,
   - client/internal approval examples,
   - readiness checks all pass for manual handoff/private demonstration,
   - at least one blocked packet to show gate enforcement.
11. Release plans:
   - manual handoff completed example,
   - private API upload queued/ready example with no real provider call in demo seed,
   - scheduled/public blocked example.
12. Agent jobs:
   - one completed research/strategy artifact,
   - one completed metadata artifact,
   - one waiting-for-review artifact,
   - one failed/cancelled/retry lifecycle example.
13. Analytics snapshots:
   - one API-imported/fresh style summary,
   - one delayed/partial example,
   - recommendations with action types: task, brief, clip_idea, script_change, series_experiment.

Demo walkthrough order:

1. Open admin command center and show filters/queues/risks.
2. Open healthy channel and show strategy, series, assets, approvals, analytics, and settings.
3. Open video cockpit and show brief, script, clips, thumbnail, metadata, review, publishing, analytics.
4. Show client portal: request video, review draft, approve/request changes, view analytics.
5. Show publishing packet readiness and explain why client approval does not equal public publish.
6. Show blocked channel/packet to prove safety gates fail closed.

## 12. Seed-flow requirements

Seed scripts/routes should be internal-only, idempotent, tenant-scoped, and non-destructive.

Required safeguards:

- Require admin auth plus `X-Org-Id` or explicit org id.
- Reject production/live client orgs unless a `demoSeedApproved` flag or explicit allowlist is present.
- Use deterministic ids or idempotency keys so reruns update known demo records instead of duplicating rows.
- Never seed raw secrets, OAuth tokens, live credential refs, private storage paths, public publish state, real YouTube video ids, real client names, or binary media.
- Mark every seeded record with safe metadata such as `demo: true`, `seedBatchId`, `seededBy`, `seededAt`, and `source: 'demo_seed'` where the model supports it.
- Keep cleanup non-destructive by soft-archiving seeded records or targeting only records with the matching `seedBatchId`.
- Support dry-run output listing create/update/archive actions before writing.
- Log what was created/updated and keep the public/client-visible/send/publish/spend/secret/destructive gates closed.

Suggested seed flow:

1. Validate caller and org scope.
2. Validate demo org allowlist.
3. Upsert organisation module setting for YouTube Studio demo visibility.
4. Upsert demo channel workspaces.
5. Upsert strategies/policies/brand rules on channel records.
6. Upsert series.
7. Upsert video projects.
8. Upsert source assets, clip candidates, production drafts, render jobs.
9. Upsert agent-job lifecycle examples.
10. Upsert publishing packets and release plans.
11. Upsert analytics snapshots and recommendations.
12. Return a demo walkthrough manifest with admin and portal routes, seeded ids, and blocked/safe proof points.

Acceptance criteria for the seed flow:

- Dry run returns the exact record plan without writes.
- Write run is idempotent across at least two executions.
- Portal GET returns only client-safe seeded fields.
- Blocked packet remains blocked in publish readiness.
- No provider publish/upload/send/spend operation is called.
- No raw secrets or binaries are accepted.
- Seed cleanup affects only matching demo records and never touches non-demo records.

## 13. Release/QA handoff checklist for Quinn

Before release-readiness review, Quinn should be able to verify:

- Operator SOP covers connect channel, strategy, approvals, publishing, brand rules, templates, permissions.
- Client SOP covers request/review/approve/analytics without implying publish power.
- Demo data requirements include healthy, blocked, client-review, publish-ready, live/manual, analytics, and agent lifecycle states.
- Seed requirements are idempotent, demo-only, dry-run capable, tenant-safe, and no-side-effect.
- Portal visibility and role permissions are explicit.
- Public publishing, production deployment, client-visible sending, spend, finance, secret/config, and destructive operations remain approval-gated.

## 14. Open implementation follow-ups

These are requirements for future implementation, not actions completed by this document:

1. Add the internal seed script/route with dry-run/idempotency/allowlist safeguards.
2. Add a demo walkthrough manifest route or doc generator so Sales/Peet can demo the module consistently.
3. Add tests proving demo seed does not leak internal fields to portal surfaces.
4. Add tests proving seeded blocked packet cannot be published.
5. Add a small client-facing help panel or onboarding copy inside the portal once Peet approves wording for client visibility.
6. Add admin checklist UI if the command center needs a guided setup wizard rather than documentation-only SOPs.

## 15. Non-actions in this task

This documentation task did not approve or perform:

- production deployment,
- main merge,
- Vercel preview/production promotion,
- live YouTube upload or public publish,
- OAuth/secret/config changes,
- client-visible send or publish,
- paid ads/spend,
- finance/billing changes,
- destructive deletion or live backfill.
