# Book Studio V1 Source Refresh Contract

**Date:** 2026-06-08
**Status:** Design-only evidence contract; not an implementation plan.
**Authoritative dossier:** `docs/superpowers/specs/2026-06-07-book-studio-research-dossier.md`
**Decision packet:** `docs/superpowers/specs/2026-06-08-book-studio-v1-approval-packet.md`
**Execution report run sheet:** `docs/superpowers/specs/2026-06-08-book-studio-v1-source-refresh-execution-report.md`
**Publishing and analytics model:** `docs/superpowers/specs/2026-06-08-book-studio-v1-publishing-analytics-model.md`
**Book family gate catalog:** `docs/superpowers/specs/2026-06-08-book-studio-v1-book-family-gate-catalog.md`
**Wider channel source aid:** `docs/superpowers/specs/2026-06-08-book-studio-v1-wider-channel-adapter-packet.md`
**Jurisdiction/local publisher source aid:** `docs/superpowers/specs/2026-06-08-book-studio-v1-jurisdiction-local-publisher-model.md`
**ai-story non-port aid:** `docs/superpowers/specs/2026-06-08-book-studio-v1-ai-story-non-port-checklist.md`
**Launch/lifecycle source aid:** `docs/superpowers/specs/2026-06-08-book-studio-v1-launch-lifecycle-governance-model.md`
**Market evidence source aid:** `docs/superpowers/specs/2026-06-08-book-studio-v1-market-evidence-model.md`
**Language/translation source aid:** `docs/superpowers/specs/2026-06-08-book-studio-v1-language-translation-edition-model.md`
**Production budget/capacity source aid:** `docs/superpowers/specs/2026-06-08-book-studio-v1-production-budget-capacity-model.md`
**Rights/asset/contributor source aid:** `docs/superpowers/specs/2026-06-08-book-studio-v1-rights-asset-contributor-ledger-model.md`

## Purpose

Book Studio depends on policies, report timing, file rules, series rules, and account-governance rules that can change outside PiB. This contract defines how future Book Studio work should prove that a publishing, analytics, Hermes, or portal claim is based on current evidence.

This file does not create runtime source records, APIs, Firestore collections, route handlers, Hermes skill files, report parsers, publishing integrations, or a Phase 1 task list.

The execution report run sheet converts this contract into a copyable review artifact. Use it after Peet approves or revises V1 and before any Phase 1 implementation plan is written.

## Verified Source Set

These source keys were rechecked on 2026-06-08.

| Source key | Official source | Why it matters to Book Studio V1 | Design consequence |
| --- | --- | --- | --- |
| `kdp-content-ai-ip` | `https://kdp.amazon.com/en_US/help/topic/G200672390` | KDP content guidelines cover AI disclosure, IP responsibility, customer experience, companion-book limits, and public-domain expectations. | Publishing packets need AI-use, rights, companion, public-domain, and customer-experience evidence before KDP handoff. |
| `kdp-ip-rights-faq` | `https://kdp.amazon.com/en_US/help/topic/G200672400` | KDP may request documentation proving publishing rights, format rights, territory rights, prior-publisher reversion, prior-website ownership, or account conflict resolution. | Rights-ledger warnings must gather evidence before manual handoff; a copyright page alone cannot be treated as proof. |
| `kdp-authors-contributors` | `https://kdp.amazon.com/en_US/help/topic/G2BWJN2BY98T5PV2` | KDP contributor and author fields affect search, detail pages, format linking, author pages, series pages, pen names, and update limits. | Contributor credit and metadata evidence must be stable before packet approval. |
| `kdp-public-domain` | `https://kdp.amazon.com/en_US/help/topic/G200743940` | KDP may request public-domain proof and requires differentiated public-domain versions when free versions exist. | Public-domain and companion candidates need jurisdiction/source-edition proof and differentiation before production or packet readiness. |
| `kdp-language-reading-direction` | `https://kdp.amazon.com/en_US/help/topic/GQSHRFWZ5CEY7XAC` | KDP language selection, content language, content-file metadata, primary language, and reading direction must align. | Translated editions need source/target language, primary-language, file metadata, reading-direction, and cover-layout evidence before KDP package review. |
| `kdp-supported-languages` | `https://kdp.amazon.com/en_US/help/topic/G200673300` | KDP language and format support differs across eBook, paperback, hardcover, right-to-left, and PDF upload paths. | Target-language and format support must be checked before claiming translated-edition package readiness. |
| `kdp-kindle-translate-beta` | `https://kdp.amazon.com/en_US/help/topic/GRSNH76FDTJHRX49` | Kindle Translate is an invite-only beta for eligible KDP eBooks and has limits around direct editing, print, audiobook, territory, and series behavior. | Kindle Translate must be modeled as a beta pathway with eligibility evidence, not a general translation engine or print/audio workflow. |
| `kdp-kindle-translate-pricing-reports` | `https://kdp.amazon.com/en_US/help/topic/GS36UMYB3M9FDBSB` | Kindle Translate pricing, royalties, KDP reports, KDP Select, and territory behavior can differ from the source edition. | Translated-edition pricing, KDP Select, reports, and analytics must stay separate from source-edition state. |
| `kdp-keywords-discoverability` | `https://kdp.amazon.com/en_US/help/topic/G201743260` | KDP keyword guidance affects candidate discoverability hypotheses and should discourage vague or irrelevant keyword choices. | Market evidence must treat keywords as relevant hypotheses, not rank promises or stuffing prompts. |
| `kdp-categories-discoverability` | `https://kdp.amazon.com/en_US/help/topic/G200652170` | KDP category guidance affects candidate shelf fit and relevance. | Candidate selection should block misleading categories and preserve relevance over superficial popularity. |
| `kdp-search-results` | `https://kdp.amazon.com/en_US/help/topic/GPYDJ3SECAVVPNVG` | Amazon search results are dynamic and can change. | Research snapshots must not promise first-page placement, stable rank, or future sales. |
| `kdp-metadata-guidelines` | `https://kdp.amazon.com/en_US/help/topic/G201097560` | KDP metadata, cover, age, marketplace, ISBN, and category choices affect customer experience. | Market evidence and publishing packets need honest metadata posture and exact-version review. |
| `kdp-description-guidelines` | `https://kdp.amazon.com/en_US/help/topic/G201189630` | KDP descriptions have content restrictions and should be clear, professional, and not stuffed with keyword phrases. | Candidate and metadata work should block review requests, testimonials, time-sensitive claims, or keyword stuffing in descriptions. |
| `kdp-content-quality` | `https://kdp.amazon.com/en_US/help/topic/G200952510` | KDP content-quality guidance warns against disappointing, misleading, duplicated, too-short, excessively reused, or poor-quality content. | Generic AI-book, duplicate, and low-value candidate ideas should block before production selection. |
| `kdp-low-content` | `https://kdp.amazon.com/en_US/help/topic/GGE5T76TWKA85DJM` | Low-content print has special ISBN, release-date, series, sample, barcode, and distribution constraints. | Low-content projects need their own gate profile; they must not inherit normal nonfiction or series assumptions. |
| `kdp-series` | `https://kdp.amazon.com/en_US/help/topic/GMFKBUS43QQ5AJ5A` | KDP series support exists, but not every internal PiB series is externally eligible. | Internal series state must stay separate from external KDP series-page readiness. |
| `kdp-print-options` | `https://kdp.amazon.com/en_US/help/topic/G201834180` | Trim, paper, color, page-count, and cover choices affect print cost, proofing, and file readiness. | Print/workbook projects need print-option evidence before pricing or package approval. |
| `kdp-reports` | `https://kdp.amazon.com/en_US/help/topic/GVTTXHKHVPAPBEDQ` | KDP reports vary by report type, update cadence, timezone, KENP finalization, payment timing, and estimate quality. | Analytics must separate estimated, processed, reportable, payment, KU, and expanded-distribution evidence. |
| `kdp-print-pricing` | `https://kdp.amazon.com/en_US/help/topic/G8BKPU9AGVZSF9QF` | KDP print royalties are affected by printing costs and distribution choices. | Low-content, planner, workbook, and print-led market evidence needs price/margin review before production selection. |
| `kdp-select-promotions` | `https://kdp.amazon.com/en_US/help/topic/G200798990` | KDP Select affects Kindle Unlimited, exclusivity posture, and eligibility for KDP ebook promotions. | Launch decisions need enrollment/exclusivity evidence before recommending KDP Select-dependent promotions. |
| `kdp-free-book-promotion` | `https://kdp.amazon.com/en_US/help/topic/G201298240` | Free Book Promotions are KDP Select-only, Kindle ebook-only, time-windowed, and royalty-sensitive. | "Make it free" must be modeled as a source-checked promotion decision, not a generic price action. |
| `kdp-merchandising-reviews` | `https://kdp.amazon.com/en_US/help/topic/G200673650` | KDP merchandising guidance warns that advance-reader-copy reviews must follow Amazon review rules and cannot be required or influenced. | Review requests need compliance review and cannot be automated by Hermes or the app. |
| `kdp-customer-reviews` | `https://kdp.amazon.com/en_US/help/topic/G202101910` | Amazon Community manages review checks, missing reviews, violations, and cross-version/cross-market review behavior. | Book Studio cannot promise review visibility, removal, sharing, or transfer outcomes. |
| `kdp-price-book` | `https://kdp.amazon.com/en_US/help/topic/G200641280` | KDP pricing depends on royalty option, marketplace, print cost, tax, fixed price laws, and update workflow. | Price changes need human approval, margin/territory evidence, and external action evidence. |
| `kdp-digital-book-pricing` | `https://kdp.amazon.com/en_US/help/topic/G200634500` | KDP eBook royalty options, delivery costs, territories, VAT, promotional pricing, and price matching affect margin. | EBook budget review must separate 35%/70% royalty, territory, file-size/delivery-cost, and price-matching warnings. |
| `kdp-paperback-printing-cost` | `https://kdp.amazon.com/en_US/help/topic/G201834340` | KDP paperback printing cost varies by marketplace, trim, page count, ink, and paper, and affects minimum list price. | Print-led projects need current print-cost evidence before production start, package QA, or margin approval. |
| `kdp-proof-author-copy-cost` | `https://kdp.amazon.com/en_US/help/topic/G2MYNEKHT443C2H2` | Proof and author copy costs use the selected print cost and marketplace. | Proof budget should be explicit for print-led production and cannot be hidden inside generic production effort. |
| `kdp-proof-author-copy-shipping` | `https://kdp.amazon.com/en_US/help/topic/GG6GRS7TKXVG6AGW` | Proof and author copy shipping has no direct formula and depends on checkout, destination, speed, site, weight, and size. | Shipping cost remains estimate/warning until checkout evidence exists. |
| `kdp-book-status-update-unpublish` | `https://kdp.amazon.com/en_US/help/topic/G200627450`, `https://kdp.amazon.com/en_US/help/topic/GBMC3A6JNGW9DU7X`, `https://kdp.amazon.com/en_US/help/topic/G4QJH4ENN4FZRFMP` | KDP status, update, blocked, delete, archive, unpublish, and new-edition behavior differs by state and format. | Lifecycle records need exact external status evidence and careful wording for update, blocked, retired, and unpublished states. |
| `google-program-policies` | `https://support.google.com/books/partner/answer/166501?hl=en` | Google policies define accepted digital file types, reports, refunds, content rules, currency handling, DRM/printing expectations, and client-services requirements. | Google packets need file, rights, DRM/print, price/currency, refund, and account-authority evidence. |
| `google-sell-books` | `https://support.google.com/books/partner/answer/1079107?hl=en` | Google Play Books selling depends on sale countries, file formats, DRM/list-price settings, previews, and revenue-share behavior. | KDP viability must not be treated as Google viability in candidate or price review. |
| `google-metadata` | `https://support.google.com/books/partner/answer/3237055?hl=en` | Google metadata affects discoverability and requires relevant title, genre, and identifier information. | Candidate evidence should keep Google genres and metadata separate from KDP category/keyword assumptions. |
| `google-isbns-identifiers` | `https://support.google.com/books/partner/answer/3431108?hl=en` | Google can assign GGKEY identifiers, validates ISBNs, and treats print/eBook identifiers and reports carefully. | Translated editions need explicit identifier or GGKEY planning; source identifiers should not be reused blindly. |
| `google-content-policies` | `https://support.google.com/books/partner/answer/1067634?hl=en` | Google content policies warn against spam, misleading or disappointing content, confusing metadata, duplicate public-domain content, and poor file quality. | Market evidence should block misleading, duplicate, or low-quality candidate ideas before production. |
| `creative-commons-licenses` | `https://creativecommons.org/cc-licenses/` | Creative Commons licenses can allow reuse, but attribution, share-alike, no-derivatives, and noncommercial terms can change whether a paid/adapted book asset is usable. | Open-licensed assets need license-type evidence, attribution, derivative, commercial, and share-alike review before package or marketing use. |
| `google-add-book` | `https://support.google.com/books/partner/answer/9261664?hl=en` | Google single-book setup uses Book Catalog, templates, ISBN/EAN or GGKEY, book info, genres, contributors, series, and settings. | Google packet readiness must map PiB metadata to the Partner Center entry fields rather than reuse KDP fields blindly. |
| `google-series` | `https://support.google.com/books/partner/answer/11069638?hl=en` | Google series requires ordered titles, relationship type, whole-number series numbering, consistent naming, genre behavior, and series catalog workflows. | Series continuity and numbering checks must be channel-specific and not inferred from PiB's internal volume plan alone. |
| `google-reports` | `https://support.google.com/books/partner/answer/9266485?hl=en` | Google report availability and fields differ across earnings, sales summary, transactions, and preview traffic, with Pacific-time reporting and possible missing values. | Google analytics must preserve report type, period, timezone, missing-value state, refunds, and preview-vs-sales separation. |
| `google-service-provider` | `https://support.google.com/books/partner/answer/3323299?hl=en` | Google distinguishes service-provider access, client consent, payments/report access, collection codes, account participation, and currently states that applications for a Google Books Client Service Agreement are not accepted. | Book Studio cannot assume PiB can become a new Google service provider, manage client Google accounts, or pull reports without explicit account authority evidence and an already-valid access model. |
| `google-promotions-overview` | `https://support.google.com/books/partner/answer/11098571?hl=en` | Google promotion types include promotional pricing, promo codes, series bundles, and series subscriptions with eligibility differences. | Google launch planning must separate promotion type, country availability, account access, and series dependency. |
| `google-promotional-pricing` | `https://support.google.com/books/partner/answer/4566728?hl=en` | Google promotional pricing uses start/end dates, country/currency rows, availability requirements, and overlap behavior. | Promotional price tasks need row-level evidence and should not be inferred from normal list price. |
| `google-promo-codes` | `https://support.google.com/books/partner/answer/9827742?hl=en` | Google promo codes include campaign limits, country and revenue-split constraints, code terms, redemption behavior, and report caveats. | Promo code distribution needs reviewed terms and analytics separation between redemptions, sales, and earnings. |
| `google-book-prices` | `https://support.google.com/books/partner/answer/3238849?hl=en` | Google prices depend on currency, country, tax, effective dates, fixed-price-law settings, and account payment setup. | Google price tasks need separate evidence from KDP price tasks. |
| `google-revenue-split` | `https://support.google.com/books/partner/answer/9331459?hl=en` | Google revenue split can differ by terms acceptance and country. | Google margin and budget review must cite the account/country revenue-split evidence rather than assume a universal percentage. |
| `ftc-reviews-endorsements` | `https://www.ftc.gov/business-guidance/advertising-marketing/endorsements-influencers-reviews`, `https://www.ftc.gov/business-guidance/resources/ftcs-endorsement-guides` | Review and endorsement practices can be deceptive when incentives, material connections, selective solicitation, or review suppression distort the picture. | Book Studio review outreach stays blocked in V1; review-compliance tasks must preserve disclosure and non-selective solicitation rules. |
| `ai-story-head` | `https://github.com/PMStander/ai-story` at `11ef473c94f977b1dbc487f8645c4711728b6095` | The prior project remains a learning source for wizard intake, story/series flow, and KDP-oriented packaging expectations. | Treat `ai-story` as design evidence only; do not use it as a runtime dependency or migration target without a separate approval decision. |

Wider-channel source keys for Apple Books, Kobo Writing Life, Draft2Digital, IngramSpark, ACX, KDP Virtual Voice, ISBN.org, and W3C EPUBCheck are separated in the wider channel adapter packet. They are future-compatibility evidence only and do not expand V1 beyond KDP and Google Play Books.

Local publisher source keys for South African legal deposit, CIPC copyright posture, ISBN publisher identity, and South African ISBN workflow are separated in the jurisdiction/local publisher packet. They are local-obligation evidence only and do not change V1's KDP/Google manual-handoff channel focus.

Launch/lifecycle source keys for KDP Select, KDP promotions, KDP reviews, KDP pricing/status/update/unpublish, Google promotions/prices, and FTC endorsement/review guidance are separated in the launch/lifecycle packet. They govern post-publication action design only and do not approve automated review outreach, price changes, public sends, ad spend, or store mutations.

The book-family gate catalog refreshed the same KDP/Google source cluster on 2026-06-08 and added a profile-level mapping for nonfiction/reference, narrative, activity/workbook, low-content, children/visual, cookbook/photo/portfolio, public-domain/companion, audiobook, and series overlay decisions. It is a review aid, not a source of permanent policy truth.

The market evidence model adds candidate-selection source keys for KDP keywords, categories, search behavior, metadata, descriptions, content quality, print pricing, and Google selling, metadata, and content policy. These keys govern whether a book idea can become production-selectable; they do not create sales forecasts, rank promises, market scraping, or bestseller claims.

The language/translation model adds translated-edition source keys for KDP language and reading direction, KDP supported languages, Kindle Translate beta, Kindle Translate pricing/reports, Google primary language metadata, Google add-book flow, Google identifiers, and Google content quality. These keys govern source/target-language evidence, AI translation disclosure, target-language quality, translated-edition metadata, identifiers, pricing, channel support, and analytics separation.

The production budget and capacity model adds budget source keys for KDP price, digital pricing, paperback printing cost, proof/author copy cost, proof/author copy shipping, KDP reports, Google book prices, Google revenue split, and Google reports. These keys govern production budget, proof cost, human/model capacity, channel economics, break-even posture, launch-spend separation, cost recovery, and analytics confidence.

The rights, asset, and contributor ledger model adds source keys for KDP publishing-rights documentation, KDP contributor metadata, KDP public-domain proof/differentiation, Google content-policy handling, and Creative Commons license type review. Asset-provider license terms remain per-asset evidence, not permanent global policy truth.

The `ai-story` non-port checklist records the planning-time rule for using the prior project: recheck `ai-story-head`, decide whether each reused concept is kept, rewritten, or rejected, and never treat `ai-story` behavior as publishing-policy, legal, local publisher, or analytics evidence.

## 2026-06-08 Live Spot-Check Addendum

A live official-source spot check on 2026-06-08 did not change the recommended V1 posture, but it tightened the account-authority rule:

- KDP still separates AI-generated content from AI-assisted content and requires disclosure for AI-generated text, images, or translations when publishing or republishing.
- KDP still requires language selection, book language, and content-file metadata language to match, with primary-language selection for multi-language books and reading-direction evidence where direction applies.
- KDP supported-language and file-format rules still require target-language and format review before translated-edition package readiness.
- Kindle Translate remains an invite-only beta pathway for eligible KDP eBooks, not a general print, audiobook, or editable translation engine.
- KDP low-content books still need their own gate profile: they are not eligible for free KDP ISBNs and are not eligible for creating a KDP series.
- KDP keyword, category, search, metadata, description, and content-quality guidance still supports a relevance-and-customer-experience market gate rather than rank promises or keyword stuffing.
- KDP reports still require confidence separation: dashboard/order/KENP/payment/update timing differs by report, format, marketplace, and settlement period.
- Google Play Books still needs channel-specific metadata, file processing, pricing, and review/publish checks instead of a reused KDP packet.
- Google Play Books still treats language as primary book metadata and identifiers as edition-sensitive, so translated editions need their own Google metadata and identifier plan.
- Google Play Books metadata and content-policy pages still support separate Google genre, metadata, content-quality, and duplicate-risk review before candidate selection or packet readiness.
- Google Play Books series numbering still needs channel-specific validation: series names must match and ordered series numbers must be whole numbers without skipped or repeated values.
- Google Play Books reports still need timezone and report-type separation: earnings, sales, transactions, refunds, and preview traffic cannot become one unqualified revenue metric.
- Google's service-provider page currently says new Google Books Client Service Agreement applications are not accepted. Treat this as a hard planning constraint: client-owned Google workflows should start from `client_owned_manual_handoff` or an already-approved access model, not an assumption that PiB can obtain new service-provider status during Phase 1.

## Evidence Freshness Rules

Policy-sensitive claims need source freshness before they can affect a reviewed state.

| Claim type | Freshness rule | Stale-source result |
| --- | --- | --- |
| KDP upload readiness | Recheck KDP content, metadata, format, print, low-content, series, and report pages used by the packet within 14 days of manual handoff. | Packet cannot be marked manual-handoff ready. |
| Google upload readiness | Recheck Google add-book, program policy, file, series, payment/report, and service-provider pages used by the packet within 14 days of manual handoff. | Packet remains internal-reviewable or blocked. |
| AI disclosure | Recheck KDP AI/content guidance and any Google AI/content guidance before answering channel disclosure questions. | AI disclosure state becomes "needs policy refresh". |
| Language/translation or translated edition | Recheck KDP language/reading-direction, supported-language, Kindle Translate, KDP AI/content, Google metadata, Google add-book, Google identifier, and Google content-policy sources before translation production, package QA, portal proof, manual handoff, or translated-edition analytics promotion. | Translated edition remains evidence-collecting, internal-reviewable, or blocked; no package, portal, manual-handoff, or analytics-ready claim is allowed. |
| Low-content or activity print | Recheck KDP low-content and print-option pages before approving ISBN, barcode, sample, expanded-distribution, series, trim, page-count, and margin assumptions. | Print package cannot be approved. |
| Series eligibility | Recheck KDP and Google series guidance before external series-page or bundle claims. | Only internal PiB series wording is allowed. |
| Google DRM/printable activity content | Recheck Google program policies before uploading coloring, puzzle, cut-pattern, workbook, or other physical-page-dependent content. | Google packet must warn or block. |
| Account authority | Recheck Google service-provider and KDP account/security guidance before claiming PiB can manage account, payment, report, or upload access. | Account state becomes "authority unverified". |
| Local publisher readiness | Recheck applicable legal-deposit, ISBN/imprint, copyright, contributor, and publisher-jurisdiction sources before claiming local compliance or local publisher readiness. | Local publisher state becomes "evidence needed" or "source refresh required". |
| Market evidence or production selection | Recheck KDP/Google keywords, categories/genres, metadata, search behavior, content-quality, pricing, and relevant book-family sources before moving a candidate to production-selectable. | Candidate remains evidence-collecting or blocked; no Book Brief, production, sales forecast, rank promise, or client claim is allowed. |
| Production budget or capacity approval | Recheck KDP price, digital pricing, print/proof cost, proof shipping, KDP reports, Google price, Google revenue split, Google reports, and any relevant book-family sources before production start, Hermes/model spend, proof orders, client production promises, or launch-spend proposals. | Candidate remains rough-sizing, budget-reviewable, accepted-warning, or blocked; no production-started, proof-ordered, portal-promised, or launch-budget claim is allowed. |
| Rights, asset, or contributor approval | Recheck KDP content/IP, KDP publishing-rights FAQ, KDP contributor, KDP public-domain, Google content-policy, Creative Commons, and per-asset provider-license evidence before production start, package QA, portal proof, manual handoff, launch copy, or analytics promotion depends on that evidence. | Dependent state remains evidence-collecting, reviewable-with-warning, or blocked; no package, portal, public, or handoff claim is allowed for the affected asset/contributor scope. |
| Analytics summary | Recheck channel report timing and field definitions before promoting revenue, order, KENP, payment, refund, preview, or currency statements to the portal. | Summary can stay internal but not client-promoted. |
| Launch or promotion action | Recheck KDP/Google promotion, price, review, and account-access sources before approving any external launch, promotion, price, or public-copy action. | Launch packet remains internal-reviewable or blocked. |
| Review or endorsement posture | Recheck Amazon review guidance and FTC review/endorsement guidance before approving any review-request wording, incentive posture, testimonial use, or review-monitoring claim. | Review outreach remains blocked and no client/public send is allowed. |
| Lifecycle revision, update, or unpublish claim | Recheck KDP status/update/unpublish or Google channel-status evidence before claiming a book was updated, retired, unpublished, blocked, or republished. | Lifecycle state stays "external evidence needed" or "source refresh required". |

## Source Evidence Contract

Every future Book Studio source-backed decision should carry this shape, whether implemented as notes, records, or review artifacts after approval:

```yaml
sourceEvidence:
  key: kdp-content-ai-ip
  url: https://kdp.amazon.com/en_US/help/topic/G200672390
  checkedAt: "2026-06-08T00:00:00+02:00"
  checkedBy: pib-admin-or-hermes-reviewer
  appliesTo:
    - ai_disclosure
    - rights_review
    - kdp_packet_readiness
  summary: current design implication in PiB terms
  confidence: official_source
  staleAfterDays: 14
  staleAction: block_packet_ready_or_client_promotion
```

The exact storage shape remains unapproved. The contract is the evidence expectation that future planning should preserve.

## Channel-Specific Stale Blockers

Stale source evidence should block only the dependent claim.

| Dependent claim | Block if stale | Still allowed |
| --- | --- | --- |
| KDP manual handoff | KDP content, file, print, series, low-content, pricing, or reports source used by that packet. | Internal drafting, research, and packet review. |
| Google manual handoff | Google add-book, program policy, series, report, or service-provider source used by that packet. | Internal drafting, research, and KDP review if KDP evidence is fresh. |
| Client-safe publishing packet | Any source behind the promoted packet summary. | Internal packet work and safe "pending source refresh" blocker. |
| Local publisher claim | South African legal-deposit, ISBN/imprint, copyright, contributor, or jurisdiction evidence behind that claim. | KDP/Google packet work can continue if its channel evidence is fresh and wording does not imply local compliance. |
| Translated-edition claim | KDP/Google source behind language, reading direction, supported format, Kindle Translate eligibility, AI translation disclosure, Google primary language, identifier, add-book flow, or content quality. | Source-edition drafting and internal translation evidence collection; no translated-edition package QA, portal proof, manual handoff, or analytics promotion. |
| Market candidate selection | KDP/Google source behind keywords, categories/genres, metadata, search, content-quality, price/margin, or book-family fit. | Internal idea capture and Research evidence collection; no Book Brief or production-selected state. |
| Production budget/capacity approval | KDP/Google source behind price, royalty, delivery cost, print cost, proof/author copy cost, proof shipping, revenue split, report timing, refunds, currency, or book-family cost assumptions. | Market evidence, internal rough sizing, and scope narrowing; no production start, proof order, Hermes/model spend, launch-spend proposal, or client production promise. |
| Rights/asset/contributor approval | KDP/Google/Creative Commons/per-asset source behind ownership, license scope, AI provenance, public-domain/open-license basis, contributor credit, assignment/license, territory, format, channel, or client-owned-asset approval. | Internal drafting, evidence collection, and safe blocker wording; no dependent production start, package QA, portal proof, launch copy, analytics promotion, or manual handoff. |
| Analytics promotion | Any report-definition source behind the promoted metric. | Internal import, reconciliation task, and no-revenue portal state. |
| Launch/lifecycle action | Any review, promotion, price, public-copy, status, update, or unpublish source behind that action. | Internal launch planning and safe "source refresh required" blocker. |
| Hermes skill output | Source key required by the skill's manifest is stale or missing. | Skill can ask for refresh task creation, but not produce readiness output. |
| `ai-story` concept reuse | The referenced `ai-story-head` commit was not rechecked, or the future plan does not classify the concept as keep/rewrite/reject. | General product discussion can continue, but the concept cannot become a Phase 1 planning dependency. |

## Hermes Source Behavior

Hermes skills should be able to help with source governance, but not override it.

Allowed:

- Summarize official-source implications in PiB language.
- Compare current packet assumptions to the source keys.
- Create source-refresh tasks.
- Mark a recommendation as stale, unsupported, or blocked.
- Draft reviewer questions where a source creates ambiguity.

Forbidden:

- Claim a source is current without a checked timestamp.
- Use unofficial blog/forum content as authoritative policy.
- Treat `ai-story` behavior as a publishing-policy source.
- Fill upload, disclosure, account, or analytics answers from model memory.
- Translate final publication text or mark translated-edition readiness from model memory without source/target evidence.
- Start model-backed production work, approve budget, or mark capacity ready from model memory without budget and source evidence.
- Convert a stale-source warning into a pass decision.

## Devil's Advocate

- A source register can become a checkbox. The real value is blocking the specific unsafe claim when the source is stale.
- Official pages can change without a visible version number. The contract should treat checked date and source URL as minimum evidence, not permanent truth.
- Rechecking every source for every internal draft would slow the module down. Freshness gates should apply only when a claim moves toward manual handoff, client promotion, analytics promotion, or Hermes readiness.
- `ai-story` is useful evidence of prior product thinking, but importing its assumptions directly would bypass PiB's multi-org, portal, Projects, Research, Client Documents, and Hermes governance constraints.
- If future implementation stores source evidence but never exposes stale blockers in the admin workflow, operators will still make upload and analytics decisions from memory.

## Current Review State

This contract strengthens the existing V1 approval packet by making source freshness explicit. It does not change the recommended V1 posture:

- Internal PiB production studio.
- KDP and Google Play Books manual handoff first.
- Controlled Hermes skill readiness.
- Manual analytics imports with confidence labels.
- No runtime implementation or Phase 1 plan until Peet approves or revises the V1 approval record.
