# Book Studio V1 Approval Revision Impact Matrix

**Date:** 2026-06-08
**Status:** Revision impact matrix only; not an implementation plan.
**Authoritative approval packet:** `docs/superpowers/specs/2026-06-08-book-studio-v1-approval-packet.md`
**Decision index:** `docs/superpowers/specs/2026-06-08-book-studio-v1-decision-index.md`
**Review scorecard:** `docs/superpowers/specs/2026-06-08-book-studio-v1-approval-review-scorecard.md`
**Approval decision form:** `docs/superpowers/specs/2026-06-08-book-studio-v1-approval-decision-form.md`
**Source refresh execution report:** `docs/superpowers/specs/2026-06-08-book-studio-v1-source-refresh-execution-report.md`
**Hermes skill contract pack:** `docs/superpowers/specs/2026-06-08-book-studio-v1-hermes-skill-contract-pack.md`
**Market evidence model:** `docs/superpowers/specs/2026-06-08-book-studio-v1-market-evidence-model.md`
**Rights, asset, and contributor ledger model:** `docs/superpowers/specs/2026-06-08-book-studio-v1-rights-asset-contributor-ledger-model.md`

## Purpose

This matrix shows what must be revised if Peet changes one field in the Book Studio V1 approval record. It keeps revisions explicit so "approve with revisions" does not silently become a runtime build, broad Phase 1 task list, or weaker evidence standard.

It does not approve runtime routes, APIs, Firestore collections, database schemas, UI components, module toggles, Hermes runtime dispatch, direct publishing, analytics automation, automated export/file validation, or a Phase 1 task list.

If a change creates a blocker, the blocker becomes a design-packet revision or a new design-only aid. It does not become implementation work until Peet approves the revised approval record and a separate Phase 1 implementation plan is written.

When revisions are accepted, record the changed fields, updated evidence docs, remaining blockers, and `planningAllowed` gate in the approval decision form.

## Revision Rules

- Revise only the smallest approval field that actually changes.
- Update every linked evidence packet named in the row before planning.
- Treat added channels, added book families, added portal exposure, or broader Hermes scope as source-refresh triggers.
- Use the source refresh execution report to record each triggered source result before planning.
- Keep KDP and Google Play Books manual handoff as the default V1 boundary unless `firstChannels` is explicitly revised.
- Keep candidate production selection blocked until a reviewed market evidence packet reaches pass or accepted warning.
- Keep runtime Hermes dispatch disabled unless a later approved implementation plan scopes contracts, manifests, ledgers, sanitizers, fixtures, reviewer defaults, and forbidden-action tests.
- Keep asset, quote, font, template, public-domain/open-license, AI-generated, client-owned, and contributor inputs blocked from dependent states unless the rights ledger has a pass or accepted-warning state for the exact scope.
- Keep direct publishing, credential custody, public SaaS, self-serve generation, autonomous ad spend, automated review outreach, and unreconciled analytics out of V1 unless Peet explicitly reopens product posture.

## Field Impact Matrix

| Approval field | Safe revision examples | Added evidence needed | Docs to update before planning | Blockers created if skipped | Devil's advocate |
| --- | --- | --- | --- | --- | --- |
| `productPosture` | Keep internal PiB studio; narrow to PiB-owned only; ask for a client-facing review-first posture. | Portal permission posture, commercial owner posture, support burden, client-visible artifact boundary. | Approval packet, portal access model, ownership/commercial model, operator workspace model, coverage audit. | Client users may see raw or weak evidence, or the build may drift into public SaaS/self-serve generation. | A more client-facing product sounds attractive, but it multiplies support, safety, permissions, pricing, and artifact-redaction risk before the internal workflow is proven. |
| `firstChannels` | Keep KDP/Google manual handoff; add Apple/Kobo/D2D/Ingram/audio; remove Google from first focus. | Current official source refresh, account authority, file/package requirements, payment/reporting, distribution conflict, territory, tax, and analytics-source review for every added channel. | Approval packet, source refresh contract, wider-channel adapter packet, publishing/analytics model, package QA model, review script. | A plan may claim channel readiness from stale or mismatched policies. | Wide distribution looks strategic, but it can turn V1 into channel governance instead of a working PiB production flow. |
| `firstPilotSet` | Add children visual gated pilot; remove negative-control fixture; make client-owned workbook the first proof. | Book-family gate profile, rights/provenance, asset and contributor ledger scope, package QA, ownership/account authority, portal artifact, analytics confidence, and Research evidence requirements for the changed pilot. | Approval packet, pilot product decision register, book-family gate catalog, rights/asset/contributor ledger model, acceptance fixtures, mock review packet, coverage audit. | V1 may prove only easy pass cases or may take on fixed-layout/rights complexity too early. | Removing blocker proof speeds the first build but weakens evidence that Book Studio can stop attractive unsafe projects. |
| `marketEvidenceScope` | Require market evidence for all live candidates; narrow first proof to admin-only market packets; add stricter margin/relevance blockers. | KDP/Google discoverability, metadata, search, content-quality, pricing, competitive observation, rights, channel fit, and PiB strategic-fit evidence. | Approval packet, market evidence model, source refresh contract, source refresh execution report, pilot product decision register, acceptance fixtures, scorecard, coverage audit. | Book Brief or production can start from shelf screenshots, rank/sales promises, generic AI-book ideas, copied competitor positioning, misleading metadata, or negative/unknown margin. | Market evidence can slow the first build, but skipping it lets Book Studio produce polished books that should never have entered production. |
| `firstPortalReviewArtifacts` | Start with Book Brief only; include proof package early; include publishing packet and analytics only when reviewed/reconciled. | Client-safe DTO/redaction rules, promotion states, invalidation rules, approval copy, disabled-module posture, reviewer roles. | Approval packet, portal access model, mock review packet, acceptance fixtures, operator workspace model, review script. | Portal could expose raw Hermes output, rights uncertainty, internal blockers, upload-account details, or unreconciled analytics. | More portal visibility can impress clients, but premature visibility creates trust and legal risk faster than it creates value. |
| `hermesFirstScope` | Wave 1 only; Wave 1 plus selected Wave 2 docs/fixtures/contracts; broader docs only with no runtime dispatch. | Skill contract records, manifests, input contracts, output artifacts, fixture IDs, pass/warn/block rubrics, forbidden actions, sanitizer expectations, reviewer defaults, stale-source behavior. | Approval packet, Hermes skill blueprint, Hermes evaluation packet, Hermes contract pack, acceptance fixtures, review scorecard, coverage audit. | Hermes can appear authorized to publish, approve, spend, message clients, request secrets, mark artifacts client-ready, or run without source-key and portal-visibility boundaries. | Hermes can create polished output quickly; without contracts, fixtures, and blockers, polish hides weak evidence. |
| `ownershipModel` | PiB-owned only; shared PiB/client-owned; client-owned first proof. | Account authority, publisher/imprint, payment/revenue separation, client approval artifacts, cost ledger, rights assignment, client-owned asset approval, contributor authority, tax/reporting boundary. | Approval packet, ownership/commercial model, rights/asset/contributor ledger model, jurisdiction/local publisher model, publishing/analytics model, mock review packet. | Revenue, rights, account access, client-owned assets, contributor assignments, and client approval can blur into one unsafe operating lane. | Shared ownership expands opportunity, but it adds governance before the module has proven one clean owner path. |
| `jurisdictionAndLocalPublisherScope` | Keep South African local evidence as a warning lane; make local publisher evidence a first-plan fixture; narrow to non-local first pilots. | Legal-deposit source refresh, ISBN/imprint source and owner, copyright posture, contributor authority, territory, local adaptation evidence. | Approval packet, jurisdiction/local publisher model, source refresh contract, acceptance fixtures, coverage audit. | KDP/Google channel readiness may be mistaken for local legal or publisher readiness. | Local obligations are easy to treat as paperwork, but missing them can make a successful upload operationally unsafe. |
| `rightsAssetContributorScope` | Require ledger before production start; require ledger before package QA; require ledger before portal/manual handoff only. | Asset source, license scope, AI provenance, public-domain/open-license basis, client-owned asset approval, contributor credit/assignment, territory, format, channel, and portal-safe summary rules. | Approval packet, rights/asset/contributor ledger model, source refresh contract, acceptance fixtures, review script, coverage audit. | A proof, cover, quote, font, template, AI image, client brand asset, or contributor input can advance without scoped evidence. | Moving the gate later speeds production but makes polished unsafe artifacts more likely; moving it earlier costs time but exposes rights problems before production spend. |
| `productionReadinessScope` | Package QA evidence only; add checksum-bound readiness; add manual preview rendering fixture; defer automated export/file validation. | File/proof/cover/rights/accessibility/source freshness evidence, rights/asset/contributor ledger state, checksum binding, invalidation rules, proof package versioning, manual preview fixture. | Approval packet, production package QA model, rights/asset/contributor ledger model, mock review packet, acceptance fixtures, review script. | A draft PDF, EPUB, cover, quote, font, template, AI image, client asset, or contributor input can be mistaken for upload-ready package evidence. | Package QA sounds like implementation detail, but it is the boundary between creative output and a safe manual handoff. |
| `analyticsScope` | Manual imports only; include series rollups; add early dashboard summaries; defer automated report integrations. | Source confidence labels, estimated/reported/settled separation, reconciliation tasks, import cadence, series/title rollup rules, client-safe summary language. | Approval packet, publishing/analytics model, mock review packet, portal access model, coverage audit. | Client-facing numbers may overclaim revenue, rankings, royalties, or channel performance. | Analytics can make the module feel commercially real, but early estimates become dangerous when presented as settled truth. |
| `acceptedDeferrals` | Remove a deferral such as automated export validation; add a deferral such as deferring Google from the first plan; keep direct publishing deferred. | A reason, affected approval fields, added source refresh, added fixtures, and explicit risk acceptance for every changed deferral. | Approval packet, decision index, review script, scorecard, coverage audit, affected appendix docs. | Deferred work may quietly become implied scope, or removed deferrals may enter planning without evidence gates. | Deferrals are product commitments, not leftovers. Removing one should be treated as a scope expansion. |

## Revision Outcome Map

| Revision outcome | Meaning | Allowed next action |
| --- | --- | --- |
| Field stays within safe revision examples and evidence docs are updated. | Approval can proceed with the revised record. | Write a separate Phase 1 implementation plan only after Peet approves the revised record. |
| Field changes beyond safe revision examples. | The current V1 posture is no longer proven by the packet. | Write a new design-only aid or reopen the approval packet before planning. |
| Field removes a blocker fixture or evidence lane. | V1 becomes faster but weaker. | Record the accepted risk in the approval packet and scorecard before planning. |
| Field adds channel, pilot, market evidence, portal, Hermes, publishing, or analytics scope. | V1 becomes broader and source-sensitive. | Refresh affected sources and update affected appendices before planning. |

## Planning Guard

A future Phase 1 plan must quote:

- the final approval record,
- the current dossier commit,
- the current `development` commit at planning time,
- the revision fields changed after the decision-bundle baseline, and
- the evidence packets updated because of those revisions.

If those quotes are missing, planning should stop and return to approval revision.

## Devil's Advocate

- A revision matrix can make approval feel mechanical. It is not. Every revision is a product-risk decision with evidence consequences.
- The safest-looking revision can still be dangerous if it changes who owns the book, who sees artifacts, which channel is first, or what Hermes can do.
- A blocker should not be renamed as a small task to keep momentum. If the approval packet does not cover it, the next artifact should be design-only.
- Future implementation planning should not use this matrix as a backlog. It is a guardrail for revising the approval boundary before a backlog exists.

## Current Review State

Book Studio remains ready for a V1 approval decision, not runtime implementation. This matrix makes "approve with revisions" safer by naming the affected evidence and blockers before any future plan is written.
