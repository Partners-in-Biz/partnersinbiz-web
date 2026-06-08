# Book Studio V1 Red-Team Risk Register

**Date:** 2026-06-08
**Status:** Design-only risk register; not an implementation plan.
**Authoritative dossier:** `docs/superpowers/specs/2026-06-07-book-studio-research-dossier.md`
**Decision packet:** `docs/superpowers/specs/2026-06-08-book-studio-v1-approval-packet.md`
**Review script:** `docs/superpowers/specs/2026-06-08-book-studio-v1-review-script.md`
**Acceptance fixtures:** `docs/superpowers/specs/2026-06-08-book-studio-v1-acceptance-fixtures.md`
**Jurisdiction/local publisher model:** `docs/superpowers/specs/2026-06-08-book-studio-v1-jurisdiction-local-publisher-model.md`
**Market evidence model:** `docs/superpowers/specs/2026-06-08-book-studio-v1-market-evidence-model.md`

## Purpose

This register consolidates the devil's-advocate work for Book Studio V1 into one review surface. It is meant to help Peet decide whether the recommended V1 posture is strong enough before any implementation plan is written.

This file does not authorize runtime code, Firestore collections, APIs, routes, components, Hermes runtime dispatch, direct publishing, ad spend, review outreach, credential custody, or a Phase 1 implementation plan.

## How To Read This Register

Each risk has one of three review outcomes:

- **Pass:** current V1 design handles the risk well enough for approval.
- **Warn:** the risk can be accepted only with owner, due date, waiver path, or later-phase label.
- **Block:** the risk should stop implementation planning or any future release-sensitive action until resolved.

The right V1 should prove restraint. A demo that cannot show blocked states is not proving Book Studio; it is proving only that the happy path looks attractive.

## Executive Red-Team Summary

The biggest risk is not that Book Studio cannot generate books. The biggest risk is that PiB generates polished, plausible, unsafe book products faster than the team can prove rights, source quality, disclosure, packaging, publishing authority, and analytics truth.

The recommended V1 stays defensible by keeping five hard boundaries:

- Internal PiB production studio first, not public self-serve SaaS.
- KDP and Google Play Books manual handoff first, not direct publishing automation.
- Reviewed market evidence before production selection, not sales/rank promises or shelf screenshots.
- Reviewed artifact promotion to portal, not raw admin or Hermes visibility.
- Hermes as bounded assistant with fixtures, not autonomous publisher.
- Manual analytics imports with confidence labels, not a single revenue promise.

## Risk Register

| Area | Red-team question | Failure mode | V1 control | Review outcome |
| --- | --- | --- | --- | --- |
| Product posture | Are we building an operating system or a flashy generator? | The module starts with "write me a book" and skips research, gates, rights, and review. | Approval packet defines internal production studio posture; workflow map starts with intake, gates, and evidence. | Pass if Peet approves the posture explicitly. |
| Scope | Does V1 try to cover every channel and book family? | Phase 1 becomes KDP, Google, Apple, Kobo, D2D, Ingram, audio, visual books, ads, and reviews at once. | Approval packet narrows first channels and pilots; wider channels stay adapter research. | Block if wider channels become first-scope requirements without source refresh. |
| Book quality | Can a polished but weak book pass? | AI produces generic content that looks complete but disappoints readers or mismatches metadata. | Research packet, Book Brief, editorial passes, proof/package evidence, and negative-control fixtures. | Warn unless first demo includes at least one block case. |
| Market evidence | Can a weak idea become a production project because the shelf looks active? | Operators treat search rank, bestseller labels, review counts, competitor screenshots, or generic category activity as proof that this book will sell. | Market evidence packet, pass/warn/block candidate state, KDP/Google discoverability source refresh, no sales/rank promises, Fixture H. | Block if Book Brief or production can start without reviewed market evidence. |
| Rights and IP | Can weak rights evidence hide behind a nice cover? | Public-domain, companion, summary, quote, trademark, or asset risks are treated as creative issues instead of release blockers. | Rights-first fixture, asset provenance gates, public-domain/companion negative control, internal-only rights notes. | Block when rights evidence is missing, stale, or ambiguous for public use. |
| KDP policy | Can the packet claim KDP readiness from memory? | Unsupported formats, misleading metadata, AI disclosure, ISBN/imprint, quality, or series rules are missed. | Source register, KDP readiness check, source freshness, manual upload checklist, packet blockers. | Block if source freshness or disclosure provenance is missing. |
| Google Play Books policy | Can Google readiness be treated as the same as KDP readiness? | File, identifier, metadata, series, report, or content-policy differences are flattened. | Separate Google readiness packet, identifier history, file validation, report confidence model. | Block if Google evidence is inferred only from KDP packet state. |
| Series | Does "series" imply every channel will accept it? | Internal PiB series, KDP series eligibility, and Google series metadata are blurred. | Channel-specific series flags, continuity bible, volume order, rollup analytics, fixture C. | Warn unless channel eligibility is visible per series. |
| Low-content/activity books | Are activity and low-content products treated as normal ebooks? | Kindle suitability, page repetition, answer keys, proofing, margin, and classification risks are hidden. | Activity/low-content warning fixture and print-first readiness posture. | Warn unless proof/classification/margin warnings are owner-bound. |
| Children/visual books | Does creative range arrive before file, safety, and asset controls? | Fixed-layout, image safety, character consistency, reading level, and rights risks slow or break V1. | Children picture fixed-layout remains fixture/later-phase unless Peet expands pilot set. | Block if promoted to first pilot without asset-rights and layout refresh. |
| Hermes skills | Can Hermes exceed its approved role? | Hermes publishes, approves, spends, messages clients, requests credentials, or marks client-ready. | Forbidden-action fixture, skill manifests, reviewer defaults, output sanitizers, runtime dispatch gate. | Block until forbidden-action tests and sanitizers exist. |
| Generation provenance | Can disclosure answers be reconstructed later? | AI-generated/assisted status is guessed after drafts are edited or overwritten. | Generation run records, idempotency keys, source manifests, immutable provenance, disclosure derivation. | Block if disclosure is a project-level checkbox only. |
| Portal safety | Can clients see internal uncertainty? | Raw research, raw Hermes output, rights notes, parser errors, upload-account details, or unreconciled costs leak. | Reviewed artifact promotion by version, portal module gate, safe blockers, client-safe summaries. | Block if portal mirrors admin state. |
| Publishing authority | Can PiB upload under the wrong account or authority? | Client-owned and PiB-owned books blur account, tax, payment, imprint, territory, or consent responsibility. | Ownership model, publishing account readiness report, manual upload evidence, no credential custody. | Block if account authority is unresolved. |
| Local publisher obligations | Can KDP/Google readiness be mistaken for South African local readiness? | Legal deposit, ISBN/imprint, copyright posture, contributor authority, publisher jurisdiction, or local adaptation evidence is missed after a polished channel packet passes. | Jurisdiction/local publisher model, separate evidence lanes, portal-safe blockers, source-refresh keys. | Block if local-compliance, ISBN/imprint, copyright-registration, or legal-deposit claims lack reviewed evidence. |
| Direct publishing | Is manual upload treated as temporary debt instead of a boundary? | The team rushes API publishing before packet evidence and account governance are proven. | V1 excludes direct publishing and sensitive credential storage. | Block if direct store automation is requested before V1 proof. |
| Launch and reviews | Can launch activity create platform or reputation risk? | Automated review outreach, paid activity, public sends, price changes, or promotion claims bypass approval. | Launch/review compliance gates and explicit V1 deferrals for automated outreach and ad spend. | Block if any public launch action lacks approval. |
| Analytics truth | Can reports become a misleading revenue story? | Estimated, reported, settled, refunded, adjusted, unmatched, ad-attributed, and partial values merge into one total. | Manual import ledger, confidence labels, reconciliation tasks, client-safe promotion only after review. | Block if source, period, timezone, confidence, or reconciliation state is missing. |
| Financial viability | Can a book pass even when margin is poor? | Print costs, refunds, ad costs, royalties, currency conversion, and platform timing make the product unprofitable. | Pricing/margin model, warnings, manual analytics import, cost recovery, series-level rollups. | Warn unless negative or unknown margin creates visible review state. |
| Operational load | Can PiB support the process repeatedly? | The first book depends on hero effort, manual spreadsheet work, or undocumented reviewer judgment. | Templates, playbooks, packets, fixtures, Projects/Kanban tasks, and explicit owner/reviewer gates. | Warn until first demo shows repeatable pass/warn/block flow. |
| Security and privacy | Can publishing/account data leak? | Passwords, tax IDs, bank data, identity documents, or internal account notes are stored or exposed. | No sensitive credential custody; account-readiness checklist only; portal redaction. | Block on any sensitive-secret storage path. |
| Platform fit | Can Book Studio become a standalone app bolted onto PiB? | `PMStander/ai-story` ideas are ported directly and bypass PiB org scope, portal modules, Projects, Research, and Client Documents. | PiB-native architecture, shared workspaces, org scope, module entitlement, artifact bridges. | Pass if direct porting remains rejected. |

## Kill Criteria

The recommended V1 should be stopped or redesigned if any of these become true:

- Peet wants public self-serve generation as the first product.
- V1 must directly publish to stores or hold channel credentials.
- V1 must automate review outreach, paid ads, price changes, or public launch sends.
- Portal users must see raw generation, raw research, internal rights notes, or unreconciled analytics.
- Book Brief or production work can start from market screenshots, copied competitor positioning, automated market scraping, sales forecasts, rank promises, or negative/unknown print margin.
- First scope must include wide distribution, audio, children/visual production, or full layout tooling without a separate source and safety refresh.
- Hermes runtime dispatch must be live before manifests, fixtures, sanitizers, reviewer defaults, and forbidden-action tests exist.
- The first demo cannot show one pass case, one warning case, and one blocked case.

## Risks Worth Accepting In V1

These risks are acceptable if they stay explicit:

- Manual upload is slower than direct publishing, but it proves packet evidence and account authority first.
- Manual analytics imports are less elegant than API integrations, but they force confidence and reconciliation labels before client reporting.
- Starting with business nonfiction and activity/low-content print is narrower than a full book platform, but it tests research, packets, series, Hermes, and analytics without making fixed-layout or audio the first bottleneck.
- Optional client review is less exciting than self-serve creation, but it prevents raw uncertainty from becoming a client-facing product.

## Review Questions For Peet

Before implementation planning, Peet should be able to answer:

1. Is the internal production-studio posture acceptable for V1?
2. Are KDP and Google Play Books manual handoff enough for the first channel proof?
3. Should the negative-control rights fixture stay in the first demo set?
4. Is the market evidence gate required before Book Brief or production selection?
5. Is portal review limited to promoted artifact versions?
6. Is Hermes allowed only to create reviewable artifacts, checks, and tasks?
7. Is manual analytics import acceptable until confidence and reconciliation behavior is proven?
8. Are the V1 deferrals acceptable: no self-serve generation, direct publishing, credential custody, automated review outreach, autonomous ads, sales/rank promises from market research, full layout tooling, or automated report integrations?

## Current Decision State

This register supports the same approval gate as the decision packet. Book Studio V1 is ready for a product approval decision, but not for runtime build work or implementation planning until Peet approves or revises the V1 approval record.
