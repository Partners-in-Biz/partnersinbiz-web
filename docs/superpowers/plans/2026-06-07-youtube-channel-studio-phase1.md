# YouTube Channel Studio Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Phase 1 foundation for YouTube Channel Studio: a module-toggleable PiB production cockpit with admin CRUD, portal request/review access, shared workspace UI, and publishing-packet gate metadata.

**Architecture:** Add a new `youtubeStudio` portal module key and a YouTube domain under `lib/youtube-studio`. Keep admin and portal routes thin; both mount shared workspace components and use route-specific API paths/permissions. Store metadata in Firestore collections for channel workspaces, series, video projects, and publishing packets; keep heavy media outside this slice and represent it as asset/source URLs or future upload references.

**Tech Stack:** Next.js App Router, React client components, Firebase Admin Firestore, existing `withAuth`/`withPortalAuthAndRole` middleware, `apiSuccess`/`apiError`, Jest, Testing Library, existing PiB CSS utility classes.

---

## Scope Check

The approved spec covers five phases. This plan intentionally implements **Phase 1: Production Cockpit Foundation** only.

This plan does not implement:

- YouTube OAuth/upload adapter.
- Hermes skill runtime integrations.
- Full analytics import.
- Render/edit automation.
- A full timeline video editor.
- Paid ad buying.

Those become separate plans after Phase 1 is merged and usable.

## Preflight For The Implementer

- [ ] **Step 1: Enter the active development worktree**

```bash
cd "/Users/peetstander/Cowork/Partners in Biz — Client Growth/worktrees/button-system-development"
```

- [ ] **Step 2: Verify branch and local state**

```bash
git status --short --branch
```

Expected: `## development...origin/development` with no local changes. If changes exist, inspect them and follow the PiB checkpoint-before-sync rule from `AGENTS.md`.

- [ ] **Step 3: Sync development**

```bash
git pull --rebase origin development
```

Expected: pull/rebase completes without conflicts.

## File Structure

Create:

- `lib/youtube-studio/types.ts` — canonical domain types for channel workspaces, series, video projects, publishing packets, analytics snapshots, policies, gates, and portal review fields.
- `lib/youtube-studio/sanitize.ts` — input normalization, serialization, client-safe record shaping, and default policies.
- `lib/youtube-studio/api.ts` — small shared Firestore/API helpers used by admin and portal routes.
- `app/api/v1/youtube-studio/channels/route.ts` — admin list/create channel workspaces.
- `app/api/v1/youtube-studio/channels/[id]/route.ts` — admin get/update/archive one channel workspace.
- `app/api/v1/youtube-studio/series/route.ts` — admin list/create series.
- `app/api/v1/youtube-studio/videos/route.ts` — admin list/create video projects.
- `app/api/v1/youtube-studio/videos/[id]/route.ts` — admin get/update/archive one video project.
- `app/api/v1/youtube-studio/publish-packets/route.ts` — admin create/update publishing packets for a video project.
- `app/api/v1/portal/youtube-studio/route.ts` — portal guard, list client-safe records, create requests, and save review decisions.
- `components/youtube-studio/YouTubeStudioWorkspaceShell.tsx` — shared header/stats/container.
- `components/youtube-studio/YouTubeStudioCards.tsx` — shared cards and status helpers for channel/video/series/packet records.
- `components/youtube-studio/YouTubeStudioAdminWorkspace.tsx` — admin operational cockpit and forms.
- `components/youtube-studio/YouTubeStudioPortalWorkspace.tsx` — client request/review cockpit with disabled-module state.
- `app/(admin)/admin/org/[slug]/youtube-studio/page.tsx` — admin org wrapper.
- `app/(portal)/portal/youtube-studio/page.tsx` — portal wrapper.
- `__tests__/lib/youtube-studio-sanitize.test.ts` — domain sanitizer tests.
- `__tests__/api/youtube-studio.test.ts` — admin route tests.
- `__tests__/api/portal-youtube-studio.test.ts` — portal route guard/request tests.
- `__tests__/app/youtube-studio-shared-workspace.test.ts` — shared route/component structure test.
- `__tests__/app/youtube-studio-portal-module-disabled.test.tsx` — disabled portal UI state test.

Modify:

- `lib/organizations/portal-modules.ts` — add `youtubeStudio`, default enabled.
- `lib/organizations/types.ts` — no type change expected if it already imports `PortalModules`; verify and adjust only if TypeScript requires it.
- `app/(admin)/admin/org/[slug]/settings/page.tsx` — add admin switch for client-visible YouTube Studio.
- `app/(portal)/layout.tsx` — add nav item and hide it when `portalModules.youtubeStudio === false`.
- `components/admin/navConfig.ts` — add admin org nav item.
- `__tests__/app/admin-org-settings-folder-mappings.test.tsx` — extend module switch test.
- `__tests__/app/portal-layout-mobile-switch.test.tsx` — extend or add tests for YouTube Studio nav visibility.

## Firestore Collections

- `youtube_channel_workspaces`
- `youtube_series`
- `youtube_video_projects`
- `youtube_publishing_packets`

Every document must include `orgId`, actor fields, timestamps, and `deleted: false` unless archived.

---

### Task 1: Portal Module Key And Navigation

**Files:**
- Modify: `lib/organizations/portal-modules.ts`
- Modify: `app/(admin)/admin/org/[slug]/settings/page.tsx`
- Modify: `app/(portal)/layout.tsx`
- Modify: `components/admin/navConfig.ts`
- Test: `__tests__/app/admin-org-settings-folder-mappings.test.tsx`
- Test: `__tests__/app/portal-layout-mobile-switch.test.tsx`

- [ ] **Step 1: Write the failing portal module resolver expectation**

Add this test case to `__tests__/app/portal-layout-mobile-switch.test.tsx` after the Mobile Apps disabled test:

```ts
it('hides YouTube Studio navigation when the active organisation disables the module', async () => {
  mockPortalModules = { youtubeStudio: false }

  render(
    <PortalLayout>
      <div>Portal content</div>
    </PortalLayout>,
  )

  expect(await screen.findByText('Client portal')).toBeInTheDocument()

  await waitFor(() => {
    expect(screen.queryByRole('link', { name: /YouTube Studio/ })).not.toBeInTheDocument()
  })
})
```

Also add this visible-by-default assertion near the existing Mobile Apps visible test:

```ts
it('keeps YouTube Studio visible when no portal module setting is stored', async () => {
  render(
    <PortalLayout>
      <div>Portal content</div>
    </PortalLayout>,
  )

  await waitFor(() => {
    expect(screen.getAllByRole('link', { name: /YouTube Studio/ }).length).toBeGreaterThan(0)
  })
})
```

- [ ] **Step 2: Run the focused layout test and verify it fails**

```bash
npm test -- --runInBand __tests__/app/portal-layout-mobile-switch.test.tsx
```

Expected: FAIL because `YouTube Studio` is not in the portal nav and `youtubeStudio` is not a portal module key.

- [ ] **Step 3: Extend the portal module resolver**

Edit `lib/organizations/portal-modules.ts` to:

```ts
export type PortalModuleKey = 'mobileApps' | 'youtubeStudio'

export type PortalModules = Record<PortalModuleKey, boolean>

export const DEFAULT_PORTAL_MODULES: PortalModules = {
  mobileApps: true,
  youtubeStudio: true,
}

type OrgSettingsLike = {
  portalModules?: Partial<Record<PortalModuleKey, boolean>> | null
} | null | undefined

export function resolvePortalModules(settings: OrgSettingsLike): PortalModules {
  const stored = settings?.portalModules ?? {}
  return {
    mobileApps: stored.mobileApps !== false,
    youtubeStudio: stored.youtubeStudio !== false,
  }
}

export function isPortalModuleEnabled(settings: OrgSettingsLike, key: PortalModuleKey): boolean {
  return resolvePortalModules(settings)[key]
}
```

- [ ] **Step 4: Add the portal nav item and module filter**

In `app/(portal)/layout.tsx`, add this nav item after Mobile Apps:

```ts
{ href: '/portal/youtube-studio', label: 'YouTube Studio', icon: 'smart_display', group: 'work' },
```

Replace the current visible-nav filter with:

```ts
const visibleNavLinks = NAV_LINKS.filter((item) => {
  if (item.href === '/portal/mobile-apps') return portalModules.mobileApps
  if (item.href === '/portal/youtube-studio') return portalModules.youtubeStudio
  return true
})
```

- [ ] **Step 5: Add the admin org nav item**

In `components/admin/navConfig.ts`, add this to `workspaceNav(slug)` immediately after Mobile Apps:

```ts
{ label: 'YouTube Studio', href: `/admin/org/${slug}/youtube-studio`, icon: 'smart_display', group: 'work' },
```

- [ ] **Step 6: Extend admin settings form state and save payload**

In `app/(admin)/admin/org/[slug]/settings/page.tsx`:

Add `portalYouTubeStudio: boolean` to `OrgForm`.

Set it in `emptyForm`:

```ts
portalModules: {}, portalMobileApps: true, portalYouTubeStudio: true,
```

When loading settings, set:

```ts
portalMobileApps: portalModules.mobileApps !== false,
portalYouTubeStudio: portalModules.youtubeStudio !== false,
```

When saving settings, include:

```ts
portalModules: {
  ...form.portalModules,
  mobileApps: form.portalMobileApps,
  youtubeStudio: form.portalYouTubeStudio,
},
```

Add a second checkbox under Mobile Apps:

```tsx
<label htmlFor="portalYouTubeStudio" className="flex items-start gap-3 rounded-lg border border-outline-variant/60 bg-[var(--color-surface-container)]/40 p-4">
  <input
    id="portalYouTubeStudio"
    type="checkbox"
    aria-label="YouTube Studio"
    checked={form.portalYouTubeStudio}
    onChange={e => update('portalYouTubeStudio', e.target.checked)}
    className="mt-0.5 h-4 w-4 rounded border-outline text-primary"
  />
  <span>
    <span className="block text-sm font-semibold text-on-surface">YouTube Studio</span>
    <span className="mt-1 block text-xs text-on-surface-variant">
      Show channel video requests, draft reviews, publishing packet approvals, and client-safe YouTube analytics.
    </span>
  </span>
</label>
```

- [ ] **Step 7: Extend the admin settings test**

In `__tests__/app/admin-org-settings-folder-mappings.test.tsx`, change the module-switch test setup:

```ts
detailSettings = { portalModules: { mobileApps: false, youtubeStudio: false } }
```

After the Mobile Apps assertion, add:

```ts
const youtubeStudioSwitch = screen.getByLabelText('YouTube Studio') as HTMLInputElement
expect(youtubeStudioSwitch).not.toBeChecked()
fireEvent.click(youtubeStudioSwitch)
```

Update the expected save payload:

```ts
expect(JSON.parse(put![1].body as string)).toMatchObject({
  settings: {
    portalModules: {
      mobileApps: true,
      youtubeStudio: true,
    },
  },
})
```

- [ ] **Step 8: Run focused tests**

```bash
npm test -- --runInBand __tests__/app/admin-org-settings-folder-mappings.test.tsx __tests__/app/portal-layout-mobile-switch.test.tsx
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add lib/organizations/portal-modules.ts "app/(admin)/admin/org/[slug]/settings/page.tsx" "app/(portal)/layout.tsx" components/admin/navConfig.ts __tests__/app/admin-org-settings-folder-mappings.test.tsx __tests__/app/portal-layout-mobile-switch.test.tsx
git commit -m "feat(youtube-studio): add portal module switch"
```

---

### Task 2: Domain Types And Sanitizers

**Files:**
- Create: `lib/youtube-studio/types.ts`
- Create: `lib/youtube-studio/sanitize.ts`
- Test: `__tests__/lib/youtube-studio-sanitize.test.ts`

- [ ] **Step 1: Write sanitizer tests**

Create `__tests__/lib/youtube-studio-sanitize.test.ts`:

```ts
import {
  clientSafeYouTubeChannelWorkspace,
  clientSafeYouTubeVideoProject,
  defaultYouTubeApprovalPolicy,
  defaultYouTubePublishingPolicy,
  sanitizeYouTubeChannelWorkspaceInput,
  sanitizeYouTubeSeriesInput,
  sanitizeYouTubeVideoProjectInput,
  serializeYouTubeRecord,
} from '@/lib/youtube-studio/sanitize'

describe('youtube studio sanitizers', () => {
  it('defaults channel policy fields and trims strategy inputs', () => {
    const result = sanitizeYouTubeChannelWorkspaceInput({
      orgId: ' org-1 ',
      title: '  Acme Channel  ',
      status: 'unknown',
      contentPillars: [' Growth ', '', 'Retention'],
      avoidTopics: 'politics\nunsupported claims',
      audienceNotes: '  Owners  ',
    })

    expect(result).toMatchObject({
      orgId: 'org-1',
      title: 'Acme Channel',
      status: 'setup',
      contentPillars: ['Growth', 'Retention'],
      avoidTopics: ['politics', 'unsupported claims'],
      audienceNotes: 'Owners',
      defaultApprovalPolicy: defaultYouTubeApprovalPolicy(),
      defaultPublishingPolicy: defaultYouTubePublishingPolicy(),
      deleted: false,
    })
  })

  it('sanitizes series format and cadence to safe defaults', () => {
    const result = sanitizeYouTubeSeriesInput({
      orgId: 'org-1',
      channelWorkspaceId: 'channel-1',
      name: 'Weekly Wins',
      format: 'bad-format',
      cadence: 'weekly',
      status: 'bad-status',
      episodeTemplate: {
        hook: 'Lead with the client result',
        sections: [{ label: 'Problem', targetSeconds: 30 }, { label: '' }],
      },
    })

    expect(result).toMatchObject({
      format: 'mixed',
      cadence: 'weekly',
      status: 'active',
      episodeTemplate: {
        hook: 'Lead with the client result',
        sections: [{ label: 'Problem', targetSeconds: 30 }],
      },
      deleted: false,
    })
  })

  it('keeps portal video records client safe', () => {
    const video = sanitizeYouTubeVideoProjectInput({
      orgId: 'org-1',
      channelWorkspaceId: 'channel-1',
      title: 'Draft',
      objective: 'Explain the service',
      videoType: 'long_form',
      internalNotes: 'Do not show this risk note',
      visibility: { showInClientPortal: true },
    })

    expect(clientSafeYouTubeVideoProject({ id: 'video-1', ...video })).not.toHaveProperty('internalNotes')
    expect(clientSafeYouTubeVideoProject({ id: 'video-1', ...video })).toMatchObject({
      id: 'video-1',
      title: 'Draft',
      videoType: 'long_form',
    })
  })

  it('serializes Firestore records through JSON-safe values', () => {
    const serialized = serializeYouTubeRecord('id-1', {
      orgId: 'org-1',
      title: 'Acme',
      createdAt: { seconds: 1 },
    })

    expect(serialized).toMatchObject({ id: 'id-1', orgId: 'org-1', title: 'Acme' })
  })

  it('hides internal channel access fields from portal clients', () => {
    const channel = sanitizeYouTubeChannelWorkspaceInput({
      orgId: 'org-1',
      title: 'Client Channel',
      connectedAccountId: 'secret-oauth-id',
      internalNotes: 'internal',
    })

    const safe = clientSafeYouTubeChannelWorkspace({ id: 'channel-1', ...channel })
    expect(safe).not.toHaveProperty('connectedAccountId')
    expect(safe).not.toHaveProperty('internalNotes')
  })
})
```

- [ ] **Step 2: Run the test and verify it fails**

```bash
npm test -- --runInBand __tests__/lib/youtube-studio-sanitize.test.ts
```

Expected: FAIL because `lib/youtube-studio/sanitize.ts` does not exist.

- [ ] **Step 3: Create canonical types**

Create `lib/youtube-studio/types.ts`:

```ts
export type ActorType = 'user' | 'agent' | 'system'

export interface YouTubeApprovalPolicy {
  requireInternalBriefApproval: boolean
  requireClientBriefApproval: boolean
  requireClientScriptApproval: boolean
  requireClientDraftApproval: boolean
  requireClientThumbnailApproval: boolean
  requireClientPublishConfirmation: boolean
  requireInternalPublishApproval: boolean
}

export interface YouTubePublishingPolicy {
  allowedModes: Array<'manual_handoff' | 'private_api_upload' | 'scheduled_api_publish'>
  defaultVisibility: 'private' | 'unlisted' | 'public'
  privateFirstRequired: boolean
  publicPublishRequiresAdmin: boolean
  publicPublishRequiresClientConfirmation: boolean
}

export type YouTubeChannelStatus = 'setup' | 'strategy' | 'active' | 'paused' | 'blocked' | 'archived'
export type YouTubeSeriesFormat = 'shorts' | 'long_form' | 'podcast' | 'case_study' | 'tutorial' | 'ads' | 'mixed'
export type YouTubeSeriesCadence = 'daily' | 'weekly' | 'fortnightly' | 'monthly' | 'campaign' | 'ad_hoc'
export type YouTubeSeriesStatus = 'active' | 'paused' | 'complete' | 'archived'
export type YouTubeVideoType = 'short' | 'long_form' | 'clip_pack' | 'podcast_episode' | 'webinar_cutdown' | 'testimonial' | 'case_study' | 'tutorial' | 'product_demo' | 'ad_creative' | 'community_update'
export type YouTubeVideoStatus = 'intake' | 'briefing' | 'production' | 'internal_review' | 'client_review' | 'changes_requested' | 'publish_ready' | 'scheduled' | 'live' | 'blocked' | 'archived'
export type YouTubeSourceType = 'raw_footage' | 'source_url' | 'transcript' | 'research' | 'client_request' | 'manual'
export type YouTubeGateStatus = 'pass' | 'warning' | 'block' | 'not_applicable'

export interface YouTubeGateCheck {
  status: YouTubeGateStatus
  message: string
  checkedBy?: string
  checkedByType?: ActorType
  checkedAt?: unknown
}

export interface YouTubeChannelWorkspace {
  id?: string
  orgId: string
  title: string
  youtubeChannelId?: string
  youtubeHandle?: string
  status: YouTubeChannelStatus
  connectedAccountId?: string
  strategyDocumentId?: string
  defaultApprovalPolicy: YouTubeApprovalPolicy
  defaultPublishingPolicy: YouTubePublishingPolicy
  contentPillars: string[]
  audienceNotes?: string
  avoidTopics: string[]
  aiDisclosureDefaults: { syntheticMediaLikely: boolean; notes?: string }
  internalNotes?: string
  clientNotes?: string
  visibility?: { showInClientPortal?: boolean; showAnalytics?: boolean }
  createdAt?: unknown
  updatedAt?: unknown
  createdBy?: string
  createdByType?: ActorType
  updatedBy?: string
  updatedByType?: ActorType
  deleted: boolean
}

export interface YouTubeSeries {
  id?: string
  orgId: string
  channelWorkspaceId: string
  name: string
  objective?: string
  audience?: string
  format: YouTubeSeriesFormat
  cadence: YouTubeSeriesCadence
  targetDurationSeconds?: number
  episodeTemplate: {
    hook?: string
    sections: Array<{ label: string; targetSeconds?: number; notes?: string }>
    outro?: string
  }
  styleGuide: {
    visualNotes?: string
    thumbnailNotes?: string
    captionNotes?: string
    introOutroRules?: string
  }
  season?: string
  status: YouTubeSeriesStatus
  deleted: boolean
}

export interface YouTubeVideoProject {
  id?: string
  orgId: string
  channelWorkspaceId: string
  seriesId?: string
  title: string
  workingTitle?: string
  videoType: YouTubeVideoType
  status: YouTubeVideoStatus
  objective: string
  targetAudience?: string
  targetDurationSeconds?: number
  source: {
    intakeType: YouTubeSourceType
    researchItemId?: string
    campaignId?: string
    projectId?: string
    sourceUrl?: string
    transcriptAssetId?: string
  }
  linked: {
    projectId?: string
    taskIds?: string[]
    documentIds?: string[]
    campaignId?: string
    socialPostIds?: string[]
  }
  approvalPolicy: YouTubeApprovalPolicy
  publishPacketId?: string
  youtubeVideoId?: string
  scheduledAt?: unknown
  publishedAt?: unknown
  clientReview?: {
    status?: 'not_requested' | 'requested' | 'approved' | 'changes_requested' | 'rejected'
    notes?: string
    decidedAt?: unknown
    decidedBy?: string
  }
  internalNotes?: string
  clientNotes?: string
  visibility?: { showInClientPortal?: boolean; showAnalytics?: boolean; showPublishingPacket?: boolean }
  createdAt?: unknown
  updatedAt?: unknown
  createdBy?: string
  createdByType?: ActorType
  updatedBy?: string
  updatedByType?: ActorType
  deleted: boolean
}

export interface YouTubePublishingPacket {
  id?: string
  orgId: string
  channelWorkspaceId: string
  videoProjectId: string
  versionNumber: number
  supersedesPacketId?: string
  status: 'draft' | 'internal_review' | 'client_review' | 'approved' | 'blocked' | 'published'
  titleOptions: Array<{ text: string; rationale?: string; selected?: boolean }>
  description?: string
  tags: string[]
  chapters: Array<{ startSeconds: number; title: string }>
  thumbnailAssetId?: string
  captionAssetId?: string
  videoAssetId?: string
  visibility: 'private' | 'unlisted' | 'public'
  publishAt?: unknown
  selfDeclaredMadeForKids?: boolean
  containsSyntheticMedia?: boolean
  aiDisclosureNotes?: string
  checks: {
    rights: YouTubeGateCheck
    aiDisclosure: YouTubeGateCheck
    madeForKids: YouTubeGateCheck
    metadata: YouTubeGateCheck
    thumbnail: YouTubeGateCheck
    captions: YouTubeGateCheck
    approval: YouTubeGateCheck
    connectedAccount: YouTubeGateCheck
  }
  approvedBy?: string
  approvedAt?: unknown
  approvedSnapshotHash?: string
  deleted: boolean
}
```

- [ ] **Step 4: Create sanitizer helpers**

Create `lib/youtube-studio/sanitize.ts`:

```ts
import type {
  YouTubeApprovalPolicy,
  YouTubeChannelStatus,
  YouTubeChannelWorkspace,
  YouTubePublishingPacket,
  YouTubePublishingPolicy,
  YouTubeSeries,
  YouTubeSeriesCadence,
  YouTubeSeriesFormat,
  YouTubeSeriesStatus,
  YouTubeSourceType,
  YouTubeVideoProject,
  YouTubeVideoStatus,
  YouTubeVideoType,
} from './types'

const CHANNEL_STATUSES: YouTubeChannelStatus[] = ['setup', 'strategy', 'active', 'paused', 'blocked', 'archived']
const SERIES_FORMATS: YouTubeSeriesFormat[] = ['shorts', 'long_form', 'podcast', 'case_study', 'tutorial', 'ads', 'mixed']
const SERIES_CADENCES: YouTubeSeriesCadence[] = ['daily', 'weekly', 'fortnightly', 'monthly', 'campaign', 'ad_hoc']
const SERIES_STATUSES: YouTubeSeriesStatus[] = ['active', 'paused', 'complete', 'archived']
const VIDEO_TYPES: YouTubeVideoType[] = ['short', 'long_form', 'clip_pack', 'podcast_episode', 'webinar_cutdown', 'testimonial', 'case_study', 'tutorial', 'product_demo', 'ad_creative', 'community_update']
const VIDEO_STATUSES: YouTubeVideoStatus[] = ['intake', 'briefing', 'production', 'internal_review', 'client_review', 'changes_requested', 'publish_ready', 'scheduled', 'live', 'blocked', 'archived']
const SOURCE_TYPES: YouTubeSourceType[] = ['raw_footage', 'source_url', 'transcript', 'research', 'client_request', 'manual']

function cleanString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function cleanNumber(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined
  return value
}

function cleanBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined
}

function cleanObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function cleanStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(cleanString).filter((item): item is string => Boolean(item))
  if (typeof value === 'string') return value.split(/[\n,]+/).map((item) => item.trim()).filter(Boolean)
  return []
}

function pick<T extends string>(values: readonly T[], input: unknown, fallback: T): T {
  return values.includes(input as T) ? input as T : fallback
}

export function defaultYouTubeApprovalPolicy(): YouTubeApprovalPolicy {
  return {
    requireInternalBriefApproval: true,
    requireClientBriefApproval: false,
    requireClientScriptApproval: false,
    requireClientDraftApproval: true,
    requireClientThumbnailApproval: false,
    requireClientPublishConfirmation: false,
    requireInternalPublishApproval: true,
  }
}

export function defaultYouTubePublishingPolicy(): YouTubePublishingPolicy {
  return {
    allowedModes: ['manual_handoff'],
    defaultVisibility: 'private',
    privateFirstRequired: true,
    publicPublishRequiresAdmin: true,
    publicPublishRequiresClientConfirmation: false,
  }
}

function policyFrom(input: unknown): YouTubeApprovalPolicy {
  const source = cleanObject(input)
  const defaults = defaultYouTubeApprovalPolicy()
  return {
    requireInternalBriefApproval: cleanBoolean(source.requireInternalBriefApproval) ?? defaults.requireInternalBriefApproval,
    requireClientBriefApproval: cleanBoolean(source.requireClientBriefApproval) ?? defaults.requireClientBriefApproval,
    requireClientScriptApproval: cleanBoolean(source.requireClientScriptApproval) ?? defaults.requireClientScriptApproval,
    requireClientDraftApproval: cleanBoolean(source.requireClientDraftApproval) ?? defaults.requireClientDraftApproval,
    requireClientThumbnailApproval: cleanBoolean(source.requireClientThumbnailApproval) ?? defaults.requireClientThumbnailApproval,
    requireClientPublishConfirmation: cleanBoolean(source.requireClientPublishConfirmation) ?? defaults.requireClientPublishConfirmation,
    requireInternalPublishApproval: cleanBoolean(source.requireInternalPublishApproval) ?? defaults.requireInternalPublishApproval,
  }
}

export function sanitizeYouTubeChannelWorkspaceInput(input: Partial<YouTubeChannelWorkspace>): Omit<YouTubeChannelWorkspace, 'id' | 'createdAt' | 'updatedAt' | 'createdBy' | 'createdByType' | 'updatedBy' | 'updatedByType'> {
  const disclosure = cleanObject(input.aiDisclosureDefaults)
  const visibility = cleanObject(input.visibility)
  return {
    orgId: cleanString(input.orgId) ?? '',
    title: cleanString(input.title) ?? 'Untitled YouTube channel',
    youtubeChannelId: cleanString(input.youtubeChannelId),
    youtubeHandle: cleanString(input.youtubeHandle),
    status: pick(CHANNEL_STATUSES, input.status, 'setup'),
    connectedAccountId: cleanString(input.connectedAccountId),
    strategyDocumentId: cleanString(input.strategyDocumentId),
    defaultApprovalPolicy: policyFrom(input.defaultApprovalPolicy),
    defaultPublishingPolicy: defaultYouTubePublishingPolicy(),
    contentPillars: cleanStringArray(input.contentPillars),
    audienceNotes: cleanString(input.audienceNotes),
    avoidTopics: cleanStringArray(input.avoidTopics),
    aiDisclosureDefaults: {
      syntheticMediaLikely: disclosure.syntheticMediaLikely === true,
      notes: cleanString(disclosure.notes),
    },
    internalNotes: cleanString(input.internalNotes),
    clientNotes: cleanString(input.clientNotes),
    visibility: {
      showInClientPortal: visibility.showInClientPortal !== false,
      showAnalytics: visibility.showAnalytics !== false,
    },
    deleted: input.deleted === true,
  }
}

export function sanitizeYouTubeSeriesInput(input: Partial<YouTubeSeries>): Omit<YouTubeSeries, 'id'> {
  const template = cleanObject(input.episodeTemplate)
  const style = cleanObject(input.styleGuide)
  const rawSections = Array.isArray(template.sections) ? template.sections : []
  return {
    orgId: cleanString(input.orgId) ?? '',
    channelWorkspaceId: cleanString(input.channelWorkspaceId) ?? '',
    name: cleanString(input.name) ?? 'Untitled series',
    objective: cleanString(input.objective),
    audience: cleanString(input.audience),
    format: pick(SERIES_FORMATS, input.format, 'mixed'),
    cadence: pick(SERIES_CADENCES, input.cadence, 'ad_hoc'),
    targetDurationSeconds: cleanNumber(input.targetDurationSeconds),
    episodeTemplate: {
      hook: cleanString(template.hook),
      sections: rawSections.flatMap((entry) => {
        const item = cleanObject(entry)
        const label = cleanString(item.label)
        return label ? [{ label, targetSeconds: cleanNumber(item.targetSeconds), notes: cleanString(item.notes) }] : []
      }),
      outro: cleanString(template.outro),
    },
    styleGuide: {
      visualNotes: cleanString(style.visualNotes),
      thumbnailNotes: cleanString(style.thumbnailNotes),
      captionNotes: cleanString(style.captionNotes),
      introOutroRules: cleanString(style.introOutroRules),
    },
    season: cleanString(input.season),
    status: pick(SERIES_STATUSES, input.status, 'active'),
    deleted: input.deleted === true,
  }
}

export function sanitizeYouTubeVideoProjectInput(input: Partial<YouTubeVideoProject>): Omit<YouTubeVideoProject, 'id' | 'createdAt' | 'updatedAt' | 'createdBy' | 'createdByType' | 'updatedBy' | 'updatedByType'> {
  const source = cleanObject(input.source)
  const linked = cleanObject(input.linked)
  const review = cleanObject(input.clientReview)
  const visibility = cleanObject(input.visibility)
  return {
    orgId: cleanString(input.orgId) ?? '',
    channelWorkspaceId: cleanString(input.channelWorkspaceId) ?? '',
    seriesId: cleanString(input.seriesId),
    title: cleanString(input.title) ?? 'Untitled video',
    workingTitle: cleanString(input.workingTitle),
    videoType: pick(VIDEO_TYPES, input.videoType, 'long_form'),
    status: pick(VIDEO_STATUSES, input.status, 'intake'),
    objective: cleanString(input.objective) ?? '',
    targetAudience: cleanString(input.targetAudience),
    targetDurationSeconds: cleanNumber(input.targetDurationSeconds),
    source: {
      intakeType: pick(SOURCE_TYPES, source.intakeType, 'manual'),
      researchItemId: cleanString(source.researchItemId),
      campaignId: cleanString(source.campaignId),
      projectId: cleanString(source.projectId),
      sourceUrl: cleanString(source.sourceUrl),
      transcriptAssetId: cleanString(source.transcriptAssetId),
    },
    linked: {
      projectId: cleanString(linked.projectId),
      taskIds: cleanStringArray(linked.taskIds),
      documentIds: cleanStringArray(linked.documentIds),
      campaignId: cleanString(linked.campaignId),
      socialPostIds: cleanStringArray(linked.socialPostIds),
    },
    approvalPolicy: policyFrom(input.approvalPolicy),
    publishPacketId: cleanString(input.publishPacketId),
    youtubeVideoId: cleanString(input.youtubeVideoId),
    scheduledAt: input.scheduledAt,
    publishedAt: input.publishedAt,
    clientReview: {
      status: pick(['not_requested', 'requested', 'approved', 'changes_requested', 'rejected'] as const, review.status, 'not_requested'),
      notes: cleanString(review.notes),
      decidedAt: review.decidedAt,
      decidedBy: cleanString(review.decidedBy),
    },
    internalNotes: cleanString(input.internalNotes),
    clientNotes: cleanString(input.clientNotes),
    visibility: {
      showInClientPortal: visibility.showInClientPortal !== false,
      showAnalytics: visibility.showAnalytics !== false,
      showPublishingPacket: visibility.showPublishingPacket === true,
    },
    deleted: input.deleted === true,
  }
}

export function serializeYouTubeRecord<T extends object>(id: string, data: FirebaseFirestore.DocumentData): T & { id: string } {
  return { id, ...(JSON.parse(JSON.stringify(data)) as T) }
}

export function clientSafeYouTubeChannelWorkspace(channel: YouTubeChannelWorkspace): YouTubeChannelWorkspace {
  const safe = { ...channel }
  delete safe.connectedAccountId
  delete safe.internalNotes
  return safe
}

export function clientSafeYouTubeVideoProject(video: YouTubeVideoProject): YouTubeVideoProject {
  const safe = { ...video }
  delete safe.internalNotes
  return safe
}

export function clientSafeYouTubePublishingPacket(packet: YouTubePublishingPacket): YouTubePublishingPacket {
  return packet
}
```

- [ ] **Step 5: Run sanitizer tests**

```bash
npm test -- --runInBand __tests__/lib/youtube-studio-sanitize.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/youtube-studio/types.ts lib/youtube-studio/sanitize.ts __tests__/lib/youtube-studio-sanitize.test.ts
git commit -m "feat(youtube-studio): add domain model"
```

---

### Task 3: Admin API Foundation

**Files:**
- Create: `lib/youtube-studio/api.ts`
- Create: `app/api/v1/youtube-studio/channels/route.ts`
- Create: `app/api/v1/youtube-studio/channels/[id]/route.ts`
- Create: `app/api/v1/youtube-studio/series/route.ts`
- Create: `app/api/v1/youtube-studio/videos/route.ts`
- Create: `app/api/v1/youtube-studio/videos/[id]/route.ts`
- Create: `app/api/v1/youtube-studio/publish-packets/route.ts`
- Test: `__tests__/api/youtube-studio.test.ts`

- [ ] **Step 1: Write admin API tests**

Create `__tests__/api/youtube-studio.test.ts`:

```ts
import { NextRequest } from 'next/server'

const mockCollection = jest.fn()
const mockWhere = jest.fn()
const mockGet = jest.fn()
const mockAdd = jest.fn()
const mockDoc = jest.fn()
const mockDocGet = jest.fn()
const mockDocSet = jest.fn()

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: { collection: mockCollection },
}))

jest.mock('@/lib/api/auth', () => ({
  withAuth: (_role: string, handler: any) => (req: NextRequest, ctx?: any) =>
    handler(req, { uid: 'admin-1', role: 'admin' }, ctx),
}))

jest.mock('@/lib/api/platformAdmin', () => ({
  canAccessOrg: jest.fn(() => true),
}))

jest.mock('firebase-admin/firestore', () => ({
  FieldValue: { serverTimestamp: () => 'SERVER_TS' },
}))

function stageCollection(name: string) {
  mockCollection.mockImplementation((collectionName: string) => {
    if (collectionName !== name && collectionName !== 'organizations') {
      throw new Error(`Unexpected collection ${collectionName}`)
    }
    if (collectionName === 'organizations') {
      return { doc: () => ({ get: jest.fn().mockResolvedValue({ exists: true }) }) }
    }
    return {
      where: mockWhere,
      add: mockAdd,
      doc: mockDoc,
    }
  })
  mockWhere.mockReturnValue({ get: mockGet })
  mockAdd.mockResolvedValue({ id: 'new-id' })
  mockDoc.mockReturnValue({ get: mockDocGet, set: mockDocSet })
  mockDocGet.mockResolvedValue({
    exists: true,
    id: 'record-1',
    data: () => ({ orgId: 'org-1', title: 'Existing', status: 'setup', deleted: false }),
    ref: { set: mockDocSet },
  })
  mockDocSet.mockResolvedValue(undefined)
}

describe('youtube studio admin API', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    jest.resetModules()
  })

  it('lists channel workspaces for an org', async () => {
    stageCollection('youtube_channel_workspaces')
    mockGet.mockResolvedValue({
      docs: [
        { id: 'channel-1', data: () => ({ orgId: 'org-1', title: 'Acme', status: 'active', deleted: false }) },
        { id: 'channel-2', data: () => ({ orgId: 'org-1', title: 'Hidden', status: 'archived', deleted: true }) },
      ],
    })

    const { GET } = await import('@/app/api/v1/youtube-studio/channels/route')
    const res = await GET(new NextRequest('http://localhost/api/v1/youtube-studio/channels?orgId=org-1'))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(mockWhere).toHaveBeenCalledWith('orgId', '==', 'org-1')
    expect(body.data.channels).toHaveLength(1)
    expect(body.data.channels[0]).toMatchObject({ id: 'channel-1', title: 'Acme' })
  })

  it('creates a channel workspace with actor fields', async () => {
    stageCollection('youtube_channel_workspaces')

    const { POST } = await import('@/app/api/v1/youtube-studio/channels/route')
    const res = await POST(new NextRequest('http://localhost/api/v1/youtube-studio/channels', {
      method: 'POST',
      body: JSON.stringify({ orgId: 'org-1', title: 'Acme Channel' }),
    }))
    const body = await res.json()

    expect(res.status).toBe(201)
    expect(body.data.id).toBe('new-id')
    expect(mockAdd).toHaveBeenCalledWith(expect.objectContaining({
      orgId: 'org-1',
      title: 'Acme Channel',
      createdBy: 'admin-1',
      createdByType: 'user',
      updatedBy: 'admin-1',
      updatedByType: 'user',
      createdAt: 'SERVER_TS',
      updatedAt: 'SERVER_TS',
    }))
  })

  it('updates a video project without changing org scope', async () => {
    stageCollection('youtube_video_projects')
    mockDocGet.mockResolvedValue({
      exists: true,
      id: 'video-1',
      data: () => ({ orgId: 'org-1', channelWorkspaceId: 'channel-1', title: 'Old', objective: 'Old', status: 'intake', videoType: 'long_form', deleted: false }),
      ref: { set: mockDocSet },
    })

    const { PUT } = await import('@/app/api/v1/youtube-studio/videos/[id]/route')
    const res = await PUT(new NextRequest('http://localhost/api/v1/youtube-studio/videos/video-1', {
      method: 'PUT',
      body: JSON.stringify({ title: 'New', orgId: 'bad-org' }),
    }), { params: Promise.resolve({ id: 'video-1' }) })

    expect(res.status).toBe(200)
    expect(mockDocSet).toHaveBeenCalledWith(expect.objectContaining({
      orgId: 'org-1',
      title: 'New',
      updatedBy: 'admin-1',
      updatedAt: 'SERVER_TS',
    }), { merge: true })
  })
})
```

- [ ] **Step 2: Run the test and verify it fails**

```bash
npm test -- --runInBand __tests__/api/youtube-studio.test.ts
```

Expected: FAIL because the admin API routes do not exist.

- [ ] **Step 3: Create shared API helpers**

Create `lib/youtube-studio/api.ts`:

```ts
import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import type { ApiUser } from '@/lib/api/types'
import { canAccessOrg } from '@/lib/api/platformAdmin'
import { apiError } from '@/lib/api/response'

export const YOUTUBE_COLLECTIONS = {
  channels: 'youtube_channel_workspaces',
  series: 'youtube_series',
  videos: 'youtube_video_projects',
  packets: 'youtube_publishing_packets',
} as const

export function actorFields(user: ApiUser) {
  const actorType = user.role === 'ai' ? 'agent' : 'user'
  return {
    createdBy: user.uid,
    createdByType: actorType,
    updatedBy: user.uid,
    updatedByType: actorType,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  }
}

export function updateActorFields(user: ApiUser) {
  return {
    updatedBy: user.uid,
    updatedByType: user.role === 'ai' ? 'agent' : 'user',
    updatedAt: FieldValue.serverTimestamp(),
  }
}

export async function ensureOrgAccess(user: ApiUser, orgId: string) {
  if (!orgId) return apiError('orgId is required', 400)
  if (user.role === 'admin' && !canAccessOrg(user, orgId)) return apiError('Forbidden', 403)
  const orgDoc = await adminDb.collection('organizations').doc(orgId).get()
  if (!orgDoc.exists) return apiError('Organisation not found', 404)
  return null
}

export async function listByOrg(collectionName: string, orgId: string) {
  const snap = await adminDb.collection(collectionName).where('orgId', '==', orgId).get()
  return snap.docs.filter((doc) => doc.data()?.deleted !== true)
}

export async function loadScopedRecord(collectionName: string, id: string) {
  const doc = await adminDb.collection(collectionName).doc(id).get()
  if (!doc.exists) return null
  return { id: doc.id, ref: doc.ref, data: doc.data()! }
}
```

- [ ] **Step 4: Create channel admin routes**

Create `app/api/v1/youtube-studio/channels/route.ts`:

```ts
import { NextRequest } from 'next/server'
import { adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { apiError, apiSuccess } from '@/lib/api/response'
import { actorFields, ensureOrgAccess, listByOrg, YOUTUBE_COLLECTIONS } from '@/lib/youtube-studio/api'
import { sanitizeYouTubeChannelWorkspaceInput, serializeYouTubeRecord } from '@/lib/youtube-studio/sanitize'
import type { YouTubeChannelWorkspace } from '@/lib/youtube-studio/types'

export const dynamic = 'force-dynamic'

export const GET = withAuth('admin', async (req, user) => {
  const orgId = new URL(req.url).searchParams.get('orgId')?.trim() ?? ''
  const denied = await ensureOrgAccess(user, orgId)
  if (denied) return denied

  const docs = await listByOrg(YOUTUBE_COLLECTIONS.channels, orgId)
  const channels = docs
    .map((doc) => serializeYouTubeRecord<YouTubeChannelWorkspace>(doc.id, doc.data()))
    .sort((a, b) => String(a.title ?? '').localeCompare(String(b.title ?? '')))

  return apiSuccess({ channels })
})

export const POST = withAuth('admin', async (req: NextRequest, user) => {
  const body = await req.json().catch(() => ({}))
  const orgId = typeof body.orgId === 'string' ? body.orgId.trim() : ''
  const denied = await ensureOrgAccess(user, orgId)
  if (denied) return denied

  const data = sanitizeYouTubeChannelWorkspaceInput({ ...body, orgId })
  if (!data.title || data.title === 'Untitled YouTube channel') return apiError('title is required', 400)

  const ref = await adminDb.collection(YOUTUBE_COLLECTIONS.channels).add({
    ...data,
    ...actorFields(user),
  })

  return apiSuccess({ id: ref.id }, 201)
})
```

Create `app/api/v1/youtube-studio/channels/[id]/route.ts`:

```ts
import { withAuth } from '@/lib/api/auth'
import { apiError, apiSuccess } from '@/lib/api/response'
import { ensureOrgAccess, loadScopedRecord, updateActorFields, YOUTUBE_COLLECTIONS } from '@/lib/youtube-studio/api'
import { sanitizeYouTubeChannelWorkspaceInput, serializeYouTubeRecord } from '@/lib/youtube-studio/sanitize'
import type { YouTubeChannelWorkspace } from '@/lib/youtube-studio/types'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ id: string }> }

export const GET = withAuth('admin', async (_req, user, ctx) => {
  const { id } = await (ctx as RouteContext).params
  const loaded = await loadScopedRecord(YOUTUBE_COLLECTIONS.channels, id)
  if (!loaded || loaded.data.deleted === true) return apiError('YouTube channel workspace not found', 404)
  const denied = await ensureOrgAccess(user, loaded.data.orgId)
  if (denied) return denied
  return apiSuccess({ channel: serializeYouTubeRecord<YouTubeChannelWorkspace>(loaded.id, loaded.data) })
})

export const PUT = withAuth('admin', async (req, user, ctx) => {
  const { id } = await (ctx as RouteContext).params
  const loaded = await loadScopedRecord(YOUTUBE_COLLECTIONS.channels, id)
  if (!loaded || loaded.data.deleted === true) return apiError('YouTube channel workspace not found', 404)
  const denied = await ensureOrgAccess(user, loaded.data.orgId)
  if (denied) return denied

  const body = await req.json().catch(() => ({}))
  const updates = sanitizeYouTubeChannelWorkspaceInput({ ...body, orgId: loaded.data.orgId })
  await loaded.ref.set({ ...updates, orgId: loaded.data.orgId, ...updateActorFields(user) }, { merge: true })
  return apiSuccess({ id, updated: true })
})

export const DELETE = withAuth('admin', async (_req, user, ctx) => {
  const { id } = await (ctx as RouteContext).params
  const loaded = await loadScopedRecord(YOUTUBE_COLLECTIONS.channels, id)
  if (!loaded || loaded.data.deleted === true) return apiError('YouTube channel workspace not found', 404)
  const denied = await ensureOrgAccess(user, loaded.data.orgId)
  if (denied) return denied

  await loaded.ref.set({ status: 'archived', deleted: true, ...updateActorFields(user) }, { merge: true })
  return apiSuccess({ id, deleted: true })
})
```

- [ ] **Step 5: Create series and video admin routes**

Create `app/api/v1/youtube-studio/series/route.ts`:

```ts
import { NextRequest } from 'next/server'
import { adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { apiError, apiSuccess } from '@/lib/api/response'
import { actorFields, ensureOrgAccess, listByOrg, YOUTUBE_COLLECTIONS } from '@/lib/youtube-studio/api'
import { sanitizeYouTubeSeriesInput, serializeYouTubeRecord } from '@/lib/youtube-studio/sanitize'
import type { YouTubeSeries } from '@/lib/youtube-studio/types'

export const dynamic = 'force-dynamic'

export const GET = withAuth('admin', async (req, user) => {
  const orgId = new URL(req.url).searchParams.get('orgId')?.trim() ?? ''
  const denied = await ensureOrgAccess(user, orgId)
  if (denied) return denied

  const docs = await listByOrg(YOUTUBE_COLLECTIONS.series, orgId)
  const series = docs
    .map((doc) => serializeYouTubeRecord<YouTubeSeries>(doc.id, doc.data()))
    .sort((a, b) => String(a.name ?? '').localeCompare(String(b.name ?? '')))

  return apiSuccess({ series })
})

export const POST = withAuth('admin', async (req: NextRequest, user) => {
  const body = await req.json().catch(() => ({}))
  const orgId = typeof body.orgId === 'string' ? body.orgId.trim() : ''
  const denied = await ensureOrgAccess(user, orgId)
  if (denied) return denied

  const data = sanitizeYouTubeSeriesInput({ ...body, orgId })
  if (!data.channelWorkspaceId) return apiError('channelWorkspaceId is required', 400)
  if (!data.name || data.name === 'Untitled series') return apiError('name is required', 400)

  const ref = await adminDb.collection(YOUTUBE_COLLECTIONS.series).add({
    ...data,
    ...actorFields(user),
  })

  return apiSuccess({ id: ref.id }, 201)
})
```

Create `app/api/v1/youtube-studio/videos/route.ts`:

```ts
import { NextRequest } from 'next/server'
import { adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { apiError, apiSuccess } from '@/lib/api/response'
import { actorFields, ensureOrgAccess, listByOrg, YOUTUBE_COLLECTIONS } from '@/lib/youtube-studio/api'
import { sanitizeYouTubeVideoProjectInput, serializeYouTubeRecord } from '@/lib/youtube-studio/sanitize'
import type { YouTubeVideoProject } from '@/lib/youtube-studio/types'

export const dynamic = 'force-dynamic'

export const GET = withAuth('admin', async (req, user) => {
  const orgId = new URL(req.url).searchParams.get('orgId')?.trim() ?? ''
  const denied = await ensureOrgAccess(user, orgId)
  if (denied) return denied

  const docs = await listByOrg(YOUTUBE_COLLECTIONS.videos, orgId)
  const videos = docs
    .map((doc) => serializeYouTubeRecord<YouTubeVideoProject>(doc.id, doc.data()))
    .sort((a, b) => String(a.title ?? '').localeCompare(String(b.title ?? '')))

  return apiSuccess({ videos })
})

export const POST = withAuth('admin', async (req: NextRequest, user) => {
  const body = await req.json().catch(() => ({}))
  const orgId = typeof body.orgId === 'string' ? body.orgId.trim() : ''
  const denied = await ensureOrgAccess(user, orgId)
  if (denied) return denied

  const data = sanitizeYouTubeVideoProjectInput({ ...body, orgId })
  if (!data.channelWorkspaceId) return apiError('channelWorkspaceId is required', 400)
  if (!data.title || data.title === 'Untitled video') return apiError('title is required', 400)

  const ref = await adminDb.collection(YOUTUBE_COLLECTIONS.videos).add({
    ...data,
    ...actorFields(user),
  })

  return apiSuccess({ id: ref.id }, 201)
})
```

Create `app/api/v1/youtube-studio/videos/[id]/route.ts`:

```ts
import { withAuth } from '@/lib/api/auth'
import { apiError, apiSuccess } from '@/lib/api/response'
import { ensureOrgAccess, loadScopedRecord, updateActorFields, YOUTUBE_COLLECTIONS } from '@/lib/youtube-studio/api'
import { sanitizeYouTubeVideoProjectInput, serializeYouTubeRecord } from '@/lib/youtube-studio/sanitize'
import type { YouTubeVideoProject } from '@/lib/youtube-studio/types'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ id: string }> }

export const GET = withAuth('admin', async (_req, user, ctx) => {
  const { id } = await (ctx as RouteContext).params
  const loaded = await loadScopedRecord(YOUTUBE_COLLECTIONS.videos, id)
  if (!loaded || loaded.data.deleted === true) return apiError('Video project not found', 404)
  const denied = await ensureOrgAccess(user, loaded.data.orgId)
  if (denied) return denied
  return apiSuccess({ video: serializeYouTubeRecord<YouTubeVideoProject>(loaded.id, loaded.data) })
})

export const PUT = withAuth('admin', async (req, user, ctx) => {
  const { id } = await (ctx as RouteContext).params
  const loaded = await loadScopedRecord(YOUTUBE_COLLECTIONS.videos, id)
  if (!loaded || loaded.data.deleted === true) return apiError('Video project not found', 404)
  const denied = await ensureOrgAccess(user, loaded.data.orgId)
  if (denied) return denied

  const body = await req.json().catch(() => ({}))
  const updates = sanitizeYouTubeVideoProjectInput({ ...body, orgId: loaded.data.orgId })
  await loaded.ref.set({ ...updates, orgId: loaded.data.orgId, ...updateActorFields(user) }, { merge: true })
  return apiSuccess({ id, updated: true })
})

export const DELETE = withAuth('admin', async (_req, user, ctx) => {
  const { id } = await (ctx as RouteContext).params
  const loaded = await loadScopedRecord(YOUTUBE_COLLECTIONS.videos, id)
  if (!loaded || loaded.data.deleted === true) return apiError('Video project not found', 404)
  const denied = await ensureOrgAccess(user, loaded.data.orgId)
  if (denied) return denied

  await loaded.ref.set({ status: 'archived', deleted: true, ...updateActorFields(user) }, { merge: true })
  return apiSuccess({ id, deleted: true })
})
```

- [ ] **Step 6: Create publishing packet route**

Create `app/api/v1/youtube-studio/publish-packets/route.ts`:

```ts
import { FieldValue } from 'firebase-admin/firestore'
import { NextRequest } from 'next/server'
import { adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { apiError, apiSuccess } from '@/lib/api/response'
import { actorFields, ensureOrgAccess, listByOrg, updateActorFields, YOUTUBE_COLLECTIONS } from '@/lib/youtube-studio/api'

export const dynamic = 'force-dynamic'

function cleanString(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : ''
}

export const GET = withAuth('admin', async (req, user) => {
  const url = new URL(req.url)
  const orgId = url.searchParams.get('orgId')?.trim() ?? ''
  const videoProjectId = url.searchParams.get('videoProjectId')?.trim() ?? ''
  const denied = await ensureOrgAccess(user, orgId)
  if (denied) return denied

  const docs = await listByOrg(YOUTUBE_COLLECTIONS.packets, orgId)
  const packets = docs
    .map((doc) => ({ id: doc.id, ...JSON.parse(JSON.stringify(doc.data())) }))
    .filter((packet) => !videoProjectId || packet.videoProjectId === videoProjectId)

  return apiSuccess({ packets })
})

export const POST = withAuth('admin', async (req: NextRequest, user) => {
  const body = await req.json().catch(() => ({}))
  const orgId = cleanString(body.orgId)
  const videoProjectId = cleanString(body.videoProjectId)
  const channelWorkspaceId = cleanString(body.channelWorkspaceId)
  const denied = await ensureOrgAccess(user, orgId)
  if (denied) return denied
  if (!videoProjectId) return apiError('videoProjectId is required', 400)
  if (!channelWorkspaceId) return apiError('channelWorkspaceId is required', 400)

  const packet = {
    orgId,
    channelWorkspaceId,
    videoProjectId,
    versionNumber: typeof body.versionNumber === 'number' ? body.versionNumber : 1,
    status: ['draft', 'internal_review', 'client_review', 'approved', 'blocked', 'published'].includes(body.status) ? body.status : 'draft',
    titleOptions: Array.isArray(body.titleOptions) ? body.titleOptions : [],
    description: cleanString(body.description),
    tags: Array.isArray(body.tags) ? body.tags.filter((tag: unknown): tag is string => typeof tag === 'string' && tag.trim().length > 0).map((tag: string) => tag.trim()) : [],
    chapters: Array.isArray(body.chapters) ? body.chapters : [],
    visibility: ['private', 'unlisted', 'public'].includes(body.visibility) ? body.visibility : 'private',
    checks: body.checks && typeof body.checks === 'object' ? body.checks : {},
    deleted: false,
    ...actorFields(user),
  }

  const ref = await adminDb.collection(YOUTUBE_COLLECTIONS.packets).add(packet)
  await adminDb.collection(YOUTUBE_COLLECTIONS.videos).doc(videoProjectId).set({
    publishPacketId: ref.id,
    updatedAt: FieldValue.serverTimestamp(),
    ...updateActorFields(user),
  }, { merge: true })

  return apiSuccess({ id: ref.id }, 201)
})
```

- [ ] **Step 7: Run admin API tests**

```bash
npm test -- --runInBand __tests__/api/youtube-studio.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add lib/youtube-studio/api.ts app/api/v1/youtube-studio __tests__/api/youtube-studio.test.ts
git commit -m "feat(youtube-studio): add admin APIs"
```

---

### Task 4: Portal API Guard, Requests, And Review Decisions

**Files:**
- Create: `app/api/v1/portal/youtube-studio/route.ts`
- Test: `__tests__/api/portal-youtube-studio.test.ts`

- [ ] **Step 1: Write portal API tests**

Create `__tests__/api/portal-youtube-studio.test.ts`:

```ts
import { NextRequest } from 'next/server'

const mockCollection = jest.fn()
const mockOrgGet = jest.fn()
const mockChannelsGet = jest.fn()
const mockVideosGet = jest.fn()
const mockSeriesGet = jest.fn()
const mockPacketsGet = jest.fn()
const mockAdd = jest.fn()
const mockDoc = jest.fn()
const mockDocGet = jest.fn()
const mockDocSet = jest.fn()

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: { collection: mockCollection },
}))

jest.mock('@/lib/auth/portal-middleware', () => ({
  withPortalAuthAndRole: (_role: string, handler: any) =>
    (req: NextRequest) => handler(req, 'client-1', req.nextUrl.searchParams.get('orgId') || 'org-1', 'viewer'),
}))

jest.mock('firebase-admin/firestore', () => ({
  FieldValue: { serverTimestamp: () => 'SERVER_TS' },
}))

function stageCollections(settings: Record<string, unknown> = {}) {
  mockOrgGet.mockResolvedValue({ exists: true, data: () => ({ settings }) })
  mockChannelsGet.mockResolvedValue({
    docs: [{ id: 'channel-1', data: () => ({ orgId: 'org-1', title: 'Acme Channel', status: 'active', visibility: { showInClientPortal: true }, deleted: false, connectedAccountId: 'secret' }) }],
  })
  mockSeriesGet.mockResolvedValue({ docs: [] })
  mockPacketsGet.mockResolvedValue({ docs: [] })
  mockVideosGet.mockResolvedValue({
    docs: [{ id: 'video-1', data: () => ({ orgId: 'org-1', channelWorkspaceId: 'channel-1', title: 'Client Draft', objective: 'Grow trust', status: 'client_review', videoType: 'long_form', visibility: { showInClientPortal: true }, internalNotes: 'hide', deleted: false }) }],
  })
  mockAdd.mockResolvedValue({ id: 'request-1' })
  mockDoc.mockReturnValue({ get: mockDocGet, set: mockDocSet })
  mockDocGet.mockResolvedValue({
    exists: true,
    id: 'video-1',
    data: () => ({ orgId: 'org-1', channelWorkspaceId: 'channel-1', title: 'Client Draft', objective: 'Grow trust', status: 'client_review', videoType: 'long_form', visibility: { showInClientPortal: true }, deleted: false }),
    ref: { set: mockDocSet },
  })
  mockDocSet.mockResolvedValue(undefined)
  mockCollection.mockImplementation((name: string) => {
    if (name === 'organizations') return { doc: () => ({ get: mockOrgGet }) }
    if (name === 'youtube_channel_workspaces') return { where: jest.fn().mockReturnValue({ get: mockChannelsGet }) }
    if (name === 'youtube_series') return { where: jest.fn().mockReturnValue({ get: mockSeriesGet }) }
    if (name === 'youtube_publishing_packets') return { where: jest.fn().mockReturnValue({ get: mockPacketsGet }) }
    if (name === 'youtube_video_projects') return { where: jest.fn().mockReturnValue({ get: mockVideosGet }), add: mockAdd, doc: mockDoc }
    throw new Error(`Unexpected collection: ${name}`)
  })
}

describe('portal youtube studio API', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    jest.resetModules()
    stageCollections()
  })

  it('returns client-safe channel and video records when enabled by default', async () => {
    const { GET } = await import('@/app/api/v1/portal/youtube-studio/route')
    const res = await GET(new NextRequest('http://localhost/api/v1/portal/youtube-studio'))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.data.channels[0]).not.toHaveProperty('connectedAccountId')
    expect(body.data.videos[0]).not.toHaveProperty('internalNotes')
    expect(body.data.videos[0]).toMatchObject({ title: 'Client Draft' })
  })

  it('blocks access when the org disables YouTube Studio', async () => {
    stageCollections({ portalModules: { youtubeStudio: false } })
    const { GET } = await import('@/app/api/v1/portal/youtube-studio/route')
    const res = await GET(new NextRequest('http://localhost/api/v1/portal/youtube-studio'))
    const body = await res.json()

    expect(res.status).toBe(403)
    expect(body).toMatchObject({ success: false, moduleDisabled: true, module: 'youtubeStudio' })
    expect(mockChannelsGet).not.toHaveBeenCalled()
  })

  it('lets a portal client submit a video request', async () => {
    const { POST } = await import('@/app/api/v1/portal/youtube-studio/route')
    const res = await POST(new NextRequest('http://localhost/api/v1/portal/youtube-studio', {
      method: 'POST',
      body: JSON.stringify({ channelWorkspaceId: 'channel-1', title: 'New FAQ video', objective: 'Answer buyers', sourceUrl: 'https://youtu.be/demo' }),
    }))
    const body = await res.json()

    expect(res.status).toBe(201)
    expect(body.data.id).toBe('request-1')
    expect(mockAdd).toHaveBeenCalledWith(expect.objectContaining({
      orgId: 'org-1',
      channelWorkspaceId: 'channel-1',
      title: 'New FAQ video',
      source: expect.objectContaining({ intakeType: 'client_request', sourceUrl: 'https://youtu.be/demo' }),
      status: 'intake',
      createdBy: 'client-1',
      createdByType: 'user',
    }))
  })

  it('lets a portal client approve or request changes on a visible video', async () => {
    const { PUT } = await import('@/app/api/v1/portal/youtube-studio/route')
    const res = await PUT(new NextRequest('http://localhost/api/v1/portal/youtube-studio', {
      method: 'PUT',
      body: JSON.stringify({ id: 'video-1', decision: 'changes_requested', notes: 'Please shorten the intro.' }),
    }))

    expect(res.status).toBe(200)
    expect(mockDocSet).toHaveBeenCalledWith(expect.objectContaining({
      status: 'changes_requested',
      clientReview: expect.objectContaining({
        status: 'changes_requested',
        notes: 'Please shorten the intro.',
        decidedBy: 'client-1',
      }),
      updatedBy: 'client-1',
      updatedAt: 'SERVER_TS',
    }), { merge: true })
  })
})
```

- [ ] **Step 2: Run portal API test and verify it fails**

```bash
npm test -- --runInBand __tests__/api/portal-youtube-studio.test.ts
```

Expected: FAIL because `app/api/v1/portal/youtube-studio/route.ts` does not exist.

- [ ] **Step 3: Create portal route**

Create `app/api/v1/portal/youtube-studio/route.ts`:

```ts
import { NextRequest } from 'next/server'
import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import { apiError, apiSuccess } from '@/lib/api/response'
import { withPortalAuthAndRole } from '@/lib/auth/portal-middleware'
import { isPortalModuleEnabled } from '@/lib/organizations/portal-modules'
import { YOUTUBE_COLLECTIONS } from '@/lib/youtube-studio/api'
import {
  clientSafeYouTubeChannelWorkspace,
  clientSafeYouTubePublishingPacket,
  clientSafeYouTubeVideoProject,
  sanitizeYouTubeVideoProjectInput,
  serializeYouTubeRecord,
} from '@/lib/youtube-studio/sanitize'
import type { YouTubeChannelWorkspace, YouTubePublishingPacket, YouTubeSeries, YouTubeVideoProject } from '@/lib/youtube-studio/types'

export const dynamic = 'force-dynamic'

async function youtubeStudioModuleGuard(orgId: string) {
  const orgDoc = await adminDb.collection('organizations').doc(orgId).get()
  if (!orgDoc.exists) return apiError('Organisation not found', 404)
  if (!isPortalModuleEnabled(orgDoc.data()?.settings, 'youtubeStudio')) {
    return apiError('YouTube Studio module is disabled for this client portal', 403, {
      moduleDisabled: true,
      module: 'youtubeStudio',
    })
  }
  return null
}

async function listOrg<T extends object>(collectionName: string, orgId: string) {
  const snap = await adminDb.collection(collectionName).where('orgId', '==', orgId).get()
  return snap.docs
    .map((doc) => serializeYouTubeRecord<T>(doc.id, doc.data()))
    .filter((record) => (record as { deleted?: boolean }).deleted !== true)
}

export const GET = withPortalAuthAndRole('viewer', async (_req: NextRequest, _uid, orgId) => {
  const disabled = await youtubeStudioModuleGuard(orgId)
  if (disabled) return disabled

  const [channelsRaw, seriesRaw, videosRaw, packetsRaw] = await Promise.all([
    listOrg<YouTubeChannelWorkspace>(YOUTUBE_COLLECTIONS.channels, orgId),
    listOrg<YouTubeSeries>(YOUTUBE_COLLECTIONS.series, orgId),
    listOrg<YouTubeVideoProject>(YOUTUBE_COLLECTIONS.videos, orgId),
    listOrg<YouTubePublishingPacket>(YOUTUBE_COLLECTIONS.packets, orgId),
  ])

  const channels = channelsRaw
    .filter((channel) => channel.visibility?.showInClientPortal !== false)
    .map(clientSafeYouTubeChannelWorkspace)
  const videos = videosRaw
    .filter((video) => video.visibility?.showInClientPortal !== false)
    .map(clientSafeYouTubeVideoProject)
  const packets = packetsRaw
    .filter((packet) => videos.some((video) => video.id && video.id === packet.videoProjectId && video.visibility?.showPublishingPacket === true))
    .map(clientSafeYouTubePublishingPacket)

  return apiSuccess({ channels, series: seriesRaw, videos, packets })
})

export const POST = withPortalAuthAndRole('member', async (req: NextRequest, uid, orgId) => {
  const disabled = await youtubeStudioModuleGuard(orgId)
  if (disabled) return disabled

  const body = await req.json().catch(() => ({}))
  const data = sanitizeYouTubeVideoProjectInput({
    orgId,
    channelWorkspaceId: body.channelWorkspaceId,
    title: body.title,
    objective: body.objective,
    videoType: body.videoType,
    targetAudience: body.targetAudience,
    source: { intakeType: 'client_request', sourceUrl: body.sourceUrl },
    status: 'intake',
    visibility: { showInClientPortal: true },
    clientReview: { status: 'not_requested' },
    clientNotes: body.clientNotes,
  })
  if (!data.channelWorkspaceId) return apiError('channelWorkspaceId is required', 400)
  if (!data.title || data.title === 'Untitled video') return apiError('title is required', 400)

  const ref = await adminDb.collection(YOUTUBE_COLLECTIONS.videos).add({
    ...data,
    createdBy: uid,
    createdByType: 'user',
    updatedBy: uid,
    updatedByType: 'user',
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  })

  return apiSuccess({ id: ref.id }, 201)
})

export const PUT = withPortalAuthAndRole('member', async (req: NextRequest, uid, orgId) => {
  const disabled = await youtubeStudioModuleGuard(orgId)
  if (disabled) return disabled

  const body = await req.json().catch(() => ({}))
  const id = typeof body.id === 'string' ? body.id.trim() : ''
  if (!id) return apiError('id is required', 400)
  const decision = ['approved', 'changes_requested', 'rejected'].includes(body.decision) ? body.decision : ''
  if (!decision) return apiError('decision must be approved, changes_requested, or rejected', 400)

  const ref = adminDb.collection(YOUTUBE_COLLECTIONS.videos).doc(id)
  const doc = await ref.get()
  if (!doc.exists) return apiError('Video project not found', 404)
  const video = serializeYouTubeRecord<YouTubeVideoProject>(doc.id, doc.data()!)
  if (video.orgId !== orgId || video.visibility?.showInClientPortal === false) return apiError('Forbidden', 403)

  await ref.set({
    status: decision === 'approved' ? 'internal_review' : decision,
    clientReview: {
      status: decision,
      notes: typeof body.notes === 'string' ? body.notes.trim() : '',
      decidedBy: uid,
      decidedAt: FieldValue.serverTimestamp(),
    },
    updatedBy: uid,
    updatedByType: 'user',
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true })

  return apiSuccess({ id, updated: true })
})
```

- [ ] **Step 4: Run portal API test**

```bash
npm test -- --runInBand __tests__/api/portal-youtube-studio.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/api/v1/portal/youtube-studio/route.ts __tests__/api/portal-youtube-studio.test.ts
git commit -m "feat(youtube-studio): add portal API"
```

---

### Task 5: Shared Workspace UI And Routes

**Files:**
- Create: `components/youtube-studio/YouTubeStudioWorkspaceShell.tsx`
- Create: `components/youtube-studio/YouTubeStudioCards.tsx`
- Create: `components/youtube-studio/YouTubeStudioAdminWorkspace.tsx`
- Create: `components/youtube-studio/YouTubeStudioPortalWorkspace.tsx`
- Create: `app/(admin)/admin/org/[slug]/youtube-studio/page.tsx`
- Create: `app/(portal)/portal/youtube-studio/page.tsx`
- Test: `__tests__/app/youtube-studio-shared-workspace.test.ts`
- Test: `__tests__/app/youtube-studio-portal-module-disabled.test.tsx`

- [ ] **Step 1: Write shared workspace structure test**

Create `__tests__/app/youtube-studio-shared-workspace.test.ts`:

```ts
import { readFileSync } from 'fs'
import path from 'path'

function source(relativePath: string) {
  return readFileSync(path.join(process.cwd(), relativePath), 'utf8')
}

describe('youtube studio shared workspace standard', () => {
  it('keeps portal and admin routes thin and shares YouTube Studio workspaces', () => {
    const adminRoute = source('app/(admin)/admin/org/[slug]/youtube-studio/page.tsx')
    const portalRoute = source('app/(portal)/portal/youtube-studio/page.tsx')

    expect(adminRoute).toContain('@/components/youtube-studio/YouTubeStudioAdminWorkspace')
    expect(adminRoute).toContain('adminDb')
    expect(adminRoute).toContain('orgId={orgDoc.id}')
    expect(adminRoute).not.toContain('videos.map')
    expect(adminRoute).not.toContain('function Field')

    expect(portalRoute).toContain('@/components/youtube-studio/YouTubeStudioPortalWorkspace')
    expect(portalRoute).not.toContain('videos.map')

    const adminWorkspace = source('components/youtube-studio/YouTubeStudioAdminWorkspace.tsx')
    const portalWorkspace = source('components/youtube-studio/YouTubeStudioPortalWorkspace.tsx')
    const shell = source('components/youtube-studio/YouTubeStudioWorkspaceShell.tsx')
    const cards = source('components/youtube-studio/YouTubeStudioCards.tsx')

    expect(shell).toContain('export function YouTubeStudioWorkspaceShell')
    expect(cards).toContain('export function YouTubeVideoCard')
    expect(adminWorkspace).toContain('@/components/youtube-studio/YouTubeStudioWorkspaceShell')
    expect(portalWorkspace).toContain('@/components/youtube-studio/YouTubeStudioWorkspaceShell')
  })
})
```

- [ ] **Step 2: Write disabled portal UI test**

Create `__tests__/app/youtube-studio-portal-module-disabled.test.tsx`:

```tsx
import React from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import { YouTubeStudioPortalWorkspace } from '@/components/youtube-studio/YouTubeStudioPortalWorkspace'

describe('YouTubeStudioPortalWorkspace module availability', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 403,
      json: async () => ({
        success: false,
        error: 'YouTube Studio module is disabled for this client portal',
        moduleDisabled: true,
        module: 'youtubeStudio',
      }),
    } as Response)
  })

  it('shows a disabled-module message instead of an empty request list', async () => {
    render(<YouTubeStudioPortalWorkspace />)

    await waitFor(() => {
      expect(screen.getByText('YouTube Studio is not enabled for this portal.')).toBeInTheDocument()
    })
    expect(screen.queryByText('No YouTube videos yet')).not.toBeInTheDocument()
  })
})
```

- [ ] **Step 3: Run UI tests and verify they fail**

```bash
npm test -- --runInBand __tests__/app/youtube-studio-shared-workspace.test.ts __tests__/app/youtube-studio-portal-module-disabled.test.tsx
```

Expected: FAIL because components and routes do not exist.

- [ ] **Step 4: Create the shared shell**

Create `components/youtube-studio/YouTubeStudioWorkspaceShell.tsx`:

```tsx
'use client'

import type { ReactNode } from 'react'
import type { YouTubeChannelWorkspace, YouTubeSeries, YouTubeVideoProject } from '@/lib/youtube-studio/types'

type Surface = 'admin' | 'portal'

interface Props {
  channels: YouTubeChannelWorkspace[]
  videos: YouTubeVideoProject[]
  series: YouTubeSeries[]
  surface: Surface
  eyebrow: string
  title?: string
  description: string
  notice?: string
  loading?: boolean
  className?: string
  children?: ReactNode
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="pib-card-section px-4 py-3 text-center">
      <p className="text-xs text-on-surface-variant">{label}</p>
      <p className="text-xl font-bold text-on-surface">{value}</p>
    </div>
  )
}

export function YouTubeStudioWorkspaceShell({
  channels,
  videos,
  series,
  surface,
  eyebrow,
  title = 'YouTube Studio',
  description,
  notice = '',
  loading = false,
  className = '',
  children,
}: Props) {
  const reviewCount = videos.filter((video) => video.status === 'client_review' || video.clientReview?.status === 'requested').length
  const publishReady = videos.filter((video) => video.status === 'publish_ready').length
  const liveCount = videos.filter((video) => video.status === 'live').length

  if (loading) {
    return (
      <main className={['max-w-7xl mx-auto space-y-6', className].filter(Boolean).join(' ')}>
        <div className="pib-skeleton h-96" />
      </main>
    )
  }

  return (
    <main className={['max-w-7xl mx-auto space-y-6', className].filter(Boolean).join(' ')}>
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="eyebrow">{eyebrow}</p>
          <h1 className="text-3xl font-headline font-bold text-[var(--color-pib-text)]">{title}</h1>
          <p className="mt-2 max-w-3xl text-sm text-[var(--color-pib-text-muted)]">{description}</p>
        </div>
        <div className="grid grid-cols-4 gap-2">
          <StatCard label="Channels" value={channels.length} />
          <StatCard label="Series" value={series.length} />
          <StatCard label={surface === 'admin' ? 'Review' : 'To review'} value={reviewCount} />
          <StatCard label={surface === 'admin' ? 'Publish' : 'Live'} value={surface === 'admin' ? publishReady : liveCount} />
        </div>
      </div>

      {notice ? (
        <div className="rounded-2xl border border-[var(--color-pib-line)] bg-[var(--color-pib-card)] p-4 text-sm text-[var(--color-pib-text)]">
          {notice}
        </div>
      ) : null}

      {children}
    </main>
  )
}
```

- [ ] **Step 5: Create shared cards**

Create `components/youtube-studio/YouTubeStudioCards.tsx` with compact cards for channels and videos:

```tsx
'use client'

import type { ReactNode } from 'react'
import type { YouTubeChannelWorkspace, YouTubeVideoProject } from '@/lib/youtube-studio/types'

function label(value?: string) {
  return value ? value.replace(/_/g, ' ') : 'not set'
}

export function StatusPill({ status }: { status?: string }) {
  return (
    <span className="rounded-full border border-[var(--color-pib-line)] px-2 py-1 text-[11px] font-label uppercase tracking-widest text-[var(--color-pib-text-muted)]">
      {label(status)}
    </span>
  )
}

export function YouTubeChannelCard({ channel, children }: { channel: YouTubeChannelWorkspace; children?: ReactNode }) {
  return (
    <article className="pib-card-section space-y-3 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-headline text-lg font-semibold text-on-surface">{channel.title}</h3>
          <p className="text-sm text-on-surface-variant">{channel.youtubeHandle || channel.youtubeChannelId || 'Channel connection pending'}</p>
        </div>
        <StatusPill status={channel.status} />
      </div>
      {channel.contentPillars?.length ? (
        <div className="flex flex-wrap gap-2">
          {channel.contentPillars.slice(0, 4).map((pillar) => (
            <span key={pillar} className="rounded-full bg-white/[0.04] px-2 py-1 text-xs text-on-surface-variant">{pillar}</span>
          ))}
        </div>
      ) : null}
      {channel.clientNotes ? <p className="text-sm text-on-surface-variant">{channel.clientNotes}</p> : null}
      {children ? <div className="flex flex-wrap gap-2 pt-1">{children}</div> : null}
    </article>
  )
}

export function YouTubeVideoCard({ video, children }: { video: YouTubeVideoProject; children?: ReactNode }) {
  return (
    <article className="pib-card-section space-y-3 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-headline text-lg font-semibold text-on-surface">{video.title}</h3>
          <p className="text-sm text-on-surface-variant">{video.objective || label(video.videoType)}</p>
        </div>
        <StatusPill status={video.status} />
      </div>
      <div className="grid grid-cols-2 gap-2 text-xs text-on-surface-variant sm:grid-cols-4">
        <span>Type: {label(video.videoType)}</span>
        <span>Review: {label(video.clientReview?.status)}</span>
        <span>Source: {label(video.source?.intakeType)}</span>
        <span>Target: {video.targetDurationSeconds ? `${video.targetDurationSeconds}s` : 'open'}</span>
      </div>
      {video.clientNotes ? <p className="rounded-xl bg-white/[0.04] p-3 text-sm text-on-surface">{video.clientNotes}</p> : null}
      {children ? <div className="flex flex-wrap gap-2 pt-1">{children}</div> : null}
    </article>
  )
}
```

- [ ] **Step 6: Create the admin workspace**

Create `components/youtube-studio/YouTubeStudioAdminWorkspace.tsx`:

```tsx
'use client'

import { useEffect, useState } from 'react'
import type { YouTubeChannelWorkspace, YouTubeSeries, YouTubeVideoProject, YouTubeVideoType } from '@/lib/youtube-studio/types'
import { YouTubeChannelCard, YouTubeVideoCard } from '@/components/youtube-studio/YouTubeStudioCards'
import { YouTubeStudioWorkspaceShell } from '@/components/youtube-studio/YouTubeStudioWorkspaceShell'

interface Props {
  orgId: string
  orgName: string
}

type FormState = {
  channelTitle: string
  youtubeHandle: string
  contentPillars: string
  audienceNotes: string
  videoChannelId: string
  videoTitle: string
  objective: string
  videoType: YouTubeVideoType
  sourceUrl: string
}

const emptyForm: FormState = {
  channelTitle: '',
  youtubeHandle: '',
  contentPillars: '',
  audienceNotes: '',
  videoChannelId: '',
  videoTitle: '',
  objective: '',
  videoType: 'long_form',
  sourceUrl: '',
}

function splitLines(value: string) {
  return value.split(/[\n,]+/).map((item) => item.trim()).filter(Boolean)
}

export function YouTubeStudioAdminWorkspace({ orgId, orgName }: Props) {
  const [channels, setChannels] = useState<YouTubeChannelWorkspace[]>([])
  const [series, setSeries] = useState<YouTubeSeries[]>([])
  const [videos, setVideos] = useState<YouTubeVideoProject[]>([])
  const [form, setForm] = useState<FormState>(emptyForm)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState('')

  async function load() {
    const [channelRes, seriesRes, videoRes] = await Promise.all([
      fetch(`/api/v1/youtube-studio/channels?orgId=${encodeURIComponent(orgId)}`),
      fetch(`/api/v1/youtube-studio/series?orgId=${encodeURIComponent(orgId)}`),
      fetch(`/api/v1/youtube-studio/videos?orgId=${encodeURIComponent(orgId)}`),
    ])
    const [channelBody, seriesBody, videoBody] = await Promise.all([
      channelRes.json().catch(() => ({})),
      seriesRes.json().catch(() => ({})),
      videoRes.json().catch(() => ({})),
    ])
    setChannels(Array.isArray(channelBody.data?.channels) ? channelBody.data.channels : [])
    setSeries(Array.isArray(seriesBody.data?.series) ? seriesBody.data.series : [])
    setVideos(Array.isArray(videoBody.data?.videos) ? videoBody.data.videos : [])
    setLoading(false)
  }

  useEffect(() => {
    if (orgId) void load()
  }, [orgId])

  function update<K extends keyof FormState>(field: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [field]: value }))
  }

  async function saveChannel(event: React.FormEvent) {
    event.preventDefault()
    if (!form.channelTitle.trim()) return
    setSaving(true)
    setNotice('')
    const res = await fetch('/api/v1/youtube-studio/channels', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        orgId,
        title: form.channelTitle,
        youtubeHandle: form.youtubeHandle,
        contentPillars: splitLines(form.contentPillars),
        audienceNotes: form.audienceNotes,
      }),
    })
    const body = await res.json().catch(() => ({}))
    setSaving(false)
    if (!res.ok) {
      setNotice(body.error ?? 'Could not save YouTube channel workspace')
      return
    }
    setForm((prev) => ({ ...prev, channelTitle: '', youtubeHandle: '', contentPillars: '', audienceNotes: '', videoChannelId: body.data?.id ?? prev.videoChannelId }))
    setNotice('YouTube channel workspace saved.')
    await load()
  }

  async function saveVideo(event: React.FormEvent) {
    event.preventDefault()
    if (!form.videoChannelId || !form.videoTitle.trim()) return
    setSaving(true)
    setNotice('')
    const res = await fetch('/api/v1/youtube-studio/videos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        orgId,
        channelWorkspaceId: form.videoChannelId,
        title: form.videoTitle,
        objective: form.objective,
        videoType: form.videoType,
        source: { intakeType: form.sourceUrl ? 'source_url' : 'manual', sourceUrl: form.sourceUrl },
        visibility: { showInClientPortal: true },
      }),
    })
    const body = await res.json().catch(() => ({}))
    setSaving(false)
    if (!res.ok) {
      setNotice(body.error ?? 'Could not save video project')
      return
    }
    setForm((prev) => ({ ...prev, videoTitle: '', objective: '', sourceUrl: '' }))
    setNotice('Video project saved.')
    await load()
  }

  return (
    <YouTubeStudioWorkspaceShell
      channels={channels}
      videos={videos}
      series={series}
      surface="admin"
      eyebrow={`${orgName} / Video production`}
      description="Manage channel setup, series, video requests, production state, client review, and publishing packet readiness."
      notice={notice}
      loading={loading}
    >
      <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
        <section className="space-y-4">
          {channels.length === 0 ? (
            <div className="pib-card-section p-5 text-sm text-on-surface-variant">No YouTube channel workspaces yet.</div>
          ) : channels.map((channel) => (
            <YouTubeChannelCard key={channel.id ?? channel.title} channel={channel} />
          ))}
          <div className="space-y-3">
            <h2 className="font-headline text-xl font-semibold text-on-surface">Video pipeline</h2>
            {videos.length === 0 ? (
              <div className="pib-card-section p-5 text-sm text-on-surface-variant">No YouTube videos yet.</div>
            ) : videos.map((video) => (
              <YouTubeVideoCard key={video.id ?? video.title} video={video} />
            ))}
          </div>
        </section>

        <aside className="space-y-4 lg:sticky lg:top-6">
          <form onSubmit={saveChannel} className="pib-card-section space-y-4 p-5">
            <h2 className="font-headline font-bold text-on-surface">Add channel</h2>
            <Field label="Channel title" value={form.channelTitle} onChange={(value) => update('channelTitle', value)} required />
            <Field label="YouTube handle" value={form.youtubeHandle} onChange={(value) => update('youtubeHandle', value)} />
            <TextArea label="Content pillars" value={form.contentPillars} onChange={(value) => update('contentPillars', value)} placeholder="One per line or comma-separated" />
            <TextArea label="Audience notes" value={form.audienceNotes} onChange={(value) => update('audienceNotes', value)} />
            <button type="submit" disabled={saving || !form.channelTitle.trim()} className="pib-btn-primary w-full">{saving ? 'Saving...' : 'Save channel'}</button>
          </form>

          <form onSubmit={saveVideo} className="pib-card-section space-y-4 p-5">
            <h2 className="font-headline font-bold text-on-surface">Start video</h2>
            <label className="block text-sm">
              <span className="text-xs font-label uppercase tracking-widest text-on-surface-variant">Channel</span>
              <select value={form.videoChannelId} onChange={(event) => update('videoChannelId', event.target.value)} className="mt-1 w-full rounded-lg border border-[var(--color-outline-variant)] bg-[var(--color-surface)] px-3 py-2 text-sm">
                <option value="">Select a channel</option>
                {channels.map((channel) => <option key={channel.id} value={channel.id}>{channel.title}</option>)}
              </select>
            </label>
            <Field label="Video title" value={form.videoTitle} onChange={(value) => update('videoTitle', value)} required />
            <TextArea label="Objective" value={form.objective} onChange={(value) => update('objective', value)} />
            <Select label="Video type" value={form.videoType} onChange={(value) => update('videoType', value as YouTubeVideoType)} options={['short', 'long_form', 'clip_pack', 'testimonial', 'case_study', 'tutorial', 'product_demo', 'ad_creative']} />
            <Field label="Source URL" value={form.sourceUrl} onChange={(value) => update('sourceUrl', value)} />
            <button type="submit" disabled={saving || !form.videoChannelId || !form.videoTitle.trim()} className="pib-btn-primary w-full">{saving ? 'Saving...' : 'Create video project'}</button>
          </form>
        </aside>
      </div>
    </YouTubeStudioWorkspaceShell>
  )
}

function Field({ label, value, onChange, required }: { label: string; value: string; onChange: (value: string) => void; required?: boolean }) {
  return <label className="block text-sm"><span className="text-xs font-label uppercase tracking-widest text-on-surface-variant">{label}</span><input required={required} value={value} onChange={(event) => onChange(event.target.value)} className="mt-1 w-full rounded-lg border border-[var(--color-outline-variant)] bg-[var(--color-surface)] px-3 py-2 text-sm" /></label>
}

function TextArea({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (value: string) => void; placeholder?: string }) {
  return <label className="block text-sm"><span className="text-xs font-label uppercase tracking-widest text-on-surface-variant">{label}</span><textarea value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} rows={3} className="mt-1 w-full rounded-lg border border-[var(--color-outline-variant)] bg-[var(--color-surface)] px-3 py-2 text-sm" /></label>
}

function Select({ label, value, onChange, options }: { label: string; value: string; onChange: (value: string) => void; options: string[] }) {
  return <label className="block text-sm"><span className="text-xs font-label uppercase tracking-widest text-on-surface-variant">{label}</span><select value={value} onChange={(event) => onChange(event.target.value)} className="mt-1 w-full rounded-lg border border-[var(--color-outline-variant)] bg-[var(--color-surface)] px-3 py-2 text-sm">{options.map((option) => <option key={option} value={option}>{option.replace(/_/g, ' ')}</option>)}</select></label>
}
```

- [ ] **Step 7: Create the portal workspace**

Create `components/youtube-studio/YouTubeStudioPortalWorkspace.tsx`:

```tsx
'use client'

import { useEffect, useState } from 'react'
import type { YouTubeChannelWorkspace, YouTubePublishingPacket, YouTubeSeries, YouTubeVideoProject } from '@/lib/youtube-studio/types'
import { YouTubeChannelCard, YouTubeVideoCard } from '@/components/youtube-studio/YouTubeStudioCards'
import { YouTubeStudioWorkspaceShell } from '@/components/youtube-studio/YouTubeStudioWorkspaceShell'

type RequestForm = {
  channelWorkspaceId: string
  title: string
  objective: string
  sourceUrl: string
}

const emptyRequest: RequestForm = {
  channelWorkspaceId: '',
  title: '',
  objective: '',
  sourceUrl: '',
}

export function YouTubeStudioPortalWorkspace() {
  const [channels, setChannels] = useState<YouTubeChannelWorkspace[]>([])
  const [series, setSeries] = useState<YouTubeSeries[]>([])
  const [videos, setVideos] = useState<YouTubeVideoProject[]>([])
  const [packets, setPackets] = useState<YouTubePublishingPacket[]>([])
  const [request, setRequest] = useState<RequestForm>(emptyRequest)
  const [reviewNotes, setReviewNotes] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [notice, setNotice] = useState('')
  const [moduleDisabled, setModuleDisabled] = useState(false)

  async function load() {
    const res = await fetch('/api/v1/portal/youtube-studio')
    const body = await res.json().catch(() => ({}))
    if (!res.ok && body.moduleDisabled === true) {
      setModuleDisabled(true)
      setChannels([])
      setSeries([])
      setVideos([])
      setPackets([])
      setLoading(false)
      return
    }
    setModuleDisabled(false)
    setChannels(Array.isArray(body.data?.channels) ? body.data.channels : [])
    setSeries(Array.isArray(body.data?.series) ? body.data.series : [])
    setVideos(Array.isArray(body.data?.videos) ? body.data.videos : [])
    setPackets(Array.isArray(body.data?.packets) ? body.data.packets : [])
    setLoading(false)
  }

  useEffect(() => {
    void load()
  }, [])

  function update<K extends keyof RequestForm>(field: K, value: RequestForm[K]) {
    setRequest((prev) => ({ ...prev, [field]: value }))
  }

  async function submitRequest(event: React.FormEvent) {
    event.preventDefault()
    if (!request.channelWorkspaceId || !request.title.trim()) return
    const res = await fetch('/api/v1/portal/youtube-studio', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    })
    const body = await res.json().catch(() => ({}))
    if (!res.ok) {
      setNotice(body.error ?? 'Could not submit video request')
      return
    }
    setRequest(emptyRequest)
    setNotice('Video request sent to the PiB team.')
    await load()
  }

  async function saveDecision(videoId: string, decision: 'approved' | 'changes_requested' | 'rejected') {
    const res = await fetch('/api/v1/portal/youtube-studio', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: videoId, decision, notes: reviewNotes[videoId] ?? '' }),
    })
    const body = await res.json().catch(() => ({}))
    if (!res.ok) {
      setNotice(body.error ?? 'Could not save review')
      return
    }
    setNotice('Review saved for the PiB team.')
    await load()
  }

  if (moduleDisabled) {
    return (
      <YouTubeStudioWorkspaceShell
        channels={[]}
        videos={[]}
        series={[]}
        surface="portal"
        eyebrow="Video production"
        title="YouTube Studio"
        description="YouTube production access is controlled by your PiB workspace settings."
        loading={loading}
        className="p-4 sm:p-6 lg:p-8"
      >
        <div className="rounded-2xl border border-[var(--color-pib-line)] bg-[var(--color-pib-card)] p-6 text-sm text-[var(--color-pib-text)]">
          YouTube Studio is not enabled for this portal.
        </div>
      </YouTubeStudioWorkspaceShell>
    )
  }

  return (
    <YouTubeStudioWorkspaceShell
      channels={channels}
      videos={videos}
      series={series}
      surface="portal"
      eyebrow="Video production"
      title="YouTube Studio"
      description="Request videos, review drafts, approve changes, and see the YouTube work PiB is producing for your account."
      notice={notice}
      loading={loading}
      className="p-4 sm:p-6 lg:p-8"
    >
      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <section className="space-y-4">
          {channels.map((channel) => <YouTubeChannelCard key={channel.id ?? channel.title} channel={channel} />)}
          <div className="space-y-3">
            <h2 className="font-headline text-xl font-semibold text-on-surface">Video reviews</h2>
            {videos.length === 0 ? (
              <div className="pib-card-section p-5 text-sm text-on-surface-variant">No YouTube videos yet.</div>
            ) : videos.map((video) => (
              <YouTubeVideoCard key={video.id ?? video.title} video={video}>
                {video.id ? (
                  <div className="w-full space-y-3">
                    <textarea
                      rows={3}
                      value={reviewNotes[video.id] ?? ''}
                      onChange={(event) => setReviewNotes((prev) => ({ ...prev, [video.id!]: event.target.value }))}
                      placeholder="Notes for PiB"
                      className="w-full rounded-xl border border-[var(--color-pib-line)] bg-transparent p-3 text-sm"
                    />
                    <div className="flex flex-wrap gap-2">
                      <button type="button" onClick={() => saveDecision(video.id!, 'approved')} className="pib-btn-primary text-sm">Approve</button>
                      <button type="button" onClick={() => saveDecision(video.id!, 'changes_requested')} className="pib-btn-ghost text-sm">Request changes</button>
                      <button type="button" onClick={() => saveDecision(video.id!, 'rejected')} className="pib-btn-ghost text-sm">Reject</button>
                    </div>
                  </div>
                ) : null}
              </YouTubeVideoCard>
            ))}
            {packets.length > 0 ? (
              <p className="text-xs text-on-surface-variant">{packets.length} publishing packet{packets.length === 1 ? '' : 's'} available for selected reviews.</p>
            ) : null}
          </div>
        </section>

        <form onSubmit={submitRequest} className="pib-card-section h-fit space-y-4 p-5 lg:sticky lg:top-6">
          <h2 className="font-headline font-bold text-on-surface">Request a video</h2>
          <label className="block text-sm">
            <span className="text-xs font-label uppercase tracking-widest text-on-surface-variant">Channel</span>
            <select value={request.channelWorkspaceId} onChange={(event) => update('channelWorkspaceId', event.target.value)} className="mt-1 w-full rounded-lg border border-[var(--color-outline-variant)] bg-[var(--color-surface)] px-3 py-2 text-sm">
              <option value="">Select a channel</option>
              {channels.map((channel) => <option key={channel.id} value={channel.id}>{channel.title}</option>)}
            </select>
          </label>
          <Field label="Video title" value={request.title} onChange={(value) => update('title', value)} required />
          <TextArea label="Objective" value={request.objective} onChange={(value) => update('objective', value)} />
          <Field label="Source URL" value={request.sourceUrl} onChange={(value) => update('sourceUrl', value)} />
          <button type="submit" disabled={!request.channelWorkspaceId || !request.title.trim()} className="pib-btn-primary w-full">Send request</button>
        </form>
      </div>
    </YouTubeStudioWorkspaceShell>
  )
}

function Field({ label, value, onChange, required }: { label: string; value: string; onChange: (value: string) => void; required?: boolean }) {
  return <label className="block text-sm"><span className="text-xs font-label uppercase tracking-widest text-on-surface-variant">{label}</span><input required={required} value={value} onChange={(event) => onChange(event.target.value)} className="mt-1 w-full rounded-lg border border-[var(--color-outline-variant)] bg-[var(--color-surface)] px-3 py-2 text-sm" /></label>
}

function TextArea({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return <label className="block text-sm"><span className="text-xs font-label uppercase tracking-widest text-on-surface-variant">{label}</span><textarea value={value} onChange={(event) => onChange(event.target.value)} rows={3} className="mt-1 w-full rounded-lg border border-[var(--color-outline-variant)] bg-[var(--color-surface)] px-3 py-2 text-sm" /></label>
}
```

- [ ] **Step 8: Create admin and portal route wrappers**

Create `app/(admin)/admin/org/[slug]/youtube-studio/page.tsx`:

```tsx
import { notFound } from 'next/navigation'
import { adminDb } from '@/lib/firebase/admin'
import { YouTubeStudioAdminWorkspace } from '@/components/youtube-studio/YouTubeStudioAdminWorkspace'

export const dynamic = 'force-dynamic'

export default async function AdminOrgYouTubeStudioPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const snap = await adminDb
    .collection('organizations')
    .where('slug', '==', slug)
    .limit(1)
    .get()

  if (snap.empty) notFound()

  const orgDoc = snap.docs[0]
  const org = orgDoc.data() ?? {}
  const orgName = typeof org.name === 'string' && org.name.trim() ? org.name.trim() : slug

  return <YouTubeStudioAdminWorkspace orgId={orgDoc.id} orgName={orgName} />
}
```

Create `app/(portal)/portal/youtube-studio/page.tsx`:

```tsx
import { YouTubeStudioPortalWorkspace } from '@/components/youtube-studio/YouTubeStudioPortalWorkspace'

export const dynamic = 'force-dynamic'

export default function PortalYouTubeStudioPage() {
  return <YouTubeStudioPortalWorkspace />
}
```

- [ ] **Step 9: Run UI tests**

```bash
npm test -- --runInBand __tests__/app/youtube-studio-shared-workspace.test.ts __tests__/app/youtube-studio-portal-module-disabled.test.tsx
```

Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add components/youtube-studio "app/(admin)/admin/org/[slug]/youtube-studio/page.tsx" "app/(portal)/portal/youtube-studio/page.tsx" __tests__/app/youtube-studio-shared-workspace.test.ts __tests__/app/youtube-studio-portal-module-disabled.test.tsx
git commit -m "feat(youtube-studio): add shared workspaces"
```

---

### Task 6: Phase 1 Verification And Documentation

**Files:**
- No planned file edits. If verification exposes a contradiction in the approved spec, stop the implementation run and request a spec revision before changing product scope.

- [ ] **Step 1: Run all focused tests from this plan**

```bash
npm test -- --runInBand \
  __tests__/lib/youtube-studio-sanitize.test.ts \
  __tests__/api/youtube-studio.test.ts \
  __tests__/api/portal-youtube-studio.test.ts \
  __tests__/app/youtube-studio-shared-workspace.test.ts \
  __tests__/app/youtube-studio-portal-module-disabled.test.tsx \
  __tests__/app/admin-org-settings-folder-mappings.test.tsx \
  __tests__/app/portal-layout-mobile-switch.test.tsx
```

Expected: PASS.

- [ ] **Step 2: Run focused lint**

```bash
npx eslint \
  lib/organizations/portal-modules.ts \
  lib/youtube-studio/types.ts \
  lib/youtube-studio/sanitize.ts \
  lib/youtube-studio/api.ts \
  app/api/v1/youtube-studio/channels/route.ts \
  app/api/v1/youtube-studio/channels/[id]/route.ts \
  app/api/v1/youtube-studio/series/route.ts \
  app/api/v1/youtube-studio/videos/route.ts \
  app/api/v1/youtube-studio/videos/[id]/route.ts \
  app/api/v1/youtube-studio/publish-packets/route.ts \
  app/api/v1/portal/youtube-studio/route.ts \
  components/youtube-studio/YouTubeStudioWorkspaceShell.tsx \
  components/youtube-studio/YouTubeStudioCards.tsx \
  components/youtube-studio/YouTubeStudioAdminWorkspace.tsx \
  components/youtube-studio/YouTubeStudioPortalWorkspace.tsx \
  "app/(admin)/admin/org/[slug]/youtube-studio/page.tsx" \
  "app/(portal)/portal/youtube-studio/page.tsx" \
  __tests__/lib/youtube-studio-sanitize.test.ts \
  __tests__/api/youtube-studio.test.ts \
  __tests__/api/portal-youtube-studio.test.ts \
  __tests__/app/youtube-studio-shared-workspace.test.ts \
  __tests__/app/youtube-studio-portal-module-disabled.test.tsx
```

Expected: PASS.

- [ ] **Step 3: Run whitespace check**

```bash
git diff --check
```

Expected: no output.

- [ ] **Step 4: Run build if the focused suite is stable**

```bash
NODE_OPTIONS=--max-old-space-size=8192 npm run build
```

Expected: PASS, allowing the known `/og/default.png` edge/static warning if it still appears.

- [ ] **Step 5: Final commit if verification required fixes**

If Task 6 caused any fixes:

```bash
git add -A
git commit -m "fix(youtube-studio): complete phase 1 verification"
```

- [ ] **Step 6: Push development**

```bash
git push origin development
```

Expected: push succeeds to `origin/development`.

## Self-Review Notes For Implementer

Before reporting completion:

- Confirm `youtubeStudio` defaults to visible in the portal when no setting exists.
- Confirm disabling `settings.portalModules.youtubeStudio` hides portal nav and blocks portal API with `{ moduleDisabled: true, module: 'youtubeStudio' }`.
- Confirm admin routes use `withAuth('admin')` and portal routes use `withPortalAuthAndRole`.
- Confirm no portal response includes `connectedAccountId` or `internalNotes`.
- Confirm public publish/schedule actions do not exist in Phase 1.
- Confirm all new Firestore records include `orgId`, actor fields, timestamps, and `deleted`.
- Confirm the shared workspace is mounted by both admin and portal routes.
- Confirm final response names tests/build actually run and any failures left.

## Plan Self-Review

- **Spec coverage:** This Phase 1 plan covers the approved spec sections for module access, admin/portal shared workspace, channel workspaces, series records, video projects, publishing packet metadata, client request/review, and admin publish-gate groundwork. It intentionally defers Hermes skill execution, YouTube OAuth/upload, analytics import, render/edit adapters, and wider self-service to later phase plans.
- **Placeholder scan:** The plan has no `TBD`, `TODO`, `implement later`, or unbounded "add appropriate handling" instructions. Every implementation task names exact files, commands, and expected results.
- **Type consistency:** The snippets consistently use `YouTubeChannelWorkspace`, `YouTubeSeries`, `YouTubeVideoProject`, `YouTubePublishingPacket`, `YouTubeApprovalPolicy`, `YouTubePublishingPolicy`, `youtubeStudio`, and the Firestore collection constants from `YOUTUBE_COLLECTIONS`.

## Future Plans After Phase 1

- Phase 2: Hermes skill contracts and agent job artifacts.
- Phase 3: YouTube OAuth/private upload adapter.
- Phase 4: analytics snapshots/imports and next-action recommendations.
- Phase 5: wider controlled self-service and generation quotas.
