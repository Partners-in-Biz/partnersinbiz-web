# Book Studio V1 Production Package QA Model

**Date:** 2026-06-08
**Status:** Design-only production package model; not an export engine, validator, UI design, route map, Firestore schema, API contract, Hermes runtime plan, or Phase 1 task list.
**Authoritative dossier:** `docs/superpowers/specs/2026-06-07-book-studio-research-dossier.md`
**Decision packet:** `docs/superpowers/specs/2026-06-08-book-studio-v1-approval-packet.md`
**Publishing and analytics model:** `docs/superpowers/specs/2026-06-08-book-studio-v1-publishing-analytics-model.md`
**Domain record/state model:** `docs/superpowers/specs/2026-06-08-book-studio-v1-domain-record-state-model.md`
**Operator workspace control model:** `docs/superpowers/specs/2026-06-08-book-studio-v1-operator-workspace-control-model.md`

## Purpose

This model defines how Book Studio V1 should treat production files before any proof, client review, publishing packet, or manual handoff can be trusted.

The central rule is that a book is not "ready" because it has text, a cover, or a PDF. It is ready for the next stage only when the current artifact version has evidence for format fit, proof review, rights/provenance, accessibility, source freshness, and checksum-bound package identity.

This file does not create export tooling, file validators, upload paths, database records, UI components, route handlers, Hermes skills, direct publishing integrations, or a Phase 1 implementation plan.

## Production Package Layers

| Layer | What it proves | Evidence needed before next stage | Must not become |
| --- | --- | --- | --- |
| Book brief | The book promise, audience, channels, family, and assumptions are reviewable. | Approved or change-requested `bookBriefVersion`, source links, gate profile. | A manuscript approval. |
| Manuscript unit | A section, chapter, spread script, worksheet, puzzle set, or content block exists. | Version, owner, source basis, review state, AI-use basis, claim notes. | Final upload content by default. |
| Interior proof | The reading or print interior can be reviewed as a coherent proof. | File reference, page/section map, editorial state, checksum, preview notes. | Upload-ready package. |
| Cover proof | Front/back/spine or ebook cover can be reviewed. | Cover file, title/author consistency, image/font rights, print wrap notes where relevant. | Proof that metadata, rights, or channel files are ready. |
| Asset ledger | Every image, font, quote, audio item, template, and contributor input has usage evidence. | Asset-level rights, territory, source, AI status, contributor role, unresolved warnings. | A generic "rights ok" checkbox. |
| Package manifest | The candidate upload package is fixed to exact files and versions. | File list, checksums, formats, package date, channel intent, source freshness, reviewer state. | A direct publish command. |
| Channel packet | A channel-specific handoff package can be reviewed. | KDP and Google evidence separated, manual instructions, account authority, metadata, pricing, disclosure. | Readiness for every channel. |
| Portal proof | A client-safe artifact version can be reviewed. | Sanitized summary, approved excerpt/proof reference, internal notes removed, promotion state. | Raw production state mirrored to clients. |

## Format Profiles

| Format profile | Applies to | Required QA emphasis | Common blockers |
| --- | --- | --- | --- |
| Reflowable ebook | Business nonfiction, narrative, course companion, text-first guides. | Structure, heading hierarchy, navigation, links, front/back matter, metadata consistency, AI disclosure basis. | Broken navigation, unsupported claims, stale source facts, copied structure, unreviewed AI output. |
| Print interior | Paperback, hardcover, activity/workbook, low-content, visual reference. | Trim intent, page count, margins, bleed where relevant, repeated-page honesty, print proof, cost/margin warning. | Thin content hidden by design, negative margin, unproofed page layout, wrong family/channel assumption. |
| Cover and wrap | Ebook cover, paperback/hardcover cover, visual product cover. | Title/subtitle/author match, image/font rights, brand/series consistency, spine/back-cover proof where relevant. | Cover promises content the book does not contain, rights unclear, title conflicts with metadata. |
| Fixed-layout or visual proof | Children/visual, comics, photo/portfolio, catalogs, cookbooks. | Spread plan, image provenance, accessibility notes, preview evidence, age/sensitivity review, print/color proof. | Pretty assets with weak rights, no accessibility summary, fixed-layout not proofed, color margin unknown. |
| Activity or puzzle package | Workbooks, puzzle books, coloring books, educational practice books. | Answer-key correctness, duplicate/repetition review, physical usability, print-first proof, low-content classification warning. | Incorrect answers, repetitive filler, digital suitability overclaimed, missing proof. |
| Series package | Book one, later volume, collection, companion sequence. | Volume order, continuity bible, shared metadata, cover/style consistency, per-book package identity. | Series claim before book one stands alone, future volumes treated as approved, analytics rollup hides weak book. |
| Audio or narrated future package | Audiobook, narrated extension, voice product. | Voice/talent rights, script adaptation, audio quality, pronunciation list, package manifest, channel deferral. | Audio promised before rights, quality, channel, and cost model exist. |

## QA Gate Sequence

| Gate | Pass means | Warning means | Block means |
| --- | --- | --- | --- |
| Gate profile applied | Book family, formats, channels, ownership, series, and required evidence are selected before production. | Optional gate has owner/date/waiver path. | Drafting or package work starts from a blank prompt. |
| Source and claim review | The content promise and factual claims have current evidence or reviewed caveats. | Non-critical assumption needs refresh before launch or client summary. | Unsupported or stale claim appears in proof, metadata, or client artifact. |
| Manuscript review | Current manuscript/proof version is internally coherent and reviewed for scope. | Useful proof exists but needs editorial or claim cleanup. | Raw generated text is treated as final. |
| Asset and rights review | Every asset or contributor input has evidence, territory, and AI status where relevant. | One asset has non-blocking owner/date/waiver path. | Unknown asset rights, quote rights, public-domain basis, or AI image status. |
| Format proof | Current proof can be reviewed in the intended format profile. | Preview has warnings that do not block internal review. | Proof missing, wrong format, broken navigation, unproofed print/fixed layout, or unusable activity content. |
| Accessibility and reader experience | Obvious accessibility, navigation, readability, and physical-use issues have been reviewed for the chosen family. | Accessibility note is incomplete but not channel-blocking for internal review. | Visual/audio/worksheet product has no reader-experience evidence. |
| Package manifest | Exact files, versions, checksums, date, and channel intent are captured. | Candidate package is internally reviewable but needs one file update. | Any file can change after approval without invalidation. |
| Channel preflight | KDP and Google packet assumptions are checked separately against the current package. | One channel has owner/date/waiver path. | One channel pass is reused for another channel. |
| Client-safe proof | A sanitized proof or package summary can be promoted to portal. | Safe artifact lacks optional context. | Raw production files, internal notes, parser errors, or rights uncertainty are exposed. |

## Package Manifest Contract

Every candidate package should declare these concepts before any manual handoff state is possible:

| Concept | Purpose |
| --- | --- |
| Package id | Stable reference for one candidate package. |
| Project and org | Keeps the package tenant-scoped. |
| Book family and format profile | Explains which QA rules apply. |
| Channel intent | KDP ebook, KDP print, Google ebook/PDF, internal proof, portal proof, or future adapter. |
| File list | Exact files included, with roles such as manuscript, cover, interior, asset, proof, report, or evidence. |
| Checksums or immutable references | Binds approval to exact versions. |
| Source freshness state | Records whether policy-sensitive sources can support readiness claims. |
| Rights/provenance snapshot | Links asset ledger, AI-use basis, public-domain/companion risk, and contributor evidence. |
| Review results | Editorial, claim, format, accessibility, rights, packet, and portal review verdicts. |
| Invalidation rules | Explains what changes force proof, packet, or portal approval back to review. |

## Invalidation Rules

| Change | Must invalidate |
| --- | --- |
| Manuscript text, order, title page, links, front matter, back matter, or metadata basis changes. | Manuscript review, package manifest, channel packet readiness, client approval tied to the old package. |
| Cover image, title/subtitle display, author/brand, spine/back cover, or cover asset changes. | Cover proof, rights review, channel packet, portal proof summary. |
| Interior file, page count, trim intent, margin, bleed, fixed-layout spread, worksheet answer, or repetition pattern changes. | Format proof, print/activity readiness, package manifest, client proof approval. |
| Image, font, quote, audio, contributor, public-domain, companion, or AI asset evidence changes. | Rights review, proof approval, packet readiness, portal claims. |
| AI-use classification or generation-run evidence changes. | Disclosure basis, channel packet readiness, client-safe wording. |
| Channel source freshness becomes stale. | Upload-readiness claim for the affected channel. |
| Store requests a change after manual upload. | Channel listing state, package version, affected portal live-status summary. |

## Hermes Boundaries

Hermes can help with production QA only as bounded reviewable assistance:

- Draft proof-review checklists.
- Summarize missing package evidence.
- Create answer-key, duplicate, link, consistency, or claim-review task suggestions.
- Produce a readiness warning report.
- Explain why a package is blocked in internal language.
- Draft a client-safe blocker summary after admin review.

Hermes must not:

- Mark a package upload-ready.
- Rewrite approved files without creating a new version.
- Decide rights, public-domain status, AI disclosure, channel suitability, price, royalty, or account authority.
- Publish, upload, spend, message clients, or request credentials.
- Promote raw production output to the portal.

## Portal Proof Rules

Client proof review should be a promoted artifact, not a mirror of internal files.

Client-safe proof packets may include:

- Book Brief summary.
- Selected proof file or excerpt reference.
- Plain-language status.
- Review questions.
- Safe blocker summary.
- Approved next decision.

Client-safe proof packets must not include:

- Raw Hermes prompts or output.
- Internal rights uncertainty.
- Account or upload details.
- Parser or validation logs.
- Unreconciled costs.
- Unsupported source claims.
- Full internal asset ledger unless rewritten as a safe client action.

## Review Scenarios

| Scenario | Package QA must prove |
| --- | --- |
| Business nonfiction ebook | Source-backed claims, reviewed manuscript, cover/title match, reflowable ebook package identity, separate KDP/Google preflight. |
| Activity/workbook print | Page plan, physical usability, answer-key correctness, repetition honesty, print proof, margin warning, KDP/Google separation. |
| Low-content print | Low-content evidence, differentiation, barcode/ISBN assumptions, repetition honesty, proof, metadata promise fit. |
| Children/visual fixture | Spread plan, image rights, age/sensitivity review, fixed-layout or print proof, accessibility note, portal-safe sample only. |
| Series scaffold | Per-book package identity, volume order, continuity, shared cover/style rules, no future-volume approval shortcut. |
| Public-domain/companion negative control | Rights blocker prevents package approval and produces safe internal/client explanation. |

## Devil's Advocate

- A generated manuscript can look finished while still being unfit for readers, stores, or clients.
- A PDF that opens locally is not a publishing package.
- A beautiful cover can hide weak content, weak rights, false metadata, or negative print economics.
- Package QA can become a checkbox wall. It must produce clear next actions and version-specific approvals, not just warnings.
- If package approval is not checksum-bound, later edits will quietly break prior proof, packet, and client approval states.
- If fixed-layout, visual, or audio work enters V1 too early, production QA can consume the module before the KDP/Google manual-handoff loop is proven.

## Current Review State

This model supports the existing V1 approval gate by making production package readiness explicit. It does not authorize export tooling, file validators, package records, route handlers, UI components, Hermes runtime dispatch, direct publishing, analytics automation, or a Phase 1 task list.

The next product decision remains Peet approving, revising, rejecting, or requesting more design detail on the Book Studio V1 approval record.
