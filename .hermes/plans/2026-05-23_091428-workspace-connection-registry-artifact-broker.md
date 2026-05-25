# Workspace Connection Registry + Drive/Docs/Sheets Artifact Broker Implementation Plan

> For Theo/PiB: this is a planning/design artifact only. Do not implement code from this plan until the Workspace governance baseline and this Phase 2 plan are approved through the linked PiB approval gate.

Goal: add a governed Google Workspace connection registry and an MVP artifact broker that can create, copy, link, list, and audit Drive folders/files plus Docs/Sheets artifacts while PiB remains the source of truth for org scope, workflow state, approvals, and audit.

Architecture: extend the existing workspace folder registry instead of replacing it. Add three new platform-owned model areas: WorkspaceConnection for OAuth/service-account/scope registration, WorkspaceArtifact for Drive/Docs/Sheets file records/backlinks, and WorkspaceBrokerJob/WorkspaceApprovalEvent for requested side effects and audit. API routes stay org-scoped, use existing withAuth/canAccessOrg patterns, and enforce agent capability/approval gates before any external share/delete/write/send-like side effect.

Tech stack/context: Next.js App Router API routes, Firebase Admin/Firestore, googleapis, existing workspace_folders collection/routes, existing client_documents, project tasks, approvalGateTaskId/sourceDocumentId/sourceSpecVersion fields, existing lib/agents/capabilities.ts approval checks, Jest tests.

Governance baseline dependency:
- Source document: uw8MT6p6GZQQJz726qNa, current version 9lLXinpIcD7r4p6VPPpe.
- Phase 1 dependency task RbAdCl9VP9gwKdf1MmKF is done and in review with the governance checklist.
- Blocking assumptions still open on the source document: Workspace plan/features, Shared Drive model, and automation identity. Therefore implementation tasks may be designed now, but actual code rollout should remain approval-gated until those are resolved or explicitly accepted as staged constraints.

Design decisions:
1. PiB is canonical for workflow state, approvals, org/task/project links, visibility, and audit.
2. Google Workspace is the artifact/collaboration layer for Drive/Docs/Sheets assets.
3. The broker stores Google file IDs/URLs and backlinks; it does not make Google the business-state database.
4. Every route requires orgId from query/body/header and checks canAccessOrg.
5. Client-visible artifacts and Drive ACL changes are explicit actions, never a side effect of marking a folder visible in PiB.
6. Agent routes are read/prepare/draft by default. Mutating routes require an authenticated agent capability and approval context when the capability is gated.
7. MVP should support Drive/Docs/Sheets only; Gmail, Calendar, Admin SDK, NotebookLM/Vertex, and broad two-way sync stay out of scope.

Data model:

Collection: workspace_connections
Purpose: approved Google capability/credential/scope registry, not a secret store.
Fields:
- id
- orgId
- connectionKey: stable slug, unique per org where possible
- displayName
- provider: google_workspace
- connectionType: user_oauth | service_account | domain_delegation | manual_link
- status: proposed | approved | active | paused | revoked | retired
- ownerAgentId
- ownerUserId
- googleCloudProjectId
- oauthClientId
- serviceAccountEmail
- automationIdentity: peet | ops_mailbox | no_reply | service_account | tbd
- scopes: array of { scope, classification: non_sensitive | sensitive | restricted, approved: boolean, approvedBy, approvedAt, approvalGateTaskId }
- capabilities: { driveRead, driveWrite, driveShare, driveDelete, docsRead, docsWrite, sheetsRead, sheetsWrite, externalShare }
- credentialRef: { secretName, envVarName, tokenStorePath?, keyPrefix? } without raw secrets
- redirectUri
- tokenStatus: unknown | connected | expired | revoked | needs_reconnect
- reconnectInstructions
- allowedOrgIds / restrictedResourceIds if a connection is narrower than org-wide
- dataTouched: drive | docs | sheets
- approvalStatus, approvalGateTaskId
- riskLevel
- retentionRule
- rollbackPath
- lastReviewedAt, lastReviewedBy
- createdBy/createdByType/createdAt/updatedBy/updatedByType/updatedAt/deleted

Collection: workspace_artifacts
Purpose: PiB canonical registry of Google artifacts created or linked by agents/humans.
Fields:
- id
- orgId
- artifactKey: stable optional slug/idempotency key
- title
- artifactType: drive_folder | drive_file | google_doc | google_sheet | export | shortcut
- mimeType
- google: { fileId, folderId, driveId, url, webViewLink, webContentLink, parents: string[] }
- workspaceFolderId: link to workspace_folders where applicable
- connectionId
- resourceType/resourceId: project, task, client_document, research_item, seo_sprint, campaign, property, client_org, etc.
- projectId, taskId, clientDocumentId, sourceDocumentId, sourceDocumentSectionId, sourceSpecVersion, sourceResearchItemId, approvalGateTaskId
- agentId
- visibility: admin_only | admin_agents | admin_agents_clients
- lifecycleStatus: draft | internal_review | approved | client_visible | archived
- piBCanonicalUrl
- sourceTemplateArtifactId
- naming: { conventionVersion, generatedName, versionLabel }
- permissions: { externalShared: boolean, anyoneWithLink: boolean, domainShared: boolean, aclAlignmentStatus: aligned | broader_than_pib | narrower_than_pib | unknown, lastCheckedAt }
- sync: { sourceOfTruth: google_drive, syncMode: full | metadata_only | manual, syncStatus, lastSyncedAt, conflictStatus }
- checksum/export metadata where available
- audit summary fields and actor/timestamps/deleted

Collection: workspace_broker_jobs
Purpose: durable queue/audit envelope for broker operations; useful even before a worker exists.
Fields:
- id
- orgId
- operation: link_existing | create_folder | copy_template_doc | copy_template_sheet | create_doc | create_sheet | export_pdf | inventory_refresh | permission_audit | request_share | request_delete
- status: requested | awaiting_approval | queued | running | done | failed | blocked | cancelled
- connectionId
- requestedBy/createdByType
- agentId
- approvalGateTaskId, approvalStatus, requiredCapability, riskLevel
- input: operation-specific JSON with folderId/templateId/name/resource links
- output: artifactId/fileId/url or error details
- error
- attempts, nextRunAt, startedAt, completedAt
- createdAt/updatedAt

Collection: workspace_artifact_events
Purpose: append-only audit log for registry/broker actions.
Fields:
- id
- orgId
- artifactId, connectionId, brokerJobId
- eventType: registered | created | copied | linked | metadata_refreshed | permission_checked | approval_requested | approval_granted | approval_rejected | shared | deleted | archived | export_created | conflict_detected
- actorId, actorType, agentId
- approvalGateTaskId
- before/after redacted JSON
- evidence: URLs, task IDs, document IDs, Google file IDs
- createdAt

Existing collection changes:
- workspace_folders: add optional connectionId, defaultArtifactFolderId, sharedDriveId, folderKey, governance fields for permission audit status if not already represented.
- projects/tasks: keep existing sourceDocumentId/sourceSpecVersion/approvalGateTaskId/expectedArtifacts fields; no schema migration needed beyond using them consistently.
- client_documents: use linked.projectId/researchItemIds and version blocks to approve specs; no schema migration needed.

API routes:

Connection registry routes:
- GET /api/v1/workspace-connections?orgId=&status=&provider=&capability=
- POST /api/v1/workspace-connections
- GET /api/v1/workspace-connections/[id]?orgId=
- PATCH /api/v1/workspace-connections/[id]?orgId=
- DELETE /api/v1/workspace-connections/[id]?orgId=  soft revoke/retire, never delete secrets
- POST /api/v1/workspace-connections/[id]/review?orgId=  mark reviewed/approved/paused with approvalGateTaskId
- POST /api/v1/workspace-connections/[id]/reconnect?orgId=  prepare reconnect instructions; no raw token return

Artifact registry routes:
- GET /api/v1/workspace-artifacts?orgId=&resourceType=&resourceId=&projectId=&taskId=&workspaceFolderId=&type=&visibility=&status=&q=
- POST /api/v1/workspace-artifacts/link-existing  register an existing Google file/folder URL or ID
- GET /api/v1/workspace-artifacts/[id]?orgId=
- PATCH /api/v1/workspace-artifacts/[id]?orgId=  metadata only, no Google mutation unless routed through broker operation
- DELETE /api/v1/workspace-artifacts/[id]?orgId=  archive PiB registry record only by default
- GET /api/v1/agent/workspace-artifacts?orgId=&resourceType=&resourceId=&tag=&visibility=  least-privilege agent lookup

Broker operation routes:
- POST /api/v1/workspace-broker/folders/create
- POST /api/v1/workspace-broker/docs/create
- POST /api/v1/workspace-broker/docs/copy-template
- POST /api/v1/workspace-broker/sheets/create
- POST /api/v1/workspace-broker/sheets/copy-template
- POST /api/v1/workspace-broker/artifacts/[id]/export
- POST /api/v1/workspace-broker/artifacts/[id]/permission-audit
- POST /api/v1/workspace-broker/artifacts/[id]/request-share
- POST /api/v1/workspace-broker/artifacts/[id]/request-delete
- GET /api/v1/workspace-broker/jobs?orgId=&status=&operation=&artifactId=
- GET /api/v1/workspace-broker/jobs/[id]?orgId=

Admin UI surfaces:
- app/(admin)/admin/org/[slug]/settings/page.tsx: add tabs/cards for connections and registered artifacts next to current folder mappings.
- Future route: app/(admin)/admin/org/[slug]/workspace/page.tsx if settings becomes too crowded.
- Show approval status, linked task/document/research IDs, visibility, Drive ACL alignment, and broker job history.

Auth/org boundaries:
- All routes require orgId via query/body/header; body orgId must match URL/header where both are present.
- Admin users must pass canAccessOrg(user, orgId). Restricted admins only see allowed orgs.
- Client users must only read artifacts/folders for their own org and only visibility=admin_agents_clients plus lifecycleStatus=client_visible when portal exposure exists.
- AI users must use authenticated agent identity where possible, and must pass canAccessOrg.
- Agent reads filter by folder/artifact visibility and allowedAgentIds.
- Agent broker writes require assertAgentCapabilityForApiUser with requiredCapability based on operation:
  - link_existing/read/inventory/permission-audit: read or draft, usually no hard approval unless sensitive scope is used.
  - create folder/doc/sheet/copy template/export: draft or write; approval required if artifact is client-visible, touches client data, or uses a restricted/sensitive connection not approved.
  - external share/delete: publish/delete and always approval-gated.
- Legacy AI key should not be allowed to perform high-risk broker actions with allowLegacySuperKey; require agent_api_key for gated mutations before enabling external effects.
- No route returns raw OAuth refresh tokens, service-account JSON, client secrets, or generated share credentials.

Approval hooks:
- Every broker operation computes requiredCapability, riskLevel, and approvalRequirement before doing work.
- If approval is missing, create a workspace_broker_jobs record with status=awaiting_approval and return 202 with approvalRequired=true plus requiredCapability/riskLevel/proposedApprovalTask payload.
- Use existing task fields when creating/holding implementation tasks: sourceDocumentId, sourceDocumentSectionId, sourceSpecVersion, approvalGateTaskId, sourceResearchItemId, riskLevel, requiredCapability, reviewerAgentId, expectedArtifacts.
- For approval task fan-out, create Pip approval-gate tasks first, then dependent Theo/Maya/Sage/Nora tasks with agentStatus=awaiting-input and dependsOn=[approvalGateTaskId]. Immediately PATCH to awaiting-input after create because the current project task create path may initialize pending.
- Side-effect routes re-check approval at execution time, not only at job creation.
- Approval evidence must be written to workspace_artifact_events and logActivity.

Testing plan:

Model/unit tests:
- __tests__/lib/workspace-connections.test.ts: normalization rejects missing org/name, invalid scopes, secret payloads, invalid statuses; preserves credentialRef without raw secret values.
- __tests__/lib/workspace-artifacts.test.ts: normalizes Google URLs/IDs, rejects javascript URLs, enforces visibility/status enums, preserves PiB backlinks, validates artifactKey idempotency shape.
- __tests__/lib/workspace-broker/approval.test.ts: maps operations to capabilities/risk, blocks external share/delete without approved approvalGateTaskId, allows safe link_existing draft path.

API tests:
- __tests__/api/workspace-connections.test.ts: CRUD org scoping, restricted admin forbidden, body/header org mismatch rejected, soft revoke, review endpoint audit.
- __tests__/api/workspace-artifacts.test.ts: link existing artifact, list by resource/project/task, client/agent visibility filtering, metadata PATCH cannot mutate orgId, archive only.
- __tests__/api/workspace-broker.test.ts: create/copy endpoints create awaiting_approval jobs when gated, do not call Google APIs without approval, idempotency key prevents duplicate jobs, approved draft operation writes artifact and event.
- Extend __tests__/api/workspace-folders.test.ts for connectionId/defaultArtifactFolderId and ACL alignment fields if added.

Integration/worker-adjacent tests:
- Mock googleapis Drive/Docs/Sheets clients; assert no network calls in blocked/awaiting approval paths.
- Verify template copy stores sourceTemplateArtifactId and backlinks.
- Verify permission-audit marks broader_than_pib when Google ACL is broader than PiB visibility.
- Verify request-delete archives by default and requires separate approved Google delete path.

UI tests:
- Extend __tests__/app/admin-org-settings-folder-mappings.test.tsx or add workspace-connections/artifacts UI test: displays connection status, artifact links, approval state, and disabled share/delete buttons without approval.

Verification commands for implementation phase:
- npm test -- __tests__/lib/workspace-connections.test.ts __tests__/lib/workspace-artifacts.test.ts __tests__/lib/workspace-broker/approval.test.ts
- npm test -- __tests__/api/workspace-connections.test.ts __tests__/api/workspace-artifacts.test.ts __tests__/api/workspace-broker.test.ts
- npm test -- __tests__/api/workspace-folders.test.ts
- npm run build, with NODE_OPTIONS=--max-old-space-size=6144 NEXT_PRIVATE_BUILD_WORKER=1 npm run build if the shared VPS hits Next.js heap pressure.

Rollout plan:

Phase 2A: schema and read-only registry
- Add model files and tests.
- Add admin-only connection registry CRUD and read-only artifact registry/link-existing.
- No Google API writes beyond validation-free manual links.
- Seed no secrets. Existing folder registry remains unchanged.

Phase 2B: broker job envelope and approval checks
- Add workspace_broker_jobs and workspace_artifact_events helpers.
- Add broker routes that create jobs and return awaiting_approval for gated operations.
- Wire project approval metadata into job/event records.
- Still do not perform Google external side effects unless test-approved and mocked.

Phase 2C: low-risk Drive/Docs/Sheets MVP
- Enable approved create folder, create doc/sheet, copy template into internal/admin-only folders.
- Register resulting artifacts with backlinks.
- Use a single approved parent-workspace connection only after Peet confirms automation identity and plan constraints.
- No external share/delete. No client portal exposure by default.

Phase 2D: permission audit and admin UI
- Add Drive permission read/audit for registered artifacts.
- Surface ACL alignment and audit events in admin UI.
- Add manual operator review before any client-visible state.

Phase 2E: controlled client-workspace pilot
- Pick one low-risk internal/client workspace folder.
- Use approval-gated create/copy flows.
- Verify org boundaries, artifacts, audit, and rollback.
- Produce a rollout report before allowing broader use.

Rollback plan:
- Disable broker mutating routes via env/feature flag WORKSPACE_BROKER_WRITES_ENABLED=false.
- Pause/revoke workspace_connections records without deleting audit history.
- Archive or hide workspace_artifacts records if bad metadata is created; do not delete Google files automatically.
- Revoke Google OAuth/service-account credentials manually using the credentialRef/reconnectInstructions/rollbackPath.
- Keep workspace_artifact_events append-only for investigation.

Open questions before implementation:
1. Which Workspace plan/security features are available?
2. Which Shared Drive model is approved: per client, single Client Workspaces drive, or hybrid?
3. Which automation identity owns broker-created artifacts?
4. Which Google OAuth scopes can be approved for MVP: Drive file-only, Docs, Sheets, or broader Drive metadata?
5. Should external share/delete be excluded entirely from MVP even behind approval gates?
6. Should artifact records be visible in the client portal in this phase, or admin-only until a separate portal approval?

Proposed implementation task breakdown after approval:
1. Add workspace connection model/tests.
2. Add workspace artifact model/tests.
3. Add broker approval-policy helper/tests.
4. Add connection registry API routes/tests.
5. Add artifact registry link/list/update/archive routes/tests.
6. Add broker job/event helpers/tests.
7. Add broker draft routes with approval-blocked behavior/tests.
8. Add Google client adapter with mocked Drive/Docs/Sheets tests.
9. Enable internal approved create/copy operations/tests.
10. Add admin UI for connections/artifacts/jobs/tests.
11. Add permission-audit route/tests.
12. Add rollout docs and operator runbook updates.

Acceptance criteria:
- A reviewer can see exactly which Firestore collections, routes, gates, and tests will be added.
- Every broker-created artifact will have orgId, project/task/source document backlinks, visibility, lifecycle status, Google fileId/url, approvalGateTaskId where needed, and audit events.
- No client-visible sharing, permanent delete, external invite, email send, admin mutation, or broad AI ingestion can happen without an explicit approval record.
- Existing workspace_folders behavior remains compatible and gains only additive links.
- Implementation remains paused until approval gates clear.
