# Book Studio V1 Production Budget And Capacity Model

**Date:** 2026-06-08
**Status:** Design-only budget and capacity gate; not an implementation plan, accounting model, forecast, or pricing instruction.
**Authoritative approval packet:** `docs/superpowers/specs/2026-06-08-book-studio-v1-approval-packet.md`
**Decision index:** `docs/superpowers/specs/2026-06-08-book-studio-v1-decision-index.md`
**Market evidence model:** `docs/superpowers/specs/2026-06-08-book-studio-v1-market-evidence-model.md`
**Ownership and commercial model:** `docs/superpowers/specs/2026-06-08-book-studio-v1-ownership-commercial-model.md`
**Production package QA model:** `docs/superpowers/specs/2026-06-08-book-studio-v1-production-package-qa-model.md`
**Publishing and analytics model:** `docs/superpowers/specs/2026-06-08-book-studio-v1-publishing-analytics-model.md`
**Source refresh contract:** `docs/superpowers/specs/2026-06-08-book-studio-v1-source-refresh-contract.md`

## Purpose

Book Studio should not move a good idea into production unless PiB knows what it will cost, who will do the work, what budget can be spent, how many review cycles are allowed, and what economic warnings should block or constrain the project.

This model defines a design-only production budget and capacity gate. It keeps production effort, Hermes/model usage, proof costs, human review, publishing economics, and launch spend separate from market evidence and upload readiness.

It does not create runtime records, ledgers, cost calculators, billing flows, route handlers, Firestore collections, UI, Hermes skills, ad integrations, direct publishing, analytics automation, or a Phase 1 task list.

## Current Official Source Implications

These official sources were checked on 2026-06-08 for budget and capacity design. They should be refreshed before any future implementation plan or production budget claim depends on them.

| Source key | Official source | Current design implication |
| --- | --- | --- |
| `kdp-price-book` | `https://kdp.amazon.com/en_US/help/topic/G200641280` | KDP list price depends on marketplace, royalty option, taxes, delivery costs, fixed-price laws, and manual price updates. Budget review must separate list price, displayed price, estimated royalty, and update evidence. |
| `kdp-digital-book-pricing` | `https://kdp.amazon.com/en_US/help/topic/G200634500` | KDP eBook royalties can use 35% or 70% options; the 70% option subtracts delivery costs and depends on eligible territories. EBook budget review needs file-size and territory warnings, not one universal royalty assumption. |
| `kdp-paperback-printing-cost` | `https://kdp.amazon.com/en_US/help/topic/G201834340` | Paperback printing cost varies by marketplace, trim, page count, ink, and paper; minimum list price is tied to print cost and royalty rate. Print-led projects need current print-cost evidence before production selection or package readiness. |
| `kdp-proof-author-copy-cost` | `https://kdp.amazon.com/en_US/help/topic/G2MYNEKHT443C2H2` | Proof and author copy cost is tied to print cost and selected marketplace. Proof budget should be explicit instead of hidden inside generic production cost. |
| `kdp-proof-author-copy-shipping` | `https://kdp.amazon.com/en_US/help/topic/GG6GRS7TKXVG6AGW` | Proof or author copy shipping depends on checkout, destination, speed, site, weight, and size; there is no direct formula. Shipping should be an estimate/warning until checkout evidence exists. |
| `kdp-reports` | `https://kdp.amazon.com/en_US/help/topic/GVTTXHKHVPAPBEDQ` | KDP report timing and estimate/payment behavior differ by report type, format, marketplace, KENP, and expanded distribution. Budget recovery cannot be treated as settled until report evidence supports it. |
| `google-book-prices` | `https://support.google.com/books/partner/answer/3238849?hl=en` | Google prices need country/currency, tax, effective-date, and fixed-price-law settings. Google budget review must not reuse KDP price rows as if they are Google-ready. |
| `google-revenue-split` | `https://support.google.com/books/partner/answer/9331459?hl=en` | Google revenue split can be 70% in many supported countries after updated terms, but defaults and country differences remain. Revenue split must be source-checked by account and country before margin claims. |
| `google-reports` | `https://support.google.com/books/partner/answer/9266485?hl=en` | Google reports expose earnings, sales, transactions, refunds, currencies, and preview traffic with distinct fields. Budget recovery and performance summaries need report type, refund, currency, and confidence labels. |

## Gate Position

The production budget and capacity gate sits after market evidence review and before production work begins.

Allowed before this gate:

- Idea capture.
- Research and market evidence collection.
- Gate profile selection.
- Rough internal sizing discussions.

Blocked before this gate:

- Book Brief approval for production.
- Hermes manuscript, image, translation, metadata, package, or report-import runs that can incur meaningful cost.
- Human editing, design, illustration, proof ordering, or subcontractor work.
- Client-facing promises about production timeline, price, launch date, profitability, or expected sales.
- Package QA, portal proof, manual handoff, launch budget, or analytics summary promotion.

## Budget States

| State | Meaning | Allowed next move | Blocks |
| --- | --- | --- | --- |
| No budget | Candidate has no production budget, capacity owner, or spend limit. | Continue research only. | Book Brief approval, production start, Hermes spend, proof orders, and client promises. |
| Rough sizing | PiB has a non-binding effort and cost sketch. | Create reviewable budget packet. | Any spend or public/client commitment. |
| Budget reviewable | Lanes have estimates, evidence, owners, warnings, and spend limits. | Human pass/warn/block review. | Production start until accepted. |
| Approved budget | Reviewer approves the current version, warnings, capacity lane, and budget ceilings. | Start bounded production tasks for this version only. | Becomes stale if scope, format, channel, price, page count, assets, source, or capacity changes. |
| Accepted-warning budget | Production can start with named warnings, owner, due date, and waiver path. | Start only the scoped work that does not violate the warning. | Portal/client profitability claims and expanded work. |
| Blocked budget | Cost, margin, capacity, or source evidence contradicts production. | Revise scope, price, channel, family, or reject candidate. | Production, package QA, portal proof, manual handoff, and launch. |
| Reconciled budget | Actual spend and report evidence are attached after work or launch. | Promote reviewed internal lessons or client-safe summary. | Hidden overruns and unsupported cost recovery claims. |

## Required Budget Lanes

Every production-selected candidate should carry these lanes before production starts.

| Lane | Minimum evidence | Pass signal | Warn signal | Block signal |
| --- | --- | --- | --- | --- |
| Scope and version | Candidate version, book family, channels, target formats, edition, expected page/word/asset range. | Scope fits the selected pilot and can be bounded. | Scope needs narrowing but has owner/date. | Scope is vague, visual/audio-heavy, or outside V1. |
| Human capacity | Operator, reviewer, editor, designer, source reviewer, client approver, and calendar load. | Named owners can complete within pilot capacity. | One role is constrained but replaceable or deferrable. | No owner, hero effort, or timeline depends on unavailable people. |
| Hermes/model budget | Skill keys, generation-run need, prompt/source manifest, model/provider policy, usage ceiling, retry limit. | Runs are bounded and have idempotency, safety, and cost ceilings. | Cost is acceptable only with lower retry or narrower scope. | Model-backed work can run without budget, provenance, or stale-run protection. |
| Editorial/design cost | Editing, proofreading, cover, interior, asset, illustration, template, and accessibility review estimates. | Cost is proportionate to candidate value and book family. | Cost is high but justified by strategic learning. | Cost exceeds the pilot or hides required quality work. |
| Print/proof cost | Trim, paper, ink, page count, proof copies, author copies, shipping estimate, marketplace. | Current KDP print/proof evidence supports the estimate. | Shipping or marketplace estimate needs checkout evidence. | Print cost, proof cost, or shipping is unknown for a print-led product. |
| Channel economics | KDP royalty option, delivery/file-size warning, print royalty, Google revenue split, territory, currency, taxes. | Per-channel economics can be reviewed without profit promises. | One channel has a warning or deferred price row. | Economics rely on one copied KDP or Google assumption across channels. |
| Break-even posture | Internal break-even units, cost recovery, margin confidence, no-sales-forecast flag. | Break-even is an internal risk lens with confidence labels. | Break-even exists but depends on unsettled cost or report evidence. | Sales forecasts, rank promises, or guaranteed profit are required to approve. |
| Launch spend | Ads, promo codes, free/discount campaigns, launch assets, outreach, review compliance, tracking. | Launch spend is zero or separately approval-gated. | Launch idea exists but budget is not approved. | Paid spend, public sends, review asks, or price changes can proceed from production budget alone. |
| Client/commercial visibility | Client-safe budget summary, hidden internal costs, client approval needs, ownership mode. | Portal wording explains scope and blockers without raw internal costs. | Client-owned work needs one approval artifact. | Portal exposes raw margin, cost, account, or reconciliation detail. |
| Actuals and reconciliation | Actual spend, usage, proof orders, vendor invoices, report imports, refunds, adjustments. | Actuals can be reconciled against approved budget. | Missing actuals create task but do not hide work. | Overrun or refund is hidden from analytics and review. |

## Budget Packet Shape

Future implementation should preserve this shape, whether stored as Research, artifacts, tasks, or review notes after approval.

```yaml
bookProductionBudgetPacket:
  status: design_contract_only
  candidateVersion: 1
  budgetVersion: 1
  bookFamilyGate: nonfiction_business_how_to
  selectedChannels:
    - kdp_manual_handoff
    - google_play_books_manual_handoff
  productionScope:
    wordCountRange: estimate_only
    pageCountRange: estimate_only
    assetCountRange: estimate_only
    targetFormats: []
    outsideV1WorkRequired: false
  capacity:
    operatorOwner: pib_admin
    requiredReviewers: []
    calendarWindow: not_committed
    heroEffortRequired: false
  hermesRunBudget:
    generationRunRequired: true
    modelBudgetCeiling: not_recorded_yet
    retryLimit: not_recorded_yet
    sourceManifestRequired: true
    idempotencyRequired: true
  costLanes:
    humanProduction: estimate_with_confidence
    editorialDesign: estimate_with_confidence
    proofAndPrint: estimate_with_source_keys
    launchSpend: zero_or_separately_approved
  channelEconomics:
    kdp:
      royaltyOption: not_recorded_yet
      deliveryCostRisk: pass | warn | block | not_applicable
      printCostEvidence: pass | warn | block | not_applicable
    google:
      revenueSplitEvidence: pass | warn | block | not_applicable
      countryCurrencyRows: pass | warn | block | not_applicable
  reviewDecision:
    state: no_budget | rough_sizing | budget_reviewable | approved_budget | accepted_warning_budget | blocked_budget | reconciled_budget
    reviewer: pib_admin
    warnings: []
    blockers: []
    acceptedWaivers: []
    nextEvidenceNeeded: []
```

## Capacity Rules

Capacity is not only calendar availability. It is whether the right people can perform the correct review at the correct stage without weakening the gate.

Book Studio should block production when:

- no one owns the production budget,
- no reviewer owns quality, rights, channel, or budget approval,
- a project needs fixed-layout, illustration, audio, legal, local-publisher, or translated-edition work outside the accepted pilot scope,
- Hermes output would create a review load the team cannot absorb,
- proof ordering, client review, or channel handoff depends on a person who is unavailable,
- manual spreadsheet work is the only way to reconcile cost or report evidence, or
- a client deadline requires skipping source refresh, quality review, package QA, or portal sanitization.

## Hermes Budget Boundaries

Hermes can help estimate and govern production effort. It cannot spend money or approve budgets.

Allowed:

- Estimate effort from reviewed scope and source evidence.
- Flag missing budget lanes, high-cost work, capacity gaps, stale source evidence, and negative margin.
- Create internal tasks for reviewer decisions.
- Recommend narrowing a candidate to fit the pilot.
- Summarize approved budget status in client-safe language after review.

Forbidden:

- Start model-backed generation without a budget ceiling and generation-run ledger.
- Approve spend, production capacity, launch budget, ad budget, or price changes.
- Hide overruns by moving work into another lane.
- Tell a client the book will be profitable, sell, rank, or recover cost.
- Mark package QA, manual handoff, launch, or analytics ready.

## Portal Rules

Production budget is internal by default.

Portal may show only:

- reviewed scope summary,
- client-owned approval requests,
- safe "more budget evidence needed" blocker,
- reviewed production status,
- reconciled and sanitized analytics/cost-recovery summary if explicitly approved.

Portal must not show:

- raw PiB labor cost,
- internal margin analysis,
- model/provider cost debugging,
- raw proof-order checkout details,
- payment-profile or report-access detail,
- unreconciled refunds, adjustments, or vendor costs,
- operator-capacity concerns that have not been rewritten for client review.

## Pass/Warn/Block Fixtures

| Fixture ID | Scenario | Expected decision |
| --- | --- | --- |
| `BUDGET-PASS-001` | A business nonfiction ebook has reviewed scope, named owners, bounded Hermes runs, no proof cost, KDP/Google price rows with warnings recorded, and no launch spend. | `approved_budget`; production can start for the current scope only. |
| `BUDGET-WARN-001` | A low-content planner has clear use case but print cost, proof shipping, and margin evidence need checkout or calculator confirmation. | `accepted_warning_budget` only if owner/date/waiver path are named; no package QA or manual handoff until proof economics are resolved. |
| `BUDGET-WARN-002` | A strong series concept needs book-one production only because follow-up volume cost and capacity are unknown. | Allow book one budget only; future-volume production and series economics remain blocked. |
| `BUDGET-BLOCK-001` | A workbook has unknown page count, color/trim assumptions, no proof budget, and negative or unknown margin. | Block production, package QA, portal proof, and manual handoff until scope and print economics are reviewed. |
| `BUDGET-BLOCK-002` | A translated illustrated book requires target-language reviewer, art revisions, fixed-layout work, and proofing outside V1 capacity. | Block or re-scope; do not let market interest or client pressure override capacity. |
| `BUDGET-BLOCK-003` | An operator wants to start launch ads or promo-code distribution from the production budget. | Block; launch spend needs the launch/lifecycle governance gate and separate approval. |

## Approval Impact

This model does not change the recommended V1 approval posture:

- Internal PiB production studio with optional client review.
- KDP and Google Play Books manual handoff first.
- Reviewed market evidence before production selection.
- Controlled Hermes readiness.
- Package QA, local publisher, language/translation, launch/lifecycle, and analytics gates preserved.

It tightens one rule that future planning should preserve: a candidate cannot move from production-selectable to production-started unless the current scope has an approved or accepted-warning production budget and capacity state. That state is not upload readiness, launch approval, profitability proof, or analytics confidence.

## Devil's Advocate

- A book can pass market evidence and still be a bad production decision if it needs more time, review, art, proofing, or channel economics than V1 can absorb.
- Low-content and workbook ideas look cheap until page count, proof copies, repetition review, print cost, shipping, and refunds are visible.
- Business nonfiction can look low-cost but still require expensive source checking, editorial review, and client approvals.
- Series plans can hide future capacity debt. Book one should pay its own evidence and budget burden.
- Hermes makes cost feel invisible. Without run ledgers and budget ceilings, model spend, retry loops, and stale-output rework become hard to govern.
- A break-even number can become a sales forecast. Book Studio should use break-even as internal risk language only.

## Current Review State

Book Studio now has a design-only production budget and capacity gate. It strengthens the market evidence, ownership/commercial, Hermes run-control, package QA, and analytics models without approving runtime implementation, cost calculators, billing, report automation, ad spend, Hermes dispatch, or Phase 1 planning.
