# Book Studio V1 Pilot Product Decision Register

**Date:** 2026-06-08
**Status:** Pilot decision register only; not an implementation plan.
**Authoritative approval packet:** `docs/superpowers/specs/2026-06-08-book-studio-v1-approval-packet.md`
**Decision index:** `docs/superpowers/specs/2026-06-08-book-studio-v1-decision-index.md`
**Book-family gate catalog:** `docs/superpowers/specs/2026-06-08-book-studio-v1-book-family-gate-catalog.md`
**Approval review scorecard:** `docs/superpowers/specs/2026-06-08-book-studio-v1-approval-review-scorecard.md`
**Acceptance fixtures:** `docs/superpowers/specs/2026-06-08-book-studio-v1-acceptance-fixtures.md`

## Purpose

This register turns the embedded pilot-selection work from the main dossier into a standalone decision aid. It helps Peet choose which first book products Book Studio should prove without turning the decision into runtime work.

It does not claim current market demand, choose a final title, approve production, create templates, create Hermes skills, create Firestore records, create UI, publish to KDP or Google Play Books, or authorize a Phase 1 task list. Every live book candidate still needs a Research evidence packet before production.

## Decision Needed

Peet needs to choose the pilot shape that future planning must serve:

| Decision field | Recommended value | Why it matters |
| --- | --- | --- |
| `firstCommercialProof` | `business_nonfiction_ebook` | Proves source-linked research, claim review, Book Brief, manuscript units, KDP/Google packet readiness, and manual analytics import. |
| `firstPrintRiskProof` | `activity_or_low_content_print_product` | Proves print-first page planning, proof tracking, classification warnings, price/margin review, and package QA evidence. |
| `firstSeriesProof` | `series_scaffolding` | Proves continuity, volume order, shared metadata/styling, and title-level plus series-level analytics posture. |
| `firstBlockerProof` | `public_domain_or_companion_negative_control_fixture` | Proves the system can block attractive but weak-rights projects before production. |
| `firstCreativeRangeProof` | `children_visual_fixture_only` | Keeps visual/children's complexity visible without making fixed-layout production the first build driver. |

Recommended decision: keep the first four fields in V1 approval and keep the creative-range proof as a fixture/gate profile only.

## Pilot Candidate Matrix

These are product archetypes, not approved titles. A future Research packet must validate audience, competition, claim risk, pricing, source evidence, and channel fit before any candidate becomes a production project.

| Candidate archetype | Book family | What it proves | Hermes help allowed | Channel posture | Analytics posture | Decision posture |
| --- | --- | --- | --- | --- | --- | --- |
| PiB growth playbook or niche business guide | Business nonfiction/reference | Research-to-brief, claim review, outline/manuscript units, metadata, KDP/Google manual packet readiness. | Niche research, source-linked outline, claim-check queue, metadata options, readiness checklist. | KDP ebook/print and Google ebook manual handoff after package evidence. | Manual imports, source confidence, estimated/reported/settled separation. | Recommended first commercial proof. |
| Client-owned course companion or service workbook | Business nonfiction plus workbook | Client review artifacts, ownership/account governance, source claims, exercises, proof package, portal-safe approval. | Brief builder, outline builder, exercise suggestions, client-safe summary drafting. | KDP/Google manual handoff only if client ownership and account authority are explicit. | Client-safe summary after reconciliation labels exist. | Strong second proof or first client-owned proof. |
| 90-day planner, worksheet pack, tracker, or logbook | Activity/workbook or low-content print | Print template risk, repetition checks, low-content classification, proof tracking, price/margin review. | Activity/page plan, duplicate/repetition prompts, low-content warnings, print checklist tasks. | KDP print-led packet; Google warns or blocks unless digital reading use is defensible. | Print sales, margin, proof/order costs, refunds, negative-margin warnings. | Recommended first print-risk proof. |
| Growth systems series, niche playbook series, or client education sequence | Series overlay | Series bible, volume order, continuity, shared metadata, release cadence, rollup analytics. | Series strategy, continuity bible, stale-continuity warnings, per-volume outline proposals. | Channel series claims remain separate from internal PiB series state. | Per-title and rollup views with weak-volume visibility. | Recommended first series proof, paired with a business nonfiction or workbook pilot. |
| Public-domain adaptation, summary, companion, or brand-adjacent commentary idea | Public-domain/companion rights-first fixture | Rights/source edition review, originality threshold, trademark/affiliation warnings, blocker handling. | Source inventory, risk prompts, originality checklist, rights-review task creation. | No manual handoff unless rights evidence passes. | No launch or analytics claims while blocked. | Required negative-control fixture, not a commercial launch target. |
| Children's picture book, illustrated story, comic, or visual explainer | Children/visual fixed-layout fixture | Asset rights, age suitability, spread continuity, accessibility, fixed-layout proof, package complexity. | Style bible, spread checklist, reading-level prompts, asset-rights reminders. | Fixture or gated pilot only unless Peet revises V1. | Slower feedback; track proof and asset costs before store reports. | Keep as fixture unless V1 is revised toward creative-range proof. |
| Audiobook or narrated extension | Audiobook/narrated later-channel family | Voice rights, audio package, narration quality, channel-specific future scope. | Script adaptation, narrator brief, pronunciation list, audio QA checklist. | Deferred beyond KDP/Google ebook/print foundation. | Deferred until audio channel is approved. | Defer unless Peet explicitly chooses audiobook V1. |

## Evidence Required Before A Candidate Becomes A Real Project

Every real pilot candidate needs these reviewed artifacts before production:

| Evidence area | Required before production | Why |
| --- | --- | --- |
| Audience and promise | Target reader, buyer/use case, claim sensitivity, success criteria, and why the book should exist. | Prevents generic AI books and vague "content for sale" projects. |
| Source and originality | Source list, claim confidence, quote/citation limits, originality posture, and differentiation from existing work. | Prevents unsupported claims, thin rewrites, and weak market positioning. |
| Book-family gate profile | Family key, formats, channels, ownership mode, series mode, required evidence, blockers, and portal visibility. | Prevents treating all book types as one workflow. |
| Ownership and account authority | PiB-owned, client-owned, or shared posture; account used; publisher/imprint; territory and payment implications. | Prevents unclear publishing authority and blended commercial reporting. |
| Hermes scope | Allowed outputs, forbidden outputs, reviewer defaults, and fixture expectations for every skill involved. | Keeps Hermes as artifact support, not autonomous publishing. |
| Package QA posture | File/proof/cover/rights/accessibility/source freshness and checksum-bound readiness expectations. | Prevents calling a local PDF or draft EPUB upload-ready. |
| Portal exposure | Which reviewed artifacts can be client-visible and what stays internal. | Prevents raw drafts, rights uncertainty, or unreconciled analytics from leaking to clients. |
| Analytics baseline | Expected report source, import cadence, confidence label, reconciliation state, and series rollup if applicable. | Prevents early estimates from becoming client-facing revenue truth. |

## Recommended Approval Record Extension

If Peet accepts the current V1 posture and wants the pilot decision to be explicit, add this companion record beside the approval record:

```yaml
bookStudioV1PilotDecision:
  firstCommercialProof: business_nonfiction_ebook
  firstPrintRiskProof: activity_or_low_content_print_product
  firstSeriesProof: series_scaffolding
  firstBlockerProof: public_domain_or_companion_negative_control_fixture
  firstCreativeRangeProof: children_visual_fixture_only
  deferredPilotFamilies:
    - full_children_visual_production
    - cookbook_photo_portfolio_catalog
    - audiobook_or_narrated_extension
    - wide_distribution_first_channel
  researchRequiredBeforeProduction: true
  marketDemandClaimsAllowedBeforeResearchPacket: false
```

## What Each Pilot Choice Changes Later

This section is not a task list. It names planning consequences that should be preserved if Peet approves a pilot shape later.

| Choice | Future planning consequence |
| --- | --- |
| Business nonfiction leads | Research packets, claim checks, Book Briefs, outline/manuscript units, metadata packets, and manual analytics imports must be first-class. |
| Activity/low-content print leads | Page plans, proof packages, print cost/margin reviews, classification warnings, and package QA evidence move earlier. |
| Series proof is included | Series bible, continuity state, volume order, shared metadata, and title-vs-series analytics cannot be deferred. |
| Negative-control fixture is included | Rights/source review, blocker states, and client-safe block explanations must exist early enough to stop unsafe production. |
| Children/visual moves from fixture to production pilot | Asset-rights ledger, fixed-layout proofing, age/accessibility review, image provenance, and visual package QA become first-plan dependencies. |
| Audiobook moves into V1 | Voice rights, talent/consent, audio package QA, channel research, and audio analytics need a new source refresh and design aid first. |

## Devil's Advocate

- A PiB growth playbook can become brand content rather than a book people would buy. The Research packet must prove buyer/use-case fit before production.
- A client-owned workbook can look commercially useful but add account, publisher, approval, and revenue-reporting complexity. Use it only when ownership evidence is explicit.
- Low-content and planner products are tempting because they are fast to generate. They are also easy to make generic, low-quality, or brand-damaging. The gate should add friction.
- Series planning can overcommit before book one proves value. Series state should support continuity without pretending future volumes are already justified.
- Public-domain and companion ideas can look attractive because source material already exists. Treat them as blocker proof unless rights, differentiation, and affiliation risks pass.
- Children's and visual books are compelling demos, but they push the module into rights, fixed-layout, proofing, accessibility, and asset-production complexity before the core workflow is proven.
- No candidate should be presented as a market winner from this register. Market evidence belongs in a future Research packet, not in the approval shortcut.

## Current State

The recommended pilot shape remains business nonfiction, activity or low-content print, series scaffolding, and a public-domain or companion negative-control fixture, with children's/visual kept as a fixture/gate profile. This register makes that choice explicit; it does not approve implementation.
