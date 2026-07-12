# Workspace Runtime Hardening Design

Date: 2026-07-12
Status: Approved design, awaiting implementation plan

## Objective

Make the existing organisation/project Workspace execution foundation secure and truthful before adding self-service linked computers. The browser must receive logical identifiers and friendly status only; PiB must authorise the conversation, runtime, project, and filesystem scope before dispatch; an explicitly selected runtime must never silently fall back; and the UI must identify the runtime that actually accepted the run.

## Scope

This release covers the current VPS runtime and the centrally registered local Mac runtime. It does not claim multi-user device pairing, Windows support, or production completion. Those belong to the linked-computers design.

## Architecture

### Browser-safe Workspace catalogue

`GET /api/v1/workspaces` will return a purpose-built public DTO containing Workspace identity, organisation identity, source-of-truth, folder schema version, active project IDs/names, and authorised runtime presence. It will never return `vpsPath`, `localPath`, working paths, agent-domain paths, runtime URLs, or credentials. `UnifiedChat` will use friendly scope and runtime copy instead of rendering raw paths.

### Server-owned execution scope

Conversation creation continues to accept logical `orgId`, `workspaceId`, `projectId`, and `runtimeTargetId`. A single server resolver will load the authorised Workspace and active project, derive the intended relative folder, and validate it against the approved root.

Before dispatch, the resolver must:

- reject empty or relative roots;
- reject missing/non-directory roots and targets;
- canonicalise the root and target with `realpath`;
- reject symlinked path components for managed project directories;
- enforce separator-safe descendant containment;
- reject archived/deleted projects;
- return the canonical resolved directory only to server-side dispatch code.

PiB will not create a missing directory at message-dispatch time. Provisioning/backfill owns materialisation; dispatch returns a typed `workspace_missing` or `project_missing` failure.

### Strict runtime resolution

Runtime selection will distinguish `auto` from explicit IDs. An explicit ID must resolve to an enabled, healthy, fresh target with credentials and matching capabilities. Missing, stale, disabled, unhealthy, or keyless explicit targets produce typed failures and never enter VPS/legacy fallback. `auto` may use the configured priority/fallback policy.

Workspace discovery and dispatch must use the same agent/runtime source. The selected dispatch result will preserve the actual `targetId`, runtime class, and machine label in the Hermes link and run ledger.

### Mutation access consistency

Central policy remains:

- private/shared reads require explicit human participation;
- organisation-visible reads require authorised organisation membership;
- AI reads require explicit agent participation;
- replies, stop actions, and agent-message appends require explicit participation;
- destructive conversation actions require the owner or an authorised access manager.

Delete, stop, agent-message, finalise, attachments, context, models, legacy aliases, and future aliases will be covered by a route-policy matrix test.

### Safe observability

Hermes run metadata will use logical identifiers and path class (`organisation` or `project`) rather than duplicate raw local/VPS paths. Server logs and browser errors will use allowlisted structured fields and typed failure codes. Upstream Hermes payloads and arbitrary exception text will not be reflected directly to browser callers.

An execution receipt will distinguish requested target from accepted target and record logical identifiers, accepted time, tool-start time when supplied, completion state, provider/model, and typed failure classification. Raw paths remain restricted server-side.

## Error contract

Workspace dispatch failures will use stable codes including:

- `runtime_offline`
- `runtime_stale`
- `runtime_unauthorised`
- `runtime_disabled`
- `workspace_missing`
- `project_missing`
- `project_archived`
- `folder_mapping_missing`
- `path_outside_workspace`
- `provider_quota_exhausted`
- `provider_failed`
- `agent_failed`

User-facing copy will identify the corrective action without disclosing paths, endpoints, or credentials.

## Verification

Implementation is test-first. Required gates are:

- public DTO tests proving all raw paths and runtime secrets are absent;
- realpath/containment tests for traversal, sibling-prefix, symlink escape, missing directory, archived project, organisation root, and valid project root;
- runtime tests proving stale/disabled/missing explicit targets never fall back;
- full route-policy matrix tests for private/shared/organisation visibility and every mutation alias;
- execution-receipt tests proving requested and actual targets cannot be conflated;
- focused Jest, TypeScript, quality ratchet, targeted ESLint, `git diff --check`, and production build;
- Preview smoke for organisation-root, project-root, offline runtime, redaction, and real local `pwd`;
- production promotion only through explicit approval from `development` to `main`.

Firestore index deployment/readback and a real VPS `pwd` remain mandatory production acceptance evidence. Provider quota failure must be reported separately and cannot substitute for the VPS proof.

## Rollout and rollback

Stage the release behind the existing Workspace flow without changing canonical storage. Deploy to Preview, verify old general conversations remain unbound, then verify new root/project conversations. Rollback is a normal revert of the narrow hardening commits; no schema migration may make existing conversations unreadable. Any execution-receipt additions must be optional on reads during rollout.

## Out of scope

- per-user pairing and device ownership;
- macOS/Windows packaging and updates;
- organisation device grants and device-specific folder mappings;
- production promotion without Peet's explicit approval.
