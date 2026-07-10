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

The admin **Create sync plan** action persists an auditable `workspace_folder_sync_requests` record and copies its request id/status onto the folder's `syncState`. Despite the UI label, this is a **Drive folder resync request record**, not an immutable local/VPS Workspace sync plan. It does not contain the local and VPS inventories, cannot be supplied to the Workspace sync CLI, and does not claim that a transfer occurred. Requests with open conflicts are recorded as `blocked_conflict`; all requests explicitly record `destructiveDeletes: false`. A Drive transfer executor remains a separate, approval-gated operational component.

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

## 7. Conflict-aware VPS/local Workspace sync

Generated Markdown Workspaces and their Obsidian agent domains use the `workspace:sync` operator CLI. This is a separate system from Drive folder resync requests: a `workspace_folder_sync_requests` id is **not** a Workspace sync plan id and must never be passed to `--plan`.

The VPS is canonical by default. Running the command without `--apply` inventories both sides, compares raw-file SHA-256 hashes with the last common baseline, and writes an immutable plan; it does not change mirrored content.

### 7.1 Plan storage, identity, and expiry

The default operator-state root is `<local-root>/.pib-workspace-sync` (normally `~/Cowork/.pib-workspace-sync`) and may be overridden with `--state-root`. Keep this directory outside both mirrored trees. Its relevant layout is:

```text
.pib-workspace-sync/
  plans/<plan-id>.json
  journals/<journal-id>.json
  states/<identity-hash>.json
  backups/<journal-id>/local/workspace|agent/...
```

A plan id is the lowercase, 64-character SHA-256 digest of the canonical persisted plan body. The body binds the exact local and VPS inventories, baseline, direction, creation/expiry times, and target identity. Plans expire 30 minutes after creation. Editing a plan changes its digest and invalidates it; expiry, a digest mismatch, or a target-identity mismatch requires a new plan.

The target identity must be bound to the authoritative remote `.pib-workspace.json` manifest, including its `workspaceId`, `orgId`, `agentDomain`, canonical Workspace/agent roots, VPS source-of-truth declaration, and manifest hash, in addition to host, SSH user, and local root. Apply must re-read the manifest and reject a missing, malformed, changed, or mismatched manifest before any transfer. It must also reject a requested Workspace/agent domain whose names or canonical paths do not match that manifest. Do not operate `--apply` with a CLI build that only trusts a display name or path.

Push-capable applies also require `--confirm-workspace <workspaceId>`, tied to the authoritative manifest identity. This confirmation is additional to `--allow-push`, the immutable plan id, and path approvals.

### 7.2 Create and review a plan

Plan the default pull direction:

```bash
npm run workspace:sync -- --workspace "Vikings Wrestling" --agent-domain vikings-wrestling
```

Plan both pull candidates and possible local write-back:

```bash
npm run workspace:sync -- --workspace "Vikings Wrestling" --agent-domain vikings-wrestling --direction both
```

The output includes the plan id, expiry, classifications, exact operations, and unresolved blockers. Review the stored `plans/<plan-id>.json`; do not approve paths from memory. Conflict choices, when required, are recorded while creating a new plan with repeated exact values such as `--resolve workspace/brief.md=remote` or `--resolve agent/wiki/note.md=local`. Applying a plan cannot add or alter its conflict resolutions.

Only regular Markdown files are inventoried or transferable. Every operation path is scope-qualified as `workspace/<relative-path>.md` or `agent/<relative-path>.md`. Binary assets, secrets, `.env*`, `.git`, sync metadata, symlinks, special files, and non-Markdown files are outside this sync contract.

### 7.3 Apply an immutable plan

Apply requires all three elements: `--apply`, the exact `--plan <id>`, and at least one repeated exact `--approve-path`. There is no approve-all flag.

```bash
npm run workspace:sync -- \
  --workspace "Vikings Wrestling" \
  --agent-domain vikings-wrestling \
  --apply \
  --plan <64-character-plan-id> \
  --approve-path workspace/README.md \
  --approve-path agent/wiki/hot.md
```

Only approved paths that are operations in that immutable plan are selected. Unapproved operations remain untouched. Before the first write, apply re-inventories both complete trees and re-reads the authoritative manifest. Any local inventory, VPS inventory, or manifest drift since planning rejects the entire stale plan. Immediately before each selected operation, apply checks that path's source and destination hashes again; drift stops the run rather than overwriting newer content.

A push is a distinct, higher-risk action. It must have been created by a `push`/`both` plan and requires the normal apply gates **plus** `--allow-push`:

```bash
npm run workspace:sync -- \
  --workspace "Vikings Wrestling" \
  --agent-domain vikings-wrestling \
  --apply \
  --plan <64-character-plan-id> \
  --approve-path workspace/approved-local-change.md \
  --allow-push \
  --confirm-workspace <manifest-workspace-id>
```

`--allow-push` is not path approval and does not approve every local change. `--confirm-workspace` must equal the exact `workspaceId` read from the authoritative manifest; a display name or agent-domain slug is not accepted as a substitute.

### 7.4 Journals, state, backups, and recovery

Each apply creates an atomic `journals/<journal-id>.json`. Every selected path moves independently through `pending`, `running`, and `completed` or `failed`, recording expected hashes, verified hash, backup path/hash, and error evidence. After each successful transfer, both sides must hash to the planned source hash before that operation is marked complete and its common-baseline state advances. Failed, conflicted, blocked, and unselected paths retain their previous baseline. A partial failure must not claim full success or roll state forward for an unverified path.

Before replacing local content, apply copies the previous file to `<state-root>/backups/<journal-id>/local/<scope>/<relative-path>`. Before replacing VPS content, it copies the previous file to `/var/lib/hermes/.pib-sync-backups/<agent-domain>/<journal-id>/<scope>/<relative-path>`. Missing destinations naturally have no backup.

Recovery procedure:

1. Stop after any failed/stale check; do not rerun the old plan blindly.
2. Read the journal to identify completed, failed, and still-pending paths and their backup hashes.
3. Verify the relevant backup hash before restoring a prior destination version manually.
4. Re-inventory by running plan mode again. Review and apply a new plan only for the remaining or recovery operations.
5. Never edit baseline state or a persisted plan to force acceptance.

### 7.5 Conflict and deletion rules

- One-sided VPS changes are safe pull candidates; one-sided local changes are push candidates only.
- If both sides changed differently, or different files appeared without a common baseline, classification is `conflict`; neither version is overwritten without a new plan containing an explicit resolution.
- `local_deleted` may restore the missing local Markdown file from the canonical VPS.
- `remote_deleted` is an unresolved blocker. It never deletes the local copy and is not silently converted into a push. Preserve the local version, investigate the VPS deletion, then use an explicitly reviewed recovery/new plan path.
- No transfer command uses delete propagation. The CLI never mirrors a deletion from either side.
- Planning, conflicts, stale-plan rejection, and failed applies must leave both existing versions intact.

## 8. Safe future path for Drive two-way sync

Two-way sync is allowed only after v1 conflict/audit behaviour is proven. The safe path is staged:

1. Registry + one-way provisioning: folder records exist, Drive links are registered, and operators can see mappings.
2. Full pull mirror: Drive to VPS/local with no automatic local write-back.
3. Manual upload/write-back: selected operator action writes a known file to Drive and records audit evidence.
4. Conflict detection: the worker can reliably detect and preserve conflicts without overwriting.
5. Human conflict resolution UI: operators can review both versions and record resolution.
6. Narrow two-way pilot: enable for a low-risk folder type only, with rollback and extra logging.
7. Broader two-way sync: expand by folder tag/type only after successful audit history.

Never enable automatic two-way sync for client-visible, legal, billing, or admin-private folders until conflict resolution and ACL boundaries have been reviewed.

## 9. Evidence and project linking

Every implementation task touching workspace folders or sync should link evidence back to the project:

- task comment with commit SHA, test output, and docs changed
- `agentOutput.artifacts` entries for commits, docs, project docs, and preview URLs
- project doc or runbook link when the change is operational policy
- conflict/audit screenshots or records when UI changes are involved

Current evidence anchors for this runbook:

- Project: `/admin/org/partners-in-biz/projects/7LZFekmyZcTrOyCZbvjt`
- Approved spec: `https://partnersinbiz.online/admin/documents/deACCRbjMnt9W9Op7sc9`
- Source task: `/admin/org/partners-in-biz/projects/7LZFekmyZcTrOyCZbvjt?task=7Ya8dqZdvgSohHsUDPdN`
