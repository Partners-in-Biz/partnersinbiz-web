# Book Studio Objective Coverage Audit

**Date:** 2026-06-08
**Status:** Design/research coverage audit only; not an implementation plan.
**Decision index:** `docs/superpowers/specs/2026-06-08-book-studio-v1-decision-index.md`
**Authoritative dossier:** `docs/superpowers/specs/2026-06-07-book-studio-research-dossier.md`
**Decision packet:** `docs/superpowers/specs/2026-06-08-book-studio-v1-approval-packet.md`
**Review aid:** `docs/superpowers/specs/2026-06-08-book-studio-v1-review-script.md`
**Approval review scorecard:** `docs/superpowers/specs/2026-06-08-book-studio-v1-approval-review-scorecard.md`
**Pilot product decision register:** `docs/superpowers/specs/2026-06-08-book-studio-v1-pilot-product-decision-register.md`
**Revision impact matrix:** `docs/superpowers/specs/2026-06-08-book-studio-v1-approval-revision-impact-matrix.md`
**Approval decision form:** `docs/superpowers/specs/2026-06-08-book-studio-v1-approval-decision-form.md`
**Acceptance fixture pack:** `docs/superpowers/specs/2026-06-08-book-studio-v1-acceptance-fixtures.md`
**Source refresh contract:** `docs/superpowers/specs/2026-06-08-book-studio-v1-source-refresh-contract.md`
**Book family gate catalog:** `docs/superpowers/specs/2026-06-08-book-studio-v1-book-family-gate-catalog.md`
**Ownership and commercial model:** `docs/superpowers/specs/2026-06-08-book-studio-v1-ownership-commercial-model.md`
**Mock review packet:** `docs/superpowers/specs/2026-06-08-book-studio-v1-mock-review-packet.md`
**Wider channel adapter packet:** `docs/superpowers/specs/2026-06-08-book-studio-v1-wider-channel-adapter-packet.md`
**Hermes skill evaluation packet:** `docs/superpowers/specs/2026-06-08-book-studio-v1-hermes-skill-evaluation-packet.md`
**Portal access and promotion model:** `docs/superpowers/specs/2026-06-08-book-studio-v1-portal-access-promotion-model.md`
**Domain record/state model:** `docs/superpowers/specs/2026-06-08-book-studio-v1-domain-record-state-model.md`
**Operator workspace control model:** `docs/superpowers/specs/2026-06-08-book-studio-v1-operator-workspace-control-model.md`
**Production package QA model:** `docs/superpowers/specs/2026-06-08-book-studio-v1-production-package-qa-model.md`
**Jurisdiction and local publisher model:** `docs/superpowers/specs/2026-06-08-book-studio-v1-jurisdiction-local-publisher-model.md`
**ai-story non-port checklist:** `docs/superpowers/specs/2026-06-08-book-studio-v1-ai-story-non-port-checklist.md`
**Decision bundle content baseline:** `ddee2021 docs(book-studio): add local publisher obligations model`

## Purpose

This audit maps Peet's original Book Studio objective to the current design artifacts. It answers one question: have the requested angles been covered well enough for a V1 product decision?

This document does not authorize runtime code, Firestore collections, routes, APIs, UI, Hermes dispatch, publishing automation, or a Phase 1 implementation plan. Those stay gated until Peet explicitly approves or revises the Book Studio V1 approval record.

When Phase 1 planning is approved later, quote both the source dossier commit and the current `development` commit at planning time. The dossier commit identifies the source-backed research base; the current planning commit identifies the companion packets that constrain portal access, domain state, operator controls, Hermes evaluation, package QA, jurisdiction/local publisher evidence, and objective coverage. The decision bundle content baseline records the last product-boundary packet update before metadata-only handoff cleanup.

## Current Coverage Summary

The current artifact set is sufficient for an approval decision about Book Studio V1. It is not sufficient to start implementation without the explicit approval record.

Covered now:

- Product posture for an internal PiB production studio with optional client review.
- KDP and Google Play Books as first manual-handoff channels.
- Wider-channel compatibility considerations.
- Book families, series, publishing packets, Hermes skill boundaries and per-skill evaluation fixtures, analytics confidence, portal review artifacts, and devil's-advocate risks.
- Standalone book-family gate catalog covering nonfiction/reference, narrative, activity/workbook, low-content, children/visual, cookbook/photo/portfolio, public-domain/companion, audiobook, and series overlay rules.
- Acceptance fixtures for pass, warn, and block cases.
- Policy/source freshness contract for KDP, Google Play Books, channel reports, account authority, Hermes source behavior, and `ai-story` as design evidence only.
- Ownership, account authority, commercial decision states, revenue/cost separation, client approval artifacts, upload-readiness blockers, and Hermes commercial boundaries.
- A concrete mock review packet showing admin state, client-safe portal state, Hermes recommendations, KDP/Google packet separation, series state, negative-control blocking, analytics confidence, and version invalidation.
- A decision index that tells Peet which docs to read, what is authoritative, what is evidence-only, and which exact approval or revision response unlocks only future planning.
- A review scorecard that turns the packet into a compact pass/warn/block decision rubric without creating runtime scope.
- A pilot product decision register that separates first commercial proof, print-risk proof, series proof, blocker proof, and creative-range fixture decisions without making market-demand claims.
- A revision impact matrix that names the evidence docs, source refresh triggers, blockers, and devil's-advocate concerns created when an approval field changes.
- An approval decision form that records the final decision outcome, accepted warnings, remaining blockers, source-refresh state, and whether Phase 1 planning is allowed.
- A Hermes skill evaluation packet defining per-skill input contracts, pass/warn/block cases, forbidden-action regressions, sanitizer expectations, stale-source behavior, and fixture IDs for the recommended first skill package.
- A portal access and promotion model defining the future module switch default, disabled state, safe DTO shape, artifact promotion states, client permissions, invalidation rules, and org isolation requirements.
- A domain record/state model defining conceptual record families, relationships, lifecycle states, packet states, analytics states, core invariants, invalidation triggers, and future test obligations without choosing schema or implementation order.
- An operator workspace control model defining the admin command-center spine, stage rail, command contract, disabled/empty/error states, PiB surface bridges, forbidden controls, and future demo scenarios without choosing UI components or route names.
- A production package QA model defining format profiles, proof gates, package manifest requirements, checksum-bound approvals, invalidation rules, Hermes QA boundaries, portal proof rules, and review scenarios before manual handoff readiness.
- Standalone wider-channel adapter research for Apple Books, Kobo Writing Life, Draft2Digital, IngramSpark, ACX, KDP Virtual Voice, ISBN governance, EPUB validation, distribution conflicts, Hermes boundaries, and portal-safe deferral.
- A jurisdiction and local publisher model defining South African legal-deposit, ISBN/imprint, copyright posture, contributor authority, account/payment, territory, and portal-safe local evidence lanes as separate from KDP/Google channel readiness.
- A standalone `ai-story` non-port checklist that locks the current `ai-story` source baseline, extracts product lessons to keep, names architecture patterns that must not be ported, and defines future planning pass/warn/block rules.

Not covered as approved build work:

- Runtime Book Studio module toggle, routes, records, APIs, UI, Firestore collections, or shared components.
- Live Hermes runtime dispatch.
- Direct KDP, Google Play Books, Apple, Kobo, Draft2Digital, IngramSpark, ACX, Amazon Ads, or review-outreach automation.
- Client self-serve generation or public SaaS.
- A Phase 1 task list.

## Requirement Coverage Matrix

| Original objective | Current evidence | Coverage verdict | Remaining action |
| --- | --- | --- | --- |
| Create books to sell on Amazon KDP, Google Books, and other channels. | The dossier covers KDP, Google Play Books, and wider channel adapters, while the approval packet narrows V1 to KDP/Google manual handoff. The wider-channel adapter packet extracts Apple/Kobo/D2D/Ingram/audio/ISBN/EPUB source implications into a standalone future-compatibility aid. | Covered for V1 design; later-phase coverage exists for wider channels. | Recheck source register before implementation planning or before adding any wider first channel. |
| Do deep research into what this entails. | The dossier includes source-backed KDP/Google constraints, current-source addendum, policy source register, channel adapter research, quality gates, rights/provenance, package validation, launch, and analytics sections. The source refresh contract adds explicit stale-source blockers and source keys for KDP/Google publishing and analytics claims. | Covered for approval-stage research. | Refresh official sources before writing a Phase 1 plan and before marking any future packet upload-ready. |
| Cover different types of books. | The dossier and approval packet define gate profiles for narrative/reflowable, business nonfiction, activity/workbook/puzzle/coloring, low-content print, children picture fixed-layout fixture, public-domain/companion rights-first fixture, and series governance. The standalone book-family gate catalog now extracts these into explicit intake, evidence, Hermes, publishing, analytics, portal, blocker, and devil's-advocate rules, adding cookbook/photo/portfolio and audiobook future profiles. | Covered for V1 design and fixtures. | Keep non-selected book families as gate profiles or fixtures unless Peet explicitly expands the first pilot set. |
| Support creating series. | The dossier covers internal series records, KDP/Google series constraints, continuity bibles, volume order, metadata risks, and rollup analytics. Acceptance Fixture C tests the series scaffold. | Covered for V1 design. | Do not imply external KDP/Google series eligibility without channel evidence. |
| Create the book with Hermes agents. | The dossier defines Wave 1 planning/evidence skills, selected Wave 2 safety/readiness skills, Wave 3-5 later skills, skill manifests, allowed/forbidden outputs, fixture reports, reviewer defaults, and sanitizer expectations. The Hermes blueprint and evaluation packet now define per-skill input contracts, expected artifacts, pass/warn/block cases, forbidden regressions, and portal visibility rules. | Covered as controlled skill design; runtime dispatch remains gated. | Do not enable runtime Hermes dispatch until manifests, ledgers, sanitizers, fixture reports, and forbidden-action tests exist. |
| Create new Hermes skills. | The dossier lists specific skill packages such as `book-niche-research`, `book-series-strategy`, `book-brief-builder`, `book-outline-builder`, KDP/Google readiness checks, metadata, account readiness, production/package/launch/analytics skills, and evaluation rubrics. The evaluation packet turns the first package into named fixture IDs and sanitizer expectations. | Covered for skill design and pre-dispatch evaluation. | After approval, write skill specs and fixtures before runtime dispatch or client-visible output. |
| Define how publishing will work. | The dossier and approval packet define manual publishing packets, account governance, file/package evidence, metadata, AI disclosure, pricing, territories, upload evidence, and channel status. The production package QA model adds package layers, format profiles, proof gates, package manifest requirements, checksum-bound approval, and invalidation rules before a packet can claim manual-handoff readiness. | Covered for V1 manual-handoff design. | Direct publishing, credential custody, and store automation remain excluded from V1. |
| Define analytics. | The dossier covers KDP/Google report timing, manual import ledger, source confidence labels, estimated/reported/settled separation, reconciliation tasks, portal-safe summaries, and series rollups. Acceptance Fixture F tests partial-import warnings. | Covered for V1 design. | Do not show blended revenue without source, period, timezone, confidence, and reconciliation state. |
| Play devil's advocate from all angles. | The dossier, approval packet, review script, and acceptance fixtures include risk sections for policy drift, rights, AI disclosure, unsafe Hermes actions, client visibility, analytics overclaiming, direct publishing pressure, and over-broad V1 scope. | Covered for design review. | Keep negative-control fixtures in the future demo set unless Peet explicitly removes them and accepts weaker blocker proof. |
| Learn from `PMStander/ai-story`. | The dossier extracts `ai-story` lessons around wizard intake, series, templates, KDP presets, agents, and package expectations, then rejects direct porting because PiB needs multi-tenant admin/portal, Projects, Client Documents, Research, Hermes policy, and Firestore patterns. The standalone non-port checklist adds a planning-time keep/rewrite/reject guard and confirms `ai-story` HEAD still matches the recorded source baseline. | Covered for architecture lessons and future planning guardrails. | Treat `ai-story` as a learning source, not a runtime dependency, migration target, or publishing-policy source. |
| Integrate with the PiB platform. | The dossier maps Book Studio to PiB admin, portal, Research, Client Documents, Projects/Kanban, artifacts, org module entitlement, portal disabled state, sanitizers, and shared review artifacts. The portal access and promotion model now defines the future `settings.portalModules.bookStudio` posture, disabled-state guard, safe portal DTOs, artifact promotion states, client permissions, invalidation rules, org switching, and test obligations. The domain record/state model adds the conceptual `bookProject`, gate profile, research link, brief, series, artifact, rights ledger, publishing packet, upload event, analytics import/summary, Hermes evaluation, portal promotion, and decision log relationships future implementation must preserve. The operator workspace control model adds the future admin command-center spine, stage rail, command contracts, empty/error states, and PiB surface bridges needed to operate those concepts without a blank-prompt-first workflow. | Covered for design. | Runtime integration remains unapproved until Peet accepts the V1 approval record. |
| Define ownership and commercial governance. | The ownership/commercial model defines PiB-owned and client-owned workflows, account authority profiles, commercial decision states, revenue/cost separation, client approval artifacts, upload-readiness blockers, and Hermes commercial boundaries. | Covered for V1 design. | Keep shared/revenue-share economics blocked unless Peet explicitly approves the added operating load. |
| Handle local publisher obligations for PiB-owned or client-owned books. | The jurisdiction/local publisher model separates South African legal-deposit, ISBN/imprint, copyright posture, contributor authority, account/payment, and territory evidence from KDP/Google channel readiness. | Covered as a design gate and source-backed evidence lane. | Refresh local sources and decide PiB/client imprint posture before implementation planning or any South African manual-handoff claim. |
| Make the proposed workflow tangible before approval. | The mock review packet shows a sample business nonfiction project across admin packet state, client portal wording, Hermes output boundaries, KDP/Google separation, series posture, blocked companion-book negative control, analytics confidence, and version invalidation. | Covered as a review aid. | Do not treat the mock packet as UI design, schema, build scope, or proof that runtime work is approved. |

## Evidence Quality Check

The current research dossier contains a current-source addendum dated 2026-06-08. The source refresh contract adds a standalone evidence rule set for keeping those policy claims current. The book-family gate catalog turns the broad "all book types" requirement into concrete profile rules. The ownership/commercial model adds the account-authority and economics review surface. The mock review packet makes the pass/warn/block operating loop concrete. The review scorecard makes the final approval decision auditable across product posture, channels, pilots, Hermes, publishing, account authority, local publisher evidence, package QA, portal exposure, analytics, `ai-story`, operator workflow, and devil's-advocate categories. The pilot product decision register makes the first book-product choice explicit while preserving the rule that market demand belongs in a future Research evidence packet. The revision impact matrix makes "approve with revisions" auditable by naming the affected evidence docs, source refresh triggers, and blockers before any plan exists. The wider-channel adapter packet keeps Apple/Kobo/D2D/Ingram/audio future-compatible while preserving the KDP/Google V1 boundary. The portal access and promotion model makes client-safe visibility and module enablement explicit. The domain record/state model names the conceptual records, relationships, state machines, and invalidation triggers a future plan must preserve. The operator workspace control model describes how admins should operate the module through staged commands and PiB bridges instead of a blank AI prompt. The production package QA model binds proof, file, cover, rights, accessibility, and checksum evidence to manual-handoff readiness. The jurisdiction/local publisher model prevents KDP/Google readiness from being mistaken for South African legal-deposit, ISBN/imprint, copyright, contributor, or local publisher readiness. The `ai-story` non-port checklist keeps the prior project useful as UX evidence while blocking standalone ownership, browser-key, broad-agent, and policy-source shortcuts. Together, they are enough for a design decision today, but not enough to make future implementation or upload-ready claims without refresh and approval.

Evidence rules for the next phase:

- A Phase 1 implementation plan must quote the final approval record and the current dossier commit.
- A Phase 1 implementation plan must quote the current `development` commit at planning time and list any design-packet content revisions after the baseline.
- Any policy-dependent task must cite the source register keys it relies on.
- Any local publisher task must cite the South African legal-deposit, ISBN/imprint, copyright, or publisher-source keys it relies on.
- Any task reusing an `ai-story` concept must cite the `ai-story` baseline used, classify the concept as keep/rewrite/reject, and preserve PiB org-scope, portal-scope, and Hermes-scope guardrails.
- Any direct or indirect channel expansion beyond KDP/Google manual handoff requires source refresh first.
- Any future demo must include at least one pass case, one warning case, and one blocker case.

## Not Yet Approved Or Built

The following remain intentionally out of scope until the approval gate is passed:

- `settings.portalModules.bookStudio` or any runtime module entitlement work.
- Book Studio admin or portal navigation.
- Book Studio Firestore collections, DTOs, sanitizers, route handlers, server actions, or React components.
- Book project, book brief, publishing packet, import ledger, or Hermes task records.
- Any schema or implementation mapping for the conceptual record/state model.
- Any implemented admin command center, workspace routes, tabs, commands, or UI components.
- Any implemented export engine, file validator, package manifest records, or package QA automation.
- Runtime Hermes dispatch from the app.
- KDP/Google direct publishing or credential handling.
- Wider-channel direct integrations.
- Automated review outreach, ad spend, public launch sends, or price/promotion changes.
- Client self-serve generation.

## Devil's Advocate Review

- The broad dossier could be mistaken for permission to build everything. The approval packet prevents that by making the V1 choice explicit.
- The standalone packet could be mistaken for implementation approval. It is approval for a future plan only.
- Too many design artifacts can hide the actual decision. Peet should primarily review the approval packet, review script, and mock review packet, then use the dossier and fixtures for evidence.
- If Phase 1 planning starts without a copied approval record, the plan will likely drift into channel research, file tooling, visual production, and analytics all at once.
- If runtime Hermes dispatch is treated as the first milestone, polished unsafe output will arrive before PiB has the evidence ledger, sanitizers, and forbidden-action tests needed to govern it.
- If portal visibility arrives before reviewed artifact promotion, clients may see raw research, internal rights uncertainty, parser errors, or unreviewed generated text.
- If analytics arrives without confidence and reconciliation labels, Book Studio will train clients to trust numbers that can later change through refunds, report delays, currency conversion, or settlement differences.

## Current Decision State

Book Studio is ready for Peet to approve, revise, reject, or request more design detail on the V1 approval record.

The safest next response from Peet, if the recommended V1 is accepted, is:

> Approve Book Studio V1 as an internal PiB production studio with optional client review. Use KDP and Google Play Books manual-handoff as the first channel focus. Start with business nonfiction, activity or low-content print, series scaffolding, and a public-domain or companion negative-control fixture. Build admin-first records, gate profiles, Research/Client Document/Project/artifact bridges, publishing packet tracking, local publisher evidence lanes, controlled Hermes skill readiness, package QA evidence, and manual analytics imports. Keep self-serve generation, public SaaS, direct publishing, account-secret custody, autonomous ads, automated review outreach, full layout tooling, automated export/file validation, and automated report integrations out of V1.
