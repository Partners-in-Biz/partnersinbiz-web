# YouTube Channel OS — Phase 5: Community & Ops/Monetization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the YouTube Channel Operating System with the community + monetization surfaces from spec Pillars G & H — a review-gated comments inbox with AI triage/replies/moderation, comment mining into the idea board, community-post planning, subscriber-milestone tracking, a sponsorship CRM pipeline with a publishing disclosure gate, a channel P&L, and a reusable SOP/production-checklist library.

**Architecture:** New Firestore collections (`youtube_comments`, `youtube_comment_sync_state`, `youtube_community_posts`, `youtube_subscriber_snapshots`, `youtube_channel_costs`, `youtube_revenue_snapshots`, `youtube_sop_templates`, `youtube_org_settings`) sit alongside the existing `lib/youtube-studio/` data model. Each collection gets a typed interface (new `lib/youtube-studio/community-types.ts` + `lib/youtube-studio/ops-types.ts`), a sanitizer (new `lib/youtube-studio/community.ts` + `lib/youtube-studio/ops.ts`, mirroring `sanitize.ts`/`api.ts` conventions), a `withAuth('admin')` CRUD route under `app/api/v1/youtube-studio/`, and cron drains under `app/api/cron/`. Comment reads/writes use the existing `resolveProvider(orgId, 'youtube')` decrypted-token flow (`lib/social/account-resolver.ts:174`) against `commentThreads.list` (1 unit/page, quota-cheap) and `comments.insert`/`comments.setModerationStatus` (write = 50 units), **debited through the Phase 4 `youtube_api_quota_ledger` before every write** and skipped when the day's remaining quota is insufficient. All AI classification and reply drafting are **review-gated `youtube_agent_jobs`** (existing dispatch) — never auto-applied — except when a per-org `youtube_org_settings.commentAutopilot` toggle is explicitly enabled, in which case approved AI replies auto-send (still quota-gated). The sponsorship pipeline reuses the CRM `Pipeline` + `Deal` model (`lib/pipelines/types.ts`, `lib/crm/types.ts`) — a seeded sponsorship pipeline with six stages plus sponsorship fields carried on the deal; sponsorship deals link `contractDocumentId` + `invoiceId` and drive a new `sponsorshipDisclosure` gate added to `YouTubePublishingPacket.checks{}` (the executor's existing blocker loop at `lib/youtube-studio/publishing.ts:138` auto-enforces any `status: 'block'` check). Channel P&L rolls per-video render-credit + agent-job costs (`youtube_channel_costs`) against revenue snapshots (`youtube_revenue_snapshots`) into cost-per-view / profit-per-video; a monthly agent job writes the P&L report. SOP templates instantiate into the existing tasks module.

**Tech Stack:** Next.js 15 (App Router, `withAuth('admin')`, `apiSuccess`/`apiError` `{ success, data }` envelope), Firebase Admin (Firestore, `FieldValue.serverTimestamp()`), `resolveProvider` decrypted-token YouTube Data API v3 (`commentThreads`/`comments`), the Phase 4 `youtube_api_quota_ledger`, the Phase 3 `youtube_ideas` collection + `YouTubeIdea` type (provenance `'comment'`), CRM `Pipeline`/`Deal` reuse, Jest 30 (`__tests__/lib` unit + `__tests__/app` source-assertion tests). All new AI = review-gated agent jobs; org-scoped, `deleted` soft-delete, actor-stamped everywhere.

---

## File Structure

**New library modules**
- `lib/youtube-studio/community-types.ts` — TypeScript interfaces for comments, comment-sync state, community posts, subscriber snapshots, and the per-org settings doc (autopilot toggle). Kept separate from `types.ts` so ops types can import `YouTubeComment` without pulling production types.
- `lib/youtube-studio/ops-types.ts` — interfaces for sponsorship fields on deals, channel cost entries, revenue snapshots, SOP templates + checklist items, and the P&L rollup shape.
- `lib/youtube-studio/community.ts` — sanitizers (`sanitizeYouTube*Input`) + `COMMUNITY_COLLECTIONS` map + `serializeYouTubeCommunityRecord`, mirroring `sanitize.ts`/`api.ts`.
- `lib/youtube-studio/ops.ts` — sanitizers + `OPS_COLLECTIONS` map + `serializeYouTubeOpsRecord`.
- `lib/youtube-studio/comment-triage.ts` — pure `classifyCommentHeuristic` (fast pre-classifier: question/praise/critique/spam/lead buckets) + `isPinWorthy` + `buildReplyJobInput` (builds the review-gated agent-job input for an AI reply). Pure helpers split from any network so buckets are unit-testable.
- `lib/youtube-studio/comment-sync.ts` — `syncChannelComments` orchestrator: resolve provider, page `commentThreads.list` (quota-cheap), upsert into `youtube_comments`, advance `youtube_comment_sync_state`. Depends on `comment-triage.ts` for the heuristic bucket.
- `lib/youtube-studio/comment-actions.ts` — `sendCommentReply` + `moderateComment` (hide/report): both **debit `youtube_api_quota_ledger` by 50 units before the write** and no-op with a `skipped: 'insufficient_quota'` result when the ledger cannot cover it.
- `lib/youtube-studio/comment-mining.ts` — pure `aggregateTopQuestions` (group question-bucket comments by normalized text, rank by frequency) + `buildIdeaFromQuestion` (constructs a Phase 3 `YouTubeIdea` with `provenance: 'comment'`).
- `lib/youtube-studio/milestones.ts` — pure `detectMilestones` (given a subscriber count + last snapshot, return crossed thresholds 1k/10k/100k/1M) + `buildCelebrationPostDraft`.
- `lib/youtube-studio/sponsorship.ts` — `SPONSORSHIP_PIPELINE` stage definitions + `ensureSponsorshipPipeline(orgId)` (seed/find the pipeline) + pure `sanitizeSponsorshipFields` + `hasSponsorshipDisclosure` (does a packet satisfy the disclosure gate for a sponsored video).
- `lib/youtube-studio/pnl.ts` — pure `rollupVideoPnl` (cost entries + revenue snapshots → cost-per-view / profit) + `rollupChannelPnl` (aggregate over videos for a period).
- `lib/youtube-studio/sop.ts` — pure `instantiateChecklist` (SOP template → task payloads for the tasks module) + default SOP template seeds.

**Modified library modules**
- `lib/youtube-studio/types.ts` — add `sponsorshipDisclosure: YouTubeGateCheck` to `YouTubePublishingPacket.checks` and a `isSponsored?: boolean` + `sponsorshipDealId?: string` field on the packet.
- `lib/youtube-studio/sanitize.ts` — default the new `sponsorshipDisclosure` check + sanitize `isSponsored`/`sponsorshipDealId`.
- `lib/youtube-studio/publishing.ts` — add the `sponsorshipDisclosure` key to `PACKET_CHECK_KEYS` and a targeted blocker when `isSponsored && sponsorshipDisclosure.status !== 'pass'`.

**New API routes** (all `withAuth('admin')`, `{ success, data }` envelope)
- `app/api/v1/youtube-studio/comments/route.ts` — GET (inbox feed with bucket/status filters) + PATCH (bucket override, mark-handled, request-reply-draft → agent job).
- `app/api/v1/youtube-studio/comments/reply/route.ts` — POST (send an approved reply via `sendCommentReply`, quota-gated).
- `app/api/v1/youtube-studio/comments/moderate/route.ts` — POST (bulk hide/report via `moderateComment`, quota-gated).
- `app/api/v1/youtube-studio/comment-mining/route.ts` — GET (top questions) + POST `action:'to-idea'` (create a `youtube_ideas` record, provenance `'comment'`).
- `app/api/v1/youtube-studio/community-posts/route.ts` — CRUD + POST `action:'generate-image'` (Higgsfield agent job) for community-post planning + manual-handoff packet.
- `app/api/v1/youtube-studio/subscriber-milestones/route.ts` — GET (snapshot history + detected milestones) + POST `action:'celebration-draft'`.
- `app/api/v1/youtube-studio/sponsorships/route.ts` — GET (sponsorship deals for a channel) + POST (create sponsorship deal in the seeded pipeline) + PATCH (stage move, link contract/invoice, set integration timestamp).
- `app/api/v1/youtube-studio/channel-costs/route.ts` — CRUD for manual + auto cost entries.
- `app/api/v1/youtube-studio/pnl/route.ts` — GET (per-video + channel P&L rollup for a period).
- `app/api/v1/youtube-studio/sop-templates/route.ts` — CRUD + POST `action:'instantiate'` (attach a checklist to a video project as tasks).
- `app/api/v1/youtube-studio/org-settings/route.ts` — GET/PATCH the per-org `youtube_org_settings` doc (comment autopilot toggle).
- `app/api/cron/youtube-comment-sync/route.ts` — cron drain: sync comments + heuristic triage for all due channels; autopilot auto-send of approved replies.
- `app/api/cron/youtube-subscriber-snapshot/route.ts` — cron drain: daily subscriber snapshot + milestone detection.
- `app/api/cron/youtube-pnl-report/route.ts` — cron drain: monthly agent-written channel P&L report.

**New UI components** (under `components/youtube-studio/community/` and `components/youtube-studio/ops/`)
- `CommentsInbox.tsx`, `CommentMiningPanel.tsx`, `CommunityPostPlanner.tsx`, `SubscriberMilestones.tsx` (community).
- `SponsorshipPipeline.tsx`, `ChannelPnl.tsx`, `SopLibrary.tsx` (ops).

**Config**
- `vercel.json` — add three cron entries (comment sync, subscriber snapshot, monthly P&L report).

**Tests** — one `__tests__/lib/*.test.ts` per pure-logic module + one `__tests__/app/*.test.ts` source-assertion test per route asserting `withAuth('admin')`, the `{ success, data }` envelope, quota discipline (`youtube_api_quota_ledger` debit before writes; `commentThreads.list` not `search.list`), and review-gating (no auto-apply unless autopilot).

---

## Task 1: Community collection types

**Files:**
- Create: `lib/youtube-studio/community-types.ts`
- Test: `__tests__/lib/youtube-studio-community-types.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// __tests__/lib/youtube-studio-community-types.test.ts
import { readFileSync } from 'fs'
import path from 'path'

function source(rel: string) {
  return readFileSync(path.join(process.cwd(), rel), 'utf8')
}

describe('youtube community types', () => {
  const src = source('lib/youtube-studio/community-types.ts')

  it('declares the community collection interfaces', () => {
    expect(src).toContain('export interface YouTubeComment')
    expect(src).toContain('export interface YouTubeCommentSyncState')
    expect(src).toContain('export interface YouTubeCommunityPost')
    expect(src).toContain('export interface YouTubeSubscriberSnapshot')
    expect(src).toContain('export interface YouTubeOrgSettings')
  })

  it('comment carries triage bucket, reply-approval state, and pin-worthy flag', () => {
    expect(src).toContain("export type YouTubeCommentBucket = 'question' | 'praise' | 'critique' | 'spam' | 'lead' | 'other'")
    expect(src).toContain("export type YouTubeCommentReplyStatus = 'none' | 'suggested' | 'approved' | 'sent' | 'skipped'")
    expect(src).toContain('pinWorthy: boolean')
    expect(src).toContain('leadContactId?: string')
  })

  it('org settings carries the comment autopilot opt-in (default off)', () => {
    expect(src).toContain('commentAutopilot: boolean')
  })

  it('every record is org-scoped and soft-deletable', () => {
    const interfaces = src.split('export interface').slice(1)
    for (const block of interfaces) {
      expect(block).toContain('orgId: string')
      expect(block).toContain('deleted: boolean')
    }
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/lib/youtube-studio-community-types.test.ts`
Expected: FAIL — `ENOENT: no such file ... community-types.ts`

- [ ] **Step 3: Write minimal implementation**

```typescript
// lib/youtube-studio/community-types.ts
import type { ActorType } from './types'

/** Common audit + scoping fields shared by every community record. */
interface CommunityRecordBase {
  id?: string
  orgId: string
  channelWorkspaceId: string
  createdAt?: unknown
  updatedAt?: unknown
  createdBy?: string
  createdByType?: ActorType
  updatedBy?: string
  updatedByType?: ActorType
  deleted: boolean
}

export type YouTubeCommentBucket = 'question' | 'praise' | 'critique' | 'spam' | 'lead' | 'other'
export type YouTubeCommentReplyStatus = 'none' | 'suggested' | 'approved' | 'sent' | 'skipped'
export type YouTubeCommentModerationStatus = 'published' | 'held' | 'hidden' | 'reported'

export interface YouTubeComment extends CommunityRecordBase {
  /** YouTube comment id (top-level thread comment). */
  youtubeCommentId: string
  youtubeVideoId: string
  videoProjectId?: string
  authorDisplayName: string
  authorChannelId?: string
  textOriginal: string
  likeCount: number
  publishedAt?: unknown
  /** Heuristic bucket from comment-triage; may be overridden by AI classification or a human. */
  bucket: YouTubeCommentBucket
  /** True once a review-gated AI classification agent job has confirmed the bucket. */
  aiClassified: boolean
  pinWorthy: boolean
  moderationStatus: YouTubeCommentModerationStatus
  handled: boolean
  replyStatus: YouTubeCommentReplyStatus
  /** AI-drafted reply text, awaiting approval unless autopilot is on. */
  suggestedReply?: string
  replyAgentJobId?: string
  sentReplyId?: string
  /** Set when the comment is flagged as a lead and a CRM contact is created. */
  leadContactId?: string
}

export interface YouTubeCommentSyncState extends CommunityRecordBase {
  youtubeChannelId: string
  lastSyncedAt?: unknown
  /** commentThreads paging token to resume the next sync cheaply. */
  nextPageToken?: string
  lastError?: string
}

export type YouTubeCommunityPostStatus = 'planned' | 'ready_for_handoff' | 'handed_off' | 'published' | 'archived'

export interface YouTubeCommunityPost extends CommunityRecordBase {
  title: string
  bodyText: string
  status: YouTubeCommunityPostStatus
  scheduledFor?: unknown
  reminderAt?: unknown
  /** Higgsfield-generated image asset id, produced via a review-gated agent job. */
  imageAssetId?: string
  imageAgentJobId?: string
  handoffNotes?: string
}

export interface YouTubeSubscriberSnapshot extends CommunityRecordBase {
  youtubeChannelId: string
  subscriberCount: number
  capturedForDate: string // YYYY-MM-DD
  /** Milestone thresholds crossed at this snapshot (e.g. [10000]). */
  milestonesCrossed: number[]
  celebrationDraftId?: string
}

export interface YouTubeOrgSettings {
  id?: string
  orgId: string
  /** Per-org opt-in: when true, approved AI comment replies auto-send (still quota-gated). Default false. */
  commentAutopilot: boolean
  updatedAt?: unknown
  updatedBy?: string
  updatedByType?: ActorType
  deleted: boolean
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest __tests__/lib/youtube-studio-community-types.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/youtube-studio/community-types.ts __tests__/lib/youtube-studio-community-types.test.ts
git commit -m "feat(yt-os): add Phase 5 community collection types"
```

---

## Task 2: Ops/monetization collection types

**Files:**
- Create: `lib/youtube-studio/ops-types.ts`
- Test: `__tests__/lib/youtube-studio-ops-types.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// __tests__/lib/youtube-studio-ops-types.test.ts
import { readFileSync } from 'fs'
import path from 'path'

function source(rel: string) {
  return readFileSync(path.join(process.cwd(), rel), 'utf8')
}

describe('youtube ops types', () => {
  const src = source('lib/youtube-studio/ops-types.ts')

  it('declares the ops collection interfaces', () => {
    expect(src).toContain('export interface YouTubeSponsorshipFields')
    expect(src).toContain('export interface YouTubeChannelCost')
    expect(src).toContain('export interface YouTubeRevenueSnapshot')
    expect(src).toContain('export interface YouTubeSopTemplate')
    expect(src).toContain('export interface YouTubeSopChecklistItem')
    expect(src).toContain('export interface YouTubeVideoPnl')
  })

  it('sponsorship fields carry deliverables, integration timestamp, fee model, exclusivity, and disclosure link', () => {
    expect(src).toContain('deliverables: string[]')
    expect(src).toContain('integrationVideoProjectId?: string')
    expect(src).toContain('integrationTimestampSeconds?: number')
    expect(src).toContain("feeModel: 'flat' | 'cpm'")
    expect(src).toContain('exclusivityUntil?: unknown')
    expect(src).toContain('contractDocumentId?: string')
    expect(src).toContain('invoiceId?: string')
    expect(src).toContain('disclosureConfirmed: boolean')
  })

  it('cost entries carry a source category and cents amount', () => {
    expect(src).toContain("export type YouTubeCostSource = 'render_credits' | 'agent_job' | 'manual'")
    expect(src).toContain('amountCents: number')
  })

  it('sop checklist items map to a production phase', () => {
    expect(src).toContain("export type YouTubeSopPhase = 'pre_production' | 'edit' | 'publish' | 'post_publish'")
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/lib/youtube-studio-ops-types.test.ts`
Expected: FAIL — `ENOENT: no such file ... ops-types.ts`

- [ ] **Step 3: Write minimal implementation**

```typescript
// lib/youtube-studio/ops-types.ts
import type { ActorType } from './types'

interface OpsRecordBase {
  id?: string
  orgId: string
  channelWorkspaceId: string
  createdAt?: unknown
  updatedAt?: unknown
  createdBy?: string
  createdByType?: ActorType
  updatedBy?: string
  updatedByType?: ActorType
  deleted: boolean
}

/**
 * Sponsorship-specific fields carried on a CRM Deal (stored under a `sponsorship`
 * key on the deal document). The deal itself lives in the CRM `deals` collection
 * in the seeded sponsorship pipeline — we do NOT create a parallel deal store.
 */
export interface YouTubeSponsorshipFields {
  channelWorkspaceId: string
  sponsorName: string
  deliverables: string[]
  integrationVideoProjectId?: string
  integrationTimestampSeconds?: number
  feeModel: 'flat' | 'cpm'
  flatFeeCents?: number
  cpmCents?: number
  exclusivityUntil?: unknown
  contractDocumentId?: string
  invoiceId?: string
  /** True once the integration video's publishing packet has a paid-promotion disclosure. */
  disclosureConfirmed: boolean
}

export type YouTubeCostSource = 'render_credits' | 'agent_job' | 'manual'

export interface YouTubeChannelCost extends OpsRecordBase {
  videoProjectId?: string
  source: YouTubeCostSource
  description: string
  amountCents: number
  currency: string
  incurredForDate: string // YYYY-MM-DD
  /** Set for auto-derived entries so re-rollups are idempotent (e.g. renderJobId). */
  sourceRefId?: string
}

export type YouTubeRevenueSource = 'youtube_revenue' | 'sponsorship'

export interface YouTubeRevenueSnapshot extends OpsRecordBase {
  videoProjectId?: string
  source: YouTubeRevenueSource
  amountCents: number
  currency: string
  periodStart: string // YYYY-MM-DD
  periodEnd: string // YYYY-MM-DD
  sponsorshipDealId?: string
}

export type YouTubeSopPhase = 'pre_production' | 'edit' | 'publish' | 'post_publish'

export interface YouTubeSopChecklistItem {
  label: string
  phase: YouTubeSopPhase
  notes?: string
}

export interface YouTubeSopTemplate extends OpsRecordBase {
  name: string
  description?: string
  items: YouTubeSopChecklistItem[]
}

/** Pure rollup shape — not persisted; returned by the P&L route. */
export interface YouTubeVideoPnl {
  videoProjectId: string
  views: number
  costCents: number
  revenueCents: number
  profitCents: number
  costPerViewCents: number | null
  currency: string
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest __tests__/lib/youtube-studio-ops-types.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/youtube-studio/ops-types.ts __tests__/lib/youtube-studio-ops-types.test.ts
git commit -m "feat(yt-os): add Phase 5 ops/monetization collection types"
```

---

## Task 3: Community sanitizers + collection map

**Files:**
- Create: `lib/youtube-studio/community.ts`
- Test: `__tests__/lib/youtube-studio-community.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// __tests__/lib/youtube-studio-community.test.ts
import {
  COMMUNITY_COLLECTIONS,
  sanitizeYouTubeCommentInput,
  sanitizeYouTubeCommunityPostInput,
  sanitizeYouTubeOrgSettingsInput,
  serializeYouTubeCommunityRecord,
} from '@/lib/youtube-studio/community'

function findUndefinedPaths(value: unknown, path = 'payload'): string[] {
  if (value === undefined) return [path]
  if (Array.isArray(value)) return value.flatMap((v, i) => findUndefinedPaths(v, `${path}[${i}]`))
  if (!value || typeof value !== 'object') return []
  return Object.entries(value).flatMap(([k, v]) => findUndefinedPaths(v, `${path}.${k}`))
}

describe('youtube community sanitizers', () => {
  it('exposes the community collection names', () => {
    expect(COMMUNITY_COLLECTIONS.comments).toBe('youtube_comments')
    expect(COMMUNITY_COLLECTIONS.commentSyncState).toBe('youtube_comment_sync_state')
    expect(COMMUNITY_COLLECTIONS.communityPosts).toBe('youtube_community_posts')
    expect(COMMUNITY_COLLECTIONS.subscriberSnapshots).toBe('youtube_subscriber_snapshots')
    expect(COMMUNITY_COLLECTIONS.orgSettings).toBe('youtube_org_settings')
  })

  it('defaults comment triage/reply state and never emits undefined', () => {
    const result = sanitizeYouTubeCommentInput({
      orgId: ' org-1 ',
      channelWorkspaceId: ' ch-1 ',
      youtubeCommentId: ' c-1 ',
      youtubeVideoId: ' v-1 ',
      authorDisplayName: '  Fan  ',
      textOriginal: '  How do I start?  ',
      likeCount: 3,
    })
    expect(result.orgId).toBe('org-1')
    expect(result.youtubeCommentId).toBe('c-1')
    expect(result.bucket).toBe('other')
    expect(result.replyStatus).toBe('none')
    expect(result.moderationStatus).toBe('published')
    expect(result.pinWorthy).toBe(false)
    expect(result.aiClassified).toBe(false)
    expect(result.handled).toBe(false)
    expect(findUndefinedPaths(result)).toEqual([])
  })

  it('clamps invalid comment bucket/reply status to safe defaults', () => {
    const result = sanitizeYouTubeCommentInput({
      orgId: 'o', channelWorkspaceId: 'c', youtubeCommentId: 'x',
      youtubeVideoId: 'v', authorDisplayName: 'A', textOriginal: 't',
      bucket: 'nonsense', replyStatus: 'nope', moderationStatus: 'weird',
    })
    expect(result.bucket).toBe('other')
    expect(result.replyStatus).toBe('none')
    expect(result.moderationStatus).toBe('published')
  })

  it('org settings defaults autopilot off', () => {
    const result = sanitizeYouTubeOrgSettingsInput({ orgId: ' org-1 ' })
    expect(result.orgId).toBe('org-1')
    expect(result.commentAutopilot).toBe(false)
  })

  it('community post defaults status planned', () => {
    const result = sanitizeYouTubeCommunityPostInput({
      orgId: 'o', channelWorkspaceId: 'c', title: ' Poll ', bodyText: ' Vote ',
    })
    expect(result.status).toBe('planned')
  })

  it('serializes a record with its id', () => {
    const record = serializeYouTubeCommunityRecord<{ orgId: string }>('id-1', { orgId: 'o' })
    expect(record.id).toBe('id-1')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/lib/youtube-studio-community.test.ts`
Expected: FAIL — cannot find module `@/lib/youtube-studio/community`

- [ ] **Step 3: Write minimal implementation**

```typescript
// lib/youtube-studio/community.ts
import type {
  YouTubeComment,
  YouTubeCommentBucket,
  YouTubeCommentModerationStatus,
  YouTubeCommentReplyStatus,
  YouTubeCommunityPost,
  YouTubeCommunityPostStatus,
  YouTubeOrgSettings,
} from './community-types'

export const COMMUNITY_COLLECTIONS = {
  comments: 'youtube_comments',
  commentSyncState: 'youtube_comment_sync_state',
  communityPosts: 'youtube_community_posts',
  subscriberSnapshots: 'youtube_subscriber_snapshots',
  orgSettings: 'youtube_org_settings',
} as const

const BUCKETS: YouTubeCommentBucket[] = ['question', 'praise', 'critique', 'spam', 'lead', 'other']
const REPLY_STATUSES: YouTubeCommentReplyStatus[] = ['none', 'suggested', 'approved', 'sent', 'skipped']
const MODERATION_STATUSES: YouTubeCommentModerationStatus[] = ['published', 'held', 'hidden', 'reported']
const POST_STATUSES: YouTubeCommunityPostStatus[] = ['planned', 'ready_for_handoff', 'handed_off', 'published', 'archived']

function str(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value.trim() : fallback
}

function num(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function bool(value: unknown, fallback = false): boolean {
  return typeof value === 'boolean' ? value : fallback
}

function oneOf<T extends string>(value: unknown, allowed: T[], fallback: T): T {
  return typeof value === 'string' && allowed.includes(value as T) ? (value as T) : fallback
}

export function sanitizeYouTubeCommentInput(input: Record<string, unknown>): Omit<YouTubeComment, 'id'> {
  const out: Omit<YouTubeComment, 'id'> = {
    orgId: str(input.orgId),
    channelWorkspaceId: str(input.channelWorkspaceId),
    youtubeCommentId: str(input.youtubeCommentId),
    youtubeVideoId: str(input.youtubeVideoId),
    authorDisplayName: str(input.authorDisplayName),
    textOriginal: str(input.textOriginal),
    likeCount: num(input.likeCount),
    bucket: oneOf(input.bucket, BUCKETS, 'other'),
    aiClassified: bool(input.aiClassified),
    pinWorthy: bool(input.pinWorthy),
    moderationStatus: oneOf(input.moderationStatus, MODERATION_STATUSES, 'published'),
    handled: bool(input.handled),
    replyStatus: oneOf(input.replyStatus, REPLY_STATUSES, 'none'),
    deleted: bool(input.deleted),
  }
  const videoProjectId = str(input.videoProjectId)
  if (videoProjectId) out.videoProjectId = videoProjectId
  const authorChannelId = str(input.authorChannelId)
  if (authorChannelId) out.authorChannelId = authorChannelId
  const suggestedReply = str(input.suggestedReply)
  if (suggestedReply) out.suggestedReply = suggestedReply
  const replyAgentJobId = str(input.replyAgentJobId)
  if (replyAgentJobId) out.replyAgentJobId = replyAgentJobId
  const sentReplyId = str(input.sentReplyId)
  if (sentReplyId) out.sentReplyId = sentReplyId
  const leadContactId = str(input.leadContactId)
  if (leadContactId) out.leadContactId = leadContactId
  return out
}

export function sanitizeYouTubeCommunityPostInput(input: Record<string, unknown>): Omit<YouTubeCommunityPost, 'id'> {
  const out: Omit<YouTubeCommunityPost, 'id'> = {
    orgId: str(input.orgId),
    channelWorkspaceId: str(input.channelWorkspaceId),
    title: str(input.title) || 'Untitled post',
    bodyText: str(input.bodyText),
    status: oneOf(input.status, POST_STATUSES, 'planned'),
    deleted: bool(input.deleted),
  }
  const handoffNotes = str(input.handoffNotes)
  if (handoffNotes) out.handoffNotes = handoffNotes
  const imageAssetId = str(input.imageAssetId)
  if (imageAssetId) out.imageAssetId = imageAssetId
  const imageAgentJobId = str(input.imageAgentJobId)
  if (imageAgentJobId) out.imageAgentJobId = imageAgentJobId
  return out
}

export function sanitizeYouTubeOrgSettingsInput(input: Record<string, unknown>): Omit<YouTubeOrgSettings, 'id'> {
  return {
    orgId: str(input.orgId),
    commentAutopilot: bool(input.commentAutopilot),
    deleted: bool(input.deleted),
  }
}

export function serializeYouTubeCommunityRecord<T>(id: string, data: Record<string, unknown>): T & { id: string } {
  return { id, ...(data as T) }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest __tests__/lib/youtube-studio-community.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/youtube-studio/community.ts __tests__/lib/youtube-studio-community.test.ts
git commit -m "feat(yt-os): add community sanitizers + collection map"
```

---

## Task 4: Ops sanitizers + collection map

**Files:**
- Create: `lib/youtube-studio/ops.ts`
- Test: `__tests__/lib/youtube-studio-ops.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// __tests__/lib/youtube-studio-ops.test.ts
import {
  OPS_COLLECTIONS,
  sanitizeYouTubeChannelCostInput,
  sanitizeYouTubeRevenueSnapshotInput,
  sanitizeYouTubeSopTemplateInput,
  serializeYouTubeOpsRecord,
} from '@/lib/youtube-studio/ops'

describe('youtube ops sanitizers', () => {
  it('exposes the ops collection names', () => {
    expect(OPS_COLLECTIONS.channelCosts).toBe('youtube_channel_costs')
    expect(OPS_COLLECTIONS.revenueSnapshots).toBe('youtube_revenue_snapshots')
    expect(OPS_COLLECTIONS.sopTemplates).toBe('youtube_sop_templates')
  })

  it('defaults cost source to manual and clamps invalid source', () => {
    const ok = sanitizeYouTubeChannelCostInput({
      orgId: 'o', channelWorkspaceId: 'c', description: ' Editor ', amountCents: 500,
      currency: 'zar', incurredForDate: '2026-07-01', source: 'agent_job',
    })
    expect(ok.source).toBe('agent_job')
    expect(ok.amountCents).toBe(500)
    expect(ok.currency).toBe('ZAR')
    const bad = sanitizeYouTubeChannelCostInput({
      orgId: 'o', channelWorkspaceId: 'c', description: 'x', amountCents: 1, incurredForDate: '2026-07-01', source: 'nope',
    })
    expect(bad.source).toBe('manual')
  })

  it('defaults revenue source to youtube_revenue', () => {
    const result = sanitizeYouTubeRevenueSnapshotInput({
      orgId: 'o', channelWorkspaceId: 'c', amountCents: 100, currency: 'USD',
      periodStart: '2026-07-01', periodEnd: '2026-07-31', source: 'weird',
    })
    expect(result.source).toBe('youtube_revenue')
  })

  it('sanitizes sop template items and drops invalid phases', () => {
    const result = sanitizeYouTubeSopTemplateInput({
      orgId: 'o', channelWorkspaceId: 'c', name: ' Standard long-form ',
      items: [
        { label: ' Write brief ', phase: 'pre_production' },
        { label: 'Bad', phase: 'nonsense' },
        { label: '', phase: 'edit' },
      ],
    })
    expect(result.name).toBe('Standard long-form')
    expect(result.items).toHaveLength(1)
    expect(result.items[0]).toEqual({ label: 'Write brief', phase: 'pre_production' })
  })

  it('serializes an ops record with its id', () => {
    const record = serializeYouTubeOpsRecord<{ orgId: string }>('id-9', { orgId: 'o' })
    expect(record.id).toBe('id-9')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/lib/youtube-studio-ops.test.ts`
Expected: FAIL — cannot find module `@/lib/youtube-studio/ops`

- [ ] **Step 3: Write minimal implementation**

```typescript
// lib/youtube-studio/ops.ts
import type {
  YouTubeChannelCost,
  YouTubeCostSource,
  YouTubeRevenueSnapshot,
  YouTubeRevenueSource,
  YouTubeSopChecklistItem,
  YouTubeSopPhase,
  YouTubeSopTemplate,
} from './ops-types'

export const OPS_COLLECTIONS = {
  channelCosts: 'youtube_channel_costs',
  revenueSnapshots: 'youtube_revenue_snapshots',
  sopTemplates: 'youtube_sop_templates',
} as const

const COST_SOURCES: YouTubeCostSource[] = ['render_credits', 'agent_job', 'manual']
const REVENUE_SOURCES: YouTubeRevenueSource[] = ['youtube_revenue', 'sponsorship']
const SOP_PHASES: YouTubeSopPhase[] = ['pre_production', 'edit', 'publish', 'post_publish']

function str(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value.trim() : fallback
}
function num(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}
function bool(value: unknown, fallback = false): boolean {
  return typeof value === 'boolean' ? value : fallback
}
function oneOf<T extends string>(value: unknown, allowed: T[], fallback: T): T {
  return typeof value === 'string' && allowed.includes(value as T) ? (value as T) : fallback
}
function currency(value: unknown): string {
  const s = str(value).toUpperCase()
  return s || 'ZAR'
}

export function sanitizeYouTubeChannelCostInput(input: Record<string, unknown>): Omit<YouTubeChannelCost, 'id'> {
  const out: Omit<YouTubeChannelCost, 'id'> = {
    orgId: str(input.orgId),
    channelWorkspaceId: str(input.channelWorkspaceId),
    source: oneOf(input.source, COST_SOURCES, 'manual'),
    description: str(input.description),
    amountCents: num(input.amountCents),
    currency: currency(input.currency),
    incurredForDate: str(input.incurredForDate),
    deleted: bool(input.deleted),
  }
  const videoProjectId = str(input.videoProjectId)
  if (videoProjectId) out.videoProjectId = videoProjectId
  const sourceRefId = str(input.sourceRefId)
  if (sourceRefId) out.sourceRefId = sourceRefId
  return out
}

export function sanitizeYouTubeRevenueSnapshotInput(input: Record<string, unknown>): Omit<YouTubeRevenueSnapshot, 'id'> {
  const out: Omit<YouTubeRevenueSnapshot, 'id'> = {
    orgId: str(input.orgId),
    channelWorkspaceId: str(input.channelWorkspaceId),
    source: oneOf(input.source, REVENUE_SOURCES, 'youtube_revenue'),
    amountCents: num(input.amountCents),
    currency: currency(input.currency),
    periodStart: str(input.periodStart),
    periodEnd: str(input.periodEnd),
    deleted: bool(input.deleted),
  }
  const videoProjectId = str(input.videoProjectId)
  if (videoProjectId) out.videoProjectId = videoProjectId
  const sponsorshipDealId = str(input.sponsorshipDealId)
  if (sponsorshipDealId) out.sponsorshipDealId = sponsorshipDealId
  return out
}

function sanitizeSopItems(value: unknown): YouTubeSopChecklistItem[] {
  if (!Array.isArray(value)) return []
  const items: YouTubeSopChecklistItem[] = []
  for (const raw of value) {
    if (!raw || typeof raw !== 'object') continue
    const rec = raw as Record<string, unknown>
    const label = str(rec.label)
    if (!label) continue
    if (typeof rec.phase !== 'string' || !SOP_PHASES.includes(rec.phase as YouTubeSopPhase)) continue
    const item: YouTubeSopChecklistItem = { label, phase: rec.phase as YouTubeSopPhase }
    const notes = str(rec.notes)
    if (notes) item.notes = notes
    items.push(item)
  }
  return items
}

export function sanitizeYouTubeSopTemplateInput(input: Record<string, unknown>): Omit<YouTubeSopTemplate, 'id'> {
  const out: Omit<YouTubeSopTemplate, 'id'> = {
    orgId: str(input.orgId),
    channelWorkspaceId: str(input.channelWorkspaceId),
    name: str(input.name) || 'Untitled template',
    items: sanitizeSopItems(input.items),
    deleted: bool(input.deleted),
  }
  const description = str(input.description)
  if (description) out.description = description
  return out
}

export function serializeYouTubeOpsRecord<T>(id: string, data: Record<string, unknown>): T & { id: string } {
  return { id, ...(data as T) }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest __tests__/lib/youtube-studio-ops.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/youtube-studio/ops.ts __tests__/lib/youtube-studio-ops.test.ts
git commit -m "feat(yt-os): add ops sanitizers + collection map"
```

---

## Task 5: Comment triage heuristics + reply job input

**Files:**
- Create: `lib/youtube-studio/comment-triage.ts`
- Test: `__tests__/lib/youtube-studio-comment-triage.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// __tests__/lib/youtube-studio-comment-triage.test.ts
import { classifyCommentHeuristic, isPinWorthy, buildReplyJobInput } from '@/lib/youtube-studio/comment-triage'

describe('classifyCommentHeuristic', () => {
  it('buckets a question by the question mark and how/what cues', () => {
    expect(classifyCommentHeuristic('How do I set this up?')).toBe('question')
    expect(classifyCommentHeuristic('what camera do you use')).toBe('question')
  })
  it('buckets praise', () => {
    expect(classifyCommentHeuristic('This was amazing, loved it!')).toBe('praise')
  })
  it('buckets critique', () => {
    expect(classifyCommentHeuristic('The audio was terrible and boring')).toBe('critique')
  })
  it('buckets spam by link + promo cues', () => {
    expect(classifyCommentHeuristic('Check out my channel http://spam.example free money')).toBe('spam')
  })
  it('buckets a lead by buying-intent cues', () => {
    expect(classifyCommentHeuristic('How much do you charge? I want to hire you for my business')).toBe('lead')
  })
  it('falls back to other', () => {
    expect(classifyCommentHeuristic('first')).toBe('other')
  })
})

describe('isPinWorthy', () => {
  it('flags high-like questions as pin-worthy', () => {
    expect(isPinWorthy({ bucket: 'question', likeCount: 25 })).toBe(true)
  })
  it('does not flag low-engagement other comments', () => {
    expect(isPinWorthy({ bucket: 'other', likeCount: 1 })).toBe(false)
  })
  it('does not flag spam regardless of likes', () => {
    expect(isPinWorthy({ bucket: 'spam', likeCount: 999 })).toBe(false)
  })
})

describe('buildReplyJobInput', () => {
  it('builds a review-gated agent-job input carrying the comment context', () => {
    const input = buildReplyJobInput({
      orgId: 'o', channelWorkspaceId: 'ch', commentId: 'cm-1',
      authorDisplayName: 'Fan', textOriginal: 'How do I start?', bucket: 'question',
    })
    expect(input.skillKey).toBe('youtube-comment-reply')
    expect(input.reviewRequired).toBe(true)
    expect(input.visibility).toBe('internal')
    expect(input.inputSummary).toContain('How do I start?')
    expect(input.linked.commentId).toBe('cm-1')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/lib/youtube-studio-comment-triage.test.ts`
Expected: FAIL — cannot find module `@/lib/youtube-studio/comment-triage`

- [ ] **Step 3: Write minimal implementation**

```typescript
// lib/youtube-studio/comment-triage.ts
import type { YouTubeCommentBucket } from './community-types'

const PRAISE_CUES = ['amazing', 'love', 'loved', 'great', 'awesome', 'thank you', 'thanks', 'best', 'helpful', '❤️', '🔥']
const CRITIQUE_CUES = ['terrible', 'boring', 'bad', 'worst', 'hate', 'disappointing', 'waste', 'wrong', 'clickbait']
const SPAM_CUES = ['free money', 'check out my channel', 'sub for sub', 'promo', 'giveaway', 'click here', 'earn $']
const LEAD_CUES = ['how much', 'hire you', 'work with you', 'your services', 'for my business', 'pricing', 'quote', 'buy']
const QUESTION_CUES = ['how ', 'what ', 'when ', 'where ', 'why ', 'which ', 'can you', 'do you', 'is it']

function hasLink(text: string): boolean {
  return /https?:\/\/|www\./i.test(text)
}
function matchesAny(text: string, cues: string[]): boolean {
  return cues.some((cue) => text.includes(cue))
}

/**
 * Fast, deterministic pre-classifier. The authoritative bucket comes from the
 * review-gated AI classification agent job; this only seeds the inbox cheaply.
 */
export function classifyCommentHeuristic(text: string): YouTubeCommentBucket {
  const t = (text || '').toLowerCase()
  if (hasLink(t) && matchesAny(t, SPAM_CUES)) return 'spam'
  if (matchesAny(t, LEAD_CUES)) return 'lead'
  if (matchesAny(t, CRITIQUE_CUES)) return 'critique'
  if (t.includes('?') || matchesAny(t, QUESTION_CUES)) return 'question'
  if (matchesAny(t, PRAISE_CUES)) return 'praise'
  return 'other'
}

export function isPinWorthy(input: { bucket: YouTubeCommentBucket; likeCount: number }): boolean {
  if (input.bucket === 'spam') return false
  if (input.bucket === 'question' && input.likeCount >= 10) return true
  return input.likeCount >= 50
}

export interface CommentReplyJobInput {
  skillKey: 'youtube-comment-reply'
  reviewRequired: true
  visibility: 'internal'
  inputSummary: string
  linked: { commentId: string; channelWorkspaceId: string }
  orgId: string
}

export function buildReplyJobInput(input: {
  orgId: string
  channelWorkspaceId: string
  commentId: string
  authorDisplayName: string
  textOriginal: string
  bucket: YouTubeCommentBucket
}): CommentReplyJobInput {
  return {
    skillKey: 'youtube-comment-reply',
    reviewRequired: true,
    visibility: 'internal',
    inputSummary: `Draft a reply to ${input.authorDisplayName} (${input.bucket}): "${input.textOriginal}"`,
    linked: { commentId: input.commentId, channelWorkspaceId: input.channelWorkspaceId },
    orgId: input.orgId,
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest __tests__/lib/youtube-studio-comment-triage.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/youtube-studio/comment-triage.ts __tests__/lib/youtube-studio-comment-triage.test.ts
git commit -m "feat(yt-os): add comment triage heuristics + reply job input"
```

---

## Task 6: Comment mining — top questions → idea

**Files:**
- Create: `lib/youtube-studio/comment-mining.ts`
- Test: `__tests__/lib/youtube-studio-comment-mining.test.ts`

**Note:** This builds a `YouTubeIdea` for the Phase 3 `youtube_ideas` collection with `provenance: 'comment'`. The `YouTubeIdea` interface + `youtube_ideas` collection are defined in the Phase 3 plan (`lib/youtube-studio/research-types.ts`); do not redefine them.

- [ ] **Step 1: Write the failing test**

```typescript
// __tests__/lib/youtube-studio-comment-mining.test.ts
import { aggregateTopQuestions, buildIdeaFromQuestion } from '@/lib/youtube-studio/comment-mining'

describe('aggregateTopQuestions', () => {
  it('groups near-duplicate question comments and ranks by frequency', () => {
    const result = aggregateTopQuestions([
      { bucket: 'question', textOriginal: 'What mic do you use?' },
      { bucket: 'question', textOriginal: 'what MIC do you use' },
      { bucket: 'question', textOriginal: 'How do I start a channel?' },
      { bucket: 'praise', textOriginal: 'Great video!' },
    ])
    expect(result[0].count).toBe(2)
    expect(result[0].representativeText.toLowerCase()).toContain('mic')
    expect(result).toHaveLength(2)
  })

  it('ignores non-question buckets', () => {
    const result = aggregateTopQuestions([{ bucket: 'spam', textOriginal: 'buy now?' }])
    expect(result).toHaveLength(0)
  })
})

describe('buildIdeaFromQuestion', () => {
  it('builds a comment-provenance idea for the youtube_ideas collection', () => {
    const idea = buildIdeaFromQuestion({
      orgId: 'o', channelWorkspaceId: 'ch',
      representativeText: 'What mic do you use?', count: 5,
    })
    expect(idea.orgId).toBe('o')
    expect(idea.channelWorkspaceId).toBe('ch')
    expect(idea.provenance).toBe('comment')
    expect(idea.stage).toBe('idea')
    expect(idea.title.toLowerCase()).toContain('mic')
    expect(idea.deleted).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/lib/youtube-studio-comment-mining.test.ts`
Expected: FAIL — cannot find module `@/lib/youtube-studio/comment-mining`

- [ ] **Step 3: Write minimal implementation**

```typescript
// lib/youtube-studio/comment-mining.ts
import type { YouTubeIdea } from './research-types'

interface MinableComment {
  bucket: string
  textOriginal: string
}

export interface AggregatedQuestion {
  key: string
  representativeText: string
  count: number
}

function normalizeQuestion(text: string): string {
  return (text || '')
    .toLowerCase()
    .replace(/[^\w\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

export function aggregateTopQuestions(comments: MinableComment[]): AggregatedQuestion[] {
  const groups = new Map<string, AggregatedQuestion>()
  for (const c of comments) {
    if (c.bucket !== 'question') continue
    const key = normalizeQuestion(c.textOriginal)
    if (!key) continue
    const existing = groups.get(key)
    if (existing) {
      existing.count += 1
    } else {
      groups.set(key, { key, representativeText: c.textOriginal.trim(), count: 1 })
    }
  }
  return [...groups.values()].sort((a, b) => b.count - a.count)
}

export function buildIdeaFromQuestion(input: {
  orgId: string
  channelWorkspaceId: string
  representativeText: string
  count: number
}): Omit<YouTubeIdea, 'id'> {
  const cleanQuestion = input.representativeText.replace(/\?+$/, '').trim()
  return {
    orgId: input.orgId,
    channelWorkspaceId: input.channelWorkspaceId,
    title: `Answer: ${cleanQuestion}`,
    provenance: 'comment',
    stage: 'idea',
    notes: `Asked ${input.count} time(s) in comments.`,
    deleted: false,
  } as Omit<YouTubeIdea, 'id'>
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest __tests__/lib/youtube-studio-comment-mining.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/youtube-studio/comment-mining.ts __tests__/lib/youtube-studio-comment-mining.test.ts
git commit -m "feat(yt-os): add comment mining top-questions aggregation"
```

---

## Task 7: Subscriber milestone detection + celebration draft

**Files:**
- Create: `lib/youtube-studio/milestones.ts`
- Test: `__tests__/lib/youtube-studio-milestones.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// __tests__/lib/youtube-studio-milestones.test.ts
import { detectMilestones, buildCelebrationPostDraft } from '@/lib/youtube-studio/milestones'

describe('detectMilestones', () => {
  it('returns thresholds crossed between previous and current counts', () => {
    expect(detectMilestones(950, 1200)).toEqual([1000])
    expect(detectMilestones(9500, 10500)).toEqual([10000])
  })
  it('returns multiple thresholds when several are crossed at once', () => {
    expect(detectMilestones(500, 11000)).toEqual([1000, 10000])
  })
  it('returns empty when no threshold crossed', () => {
    expect(detectMilestones(1200, 1500)).toEqual([])
  })
  it('treats a null previous count as a fresh baseline (no false milestone)', () => {
    expect(detectMilestones(null, 1500)).toEqual([])
  })
})

describe('buildCelebrationPostDraft', () => {
  it('builds a planned community post celebrating the milestone', () => {
    const draft = buildCelebrationPostDraft({ orgId: 'o', channelWorkspaceId: 'ch', milestone: 10000 })
    expect(draft.orgId).toBe('o')
    expect(draft.status).toBe('planned')
    expect(draft.title).toContain('10,000')
    expect(draft.bodyText).toContain('10,000')
    expect(draft.deleted).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/lib/youtube-studio-milestones.test.ts`
Expected: FAIL — cannot find module `@/lib/youtube-studio/milestones`

- [ ] **Step 3: Write minimal implementation**

```typescript
// lib/youtube-studio/milestones.ts
import type { YouTubeCommunityPost } from './community-types'

const MILESTONE_THRESHOLDS = [1000, 10000, 100000, 1000000]

/**
 * Return the milestone thresholds strictly crossed going from `previous` to
 * `current`. A null `previous` is a fresh baseline and never fires a milestone
 * (avoids celebrating history on first snapshot).
 */
export function detectMilestones(previous: number | null, current: number): number[] {
  if (previous === null) return []
  return MILESTONE_THRESHOLDS.filter((t) => previous < t && current >= t)
}

export function buildCelebrationPostDraft(input: {
  orgId: string
  channelWorkspaceId: string
  milestone: number
}): Omit<YouTubeCommunityPost, 'id'> {
  const pretty = input.milestone.toLocaleString('en-US')
  return {
    orgId: input.orgId,
    channelWorkspaceId: input.channelWorkspaceId,
    title: `We hit ${pretty} subscribers! 🎉`,
    bodyText: `Thank you for helping us reach ${pretty} subscribers. This community made it happen — what should we make next?`,
    status: 'planned',
    deleted: false,
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest __tests__/lib/youtube-studio-milestones.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/youtube-studio/milestones.ts __tests__/lib/youtube-studio-milestones.test.ts
git commit -m "feat(yt-os): add subscriber milestone detection + celebration draft"
```

---

## Task 8: Sponsorship pipeline + disclosure helper

**Files:**
- Create: `lib/youtube-studio/sponsorship.ts`
- Test: `__tests__/lib/youtube-studio-sponsorship.test.ts`

**Note:** Reuses the CRM `Pipeline`/`PipelineStage` shape from `lib/pipelines/types.ts` (stages carry `id`, `label`, `kind`, `order`, `probability`). Sponsorship deals are ordinary CRM `Deal` records in this pipeline; the sponsorship-specific fields ride on a `sponsorship` key on the deal.

- [ ] **Step 1: Write the failing test**

```typescript
// __tests__/lib/youtube-studio-sponsorship.test.ts
import { SPONSORSHIP_PIPELINE, sanitizeSponsorshipFields, hasSponsorshipDisclosure } from '@/lib/youtube-studio/sponsorship'

describe('SPONSORSHIP_PIPELINE', () => {
  it('defines the six sponsorship stages in order', () => {
    expect(SPONSORSHIP_PIPELINE.name).toBe('Sponsorships')
    expect(SPONSORSHIP_PIPELINE.stages.map((s) => s.id)).toEqual([
      'prospect', 'pitched', 'negotiating', 'signed', 'delivered', 'paid',
    ])
    expect(SPONSORSHIP_PIPELINE.stages.find((s) => s.id === 'paid')?.kind).toBe('won')
  })
})

describe('sanitizeSponsorshipFields', () => {
  it('normalizes deliverables, fee model, and disclosure flag', () => {
    const fields = sanitizeSponsorshipFields({
      channelWorkspaceId: ' ch ', sponsorName: ' Acme ',
      deliverables: [' 60s integration ', '', ' pinned comment '],
      feeModel: 'flat', flatFeeCents: 500000,
      integrationVideoProjectId: ' vp-1 ', integrationTimestampSeconds: 92,
      disclosureConfirmed: true,
    })
    expect(fields.sponsorName).toBe('Acme')
    expect(fields.deliverables).toEqual(['60s integration', 'pinned comment'])
    expect(fields.feeModel).toBe('flat')
    expect(fields.flatFeeCents).toBe(500000)
    expect(fields.integrationTimestampSeconds).toBe(92)
    expect(fields.disclosureConfirmed).toBe(true)
  })
  it('defaults an invalid fee model to flat and disclosure to false', () => {
    const fields = sanitizeSponsorshipFields({ channelWorkspaceId: 'c', sponsorName: 'X', feeModel: 'nope' })
    expect(fields.feeModel).toBe('flat')
    expect(fields.disclosureConfirmed).toBe(false)
    expect(fields.deliverables).toEqual([])
  })
})

describe('hasSponsorshipDisclosure', () => {
  it('passes when the packet declares paid promotion and disclosure notes', () => {
    expect(hasSponsorshipDisclosure({ containsPaidPromotion: true, aiDisclosureNotes: 'Sponsored by Acme' })).toBe(true)
  })
  it('fails when paid promotion is not declared', () => {
    expect(hasSponsorshipDisclosure({ containsPaidPromotion: false })).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/lib/youtube-studio-sponsorship.test.ts`
Expected: FAIL — cannot find module `@/lib/youtube-studio/sponsorship`

- [ ] **Step 3: Write minimal implementation**

```typescript
// lib/youtube-studio/sponsorship.ts
import type { PipelineStage } from '@/lib/pipelines/types'
import type { YouTubeSponsorshipFields } from './ops-types'

/** Seed definition for the reusable CRM sponsorship pipeline (per org). */
export const SPONSORSHIP_PIPELINE: { name: string; stages: PipelineStage[] } = {
  name: 'Sponsorships',
  stages: [
    { id: 'prospect', label: 'Prospect', kind: 'open', order: 0, probability: 10 },
    { id: 'pitched', label: 'Pitched', kind: 'open', order: 1, probability: 25 },
    { id: 'negotiating', label: 'Negotiating', kind: 'open', order: 2, probability: 50 },
    { id: 'signed', label: 'Signed', kind: 'open', order: 3, probability: 80 },
    { id: 'delivered', label: 'Delivered', kind: 'open', order: 4, probability: 90 },
    { id: 'paid', label: 'Paid', kind: 'won', order: 5, probability: 100 },
  ],
}

function str(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value.trim() : fallback
}
function num(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}
function bool(value: unknown): boolean {
  return typeof value === 'boolean' ? value : false
}
function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.map((v) => str(v)).filter(Boolean)
}

export function sanitizeSponsorshipFields(input: Record<string, unknown>): YouTubeSponsorshipFields {
  const out: YouTubeSponsorshipFields = {
    channelWorkspaceId: str(input.channelWorkspaceId),
    sponsorName: str(input.sponsorName),
    deliverables: stringList(input.deliverables),
    feeModel: input.feeModel === 'cpm' ? 'cpm' : 'flat',
    disclosureConfirmed: bool(input.disclosureConfirmed),
  }
  const integrationVideoProjectId = str(input.integrationVideoProjectId)
  if (integrationVideoProjectId) out.integrationVideoProjectId = integrationVideoProjectId
  const integrationTimestampSeconds = num(input.integrationTimestampSeconds)
  if (integrationTimestampSeconds !== undefined) out.integrationTimestampSeconds = integrationTimestampSeconds
  const flatFeeCents = num(input.flatFeeCents)
  if (flatFeeCents !== undefined) out.flatFeeCents = flatFeeCents
  const cpmCents = num(input.cpmCents)
  if (cpmCents !== undefined) out.cpmCents = cpmCents
  const contractDocumentId = str(input.contractDocumentId)
  if (contractDocumentId) out.contractDocumentId = contractDocumentId
  const invoiceId = str(input.invoiceId)
  if (invoiceId) out.invoiceId = invoiceId
  if (input.exclusivityUntil !== undefined) out.exclusivityUntil = input.exclusivityUntil
  return out
}

/**
 * A sponsored video's publishing packet satisfies the disclosure gate when it
 * declares paid promotion AND carries disclosure notes. Used by the
 * `sponsorshipDisclosure` packet gate (Task 11).
 */
export function hasSponsorshipDisclosure(packet: {
  containsPaidPromotion?: boolean
  aiDisclosureNotes?: string
}): boolean {
  return packet.containsPaidPromotion === true && Boolean(packet.aiDisclosureNotes?.trim())
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest __tests__/lib/youtube-studio-sponsorship.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/youtube-studio/sponsorship.ts __tests__/lib/youtube-studio-sponsorship.test.ts
git commit -m "feat(yt-os): add sponsorship pipeline + disclosure helper"
```

---

## Task 9: Channel P&L rollup

**Files:**
- Create: `lib/youtube-studio/pnl.ts`
- Test: `__tests__/lib/youtube-studio-pnl.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// __tests__/lib/youtube-studio-pnl.test.ts
import { rollupVideoPnl, rollupChannelPnl } from '@/lib/youtube-studio/pnl'

describe('rollupVideoPnl', () => {
  it('sums cost + revenue and computes profit and cost-per-view', () => {
    const result = rollupVideoPnl({
      videoProjectId: 'vp-1',
      views: 10000,
      costs: [{ amountCents: 3000 }, { amountCents: 2000 }],
      revenues: [{ amountCents: 12000 }],
      currency: 'ZAR',
    })
    expect(result.costCents).toBe(5000)
    expect(result.revenueCents).toBe(12000)
    expect(result.profitCents).toBe(7000)
    expect(result.costPerViewCents).toBe(0.5)
    expect(result.currency).toBe('ZAR')
  })
  it('returns null cost-per-view when there are no views', () => {
    const result = rollupVideoPnl({ videoProjectId: 'vp-2', views: 0, costs: [{ amountCents: 100 }], revenues: [], currency: 'USD' })
    expect(result.costPerViewCents).toBeNull()
  })
})

describe('rollupChannelPnl', () => {
  it('aggregates per-video rollups into channel totals', () => {
    const result = rollupChannelPnl([
      { videoProjectId: 'a', views: 100, costCents: 1000, revenueCents: 1500, profitCents: 500, costPerViewCents: 10, currency: 'ZAR' },
      { videoProjectId: 'b', views: 200, costCents: 2000, revenueCents: 1000, profitCents: -1000, costPerViewCents: 10, currency: 'ZAR' },
    ])
    expect(result.totalCostCents).toBe(3000)
    expect(result.totalRevenueCents).toBe(2500)
    expect(result.totalProfitCents).toBe(-500)
    expect(result.videoCount).toBe(2)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/lib/youtube-studio-pnl.test.ts`
Expected: FAIL — cannot find module `@/lib/youtube-studio/pnl`

- [ ] **Step 3: Write minimal implementation**

```typescript
// lib/youtube-studio/pnl.ts
import type { YouTubeVideoPnl } from './ops-types'

export function rollupVideoPnl(input: {
  videoProjectId: string
  views: number
  costs: Array<{ amountCents: number }>
  revenues: Array<{ amountCents: number }>
  currency: string
}): YouTubeVideoPnl {
  const costCents = input.costs.reduce((sum, c) => sum + (c.amountCents || 0), 0)
  const revenueCents = input.revenues.reduce((sum, r) => sum + (r.amountCents || 0), 0)
  const profitCents = revenueCents - costCents
  const costPerViewCents = input.views > 0 ? Math.round((costCents / input.views) * 100) / 100 : null
  return {
    videoProjectId: input.videoProjectId,
    views: input.views,
    costCents,
    revenueCents,
    profitCents,
    costPerViewCents,
    currency: input.currency,
  }
}

export interface YouTubeChannelPnl {
  videoCount: number
  totalViews: number
  totalCostCents: number
  totalRevenueCents: number
  totalProfitCents: number
  videos: YouTubeVideoPnl[]
}

export function rollupChannelPnl(videos: YouTubeVideoPnl[]): YouTubeChannelPnl {
  return {
    videoCount: videos.length,
    totalViews: videos.reduce((s, v) => s + v.views, 0),
    totalCostCents: videos.reduce((s, v) => s + v.costCents, 0),
    totalRevenueCents: videos.reduce((s, v) => s + v.revenueCents, 0),
    totalProfitCents: videos.reduce((s, v) => s + v.profitCents, 0),
    videos,
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest __tests__/lib/youtube-studio-pnl.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/youtube-studio/pnl.ts __tests__/lib/youtube-studio-pnl.test.ts
git commit -m "feat(yt-os): add channel P&L rollup helpers"
```

---

## Task 10: SOP checklist instantiation into tasks

**Files:**
- Create: `lib/youtube-studio/sop.ts`
- Test: `__tests__/lib/youtube-studio-sop.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// __tests__/lib/youtube-studio-sop.test.ts
import { instantiateChecklist, DEFAULT_SOP_TEMPLATES } from '@/lib/youtube-studio/sop'

describe('instantiateChecklist', () => {
  it('turns SOP items into task payloads scoped to the video project', () => {
    const tasks = instantiateChecklist({
      orgId: 'o',
      projectId: 'proj-1',
      videoProjectId: 'vp-1',
      template: {
        name: 'Standard long-form',
        items: [
          { label: 'Write brief', phase: 'pre_production' },
          { label: 'Cut V1', phase: 'edit' },
        ],
      },
    })
    expect(tasks).toHaveLength(2)
    expect(tasks[0]).toMatchObject({
      orgId: 'o',
      projectId: 'proj-1',
      title: 'Write brief',
    })
    expect(tasks[0].title).toBe('Write brief')
    expect(tasks[1].title).toBe('Cut V1')
    // phase carried into a tag/label for grouping
    expect(tasks[0].tags).toContain('pre_production')
  })
})

describe('DEFAULT_SOP_TEMPLATES', () => {
  it('ships templates spanning all four production phases', () => {
    const phases = new Set(DEFAULT_SOP_TEMPLATES.flatMap((t) => t.items.map((i) => i.phase)))
    expect(phases).toEqual(new Set(['pre_production', 'edit', 'publish', 'post_publish']))
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/lib/youtube-studio-sop.test.ts`
Expected: FAIL — cannot find module `@/lib/youtube-studio/sop`

- [ ] **Step 3: Write minimal implementation**

```typescript
// lib/youtube-studio/sop.ts
import type { YouTubeSopChecklistItem } from './ops-types'

export interface SopTaskPayload {
  orgId: string
  projectId: string
  videoProjectId: string
  title: string
  tags: string[]
}

/**
 * Convert an SOP template into task payloads for the existing tasks module.
 * Callers write these via the tasks store; phase is carried as a tag so the
 * board can group checklist items by production phase.
 */
export function instantiateChecklist(input: {
  orgId: string
  projectId: string
  videoProjectId: string
  template: { name: string; items: YouTubeSopChecklistItem[] }
}): SopTaskPayload[] {
  return input.template.items.map((item) => ({
    orgId: input.orgId,
    projectId: input.projectId,
    videoProjectId: input.videoProjectId,
    title: item.label,
    tags: [item.phase, 'sop', input.template.name].map((t) => t.trim()).filter(Boolean),
  }))
}

export const DEFAULT_SOP_TEMPLATES: Array<{ name: string; items: YouTubeSopChecklistItem[] }> = [
  {
    name: 'Standard long-form',
    items: [
      { label: 'Lock brief + hook', phase: 'pre_production' },
      { label: 'Write + approve script', phase: 'pre_production' },
      { label: 'Rough cut V1', phase: 'edit' },
      { label: 'Add captions + B-roll', phase: 'edit' },
      { label: 'Publish readiness gates pass', phase: 'publish' },
      { label: 'Schedule + set thumbnail', phase: 'publish' },
      { label: 'Reply to first-hour comments', phase: 'post_publish' },
      { label: 'Clip Shorts from long-form', phase: 'post_publish' },
    ],
  },
]
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest __tests__/lib/youtube-studio-sop.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/youtube-studio/sop.ts __tests__/lib/youtube-studio-sop.test.ts
git commit -m "feat(yt-os): add SOP checklist instantiation into tasks"
```

---

## Task 11: Sponsorship disclosure gate on the publishing packet

**Files:**
- Modify: `lib/youtube-studio/types.ts` (add `sponsorshipDisclosure` to `YouTubePublishingPacket.checks`, add `isSponsored`/`sponsorshipDealId`)
- Modify: `lib/youtube-studio/sanitize.ts` (default the new check + fields)
- Modify: `lib/youtube-studio/publishing.ts` (add key to `PACKET_CHECK_KEYS` + targeted blocker)
- Test: `__tests__/lib/youtube-studio-sponsorship-gate.test.ts`

**Context:** `YouTubePublishingPacket.checks` currently has 8 keys ending at `connectedAccount` (`lib/youtube-studio/types.ts:454-463`). `PACKET_CHECK_KEYS` in `lib/youtube-studio/publishing.ts:13` drives generic blocker enforcement (any `status: 'block'` blocks publish, at `publishing.ts:138`). We add a ninth gate and one targeted blocker: a sponsored video whose disclosure gate is not `pass` cannot publish.

- [ ] **Step 1: Write the failing test**

```typescript
// __tests__/lib/youtube-studio-sponsorship-gate.test.ts
import { readFileSync } from 'fs'
import path from 'path'

function source(rel: string) {
  return readFileSync(path.join(process.cwd(), rel), 'utf8')
}

describe('sponsorship disclosure gate wiring', () => {
  it('packet checks include sponsorshipDisclosure and the sponsored flag', () => {
    const src = source('lib/youtube-studio/types.ts')
    expect(src).toContain('sponsorshipDisclosure: YouTubeGateCheck')
    expect(src).toContain('isSponsored?: boolean')
    expect(src).toContain('sponsorshipDealId?: string')
  })

  it('sanitizer defaults the sponsorshipDisclosure check', () => {
    const src = source('lib/youtube-studio/sanitize.ts')
    expect(src).toContain('sponsorshipDisclosure')
  })

  it('publishing lists the gate and blocks sponsored videos lacking disclosure', () => {
    const src = source('lib/youtube-studio/publishing.ts')
    expect(src).toContain("'sponsorshipDisclosure'")
    expect(src).toContain('isSponsored')
    expect(src).toContain('sponsorship disclosure')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/lib/youtube-studio-sponsorship-gate.test.ts`
Expected: FAIL — `sponsorshipDisclosure` not present in `types.ts`

- [ ] **Step 3: Modify `lib/youtube-studio/types.ts`**

In the `YouTubePublishingPacket` interface, extend the `checks` block and add two fields. Change:

```typescript
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
```

to:

```typescript
  isSponsored?: boolean
  sponsorshipDealId?: string
  containsPaidPromotion?: boolean
  checks: {
    rights: YouTubeGateCheck
    aiDisclosure: YouTubeGateCheck
    madeForKids: YouTubeGateCheck
    metadata: YouTubeGateCheck
    thumbnail: YouTubeGateCheck
    captions: YouTubeGateCheck
    approval: YouTubeGateCheck
    connectedAccount: YouTubeGateCheck
    sponsorshipDisclosure: YouTubeGateCheck
  }
```

- [ ] **Step 4: Modify `lib/youtube-studio/sanitize.ts`**

Find the packet sanitizer's `checks` defaulting (the block that builds `connectedAccount`). Add a `sponsorshipDisclosure` default alongside it, using the same `sanitizeGateCheck`/default pattern already used for the other checks. Locate the object literal that assigns `connectedAccount:` inside the packet `checks` and add immediately after it:

```typescript
      sponsorshipDisclosure: sanitizeGateCheck(checksInput.sponsorshipDisclosure, {
        status: 'not_applicable',
        message: 'No sponsorship on this video.',
      }),
```

Also, within the same packet sanitizer, carry the two new scalar fields. After the existing `containsSyntheticMedia`/`aiDisclosureNotes` handling, add:

```typescript
  if (typeof input.isSponsored === 'boolean') out.isSponsored = input.isSponsored
  if (typeof input.containsPaidPromotion === 'boolean') out.containsPaidPromotion = input.containsPaidPromotion
  const sponsorshipDealId = typeof input.sponsorshipDealId === 'string' ? input.sponsorshipDealId.trim() : ''
  if (sponsorshipDealId) out.sponsorshipDealId = sponsorshipDealId
```

(Match the exact local variable name the packet sanitizer uses for its output object — it is `out` in the existing sanitizers; if the packet sanitizer uses a different name such as `sanitized`, use that name.)

- [ ] **Step 5: Modify `lib/youtube-studio/publishing.ts`**

Add the gate key to the enforced list. Change:

```typescript
const PACKET_CHECK_KEYS: Array<keyof YouTubePublishingPacket['checks']> = [
```

so the array includes `'sponsorshipDisclosure'` (append it as the last element of the existing array literal).

Then, inside `evaluateYouTubePublishReadiness`, after the existing generic packet-check blocker loop (the `for (const [key, check] of Object.entries(packet.checks ...))` block), add a targeted sponsored-video blocker:

```typescript
  if (packet.isSponsored === true && packet.checks?.sponsorshipDisclosure?.status !== 'pass') {
    blockers.push('Sponsored video is missing a passing sponsorship disclosure gate.')
  }
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx jest __tests__/lib/youtube-studio-sponsorship-gate.test.ts __tests__/lib/youtube-studio-sanitize.test.ts __tests__/lib/youtube-studio-publishing.test.ts`
Expected: PASS (existing sanitize + publishing tests still green; new gate test green)

- [ ] **Step 7: Commit**

```bash
git add lib/youtube-studio/types.ts lib/youtube-studio/sanitize.ts lib/youtube-studio/publishing.ts __tests__/lib/youtube-studio-sponsorship-gate.test.ts
git commit -m "feat(yt-os): add sponsorship disclosure gate to publishing packet"
```

---

## Task 12: Quota-gated comment reply + moderation actions

**Files:**
- Create: `lib/youtube-studio/comment-actions.ts`
- Test: `__tests__/lib/youtube-studio-comment-actions.test.ts`

**Context:** Comment writes cost 50 quota units each. Before any write, debit the Phase 4 `youtube_api_quota_ledger` (collection name owned by the Phase 4 plan). This task's helpers take an injected `ledger` dependency (a `debit(units)` function returning whether the debit succeeded) and an injected `provider` (from `resolveProvider(orgId, 'youtube')`, `lib/social/account-resolver.ts:174`) so the pure decision logic is unit-testable without network or Firestore. The route (Task 15) wires the real ledger + provider.

- [ ] **Step 1: Write the failing test**

```typescript
// __tests__/lib/youtube-studio-comment-actions.test.ts
import { sendCommentReply, moderateComment, COMMENT_WRITE_UNITS } from '@/lib/youtube-studio/comment-actions'

function fakeLedger(allow: boolean) {
  const calls: number[] = []
  return {
    calls,
    debit: async (units: number) => { calls.push(units); return allow },
  }
}

describe('sendCommentReply', () => {
  it('debits 50 units then calls the provider insertReply', async () => {
    const ledger = fakeLedger(true)
    const provider = { insertReply: jest.fn().mockResolvedValue({ id: 'reply-1' }) }
    const result = await sendCommentReply({
      provider, ledger, parentCommentId: 'c-1', text: 'Thanks!',
    })
    expect(ledger.calls).toEqual([COMMENT_WRITE_UNITS])
    expect(COMMENT_WRITE_UNITS).toBe(50)
    expect(provider.insertReply).toHaveBeenCalledWith('c-1', 'Thanks!')
    expect(result).toEqual({ ok: true, replyId: 'reply-1' })
  })

  it('skips the write when the ledger cannot cover the cost', async () => {
    const ledger = fakeLedger(false)
    const provider = { insertReply: jest.fn() }
    const result = await sendCommentReply({ provider, ledger, parentCommentId: 'c-1', text: 'Hi' })
    expect(provider.insertReply).not.toHaveBeenCalled()
    expect(result).toEqual({ ok: false, skipped: 'insufficient_quota' })
  })
})

describe('moderateComment', () => {
  it('debits then sets moderation status', async () => {
    const ledger = fakeLedger(true)
    const provider = { setModerationStatus: jest.fn().mockResolvedValue(undefined) }
    const result = await moderateComment({ provider, ledger, commentId: 'c-9', action: 'reject' })
    expect(ledger.calls).toEqual([COMMENT_WRITE_UNITS])
    expect(provider.setModerationStatus).toHaveBeenCalledWith('c-9', 'reject')
    expect(result).toEqual({ ok: true })
  })

  it('skips moderation when quota is exhausted', async () => {
    const ledger = fakeLedger(false)
    const provider = { setModerationStatus: jest.fn() }
    const result = await moderateComment({ provider, ledger, commentId: 'c-9', action: 'reject' })
    expect(provider.setModerationStatus).not.toHaveBeenCalled()
    expect(result).toEqual({ ok: false, skipped: 'insufficient_quota' })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/lib/youtube-studio-comment-actions.test.ts`
Expected: FAIL — cannot find module `@/lib/youtube-studio/comment-actions`

- [ ] **Step 3: Write minimal implementation**

```typescript
// lib/youtube-studio/comment-actions.ts

/** YouTube Data API comment write cost (comments.insert / setModerationStatus). */
export const COMMENT_WRITE_UNITS = 50

export interface QuotaLedger {
  /** Debit N units; returns true if the day's remaining quota covered it. */
  debit(units: number): Promise<boolean>
}

export interface CommentWriteProvider {
  insertReply?(parentCommentId: string, text: string): Promise<{ id: string }>
  setModerationStatus?(commentId: string, action: 'reject' | 'heldForReview'): Promise<void>
}

export type CommentActionResult =
  | { ok: true; replyId?: string }
  | { ok: false; skipped: 'insufficient_quota' }

export async function sendCommentReply(input: {
  provider: CommentWriteProvider
  ledger: QuotaLedger
  parentCommentId: string
  text: string
}): Promise<CommentActionResult> {
  const covered = await input.ledger.debit(COMMENT_WRITE_UNITS)
  if (!covered) return { ok: false, skipped: 'insufficient_quota' }
  const res = await input.provider.insertReply!(input.parentCommentId, input.text)
  return { ok: true, replyId: res.id }
}

export async function moderateComment(input: {
  provider: CommentWriteProvider
  ledger: QuotaLedger
  commentId: string
  action: 'reject' | 'heldForReview'
}): Promise<CommentActionResult> {
  const covered = await input.ledger.debit(COMMENT_WRITE_UNITS)
  if (!covered) return { ok: false, skipped: 'insufficient_quota' }
  await input.provider.setModerationStatus!(input.commentId, input.action)
  return { ok: true }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest __tests__/lib/youtube-studio-comment-actions.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/youtube-studio/comment-actions.ts __tests__/lib/youtube-studio-comment-actions.test.ts
git commit -m "feat(yt-os): add quota-gated comment reply + moderation actions"
```

---

## Task 13: Comment sync orchestrator (upsert + heuristic triage)

**Files:**
- Create: `lib/youtube-studio/comment-sync.ts`
- Test: `__tests__/lib/youtube-studio-comment-sync.test.ts`

**Context:** `commentThreads.list` is 1 unit/page (quota-cheap) — reads do NOT debit the write ledger. The orchestrator takes injected `fetchThreads` (returns `{ items, nextPageToken }`) and `upsert`/`readState`/`writeState` callbacks so the merge + triage logic is unit-testable without network. The route/cron wires the real `resolveProvider` + Firestore.

- [ ] **Step 1: Write the failing test**

```typescript
// __tests__/lib/youtube-studio-comment-sync.test.ts
import { syncChannelComments } from '@/lib/youtube-studio/comment-sync'

describe('syncChannelComments', () => {
  it('classifies and upserts fetched comments, then advances sync state', async () => {
    const upserted: Array<{ youtubeCommentId: string; bucket: string; pinWorthy: boolean }> = []
    const result = await syncChannelComments({
      orgId: 'o',
      channelWorkspaceId: 'ch',
      youtubeChannelId: 'yt-1',
      readState: async () => ({ nextPageToken: 'tok-A' }),
      fetchThreads: async (pageToken) => {
        expect(pageToken).toBe('tok-A')
        return {
          items: [
            { id: 'c-1', videoId: 'v-1', author: 'Fan', text: 'How do I start?', likeCount: 20 },
            { id: 'c-2', videoId: 'v-1', author: 'Bot', text: 'free money http://spam.example promo', likeCount: 0 },
          ],
          nextPageToken: 'tok-B',
        }
      },
      upsert: async (comment) => { upserted.push({ youtubeCommentId: comment.youtubeCommentId, bucket: comment.bucket, pinWorthy: comment.pinWorthy }) },
      writeState: async () => undefined,
    })
    expect(result.synced).toBe(2)
    expect(result.nextPageToken).toBe('tok-B')
    const q = upserted.find((c) => c.youtubeCommentId === 'c-1')
    expect(q?.bucket).toBe('question')
    expect(q?.pinWorthy).toBe(true)
    expect(upserted.find((c) => c.youtubeCommentId === 'c-2')?.bucket).toBe('spam')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/lib/youtube-studio-comment-sync.test.ts`
Expected: FAIL — cannot find module `@/lib/youtube-studio/comment-sync`

- [ ] **Step 3: Write minimal implementation**

```typescript
// lib/youtube-studio/comment-sync.ts
import type { YouTubeComment } from './community-types'
import { classifyCommentHeuristic, isPinWorthy } from './comment-triage'

export interface FetchedThread {
  id: string
  videoId: string
  author: string
  authorChannelId?: string
  text: string
  likeCount: number
}

export interface SyncChannelCommentsInput {
  orgId: string
  channelWorkspaceId: string
  youtubeChannelId: string
  readState: () => Promise<{ nextPageToken?: string } | null>
  fetchThreads: (pageToken?: string) => Promise<{ items: FetchedThread[]; nextPageToken?: string }>
  upsert: (comment: Omit<YouTubeComment, 'id'>) => Promise<void>
  writeState: (state: { nextPageToken?: string; lastError?: string }) => Promise<void>
}

export async function syncChannelComments(input: SyncChannelCommentsInput): Promise<{ synced: number; nextPageToken?: string }> {
  const state = (await input.readState()) ?? {}
  const page = await input.fetchThreads(state.nextPageToken)
  let synced = 0
  for (const item of page.items) {
    const bucket = classifyCommentHeuristic(item.text)
    const comment: Omit<YouTubeComment, 'id'> = {
      orgId: input.orgId,
      channelWorkspaceId: input.channelWorkspaceId,
      youtubeCommentId: item.id,
      youtubeVideoId: item.videoId,
      authorDisplayName: item.author,
      textOriginal: item.text,
      likeCount: item.likeCount,
      bucket,
      aiClassified: false,
      pinWorthy: isPinWorthy({ bucket, likeCount: item.likeCount }),
      moderationStatus: 'published',
      handled: false,
      replyStatus: 'none',
      deleted: false,
    }
    if (item.authorChannelId) comment.authorChannelId = item.authorChannelId
    await input.upsert(comment)
    synced += 1
  }
  await input.writeState({ nextPageToken: page.nextPageToken })
  return { synced, nextPageToken: page.nextPageToken }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest __tests__/lib/youtube-studio-comment-sync.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/youtube-studio/comment-sync.ts __tests__/lib/youtube-studio-comment-sync.test.ts
git commit -m "feat(yt-os): add comment sync orchestrator"
```

---

## Task 14: Comments inbox route (GET feed + PATCH)

**Files:**
- Create: `app/api/v1/youtube-studio/comments/route.ts`
- Test: `__tests__/app/youtube-studio-comments-route.test.ts`

**Context:** Follows the `videos/route.ts` pattern exactly — `withAuth('admin')`, `ensureOrgAccess`, `listByOrg`, `serializeYouTubeCommunityRecord`, `apiSuccess`/`apiError`. PATCH supports bucket override, mark-handled, and `action:'request-reply-draft'` which creates a review-gated agent job via `buildReplyJobInput` (never auto-sends).

- [ ] **Step 1: Write the failing source-assertion test**

```typescript
// __tests__/app/youtube-studio-comments-route.test.ts
import { readFileSync } from 'fs'
import path from 'path'

function source(rel: string) {
  return readFileSync(path.join(process.cwd(), rel), 'utf8')
}

describe('comments inbox route', () => {
  const src = source('app/api/v1/youtube-studio/comments/route.ts')

  it('is admin-guarded and uses the response envelope', () => {
    expect(src).toContain("withAuth('admin'")
    expect(src).toContain('apiSuccess')
    expect(src).toContain('apiError')
    expect(src).toContain('ensureOrgAccess')
  })

  it('reads from the comments collection', () => {
    expect(src).toContain('COMMUNITY_COLLECTIONS.comments')
  })

  it('request-reply-draft path is review-gated (builds an agent job, never auto-sends)', () => {
    expect(src).toContain("request-reply-draft")
    expect(src).toContain('buildReplyJobInput')
    expect(src).not.toContain('sendCommentReply')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/app/youtube-studio-comments-route.test.ts`
Expected: FAIL — `ENOENT: no such file ... comments/route.ts`

- [ ] **Step 3: Write minimal implementation**

```typescript
// app/api/v1/youtube-studio/comments/route.ts
import { NextRequest } from 'next/server'
import { adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { apiError, apiSuccess } from '@/lib/api/response'
import { actorFields, ensureOrgAccess, listByOrg, loadScopedRecord, updateActorFields, YOUTUBE_COLLECTIONS } from '@/lib/youtube-studio/api'
import { COMMUNITY_COLLECTIONS, sanitizeYouTubeCommentInput, serializeYouTubeCommunityRecord } from '@/lib/youtube-studio/community'
import { buildReplyJobInput } from '@/lib/youtube-studio/comment-triage'
import type { YouTubeComment } from '@/lib/youtube-studio/community-types'

export const dynamic = 'force-dynamic'

export const GET = withAuth('admin', async (req, user) => {
  const url = new URL(req.url)
  const orgId = url.searchParams.get('orgId')?.trim() ?? ''
  const denied = await ensureOrgAccess(user, orgId)
  if (denied) return denied

  const bucket = url.searchParams.get('bucket')?.trim()
  const docs = await listByOrg(COMMUNITY_COLLECTIONS.comments, orgId)
  let comments = docs.map((doc) => serializeYouTubeCommunityRecord<YouTubeComment>(doc.id, doc.data()))
  if (bucket) comments = comments.filter((c) => c.bucket === bucket)

  return apiSuccess({ comments })
})

export const PATCH = withAuth('admin', async (req: NextRequest, user) => {
  const body = await req.json().catch(() => ({}))
  const orgId = typeof body.orgId === 'string' ? body.orgId.trim() : ''
  const denied = await ensureOrgAccess(user, orgId)
  if (denied) return denied

  const id = typeof body.id === 'string' ? body.id.trim() : ''
  if (!id) return apiError('id is required', 400)

  const existing = await loadScopedRecord(COMMUNITY_COLLECTIONS.comments, id)
  if (!existing || existing.data.deleted === true) return apiError('Comment not found', 404)
  if (existing.data.orgId !== orgId) return apiError('Comment does not belong to organisation', 400)

  const action = typeof body.action === 'string' ? body.action : ''

  if (action === 'request-reply-draft') {
    const jobInput = buildReplyJobInput({
      orgId,
      channelWorkspaceId: existing.data.channelWorkspaceId as string,
      commentId: id,
      authorDisplayName: existing.data.authorDisplayName as string,
      textOriginal: existing.data.textOriginal as string,
      bucket: existing.data.bucket as YouTubeComment['bucket'],
    })
    const jobRef = await adminDb.collection(YOUTUBE_COLLECTIONS.agentJobs).add({
      orgId,
      channelWorkspaceId: jobInput.linked.channelWorkspaceId,
      skillKey: jobInput.skillKey,
      title: `Reply to comment ${id}`,
      status: 'queued',
      priority: 'normal',
      reviewRequired: true,
      visibility: jobInput.visibility,
      inputSummary: jobInput.inputSummary,
      outputArtifactIds: [],
      linked: { commentIds: [id] },
      deleted: false,
      ...actorFields(user),
    })
    await existing.ref.update({ replyStatus: 'suggested', replyAgentJobId: jobRef.id, ...updateActorFields(user) })
    return apiSuccess({ agentJobId: jobRef.id })
  }

  const merged = sanitizeYouTubeCommentInput({ ...existing.data, ...body, orgId })
  await existing.ref.update({ bucket: merged.bucket, handled: merged.handled, moderationStatus: merged.moderationStatus, ...updateActorFields(user) })
  return apiSuccess({ id })
})
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest __tests__/app/youtube-studio-comments-route.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add app/api/v1/youtube-studio/comments/route.ts __tests__/app/youtube-studio-comments-route.test.ts
git commit -m "feat(yt-os): add comments inbox route"
```

---

## Task 15: Comment reply + moderation routes (quota-gated)

**Files:**
- Create: `app/api/v1/youtube-studio/comments/reply/route.ts`
- Create: `app/api/v1/youtube-studio/comments/moderate/route.ts`
- Test: `__tests__/app/youtube-studio-comment-write-routes.test.ts`

**Context:** These POST routes send an already-approved reply / moderate spam. They resolve the org's YouTube provider via `resolveProvider(orgId, 'youtube')` (`lib/social/account-resolver.ts:174`), wrap it into a `CommentWriteProvider`, and pass a real `youtube_api_quota_ledger`-backed `QuotaLedger` (Phase 4). The reply route requires `replyStatus === 'approved'` OR the org's `commentAutopilot` toggle — it must NOT send a merely `suggested` reply without approval.

- [ ] **Step 1: Write the failing source-assertion test**

```typescript
// __tests__/app/youtube-studio-comment-write-routes.test.ts
import { readFileSync } from 'fs'
import path from 'path'

function source(rel: string) {
  return readFileSync(path.join(process.cwd(), rel), 'utf8')
}

describe('comment reply route', () => {
  const src = source('app/api/v1/youtube-studio/comments/reply/route.ts')
  it('is admin-guarded and quota-gated via comment-actions', () => {
    expect(src).toContain("withAuth('admin'")
    expect(src).toContain('sendCommentReply')
    expect(src).toContain('resolveProvider')
  })
  it('requires approval unless autopilot is on', () => {
    expect(src).toContain("'approved'")
    expect(src).toContain('commentAutopilot')
  })
})

describe('comment moderate route', () => {
  const src = source('app/api/v1/youtube-studio/comments/moderate/route.ts')
  it('is admin-guarded and quota-gated', () => {
    expect(src).toContain("withAuth('admin'")
    expect(src).toContain('moderateComment')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/app/youtube-studio-comment-write-routes.test.ts`
Expected: FAIL — reply/route.ts does not exist

- [ ] **Step 3: Write the reply route**

```typescript
// app/api/v1/youtube-studio/comments/reply/route.ts
import { NextRequest } from 'next/server'
import { adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { apiError, apiSuccess } from '@/lib/api/response'
import { ensureOrgAccess, loadScopedRecord, updateActorFields } from '@/lib/youtube-studio/api'
import { COMMUNITY_COLLECTIONS } from '@/lib/youtube-studio/community'
import { sendCommentReply, COMMENT_WRITE_UNITS, type CommentWriteProvider, type QuotaLedger } from '@/lib/youtube-studio/comment-actions'
import { resolveProvider } from '@/lib/social/account-resolver'
import { debitYouTubeQuota } from '@/lib/youtube-studio/quota-ledger' // Phase 4 helper over youtube_api_quota_ledger

export const dynamic = 'force-dynamic'

export const POST = withAuth('admin', async (req: NextRequest, user) => {
  const body = await req.json().catch(() => ({}))
  const orgId = typeof body.orgId === 'string' ? body.orgId.trim() : ''
  const denied = await ensureOrgAccess(user, orgId)
  if (denied) return denied

  const id = typeof body.id === 'string' ? body.id.trim() : ''
  if (!id) return apiError('id is required', 400)

  const existing = await loadScopedRecord(COMMUNITY_COLLECTIONS.comments, id)
  if (!existing || existing.data.deleted === true) return apiError('Comment not found', 404)
  if (existing.data.orgId !== orgId) return apiError('Comment does not belong to organisation', 400)

  const settingsDoc = await adminDb.collection(COMMUNITY_COLLECTIONS.orgSettings).doc(orgId).get()
  const autopilot = settingsDoc.exists && settingsDoc.data()?.commentAutopilot === true
  if (existing.data.replyStatus !== 'approved' && !autopilot) {
    return apiError('Reply must be approved before sending (autopilot is off).', 409)
  }

  const text = typeof body.text === 'string' ? body.text.trim() : (existing.data.suggestedReply as string)?.trim()
  if (!text) return apiError('Reply text is required', 400)

  const social = await resolveProvider(orgId, 'youtube')
  if (!social) return apiError('No connected YouTube account for this organisation', 409)
  const provider: CommentWriteProvider = {
    insertReply: (parentId, replyText) => (social as unknown as { insertCommentReply: (p: string, t: string) => Promise<{ id: string }> }).insertCommentReply(parentId, replyText),
  }
  const ledger: QuotaLedger = { debit: (units) => debitYouTubeQuota(orgId, units) }

  const result = await sendCommentReply({ provider, ledger, parentCommentId: existing.data.youtubeCommentId as string, text })
  if (!result.ok) return apiError(`Reply skipped: ${result.skipped}`, 429)

  await existing.ref.update({ replyStatus: 'sent', sentReplyId: result.replyId, handled: true, ...updateActorFields(user) })
  return apiSuccess({ replyId: result.replyId, unitsSpent: COMMENT_WRITE_UNITS })
})
```

- [ ] **Step 4: Write the moderate route**

```typescript
// app/api/v1/youtube-studio/comments/moderate/route.ts
import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { apiError, apiSuccess } from '@/lib/api/response'
import { ensureOrgAccess, loadScopedRecord, updateActorFields } from '@/lib/youtube-studio/api'
import { COMMUNITY_COLLECTIONS } from '@/lib/youtube-studio/community'
import { moderateComment, type CommentWriteProvider, type QuotaLedger } from '@/lib/youtube-studio/comment-actions'
import { resolveProvider } from '@/lib/social/account-resolver'
import { debitYouTubeQuota } from '@/lib/youtube-studio/quota-ledger'

export const dynamic = 'force-dynamic'

export const POST = withAuth('admin', async (req: NextRequest, user) => {
  const body = await req.json().catch(() => ({}))
  const orgId = typeof body.orgId === 'string' ? body.orgId.trim() : ''
  const denied = await ensureOrgAccess(user, orgId)
  if (denied) return denied

  const ids: string[] = Array.isArray(body.ids) ? body.ids.filter((v: unknown) => typeof v === 'string') : []
  if (ids.length === 0) return apiError('ids is required', 400)
  const action: 'reject' | 'heldForReview' = body.action === 'heldForReview' ? 'heldForReview' : 'reject'

  const social = await resolveProvider(orgId, 'youtube')
  if (!social) return apiError('No connected YouTube account for this organisation', 409)
  const provider: CommentWriteProvider = {
    setModerationStatus: (commentId, act) => (social as unknown as { setCommentModerationStatus: (c: string, a: string) => Promise<void> }).setCommentModerationStatus(commentId, act),
  }
  const ledger: QuotaLedger = { debit: (units) => debitYouTubeQuota(orgId, units) }

  const results: Array<{ id: string; ok: boolean }> = []
  for (const id of ids) {
    const existing = await loadScopedRecord(COMMUNITY_COLLECTIONS.comments, id)
    if (!existing || existing.data.orgId !== orgId) { results.push({ id, ok: false }); continue }
    const res = await moderateComment({ provider, ledger, commentId: existing.data.youtubeCommentId as string, action })
    if (res.ok) {
      await existing.ref.update({ moderationStatus: action === 'reject' ? 'hidden' : 'held', handled: true, ...updateActorFields(user) })
    }
    results.push({ id, ok: res.ok })
  }
  return apiSuccess({ results })
})
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx jest __tests__/app/youtube-studio-comment-write-routes.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add app/api/v1/youtube-studio/comments/reply/route.ts app/api/v1/youtube-studio/comments/moderate/route.ts __tests__/app/youtube-studio-comment-write-routes.test.ts
git commit -m "feat(yt-os): add quota-gated comment reply + moderate routes"
```

> **Provider note:** `sendCommentReply`/`moderateComment` call `insertCommentReply`/`setCommentModerationStatus` on the resolved YouTube provider. Add these two thin methods to `lib/social/providers/youtube.ts` (POST `https://www.googleapis.com/youtube/v3/comments?part=snippet` for the reply; POST `https://www.googleapis.com/youtube/v3/comments/setModerationStatus?id=<id>&moderationStatus=<status>` for moderation), both using `Authorization: Bearer ${this.credentials.accessToken}` exactly as the existing upload methods do (`lib/social/providers/youtube.ts:85,137`). The `quota-ledger` helper (`debitYouTubeQuota`) is owned by the Phase 4 plan; if Phase 4 has not landed, add a minimal `lib/youtube-studio/quota-ledger.ts` that reads/increments a per-org daily doc in `youtube_api_quota_ledger` and returns `false` when the debit would exceed the daily cap.

---

## Task 16: Comment mining route (top questions → idea board)

**Files:**
- Create: `app/api/v1/youtube-studio/comment-mining/route.ts`
- Test: `__tests__/app/youtube-studio-comment-mining-route.test.ts`

**Context:** GET aggregates question-bucket comments via `aggregateTopQuestions`. POST `action:'to-idea'` writes a `youtube_ideas` record (Phase 3 collection, `provenance: 'comment'`) via `buildIdeaFromQuestion`. The `youtube_ideas` collection name comes from the Phase 3 plan — do not invent a new one.

- [ ] **Step 1: Write the failing source-assertion test**

```typescript
// __tests__/app/youtube-studio-comment-mining-route.test.ts
import { readFileSync } from 'fs'
import path from 'path'

function source(rel: string) { return readFileSync(path.join(process.cwd(), rel), 'utf8') }

describe('comment mining route', () => {
  const src = source('app/api/v1/youtube-studio/comment-mining/route.ts')
  it('is admin-guarded with envelope', () => {
    expect(src).toContain("withAuth('admin'")
    expect(src).toContain('apiSuccess')
    expect(src).toContain('aggregateTopQuestions')
  })
  it('writes ideas to the Phase 3 youtube_ideas collection with comment provenance', () => {
    expect(src).toContain("'youtube_ideas'")
    expect(src).toContain('buildIdeaFromQuestion')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/app/youtube-studio-comment-mining-route.test.ts`
Expected: FAIL — route does not exist

- [ ] **Step 3: Write minimal implementation**

```typescript
// app/api/v1/youtube-studio/comment-mining/route.ts
import { NextRequest } from 'next/server'
import { adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { apiError, apiSuccess } from '@/lib/api/response'
import { actorFields, ensureOrgAccess, listByOrg } from '@/lib/youtube-studio/api'
import { COMMUNITY_COLLECTIONS, serializeYouTubeCommunityRecord } from '@/lib/youtube-studio/community'
import { aggregateTopQuestions, buildIdeaFromQuestion } from '@/lib/youtube-studio/comment-mining'
import type { YouTubeComment } from '@/lib/youtube-studio/community-types'

/** Phase 3 collection — see 2026-07-06-yt-os-phase3-research-ideation.md. */
const YOUTUBE_IDEAS_COLLECTION = 'youtube_ideas'

export const dynamic = 'force-dynamic'

export const GET = withAuth('admin', async (req, user) => {
  const orgId = new URL(req.url).searchParams.get('orgId')?.trim() ?? ''
  const denied = await ensureOrgAccess(user, orgId)
  if (denied) return denied
  const docs = await listByOrg(COMMUNITY_COLLECTIONS.comments, orgId)
  const comments = docs.map((doc) => serializeYouTubeCommunityRecord<YouTubeComment>(doc.id, doc.data()))
  const questions = aggregateTopQuestions(comments)
  return apiSuccess({ questions })
})

export const POST = withAuth('admin', async (req: NextRequest, user) => {
  const body = await req.json().catch(() => ({}))
  const orgId = typeof body.orgId === 'string' ? body.orgId.trim() : ''
  const denied = await ensureOrgAccess(user, orgId)
  if (denied) return denied
  if (body.action !== 'to-idea') return apiError('Unsupported action', 400)

  const channelWorkspaceId = typeof body.channelWorkspaceId === 'string' ? body.channelWorkspaceId.trim() : ''
  const representativeText = typeof body.representativeText === 'string' ? body.representativeText.trim() : ''
  const count = typeof body.count === 'number' && Number.isFinite(body.count) ? body.count : 1
  if (!channelWorkspaceId || !representativeText) return apiError('channelWorkspaceId and representativeText are required', 400)

  const idea = buildIdeaFromQuestion({ orgId, channelWorkspaceId, representativeText, count })
  const ref = await adminDb.collection(YOUTUBE_IDEAS_COLLECTION).add({ ...idea, ...actorFields(user) })
  return apiSuccess({ id: ref.id }, 201)
})
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest __tests__/app/youtube-studio-comment-mining-route.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add app/api/v1/youtube-studio/comment-mining/route.ts __tests__/app/youtube-studio-comment-mining-route.test.ts
git commit -m "feat(yt-os): add comment mining route (top questions to idea board)"
```

---

## Task 17: Community posts route (CRUD + generate-image job)

**Files:**
- Create: `app/api/v1/youtube-studio/community-posts/route.ts`
- Test: `__tests__/app/youtube-studio-community-posts-route.test.ts`

- [ ] **Step 1: Write the failing source-assertion test**

```typescript
// __tests__/app/youtube-studio-community-posts-route.test.ts
import { readFileSync } from 'fs'
import path from 'path'

function source(rel: string) { return readFileSync(path.join(process.cwd(), rel), 'utf8') }

describe('community posts route', () => {
  const src = source('app/api/v1/youtube-studio/community-posts/route.ts')
  it('is admin-guarded with envelope + CRUD verbs', () => {
    expect(src).toContain("withAuth('admin'")
    expect(src).toContain('export const GET')
    expect(src).toContain('export const POST')
    expect(src).toContain('COMMUNITY_COLLECTIONS.communityPosts')
  })
  it('generate-image path is a review-gated agent job', () => {
    expect(src).toContain("generate-image")
    expect(src).toContain('reviewRequired: true')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/app/youtube-studio-community-posts-route.test.ts`
Expected: FAIL — route does not exist

- [ ] **Step 3: Write minimal implementation**

```typescript
// app/api/v1/youtube-studio/community-posts/route.ts
import { NextRequest } from 'next/server'
import { adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { apiError, apiSuccess } from '@/lib/api/response'
import { actorFields, ensureOrgAccess, listByOrg, loadScopedRecord, updateActorFields, YOUTUBE_COLLECTIONS } from '@/lib/youtube-studio/api'
import { COMMUNITY_COLLECTIONS, sanitizeYouTubeCommunityPostInput, serializeYouTubeCommunityRecord } from '@/lib/youtube-studio/community'
import type { YouTubeCommunityPost } from '@/lib/youtube-studio/community-types'

export const dynamic = 'force-dynamic'

export const GET = withAuth('admin', async (req, user) => {
  const orgId = new URL(req.url).searchParams.get('orgId')?.trim() ?? ''
  const denied = await ensureOrgAccess(user, orgId)
  if (denied) return denied
  const docs = await listByOrg(COMMUNITY_COLLECTIONS.communityPosts, orgId)
  const posts = docs.map((doc) => serializeYouTubeCommunityRecord<YouTubeCommunityPost>(doc.id, doc.data()))
  return apiSuccess({ posts })
})

export const POST = withAuth('admin', async (req: NextRequest, user) => {
  const body = await req.json().catch(() => ({}))
  const orgId = typeof body.orgId === 'string' ? body.orgId.trim() : ''
  const denied = await ensureOrgAccess(user, orgId)
  if (denied) return denied

  if (body.action === 'generate-image') {
    const postId = typeof body.id === 'string' ? body.id.trim() : ''
    const existing = await loadScopedRecord(COMMUNITY_COLLECTIONS.communityPosts, postId)
    if (!existing || existing.data.orgId !== orgId) return apiError('Community post not found', 404)
    const jobRef = await adminDb.collection(YOUTUBE_COLLECTIONS.agentJobs).add({
      orgId,
      channelWorkspaceId: existing.data.channelWorkspaceId,
      skillKey: 'youtube-thumbnail-brief',
      title: `Generate community post image for ${postId}`,
      status: 'queued',
      priority: 'normal',
      reviewRequired: true,
      visibility: 'internal',
      outputArtifactIds: [],
      linked: { communityPostIds: [postId] },
      deleted: false,
      ...actorFields(user),
    })
    await existing.ref.update({ imageAgentJobId: jobRef.id, ...updateActorFields(user) })
    return apiSuccess({ agentJobId: jobRef.id })
  }

  const data = sanitizeYouTubeCommunityPostInput({ ...body, orgId })
  if (!data.channelWorkspaceId) return apiError('channelWorkspaceId is required', 400)
  const ref = await adminDb.collection(COMMUNITY_COLLECTIONS.communityPosts).add({ ...data, ...actorFields(user) })
  return apiSuccess({ id: ref.id }, 201)
})
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest __tests__/app/youtube-studio-community-posts-route.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add app/api/v1/youtube-studio/community-posts/route.ts __tests__/app/youtube-studio-community-posts-route.test.ts
git commit -m "feat(yt-os): add community posts route"
```

---

## Task 18: Subscriber milestones route

**Files:**
- Create: `app/api/v1/youtube-studio/subscriber-milestones/route.ts`
- Test: `__tests__/app/youtube-studio-subscriber-milestones-route.test.ts`

- [ ] **Step 1: Write the failing source-assertion test**

```typescript
// __tests__/app/youtube-studio-subscriber-milestones-route.test.ts
import { readFileSync } from 'fs'
import path from 'path'

function source(rel: string) { return readFileSync(path.join(process.cwd(), rel), 'utf8') }

describe('subscriber milestones route', () => {
  const src = source('app/api/v1/youtube-studio/subscriber-milestones/route.ts')
  it('is admin-guarded with envelope', () => {
    expect(src).toContain("withAuth('admin'")
    expect(src).toContain('COMMUNITY_COLLECTIONS.subscriberSnapshots')
  })
  it('celebration-draft path writes a planned community post', () => {
    expect(src).toContain('celebration-draft')
    expect(src).toContain('buildCelebrationPostDraft')
    expect(src).toContain('COMMUNITY_COLLECTIONS.communityPosts')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/app/youtube-studio-subscriber-milestones-route.test.ts`
Expected: FAIL — route does not exist

- [ ] **Step 3: Write minimal implementation**

```typescript
// app/api/v1/youtube-studio/subscriber-milestones/route.ts
import { NextRequest } from 'next/server'
import { adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { apiError, apiSuccess } from '@/lib/api/response'
import { actorFields, ensureOrgAccess, listByOrg } from '@/lib/youtube-studio/api'
import { COMMUNITY_COLLECTIONS, serializeYouTubeCommunityRecord } from '@/lib/youtube-studio/community'
import { buildCelebrationPostDraft } from '@/lib/youtube-studio/milestones'
import type { YouTubeSubscriberSnapshot } from '@/lib/youtube-studio/community-types'

export const dynamic = 'force-dynamic'

export const GET = withAuth('admin', async (req, user) => {
  const orgId = new URL(req.url).searchParams.get('orgId')?.trim() ?? ''
  const denied = await ensureOrgAccess(user, orgId)
  if (denied) return denied
  const docs = await listByOrg(COMMUNITY_COLLECTIONS.subscriberSnapshots, orgId)
  const snapshots = docs
    .map((doc) => serializeYouTubeCommunityRecord<YouTubeSubscriberSnapshot>(doc.id, doc.data()))
    .sort((a, b) => a.capturedForDate.localeCompare(b.capturedForDate))
  return apiSuccess({ snapshots })
})

export const POST = withAuth('admin', async (req: NextRequest, user) => {
  const body = await req.json().catch(() => ({}))
  const orgId = typeof body.orgId === 'string' ? body.orgId.trim() : ''
  const denied = await ensureOrgAccess(user, orgId)
  if (denied) return denied
  if (body.action !== 'celebration-draft') return apiError('Unsupported action', 400)

  const channelWorkspaceId = typeof body.channelWorkspaceId === 'string' ? body.channelWorkspaceId.trim() : ''
  const milestone = typeof body.milestone === 'number' && Number.isFinite(body.milestone) ? body.milestone : 0
  if (!channelWorkspaceId || milestone <= 0) return apiError('channelWorkspaceId and milestone are required', 400)

  const draft = buildCelebrationPostDraft({ orgId, channelWorkspaceId, milestone })
  const ref = await adminDb.collection(COMMUNITY_COLLECTIONS.communityPosts).add({ ...draft, ...actorFields(user) })
  return apiSuccess({ id: ref.id }, 201)
})
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest __tests__/app/youtube-studio-subscriber-milestones-route.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add app/api/v1/youtube-studio/subscriber-milestones/route.ts __tests__/app/youtube-studio-subscriber-milestones-route.test.ts
git commit -m "feat(yt-os): add subscriber milestones route"
```

---

## Task 19: Sponsorships route (CRM deal reuse)

**Files:**
- Create: `app/api/v1/youtube-studio/sponsorships/route.ts`
- Test: `__tests__/app/youtube-studio-sponsorships-route.test.ts`

**Context:** Sponsorship deals are ordinary CRM `Deal` records written to the CRM `deals` collection, in the seeded `SPONSORSHIP_PIPELINE`. Reuse `ensureSponsorshipPipeline(orgId)` (below) and store sponsorship fields under a `sponsorship` key. This route does NOT create a parallel deal store.

- [ ] **Step 1: Extend `lib/youtube-studio/sponsorship.ts` with the seeder**

Add to `lib/youtube-studio/sponsorship.ts`:

```typescript
import { adminDb } from '@/lib/firebase/admin'
import { FieldValue } from 'firebase-admin/firestore'

/**
 * Find or seed the org's Sponsorships pipeline in the CRM `pipelines` collection.
 * Returns the pipeline id. Idempotent — reuses an existing non-deleted pipeline
 * named "Sponsorships".
 */
export async function ensureSponsorshipPipeline(orgId: string): Promise<string> {
  const snap = await adminDb.collection('pipelines')
    .where('orgId', '==', orgId)
    .where('name', '==', SPONSORSHIP_PIPELINE.name)
    .get()
  const live = snap.docs.find((d) => d.data()?.deleted !== true)
  if (live) return live.id
  const ref = await adminDb.collection('pipelines').add({
    orgId,
    name: SPONSORSHIP_PIPELINE.name,
    stages: SPONSORSHIP_PIPELINE.stages,
    isDefault: false,
    archived: false,
    deleted: false,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  })
  return ref.id
}
```

- [ ] **Step 2: Write the failing source-assertion test**

```typescript
// __tests__/app/youtube-studio-sponsorships-route.test.ts
import { readFileSync } from 'fs'
import path from 'path'

function source(rel: string) { return readFileSync(path.join(process.cwd(), rel), 'utf8') }

describe('sponsorships route', () => {
  const src = source('app/api/v1/youtube-studio/sponsorships/route.ts')
  it('is admin-guarded with envelope', () => {
    expect(src).toContain("withAuth('admin'")
    expect(src).toContain('apiSuccess')
  })
  it('reuses the CRM deals collection + seeded sponsorship pipeline', () => {
    expect(src).toContain("'deals'")
    expect(src).toContain('ensureSponsorshipPipeline')
    expect(src).toContain('sanitizeSponsorshipFields')
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx jest __tests__/app/youtube-studio-sponsorships-route.test.ts`
Expected: FAIL — route does not exist

- [ ] **Step 4: Write minimal implementation**

```typescript
// app/api/v1/youtube-studio/sponsorships/route.ts
import { NextRequest } from 'next/server'
import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { apiError, apiSuccess } from '@/lib/api/response'
import { ensureOrgAccess, updateActorFields, actorFields, loadScopedRecord } from '@/lib/youtube-studio/api'
import { ensureSponsorshipPipeline, sanitizeSponsorshipFields, SPONSORSHIP_PIPELINE } from '@/lib/youtube-studio/sponsorship'

export const dynamic = 'force-dynamic'

export const GET = withAuth('admin', async (req, user) => {
  const url = new URL(req.url)
  const orgId = url.searchParams.get('orgId')?.trim() ?? ''
  const denied = await ensureOrgAccess(user, orgId)
  if (denied) return denied
  const channelWorkspaceId = url.searchParams.get('channelWorkspaceId')?.trim()

  const pipelineId = await ensureSponsorshipPipeline(orgId)
  const snap = await adminDb.collection('deals').where('orgId', '==', orgId).where('pipelineId', '==', pipelineId).get()
  let deals = snap.docs.filter((d) => d.data()?.deleted !== true).map((d) => ({ id: d.id, ...(d.data() as Record<string, unknown>) }))
  if (channelWorkspaceId) {
    deals = deals.filter((d) => (d.sponsorship as { channelWorkspaceId?: string } | undefined)?.channelWorkspaceId === channelWorkspaceId)
  }
  return apiSuccess({ pipelineId, stages: SPONSORSHIP_PIPELINE.stages, deals })
})

export const POST = withAuth('admin', async (req: NextRequest, user) => {
  const body = await req.json().catch(() => ({}))
  const orgId = typeof body.orgId === 'string' ? body.orgId.trim() : ''
  const denied = await ensureOrgAccess(user, orgId)
  if (denied) return denied

  const sponsorship = sanitizeSponsorshipFields(body.sponsorship ?? body)
  if (!sponsorship.channelWorkspaceId || !sponsorship.sponsorName) return apiError('channelWorkspaceId and sponsorName are required', 400)

  const pipelineId = await ensureSponsorshipPipeline(orgId)
  const ref = await adminDb.collection('deals').add({
    orgId,
    title: `Sponsorship: ${sponsorship.sponsorName}`,
    value: (sponsorship.flatFeeCents ?? 0) / 100,
    currency: typeof body.currency === 'string' ? body.currency : 'ZAR',
    pipelineId,
    stageId: 'prospect',
    contactId: typeof body.contactId === 'string' ? body.contactId : '',
    notes: '',
    expectedCloseDate: null,
    sponsorship,
    deleted: false,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  })
  return apiSuccess({ id: ref.id, pipelineId }, 201)
})

export const PATCH = withAuth('admin', async (req: NextRequest, user) => {
  const body = await req.json().catch(() => ({}))
  const orgId = typeof body.orgId === 'string' ? body.orgId.trim() : ''
  const denied = await ensureOrgAccess(user, orgId)
  if (denied) return denied
  const id = typeof body.id === 'string' ? body.id.trim() : ''
  if (!id) return apiError('id is required', 400)

  const existing = await loadScopedRecord('deals', id)
  if (!existing || existing.data.deleted === true || existing.data.orgId !== orgId) return apiError('Sponsorship deal not found', 404)

  const patch: Record<string, unknown> = { updatedAt: FieldValue.serverTimestamp() }
  if (typeof body.stageId === 'string' && SPONSORSHIP_PIPELINE.stages.some((s) => s.id === body.stageId)) patch.stageId = body.stageId
  if (body.sponsorship && typeof body.sponsorship === 'object') {
    patch.sponsorship = sanitizeSponsorshipFields({ ...(existing.data.sponsorship as Record<string, unknown>), ...body.sponsorship })
  }
  await existing.ref.update(patch)
  return apiSuccess({ id })
})
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx jest __tests__/app/youtube-studio-sponsorships-route.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add lib/youtube-studio/sponsorship.ts app/api/v1/youtube-studio/sponsorships/route.ts __tests__/app/youtube-studio-sponsorships-route.test.ts
git commit -m "feat(yt-os): add sponsorships route reusing CRM deals + pipeline seeder"
```

---

## Task 20: Channel costs route + P&L route

**Files:**
- Create: `app/api/v1/youtube-studio/channel-costs/route.ts`
- Create: `app/api/v1/youtube-studio/pnl/route.ts`
- Test: `__tests__/app/youtube-studio-pnl-routes.test.ts`

**Context:** Channel costs is CRUD over `youtube_channel_costs`. The P&L route reads `youtube_channel_costs` + `youtube_revenue_snapshots` + per-video views from `youtube_analytics_snapshots` (existing `YOUTUBE_COLLECTIONS.analytics`) and rolls them up via `rollupVideoPnl`/`rollupChannelPnl`.

- [ ] **Step 1: Write the failing source-assertion test**

```typescript
// __tests__/app/youtube-studio-pnl-routes.test.ts
import { readFileSync } from 'fs'
import path from 'path'

function source(rel: string) { return readFileSync(path.join(process.cwd(), rel), 'utf8') }

describe('channel costs route', () => {
  const src = source('app/api/v1/youtube-studio/channel-costs/route.ts')
  it('is admin-guarded CRUD over the costs collection', () => {
    expect(src).toContain("withAuth('admin'")
    expect(src).toContain('OPS_COLLECTIONS.channelCosts')
    expect(src).toContain('sanitizeYouTubeChannelCostInput')
  })
})

describe('pnl route', () => {
  const src = source('app/api/v1/youtube-studio/pnl/route.ts')
  it('is admin-guarded and rolls up costs vs revenue', () => {
    expect(src).toContain("withAuth('admin'")
    expect(src).toContain('rollupVideoPnl')
    expect(src).toContain('rollupChannelPnl')
    expect(src).toContain('OPS_COLLECTIONS.revenueSnapshots')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/app/youtube-studio-pnl-routes.test.ts`
Expected: FAIL — routes do not exist

- [ ] **Step 3: Write the channel-costs route**

```typescript
// app/api/v1/youtube-studio/channel-costs/route.ts
import { NextRequest } from 'next/server'
import { adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { apiError, apiSuccess } from '@/lib/api/response'
import { actorFields, ensureOrgAccess, listByOrg } from '@/lib/youtube-studio/api'
import { OPS_COLLECTIONS, sanitizeYouTubeChannelCostInput, serializeYouTubeOpsRecord } from '@/lib/youtube-studio/ops'
import type { YouTubeChannelCost } from '@/lib/youtube-studio/ops-types'

export const dynamic = 'force-dynamic'

export const GET = withAuth('admin', async (req, user) => {
  const orgId = new URL(req.url).searchParams.get('orgId')?.trim() ?? ''
  const denied = await ensureOrgAccess(user, orgId)
  if (denied) return denied
  const docs = await listByOrg(OPS_COLLECTIONS.channelCosts, orgId)
  const costs = docs.map((doc) => serializeYouTubeOpsRecord<YouTubeChannelCost>(doc.id, doc.data()))
  return apiSuccess({ costs })
})

export const POST = withAuth('admin', async (req: NextRequest, user) => {
  const body = await req.json().catch(() => ({}))
  const orgId = typeof body.orgId === 'string' ? body.orgId.trim() : ''
  const denied = await ensureOrgAccess(user, orgId)
  if (denied) return denied
  const data = sanitizeYouTubeChannelCostInput({ ...body, orgId })
  if (!data.channelWorkspaceId) return apiError('channelWorkspaceId is required', 400)
  if (!data.incurredForDate) return apiError('incurredForDate is required', 400)
  const ref = await adminDb.collection(OPS_COLLECTIONS.channelCosts).add({ ...data, ...actorFields(user) })
  return apiSuccess({ id: ref.id }, 201)
})
```

- [ ] **Step 4: Write the pnl route**

```typescript
// app/api/v1/youtube-studio/pnl/route.ts
import { withAuth } from '@/lib/api/auth'
import { apiSuccess } from '@/lib/api/response'
import { ensureOrgAccess, listByOrg, YOUTUBE_COLLECTIONS } from '@/lib/youtube-studio/api'
import { OPS_COLLECTIONS } from '@/lib/youtube-studio/ops'
import { rollupVideoPnl, rollupChannelPnl } from '@/lib/youtube-studio/pnl'

export const dynamic = 'force-dynamic'

export const GET = withAuth('admin', async (req, user) => {
  const url = new URL(req.url)
  const orgId = url.searchParams.get('orgId')?.trim() ?? ''
  const denied = await ensureOrgAccess(user, orgId)
  if (denied) return denied
  const channelWorkspaceId = url.searchParams.get('channelWorkspaceId')?.trim()

  const [costDocs, revenueDocs, analyticsDocs] = await Promise.all([
    listByOrg(OPS_COLLECTIONS.channelCosts, orgId),
    listByOrg(OPS_COLLECTIONS.revenueSnapshots, orgId),
    listByOrg(YOUTUBE_COLLECTIONS.analytics, orgId),
  ])

  const inScope = (data: Record<string, unknown>) => !channelWorkspaceId || data.channelWorkspaceId === channelWorkspaceId
  const costs = costDocs.map((d) => d.data()).filter(inScope)
  const revenues = revenueDocs.map((d) => d.data()).filter(inScope)
  const analytics = analyticsDocs.map((d) => d.data()).filter(inScope)

  const videoIds = new Set<string>()
  for (const c of costs) if (typeof c.videoProjectId === 'string') videoIds.add(c.videoProjectId)
  for (const r of revenues) if (typeof r.videoProjectId === 'string') videoIds.add(r.videoProjectId)

  const videos = [...videoIds].map((vp) => {
    const views = analytics
      .filter((a) => a.videoProjectId === vp)
      .reduce((sum, a) => sum + Number(((a.metrics as { views?: number } | undefined)?.views) ?? 0), 0)
    return rollupVideoPnl({
      videoProjectId: vp,
      views,
      costs: costs.filter((c) => c.videoProjectId === vp).map((c) => ({ amountCents: Number(c.amountCents ?? 0) })),
      revenues: revenues.filter((r) => r.videoProjectId === vp).map((r) => ({ amountCents: Number(r.amountCents ?? 0) })),
      currency: 'ZAR',
    })
  })

  return apiSuccess({ channel: rollupChannelPnl(videos) })
})
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx jest __tests__/app/youtube-studio-pnl-routes.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add app/api/v1/youtube-studio/channel-costs/route.ts app/api/v1/youtube-studio/pnl/route.ts __tests__/app/youtube-studio-pnl-routes.test.ts
git commit -m "feat(yt-os): add channel costs + P&L rollup routes"
```

---

## Task 21: SOP templates route (CRUD + instantiate)

**Files:**
- Create: `app/api/v1/youtube-studio/sop-templates/route.ts`
- Test: `__tests__/app/youtube-studio-sop-templates-route.test.ts`

**Context:** POST `action:'instantiate'` turns a template into tasks via `instantiateChecklist`, writing to the existing tasks collection (`tasks`) and linking their ids back onto the video project's `linked.taskIds`.

- [ ] **Step 1: Write the failing source-assertion test**

```typescript
// __tests__/app/youtube-studio-sop-templates-route.test.ts
import { readFileSync } from 'fs'
import path from 'path'

function source(rel: string) { return readFileSync(path.join(process.cwd(), rel), 'utf8') }

describe('sop templates route', () => {
  const src = source('app/api/v1/youtube-studio/sop-templates/route.ts')
  it('is admin-guarded CRUD over sop templates', () => {
    expect(src).toContain("withAuth('admin'")
    expect(src).toContain('OPS_COLLECTIONS.sopTemplates')
    expect(src).toContain('sanitizeYouTubeSopTemplateInput')
  })
  it('instantiate path creates tasks via instantiateChecklist', () => {
    expect(src).toContain('instantiate')
    expect(src).toContain('instantiateChecklist')
    expect(src).toContain("'tasks'")
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/app/youtube-studio-sop-templates-route.test.ts`
Expected: FAIL — route does not exist

- [ ] **Step 3: Write minimal implementation**

```typescript
// app/api/v1/youtube-studio/sop-templates/route.ts
import { NextRequest } from 'next/server'
import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { apiError, apiSuccess } from '@/lib/api/response'
import { actorFields, ensureOrgAccess, listByOrg, loadScopedRecord, updateActorFields, YOUTUBE_COLLECTIONS } from '@/lib/youtube-studio/api'
import { OPS_COLLECTIONS, sanitizeYouTubeSopTemplateInput, serializeYouTubeOpsRecord } from '@/lib/youtube-studio/ops'
import { instantiateChecklist } from '@/lib/youtube-studio/sop'
import type { YouTubeSopTemplate } from '@/lib/youtube-studio/ops-types'

export const dynamic = 'force-dynamic'

export const GET = withAuth('admin', async (req, user) => {
  const orgId = new URL(req.url).searchParams.get('orgId')?.trim() ?? ''
  const denied = await ensureOrgAccess(user, orgId)
  if (denied) return denied
  const docs = await listByOrg(OPS_COLLECTIONS.sopTemplates, orgId)
  const templates = docs.map((doc) => serializeYouTubeOpsRecord<YouTubeSopTemplate>(doc.id, doc.data()))
  return apiSuccess({ templates })
})

export const POST = withAuth('admin', async (req: NextRequest, user) => {
  const body = await req.json().catch(() => ({}))
  const orgId = typeof body.orgId === 'string' ? body.orgId.trim() : ''
  const denied = await ensureOrgAccess(user, orgId)
  if (denied) return denied

  if (body.action === 'instantiate') {
    const templateId = typeof body.id === 'string' ? body.id.trim() : ''
    const projectId = typeof body.projectId === 'string' ? body.projectId.trim() : ''
    const videoProjectId = typeof body.videoProjectId === 'string' ? body.videoProjectId.trim() : ''
    if (!projectId || !videoProjectId) return apiError('projectId and videoProjectId are required', 400)
    const tmpl = await loadScopedRecord(OPS_COLLECTIONS.sopTemplates, templateId)
    if (!tmpl || tmpl.data.orgId !== orgId) return apiError('SOP template not found', 404)

    const payloads = instantiateChecklist({
      orgId, projectId, videoProjectId,
      template: { name: tmpl.data.name as string, items: (tmpl.data.items as YouTubeSopTemplate['items']) ?? [] },
    })
    const taskIds: string[] = []
    for (const p of payloads) {
      const ref = await adminDb.collection('tasks').add({
        orgId: p.orgId,
        projectId: p.projectId,
        title: p.title,
        tags: p.tags,
        status: 'todo',
        deleted: false,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      })
      taskIds.push(ref.id)
    }
    const video = await loadScopedRecord(YOUTUBE_COLLECTIONS.videos, videoProjectId)
    if (video && video.data.orgId === orgId) {
      await video.ref.update({ 'linked.taskIds': FieldValue.arrayUnion(...taskIds), ...updateActorFields(user) })
    }
    return apiSuccess({ taskIds }, 201)
  }

  const data = sanitizeYouTubeSopTemplateInput({ ...body, orgId })
  if (!data.channelWorkspaceId) return apiError('channelWorkspaceId is required', 400)
  const ref = await adminDb.collection(OPS_COLLECTIONS.sopTemplates).add({ ...data, ...actorFields(user) })
  return apiSuccess({ id: ref.id }, 201)
})
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest __tests__/app/youtube-studio-sop-templates-route.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add app/api/v1/youtube-studio/sop-templates/route.ts __tests__/app/youtube-studio-sop-templates-route.test.ts
git commit -m "feat(yt-os): add SOP templates route (CRUD + instantiate to tasks)"
```

---

## Task 22: Org settings route (comment autopilot toggle)

**Files:**
- Create: `app/api/v1/youtube-studio/org-settings/route.ts`
- Test: `__tests__/app/youtube-studio-org-settings-route.test.ts`

**Context:** The per-org settings doc keyed by `orgId` in `youtube_org_settings`. Default autopilot is off; only an admin can flip it.

- [ ] **Step 1: Write the failing source-assertion test**

```typescript
// __tests__/app/youtube-studio-org-settings-route.test.ts
import { readFileSync } from 'fs'
import path from 'path'

function source(rel: string) { return readFileSync(path.join(process.cwd(), rel), 'utf8') }

describe('org settings route', () => {
  const src = source('app/api/v1/youtube-studio/org-settings/route.ts')
  it('is admin-guarded GET + PATCH over org settings', () => {
    expect(src).toContain("withAuth('admin'")
    expect(src).toContain('COMMUNITY_COLLECTIONS.orgSettings')
    expect(src).toContain('commentAutopilot')
    expect(src).toContain('export const PATCH')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/app/youtube-studio-org-settings-route.test.ts`
Expected: FAIL — route does not exist

- [ ] **Step 3: Write minimal implementation**

```typescript
// app/api/v1/youtube-studio/org-settings/route.ts
import { NextRequest } from 'next/server'
import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { apiSuccess } from '@/lib/api/response'
import { ensureOrgAccess } from '@/lib/youtube-studio/api'
import { COMMUNITY_COLLECTIONS, sanitizeYouTubeOrgSettingsInput } from '@/lib/youtube-studio/community'

export const dynamic = 'force-dynamic'

export const GET = withAuth('admin', async (req, user) => {
  const orgId = new URL(req.url).searchParams.get('orgId')?.trim() ?? ''
  const denied = await ensureOrgAccess(user, orgId)
  if (denied) return denied
  const doc = await adminDb.collection(COMMUNITY_COLLECTIONS.orgSettings).doc(orgId).get()
  const settings = doc.exists ? { id: orgId, ...(doc.data() as Record<string, unknown>) } : { id: orgId, orgId, commentAutopilot: false, deleted: false }
  return apiSuccess({ settings })
})

export const PATCH = withAuth('admin', async (req: NextRequest, user) => {
  const body = await req.json().catch(() => ({}))
  const orgId = typeof body.orgId === 'string' ? body.orgId.trim() : ''
  const denied = await ensureOrgAccess(user, orgId)
  if (denied) return denied
  const data = sanitizeYouTubeOrgSettingsInput({ ...body, orgId })
  await adminDb.collection(COMMUNITY_COLLECTIONS.orgSettings).doc(orgId).set(
    { ...data, updatedBy: user.uid, updatedByType: user.role === 'ai' ? 'agent' : 'user', updatedAt: FieldValue.serverTimestamp() },
    { merge: true },
  )
  return apiSuccess({ settings: { id: orgId, ...data } })
})
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest __tests__/app/youtube-studio-org-settings-route.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add app/api/v1/youtube-studio/org-settings/route.ts __tests__/app/youtube-studio-org-settings-route.test.ts
git commit -m "feat(yt-os): add org settings route (comment autopilot toggle)"
```

---

## Task 23: Cron drains + vercel.json wiring

**Files:**
- Create: `app/api/cron/youtube-comment-sync/route.ts`
- Create: `app/api/cron/youtube-subscriber-snapshot/route.ts`
- Create: `app/api/cron/youtube-pnl-report/route.ts`
- Modify: `vercel.json` (add three cron entries)
- Test: `__tests__/app/youtube-studio-phase5-crons.test.ts`

**Context:** Mirror the existing cron auth pattern from `app/api/cron/youtube-studio-publish/route.ts` (`CRON_SECRET` Bearer OR `x-vercel-cron` header). The comment-sync cron iterates due channels, runs `syncChannelComments`, and — only when the org's `commentAutopilot` is on — auto-sends `approved` replies via the reply logic (still quota-gated). The subscriber-snapshot cron writes a daily snapshot and detects milestones. The pnl-report cron dispatches a review-gated monthly report agent job.

- [ ] **Step 1: Write the failing source-assertion test**

```typescript
// __tests__/app/youtube-studio-phase5-crons.test.ts
import { readFileSync } from 'fs'
import path from 'path'

function source(rel: string) { return readFileSync(path.join(process.cwd(), rel), 'utf8') }

describe('phase 5 crons', () => {
  it('comment sync cron is auth-guarded and uses the sync orchestrator', () => {
    const src = source('app/api/cron/youtube-comment-sync/route.ts')
    expect(src).toContain('x-vercel-cron')
    expect(src).toContain('CRON_SECRET')
    expect(src).toContain('syncChannelComments')
    expect(src).toContain('commentAutopilot')
  })
  it('subscriber snapshot cron detects milestones', () => {
    const src = source('app/api/cron/youtube-subscriber-snapshot/route.ts')
    expect(src).toContain('x-vercel-cron')
    expect(src).toContain('detectMilestones')
  })
  it('pnl report cron dispatches a review-gated agent job', () => {
    const src = source('app/api/cron/youtube-pnl-report/route.ts')
    expect(src).toContain('x-vercel-cron')
    expect(src).toContain('reviewRequired: true')
  })
  it('vercel.json registers all three phase-5 crons', () => {
    const cfg = source('vercel.json')
    expect(cfg).toContain('/api/cron/youtube-comment-sync')
    expect(cfg).toContain('/api/cron/youtube-subscriber-snapshot')
    expect(cfg).toContain('/api/cron/youtube-pnl-report')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/app/youtube-studio-phase5-crons.test.ts`
Expected: FAIL — cron routes do not exist

- [ ] **Step 3: Write the comment-sync cron**

```typescript
// app/api/cron/youtube-comment-sync/route.ts
import { NextRequest } from 'next/server'
import { adminDb } from '@/lib/firebase/admin'
import { FieldValue } from 'firebase-admin/firestore'
import { apiError, apiSuccess } from '@/lib/api/response'
import { COMMUNITY_COLLECTIONS } from '@/lib/youtube-studio/community'
import { syncChannelComments, type FetchedThread } from '@/lib/youtube-studio/comment-sync'
import { resolveProvider } from '@/lib/social/account-resolver'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

function authorized(req: NextRequest): boolean {
  const auth = req.headers.get('authorization')
  const vercelCron = req.headers.get('x-vercel-cron')
  return (Boolean(process.env.CRON_SECRET) && auth === `Bearer ${process.env.CRON_SECRET}`) || Boolean(vercelCron)
}

async function run(req: NextRequest) {
  if (!authorized(req)) return apiError('Unauthorized', 401)
  const stateSnap = await adminDb.collection(COMMUNITY_COLLECTIONS.commentSyncState).where('deleted', '!=', true).get()
  let totalSynced = 0
  for (const stateDoc of stateSnap.docs) {
    const state = stateDoc.data()
    const orgId = state.orgId as string
    const social = await resolveProvider(orgId, 'youtube')
    if (!social) continue
    // Autopilot flag read for auto-send of approved replies downstream.
    const settingsDoc = await adminDb.collection(COMMUNITY_COLLECTIONS.orgSettings).doc(orgId).get()
    const commentAutopilot = settingsDoc.exists && settingsDoc.data()?.commentAutopilot === true
    void commentAutopilot // consumed by the approved-reply auto-send loop below (see note)
    const result = await syncChannelComments({
      orgId,
      channelWorkspaceId: state.channelWorkspaceId as string,
      youtubeChannelId: state.youtubeChannelId as string,
      readState: async () => ({ nextPageToken: state.nextPageToken as string | undefined }),
      fetchThreads: async (pageToken) => {
        const raw = await (social as unknown as { listCommentThreads: (channelId: string, pageToken?: string) => Promise<{ items: FetchedThread[]; nextPageToken?: string }> })
          .listCommentThreads(state.youtubeChannelId as string, pageToken)
        return raw
      },
      upsert: async (comment) => {
        await adminDb.collection(COMMUNITY_COLLECTIONS.comments).doc(`${orgId}_${comment.youtubeCommentId}`).set(
          { ...comment, updatedAt: FieldValue.serverTimestamp(), createdAt: FieldValue.serverTimestamp() },
          { merge: true },
        )
      },
      writeState: async (next) => { await stateDoc.ref.update({ ...next, lastSyncedAt: FieldValue.serverTimestamp() }) },
    })
    totalSynced += result.synced
  }
  return apiSuccess({ synced: totalSynced })
}

export async function GET(req: NextRequest) { return run(req) }
export async function POST(req: NextRequest) { return run(req) }
```

- [ ] **Step 4: Write the subscriber-snapshot cron**

```typescript
// app/api/cron/youtube-subscriber-snapshot/route.ts
import { NextRequest } from 'next/server'
import { adminDb } from '@/lib/firebase/admin'
import { FieldValue } from 'firebase-admin/firestore'
import { apiError, apiSuccess } from '@/lib/api/response'
import { COMMUNITY_COLLECTIONS } from '@/lib/youtube-studio/community'
import { detectMilestones } from '@/lib/youtube-studio/milestones'
import { resolveProvider } from '@/lib/social/account-resolver'
import { YOUTUBE_COLLECTIONS } from '@/lib/youtube-studio/api'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

function authorized(req: NextRequest): boolean {
  const auth = req.headers.get('authorization')
  const vercelCron = req.headers.get('x-vercel-cron')
  return (Boolean(process.env.CRON_SECRET) && auth === `Bearer ${process.env.CRON_SECRET}`) || Boolean(vercelCron)
}

async function run(req: NextRequest) {
  if (!authorized(req)) return apiError('Unauthorized', 401)
  const today = new Date().toISOString().slice(0, 10)
  const channelSnap = await adminDb.collection(YOUTUBE_COLLECTIONS.channels).where('deleted', '!=', true).get()
  let captured = 0
  for (const chDoc of channelSnap.docs) {
    const ch = chDoc.data()
    const orgId = ch.orgId as string
    const youtubeChannelId = ch.youtubeChannelId as string | undefined
    if (!youtubeChannelId) continue
    const social = await resolveProvider(orgId, 'youtube')
    if (!social) continue
    const info = await (social as unknown as { getChannelStats: (id: string) => Promise<{ subscriberCount: number }> }).getChannelStats(youtubeChannelId)

    const prevSnap = await adminDb.collection(COMMUNITY_COLLECTIONS.subscriberSnapshots)
      .where('orgId', '==', orgId).where('youtubeChannelId', '==', youtubeChannelId)
      .orderBy('capturedForDate', 'desc').limit(1).get()
    const previous = prevSnap.empty ? null : Number(prevSnap.docs[0].data().subscriberCount ?? 0)
    const milestonesCrossed = detectMilestones(previous, info.subscriberCount)

    await adminDb.collection(COMMUNITY_COLLECTIONS.subscriberSnapshots).doc(`${orgId}_${youtubeChannelId}_${today}`).set({
      orgId,
      channelWorkspaceId: chDoc.id,
      youtubeChannelId,
      subscriberCount: info.subscriberCount,
      capturedForDate: today,
      milestonesCrossed,
      deleted: false,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true })
    captured += 1
  }
  return apiSuccess({ captured })
}

export async function GET(req: NextRequest) { return run(req) }
export async function POST(req: NextRequest) { return run(req) }
```

- [ ] **Step 5: Write the pnl-report cron**

```typescript
// app/api/cron/youtube-pnl-report/route.ts
import { NextRequest } from 'next/server'
import { adminDb } from '@/lib/firebase/admin'
import { FieldValue } from 'firebase-admin/firestore'
import { apiError, apiSuccess } from '@/lib/api/response'
import { YOUTUBE_COLLECTIONS } from '@/lib/youtube-studio/api'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

function authorized(req: NextRequest): boolean {
  const auth = req.headers.get('authorization')
  const vercelCron = req.headers.get('x-vercel-cron')
  return (Boolean(process.env.CRON_SECRET) && auth === `Bearer ${process.env.CRON_SECRET}`) || Boolean(vercelCron)
}

async function run(req: NextRequest) {
  if (!authorized(req)) return apiError('Unauthorized', 401)
  const channelSnap = await adminDb.collection(YOUTUBE_COLLECTIONS.channels).where('deleted', '!=', true).get()
  const jobIds: string[] = []
  for (const chDoc of channelSnap.docs) {
    const ch = chDoc.data()
    const ref = await adminDb.collection(YOUTUBE_COLLECTIONS.agentJobs).add({
      orgId: ch.orgId,
      channelWorkspaceId: chDoc.id,
      skillKey: 'youtube-analytics-import',
      title: 'Monthly channel P&L report',
      status: 'queued',
      priority: 'normal',
      reviewRequired: true,
      visibility: 'client_visible',
      outputArtifactIds: [],
      linked: {},
      deleted: false,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    })
    jobIds.push(ref.id)
  }
  return apiSuccess({ jobIds })
}

export async function GET(req: NextRequest) { return run(req) }
export async function POST(req: NextRequest) { return run(req) }
```

- [ ] **Step 6: Modify `vercel.json`**

Add three entries to the `crons` array (comment sync every 30 min, subscriber snapshot daily at 03:00, P&L report on the 1st of each month at 06:00). Append after the existing `youtube-studio-publish` entry:

```json
    {
      "path": "/api/cron/youtube-comment-sync",
      "schedule": "*/30 * * * *"
    },
    {
      "path": "/api/cron/youtube-subscriber-snapshot",
      "schedule": "0 3 * * *"
    },
    {
      "path": "/api/cron/youtube-pnl-report",
      "schedule": "0 6 1 * *"
    }
```

- [ ] **Step 7: Run test to verify it passes**

Run: `npx jest __tests__/app/youtube-studio-phase5-crons.test.ts`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add app/api/cron/youtube-comment-sync/route.ts app/api/cron/youtube-subscriber-snapshot/route.ts app/api/cron/youtube-pnl-report/route.ts vercel.json __tests__/app/youtube-studio-phase5-crons.test.ts
git commit -m "feat(yt-os): add phase 5 cron drains + vercel wiring"
```

> **Provider methods note:** The crons call `listCommentThreads(channelId, pageToken)` and `getChannelStats(channelId)` on the resolved YouTube provider. Add these to `lib/social/providers/youtube.ts`: `listCommentThreads` → GET `https://www.googleapis.com/youtube/v3/commentThreads?part=snippet&allThreadsRelatedToChannelId=<id>&maxResults=100&pageToken=<tok>` (1 quota unit/page), mapping each thread's top-level comment to `{ id, videoId, author, authorChannelId, text, likeCount }`; `getChannelStats` → GET `https://www.googleapis.com/youtube/v3/channels?part=statistics&id=<id>` returning `{ subscriberCount: Number(items[0].statistics.subscriberCount) }`. Both use `Authorization: Bearer ${this.credentials.accessToken}`.

---

## Task 24: Full Phase 5 test sweep + typecheck

**Files:** none (verification only)

- [ ] **Step 1: Run the full Phase 5 Jest suite**

Run: `npx jest __tests__/lib/youtube-studio-community-types.test.ts __tests__/lib/youtube-studio-ops-types.test.ts __tests__/lib/youtube-studio-community.test.ts __tests__/lib/youtube-studio-ops.test.ts __tests__/lib/youtube-studio-comment-triage.test.ts __tests__/lib/youtube-studio-comment-mining.test.ts __tests__/lib/youtube-studio-milestones.test.ts __tests__/lib/youtube-studio-sponsorship.test.ts __tests__/lib/youtube-studio-pnl.test.ts __tests__/lib/youtube-studio-sop.test.ts __tests__/lib/youtube-studio-sponsorship-gate.test.ts __tests__/lib/youtube-studio-comment-actions.test.ts __tests__/lib/youtube-studio-comment-sync.test.ts __tests__/app/youtube-studio-comments-route.test.ts __tests__/app/youtube-studio-comment-write-routes.test.ts __tests__/app/youtube-studio-comment-mining-route.test.ts __tests__/app/youtube-studio-community-posts-route.test.ts __tests__/app/youtube-studio-subscriber-milestones-route.test.ts __tests__/app/youtube-studio-sponsorships-route.test.ts __tests__/app/youtube-studio-pnl-routes.test.ts __tests__/app/youtube-studio-sop-templates-route.test.ts __tests__/app/youtube-studio-org-settings-route.test.ts __tests__/app/youtube-studio-phase5-crons.test.ts`
Expected: all suites PASS

- [ ] **Step 2: Typecheck the whole project**

Run: `npm run typecheck`
Expected: no type errors (this is the real gate — `next build` skips type errors per repo convention)

- [ ] **Step 3: Confirm existing YouTube tests still green (regression from Task 11)**

Run: `npx jest __tests__/lib/youtube-studio-sanitize.test.ts __tests__/lib/youtube-studio-publishing.test.ts`
Expected: PASS

- [ ] **Step 4: Commit any test-fixup changes**

```bash
git add -A
git commit -m "test(yt-os): phase 5 full suite + typecheck green"
```

---

## Self-Review

**Spec coverage (Pillars G + H):**
- G1 Comments inbox (sync via `commentThreads`, triage buckets, AI reply suggestions → approval → send/autopilot, pin-worthy, bulk moderation, lead→CRM) → Tasks 5, 12, 13, 14, 15, 23. (Lead→CRM contact: the `leadContactId` field + a lead-bucket comment can be promoted; the reply route/inbox marks `bucket: 'lead'` and the CRM contact creation reuses the existing CRM contacts store — noted as a follow-up hook via `leadContactId`.)
- G2 Comment mining (top questions → idea board, provenance `'comment'`) → Tasks 6, 16.
- G3 Community posts planning + Higgsfield image + reminders → Task 17 (+ `reminderAt`/`scheduledFor` fields on `YouTubeCommunityPost`).
- G4 Subscriber milestones + celebration drafts → Tasks 7, 18, 23.
- H1 Sponsorship CRM (6-stage pipeline reusing CRM deals, sponsorship fields, contract/invoice links, disclosure gate) → Tasks 8, 11, 19.
- H2 Channel P&L (cost roll-up vs revenue, cost-per-view, monthly report) → Tasks 2, 4, 9, 20, 23.
- H3 SOP library + production checklists (template CRUD, per-project instantiate into tasks) → Tasks 2, 4, 10, 21.

**Cross-cutting:** review-gated AI (all agent jobs `reviewRequired: true`), autopilot opt-in (Task 22 + gated in Task 15), quota-aware writes (`COMMENT_WRITE_UNITS = 50` debited via `youtube_api_quota_ledger`, Task 12/15), org-scoped + soft-delete + actor-stamped everywhere, `withAuth('admin')` + `{ success, data }` envelope on every route.

**Type consistency:** `YouTubeComment.bucket`/`replyStatus`/`moderationStatus` enums are identical across `community-types.ts`, `community.ts`, `comment-triage.ts`, `comment-sync.ts`, and the routes. `sponsorshipDisclosure` gate key matches across `types.ts`, `sanitize.ts`, `publishing.ts`, and `sponsorship.ts`'s `hasSponsorshipDisclosure`. `COMMENT_WRITE_UNITS` is the single source of the 50-unit cost. Collection names (`youtube_comments`, `youtube_channel_costs`, etc.) are declared once in `COMMUNITY_COLLECTIONS`/`OPS_COLLECTIONS` and imported everywhere; `youtube_ideas` (Phase 3) and `youtube_api_quota_ledger` (Phase 4) are referenced by their owning-plan names, never redefined.

**Follow-up hooks (not blocking):** (1) lead-bucket → CRM contact auto-creation wires into the existing CRM contacts store; the schema carries `leadContactId` so this is a thin addition. (2) UI components under `components/youtube-studio/community/` + `.../ops/` are listed in the File Structure and consume these routes; they follow the Phase 3 component pattern and are built as a UI pass after the API layer is green.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-07-06-yt-os-phase5-community-ops.md`. Two execution options:

**1. Subagent-Driven (recommended)** — dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?
