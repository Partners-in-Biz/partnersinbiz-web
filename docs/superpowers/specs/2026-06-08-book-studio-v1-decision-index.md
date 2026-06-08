# Book Studio V1 Decision Index

**Date:** 2026-06-08
**Status:** Review index only; not an implementation plan.
**Authoritative approval packet:** `docs/superpowers/specs/2026-06-08-book-studio-v1-approval-packet.md`
**Authoritative dossier:** `docs/superpowers/specs/2026-06-07-book-studio-research-dossier.md`
**Coverage audit:** `docs/superpowers/specs/2026-06-08-book-studio-objective-coverage-audit.md`
**Review scorecard:** `docs/superpowers/specs/2026-06-08-book-studio-v1-approval-review-scorecard.md`
**Pilot product decision register:** `docs/superpowers/specs/2026-06-08-book-studio-v1-pilot-product-decision-register.md`
**Revision impact matrix:** `docs/superpowers/specs/2026-06-08-book-studio-v1-approval-revision-impact-matrix.md`

## Purpose

Book Studio now has enough research and design evidence to support a V1 product decision, but the packet set is broad. This index tells Peet what to read, which docs are authoritative, which docs are evidence aids, and exactly what decision is still needed before implementation planning.

This file does not approve runtime code, routes, records, schemas, UI, Hermes dispatch, direct publishing, analytics automation, or a Phase 1 implementation plan.

## Fast Review Path

If Peet has 10 minutes:

1. Read the approval packet's **Recommended Approval**, **Copyable Approval Record**, and **What Remains Unapproved** sections.
2. Skim the objective coverage audit's **Requirement Coverage Matrix**.
3. Use the approval review scorecard to mark each category as pass, warn, or block.
4. Use the pilot product decision register if the first commercial/product proof is the unclear part.
5. Use the revision impact matrix if the likely outcome is "approve with revisions."
6. Review the mock review packet to see the operating loop in a concrete business nonfiction example.
7. Decide whether to approve the exact wording, revise specific fields, reject the internal-studio posture, or request another design aid.

If Peet has 30 minutes:

1. Use the review script agenda.
2. Use the approval review scorecard to record any pass, warning, or blocker decisions.
3. Read the package QA model, jurisdiction/local publisher model, and `ai-story` non-port checklist for the highest-risk edges.
4. Use the acceptance fixtures to check pass/warn/block coverage.
5. Copy the approval or revision response at the end.

## Core Decision Docs

| Read order | Document | Use it for |
| --- | --- | --- |
| 1 | `2026-06-08-book-studio-v1-approval-packet.md` | The actual V1 decision and copyable approval record. |
| 2 | `2026-06-08-book-studio-objective-coverage-audit.md` | Proof that the original objective was covered at design depth. |
| 3 | `2026-06-08-book-studio-v1-approval-review-scorecard.md` | A compact pass/warn/block rubric for deciding whether the approval packet is ready. |
| 4 | `2026-06-08-book-studio-v1-pilot-product-decision-register.md` | A standalone first-pilot product register for deciding which book archetypes prove V1. |
| 5 | `2026-06-08-book-studio-v1-approval-revision-impact-matrix.md` | A field-by-field map of what changes if Peet approves with revisions. |
| 6 | `2026-06-08-book-studio-v1-review-script.md` | A structured 30-minute review agenda and exact revision format. |
| 7 | `2026-06-08-book-studio-v1-mock-review-packet.md` | A concrete example of admin state, portal wording, blockers, and analytics confidence. |
| 8 | `2026-06-08-book-studio-v1-acceptance-fixtures.md` | Minimum pass, warning, and blocker cases a future demo must satisfy. |

## Evidence And Boundary Appendices

| Appendix | When to read it |
| --- | --- |
| Source refresh contract | Before relying on KDP, Google, analytics, source freshness, or `ai-story` baseline claims. |
| Book-family gate catalog | When deciding whether the first pilot set covers enough book types. |
| Publishing and analytics model | When reviewing manual handoff, upload evidence, analytics confidence, and reconciliation. |
| Ownership and commercial model | When deciding PiB-owned, client-owned, or shared ownership posture. |
| Portal access and promotion model | When deciding what a client can see and how the module switch should behave later. |
| Domain record/state model | When checking the conceptual record relationships a future plan must preserve. |
| Operator workspace control model | When checking how admins should operate Book Studio without a blank-prompt-first workflow. |
| Production package QA model | When checking proof, file, cover, rights, accessibility, source, and checksum evidence. |
| Jurisdiction/local publisher model | When checking South African legal-deposit, ISBN/imprint, copyright, contributor, and local publisher lanes. |
| Hermes skill blueprint and evaluation packet | When reviewing new Hermes skills, fixture gates, forbidden actions, and runtime dispatch blockers. |
| Wider-channel adapter packet | When deciding whether Apple/Kobo/D2D/Ingram/audio should stay future-compatible but deferred. |
| `ai-story` non-port checklist | When deciding which `PMStander/ai-story` ideas to keep, rewrite, or reject. |
| Red-team risk register | When pressure appears to broaden V1 or skip blocker evidence. |
| Revision impact matrix | When Peet changes an approval field and the affected evidence docs must be named before planning. |

## Decision Options

| Peet decision | What it means | Next allowed action |
| --- | --- | --- |
| Approve as written | The recommended V1 boundary is accepted. | Write a separate Phase 1 implementation plan from the approval record, dossier, current `development` commit, and evidence packets. |
| Approve with revisions | V1 is accepted but one or more approval fields change. | Update the approval packet and affected evidence docs first, then write the Phase 1 plan. |
| Reject internal-studio V1 | The first product posture should not be PiB-operated internal production. | Reopen product positioning around client-facing or public SaaS risk. |
| Request more design detail | The current packet is not enough for a decision. | Add another design-only aid without runtime code or implementation planning. |

## What Approval Unlocks

Approval unlocks only a future implementation plan. That plan must:

- quote the final approval record,
- quote the current dossier commit,
- quote the current `development` commit at planning time,
- refresh policy-sensitive sources,
- keep KDP/Google manual handoff as the first channel focus unless revised,
- keep runtime Hermes dispatch blocked until manifests, fixtures, sanitizers, ledgers, reviewer defaults, and forbidden-action tests exist,
- preserve package QA, local publisher, portal safety, analytics confidence, and `ai-story` non-port rules, and
- include at least one pass case, one warning case, and one blocker case.

Approval does not unlock:

- runtime routes, records, APIs, UI, schemas, or Firestore collections,
- direct KDP/Google publishing,
- account-secret custody,
- client self-serve generation,
- public SaaS,
- autonomous ads,
- automated review outreach,
- automated export/file validation before package QA is implemented, or
- automated report integrations before the manual import model is proven.

## Exact Approval Response

If Peet accepts the recommended V1, use this:

> Approve Book Studio V1 as an internal PiB production studio with optional client review. Use KDP and Google Play Books manual-handoff as the first channel focus. Start with business nonfiction, activity or low-content print, series scaffolding, and a public-domain or companion negative-control fixture. Build admin-first records, gate profiles, Research/Client Document/Project/artifact bridges, publishing packet tracking, local publisher evidence lanes, controlled Hermes skill readiness, package QA evidence, and manual analytics imports. Keep self-serve generation, public SaaS, direct publishing, account-secret custody, autonomous ads, automated review outreach, full layout tooling, automated export/file validation, and automated report integrations out of V1.

## Exact Revision Shape

If Peet wants changes, use this shape:

```yaml
bookStudioV1ApprovalRevision:
  productPosture:
    choose: internal_pib_production_studio_with_optional_client_review | pib_owned_internal_studio_only | client_review_first_internal_studio
  firstPilotSet:
    add: []
    remove: []
  firstPortalReviewArtifacts:
    startWith: []
  hermesFirstScope:
    choose: wave1_only | wave1_plus_selected_wave2_docs_and_fixtures | broader_docs_only_no_runtime
  ownershipModel:
    choose: pib_owned_only | shared_pib_and_client_owned
  jurisdictionAndLocalPublisherScope:
    add: []
    remove: []
  productionReadinessScope:
    add: []
    remove: []
  analyticsScope:
    add: []
    remove: []
  firstChannels:
    add: []
    remove: []
  acceptedDeferrals:
    add: []
    remove: []
```

## Devil's Advocate

- A review index can make the packet feel done. It is not done as a product until Peet approves a V1 boundary and a separate implementation plan is written and executed.
- If Peet approves from the short path only, the later plan must still preserve the evidence appendices. The short path is a decision aid, not a weaker standard.
- If another design aid is requested, it should answer a specific unresolved question. Adding more broad packets now risks hiding the decision instead of clarifying it.

## Current Review State

Book Studio is ready for a V1 product decision, not implementation. The next human decision remains: approve the record as written, revise specific fields, reject the internal-studio posture, or request a specific design aid.
