# Book Studio V1 Book Family Gate Catalog

**Date:** 2026-06-08
**Status:** Design-only gate catalog; not an implementation plan.
**Authoritative dossier:** `docs/superpowers/specs/2026-06-07-book-studio-research-dossier.md`
**Decision packet:** `docs/superpowers/specs/2026-06-08-book-studio-v1-approval-packet.md`
**Acceptance fixtures:** `docs/superpowers/specs/2026-06-08-book-studio-v1-acceptance-fixtures.md`
**Source refresh contract:** `docs/superpowers/specs/2026-06-08-book-studio-v1-source-refresh-contract.md`

## Purpose

The main dossier already covers book types, but the rules are spread across the dossier, approval packet, fixtures, publishing model, source contract, and red-team register. This catalog makes the book-family decision surface explicit: when an admin starts a Book Studio project, the chosen family should derive the intake fields, evidence gates, Hermes permissions, publishing packet shape, analytics expectations, portal visibility, and blockers before any drafting or packaging work starts.

This file does not create runtime gate profiles, Firestore records, routes, APIs, UI, Hermes skill files, test data, channel integrations, report parsers, or a Phase 1 implementation plan.

## Current Official Source Checks

These official source pages were checked on 2026-06-08 for policy-sensitive family rules. They strengthen the catalog but do not replace the source refresh contract.

| Source key | Official source | Catalog consequence |
| --- | --- | --- |
| `kdp-content-ai-ip` | `https://kdp.amazon.com/en_US/help/topic/G200672390` | Every family needs AI-use, rights, customer-experience, public-domain, and companion-risk evidence before KDP handoff. |
| `kdp-low-content` | `https://kdp.amazon.com/en_US/help/topic/GGE5T76TWKA85DJM` | Low-content projects need their own profile and cannot inherit normal print, ISBN, release-date, or series assumptions. |
| `kdp-metadata-series` | `https://kdp.amazon.com/en_US/help/topic/G201097560` and `https://kdp.amazon.com/en_US/help/topic/GMFKBUS43QQ5AJ5A` | Internal PiB series state must stay separate from KDP series eligibility, metadata, and customer-facing series claims. |
| `kdp-public-domain` | `https://kdp.amazon.com/en_US/help/topic/G200743940` | Public-domain projects need source edition, differentiation, title, rights, and royalty-option gates before production. |
| `google-program-policies` | `https://support.google.com/books/partner/answer/18625?hl=en` and `https://support.google.com/books/partner/answer/166501?hl=en` | Google packets need rights, file, content, sales/reporting, refund, currency, and activity-content constraints separated from KDP. |
| `google-add-book` | `https://support.google.com/books/partner/answer/9261664?hl=en` and `https://support.google.com/books/partner/answer/3289675?hl=en` | Google readiness needs Partner Center fields, Book ID, metadata, file, cover, price, review, and publish-step evidence. |
| `google-series` | `https://support.google.com/books/partner/answer/11069638?hl=en` | Series numbering and relationship checks must be channel-specific. |
| `google-reports` | `https://support.google.com/books/partner/answer/9266485?hl=en` | Analytics must separate earnings, sales summary, sales transactions, and Google Books preview traffic. |

Freshness rule: source-backed pass states become stale after 14 days when they affect manual handoff, client promotion, analytics promotion, or Hermes readiness. Stale source evidence blocks only the dependent claim.

## Gate Profile Contract

Every book family should resolve to one gate profile with these fields before production work begins:

| Field | Purpose |
| --- | --- |
| `familyKey` | Stable internal family identifier. |
| `formats` | Ebook, print, fixed-layout, audiobook, or later-channel package assumptions. |
| `channels` | KDP, Google Play Books, wider-channel deferred, or internal-only. |
| `ownershipMode` | PiB-owned, client-owned, or shared/economics-blocked. |
| `seriesMode` | Standalone, book one, later volume, companion, collection, or series overlay. |
| `requiredEvidence` | Research, rights, source, manuscript, assets, package, pricing, account authority, and analytics evidence. |
| `hermesAllowedOutputs` | What Hermes can create as reviewable internal artifacts or task suggestions. |
| `hermesForbiddenOutputs` | What Hermes must never decide, publish, send, or expose. |
| `portalVisibility` | Which reviewed artifacts can be promoted to clients. |
| `packetShape` | KDP and Google packet checks required for this family. |
| `analyticsShape` | What can be imported, shown, warned, or blocked after launch. |
| `blockers` | Conditions that stop drafting, packaging, upload readiness, client promotion, or analytics promotion. |

Devil's advocate: if the gate profile is optional, the module will drift toward a blank-prompt content generator. The profile must be chosen before drafting, cover work, pricing, publishing packet work, or Hermes task dispatch.

## Family A: Business Nonfiction, Reference, How-To, Or Course Companion

**V1 posture:** recommended first commercial pilot.

Examples: local growth guide, professional playbook, niche how-to, guidebook, business explainer, course companion, checklist-driven reference book.

| Area | Gate requirement |
| --- | --- |
| Intake | Target reader, promise, commercial goal, expertise source, claim sensitivity, channel targets, ownership mode, client review scope, and series posture. |
| Research | Source-linked research packet with claim confidence, unsupported assertions, quote/citation limits, competitor positioning, and internal-only notes. |
| Production | Book Brief, outline, manuscript units, editorial passes, claim review, metadata packet, cover brief, AI-use provenance, and version history. |
| Hermes | `book-niche-research`, `book-brief-builder`, `book-outline-builder`, `book-claim-check`, `book-metadata-optimizer`, and readiness checklists can produce reviewable artifacts or tasks. |
| Publishing | KDP ebook/print packet and Google ebook packet stay separate; both need metadata, file, pricing, rights, AI disclosure, source freshness, and reviewer state. |
| Analytics | Manual imports can show estimated/reported/settled sales, refunds, price changes, source confidence, and client-safe summary only after reconciliation labels exist. |
| Portal | Reviewed Book Brief, proof package, publishing status summary, and confidence-labeled analytics can be promoted. Raw research and Hermes drafts stay internal. |

Blockers:

- Unsupported legal, medical, financial, or outcome claims.
- Thin generic AI content that does not show a defensible PiB/client point of view.
- Missing AI-generation disclosure evidence for text, images, or translations.
- Reused third-party course or book structure without rights review.

Devil's advocate: this family looks safe because it is text-heavy, but it can still fail through generic content, misleading expertise claims, unsupported ROI promises, keyword-stuffed metadata, or unreviewed AI-generated text.

## Family B: Narrative Fiction, Memoir, Or Story-Driven Reflowable Book

**V1 posture:** supported as a gate profile and later pilot, not the default first commercial proof.

Examples: short story collection, genre novella, memoir-style founder story, narrative brand book, inspirational story series.

| Area | Gate requirement |
| --- | --- |
| Intake | Genre, reader promise, age range, tone boundary, continuity needs, narrator/POV, originality source, sensitivity concerns, and series potential. |
| Research | Genre conventions, comparable positioning, originality notes, cultural/sensitivity risks, and rights/provenance for any real people, brands, places, or quoted material. |
| Production | Story bible, outline or beat map, manuscript units, continuity checks, editorial review, cover/metadata fit, and AI-use provenance. |
| Hermes | Hermes can support ideation, structure, continuity warnings, style bible drafts, and metadata options. Hermes cannot mark a manuscript final or originality-safe. |
| Publishing | KDP/Google packet focuses on manuscript quality, metadata honesty, category fit, contributor roles, AI disclosure, and cover-title match. |
| Analytics | Track title-level sales, series-readthrough signals if later available, pricing experiments only after manual approval, and review-risk notes separately from revenue. |
| Portal | Reviewed concept brief, story bible summary, and proof request can be promoted when useful. Raw drafts remain internal unless explicitly selected for review. |

Blockers:

- Character, plot, or cover too close to a protected work or living person's identity.
- Genre/category manipulation that misleads readers.
- Client-visible raw creative drafts that have not been reviewed.
- Series claims before book one can stand on its own.

Devil's advocate: fiction can absorb unlimited generation time without proving commercial fit. The gate profile must force a commercial hypothesis, review checkpoints, and stop conditions.

## Family C: Activity Workbook, Puzzle Book, Coloring Book, Or Educational Workbook

**V1 posture:** recommended first print-risk pilot, with warnings until proof evidence exists.

Examples: business workbook, classroom activity book, puzzle book, coloring book, guided worksheet pack, practice book, training manual with exercises.

| Area | Gate requirement |
| --- | --- |
| Intake | Activity type, age/skill level, answer-key need, page count, trim size, print-first assumption, repetition pattern, accessibility needs, and client/proof review path. |
| Research | Curriculum/source evidence where relevant, duplicate checks, solution correctness, age fit, safety notes, and whether the product is activity content or low-content. |
| Production | Page plan, template selection, proof manifest, answer-key review, duplicate/repetition report, print margin/cost estimate, cover/back-cover brief, and sample proof. |
| Hermes | Hermes can draft activity plans, puzzle prompts, answer-key review tasks, duplicate-check prompts, and print checklist summaries. |
| Publishing | KDP print packet leads. Google packet is separate and may warn where the product depends on writing, cutting, coloring, puzzles, or physical-page behavior. |
| Analytics | Separate margin estimate, reported print sales, expanded distribution uncertainty, production cost, and proof/order costs. |
| Portal | Reviewed proof package, sample pages, client feedback request, and safe status summary only. Internal margin doubts can be converted to client-safe decisions if needed. |

Blockers:

- No answer-key or correctness review where the activity requires one.
- Thin repetitive pages hidden by polished cover design.
- Negative margin, unreviewed trim/page count, or missing proof evidence.
- Google suitability inferred from KDP print readiness.

Devil's advocate: activity books can look productized early, but quality lives in repetition, correctness, proofing, and physical usability. A pretty PDF is not upload readiness.

## Family D: Low-Content Print, Journal, Planner, Notebook, Or Logbook

**V1 posture:** supported but risky; must not inherit normal book or series assumptions.

Examples: journal, planner, tracker, notebook, logbook, simple template book, repetitive fill-in pages.

| Area | Gate requirement |
| --- | --- |
| Intake | Low-content classification, intended use, repetition pattern, trim size, page count, cover promise, barcode/ISBN choice, release-date assumption, and marketplace fit. |
| Research | KDP low-content source evidence, differentiation, customer value, repetition honesty, pricing/margin comparison, and metadata fit. |
| Production | Template manifest, interior sample, repetition report, cover/metadata truth check, print proof, margin review, and low-content evidence snapshot. |
| Hermes | Hermes can suggest planner structures, template variants, metadata warnings, and proof checklist tasks. Hermes cannot decide classification or upload readiness. |
| Publishing | KDP low-content packet is separate from normal print packet. Google packet should be warn/block unless the product has a defensible digital reading use. |
| Analytics | Margin and conversion matter more than page engagement. Track print sales, refund signals, ad spend only if separately approved, and negative-margin alerts. |
| Portal | Client sees reviewed product concept, sample proof, and approval request. Internal low-content classification notes stay internal unless converted to client-safe wording. |

Blockers:

- Series eligibility claimed externally for low-content.
- Free KDP ISBN, release-date, or normal print assumptions copied from another family.
- Generic notebook with no defensible differentiation.
- Metadata promises more content than the book contains.

Devil's advocate: this family is easy to mass-produce and easy to damage the PiB brand with. Book Studio should make low-content friction higher, not lower.

## Family E: Children, Illustrated, Picture Book, Comic, Graphic, Or Visual Story

**V1 posture:** fixture and gate profile first; full production only if Peet explicitly expands V1.

Examples: children's picture book, illustrated story, comic, visual explainer, graphic mini-book, manga/light-novel-adjacent visual title.

| Area | Gate requirement |
| --- | --- |
| Intake | Age range, reading level, guardian sensitivity, visual style, character bible, spread count, fixed/reflowable choice, asset source, and accessibility expectations. |
| Research | Age suitability, content safety, visual references, illustration rights, cultural/sensitivity review, and format/channel proof requirements. |
| Production | Spread plan, art brief, asset-rights ledger, image provenance, fixed-layout or PDF proof, accessibility notes, print/ebook preview screenshots, and cover-wrap review. |
| Hermes | Hermes can draft story structure, style bible, spread checklist, reading-level prompts, asset-rights reminders, and proof review tasks. |
| Publishing | KDP and Google packets need file/format proof, image rights, cover/metadata match, age/mature settings, source freshness, and preview evidence. |
| Analytics | Slower feedback loop; track title sales, proof costs, artwork costs, review signals, and family/series rollup only after per-book evidence exists. |
| Portal | Reviewed concept, sample spreads, and proof feedback can be promoted. Raw image generations, prompts, and rights uncertainty remain internal. |

Blockers:

- Image rights, font rights, contributor rights, or AI-image disclosure unresolved.
- Age-inappropriate content, unsafe visual stereotypes, or unclear guardian expectations.
- Fixed-layout package not proofed on channel-relevant preview surfaces.
- Visual polish used to hide weak story, weak rights, or weak accessibility.

Devil's advocate: this is the most emotionally attractive family and one of the easiest places to overpromise. The gate should treat visual assets as evidence-heavy production objects, not decorations.

## Family F: Cookbook, Photo Book, Portfolio, Catalog, Or Visual Reference

**V1 posture:** later-phase or gated pilot, depending on rights and file complexity.

Examples: recipe book, product catalog, property portfolio, photography collection, visual case-study book, illustrated reference.

| Area | Gate requirement |
| --- | --- |
| Intake | Image volume, rights source, layout density, print color needs, recipe/test evidence where applicable, captions, contributor credits, and commercial objective. |
| Research | Asset provenance, model/property releases where applicable, recipe testing or factual review, metadata/category fit, and channel file constraints. |
| Production | Asset ledger, layout plan, print/color proof, caption/copy review, accessibility alt-summary, cover/wrap review, and package manifest. |
| Hermes | Hermes can help with structure, captions, recipe/test checklists, asset-ledger prompts, metadata drafts, and proof-review tasks. |
| Publishing | KDP print/color and Google file packets need separate proofing; wider-channel adapters may matter later for catalog/photo-book economics. |
| Analytics | Track print cost, proof cost, color margin, channel sales, client campaign attribution, and source confidence separately. |
| Portal | Reviewed proof package and image-rights summary can be shown. Raw asset ledger and release gaps stay internal unless promoted as client actions. |

Blockers:

- Missing image, recipe, contributor, model, property, font, or brand permissions.
- Color print margin negative or unverified.
- Captions or recipes make unsupported claims.
- Channel file proof is missing.

Devil's advocate: visual reference books can be valuable for clients but may be closer to a marketing asset than a scalable publishing product. The commercial model must say why publishing beats a PDF, landing page, or proposal.

## Family G: Public-Domain Adaptation, Companion, Commentary, Summary, Or Brand-Adjacent Book

**V1 posture:** negative-control fixture first; commercial launch only after explicit rights review.

Examples: annotated classic, public-domain edition, commentary on a known work, unofficial companion, study guide, summary, brand-adjacent guide.

| Area | Gate requirement |
| --- | --- |
| Intake | Source edition, jurisdiction, rights claim, differentiation plan, quote plan, trademark/affiliation risk, contributor role, and channel targets. |
| Research | Public-domain evidence, copyright duration assumptions, source inventory, originality/differentiation evidence, companion risk, title/subtitle risk, and quote permissions. |
| Production | Rights review task, originality plan, annotation/commentary evidence, title/metadata restrictions, and reviewer sign-off before drafting can move to packet readiness. |
| Hermes | Hermes can inventory sources, identify missing evidence, draft originality questions, and create rights-review tasks. Hermes cannot give legal advice or waive a rights blocker. |
| Publishing | KDP packet stays blocked until public-domain or rights evidence is reviewed. Google packet needs its own rights and content-policy review. |
| Analytics | No launch or revenue projections while rights are blocked. If later approved, analytics are normal but affiliation and title-risk notes remain auditable. |
| Portal | Client may see a safe blocker explanation only after admin promotion. Internal rights analysis and speculative legal notes stay internal. |

Blockers:

- Public-domain safety assumed from one source or jurisdiction.
- Companion, summary, or study-guide affiliation implied without rights.
- Title, subtitle, cover, or metadata uses protected names misleadingly.
- Differentiation is too weak for platform expectations.

Devil's advocate: these projects can look like fast monetization opportunities. The module's value is partly proving that it can stop them.

## Family H: Audiobook, Auto-Narrated Book, Or Narrated Extension

**V1 posture:** future-compatible, deferred unless Peet explicitly approves audio in V1.

Examples: audiobook edition, auto-narrated ebook, narrated companion, podcast-to-book audio extension.

| Area | Gate requirement |
| --- | --- |
| Intake | Audio channel target, narrator type, voice/talent consent, script source, pronunciation needs, rights, cost model, and distribution path. |
| Research | Channel rules, narrator/voice rights, audio quality expectations, content adaptation needs, and account authority. |
| Production | Script adaptation, pronunciation guide, narrator brief, audio QA checklist, sample review, package manifest, and rights ledger. |
| Hermes | Hermes can draft scripts, pronunciation lists, narrator briefs, QA checklists, and readiness warnings. Hermes cannot synthesize or publish audio without explicit approved tooling and rights. |
| Publishing | Audio packets are separate from KDP/Google ebook/print packets. ACX, KDP Virtual Voice, Google audio, or wider channels need fresh adapter source checks. |
| Analytics | Track audio sales, listening/traffic reports where available, production costs, royalty differences, and format-level performance separately. |
| Portal | Reviewed audio sample and summary can be promoted later. Raw voices, prompts, and unapproved recordings stay internal. |

Blockers:

- Voice rights or talent consent unresolved.
- Audio package channel not selected.
- Quality review missing.
- Audio economics unclear or negative.

Devil's advocate: audio is a separate production business, not a small export option. It should not be hidden inside the first ebook/print foundation.

## Series Overlay Profile

Series is not a book family by itself. It is an overlay that changes another family's gates.

| Area | Gate requirement |
| --- | --- |
| Intake | Internal series title, book role, volume order, planned books, continuity bible, channel series intent, and whether book one stands alone. |
| Evidence | Continuity facts, recurring structure, shared cover/style rules, metadata naming rules, per-volume status, and source freshness for external series claims. |
| Hermes | `book-series-strategy` can propose volume order, continuity tasks, stale-canon warnings, and rollup summaries. |
| Publishing | KDP and Google series readiness must be evaluated separately. Public-domain and low-content constraints can block external series claims. |
| Analytics | Book-level rows remain primary. Rollups must preserve source, period, confidence, and weak-volume visibility. |
| Portal | Reviewed series brief and rollup can be promoted. Future volumes must not appear approved because a series scaffold exists. |

Blockers:

- Book one is weak but hidden by a big series concept.
- External series eligibility inferred from internal series scaffold.
- Future volumes appear client-ready without briefs, gates, and evidence.
- Series analytics hides poor per-book economics.

Devil's advocate: a series can make the module feel strategic, but it can also multiply weak ideas. The overlay should increase scrutiny, not lower it.

## Cross-Family Rules

These rules apply to all profiles:

1. Gate profile first. No drafting, cover work, pricing, packet work, or Hermes dispatch from a blank prompt.
2. KDP and Google packet readiness are separate states.
3. Internal PiB readiness, client review readiness, manual upload readiness, and live-channel state are separate states.
4. AI-generated and AI-assisted provenance must be derivable from generation/activity records, not typed manually at the end.
5. Rights, quotes, images, fonts, audio, public-domain, contributor, and brand-affiliation evidence must block the specific dependent claim when missing.
6. Client portal output is promoted artifact output only. Raw research, raw Hermes output, internal rights notes, costs, account details, and parser errors remain internal.
7. Analytics never blends estimated, reported, payment, refund, preview, ad, cost, and series rollup values without labels.
8. Source freshness gates apply when moving toward manual handoff, client promotion, analytics promotion, or Hermes readiness.

## V1 Recommendation

Keep the recommended first pilot set:

1. Business nonfiction/reference/how-to ebook.
2. Activity/workbook or low-content print warning case.
3. Series overlay scaffold.
4. Public-domain/companion negative-control block.

Keep children's/visual, cookbook/photo/portfolio, narrative fiction, and audio as cataloged profiles and fixtures unless Peet explicitly expands V1. This preserves creative range without forcing the first implementation plan to solve fixed-layout assets, audio production, and complex rights before the core PiB operating loop is proven.

## Approval Implication

If Peet approves the existing V1 record, this catalog should become a planning input for the first implementation plan. It should not become a runtime schema or ticket list until the approval record is copied or revised.

If Peet asks for a wider first V1, the approval record should name which additional family moves from "profile/fixture" to "production pilot" and accept the extra gates that come with it.
