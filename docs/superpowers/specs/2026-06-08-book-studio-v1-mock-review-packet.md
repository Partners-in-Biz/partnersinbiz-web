# Book Studio V1 Mock Review Packet

**Date:** 2026-06-08
**Status:** Design-only review artifact; not a UI spec, data schema, implementation plan, legal advice, tax advice, accounting advice, or publishing instruction.
**Authoritative dossier:** `docs/superpowers/specs/2026-06-07-book-studio-research-dossier.md`
**Approval packet:** `docs/superpowers/specs/2026-06-08-book-studio-v1-approval-packet.md`
**Review script:** `docs/superpowers/specs/2026-06-08-book-studio-v1-review-script.md`
**Acceptance fixtures:** `docs/superpowers/specs/2026-06-08-book-studio-v1-acceptance-fixtures.md`
**Ownership/commercial model:** `docs/superpowers/specs/2026-06-08-book-studio-v1-ownership-commercial-model.md`

## Purpose

This packet makes Book Studio V1 reviewable by showing what a future operator, client, and Hermes reviewer would see for one sample book project. It is intentionally concrete enough to expose unsafe assumptions, but it does not create runtime records, APIs, routes, components, Firestore collections, Hermes skills, publishing integrations, report parsers, or a Phase 1 implementation plan.

The sample exists to answer Peet's practical question: "If we built this into PiB, what would the work actually look like before anything goes live?"

## Sample Project

| Field | Example |
| --- | --- |
| Working title | `The Local Growth Playbook For Independent Clinics` |
| Owner mode | `client_owned` |
| Client | Fictional clinic group used for review only |
| First format | Business nonfiction ebook, with optional print workbook later |
| First channels | Amazon KDP manual handoff, Google Play Books manual handoff |
| Series posture | Book 1 of a possible practical guide series; later volumes not assumed viable |
| Portal posture | Client may review promoted versions only: Book Brief, proof package, publishing packet, and reconciled analytics summary |
| Hermes posture | Hermes may research, draft, summarize, check, and create internal tasks. Hermes may not publish, approve, spend, message clients, request credentials, or mark the packet ready. |

## Admin Packet Snapshot

The admin packet should make the current state obvious without forcing Peet to read every underlying artifact.

| Area | State | Evidence | Reviewer action |
| --- | --- | --- | --- |
| Intake and gate profile | Pass | Book family, format, owner mode, channels, series posture, client review scope, and active gates are set. | Confirm this is the right pilot type. |
| Research packet | Warn | Audience, competitor patterns, category direction, and source confidence exist; two price assumptions need current checks before packet approval. | Assign source refresh task. |
| Book Brief | Pass | Audience, promise, outline direction, assumptions, and client decision points are versioned. | Promote client-safe brief if wording is clean. |
| Hermes outputs | Warn | Hermes produced research notes, brief draft, outline options, metadata questions, and KDP/Google readiness warnings. | Keep internal until reviewed. |
| Manuscript/proof | Not started | No generated manuscript version is approved. | Do not show proof package yet. |
| Rights/provenance | Warn | Client-owned text basis is clear; image, quote, and font evidence not yet attached. | Block cover/proof approval until resolved. |
| KDP packet | Warn | Metadata draft, file intent, AI disclosure prompt, pricing assumptions, and manual upload checklist exist. | Not upload-ready until package, pricing, rights, source freshness, and account authority pass. |
| Google packet | Warn | Google-specific file, identifier, series, pricing, and policy checklist exists separately. | Do not infer Google readiness from KDP readiness. |
| Ownership/account authority | Warn | Client owner identified; publishing account authority and report access are not confirmed. | Create client/account authority decision task. |
| Commercial model | Warn | Price and royalty assumptions are internal estimates only. | Do not make client-facing revenue claims. |
| Portal promotion | Partial | Book Brief can be promoted after wording review. | Keep raw research, Hermes notes, account details, rights notes, and costs internal. |

Admin summary wording:

> This book is internally useful enough to continue, but it is not upload-ready. The next safe action is to review the Book Brief and resolve source freshness, account authority, rights/provenance, and commercial warnings before a publishing packet can be approved.

## Client Portal Packet Snapshot

The client portal should show decisions and safe blockers, not raw operating detail.

Client-visible summary:

> We are preparing a practical clinic growth guide for review. The current step is Book Brief approval. Publishing, pricing, rights, and account-readiness checks are still in progress, so no upload or launch date is confirmed yet.

Client-visible sections:

| Section | Visible to client | Hidden from client |
| --- | --- | --- |
| Book Brief | Audience, promise, scope, outline direction, assumptions, client decision requests. | Raw research notes, internal market strategy, disputed findings, unreviewed Hermes drafts. |
| Proof package | Only a reviewed proof version and clear caveats. | Draft generation runs, internal editorial disputes, raw asset-rights notes, rejected covers. |
| Publishing packet | Reviewed metadata summary, channel intent, price/territory summary, upload-readiness blockers phrased safely. | Account details, identity/tax/payment readiness, private contract notes, source parser errors. |
| Analytics summary | Reconciled period, source-labeled confidence, safe trend language. | Raw report rows, payment profile data, internal margin, unreconciled adjustments, refund disputes. |

Client action wording examples:

- `Approve Book Brief version 1.0`
- `Request changes to audience or promise`
- `Acknowledge publishing readiness blockers`
- `Review proof package version 1.0` only after admin promotion

Blocked client wording examples:

- "Publishing account readiness is still under internal review."
- "Rights/provenance evidence is still being checked before this can move to proof approval."
- "Revenue reporting is not yet reconciled for client summary."

Unsafe client wording examples:

- "Your book is ready for KDP."
- "Estimated royalties are R12,000 per month."
- "Hermes has approved the publishing packet."
- "Please send us your Amazon password."

## Hermes Review Packet

Hermes output should be framed as recommendations and tasks, never final decisions.

Allowed Hermes outputs for this sample:

| Skill key | Output example | Visibility |
| --- | --- | --- |
| `book-niche-research` | Research note with source links, competitor patterns, confidence labels, and unresolved questions. | Internal only until rewritten into reviewed Book Brief. |
| `book-brief-builder` | Draft Book Brief with audience, promise, scope, assumptions, and client questions. | Internal until promoted as a reviewed document version. |
| `book-outline-builder` | Three outline options with rationale and risk notes. | Internal by default. |
| `book-metadata-optimizer` | Title/subtitle/description/category/keyword options with warnings. | Internal until publishing packet review. |
| `book-kdp-readiness-check` | Checklist report with pass/warn/block state. | Internal. |
| `book-google-play-readiness-check` | Separate Google checklist report. | Internal. |
| `book-publishing-account-readiness` | Account authority question set and task suggestions. | Internal. |

Forbidden Hermes outputs for this sample:

- Marking the Book Brief, proof package, publishing packet, or client approval as complete.
- Claiming KDP or Google upload readiness without human reviewer evidence.
- Asking for passwords, tax IDs, bank details, identity documents, or shared credentials.
- Sending client messages, review requests, public launch copy, price changes, ads, or publishing updates.
- Rewriting unresolved rights, account, or commercial warnings into positive client-facing copy.

## Publishing Packet Example

The packet should show two channel tracks. Shared book facts may be reused, but readiness is decided separately.

### Shared Book Facts

| Field | Example state |
| --- | --- |
| Title | Draft title options exist; final title not approved. |
| Subtitle | Draft options exist; claim strength needs research-source check. |
| Author/publisher | Client-owned; author/imprint decision pending. |
| AI-use classification | Drafted by assisted workflow; final disclosure depends on approved generation/provenance evidence. |
| Files | No approved manuscript, cover, EPUB, PDF, or print package yet. |
| Rights | Client text basis is clear; images/fonts/quotes unresolved. |
| Pricing | Internal estimate only. |
| Territories | Draft territory assumption exists; not approved. |

### Amazon KDP Track

| Area | Example state |
| --- | --- |
| Format fit | Ebook first; print workbook considered later. |
| Metadata | Draft options exist; no final category/keyword approval. |
| Series | Internal series scaffold only; KDP series eligibility not assumed. |
| Files | Not upload-ready until package evidence and checksums exist. |
| Account authority | Client or publisher account authority unresolved. |
| AI disclosure | Must be answered from final provenance evidence, not from memory. |
| Manual upload | No operator instructions until all blockers pass. |

### Google Play Books Track

| Area | Example state |
| --- | --- |
| Format fit | EPUB/PDF path needs separate package evidence. |
| Metadata | Google-specific fields and identifiers need review. |
| Series | Google series metadata is separate from internal series scaffold. |
| Pricing | Price/currency/revenue-share assumptions need review. |
| Account authority | Service-provider or account access decision unresolved. |
| Content policy | Google readiness cannot be inferred from KDP readiness. |
| Manual upload | No operator instructions until all Google-specific blockers pass. |

Packet summary:

> KDP and Google are both in warning state. The book can continue through brief and production work, but neither channel may be marked upload-ready until file package, metadata, pricing, account authority, rights, AI disclosure, and source freshness evidence are reviewed per channel.

## Series Packet Example

If the book becomes part of a series, the first packet should separate internal planning from external eligibility.

| Area | Example |
| --- | --- |
| Internal series title | `Local Growth Playbooks` |
| Volume status | Book 1 only. Later volumes are ideas, not approved products. |
| Continuity bible | Audience, tone, promises, recurring sections, visual style, and forbidden repeats. |
| Volume order | Draft order exists; channel acceptance not assumed. |
| Rollup analytics | Future rollup shape exists, but no performance claim until live report evidence exists. |
| Portal visibility | Client can see reviewed series brief only. |

Devil's advocate:

- A nice series name can hide weak future demand.
- Internal continuity does not prove KDP or Google series metadata acceptance.
- Rollup analytics can overstate performance if later books, refunds, and report periods are blended.

## Negative-Control Packet Example

The module should prove it can block an attractive but unsafe idea.

Scenario:

> "Create a workbook based on a famous business book, use its title in the subtitle, add quote pages from the original author, and publish it as a companion guide."

Expected state:

| Area | State |
| --- | --- |
| Rights | Block: companion/trademark/quote risks unresolved. |
| Hermes | May create a rights-review task and safer positioning questions only. |
| Publishing packet | Blocked for all channels. |
| Portal | No client-facing publishing claim. |
| Launch | No public copy, review outreach, ads, or price/promo action. |

Safe output:

> This idea is blocked for production until rights, trademark, quote, and originality evidence are reviewed. Hermes may help gather questions and propose safer alternatives, but it may not create launch copy or publishing instructions.

## Analytics Packet Example

Analytics should remain useful while refusing to overclaim.

Early import example:

| Metric family | Example state | Client visibility |
| --- | --- | --- |
| Store list price | External listing screenshot attached; current but not reconciled to sales period. | Safe only as "listed price evidence" after review. |
| Reported sales | KDP/Google report snapshot manually imported for one period. | Hidden until source, period, timezone, and confidence are reviewed. |
| Refunds/reversals | Unknown. | Hidden; creates reconciliation warning. |
| Settled payment | Not available. | Hidden. |
| Promotion cost | Internal only. | Hidden by default. |
| Revenue share/cost recovery | Not approved. | Hidden and blocked from summary. |

Client-safe summary after review:

> Early store reporting is available for a partial period, but it has not been reconciled to settled payment or refunds. We will treat it as directional until the next report cycle confirms the numbers.

Unsafe summary:

> The book earned R4,200 profit this month.

## Version And Approval Trace

Every packet decision should bind to a version.

| Event | Version impact |
| --- | --- |
| Book Brief approved | Locks brief version only. Does not approve manuscript, cover, packet, pricing, or launch. |
| Outline changed materially | Invalidates affected brief/production assumptions. |
| Cover or manuscript changes after proof approval | Invalidates proof/package approval. |
| Metadata, price, account, ownership, territory, or source evidence changes | Invalidates affected publishing packet approval. |
| Report import changes, refund appears, or payment evidence arrives | Invalidates affected analytics summary confidence. |

## Review Questions For Peet

1. Does this mock packet make the internal-studio posture concrete enough to approve or revise?
2. Should V1 portal review start with Book Brief only, or include proof and publishing packet review from the start?
3. Should `client_owned` remain in V1, or should the first implementation plan narrow to `pib_owned` only?
4. Is the negative-control example strict enough to prove the module can say no?
5. Is Hermes useful enough under these boundaries, or should Wave 1 be narrower?
6. Are KDP and Google manual-handoff enough for the first approved channel scope?

## Current Review State

This mock packet supports the existing V1 approval gate. It makes the proposed Book Studio operating loop tangible, but it does not authorize implementation. The next step remains Peet approving, revising, rejecting, or requesting more design detail on the V1 approval record.
