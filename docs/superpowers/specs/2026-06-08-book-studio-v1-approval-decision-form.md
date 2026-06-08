# Book Studio V1 Approval Decision Form

**Date:** 2026-06-08
**Status:** Decision-record form only; not an implementation plan.
**Decision index:** `docs/superpowers/specs/2026-06-08-book-studio-v1-decision-index.md`
**Authoritative approval packet:** `docs/superpowers/specs/2026-06-08-book-studio-v1-approval-packet.md`
**Review scorecard:** `docs/superpowers/specs/2026-06-08-book-studio-v1-approval-review-scorecard.md`
**Review script:** `docs/superpowers/specs/2026-06-08-book-studio-v1-review-script.md`
**Revision impact matrix:** `docs/superpowers/specs/2026-06-08-book-studio-v1-approval-revision-impact-matrix.md`
**Source refresh execution report:** `docs/superpowers/specs/2026-06-08-book-studio-v1-source-refresh-execution-report.md`
**Coverage audit:** `docs/superpowers/specs/2026-06-08-book-studio-objective-coverage-audit.md`
**Market evidence model:** `docs/superpowers/specs/2026-06-08-book-studio-v1-market-evidence-model.md`
**Rights, asset, and contributor ledger model:** `docs/superpowers/specs/2026-06-08-book-studio-v1-rights-asset-contributor-ledger-model.md`
**Metadata, discoverability, and store listing model:** `docs/superpowers/specs/2026-06-08-book-studio-v1-metadata-discoverability-listing-model.md`

## Purpose

This form gives Peet one place to record the Book Studio V1 decision after reviewing the approval packet, decision index, scorecard, pilot register, revision matrix, and supporting evidence.

It is not approval for runtime Book Studio code. It does not approve routes, APIs, Firestore collections, database schemas, UI components, module toggles, Hermes runtime dispatch, direct publishing, analytics automation, or a Phase 1 task list.

## Decision Options

| Decision | Meaning | Planning posture |
| --- | --- | --- |
| `approve_as_written` | The approval packet is accepted without field changes. | Phase 1 planning can start only after the source-refresh gate is cleared and no blockers remain. |
| `approve_with_revisions` | V1 is accepted, but one or more approval fields change. | Update every affected evidence doc named by the revision impact matrix, clear source-refresh requirements, then plan. |
| `request_more_design_detail` | The current packet is not enough for a decision. | Add a design-only aid. Do not write a Phase 1 plan. |
| `reject_internal_studio_v1` | The internal PiB production-studio posture is not accepted. | Reopen product positioning. Do not write a Phase 1 plan from the current packet. |

## Copyable Decision Record

Use one decision record. Keep arrays empty when nothing applies. Do not delete the guard fields; the absence of a blocker or warning must be explicit.

```yaml
bookStudioV1Decision:
  decisionId: book-studio-v1-2026-06-08
  decision: approve_as_written
  decidedAt: "2026-06-08T00:00:00+02:00"
  decidedBy: Peet Stander
  reviewedDevelopmentCommit:
    required: true
    rule: "Use the current origin/development commit at the time Peet records this decision."
  reviewedDocs:
    decisionIndex: docs/superpowers/specs/2026-06-08-book-studio-v1-decision-index.md
    approvalPacket: docs/superpowers/specs/2026-06-08-book-studio-v1-approval-packet.md
    scorecard: docs/superpowers/specs/2026-06-08-book-studio-v1-approval-review-scorecard.md
    pilotRegister: docs/superpowers/specs/2026-06-08-book-studio-v1-pilot-product-decision-register.md
    marketEvidenceModel: docs/superpowers/specs/2026-06-08-book-studio-v1-market-evidence-model.md
    metadataListingModel: docs/superpowers/specs/2026-06-08-book-studio-v1-metadata-discoverability-listing-model.md
    rightsAssetContributorLedgerModel: docs/superpowers/specs/2026-06-08-book-studio-v1-rights-asset-contributor-ledger-model.md
    revisionImpactMatrix: docs/superpowers/specs/2026-06-08-book-studio-v1-approval-revision-impact-matrix.md
    coverageAudit: docs/superpowers/specs/2026-06-08-book-studio-objective-coverage-audit.md
  scorecardSummary:
    productPosture: pass
    firstChannels: pass
    firstPilotSet: pass
    marketEvidenceGate: pass
    metadataListingGate: pass
    bookFamilyGateCoverage: pass
    rightsAssetContributorLedger: pass
    hermesScope: pass
    publishingAndAccountGovernance: pass
    jurisdictionAndLocalPublisherEvidence: pass
    productionPackageQa: pass
    portalExposure: pass
    analyticsTrust: pass
    aiStoryIntegration: pass
    operatorWorkflow: pass
    devilAdvocateCoverage: pass
  approvedApprovalRecord:
    source: docs/superpowers/specs/2026-06-08-book-studio-v1-approval-packet.md
    productPosture: internal_pib_production_studio_with_optional_client_review
    firstChannels:
      - kdp_manual_handoff
      - google_play_books_manual_handoff
    firstPilotSet:
      - business_nonfiction_ebook
      - activity_or_low_content_print_product
      - series_scaffolding
      - public_domain_or_companion_negative_control_fixture
    firstPortalReviewArtifacts:
      - book_brief
      - proof_package_when_reviewed
      - publishing_packet_when_reviewed
      - analytics_summary_when_reconciled
    marketEvidenceScope:
      - reviewed_book_research_evidence_packet_before_production_selection
      - audience_buyer_use_case
      - competitive_shelf_observations
      - discoverability_metadata_hypotheses
      - price_margin_and_channel_fit_review
      - pass_warn_block_candidate_decision
    metadataListingScope:
      - kdp_title_subtitle_description_keywords_categories_contributors_series
      - google_title_subtitle_description_genres_contributors_identifiers_series
      - channel_specific_language_identifier_and_translated_edition_metadata
      - portal_safe_listing_summary_when_reviewed
      - no_keyword_stuffing_rank_promise_bestseller_claim_or_competitor_copy
    hermesFirstScope: wave1_planning_and_evidence_plus_selected_wave2_safety_docs_no_runtime_dispatch
    ownershipModel: shared_workflow_with_owner_type_and_account_governance
    jurisdictionAndLocalPublisherScope:
      - publisher_jurisdiction_evidence
      - south_africa_legal_deposit_evidence_lane
      - isbn_imprint_source_and_owner_decision
      - copyright_posture_and_contributor_authority
      - territory_and_local_adaptation_review
    rightsAssetContributorScope:
      - asset_level_and_contributor_level_evidence_before_dependent_states_advance
      - license_scope_ai_provenance_public_domain_open_license_and_client_asset_review
      - portal_safe_rights_summaries_only
    productionReadinessScope:
      - package_qa_evidence
      - checksum_bound_package_readiness
      - format_rights_accessibility_and_source_preflight
      - asset_and_contributor_rights_ledger_gate
    analyticsScope:
      - manual_import_ledger
      - source_confidence_labels
      - estimated_reported_settled_separation
      - reconciliation_tasks
    acceptedDeferrals:
      - no_client_self_serve_generation
      - no_public_saas_surface
      - no_direct_store_publishing
      - no_sensitive_account_secret_custody
      - no_autonomous_ad_spend
      - no_automated_review_outreach
      - no_sales_forecasting_or_rank_promises_from_market_research
      - no_runtime_metadata_optimizer_category_automation_keyword_scraping_or_listing_mutation
      - no_full_print_perfect_layout_engine
      - no_automated_export_or_file_validation_before_package_qa_is_implemented
      - no_automated_report_integrations_before_manual_import_model_is_proven
  revisionRecord:
    applies: false
    changedApprovalFields: []
    affectedEvidenceDocsUpdated: []
    blockersCreatedByRevision: []
  pilotDecision:
    firstCommercialProof: business_nonfiction_ebook
    firstPrintRiskProof: activity_or_low_content_print_product
    firstSeriesProof: series_scaffolding
    firstBlockerProof: public_domain_or_companion_negative_control_fixture
    marketEvidenceRequiredForProductionSelection: true
    marketDemandClaimsAllowedBeforeResearchPacket: false
  warningsAccepted: []
  blockersRemaining: []
  sourceRefreshRequiredBeforePlanning:
    required: true
    completed: false
    requiredSourceGroups:
      - kdp_policy_and_packet_requirements
      - google_play_books_policy_and_packet_requirements
      - language_translation_edition_sources
      - market_evidence_selection_sources
      - metadata_listing_sources
      - production_budget_capacity_sources
      - rights_asset_contributor_sources
      - local_publisher_and_jurisdiction_sources
      - launch_lifecycle_sources
      - ai_story_source_baseline
  planningAllowed: false
  planningAllowedRule: "Set true only when decision is approve_as_written or approve_with_revisions, blockersRemaining is empty, affected revision docs are updated when revisions apply, and sourceRefreshRequiredBeforePlanning.completed is true."
  whatRemainsUnapproved:
    - runtime_book_studio_routes_records_apis_components_or_database_collections
    - runtime_hermes_dispatch
    - direct_store_publishing
    - sensitive_account_secret_custody
    - client_self_serve_generation
    - public_productized_ai_book_saas
    - autonomous_ad_spend
    - automated_review_outreach
    - runtime_metadata_optimizers_listing_mutation_category_automation_or_keyword_scraping
    - automated_export_file_validation_or_package_validator_claims_before_package_qa
    - automated_report_integrations_before_manual_import_model_is_proven
    - runtime_rights_ledgers_license_automation_contract_templates_or_legal_advice_workflows
```

## Revision Record Rules

When `decision` is `approve_with_revisions`, the `revisionRecord` must name every changed approval field and every evidence document updated before planning.

At minimum, map changes through the revision impact matrix:

| Changed field | Required evidence check |
| --- | --- |
| `productPosture` | Portal access, ownership/commercial, operator workflow, and coverage audit. |
| `firstChannels` | Source refresh, wider-channel adapter, publishing/analytics, and package QA. |
| `firstPilotSet` | Pilot register, book-family gates, acceptance fixtures, mock packet, and coverage audit. |
| `marketEvidenceScope` | Market evidence model, source refresh contract, acceptance fixtures, pilot register, and coverage audit. |
| `metadataListingScope` | Metadata/listing model, source refresh contract, acceptance fixtures, review script, publishing/analytics model, and coverage audit. |
| `firstPortalReviewArtifacts` | Portal access, mock packet, acceptance fixtures, and operator workflow. |
| `hermesFirstScope` | Hermes blueprint, Hermes evaluation packet, acceptance fixtures, scorecard, and coverage audit. |
| `ownershipModel` | Ownership/commercial, jurisdiction/local publisher, publishing/analytics, and mock packet. |
| `jurisdictionAndLocalPublisherScope` | Jurisdiction/local publisher model, source refresh contract, acceptance fixtures, and coverage audit. |
| `rightsAssetContributorScope` | Rights/asset/contributor ledger model, source refresh contract, acceptance fixtures, review script, and coverage audit. |
| `productionReadinessScope` | Production package QA, rights/asset/contributor ledger model, mock packet, acceptance fixtures, and review script. |
| `analyticsScope` | Publishing/analytics, mock packet, portal access, and coverage audit. |
| `acceptedDeferrals` | Approval packet, decision index, review script, scorecard, coverage audit, and affected appendices. |

If an evidence update is not finished, set `planningAllowed: false`. Do not convert the evidence gap into an implementation task.

## Completion Tests For The Decision Record

A valid decision record must pass these checks before a Phase 1 plan is written:

1. The record names the approval packet, decision index, scorecard, pilot register, revision matrix, coverage audit, market evidence model, metadata/listing model, rights/asset/contributor ledger model, and reviewed `development` commit.
2. The selected `decision` is one of the four allowed decision options.
3. Every scorecard row is recorded as `pass`, `warn`, or `block`.
4. Every warning is listed in `warningsAccepted` or converted into a changed approval field.
5. `blockersRemaining` is empty before `planningAllowed` can be true.
6. If revisions apply, `changedApprovalFields` and `affectedEvidenceDocsUpdated` are both non-empty.
7. `sourceRefreshRequiredBeforePlanning.completed` is true before `planningAllowed` can be true, backed by a completed source refresh execution report.
8. `whatRemainsUnapproved` still excludes runtime routes, APIs, records, Firestore collections, UI, module toggles, Hermes runtime dispatch, direct publishing, analytics automation, and a Phase 1 task list.

## Devil's Advocate

- A decision form can become a rubber stamp if the scorecard rows are copied as pass without reviewing the evidence. The scorecard summary must reflect real review, not optimism.
- A warning is not a small implementation issue. It is an accepted product-risk decision and must be named.
- A blocker is not a task. If a blocker remains, the next artifact is a revised design packet or another design aid.
- Source refresh is easy to postpone because the design packet is broad. Do not write the Phase 1 plan until source-sensitive KDP, Google, language/translation, market evidence, metadata/listing, production budget/capacity, rights/asset/contributor, local publisher, launch/lifecycle, and `ai-story` baseline checks are refreshed or explicitly removed from the first plan.
- `planningAllowed: true` is a strong claim. It means the approval decision, blockers, revisions, and source-refresh gate all support writing a separate Phase 1 plan.

## Explicit Exclusions

This form does not create or approve:

- Book Studio runtime routes, APIs, records, React components, or Firestore collections.
- `settings.portalModules.bookStudio` or any module-toggle implementation.
- Admin or portal navigation.
- Runtime Hermes dispatch from PiB.
- Direct KDP, Google Play Books, Apple, Kobo, Draft2Digital, IngramSpark, ACX, Amazon Ads, or review-outreach automation.
- Client self-serve generation.
- Public/productized AI-book SaaS.
- Automated market scraping, sales forecasting, rank promises, bestseller claims, or competitor-copy reuse.
- Runtime metadata optimizers, listing mutation, category automation, keyword scraping, or direct KDP/Google listing updates.
- Automated analytics imports or report integrations.
- Runtime rights ledgers, license automation, contract templates, or legal-advice workflows.
- A Phase 1 implementation task list.

## Current Review State

Book Studio remains ready for a V1 decision record, not runtime implementation. The next approval movement is to copy this form, choose the decision outcome, record warnings and blockers honestly, clear the source-refresh gate where required, and then decide whether a separate Phase 1 implementation plan is allowed.
