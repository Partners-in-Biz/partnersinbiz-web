# YouTube Studio implementation map

Date: 2026-06-09T13:15:55Z
Task: SFYplkpfRnlenEBUoJMN
Branch: development

## Current state

YouTube Studio already has a Phase 1/early Phase 2 foundation in the development branch. The implementation is metadata-first, Firestore-backed, and gated through admin/portal APIs. It does not yet include a YouTube OAuth/upload adapter, binary video storage, real render execution, real analytics imports, or Projects/Kanban task creation from agent jobs.

Focused verification run for this inspection:

- `npm test -- --runInBand __tests__/lib/youtube-studio-sanitize.test.ts __tests__/lib/youtube-studio-skills.test.ts __tests__/api/youtube-studio.test.ts __tests__/api/portal-youtube-studio.test.ts __tests__/app/youtube-studio-route-placeholders.test.ts __tests__/app/youtube-studio-shared-workspace.test.ts __tests__/app/youtube-studio-portal-module-disabled.test.tsx`
- Result: 7 suites passed, 129 tests passed.

## Exact file map

### Product/spec source

- `docs/superpowers/specs/2026-06-07-youtube-channel-studio-design.md`
  - Approved product direction.
  - Defines the Production Cockpit model, V1 workflow, personas, YouTube policy constraints, data model, module access, publishing modes, guardrails, phases, and success criteria.
  - Important non-negotiables: no autonomous public publishing, no client-side public publishing, rights/AI disclosure/made-for-kids gates, no large media in Firestore, no paid ad launch from this module.

- `docs/superpowers/plans/2026-06-07-youtube-channel-studio-phase1.md`
  - Original implementation plan.
  - Lists intended created/modified files for the Phase 1 foundation.
  - Some current implementation has already gone beyond the original Phase 1 list: source assets, clip candidates, production drafts, render jobs, agent jobs, analytics snapshots, release plans, and readiness fields now exist.

### Domain types and shared helpers

- `lib/youtube-studio/types.ts`
  - Canonical TypeScript model.
  - Records: `YouTubeChannelWorkspace`, `YouTubeSeries`, `YouTubeVideoProject`, `YouTubePublishingPacket`, `YouTubeSourceAsset`, `YouTubeClipCandidate`, `YouTubeProductionDraft`, `YouTubeRenderJob`, `YouTubeAgentJob`, `YouTubeAnalyticsSnapshot`, `YouTubeReleasePlan`.
  - Policy/readiness types: `YouTubeApprovalPolicy`, `YouTubePublishingPolicy`, `YouTubePublishingReadiness`, gate checks, publishing modes, account/API readiness states.

- `lib/youtube-studio/sanitize.ts`
  - 1,576-line sanitizer/client-safe shaping layer.
  - Exports default policy helpers, input sanitizers for every YouTube Studio record type, Firestore serialization, and portal-safe record shapers.
  - Important client-safe functions strip internal/unsafe fields such as connected account id, internal notes, raw storage path, transcript text when not portal-visible, and execution job ids.

- `lib/youtube-studio/api.ts`
  - Shared Firestore/API helpers.
  - `YOUTUBE_COLLECTIONS` maps logical resources to Firestore collections:
    - `youtube_channel_workspaces`
    - `youtube_series`
    - `youtube_video_projects`
    - `youtube_publishing_packets`
    - `youtube_release_plans`
    - `youtube_source_assets`
    - `youtube_clip_candidates`
    - `youtube_production_drafts`
    - `youtube_render_jobs`
    - `youtube_agent_jobs`
    - `youtube_analytics_snapshots`
  - Helpers: actor fields, update actor fields, org access check, org listing, scoped record load, merge patch, deep undefined stripping.

- `lib/youtube-studio/skills.ts`
  - Skill contract catalog for YouTube production jobs.
  - Exposes 16 skill contracts, including channel strategy, series planner, video brief, research-to-video, script writer, clip finder, Shorts packager, thumbnail brief, title/metadata, captions/chapters, AI disclosure, rights check, publish readiness, analytics import, retention review, and next-video brief.
  - Agent jobs currently create structured job packets; they do not yet dispatch Hermes workers or create Projects/Kanban tasks.

### Admin UI and routes

- `app/(admin)/admin/org/[slug]/youtube-studio/page.tsx`
  - Thin server wrapper.
  - Resolves org by slug from Firestore and mounts `YouTubeStudioAdminWorkspace` with `orgId` and `orgName`.

- `components/youtube-studio/YouTubeStudioAdminWorkspace.tsx`
  - Main admin cockpit client component, 2,856 lines.
  - Loads all YouTube Studio resources in parallel:
    - `/api/v1/youtube-studio/channels`
    - `/api/v1/youtube-studio/series`
    - `/api/v1/youtube-studio/videos`
    - `/api/v1/youtube-studio/publish-packets`
    - `/api/v1/youtube-studio/release-plans`
    - `/api/v1/youtube-studio/source-assets`
    - `/api/v1/youtube-studio/clip-candidates`
    - `/api/v1/youtube-studio/production-drafts`
    - `/api/v1/youtube-studio/render-jobs`
    - `/api/v1/youtube-studio/agent-jobs`
    - `/api/v1/youtube-studio/analytics`
  - Provides creation/update workflows for channel, video, source asset, clip candidate, production draft, render job, publishing packet/review state, channel readiness, release plan, agent job, and analytics snapshot.

- `components/youtube-studio/YouTubeStudioWorkspaceShell.tsx`
  - Shared header/stats/container shell for admin and portal.

- `components/youtube-studio/YouTubeStudioCards.tsx`
  - Shared channel/video/status card primitives.

### Portal UI and route

- `app/(portal)/portal/youtube-studio/page.tsx`
  - Thin server wrapper.
  - Reads optional `orgId` search param and mounts `YouTubeStudioPortalWorkspace`.

- `components/youtube-studio/YouTubeStudioPortalWorkspace.tsx`
  - Portal client workspace, 973 lines.
  - Loads `/api/v1/portal/youtube-studio` with optional org scope via `scopedApiPath`.
  - Shows disabled-module state, channel cards, visible video projects, client-review actions, visible packets, release plans, assets, clip candidates, production drafts, render jobs, and client-safe analytics summaries.
  - Portal clients can request a video and submit decisions for visible videos/production drafts/render jobs/publishing packets.

- `app/api/v1/portal/youtube-studio/route.ts`
  - Auth: `withPortalAuthAndRole`.
  - Methods: `GET` viewer, `POST` member, `PUT` member.
  - Module gate: checks `organizations/{orgId}.settings.portalModules.youtubeStudio` and returns 403 with `{ moduleDisabled: true, module: 'youtubeStudio' }` when disabled.
  - `GET` lists all org records from all YouTube collections, then applies portal visibility and client-safe shaping in memory.
  - `POST` creates client-requested `youtube_video_projects` with source intake type `client_request`.
  - `PUT` handles client decisions for visible videos, publishing packets, production drafts, and render jobs; packet/draft/render approvals record snapshot hashes.

### Admin API routes

- `app/api/v1/youtube-studio/channels/route.ts`
  - Auth: admin.
  - Methods: `GET`, `POST`.
  - Lists/creates `youtube_channel_workspaces`.

- `app/api/v1/youtube-studio/channels/[id]/route.ts`
  - Auth: admin.
  - Methods: `GET`, `PUT`, `DELETE`.
  - Loads/updates/soft-archives one channel workspace.
  - Uses merge patch and locks org/id scope during updates.

- `app/api/v1/youtube-studio/series/route.ts`
  - Auth: admin.
  - Methods: `GET`, `POST`.
  - Lists/creates `youtube_series`; validates channel belongs to org.

- `app/api/v1/youtube-studio/videos/route.ts`
  - Auth: admin.
  - Methods: `GET`, `POST`.
  - Lists/creates `youtube_video_projects`; validates channel and optional series scope.

- `app/api/v1/youtube-studio/videos/[id]/route.ts`
  - Auth: admin.
  - Methods: `GET`, `PUT`, `DELETE`.
  - Loads/updates/soft-archives one video project.
  - Locks org scope and validates channel/series links.

- `app/api/v1/youtube-studio/publish-packets/route.ts`
  - Auth: admin.
  - Methods: `GET`, `POST`, `PUT`.
  - Creates/updates `youtube_publishing_packets`.
  - On create, batches packet creation and video `publishPacketId` update.
  - Connected-account gate is system-derived from channel publishing readiness.
  - Admin approval is blocked if any packet check is `block`.
  - Current route forces `visibility: 'private'` and does not perform external upload/publish.

- `app/api/v1/youtube-studio/release-plans/route.ts`
  - Auth: admin.
  - Methods: `GET`, `POST`.
  - Creates release plan metadata for manual handoff/private API upload/scheduled publish modes.
  - Validates channel, video, packet scope.
  - Does not execute YouTube publishing.

- `app/api/v1/youtube-studio/source-assets/route.ts`
  - Auth: admin.
  - Methods: `GET`, `POST`.
  - Metadata-only asset intake for source URLs, transcripts, thumbnails, audio, b-roll, images, documents, rendered videos.
  - Validates channel, optional video, optional series scope.

- `app/api/v1/youtube-studio/clip-candidates/route.ts`
  - Auth: admin.
  - Methods: `GET`, `POST`.
  - Stores selected/suggested clip ranges against a source asset and optional video.
  - Validates source asset/video belongs to org/channel.

- `app/api/v1/youtube-studio/production-drafts/route.ts`
  - Auth: admin.
  - Methods: `GET`, `POST`, `PUT`.
  - Stores briefs/outlines/scripts/storyboards/shot lists/voiceover/edit notes.
  - Validates referenced video, channel, source assets, and clip candidates.
  - Supports client-review/approval metadata but no Client Document version write yet.

- `app/api/v1/youtube-studio/render-jobs/route.ts`
  - Auth: admin.
  - Methods: `GET`, `POST`, `PUT`.
  - Stores render/edit packages and output metadata.
  - Validates referenced video, channel, draft, source assets, and clip candidates.
  - Metadata-only; no render engine execution yet.

- `app/api/v1/youtube-studio/agent-jobs/route.ts`
  - Auth: admin.
  - Methods: `GET`, `POST`.
  - Creates `youtube_agent_jobs` with a structured `inputPacket` from `lib/youtube-studio/skills.ts`.
  - Validates skill key, channel/video/series scope, and referenced artifacts.
  - Does not currently create a Projects/Kanban task, dispatch Hermes, or consume completed task output.

- `app/api/v1/youtube-studio/analytics/route.ts`
  - Auth: admin.
  - Methods: `GET`, `POST`.
  - Stores manual/API/reporting snapshot metadata and recommendations.
  - Validates channel, optional video, optional series scope.
  - Does not yet connect to YouTube Analytics or Reporting API.

### Portal module/navigation integration

- `lib/organizations/portal-modules.ts`
  - Includes `youtubeStudio` in portal module resolution.

- `app/(admin)/admin/org/[slug]/settings/page.tsx`
  - Includes admin setting switch for YouTube Studio portal visibility.

- `app/(portal)/layout.tsx`
  - Includes portal nav item and hides it when `portalModules.youtubeStudio === false`.

- `components/admin/navConfig.ts`
  - Includes admin org nav item.

### Existing tests

- `__tests__/lib/youtube-studio-sanitize.test.ts`
  - Sanitizer defaults, portal safety, extra record types, connected-account secrecy, storage/transcript visibility shaping.

- `__tests__/lib/youtube-studio-skills.test.ts`
  - Skill contract catalog/guardrail expectations.

- `__tests__/api/youtube-studio.test.ts`
  - Admin route foundations across channels, videos, packets, source assets, clip candidates, production drafts, render jobs, agent jobs, analytics, and release plans.

- `__tests__/api/portal-youtube-studio.test.ts`
  - Portal module guard, portal list filtering, client request creation, and decision routes.

- `__tests__/app/youtube-studio-route-placeholders.test.ts`
  - Route wrapper presence and component mount expectations.

- `__tests__/app/youtube-studio-shared-workspace.test.ts`
  - Shared workspace and module/nav structure.

- `__tests__/app/youtube-studio-portal-module-disabled.test.tsx`
  - Disabled portal module UI state.

## Recommended implementation split from here

### P0: Foundation hardening before any external execution

Goal: make current metadata foundation safe enough to support real task-bus and upload-adapter work.

Recommended files:

- `app/api/v1/portal/youtube-studio/route.ts`
- `app/api/v1/youtube-studio/publish-packets/route.ts`
- `app/api/v1/youtube-studio/release-plans/route.ts`
- `app/api/v1/youtube-studio/agent-jobs/route.ts`
- `lib/youtube-studio/api.ts`
- `lib/youtube-studio/sanitize.ts`
- `__tests__/api/youtube-studio.test.ts`
- `__tests__/api/portal-youtube-studio.test.ts`

Work items:

1. Add explicit test coverage that portal clients cannot approve hidden or non-client-review packets/drafts/render jobs and cannot approve resources whose channel/video linkage is inconsistent.
2. Add route-level assertions that release plans cannot be created for public/scheduled modes unless the packet is approved and channel readiness allows that mode.
3. Add tests around `approvalSnapshotHash` stability and fields included for admin packet approval and portal approval.
4. Add tests proving admin packet approval cannot pass if rights, AI disclosure, made-for-kids, metadata, thumbnail, captions, connected account, or approval checks are `block`.
5. Decide and document indexing/pagination pattern for org-wide list routes before high-volume clients use the module. Current list helpers read all org docs for a collection and filter/sort in memory.
6. Split giant UI components only after tests protect behavior; avoid a visual rewrite during safety hardening.

### P1: Projects/Kanban + Client Documents integration

Goal: connect YouTube records to PiB operating primitives instead of creating a parallel work system.

Recommended files:

- `app/api/v1/youtube-studio/agent-jobs/route.ts`
- New helper under `lib/youtube-studio/project-links.ts` or similar.
- Existing Project/Kanban API/client helpers after inspection.
- Existing Client Documents helpers/routes after inspection.
- Tests in `__tests__/api/youtube-studio.test.ts` plus focused project/doc integration tests.

Work items:

1. When creating a YouTube agent job, optionally create or link a Projects/Kanban task with `assigneeAgentId`, `agentInput`, `dependsOn`, and expected artifacts.
2. Store task ids back on `youtube_agent_jobs.linked.taskIds` and related video/source/draft/packet records where appropriate.
3. Add Client Document creation/linking for production briefs and publishing packets when a packet enters client review or internal approval review.
4. Make client approval evidence point to immutable document version or packet snapshot, not mutable UI text only.
5. Add a reconciliation test: agent job -> task -> output artifact -> YouTube record linked update.

### P2: Upload/readiness adapter, still private-first/manual-first

Goal: introduce external YouTube integration without public publishing risk.

Recommended files:

- New `lib/youtube-studio/providers/youtube-data.ts` or similar.
- New route under `app/api/v1/youtube-studio/publishing/...` only after a spec/approval gate.
- `app/api/v1/youtube-studio/release-plans/route.ts`
- `app/api/v1/youtube-studio/publish-packets/route.ts`
- Tests under `__tests__/api/youtube-studio-publishing*.test.ts`.

Work items:

1. Model connected account lookup without exposing credential refs to portal/client-safe surfaces.
2. Add dry-run readiness endpoint first; no YouTube mutation.
3. Add private/unlisted upload only after connected-account, approval, rights, disclosure, made-for-kids, metadata, thumbnail/caption, packet approval, and private-first checks pass.
4. Store external `youtubeVideoId`, request id, response status, error/retry details, and audit fields.
5. Keep public/scheduled publish as a separate approval-gated follow-up after private upload proof exists.

### P3: Analytics import and recommendation-to-task loop

Goal: make analytics useful and safely actionable.

Recommended files:

- `app/api/v1/youtube-studio/analytics/route.ts`
- New import parser/helper under `lib/youtube-studio/analytics.ts`.
- `components/youtube-studio/YouTubeStudioAdminWorkspace.tsx`
- `components/youtube-studio/YouTubeStudioPortalWorkspace.tsx`
- Tests for manual import/API import normalization and client-safe summaries.

Work items:

1. Add manual CSV/JSON import normalization before external API ingestion.
2. Preserve source freshness: `fresh`, `delayed`, `partial`, `estimated`.
3. Add recommendation state transitions: suggested, accepted, rejected, converted_to_task.
4. Convert accepted recommendations into Projects/Kanban tasks or YouTube video briefs.

### P4: UI modularization and scale

Goal: make the 2,856-line admin component and 973-line portal component maintainable without changing behavior.

Recommended files:

- Split `components/youtube-studio/YouTubeStudioAdminWorkspace.tsx` into focused form/section components after tests are in place.
- Split `components/youtube-studio/YouTubeStudioPortalWorkspace.tsx` into list/review/analytics sections.
- Add tests per component behavior before extraction.

Work items:

1. Extract data-loading hook.
2. Extract admin forms by entity: channel, video, asset, clip, draft, render, packet, release, job, analytics.
3. Extract portal review cards for video/draft/render/packet decisions.
4. Add loading/error/partial-data state tests.

## Risk areas

1. External-side-effect risk: current code is metadata-only, but the model already has private API upload and scheduled publish modes. Do not add any YouTube upload/publish execution until release-plan/packet approval gates have focused tests and explicit approval.

2. Portal visibility risk: portal GET reads many record types and filters in memory. Client-safe shapers exist, but every new field added to types must be audited for portal exposure. Add a regression whenever adding sensitive fields such as credential refs, storage paths, raw transcript text, execution ids, or internal risk notes.

3. Approval snapshot risk: packet/draft/render approvals use snapshot hashes. The tests should prove the hash includes the exact client-visible approval substance and does not depend on server timestamp sentinel values in a way that makes evidence unreproducible.

4. Parallel work-system risk: `youtube_agent_jobs` exists as its own queue. That can drift from PiB Projects/Kanban unless the next slice links or creates canonical project tasks.

5. Component size risk: admin workspace is already very large. Feature work inside that component will get risky quickly. Safety tests should come before extraction; extraction should be behavior-preserving.

6. Firestore scale/index risk: list routes use `where('orgId', '==', orgId).get()` and in-memory filtering/sorting. That avoids composite-index failures but can become expensive. Add pagination or scoped filters before real client video libraries grow.

7. Publish-readiness semantics risk: `release-plans` need stricter validation against packet approval and channel publishing readiness before any adapter work. Metadata currently allows planning modes, not external action.

8. Storage/render risk: current source/render records may carry URLs/storage paths, but there is no upload storage broker or render execution. Large media must remain outside Firestore.

9. YouTube policy risk: made-for-kids, synthetic media, rights, quota/compliance audit, and Shorts constraints are represented as gates but need route tests that block approval/execution when unresolved.

10. Invoice checkpoint risk from preflight: this inspection worktree had pre-existing dirty `lib/invoices/permissions.ts`; it was checkpoint-committed before sync per AGENTS.md. Do not mix that invoice foundation edit with YouTube Studio changes in review notes.

## First-pass tests to add next

### P0 route safety

- `__tests__/api/youtube-studio.test.ts`
  - `PUT /publish-packets` rejects `status: 'approved'` when any required gate is `block`.
  - `PUT /publish-packets` preserves locked `orgId`, `channelWorkspaceId`, and `videoProjectId` even when caller sends conflicting values.
  - `POST /release-plans` rejects scheduled/public mode when packet is not approved.
  - `POST /release-plans` rejects API modes when channel readiness is `manual_only`, `not_ready`, `blocked`, `quota_limited`, or `audit_required`.
  - `POST /agent-jobs` rejects cross-org artifact ids for every artifact family.

- `__tests__/api/portal-youtube-studio.test.ts`
  - Portal `GET` never returns `connectedAccountId`, `internalNotes`, raw `storagePath`, transcript text unless explicit transcript visibility allows it, or execution ids.
  - Portal `PUT` rejects packet decisions when the packet is not `client_review`.
  - Portal `PUT` rejects production draft decisions when draft visibility is false or the video is hidden.
  - Portal `PUT` rejects render job decisions when job/video/channel linkage does not match.
  - Portal decision approval snapshot hash changes when title/description/checks/client-visible approval substance changes.

### P1 integration

- Agent job creation can create/link a Projects/Kanban task with expected `assigneeAgentId`, `agentInput.context`, `dependsOn`, and artifact refs.
- Re-running or updating a job does not duplicate project tasks when an idempotency key or existing linked task exists.
- Client review packet creation can create/link a Client Document version and stores the document/version id on the packet or video linkage.

### P2 external adapter safety

- Dry-run publishing endpoint returns readiness evidence and performs no provider call.
- Private upload route refuses missing approval evidence, unresolved disclosure/made-for-kids/rights checks, missing connected account, and public visibility.
- Scheduled/public publish route is absent or returns approval-required until explicit later approval.

### P3 analytics

- Manual import normalizes metrics, source freshness, date periods, and recommendation states.
- Portal analytics summary hides internal notes and unsupported dimensions.
- Accepted recommendation converts to a task or next-video brief without mutating public/publish state.

## Recommended immediate next task packet

Title: Harden YouTube Studio foundation before external execution

Scope:

- Add the P0 route safety tests above.
- Patch only minimal code needed to satisfy failing tests.
- Do not add YouTube OAuth/upload, render execution, public publishing, client-visible messaging, paid ad actions, secret/config changes, or destructive data operations.

Expected artifacts:

- Focused Jest output for YouTube Studio API/portal tests.
- `git diff --check`.
- Optional targeted ESLint for changed files.
- Commit pushed to `origin/development` only if the worktree contains only reviewed safe foundation edits.
