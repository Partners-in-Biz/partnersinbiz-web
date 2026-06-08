# Book Studio V1 Publishing And Analytics Model

**Date:** 2026-06-08
**Status:** Design-only operating model; not an implementation plan.
**Authoritative dossier:** `docs/superpowers/specs/2026-06-07-book-studio-research-dossier.md`
**Decision packet:** `docs/superpowers/specs/2026-06-08-book-studio-v1-approval-packet.md`
**Workflow map:** `docs/superpowers/specs/2026-06-08-book-studio-v1-platform-workflow-map.md`
**Production package QA model:** `docs/superpowers/specs/2026-06-08-book-studio-v1-production-package-qa-model.md`

## Purpose

This model extracts the publishing and analytics parts of Book Studio V1 into one review surface. It explains how PiB should move from a reviewed book package to KDP/Google manual handoff, then from external reports to trustworthy client-safe analytics.

This file does not create records, routes, APIs, components, direct publishing integrations, report parsers, or a Phase 1 implementation plan.

The companion production package QA model defines what "reviewed book package" means before a packet can claim manual-handoff readiness.

## V1 Publishing Posture

Book Studio V1 should use manual publishing handoff, not direct store automation.

The first channel focus is:

- Amazon KDP manual handoff.
- Google Play Books manual handoff.

The first operating rule is simple: PiB can only say "ready for manual handoff" when the packet contains enough evidence for a human operator to upload without guessing.

V1 must not:

- Publish directly to KDP, Google, or wider channels.
- Store or request sensitive publishing-account credentials.
- Mark a book live, accepted, ranked, or earning without external evidence.
- Treat one channel's readiness as proof for another channel.
- Promote internal upload notes or account details to the portal.

## Publishing Packet State Model

| State | Meaning | Allowed next move | Client visibility |
| --- | --- | --- | --- |
| Draft packet | Metadata, files, pricing, rights, account, or source evidence is incomplete. | Keep gathering evidence and review blockers. | Hidden. |
| Internal reviewable | Enough packet detail exists for PiB review, but one or more warnings may remain. | Assign owner/date/waiver path or resolve warnings. | Hidden unless admin promotes a safe summary. |
| Manual-handoff ready | Required evidence is current, packet version is bound to proof/package, and reviewer approves manual upload. | Human uploads externally and records evidence. | Client-safe publishing packet may be promoted. |
| Submitted externally | Human upload occurred and evidence is recorded. | Track external review state, revisions, or live links. | Safe status summary may be promoted. |
| Live with evidence | External listing/live link and package/version evidence are recorded. | Start launch/lifecycle and analytics tracking. | Safe live status may be promoted. |
| Revision required | External store or reviewer requires a change. | Invalidate affected packet/proof state and create revision tasks. | Safe blocker may be promoted. |
| Blocked | Rights, account, package, disclosure, policy, or source evidence is missing or failed. | Resolve blocker or stop production. | Safe blocker only if admin promotes it. |

## Packet Evidence Checklist

Every KDP/Google manual-handoff packet should carry evidence for these areas:

| Evidence area | Required proof before handoff |
| --- | --- |
| Version binding | Approved manuscript/proof/package version, checksum or package reference, and invalidation rules for later edits. |
| Metadata | Title, subtitle, author/brand, description, categories/genres, keywords, language, audience, maturity, and series data. |
| Files | Intended format, file names, package manifest, cover/interior proof, validation warnings, and channel-specific file assumptions. |
| AI disclosure | AI-generated, AI-assisted, human-authored, unknown, and reviewed disclosure basis derived from generation/provenance records. |
| Rights | Asset, quote, public-domain, companion/commentary, trademark, contributor, territory, and ownership evidence. |
| Account authority | Owner type, channel account used, consent/authority, identity/tax/payment readiness label, and recheck date without storing secrets. |
| Pricing and territories | Price, royalty/margin assumption, territory plan, currency, print cost where relevant, and negative-margin warnings. |
| Source freshness | Source-register keys and last-checked state for policy-sensitive readiness claims. |
| Reviewer decision | Human reviewer, decision date, pass/warn/block state, warnings, waiver path, and next action. |
| Manual upload instructions | External step checklist and what evidence must be copied back into PiB after upload. |

## KDP And Google Separation

KDP and Google should have separate packet lanes.

| Concern | KDP lane | Google Play Books lane |
| --- | --- | --- |
| File readiness | Kindle ebook, paperback, and hardcover assumptions must be checked separately from unsupported formats. | EPUB/PDF package intent, file completeness, identifier mapping, and validation assumptions must be checked separately. |
| Metadata | Categories, keywords, title/subtitle/cover consistency, series eligibility, ISBN/imprint, and AI disclosure are channel-specific. | Title/language/genre/identifier/series spelling and duplicate-risk handling are channel-specific. |
| Series | Internal PiB series does not equal KDP series-page eligibility. | Exact series spelling, punctuation, volume numbering, and identifier behavior matter. |
| Reports | Orders, royalties, KENP, promotions, payments, and timing need confidence labels. | Earnings, sales summary, transactions, preview traffic, missing values, refunds, and Pacific-time dates need confidence labels. |
| Evidence freshness | KDP source keys must be current before packet approval. | Google source keys must be current before packet approval. |

## Manual Upload Evidence

After a human uploads externally, PiB should record:

- Channel.
- Account/profile label used, without secrets.
- Packet version and package checksum/reference used.
- Upload date and operator.
- External book/listing ID if available.
- Store review state.
- Live link if available.
- Store warnings, rejection notes, or revision requests.
- Evidence attachment or screenshot reference if allowed.
- Next review date.

Manual upload evidence should never imply commercial performance. It proves that an external action happened; analytics remains separate.

## Analytics Posture

V1 analytics should start with manual imports and confidence labels.

The dashboard should answer:

- What source is this from?
- What report type is this?
- What period and timezone does it cover?
- Is this estimated, reported, settled, refunded, adjusted, unmatched, ad-attributed, or partial?
- What is missing or unresolved?
- What can be shown safely to the client?

The dashboard should not start with one blended revenue number.

## Analytics State Model

| State | Meaning | Allowed next move | Client visibility |
| --- | --- | --- | --- |
| No import | No external performance evidence exists. | Show no revenue claims; create import task after launch. | No analytics summary. |
| Imported partial | A report/snapshot exists, but rows, period, source, or confidence are incomplete. | Create reconciliation warnings and owner. | Hidden or clearly partial if promoted. |
| Reported with caveats | Report rows are useful but settlement, refunds, adjustments, or matching may still change. | Keep confidence labels and reconcile gaps. | Client-safe summary only with caveats. |
| Reconciled summary | Source, period, timezone, confidence, and outstanding gaps are reviewed. | Promote client-safe summary. | Visible if admin promotes it. |
| Settled where supported | Payment/settlement evidence supports settled status for a specific period/source. | Include in settled view with source details. | Visible if admin promotes it. |
| Disputed or unmatched | Rows do not reconcile, values are missing, or source conflicts exist. | Create task and block confident summary. | Safe blocker only if admin promotes it. |

## Analytics Data Separation

| Metric family | Rule |
| --- | --- |
| Estimated sales or royalties | Useful for trend signals only; never merged into settled totals. |
| Reported sales | Show with report type, source period, timezone, and confidence. |
| Settled payments | Show only where payment/settlement evidence exists for the period. |
| Refunds and returns | Keep visible; do not hide inside net values without trace. |
| Adjustments | Label source and reason where known. |
| Ad-attributed rows | Separate from organic/store reports unless reconciliation supports merging. |
| Preview traffic | Treat as engagement signal, not revenue. |
| Series rollups | Show book-level rows first, then rollups with confidence and missing-volume warnings. |
| Costs | Separate production, promotion, platform, and manual adjustment costs from store revenue. |

## Portal Reporting Rules

Portal analytics should be promoted, not mirrored.

Client-safe analytics may include:

- Book or series performance summary.
- Source period and confidence label.
- High-level sales/royalty trend where evidence supports it.
- Reconciliation caveat in plain language.
- Next action or waiting state.

Portal analytics must not include:

- Raw imports.
- Parser errors.
- Internal costs unless explicitly client-approved.
- Account/payment profile details.
- Internal reconciliation notes.
- Estimates framed as guaranteed revenue.
- Screenshots presented as source of truth without report metadata.

## Publishing And Analytics Review Walkthrough

Peet should be able to review V1 through this sequence:

1. A project reaches a reviewed Book Brief and proof/package state.
2. KDP and Google packet lanes show separate readiness, warnings, and blockers.
3. Account authority is labeled without secrets.
4. Manual-handoff ready appears only after source freshness, disclosure, rights, files, metadata, pricing, package version, and reviewer evidence exist.
5. Human upload evidence records what happened outside PiB.
6. External status does not imply revenue.
7. Manual analytics import creates source/confidence/reconciliation labels.
8. Client portal receives only a reviewed summary with caveats.

## Wider Channel Deferral

Apple, Kobo, Draft2Digital, IngramSpark, ACX, Amazon Ads, review outreach, and direct publishing APIs should stay deferred unless Peet revises the approval record.

Adding any of them to V1 requires:

- Fresh source review.
- Account authority design.
- File/package differences.
- Reporting and payment timing design.
- Conflict checks with KDP/Google and aggregators.
- New acceptance fixtures.

## Devil's Advocate

- Manual handoff may feel slow, but direct publishing before account governance and packet evidence is a liability multiplier.
- A packet can look complete while being stale. Source freshness must be visible at the readiness point.
- Store status is not revenue. Upload evidence, live links, sales reports, and payment settlements are separate facts.
- Analytics can damage trust if it turns partial reports into a confident story.
- Series rollups can hide weak individual books. Book-level evidence should remain visible under every series summary.
- Portal summaries should reduce uncertainty for clients, not expose every internal caveat.

## Current Review State

This model supports the same approval gate as the decision packet. Book Studio V1 has a reviewable publishing and analytics posture, but no implementation plan, direct publishing integration, report parser, or runtime analytics surface is approved until Peet approves or revises the V1 approval record.
