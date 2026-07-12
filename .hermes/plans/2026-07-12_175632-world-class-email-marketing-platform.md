# World-Class Email Marketing, Lifecycle, Capture, and Sales Handoff Implementation Plan

> **For Hermes:** Implement this plan with `subagent-driven-development`, one bounded task at a time. Keep database migrations backward compatible, run focused tests after every task, and do not enable real outbound sending until the release gates in Task 14 pass.

**Goal:** Turn `/portal/marketing` into a world-class, multi-organisation email growth platform that covers broadcasts, newsletters, lifecycle sequences, CRM-triggered automations, dynamic personalisation, lead capture, deliverability, analytics, and marketing-to-sales handoff—including campaigns that are centrally created but sent under an eligible salesperson identity with replies, leads, attribution, and follow-up routed back to that salesperson.

**Architecture:** Keep Resend/SES, Firestore, CRM, sequence, broadcast, email-builder, capture, preference, suppression, and analytics foundations that already work. Introduce a canonical email-program contract and shared services around the currently fragmented `campaigns`, `broadcasts`, `sequences`, `communications_campaigns`, and `emails` shapes. Make audience snapshots, consent, sender identity, approval, message events, replies, and attribution first-class records. Use adapters so existing records and routes continue to work while UI and agents converge on one Marketing Studio.

**Tech stack:** Next.js App Router, React, TypeScript, Firestore/Firebase Admin, Resend with SES fallback, Resend inbound routes and Svix verification, Twilio for SMS, Vercel AI Gateway, existing PiB CRM/analytics infrastructure, Jest/React Testing Library, browser smoke tests, policy-driven Hermes agent skills.

---

## 1. Repository-grounded audit

### What already exists and should be retained

1. **One-time campaigns and broadcasts**
   - `lib/broadcasts/types.ts` has audience targeting, scheduling, per-org sender fields, A/B testing, preference topics, local-time delivery, and send stats.
   - `lib/broadcasts/send.ts` performs idempotency checks, suppression/preference/frequency gates, merge interpolation, conditional rendering, A/B selection, List-Unsubscribe, audit writes, and CRM activity logging.
   - `components/campaigns/NewEmailCampaignWizard.tsx`, `EmailCampaignEditor.tsx`, and `CampaignReviewPanel.tsx` provide a settings wizard, block editor, test send, client previews, basic preflight, immediate launch, and scheduling.

2. **Lifecycle sequences**
   - `lib/sequences/types.ts` already models email/SMS steps, branching, goals, wait-until conditions, reply exits, A/B testing, topics, and traversal history.
   - `components/email/SequenceBuilder.tsx` and `SequenceStepBuilder.tsx` provide a visual sequence workflow.
   - Sequence cron and enrollment APIs already enforce launch-readiness and communication preferences.

3. **CRM automations**
   - `lib/automations/types.ts` and `/portal/settings/automations` support six CRM triggers and actions such as email, owner assignment, webhook, sequence enrollment, tags, and segments.
   - CRM has company/account ownership and member references that can seed salesperson routing.

4. **Authoring and personalisation**
   - The block editor supports hero, heading, paragraph, button, image, divider, spacer, columns, footer, themes, desktop/mobile previews, and simulated client rendering.
   - Template interpolation supports contact fields and custom fields; conditional content and reusable email templates are present in the wider email-builder stack.

5. **Capture and audience**
   - `components/capture-sources/CaptureSourcesWorkspace.tsx` supports forms, APIs, CSV, integrations, manual sources, public keys, embeds, auto-tags, sequence/campaign enrollment, redirects, and explicit consent switches.
   - CRM segments, tags, contacts, preference topics, suppressions, frequency caps, double opt-in, and list-health utilities exist.

6. **Compliance and deliverability**
   - Per-org domain verification exists.
   - `lib/email/provider.ts` emits RFC 8058 `List-Unsubscribe` and `List-Unsubscribe-Post` headers.
   - Public one-click unsubscribe, topic preferences, hard/soft bounce handling, complaint suppression, and production-fail-closed Svix webhook verification exist.
   - Resend and SES event ingestion paths exist.

7. **Analytics**
   - `components/email-analytics/EmailAnalyticsDashboard.tsx` already exposes overview, engagement, broadcasts, sequences, cohorts, revenue, send-time matrix, industry benchmarks, and an admin leaderboard.
   - Per-broadcast and per-sequence detail pages and tests exist.

8. **Agent enablement**
   - `.claude/skills/email-outreach/SKILL.md` already documents most current email capabilities and APIs.
   - `config/agent-skill-policy.json` mounts `email-outreach` on Maya, Blake/Sales, Nora, Support, QA, and Theo, with `message_client` approval gates.

### Gaps that prevent a world-leading product

1. **Fragmented product model and navigation**
   - `campaigns` contains incompatible email-program and content-engine documents.
   - Email-builder fields are persisted but explicitly absent from `lib/campaigns/types.ts`.
   - Broadcasts, email campaigns, sequences, CRM automations, communications campaigns, templates, inboxes, analytics, domains, preferences, and suppressions live on separate surfaces with overlapping concepts.
   - Portal users see only five “Email and capture” cards even though the product has substantially more capability.

2. **No first-class salesperson sender strategy**
   - `lib/email/resolveFrom.ts` resolves only a fixed display name/local part/domain. It does not resolve a salesperson, contact owner, company account manager, connected mailbox, eligibility, delegation, reply route, or per-recipient fallback.
   - Campaign and broadcast records store scalar sender strings rather than an auditable sender identity and strategy.
   - Bulk marketing and low-volume 1:1 mailbox sending are not explicitly separated.

3. **Replies are not a complete sales workflow**
   - Inbound tracking exists, but campaign replies are not consistently assigned into a salesperson-owned CRM conversation, SLA queue, task, notification, and sequence-exit workflow.
   - Analytics do not make reply rate, positive reply rate, booked meeting, opportunity, pipeline, and revenue per salesperson first-class campaign outcomes.

4. **Campaign authoring is capable but not yet best-in-class**
   - Missing or incomplete: searchable merge-field browser with fallbacks, per-recipient preview, saved sections/snippets in the campaign editor, brand-lock controls, comments/version history, approvals, accessibility checker, real broken-link validation, spam/content checks, inbox screenshot integration, undo/redo, autosave/conflict handling, and complete template/category discovery.

5. **Audience planning is too shallow**
   - The new-campaign wizard supports one segment, one tag, or selected contacts plus manual exclusions, but not nested AND/OR filters, estimated reach by consent/eligibility, inclusion/exclusion groups, company/deal/owner filters, behavioural events, engagement windows, predictive scores, holdouts, or reusable audience versions.
   - Audience membership is not frozen and explainable at approval/send time.

6. **Automation coverage is narrow**
   - CRM automations expose only six trigger events and mostly linear action chains.
   - Missing: website/product/email events, form-specific events, date/anniversary triggers, recurring schedules, inactivity, page visits, score changes, consent changes, reply events, branches, reusable subflows, goals, re-entry policies, concurrency guards, quiet hours, contact-local timing, workflow versioning, dry runs, and execution analytics.

7. **Capture is an intake manager, not a conversion suite**
   - Missing: visual form and landing-page builders, popups/slide-ins/banners, multi-step forms, exit intent, progressive profiling, hidden attribution fields, conversion experiments, field mapping UI, consent copy/version receipts, locale-aware double opt-in, bot and disposable-address reporting, abandonment analytics, and source-to-revenue reporting.

8. **Analytics can overstate opens and understate business outcomes**
   - Current UI treats opens as ordinary truth; Apple Mail Privacy Protection and machine opens need filtering or explicit “estimated/human” labelling.
   - The aggregate model needs unique-vs-total events, click-detail/link maps, complaint rate, deferral, provider response, inbox placement signals, reply sentiment, funnel conversion, owner attribution, and cohort confidence/sample-size treatment.
   - A durable idempotent event ledger is required instead of relying primarily on mutable email status fields and aggregate counters.

9. **Approval and governance are inconsistent across email surfaces**
   - The campaign review panel can launch after a browser confirm. It does not consistently enforce organisation policy, maker-checker approval, audience-delta review, sender authorisation, legal basis, quiet hours, rate limits, or agent `message_client` evidence.

10. **Agent policy is close but incomplete**
   - Pip, the front-door operator, does not currently have `email-outreach` even though Pip must route and inspect this domain.
   - Vera/Data has analytics skills but not a focused email-performance operating contract.
   - The skill describes many advanced features, but some route/model details have drifted and agents need explicit sender-strategy, approval, dry-run, and read-vs-send workflows.

---

## 2. Product principles and scope boundaries

1. **One Marketing Studio, multiple job modes**
   - Broadcast, newsletter, promotion, announcement, sequence, sales nurture, transactional notice, RSS digest, and capture journey are clear templates on one surface—not unrelated modules users must discover.

2. **Organisation isolation by construction**
   - Every program, sender identity, audience, template, capture surface, consent record, event, attribution record, and agent action carries `orgId` and is authorised server-side.

3. **Marketing creates; sales can own the relationship**
   - A marketer may author and approve centrally while each recipient resolves to an eligible salesperson sender and reply owner.
   - The exact resolved sender is snapshotted per message for audit and analytics.

4. **Bulk marketing is not disguised mailbox outreach**
   - Broadcasts and high-volume lifecycle sends go through the organisation’s authenticated ESP domain.
   - Connected Gmail/Workspace mailboxes are reserved for explicitly authorised low-volume, human-like 1:1 steps with provider quota and policy controls.
   - “From Alex” can mean display identity plus `alex@verified-company-domain` and reply routing through Alex without abusing Alex’s Gmail SMTP.

5. **Consent and suppression are send-time gates, not UI hints**
   - UI previews explain eligibility, but the send executor rechecks consent, suppression, frequency, sender, legal, and approval gates immediately before provider dispatch.

6. **Business outcomes outrank vanity metrics**
   - Prioritise delivered, human click, reply, positive reply, booking, qualified lead, opportunity, pipeline, revenue, unsubscribe, complaint, bounce, and cost.
   - Report opens as privacy-affected/estimated where appropriate.

7. **Agents draft and operate safely; humans approve external sends**
   - Agents may research, segment, draft, create templates/programs, simulate, preflight, and report without sending.
   - Any client-visible send, activation, or material audience expansion requires policy-backed approval evidence.

8. **No big-bang rewrite**
   - Add canonical contracts and adapters, migrate reads first, dual-write only where necessary, backfill, then retire legacy paths after parity and reconciliation.

---

## 3. Target user journeys

### Journey A — Organisation newsletter
A marketer chooses “Newsletter,” selects a reusable audience, uses a brand-approved template, inserts dynamic fields with fallbacks, previews named sample contacts, runs preflight, requests approval, schedules by contact timezone, and watches delivery/click/revenue analytics.

### Journey B — Marketing-created, salesperson-owned campaign
A marketer creates one campaign and chooses `senderStrategy = contact_owner`. The system previews recipient counts by salesperson, flags contacts with no eligible owner, applies an approved fallback, renders each message with that salesperson’s display name/address/signature, routes replies and notifications to that person, pauses relevant sequence enrolments on reply, creates CRM activities/tasks, and attributes meetings/pipeline/revenue to campaign and salesperson.

### Journey C — Account-based sales outreach
A sales manager selects target companies/deals, assigns account owners, launches a low-volume multi-step sequence, uses mailbox mode only for authorised 1:1 steps, stops on reply/meeting/stage goal, and sees account coverage and owner performance without duplicate touches.

### Journey D — Lead capture to nurture to human follow-up
A marketer publishes a form/popup/landing page with UTM and consent tracking. A contact is deduplicated, double-opted-in where required, scored/tagged, enrolled into a journey, and assigned to sales when qualified. Source, message engagement, reply, deal, and revenue remain linked.

### Journey E — Behavioural lifecycle automation
A marketer starts from “Welcome,” “Trial conversion,” “Abandoned enquiry,” “Renewal,” “Win-back,” or “Re-engagement,” defines event/segment triggers and branches, simulates test contacts, activates an immutable workflow version, and compares conversion against a holdout.

### Journey F — Agent-assisted operation
Peet asks Maya to build a campaign, Blake to define the sales audience and ownership, Vera to inspect performance, or Pip to coordinate. Agents create drafts and preflight evidence through APIs; external send remains approval-gated; the selected salesperson identity is never guessed.

---

## 4. Canonical domain design

### 4.1 Email program

Create `lib/email-marketing/types.ts` with a canonical `EmailProgram` contract:

- `kind`: `broadcast | newsletter | lifecycle | sales_sequence | transactional | rss`
- `status`: `draft | in_review | approved | scheduled | active | paused | completed | cancelled | failed`
- `contentVersionId`, `workflowVersionId`, `audienceVersionId`
- `senderPolicyId`, `replyPolicyId`, `preferenceTopicId`
- `approvalPolicy`, `approvalState`, `legalBasisPolicy`
- `schedulePolicy`, `frequencyPolicy`, `experimentPolicy`
- links to campaign/project/deal/company/source records
- creator/updater actor refs and immutable launch snapshot

Use adapters for existing campaign, broadcast, sequence, RSS, and communications records. Do not immediately combine all Firestore collections.

### 4.2 Sender identities and policies

Create records under `email_sender_identities` and `email_sender_policies`.

`EmailSenderIdentity`:

- organisation and user/member references
- display name, local part, email address, reply-to
- verified domain id and optional connected mailbox account id
- modes: `esp_domain | connected_mailbox`
- allowed purposes: `marketing_bulk | lifecycle | sales_1to1 | transactional`
- signature/template defaults
- verification, delegation, enabled, health, quota, and last-check state

`EmailSenderPolicy.strategy`:

- `organisation_default`
- `fixed_identity`
- `campaign_creator`
- `contact_owner`
- `company_account_manager`
- `deal_owner`
- `round_robin_pool`

Policy also defines fallback identity, no-owner behaviour (`exclude | fallback | block`), reply routing, and whether a mailbox mode is permitted.

Create `resolveSenderForRecipient()` in `lib/email-marketing/sender-resolution.ts`. It must verify same-org membership, role/delegation, identity status, domain status, purpose, quotas, and fallback. Persist `senderResolution` on every `emails` document.

### 4.3 Audience versions and eligibility

Create immutable `email_audience_versions` with:

- nested filter tree
- inclusion and exclusion sources
- resolved-at timestamp and counts
- eligible/excluded counts by reason
- contact snapshot ids or chunk references
- consent/topic/suppression/frequency checks
- owner/sender distribution
- source definition hash and audience delta from prior approval

Recheck volatile gates at dispatch while preserving the approved snapshot for audit.

### 4.4 Message event ledger

Create append-only `email_events` with deterministic idempotency keys:

- org, message, program, contact, sender identity, provider ids
- event: queued, attempted, sent, delivered, deferred, opened, machine_opened, clicked, replied, positive_reply, bounced, complained, unsubscribed, converted
- provider timestamp, received timestamp, URL/link id, user agent/privacy classification, bounce class, metadata
- unique-event derivation fields

Webhook handlers append events and project current state/rollups. Reconciliation jobs compare provider events, `emails`, and aggregates.

### 4.5 Reply and sales handoff

Create `email_reply_routes`/routing service that:

- matches inbound message/thread/provider ids to the outbound message and sender snapshot
- resolves assigned salesperson and fallback queue
- creates/updates a Communications conversation
- logs contact/company/deal CRM activity
- pauses/exits matching enrolments when policy says `stopOnReply`
- creates task/notification with configurable SLA
- classifies reply intent as assistive metadata, never silently auto-sends a response
- exposes reply, positive reply, meeting, and opportunity attribution

### 4.6 Consent ledger

Create append-only `contact_consent_events`:

- org/contact/channel/topic
- state and legal basis
- source/capture version/form copy version
- locale, jurisdiction, timestamp, IP/user agent hashes where lawful
- double-opt-in request/confirmation
- policy version and proof reference

The projected preference record remains fast read state; the ledger is audit truth.

---

## 5. Implementation tasks

### Task 0 — Protect the current dirty work and establish baselines

**Current unrelated modified files:**

- `__tests__/lib/conversations-list.test.ts`
- `__tests__/lib/conversations/access.test.ts`
- `app/api/v1/conversations/[convId]/route.ts`
- `components/chat/ConversationAccessDialog.tsx`
- `lib/conversations/access.ts`

**Steps:**

1. Do not modify, stage, commit, or revert these files as part of email work.
2. Before implementation, follow repo preflight: checkpoint existing work if still dirty, switch/remain on `development`, and rebase from `origin/development`.
3. Capture focused baseline results for email/campaign/sequence/capture tests and typecheck.
4. Create a feature flag `emailMarketingStudioV2` with per-org rollout support.

**Verification:** branch is `development`; unrelated diff is preserved; baseline results are attached to the project task.

---

### Task 1 — Write the canonical product spec and route map

**Create:**

- `docs/specs/email-marketing-platform-v2.md`
- `docs/specs/email-marketing-data-contracts-v2.md`
- `docs/specs/email-marketing-compliance-matrix.md`
- `docs/specs/email-marketing-agent-contract.md`

**Modify:**

- `docs/specs/README.md` or the nearest spec index

**Requirements:**

- Define terminology: program, campaign, broadcast, journey, workflow, message, audience version, sender identity, reply owner.
- Map old routes/collections to canonical concepts and document migration/retirement states.
- Define role/capability matrix for marketer, sales rep, sales manager, admin, analyst, client reviewer, and agent.
- Include POPIA, GDPR/ePrivacy, CAN-SPAM, CASL, Google/Yahoo bulk-sender, and configurable jurisdiction requirements; obtain legal review before claiming universal compliance.
- Define event schemas, attribution windows/models, MPP/machine-open handling, and metric formulas.

**Verification:** architecture and product reviewers approve the spec before schema work.

---

### Task 2 — Add canonical types, adapters, and migration-safe repositories

**Create:**

- `lib/email-marketing/types.ts`
- `lib/email-marketing/adapters.ts`
- `lib/email-marketing/repository.ts`
- `lib/email-marketing/validation.ts`
- `__tests__/lib/email-marketing/adapters.test.ts`
- `__tests__/lib/email-marketing/validation.test.ts`

**Modify:**

- `lib/campaigns/types.ts` to include already-persisted email document, subject, preheader, tag, and exclusion fields—or explicitly mark legacy and adapt it.
- `lib/broadcasts/types.ts`
- `lib/sequences/types.ts` to move the UI-only trigger contract into the shared type.

**Steps:**

1. Add discriminators (`recordType`, `schemaVersion`) to all newly written campaign records.
2. Never infer email-vs-content campaign solely from optional fields after this task.
3. Implement adapters for legacy email campaign, content campaign, broadcast, sequence, and communications campaign.
4. Add repository reads that can return a unified program list without changing send executors.
5. Add backfill/dry-run scripts with counts, invalid-record reports, and idempotency.

**Verification:** adapter fixtures cover every legacy shape; dry-run reports zero cross-org leakage and no destructive writes.

---

### Task 3 — Build sender identity and salesperson resolution

**Create:**

- `lib/email-marketing/sender-types.ts`
- `lib/email-marketing/sender-store.ts`
- `lib/email-marketing/sender-resolution.ts`
- `app/api/v1/email-marketing/sender-identities/route.ts`
- `app/api/v1/email-marketing/sender-identities/[id]/route.ts`
- `app/api/v1/email-marketing/sender-policies/route.ts`
- `app/api/v1/email-marketing/sender-policies/preview/route.ts`
- `components/email-marketing/SenderPolicyEditor.tsx`
- focused API/unit tests

**Modify:**

- `lib/email/resolveFrom.ts` to remain a low-level domain formatter called by the new resolver.
- broadcast/campaign/sequence send contexts to accept a resolved per-recipient sender.
- `emails` writes to store identity, owner, policy, resolution source, fallback reason, and reply owner snapshots.

**Acceptance scenarios:**

- Fixed organisation sender.
- Fixed salesperson sender.
- Contact owner, company account manager, or deal owner sender.
- Round-robin pool with deterministic assignment.
- Missing owner excluded, blocked, or routed to approved fallback exactly as policy says.
- Disabled member, unverified domain, unauthorised mailbox, or exceeded quota cannot send.
- Bulk campaign never silently switches to a personal mailbox.
- Preview shows count and exclusions by resolved salesperson before approval.

**Verification:** table-driven tests cover all strategies, fallbacks, tenant boundaries, permissions, and mailbox/bulk restrictions.

---

### Task 4 — Create immutable audience versions and advanced segmentation

**Create:**

- `lib/email-marketing/audience-types.ts`
- `lib/email-marketing/audience-resolver.ts`
- `lib/email-marketing/audience-snapshot.ts`
- `app/api/v1/email-marketing/audiences/estimate/route.ts`
- `app/api/v1/email-marketing/audiences/versions/route.ts`
- `components/email-marketing/AudienceBuilder.tsx`
- `components/email-marketing/AudienceEligibilityPanel.tsx`

**Modify:**

- `components/campaigns/NewEmailCampaignWizard.tsx`
- existing CRM segment APIs where cursor/pagination or explainability is missing

**Filter support:**

- nested AND/OR groups
- contact fields/custom fields/tags/lifecycle/engagement
- company/account manager/deal owner/stage/value
- capture source/form/UTM/referrer
- email events, page/product events, lead score, consent topic
- include/exclude segments and contacts
- inactivity and date-relative windows
- holdout/control percentage

**Acceptance:** estimates explain excluded counts for no email, invalid email, suppression, topic opt-out, frequency, owner/sender failure, duplicate, and policy blocks. Approval screen shows audience delta if membership changes.

---

### Task 5 — Upgrade the email design studio

**Modify:**

- `components/campaigns/EmailCampaignEditor.tsx`
- `components/admin/email-builder/**`
- `lib/email-builder/types.ts`
- `lib/email-builder/render.ts`

**Create:**

- `components/email-marketing/MergeFieldBrowser.tsx`
- `components/email-marketing/RecipientPreviewPicker.tsx`
- `components/email-marketing/PreflightPanel.tsx`
- `components/email-marketing/VersionHistory.tsx`
- `components/email-marketing/CommentsPanel.tsx`
- reusable section/snippet APIs and tests

**Capabilities:**

- merge-field browser with required fallback syntax and sample values
- dynamic/conditional blocks with readable rule summaries
- preview as real selected contacts and salesperson identities
- autosave, undo/redo, conflict detection, version history, restore
- saved sections, global blocks, template categories, brand kit, locked brand regions
- collaboration comments and approval annotations
- accessibility audit: contrast, alt text, semantic order, descriptive links
- actual URL validation, tracking-domain validation, image weight, HTML size/Gmail clipping, text/image balance, subject/preheader checks
- desktop/mobile/dark-mode and supported-client rendering; do not label CSS-reset previews as real screenshots
- test groups and test-send audit
- AI actions that obey brand voice and never invent unsupported merge fields

**Verification:** visual regression fixtures, renderer snapshot tests, XSS sanitisation tests, accessibility tests, and real provider test messages in a non-production org.

---

### Task 6 — Unify the Marketing Studio information architecture

**Modify:**

- `components/navigation/marketingHubConfig.ts`
- `app/(portal)/portal/marketing/page.tsx`
- campaign/email/template/sequence/automation/capture/analytics/domain/preference/suppression routes to use shared shell/navigation

**Create:**

- `components/email-marketing/MarketingStudioDashboard.tsx`
- `components/email-marketing/ProgramList.tsx`
- `components/email-marketing/MarketingStudioNav.tsx`
- `app/(portal)/portal/marketing/email/**` routes or equivalent route group

**Target navigation:**

- Overview
- Campaigns
- Journeys
- Automations
- Templates & brand
- Audiences
- Capture
- Inbox & replies
- Analytics
- Deliverability
- Settings

**Dashboard:** upcoming sends, drafts needing approval, active journeys, list growth, qualified leads, replies awaiting sales, deliverability incidents, revenue, and clear create-from-playbook actions.

**Compatibility:** retain redirects/links for `/portal/email`, `/portal/campaigns`, `/portal/sequences`, `/portal/settings/sequences`, `/portal/settings/automations`, `/portal/email-analytics`, `/portal/capture-sources`, and existing admin routes until telemetry shows they can retire.

---

### Task 7 — Expand journeys and automation runtime

**Modify:**

- `lib/automations/types.ts`
- automation processor/executor and sequence cron
- `components/email/SequenceBuilder.tsx`
- automation creation/edit routes

**Add triggers:** form submitted, DOI confirmed, tag/segment entered/exited, page/product event, email delivered/opened/clicked/replied/bounced, score threshold, date/anniversary, inactivity, meeting booked, task completed, invoice/payment, scheduled recurring trigger.

**Add controls:** nested branches, wait duration/until/event, goals, re-entry, max concurrent enrolments, quiet hours, contact-local timezone, frequency policy, dedupe key, transactional bypass policy, dry run, replay failed action, version activation, holdout, workflow analytics.

**Runtime requirements:**

- immutable active versions
- per-action idempotency
- lease/lock to prevent duplicate workers
- dead-letter state and retry policy
- execution log with input redaction
- pause/cancel semantics that do not strand contacts
- simulation against named test contacts before activation

**Verification:** deterministic clock tests, duplicate-event tests, branch/goal/cycle tests, retry/dead-letter tests, quiet-hours/DST tests, and end-to-end lead-to-sequence simulation.

---

### Task 8 — Complete reply tracking and sales handoff

**Create:**

- `lib/email-marketing/reply-routing.ts`
- `lib/email-marketing/reply-classification.ts`
- `app/api/v1/email-marketing/replies/route.ts`
- `components/email-marketing/ReplyQueue.tsx`
- reply routing tests

**Modify:**

- `app/api/v1/email/inbound-webhook/route.ts`
- Communications conversation store/routes
- CRM activity, task, notification, and sequence-exit paths

**Rules:**

- Route to the snapshotted salesperson first; if inactive, use configured queue/fallback.
- Thread replies to the original campaign and contact.
- Stop or pause only the enrolments whose policy says so.
- Positive/negative/out-of-office classification is assistive; expose confidence and allow correction.
- A reply creates a visible owner action with SLA and escalation.
- Sales can reply through the authorised mailbox/conversation surface, not through a bulk sender address.

**Analytics:** reply rate, positive reply rate, median first response time, SLA misses, meetings, opportunities, pipeline, and revenue by program/variant/sender/team.

---

### Task 9 — Turn Capture Sources into a conversion suite

**Modify:**

- `components/capture-sources/CaptureSourcesWorkspace.tsx`
- public capture and embed routes
- CRM contact dedupe/import paths

**Create:**

- form schema/version records
- visual form editor
- landing page builder
- popup/slide-in/banner/multi-step renderers
- attribution and experiment records
- consent proof viewer
- capture analytics workspace

**Requirements:**

- responsive field/layout builder, custom fields, hidden fields, UTM/referrer/campaign capture
- progressive profiling and conditional fields
- locale/jurisdiction-aware consent copy and DOI
- Turnstile, honeypot, rate limiting, disposable-address checks, bot reporting
- server-side dedupe/merge policy and review queue for ambiguous matches
- field mapping, routing, owner assignment, tags, score, journey enrollment
- view/start/submit/qualified/opportunity/revenue funnel
- A/B tests and statistical guardrails
- versioned embed code with safe CORS/CSP behavior

---

### Task 10 — Add an idempotent event ledger and trustworthy analytics

**Create:**

- `lib/email-events/types.ts`
- `lib/email-events/store.ts`
- `lib/email-events/projector.ts`
- `lib/email-events/privacy-classifier.ts`
- event backfill/reconciliation scripts
- event and projector tests

**Modify:**

- Resend/SES outbound webhook handlers
- inbound reply webhook
- send executors and analytics aggregators
- `components/email-analytics/EmailAnalyticsDashboard.tsx`

**Metrics:**

- attempted/sent/delivered/deferred/failed
- total and unique human/unknown/machine opens
- total and unique clicks, CTOR, click heatmap by link
- reply/positive reply/meeting/opportunity
- bounce by hard/soft/category/provider response
- complaint and unsubscribe by topic
- conversion/revenue/pipeline with configurable attribution windows/models
- sender identity/team and audience cohort comparisons
- variant confidence, lift, sample size, and guardrail metrics
- capture-to-revenue funnel and list growth/churn

**Privacy:** label privacy-affected open metrics, default optimisation to clicks/conversions/replies where possible, and document metric limitations in-product.

**Verification:** webhook replay is idempotent; projector rebuild equals stored rollups; provider reconciliation reports drift; date/timezone boundaries are tested.

---

### Task 11 — Build deliverability command centre and enforced preflight

**Create/extend:**

- sender-domain health dashboard
- provider/webhook health and queue latency
- bounce/complaint/list-health trends
- warm-up/ramp policy records
- deliverability incident alerts
- preflight API that returns blocking errors vs warnings

**Checks:** SPF, DKIM, DMARC, alignment, tracking domain, HTTPS/unsubscribe, postal address, consent/legal basis, sender eligibility, audience delta, complaint/bounce thresholds, rate/ramp, link validity, HTML size, missing text part, accessibility, duplicate active sends, frequency/quiet hours, approval evidence.

**Important:** replace unsupported promises such as “warm IP pool managed by the platform” with provider-backed facts and status. Never promise inbox placement.

---

### Task 12 — Enforce approvals, permissions, and auditability

**Modify:**

- `lib/organizations/module-policies.ts`
- campaign/broadcast/sequence launch and schedule APIs
- agent auth/capability checks
- activity/evidence ledger integrations

**Add granular capabilities:**

- view analytics
- manage audience
- manage templates/brand
- create/edit program
- request approval
- approve content
- approve audience
- manage sender identity
- schedule/send
- pause/cancel
- manage capture
- export personal data

**Rules:**

- maker-checker option by org and risk level
- reapproval when content, sender, schedule, or audience changes materially
- immutable approval snapshot and evidence
- agent-created programs always record actor and remain send-blocked until approved
- bulk destructive operations require dry-run and explicit evidence
- all endpoints enforce policy server-side; hiding a button is insufficient

---

### Task 13 — Give the VPS agents complete, safe operating skills

**Modify:**

- `.claude/skills/email-outreach/SKILL.md`
- `.claude/skills/crm-sales/SKILL.md`
- `.claude/skills/content-engine/SKILL.md`
- `.claude/skills/analytics/SKILL.md`
- `.claude/skills/platform-ops/SKILL.md`
- `config/agent-skill-policy.json`
- skill policy validation/install tests and VPS sync docs

**Policy target:**

- **Maya/Marketing:** create programs, audiences, templates, journeys, capture surfaces, simulations, and reports; sending remains `message_client` gated.
- **Blake/Sales:** manage sales-owned audiences, sender preferences/eligibility, low-volume sequences, reply queue, and CRM follow-up; cannot alter bulk brand/domain governance.
- **Nora/Operations:** consent, suppression, list hygiene, routing, inbox operations, and audit reconciliation.
- **Vera/Data:** read-only email analytics, attribution, experiment and data-quality workflows; no send authority.
- **Pip/Operator:** add `email-outreach` for orchestration, inspection, draft creation, and approval routing; no implicit send authority.
- **Theo/Builder:** schema, API, provider, cron, migration, and deliverability debugging under deploy/secret gates.
- **QA Release:** preflight, fixture sends in non-production, event reconciliation, accessibility, rendering, and release gates.
- **Support:** delivery/reply diagnostics and safe draft responses, with customer-visible messages gated.

**Skill requirements:**

- canonical routes and schemas
- `dryRun`/estimate/preview/preflight examples
- clear distinction between bulk ESP sending and connected mailbox 1:1
- sender strategy and fallback rules
- audience/consent/suppression checks
- approval evidence flow
- read-only analytics recipes
- never guess org, sender, audience, or approval state
- verify created records by read-back; return ids and preflight state

**VPS verification:**

1. Policy validator passes.
2. Sync/mount process installs exact skill versions under each `vpsExternalDir`.
3. Runtime skill inventory endpoint/read-back matches policy for Maya, Blake, Nora, Vera, Pip, Theo, QA, and Support.
4. Canary prompts prove each agent can create a draft/analysis but cannot bypass send approval.

---

### Task 14 — Release gates, migration, and rollout

#### Gate A — Foundation and no-regression

- Canonical adapters pass fixtures for all legacy shapes.
- No tenant leak in sender/audience/program APIs.
- Existing broadcast, sequence, unsubscribe, suppression, webhook, and analytics focused tests pass.
- Backfill is dry-run-first, idempotent, and reversible.

#### Gate B — Sender and sales handoff

- Every send stores resolved identity/reply owner snapshots.
- All salesperson strategy/fallback scenarios pass.
- Inbound reply routes to the expected salesperson/queue and pauses only intended enrolments.
- Bulk-vs-mailbox policy is enforced.

#### Gate C — Compliance and deliverability

- One-click unsubscribe works by GET and RFC 8058 POST.
- Suppression, topic preferences, frequency, consent, sender, and approval are rechecked at dispatch.
- Resend/SES webhooks fail closed in production and replay idempotently.
- Complaint and bounce thresholds produce alerts/blockers.
- Legal/compliance matrix receives qualified review before marketing claims.

#### Gate D — Analytics trust

- Event projector rebuild matches rollups.
- Unique vs total and machine/privacy-affected opens are labelled.
- Click/reply/conversion/revenue attribution traces back to contact, message, program, sender, and source.
- Provider reconciliation drift is below the agreed threshold.

#### Gate E — UX and agents

- Browser QA covers create → design → audience → sender preview → preflight → approval → schedule in portal and admin org scope.
- Mobile/tablet authoring and analytics smoke tests pass.
- Maya, Blake, Vera, Pip, Nora, Theo, QA, and Support skill inventories match policy.
- Canary agents cannot perform client-visible send without approval evidence.

#### Rollout order

1. Internal PiB organisation, read-only unified dashboard.
2. Internal draft creation, audience estimates, sender preview, and preflight.
3. Test-domain sends and inbound reply routing.
4. One low-risk pilot organisation with capped volume and daily reconciliation.
5. Selected organisations behind feature flag.
6. Default-on only after deliverability, event, reply SLA, and support metrics remain healthy.

**Rollback:** disable V2 UI and new program creation while legacy send executors remain operational; stop new schedules without deleting records; retain append-only events and approval evidence.

---

## 6. Testing and observability matrix

### Unit

- sender strategies and fallbacks
- audience filter evaluation and eligibility reasons
- merge fields/fallbacks/conditional content
- consent/suppression/frequency precedence
- automation branches/goals/waits/DST/re-entry
- privacy classifier and metric formulas
- attribution and experiment statistics

### API/integration

- org-scope and role matrix for every new endpoint
- create/read/update/version/approve/schedule/pause flows
- provider failure, retry, duplicate webhook, out-of-order webhook
- sender disabled after approval but before dispatch
- contact unsubscribed after snapshot but before dispatch
- reply to campaign and salesperson failover
- capture dedupe, DOI, bot rejection, routing, enrollment

### End-to-end

- marketer-owned newsletter
- contact-owner salesperson campaign
- account-manager sequence
- lead capture → DOI → nurture → qualification → sales task
- agent creates draft → human reviews → approved send
- audience changes after approval require reapproval
- pause/cancel/resume and partial provider outage

### Observability

- queue depth/age, send throughput, provider latency/error rate
- webhook verification/replay/drift
- domain/identity health
- bounce/complaint/unsubscribe thresholds
- reply routing failures and SLA backlog
- automation dead letters and retries
- event projection lag
- capture bot/abuse rates
- per-org volume/cost and quota

---

## 7. Definition of “world-class” for this release

The platform is not world-class because it has many menu cards. It qualifies when an organisation can safely and measurably:

1. capture and prove consent for a lead;
2. build a polished, responsive, accessible, personalised email with fallbacks;
3. target an explainable, reusable audience;
4. run broadcasts and advanced lifecycle journeys;
5. send centrally authored work under an eligible salesperson identity without breaking bulk-email rules;
6. route replies and follow-up to the right salesperson with CRM accountability;
7. protect reputation with authenticated domains, preferences, suppression, frequency, preflight, and approval gates;
8. measure trustworthy delivery, clicks, replies, conversion, pipeline, revenue, and list health;
9. let authorised agents create and operate drafts through documented APIs while preserving human approval for external sends;
10. reconcile provider truth, message events, CRM outcomes, and analytics without cross-organisation leakage.
