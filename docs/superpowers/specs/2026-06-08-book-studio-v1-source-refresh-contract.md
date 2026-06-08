# Book Studio V1 Source Refresh Contract

**Date:** 2026-06-08
**Status:** Design-only evidence contract; not an implementation plan.
**Authoritative dossier:** `docs/superpowers/specs/2026-06-07-book-studio-research-dossier.md`
**Decision packet:** `docs/superpowers/specs/2026-06-08-book-studio-v1-approval-packet.md`
**Publishing and analytics model:** `docs/superpowers/specs/2026-06-08-book-studio-v1-publishing-analytics-model.md`
**Book family gate catalog:** `docs/superpowers/specs/2026-06-08-book-studio-v1-book-family-gate-catalog.md`
**Wider channel source aid:** `docs/superpowers/specs/2026-06-08-book-studio-v1-wider-channel-adapter-packet.md`

## Purpose

Book Studio depends on policies, report timing, file rules, series rules, and account-governance rules that can change outside PiB. This contract defines how future Book Studio work should prove that a publishing, analytics, Hermes, or portal claim is based on current evidence.

This file does not create runtime source records, APIs, Firestore collections, route handlers, Hermes skill files, report parsers, publishing integrations, or a Phase 1 task list.

## Verified Source Set

These source keys were rechecked on 2026-06-08.

| Source key | Official source | Why it matters to Book Studio V1 | Design consequence |
| --- | --- | --- | --- |
| `kdp-content-ai-ip` | `https://kdp.amazon.com/en_US/help/topic/G200672390` | KDP content guidelines cover AI disclosure, IP responsibility, customer experience, companion-book limits, and public-domain expectations. | Publishing packets need AI-use, rights, companion, public-domain, and customer-experience evidence before KDP handoff. |
| `kdp-low-content` | `https://kdp.amazon.com/en_US/help/topic/GGE5T76TWKA85DJM` | Low-content print has special ISBN, release-date, series, sample, barcode, and distribution constraints. | Low-content projects need their own gate profile; they must not inherit normal nonfiction or series assumptions. |
| `kdp-series` | `https://kdp.amazon.com/en_US/help/topic/GMFKBUS43QQ5AJ5A` | KDP series support exists, but not every internal PiB series is externally eligible. | Internal series state must stay separate from external KDP series-page readiness. |
| `kdp-print-options` | `https://kdp.amazon.com/en_US/help/topic/G201834180` | Trim, paper, color, page-count, and cover choices affect print cost, proofing, and file readiness. | Print/workbook projects need print-option evidence before pricing or package approval. |
| `kdp-reports` | `https://kdp.amazon.com/en_US/help/topic/GVTTXHKHVPAPBEDQ` | KDP reports vary by report type, update cadence, timezone, KENP finalization, payment timing, and estimate quality. | Analytics must separate estimated, processed, reportable, payment, KU, and expanded-distribution evidence. |
| `google-program-policies` | `https://support.google.com/books/partner/answer/166501?hl=en` | Google policies define accepted digital file types, reports, refunds, content rules, currency handling, DRM/printing expectations, and client-services requirements. | Google packets need file, rights, DRM/print, price/currency, refund, and account-authority evidence. |
| `google-add-book` | `https://support.google.com/books/partner/answer/9261664?hl=en` | Google single-book setup uses Book Catalog, templates, ISBN/EAN or GGKEY, book info, genres, contributors, series, and settings. | Google packet readiness must map PiB metadata to the Partner Center entry fields rather than reuse KDP fields blindly. |
| `google-series` | `https://support.google.com/books/partner/answer/11069638?hl=en` | Google series requires ordered titles, relationship type, whole-number series numbering, consistent naming, genre behavior, and series catalog workflows. | Series continuity and numbering checks must be channel-specific and not inferred from PiB's internal volume plan alone. |
| `google-reports` | `https://support.google.com/books/partner/answer/9266485?hl=en` | Google report availability and fields differ across earnings, sales summary, transactions, and preview traffic, with Pacific-time reporting and possible missing values. | Google analytics must preserve report type, period, timezone, missing-value state, refunds, and preview-vs-sales separation. |
| `google-service-provider` | `https://support.google.com/books/partner/answer/3323299?hl=en` | Google distinguishes service-provider access, client consent, payments/report access, collection codes, and account participation. | Book Studio cannot assume PiB can manage client Google accounts or pull reports without explicit account authority evidence. |
| `ai-story-head` | `https://github.com/PMStander/ai-story` at `11ef473c94f977b1dbc487f8645c4711728b6095` | The prior project remains a learning source for wizard intake, story/series flow, and KDP-oriented packaging expectations. | Treat `ai-story` as design evidence only; do not use it as a runtime dependency or migration target without a separate approval decision. |

Wider-channel source keys for Apple Books, Kobo Writing Life, Draft2Digital, IngramSpark, ACX, KDP Virtual Voice, ISBN.org, and W3C EPUBCheck are separated in the wider channel adapter packet. They are future-compatibility evidence only and do not expand V1 beyond KDP and Google Play Books.

The book-family gate catalog refreshed the same KDP/Google source cluster on 2026-06-08 and added a profile-level mapping for nonfiction/reference, narrative, activity/workbook, low-content, children/visual, cookbook/photo/portfolio, public-domain/companion, audiobook, and series overlay decisions. It is a review aid, not a source of permanent policy truth.

## Evidence Freshness Rules

Policy-sensitive claims need source freshness before they can affect a reviewed state.

| Claim type | Freshness rule | Stale-source result |
| --- | --- | --- |
| KDP upload readiness | Recheck KDP content, metadata, format, print, low-content, series, and report pages used by the packet within 14 days of manual handoff. | Packet cannot be marked manual-handoff ready. |
| Google upload readiness | Recheck Google add-book, program policy, file, series, payment/report, and service-provider pages used by the packet within 14 days of manual handoff. | Packet remains internal-reviewable or blocked. |
| AI disclosure | Recheck KDP AI/content guidance and any Google AI/content guidance before answering channel disclosure questions. | AI disclosure state becomes "needs policy refresh". |
| Low-content or activity print | Recheck KDP low-content and print-option pages before approving ISBN, barcode, sample, expanded-distribution, series, trim, page-count, and margin assumptions. | Print package cannot be approved. |
| Series eligibility | Recheck KDP and Google series guidance before external series-page or bundle claims. | Only internal PiB series wording is allowed. |
| Google DRM/printable activity content | Recheck Google program policies before uploading coloring, puzzle, cut-pattern, workbook, or other physical-page-dependent content. | Google packet must warn or block. |
| Account authority | Recheck Google service-provider and KDP account/security guidance before claiming PiB can manage account, payment, report, or upload access. | Account state becomes "authority unverified". |
| Analytics summary | Recheck channel report timing and field definitions before promoting revenue, order, KENP, payment, refund, preview, or currency statements to the portal. | Summary can stay internal but not client-promoted. |

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
| Analytics promotion | Any report-definition source behind the promoted metric. | Internal import, reconciliation task, and no-revenue portal state. |
| Hermes skill output | Source key required by the skill's manifest is stale or missing. | Skill can ask for refresh task creation, but not produce readiness output. |

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
