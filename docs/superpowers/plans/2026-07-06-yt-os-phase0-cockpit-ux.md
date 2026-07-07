# YouTube OS Phase 0 — Studio Cockpit UX Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the portal YouTube Studio page into a client video-work cockpit (channel header, three primary actions, grouped work queue, technical collections behind contextual tabs), fix the Video Editor trim stub with real trim UI, and add a guarded dev seed script so signed-in local smokes are possible.

**Architecture:** A new pure grouping module (`lib/youtube-studio/work-queue.ts`) classifies videos/packets/drafts/render jobs into four client-facing groups. Three new presentational components (`YouTubeStudioChannelHeader`, `YouTubeStudioWorkQueue`, `YouTubeStudioDetailsTabs`) replace the long single-column dump in `YouTubeStudioPortalWorkspace.tsx`; all data loading and decision handlers in that file stay as-is. Trim uses the existing pure `trimClip` op in `lib/video-editor/timeline-ops.ts` — the work is UI wiring (edge-drag handles in `TimelinePanel`, numeric in/out fields in `InspectorPanel`, handler in `VideoEditorShell`). The seed script writes directly to Firestore/Auth **emulators only**, enforced by a tested guard module.

**Tech Stack:** Next.js 15 App Router, React 19 client components, Tailwind (pib-card-section visual system), Jest 30 (ts-jest; `*.test.tsx` → jsdom project, `*.test.ts` → node project), firebase-admin, tsx for scripts.

**Branch:** All work on `development` in `partnersinbiz-web` (repo rule: no feature branches, no worktrees). Run the git preflight from the project CLAUDE.md before Task 1.

---

## Context you must know before starting

- **Peet's UX verdict** (docs/superpowers/specs → wiki note `youtube-studio-ux-redesign-needed-2026-07-06`): the portal page "does not clearly answer: what am I supposed to do here?", mixes internal production objects with client actions, and empty sections make it feel broken. Required first screen: channel selector + status header; primary actions `Create video edit` / `Request PiB video` / `Review pending work`; work queue grouped `Needs your input` / `In production` / `Ready to review` / `Scheduled & live`; technical collections hidden unless populated, in contextual tabs.
- **API envelope:** all `/api/v1/*` routes return `{ success, data }` via `apiSuccess` — client code unwraps `body.data`.
- **The portal GET** (`app/api/v1/portal/youtube-studio/route.ts`) already returns `channels, series, videos, packets, releasePlans, sourceAssets, clipCandidates, productionDrafts, renderJobs, analytics, capabilities` — no API changes are needed for the cockpit; this is a pure front-end regrouping.
- **Admin surface is untouched.** `YouTubeStudioAdminWorkspace.tsx` / `AdminYouTubeStudioGovernanceWorkspace.tsx` already "see everything"; do not modify them.
- **Status unions** (from `lib/youtube-studio/types.ts`):
  - `YouTubeVideoStatus`: `intake | briefing | production | internal_review | client_review | changes_requested | publish_ready | scheduled | live | blocked | archived`
  - `YouTubeProductionDraftStatus`: `draft | internal_review | client_review | approved | changes_requested | blocked | archived`
  - `YouTubeRenderJobStatus`: `planning | ready_for_edit | rendering | rendered | qa_review | approved | blocked | cancelled`
  - Packet status: `draft | internal_review | client_review | approved | blocked | published`
- **`trimClip` already exists and is tested** in `lib/video-editor/timeline-ops.ts:130-158` with signature `trimClip(timeline, trackId, clipId, { edge: 'start' | 'end', deltaSeconds })`. Only the UI is stubbed: `components/video-editor/VideoEditorShell.tsx:242` has `onTrimClip={() => undefined}`.
- **Auth model for the seed:** `withPortalAuthAndRole` verifies a session cookie, loads `users/{uid}` (fields `role`, `orgIds`, `activeOrgId`, `orgId`), resolves membership from `orgMembers/{orgId}_{uid}` (`{ uid, orgId, role }`) with fallback to `organizations/{orgId}.members[]`. Module gate: `organizations/{orgId}.settings` → `isPortalModuleEnabled(settings, 'youtubeStudio')` (default true).
- **Collections:** `youtube_channel_workspaces`, `youtube_series`, `youtube_video_projects`, `youtube_publishing_packets`, `youtube_release_plans`, `youtube_source_assets`, `youtube_clip_candidates`, `youtube_production_drafts`, `youtube_render_jobs`, `youtube_analytics_snapshots`, `video_editor_projects`.
- **Run tests with** `npx jest <path>` (jest.config.ts routes `.test.tsx` to jsdom + `jest.setup.js`, `.test.ts` to node). Typecheck gate is `npm run typecheck` (NOT `next build` — build has `ignoreBuildErrors`).

## File structure (what gets created/modified)

| File | Action | Responsibility |
|---|---|---|
| `lib/youtube-studio/work-queue.ts` | Create | Pure classification of records into the four cockpit groups |
| `__tests__/lib/youtube-studio-work-queue.test.ts` | Create | Node tests for grouping rules |
| `components/youtube-studio/YouTubeStudioChannelHeader.tsx` | Create | Channel selector + connection status chip + link/reconnect actions |
| `components/youtube-studio/YouTubeStudioWorkQueue.tsx` | Create | Grouped work-queue card list (presentational) |
| `components/youtube-studio/YouTubeStudioDetailsTabs.tsx` | Create | Contextual tabs for technical collections + decision forms |
| `components/youtube-studio/YouTubeStudioPortalWorkspace.tsx` | Modify | Cockpit layout; keep loaders/mutators; delegate rendering |
| `__tests__/app/youtube-studio-cockpit.test.tsx` | Create | jsdom tests for header, queue, tabs, cockpit assembly |
| `__tests__/app/youtube-studio-connect-ux.test.tsx` | Modify | Update assertions to cockpit layout |
| `__tests__/app/youtube-studio-shared-workspace.test.ts` | Modify | Update source-standard assertions to new file layout |
| `components/video-editor/TimelinePanel.tsx` | Modify | Edge-drag trim handles with keyboard support |
| `components/video-editor/InspectorPanel.tsx` | Modify | Numeric in/out trim fields (`onTrim` prop) |
| `components/video-editor/VideoEditorShell.tsx` | Modify | Wire `onTrimClip`/`onTrim` to the pure `trimClip` op |
| `__tests__/app/video-editor-trim-ui.test.tsx` | Create | jsdom tests for trim handles, inspector fields, shell wiring |
| `lib/dev-seed/guard.ts` | Create | Pure, testable production-safety guard |
| `__tests__/lib/dev-seed-guard.test.ts` | Create | Node tests for the guard |
| `scripts/dev-seed-youtube-studio.ts` | Create | Emulator-only seed: admin+client logins, demo org, channel, projects |

---

### Task 1: Work-queue grouping module

**Files:**
- Create: `lib/youtube-studio/work-queue.ts`
- Test: `__tests__/lib/youtube-studio-work-queue.test.ts`

Grouping rules (client-centric; document them in the file header):
- **needs_input** — anything waiting on a client decision or blocked by a client rejection: videos in `client_review` or with `clientReview.status === 'requested'` or `blocked`; packets `client_review`; production drafts `client_review`; render jobs `qa_review`.
- **in_production** — videos in `intake | briefing | production | internal_review | changes_requested`. Drafts/renders in internal states are NOT queued separately (they'd duplicate the video card); they live in the details tabs.
- **ready_to_review** — approved deliverables the client can look at without a blocking decision: videos `publish_ready`; packets `approved`; render jobs `approved` that have `output.previewUrl` or `output.downloadUrl`.
- **scheduled_live** — videos `scheduled | live`.
- Videos `archived`, packets `draft | internal_review | blocked | published`, drafts in any other state, render jobs in any other state: excluded from the queue (details tabs still show them).

- [ ] **Step 1: Write the failing test**

Create `__tests__/lib/youtube-studio-work-queue.test.ts`:

```ts
import { buildWorkQueue, WORK_QUEUE_GROUPS } from '@/lib/youtube-studio/work-queue'
import type {
  YouTubeProductionDraft,
  YouTubePublishingPacket,
  YouTubeRenderJob,
  YouTubeVideoProject,
} from '@/lib/youtube-studio/types'

function video(id: string, status: YouTubeVideoProject['status'], extra: Partial<YouTubeVideoProject> = {}): YouTubeVideoProject {
  return {
    id,
    orgId: 'org-1',
    channelWorkspaceId: 'channel-1',
    title: `Video ${id}`,
    objective: 'Grow the channel',
    videoType: 'long_form',
    status,
    visibility: { showInClientPortal: true },
    deleted: false,
    ...extra,
  } as YouTubeVideoProject
}

const emptyInput = { videos: [], packets: [], productionDrafts: [], renderJobs: [] }

describe('buildWorkQueue', () => {
  it('exposes the four cockpit groups in display order', () => {
    expect(WORK_QUEUE_GROUPS.map((group) => group.key)).toEqual([
      'needs_input',
      'in_production',
      'ready_to_review',
      'scheduled_live',
    ])
    expect(WORK_QUEUE_GROUPS.map((group) => group.label)).toEqual([
      'Needs your input',
      'In production',
      'Ready to review',
      'Scheduled & live',
    ])
  })

  it('groups videos by status', () => {
    const groups = buildWorkQueue({
      ...emptyInput,
      videos: [
        video('v-review', 'client_review'),
        video('v-changes', 'changes_requested'),
        video('v-intake', 'intake'),
        video('v-prod', 'production'),
        video('v-ready', 'publish_ready'),
        video('v-scheduled', 'scheduled'),
        video('v-live', 'live'),
        video('v-blocked', 'blocked'),
        video('v-archived', 'archived'),
      ],
    })
    expect(groups.needs_input.map((item) => item.id)).toEqual(['v-blocked', 'v-review'])
    expect(groups.in_production.map((item) => item.id)).toEqual(['v-changes', 'v-intake', 'v-prod'])
    expect(groups.ready_to_review.map((item) => item.id)).toEqual(['v-ready'])
    expect(groups.scheduled_live.map((item) => item.id)).toEqual(['v-live', 'v-scheduled'])
  })

  it('treats a requested client review as needing input even outside client_review status', () => {
    const groups = buildWorkQueue({
      ...emptyInput,
      videos: [video('v1', 'internal_review', { clientReview: { status: 'requested' } } as Partial<YouTubeVideoProject>)],
    })
    expect(groups.needs_input.map((item) => item.id)).toEqual(['v1'])
    expect(groups.in_production).toHaveLength(0)
  })

  it('queues packets, drafts and render jobs only in client-decision or ready states', () => {
    const packets = [
      { id: 'p-review', status: 'client_review', videoProjectId: 'v1', versionNumber: 1 },
      { id: 'p-approved', status: 'approved', videoProjectId: 'v1', versionNumber: 1 },
      { id: 'p-draft', status: 'draft', videoProjectId: 'v1', versionNumber: 1 },
    ] as unknown as YouTubePublishingPacket[]
    const productionDrafts = [
      { id: 'd-review', status: 'client_review', title: 'Script v2', videoProjectId: 'v1', versionNumber: 2 },
      { id: 'd-internal', status: 'internal_review', title: 'Script v1', videoProjectId: 'v1', versionNumber: 1 },
    ] as unknown as YouTubeProductionDraft[]
    const renderJobs = [
      { id: 'r-qa', status: 'qa_review', title: 'Cut A', videoProjectId: 'v1', versionNumber: 1 },
      { id: 'r-approved', status: 'approved', title: 'Cut B', videoProjectId: 'v1', versionNumber: 2, output: { previewUrl: 'https://x.test/b.mp4' } },
      { id: 'r-approved-no-output', status: 'approved', title: 'Cut C', videoProjectId: 'v1', versionNumber: 3 },
      { id: 'r-rendering', status: 'rendering', title: 'Cut D', videoProjectId: 'v1', versionNumber: 4 },
    ] as unknown as YouTubeRenderJob[]

    const groups = buildWorkQueue({ videos: [], packets, productionDrafts, renderJobs })
    expect(groups.needs_input.map((item) => item.key)).toEqual([
      'packet:p-review',
      'production_draft:d-review',
      'render_job:r-qa',
    ])
    expect(groups.ready_to_review.map((item) => item.key)).toEqual(['packet:p-approved', 'render_job:r-approved'])
    expect(groups.in_production).toHaveLength(0)
  })

  it('skips records without ids and reports a total pending count', () => {
    const groups = buildWorkQueue({ ...emptyInput, videos: [video('', 'client_review'), video('v1', 'client_review')] })
    expect(groups.needs_input).toHaveLength(1)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd partnersinbiz-web && npx jest __tests__/lib/youtube-studio-work-queue.test.ts`
Expected: FAIL — `Cannot find module '@/lib/youtube-studio/work-queue'`

- [ ] **Step 3: Write the implementation**

Create `lib/youtube-studio/work-queue.ts`:

```ts
// lib/youtube-studio/work-queue.ts
//
// Pure classification of YouTube Studio records into the four client cockpit
// groups. Client-centric semantics:
//   needs_input     — a client decision is required (or a client block stands)
//   in_production   — PiB is actively working; nothing for the client to do
//   ready_to_review — approved deliverables to look at, no blocking decision
//   scheduled_live  — scheduled or published videos
// Internal-only states (draft packets, rendering jobs, archived videos) are
// intentionally excluded — they surface in the details tabs instead.

import type {
  YouTubeProductionDraft,
  YouTubePublishingPacket,
  YouTubeRenderJob,
  YouTubeVideoProject,
} from '@/lib/youtube-studio/types'

export type WorkQueueGroupKey = 'needs_input' | 'in_production' | 'ready_to_review' | 'scheduled_live'

export interface WorkQueueGroupMeta {
  key: WorkQueueGroupKey
  label: string
  emptyHint: string
}

export const WORK_QUEUE_GROUPS: WorkQueueGroupMeta[] = [
  { key: 'needs_input', label: 'Needs your input', emptyHint: 'Nothing is waiting on you right now.' },
  { key: 'in_production', label: 'In production', emptyHint: 'PiB is not producing a video right now.' },
  { key: 'ready_to_review', label: 'Ready to review', emptyHint: 'Approved drafts, renders, and packets ready for a final look appear here.' },
  { key: 'scheduled_live', label: 'Scheduled & live', emptyHint: 'Scheduled and published videos land here.' },
]

export type WorkQueueItemKind = 'video' | 'packet' | 'production_draft' | 'render_job'

export interface WorkQueueItem {
  key: string
  kind: WorkQueueItemKind
  group: WorkQueueGroupKey
  id: string
  title: string
  channelWorkspaceId?: string
  video?: YouTubeVideoProject
  packet?: YouTubePublishingPacket
  draft?: YouTubeProductionDraft
  renderJob?: YouTubeRenderJob
}

export type WorkQueueGroups = Record<WorkQueueGroupKey, WorkQueueItem[]>

export interface WorkQueueInput {
  videos: YouTubeVideoProject[]
  packets: YouTubePublishingPacket[]
  productionDrafts: YouTubeProductionDraft[]
  renderJobs: YouTubeRenderJob[]
}

function videoGroup(video: YouTubeVideoProject): WorkQueueGroupKey | null {
  if (video.status === 'client_review' || video.status === 'blocked' || video.clientReview?.status === 'requested') {
    return 'needs_input'
  }
  switch (video.status) {
    case 'intake':
    case 'briefing':
    case 'production':
    case 'internal_review':
    case 'changes_requested':
      return 'in_production'
    case 'publish_ready':
      return 'ready_to_review'
    case 'scheduled':
    case 'live':
      return 'scheduled_live'
    default:
      return null
  }
}

function packetGroup(packet: YouTubePublishingPacket): WorkQueueGroupKey | null {
  if (packet.status === 'client_review') return 'needs_input'
  if (packet.status === 'approved') return 'ready_to_review'
  return null
}

function draftGroup(draft: YouTubeProductionDraft): WorkQueueGroupKey | null {
  return draft.status === 'client_review' ? 'needs_input' : null
}

function renderJobGroup(job: YouTubeRenderJob): WorkQueueGroupKey | null {
  if (job.status === 'qa_review') return 'needs_input'
  if (job.status === 'approved' && (job.output?.previewUrl || job.output?.downloadUrl)) return 'ready_to_review'
  return null
}

function packetTitle(packet: YouTubePublishingPacket): string {
  return packet.titleOptions?.find((option) => option.selected)?.text
    ?? packet.titleOptions?.[0]?.text
    ?? 'Publishing packet'
}

export function buildWorkQueue(input: WorkQueueInput): WorkQueueGroups {
  const groups: WorkQueueGroups = {
    needs_input: [],
    in_production: [],
    ready_to_review: [],
    scheduled_live: [],
  }

  for (const video of input.videos) {
    if (!video.id) continue
    const group = videoGroup(video)
    if (!group) continue
    groups[group].push({
      key: `video:${video.id}`,
      kind: 'video',
      group,
      id: video.id,
      title: video.title,
      channelWorkspaceId: video.channelWorkspaceId,
      video,
    })
  }
  for (const packet of input.packets) {
    if (!packet.id) continue
    const group = packetGroup(packet)
    if (!group) continue
    groups[group].push({
      key: `packet:${packet.id}`,
      kind: 'packet',
      group,
      id: packet.id,
      title: packetTitle(packet),
      channelWorkspaceId: packet.channelWorkspaceId,
      packet,
    })
  }
  for (const draft of input.productionDrafts) {
    if (!draft.id) continue
    const group = draftGroup(draft)
    if (!group) continue
    groups[group].push({
      key: `production_draft:${draft.id}`,
      kind: 'production_draft',
      group,
      id: draft.id,
      title: draft.title,
      channelWorkspaceId: draft.channelWorkspaceId,
      draft,
    })
  }
  for (const job of input.renderJobs) {
    if (!job.id) continue
    const group = renderJobGroup(job)
    if (!group) continue
    groups[group].push({
      key: `render_job:${job.id}`,
      kind: 'render_job',
      group,
      id: job.id,
      title: job.title,
      channelWorkspaceId: job.channelWorkspaceId,
      renderJob: job,
    })
  }

  const kindOrder: Record<WorkQueueItemKind, number> = { video: 0, packet: 1, production_draft: 2, render_job: 3 }
  for (const key of Object.keys(groups) as WorkQueueGroupKey[]) {
    groups[key].sort((a, b) => kindOrder[a.kind] - kindOrder[b.kind] || a.title.localeCompare(b.title))
  }
  return groups
}

export function workQueuePendingCount(groups: WorkQueueGroups): number {
  return groups.needs_input.length
}

export function filterWorkQueueByChannel(groups: WorkQueueGroups, channelWorkspaceId: string | null): WorkQueueGroups {
  if (!channelWorkspaceId) return groups
  const filtered = {} as WorkQueueGroups
  for (const key of Object.keys(groups) as WorkQueueGroupKey[]) {
    filtered[key] = groups[key].filter((item) => !item.channelWorkspaceId || item.channelWorkspaceId === channelWorkspaceId)
  }
  return filtered
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx jest __tests__/lib/youtube-studio-work-queue.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/youtube-studio/work-queue.ts __tests__/lib/youtube-studio-work-queue.test.ts
git commit -m "feat(youtube-studio): pure work-queue grouping for the client cockpit"
```

---

### Task 2: Channel header component (selector + connection status)

**Files:**
- Create: `components/youtube-studio/YouTubeStudioChannelHeader.tsx`
- Test: `__tests__/app/youtube-studio-cockpit.test.tsx` (new file, grows across Tasks 2–4)

Reuses `ConnectionChip` / `channelNeedsReconnect` from `YouTubeStudioCards.tsx`.

- [ ] **Step 1: Write the failing test**

Create `__tests__/app/youtube-studio-cockpit.test.tsx`:

```tsx
import React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { YouTubeStudioChannelHeader } from '@/components/youtube-studio/YouTubeStudioChannelHeader'
import type { YouTubeChannelWorkspace } from '@/lib/youtube-studio/types'

function channel(id: string, title: string, extra: Partial<YouTubeChannelWorkspace> = {}): YouTubeChannelWorkspace {
  return {
    id,
    orgId: 'org-1',
    title,
    youtubeHandle: `@${title.toLowerCase().replace(/\s/g, '')}`,
    status: 'active',
    connectedAccountId: 'acct-1',
    publishingReadiness: { accountStatus: 'connected' },
    contentPillars: [],
    avoidTopics: [],
    deleted: false,
    ...extra,
  } as YouTubeChannelWorkspace
}

describe('YouTubeStudioChannelHeader', () => {
  const channels = [channel('channel-1', 'Acme Films'), channel('channel-2', 'Stale', { publishingReadiness: { accountStatus: 'needs_reauth' } })]

  it('renders a channel selector with an all-channels option and fires onSelect', () => {
    const onSelect = jest.fn()
    render(
      <YouTubeStudioChannelHeader
        channels={channels}
        selectedChannelId={null}
        onSelect={onSelect}
        oauthHref="/api/v1/social/oauth/youtube?feature=youtube_studio"
        linkAnotherChannelHref="/api/v1/social/oauth/youtube?prompt=select_account"
      />,
    )
    const selector = screen.getByLabelText('Channel')
    expect(selector).toHaveValue('')
    fireEvent.change(selector, { target: { value: 'channel-2' } })
    expect(onSelect).toHaveBeenCalledWith('channel-2')
  })

  it('shows the connection chip and a reconnect link for the selected channel', () => {
    render(
      <YouTubeStudioChannelHeader
        channels={channels}
        selectedChannelId="channel-2"
        onSelect={jest.fn()}
        oauthHref="/oauth"
        linkAnotherChannelHref="/oauth?prompt=select_account"
      />,
    )
    expect(screen.getByText('Needs reconnect')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Reconnect' })).toHaveAttribute('href', '/oauth')
  })

  it('offers Link YouTube channel when no channels exist', () => {
    render(
      <YouTubeStudioChannelHeader
        channels={[]}
        selectedChannelId={null}
        onSelect={jest.fn()}
        oauthHref="/oauth"
        linkAnotherChannelHref="/oauth?prompt=select_account"
      />,
    )
    expect(screen.getByRole('link', { name: 'Link YouTube channel' })).toHaveAttribute('href', '/oauth')
    expect(screen.queryByLabelText('Channel')).not.toBeInTheDocument()
  })

  it('offers Link another channel when channels exist', () => {
    render(
      <YouTubeStudioChannelHeader
        channels={channels}
        selectedChannelId={null}
        onSelect={jest.fn()}
        oauthHref="/oauth"
        linkAnotherChannelHref="/oauth?prompt=select_account"
      />,
    )
    expect(screen.getByRole('link', { name: 'Link another channel' })).toHaveAttribute('href', '/oauth?prompt=select_account')
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx jest __tests__/app/youtube-studio-cockpit.test.tsx`
Expected: FAIL — `Cannot find module '@/components/youtube-studio/YouTubeStudioChannelHeader'`

- [ ] **Step 3: Write the component**

Create `components/youtube-studio/YouTubeStudioChannelHeader.tsx`:

```tsx
'use client'

import type { YouTubeChannelWorkspace } from '@/lib/youtube-studio/types'
import { channelNeedsReconnect, ConnectionChip } from '@/components/youtube-studio/YouTubeStudioCards'

interface YouTubeStudioChannelHeaderProps {
  channels: YouTubeChannelWorkspace[]
  /** null = all channels */
  selectedChannelId: string | null
  onSelect: (channelId: string | null) => void
  oauthHref: string
  linkAnotherChannelHref: string
}

export function YouTubeStudioChannelHeader({
  channels,
  selectedChannelId,
  onSelect,
  oauthHref,
  linkAnotherChannelHref,
}: YouTubeStudioChannelHeaderProps) {
  const selected = channels.find((channel) => channel.id === selectedChannelId) ?? null

  if (channels.length === 0) {
    return (
      <section className="pib-card-section flex flex-wrap items-center justify-between gap-3 p-4">
        <p className="text-sm text-on-surface-variant">No YouTube channel is connected yet. Linking a channel unlocks requests, edits, and publishing.</p>
        <a href={oauthHref} className="pib-btn-primary text-sm">Link YouTube channel</a>
      </section>
    )
  }

  return (
    <section className="pib-card-section flex flex-wrap items-center gap-3 p-4">
      <label className="flex min-w-0 items-center gap-2 text-sm text-on-surface-variant">
        <span className="text-xs font-label uppercase tracking-widest">Channel</span>
        <select
          aria-label="Channel"
          value={selectedChannelId ?? ''}
          onChange={(event) => onSelect(event.target.value || null)}
          className="rounded-lg border border-[var(--color-pib-line)] bg-[var(--color-surface)] px-3 py-2 text-sm text-on-surface"
        >
          <option value="">All channels ({channels.length})</option>
          {channels.map((channel) => (
            <option key={channel.id} value={channel.id ?? ''}>
              {channel.title || channel.youtubeHandle || 'YouTube channel'}
            </option>
          ))}
        </select>
      </label>
      {selected ? (
        <div className="flex min-w-0 items-center gap-2">
          <ConnectionChip channel={selected} />
          {selected.youtubeHandle ? (
            <span className="truncate text-xs text-on-surface-variant">{selected.youtubeHandle}</span>
          ) : null}
          {channelNeedsReconnect(selected) ? (
            <a href={oauthHref} className="pib-btn-primary text-sm">Reconnect</a>
          ) : null}
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          {channels.map((channel) => (
            <span key={channel.id} className="flex items-center gap-1 text-xs text-on-surface-variant">
              <span className="max-w-[10rem] truncate">{channel.title}</span>
              <ConnectionChip channel={channel} />
            </span>
          ))}
        </div>
      )}
      <a href={linkAnotherChannelHref} className="pib-btn-ghost ml-auto text-sm">Link another channel</a>
    </section>
  )
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx jest __tests__/app/youtube-studio-cockpit.test.tsx`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add components/youtube-studio/YouTubeStudioChannelHeader.tsx __tests__/app/youtube-studio-cockpit.test.tsx
git commit -m "feat(youtube-studio): channel header with selector and connection status"
```

---

### Task 3: Work-queue component

**Files:**
- Create: `components/youtube-studio/YouTubeStudioWorkQueue.tsx`
- Test: `__tests__/app/youtube-studio-cockpit.test.tsx` (append)

Presentational: receives pre-built `WorkQueueGroups` plus a `renderItemActions` render-prop so the parent supplies decision forms / buttons. Empty groups render a one-line hint (not a broken-looking empty card grid); a fully empty queue renders a single friendly card.

- [ ] **Step 1: Write the failing test** — append to `__tests__/app/youtube-studio-cockpit.test.tsx`:

```tsx
import { YouTubeStudioWorkQueue } from '@/components/youtube-studio/YouTubeStudioWorkQueue'
import { buildWorkQueue } from '@/lib/youtube-studio/work-queue'
import type { YouTubeVideoProject } from '@/lib/youtube-studio/types'

function queueVideo(id: string, status: YouTubeVideoProject['status']): YouTubeVideoProject {
  return {
    id,
    orgId: 'org-1',
    channelWorkspaceId: 'channel-1',
    title: `Video ${id}`,
    objective: 'Grow the channel',
    videoType: 'long_form',
    status,
    visibility: { showInClientPortal: true },
    deleted: false,
  } as YouTubeVideoProject
}

describe('YouTubeStudioWorkQueue', () => {
  it('renders the four groups with counts and item cards', () => {
    const groups = buildWorkQueue({
      videos: [queueVideo('v1', 'client_review'), queueVideo('v2', 'production'), queueVideo('v3', 'live')],
      packets: [],
      productionDrafts: [],
      renderJobs: [],
    })
    render(<YouTubeStudioWorkQueue groups={groups} renderItemActions={() => null} />)

    expect(screen.getByRole('heading', { name: /Needs your input/ })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /In production/ })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /Ready to review/ })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /Scheduled & live/ })).toBeInTheDocument()
    expect(screen.getByText('Video v1')).toBeInTheDocument()
    expect(screen.getByText('Video v2')).toBeInTheDocument()
    expect(screen.getByText('Video v3')).toBeInTheDocument()
    // empty group shows its hint, populated groups do not
    expect(screen.getByText('Approved drafts, renders, and packets ready for a final look appear here.')).toBeInTheDocument()
  })

  it('renders custom actions for items via renderItemActions', () => {
    const groups = buildWorkQueue({
      videos: [queueVideo('v1', 'client_review')],
      packets: [],
      productionDrafts: [],
      renderJobs: [],
    })
    render(
      <YouTubeStudioWorkQueue
        groups={groups}
        renderItemActions={(item) => <button type="button">Decide {item.id}</button>}
      />,
    )
    expect(screen.getByRole('button', { name: 'Decide v1' })).toBeInTheDocument()
  })

  it('renders a single friendly empty state when the whole queue is empty', () => {
    const groups = buildWorkQueue({ videos: [], packets: [], productionDrafts: [], renderJobs: [] })
    render(<YouTubeStudioWorkQueue groups={groups} renderItemActions={() => null} />)
    expect(screen.getByText(/No video work yet/)).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: /Needs your input/ })).not.toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx jest __tests__/app/youtube-studio-cockpit.test.tsx`
Expected: FAIL — `Cannot find module '@/components/youtube-studio/YouTubeStudioWorkQueue'`

- [ ] **Step 3: Write the component**

Create `components/youtube-studio/YouTubeStudioWorkQueue.tsx`:

```tsx
'use client'

import type { ReactNode } from 'react'
import { WORK_QUEUE_GROUPS, type WorkQueueGroups, type WorkQueueItem } from '@/lib/youtube-studio/work-queue'
import { StatusPill, YouTubeVideoCard } from '@/components/youtube-studio/YouTubeStudioCards'

interface YouTubeStudioWorkQueueProps {
  groups: WorkQueueGroups
  renderItemActions: (item: WorkQueueItem) => ReactNode
}

const KIND_LABEL: Record<WorkQueueItem['kind'], string> = {
  video: 'Video',
  packet: 'Publishing packet',
  production_draft: 'Production draft',
  render_job: 'Video cut',
}

function itemStatus(item: WorkQueueItem): string | undefined {
  return item.video?.status ?? item.packet?.status ?? item.draft?.status ?? item.renderJob?.status
}

function WorkQueueItemCard({ item, actions }: { item: WorkQueueItem; actions: ReactNode }) {
  if (item.kind === 'video' && item.video) {
    return <YouTubeVideoCard video={item.video}>{actions}</YouTubeVideoCard>
  }
  const previewUrl = item.renderJob?.output?.previewUrl || item.renderJob?.output?.downloadUrl
  return (
    <article className="pib-card-section min-w-0 space-y-3 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-label uppercase tracking-widest text-on-surface-variant">{KIND_LABEL[item.kind]}</p>
          <h4 className="break-words font-headline text-base font-semibold text-on-surface">{item.title}</h4>
        </div>
        <StatusPill status={itemStatus(item)} />
      </div>
      {previewUrl ? (
        <a href={previewUrl} target="_blank" rel="noreferrer" className="pib-btn-ghost text-sm">Watch preview</a>
      ) : null}
      {actions ? <div className="flex flex-wrap gap-2 pt-1">{actions}</div> : null}
    </article>
  )
}

export function YouTubeStudioWorkQueue({ groups, renderItemActions }: YouTubeStudioWorkQueueProps) {
  const totalItems = WORK_QUEUE_GROUPS.reduce((sum, group) => sum + groups[group.key].length, 0)

  if (totalItems === 0) {
    return (
      <div className="pib-card-section p-6 text-sm text-on-surface-variant">
        No video work yet. Create a video edit or request a PiB video to start the workflow.
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {WORK_QUEUE_GROUPS.map((group) => {
        const items = groups[group.key]
        return (
          <section key={group.key} className="space-y-3">
            <h3 className="flex items-center gap-2 font-headline text-lg font-semibold text-on-surface">
              {group.label}
              <span className="text-sm font-normal text-on-surface-variant">({items.length})</span>
            </h3>
            {items.length === 0 ? (
              <p className="rounded-lg border border-dashed border-[var(--color-pib-line)] p-3 text-xs text-on-surface-variant">
                {group.emptyHint}
              </p>
            ) : (
              <div className="grid gap-3 lg:grid-cols-2">
                {items.map((item) => (
                  <WorkQueueItemCard key={item.key} item={item} actions={renderItemActions(item)} />
                ))}
              </div>
            )}
          </section>
        )
      })}
    </div>
  )
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx jest __tests__/app/youtube-studio-cockpit.test.tsx`
Expected: PASS (7 tests so far)

- [ ] **Step 5: Commit**

```bash
git add components/youtube-studio/YouTubeStudioWorkQueue.tsx __tests__/app/youtube-studio-cockpit.test.tsx
git commit -m "feat(youtube-studio): grouped client work queue component"
```

---

### Task 4: Details tabs component (technical collections behind contextual tabs)

**Files:**
- Create: `components/youtube-studio/YouTubeStudioDetailsTabs.tsx`
- Test: `__tests__/app/youtube-studio-cockpit.test.tsx` (append)

This component absorbs the long technical sections currently inlined in `YouTubeStudioPortalWorkspace.tsx` (source assets lines 673–691, clip candidates 693–717, production drafts 719–804, render jobs 806–886, publishing packets 892–968, release plans 970–1001, analytics 1003–1041) **and** their helper functions (`Metric`, `sourceAssetMeta`, `clipMeta`, `clipGateEntries`, `productionDraftMeta`, `productionSceneMeta`, `productionDraftGateEntries`, `renderJobMeta`, `renderTimelineMeta`, `renderJobGateEntries`, `formatToken`, `packetTitle`, `packetGateEntries`, `releasePlanGateEntries` — currently lines 1122–1202 of that file). Only tabs with at least one record render. If every collection is empty the component renders `null` (the cockpit stays clean).

- [ ] **Step 1: Write the failing test** — append to `__tests__/app/youtube-studio-cockpit.test.tsx`:

```tsx
import { YouTubeStudioDetailsTabs } from '@/components/youtube-studio/YouTubeStudioDetailsTabs'

const noopDecisions = {
  canReviewApprovals: true,
  draftNotes: {},
  renderNotes: {},
  packetNotes: {},
  reviewingDraftId: null,
  reviewingRenderId: null,
  reviewingPacketId: null,
  onDraftNotesChange: jest.fn(),
  onRenderNotesChange: jest.fn(),
  onPacketNotesChange: jest.fn(),
  onDraftDecision: jest.fn(),
  onRenderDecision: jest.fn(),
  onPacketDecision: jest.fn(),
}

describe('YouTubeStudioDetailsTabs', () => {
  it('renders nothing when every collection is empty', () => {
    const { container } = render(
      <YouTubeStudioDetailsTabs
        sourceAssets={[]}
        clipCandidates={[]}
        productionDrafts={[]}
        renderJobs={[]}
        packets={[]}
        releasePlans={[]}
        analytics={[]}
        {...noopDecisions}
      />,
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('only renders tabs for populated collections and switches between them', () => {
    render(
      <YouTubeStudioDetailsTabs
        sourceAssets={[{ id: 'a1', orgId: 'org-1', channelWorkspaceId: 'channel-1', title: 'Raw shoot', assetType: 'raw_footage', status: 'ready', deleted: false } as never]}
        clipCandidates={[]}
        productionDrafts={[]}
        renderJobs={[{ id: 'r1', orgId: 'org-1', channelWorkspaceId: 'channel-1', videoProjectId: 'v1', title: 'Cut A', renderType: 'full_video', targetFormat: 'horizontal_16_9', status: 'qa_review', versionNumber: 1, timeline: [], deleted: false } as never]}
        packets={[]}
        releasePlans={[]}
        analytics={[]}
        {...noopDecisions}
      />,
    )
    expect(screen.getByRole('tab', { name: /Source assets \(1\)/ })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /Renders \(1\)/ })).toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: /Clip candidates/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: /Packets/ })).not.toBeInTheDocument()

    // first populated tab is active by default
    expect(screen.getByText('Raw shoot')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('tab', { name: /Renders \(1\)/ }))
    expect(screen.getByText('Cut A')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Approve render' })).toBeInTheDocument()
  })

  it('fires render decisions from the renders tab', () => {
    const onRenderDecision = jest.fn()
    render(
      <YouTubeStudioDetailsTabs
        sourceAssets={[]}
        clipCandidates={[]}
        productionDrafts={[]}
        renderJobs={[{ id: 'r1', orgId: 'org-1', channelWorkspaceId: 'channel-1', videoProjectId: 'v1', title: 'Cut A', renderType: 'full_video', targetFormat: 'horizontal_16_9', status: 'qa_review', versionNumber: 1, timeline: [], deleted: false } as never]}
        packets={[]}
        releasePlans={[]}
        analytics={[]}
        {...noopDecisions}
        onRenderDecision={onRenderDecision}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Approve render' }))
    expect(onRenderDecision).toHaveBeenCalledWith('r1', 'approved')
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx jest __tests__/app/youtube-studio-cockpit.test.tsx`
Expected: FAIL — `Cannot find module '@/components/youtube-studio/YouTubeStudioDetailsTabs'`

- [ ] **Step 3: Write the component**

Create `components/youtube-studio/YouTubeStudioDetailsTabs.tsx`. Scaffolding below is complete; the seven `*TabContent` bodies are the existing JSX blocks moved verbatim from `YouTubeStudioPortalWorkspace.tsx` (line ranges above), with `capabilities.canReviewApprovals` → `props.canReviewApprovals`, note-state setters → the `on*NotesChange` callbacks, and `saveDraftDecision/saveRenderDecision/savePacketDecision` → `onDraftDecision/onRenderDecision/onPacketDecision`. Move the helper functions listed in the task intro into this file unchanged.

```tsx
'use client'

import { useMemo, useState } from 'react'
import type {
  YouTubeAnalyticsSnapshot,
  YouTubeClipCandidate,
  YouTubeProductionDraft,
  YouTubePublishingPacket,
  YouTubeReleasePlan,
  YouTubeRenderJob,
  YouTubeSourceAsset,
} from '@/lib/youtube-studio/types'

type ClientDecision = 'approved' | 'changes_requested' | 'rejected'
type DetailsTabKey = 'source_assets' | 'clips' | 'drafts' | 'renders' | 'packets' | 'release_plans' | 'analytics'

export interface YouTubeStudioDetailsTabsProps {
  sourceAssets: YouTubeSourceAsset[]
  clipCandidates: YouTubeClipCandidate[]
  productionDrafts: YouTubeProductionDraft[]
  renderJobs: YouTubeRenderJob[]
  packets: YouTubePublishingPacket[]
  releasePlans: YouTubeReleasePlan[]
  analytics: YouTubeAnalyticsSnapshot[]
  canReviewApprovals: boolean
  draftNotes: Record<string, string>
  renderNotes: Record<string, string>
  packetNotes: Record<string, string>
  reviewingDraftId: string | null
  reviewingRenderId: string | null
  reviewingPacketId: string | null
  onDraftNotesChange: (id: string, value: string) => void
  onRenderNotesChange: (id: string, value: string) => void
  onPacketNotesChange: (id: string, value: string) => void
  onDraftDecision: (id: string, decision: ClientDecision) => void
  onRenderDecision: (id: string, decision: ClientDecision) => void
  onPacketDecision: (id: string, decision: ClientDecision) => void
}

export function YouTubeStudioDetailsTabs(props: YouTubeStudioDetailsTabsProps) {
  const tabs = useMemo(() => {
    const definitions: Array<{ key: DetailsTabKey; label: string; count: number }> = [
      { key: 'source_assets', label: 'Source assets', count: props.sourceAssets.length },
      { key: 'clips', label: 'Clip candidates', count: props.clipCandidates.length },
      { key: 'drafts', label: 'Drafts', count: props.productionDrafts.length },
      { key: 'renders', label: 'Renders', count: props.renderJobs.length },
      { key: 'packets', label: 'Publishing packets', count: props.packets.length },
      { key: 'release_plans', label: 'Release plans', count: props.releasePlans.length },
      { key: 'analytics', label: 'Analytics', count: props.analytics.length },
    ]
    return definitions.filter((tab) => tab.count > 0)
  }, [props.sourceAssets, props.clipCandidates, props.productionDrafts, props.renderJobs, props.packets, props.releasePlans, props.analytics])

  const [requestedTab, setRequestedTab] = useState<DetailsTabKey | null>(null)
  if (tabs.length === 0) return null
  const activeTab = tabs.some((tab) => tab.key === requestedTab) ? requestedTab! : tabs[0].key

  return (
    <section className="space-y-3">
      <h2 className="font-headline text-xl font-semibold text-on-surface">Production details</h2>
      <div role="tablist" aria-label="Production details" className="flex flex-wrap gap-2">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            type="button"
            role="tab"
            aria-selected={tab.key === activeTab}
            onClick={() => setRequestedTab(tab.key)}
            className={tab.key === activeTab ? 'pib-btn-primary text-sm' : 'pib-btn-ghost text-sm'}
          >
            {tab.label} ({tab.count})
          </button>
        ))}
      </div>
      <div role="tabpanel">
        {activeTab === 'source_assets' ? <SourceAssetsTabContent assets={props.sourceAssets} /> : null}
        {activeTab === 'clips' ? <ClipCandidatesTabContent clips={props.clipCandidates} /> : null}
        {activeTab === 'drafts' ? <ProductionDraftsTabContent {...props} /> : null}
        {activeTab === 'renders' ? <RenderJobsTabContent {...props} /> : null}
        {activeTab === 'packets' ? <PacketsTabContent {...props} /> : null}
        {activeTab === 'release_plans' ? <ReleasePlansTabContent plans={props.releasePlans} /> : null}
        {activeTab === 'analytics' ? <AnalyticsTabContent analytics={props.analytics} /> : null}
      </div>
    </section>
  )
}

// --- Tab bodies: JSX moved verbatim from YouTubeStudioPortalWorkspace.tsx ---
// SourceAssetsTabContent      <- lines 673-691  (drop the outer `{sourceAssets.length > 0 ?` guard and the h2)
// ClipCandidatesTabContent    <- lines 693-717  (same treatment)
// ProductionDraftsTabContent  <- lines 719-804  (decision form wired to props.onDraftDecision / props.onDraftNotesChange / props.reviewingDraftId / props.draftNotes)
// RenderJobsTabContent        <- lines 806-886  (decision form wired to props.onRenderDecision / props.onRenderNotesChange / props.reviewingRenderId / props.renderNotes)
// PacketsTabContent           <- lines 892-968  (decision form wired to props.onPacketDecision / props.onPacketNotesChange / props.reviewingPacketId / props.packetNotes)
// ReleasePlansTabContent      <- lines 970-1001
// AnalyticsTabContent         <- lines 1003-1041
// Helpers moved verbatim from lines 1122-1202: Metric, sourceAssetMeta, clipMeta,
// clipGateEntries, productionDraftMeta, productionSceneMeta, productionDraftGateEntries,
// renderJobMeta, renderTimelineMeta, renderJobGateEntries, formatToken, packetTitle,
// packetGateEntries, releasePlanGateEntries.
```

Example of a fully wired tab body (Render jobs) so the wiring pattern is unambiguous — apply the same pattern to drafts and packets:

```tsx
function RenderJobsTabContent({
  renderJobs,
  canReviewApprovals,
  renderNotes,
  reviewingRenderId,
  onRenderNotesChange,
  onRenderDecision,
}: YouTubeStudioDetailsTabsProps) {
  return (
    <div className="space-y-3">
      {renderJobs.map((job) => (
        <article key={job.id ?? `${job.videoProjectId}-${job.versionNumber}`} className="pib-card-section space-y-3 p-4">
          {/* ...header/meta/timeline/gates JSX verbatim from lines 810-844... */}
          {canReviewApprovals && job.id && job.status === 'qa_review' ? (
            <div className="space-y-3">
              <textarea
                rows={3}
                disabled={reviewingRenderId === job.id}
                value={renderNotes[job.id] ?? ''}
                onChange={(event) => onRenderNotesChange(job.id!, event.target.value)}
                placeholder="Render notes for PiB"
                className="w-full rounded-xl border border-[var(--color-pib-line)] bg-transparent p-3 text-sm"
              />
              <div className="flex flex-wrap gap-2">
                <button type="button" disabled={Boolean(reviewingRenderId)} onClick={() => onRenderDecision(job.id!, 'approved')} className="pib-btn-primary text-sm">Approve render</button>
                <button type="button" disabled={Boolean(reviewingRenderId)} onClick={() => onRenderDecision(job.id!, 'changes_requested')} className="pib-btn-ghost text-sm">Request render changes</button>
                <button type="button" disabled={Boolean(reviewingRenderId)} onClick={() => onRenderDecision(job.id!, 'rejected')} className="pib-btn-ghost text-sm">Reject render</button>
              </div>
            </div>
          ) : null}
        </article>
      ))}
    </div>
  )
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx jest __tests__/app/youtube-studio-cockpit.test.tsx`
Expected: PASS (10 tests)

- [ ] **Step 5: Commit**

```bash
git add components/youtube-studio/YouTubeStudioDetailsTabs.tsx __tests__/app/youtube-studio-cockpit.test.tsx
git commit -m "feat(youtube-studio): contextual details tabs for technical collections"
```

---

### Task 5: Rewire the portal workspace into the cockpit

**Files:**
- Modify: `components/youtube-studio/YouTubeStudioPortalWorkspace.tsx`
- Modify: `__tests__/app/youtube-studio-connect-ux.test.tsx`
- Test: `__tests__/app/youtube-studio-cockpit.test.tsx` (append cockpit-assembly tests)

**Keep unchanged** in `YouTubeStudioPortalWorkspace.tsx`: all state, refs, `load`, `submitRequest`, `saveDecision`, `savePacketDecision`, `saveDraftDecision`, `saveRenderDecision`, `repurposeVideo`, the module-disabled branch, `buildRequestHelpText`/`joinHumanList`, `ChannelChoices`, `Field`, `TextArea`, and the OAuth href memos.

**Remove** from this file: the sections and helpers moved to `YouTubeStudioDetailsTabs` in Task 4, the old `activeTab: 'overview' | 'pipeline'` layout, `hasClientProductionWork`, and the imports for `YouTubeStudioPipelineBoard`/`YouTubeChannelCard` if no longer referenced. Keep `YouTubeStudioGuide` for the no-channel state. Keep `YouTubeStudioPipelineBoard` only if you want the "Pipeline" view — the cockpit work queue replaces it; delete the import and the component stays in the tree for the admin surface (do NOT delete `YouTubeStudioPipelineBoard.tsx` itself; `SendToYouTubeStudioButton` flows and admin views are out of scope).

- [ ] **Step 1: Write the failing tests**

Append a cockpit-assembly describe to `__tests__/app/youtube-studio-cockpit.test.tsx`:

```tsx
import { YouTubeStudioPortalWorkspace } from '@/components/youtube-studio/YouTubeStudioPortalWorkspace'
import { waitFor } from '@testing-library/react'

jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace: jest.fn(), push: jest.fn() }),
  usePathname: () => '/portal/youtube-studio',
  useSearchParams: () => new URLSearchParams(''),
}))

function cockpitPayload(overrides: Record<string, unknown> = {}) {
  return {
    success: true,
    data: {
      orgId: 'org-1',
      channels: [channel('channel-1', 'Acme Films')],
      series: [],
      videos: [],
      packets: [],
      releasePlans: [],
      sourceAssets: [],
      clipCandidates: [],
      productionDrafts: [],
      renderJobs: [],
      analytics: [],
      ...overrides,
    },
  }
}

describe('YouTubeStudioPortalWorkspace cockpit', () => {
  beforeEach(() => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => cockpitPayload() } as Response) as jest.Mock
  })

  it('renders the channel header, three primary action cards, and the work queue', async () => {
    render(<YouTubeStudioPortalWorkspace orgId="org-1" />)

    expect(await screen.findByLabelText('Channel')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Create video edit' })).toBeInTheDocument()
    expect(screen.getAllByRole('heading', { name: 'Request a PiB video' }).length).toBeGreaterThan(0)
    expect(screen.getByRole('heading', { name: 'Review pending work' })).toBeInTheDocument()
    expect(screen.getByText(/No video work yet/)).toBeInTheDocument()
  })

  it('hides the details tabs entirely when technical collections are empty', async () => {
    render(<YouTubeStudioPortalWorkspace orgId="org-1" />)
    await screen.findByLabelText('Channel')
    expect(screen.queryByRole('tab')).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Source assets' })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Render jobs' })).not.toBeInTheDocument()
  })

  it('shows a decision form on needs-input video cards and saves the decision', async () => {
    const fetchMock = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'PUT') return { ok: true, status: 200, json: async () => ({ success: true, data: { id: 'v1', updated: true } }) } as Response
      return {
        ok: true,
        status: 200,
        json: async () => cockpitPayload({
          videos: [{
            id: 'v1', orgId: 'org-1', channelWorkspaceId: 'channel-1', title: 'Launch teaser',
            objective: 'Announce launch', videoType: 'long_form', status: 'client_review',
            visibility: { showInClientPortal: true }, deleted: false,
          }],
        }),
      } as Response
    })
    global.fetch = fetchMock as jest.Mock

    render(<YouTubeStudioPortalWorkspace orgId="org-1" />)
    const approve = await screen.findByRole('button', { name: 'Approve' })
    fireEvent.click(approve)
    await waitFor(() => {
      const putCall = fetchMock.mock.calls.find(([, init]) => init?.method === 'PUT')
      expect(putCall).toBeTruthy()
      expect(JSON.parse(String(putCall?.[1]?.body))).toMatchObject({ id: 'v1', decision: 'approved' })
    })
  })

  it('filters the work queue by the selected channel', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => cockpitPayload({
        channels: [channel('channel-1', 'Acme Films'), channel('channel-2', 'Second')],
        videos: [
          { id: 'v1', orgId: 'org-1', channelWorkspaceId: 'channel-1', title: 'Acme video', objective: 'x', videoType: 'long_form', status: 'production', visibility: { showInClientPortal: true }, deleted: false },
          { id: 'v2', orgId: 'org-1', channelWorkspaceId: 'channel-2', title: 'Second video', objective: 'x', videoType: 'long_form', status: 'production', visibility: { showInClientPortal: true }, deleted: false },
        ],
      }),
    } as Response) as jest.Mock

    render(<YouTubeStudioPortalWorkspace orgId="org-1" />)
    expect(await screen.findByText('Acme video')).toBeInTheDocument()
    expect(screen.getByText('Second video')).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Channel'), { target: { value: 'channel-1' } })
    expect(screen.getByText('Acme video')).toBeInTheDocument()
    expect(screen.queryByText('Second video')).not.toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run to verify the new tests fail**

Run: `npx jest __tests__/app/youtube-studio-cockpit.test.tsx`
Expected: FAIL — cockpit describe fails (no `Channel` selector, no `Create video edit` heading in current layout)

- [ ] **Step 3: Rewrite the workspace layout**

In `YouTubeStudioPortalWorkspace.tsx`:

3a. Add imports and remove dead ones:

```tsx
import { buildWorkQueue, filterWorkQueueByChannel, type WorkQueueItem } from '@/lib/youtube-studio/work-queue'
import { YouTubeStudioChannelHeader } from '@/components/youtube-studio/YouTubeStudioChannelHeader'
import { YouTubeStudioWorkQueue } from '@/components/youtube-studio/YouTubeStudioWorkQueue'
import { YouTubeStudioDetailsTabs } from '@/components/youtube-studio/YouTubeStudioDetailsTabs'
```

Remove imports: `YouTubeStudioPipelineBoard`, `channelNeedsReconnect`, `YouTubeChannelCard` (the header owns channel display now). Keep `YouTubeVideoCard` OUT too — the work queue renders cards. Keep `YouTubeStudioGuide`, `YouTubeStudioOAuthReturnHandler`, `YouTubeStudioWorkspaceShell`, `VideoEditorProjectList`.

3b. Replace state `const [activeTab, setActiveTab] = useState<'overview' | 'pipeline'>('overview')` with:

```tsx
const [selectedChannelId, setSelectedChannelId] = useState<string | null>(null)
```

and add the queue memo after the existing `pendingWorkCount` calculations (keep those — the stat cards still use them):

```tsx
const workQueue = useMemo(
  () => filterWorkQueueByChannel(
    buildWorkQueue({ videos, packets, productionDrafts, renderJobs }),
    selectedChannelId,
  ),
  [videos, packets, productionDrafts, renderJobs, selectedChannelId],
)
```

Delete `hasClientProductionWork`. Replace `showOverviewSection` with:

```tsx
const workQueueRef = useRef<HTMLDivElement>(null)

function scrollToSection(target: 'request' | 'editor' | 'queue') {
  const element = target === 'request' ? requestFormRef.current : target === 'editor' ? editProjectsRef.current : workQueueRef.current
  const run = () => element?.scrollIntoView?.({ behavior: 'smooth', block: 'start' })
  if (typeof window.requestAnimationFrame === 'function') window.requestAnimationFrame(run)
  else run()
}
```

3c. Add the work-queue item action renderer (inside the component, before `return`). It reuses the existing decision handlers:

```tsx
function renderWorkQueueActions(item: WorkQueueItem) {
  if (item.kind === 'video' && item.video && capabilities.canReviewApprovals && isClientReviewOpen(item.video)) {
    return (
      <div className="w-full space-y-3">
        <textarea
          rows={3}
          disabled={reviewingId === item.id}
          value={reviewNotes[item.id] ?? ''}
          onChange={(event) => setReviewNotes((prev) => ({ ...prev, [item.id]: event.target.value }))}
          placeholder="Notes for PiB"
          className="w-full rounded-xl border border-[var(--color-pib-line)] bg-transparent p-3 text-sm"
        />
        <div className="flex flex-wrap gap-2">
          <button type="button" disabled={Boolean(reviewingId)} onClick={() => saveDecision(item.id, 'approved')} className="pib-btn-primary text-sm">Approve</button>
          <button type="button" disabled={Boolean(reviewingId)} onClick={() => saveDecision(item.id, 'changes_requested')} className="pib-btn-ghost text-sm">Request changes</button>
          <button type="button" disabled={Boolean(reviewingId)} onClick={() => saveDecision(item.id, 'rejected')} className="pib-btn-ghost text-sm">Reject</button>
        </div>
      </div>
    )
  }
  if (item.kind === 'video' && item.video?.status === 'live') {
    return <button type="button" onClick={() => void repurposeVideo(item.id)} className="pib-btn-ghost text-sm">Repurpose to social</button>
  }
  if (item.kind === 'packet' && item.packet?.status === 'client_review') {
    return <a href="#youtube-studio-details" className="pib-btn-primary text-sm">Review packet below</a>
  }
  if (item.kind === 'production_draft') {
    return <a href="#youtube-studio-details" className="pib-btn-primary text-sm">Review draft below</a>
  }
  if (item.kind === 'render_job' && item.renderJob?.status === 'qa_review') {
    return <a href="#youtube-studio-details" className="pib-btn-primary text-sm">Review render below</a>
  }
  return null
}
```

3d. Replace everything between `<Suspense fallback={null}>...</Suspense>` and the closing `</YouTubeStudioWorkspaceShell>` in the main (non-disabled) return with:

```tsx
<YouTubeStudioChannelHeader
  channels={channels}
  selectedChannelId={selectedChannelId}
  onSelect={setSelectedChannelId}
  oauthHref={youtubeOAuthHref}
  linkAnotherChannelHref={linkAnotherChannelHref}
/>

{channels.length === 0 && !loading ? <YouTubeStudioGuide oauthHref={youtubeOAuthHref} /> : null}

<section className="grid gap-3 md:grid-cols-3">
  <article className="pib-card-section flex min-w-0 flex-col gap-4 p-5">
    <div className="min-w-0">
      <p className="text-xs font-label uppercase tracking-widest text-on-surface-variant">Create</p>
      <h2 className="mt-1 font-headline text-xl font-semibold text-on-surface">Create video edit</h2>
      <p className="mt-2 text-sm text-on-surface-variant">Start a channel-linked edit project in the Video Editor or open recent edits.</p>
    </div>
    <button type="button" onClick={() => scrollToSection('editor')} className="pib-btn-primary mt-auto justify-center text-sm">
      Create video edit
    </button>
  </article>
  <article className="pib-card-section flex min-w-0 flex-col gap-4 p-5">
    <div className="min-w-0">
      <p className="text-xs font-label uppercase tracking-widest text-on-surface-variant">Request</p>
      <h2 className="mt-1 font-headline text-xl font-semibold text-on-surface">Request a PiB video</h2>
      <p className="mt-2 text-sm text-on-surface-variant">{channels.length ? 'Send PiB a clear brief for the next video.' : 'Link a channel before requesting production work.'}</p>
    </div>
    <button type="button" onClick={() => scrollToSection('request')} className="pib-btn-ghost mt-auto justify-center text-sm">
      Request a PiB video
    </button>
  </article>
  <article className="pib-card-section flex min-w-0 flex-col gap-4 p-5">
    <div className="min-w-0">
      <p className="text-xs font-label uppercase tracking-widest text-on-surface-variant">Review</p>
      <h2 className="mt-1 font-headline text-xl font-semibold text-on-surface">Review pending work</h2>
      <p className="mt-2 text-sm text-on-surface-variant">
        {pendingWorkCount ? `${pendingWorkCount} item${pendingWorkCount === 1 ? '' : 's'} waiting for a decision.` : 'No client decisions waiting right now.'}
      </p>
    </div>
    <button type="button" onClick={() => scrollToSection('queue')} className="pib-btn-ghost mt-auto justify-center text-sm">
      Review pending work
    </button>
  </article>
</section>

<div className="grid gap-6 lg:grid-cols-[1fr_360px]">
  <section className="space-y-6">
    <div ref={workQueueRef}>
      <YouTubeStudioWorkQueue groups={workQueue} renderItemActions={renderWorkQueueActions} />
    </div>

    <div id="youtube-studio-details">
      <YouTubeStudioDetailsTabs
        sourceAssets={sourceAssets}
        clipCandidates={clipCandidates}
        productionDrafts={productionDrafts}
        renderJobs={renderJobs}
        packets={packets}
        releasePlans={releasePlans}
        analytics={analytics}
        canReviewApprovals={capabilities.canReviewApprovals}
        draftNotes={draftNotes}
        renderNotes={renderNotes}
        packetNotes={packetNotes}
        reviewingDraftId={reviewingDraftId}
        reviewingRenderId={reviewingRenderId}
        reviewingPacketId={reviewingPacketId}
        onDraftNotesChange={(id, value) => setDraftNotes((prev) => ({ ...prev, [id]: value }))}
        onRenderNotesChange={(id, value) => setRenderNotes((prev) => ({ ...prev, [id]: value }))}
        onPacketNotesChange={(id, value) => setPacketNotes((prev) => ({ ...prev, [id]: value }))}
        onDraftDecision={(id, decision) => void saveDraftDecision(id, decision)}
        onRenderDecision={(id, decision) => void saveRenderDecision(id, decision)}
        onPacketDecision={(id, decision) => void savePacketDecision(id, decision)}
      />
    </div>

    <div ref={editProjectsRef}>
      <VideoEditorProjectList orgId={activeOrgId} channelOptions={channels} compact />
    </div>
  </section>

  <aside className="h-fit space-y-4 lg:sticky lg:top-6">
    {/* Keep the existing "Link your channel" card (current lines 1051-1089) verbatim */}
    {/* Keep the existing request form / disabled-notice block (current lines 1091-1114) verbatim */}
  </aside>
</div>
```

Also update the shell `description` prop to: `"Create or request videos, track the work PiB is producing, and approve what goes live on your channel."`

3e. Update `__tests__/app/youtube-studio-connect-ux.test.tsx` — the OAuth-handler, channel-card, and request-form describes still pass; fix the layout-coupled assertions:

- `'offers Reconnect only on channels that need reauth'`: the Reconnect link now only appears when the stale channel is selected. Replace the body with:

```tsx
render(<YouTubeStudioPortalWorkspace orgId="lumen-org" />)
const selector = await screen.findByLabelText('Channel')
fireEvent.change(selector, { target: { value: 'channel-2' } })
expect(screen.getByRole('link', { name: 'Reconnect' })).toBeInTheDocument()
fireEvent.change(selector, { target: { value: 'channel-1' } })
expect(screen.queryByRole('link', { name: 'Reconnect' })).not.toBeInTheDocument()
```

- `'puts the client cockpit actions at the top of the portal workspace'`: replace `screen.getByText('Connected channels')` / `'Active video work'` / `'Waiting for review'` assertions (the middle stat band is gone; the shell StatCards remain) with:

```tsx
expect(screen.getByRole('heading', { name: 'Create video edit' })).toBeInTheDocument()
```

  keeping the `Request a PiB video` and `Review pending work` heading assertions.

- `'does not render empty internal production buckets on the portal overview'`: replace `await screen.findByRole('heading', { name: 'Review queue' })` with `await screen.findByText(/No video work yet/)`, and replace the final `expect(screen.getByText(/Production details will appear here/i))` with `expect(screen.queryByRole('tab')).not.toBeInTheDocument()`.

- Any assertion referencing the `Overview`/`Pipeline` tab buttons: delete (the pipeline board is replaced by the work queue).

- [ ] **Step 4: Run the full jsdom suite for these files**

Run: `npx jest __tests__/app/youtube-studio-cockpit.test.tsx __tests__/app/youtube-studio-connect-ux.test.tsx __tests__/app/youtube-studio-portal-module-disabled.test.tsx`
Expected: PASS. If `youtube-studio-portal-module-disabled.test.tsx` fails, the module-disabled branch was altered — restore it (it must stay exactly as before).

- [ ] **Step 5: Commit**

```bash
git add components/youtube-studio/YouTubeStudioPortalWorkspace.tsx __tests__/app/youtube-studio-cockpit.test.tsx __tests__/app/youtube-studio-connect-ux.test.tsx
git commit -m "feat(youtube-studio): client cockpit layout for the portal workspace"
```

---

### Task 6: Update the shared-workspace source-standard test

**Files:**
- Modify: `__tests__/app/youtube-studio-shared-workspace.test.ts`

This node test asserts on raw source text and will fail after Task 5 because packets/analytics markup moved out of `YouTubeStudioPortalWorkspace.tsx`.

- [ ] **Step 1: Run it to see the exact failures**

Run: `npx jest __tests__/app/youtube-studio-shared-workspace.test.ts`
Expected: FAIL on `portalWorkspace` assertions for `'Publishing packets'` and `'Analytics summaries'`.

- [ ] **Step 2: Update the assertions**

In the `portalWorkspace` block, replace:

```ts
expect(portalWorkspace).toContain('Publishing packets')
...
expect(portalWorkspace).toContain('Analytics summaries')
```

with:

```ts
const detailsTabs = source('components/youtube-studio/YouTubeStudioDetailsTabs.tsx')
const workQueue = source('components/youtube-studio/YouTubeStudioWorkQueue.tsx')
const channelHeader = source('components/youtube-studio/YouTubeStudioChannelHeader.tsx')

// Cockpit standard: portal workspace composes the cockpit pieces
expect(portalWorkspace).toContain('@/components/youtube-studio/YouTubeStudioChannelHeader')
expect(portalWorkspace).toContain('@/components/youtube-studio/YouTubeStudioWorkQueue')
expect(portalWorkspace).toContain('@/components/youtube-studio/YouTubeStudioDetailsTabs')
expect(portalWorkspace).toContain('buildWorkQueue')
// Technical collections live behind contextual tabs, not on the landing page
expect(detailsTabs).toContain('Publishing packets')
expect(detailsTabs).toContain('Analytics')
expect(detailsTabs).toContain('Source assets')
expect(workQueue).toContain('Needs your input')
expect(channelHeader).toContain('ConnectionChip')
```

Keep every other assertion in the file as-is (`Request a PiB video`, `ChannelChoices`, `buildRequestHelpText`, `submittingRequest`, `reviewingId` all still exist in the portal workspace).

- [ ] **Step 3: Run to verify it passes**

Run: `npx jest __tests__/app/youtube-studio-shared-workspace.test.ts`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add __tests__/app/youtube-studio-shared-workspace.test.ts
git commit -m "test(youtube-studio): update shared-workspace standard for cockpit layout"
```

---

### Task 7: Timeline trim handles (drag + keyboard)

**Files:**
- Modify: `components/video-editor/TimelinePanel.tsx`
- Test: `__tests__/app/video-editor-trim-ui.test.tsx` (new)

Design: each clip gets two edge handles. The clip's outer element becomes a `div` (the current `<button>` cannot legally contain the handle buttons); selection stays click/keyboard accessible via `role="button"`/`tabIndex`. Drag: `pointerdown` records `clientX`, listeners on `window` track movement, `pointerup` commits ONE `onTrimClip` call with the accumulated delta (so `VideoEditorShell` persists once per gesture). While dragging, a local preview offset adjusts the clip's rendered geometry. Keyboard: handles are focusable buttons; ArrowLeft/ArrowRight nudge by 0.1s (1s with Shift) and commit immediately.

- [ ] **Step 1: Write the failing test**

Create `__tests__/app/video-editor-trim-ui.test.tsx`:

```tsx
import React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { TimelinePanel } from '@/components/video-editor/TimelinePanel'
import type { EditorTimeline } from '@/lib/video-editor/types'

const timeline: EditorTimeline = {
  version: 1,
  tracks: [
    {
      id: 't1',
      kind: 'video',
      label: 'V1',
      clips: [
        { id: 'a', timelineStart: 0, duration: 4, media: { type: 'upload', fileId: 'f-a', url: 'https://x.test/a.mp4', mediaKind: 'video' } },
      ],
    },
  ],
}

function renderPanel(onTrimClip = jest.fn()) {
  const props = {
    timeline,
    selection: { trackId: 't1', clipIds: ['a'] },
    playheadSeconds: 0,
    pxPerSecond: 60,
    onSelectionChange: jest.fn(),
    onSeek: jest.fn(),
    onZoomChange: jest.fn(),
    onMoveClip: jest.fn(),
    onTrimClip,
    onSplitAtPlayhead: jest.fn(),
    onRemoveSelected: jest.fn(),
    onToggleTrackFlag: jest.fn(),
    onAddTrack: jest.fn(),
    onAddTextClip: jest.fn(),
  }
  render(<TimelinePanel {...props} />)
  return { onTrimClip }
}

describe('TimelinePanel trim handles', () => {
  it('renders start and end trim handles on selected clips', () => {
    renderPanel()
    expect(screen.getByRole('button', { name: 'Trim start of clip a' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Trim end of clip a' })).toBeInTheDocument()
  })

  it('commits a single start-edge trim after a pointer drag (px / pxPerSecond)', () => {
    const { onTrimClip } = renderPanel()
    const handle = screen.getByRole('button', { name: 'Trim start of clip a' })
    fireEvent.pointerDown(handle, { clientX: 100, pointerId: 1 })
    fireEvent.pointerMove(window, { clientX: 160, pointerId: 1 })
    fireEvent.pointerUp(window, { clientX: 160, pointerId: 1 })
    expect(onTrimClip).toHaveBeenCalledTimes(1)
    expect(onTrimClip).toHaveBeenCalledWith('t1', 'a', 'start', 1) // 60px at 60 px/s
  })

  it('commits an end-edge trim with a negative delta when dragged left', () => {
    const { onTrimClip } = renderPanel()
    const handle = screen.getByRole('button', { name: 'Trim end of clip a' })
    fireEvent.pointerDown(handle, { clientX: 240, pointerId: 1 })
    fireEvent.pointerMove(window, { clientX: 180, pointerId: 1 })
    fireEvent.pointerUp(window, { clientX: 180, pointerId: 1 })
    expect(onTrimClip).toHaveBeenCalledWith('t1', 'a', 'end', -1)
  })

  it('ignores sub-threshold drags', () => {
    const { onTrimClip } = renderPanel()
    const handle = screen.getByRole('button', { name: 'Trim start of clip a' })
    fireEvent.pointerDown(handle, { clientX: 100, pointerId: 1 })
    fireEvent.pointerUp(window, { clientX: 100, pointerId: 1 })
    expect(onTrimClip).not.toHaveBeenCalled()
  })

  it('nudges the trim with arrow keys, 0.1s per press and 1s with Shift', () => {
    const { onTrimClip } = renderPanel()
    const handle = screen.getByRole('button', { name: 'Trim start of clip a' })
    fireEvent.keyDown(handle, { key: 'ArrowRight' })
    expect(onTrimClip).toHaveBeenCalledWith('t1', 'a', 'start', 0.1)
    fireEvent.keyDown(handle, { key: 'ArrowLeft', shiftKey: true })
    expect(onTrimClip).toHaveBeenCalledWith('t1', 'a', 'start', -1)
  })

  it('still selects a clip when its body is clicked', () => {
    const onSelectionChange = jest.fn()
    render(
      <TimelinePanel
        timeline={timeline}
        selection={null}
        playheadSeconds={0}
        pxPerSecond={60}
        onSelectionChange={onSelectionChange}
        onSeek={jest.fn()}
        onZoomChange={jest.fn()}
        onMoveClip={jest.fn()}
        onTrimClip={jest.fn()}
        onSplitAtPlayhead={jest.fn()}
        onRemoveSelected={jest.fn()}
        onToggleTrackFlag={jest.fn()}
        onAddTrack={jest.fn()}
        onAddTextClip={jest.fn()}
      />,
    )
    fireEvent.click(screen.getByTestId('timeline-clip-a'))
    expect(onSelectionChange).toHaveBeenCalledWith({ trackId: 't1', clipIds: ['a'] })
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx jest __tests__/app/video-editor-trim-ui.test.tsx`
Expected: FAIL — no elements named `Trim start of clip a`

- [ ] **Step 3: Implement the handles**

In `components/video-editor/TimelinePanel.tsx`:

3a. Add imports and drag state at the top of the component:

```tsx
import { useEffect, useState } from 'react'

const TRIM_COMMIT_THRESHOLD_SECONDS = 0.05
const TRIM_KEY_STEP_SECONDS = 0.1
const TRIM_KEY_STEP_LARGE_SECONDS = 1

interface TrimDragState {
  trackId: string
  clipId: string
  edge: 'start' | 'end'
  originClientX: number
  deltaSeconds: number
}
```

Inside `TimelinePanel` add:

```tsx
const [trimDrag, setTrimDrag] = useState<TrimDragState | null>(null)

useEffect(() => {
  if (!trimDrag) return
  const handleMove = (event: PointerEvent) => {
    setTrimDrag((current) => current
      ? { ...current, deltaSeconds: (event.clientX - current.originClientX) / pxPerSecond }
      : current)
  }
  const handleUp = (event: PointerEvent) => {
    const deltaSeconds = (event.clientX - trimDrag.originClientX) / pxPerSecond
    setTrimDrag(null)
    if (Math.abs(deltaSeconds) >= TRIM_COMMIT_THRESHOLD_SECONDS) {
      onTrimClip(trimDrag.trackId, trimDrag.clipId, trimDrag.edge, Math.round(deltaSeconds * 1000) / 1000)
    }
  }
  window.addEventListener('pointermove', handleMove)
  window.addEventListener('pointerup', handleUp)
  return () => {
    window.removeEventListener('pointermove', handleMove)
    window.removeEventListener('pointerup', handleUp)
  }
}, [trimDrag, pxPerSecond, onTrimClip])

function handleTrimKeyDown(event: React.KeyboardEvent, trackId: string, clipId: string, edge: 'start' | 'end') {
  if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
  event.preventDefault()
  event.stopPropagation()
  const step = event.shiftKey ? TRIM_KEY_STEP_LARGE_SECONDS : TRIM_KEY_STEP_SECONDS
  onTrimClip(trackId, clipId, edge, event.key === 'ArrowLeft' ? -step : step)
}
```

3b. Replace the clip `<button>` block (current lines 128–149) with a `div` wrapper carrying the geometry plus preview offsets, an inner selectable body, and two handles:

```tsx
{track.clips.map((clip) => {
  const selected = selection?.trackId === track.id && selection.clipIds.includes(clip.id)
  const isDraggingThisClip = trimDrag?.trackId === track.id && trimDrag.clipId === clip.id
  const startPreview = isDraggingThisClip && trimDrag.edge === 'start' ? trimDrag.deltaSeconds : 0
  const endPreview = isDraggingThisClip && trimDrag.edge === 'end' ? trimDrag.deltaSeconds : 0
  const left = (clip.timelineStart + startPreview) * pxPerSecond
  const width = Math.max(8, (clip.duration - startPreview + endPreview) * pxPerSecond)
  const clipLabel = clip.text?.content || clip.media?.mediaKind || clip.id
  return (
    <div
      key={clip.id}
      data-testid={`timeline-clip-${clip.id}`}
      role="button"
      tabIndex={0}
      aria-label={`Clip ${clipLabel}`}
      style={{ left: `${left}px`, width: `${width}px` }}
      className={[
        'group absolute top-3 h-12 overflow-hidden rounded-md border px-2 text-left text-xs',
        selected ? 'border-[var(--color-pib-primary)] bg-[var(--color-pib-primary)]/20 text-on-surface' : 'border-[var(--color-pib-line)] bg-white/[0.04] text-on-surface-variant',
      ].join(' ')}
      onClick={(event) => {
        event.stopPropagation()
        onSelectionChange({ trackId: track.id, clipIds: [clip.id] })
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onSelectionChange({ trackId: track.id, clipIds: [clip.id] })
        }
      }}
      onDoubleClick={() => onMoveClip(track.id, clip.id, snapSeconds(clip.timelineStart + 1, snapCandidates))}
    >
      <span className="block truncate">{clipLabel}</span>
      <span className="block truncate">{clip.duration}s</span>
      <button
        type="button"
        aria-label={`Trim start of clip ${clip.id}`}
        className="absolute inset-y-0 left-0 w-2 cursor-ew-resize bg-[var(--color-pib-primary)]/40 opacity-0 focus:opacity-100 focus:outline-2 group-hover:opacity-100"
        onClick={(event) => event.stopPropagation()}
        onPointerDown={(event) => {
          event.stopPropagation()
          event.preventDefault()
          setTrimDrag({ trackId: track.id, clipId: clip.id, edge: 'start', originClientX: event.clientX, deltaSeconds: 0 })
        }}
        onKeyDown={(event) => handleTrimKeyDown(event, track.id, clip.id, 'start')}
      />
      <button
        type="button"
        aria-label={`Trim end of clip ${clip.id}`}
        className="absolute inset-y-0 right-0 w-2 cursor-ew-resize bg-[var(--color-pib-primary)]/40 opacity-0 focus:opacity-100 focus:outline-2 group-hover:opacity-100"
        onClick={(event) => event.stopPropagation()}
        onPointerDown={(event) => {
          event.stopPropagation()
          event.preventDefault()
          setTrimDrag({ trackId: track.id, clipId: clip.id, edge: 'end', originClientX: event.clientX, deltaSeconds: 0 })
        }}
        onKeyDown={(event) => handleTrimKeyDown(event, track.id, clip.id, 'end')}
      />
    </div>
  )
})}
```

Note for the end edge: `trimClip(..., { edge: 'end', deltaSeconds })` ADDS the delta to duration, so dragging left (negative dx) shortens the clip — the raw `(clientX - origin)/pxPerSecond` delta is already in the correct sign for both edges.

- [ ] **Step 4: Run trim tests plus the existing editor suites (regression: clip is no longer a `<button>`)**

Run: `npx jest __tests__/app/video-editor-trim-ui.test.tsx && npx jest __tests__ -t "video-editor" --listTests`
Then run every listed video-editor jsdom test file, e.g. `npx jest __tests__/app --testPathPattern="video-editor"`.
Expected: PASS. If an existing test queried the clip via `getByRole('button', { name: ... })`, update it to `getByTestId('timeline-clip-<id>')`.

- [ ] **Step 5: Commit**

```bash
git add components/video-editor/TimelinePanel.tsx __tests__/app/video-editor-trim-ui.test.tsx
git commit -m "feat(video-editor): edge-drag trim handles with keyboard support on the timeline"
```

---

### Task 8: Inspector numeric trim fields

**Files:**
- Modify: `components/video-editor/InspectorPanel.tsx`
- Test: `__tests__/app/video-editor-trim-ui.test.tsx` (append)

Adds an optional `onTrim` prop. Two numeric fields express trim as absolute timeline in/out points; the component converts them to trim deltas: `In point` delta = `value - clip.timelineStart` (edge `start`), `Out point` delta = `value - (clip.timelineStart + clip.duration)` (edge `end`). The existing raw Start/Duration fields stay (they are move/resize, not source-trim).

- [ ] **Step 1: Write the failing test** — append to `__tests__/app/video-editor-trim-ui.test.tsx`:

```tsx
import { InspectorPanel } from '@/components/video-editor/InspectorPanel'

describe('InspectorPanel trim fields', () => {
  const clip = {
    id: 'a',
    timelineStart: 2,
    duration: 4,
    media: { type: 'upload' as const, fileId: 'f-a', url: 'https://x.test/a.mp4', mediaKind: 'video' as const },
  }

  it('converts an in-point change into a start trim delta', () => {
    const onTrim = jest.fn()
    render(<InspectorPanel clip={clip} onPatch={jest.fn()} onTrim={onTrim} />)
    const inPoint = screen.getByLabelText('In point (s)')
    expect(inPoint).toHaveValue(2)
    fireEvent.change(inPoint, { target: { value: '2.5' } })
    expect(onTrim).toHaveBeenCalledWith('start', 0.5)
  })

  it('converts an out-point change into an end trim delta', () => {
    const onTrim = jest.fn()
    render(<InspectorPanel clip={clip} onPatch={jest.fn()} onTrim={onTrim} />)
    const outPoint = screen.getByLabelText('Out point (s)')
    expect(outPoint).toHaveValue(6)
    fireEvent.change(outPoint, { target: { value: '5' } })
    expect(onTrim).toHaveBeenCalledWith('end', -1)
  })

  it('hides trim fields when onTrim is not provided', () => {
    render(<InspectorPanel clip={clip} onPatch={jest.fn()} />)
    expect(screen.queryByLabelText('In point (s)')).not.toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx jest __tests__/app/video-editor-trim-ui.test.tsx`
Expected: FAIL — `Unable to find a label with the text of: In point (s)`

- [ ] **Step 3: Implement**

Replace `components/video-editor/InspectorPanel.tsx` signature and add the trim block after the Duration field:

```tsx
'use client'

import type { EditorClip } from '@/lib/video-editor/types'

export function InspectorPanel({
  clip,
  onPatch,
  onTrim,
}: {
  clip: EditorClip | null
  onPatch: (patch: Partial<EditorClip>) => void
  onTrim?: (edge: 'start' | 'end', deltaSeconds: number) => void
}) {
```

and inside the returned section, after the Duration `<label>`:

```tsx
{onTrim ? (
  <fieldset className="space-y-3 rounded-lg border border-[var(--color-pib-line)] p-3">
    <legend className="px-1 text-xs font-label uppercase tracking-widest text-on-surface-variant">Trim</legend>
    <label className="block text-sm text-on-surface-variant">
      In point (s)
      <input
        className="mt-1 w-full rounded-lg border border-[var(--color-pib-line)] bg-transparent px-3 py-2"
        type="number"
        step="0.1"
        min="0"
        value={clip.timelineStart}
        onChange={(event) => {
          const value = Number(event.target.value)
          if (!Number.isFinite(value)) return
          const delta = Math.round((value - clip.timelineStart) * 1000) / 1000
          if (delta !== 0) onTrim('start', delta)
        }}
      />
    </label>
    <label className="block text-sm text-on-surface-variant">
      Out point (s)
      <input
        className="mt-1 w-full rounded-lg border border-[var(--color-pib-line)] bg-transparent px-3 py-2"
        type="number"
        step="0.1"
        value={clip.timelineStart + clip.duration}
        onChange={(event) => {
          const value = Number(event.target.value)
          if (!Number.isFinite(value)) return
          const delta = Math.round((value - (clip.timelineStart + clip.duration)) * 1000) / 1000
          if (delta !== 0) onTrim('end', delta)
        }}
      />
    </label>
    <p className="text-xs text-on-surface-variant">Trimming keeps the source offset in sync — use Start/Duration above to move or stretch instead.</p>
  </fieldset>
) : null}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx jest __tests__/app/video-editor-trim-ui.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add components/video-editor/InspectorPanel.tsx __tests__/app/video-editor-trim-ui.test.tsx
git commit -m "feat(video-editor): numeric in/out trim fields in the inspector"
```

---

### Task 9: Wire trim into VideoEditorShell (kill the stub)

**Files:**
- Modify: `components/video-editor/VideoEditorShell.tsx`
- Test: `__tests__/app/video-editor-trim-ui.test.tsx` (append)

- [ ] **Step 1: Write the failing test** — append to `__tests__/app/video-editor-trim-ui.test.tsx`:

```tsx
import { waitFor } from '@testing-library/react'
import { VideoEditorShell } from '@/components/video-editor/VideoEditorShell'

describe('VideoEditorShell trim wiring', () => {
  const project = {
    id: 'proj-1',
    orgId: 'org-1',
    title: 'Demo edit',
    timeline: {
      version: 1,
      tracks: [
        {
          id: 't1',
          kind: 'video',
          label: 'V1',
          clips: [{ id: 'a', timelineStart: 0, duration: 4, media: { type: 'upload', fileId: 'f-a', url: 'https://x.test/a.mp4', mediaKind: 'video' } }],
        },
      ],
    },
  }

  beforeEach(() => {
    global.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.includes('/api/v1/video-editor/projects/proj-1') && (!init?.method || init.method === 'GET')) {
        return { ok: true, status: 200, json: async () => ({ success: true, data: { project } }) } as Response
      }
      if (url.includes('/api/v1/video-editor/render-jobs')) {
        return { ok: true, status: 200, json: async () => ({ success: true, data: { jobs: [] } }) } as Response
      }
      return { ok: true, status: 200, json: async () => ({ success: true, data: {} }) } as Response
    }) as jest.Mock
  })

  it('persists a trimmed timeline when a trim handle drag commits', async () => {
    render(<VideoEditorShell projectId="proj-1" orgId="org-1" />)
    const handle = await screen.findByRole('button', { name: 'Trim start of clip a' })
    fireEvent.pointerDown(handle, { clientX: 100, pointerId: 1 })
    fireEvent.pointerMove(window, { clientX: 160, pointerId: 1 })
    fireEvent.pointerUp(window, { clientX: 160, pointerId: 1 })

    await waitFor(() => {
      const putCall = (global.fetch as jest.Mock).mock.calls.find(([url, init]) =>
        String(url).includes('/api/v1/video-editor/projects/proj-1') && init?.method === 'PUT')
      expect(putCall).toBeTruthy()
      const body = JSON.parse(String(putCall?.[1]?.body))
      const clip = body.timeline.tracks[0].clips[0]
      expect(clip.timelineStart).toBe(1)
      expect(clip.duration).toBe(3)
      expect(clip.trimStart).toBe(1)
    })
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx jest __tests__/app/video-editor-trim-ui.test.tsx`
Expected: FAIL — no PUT is issued (stub swallows the trim)

- [ ] **Step 3: Implement**

In `components/video-editor/VideoEditorShell.tsx`:

3a. Import the op — change line 5 to:

```tsx
import { addClip, addTrack, moveClip, removeClip, splitClip, trimClip } from '@/lib/video-editor/timeline-ops'
```

3b. Add a handler next to `patchSelected`:

```tsx
function handleTrimClip(trackId: string, clipId: string, edge: 'start' | 'end', deltaSeconds: number) {
  try {
    void persist(trimClip(timeline, trackId, clipId, { edge, deltaSeconds }))
  } catch (error) {
    setNotice(error instanceof Error ? error.message : 'Could not trim clip')
  }
}
```

3c. Replace `onTrimClip={() => undefined}` (line 242) with:

```tsx
onTrimClip={handleTrimClip}
```

3d. Wire the inspector (line 259) so numeric trims hit the same path:

```tsx
<InspectorPanel
  clip={selectedClip}
  onPatch={patchSelected}
  onTrim={(edge, deltaSeconds) => {
    if (!selection?.clipIds[0]) return
    handleTrimClip(selection.trackId, selection.clipIds[0], edge, deltaSeconds)
  }}
/>
```

- [ ] **Step 4: Run the trim suite + timeline-ops regression + typecheck**

Run: `npx jest __tests__/app/video-editor-trim-ui.test.tsx __tests__/lib/video-editor-timeline-ops.test.ts && npm run typecheck`
Expected: PASS / no type errors

- [ ] **Step 5: Commit**

```bash
git add components/video-editor/VideoEditorShell.tsx __tests__/app/video-editor-trim-ui.test.tsx
git commit -m "fix(video-editor): wire clip trim UI to the trimClip timeline op"
```

---

### Task 10: Guarded dev seed script for signed-in local smokes

**Files:**
- Create: `lib/dev-seed/guard.ts`
- Create: `scripts/dev-seed-youtube-studio.ts`
- Test: `__tests__/lib/dev-seed-guard.test.ts`

The guard is a pure module so it can be unit-tested; the script imports it. **The script refuses to run unless BOTH the explicit `ALLOW_DEV_SEED=1` flag is set AND both Firebase emulator hosts point at localhost.** It can therefore never touch production Firestore/Auth — the firebase-admin SDK routes all traffic to the emulators when those env vars are set, and the guard rejects any non-localhost value.

- [ ] **Step 1: Write the failing guard test**

Create `__tests__/lib/dev-seed-guard.test.ts`:

```ts
import { assertDevSeedAllowed } from '@/lib/dev-seed/guard'

const emulatorEnv = {
  ALLOW_DEV_SEED: '1',
  FIRESTORE_EMULATOR_HOST: 'localhost:8080',
  FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099',
}

describe('assertDevSeedAllowed', () => {
  it('allows seeding with the explicit flag plus localhost emulators', () => {
    expect(() => assertDevSeedAllowed(emulatorEnv)).not.toThrow()
  })

  it('refuses without the explicit ALLOW_DEV_SEED flag', () => {
    expect(() => assertDevSeedAllowed({ ...emulatorEnv, ALLOW_DEV_SEED: undefined })).toThrow(/ALLOW_DEV_SEED/)
    expect(() => assertDevSeedAllowed({ ...emulatorEnv, ALLOW_DEV_SEED: 'true' })).toThrow(/ALLOW_DEV_SEED/)
  })

  it('refuses when the Firestore emulator host is missing or not localhost', () => {
    expect(() => assertDevSeedAllowed({ ...emulatorEnv, FIRESTORE_EMULATOR_HOST: undefined })).toThrow(/FIRESTORE_EMULATOR_HOST/)
    expect(() => assertDevSeedAllowed({ ...emulatorEnv, FIRESTORE_EMULATOR_HOST: 'firestore.googleapis.com:443' })).toThrow(/localhost/)
  })

  it('refuses when the Auth emulator host is missing or not localhost', () => {
    expect(() => assertDevSeedAllowed({ ...emulatorEnv, FIREBASE_AUTH_EMULATOR_HOST: undefined })).toThrow(/FIREBASE_AUTH_EMULATOR_HOST/)
    expect(() => assertDevSeedAllowed({ ...emulatorEnv, FIREBASE_AUTH_EMULATOR_HOST: 'auth.example.com:9099' })).toThrow(/localhost/)
  })

  it('refuses in production-like environments even with emulators configured', () => {
    expect(() => assertDevSeedAllowed({ ...emulatorEnv, NODE_ENV: 'production' })).toThrow(/production/)
    expect(() => assertDevSeedAllowed({ ...emulatorEnv, VERCEL: '1' })).toThrow(/production/)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx jest __tests__/lib/dev-seed-guard.test.ts`
Expected: FAIL — `Cannot find module '@/lib/dev-seed/guard'`

- [ ] **Step 3: Write the guard**

Create `lib/dev-seed/guard.ts`:

```ts
// lib/dev-seed/guard.ts
// Safety gate for dev seed scripts. Seeding is ONLY allowed against local
// Firebase emulators, and only with an explicit opt-in flag. This can never
// pass against production: firebase-admin routes all traffic to the emulator
// hosts when these env vars are set, and non-localhost hosts are rejected.

export type DevSeedEnv = Partial<Record<string, string>>

const LOCALHOST_PATTERN = /^(localhost|127\.0\.0\.1|\[::1\]):\d+$/

function requireLocalhost(env: DevSeedEnv, key: string): void {
  const value = (env[key] ?? '').trim()
  if (!value) {
    throw new Error(`Refusing to seed: ${key} is not set. Start the Firebase emulators and export ${key} (e.g. localhost:8080).`)
  }
  if (!LOCALHOST_PATTERN.test(value)) {
    throw new Error(`Refusing to seed: ${key}='${value}' is not a localhost emulator address.`)
  }
}

export function assertDevSeedAllowed(env: DevSeedEnv = process.env as DevSeedEnv): void {
  if (env.ALLOW_DEV_SEED !== '1') {
    throw new Error("Refusing to seed: set ALLOW_DEV_SEED=1 explicitly to confirm you are seeding a local emulator.")
  }
  if (env.NODE_ENV === 'production' || env.VERCEL) {
    throw new Error('Refusing to seed: this looks like a production environment (NODE_ENV/VERCEL set).')
  }
  requireLocalhost(env, 'FIRESTORE_EMULATOR_HOST')
  requireLocalhost(env, 'FIREBASE_AUTH_EMULATOR_HOST')
}
```

- [ ] **Step 4: Run to verify the guard tests pass**

Run: `npx jest __tests__/lib/dev-seed-guard.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Write the seed script**

Create `scripts/dev-seed-youtube-studio.ts`:

```ts
/**
 * Dev seed for signed-in YouTube Studio / Video Editor smokes.
 * EMULATOR-ONLY — refuses to run unless ALLOW_DEV_SEED=1 and both
 * FIRESTORE_EMULATOR_HOST and FIREBASE_AUTH_EMULATOR_HOST point at localhost.
 *
 * Run:
 *   firebase emulators:start --only auth,firestore --project partners-in-biz-85059 &
 *   ALLOW_DEV_SEED=1 \
 *   FIRESTORE_EMULATOR_HOST=localhost:8080 \
 *   FIREBASE_AUTH_EMULATOR_HOST=localhost:9099 \
 *   npx tsx scripts/dev-seed-youtube-studio.ts
 *
 * Then run the dev server with the SAME two emulator env vars so the app's
 * firebase-admin talks to the emulators, and sign in as:
 *   admin:  dev-admin@pib.local  / dev-seed-password-1
 *   client: dev-client@pib.local / dev-seed-password-1
 *
 * Idempotent: uses fixed document IDs and set(..., { merge: true }).
 */

import { assertDevSeedAllowed } from '@/lib/dev-seed/guard'

assertDevSeedAllowed()

// Import AFTER the guard so firebase-admin never initialises in a refused run.
async function main() {
  const { adminAuth, adminDb } = await import('@/lib/firebase/admin')
  const { FieldValue } = await import('firebase-admin/firestore')
  const { YOUTUBE_COLLECTIONS } = await import('@/lib/youtube-studio/api')
  const { VIDEO_EDITOR_COLLECTIONS } = await import('@/lib/video-editor/api')

  const ORG_ID = 'dev-seed-yt-org'
  const CHANNEL_ID = 'dev-seed-yt-channel'
  const PASSWORD = 'dev-seed-password-1'
  const now = FieldValue.serverTimestamp()
  const actor = { createdByType: 'user', updatedByType: 'user', createdAt: now, updatedAt: now }

  async function ensureUser(email: string, displayName: string): Promise<string> {
    try {
      const existing = await adminAuth.getUserByEmail(email)
      return existing.uid
    } catch {
      const created = await adminAuth.createUser({ email, password: PASSWORD, displayName, emailVerified: true })
      return created.uid
    }
  }

  const adminUid = await ensureUser('dev-admin@pib.local', 'Dev Admin')
  const clientUid = await ensureUser('dev-client@pib.local', 'Dev Client')

  await adminDb.collection('users').doc(adminUid).set({
    email: 'dev-admin@pib.local', displayName: 'Dev Admin', role: 'admin',
    orgIds: [ORG_ID], activeOrgId: ORG_ID, createdAt: now, updatedAt: now,
  }, { merge: true })
  await adminDb.collection('users').doc(clientUid).set({
    email: 'dev-client@pib.local', displayName: 'Dev Client', role: 'client',
    orgIds: [ORG_ID], activeOrgId: ORG_ID, orgId: ORG_ID, createdAt: now, updatedAt: now,
  }, { merge: true })

  await adminDb.collection('organizations').doc(ORG_ID).set({
    name: 'Dev Seed Studio', slug: 'dev-seed-studio',
    members: [
      { userId: adminUid, role: 'owner' },
      { userId: clientUid, role: 'owner' },
    ],
    settings: { portalModules: { youtubeStudio: true } },
    createdAt: now, updatedAt: now,
  }, { merge: true })
  for (const uid of [adminUid, clientUid]) {
    await adminDb.collection('orgMembers').doc(`${ORG_ID}_${uid}`).set(
      { uid, orgId: ORG_ID, role: 'owner', createdAt: now, updatedAt: now },
      { merge: true },
    )
  }

  await adminDb.collection(YOUTUBE_COLLECTIONS.channels).doc(CHANNEL_ID).set({
    orgId: ORG_ID, title: 'Dev Seed Channel', youtubeHandle: '@devseed',
    youtubeChannelId: 'UC_dev_seed', status: 'active', connectedAccountId: 'dev-seed-account',
    publishingReadiness: { readiness: 'ready', accountStatus: 'connected', apiProjectStatus: 'production', defaultUploadPrivacy: 'private' },
    contentPillars: ['Product', 'Tutorials'], avoidTopics: [],
    visibility: { showInClientPortal: true, showAnalytics: true },
    deleted: false, ...actor,
  }, { merge: true })

  const videos: Array<{ id: string; title: string; status: string; clientReview?: { status: string } }> = [
    { id: 'dev-seed-video-intake', title: 'Requested: launch teaser', status: 'intake' },
    { id: 'dev-seed-video-production', title: 'In production: onboarding walkthrough', status: 'production' },
    { id: 'dev-seed-video-review', title: 'Your review: feature deep-dive', status: 'client_review', clientReview: { status: 'requested' } },
    { id: 'dev-seed-video-ready', title: 'Ready: customer story', status: 'publish_ready' },
    { id: 'dev-seed-video-scheduled', title: 'Scheduled: Q3 roadmap', status: 'scheduled' },
    { id: 'dev-seed-video-live', title: 'Live: welcome to the channel', status: 'live' },
  ]
  for (const video of videos) {
    await adminDb.collection(YOUTUBE_COLLECTIONS.videos).doc(video.id).set({
      orgId: ORG_ID, channelWorkspaceId: CHANNEL_ID, title: video.title,
      objective: 'Dev seed demo video', videoType: 'long_form', status: video.status,
      ...(video.clientReview ? { clientReview: video.clientReview } : {}),
      visibility: { showInClientPortal: true, showPublishingPacket: true },
      deleted: false, ...actor,
    }, { merge: true })
  }

  await adminDb.collection(YOUTUBE_COLLECTIONS.productionDrafts).doc('dev-seed-draft-review').set({
    orgId: ORG_ID, channelWorkspaceId: CHANNEL_ID, videoProjectId: 'dev-seed-video-review',
    title: 'Script v2 — feature deep-dive', draftType: 'script', status: 'client_review', versionNumber: 2,
    summary: 'Tighter hook, shorter intro.', hook: 'What if onboarding took 2 minutes?',
    outline: ['Hook', 'Problem', 'Demo', 'CTA'], scenes: [],
    visibility: { showInClientPortal: true }, deleted: false, ...actor,
  }, { merge: true })

  await adminDb.collection(YOUTUBE_COLLECTIONS.renderJobs).doc('dev-seed-render-qa').set({
    orgId: ORG_ID, channelWorkspaceId: CHANNEL_ID, videoProjectId: 'dev-seed-video-review',
    title: 'Cut A — feature deep-dive', renderType: 'full_video', targetFormat: 'horizontal_16_9',
    status: 'qa_review', versionNumber: 1, editBrief: 'Fast cuts, captions on.', timeline: [],
    output: { previewUrl: 'https://example.com/dev-seed-preview.mp4', durationSeconds: 90 },
    visibility: { showInClientPortal: true }, deleted: false, ...actor,
  }, { merge: true })

  await adminDb.collection(YOUTUBE_COLLECTIONS.packets).doc('dev-seed-packet-review').set({
    orgId: ORG_ID, channelWorkspaceId: CHANNEL_ID, videoProjectId: 'dev-seed-video-ready',
    status: 'client_review', versionNumber: 1, visibility: 'private',
    titleOptions: [{ text: 'Customer story: 3x output with PiB', selected: true }],
    description: 'How a client tripled content output.', tags: ['case study'], chapters: [],
    selfDeclaredMadeForKids: false, containsSyntheticMedia: false,
    deleted: false, ...actor,
  }, { merge: true })

  await adminDb.collection(YOUTUBE_COLLECTIONS.sourceAssets).doc('dev-seed-asset-1').set({
    orgId: ORG_ID, channelWorkspaceId: CHANNEL_ID, videoProjectId: 'dev-seed-video-production',
    title: 'Raw screen recording', assetType: 'raw_footage', status: 'ready', durationSeconds: 640,
    visibility: { showInClientPortal: true }, deleted: false, ...actor,
  }, { merge: true })

  await adminDb.collection(VIDEO_EDITOR_COLLECTIONS.projects).doc('dev-seed-editor-project').set({
    orgId: ORG_ID, channelWorkspaceId: CHANNEL_ID, title: 'Dev seed edit project',
    timeline: {
      version: 1,
      tracks: [
        { id: 'track-video-1', kind: 'video', label: 'Video', clips: [] },
        { id: 'track-text-1', kind: 'text', label: 'Text', clips: [{ id: 'title-1', timelineStart: 0, duration: 5, text: { content: 'Dev seed title', fontSizePx: 72, color: '#ffffff', align: 'center', animationPreset: 'none' }, transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 } }] },
      ],
    },
    deleted: false, ...actor,
  }, { merge: true })

  console.log('Dev seed complete.')
  console.log('  Org:      dev-seed-yt-org (Dev Seed Studio)')
  console.log('  Admin:    dev-admin@pib.local / dev-seed-password-1')
  console.log('  Client:   dev-client@pib.local / dev-seed-password-1')
  console.log('  Portal:   /portal/youtube-studio?orgId=dev-seed-yt-org')
  console.log('  Editor:   /portal/youtube-studio/editor/dev-seed-editor-project?orgId=dev-seed-yt-org')
}

main().then(() => process.exit(0)).catch((error) => {
  console.error(error)
  process.exit(1)
})
```

- [ ] **Step 6: Verify the guard blocks a live run and typecheck passes**

Run: `npx tsx scripts/dev-seed-youtube-studio.ts`
Expected: exits 1 with `Refusing to seed: set ALLOW_DEV_SEED=1 ...` and no Firestore writes.

Run: `ALLOW_DEV_SEED=1 npx tsx scripts/dev-seed-youtube-studio.ts`
Expected: exits 1 with `Refusing to seed: FIRESTORE_EMULATOR_HOST is not set ...`

Run: `npm run typecheck`
Expected: no errors.

(A full emulator smoke — start emulators, seed, sign in — is a manual QA step for Peet/the executing agent, not a CI gate.)

- [ ] **Step 7: Commit**

```bash
git add lib/dev-seed/guard.ts scripts/dev-seed-youtube-studio.ts __tests__/lib/dev-seed-guard.test.ts
git commit -m "feat(dev): emulator-only YouTube Studio seed script with tested production guard"
```

---

### Task 11: Full verification pass

**Files:** none new.

- [ ] **Step 1: Run the complete Jest suites touched by this plan**

Run:
```bash
npx jest __tests__/lib/youtube-studio-work-queue.test.ts \
  __tests__/lib/dev-seed-guard.test.ts \
  __tests__/lib/video-editor-timeline-ops.test.ts \
  __tests__/app/youtube-studio-cockpit.test.tsx \
  __tests__/app/youtube-studio-connect-ux.test.tsx \
  __tests__/app/youtube-studio-portal-module-disabled.test.tsx \
  __tests__/app/video-editor-trim-ui.test.tsx \
  __tests__/app/youtube-studio-shared-workspace.test.ts \
  __tests__/app/youtube-studio-route-placeholders.test.ts \
  __tests__/app/youtube-studio-admin-command-center.test.tsx
```
Expected: all PASS.

- [ ] **Step 2: Typecheck (the real gate — `next build` skips type errors)**

Run: `npm run typecheck`
Expected: exit 0.

- [ ] **Step 3: Optional full build sanity (memory-hungry)**

Run: `NODE_OPTIONS=--max-old-space-size=10240 npm run build`
Expected: build succeeds.

- [ ] **Step 4: Push**

```bash
git push origin development
```

Do NOT promote to production; `development` pushes produce Vercel Preview deployments only.

---

## Out of scope (explicitly)

- Admin workspace changes (`YouTubeStudioAdminWorkspace.tsx` already exposes everything for operators — "admin sees everything" is satisfied by the existing admin surface).
- API/route changes — the portal GET already returns everything the cockpit needs.
- Phase 1+ items: ripple edit, keyframes, captions/TTS, thumbnail studio, research surfaces (see master spec `docs/superpowers/specs/2026-07-06-youtube-channel-operating-system-spec.md`, §5).
- Deleting `YouTubeStudioPipelineBoard.tsx` — it is no longer used by the portal workspace but stays in the tree; removing it is a follow-up cleanup once nothing imports it.

## Self-review (performed while writing this plan)

1. **Spec coverage** — Phase 0 = "Pillar-4.x redesign, fix trim stub, signed-in QA with dev seed login":
   - Channel selector + status header → Task 2. Three primary actions → Task 5 (cards named exactly `Create video edit`, `Request a PiB video`, `Review pending work`). Grouped work queue → Tasks 1+3+5 (groups named exactly as Peet's note). Empty technical collections hidden; contextual tabs only when populated → Task 4 (component returns `null` when empty) + Task 5 assembly. `/portal/video-editor` as the creation surface → the `Create video edit` card scrolls to the embedded channel-linked `VideoEditorProjectList` (which creates projects bound to `channelWorkspaceId` — deliberately kept over a bare link to `/portal/video-editor`, which cannot bind channels). Trim stub → Tasks 7–9 (drag handles, keyboard a11y, inspector numeric fields, shell wiring to the existing pure op). Dev seed + production guard → Task 10. Jest coverage → every task is test-first; pib-card-section idioms reused throughout.
2. **Placeholder scan** — the only "move verbatim" references (Task 4 tab bodies, Task 5 aside) cite exact current line ranges and include a fully-worked example of the wiring pattern; all new logic has complete code.
3. **Type consistency** — `WorkQueueItem`/`WorkQueueGroups`/`buildWorkQueue`/`filterWorkQueueByChannel` names match across Tasks 1, 3, 5. `onTrimClip(trackId, clipId, edge, deltaSeconds)` matches the existing `TimelinePanel` prop type (TimelinePanel.tsx:19) and `trimClip(timeline, trackId, clipId, { edge, deltaSeconds })` (timeline-ops.ts:130). `onTrim(edge, deltaSeconds)` is consistent between Tasks 8 and 9. Seed doc shapes match `withPortalAuthAndRole` (`users.orgIds/activeOrgId`, `orgMembers/{orgId}_{uid}` with `uid`+`role`, `organizations.members[]`) and `isPortalModuleEnabled` defaults.
4. **Known risk called out** — Task 7 changes the clip element from `<button>` to `div[role=button]`; Step 4 explicitly runs the existing video-editor jsdom suites and tells the implementer how to fix any `getByRole('button')` queries against clips.
