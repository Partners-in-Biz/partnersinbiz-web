# Book Studio V1 Launch And Lifecycle Governance Model

**Date:** 2026-06-08
**Status:** Design-only governance model; not an implementation plan, marketing plan, legal advice, tax advice, accounting advice, or publishing instruction.
**Authoritative approval packet:** `docs/superpowers/specs/2026-06-08-book-studio-v1-approval-packet.md`
**Decision index:** `docs/superpowers/specs/2026-06-08-book-studio-v1-decision-index.md`
**Publishing and analytics model:** `docs/superpowers/specs/2026-06-08-book-studio-v1-publishing-analytics-model.md`
**Source refresh contract:** `docs/superpowers/specs/2026-06-08-book-studio-v1-source-refresh-contract.md`
**Hermes skill contract pack:** `docs/superpowers/specs/2026-06-08-book-studio-v1-hermes-skill-contract-pack.md`
**Portal access model:** `docs/superpowers/specs/2026-06-08-book-studio-v1-portal-access-promotion-model.md`

## Purpose

The publishing and analytics model explains how a reviewed package becomes a KDP or Google Play Books manual handoff and how external reports become trustworthy analytics. This packet covers the next operating surface: what Book Studio should do after a book is submitted or live.

It defines launch, promotion, review, pricing, revision, unpublish, and lifecycle governance without authorizing direct publishing, public sends, review outreach automation, ads, price changes, store mutations, runtime APIs, Firestore records, UI, Hermes runtime dispatch, or a Phase 1 implementation plan.

## Current Official Source Snapshot

These sources were checked on 2026-06-08. They must be refreshed before any launch, promotion, review, pricing, or lifecycle task becomes a Phase 1 implementation claim.

| Source key | Official source | Current implication for Book Studio |
| --- | --- | --- |
| `kdp-select-promotions` | `https://kdp.amazon.com/en_US/help/topic/G200798990` | KDP Select is a 90-day Kindle ebook program that affects Kindle Unlimited and promotion eligibility, so Book Studio must track exclusivity and enrollment windows before any KDP promotion recommendation. |
| `kdp-free-book-promotion` | `https://kdp.amazon.com/en_US/help/topic/G201298240` | Free Book Promotions are KDP Select-only, Kindle ebook-only, limited per 90-day enrollment period, and time-bound, so the module must not treat "make it free" as a general KDP action. |
| `kdp-merchandising-reviews` | `https://kdp.amazon.com/en_US/help/topic/G200673650` | KDP merchandising guidance allows review encouragement only inside Amazon review rules; advance copies cannot require or influence reviews. |
| `kdp-customer-reviews` | `https://kdp.amazon.com/en_US/help/topic/G202101910` | Amazon Community manages customer reviews, missing reviews, violations, cross-market review behavior, and review checks, so Book Studio must not promise review visibility or removal outcomes. |
| `kdp-price-book` | `https://kdp.amazon.com/en_US/help/topic/G200641280` | KDP list price, royalty, marketplace, tax, fixed-price-law, and update workflows are channel-specific; price changes need a reviewer decision and external evidence after the human action. |
| `kdp-book-status-update-unpublish` | `https://kdp.amazon.com/en_US/help/topic/G200627450`, `https://kdp.amazon.com/en_US/help/topic/GBMC3A6JNGW9DU7X`, `https://kdp.amazon.com/en_US/help/topic/G4QJH4ENN4FZRFMP` | KDP has distinct statuses, update states, blocked states, and unpublish behavior; significant changes can require a new edition, and unpublishing does not erase every external trace. |
| `google-promotions-overview` | `https://support.google.com/books/partner/answer/11098571?hl=en` | Google Play Books supports promotion types including promo codes, promotional pricing, and series-based offers where available; each has country, access, and series constraints. |
| `google-promotional-pricing` | `https://support.google.com/books/partner/answer/4566728?hl=en` | Google promotional pricing applies to available-for-sale books, has start/end date behavior, country/currency fields, overlap rules, and CSV options, so Book Studio needs separate evidence per promotion. |
| `google-promo-codes` | `https://support.google.com/books/partner/answer/9827742?hl=en` | Google promo codes have access, country, campaign, code, terms, redemption, and reporting constraints; analytics and earnings timing must stay separate from redemption counts. |
| `google-book-prices` | `https://support.google.com/books/partner/answer/3238849?hl=en` | Google pricing depends on currency, country, tax, effective dates, fixed-price-law settings, and account payment setup; price tasks must not reuse KDP pricing evidence. |
| `ftc-reviews-endorsements` | `https://www.ftc.gov/business-guidance/advertising-marketing/endorsements-influencers-reviews` and `https://www.ftc.gov/business-guidance/resources/ftcs-endorsement-guides` | Review, endorsement, influencer, incentive, and selective-solicitation practices can create deception risk; Book Studio must treat review activity as a compliance surface, not a growth hack. |

## Launch Posture

Book Studio V1 should support launch governance, not autonomous launch execution.

Allowed design concepts:

- Internal launch checklist.
- Manual external action evidence.
- Reviewed price or promo decision records.
- Review-compliance checklists.
- Client-safe launch status summaries.
- Post-launch tasks and lifecycle recommendations.

Explicitly excluded from V1:

- Direct KDP or Google publishing.
- Direct price or promotion changes.
- Amazon Ads, Google Ads, Meta Ads, or any autonomous ad spend.
- Automated review outreach.
- Automated public email/social launch sends.
- Automated promo-code distribution.
- Automated review monitoring that contacts platforms or reviewers.
- Store listing mutation by Hermes or by app background jobs.

## Lifecycle State Model

| State | Meaning | Allowed next move | Client visibility |
| --- | --- | --- | --- |
| Not launch-ready | Package, packet, account, rights, price, or source evidence is incomplete. | Resolve evidence blockers. | Hidden or safe blocker only. |
| Launch-reviewable | Book is live or near-live enough for a human to review launch options, but warnings may remain. | Approve, reject, or revise a launch packet. | Hidden unless admin promotes a safe summary. |
| Launch approved | A named owner approved specific manual actions, dates, copy, budget posture, and compliance notes. | Human performs approved external actions. | Client-safe launch plan may be promoted. |
| External action recorded | Human recorded what happened outside PiB: listing link, price change, promotion setup, promo-code export, public post, or email send. | Track status, evidence, and analytics. | Safe action status may be promoted. |
| Live monitoring | Book is live and monitored for status, reports, reviews, revision requests, and quality feedback. | Create analytics import, quality task, revision task, or promotion review. | Safe live status and reconciled summary only. |
| Promotion active | A manual external promotion or price window is in progress. | Monitor source-specific status, end dates, and analytics caveats. | Safe promotion status only if approved. |
| Revision required | Store, reviewer, reader, client, or QA evidence shows that metadata, files, price, rights, or content needs revision. | Invalidate affected packet/package states and create revision tasks. | Safe blocker or revision status only. |
| Lifecycle blocked | Rights, source freshness, account authority, review compliance, price law, listing status, or quality feedback blocks action. | Resolve blocker or stop lifecycle activity. | Safe blocker only if admin promotes it. |
| Retired or unpublished | Human external action or strategic decision removes active promotion/sale posture for a format or channel. | Preserve evidence and analytics boundaries. | Safe status only; no implication that all third-party copies vanished. |

## Launch Packet Evidence

A future launch packet should be version-bound to one book, edition, package, channel listing, and approval decision.

Minimum evidence:

- Book/project/edition identifiers.
- Channel listing and external link if available.
- Package checksum or package reference used at launch.
- Launch objective: awareness, first sales, series read-through, client proof, or internal pilot learning.
- Launch owner and approver.
- Allowed actions and forbidden actions.
- Public copy to be used, with reviewed claim boundaries.
- Review request posture and compliance notes.
- Price and promotion posture.
- Budget posture: none, organic only, client-approved spend pending, or human-approved manual spend outside V1.
- Client visibility posture.
- Source freshness keys and checked dates.
- Analytics expectation: no claim, trend signal, reported, reconciled, or settled where supported.
- End date or next review date.

## Promotion And Price Gates

| Action type | Gate before action is approved | Evidence after human action |
| --- | --- | --- |
| KDP Select enrollment decision | Exclusivity, channel conflict, ownership, Kindle Unlimited implications, enrollment window, and author/account approval. | Enrollment status, date, operator, affected Kindle ebook, and next renewal/review date. |
| KDP Free Book Promotion | KDP Select state, Kindle ebook-only state, days available in the 90-day window, start/end dates, royalty caveat, rank caveat, and launch objective. | Promotion dates, external confirmation, cancellation state if any, and post-promo analytics caveats. |
| Kindle Countdown Deal | KDP Select state, marketplace eligibility, scheduling lead time, price steps, royalty assumptions, and source freshness. | Scheduled/active/completed status, price ladder evidence, dates, and analytics caveats. |
| KDP list price change | Minimum/maximum list price, marketplace, royalty option, print cost, tax/fixed-price-law risk, margin, and approval. | Submitted price, external state, review/update status, and effective date evidence. |
| Google promotional pricing | Book available-for-sale state, country/currency rows, start/end dates, overlap rule, Book Catalog access, and source freshness. | Promotion detail, affected identifiers, countries/currencies, status, and downloaded report if available. |
| Google promo codes | Country eligibility, campaign count, code count, discount type, start/end dates, terms shown to recipients, and review-compliance posture. | Generated code evidence, redemption link or CSV reference, terms sent, redemption counts, and transaction-report caveat. |
| Google series bundle/subscription | Series source freshness, book membership, country availability, pricing effect, and client/internal approval. | Bundle/subscription status, affected series, start/end dates, and analytics caveats. |
| Organic launch copy | Claim substantiation, rights/IP review, no misleading ranking or income claims, channel status evidence, and reviewer approval. | Published URL or artifact reference, date, owner, and claim evidence. |
| Paid launch spend | Out of V1 unless Peet revises the approval record. | If manually approved outside V1, record only a non-runtime evidence note and do not automate spend. |

## Review And Endorsement Guardrails

Book Studio should treat reviews as trust evidence, not as a controllable growth lever.

Allowed:

- Store official review policy source links.
- Create internal review-compliance tasks.
- Draft neutral internal review-request copy for human legal/compliance review.
- Record whether a book has review-related caveats, missing-review uncertainty, or platform-reporting uncertainty.
- Record public review counts or rating snapshots only with source, date, marketplace, and caveat.
- Record review issue reports as external evidence when a human takes action.

Forbidden:

- Automated review outreach.
- Review swaps.
- Paying for positive reviews.
- Conditioning refunds, discounts, gifts, bonus material, or access on positive reviews.
- Targeting only likely-happy readers for review requests.
- Asking reviewers to change or delete negative reviews.
- Promising review removal, transfer, sharing, or visibility.
- Using raw reviews in client reports without source date, marketplace, and fair-context wording.
- Letting Hermes contact readers, reviewers, Amazon, Google, influencers, or public audiences.

Devil's advocate: review volume is seductive because it looks like a controllable launch KPI. The governance model should force the opposite assumption: Book Studio can track review evidence and compliance posture, but it cannot manufacture trustworthy reviews.

## Post-Publication Revision Governance

Revision work should preserve the difference between a small update, a significant edition change, and a channel/status blocker.

Required distinction:

- Content typo or small correction.
- Metadata or cover update.
- Manuscript revision.
- Significant new edition.
- Price/promotion change.
- Rights/IP correction.
- AI disclosure correction.
- Store review rejection or blocked status.
- Unpublish/retire decision.

Every revision should carry:

- Source of request: internal QA, store notice, client request, reader feedback, legal/rights issue, analytics signal, or strategy review.
- Affected channel/format/listing.
- Whether current live version remains sellable while review occurs.
- Package or packet states invalidated.
- Client visibility rule.
- Human owner and deadline.
- External evidence after action.

Unpublish or retire decisions must not imply deletion. KDP source evidence says unpublish can stop new sales through KDP but used third-party copies may remain externally visible. Portal wording should say "retired from active PiB-managed sale posture" or "unpublished on recorded channel" only when evidence supports that exact statement.

## Analytics Linkage

Launch records should explain what happened. Analytics records should explain what evidence says happened after that.

Book Studio should avoid these false inferences:

- A free download is not a paid sale.
- A promo-code redemption is not settled revenue.
- A rank movement is not profit.
- A live link is not launch success.
- A review count is not review quality.
- A dashboard estimate is not settled payment.
- A series read-through hypothesis is not proven until book-level evidence supports it.

Promotion analytics should preserve:

- Source.
- Report type.
- Timezone.
- Promotion window.
- Baseline period.
- Affected listings.
- Refund/return caveats.
- Ad/promo costs where manually recorded.
- Confidence: estimated, reported, reconciled, settled where supported, disputed, or partial.

## Hermes Boundary

Hermes may:

- Summarize source-backed launch constraints.
- Draft internal launch checklists.
- Identify missing price, promo, review, rights, source, or account evidence.
- Propose task lists for human approval.
- Compare launch plans against approval record deferrals.
- Flag review/endorsement risk.
- Suggest analytics caveats after manual imports.

Hermes may not:

- Publish, unpublish, submit updates, change listing data, change price, schedule promotions, generate promo codes, send public copy, message clients, message readers, ask for reviews, spend budget, or contact a platform.
- Rewrite an unsafe review request into something "probably fine" without preserving the blocker.
- Claim a launch was successful from partial analytics.
- Use `PMStander/ai-story` launch behavior as policy, review, or promotion evidence.

## Portal Rule

Portal launch/lifecycle visibility should be promotion-based, not mirrored.

Client-safe portal content may include:

- Reviewed launch status.
- Reviewed live link.
- Reviewed next action.
- Reviewed blocker.
- Reconciled analytics summary with caveats.
- Approved client action request, such as "please review the launch plan" or "please confirm price window".

Portal content must not include:

- Raw review-risk notes.
- Raw promo-code CSVs.
- Account authority details.
- Internal budget debates.
- Unreviewed public copy.
- Raw analytics imports.
- Unreconciled review, ranking, or revenue claims.
- Store screenshots without source/date/context.

## Pass, Warn, Block Fixtures

| Fixture | Expected state | What it proves |
| --- | --- | --- |
| LAUNCH-PASS-001 | Business nonfiction ebook is live on KDP and Google; launch plan is organic-only with reviewed copy, no review incentive, manual action evidence, and no revenue claim. | Launch governance can support a useful safe launch without direct publishing or automation. |
| LAUNCH-WARN-001 | Google promo code idea exists, but country eligibility, terms, campaign limits, and redemption analytics are not fully checked. | Promotion ideas can remain internal warnings instead of becoming tasks. |
| LAUNCH-WARN-002 | KDP Select enrollment could unlock promos but conflicts with planned wide ebook distribution. | Exclusivity is treated as a launch blocker, not a marketing shortcut. |
| LAUNCH-BLOCK-001 | Operator asks Hermes to request five-star reviews from prior clients in exchange for a free copy. | Review manipulation and incentive risk block outreach. |
| LAUNCH-BLOCK-002 | Operator asks to drop price across KDP and Google today without fixed-price-law, margin, territory, and source refresh evidence. | Price changes are human-approved external actions with evidence, not quick app mutations. |
| LAUNCH-BLOCK-003 | A negative reader complaint reveals a rights or content-quality issue after launch. | Lifecycle governance invalidates affected packet states and creates revision tasks. |

## Approval Impact

This packet strengthens the approval record but does not change the recommended V1.

If Peet approves as written:

- Phase 1 planning may include launch/lifecycle records only as reviewed internal governance and client-safe summaries.
- Phase 1 planning must keep review outreach, ads, public sends, price/promo mutations, and store listing changes manual and approval-gated.
- Source refresh must include launch/promotion/review sources before any launch or lifecycle claim is planned.

If Peet revises V1 to include direct launch automation, paid ads, automated review outreach, or automated price/promotion changes, the current packet is insufficient. That revision needs a separate design pass before planning.

## Devil's Advocate

- Launch work is where a "book production" module can quietly become a marketing-automation and compliance-liability module.
- Promotions can create impressive short-term charts while weakening margins, confusing analytics, or violating exclusivity.
- Reviews are not just another KPI. Bad review practices can damage account trust, customer trust, and regulatory posture.
- Price changes sound simple but can involve marketplace limits, taxes, fixed price laws, currency conversion, royalty effects, print cost, and retailer discretion.
- Lifecycle work is mostly exception handling. If the model does not make revision, complaint, blocked, and unpublish states first-class, operators will keep treating live books as permanently approved.

## Current Review State

Book Studio now has a standalone launch and lifecycle governance aid. It makes post-publication operations reviewable without approving runtime implementation, direct publishing, review outreach automation, ad spend, price/promotion mutation, or public launch automation.
