# Book Studio V1 Ownership And Commercial Governance Model

**Date:** 2026-06-08
**Status:** Design-only operating model; not legal, tax, accounting, or implementation advice.
**Authoritative dossier:** `docs/superpowers/specs/2026-06-07-book-studio-research-dossier.md`
**Decision packet:** `docs/superpowers/specs/2026-06-08-book-studio-v1-approval-packet.md`
**Publishing and analytics model:** `docs/superpowers/specs/2026-06-08-book-studio-v1-publishing-analytics-model.md`
**Source refresh contract:** `docs/superpowers/specs/2026-06-08-book-studio-v1-source-refresh-contract.md`

## Purpose

Book Studio cannot treat "create a book" and "sell a book" as the same problem. A finished manuscript still needs a clear owner, publishing account authority, rights basis, commercial model, payment/report access, client visibility model, and blocker state before PiB can claim a book is ready for manual handoff.

This model extracts the ownership and commercial rules into one review surface. It does not create records, contracts, invoices, payment flows, legal templates, routes, APIs, Hermes skills, account integrations, or a Phase 1 implementation plan.

## Current Source Implications

These official-source implications were rechecked on 2026-06-08 and should remain source-refresh gated:

| Source | Implication for Book Studio |
| --- | --- |
| KDP Help Center account-security notice: `https://kdp.amazon.com/en_US/help` | PiB should not ask clients for Amazon passwords or full bank details outside their KDP account. Book Studio should track readiness, not secrets. |
| KDP identity verification: `https://kdp.amazon.com/en_US/help/topic/GH7TYHP6FR9QAUM9` | Publishing access can depend on identity, tax, and bank-account consistency. Book Studio should label this as an external readiness state, not store identity documents. |
| Google Play Books service providers: `https://support.google.com/books/partner/answer/3323299?hl=en` | Managing client Google publishing accounts may require service-provider access, client consent, payments/report access, and client account participation. Google's page currently says new Google Books Client Service Agreement applications are not accepted, so Phase 1 must not depend on PiB obtaining new service-provider status. |
| Google Play Books program policies: `https://support.google.com/books/partner/answer/166501?hl=en` | Pricing, refunds, currency conversion, revenue share, reports, DRM/printing, and client-services agreement rules affect commercial claims. |
| Google Play Books selling overview: `https://support.google.com/books/partner/answer/1079107?hl=en` | Supported countries, file formats, DRM, list prices, preview, and revenue share are channel-specific and cannot be assumed from KDP readiness. |

## Ownership Modes

Book Studio V1 should support one workflow with an explicit ownership mode, while blocking upload-readiness if the mode lacks evidence.

| Ownership mode | Use case | Required evidence before packet-ready | Portal wording |
| --- | --- | --- | --- |
| `pib_owned` | PiB creates and owns the book as an internal asset, lead magnet, brand authority asset, or revenue experiment. | PiB owner, imprint/author decision, rights/provenance, account profile, price/margin plan, and internal approval. | "PiB-owned production asset" only if client does not need approval. |
| `client_owned` | PiB creates the book for a client brand, expert, course, property, or niche authority campaign. | Client owner, publishing authority, approval artifact, author/publisher/imprint decision, account authority, revenue/report access expectation, and rights assignment/permission evidence. | Client sees only reviewed ownership and approval decisions, not internal risk notes. |
| `shared_or_revenue_share` | PiB and client share production cost, IP, royalties, or campaign upside. | Written commercial decision, revenue share basis, cost recovery rule, tax/account owner, payment/report evidence, termination/rights fallback, and client acceptance. | Defer in V1 unless Peet explicitly approves this mode. |
| `third_party_or_contributor` | Ghostwriter, illustrator, editor, narrator, designer, or external rights holder contributes work. | Contributor role, usage license, territory, exclusivity, attribution, AI-use status, compensation state, and proof artifact. | Hide unless converted into a safe credit/approval note. |

Default V1 recommendation: allow `pib_owned` and `client_owned`; treat `shared_or_revenue_share` as a blocked/warn state unless explicitly approved for a pilot.

## Account Authority Model

Every KDP or Google channel packet should reference an account authority profile before it can become manual-handoff ready.

| Profile area | Required state | Must not store |
| --- | --- | --- |
| Account owner | PiB, client, or approved publisher entity. | Passwords, two-factor recovery codes, identity documents, bank account numbers, tax IDs. |
| Operator authority | Who may upload, change metadata, view reports, or record evidence. | Shared login credentials or private account notes. |
| Identity readiness | External state label such as not checked, ready, pending, failed, or recheck required. | Uploaded identity photos or personal document copies. |
| Tax/payment readiness | External state label and recheck date. | Full tax forms, full banking details, or payment profile secrets. |
| Report access | Whether PiB can see reports, receive exports, or only accept client-supplied snapshots. | Raw account credentials. |
| Territory authority | Countries/regions where the owner claims rights and can sell. | Legal conclusions beyond reviewed evidence. |
| Consent evidence | Client or internal approval artifact reference. | Private contract text in portal responses. |

Account authority state should be independent per channel. A KDP-ready account does not prove Google readiness, and Google service-provider consent does not prove KDP authority.

## Commercial Decision States

Commercial status should move separately from manuscript status and channel status.

| State | Meaning | Allowed next move | Blocks |
| --- | --- | --- | --- |
| No commercial model | Book idea exists, but owner, pricing, rights, and revenue model are not decided. | Continue research and brief work. | Packet-ready and portal commercial claims. |
| Internal estimate | PiB has rough pricing, cost, and margin assumptions. | Create review task and attach source/calculator evidence. | Client-safe revenue language. |
| Reviewable model | Price, territory, royalty/margin, cost recovery, ownership, account, and report assumptions are visible with confidence labels. | Approve, revise, or waive warnings. | Manual handoff until approved. |
| Approved commercial model | Human reviewer approves the current version and assumptions. | Use in packet and launch planning. | Becomes stale if package, price, channel, account, source, or ownership changes. |
| Live commercial evidence | External listing, price, report, payment, refund, or adjustment evidence exists. | Reconcile analytics and promote safe summary if reviewed. | Blended revenue without source/confidence. |
| Disputed or stale | Report mismatch, refund, account change, price change, rights issue, or stale source undermines confidence. | Create blocker/reconciliation task. | Portal performance claims. |

## Revenue And Cost Separation

V1 should not promise profit from one number. It should keep these families separate:

| Family | Rule |
| --- | --- |
| Store list price | Store-facing price assumption or external listing evidence. |
| Store revenue or royalty | Source-labeled KDP/Google report value, with period and confidence. |
| Settled payment | Only where payment/settlement evidence supports the period and account. |
| Refunds and reversals | Must remain visible and should not disappear inside net values without trace. |
| Production cost | PiB labor, subcontractor, tooling, design, proof, and review costs where internally tracked. |
| Promotion cost | Ads, launch assets, discounts, promo codes, or campaign spend, approval-gated. |
| Cost recovery | Internal measure unless explicitly agreed and safe for client reporting. |
| Revenue share | Blocked unless the ownership model explicitly approves shared economics. |

Portal summaries can show client-safe trend or outcome language after review, but raw cost lines, payment-profile detail, internal margin calculations, and unresolved reconciliation notes stay internal by default.

## Client Approval Artifacts

Client-owned and shared projects need explicit approval artifacts before upload-readiness.

Minimum safe artifacts:

- Book Brief approval: audience, promise, scope, brand/author positioning, and assumptions.
- Proof/package approval: exact version, visible content, cover/interior, and known caveats.
- Rights/ownership approval: who owns what, what PiB may do, and what the client is accepting.
- Publishing packet approval: metadata, channel, files, AI disclosure basis, price/territory summary, and manual upload state.
- Commercial summary approval: price/revenue/report assumptions and caveats where client-facing.

Each approval applies to a version. Later changes to manuscript, cover, package, metadata, channel, price, ownership, account, or source evidence should invalidate only the affected approval scopes.

## Upload-Readiness Blockers

Manual handoff should block when any of these are unresolved:

- Owner is unknown or conflicts with account owner.
- Client approval is required but missing.
- Account authority is unverified, stale, or credential-sharing-dependent.
- Identity, tax, payment, report, or territory readiness is unresolved for the selected channel.
- Contributor, image, quote, font, AI, public-domain, companion, or trademark rights are unresolved.
- Price, margin, refund, currency, or cost assumptions are unknown and no waiver exists.
- Revenue-share or cost-recovery expectation is undefined.
- Source freshness is stale for the claim being made.
- Portal summary would expose raw legal, account, contract, cost, or reconciliation detail.

## Hermes Commercial Boundaries

Hermes can support commercial governance as a reviewer assistant, not as a decision-maker.

Allowed:

- Summarize commercial assumptions from approved sources and artifacts.
- Draft client-safe questions for ownership, author, account, or price decisions.
- Compare a packet against account authority and commercial checklist requirements.
- Flag stale, missing, contradictory, or unsafe commercial evidence.
- Create internal tasks for reviewer decisions.

Forbidden:

- Give legal, tax, or accounting advice.
- Approve ownership, revenue share, price, tax, payment, or account authority.
- Ask for or store secrets, tax IDs, bank data, IDs, or account credentials.
- Tell a client the book is commercially viable without reviewer-approved evidence.
- Mark a packet manual-handoff ready.

## Devil's Advocate

- A beautiful book can still be commercially unpublishable if account authority, identity, payment, or rights are unresolved.
- PiB-owned and client-owned books should share workflow mechanics, but not ownership assumptions. One wrong default could put revenue, tax, rights, and support responsibility on the wrong party.
- Revenue-share projects can sound attractive but create accounting, reporting, termination, and trust problems. V1 should not include shared economics unless Peet explicitly accepts that operational load.
- A client may approve content without understanding publishing/account consequences. Approval artifacts should make the exact decision visible.
- Hermes can speed commercial review, but if it starts making commercial decisions it becomes a liability multiplier.
- Portal transparency is not the same as raw visibility. Clients need clear decisions and safe blockers, not account details, internal costs, private contract notes, or unreconciled report rows.

## Current Review State

This model strengthens the V1 packet by making ownership and commercial governance explicit. It does not change the approval gate:

- Book Studio remains an internal PiB production studio with optional client review.
- KDP and Google Play Books remain manual-handoff channels first.
- `pib_owned` and `client_owned` are the recommended V1 ownership modes.
- Shared/revenue-share economics should stay blocked unless Peet explicitly approves them.
- No implementation or Phase 1 plan should start until Peet approves or revises the V1 approval record.
