# Book Studio V1 Approval Review Scorecard

**Date:** 2026-06-08
**Status:** Review scorecard only; not an implementation plan.
**Authoritative approval packet:** `docs/superpowers/specs/2026-06-08-book-studio-v1-approval-packet.md`
**Decision index:** `docs/superpowers/specs/2026-06-08-book-studio-v1-decision-index.md`
**Coverage audit:** `docs/superpowers/specs/2026-06-08-book-studio-objective-coverage-audit.md`
**Review script:** `docs/superpowers/specs/2026-06-08-book-studio-v1-review-script.md`
**Pilot product decision register:** `docs/superpowers/specs/2026-06-08-book-studio-v1-pilot-product-decision-register.md`
**Revision impact matrix:** `docs/superpowers/specs/2026-06-08-book-studio-v1-approval-revision-impact-matrix.md`
**Approval decision form:** `docs/superpowers/specs/2026-06-08-book-studio-v1-approval-decision-form.md`
**Source refresh execution report:** `docs/superpowers/specs/2026-06-08-book-studio-v1-source-refresh-execution-report.md`
**Hermes skill contract pack:** `docs/superpowers/specs/2026-06-08-book-studio-v1-hermes-skill-contract-pack.md`
**Launch and lifecycle governance model:** `docs/superpowers/specs/2026-06-08-book-studio-v1-launch-lifecycle-governance-model.md`
**Market evidence model:** `docs/superpowers/specs/2026-06-08-book-studio-v1-market-evidence-model.md`
**Editorial quality model:** `docs/superpowers/specs/2026-06-08-book-studio-v1-editorial-quality-reader-experience-model.md`
**Language and translation model:** `docs/superpowers/specs/2026-06-08-book-studio-v1-language-translation-edition-model.md`
**Production budget and capacity model:** `docs/superpowers/specs/2026-06-08-book-studio-v1-production-budget-capacity-model.md`
**Rights, asset, and contributor ledger model:** `docs/superpowers/specs/2026-06-08-book-studio-v1-rights-asset-contributor-ledger-model.md`

## Purpose

This scorecard gives Peet a compact way to judge whether the current Book Studio V1 approval packet is ready to approve, revise, reject, or send back for one more design aid.

It does not approve Book Studio runtime routes, records, APIs, Firestore collections, UI, module toggles, Hermes runtime dispatch, direct publishing, analytics automation, or a Phase 1 task list.

When the rows have been reviewed, copy the approval decision form to record the final outcome, accepted warnings, remaining blockers, source-refresh gate, and whether Phase 1 planning is allowed. After approval or revision, use the source refresh execution report before writing any Phase 1 plan.

## How To Use It

Score each row as `pass`, `warn`, or `block`.

| Score | Meaning | Decision effect |
| --- | --- | --- |
| pass | The current approval packet gives enough direction and evidence for this category. | Approval can proceed for this category. |
| warn | The category is directionally acceptable, but needs a named owner, accepted deferral, or approval-field revision. | Approval can proceed only if the warning is written into the revision record or accepted as a deferral. |
| block | The current packet would let Book Studio make a claim or perform a workflow without enough safety, evidence, or product clarity. | Approval should not proceed until the packet is revised or another design aid resolves the blocker. |

Overall decision rule:

- `approve_as_written` requires no blockers and no unresolved warnings.
- `approve_with_revisions` allows warnings only when the exact revised field is written down.
- `request_more_design_detail` is the right outcome when a blocker is narrow and answerable without runtime work.
- `reject_internal_studio_v1` is the right outcome when the desired first product is client self-serve, public SaaS, direct publishing, or another posture that conflicts with the packet.

## Scorecard

| Category | Pass standard | Warning examples | Block examples | Primary evidence docs |
| --- | --- | --- | --- | --- |
| Product posture | V1 is an internal PiB production studio with optional client review. | Peet wants more portal visibility but still accepts admin-operated production. | Peet wants public AI-book SaaS, client self-serve generation, or a creator tool as V1. | Approval packet, review script, objective coverage audit. |
| First channel boundary | KDP and Google Play Books manual handoff are enough for first proof. | One wider channel must stay future-compatible but not built first. | Direct publishing, credential custody, automated review outreach, Amazon Ads, or wider-channel automation is required for V1. | Publishing and analytics model, source refresh contract, source refresh execution report, wider-channel adapter packet. |
| First pilot set | Business nonfiction, activity or low-content print, series scaffolding, and a rights-first negative control are accepted. | A children's or visual fixture is added as a gated fixture only. | Pilot set is vague, visual/audio-first, or removes blocker proof without accepting weaker safety evidence. | Pilot product decision register, book-family gate catalog, acceptance fixtures, mock review packet. |
| Market evidence gate | Candidate ideas need reviewed audience/buyer, competitive shelf, discoverability, differentiation, rights, channel, price/margin, PiB fit, and capacity evidence before production selection. | Candidate can proceed with named evidence warnings, owner, and review date. | Production starts from a shelf screenshot, sales/rank promise, generic AI-book idea, misleading metadata, copied competitor positioning, or negative/unknown margin. | Market evidence model, pilot product decision register, acceptance fixtures, source refresh contract. |
| Production budget and capacity | Production-selected candidates need reviewed scope, human capacity, Hermes/model budget, proof costs, channel economics, break-even posture, launch-spend separation, and portal-safe budget wording before production starts. | Candidate can start only with named budget/capacity warnings, owner, due date, and waiver path. | Production starts with no owner, no model budget, unknown proof cost, negative/unknown margin, hidden launch spend, or profit promise. | Production budget/capacity model, ownership/commercial model, market evidence model, acceptance fixtures, source refresh contract. |
| Book-family gate coverage | Every important book family has a gate profile, fixture posture, or explicit deferral. | A family needs stronger future compatibility notes before planning. | A family is treated as supported without rights, format, accessibility, analytics, and channel evidence. | Book-family gate catalog, approval packet, coverage audit. |
| Editorial quality and reader experience | Generated or assisted manuscripts need version-bound quality lanes for reader promise, structure, originality, source/claim integrity, editorial quality, continuity, usability, accessibility, rights-sensitive content, and client-safe summaries. | A draft is useful but needs named revision tasks, accepted warnings, or a narrower quality lane before package/portal work. | Raw AI prose, generic content, invented claims, copied structure, unusable activities, or weak client-safe summaries can reach package QA, portal proof, or packet readiness. | Editorial quality model, production package QA model, red-team register, acceptance fixtures. |
| Language, translation, and edition governance | Translated editions have source/target language, translation rights, translator/AI provenance, target quality, reading direction, metadata, identifiers, pricing/territory, channel support, and analytics separation before package or portal work. | Translation intent exists but needs target-language reviewer, identifier, KDP Select, pricing, or channel-specific warning before handoff. | Translation production, Kindle Translate pathway, Google translated-edition packet, portal proof, package QA, or analytics promotion can proceed without the language gates. | Language/translation model, source refresh contract, acceptance fixtures, red-team register. |
| Rights, asset, and contributor ledger | Asset and contributor evidence exists for covers, images, fonts, templates, quotes, public-domain/open-licensed material, AI assets, client brand assets, translators, illustrators, designers, narrators, and other hired work before dependent states advance. | One asset or contributor has a named owner, due date, scope limitation, attribution task, or channel-specific warning. | Production start, package QA, portal proof, launch copy, analytics promotion, or manual handoff can proceed with missing, stale, noncommercial/no-derivatives-conflicting, disputed, or unassigned evidence. | Rights/asset/contributor ledger model, production package QA model, jurisdiction/local publisher model, acceptance fixtures. |
| Series governance | Volume order, continuity, shared metadata, release state, and rollup analytics are part of the V1 design boundary. | Series is accepted but not first demo evidence. | Series support means only naming several unrelated books as a series. | Research dossier, acceptance fixtures, domain record/state model. |
| Hermes scope | Hermes produces bounded artifacts, checks, recommendations, and proposed contract records; runtime dispatch stays gated. | Peet wants Wave 1 only or selected Wave 2 docs only. | Hermes can publish, approve, spend, message clients, request secrets, mark client-ready, bypass review, or run without contract fixtures. | Hermes skill blueprint, Hermes skill evaluation packet, Hermes skill contract pack, review script. |
| Publishing packet governance | Upload-ready claims require file, metadata, rights, account authority, AI disclosure, source freshness, and upload evidence. | One channel-specific warning needs an owner or waiver path. | A packet can be marked upload-ready while evidence is missing or stale. | Publishing and analytics model, production package QA model, ownership/commercial model. |
| Launch and lifecycle governance | Launch, promotion, review, price, revision, and unpublish actions are manual, approval-gated, source-backed, and evidence-recorded. | Launch ideas exist but stay internal until source, review, budget, price, and portal-safe wording are approved. | Automated review outreach, ad spend, public sends, price changes, promo-code distribution, or listing mutations are required for V1. | Launch/lifecycle governance model, publishing and analytics model, source refresh contract. |
| Account and ownership model | PiB-owned, client-owned, and shared authority states are explicit enough for first manual handoff. | Approval narrows to PiB-owned books only. | PiB stores sensitive channel secrets, publishes under unclear authority, or blends client and PiB revenue/costs. | Ownership/commercial model, source refresh contract, jurisdiction/local publisher model. |
| Jurisdiction and local publisher evidence | Local publisher readiness stays separate from KDP/Google channel readiness. | South African local evidence is a warning lane for drafting but blocks local-compliance claims. | Legal-deposit, ISBN/imprint, copyright, contributor, or publisher claims can pass without reviewed evidence. | Jurisdiction/local publisher model, approval packet, review script. |
| Production package QA | Proof, file, cover, rights, accessibility, source freshness, and checksum evidence bind readiness to one exact package version. | Manual preview rendering fixture is added without claiming automated export validation. | Any generated file, proof, or local PDF can be called upload-ready without package identity and preflight evidence. | Production package QA model, acceptance fixtures, mock review packet. |
| Portal exposure | Portal shows only promoted, reviewed artifacts and has a disabled-module posture. | Portal starts with Book Brief only while proof, packet, and analytics remain later V1 artifacts. | Raw Hermes output, internal rights uncertainty, parser errors, upload-account details, or unreconciled analytics appear to clients. | Portal access model, operator workspace model, approval packet. |
| Analytics trust | Every client-facing metric has source, period, timezone, confidence, and reconciliation state. | Partial imports are useful but labelled partial. | Estimates, screenshots, partial reports, or unsettled values are presented as guaranteed revenue. | Publishing and analytics model, acceptance fixtures, review script. |
| `ai-story` reuse | Prior `PMStander/ai-story` ideas are classified keep/rewrite/reject before reuse. | A concept is useful but needs stronger PiB boundary wording. | Standalone ownership, browser-key flows, direct porting, broad agents, or policy-source shortcuts are copied into PiB. | `ai-story` non-port checklist, source refresh contract, coverage audit. |
| Operator workflow | Admins can operate through staged controls, evidence gates, PiB bridges, and non-blank-prompt workflows. | One stage needs a narrower first-demo posture. | The module starts as a blank generation prompt with weak task, artifact, or review structure. | Operator workspace control model, platform workflow map, mock review packet. |
| Devil's advocate coverage | Negative control, stale-source, unsafe-Hermes, portal-leak, analytics-overclaim, and over-broad-scope risks are visible. | One risk needs a named owner in the future plan. | Approval ignores a known blocker because the happy path is compelling. | Red-team risk register, acceptance fixtures, review script. |

## Recommended Score For The Current Packet

Current design evidence supports `approve_as_written` or `approve_with_revisions` if Peet accepts the internal-studio posture.

The strongest reasons to approve as written:

- The packet narrows V1 to KDP and Google manual handoff instead of direct publishing.
- The first pilot set proves business value, series behavior, and blocker handling without starting from the hardest visual/audio cases.
- The market evidence gate prevents weak candidates from becoming Book Briefs, production projects, sales forecasts, or rank promises.
- The production budget and capacity gate prevents good ideas from becoming over-budget, over-capacity, or hidden-margin production work.
- The editorial quality gate prevents polished weak AI-assisted drafts from becoming proof, packet, portal, or publishing-ready.
- The language and translation gate prevents translated editions from inheriting source-edition readiness or hiding AI translation, rights, target-quality, identifier, pricing, channel, or analytics gaps.
- The rights, asset, and contributor ledger prevents attractive covers, public-domain ideas, CC assets, AI images, client brand assets, quotes, and hired contributor work from advancing without scoped evidence.
- Hermes is treated as reviewed artifact production and evidence checking, not autonomous publishing.
- The Hermes contract pack makes first skill boundaries copyable without creating runnable skill files.
- Package QA, local publisher, portal safety, analytics confidence, and `ai-story` non-port rules are explicit.

The strongest reasons to approve with revisions:

- Peet may want to start the portal with Book Brief only.
- Peet may want Wave 1 Hermes only before selected readiness checks.
- Peet may want PiB-owned books only for the first release.
- Peet may want a manual preview-rendering fixture in the production-readiness scope.

The strongest reasons to request more design detail:

- The first pilot book category is not yet the right commercial starting point.
- Local publisher posture for PiB-owned South African books needs a named imprint decision before planning.
- The review experience needs a visual companion or workflow mock before Peet can approve.

## Revision Prompts

If a row scores `warn`, copy the exact row name into the revision record and choose one of these actions:

| Warning type | Revision action |
| --- | --- |
| Narrower first scope | Remove the relevant item from `firstPilotSet`, `firstPortalReviewArtifacts`, `hermesFirstScope`, or `productionReadinessScope`. |
| Extra review evidence | Add the needed fixture or evidence lane to `firstPilotSet` or `productionReadinessScope`. |
| Wider channel pressure | Add the channel to `firstChannels` only if source refresh and channel-specific governance are accepted. Otherwise keep it in future-compatible deferral. |
| Ownership uncertainty | Change `ownershipModel` to `pib_owned_only` or add a clearer shared-governance note. |
| Accepted deferral | Add the deferral to `acceptedDeferrals` so the future plan cannot silently build it. |

Use the revision impact matrix before planning from any warning that changes `productPosture`, `firstChannels`, `firstPilotSet`, `firstPortalReviewArtifacts`, `hermesFirstScope`, `ownershipModel`, `jurisdictionAndLocalPublisherScope`, `productionReadinessScope`, `analyticsScope`, or `acceptedDeferrals`.

If a row scores `block`, do not translate it into a task list. First revise the approval packet or write a design-only aid that answers the blocker.

## Devil's Advocate

- A scorecard can create false confidence if Peet checks boxes without reading the evidence. Use it after the decision index, not instead of it.
- A warning is not a small bug. It is an accepted product-risk decision that must be written into the approval or revision record.
- A blocker is not implementation work. Treat blockers as approval-boundary problems until Peet accepts a revised V1 posture.
- The scorecard can make the design feel complete. The product is still unbuilt, and implementation planning remains gated.

## Current State

Book Studio remains ready for a V1 approval decision, not runtime implementation. The scorecard makes the decision easier to audit; it does not change the approval gate.
