# Book Studio V1 Rights, Asset, And Contributor Ledger Model

**Date:** 2026-06-08
**Status:** Design-only rights and provenance model; not legal advice, a contract template, a file store, a route map, a Firestore schema, an API contract, a UI design, a Hermes runtime plan, or a Phase 1 task list.
**Authoritative dossier:** `docs/superpowers/specs/2026-06-07-book-studio-research-dossier.md`
**Decision packet:** `docs/superpowers/specs/2026-06-08-book-studio-v1-approval-packet.md`
**Production package QA model:** `docs/superpowers/specs/2026-06-08-book-studio-v1-production-package-qa-model.md`
**Jurisdiction/local publisher model:** `docs/superpowers/specs/2026-06-08-book-studio-v1-jurisdiction-local-publisher-model.md`
**Source refresh contract:** `docs/superpowers/specs/2026-06-08-book-studio-v1-source-refresh-contract.md`

## Purpose

Book Studio cannot treat a manuscript, cover, illustration set, translated edition, worksheet, audio script, or publishing packet as ready while rights and contributor evidence are unresolved. This model turns the conceptual `bookRightsAssetLedger` into a design gate for future planning.

The central rule is simple: every production artifact that may influence a proof, portal artifact, publishing packet, marketing claim, or manual handoff must have asset-level and contributor-level provenance evidence, or it must carry a reviewed warning or blocker.

This file does not decide legal rights, write contracts, approve copyright posture, create runtime ledgers, store files, validate licenses automatically, dispatch Hermes, publish to any channel, or authorize implementation.

## Current Source Implications

These sources were checked on 2026-06-08 and should remain source-refresh gated:

| Source | Implication for Book Studio |
| --- | --- |
| KDP Content Guidelines: `https://kdp.amazon.com/en_US/help/topic/G200672390` | KDP applies content rules to book content, title, cover art, and product description; authors/publishers are responsible for proprietary rights, AI-generated images/text/translations, companion-book permission, public-domain proof, and customer experience. |
| KDP Intellectual Property Rights FAQ: `https://kdp.amazon.com/en_US/help/topic/G200672400` | KDP requires publishing rights for uploaded content and may request documentation for rights, previous publishers, formats, territories, prior websites, or KDP account conflicts. A copyright page alone is not proof of rights. |
| KDP Authors & Contributors: `https://kdp.amazon.com/en_US/help/topic/G2BWJN2BY98T5PV2` | KDP contributor names and author fields affect detail pages, series/format linking, search, author pages, pen names, and contributor update limits. Contributor evidence must be stable before metadata or packet approval. |
| KDP Public Domain Content: `https://kdp.amazon.com/en_US/help/topic/G200743940` | Public-domain projects may need proof and differentiation; basic formatting, collections, price, sales rank, or freely available internet content do not make a work meaningfully differentiated. |
| Google Publisher Program Policies: `https://support.google.com/books/partner/answer/166501?hl=en` | Google packets need account, file, content, pricing, reporting, refund, copy/paste, printing, and valid contact evidence; books sold on Google Play must comply with Google content policies. |
| Google Publisher Content Policies: `https://support.google.com/books/partner/answer/1067634?hl=en` | Google blocks spam, misleading/disappointing content, confusing metadata, duplicate public-domain content, and technical/readability quality failures, including low-quality unclear machine-read audio. |
| Creative Commons license overview: `https://creativecommons.org/cc-licenses/` | CC licenses can grant reuse in advance, but license type matters: attribution, share-alike, no-derivatives, and noncommercial terms can directly affect a paid KDP/Google book, adapted cover, workbook, or translated edition. |

Book Studio should also preserve per-asset provider terms at acquisition time. Stock-photo, font, template, marketplace, generator, freelancer, and client-owned-asset licenses can change outside this packet; future runtime work should store the exact provider URL, captured date, and accepted terms snapshot reference for each asset.

## Ledger Scope

The ledger should cover these inputs before package QA, portal proof, or manual handoff can claim readiness:

| Input class | Examples | Required evidence |
| --- | --- | --- |
| Manuscript and generated text | Human draft, Hermes-assisted draft, AI-generated section, ghostwritten chapter, adapted source text, public-domain source. | Creator, owner, AI classification, source basis, originality posture, territory, format, version, reviewer state. |
| Cover assets | Photo, generated image, illustration, typography, layout template, back-cover copy, author photo, logo. | Asset source, license, commercial use, territory, print/ebook use, modification/adaptation permission, AI status, attribution, expiry, owner. |
| Interior assets | Illustrations, diagrams, worksheets, icons, tables, screenshots, maps, recipe photos, activity templates. | Source, creator, usage grant, resolution/format, derivative permission, attribution, sensitive-person/property release if relevant. |
| Fonts and templates | Paperback/interior fonts, cover fonts, layout templates, Canva/Figma/marketplace templates, workbook templates. | License source, embedding/print/ebook permission, seat/account authority, commercial use, modification rules, attribution if required. |
| Quotes and excerpts | Client quotes, third-party extracts, lyrics, poems, study-guide source excerpts, testimonials, reviews. | Permission, fair-use/legal-review task where applicable, source, length, attribution, territory, channel, public/portal wording approval. |
| Public-domain and open-licensed material | Public-domain books, CC images/text, museum assets, government/public works, open education resources. | Jurisdiction, source edition, license/public-domain basis, differentiation plan, attribution, no-derivatives/noncommercial/share-alike impact. |
| Contributors | Author, ghostwriter, editor, illustrator, designer, photographer, translator, narrator, voice artist, sensitivity reader, subject expert. | Role, credit display, assignment or license scope, payment/commercial terms, territory, formats, exclusivity, moral-rights/credit posture, revision rights. |
| Audio and voice assets | Narration, voiceover, virtual voice, music, sound effects, pronunciation list, audio edits. | Talent or synthetic-voice rights, music/SFX license, pronunciation approval, audio quality, distribution channel, credit, AI disclosure where needed. |
| Client-owned and brand assets | Logos, product photos, staff portraits, internal diagrams, case-study data, brand colors, customer examples. | Client approval, public-use scope, privacy/confidentiality review, territory, format, revocation/expiry, portal-safe summary. |

## Ledger States

| State | Meaning | Allowed use |
| --- | --- | --- |
| `not_needed_reviewed` | Reviewer confirms the artifact has no external asset or contributor dependency for this claim. | Internal review, package QA, or packet work can proceed if other gates pass. |
| `evidence_collecting` | Asset/contributor is known, but rights evidence is incomplete. | Internal drafting and task routing only. |
| `reviewable_with_warning` | Evidence exists but has a named warning, owner, due date, expiry, territory limit, attribution duty, or channel constraint. | Internal review only unless the warning is explicitly accepted for the next state. |
| `approved_for_current_scope` | Reviewer accepts evidence for exact artifact, version, channels, territory, format, and client/public wording. | Can support package QA, portal proof, or manual handoff for that scope only. |
| `blocked_or_disputed` | Evidence is missing, contradictory, stale, noncommercial-only, no-derivatives-conflicting, territory-limited, unassigned, or otherwise unsafe. | Blocks production start, package QA, portal proof, manual handoff, public copy, and analytics promotion for dependent claims. |

Approvals are version-bound. Changing files, contributor credit, metadata, edition, format, territory, cover art, language, public-domain basis, AI classification, or channel should invalidate the affected ledger evidence.

## Required Evidence Lanes

| Lane | Pass evidence | Warning evidence | Block evidence |
| --- | --- | --- | --- |
| Ownership and authority | PiB/client/author has rights for current scope and can produce proof if asked. | Rights are likely but proof has owner/date or channel-specific limitation. | Owner is unknown, rights conflict, prior publisher/territory/format issue is unresolved. |
| License scope | Commercial, print, ebook, cover, interior, marketing, translation, derivative, and territory scope are known. | Scope is narrow but acceptable for internal review or one channel. | License is noncommercial-only, no-derivatives-conflicting, expired, platform-only, or missing. |
| Contributor credit and metadata | Contributor role, display name, credit/pen-name posture, and channel metadata implications are reviewed. | Credit can change later but must not block current internal review. | Required contributor is missing, wrong, disputed, or metadata would be misleading. |
| AI and generated asset provenance | AI-generated vs AI-assisted classification is recorded for text, images, and translations; prompt/output evidence is internal-only. | Classification or disclosure wording needs reviewer confirmation. | AI-generated asset reaches packet/portal without classification or IP/customer-experience review. |
| Public-domain and open-license basis | Jurisdiction/source edition/license terms/differentiation/attribution are reviewed. | Public-domain or CC evidence has territory/attribution/share-alike warning. | Public-domain claim is assumed from one source, CC noncommercial/no-derivatives conflicts with planned paid/adapted use, or differentiation is weak. |
| Privacy, publicity, and client approval | People, client data, brand assets, screenshots, case examples, and testimonials have public-use clearance. | Client action is needed before public or portal promotion. | Private data, identifiable person, client mark, or testimonial reaches public copy without approval. |
| Channel and package dependency | KDP, Google, print, ebook, translation, series, audio, and marketing claims are mapped separately. | One channel can proceed while another remains warning/blocked. | One channel's rights pass is reused for another channel, format, territory, or edition. |

## Gate Effects

| Future state | Ledger requirement |
| --- | --- |
| Candidate becomes production-selectable | Known high-risk source, public-domain, companion, brand, AI, and contributor risks must be clear enough to price and scope. |
| Production starts | Required assets and contributors for the selected production scope are pass or accepted warning; blocked rights stop production. |
| Proof enters package QA | Every visible asset, cover element, quote, contributor input, and AI-generated element in the proof has evidence. |
| Portal proof is promoted | Internal rights notes are removed; client sees only safe actions, decisions, and blocker summaries. |
| KDP/Google manual handoff is prepared | Channel-specific rights, contributors, AI disclosure, public-domain, metadata, and account-authority evidence are fresh enough. |
| Launch/lifecycle action is prepared | Marketing copy, review/testimonial use, cover badges, claims, screenshots, and store status claims have rights and public-use evidence. |
| Analytics are promoted | No analytics summary implies revenue, ownership, attribution, or series rights that contradict ledger/account evidence. |

## Hermes Boundaries

Hermes can help with the ledger only as reviewable assistance:

- Inventory likely assets and contributors from a proof or brief.
- Draft missing-evidence questions.
- Summarize source/asset/license implications in internal language.
- Flag noncommercial, no-derivatives, territory, credit, AI, public-domain, or contributor warnings.
- Draft client-safe blocker wording after admin review.

Hermes must not:

- Decide legal rights, fair use, public-domain status, contributor ownership, or license enforceability.
- Convert missing rights evidence into a pass.
- Generate replacement art/text to bypass a rights blocker without new artifact versioning.
- Ask clients for credentials or legal documents outside reviewed task wording.
- Promote internal rights notes to the portal.
- Publish, upload, price, launch, request reviews, spend, or message clients.

## Portal Rules

Portal can later show reviewed, client-safe rights outcomes only:

- "Asset approval needed for the cover photo."
- "Translator credit needs confirmation."
- "Public-domain evidence is under review."
- "Client brand asset approval is required before this proof can be released."

Portal must not show:

- Raw license files or private contracts.
- Internal legal analysis.
- Prompt/output logs.
- Provider account details.
- Private client data.
- Speculative infringement language.
- Full internal contributor cost/commercial terms unless separately approved for the client.

## Acceptance Fixtures

| Fixture | Expected result |
| --- | --- |
| `RIGHTS-PASS-001` | Business nonfiction ebook has human author agreement, edited manuscript provenance, cover image license, font license, quote permissions or removed quotes, AI-assisted-only classification, and channel-specific KDP/Google rights summary; package QA can proceed for the current version. |
| `RIGHTS-WARN-001` | Stock cover image license supports ebook but print-run or merchandise use is unclear; internal proof can continue with owner/date warning, but print packet and public marketing are blocked until resolved. |
| `RIGHTS-WARN-002` | Client-owned logo, author photo, or testimonial is useful but needs public-use approval; portal may show a client action request, not a publish-ready state. |
| `RIGHTS-BLOCK-001` | Companion or public-domain project assumes rights from a web copy, lacks jurisdiction/source-edition evidence, and has weak differentiation; production, package QA, portal proof, and manual handoff are blocked. |
| `RIGHTS-BLOCK-002` | AI-generated cover or interior illustration lacks generation provenance, IP/customer-experience review, and disclosure basis; proof promotion, KDP/Google packet readiness, and portal summary are blocked. |
| `RIGHTS-BLOCK-003` | Hired illustrator, translator, ghostwriter, narrator, or designer work has no assignment/license, credit, territory, or format evidence; dependent package and manual handoff states are blocked. |

## Source Evidence Keys

```yaml
rightsAssetContributorSourceKeys:
  kdp-content-ai-ip:
    url: https://kdp.amazon.com/en_US/help/topic/G200672390
    affects:
      - rights_review
      - ai_generated_asset_classification
      - public_domain_and_companion_review
      - cover_and_product_description_safety
  kdp-ip-rights-faq:
    url: https://kdp.amazon.com/en_US/help/topic/G200672400
    affects:
      - publishing_rights_documentation
      - prior_publisher_format_territory_review
      - rights_proof_warning
  kdp-authors-contributors:
    url: https://kdp.amazon.com/en_US/help/topic/G2BWJN2BY98T5PV2
    affects:
      - contributor_credit
      - author_metadata_consistency
      - pen_name_and_detail_page_risk
  kdp-public-domain:
    url: https://kdp.amazon.com/en_US/help/topic/G200743940
    affects:
      - public_domain_proof
      - differentiation_review
      - public_domain_blocker
  google-program-policies:
    url: https://support.google.com/books/partner/answer/166501?hl=en
    affects:
      - google_packet_rights_and_content_policy
      - account_contact_authority
  google-content-policies:
    url: https://support.google.com/books/partner/answer/1067634?hl=en
    affects:
      - misleading_duplicate_or_low_quality_content
      - public_domain_google_blocker
      - audio_quality_review
  creative-commons-licenses:
    url: https://creativecommons.org/cc-licenses/
    affects:
      - open_license_terms
      - attribution
      - noncommercial_no_derivatives_sharealike_review
```

Per-asset provider terms should be stored as asset-level evidence, not global source keys.

## Review Questions For Peet

1. Should Phase 1 require a visible internal rights ledger before the first proof can exist, or before the first proof can be promoted to package QA?
2. Should client-owned books require client approval for every brand/photo/testimonial asset, or only assets that become public or portal-visible?
3. Should PiB-owned books default to stricter asset rules than client-owned books because PiB carries the publishing risk?
4. Should children/visual and audio fixtures stay deferred until rights-ledger controls exist, or should one visual fixture be added specifically to prove the controls?

## Devil's Advocate

- A polished cover can make a weak rights situation feel solved. The ledger must block the package even when the proof looks good.
- "Royalty-free" or "free to use" is not enough. The actual license scope, attribution, territory, format, and derivative/commercial rules matter.
- Contributor rights are easy to lose in project chat. If the ledger cannot prove assignment/license/credit for hired work, it should block.
- Public-domain confidence can vary by jurisdiction and edition. One public web copy should not become a global paid-book rights claim.
- Creative Commons assets can be powerful, but noncommercial, no-derivatives, share-alike, and attribution duties can conflict with paid books or adapted covers.
- AI-generated images can look original but still need provenance, disclosure basis, customer-experience review, and rights-risk handling.
- Too much portal transparency can expose internal legal uncertainty. Clients need safe decisions and action requests, not raw rights analysis.

## Current Review State

This model strengthens the existing V1 approval packet by making the rights, asset, and contributor ledger explicit. It does not change the recommended V1 posture:

- Internal PiB production studio.
- KDP and Google Play Books manual handoff first.
- Package QA and portal proof only after reviewed evidence.
- Hermes can assist with inventories and warnings, not rights decisions.
- No runtime ledger, UI, API, Firestore schema, Hermes dispatch, direct publishing, or Phase 1 plan until Peet approves or revises the V1 approval record.
