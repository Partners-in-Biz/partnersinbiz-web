# Book Studio V1 Hermes Skill Contract Pack

**Date:** 2026-06-08
**Status:** Design-only Hermes skill contract pack; not skill implementation and not an implementation plan.
**Authoritative approval packet:** `docs/superpowers/specs/2026-06-08-book-studio-v1-approval-packet.md`
**Hermes blueprint:** `docs/superpowers/specs/2026-06-08-book-studio-v1-hermes-skill-blueprint.md`
**Hermes evaluation packet:** `docs/superpowers/specs/2026-06-08-book-studio-v1-hermes-skill-evaluation-packet.md`
**Acceptance fixtures:** `docs/superpowers/specs/2026-06-08-book-studio-v1-acceptance-fixtures.md`
**Source refresh contract:** `docs/superpowers/specs/2026-06-08-book-studio-v1-source-refresh-contract.md`
**Source refresh execution report:** `docs/superpowers/specs/2026-06-08-book-studio-v1-source-refresh-execution-report.md`
**ai-story non-port checklist:** `docs/superpowers/specs/2026-06-08-book-studio-v1-ai-story-non-port-checklist.md`
**Launch/lifecycle governance model:** `docs/superpowers/specs/2026-06-08-book-studio-v1-launch-lifecycle-governance-model.md`
**Market evidence model:** `docs/superpowers/specs/2026-06-08-book-studio-v1-market-evidence-model.md`

## Purpose

The Hermes skill blueprint names the recommended first skills. The evaluation packet defines pass, warn, block, and forbidden-action expectations. This contract pack adds the missing middle layer: copyable per-skill contract records that future skill specs, manifests, and tests can quote after Peet approves or revises the Book Studio V1 approval record.

This file does not create `.claude/skills`, `.codex/skills`, Hermes runtime manifests, app routes, APIs, Firestore collections, UI, module toggles, runtime dispatch, direct publishing, analytics automation, or a Phase 1 task list.

## Contract Posture

All contracts in this pack are `proposed_contract_only`. They are review inputs, not runnable skills.

Default rules:

- Missing or stale official source evidence blocks any source-dependent readiness, publishing, metadata, analytics, or channel claim.
- Hermes output remains internal unless a human reviewer promotes a rewritten artifact version.
- Every skill must return a bounded artifact, checklist, report, blocker, or task suggestion.
- Every selected skill must refuse publishing, upload, public send, client message, credential, approval, live listing mutation, price, promotion, ad-spend, and review-outreach requests.
- Every selected skill must preserve warnings instead of smoothing them into polished copy.
- `PMStander/ai-story` is design evidence only. It is never a publishing policy source, runtime dependency, or shortcut around PiB org, portal, Project, Research, Client Document, or Hermes governance.

## Copyable Contract Envelope

```yaml
bookStudioV1HermesSkillContracts:
  contractPackId: book-studio-v1-hermes-skill-contracts-2026-06-08
  status: proposed_contract_only
  approvalGate:
    approvalRecordRequired: true
    sourceRefreshRequiredBeforePlanning: true
    runtimeDispatchAllowed: false
    implementationPlanAllowed: false
  defaultForbiddenActions:
    - publish_or_upload_to_store
    - direct_store_api_call
    - request_or_store_credentials
    - request_tax_bank_identity_or_recovery_data
    - approve_client_or_release_state
    - mark_upload_ready_without_evidence
    - message_client_or_public_audience
    - spend_or_allocate_ad_budget
    - automated_review_outreach
    - change_live_price_promotion_metadata_or_listing
    - promise_market_demand_sales_rank_or_bestseller_status
    - copy_competitor_metadata_or_content
    - expose_raw_hermes_output_to_portal
    - replace_official_source_refresh
    - use_ai_story_as_policy_source
  defaultReviewer: pib_admin
  defaultPortalVisibility: internal_only_until_promoted_reviewed_artifact
```

## Contract Field Template

Every future Book Studio skill spec should copy this field shape before implementation planning names the skill as a runtime candidate.

| Field | Required meaning |
| --- | --- |
| `skillKey` | Stable skill key used in docs, manifests, fixture reports, audit logs, and future task records. |
| `status` | `proposed_contract_only` until Peet approves V1 and a later implementation plan writes runnable skill work. |
| `phase` | Skill wave and intended V1 role. |
| `allowedInputs` | Reviewed record or artifact inputs that may trigger the skill. No blank prompt by default. |
| `requiredSourceKeys` | Source refresh keys or gate profiles the skill depends on. Use `none` only when the skill has no source-sensitive claim. |
| `requiredExistingArtifacts` | Project, Research, Book Brief, gate, packet, package, generation run, account, or analytics artifacts that must exist before the skill can run. |
| `allowedOutputs` | Exact output categories the skill may produce. |
| `forbiddenActions` | Skill-specific forbidden actions, in addition to the default forbidden actions. |
| `reviewerDefault` | Human reviewer role that receives output before client promotion or release-sensitive use. |
| `portalVisibility` | Client-safe visibility rule, if any. |
| `passFixtures` | Fixture IDs that prove normal useful output. |
| `warnFixtures` | Fixture IDs that prove warnings are preserved. |
| `blockFixtures` | Fixture IDs that prove unsafe or unsupported work is blocked. |
| `forbiddenFixtures` | Fixture IDs that prove release-sensitive forbidden requests are refused. |
| `staleSourceBehavior` | What happens when an official source key is stale, unavailable, missing, or changed. |
| `writesRuntimeData` | `false` in this pack. |
| `canTriggerPublishing` | `false` in this pack. |

## Wave 1 Planning And Evidence Contracts

### `book-niche-research`

```yaml
skillKey: book-niche-research
status: proposed_contract_only
phase: wave1_planning_and_evidence
ownerAgent: Sage
allowedInputs:
  - book_intake
  - target_audience
  - client_objective
  - selected_book_family_gate
  - approved_research_lanes
requiredSourceKeys:
  - source-refresh-contract
  - book-family-gate-catalog
  - market-evidence-model
  - kdp-keywords-discoverability
  - kdp-categories-discoverability
  - kdp-search-results
  - kdp-content-quality
  - google-metadata
  - google-content-policies
requiredExistingArtifacts:
  - bookProjectDraft
  - intakeSummary
allowedOutputs:
  - internalResearchItem
  - marketEvidencePacketDraft
  - confidenceLabeledFinding
  - candidateSelectionWarning
  - candidateSelectionBlocker
  - unsupportedClaimWarning
  - reviewerQuestion
  - taskSuggestion
forbiddenActions:
  - invent_bestseller_claims
  - predict_sales_rank_royalties_or_market_demand
  - copy_competitor_metadata_or_content
  - recommend_misleading_categories_or_keyword_stuffing
  - mark_candidate_production_selectable
  - cite_model_memory_as_source_evidence
  - create_client_ready_copy
  - recommend_channel_launch
reviewerDefault: research_lead
portalVisibility: hidden_unless_rewritten_into_reviewed_book_brief
passFixtures:
  - HERMES-BNF-PASS-001
  - MARKET-PASS-001
warnFixtures:
  - HERMES-SOURCE-WARN-001
  - MARKET-WARN-001
  - MARKET-WARN-002
blockFixtures:
  - HERMES-RIGHTS-BLOCK-001
  - MARKET-BLOCK-001
  - MARKET-BLOCK-002
  - MARKET-BLOCK-003
forbiddenFixtures:
  - HERMES-FORBID-001
staleSourceBehavior: warn_for_internal_findings_and_block_any_client_promise_or_channel_readiness_claim
writesRuntimeData: false
canTriggerPublishing: false
```

Devil's advocate: niche research is where unsupported optimism enters the workflow. This skill should make uncertainty visible instead of turning thin evidence into a client promise.

### `book-series-strategy`

```yaml
skillKey: book-series-strategy
status: proposed_contract_only
phase: wave1_planning_and_evidence
ownerAgent: Sage
supportingAgent: Iris
allowedInputs:
  - series_intent
  - selected_book_family_gate
  - book_one_scope
  - channel_intent
requiredSourceKeys:
  - kdp-series
  - google-series
  - book-family-gate-catalog
requiredExistingArtifacts:
  - bookProjectDraft
  - seriesIntent
allowedOutputs:
  - internalSeriesStrategy
  - continuityBibleFieldList
  - volumeOrderRecommendation
  - externalEligibilityWarning
  - taskSuggestion
forbiddenActions:
  - mark_future_volumes_viable
  - mark_future_volumes_client_ready
  - claim_external_series_eligibility_without_current_channel_evidence
reviewerDefault: production_lead
portalVisibility: reviewed_series_brief_only
passFixtures:
  - HERMES-SERIES-PASS-001
warnFixtures:
  - HERMES-SERIES-WARN-001
blockFixtures:
  - HERMES-SOURCE-WARN-001
forbiddenFixtures:
  - HERMES-FORBID-001
staleSourceBehavior: allow_internal_continuity_planning_but_block_external_KDP_or_Google_series_claims
writesRuntimeData: false
canTriggerPublishing: false
```

Devil's advocate: a series scaffold can make future books look approved. The contract must keep book one and future-volume viability separate.

### `book-brief-builder`

```yaml
skillKey: book-brief-builder
status: proposed_contract_only
phase: wave1_planning_and_evidence
ownerAgent: Iris
allowedInputs:
  - reviewed_research_packet
  - client_goal
  - ownership_model
  - first_channel_scope
  - selected_book_family_gate
requiredSourceKeys:
  - source-refresh-contract
  - book-family-gate-catalog
  - ownership-commercial-model
requiredExistingArtifacts:
  - researchPacket
  - ownershipDecision
  - bookFamilyGateProfile
allowedOutputs:
  - internalBookBriefDraft
  - reviewQuestionList
  - explicitAssumptionList
  - acceptedDeferralList
  - clientDocumentDraftAfterHumanReview
forbiddenActions:
  - ask_client_to_approve_raw_hermes_output
  - embed_unresolved_rights_uncertainty_as_client_promise
  - expose_internal_strategy_notes_to_portal
  - change_product_posture_or_channel_scope
reviewerDefault: account_lead
portalVisibility: promoted_client_document_version_only
passFixtures:
  - HERMES-BNF-PASS-001
warnFixtures:
  - HERMES-BRIEF-WARN-001
blockFixtures:
  - HERMES-RIGHTS-BLOCK-001
forbiddenFixtures:
  - HERMES-FORBID-CLIENT-001
staleSourceBehavior: block_client_promotion_when_source_or_rights_evidence_affects_the_core_promise
writesRuntimeData: false
canTriggerPublishing: false
```

Devil's advocate: a polished Book Brief can hide unresolved risk. The brief builder should preserve review questions until a human rewrites them into client-safe commitments.

### `book-outline-builder`

```yaml
skillKey: book-outline-builder
status: proposed_contract_only
phase: wave1_planning_and_evidence
ownerAgent: Iris
supportingAgent: Maya
allowedInputs:
  - internally_reviewed_book_brief
  - selected_book_family_gate
  - series_state
  - approved_book_promise
requiredSourceKeys:
  - book-family-gate-catalog
requiredExistingArtifacts:
  - bookBriefDraft
  - bookFamilyGateProfile
allowedOutputs:
  - chapterMap
  - pagePlan
  - assetNeedList
  - answerKeyReviewNeed
  - proofingTaskSuggestion
  - briefRevisionBlocker
forbiddenActions:
  - start_draft_generation
  - change_audience_promise_family_or_channel_scope
  - hide_low_content_or_activity_warnings
  - create_upload_ready_structure_claim
reviewerDefault: production_lead
portalVisibility: reviewed_outline_summary_only
passFixtures:
  - HERMES-BNF-PASS-001
  - HERMES-SERIES-PASS-001
warnFixtures:
  - HERMES-LOW-WARN-001
blockFixtures:
  - HERMES-RIGHTS-BLOCK-001
forbiddenFixtures:
  - HERMES-FORBID-001
staleSourceBehavior: warn_for_internal_structure_and_block_any_channel_or_package_readiness_claim
writesRuntimeData: false
canTriggerPublishing: false
```

Devil's advocate: an outline can become a hidden scope change. If it changes the approved promise, the output should be a brief revision blocker, not a better-looking outline.

## Selected Wave 2 Safety And Readiness Contracts

### `book-generation-safety-review`

```yaml
skillKey: book-generation-safety-review
status: proposed_contract_only
phase: selected_wave2_safety_and_readiness
ownerAgent: Quinn
supportingAgent: Pip
allowedInputs:
  - prompt_sample
  - output_sample
  - generation_run_metadata
  - artifact_version
  - intended_visibility
requiredSourceKeys:
  - book-family-gate-catalog
  - source-refresh-contract
requiredExistingArtifacts:
  - generationRunRecord
  - artifactVersion
  - visibilityIntent
allowedOutputs:
  - safetyReviewReport
  - passStateForExactArtifactVersion
  - warningState
  - blockerState
  - nextActionList
forbiddenActions:
  - approve_output_for_publishing
  - launder_unsafe_text_into_client_safe_wording
  - remove_warnings_because_output_reads_well
  - promote_unreviewed_output_to_portal
reviewerDefault: safety_reviewer
portalVisibility: safe_blocker_or_reviewed_summary_only
passFixtures:
  - HERMES-SAFETY-PASS-001
warnFixtures:
  - HERMES-SAFETY-WARN-001
blockFixtures:
  - HERMES-RIGHTS-BLOCK-001
forbiddenFixtures:
  - HERMES-FORBID-CLIENT-001
staleSourceBehavior: block_publishing_or_portal_promotion_when_source_freshness_affects_safety_or_rights_claims
writesRuntimeData: false
canTriggerPublishing: false
```

Devil's advocate: safety review is not copyediting. It must stop unsafe promotion even when the output is attractive and commercially useful.

### `book-metadata-optimizer`

```yaml
skillKey: book-metadata-optimizer
status: proposed_contract_only
phase: selected_wave2_safety_and_readiness
ownerAgent: Sage
supportingAgent: Maya
allowedInputs:
  - research_packet
  - book_brief
  - channel_intent
  - selected_book_family_gate
  - source_evidence
requiredSourceKeys:
  - kdp-content-ai-ip
  - kdp-low-content
  - kdp-series
  - google-program-policies
  - google-series
requiredExistingArtifacts:
  - researchPacket
  - bookBriefDraft
  - channelIntent
allowedOutputs:
  - metadataOptionPacket
  - titleSubtitleOption
  - descriptionNote
  - categoryKeywordRationale
  - metadataWarning
forbiddenActions:
  - use_misleading_categories
  - use_keyword_stuffing
  - use_competitor_names_as_affiliation_or_keywords
  - imply_bestseller_or_guaranteed_outcome
  - write_final_upload_metadata_without_review
reviewerDefault: publishing_reviewer
portalVisibility: reviewed_metadata_recommendation_only
passFixtures:
  - HERMES-BNF-PASS-001
warnFixtures:
  - HERMES-METADATA-WARN-001
blockFixtures:
  - HERMES-RIGHTS-BLOCK-001
forbiddenFixtures:
  - HERMES-FORBID-LISTING-001
staleSourceBehavior: block_channel_specific_metadata_recommendations_when_required_channel_rules_are_stale
writesRuntimeData: false
canTriggerPublishing: false
```

Devil's advocate: metadata optimization is a trust boundary. It should not turn search pressure into misleading categories, stuffed keywords, or unsupported claims.

### `book-kdp-readiness-check`

```yaml
skillKey: book-kdp-readiness-check
status: proposed_contract_only
phase: selected_wave2_safety_and_readiness
ownerAgent: Quinn
allowedInputs:
  - kdp_packet_draft
  - file_intent
  - metadata_packet
  - pricing_draft
  - ai_disclosure_evidence
  - account_authority
requiredSourceKeys:
  - kdp-content-ai-ip
  - kdp-low-content
  - kdp-series
  - kdp-print-options
requiredExistingArtifacts:
  - publishingPacketDraft
  - packageIntent
  - metadataOptionPacket
  - ownershipDecision
  - sourceRefreshEvidence
allowedOutputs:
  - kdpReadinessReport
  - manualUploadChecklist
  - warningState
  - blockerState
  - reviewerQuestion
forbiddenActions:
  - publish_upload_or_submit_to_kdp
  - claim_kdp_acceptance
  - request_or_store_kdp_credentials
  - mark_upload_ready_without_complete_current_evidence
reviewerDefault: publishing_reviewer
portalVisibility: safe_packet_summary_only_after_review
passFixtures:
  - HERMES-KDP-PASS-001
warnFixtures:
  - HERMES-LOW-WARN-001
  - HERMES-SOURCE-WARN-001
blockFixtures:
  - HERMES-RIGHTS-BLOCK-001
forbiddenFixtures:
  - HERMES-FORBID-PUBLISH-001
  - HERMES-FORBID-CREDENTIAL-001
staleSourceBehavior: block_upload_ready_or_manual_handoff_ready_status_until_all_required_kdp_source_keys_are_current
writesRuntimeData: false
canTriggerPublishing: false
```

Devil's advocate: a KDP readiness report can be mistaken for permission to upload. This contract only permits a checklist and reviewer questions.

### `book-google-play-readiness-check`

```yaml
skillKey: book-google-play-readiness-check
status: proposed_contract_only
phase: selected_wave2_safety_and_readiness
ownerAgent: Quinn
allowedInputs:
  - google_packet_draft
  - file_intent
  - identifier_plan
  - metadata_packet
  - pricing_draft
  - account_authority
requiredSourceKeys:
  - google-program-policies
  - google-add-book
  - google-series
  - google-service-provider
requiredExistingArtifacts:
  - publishingPacketDraft
  - packageIntent
  - metadataOptionPacket
  - ownershipDecision
  - sourceRefreshEvidence
allowedOutputs:
  - googleReadinessReport
  - partnerCenterChecklist
  - channelSeparationWarning
  - blockerState
  - reviewerQuestion
forbiddenActions:
  - upload_to_partner_center
  - request_or_store_google_account_secrets
  - infer_google_readiness_from_kdp_readiness
  - claim_google_acceptance
reviewerDefault: publishing_reviewer
portalVisibility: safe_packet_summary_only_after_review
passFixtures:
  - HERMES-GOOGLE-PASS-001
warnFixtures:
  - HERMES-GOOGLE-WARN-001
  - HERMES-SOURCE-WARN-001
blockFixtures:
  - HERMES-RIGHTS-BLOCK-001
forbiddenFixtures:
  - HERMES-FORBID-PUBLISH-001
  - HERMES-FORBID-CREDENTIAL-001
staleSourceBehavior: block_google_readiness_claims_until_required_google_source_keys_are_current
writesRuntimeData: false
canTriggerPublishing: false
```

Devil's advocate: Google readiness is not a copy of KDP readiness. The skill must preserve channel separation even when that creates extra work.

### `book-publishing-account-readiness`

```yaml
skillKey: book-publishing-account-readiness
status: proposed_contract_only
phase: selected_wave2_safety_and_readiness
ownerAgent: Quinn
supportingAgent: Pip
allowedInputs:
  - ownership_model
  - channel_intent
  - account_authority_summary
  - consent_artifacts
  - access_boundary
requiredSourceKeys:
  - google-service-provider
  - ownership-commercial-model
  - jurisdiction-local-publisher-model
requiredExistingArtifacts:
  - ownershipDecision
  - consentArtifact
  - accountAuthoritySummary
allowedOutputs:
  - accountReadinessReport
  - passState
  - warningState
  - blockerState
  - governanceTask
  - recheckDate
forbiddenActions:
  - request_store_transmit_or_summarize_passwords
  - request_tax_bank_identity_or_recovery_data
  - blur_pib_owned_client_owned_or_shared_authority
  - claim_account_authority_without_evidence
reviewerDefault: operations_owner
portalVisibility: safe_account_setup_pending_or_ready_label_only
passFixtures:
  - HERMES-ACCOUNT-PASS-001
warnFixtures:
  - HERMES-ACCOUNT-WARN-001
blockFixtures:
  - HERMES-ACCOUNT-BLOCK-001
forbiddenFixtures:
  - HERMES-FORBID-CREDENTIAL-001
staleSourceBehavior: block_publishing_readiness_when_account_authority_or_service_provider_evidence_is_stale_or_missing
writesRuntimeData: false
canTriggerPublishing: false
```

Devil's advocate: account readiness is where operational convenience can become credential custody. The skill must create governance tasks, not ask for secrets.

## Deferred Contract Stubs

These skill families stay named for future compatibility but are not part of the first contract detail set unless Peet revises the approval record.

| Skill key | Current status | Reason deferred |
| --- | --- | --- |
| `book-production-package-qa` | deferred_contract_stub | Needs package manifests, checksum binding, proof rules, file identity, and package QA implementation boundaries first. |
| `book-launch-plan-builder` | deferred_contract_stub | Public launch activity, review requests, client messages, ads, budget decisions, price windows, and promo-code distribution are release-sensitive. Use the launch/lifecycle governance model before expanding this stub. |
| `book-analytics-import-review` | deferred_contract_stub | Manual analytics import model exists, but runtime parser/importer work remains unapproved. |
| `book-review-risk-monitor` | deferred_contract_stub | Review outreach and monitoring can create compliance risk. The launch/lifecycle governance model keeps it as internal compliance review only. |
| `book-lifecycle-ops` | deferred_contract_stub | Live listing changes, price changes, revisions, unpublish decisions, and post-launch updates require approval and evidence gates. |

Deferred stubs may be expanded only through another design-only aid or through an approved implementation plan that quotes the final approval record.

## Dependency Sequence

| Step | Required before | Unlocks |
| --- | --- | --- |
| Approval decision record | Any Phase 1 plan. | Defines exact V1 scope and accepted warnings. |
| Source refresh execution report | Any source-sensitive task list. | Confirms whether KDP, Google, local publisher, and `ai-story` source assumptions still hold. |
| `book-niche-research` contract | Brief, metadata, and readiness tasks. | Evidence-aware Research items and warnings. |
| `book-series-strategy` contract | Series scaffold and rollup planning. | Continuity tasks without future-volume approval. |
| `book-brief-builder` contract | Portal Book Brief and outline work. | Reviewable brief draft with unresolved risks preserved. |
| `book-outline-builder` contract | Manuscript/page production planning. | Structure and production tasks tied to approved scope. |
| `book-generation-safety-review` contract | Client or publishing promotion of generated output. | Safety pass, warning, or block state for exact artifact version. |
| `book-metadata-optimizer` contract | KDP or Google readiness checks. | Reviewed metadata options, not final store listing mutation. |
| `book-kdp-readiness-check` contract | Manual KDP handoff review. | KDP checklist and blockers, no upload. |
| `book-google-play-readiness-check` contract | Manual Google handoff review. | Google checklist and blockers, no upload. |
| `book-publishing-account-readiness` contract | Any channel readiness claim. | Account authority state without secrets. |

## Contract Completion Tests

A future implementation plan should not name a skill runtime-ready unless these contract checks are preserved:

1. Every selected skill has `requiredSourceKeys` or explicitly records `none`.
2. Every selected skill includes the default forbidden actions plus skill-specific forbidden actions.
3. Every selected skill has pass, warn, block, and forbidden-action fixture IDs.
4. Every selected skill records `writesRuntimeData: false` and `canTriggerPublishing: false` until a later approved plan changes that with tests.
5. Every selected skill has a reviewer default and a portal visibility rule.
6. Stale source behavior blocks readiness, publishing, metadata, analytics, or client-promise claims that depend on stale evidence.
7. No contract turns a design field into an implementation task, Firestore schema, route map, UI component, or skill file path.
8. `ai-story` remains a source of product lessons only and cannot satisfy policy, channel, account, or rights evidence.
9. Forbidden-action fixtures block direct publishing, account-secret handling, client messaging, public sends, ad spend, review outreach, live listing mutation, approval-state changes, and raw portal output.

## Exclusions

This contract pack does not approve:

- `settings.portalModules.bookStudio` or any module-toggle implementation.
- Book Studio admin or portal navigation.
- Book Studio Firestore collections, DTOs, route handlers, server actions, or React components.
- Runtime Hermes dispatch from PiB.
- Runtime skill files, skill manifests, fixture runners, or sanitizer implementation.
- Direct KDP, Google Play Books, Apple, Kobo, Draft2Digital, IngramSpark, ACX, Amazon Ads, or review-outreach automation.
- Sensitive account-secret custody.
- Automated export, file, package, or report validation.
- Client self-serve generation or public AI-book SaaS.
- A Phase 1 task list.

## Current Review State

Book Studio now has a reviewable contract layer between Hermes skill naming and future skill implementation. The next product decision remains Peet approving, revising, rejecting, or requesting more design detail on the V1 approval record. If Peet approves or revises the record, a reviewer must still run the source refresh execution report before any Phase 1 implementation plan can be written.
