# Book Studio V1 Wider Channel Adapter Packet

**Date:** 2026-06-08
**Status:** Design-only source-backed review artifact; not an implementation plan, API design, data schema, publishing instruction, legal advice, tax advice, or accounting advice.
**Authoritative dossier:** `docs/superpowers/specs/2026-06-07-book-studio-research-dossier.md`
**Approval packet:** `docs/superpowers/specs/2026-06-08-book-studio-v1-approval-packet.md`
**Source refresh contract:** `docs/superpowers/specs/2026-06-08-book-studio-v1-source-refresh-contract.md`
**Publishing and analytics model:** `docs/superpowers/specs/2026-06-08-book-studio-v1-publishing-analytics-model.md`

## Purpose

Peet's original brief said Amazon KDP, Google Books, and "etc". The approved-first V1 direction still recommends KDP and Google Play Books manual handoff only, but Book Studio should not paint itself into a KDP/Google-only architecture. This packet turns the wider-channel research into a standalone adapter review surface.

It answers three questions:

1. What would Apple Books, Kobo Writing Life, Draft2Digital, IngramSpark, audiobook channels, ISBN governance, and EPUB validation add to the model?
2. What should PiB track now so wider channels remain future-compatible?
3. What must stay blocked until Peet explicitly revises the V1 approval record?

This packet does not authorize runtime records, routes, UI, Firestore collections, Hermes skills, report parsers, direct publishing APIs, account custody, payment flows, or a Phase 1 task list.

## Current Official Source Snapshot

These sources were checked on 2026-06-08 and should be refreshed before any wider-channel implementation or upload-ready claim:

| Source | Current implication for Book Studio |
| --- | --- |
| Apple Books for Authors, publishing from the web: `https://authors.apple.com/support/4574-publish-book-from-web` | Apple direct web publishing needs an Apple Books/iTunes Connect account and an EPUB, cover image, sample, and description. Apple states submitted books must pass EPUBCheck. |
| Kobo Writing Life FAQ: `https://www.kobo.com/kobo-writing-life/blog/frequently-asked-questions` | Kobo tracks DRM choice, territorial rights, public-domain royalties, dashboard estimates, refunds/discount caveats, and monthly reports. Dashboard values must not be treated as settled revenue. |
| Draft2Digital FAQ: `https://draft2digital.com/faq/` | Draft2Digital is an aggregator with selected partner stores, varied review times, ebook/print promotion differences, delayed downstream payments, and warnings about D2D Print overlap with KDP Expanded Distribution or IngramSpark. |
| IngramSpark FAQ: `https://www.ingramspark.com/faqs` | IngramSpark needs cover and interior files; distributed formats need ISBNs; SKU-only mode exists for non-distributed printing; wholesale distribution can take weeks; returnability and KDP Expanded Distribution conflicts matter. |
| ACX author workflow: `https://www.acx.com/help/authors-as-narrators/200626860` | ACX requires audio rights and an Amazon ebook listing to claim a title. Audiobook work needs title profile, audition/script, narrator/studio workflow, and rights checks. |
| KDP Virtual Voice help: `https://kdp.amazon.com/en_US/help/topic/G3QRL9HQNF273Q2H` | KDP Virtual Voice is a beta path in the U.S. marketplace for eligible KDP ebooks and creates a distinct computer-generated audiobook path with different disclosure/provenance needs. |
| ISBN.org ISBN standard: `https://www.isbn.org/about_ISBN_standard` | ISBNs identify a title or book-like product and the publisher in the supply chain. ISBNs from non-official sources may not identify the publisher accurately. |
| W3C EPUBCheck: `https://www.w3.org/publishing/epubcheck/` | EPUBCheck is the conformance checker for EPUB publications and checks EPUB files against official EPUB specifications. |

## Adapter Principle

Book Studio should model publishing destinations as channel adapters, not as booleans on a book. A book can have multiple editions, each edition can have multiple file packages, and each file package can map to one or more channel listings with different readiness, pricing, territory, reporting, and conflict states.

Core separation:

| Layer | Meaning | Why it matters |
| --- | --- | --- |
| Book project | The creative/business project: audience, promise, ownership, series, client scope, and strategy. | One idea can become multiple editions and listings. |
| Edition | Ebook, paperback, hardcover, workbook, low-content, audiobook, fixed-layout, or special format. | Format decides file, rights, accessibility, pricing, and channel gates. |
| File package | Exact files and checksums: EPUB, PDF, cover, interior, audio, sample, supplemental files, manifests, validations. | Upload readiness is version-specific. |
| Channel listing | Destination-specific metadata, account authority, price, territory, identifiers, status, external IDs, blockers. | Apple/Kobo/D2D/Ingram/ACX readiness cannot be inferred from KDP/Google. |
| Financial source | Dashboard estimate, monthly report, settled payment, refund/reversal, print return, promo cost, ad cost. | Analytics can disagree across timing and source type. |

## Channel Adapter Cards

### Apple Books

V1 posture: future-compatible, not first-scope.

Track:

- Apple Books account authority and operator role.
- EPUB package, cover image, sample, description, author, language, categories, release/pre-order date, and pricing territory assumptions.
- EPUBCheck result and formatting-guideline review state.
- Whether Apple is direct-published or delivered through a partner/aggregator.
- Apple-specific external IDs and listing status if later used.

Block when:

- EPUBCheck has not passed for the upload package.
- Apple account authority is unclear.
- Apple readiness is inferred from KDP or Google readiness.
- A print/PDF-only package is treated as Apple-ready without partner/delivery evidence.

### Kobo Writing Life

V1 posture: future-compatible, not first-scope.

Track:

- Kobo account authority, language, title/author/description/category, cover, EPUB/manuscript conversion path, DRM choice, and territorial rights.
- Pricing and currency assumptions per territory.
- Public-domain state and royalty implications.
- Estimated dashboard values separately from monthly finance reports.
- Refunds, discounts, Kobo Plus, credit memos, and report confidence.

Block when:

- Territorial rights are unknown.
- Dashboard estimates are shown as settled revenue.
- Public-domain or companion-book risk has not been reviewed.
- DRM choice, price, and territory decisions are missing.

### Draft2Digital

V1 posture: future-compatible aggregator, not first-scope.

Track:

- Selected downstream retailers, formats, review status per retailer, and external IDs where available.
- Ebook, print, and promotion differences; scheduled pricing support varies by format and retailer.
- D2D Print compatibility with KDP Expanded Distribution and IngramSpark.
- Downstream payment windows and whether PiB sees retailer-level data or D2D-level summary data only.

Block when:

- Draft2Digital is modeled as one store instead of an aggregator.
- D2D Print overlaps with KDP Expanded Distribution or IngramSpark without an explicit conflict decision.
- A downstream retailer is marked live from D2D submission alone.
- Payment lag and report-source confidence are hidden from analytics.

### IngramSpark

V1 posture: future-compatible print/wide-distribution infrastructure, not first-scope.

Track:

- Publisher/imprint, ISBN owner/source, format binding, cover file, interior file, trim, paper, wholesale discount, returnability, pricing, and SKU-only or distributed mode.
- KDP Expanded Distribution conflict state.
- Retailer/library network status and expected listing lag.
- Print returns and wholesale economics separately from store-facing list price.

Block when:

- The same print distribution plan conflicts with KDP Expanded Distribution.
- ISBN owner/source/imprint is unclear.
- Cover/interior package is not validated and checksum-bound.
- Returnability, wholesale discount, and print cost are missing from commercial review.

### Audiobooks: ACX And KDP Virtual Voice

V1 posture: audiobook gate profile only unless Peet explicitly revises V1.

Track:

- Audio rights owner, source text edition, narrator/source, consent/provenance, audition/script, performance notes, chapter audio files, cover, sample, quality checks, and supplemental PDF if used.
- ACX title claim prerequisites and account authority.
- KDP Virtual Voice eligibility, marketplace limitation, generated-narration disclosure, and editor/reviewer evidence.
- Royalty share, per-finished-hour cost, production cost, payment timing, and exclusive/non-exclusive distribution if later relevant.

Block when:

- Audio rights are assumed from ebook/print rights.
- Computer-generated narration is not clearly labeled and provenance-bound.
- Audio package readiness is inferred from manuscript readiness.
- Narrator compensation, consent, or distribution terms are ambiguous.

### ISBN And Metadata Governance

V1 posture: required design concept, even when V1 does not buy or assign ISBNs.

Track:

- ISBN source, official agency, owner/publisher prefix, imprint, format binding, edition binding, assignment date, and metadata submission responsibility.
- Whether a free platform ISBN creates imprint, ownership, or distribution constraints.
- Whether a format needs its own ISBN for the intended channel.

Block when:

- ISBN is treated as a plain string with no owner/source/imprint.
- The same ISBN is reused across incompatible editions or distribution paths.
- A platform-provided ISBN is treated as if it identifies PiB or the client as publisher when it does not.

### EPUB Validation

V1 posture: future validator concept; required before Apple/Kobo/Google/D2D EPUB-ready claims.

Track:

- EPUBCheck version/source, file checksum, validation result, warnings, errors, run date, and reviewer decision.
- Whether validation is advisory, required, or blocking for the target channel.

Block when:

- An EPUB package is marked channel-ready without validation evidence.
- A file changes after validation without invalidating the result.
- Warnings are hidden instead of reviewed or waived.

## Cross-Channel Conflict Map

| Conflict | Why it matters | Book Studio behavior |
| --- | --- | --- |
| KDP Select vs wide ebook distribution | Select-style exclusivity can conflict with Google/Apple/Kobo/D2D sale plans. | Require explicit exclusivity state before wide channel planning. |
| KDP Expanded Distribution vs IngramSpark/D2D Print | Multiple print distribution feeds can cause ISBN/listing conflicts. | Add print distribution conflict check before Ingram/D2D Print readiness. |
| Free platform ISBN vs owned ISBN | Publisher/imprint and reuse constraints can differ. | Track ISBN source and owner before external packet approval. |
| Direct store vs aggregator | Same ebook may be submitted through Apple/Kobo directly or through D2D; duplicate distribution can confuse reporting/status. | Require route-to-market decision per retailer. |
| Dashboard estimate vs finance report | Timing, refunds, discounts, and downstream payment windows differ. | Keep estimated, reported, settled, and adjusted values separate. |
| Text edition vs audiobook | Audio rights, production cost, narrator/source, quality, and distribution differ. | Treat audio as separate edition and channel packet. |

## Future Adapter Readiness Checklist

Before Peet adds any wider channel to a future approval record, the channel needs:

- Official source refresh with source date and source keys.
- Account authority model and safe non-secret readiness fields.
- File package requirements and validation evidence.
- Channel-specific metadata, identifier, price, territory, language, and format fields.
- Distribution conflict checks against active or planned channels.
- Manual handoff checklist and external status evidence.
- Analytics source model: estimate, report, settled payment, refunds, returns, promo/ad cost, and reconciliation.
- Portal-safe summary rules.
- Hermes allowed/forbidden output matrix.
- Pass/warn/block acceptance fixture.

## Hermes Boundary For Wider Channels

Hermes may:

- Summarize official source implications into reviewable checklists.
- Compare a proposed book package against channel readiness rules.
- Draft internal questions for account authority, ISBN/imprint, territory, file package, and distribution conflicts.
- Create tasks for source refresh, package validation, or conflict review.

Hermes may not:

- Tell an operator that a wider channel is ready without human-reviewed evidence.
- Submit, publish, change pricing, toggle distribution, enroll in exclusivity, or schedule promotions.
- Ask for passwords, tax IDs, bank details, identity documents, or shared login credentials.
- Hide distribution conflicts behind a positive recommendation.
- Convert dashboard estimates into client-safe revenue claims.

## Client Portal Rule

For wider channels, the portal should show only:

- A reviewed channel intent such as "Apple Books is being evaluated" or "IngramSpark is deferred".
- Safe blockers such as "print distribution conflict needs review".
- Reviewed live-status evidence after an external listing is confirmed.
- Reconciled analytics summaries with confidence labels.

The portal should not show:

- Account readiness details, identity/tax/payment state, credentials, internal route-to-market debates, ISBN ownership uncertainty, unresolved returnability/cost notes, raw D2D downstream statuses, raw retailer reports, or unreconciled payment rows.

## Devil's Advocate

- Adding wider channels too early will make Phase 1 look more strategic while making it less shippable.
- Aggregators are convenient, but they blur who is selling, who is reporting, and when money is actually reliable.
- Print distribution is not just another upload; ISBN, returnability, wholesale discount, and duplicate-feed conflicts can change the economics.
- Audiobooks can multiply cost, rights, quality, and disclosure risk. Treating audio as an afterthought is a reliable way to create expensive cleanup.
- ISBNs look simple because they are short strings. Operationally, they encode publisher identity, edition identity, and supply-chain responsibility.
- Validation tools do not prove a book is good, lawful, or commercially viable. They only prove one class of package conformance.

## Current Review State

This packet strengthens future compatibility while keeping V1 narrow. KDP and Google Play Books remain the recommended first manual-handoff channels. Apple, Kobo, Draft2Digital, IngramSpark, ACX, KDP Virtual Voice, Amazon Ads, review outreach, and direct publishing APIs remain deferred unless Peet explicitly revises the approval record and accepts the additional source, account, package, conflict, analytics, Hermes, and portal-safety work.
