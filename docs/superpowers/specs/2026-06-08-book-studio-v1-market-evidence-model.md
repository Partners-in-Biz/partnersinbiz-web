# Book Studio V1 Market Evidence And Commercial Selection Model

**Date:** 2026-06-08
**Status:** Design-only market evidence model; not an implementation plan, market-demand claim, or publishing instruction.
**Authoritative approval packet:** `docs/superpowers/specs/2026-06-08-book-studio-v1-approval-packet.md`
**Decision index:** `docs/superpowers/specs/2026-06-08-book-studio-v1-decision-index.md`
**Pilot product decision register:** `docs/superpowers/specs/2026-06-08-book-studio-v1-pilot-product-decision-register.md`
**Book family gate catalog:** `docs/superpowers/specs/2026-06-08-book-studio-v1-book-family-gate-catalog.md`
**Ownership and commercial model:** `docs/superpowers/specs/2026-06-08-book-studio-v1-ownership-commercial-model.md`
**Publishing and analytics model:** `docs/superpowers/specs/2026-06-08-book-studio-v1-publishing-analytics-model.md`
**Hermes skill contract pack:** `docs/superpowers/specs/2026-06-08-book-studio-v1-hermes-skill-contract-pack.md`
**Source refresh contract:** `docs/superpowers/specs/2026-06-08-book-studio-v1-source-refresh-contract.md`

## Purpose

Book Studio should not turn every book idea into a manuscript. V1 needs a market evidence gate that answers whether a candidate deserves production effort before Hermes, editors, designers, and publishing operators spend time on it.

This model defines the future Book Research Evidence Packet for candidate selection: audience, buyer/use case, competitive shelf, discoverability metadata, book-family fit, rights risk, price/margin posture, channel fit, and PiB strategic fit.

It does not create runtime records, Research schemas, route handlers, Firestore collections, UI, Hermes skills, automated market scraping, sales forecasts, ad campaigns, direct publishing, or a Phase 1 task list.

## Current Official Source Implications

These official sources were spot-checked on 2026-06-08 for market-selection design. They should be refreshed before any future plan or candidate selection claim depends on them.

| Source key | Official source | Current design implication |
| --- | --- | --- |
| `kdp-keywords-discoverability` | `https://kdp.amazon.com/en_US/help/topic/G201743260` | KDP keywords should relate to the book content and avoid vague terms. Book Studio should treat keywords as evidence-bound discoverability hypotheses, not as keyword-stuffing prompts. |
| `kdp-categories-discoverability` | `https://kdp.amazon.com/en_US/help/topic/G200652170` | KDP category selection should be relevant, reader-oriented, and balanced between popularity and specificity. Book Studio should block misleading category choices. |
| `kdp-search-results` | `https://kdp.amazon.com/en_US/help/topic/GPYDJ3SECAVVPNVG` | Amazon search results are dynamic and can change. Book Studio should not promise first-page placement or stable ranking from a research snapshot. |
| `kdp-metadata-guidelines` | `https://kdp.amazon.com/en_US/help/topic/G201097560` | Metadata, cover, categories, title, subtitle, age, marketplace, and ISBN choices affect customer experience. Book Studio should bind market evidence to the exact metadata posture being reviewed. |
| `kdp-description-guidelines` | `https://kdp.amazon.com/en_US/help/topic/G201189630` | KDP descriptions should be simple, compelling, and professional, and cannot include review requests, testimonials, price/availability claims, time-sensitive promotions, or keyword phrases. |
| `kdp-content-quality` | `https://kdp.amazon.com/en_US/help/topic/G200952510` | KDP can reject disappointing, misleading, duplicated, too-short, excessively reused, or poor-quality content. Book Studio should block "fast generic AI book" candidates even when a shelf appears commercially active. |
| `kdp-content-ai-ip` | `https://kdp.amazon.com/en_US/help/topic/G200672390` | KDP content guidelines cover AI disclosure, IP responsibility, customer experience, companion-book limits, and public-domain expectations. Market evidence must include rights and originality posture, not only demand. |
| `kdp-price-book` | `https://kdp.amazon.com/en_US/help/topic/G200641280` | KDP list price, royalty option, marketplace, tax, fixed-price-law, print cost, and public-domain constraints affect viable price and margin. |
| `kdp-print-pricing` | `https://kdp.amazon.com/en_US/help/topic/G8BKPU9AGVZSF9QF` | Print royalty is reduced by printing costs and depends on distribution choices. Workbook, planner, and low-content candidates need margin checks before production selection. |
| `google-sell-books` | `https://support.google.com/books/partner/answer/1079107?hl=en` | Google Play Books selling depends on accepted files, sale countries, DRM/list-price settings, preview, and revenue-share behavior. KDP viability does not prove Google viability. |
| `google-metadata` | `https://support.google.com/books/partner/answer/3237055?hl=en` | Google requires genre, title, and identifier metadata and recommends complete metadata for discoverability. Genres should be relevant and usually limited to a small set. |
| `google-add-book` | `https://support.google.com/books/partner/answer/9261664?hl=en` | Google setup separates Book ID, book info, genres, contributors, series, and settings. Candidate evidence should say which channel metadata fields are still unproven. |
| `google-content-policies` | `https://support.google.com/books/partner/answer/1067634?hl=en` | Google blocks spam, misleading or disappointing content, confusingly similar metadata, duplicate public-domain content, and poor file quality. Market evidence must consider policy and reader-quality risk. |
| `google-program-policies` | `https://support.google.com/books/partner/answer/166501?hl=en` | Google program policies affect file types, reports, refunds, content rules, currency, DRM/printing, and client-services terms. Candidate economics should not use KDP assumptions as Google assumptions. |

## Selection Posture

The market evidence gate is not a prediction engine. It is a review workflow that prevents weak candidates from entering production as if demand, quality, and commercial fit were already proven.

Allowed claims:

- "This candidate is evidence-reviewable."
- "This candidate is selectable for production with warnings."
- "This candidate is blocked until evidence changes."
- "This candidate has a clear buyer/use case, but no sales performance exists yet."

Forbidden claims:

- "This book will sell."
- "This keyword/category will rank."
- "This candidate is a bestseller opportunity."
- "Competitor sales prove our future sales."
- "A shelf screenshot proves demand."
- "A generic AI-generated book is acceptable because the category is active."

## Candidate Evidence States

| State | Meaning | Allowed next move | Blocks |
| --- | --- | --- | --- |
| Idea captured | A candidate book idea exists with owner, audience guess, and book family guess. | Create Research packet and gate profile. | Brief, outline, generation, packet, and client promise. |
| Evidence collecting | Research lanes are open for audience, shelf, metadata, pricing, rights, format, channel, and PiB fit. | Keep gathering source-linked findings. | Production selection and client-safe claims. |
| Evidence reviewable | Findings have source IDs, observation dates, confidence labels, and unresolved assumptions. | Human pass/warn/block review. | Hermes may not turn findings into client promises. |
| Production selectable | Reviewer approves the current candidate version, gate profile, warnings, and next evidence needed. | Create or approve Book Brief work. | Upload-ready or launch claims. |
| Selectable with warnings | Candidate can proceed only with named warnings, owner, and review dates. | Continue internal production with visible warnings. | Portal promotion unless the warning is rewritten safely. |
| Blocked | Evidence contradicts the candidate or a required lane is missing, stale, unsafe, or commercially incoherent. | Revise, park, or reject the candidate. | Brief promotion, manuscript production, publishing packets, and client claims. |
| Retired | Candidate is intentionally dropped or superseded. | Keep decision log and reusable lessons. | Any active production work. |

## Required Evidence Lanes

Every real candidate should carry these lanes before it becomes production selectable.

| Lane | Minimum evidence | Pass signal | Warn signal | Block signal |
| --- | --- | --- | --- | --- |
| Reader and buyer use case | Target reader, job-to-be-done, buyer decision, urgency, and why a book is the right format. | A specific reader can be named and the book solves a concrete need. | Audience exists but the buyer/use case is broad or weak. | No clear buyer, or the promise is only "people buy books like this." |
| Competitive shelf | Manual observations of comparable titles, formats, price bands, quality expectations, metadata patterns, and gaps. | Comparable shelf is active and the candidate has a defensible difference. | Shelf is active but crowded, low quality, or weakly differentiated. | Candidate is a copy, trademark bait, public-domain duplicate, or indistinguishable commodity. |
| Discoverability metadata | Candidate title/subtitle direction, KDP keywords, KDP categories, Google genres, description posture, and channel-specific unknowns. | Metadata is relevant, honest, and channel-specific. | Metadata needs refinement or is too broad. | Metadata is misleading, stuffed, confusingly similar, or unrelated to content. |
| Book-family fit | Gate profile, format, page/asset needs, proof burden, low-content/activity distinction, series state, and family blockers. | Candidate fits one gate profile with known evidence needs. | Candidate crosses families and needs a narrower first version. | Candidate uses the wrong family to bypass proof, rights, or quality work. |
| Differentiation and quality promise | Unique angle, author/brand credibility, original contribution, source plan, reader outcome, and quality standard. | The book can be meaningfully different without misleading readers. | Differentiation depends on execution quality still unproven. | Thin rewrite, excessive reuse, too-short content, or generic AI slop. |
| Rights and originality | Source ownership, public-domain posture, companion/trademark risk, contributor/asset rights, quote/claim plan. | Rights basis is reviewable and does not depend on assumptions. | Rights look possible but need proof or local review. | Rights, public-domain, companion, trademark, or contributor evidence is missing or contradictory. |
| Channel fit | KDP and Google fit, sale countries, file/format assumptions, DRM/preview, series eligibility, account authority unknowns. | At least one first channel has a plausible manual-handoff path. | One channel fits and another needs warning or deferral. | No first channel can be described without policy or account-authority assumptions. |
| Price and margin | Candidate price band, KDP royalty path, print cost if relevant, Google price assumptions, production/proof cost, negative-margin flags. | Price/margin can be reviewed without claiming profit. | Margin is thin, cost uncertain, or price relies on a waiver. | Negative margin, impossible price, or missing print-cost evidence for print-led candidates. |
| PiB strategic fit | Why PiB or a client should produce this now, connection to campaigns, client outcomes, brand authority, reusable templates, or learning value. | Candidate supports a PiB/client growth objective beyond store sales alone. | Sales path is weak but strategic learning value is explicit. | Candidate is only a speculative KDP product with no PiB/client fit. |
| Production capacity | Required skills, editing, design, proofing, source work, client review, launch support, and expected calendar load. | The candidate can be produced inside the chosen pilot capacity. | Candidate is useful but too large for first proof without narrowing. | Candidate would consume fixed-layout, art, legal, audio, or channel work outside V1. |

## Evidence Packet Shape

Future implementation should preserve this shape, whether stored as Research records, artifacts, or review notes after approval.

```yaml
bookMarketEvidencePacket:
  status: design_contract_only
  candidateId: not_implemented
  candidateVersion: 1
  bookFamilyGate: nonfiction_business_how_to
  ownershipMode: pib_owned | client_owned | shared_or_revenue_share
  selectedChannels:
    - kdp_manual_handoff
    - google_play_books_manual_handoff
  readerBuyerUseCase:
    targetReader: reviewed_summary
    buyerDecision: reviewed_summary
    urgency: high | medium | low | unknown
    evidenceConfidence: strong | moderate | weak | blocked
  competitiveShelf:
    comparableObservations: []
    observationDate: "not_recorded_yet"
    copiedCompetitorCopyAllowed: false
    rankOrSalesForecastAllowed: false
  discoverability:
    kdpKeywordHypotheses: []
    kdpCategoryHypotheses: []
    googleGenreHypotheses: []
    descriptionPositioning: reviewed_summary
    misleadingMetadataRisk: pass | warn | block
  commercial:
    candidatePriceBand: not_recorded_yet
    printCostEvidenceRequired: true
    marginPosture: pass | warn | block | not_applicable
    profitForecastAllowed: false
  reviewDecision:
    state: evidence_collecting | evidence_reviewable | production_selectable | selectable_with_warnings | blocked | retired
    reviewer: pib_admin
    warnings: []
    blockers: []
    nextEvidenceNeeded: []
```

## Competitive Evidence Rules

Competitive research is allowed, but it must be treated as observation, not proof of future sales.

Allowed:

- Record comparable titles, formats, broad price bands, metadata patterns, quality expectations, and obvious reader-use patterns.
- Note shelf activity, reader promise patterns, and areas where a candidate can be meaningfully different.
- Use KDP/Google official guidance to validate metadata, category, description, price, and policy posture.
- Link manual Research observations back to the Book Brief as assumptions, not guarantees.

Forbidden:

- Scrape or store competitor copyrighted copy as reusable content.
- Use competitor title, subtitle, cover style, author name, trademark, or brand identity as a template.
- Treat bestseller rank, search position, review counts, or screenshots as stable sales proof.
- Use misleading categories, keyword stuffing, confusingly similar metadata, or duplicate public-domain positioning.
- Ask Hermes to invent demand evidence, sales forecasts, or competitor conclusions without source IDs.

## Book-Family Selection Consequences

| Candidate family | Market evidence emphasis | Extra warning |
| --- | --- | --- |
| Business nonfiction/reference | Buyer problem, claim evidence, author/brand authority, comparable price band, and source quality. | A PiB playbook can become brand content instead of a book someone would buy. |
| Activity/workbook/puzzle/coloring | Printable usefulness, answer/proof quality, page-count value, print cost, and negative-margin risk. | Fast page generation can hide repetition, weak utility, and Google refund/performance risk. |
| Low-content print | Specific use case, honest low-content classification, interior value, proof and margin evidence. | Low-content commodity shelves can reward speed while damaging quality and brand. |
| Series | Book one value, continuity need, volume-order logic, repeat buyer/use case, and per-title viability. | A series plan should not justify book one before book one has evidence. |
| Public-domain/companion | Rights/source edition evidence, originality, differentiation, territory, and affiliation risk. | Attractive source material is a blocker fixture unless originality and rights evidence pass. |
| Children/visual | Parent/child use case, reading age, asset rights, accessibility, fixed-layout proof, and review sensitivity. | Commercial appeal can hide rights, age, and production risk. Keep as fixture unless approval changes. |
| Audiobook/narrated future | Voice rights, narrator posture, audio quality, channel source refresh, and reporting path. | Audio should stay deferred until V1 proves text/print foundation. |

## Hermes Boundaries

Hermes can help build and review market evidence, but cannot choose the product alone.

Allowed:

- Summarize source-linked Research findings.
- Compare a candidate against the evidence lanes.
- Draft reviewer questions for weak evidence.
- Flag misleading metadata, generic content, weak differentiation, price/margin uncertainty, and rights risk.
- Suggest a blocker, warning, or next-evidence task.

Forbidden:

- Claim market demand without a reviewed Research packet.
- Predict sales, royalties, rankings, or bestseller outcomes.
- Recommend misleading categories or keyword stuffing.
- Copy competitor metadata, covers, descriptions, reviews, or proprietary structure.
- Mark a candidate production selectable.
- Convert a blocked candidate into a polished Book Brief.
- Message a client with raw market evidence or internal commercial assumptions.

## Portal Rules

Market evidence is internal by default.

Portal may show only:

- A reviewed candidate summary.
- A safe statement of why the book is being explored.
- A client question or approval request when ownership/client input is required.
- A safe blocker such as "More evidence is needed before this can move forward."

Portal must not show:

- Raw competitor notes.
- Internal sales or margin assumptions.
- Unsupported demand claims.
- Raw Hermes output.
- Rights uncertainty that has not been rewritten for client review.
- Store account, report, source-refresh, or policy-processing details.

## Analytics Feedback Loop

After a book is live, market assumptions should be revisited against real evidence without pretending early assumptions were forecasts.

The future analytics loop should compare:

- Candidate reader/use-case assumption against actual sales, reviews, support notes, and client feedback where available.
- Metadata hypotheses against changes in search visibility, category posture, and channel status where evidence exists.
- Price/margin assumptions against reported, refunded, settled, and cost evidence.
- Series assumptions against per-title performance, not only rollup totals.
- Launch/promotion assumptions against source-labeled campaign and report evidence.

The loop should not punish an operator for uncertainty recorded honestly. It should punish missing evidence, hidden warnings, and confident claims made before proof existed.

## Pass/Warn/Block Fixtures

| Fixture ID | Scenario | Expected decision |
| --- | --- | --- |
| `MARKET-PASS-001` | A business nonfiction ebook candidate has a specific buyer/use case, source-linked claim plan, relevant categories/genres, honest keyword hypotheses, defensible differentiation, first-channel fit, and reviewed price assumptions. | Production selectable for Book Brief work only; no sales forecast or upload-ready claim. |
| `MARKET-WARN-001` | A low-content planner has a clear use case but thin differentiation, print cost uncertainty, and category risk. | Selectable with warnings only if margin/proof/classification owners and dates are named. |
| `MARKET-WARN-002` | A series concept has a strong theme, but book one has not proven value and future-volume demand is speculative. | Allow internal series scaffold, block future-volume viability claims. |
| `MARKET-BLOCK-001` | A candidate relies on a competitor's title pattern, misleading categories, vague keywords, and a promise that search rank will make it sell. | Block; revise candidate or retire. |
| `MARKET-BLOCK-002` | A public-domain or companion candidate has active-looking demand but no rights/originality/affiliation evidence. | Block; use as negative-control fixture. |
| `MARKET-BLOCK-003` | A workbook has a negative or unknown print margin and no waiver path. | Block production selection until price, print cost, and margin evidence are reviewed. |

## Approval Impact

This model does not change the recommended V1 approval posture:

- Internal PiB production studio with optional client review.
- KDP and Google Play Books manual handoff first.
- Business nonfiction, activity or low-content print, series scaffolding, and public-domain/companion negative-control fixture first.
- Research required before production selection.
- No implementation or Phase 1 plan until Peet approves or revises the V1 approval record.

It tightens one rule that future planning should preserve: a Book Studio project cannot move from idea to production-selected until a market evidence packet is reviewed as pass or accepted warning. Production selection is still not upload readiness, launch approval, or revenue confidence.

## Devil's Advocate

- The easiest Book Studio failure is not a broken export. It is producing a polished book nobody should have made.
- "Active shelf" evidence can become false confidence. Many crowded categories are active because they are easy to enter, not because a new undifferentiated book is worthwhile.
- KDP discoverability guidance can tempt keyword and category manipulation. Book Studio should reward relevance and reader fit, not metadata tricks.
- Low-content and planner ideas are operationally tempting because they look fast. They still need proof, classification, margin, and customer-experience evidence.
- Client pressure can turn a weak idea into a production project. The market gate needs a visible block state that is safe to explain without embarrassing the client.
- Hermes can make weak ideas sound strategic. The gate should preserve uncertainty and force a human production-selection decision.

## Current Review State

Book Studio now has a standalone market evidence model for deciding whether a candidate deserves production. This strengthens the existing pilot decision register and Research-packet rule without approving runtime implementation, market scraping, sales forecasting, Hermes dispatch, direct publishing, or Phase 1 planning.
