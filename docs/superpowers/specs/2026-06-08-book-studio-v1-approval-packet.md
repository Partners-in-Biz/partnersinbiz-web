# Book Studio V1 Approval Packet

**Date:** 2026-06-08
**Status:** Approval packet only; not an implementation plan.
**Decision index:** `docs/superpowers/specs/2026-06-08-book-studio-v1-decision-index.md`
**Review scorecard:** `docs/superpowers/specs/2026-06-08-book-studio-v1-approval-review-scorecard.md`
**Pilot product decision register:** `docs/superpowers/specs/2026-06-08-book-studio-v1-pilot-product-decision-register.md`
**Revision impact matrix:** `docs/superpowers/specs/2026-06-08-book-studio-v1-approval-revision-impact-matrix.md`
**Approval decision form:** `docs/superpowers/specs/2026-06-08-book-studio-v1-approval-decision-form.md`
**Source refresh execution report:** `docs/superpowers/specs/2026-06-08-book-studio-v1-source-refresh-execution-report.md`
**Authoritative dossier:** `docs/superpowers/specs/2026-06-07-book-studio-research-dossier.md` at commit `d7ff96d1`.
**Decision bundle content baseline:** `ddee2021 docs(book-studio): add local publisher obligations model`.
**Coverage audit:** `docs/superpowers/specs/2026-06-08-book-studio-objective-coverage-audit.md`
**Portal access aid:** `docs/superpowers/specs/2026-06-08-book-studio-v1-portal-access-promotion-model.md`
**Production package QA aid:** `docs/superpowers/specs/2026-06-08-book-studio-v1-production-package-qa-model.md`
**Operator workspace aid:** `docs/superpowers/specs/2026-06-08-book-studio-v1-operator-workspace-control-model.md`
**Jurisdiction/local publisher aid:** `docs/superpowers/specs/2026-06-08-book-studio-v1-jurisdiction-local-publisher-model.md`
**ai-story non-port aid:** `docs/superpowers/specs/2026-06-08-book-studio-v1-ai-story-non-port-checklist.md`

## Purpose

This packet gives Peet a short decision surface for Book Studio V1. The full dossier covers research, channel constraints, book types, series, Hermes skills, publishing operations, analytics, risk, and PiB integration. This packet captures only the decision needed before a Phase 1 implementation plan can be written.

Use the review scorecard when the packet feels directionally right but a pass/warn/block decision is needed for product posture, channels, pilot set, Hermes scope, publishing governance, portal exposure, analytics trust, or devil's-advocate coverage.

Use the pilot product decision register when the open question is which first book archetypes should prove the module before any production project is selected.

Use the revision impact matrix when Peet approves with revisions and the affected evidence docs, blockers, and source-refresh triggers need to be named before any future plan is written.

Use the approval decision form when the review outcome is ready to be recorded with accepted warnings, remaining blockers, source-refresh state, and a `planningAllowed` gate.

The dossier commit shows where the primary research was last changed. The decision bundle content baseline shows the review-ready set of companion packets that shape the boundary: portal access, domain state, operator workspace, source refresh, book-family gates, ownership/commercial governance, jurisdiction/local publisher evidence, `ai-story` non-port rules, wider channels, Hermes evaluation, and production package QA. Metadata-only handoff edits after that baseline do not change the product boundary, but a future Phase 1 plan must still quote the current `development` commit at planning time and list any content revisions after this baseline.

## Recommended Approval

Approve Book Studio V1 as an internal PiB production studio with optional client review.

The first version should focus on:

- KDP and Google Play Books manual-handoff workflows.
- Business nonfiction ebooks.
- Activity/workbook or low-content print products.
- Series scaffolding.
- A public-domain or companion negative-control fixture that proves the module can block unsafe projects.
- Admin-first records, gate profiles, Research/Client Document/Project/artifact bridges, publishing packet tracking, local publisher evidence lanes, controlled Hermes skill readiness, package QA evidence, and manual analytics imports.

It should not include:

- Client self-serve generation.
- Public SaaS surface.
- Direct store publishing.
- Sensitive account-secret custody.
- Autonomous ad spend.
- Automated review outreach.
- Full print-perfect layout tooling.
- Automated export engines, file validators, package validators, or direct upload-ready claims before package QA is implemented and reviewed.
- Automated report integrations before the manual import model is proven.

## Copyable Approval Record

```yaml
bookStudioV1Approval:
  productPosture: internal_pib_production_studio_with_optional_client_review
  firstChannels:
    - kdp_manual_handoff
    - google_play_books_manual_handoff
  firstPilotSet:
    - business_nonfiction_ebook
    - activity_or_low_content_print_product
    - series_scaffolding
    - public_domain_or_companion_negative_control_fixture
  pilotDecisionRegister: docs/superpowers/specs/2026-06-08-book-studio-v1-pilot-product-decision-register.md
  firstBookTypeGateProfiles:
    - narrative_reflowable
    - nonfiction_business_how_to
    - activity_workbook_puzzle_coloring
    - low_content_print
    - children_picture_fixed_layout_fixture_only
    - public_domain_companion_rights_first_fixture_only
    - series_governance
  firstPortalReviewArtifacts:
    - book_brief
    - proof_package_when_reviewed
    - publishing_packet_when_reviewed
    - analytics_summary_when_reconciled
  hermesFirstScope:
    wave1_planning_and_evidence:
      - book-niche-research
      - book-series-strategy
      - book-brief-builder
      - book-outline-builder
    selectedWave2Safety:
      - book-generation-safety-review
      - book-metadata-optimizer
      - book-kdp-readiness-check
      - book-google-play-readiness-check
      - book-publishing-account-readiness
    wave3To5RuntimeDispatch: disabled_until_ledgers_sanitizers_fixtures_and_forbidden_action_tests_exist
  ownershipModel: shared_workflow_with_owner_type_and_account_governance
  jurisdictionAndLocalPublisherScope:
    - publisher_jurisdiction_evidence
    - south_africa_legal_deposit_evidence_lane
    - isbn_imprint_source_and_owner_decision
    - copyright_posture_and_contributor_authority
    - territory_and_local_adaptation_review
  analyticsScope:
    - manual_import_ledger
    - source_confidence_labels
    - estimated_reported_settled_separation
    - reconciliation_tasks
  productionReadinessScope:
    - package_qa_evidence
    - checksum_bound_package_readiness
    - format_rights_accessibility_and_source_preflight
  acceptedDeferrals:
    - no_client_self_serve_generation
    - no_public_saas_surface
    - no_direct_store_publishing
    - no_sensitive_account_secret_custody
    - no_autonomous_ad_spend
    - no_automated_review_outreach
    - no_full_print_perfect_layout_engine
    - no_automated_export_or_file_validation_before_package_qa_is_implemented
    - no_automated_report_integrations_before_manual_import_model_is_proven
```

## Plain-Language Approval

Peet can use this wording if the recommended V1 is acceptable:

> Approve Book Studio V1 as an internal PiB production studio with optional client review. Use KDP and Google Play Books manual-handoff as the first channel focus. Start with business nonfiction, activity or low-content print, series scaffolding, and a public-domain or companion negative-control fixture. Build admin-first records, gate profiles, Research/Client Document/Project/artifact bridges, publishing packet tracking, local publisher evidence lanes, controlled Hermes skill readiness, package QA evidence, and manual analytics imports. Keep self-serve generation, public SaaS, direct publishing, account-secret custody, autonomous ads, automated review outreach, full layout tooling, automated export/file validation, and automated report integrations out of V1.

## Safe Revisions Before Approval

| Field | Safe revision | Consequence |
| --- | --- | --- |
| `firstPilotSet` | Add `children_visual_gated_pilot`. | Phase 1 planning must bring asset-rights, fixed-layout proofing, image safety, and accessibility evidence earlier. |
| `firstPilotSet` | Remove the public-domain/companion negative-control fixture. | Faster first plan, but weaker proof that Book Studio can block attractive but unsafe projects. |
| `firstPortalReviewArtifacts` | Start with `book_brief` only. | Safer portal scope, but clients see less of the publishing workflow in early V1. |
| `hermesFirstScope` | Wave 1 only. | Safer first plan, but KDP/Google readiness, metadata, account authority, and generation safety checks become follow-up work. |
| `ownershipModel` | PiB-owned books only. | Easier account governance, but weaker fit for client-owned publishing projects. |
| `productionReadinessScope` | Limit first planning to package QA evidence only. | Safer first plan, but checksum-bound readiness, format preflight, rights/accessibility preflight, and source freshness become follow-up work. |
| `productionReadinessScope` | Add `manual_preview_rendering_fixture`. | Phase 1 planning must include a preview fixture that proves reviewed proof/package versions render consistently, without claiming automated export validation. |
| `firstChannels` | Add Apple/Kobo/D2D/Ingram/audio. | Requires additional source refresh, account governance, package, distribution-conflict, reporting, and payment research before planning. |

For revision consequences beyond this summary table, use the revision impact matrix before changing the approval record.

## What Approval Unlocks

Approval unlocks a separate Phase 1 implementation plan. It does not approve runtime coding directly.

The future Phase 1 plan must:

- Quote the final approval record and the current dossier commit.
- Quote the current `development` commit at planning time and list any design-packet content revisions after the baseline.
- Recheck the policy source register before listing tasks and record the result in the source refresh execution report.
- Map every task to the selected pilot set.
- Map evidence-sensitive tasks to the V1 evidence acceptance matrix.
- Preserve the production package QA rule that proof, file, cover, rights, accessibility, source freshness, and checksum evidence bind manual-handoff readiness to one exact package version.
- Preserve the jurisdiction/local publisher rule that KDP or Google channel readiness does not prove South African legal-deposit, ISBN/imprint, copyright, contributor-authority, or local publisher readiness.
- Preserve the `ai-story` non-port rule that prior standalone UX patterns can be reused only after keep/rewrite/reject classification and cannot bypass PiB org scope, Research, Client Documents, Projects/Kanban, portal gating, or Hermes skill governance.
- Keep runtime Hermes dispatch disabled until ledgers, sanitizers, fixtures, reviewer defaults, and forbidden-action tests exist.

## What Remains Unapproved

- Book Studio runtime routes, records, APIs, components, and database collections.
- A Phase 1 implementation task list.
- Runtime Hermes dispatch.
- Runtime export engines, file validators, package manifest records, or package QA automation.
- Direct KDP, Google Play Books, Apple, Kobo, Draft2Digital, IngramSpark, ACX, Amazon Ads, or review-outreach automation.
- Client self-serve generation.
- Public/productized AI-book SaaS.

## Decision Outcomes

| Peet decision | Next step |
| --- | --- |
| Approve as written | Write a separate Phase 1 implementation plan from this approval record and the full dossier. |
| Approve with revisions | Update this packet and affected dossier sections first, then write the Phase 1 implementation plan. |
| Reject internal-studio V1 | Stop implementation planning and reopen product positioning around client-facing or public SaaS Book Studio. |
| Request more detail | Add another design-only packet or visual/workflow aid without writing runtime code. |

## Devil's Advocate

- If approval is too broad, Phase 1 becomes channel research, file tooling, and account governance instead of a usable PiB production workflow.
- If approval is too narrow, Book Studio may under-prove creative range and rights blockers. Keep non-selected book families as gate profiles and fixtures.
- If the negative-control fixture is removed, the first plan may prove only that easy projects can pass.
- If runtime Hermes dispatch is allowed before evaluation fixtures and forbidden-action tests exist, the module can create polished but unsafe outputs faster than humans can review them.
