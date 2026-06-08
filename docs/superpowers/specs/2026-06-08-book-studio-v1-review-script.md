# Book Studio V1 Review Script

**Date:** 2026-06-08
**Status:** Review aid only; not an implementation plan.
**Decision index:** `docs/superpowers/specs/2026-06-08-book-studio-v1-decision-index.md`
**Authoritative packet:** `docs/superpowers/specs/2026-06-08-book-studio-v1-approval-packet.md`
**Authoritative dossier:** `docs/superpowers/specs/2026-06-07-book-studio-research-dossier.md`
**Coverage audit:** `docs/superpowers/specs/2026-06-08-book-studio-objective-coverage-audit.md`
**Review scorecard:** `docs/superpowers/specs/2026-06-08-book-studio-v1-approval-review-scorecard.md`
**Pilot product decision register:** `docs/superpowers/specs/2026-06-08-book-studio-v1-pilot-product-decision-register.md`
**Revision impact matrix:** `docs/superpowers/specs/2026-06-08-book-studio-v1-approval-revision-impact-matrix.md`
**Approval decision form:** `docs/superpowers/specs/2026-06-08-book-studio-v1-approval-decision-form.md`
**Source refresh execution report:** `docs/superpowers/specs/2026-06-08-book-studio-v1-source-refresh-execution-report.md`
**Concrete review aid:** `docs/superpowers/specs/2026-06-08-book-studio-v1-mock-review-packet.md`
**Portal access aid:** `docs/superpowers/specs/2026-06-08-book-studio-v1-portal-access-promotion-model.md`
**Package QA aid:** `docs/superpowers/specs/2026-06-08-book-studio-v1-production-package-qa-model.md`
**Operator workspace aid:** `docs/superpowers/specs/2026-06-08-book-studio-v1-operator-workspace-control-model.md`
**Jurisdiction/local publisher aid:** `docs/superpowers/specs/2026-06-08-book-studio-v1-jurisdiction-local-publisher-model.md`
**Hermes skill contract pack:** `docs/superpowers/specs/2026-06-08-book-studio-v1-hermes-skill-contract-pack.md`
**Launch and lifecycle governance aid:** `docs/superpowers/specs/2026-06-08-book-studio-v1-launch-lifecycle-governance-model.md`
**Market evidence aid:** `docs/superpowers/specs/2026-06-08-book-studio-v1-market-evidence-model.md`

## Purpose

This script helps Peet review the proposed Book Studio V1 decision without turning the approval packet into runtime work. It should be used with the mock review packet and approval decision form before any Phase 1 implementation plan is written.

The review has four possible outcomes:

| Outcome | Meaning | Next step |
| --- | --- | --- |
| Approve as written | The approval packet is accepted as the V1 product boundary. | Write a separate Phase 1 implementation plan from the approval record and dossier. |
| Approve with revisions | The V1 direction is accepted, but one or more approval fields must change. | Update the approval packet and affected dossier sections before planning. |
| Reject internal-studio V1 | The proposed PiB internal production-studio posture is not the right first product. | Reopen product positioning around client-facing or public SaaS Book Studio. |
| Request more design detail | The decision is still unclear, but runtime implementation is not approved. | Add a design-only aid, workflow diagram, mock review packet, or deeper risk note. |

## 30-Minute Review Agenda

Before the agenda, open the decision index, approval packet, coverage audit, review scorecard, pilot product decision register, revision impact matrix, approval decision form, mock review packet, market evidence aid, package QA aid, jurisdiction/local publisher aid, Hermes skill contract pack, and launch/lifecycle governance aid. The decision index answers "what should I read and what decision is needed?" The approval packet answers "what would we approve?" The coverage audit answers "which original objective requirements are covered?" The scorecard answers "which categories are pass, warn, or block?" The pilot register answers "which first book archetypes prove V1 without pretending market demand is already validated?" The market evidence aid answers "what evidence stops weak candidate ideas before Book Brief or production selection?" The revision matrix answers "what else must change if Peet approves with revisions?" The decision form answers "what exact decision record controls planning?" The source refresh execution report answers "how do we prove current official sources were checked before planning?" The mock packet answers "what would this feel like in PiB?" The package QA aid answers "what would make a book package safe enough for proof, portal review, or manual handoff?" The jurisdiction/local publisher aid answers "what local publisher evidence must stay separate from KDP/Google readiness?" The Hermes skill contract pack answers "what fields must every first skill declare before any runtime skill spec exists?" The launch/lifecycle aid answers "what happens after a book is live without drifting into review outreach, ad spend, price automation, or public launch automation?"

### 1. Confirm The Product Posture

Read the approval packet's recommended approval aloud:

> Book Studio V1 is an internal PiB production studio with optional client review.

Review questions:

- Is Book Studio first a PiB-operated production workflow, not a public AI-book SaaS product?
- Is client review optional and artifact-based, rather than self-serve generation?
- Are admin, Research, Client Documents, Projects, artifacts, publishing packets, Hermes readiness, and analytics imports the correct first integration points?

Pass state:

- Peet can repeat the V1 posture in one sentence and it matches the approval packet.

Block state:

- The desired V1 is actually public self-serve generation, direct publishing automation, or a client-facing creator tool. That requires a different design pass.

### 2. Confirm The First Channels

Review the first channel scope:

- Amazon KDP manual handoff.
- Google Play Books manual handoff.

Review questions:

- Is manual upload evidence acceptable for V1, rather than direct API/store publishing?
- Are wider channels such as Apple, Kobo, Draft2Digital, IngramSpark, ACX, Amazon Ads, and review outreach correctly deferred?
- Does the first plan need a source refresh before implementation planning starts?

Pass state:

- KDP and Google manual packets are enough to prove the first publishing workflow.

Warning state:

- Peet wants one wider channel documented as future-compatible, but not built in Phase 1.

Block state:

- V1 must directly publish, store channel credentials, automate review outreach, or manage ad spend.

### 3. Confirm The First Pilot Set

Review the recommended first pilots:

- Business nonfiction ebook.
- Activity, workbook, puzzle, coloring, or low-content print product.
- Series scaffolding.
- Public-domain or companion negative-control fixture.

Review questions:

- Does this pilot set prove the PiB operating loop without starting with fixed-layout visual complexity?
- Is the negative-control fixture valuable enough to keep, even though it slows the first plan?
- Should children's/visual or audiobook work stay as fixture/later-phase scope rather than first implementation scope?

Pass state:

- Peet accepts the first pilot set as the basis for Phase 1 planning.

Warning state:

- Peet adds a tightly gated children's/visual fixture, but does not expect full visual book production in Phase 1.

Block state:

- Pilot selection stays vague, or the first scope jumps to audio/full visual publishing before the core workflow is proven.

### 4. Confirm Market Evidence Gate

Review the candidate-selection posture:

- Candidate ideas need reviewed market evidence before Book Brief or production selection.
- Evidence includes reader/buyer use case, competitive shelf observations, discoverability metadata, differentiation, rights, channel fit, price/margin, PiB strategic fit, and capacity.
- Market research cannot promise sales, rank, bestseller status, or future revenue.

Review questions:

- Does Peet accept that weak or speculative ideas can be blocked before production, even if they look easy for Hermes to create?
- Should market evidence be required for all live candidates, including PiB-owned internal books?
- Are automated market scraping, copied competitor metadata, and sales/rank promises correctly excluded?

Pass state:

- Peet accepts a pass/warn/block market evidence gate before Book Brief or production work.

Warning state:

- A candidate may proceed with named warnings only when owner, review date, and next evidence are visible.

Block state:

- Production can start from shelf screenshots, search-rank assumptions, generic AI-book ideas, copied competitor positioning, or unknown/negative print margins.

### 5. Confirm Portal Review Artifacts

Review the first client-safe portal artifacts:

- Book Brief.
- Proof package when reviewed.
- Publishing packet when reviewed.
- Analytics summary when reconciled.

Review questions:

- Should the portal start with only Book Brief review, or should proof and publishing packets be planned from the start?
- Is raw Hermes output explicitly blocked from the portal?
- Are internal rights notes, upload-account details, parser errors, and unreconciled costs blocked from client visibility?

Pass state:

- The first portal surface exposes only reviewed artifact versions and a clear disabled-module state.

Warning state:

- Portal scope starts narrower with Book Brief only, but the approval record says proof, packet, and analytics artifacts are later within V1.

Block state:

- Clients can see raw research, raw Hermes drafts, internal rights notes, or unreconciled analytics.

### 6. Confirm Hermes Scope

Review the recommended Hermes posture:

- Wave 1 planning and evidence skills: niche research, series strategy, brief builder, outline builder.
- Selected Wave 2 safety/readiness docs and fixtures: generation safety, metadata, KDP readiness, Google readiness, publishing account readiness.
- Proposed contract records for first skills: allowed inputs, required source keys, existing artifacts, allowed outputs, forbidden actions, reviewer defaults, portal visibility, fixtures, stale-source behavior, and no-runtime flags.
- Runtime dispatch disabled until ledgers, sanitizers, fixtures, reviewer defaults, and forbidden-action tests exist.

Review questions:

- Are skills being approved as bounded docs, manifests, fixtures, and evaluation records before runtime dispatch?
- Can every Hermes output become a reviewable artifact or task, rather than a final public action?
- Does any proposed skill publish, spend, message clients, request secrets, mark client-ready, or bypass human review?
- Does any proposed skill lack a contract record, source-key behavior, fixture IDs, or portal visibility rule?

Pass state:

- Hermes can help prepare, check, summarize, and recommend, but cannot perform release-sensitive actions.

Warning state:

- Peet wants fewer Wave 2 skills in the first plan, but the readiness gaps are tracked as follow-up.

Block state:

- Runtime Hermes dispatch is approved before forbidden-action tests, output sanitizers, fixture reports, and reviewer defaults exist.

### 7. Confirm Publishing Packet And Account Governance

Review the manual publishing packet model:

- Files, metadata, pricing, territories, ISBN/imprint, AI disclosure, source freshness, rights evidence, account authority, manual upload instructions, external status, and upload evidence.

Review questions:

- Does every upload-ready claim need current packet evidence?
- Is account ownership, account used, and authority to publish tracked without storing sensitive credentials?
- Are AI-generated versus AI-assisted disclosures derived from provenance records, not a project-level guess?

Pass state:

- A human can manually upload from the packet without guessing and without PiB holding sensitive channel secrets.

Warning state:

- A packet is internally reviewable but one channel-specific warning needs an owner, due date, or waiver path.

Block state:

- The packet is marked upload-ready while files, pricing, rights, account readiness, disclosure, or source freshness are missing.

### 8. Confirm Jurisdiction And Local Publisher Evidence

Review the local publisher model:

- South African legal-deposit evidence lane.
- ISBN/imprint source, owner, agency, format, and platform-ISBN consequences.
- Copyright posture, human authorship, AI-use classification, and contributor authority.
- Territory, adaptation, account/payment, and publisher-identity evidence.

Review questions:

- Should PiB-owned South African books default to a PiB imprint, named-author imprint, or another publisher identity?
- Should client-owned books default to client-owned ISBN/imprint decisions unless the client explicitly approves PiB as publisher?
- Is local publisher evidence allowed to warn during drafting but block local-compliance, upload-ready, and client-facing publisher claims?

Pass state:

- KDP/Google channel readiness and local publisher readiness are treated as separate gates.

Warning state:

- South African local evidence exists as a warning lane, but first implementation planning needs one explicit fixture to prove it.

Block state:

- The packet can claim local compliance, publisher readiness, ISBN/imprint readiness, copyright registration, or legal-deposit completion without reviewed evidence.

### 9. Confirm Analytics And Reporting Trust

Review the analytics posture:

- Manual import ledger.
- Source confidence labels.
- Estimated, reported, settled, ad-attributed, refund, adjustment, and unmatched row separation.
- Reconciliation tasks before client-safe summaries.

Review questions:

- Does the dashboard avoid merging early estimates with settled revenue?
- Can every client-facing metric answer: what source, what period, what timezone, what confidence?
- Are KDP and Google timing differences, refunds, missing values, and payment-period differences visible as confidence or reconciliation state?

Pass state:

- Analytics can inform decisions without pretending early or partial data is final revenue.

Warning state:

- Some imports are useful but partial, and the dashboard labels them as partial.

Block state:

- Screenshots, raw imports, estimates, or unsettled reports are presented as guaranteed revenue.

### 10. Confirm Production Package QA

Review the production package posture:

- Proof, file, cover, rights, accessibility, source freshness, and checksum evidence bind approvals to one package version.
- A PDF that opens locally is not treated as an upload-ready publishing package.
- Package QA is a future runtime requirement, not a claim that validators or export tooling already exist.

Review questions:

- Can every manual-handoff claim point to exact file versions and package evidence?
- Does a manuscript, cover, metadata, rights, AI-use, or channel-source change invalidate the affected proof, packet, or client approval?
- Are automated export/file validators still deferred until the implementation plan explicitly scopes and tests them?

Pass state:

- Book Studio can say "this exact package is ready for the next human step" without implying direct publishing or blanket channel approval.

Warning state:

- A package is internally reviewable, but one format/channel warning needs an owner, due date, or waiver path before handoff.

Block state:

- Any generated file, proof, or package is marked upload-ready without exact file identity, package evidence, rights/provenance review, and channel-specific preflight.

## First Implementation Demo Evidence Peet Should Ask For Later

This section is a future demo checklist, not a build plan. It defines what evidence a later Phase 1 implementation demo should show if the approval record is accepted.

| Demo case | Must prove | Should not prove |
| --- | --- | --- |
| Business nonfiction or activity project | A reviewed Book Brief and packet-ready state without direct publishing. | That AI can generate a polished book from a blank prompt. |
| Series scaffold | Volume order, continuity notes, shared metadata, and rollup analytics shape. | That every future series volume is already viable. |
| Public-domain or companion negative control | Unsafe production is blocked with a clear rights/evidence explanation. | That the module can work around weak rights evidence. |
| Hermes recommendation | A skill creates a reviewable artifact or task. | That Hermes can publish, approve, spend, message clients, or access secrets. |
| Package QA | Exact files, proof state, rights evidence, checksum binding, and invalidation behavior are visible before manual handoff. | That a local PDF or generated EPUB is automatically upload-ready. |
| Analytics import | Source/confidence labels and reconciliation state are visible. | That partial reports equal settled revenue. |

## Exact Approval Response

Peet can approve with this text:

> Approve Book Studio V1 as an internal PiB production studio with optional client review. Use KDP and Google Play Books manual-handoff as the first channel focus. Start with business nonfiction, activity or low-content print, series scaffolding, and a public-domain or companion negative-control fixture. Build admin-first records, market evidence gates, gate profiles, Research/Client Document/Project/artifact bridges, publishing packet tracking, local publisher evidence lanes, controlled Hermes skill readiness, package QA evidence, and manual analytics imports. Keep self-serve generation, public SaaS, direct publishing, account-secret custody, autonomous ads, automated review outreach, sales forecasting or rank promises from market research, full layout tooling, automated export/file validation, and automated report integrations out of V1.

## Exact Revision Response

Peet can request revisions with this structure:

```yaml
bookStudioV1ApprovalRevision:
  productPosture:
    choose: internal_pib_production_studio_with_optional_client_review | pib_owned_internal_studio_only | client_review_first_internal_studio
  firstPilotSet:
    add: []
    remove: []
  firstPortalReviewArtifacts:
    startWith: []
  hermesFirstScope:
    choose: wave1_only | wave1_plus_selected_wave2_docs_and_fixtures | broader_docs_only_no_runtime
  ownershipModel:
    choose: pib_owned_only | shared_pib_and_client_owned
  jurisdictionAndLocalPublisherScope:
    add: []
    remove: []
  productionReadinessScope:
    add: []
    remove: []
  analyticsScope:
    add: []
    remove: []
  firstChannels:
    add: []
    remove: []
  acceptedDeferrals:
    add: []
    remove: []
```

After filling this structure, check the revision impact matrix and name the affected evidence docs before any implementation plan is written.

## Devil's Advocate

- If the review approves only the exciting generation parts, Book Studio will become a risky content generator rather than a production system.
- If the review approves every possible book type and channel, Phase 1 will become channel research, file packaging, account governance, and rights complexity before proving the PiB workflow.
- If the negative-control fixture is removed, the first implementation can pass only the happy path and still fail at the first attractive unsafe idea.
- If portal review is treated as "show clients everything", PiB will leak uncertainty, rights risk, and raw agent output.
- If analytics is approved as a single revenue chart, clients will be trained to trust numbers before refunds, timing lags, payment reports, and reconciliation are understood.
- If Hermes runtime dispatch is approved too early, the module can create polished unsafe output faster than reviewers can catch it.
- If package QA is treated as a file-opening check, Book Studio may hand off beautiful but unreviewed files with weak rights evidence, stale channel assumptions, or mutated post-approval content.
