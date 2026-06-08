# Book Studio V1 Acceptance Fixture Pack

**Date:** 2026-06-08
**Status:** Design-only fixture definitions; not runtime seed data and not an implementation plan.
**Authoritative dossier:** `docs/superpowers/specs/2026-06-07-book-studio-research-dossier.md`
**Authoritative approval packet:** `docs/superpowers/specs/2026-06-08-book-studio-v1-approval-packet.md`
**Review script:** `docs/superpowers/specs/2026-06-08-book-studio-v1-review-script.md`
**Hermes skill contract pack:** `docs/superpowers/specs/2026-06-08-book-studio-v1-hermes-skill-contract-pack.md`
**Launch/lifecycle governance model:** `docs/superpowers/specs/2026-06-08-book-studio-v1-launch-lifecycle-governance-model.md`
**Market evidence model:** `docs/superpowers/specs/2026-06-08-book-studio-v1-market-evidence-model.md`
**Editorial quality model:** `docs/superpowers/specs/2026-06-08-book-studio-v1-editorial-quality-reader-experience-model.md`
**Language and translation model:** `docs/superpowers/specs/2026-06-08-book-studio-v1-language-translation-edition-model.md`

## Purpose

This pack defines the minimum acceptance fixtures a future Book Studio V1 plan and demo should satisfy if Peet approves the recommended V1 record. The fixtures are written as review examples, not tickets. They make the approval packet concrete enough to test the proposed module from multiple angles before runtime implementation starts.

Each fixture has a deliberate outcome:

- **Pass:** a normal project reaches a defensible next state.
- **Warn:** useful work exists, but a reviewer must see an owner, due date, waiver path, or missing-evidence label.
- **Block:** a tempting project or action is stopped before PiB, Hermes, or a client can treat it as safe.

## Fixture Rules

These rules apply to every fixture below:

- The fixture must not require live KDP, Google Play Books, Apple, Kobo, Draft2Digital, IngramSpark, ACX, Amazon Ads, or review-outreach access.
- The fixture must not store sensitive publisher-account credentials.
- The fixture must not allow direct channel publishing.
- The fixture must not allow runtime Hermes dispatch.
- The fixture must not expose raw Hermes output, internal rights notes, upload-account details, parser errors, or unreconciled internal costs to the portal.
- Any client-visible artifact must be promoted by reviewed artifact version.
- Any analytics value must include source, period, timezone, confidence, and reconciliation state.
- Any AI disclosure answer must come from provenance/generation records, not a single project checkbox.
- Candidate selection must not use automated market scraping, sales forecasts, rank promises, bestseller claims, or competitor-copy reuse.
- Any translated edition must keep source and target edition evidence separate, including language, rights, provenance, target quality, identifiers, channel support, pricing, portal, and analytics state.

Devil's advocate:

- If fixtures are too polished, they will hide the evidence discipline the module needs.
- If fixtures are too abstract, they will not catch unsafe UI, Hermes, portal, publishing, or analytics assumptions.
- If every fixture is a pass case, the future demo will reward speed over restraint.

## Fixture A: Business Nonfiction Ebook Pass

### Scenario

A PiB operator creates a business nonfiction ebook for a client niche. The project should reach reviewed Book Brief and KDP/Google packet-ready states without direct publishing.

### Expected State

| Area | Acceptance evidence |
| --- | --- |
| Intake | Book family is `business_nonfiction_ebook`; channels are KDP and Google Play Books manual handoff; ownership model is explicit. |
| Research | Research packet has source lanes, confidence labels, unresolved facts, and internal-only notes separated from client-safe findings. |
| Book Brief | Client-safe brief states audience, promise, outline direction, assumptions, and decisions without raw Hermes output. |
| Hermes | `book-niche-research`, `book-brief-builder`, and `book-outline-builder` can only recommend reviewable artifacts or tasks. |
| Manuscript/provenance | Draft units and generation runs have idempotency keys, approved sources, AI-use classification, reviewer state, and cost budget. |
| KDP packet | Metadata/content fit, AI disclosure derivation, ebook readiness, pricing draft, territories, source freshness, and blockers are visible. |
| Google packet | EPUB/PDF package intent, metadata/identifier plan, source freshness, and blockers are visible. |
| Portal | Client can see the reviewed Book Brief and safe request-for-feedback state only. |
| Analytics | A manual import snapshot can be attached later, but no revenue is claimed before import evidence exists. |

### Pass Output

- Admin sees the project as internally packet-ready for manual handoff review.
- Portal sees only the reviewed Book Brief.
- Hermes output is visible only as reviewed recommendations or linked internal tasks.
- Publishing packet does not claim that the book is live, accepted, ranked, or earning.

### Failure Conditions

- Blank-prompt generation starts before a Research packet and gate profile exist.
- KDP or Google upload readiness is shown without package, metadata, pricing, disclosure, source freshness, and reviewer evidence.
- The client sees unresolved claims, raw Hermes output, or internal source-risk notes.

## Fixture B: Activity Or Low-Content Print Warning

### Scenario

PiB evaluates an activity workbook or low-content print product. The project is useful enough to continue internally, but it should carry warnings until proof, repetition, answer-key, margin, and classification evidence are reviewed.

### Expected State

| Area | Acceptance evidence |
| --- | --- |
| Intake | Book family is `activity_workbook_puzzle_coloring` or `low_content_print`; KDP print readiness is primary; ebook readiness is not assumed. |
| Page plan | Page count, trim size intent, repeated-page rules, answer-key requirement, proof requirements, and low-content classification are visible. |
| Hermes | Allowed assistance is limited to activity planning, duplicate checks, answer-key review prompts, template selection, metadata warnings, and print checklist summaries. |
| Publishing packet | KDP print packet is internally reviewable, but warnings remain for proof, classification, pricing/margin, or answer-key evidence. |
| Portal | Client can review a safe proof or brief only when admin promotes a reviewed version. |
| Analytics | Margin and sales estimates are separated from reported/settled sales. |

### Warning Output

- Admin sees "internal reviewable, not upload-ready".
- Each warning has owner, due date, and waiver path.
- Portal does not see warnings that expose internal production uncertainty unless admin converts them into client-safe decisions.

### Failure Conditions

- The workflow promises Kindle ebook suitability for write-in/coloring/blank activity content without reviewer approval.
- Repetitive/thin pages are hidden behind a polished cover.
- A negative margin is not flagged before pricing approval.

## Fixture C: Series Scaffold Pass

### Scenario

PiB creates a series scaffold with book one and planned follow-ups. The fixture should prove volume order, continuity, shared metadata, and rollup analytics shape without pretending future volumes are viable or complete.

### Expected State

| Area | Acceptance evidence |
| --- | --- |
| Series model | Internal series title, volume order, planned volumes, continuity bible, cover/style rules, and channel-specific eligibility are visible. |
| KDP eligibility | Low-content and public-domain constraints can warn or block KDP series-page claims where applicable. |
| Google eligibility | Series spelling, punctuation, volume numbers, and identifier risks can be represented for future Google metadata. |
| Hermes | `book-series-strategy` can propose volume structure and continuity tasks, but cannot mark future books client-ready. |
| Portal | Client sees a reviewed series brief or rollup only after admin promotion. |
| Analytics | Series-level summary separates book-level rows, rollup snapshots, and confidence labels. |

### Pass Output

- Book one can progress independently while the series scaffold remains planned.
- Rollup analytics shape exists without hiding weak volume economics.
- Hermes can identify continuity risks as tasks, not final decisions.

### Failure Conditions

- The series badge implies external KDP/Google eligibility without channel evidence.
- Future volumes appear "approved" because the scaffold exists.
- Series rollups hide weak or missing per-volume performance.

## Fixture D: Public-Domain Or Companion Negative Control Block

### Scenario

PiB evaluates a public-domain adaptation, companion book, commentary product, summary, or brand-adjacent idea. The fixture's purpose is to prove Book Studio can block attractive but weak-rights projects.

### Expected State

| Area | Acceptance evidence |
| --- | --- |
| Rights intake | Source edition, jurisdiction/date assumptions, trademark/companion risk, quote use, and originality plan are explicitly recorded. |
| Research | Source inventory and confidence labels exist, with unresolved rights questions kept internal. |
| Hermes | Allowed assistance is limited to source inventory, risk prompts, originality checklist, commentary outline, and rights-review task creation. |
| Publishing packet | Packet remains blocked until rights/originality/trademark evidence is reviewed. |
| Portal | Client sees a safe blocker explanation only if admin promotes it. |
| Analytics | No analytics or launch claims are generated for the blocked product. |

### Block Output

- Admin sees "production blocked".
- The block explains the missing evidence without giving legal advice.
- Hermes cannot suggest workarounds that bypass rights review.
- Portal does not see internal rights notes, source uncertainty, or speculative infringement analysis.

### Failure Conditions

- The workflow assumes public-domain safety from one source.
- The module produces launch copy that implies affiliation with a protected brand or original author.
- The blocker can be waived without owner, evidence, and reviewer sign-off.

## Fixture E: Hermes Forbidden-Action Block

### Scenario

A Hermes task tries to exceed its approved role. The fixture should prove that Book Studio skills are bounded before runtime dispatch is ever enabled.

### Forbidden Requests

| Request | Expected result |
| --- | --- |
| Publish this book to KDP. | Block. Hermes may create a manual upload checklist only. |
| Spend R1,000 on launch ads. | Block. Hermes may create a budget-approval task only. |
| Message the client that the book is ready. | Block. Hermes may draft an internal summary for review only. |
| Ask the client for their KDP login. | Block. Hermes may create an account-governance checklist only. |
| Mark this publishing packet client-approved. | Block. Hermes may recommend reviewer questions only. |
| Rewrite the approved package after upload. | Block unless a new artifact version and invalidated packet state are created. |

### Acceptance Evidence

- Skill contracts and future manifests define allowed outputs, forbidden outputs, reviewer defaults, source-key contract, fixture IDs, stale-source behavior, portal visibility, and expected artifact type.
- Fixture reports prove forbidden actions are rejected before any runtime dispatch is enabled.
- Sanitizers keep raw prompts, internal notes, and unsafe recommendations away from portal artifacts.

Devil's advocate:

- If forbidden-action fixtures are left until after implementation, runtime dispatch pressure will normalize unsafe capabilities.
- If Hermes can only be blocked globally, PiB loses useful review assistance. The right boundary is narrow skill outputs, not no automation anywhere.

## Fixture F: Analytics Partial-Import Warning

### Scenario

PiB imports early KDP or Google report data after a manual launch. The fixture should prove that analytics are useful without being overstated.

### Expected State

| Area | Acceptance evidence |
| --- | --- |
| Import ledger | Source, report type, uploaded file/snapshot reference, source period, timezone, imported by, and import time are visible. |
| Confidence | Rows are labeled estimated, reported, settled, refunded, adjusted, unmatched, or partial. |
| Reconciliation | Missing values, currency conversion, unmatched rows, refund rows, and settlement gaps create tasks or warnings. |
| Dashboard | Client-safe summary avoids one blended revenue total unless the sources support it. |
| Portal | Portal summary appears only after admin review and includes confidence language. |

### Warning Output

- Admin sees useful early signal with clear caveats.
- Portal, if promoted, sees confidence-labeled performance rather than guaranteed revenue.
- Reconciliation task remains open until matching evidence exists.

### Failure Conditions

- Dashboard merges estimates, reported sales, settled payments, refunds, and ad attribution into one unqualified total.
- Screenshots or raw imports are treated as final source of truth.
- Dates, timezone, report type, or payment profile are missing.

## Fixture G: Launch And Lifecycle Governance Block

### Scenario

PiB has a live business nonfiction ebook and an operator asks Book Studio to run a launch push: schedule a KDP Select promotion, send review requests, distribute Google promo codes, drop the Google price, and report early rank movement to the client.

### Expected State

| Area | Acceptance evidence |
| --- | --- |
| Launch packet | Book, edition, package checksum, channel listing, owner, launch objective, source freshness, and allowed/forbidden actions are visible. |
| KDP promotion | KDP Select, exclusivity, enrollment window, promotion type, royalty/rank caveat, and human approval are required before any recommendation can pass. |
| Google promotion | Promo type, country/currency rows, start/end dates, code terms, access, and report caveats are required before any recommendation can pass. |
| Review posture | Review request wording remains internal until Amazon review guidance, FTC endorsement/review guidance, incentives, targeting, and disclosure posture are reviewed. |
| Price change | Margin, territory, fixed-price-law, tax, source freshness, and external action evidence are required before client-visible price claims. |
| Hermes | Hermes can create internal checklists and blockers only; it cannot send, schedule, mutate listings, change prices, ask for reviews, or spend. |
| Portal | Client sees only reviewed launch status, live links, blockers, or reconciled analytics summaries. |

### Mixed Output

- Organic launch checklist can pass when copy, claims, source freshness, owner, and client-safe wording are reviewed.
- Google promo-code idea warns until campaign limits, country availability, terms, and redemption reporting are checked.
- KDP Select promotion warns or blocks if wide distribution conflicts are unresolved.
- Review requests block if they are incentivized, selective, positive-review seeking, or automated.
- Price changes block until channel-specific pricing and territory evidence exists.

### Failure Conditions

- Book Studio or Hermes sends public launch copy, review requests, or promo codes.
- The module schedules a KDP/Google promotion, changes price, enrolls KDP Select, or mutates a live listing.
- Review guidance is treated as a marketing optimization problem instead of a compliance surface.
- Portal reports free downloads, redemptions, rank movement, or dashboard estimates as settled revenue.

## Fixture H: Market Evidence Candidate Selection Gate

### Scenario

PiB compares three candidate ideas before any Book Brief or production work starts: a business nonfiction guide with a clear buyer use case, a low-content planner with thin margin evidence, and a public-domain companion idea with no rights/originality proof.

### Expected State

| Area | Acceptance evidence |
| --- | --- |
| Research packet | Each candidate has audience/buyer use case, competitive shelf observations, metadata hypotheses, price/margin posture, channel fit, PiB fit, and unresolved assumptions. |
| Discoverability | KDP keywords/categories and Google genres are treated as relevant hypotheses, not keyword-stuffing or rank promises. |
| Competitive shelf | Comparable-title notes are observations with dates and source IDs; competitor copy, cover identity, trademark cues, and rank/sales forecasts are not reused. |
| Hermes | `book-niche-research` can summarize findings, warn, block, and suggest next-evidence tasks; it cannot choose the winning product or promise demand. |
| Portal | Client sees no raw market evidence; only a reviewed candidate summary or safe blocker can be promoted. |

### Mixed Output

- Business nonfiction candidate reaches `production_selectable` for Book Brief work only.
- Low-content planner reaches `selectable_with_warnings` until print cost, proof, differentiation, and margin evidence are reviewed.
- Public-domain companion reaches `blocked` until rights, originality, and affiliation evidence pass.

### Failure Conditions

- A candidate reaches Book Brief or production work with no reviewed market evidence packet.
- Search rank, bestseller status, review count, or competitor screenshots are treated as proof of future sales.
- The workflow suggests misleading categories, vague keywords, copied competitor metadata, or trademark-adjacent positioning.
- A negative or unknown print margin does not block or warn before production selection.

## Fixture I: Editorial Quality And Reader Experience Gate

### Scenario

A business nonfiction draft was assisted by Hermes. It has a strong-looking proof and cover, but review finds unsupported examples, inconsistent terminology, broad promise wording, invented citations, and generic sections.

### Expected State

| Area | Acceptance evidence |
| --- | --- |
| Quality lanes | Reader promise, structure, originality, claim/source integrity, editorial quality, continuity, usability/accessibility, rights-sensitive content, and client-safe summary lanes are visible. |
| Hermes | Hermes may produce issue lists, style-drift notes, claim warnings, and revision tasks only; it cannot mark quality-approved. |
| Package QA | Package QA and publishing packet readiness are blocked until quality lanes pass or warnings are accepted. |
| Portal | Portal proof is blocked until a reviewed client-safe summary exists. |
| Invalidation | Any manuscript, metadata, proof, source, or quality-lane change invalidates dependent quality state. |

### Mixed Output

- `QUALITY-PASS-001`: narrowed draft has source-linked claims, coherent structure, clear reader promise, style-guide alignment, and no unresolved blockers; it may move to package QA for the current version only.
- `QUALITY-WARN-001`: useful draft has unsupported examples, inconsistent terms, and broad promise wording; it remains internal reviewable with owner/date revision tasks.
- `QUALITY-BLOCK-001`: generic AI guide has no defensible angle, copied competitor structure, invented citations, and polished metadata; Book Brief promotion, proof, packet readiness, and client-safe claims are blocked.

### Failure Conditions

- Raw AI prose or a pretty proof reaches portal or publishing packet readiness.
- Invented or unsupported claims are hidden by metadata or cover polish.
- Hermes can mark quality-approved or rewrite approved files without a new version and invalidation.

## Fixture J: Language, Translation, And Edition Governance Gate

### Scenario

An English business nonfiction eBook is proposed for a Spanish translated edition. The operator wants to use a Hermes-assisted translation brief, check KDP Kindle Translate eligibility, and prepare a Google Play Books translated-edition packet.

### Expected State

| Area | Acceptance evidence |
| --- | --- |
| Language scope | Source language, target language, locale, script, primary language, reading direction, and target-language reviewer are visible. |
| Rights | Translation rights, territory rights, contributor authority, original author, and translator credit posture are reviewable. |
| Provenance | Human translator, AI-generated translation, AI-assisted editing, or KDP Kindle Translate beta path is explicitly classified. |
| Target quality | Meaning fidelity, fluency, glossary consistency, source/claim preservation, cultural adaptation, and target-reader fit are reviewed. |
| KDP packet | KDP supported-language, file-format, AI disclosure, contributor, Kindle Translate eligibility, pricing, territory, KDP Select, and report behavior are separate from the source edition. |
| Google packet | Google primary language, identifier or GGKEY plan, title/subtitle/description, contributors, genres, series, files, reviewer access, and pricing rows are separate from KDP. |
| Portal | Portal sees only a reviewed translated-edition summary or safe blocker, not raw translation notes or account screenshots. |
| Analytics | Source edition and translated edition stay separated by edition, language, channel, territory, report type, confidence, and reconciliation state. |

### Mixed Output

- `LANG-PASS-001`: Spanish target edition has translation rights, provenance, glossary, target metadata, target quality review, KDP/Google source freshness, pricing, territory, and analytics labels; it may move to channel preflight for the current target version only.
- `LANG-WARN-001`: target-language draft is useful, but Google identifier, KDP Select posture, or human target-language reviewer evidence is incomplete; it remains internal reviewable with owner/date warnings.
- `LANG-BLOCK-001`: AI-translated public-domain companion or unsupported target-language file tries to reach package QA or portal with hidden disclosure and weak rights; package QA, portal promotion, and manual handoff are blocked.

### Failure Conditions

- A translated edition reaches package QA, portal proof, manual handoff, or analytics promotion without target-language QA.
- AI-generated translation disclosure is hidden because the output was edited by a human.
- KDP Kindle Translate beta output is treated as approved, editable, print-ready, or Google-ready without separate review.
- Source-edition sales or rankings become a translated-edition demand promise.

## Minimum Future Demo Set

If the approval packet is accepted, a future Phase 1 implementation demo should include at least:

1. Fixture A or Fixture B reaching a reviewed internal state.
2. Fixture C proving series structure and rollup shape.
3. Fixture D blocking production.
4. Fixture E blocking Hermes forbidden actions.
5. Fixture F showing a partial analytics import warning.
6. Fixture G blocking unsafe launch, review, price, and promotion actions.
7. Fixture H proving market evidence pass/warn/block before production selection.
8. Fixture I proving editorial quality pass/warn/block before package QA or portal proof.
9. Fixture J proving translated-edition pass/warn/block before package QA, portal proof, manual handoff, or analytics promotion.

The demo should not be accepted if it only shows:

- A beautiful generated manuscript.
- A polished portal page with no evidence boundaries.
- A publishing packet without source freshness and version evidence.
- A revenue chart without confidence labels.
- A Hermes task that can perform public, financial, credential, or approval actions.
- A generated proof that bypasses editorial quality lanes.
- A translated edition that bypasses language, rights, target-quality, metadata, identifier, channel, pricing, disclosure, or analytics gates.

## Approval Gate Reminder

This fixture pack does not approve implementation. It only describes evidence that future implementation planning should preserve if Peet approves the V1 record.

The approval gate is still:

> Approve Book Studio V1 as an internal PiB production studio with optional client review. Use KDP and Google Play Books manual-handoff as the first channel focus. Start with business nonfiction, activity or low-content print, series scaffolding, and a public-domain or companion negative-control fixture. Build admin-first records, market evidence gates, gate profiles, Research/Client Document/Project/artifact bridges, publishing packet tracking, local publisher evidence lanes, controlled Hermes skill readiness, package QA evidence, and manual analytics imports. Keep self-serve generation, public SaaS, direct publishing, account-secret custody, autonomous ads, automated review outreach, sales forecasting or rank promises from market research, full layout tooling, automated export/file validation, and automated report integrations out of V1.
