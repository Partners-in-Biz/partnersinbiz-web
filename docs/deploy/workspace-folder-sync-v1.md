# Workspace folder sync v1 — developer/operator runbook

Status: v1 operating policy
Project: Cross-client Agent Orchestration & System Documents (`7LZFekmyZcTrOyCZbvjt`)
Approved spec: `deACCRbjMnt9W9Op7sc9` version `h87c34vdjvYwCKqEq2MT`
Source task: `7Ya8dqZdvgSohHsUDPdN`
Owner: Theo

This runbook documents how Partners in Biz should treat workspace folder records, Google Drive assets, VPS/local mirrors, conflict handling, and agent lookup usage for v1.

## 1. Canonical model

PiB should not model a client/workspace as having one fixed folder. A workspace or resource may have many linked folders, each with its own visibility, Drive mapping, sync target, ordering, tags, hierarchy, and audit state.

Each folder record should be tenant-scoped and include at least:

- `orgId`
- `resourceType` and `resourceId` when attached to a client org, project, document, campaign, CRM record, or other resource
- `name`
- `parentId` for folder hierarchy
- `tags` for stable lookup keys such as `brief`, `assets`, `raw`, `exports`, `client-visible`, `admin-private`
- `sortOrder`
- `visibility`: `admin_only`, `admin_agents`, or `admin_agents_clients`
- `drive.folderId` and/or `drive.folderUrl`
- `paths.vpsPath` and `paths.localPathHint`
- `sourceOfTruth`, normally `google_drive` for binary/source assets
- `syncMode`, normally `full` for v1 workspace asset sync
- `syncTargets`, supporting both `vps` and `local`
- `syncState`: status, last sync time, last error, conflict count
- `audit`: conflict status, last conflict time, notes/evidence

Implementation note: Drive folder links must be attachable wherever the admin needs them. Do not hard-code a single client root, one fixed Drive parent, or a single-folder-per-client assumption.

## 2. Visibility and permissions

Visibility is per folder, not per workspace.

Supported v1 visibility scopes:

- `admin_only`: internal operations only. Agents and clients do not read it by default.
- `admin_agents`: admins and permitted agents can read it. Clients cannot.
- `admin_agents_clients`: admins, permitted agents, and clients can read it through the app or portal.

The safest practical model is hybrid:

- PiB roles and folder `visibility` decide what the app and agents can see.
- Google Drive ACLs must not accidentally expose private admin/agent folders to clients.
- Client-visible app state does not imply the underlying Drive folder should be publicly shared.
- If Drive ACL mirroring is added later, it must be explicit, audited, and narrower than or equal to PiB visibility.

Operator checklist before making a folder client-visible:

1. Confirm the folder record has `visibility: admin_agents_clients`.
2. Confirm the Drive folder does not inherit broader permissions from a parent folder that exposes admin/agent-only siblings.
3. Confirm all child folders and files are intended for client access.
4. Add an audit note or activity entry explaining why visibility was changed.

## 3. Sync behaviour in v1

V1 sync is full workspace asset sync for linked folder records, with Google Drive as the source of truth for binary/source assets.

Expected behaviour:

- A folder record may sync to both Peet's local Cowork environment and the VPS Cowork environment.
- `syncTargets` can include `vps`, `local`, or both.
- Sync copies actual file content for the folder scope. It is not metadata-only.
- Sync state must be recorded on the folder record or in linked audit records.
- Operators must be able to see last successful sync, pending/manual sync request, errors, and conflict state.
- Failed sync must not silently overwrite local, VPS, or Drive content.

Recommended v1 statuses:

- `idle`: no sync currently needed
- `pending`: sync requested or queued
- `syncing`: worker has claimed sync
- `synced`: last sync completed successfully
- `error`: sync failed without a file conflict
- `conflict`: sync found competing changes that need review
- `paused`: sync disabled by operator decision

## 4. Conflict handling

Do not implement blind last-writer-wins for workspace assets.

Safe v1 policy:

1. Detect conflicts using available evidence: file id/path, modified time, size/hash where available, source side, and last known sync marker.
2. If both Drive and a mirror changed since last successful sync, mark the folder or file as `conflict`.
3. Preserve both versions. Do not overwrite either side automatically.
4. Write an audit entry with the source paths, timestamps, proposed resolution options, and responsible operator.
5. Surface the conflict in the admin folder/audit UI and agent context.
6. Require a human/operator resolution: keep Drive, keep VPS/local, create copy, or manually merge.
7. After resolution, record who resolved it, when, which version won, and any evidence links.

Conflict records should include:

- `folderId`
- `orgId`
- `resourceType` / `resourceId` if available
- `relativePath`
- `driveFileId`
- `driveModifiedAt`
- `mirrorTarget`: `vps` or `local`
- `mirrorPath`
- `mirrorModifiedAt`
- `status`: `open`, `resolved`, or `ignored`
- `resolution`: `drive_wins`, `mirror_wins`, `manual_merge`, `copied_as_new`, or `ignored`
- `resolvedBy` / `resolvedAt`
- `evidence` links or notes

## 5. Google Drive binary/source asset policy

Google Drive is canonical for binary/source assets.

Examples that belong in Drive:

- images, logos, screenshots, design exports
- PDFs, signed docs, decks, spreadsheets
- videos, audio, source creative files
- downloaded asset packs and client uploads
- large raw research/source files that are not plain markdown notes

Examples that belong in Obsidian/wiki:

- markdown notes
- text summaries
- decisions and runbooks
- source links
- lightweight structured notes
- logs and handoffs

Do not write binaries into the Obsidian vault or git repo as a convenience. Store the file in Drive, then link its Drive folder/file id from the relevant folder record, wiki note, project doc, task comment, or client document.

VPS/local mirrors are working copies and caches. They are not the canonical owner of binaries unless a future approved spec explicitly changes this rule.

## 6. Folder lookup usage by agents and skills

Agents and skills should not guess or hard-code folder paths when a folder record exists.

Required lookup pattern:

1. Read task context and resolve `orgId`.
2. If working inside a project, read project context first with `GET /api/v1/agent/project/{projectId}`.
3. Look up folders by stable filters: `orgId`, `resourceType`, `resourceId`, `tags`, `visibility`, and optionally `syncTarget`.
4. Pick the least-privileged folder that satisfies the task. Do not choose a client-visible folder for private drafts or agent notes.
5. Use `drive.folderId`/`drive.folderUrl` for canonical asset references.
6. Use `paths.vpsPath` or `paths.localPathHint` only as working-copy hints.
7. If no folder exists, create or request a folder record instead of inventing a new path.
8. Return evidence links in `agentOutput.artifacts` and/or task comments.

Stable tags should be preferred over display names. Display names can change; tags and resource links are the contract.

Suggested lookup examples:

- Client-facing design assets: `resourceType=client_org`, `resourceId=<clientOrgId>`, `tag=assets`, `visibility=admin_agents_clients`
- Agent-only research/raw files: `resourceType=project`, `resourceId=<projectId>`, `tag=raw`, `visibility=admin_agents`
- Admin-only finance/legal source: `tag=legal` or `tag=finance`, `visibility=admin_only`

If a skill instructs agents to read or write client assets, that skill should mention this lookup policy and link to this runbook.

## 7. Safe future path for two-way sync

Two-way sync is allowed only after v1 conflict/audit behaviour is proven. The safe path is staged:

1. Registry + one-way provisioning: folder records exist, Drive links are registered, and operators can see mappings.
2. Full pull mirror: Drive to VPS/local with no automatic local write-back.
3. Manual upload/write-back: selected operator action writes a known file to Drive and records audit evidence.
4. Conflict detection: the worker can reliably detect and preserve conflicts without overwriting.
5. Human conflict resolution UI: operators can review both versions and record resolution.
6. Narrow two-way pilot: enable for a low-risk folder type only, with rollback and extra logging.
7. Broader two-way sync: expand by folder tag/type only after successful audit history.

Never enable automatic two-way sync for client-visible, legal, billing, or admin-private folders until conflict resolution and ACL boundaries have been reviewed.

## 8. Evidence and project linking

Every implementation task touching workspace folders or sync should link evidence back to the project:

- task comment with commit SHA, test output, and docs changed
- `agentOutput.artifacts` entries for commits, docs, project docs, and preview URLs
- project doc or runbook link when the change is operational policy
- conflict/audit screenshots or records when UI changes are involved

Current evidence anchors for this runbook:

- Project: `/admin/org/partners-in-biz/projects/7LZFekmyZcTrOyCZbvjt`
- Approved spec: `https://partnersinbiz.online/admin/documents/deACCRbjMnt9W9Op7sc9`
- Source task: `/admin/org/partners-in-biz/projects/7LZFekmyZcTrOyCZbvjt?task=7Ya8dqZdvgSohHsUDPdN`
