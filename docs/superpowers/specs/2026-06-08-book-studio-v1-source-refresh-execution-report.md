# Book Studio V1 Source Refresh Execution Report

**Date:** 2026-06-08
**Status:** Source-refresh report template and run sheet only; not an implementation plan.
**Source refresh contract:** `docs/superpowers/specs/2026-06-08-book-studio-v1-source-refresh-contract.md`
**Approval decision form:** `docs/superpowers/specs/2026-06-08-book-studio-v1-approval-decision-form.md`
**Approval packet:** `docs/superpowers/specs/2026-06-08-book-studio-v1-approval-packet.md`
**Decision index:** `docs/superpowers/specs/2026-06-08-book-studio-v1-decision-index.md`
**Revision impact matrix:** `docs/superpowers/specs/2026-06-08-book-studio-v1-approval-revision-impact-matrix.md`
**Jurisdiction/local publisher model:** `docs/superpowers/specs/2026-06-08-book-studio-v1-jurisdiction-local-publisher-model.md`
**Wider channel adapter packet:** `docs/superpowers/specs/2026-06-08-book-studio-v1-wider-channel-adapter-packet.md`
**ai-story non-port checklist:** `docs/superpowers/specs/2026-06-08-book-studio-v1-ai-story-non-port-checklist.md`
**Launch/lifecycle governance model:** `docs/superpowers/specs/2026-06-08-book-studio-v1-launch-lifecycle-governance-model.md`

## Purpose

The approval decision form requires source refresh before `planningAllowed` can become true. The source refresh contract defines the rule. This report gives the reviewer a copyable execution artifact for proving whether the rule was actually run.

This report does not recheck sources by itself. It does not create runtime source records, APIs, Firestore collections, route handlers, UI, Hermes skill files, direct publishing integrations, analytics automation, or a Phase 1 task list.

## Use When

Use this report only after Peet has approved or revised the Book Studio V1 approval record and before a Phase 1 implementation plan is written.

Use it again before planning if a revision expands a source-sensitive approval field, including first channels, first pilot set, production readiness, local publisher scope, analytics scope, ownership model, or Hermes first scope.

Do not use this report to bypass a blocker. If an official source is unavailable or contradicts the approval packet, the result is a planning blocker for the dependent claim.

## Copyable Source Refresh Report

```yaml
bookStudioV1SourceRefreshReport:
  reportId: book-studio-v1-source-refresh-2026-06-08
  runAt: "not_recorded_yet"
  runBy: pib-admin-or-hermes-reviewer
  decisionRecordSource: docs/superpowers/specs/2026-06-08-book-studio-v1-approval-decision-form.md
  planningTargetCommit:
    required: true
    rule: "Use the current origin/development commit at the time this source refresh is run."
  approvalDecision:
    decisionId: book-studio-v1-2026-06-08
    decision: not_recorded_yet
    changedApprovalFields: []
  refreshedFor:
    - phase1_planning
  requiredSourceGroups:
    kdp_policy_and_packet_requirements:
      required: true
      completed: false
      sources:
        - kdp-content-ai-ip
        - kdp-low-content
        - kdp-series
        - kdp-print-options
        - kdp-reports
    google_play_books_policy_and_packet_requirements:
      required: true
      completed: false
      sources:
        - google-program-policies
        - google-add-book
        - google-series
        - google-reports
        - google-service-provider
    local_publisher_and_jurisdiction_sources:
      required: true
      completed: false
      sources:
        - south-africa-legal-deposit-faq
        - south-africa-legal-deposit-act
        - south-africa-copyright-cipc
        - south-africa-copyright-cipc-faq
        - isbn-global-agency
        - isbn-publisher-identity
        - south-africa-isbn-workflow
    ai_story_source_baseline:
      required: true
      completed: false
      sources:
        - ai-story-head
    launch_lifecycle_sources:
      required: true
      completed: false
      sources:
        - kdp-select-promotions
        - kdp-free-book-promotion
        - kdp-merchandising-reviews
        - kdp-customer-reviews
        - kdp-price-book
        - kdp-book-status-update-unpublish
        - google-promotions-overview
        - google-promotional-pricing
        - google-promo-codes
        - google-book-prices
        - ftc-reviews-endorsements
    wider_channel_revision_sources:
      required: false
      requiredWhen: "Only when the approval decision adds Apple, Kobo, Draft2Digital, IngramSpark, audiobook, owned ISBN, or EPUB validation to first-scope planning."
      completed: false
      sources:
        - apple-books-web-publishing
        - kobo-writing-life-faq
        - draft2digital-faq
        - ingramspark-faq
        - acx-author-workflow
        - kdp-virtual-voice
        - isbn-publisher-identity
        - epubcheck
  sourceResults:
    - key: kdp-content-ai-ip
      url: https://kdp.amazon.com/en_US/help/topic/G200672390
      officialSource: true
      checkedAt: "not_recorded_yet"
      result: not_recorded_yet
      allowedResults:
        - unchanged
        - changed_non_blocking
        - changed_blocking
        - unavailable
      evidenceSummary: not_recorded_yet
      affectedApprovalFields: []
      affectedDocsToRevise: []
      planningImpact: planning_blocked_until_result_recorded
    - key: kdp-low-content
      url: https://kdp.amazon.com/en_US/help/topic/GGE5T76TWKA85DJM
      officialSource: true
      checkedAt: "not_recorded_yet"
      result: not_recorded_yet
      evidenceSummary: not_recorded_yet
      affectedApprovalFields: []
      affectedDocsToRevise: []
      planningImpact: planning_blocked_until_result_recorded
    - key: kdp-series
      url: https://kdp.amazon.com/en_US/help/topic/GMFKBUS43QQ5AJ5A
      officialSource: true
      checkedAt: "not_recorded_yet"
      result: not_recorded_yet
      evidenceSummary: not_recorded_yet
      affectedApprovalFields: []
      affectedDocsToRevise: []
      planningImpact: planning_blocked_until_result_recorded
    - key: kdp-print-options
      url: https://kdp.amazon.com/en_US/help/topic/G201834180
      officialSource: true
      checkedAt: "not_recorded_yet"
      result: not_recorded_yet
      evidenceSummary: not_recorded_yet
      affectedApprovalFields: []
      affectedDocsToRevise: []
      planningImpact: planning_blocked_until_result_recorded
    - key: kdp-reports
      url: https://kdp.amazon.com/en_US/help/topic/GVTTXHKHVPAPBEDQ
      officialSource: true
      checkedAt: "not_recorded_yet"
      result: not_recorded_yet
      evidenceSummary: not_recorded_yet
      affectedApprovalFields: []
      affectedDocsToRevise: []
      planningImpact: planning_blocked_until_result_recorded
    - key: google-program-policies
      url: https://support.google.com/books/partner/answer/166501?hl=en
      officialSource: true
      checkedAt: "not_recorded_yet"
      result: not_recorded_yet
      evidenceSummary: not_recorded_yet
      affectedApprovalFields: []
      affectedDocsToRevise: []
      planningImpact: planning_blocked_until_result_recorded
    - key: google-add-book
      url: https://support.google.com/books/partner/answer/9261664?hl=en
      officialSource: true
      checkedAt: "not_recorded_yet"
      result: not_recorded_yet
      evidenceSummary: not_recorded_yet
      affectedApprovalFields: []
      affectedDocsToRevise: []
      planningImpact: planning_blocked_until_result_recorded
    - key: google-series
      url: https://support.google.com/books/partner/answer/11069638?hl=en
      officialSource: true
      checkedAt: "not_recorded_yet"
      result: not_recorded_yet
      evidenceSummary: not_recorded_yet
      affectedApprovalFields: []
      affectedDocsToRevise: []
      planningImpact: planning_blocked_until_result_recorded
    - key: google-reports
      url: https://support.google.com/books/partner/answer/9266485?hl=en
      officialSource: true
      checkedAt: "not_recorded_yet"
      result: not_recorded_yet
      evidenceSummary: not_recorded_yet
      affectedApprovalFields: []
      affectedDocsToRevise: []
      planningImpact: planning_blocked_until_result_recorded
    - key: google-service-provider
      url: https://support.google.com/books/partner/answer/3323299?hl=en
      officialSource: true
      checkedAt: "not_recorded_yet"
      result: not_recorded_yet
      evidenceSummary: not_recorded_yet
      affectedApprovalFields: []
      affectedDocsToRevise: []
      planningImpact: planning_blocked_until_result_recorded
    - key: kdp-select-promotions
      url: https://kdp.amazon.com/en_US/help/topic/G200798990
      officialSource: true
      checkedAt: "not_recorded_yet"
      result: not_recorded_yet
      evidenceSummary: not_recorded_yet
      affectedApprovalFields: []
      affectedDocsToRevise: []
      planningImpact: planning_blocked_until_result_recorded
    - key: kdp-free-book-promotion
      url: https://kdp.amazon.com/en_US/help/topic/G201298240
      officialSource: true
      checkedAt: "not_recorded_yet"
      result: not_recorded_yet
      evidenceSummary: not_recorded_yet
      affectedApprovalFields: []
      affectedDocsToRevise: []
      planningImpact: planning_blocked_until_result_recorded
    - key: kdp-merchandising-reviews
      url: https://kdp.amazon.com/en_US/help/topic/G200673650
      officialSource: true
      checkedAt: "not_recorded_yet"
      result: not_recorded_yet
      evidenceSummary: not_recorded_yet
      affectedApprovalFields: []
      affectedDocsToRevise: []
      planningImpact: planning_blocked_until_result_recorded
    - key: kdp-customer-reviews
      url: https://kdp.amazon.com/en_US/help/topic/G202101910
      officialSource: true
      checkedAt: "not_recorded_yet"
      result: not_recorded_yet
      evidenceSummary: not_recorded_yet
      affectedApprovalFields: []
      affectedDocsToRevise: []
      planningImpact: planning_blocked_until_result_recorded
    - key: kdp-price-book
      url: https://kdp.amazon.com/en_US/help/topic/G200641280
      officialSource: true
      checkedAt: "not_recorded_yet"
      result: not_recorded_yet
      evidenceSummary: not_recorded_yet
      affectedApprovalFields: []
      affectedDocsToRevise: []
      planningImpact: planning_blocked_until_result_recorded
    - key: kdp-book-status-update-unpublish
      urls:
        - https://kdp.amazon.com/en_US/help/topic/G200627450
        - https://kdp.amazon.com/en_US/help/topic/GBMC3A6JNGW9DU7X
        - https://kdp.amazon.com/en_US/help/topic/G4QJH4ENN4FZRFMP
      officialSource: true
      checkedAt: "not_recorded_yet"
      result: not_recorded_yet
      evidenceSummary: not_recorded_yet
      affectedApprovalFields: []
      affectedDocsToRevise: []
      planningImpact: planning_blocked_until_result_recorded
    - key: google-promotions-overview
      url: https://support.google.com/books/partner/answer/11098571?hl=en
      officialSource: true
      checkedAt: "not_recorded_yet"
      result: not_recorded_yet
      evidenceSummary: not_recorded_yet
      affectedApprovalFields: []
      affectedDocsToRevise: []
      planningImpact: planning_blocked_until_result_recorded
    - key: google-promotional-pricing
      url: https://support.google.com/books/partner/answer/4566728?hl=en
      officialSource: true
      checkedAt: "not_recorded_yet"
      result: not_recorded_yet
      evidenceSummary: not_recorded_yet
      affectedApprovalFields: []
      affectedDocsToRevise: []
      planningImpact: planning_blocked_until_result_recorded
    - key: google-promo-codes
      url: https://support.google.com/books/partner/answer/9827742?hl=en
      officialSource: true
      checkedAt: "not_recorded_yet"
      result: not_recorded_yet
      evidenceSummary: not_recorded_yet
      affectedApprovalFields: []
      affectedDocsToRevise: []
      planningImpact: planning_blocked_until_result_recorded
    - key: google-book-prices
      url: https://support.google.com/books/partner/answer/3238849?hl=en
      officialSource: true
      checkedAt: "not_recorded_yet"
      result: not_recorded_yet
      evidenceSummary: not_recorded_yet
      affectedApprovalFields: []
      affectedDocsToRevise: []
      planningImpact: planning_blocked_until_result_recorded
    - key: ftc-reviews-endorsements
      urls:
        - https://www.ftc.gov/business-guidance/advertising-marketing/endorsements-influencers-reviews
        - https://www.ftc.gov/business-guidance/resources/ftcs-endorsement-guides
      officialSource: true
      checkedAt: "not_recorded_yet"
      result: not_recorded_yet
      evidenceSummary: not_recorded_yet
      affectedApprovalFields: []
      affectedDocsToRevise: []
      planningImpact: planning_blocked_until_result_recorded
    - key: south-africa-legal-deposit-faq
      url: https://www.nationalarchives.gov.za/node/475
      officialSource: true
      checkedAt: "not_recorded_yet"
      result: not_recorded_yet
      evidenceSummary: not_recorded_yet
      affectedApprovalFields: []
      affectedDocsToRevise: []
      planningImpact: planning_blocked_until_result_recorded
    - key: south-africa-legal-deposit-act
      url: https://www.nationalarchives.gov.za/sites/default/files/Legal%20Deposit%20Act.pdf
      officialSource: true
      checkedAt: "not_recorded_yet"
      result: not_recorded_yet
      evidenceSummary: not_recorded_yet
      affectedApprovalFields: []
      affectedDocsToRevise: []
      planningImpact: planning_blocked_until_result_recorded
    - key: south-africa-copyright-cipc
      url: https://www.cipc.co.za/?page_id=4586
      officialSource: true
      checkedAt: "not_recorded_yet"
      result: not_recorded_yet
      evidenceSummary: not_recorded_yet
      affectedApprovalFields: []
      affectedDocsToRevise: []
      planningImpact: planning_blocked_until_result_recorded
    - key: south-africa-copyright-cipc-faq
      url: https://www.cipc.co.za/?page_id=4160
      officialSource: true
      checkedAt: "not_recorded_yet"
      result: not_recorded_yet
      evidenceSummary: not_recorded_yet
      affectedApprovalFields: []
      affectedDocsToRevise: []
      planningImpact: planning_blocked_until_result_recorded
    - key: isbn-global-agency
      url: https://www.isbn-international.org/
      officialSource: true
      checkedAt: "not_recorded_yet"
      result: not_recorded_yet
      evidenceSummary: not_recorded_yet
      affectedApprovalFields: []
      affectedDocsToRevise: []
      planningImpact: planning_blocked_until_result_recorded
    - key: isbn-publisher-identity
      url: https://www.isbn.org/about_ISBN_standard
      officialSource: true
      checkedAt: "not_recorded_yet"
      result: not_recorded_yet
      evidenceSummary: not_recorded_yet
      affectedApprovalFields: []
      affectedDocsToRevise: []
      planningImpact: planning_blocked_until_result_recorded
    - key: south-africa-isbn-workflow
      url: https://publishsa.co.za/isbn-numbers/
      officialSource: true
      checkedAt: "not_recorded_yet"
      result: not_recorded_yet
      evidenceSummary: not_recorded_yet
      affectedApprovalFields: []
      affectedDocsToRevise: []
      planningImpact: planning_blocked_until_result_recorded
    - key: ai-story-head
      url: https://github.com/PMStander/ai-story
      officialSource: true
      checkedAt: "not_recorded_yet"
      result: not_recorded_yet
      evidenceSummary: not_recorded_yet
      affectedApprovalFields: []
      affectedDocsToRevise: []
      planningImpact: planning_blocked_until_result_recorded
  sourceRefreshCompleted: false
  planningAllowedAfterRefresh: false
  blockersRemaining:
    - source_refresh_not_run
  completionStatement: "Set sourceRefreshRequiredBeforePlanning.completed to true only when every required source group is completed, every required source has a result, no required result is changed_blocking or unavailable for the planning claim, revision docs are updated where needed, and blockersRemaining is empty."
```

## Required Source Groups

The reviewer must check the source groups required by the final decision record. The recommended V1 approval requires all five core groups: KDP, Google Play Books, local publisher/jurisdiction, launch/lifecycle, and `ai-story`.

| Group | Source key | Source to check | Planning claim protected |
| --- | --- | --- | --- |
| KDP | `kdp-content-ai-ip` | `https://kdp.amazon.com/en_US/help/topic/G200672390` | AI disclosure, rights/IP, public-domain, companion-book, and KDP packet safety. |
| KDP | `kdp-low-content` | `https://kdp.amazon.com/en_US/help/topic/GGE5T76TWKA85DJM` | Low-content, ISBN, sample, barcode, distribution, and series assumptions. |
| KDP | `kdp-series` | `https://kdp.amazon.com/en_US/help/topic/GMFKBUS43QQ5AJ5A` | External KDP series eligibility and channel-specific series state. |
| KDP | `kdp-print-options` | `https://kdp.amazon.com/en_US/help/topic/G201834180` | Print format, trim, paper, color, page-count, cover, and cost assumptions. |
| KDP | `kdp-reports` | `https://kdp.amazon.com/en_US/help/topic/GVTTXHKHVPAPBEDQ` | KDP analytics source confidence, timing, KENP, payment, and settlement separation. |
| Google Play Books | `google-program-policies` | `https://support.google.com/books/partner/answer/166501?hl=en` | Google policy, file, price, DRM/print, currency, refund, and account-authority evidence. |
| Google Play Books | `google-add-book` | `https://support.google.com/books/partner/answer/9261664?hl=en` | Google Partner Center metadata and add-book packet fields. |
| Google Play Books | `google-series` | `https://support.google.com/books/partner/answer/11069638?hl=en` | Google series numbering, name matching, order, and catalog workflow. |
| Google Play Books | `google-reports` | `https://support.google.com/books/partner/answer/9266485?hl=en` | Google earnings, sales, transaction, refund, preview, and timezone evidence. |
| Google Play Books | `google-service-provider` | `https://support.google.com/books/partner/answer/3323299?hl=en` | Service-provider, client consent, report/payment access, and account authority assumptions. |
| Launch/lifecycle | `kdp-select-promotions` | `https://kdp.amazon.com/en_US/help/topic/G200798990` | KDP Select, Kindle Unlimited, exclusivity, and promotion eligibility assumptions. |
| Launch/lifecycle | `kdp-free-book-promotion` | `https://kdp.amazon.com/en_US/help/topic/G201298240` | Free Book Promotion eligibility, timing, royalty, rank, and cancellation caveats. |
| Launch/lifecycle | `kdp-merchandising-reviews` | `https://kdp.amazon.com/en_US/help/topic/G200673650` | KDP review request, advance copy, and review-influence guardrails. |
| Launch/lifecycle | `kdp-customer-reviews` | `https://kdp.amazon.com/en_US/help/topic/G202101910` | Customer review visibility, missing-review, violation-report, and review-transfer caveats. |
| Launch/lifecycle | `kdp-price-book` | `https://kdp.amazon.com/en_US/help/topic/G200641280` | KDP price, royalty, tax, fixed-price-law, and price-update assumptions. |
| Launch/lifecycle | `kdp-book-status-update-unpublish` | `https://kdp.amazon.com/en_US/help/topic/G200627450`, `https://kdp.amazon.com/en_US/help/topic/GBMC3A6JNGW9DU7X`, `https://kdp.amazon.com/en_US/help/topic/G4QJH4ENN4FZRFMP` | KDP status, update, blocked, unpublish, archive, delete, and new-edition wording. |
| Launch/lifecycle | `google-promotions-overview` | `https://support.google.com/books/partner/answer/11098571?hl=en` | Google promotion type, country availability, access, and series-promotion assumptions. |
| Launch/lifecycle | `google-promotional-pricing` | `https://support.google.com/books/partner/answer/4566728?hl=en` | Google promotional price date, country/currency, overlap, and CSV-row assumptions. |
| Launch/lifecycle | `google-promo-codes` | `https://support.google.com/books/partner/answer/9827742?hl=en` | Google promo code campaign, country, code-count, terms, redemption, and report caveats. |
| Launch/lifecycle | `google-book-prices` | `https://support.google.com/books/partner/answer/3238849?hl=en` | Google price, tax, currency, effective-date, and fixed-price-law assumptions. |
| Launch/lifecycle | `ftc-reviews-endorsements` | `https://www.ftc.gov/business-guidance/advertising-marketing/endorsements-influencers-reviews`, `https://www.ftc.gov/business-guidance/resources/ftcs-endorsement-guides` | Review, endorsement, incentive, selective-solicitation, and disclosure guardrails. |
| Local publisher | `south-africa-legal-deposit-faq` | `https://www.nationalarchives.gov.za/node/475` | South African legal-deposit trigger and local-publication claim. |
| Local publisher | `south-africa-legal-deposit-act` | `https://www.nationalarchives.gov.za/sites/default/files/Legal%20Deposit%20Act.pdf` | Legal-deposit lane, dispatch timing claim, and publisher definition evidence. |
| Local publisher | `south-africa-copyright-cipc` | `https://www.cipc.co.za/?page_id=4586` | Copyright posture, registration claim, and authorship/provenance wording. |
| Local publisher | `south-africa-copyright-cipc-faq` | `https://www.cipc.co.za/?page_id=4160` | Copyright posture and registration-formality wording. |
| Local publisher | `isbn-global-agency` | `https://www.isbn-international.org/` | ISBN source and official-agency claim. |
| Local publisher | `isbn-publisher-identity` | `https://www.isbn.org/about_ISBN_standard` | Imprint owner, publisher identity, and non-official ISBN warning. |
| Local publisher | `south-africa-isbn-workflow` | `https://publishsa.co.za/isbn-numbers/` | South African ISBN contact path and ISN Agency workflow evidence. |
| ai-story | `ai-story-head` | `https://github.com/PMStander/ai-story` | Prior-project baseline for keep/rewrite/reject planning classification. |

## Revision-Specific Wider Sources

These sources are not required for the recommended KDP/Google first-scope V1. They become required only when the approval decision adds the related channel or claim to first-scope planning.

| Source key | Source to check | Required when |
| --- | --- | --- |
| `apple-books-web-publishing` | `https://authors.apple.com/support/4574-publish-book-from-web` | Apple Books becomes a first-scope channel or EPUB upload readiness is planned. |
| `kobo-writing-life-faq` | `https://www.kobo.com/kobo-writing-life/blog/frequently-asked-questions` | Kobo Writing Life becomes first-scope or Kobo analytics are planned. |
| `draft2digital-faq` | `https://draft2digital.com/faq/` | Draft2Digital or aggregator route-to-market becomes first-scope. |
| `ingramspark-faq` | `https://www.ingramspark.com/faqs` | IngramSpark, wide print, wholesale, returnability, or duplicate-feed checks become first-scope. |
| `acx-author-workflow` | `https://www.acx.com/help/authors-as-narrators/200626860` | Audiobook production or ACX claim/title workflow becomes first-scope. |
| `kdp-virtual-voice` | `https://kdp.amazon.com/en_US/help/topic/G3QRL9HQNF273Q2H` | KDP Virtual Voice or generated-audio workflow becomes first-scope. |
| `epubcheck` | `https://www.w3.org/publishing/epubcheck/` | EPUB validation or Apple/Kobo/D2D EPUB readiness becomes first-scope. |

## Result Semantics

| Result | Meaning | Planning impact |
| --- | --- | --- |
| `unchanged` | The official source still supports the evidence claim recorded in the approval packet or appendix. | Planning may continue for that dependent claim if every other required source passes. |
| `changed_non_blocking` | The source changed or clarified wording, but the V1 approval boundary and dependent claim still hold after the change is recorded. | Update the report summary and affected docs where needed; planning may continue only if no blocker remains. |
| `changed_blocking` | The source changed in a way that invalidates, narrows, or contradicts a planned claim. | `planningAllowedAfterRefresh` stays false for the dependent claim until the affected approval field or evidence doc is revised. |
| `unavailable` | The official source cannot be checked, or the reviewer cannot verify that the source is authoritative. | Treat the dependent claim as blocked. Do not replace the source with model memory or unofficial commentary. |

## Completion Tests

A source refresh report can support `sourceRefreshRequiredBeforePlanning.completed: true` only when all of these checks pass:

1. The report quotes the current `origin/development` commit at the time the refresh is run.
2. The final approval decision record is named and its changed approval fields are copied into the report.
3. Every source group required by the decision record is completed.
4. Every required source has a URL, official-source flag, checked timestamp, result, evidence summary, affected approval fields, affected docs, and planning impact.
5. No required source result is `changed_blocking` or `unavailable` for a claim that appears in the planned Phase 1 scope.
6. Every `changed_non_blocking` result names any affected docs that were updated or explicitly confirms no doc update is needed.
7. Every wider-channel source triggered by an approval revision is checked before the revised channel appears in planning.
8. Local publisher sources remain separate from KDP and Google channel readiness.
9. `ai-story-head` is treated as a prior-project baseline only, with keep/rewrite/reject classification deferred to planning.
10. `blockersRemaining` is empty before `planningAllowedAfterRefresh` can become true.
11. The report still excludes runtime routes, APIs, Firestore collections, UI, module toggles, Hermes runtime dispatch, direct publishing, analytics automation, and a Phase 1 task list.

## Devil's Advocate

- A source refresh report can become a checkbox if the reviewer copies URLs without reading how the claim changed. The evidence summary must say what the source means for Book Studio, not just that the page opened.
- An unavailable source is not neutral. It blocks the dependent claim because the whole point of the gate is to avoid planning from memory.
- Wider-channel revisions can quietly turn a focused KDP/Google plan into a distribution platform. If a revision adds a channel, its account, package, reporting, conflict, and portal-safe evidence must come forward too.
- Local publisher evidence can feel separate from product delivery, but it can invalidate publisher, imprint, copyright, legal-deposit, and ISBN wording just as directly as a KDP or Google policy change.
- `planningAllowedAfterRefresh: true` is a strong claim. It means the source gate supports writing a plan, not that the module or any publishing packet is ready.

## Explicit Exclusions

This report does not create or approve:

- Book Studio runtime routes, APIs, records, React components, or Firestore collections.
- `settings.portalModules.bookStudio` or any module-toggle implementation.
- Admin or portal navigation.
- Runtime Hermes dispatch from PiB.
- Direct KDP, Google Play Books, Apple, Kobo, Draft2Digital, IngramSpark, ACX, Amazon Ads, or review-outreach automation.
- Client self-serve generation.
- Public/productized AI-book SaaS.
- Automated analytics imports or report integrations.
- A Phase 1 implementation task list.

## Current Review State

Book Studio now has a design-only run sheet for clearing or blocking the source-refresh gate. It still requires Peet to approve or revise the V1 decision record, a reviewer to run this report against current official sources, and a separate approval before any Phase 1 implementation plan is written.
