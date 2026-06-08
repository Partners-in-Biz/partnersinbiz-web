# Book Studio V1 Metadata, Discoverability, And Store Listing Model

**Date:** 2026-06-08
**Status:** Design-only evidence model; not a schema, UI design, Hermes runtime skill, listing optimizer, or implementation plan.
**Authoritative dossier:** `docs/superpowers/specs/2026-06-07-book-studio-research-dossier.md`
**Decision packet:** `docs/superpowers/specs/2026-06-08-book-studio-v1-approval-packet.md`
**Source refresh contract:** `docs/superpowers/specs/2026-06-08-book-studio-v1-source-refresh-contract.md`
**Market evidence model:** `docs/superpowers/specs/2026-06-08-book-studio-v1-market-evidence-model.md`
**Publishing and analytics model:** `docs/superpowers/specs/2026-06-08-book-studio-v1-publishing-analytics-model.md`
**Rights, asset, and contributor ledger model:** `docs/superpowers/specs/2026-06-08-book-studio-v1-rights-asset-contributor-ledger-model.md`
**Language and translation model:** `docs/superpowers/specs/2026-06-08-book-studio-v1-language-translation-edition-model.md`

## Purpose

Book metadata is not cosmetic. For Book Studio V1 it controls how the book is described, discovered, linked to contributors and series, reviewed by channels, and represented to clients.

This model makes metadata and store listing evidence a first-class approval gate before a Book Studio project can claim KDP or Google Play Books packet readiness, portal listing-readiness, launch copy readiness, or analytics promotion.

This file does not approve runtime metadata records, listing mutation, category automation, keyword scraping, direct KDP/Google publishing, app UI, Firestore schema, Hermes dispatch, or a Phase 1 task list.

## Current Source Implications

The source refresh contract already tracks the official source keys that matter most for metadata and listing readiness:

- KDP keywords, categories, metadata, description, authors/contributors, series, search, content-quality, and low-content guidance.
- Google metadata, add-book, series, identifier, selling, and content-policy guidance.
- Language/translation source keys for target-language metadata, identifiers, reading direction, and translated-edition channel support.
- Rights and contributor source keys for public-domain, contributor credit, AI assets, client assets, and public-use permission.

Design consequence: KDP and Google metadata cannot be treated as one generic "book listing" field. V1 needs separate channel packets with evidence for the current title/subtitle, description, contributor display, category/genre choices, keywords/search terms, series state, language, identifiers, audience/age posture, rights-sensitive assets, and source freshness.

## Metadata Scope

The V1 metadata gate covers these lanes:

| Lane | KDP posture | Google Play Books posture | Common blocker |
| --- | --- | --- | --- |
| Title and subtitle | Must match the book, cover, files, and customer promise. | Must map to Google book info without reusing KDP assumptions blindly. | Misleading promise, keyword stuffing, title/cover mismatch, or rank/sales claim. |
| Description | Must be clear, professional, source-backed, and free of restricted claims or stuffing. | Must be suitable for Google metadata and content-policy review. | Review/testimonial claim, time-sensitive hype, copied competitor copy, or unsupported benefit. |
| Keywords/search terms | Treated as relevance hypotheses and reviewed against the book's actual content. | Stored as Google-safe discoverability notes only when applicable; do not force KDP keyword behavior into Google. | Irrelevant, vague, repeated, trademark-adjacent, or competitor-name stuffing. |
| Categories and genres | KDP category choices require relevance and customer-experience review. | Google genres and category mapping require separate review. | Choosing popular but misleading categories or flattening KDP categories into Google genres. |
| Contributors | Author, editor, translator, illustrator, narrator, designer, and other contributor display must align with rights and credit evidence. | Contributor metadata must match Google entry requirements and identifier/series context. | Pen name, ghostwriter, translator, illustrator, or client-owned contributor state has no authority evidence. |
| Series and volume data | Internal series state must not imply KDP series eligibility. | Google series names, numbering, and relationship type need channel-specific evidence. | Whole series marked ready because book one metadata passed. |
| Language, audience, and identifiers | Language, age/audience, ISBN/imprint, and AI disclosure implications must align with the packet. | Primary language, identifiers or GGKEY plan, and translated-edition metadata must stay edition-specific. | Source-edition metadata reused for a translated edition or wrong identifier. |
| Portal listing summary | Portal can show only reviewed, client-safe listing summaries. | Same portal rule; no raw keyword experiments or internal channel notes. | Client sees internal uncertainty, raw Hermes output, account notes, or speculative metadata. |

## Metadata States

| State | Meaning | Allowed movement |
| --- | --- | --- |
| `metadata_not_started` | No reviewed listing evidence exists for this book version. | Internal idea capture only. |
| `metadata_evidence_collecting` | Operators or Hermes collect options, source evidence, rights references, and channel constraints. | Research, Book Brief, and internal packet work can continue. |
| `metadata_reviewable` | Title, subtitle, description, categories/genres, keywords, contributors, series, identifiers, language, and portal summary are ready for human review. | May move to pass, warning, or block. |
| `metadata_reviewable_with_warning` | A channel or lane has a named owner, due date, waiver path, or narrower safe wording. | Internal packet can continue; dependent portal/manual-handoff claims must show warning. |
| `metadata_approved_for_current_scope` | Current channel, edition, file, rights, and source scope has passed review. | Packet readiness, portal summary, and launch copy can depend on it for this exact version only. |
| `metadata_blocked` | Metadata is misleading, stale, copied, stuffed, unsupported, rights-inconsistent, or channel-incompatible. | No packet readiness, portal listing summary, launch copy, or analytics promotion for the affected scope. |
| `metadata_invalidated` | A dependent source, manuscript, cover, title, description, rights, contributor, identifier, language, or channel fact changed. | Return to collection or review for affected lanes. |

## Gate Effects

Metadata/listing evidence must be pass or accepted-warning before these claims advance:

- Candidate becomes production-selectable when metadata risk is part of market evidence.
- Book Brief promises a title, audience, or customer outcome as stable.
- KDP or Google packet claims manual-handoff readiness.
- Portal shows a listing summary, publishing packet summary, or client approval request.
- Launch copy, price/promotion copy, or lifecycle update uses the metadata.
- Analytics summary interprets title, series, edition, language, or channel performance.

Metadata/listing evidence does not need to pass before:

- Internal idea capture.
- Research packet assembly.
- Internal option drafting.
- Safe blocker wording.
- Reviewer task creation.

## Hermes Boundaries

Allowed:

- Draft title, subtitle, description, category/genre, keyword, contributor, and series options as internal candidates.
- Compare metadata options to reviewed research, Book Brief, content, rights, source keys, and channel constraints.
- Flag keyword stuffing, misleading categories, copied competitor phrasing, rank/sales claims, weak contributor authority, stale source keys, and channel mismatch.
- Create reviewer questions and metadata-fix tasks.

Forbidden:

- Mutate any live KDP or Google listing.
- Choose final categories, genres, keywords, contributors, identifiers, series, or disclosure answers without reviewer approval.
- Use competitor metadata as copy source.
- Promise rank, bestseller status, search placement, sales, royalties, or review outcomes.
- Treat KDP keyword/category behavior as Google metadata behavior.
- Mark a listing upload-ready when source keys, rights evidence, file/package evidence, or contributor authority are stale or missing.

## Portal Rules

Portal metadata must be a safe summary, not the admin listing workspace.

Allowed portal wording:

- "The proposed listing summary is ready for your review."
- "The listing summary is being revised after source or content changes."
- "The listing is blocked until PiB resolves channel, rights, contributor, or title/description evidence."

Forbidden portal exposure:

- Raw keyword experiments.
- Internal competitor notes.
- Account or upload instructions.
- Source uncertainty that has not been converted into client-safe wording.
- Raw Hermes output.
- Rank, sales, bestseller, review, or search-placement promises.

## Acceptance Fixtures

| Fixture | Expected outcome |
| --- | --- |
| `META-PASS-001` | Business nonfiction ebook has title/subtitle, description, KDP keywords/categories, Google genre, contributor, AI-use, language, identifier, series-not-applicable, and portal summary reviewed for current files and rights scope. |
| `META-WARN-001` | Strong manuscript has useful KDP metadata but Google genre/identifier evidence is incomplete; KDP packet can remain reviewable while Google handoff and portal listing summary carry warning. |
| `META-WARN-002` | Series metadata is internally coherent, but KDP or Google external series eligibility is unverified; portal may show internal series plan only. |
| `META-BLOCK-001` | Title, subtitle, or description promises outcomes the manuscript does not support or uses rank/sales/bestseller language. |
| `META-BLOCK-002` | Categories, keywords, or description use stuffing, irrelevant terms, competitor names, trademark-adjacent positioning, review/testimonial language, or copied competitor metadata. |
| `META-BLOCK-003` | Contributor, translator, illustrator, client brand, AI asset, public-domain, or open-license evidence is missing, stale, or inconsistent with the proposed public listing. |

## Source Evidence Keys

```yaml
metadataListingSourceKeys:
  kdp:
    - kdp-keywords-discoverability
    - kdp-categories-discoverability
    - kdp-metadata-guidelines
    - kdp-description-guidelines
    - kdp-authors-contributors
    - kdp-series
    - kdp-content-quality
  google:
    - google-metadata
    - google-add-book
    - google-series
    - google-isbns-identifiers
    - google-content-policies
  dependentEvidence:
    - bookResearchPacketLink
    - bookMarketEvidencePacket
    - bookBriefVersion
    - bookRightsAssetLedger
    - bookPublishingPacket
    - bookPortalPromotion
```

## Review Questions

Before metadata/listing claims can pass, a reviewer should be able to answer:

1. Does the metadata match the current manuscript, cover, proof, book promise, rights evidence, contributor evidence, and selected channel scope?
2. Is KDP metadata reviewed separately from Google metadata?
3. Are keywords, categories, genres, and descriptions relevant rather than stuffed, vague, copied, or popularity-chasing?
4. Are contributor, translator, illustrator, narrator, brand, public-domain, open-license, AI-asset, and client-owned asset implications backed by the rights ledger?
5. Are series, language, identifiers, and translated-edition metadata version-bound and channel-specific?
6. Is the portal summary safe, reviewed, and free of internal experiments or promises?

## Devil's Advocate

- Metadata can look like marketing copy, but it is a policy, rights, and customer-experience surface.
- "Better discoverability" can become an excuse for misleading categories, stuffed keywords, copied competitor positioning, or rank promises.
- Reusing KDP metadata for Google feels efficient, but it hides channel-specific genre, identifier, series, and add-book requirements.
- Metadata can invalidate downstream approvals. A changed title, subtitle, category, contributor, series, identifier, language, or description can make prior packet, proof, portal, launch, and analytics summaries stale.

## Current Review State

This model strengthens the existing V1 approval packet by making metadata/listing evidence explicit. It does not change the recommended V1 posture: internal PiB production studio, KDP and Google manual handoff first, reviewed evidence gates, safe portal promotion, controlled Hermes readiness, no direct listing mutation, and no implementation until Peet approves or revises the V1 record.
