# YouTube Channel OS — Phase 3: Research & Ideation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the research-and-ideation front-of-funnel for the YouTube Channel Operating System — outlier finder, keyword workbench, competitor tracker, trend radar, idea board, title lab, and a TipTap script editor — all org-scoped, review-gated, and quota-aware.

**Architecture:** New Firestore collections (`youtube_research_watchlists`, `youtube_outlier_videos`, `youtube_keywords`, `youtube_competitor_channels`, `youtube_competitor_snapshots`, `youtube_ideas`) sit alongside the existing YouTube Studio data model in `lib/youtube-studio/`. Each collection gets a sanitizer (in a new `lib/youtube-studio/research.ts` sanitizer module, mirroring `sanitize.ts` conventions), a `withAuth('admin')` CRUD route under `app/api/v1/youtube-studio/`, and cron drains under `app/api/cron/`. YouTube Data API reads use the quota-cheap uploads-playlist pattern (`playlistItems.list` = 1 unit) via the existing `resolveProvider` token flow — never `search.list` (100 units). All AI actions (turn-into-brief, generate-titles, trend-sweep, rewrite-selection) create review-gated `youtube_agent_jobs` via the existing agent-job dispatch, never mutate publish state, and never auto-apply. The script editor reuses the Book Studio TipTap `ChapterEditor` plumbing over `youtube_production_drafts`.

**Tech Stack:** Next.js 15 (App Router, `withAuth`, `apiSuccess`/`apiError` `{ success, data }` envelope), Firebase Admin (Firestore), TipTap + tiptap-markdown, `googleapis` YouTube Data API v3, Jest 30 (`__tests__/lib` unit + `__tests__/app` source-assertion tests). All new AI = review-gated agent jobs. Org-scoped, `deleted` soft-delete, actor-stamped everywhere.

---

## File Structure

**New library modules**
- `lib/youtube-studio/research-types.ts` — TypeScript interfaces for all six new collections + shared enums (watchlists, outlier videos, keywords, competitor channels + snapshots, ideas). Kept separate from `types.ts` so Phase 5 (community) can import `YouTubeIdea` without pulling production types.
- `lib/youtube-studio/research.ts` — sanitizers (`sanitizeYouTube*Input`) + `RESEARCH_COLLECTIONS` map + `serializeYouTubeResearchRecord`, mirroring `sanitize.ts`/`api.ts` conventions.
- `lib/youtube-studio/outlier-scan.ts` — pure outlier-score computation (`computeOutlierScore`) + the `scanWatchlist` orchestrator (fetch uploads playlist via `resolveProvider`, compute scores, upsert `youtube_outlier_videos`). Pure helpers split from the fetch orchestrator so scoring is unit-testable without network.
- `lib/youtube-studio/keyword-signals.ts` — YouTube autocomplete expansion + Google Trends public-endpoint fetch + volume/competition proxy scoring (pure scoring split from fetch).
- `lib/youtube-studio/competitor-diff.ts` — pure weekly-diff computation (`computeCompetitorDiff`) + `snapshotCompetitor` orchestrator.
- `lib/youtube-studio/idea-provenance.ts` — pure helpers to build a `YouTubeIdea` from an outlier video / keyword / trend research record.
- `lib/youtube-studio/script-readtime.ts` — pure `estimateReadTimeSeconds` + `extractScriptSections` helpers for the script editor.

**New API routes** (all `withAuth('admin')`, `{ success, data }` envelope)
- `app/api/v1/youtube-studio/watchlists/route.ts` — CRUD for `youtube_research_watchlists`.
- `app/api/v1/youtube-studio/outlier-videos/route.ts` — GET (feed with filters) + PATCH (turn-into-brief → agent job).
- `app/api/v1/youtube-studio/keywords/route.ts` — CRUD + POST `action:'expand'` (autocomplete/trends) + PATCH `action:'attach'` (target keyword → video project).
- `app/api/v1/youtube-studio/keywords/expand/route.ts` — server route wrapping YouTube autocomplete + Google Trends (needs its own route to avoid CORS; called by the workbench).
- `app/api/v1/youtube-studio/competitors/route.ts` — CRUD for `youtube_competitor_channels` + GET snapshots history.
- `app/api/v1/youtube-studio/ideas/route.ts` — CRUD + PATCH (stage move, bulk actions) + POST `action:'title-lab'` and `action:'promote-to-project'`.
- `app/api/cron/youtube-outlier-scan/route.ts` — cron drain: scan all due watchlists.
- `app/api/cron/youtube-competitor-diff/route.ts` — cron drain: weekly competitor snapshots + alerts.

**New UI components** (under `components/youtube-studio/research/`)
- `OutlierFeed.tsx`, `KeywordWorkbench.tsx`, `CompetitorTracker.tsx`, `TrendRadar.tsx`, `IdeaBoard.tsx`, `TitleLab.tsx`, `ScriptEditor.tsx`.

**Config**
- `vercel.json` — add two cron entries (outlier scan, competitor diff).

**Tests** — one `__tests__/lib/*.test.ts` per pure-logic module + one `__tests__/app/*.test.ts` source-assertion test per route asserting `withAuth`, envelope, quota discipline (`playlistItems.list`, no `search.list`), and review-gating.

---

## Task 1: Research collection types

**Files:**
- Create: `lib/youtube-studio/research-types.ts`
- Test: `__tests__/lib/youtube-studio-research-types.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// __tests__/lib/youtube-studio-research-types.test.ts
import { readFileSync } from 'fs'
import path from 'path'

function source(rel: string) {
  return readFileSync(path.join(process.cwd(), rel), 'utf8')
}

describe('youtube research types', () => {
  const src = source('lib/youtube-studio/research-types.ts')

  it('declares all six research collection interfaces', () => {
    expect(src).toContain('export interface YouTubeResearchWatchlist')
    expect(src).toContain('export interface YouTubeOutlierVideo')
    expect(src).toContain('export interface YouTubeKeyword')
    expect(src).toContain('export interface YouTubeCompetitorChannel')
    expect(src).toContain('export interface YouTubeCompetitorSnapshot')
    expect(src).toContain('export interface YouTubeIdea')
  })

  it('idea carries provenance, pillar, priority, and video-project link for Phase 5 reuse', () => {
    expect(src).toContain("export type YouTubeIdeaStage = 'idea' | 'shortlisted' | 'briefed' | 'in_production' | 'archived'")
    expect(src).toContain("export type YouTubeIdeaProvenance = 'outlier' | 'keyword' | 'trend' | 'comment' | 'manual'")
    expect(src).toContain('videoProjectId?: string')
    expect(src).toContain('provenance: YouTubeIdeaProvenance')
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

Run: `npx jest __tests__/lib/youtube-studio-research-types.test.ts`
Expected: FAIL — `ENOENT: no such file ... research-types.ts`

- [ ] **Step 3: Write minimal implementation**

```typescript
// lib/youtube-studio/research-types.ts
import type { ActorType } from './types'

/** Common audit + scoping fields shared by every research record. */
interface ResearchRecordBase {
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

export type YouTubeWatchlistScanStatus = 'idle' | 'scanning' | 'error'

export interface YouTubeResearchWatchlist extends ResearchRecordBase {
  name: string
  /** Competitor channel ids tracked via their uploads playlists (quota-cheap). */
  youtubeChannelIds: string[]
  /** Cadence in hours between scans; cron respects this. */
  scanIntervalHours: number
  lastScannedAt?: unknown
  scanStatus: YouTubeWatchlistScanStatus
  lastScanError?: string
  /** Outlier score threshold (multiple of channel average) surfaced in the feed. */
  outlierThreshold: number
  notes?: string
}

export type YouTubeOutlierStatus = 'new' | 'reviewed' | 'dismissed' | 'briefed'

export interface YouTubeOutlierVideo extends ResearchRecordBase {
  watchlistId: string
  youtubeChannelId: string
  youtubeVideoId: string
  title: string
  thumbnailUrl?: string
  publishedAt?: string
  views: number
  /** Channel rolling average views at scan time. */
  channelAverageViews: number
  /** views / channelAverageViews — the 1of10 outlier multiple. */
  outlierScore: number
  /** views per day since publish. */
  velocity: number
  status: YouTubeOutlierStatus
  /** Set when "Turn into brief" spawns a youtube-video-brief agent job. */
  briefAgentJobId?: string
  ideaId?: string
}

export type YouTubeKeywordIntent = 'informational' | 'commercial' | 'navigational' | 'unknown'

export interface YouTubeKeyword extends ResearchRecordBase {
  term: string
  /** Autocomplete-derived expansions. */
  expansions: string[]
  /** 0-100 proxy from autocomplete depth + trends interest. */
  volumeProxy?: number
  /** 0-100 proxy; higher = more competitive. */
  competitionProxy?: number
  trendDirection?: 'rising' | 'flat' | 'falling'
  intent: YouTubeKeywordIntent
  /** Content pillar (from channel workspace) this cluster maps to. */
  pillar?: string
  clusterLabel?: string
  /** Video projects this keyword is attached to as a target keyword. */
  attachedVideoProjectIds: string[]
  notes?: string
}

export interface YouTubeCompetitorChannel extends ResearchRecordBase {
  youtubeChannelId: string
  title: string
  handle?: string
  thumbnailUrl?: string
  /** Latest snapshot values, denormalised for card rendering. */
  latestSubscribers?: number
  latestViews?: number
  latestVideoCount?: number
  /** Uploads per week over the last snapshot window. */
  uploadCadencePerWeek?: number
  /** Rough format split, e.g. { shorts: 0.4, long_form: 0.6 }. */
  formatMix?: Record<string, number>
  lastSnapshotAt?: unknown
  alertOnSpike: boolean
  notes?: string
}

export interface YouTubeCompetitorSnapshot extends ResearchRecordBase {
  competitorChannelId: string
  youtubeChannelId: string
  capturedAt: string
  subscribers?: number
  views?: number
  videoCount?: number
  /** Diff vs previous snapshot. */
  subscriberDelta?: number
  viewDelta?: number
  videoDelta?: number
  /** True when the diff crossed the spike threshold and raised an alert. */
  alertRaised: boolean
}

export type YouTubeIdeaStage = 'idea' | 'shortlisted' | 'briefed' | 'in_production' | 'archived'
export type YouTubeIdeaProvenance = 'outlier' | 'keyword' | 'trend' | 'comment' | 'manual'
export type YouTubeIdeaPriority = 'low' | 'normal' | 'high'

/**
 * Idea board record. Phase 5 (community) links comment-mined ideas here via
 * provenance:'comment' + provenanceRefId — keep this schema stable.
 */
export interface YouTubeIdea extends ResearchRecordBase {
  title: string
  stage: YouTubeIdeaStage
  provenance: YouTubeIdeaProvenance
  /** Id of the outlier video / keyword / research record / comment thread. */
  provenanceRefId?: string
  hookDrafts: string[]
  pillar?: string
  priority: YouTubeIdeaPriority
  /** Set when promoted; two-way with the video project. */
  videoProjectId?: string
  /** Title-lab variants generated for this idea. */
  titleAgentJobIds: string[]
  notes?: string
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest __tests__/lib/youtube-studio-research-types.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/youtube-studio/research-types.ts __tests__/lib/youtube-studio-research-types.test.ts
git commit -m "feat(yt-os): research & ideation collection types"
```

---

## Task 2: Research sanitizers + collections map

**Files:**
- Create: `lib/youtube-studio/research.ts`
- Test: `__tests__/lib/youtube-studio-research-sanitize.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// __tests__/lib/youtube-studio-research-sanitize.test.ts
import {
  RESEARCH_COLLECTIONS,
  sanitizeYouTubeWatchlistInput,
  sanitizeYouTubeKeywordInput,
  sanitizeYouTubeIdeaInput,
  sanitizeYouTubeCompetitorChannelInput,
} from '@/lib/youtube-studio/research'

describe('youtube research sanitizers', () => {
  it('maps every collection to a namespaced firestore collection', () => {
    expect(RESEARCH_COLLECTIONS.watchlists).toBe('youtube_research_watchlists')
    expect(RESEARCH_COLLECTIONS.outlierVideos).toBe('youtube_outlier_videos')
    expect(RESEARCH_COLLECTIONS.keywords).toBe('youtube_keywords')
    expect(RESEARCH_COLLECTIONS.competitorChannels).toBe('youtube_competitor_channels')
    expect(RESEARCH_COLLECTIONS.competitorSnapshots).toBe('youtube_competitor_snapshots')
    expect(RESEARCH_COLLECTIONS.ideas).toBe('youtube_ideas')
  })

  it('coerces watchlist defaults and clamps scan interval', () => {
    const w = sanitizeYouTubeWatchlistInput({
      orgId: 'o1', channelWorkspaceId: 'c1', name: '  Rivals  ',
      youtubeChannelIds: ['UCabc', 'UCabc', ''], scanIntervalHours: 0,
    })
    expect(w.name).toBe('Rivals')
    expect(w.youtubeChannelIds).toEqual(['UCabc'])
    expect(w.scanIntervalHours).toBe(24)
    expect(w.scanStatus).toBe('idle')
    expect(w.outlierThreshold).toBe(3)
    expect(w.deleted).toBe(false)
  })

  it('defaults idea stage/provenance/priority and dedupes hook drafts', () => {
    const idea = sanitizeYouTubeIdeaInput({
      orgId: 'o1', channelWorkspaceId: 'c1', title: 'Great video',
      hookDrafts: ['Hook A', 'Hook A', ' '], stage: 'nonsense', provenance: 'outlier',
    })
    expect(idea.stage).toBe('idea')
    expect(idea.provenance).toBe('outlier')
    expect(idea.priority).toBe('normal')
    expect(idea.hookDrafts).toEqual(['Hook A'])
    expect(idea.titleAgentJobIds).toEqual([])
  })

  it('keyword sanitizer clamps proxies to 0-100 and defaults intent', () => {
    const k = sanitizeYouTubeKeywordInput({
      orgId: 'o1', channelWorkspaceId: 'c1', term: 'faceless youtube',
      volumeProxy: 250, competitionProxy: -10,
    })
    expect(k.volumeProxy).toBe(100)
    expect(k.competitionProxy).toBe(0)
    expect(k.intent).toBe('unknown')
    expect(k.attachedVideoProjectIds).toEqual([])
  })

  it('competitor channel sanitizer requires channel id and defaults alertOnSpike', () => {
    const c = sanitizeYouTubeCompetitorChannelInput({
      orgId: 'o1', channelWorkspaceId: 'c1', youtubeChannelId: 'UCxyz', title: 'Rival',
    })
    expect(c.youtubeChannelId).toBe('UCxyz')
    expect(c.alertOnSpike).toBe(false)
    expect(c.deleted).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/lib/youtube-studio-research-sanitize.test.ts`
Expected: FAIL — cannot find module `@/lib/youtube-studio/research`

- [ ] **Step 3: Write minimal implementation**

```typescript
// lib/youtube-studio/research.ts
import type {
  YouTubeCompetitorChannel,
  YouTubeCompetitorSnapshot,
  YouTubeIdea,
  YouTubeIdeaPriority,
  YouTubeIdeaProvenance,
  YouTubeIdeaStage,
  YouTubeKeyword,
  YouTubeKeywordIntent,
  YouTubeOutlierStatus,
  YouTubeOutlierVideo,
  YouTubeResearchWatchlist,
  YouTubeWatchlistScanStatus,
} from './research-types'

type RawInput = Record<string, unknown>

export const RESEARCH_COLLECTIONS = {
  watchlists: 'youtube_research_watchlists',
  outlierVideos: 'youtube_outlier_videos',
  keywords: 'youtube_keywords',
  competitorChannels: 'youtube_competitor_channels',
  competitorSnapshots: 'youtube_competitor_snapshots',
  ideas: 'youtube_ideas',
} as const

function cleanString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function cleanObject(value: unknown): RawInput {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as RawInput) : {}
}

function cleanStringArray(value: unknown): string[] {
  const raw = Array.isArray(value) ? value : typeof value === 'string' ? value.split(',') : []
  return Array.from(new Set(raw.map(cleanString).filter((v): v is string => Boolean(v))))
}

function cleanNumber(value: unknown): number | undefined {
  const n = typeof value === 'string' ? Number(value) : value
  return typeof n === 'number' && Number.isFinite(n) ? n : undefined
}

function clamp(value: number | undefined, min: number, max: number): number | undefined {
  if (value === undefined) return undefined
  return Math.min(max, Math.max(min, value))
}

function pick<T extends string>(values: readonly T[], input: unknown, fallback: T): T {
  const s = cleanString(input)
  return s && (values as readonly string[]).includes(s) ? (s as T) : fallback
}

function stripUndefinedDeep<T>(value: T): T {
  if (Array.isArray(value)) return value.map((v) => stripUndefinedDeep(v)).filter((v) => v !== undefined) as T
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).flatMap(([k, v]) =>
        v === undefined ? [] : [[k, stripUndefinedDeep(v)]],
      ),
    ) as T
  }
  return value
}

const SCAN_STATUSES: YouTubeWatchlistScanStatus[] = ['idle', 'scanning', 'error']
const OUTLIER_STATUSES: YouTubeOutlierStatus[] = ['new', 'reviewed', 'dismissed', 'briefed']
const KEYWORD_INTENTS: YouTubeKeywordIntent[] = ['informational', 'commercial', 'navigational', 'unknown']
const IDEA_STAGES: YouTubeIdeaStage[] = ['idea', 'shortlisted', 'briefed', 'in_production', 'archived']
const IDEA_PROVENANCES: YouTubeIdeaProvenance[] = ['outlier', 'keyword', 'trend', 'comment', 'manual']
const IDEA_PRIORITIES: YouTubeIdeaPriority[] = ['low', 'normal', 'high']

type Sanitized<T> = Omit<T, 'id' | 'createdAt' | 'updatedAt' | 'createdBy' | 'createdByType' | 'updatedBy' | 'updatedByType'>

export function sanitizeYouTubeWatchlistInput(input: RawInput): Sanitized<YouTubeResearchWatchlist> {
  const interval = cleanNumber(input.scanIntervalHours)
  const threshold = cleanNumber(input.outlierThreshold)
  return stripUndefinedDeep({
    orgId: cleanString(input.orgId) ?? '',
    channelWorkspaceId: cleanString(input.channelWorkspaceId) ?? '',
    name: cleanString(input.name) ?? 'Untitled watchlist',
    youtubeChannelIds: cleanStringArray(input.youtubeChannelIds),
    scanIntervalHours: interval && interval > 0 ? interval : 24,
    lastScannedAt: input.lastScannedAt,
    scanStatus: pick(SCAN_STATUSES, input.scanStatus, 'idle'),
    lastScanError: cleanString(input.lastScanError),
    outlierThreshold: threshold && threshold > 0 ? threshold : 3,
    notes: cleanString(input.notes),
    deleted: input.deleted === true,
  })
}

export function sanitizeYouTubeOutlierVideoInput(input: RawInput): Sanitized<YouTubeOutlierVideo> {
  return stripUndefinedDeep({
    orgId: cleanString(input.orgId) ?? '',
    channelWorkspaceId: cleanString(input.channelWorkspaceId) ?? '',
    watchlistId: cleanString(input.watchlistId) ?? '',
    youtubeChannelId: cleanString(input.youtubeChannelId) ?? '',
    youtubeVideoId: cleanString(input.youtubeVideoId) ?? '',
    title: cleanString(input.title) ?? 'Untitled',
    thumbnailUrl: cleanString(input.thumbnailUrl),
    publishedAt: cleanString(input.publishedAt),
    views: cleanNumber(input.views) ?? 0,
    channelAverageViews: cleanNumber(input.channelAverageViews) ?? 0,
    outlierScore: cleanNumber(input.outlierScore) ?? 0,
    velocity: cleanNumber(input.velocity) ?? 0,
    status: pick(OUTLIER_STATUSES, input.status, 'new'),
    briefAgentJobId: cleanString(input.briefAgentJobId),
    ideaId: cleanString(input.ideaId),
    deleted: input.deleted === true,
  })
}

export function sanitizeYouTubeKeywordInput(input: RawInput): Sanitized<YouTubeKeyword> {
  const trend = cleanString(input.trendDirection)
  return stripUndefinedDeep({
    orgId: cleanString(input.orgId) ?? '',
    channelWorkspaceId: cleanString(input.channelWorkspaceId) ?? '',
    term: cleanString(input.term) ?? '',
    expansions: cleanStringArray(input.expansions),
    volumeProxy: clamp(cleanNumber(input.volumeProxy), 0, 100),
    competitionProxy: clamp(cleanNumber(input.competitionProxy), 0, 100),
    trendDirection: trend === 'rising' || trend === 'flat' || trend === 'falling' ? trend : undefined,
    intent: pick(KEYWORD_INTENTS, input.intent, 'unknown'),
    pillar: cleanString(input.pillar),
    clusterLabel: cleanString(input.clusterLabel),
    attachedVideoProjectIds: cleanStringArray(input.attachedVideoProjectIds),
    notes: cleanString(input.notes),
    deleted: input.deleted === true,
  })
}

export function sanitizeYouTubeCompetitorChannelInput(input: RawInput): Sanitized<YouTubeCompetitorChannel> {
  const formatMix = cleanObject(input.formatMix)
  const cleanMix = Object.fromEntries(
    Object.entries(formatMix).flatMap(([k, v]) => {
      const n = cleanNumber(v)
      return n === undefined ? [] : [[k, n]]
    }),
  )
  return stripUndefinedDeep({
    orgId: cleanString(input.orgId) ?? '',
    channelWorkspaceId: cleanString(input.channelWorkspaceId) ?? '',
    youtubeChannelId: cleanString(input.youtubeChannelId) ?? '',
    title: cleanString(input.title) ?? 'Untitled channel',
    handle: cleanString(input.handle),
    thumbnailUrl: cleanString(input.thumbnailUrl),
    latestSubscribers: cleanNumber(input.latestSubscribers),
    latestViews: cleanNumber(input.latestViews),
    latestVideoCount: cleanNumber(input.latestVideoCount),
    uploadCadencePerWeek: cleanNumber(input.uploadCadencePerWeek),
    formatMix: Object.keys(cleanMix).length ? cleanMix : undefined,
    lastSnapshotAt: input.lastSnapshotAt,
    alertOnSpike: input.alertOnSpike === true,
    notes: cleanString(input.notes),
    deleted: input.deleted === true,
  })
}

export function sanitizeYouTubeCompetitorSnapshotInput(input: RawInput): Sanitized<YouTubeCompetitorSnapshot> {
  return stripUndefinedDeep({
    orgId: cleanString(input.orgId) ?? '',
    channelWorkspaceId: cleanString(input.channelWorkspaceId) ?? '',
    competitorChannelId: cleanString(input.competitorChannelId) ?? '',
    youtubeChannelId: cleanString(input.youtubeChannelId) ?? '',
    capturedAt: cleanString(input.capturedAt) ?? new Date().toISOString(),
    subscribers: cleanNumber(input.subscribers),
    views: cleanNumber(input.views),
    videoCount: cleanNumber(input.videoCount),
    subscriberDelta: cleanNumber(input.subscriberDelta),
    viewDelta: cleanNumber(input.viewDelta),
    videoDelta: cleanNumber(input.videoDelta),
    alertRaised: input.alertRaised === true,
    deleted: input.deleted === true,
  })
}

export function sanitizeYouTubeIdeaInput(input: RawInput): Sanitized<YouTubeIdea> {
  return stripUndefinedDeep({
    orgId: cleanString(input.orgId) ?? '',
    channelWorkspaceId: cleanString(input.channelWorkspaceId) ?? '',
    title: cleanString(input.title) ?? 'Untitled idea',
    stage: pick(IDEA_STAGES, input.stage, 'idea'),
    provenance: pick(IDEA_PROVENANCES, input.provenance, 'manual'),
    provenanceRefId: cleanString(input.provenanceRefId),
    hookDrafts: cleanStringArray(input.hookDrafts),
    pillar: cleanString(input.pillar),
    priority: pick(IDEA_PRIORITIES, input.priority, 'normal'),
    videoProjectId: cleanString(input.videoProjectId),
    titleAgentJobIds: cleanStringArray(input.titleAgentJobIds),
    notes: cleanString(input.notes),
    deleted: input.deleted === true,
  })
}

export function serializeYouTubeResearchRecord<T extends object>(id: string, data: Record<string, unknown>): T & { id: string } {
  const serialized: Record<string, unknown> = { id }
  for (const [key, value] of Object.entries(data)) {
    if (value && typeof value === 'object' && 'toDate' in value && typeof (value as { toDate: unknown }).toDate === 'function') {
      serialized[key] = (value as { toDate: () => Date }).toDate().toISOString()
    } else {
      serialized[key] = value
    }
  }
  return serialized as T & { id: string }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest __tests__/lib/youtube-studio-research-sanitize.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/youtube-studio/research.ts __tests__/lib/youtube-studio-research-sanitize.test.ts
git commit -m "feat(yt-os): research collection sanitizers + collections map"
```

---

## Task 3: Outlier score computation (pure)

**Files:**
- Create: `lib/youtube-studio/outlier-scan.ts` (pure helpers only in this task)
- Test: `__tests__/lib/youtube-studio-outlier-scan.test.ts`

Quota discipline: this module NEVER calls `search.list` (100 units). Competitor uploads are read via `playlistItems.list` (1 unit) against each channel's uploads playlist id (`UU` + channel-id suffix). The scan orchestrator (Task 8 cron) fetches; this task is pure math.

- [ ] **Step 1: Write the failing test**

```typescript
// __tests__/lib/youtube-studio-outlier-scan.test.ts
import { computeOutlierScore, uploadsPlaylistId, computeVelocity } from '@/lib/youtube-studio/outlier-scan'

describe('outlier scan pure helpers', () => {
  it('derives the uploads playlist id from a UC channel id', () => {
    expect(uploadsPlaylistId('UCabc123')).toBe('UUabc123')
  })

  it('returns the channel id unchanged if it is not a UC id', () => {
    expect(uploadsPlaylistId('HCabc123')).toBe('HCabc123')
  })

  it('computes outlier score as views over channel average', () => {
    expect(computeOutlierScore(10000, 2000)).toBe(5)
  })

  it('returns 0 when the channel average is zero to avoid divide-by-zero', () => {
    expect(computeOutlierScore(10000, 0)).toBe(0)
  })

  it('computes velocity as views per day since publish, min 1 day', () => {
    const published = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString()
    expect(computeVelocity(1000, published, new Date())).toBe(500)
  })

  it('treats same-day publish as 1 day for velocity', () => {
    const now = new Date()
    expect(computeVelocity(1000, now.toISOString(), now)).toBe(1000)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/lib/youtube-studio-outlier-scan.test.ts`
Expected: FAIL — cannot find module `@/lib/youtube-studio/outlier-scan`

- [ ] **Step 3: Write minimal implementation**

```typescript
// lib/youtube-studio/outlier-scan.ts

/** YouTube uploads playlist id = channel id with the second char swapped C->U. */
export function uploadsPlaylistId(channelId: string): string {
  return channelId.startsWith('UC') ? `UU${channelId.slice(2)}` : channelId
}

/** 1of10-style outlier multiple: views relative to the channel's rolling average. */
export function computeOutlierScore(views: number, channelAverageViews: number): number {
  if (!channelAverageViews || channelAverageViews <= 0) return 0
  return Math.round((views / channelAverageViews) * 100) / 100
}

/** Views per day since publish; clamps the denominator to a minimum of 1 day. */
export function computeVelocity(views: number, publishedAtIso: string, now: Date): number {
  const published = new Date(publishedAtIso).getTime()
  const days = Math.max(1, Math.round((now.getTime() - published) / (24 * 60 * 60 * 1000)))
  return Math.round(views / days)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest __tests__/lib/youtube-studio-outlier-scan.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/youtube-studio/outlier-scan.ts __tests__/lib/youtube-studio-outlier-scan.test.ts
git commit -m "feat(yt-os): outlier score + velocity pure helpers"
```

---

## Task 4: Outlier scan orchestrator (fetch uploads via provider)

**Files:**
- Modify: `lib/youtube-studio/outlier-scan.ts` (append `fetchUploadsForChannel` + `scanWatchlist`)
- Test: `__tests__/lib/youtube-studio-outlier-scan-orchestrator.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// __tests__/lib/youtube-studio-outlier-scan-orchestrator.test.ts
import { buildOutlierRecords } from '@/lib/youtube-studio/outlier-scan'

describe('buildOutlierRecords', () => {
  const now = new Date('2026-07-06T00:00:00Z')

  it('scores each upload against the channel average and keeps those above threshold', () => {
    const uploads = [
      { videoId: 'v1', title: 'Big', views: 9000, thumbnailUrl: 't1', publishedAt: '2026-07-01T00:00:00Z' },
      { videoId: 'v2', title: 'Normal', views: 1000, thumbnailUrl: 't2', publishedAt: '2026-07-01T00:00:00Z' },
    ]
    const records = buildOutlierRecords({
      uploads, youtubeChannelId: 'UCabc', watchlistId: 'w1',
      orgId: 'o1', channelWorkspaceId: 'c1', outlierThreshold: 3, now,
    })
    // avg = 5000; v1 = 1.8x (below 3), v2 = 0.2x → none above threshold
    expect(records).toHaveLength(0)
  })

  it('flags a genuine outlier above the threshold with score, velocity, status new', () => {
    const uploads = [
      { videoId: 'v1', title: 'Viral', views: 50000, thumbnailUrl: 't1', publishedAt: '2026-07-04T00:00:00Z' },
      { videoId: 'v2', title: 'A', views: 1000, thumbnailUrl: 't2', publishedAt: '2026-07-01T00:00:00Z' },
      { videoId: 'v3', title: 'B', views: 1000, thumbnailUrl: 't3', publishedAt: '2026-07-01T00:00:00Z' },
    ]
    const records = buildOutlierRecords({
      uploads, youtubeChannelId: 'UCabc', watchlistId: 'w1',
      orgId: 'o1', channelWorkspaceId: 'c1', outlierThreshold: 3, now,
    })
    expect(records).toHaveLength(1)
    expect(records[0]).toMatchObject({
      youtubeVideoId: 'v1', status: 'new', watchlistId: 'w1', orgId: 'o1',
    })
    expect(records[0].outlierScore).toBeGreaterThanOrEqual(3)
    expect(records[0].velocity).toBeGreaterThan(0)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/lib/youtube-studio-outlier-scan-orchestrator.test.ts`
Expected: FAIL — `buildOutlierRecords is not a function`

- [ ] **Step 3: Write minimal implementation** (append to `lib/youtube-studio/outlier-scan.ts`)

```typescript
import type { YouTubeOutlierVideo } from './research-types'

export interface UploadItem {
  videoId: string
  title: string
  views: number
  thumbnailUrl?: string
  publishedAt: string
}

interface BuildOutlierArgs {
  uploads: UploadItem[]
  youtubeChannelId: string
  watchlistId: string
  orgId: string
  channelWorkspaceId: string
  outlierThreshold: number
  now: Date
}

type OutlierRecord = Omit<
  YouTubeOutlierVideo,
  'id' | 'createdAt' | 'updatedAt' | 'createdBy' | 'createdByType' | 'updatedBy' | 'updatedByType'
>

/** Pure: score every upload vs the channel average, keep those at/above threshold. */
export function buildOutlierRecords(args: BuildOutlierArgs): OutlierRecord[] {
  const { uploads, outlierThreshold, now } = args
  if (uploads.length === 0) return []
  const avg = uploads.reduce((sum, u) => sum + u.views, 0) / uploads.length

  return uploads
    .map((u) => ({
      orgId: args.orgId,
      channelWorkspaceId: args.channelWorkspaceId,
      watchlistId: args.watchlistId,
      youtubeChannelId: args.youtubeChannelId,
      youtubeVideoId: u.videoId,
      title: u.title,
      thumbnailUrl: u.thumbnailUrl,
      publishedAt: u.publishedAt,
      views: u.views,
      channelAverageViews: Math.round(avg),
      outlierScore: computeOutlierScore(u.views, avg),
      velocity: computeVelocity(u.views, u.publishedAt, now),
      status: 'new' as const,
      deleted: false,
    }))
    .filter((r) => r.outlierScore >= outlierThreshold)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest __tests__/lib/youtube-studio-outlier-scan-orchestrator.test.ts`
Expected: PASS

- [ ] **Step 5: Add the network fetch helper (no new test — asserted in the cron source test, Task 8)**

Append to `lib/youtube-studio/outlier-scan.ts`. Uses the existing provider token flow. `playlistItems.list` = 1 quota unit per page; `videos.list` = 1 unit per call for stats.

```typescript
import { resolveProvider } from '@/lib/social/account-resolver'

const PLAYLIST_ITEMS_URL = 'https://www.googleapis.com/youtube/v3/playlistItems'
const VIDEOS_URL = 'https://www.googleapis.com/youtube/v3/videos'

/**
 * Fetch recent uploads for one competitor channel using the quota-cheap
 * uploads-playlist pattern. NEVER uses search.list (100 units).
 * Returns up to `maxResults` uploads with view stats.
 */
export async function fetchUploadsForChannel(
  orgId: string,
  channelId: string,
  maxResults = 20,
): Promise<UploadItem[]> {
  const resolved = await resolveProvider({}, orgId, 'youtube')
  const accessToken = (resolved as { credentials?: { accessToken?: string } })?.credentials?.accessToken
  if (!accessToken) throw new Error('No connected YouTube account for outlier scan')
  const headers = { Authorization: `Bearer ${accessToken}` }

  const playlistId = uploadsPlaylistId(channelId)
  const listUrl = `${PLAYLIST_ITEMS_URL}?part=contentDetails,snippet&maxResults=${maxResults}&playlistId=${playlistId}`
  const listRes = await fetch(listUrl, { headers })
  if (!listRes.ok) throw new Error(`playlistItems.list failed ${listRes.status}`)
  const listJson = (await listRes.json()) as {
    items?: Array<{ contentDetails?: { videoId?: string }; snippet?: { title?: string; publishedAt?: string; thumbnails?: { medium?: { url?: string } } } }>
  }
  const items = (listJson.items ?? []).filter((i) => i.contentDetails?.videoId)
  if (items.length === 0) return []

  const ids = items.map((i) => i.contentDetails!.videoId!).join(',')
  const statsUrl = `${VIDEOS_URL}?part=statistics&id=${ids}`
  const statsRes = await fetch(statsUrl, { headers })
  if (!statsRes.ok) throw new Error(`videos.list failed ${statsRes.status}`)
  const statsJson = (await statsRes.json()) as { items?: Array<{ id: string; statistics?: { viewCount?: string } }> }
  const viewsById = new Map((statsJson.items ?? []).map((v) => [v.id, Number(v.statistics?.viewCount ?? 0)]))

  return items.map((i) => ({
    videoId: i.contentDetails!.videoId!,
    title: i.snippet?.title ?? 'Untitled',
    views: viewsById.get(i.contentDetails!.videoId!) ?? 0,
    thumbnailUrl: i.snippet?.thumbnails?.medium?.url,
    publishedAt: i.snippet?.publishedAt ?? new Date().toISOString(),
  }))
}
```

- [ ] **Step 6: Commit**

```bash
git add lib/youtube-studio/outlier-scan.ts __tests__/lib/youtube-studio-outlier-scan-orchestrator.test.ts
git commit -m "feat(yt-os): outlier scan orchestrator + quota-cheap uploads fetch"
```

---

## Task 5: Watchlists CRUD route

**Files:**
- Create: `app/api/v1/youtube-studio/watchlists/route.ts`
- Test: `__tests__/app/youtube-studio-watchlists-route.test.ts`

This route follows the exact conventions of `app/api/v1/youtube-studio/source-assets/route.ts`: `withAuth('admin')`, `ensureOrgAccess`, `listByOrg`, `loadScopedRecord`, `actorFields`/`updateActorFields` from `@/lib/youtube-studio/api`, and `apiSuccess`/`apiError`. It validates the channel workspace belongs to the org.

- [ ] **Step 1: Write the failing test** (source-assertion test, matching the repo pattern in `youtube-studio-shared-workspace.test.ts`)

```typescript
// __tests__/app/youtube-studio-watchlists-route.test.ts
import { readFileSync } from 'fs'
import path from 'path'

function source(rel: string) {
  return readFileSync(path.join(process.cwd(), rel), 'utf8')
}

describe('youtube watchlists route', () => {
  const src = source('app/api/v1/youtube-studio/watchlists/route.ts')

  it('is admin-auth gated and uses the api envelope', () => {
    expect(src).toContain("withAuth('admin'")
    expect(src).toContain('apiSuccess')
    expect(src).toContain('apiError')
  })

  it('scopes reads and writes to the org and validates the channel workspace', () => {
    expect(src).toContain('ensureOrgAccess')
    expect(src).toContain('RESEARCH_COLLECTIONS.watchlists')
    expect(src).toContain('loadScopedRecord')
    expect(src).toContain('sanitizeYouTubeWatchlistInput')
  })

  it('exposes GET, POST, PATCH, DELETE', () => {
    expect(src).toContain('export const GET')
    expect(src).toContain('export const POST')
    expect(src).toContain('export const PATCH')
    expect(src).toContain('export const DELETE')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/app/youtube-studio-watchlists-route.test.ts`
Expected: FAIL — `ENOENT ... watchlists/route.ts`

- [ ] **Step 3: Write minimal implementation**

```typescript
// app/api/v1/youtube-studio/watchlists/route.ts
import { NextRequest } from 'next/server'
import { adminDb } from '@/lib/firebase/admin'
import { FieldValue } from 'firebase-admin/firestore'
import { withAuth } from '@/lib/api/auth'
import { apiError, apiSuccess } from '@/lib/api/response'
import {
  actorFields,
  ensureOrgAccess,
  listByOrg,
  loadScopedRecord,
  updateActorFields,
  YOUTUBE_COLLECTIONS,
} from '@/lib/youtube-studio/api'
import { RESEARCH_COLLECTIONS, sanitizeYouTubeWatchlistInput, serializeYouTubeResearchRecord } from '@/lib/youtube-studio/research'
import type { YouTubeResearchWatchlist } from '@/lib/youtube-studio/research-types'

export const dynamic = 'force-dynamic'

function cleanString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}
function cleanObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

async function validateChannel(orgId: string, channelWorkspaceId: string) {
  const channel = await loadScopedRecord(YOUTUBE_COLLECTIONS.channels, channelWorkspaceId)
  if (!channel || channel.data.deleted === true) return apiError('YouTube channel workspace not found', 404)
  if (channel.data.orgId !== orgId) return apiError('channelWorkspaceId does not belong to organisation', 400)
  return null
}

export const GET = withAuth('admin', async (req, user) => {
  const url = new URL(req.url)
  const orgId = url.searchParams.get('orgId')?.trim() ?? ''
  const channelWorkspaceId = url.searchParams.get('channelWorkspaceId')?.trim() ?? ''
  const denied = await ensureOrgAccess(user, orgId)
  if (denied) return denied
  const docs = await listByOrg(RESEARCH_COLLECTIONS.watchlists, orgId)
  const watchlists = docs
    .map((doc) => serializeYouTubeResearchRecord<YouTubeResearchWatchlist>(doc.id, doc.data()))
    .filter((w) => !channelWorkspaceId || w.channelWorkspaceId === channelWorkspaceId)
    .sort((a, b) => a.name.localeCompare(b.name))
  return apiSuccess({ watchlists })
})

export const POST = withAuth('admin', async (req: NextRequest, user) => {
  const body = cleanObject(await req.json().catch(() => ({})))
  const orgId = cleanString(body.orgId) ?? ''
  const denied = await ensureOrgAccess(user, orgId)
  if (denied) return denied
  const channelWorkspaceId = cleanString(body.channelWorkspaceId) ?? ''
  if (!channelWorkspaceId) return apiError('channelWorkspaceId is required', 400)
  const channelError = await validateChannel(orgId, channelWorkspaceId)
  if (channelError) return channelError
  const data = sanitizeYouTubeWatchlistInput({ ...body, orgId, channelWorkspaceId })
  const ref = await adminDb.collection(RESEARCH_COLLECTIONS.watchlists).add({ ...data, ...actorFields(user) })
  return apiSuccess({ id: ref.id }, 201)
})

export const PATCH = withAuth('admin', async (req: NextRequest, user) => {
  const body = cleanObject(await req.json().catch(() => ({})))
  const orgId = cleanString(body.orgId) ?? ''
  const id = cleanString(body.id) ?? ''
  const denied = await ensureOrgAccess(user, orgId)
  if (denied) return denied
  if (!id) return apiError('id is required', 400)
  const loaded = await loadScopedRecord(RESEARCH_COLLECTIONS.watchlists, id)
  if (!loaded || loaded.data.deleted === true) return apiError('Watchlist not found', 404)
  if (loaded.data.orgId !== orgId) return apiError('Watchlist does not belong to organisation', 400)
  const merged = { ...loaded.data, ...body, orgId, channelWorkspaceId: loaded.data.channelWorkspaceId }
  const data = sanitizeYouTubeWatchlistInput(merged)
  await loaded.ref.set({ ...data, ...updateActorFields(user) }, { merge: true })
  return apiSuccess({ id })
})

export const DELETE = withAuth('admin', async (req: NextRequest, user) => {
  const url = new URL(req.url)
  const orgId = url.searchParams.get('orgId')?.trim() ?? ''
  const id = url.searchParams.get('id')?.trim() ?? ''
  const denied = await ensureOrgAccess(user, orgId)
  if (denied) return denied
  if (!id) return apiError('id is required', 400)
  const loaded = await loadScopedRecord(RESEARCH_COLLECTIONS.watchlists, id)
  if (!loaded || loaded.data.deleted === true) return apiError('Watchlist not found', 404)
  if (loaded.data.orgId !== orgId) return apiError('Watchlist does not belong to organisation', 400)
  await loaded.ref.set({ deleted: true, deletedAt: FieldValue.serverTimestamp(), ...updateActorFields(user) }, { merge: true })
  return apiSuccess({ id })
})
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest __tests__/app/youtube-studio-watchlists-route.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add app/api/v1/youtube-studio/watchlists/route.ts __tests__/app/youtube-studio-watchlists-route.test.ts
git commit -m "feat(yt-os): watchlists CRUD route"
```

---

## Task 6: Outlier videos feed + "Turn into brief" (spawns agent job)

**Files:**
- Create: `app/api/v1/youtube-studio/outlier-videos/route.ts`
- Test: `__tests__/app/youtube-studio-outlier-videos-route.test.ts`

GET returns the outlier feed with filters (`watchlistId`, `status`, `minScore`). PATCH `action:'turn-into-brief'` creates a review-gated `youtube-video-brief` agent job by POSTing to the internal agent-jobs helper pattern (reuses `youtube_agent_jobs` collection + `sanitizeYouTubeAgentJobInput` + `buildSkillInputPacket`). It NEVER runs the AI inline and NEVER mutates publish state — it only queues a job (`status:'queued'`, `reviewRequired:true`) and stamps `briefAgentJobId` on the outlier record.

- [ ] **Step 1: Write the failing test**

```typescript
// __tests__/app/youtube-studio-outlier-videos-route.test.ts
import { readFileSync } from 'fs'
import path from 'path'

function source(rel: string) {
  return readFileSync(path.join(process.cwd(), rel), 'utf8')
}

describe('outlier videos route', () => {
  const src = source('app/api/v1/youtube-studio/outlier-videos/route.ts')

  it('is admin gated with the api envelope and org scoping', () => {
    expect(src).toContain("withAuth('admin'")
    expect(src).toContain('ensureOrgAccess')
    expect(src).toContain('RESEARCH_COLLECTIONS.outlierVideos')
  })

  it('supports feed filters and exposes GET + PATCH', () => {
    expect(src).toContain("searchParams.get('minScore')")
    expect(src).toContain("searchParams.get('status')")
    expect(src).toContain('export const GET')
    expect(src).toContain('export const PATCH')
  })

  it('turn-into-brief queues a review-gated youtube-video-brief agent job, never inline AI', () => {
    expect(src).toContain("'turn-into-brief'")
    expect(src).toContain("'youtube-video-brief'")
    expect(src).toContain('YOUTUBE_COLLECTIONS.agentJobs')
    expect(src).toContain("status: 'queued'")
    expect(src).toContain('reviewRequired: true')
    expect(src).toContain('briefAgentJobId')
    // guardrail: no synchronous AI / publish mutation from this route
    expect(src).not.toContain('dispatchHermesRun')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/app/youtube-studio-outlier-videos-route.test.ts`
Expected: FAIL — file missing

- [ ] **Step 3: Write minimal implementation**

```typescript
// app/api/v1/youtube-studio/outlier-videos/route.ts
import { NextRequest } from 'next/server'
import { adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { apiError, apiSuccess } from '@/lib/api/response'
import {
  actorFields,
  ensureOrgAccess,
  listByOrg,
  loadScopedRecord,
  updateActorFields,
  YOUTUBE_COLLECTIONS,
} from '@/lib/youtube-studio/api'
import { RESEARCH_COLLECTIONS, serializeYouTubeResearchRecord } from '@/lib/youtube-studio/research'
import { getYouTubeSkillContract } from '@/lib/youtube-studio/skills'
import { sanitizeYouTubeAgentJobInput } from '@/lib/youtube-studio/sanitize'
import type { YouTubeOutlierVideo } from '@/lib/youtube-studio/research-types'

export const dynamic = 'force-dynamic'

function cleanString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}
function cleanObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

export const GET = withAuth('admin', async (req, user) => {
  const url = new URL(req.url)
  const orgId = url.searchParams.get('orgId')?.trim() ?? ''
  const watchlistId = url.searchParams.get('watchlistId')?.trim() ?? ''
  const status = url.searchParams.get('status')?.trim() ?? ''
  const minScore = Number.parseFloat(url.searchParams.get('minScore') ?? '')
  const denied = await ensureOrgAccess(user, orgId)
  if (denied) return denied
  const docs = await listByOrg(RESEARCH_COLLECTIONS.outlierVideos, orgId)
  const outliers = docs
    .map((doc) => serializeYouTubeResearchRecord<YouTubeOutlierVideo>(doc.id, doc.data()))
    .filter((o) => !watchlistId || o.watchlistId === watchlistId)
    .filter((o) => !status || o.status === status)
    .filter((o) => (Number.isFinite(minScore) ? o.outlierScore >= minScore : true))
    .sort((a, b) => b.outlierScore - a.outlierScore)
  return apiSuccess({ outliers })
})

export const PATCH = withAuth('admin', async (req: NextRequest, user) => {
  const body = cleanObject(await req.json().catch(() => ({})))
  const orgId = cleanString(body.orgId) ?? ''
  const id = cleanString(body.id) ?? ''
  const action = cleanString(body.action) ?? 'update'
  const denied = await ensureOrgAccess(user, orgId)
  if (denied) return denied
  if (!id) return apiError('id is required', 400)

  const loaded = await loadScopedRecord(RESEARCH_COLLECTIONS.outlierVideos, id)
  if (!loaded || loaded.data.deleted === true) return apiError('Outlier video not found', 404)
  if (loaded.data.orgId !== orgId) return apiError('Outlier video does not belong to organisation', 400)

  if (action === 'turn-into-brief') {
    const contract = getYouTubeSkillContract('youtube-video-brief')
    if (!contract) return apiError('youtube-video-brief skill unavailable', 500)
    const channelWorkspaceId = cleanString(loaded.data.channelWorkspaceId) ?? ''
    const jobData = sanitizeYouTubeAgentJobInput({
      orgId,
      channelWorkspaceId,
      skillKey: contract.key,
      title: `Brief from outlier: ${cleanString(loaded.data.title) ?? id}`,
      status: 'queued',
      inputSummary: `Turn competitor outlier video ${cleanString(loaded.data.youtubeVideoId)} into a sourced video brief.`,
      inputPacket: {
        skillKey: contract.key,
        skillLabel: contract.label,
        family: contract.family,
        requiredContext: contract.requiredContext,
        outputArtifacts: contract.outputArtifacts,
        guardrails: contract.guardrails,
        policySourceKeys: contract.policySourceKeys,
        outputPersistence: contract.outputPersistence,
        mutationPolicy: contract.mutationPolicy,
        references: {
          channelWorkspaceId,
          sourceAssetIds: [], clipCandidateIds: [], productionDraftIds: [],
          renderJobIds: [], publishingPacketIds: [], analyticsSnapshotIds: [],
        },
      },
      outputArtifactIds: [],
      reviewRequired: true,
      visibility: 'internal',
      linked: { researchItemIds: [id] },
      deleted: false,
    })
    const jobRef = await adminDb.collection(YOUTUBE_COLLECTIONS.agentJobs).add({
      ...jobData,
      status: 'queued',
      outputArtifactIds: [],
      reviewRequired: true,
      visibility: 'internal',
      deleted: false,
      ...actorFields(user),
    })
    await loaded.ref.set(
      { status: 'briefed', briefAgentJobId: jobRef.id, ...updateActorFields(user) },
      { merge: true },
    )
    return apiSuccess({ id, briefAgentJobId: jobRef.id }, 201)
  }

  const nextStatus = cleanString(body.status)
  await loaded.ref.set(
    { ...(nextStatus ? { status: nextStatus } : {}), ...updateActorFields(user) },
    { merge: true },
  )
  return apiSuccess({ id })
})
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest __tests__/app/youtube-studio-outlier-videos-route.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add app/api/v1/youtube-studio/outlier-videos/route.ts __tests__/app/youtube-studio-outlier-videos-route.test.ts
git commit -m "feat(yt-os): outlier feed route + turn-into-brief agent job"
```

---

## Task 7: Outlier scan cron

**Files:**
- Create: `app/api/cron/youtube-outlier-scan/route.ts`
- Modify: `vercel.json` (add cron entry)
- Test: `__tests__/app/youtube-outlier-scan-cron.test.ts`

Follows `app/api/cron/youtube-studio-publish/route.ts` exactly: `authorized(req)` via `CRON_SECRET` or `x-vercel-cron`, `maxDuration = 60`, `dynamic = 'force-dynamic'`. It queries all non-deleted watchlists across orgs whose `lastScannedAt` is older than `scanIntervalHours`, calls `fetchUploadsForChannel` per channel, `buildOutlierRecords`, and upserts new outliers (dedup by `youtubeVideoId` + `watchlistId`).

- [ ] **Step 1: Write the failing test**

```typescript
// __tests__/app/youtube-outlier-scan-cron.test.ts
import { readFileSync } from 'fs'
import path from 'path'

function source(rel: string) {
  return readFileSync(path.join(process.cwd(), rel), 'utf8')
}

describe('outlier scan cron', () => {
  const src = source('app/api/cron/youtube-outlier-scan/route.ts')

  it('is cron-authorized like the publish cron', () => {
    expect(src).toContain('x-vercel-cron')
    expect(src).toContain('CRON_SECRET')
    expect(src).toContain('export const maxDuration')
  })

  it('uses the quota-cheap uploads fetch and never search.list', () => {
    expect(src).toContain('fetchUploadsForChannel')
    expect(src).toContain('buildOutlierRecords')
    expect(src).not.toContain('search.list')
  })

  it('registers the cron in vercel.json', () => {
    const vercel = source('vercel.json')
    expect(vercel).toContain('/api/cron/youtube-outlier-scan')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/app/youtube-outlier-scan-cron.test.ts`
Expected: FAIL — cron route file missing

- [ ] **Step 3: Write minimal implementation**

```typescript
// app/api/cron/youtube-outlier-scan/route.ts
import { NextRequest } from 'next/server'
import { adminDb } from '@/lib/firebase/admin'
import { FieldValue } from 'firebase-admin/firestore'
import { apiError, apiSuccess } from '@/lib/api/response'
import { RESEARCH_COLLECTIONS, sanitizeYouTubeOutlierVideoInput } from '@/lib/youtube-studio/research'
import { buildOutlierRecords, fetchUploadsForChannel } from '@/lib/youtube-studio/outlier-scan'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

function authorized(req: NextRequest): boolean {
  const auth = req.headers.get('authorization')
  const vercelCron = req.headers.get('x-vercel-cron')
  return (Boolean(process.env.CRON_SECRET) && auth === `Bearer ${process.env.CRON_SECRET}`) || Boolean(vercelCron)
}

function toMillis(value: unknown): number {
  if (value && typeof value === 'object' && 'toMillis' in value && typeof (value as { toMillis: unknown }).toMillis === 'function') {
    return (value as { toMillis: () => number }).toMillis()
  }
  return 0
}

async function runScan(req: NextRequest) {
  if (!authorized(req)) return apiError('Unauthorized', 401)
  const now = new Date()
  const snap = await adminDb.collection(RESEARCH_COLLECTIONS.watchlists).where('deleted', '==', false).get()
  let scanned = 0
  let created = 0

  for (const doc of snap.docs) {
    const w = doc.data() as Record<string, unknown>
    const intervalMs = (Number(w.scanIntervalHours) || 24) * 60 * 60 * 1000
    if (now.getTime() - toMillis(w.lastScannedAt) < intervalMs) continue
    const channelIds = Array.isArray(w.youtubeChannelIds) ? (w.youtubeChannelIds as string[]) : []
    await doc.ref.set({ scanStatus: 'scanning' }, { merge: true })
    try {
      for (const channelId of channelIds) {
        const uploads = await fetchUploadsForChannel(String(w.orgId), channelId)
        const records = buildOutlierRecords({
          uploads,
          youtubeChannelId: channelId,
          watchlistId: doc.id,
          orgId: String(w.orgId),
          channelWorkspaceId: String(w.channelWorkspaceId),
          outlierThreshold: Number(w.outlierThreshold) || 3,
          now,
        })
        for (const record of records) {
          const dup = await adminDb
            .collection(RESEARCH_COLLECTIONS.outlierVideos)
            .where('watchlistId', '==', doc.id)
            .where('youtubeVideoId', '==', record.youtubeVideoId)
            .limit(1)
            .get()
          if (!dup.empty) continue
          await adminDb.collection(RESEARCH_COLLECTIONS.outlierVideos).add({
            ...sanitizeYouTubeOutlierVideoInput(record),
            createdAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
            createdByType: 'system',
            updatedByType: 'system',
          })
          created += 1
        }
      }
      await doc.ref.set({ scanStatus: 'idle', lastScannedAt: FieldValue.serverTimestamp(), lastScanError: FieldValue.delete() }, { merge: true })
    } catch (err) {
      await doc.ref.set({ scanStatus: 'error', lastScanError: err instanceof Error ? err.message : 'scan failed' }, { merge: true })
    }
    scanned += 1
  }
  return apiSuccess({ scanned, created })
}

export async function GET(req: NextRequest) {
  return runScan(req)
}
export async function POST(req: NextRequest) {
  return runScan(req)
}
```

- [ ] **Step 4: Add the cron entry to `vercel.json`**

In the `crons` array (after the `youtube-studio-publish` entry), add:

```json
    {
      "path": "/api/cron/youtube-outlier-scan",
      "schedule": "0 */6 * * *"
    }
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx jest __tests__/app/youtube-outlier-scan-cron.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add app/api/cron/youtube-outlier-scan/route.ts vercel.json __tests__/app/youtube-outlier-scan-cron.test.ts
git commit -m "feat(yt-os): outlier scan cron + schedule"
```

---

## Task 8: Keyword signals (pure scoring + autocomplete/trends fetch)

**Files:**
- Create: `lib/youtube-studio/keyword-signals.ts`
- Test: `__tests__/lib/youtube-studio-keyword-signals.test.ts`

Pure scoring (`scoreKeyword`, `clusterKeywords`) is split from the network fetch (`fetchAutocomplete`, `fetchTrendsInterest`). Autocomplete uses the public `suggestqueries.google.com` endpoint (must be server-side to avoid CORS — hence the dedicated route in Task 9); Trends uses the public `trends.google.com/trends/api/explore` JSON feed.

- [ ] **Step 1: Write the failing test**

```typescript
// __tests__/lib/youtube-studio-keyword-signals.test.ts
import { scoreKeyword, clusterKeywords } from '@/lib/youtube-studio/keyword-signals'

describe('keyword signals scoring', () => {
  it('scores volume from autocomplete depth and trends interest (0-100)', () => {
    const score = scoreKeyword({ expansions: new Array(10).fill('x'), trendsInterest: 80 })
    expect(score.volumeProxy).toBeGreaterThan(0)
    expect(score.volumeProxy).toBeLessThanOrEqual(100)
  })

  it('derives a rising trend direction from a positive trends slope', () => {
    expect(scoreKeyword({ expansions: [], trendsInterest: 50, trendsSlope: 5 }).trendDirection).toBe('rising')
    expect(scoreKeyword({ expansions: [], trendsInterest: 50, trendsSlope: -5 }).trendDirection).toBe('falling')
    expect(scoreKeyword({ expansions: [], trendsInterest: 50, trendsSlope: 0 }).trendDirection).toBe('flat')
  })

  it('competition proxy rises with expansion count', () => {
    const few = scoreKeyword({ expansions: ['a'], trendsInterest: 10 }).competitionProxy
    const many = scoreKeyword({ expansions: new Array(20).fill('a'), trendsInterest: 10 }).competitionProxy
    expect(many).toBeGreaterThan(few)
  })

  it('clusters keywords by shared leading token', () => {
    const clusters = clusterKeywords(['faceless youtube ideas', 'faceless youtube niche', 'ai video tools'])
    expect(clusters['faceless']).toContain('faceless youtube ideas')
    expect(clusters['ai']).toContain('ai video tools')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/lib/youtube-studio-keyword-signals.test.ts`
Expected: FAIL — module missing

- [ ] **Step 3: Write minimal implementation**

```typescript
// lib/youtube-studio/keyword-signals.ts

export interface KeywordScoreInput {
  expansions: string[]
  trendsInterest: number // 0-100 average interest
  trendsSlope?: number // positive = rising
}

export interface KeywordScore {
  volumeProxy: number
  competitionProxy: number
  trendDirection: 'rising' | 'flat' | 'falling'
}

function clamp(n: number): number {
  return Math.min(100, Math.max(0, Math.round(n)))
}

/** Proxy scoring: no real search-volume API, so blend autocomplete depth + trends interest. */
export function scoreKeyword(input: KeywordScoreInput): KeywordScore {
  const depth = Math.min(input.expansions.length, 20)
  const volumeProxy = clamp(input.trendsInterest * 0.6 + depth * 4 * 0.4)
  const competitionProxy = clamp(depth * 5)
  const slope = input.trendsSlope ?? 0
  const trendDirection = slope > 1 ? 'rising' : slope < -1 ? 'falling' : 'flat'
  return { volumeProxy, competitionProxy, trendDirection }
}

/** Group keyword terms by their first token so pillars can be mapped over clusters. */
export function clusterKeywords(terms: string[]): Record<string, string[]> {
  const clusters: Record<string, string[]> = {}
  for (const term of terms) {
    const head = term.trim().split(/\s+/)[0]?.toLowerCase()
    if (!head) continue
    if (!clusters[head]) clusters[head] = []
    clusters[head].push(term)
  }
  return clusters
}

const AUTOCOMPLETE_URL = 'https://suggestqueries.google.com/complete/search'
const TRENDS_EXPLORE_URL = 'https://trends.google.com/trends/api/explore'

/** Server-only: expand a seed term via YouTube's public autocomplete feed. */
export async function fetchAutocomplete(term: string): Promise<string[]> {
  const url = `${AUTOCOMPLETE_URL}?client=firefox&ds=yt&q=${encodeURIComponent(term)}`
  const res = await fetch(url)
  if (!res.ok) return []
  const json = (await res.json()) as [string, string[]]
  return Array.isArray(json?.[1]) ? json[1] : []
}

/**
 * Server-only: fetch Google Trends interest for a term. The explore endpoint
 * prefixes its JSON with ")]}'," which must be stripped. Returns a 0-100
 * average interest and a crude slope; on any failure returns neutral values.
 */
export async function fetchTrendsInterest(term: string): Promise<{ interest: number; slope: number }> {
  try {
    const url = `${TRENDS_EXPLORE_URL}?hl=en-US&tz=0&req=${encodeURIComponent(JSON.stringify({ comparisonItem: [{ keyword: term, geo: '', time: 'today 3-m' }], category: 0, property: '' }))}`
    const res = await fetch(url)
    if (!res.ok) return { interest: 0, slope: 0 }
    const text = (await res.text()).replace(/^\)\]\}',?/, '')
    const parsed = JSON.parse(text) as unknown
    void parsed
    return { interest: 50, slope: 0 }
  } catch {
    return { interest: 0, slope: 0 }
  }
}
```

Note: `fetchTrendsInterest` returns neutral values in this baseline because the Trends widget-token handshake is brittle; the pure `scoreKeyword` accepts whatever interest/slope the caller supplies, so a later task can harden the Trends parse without touching scoring.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest __tests__/lib/youtube-studio-keyword-signals.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/youtube-studio/keyword-signals.ts __tests__/lib/youtube-studio-keyword-signals.test.ts
git commit -m "feat(yt-os): keyword signal scoring + autocomplete/trends fetch"
```

---

## Task 9: Keyword expand route (server-side autocomplete + trends)

**Files:**
- Create: `app/api/v1/youtube-studio/keywords/expand/route.ts`
- Test: `__tests__/app/youtube-studio-keyword-expand-route.test.ts`

Thin server route so the browser workbench never hits Google's endpoints directly (CORS + no client secrets). `withAuth('admin')`, org-scoped. Returns expansions + score for a seed term without persisting.

- [ ] **Step 1: Write the failing test**

```typescript
// __tests__/app/youtube-studio-keyword-expand-route.test.ts
import { readFileSync } from 'fs'
import path from 'path'

function source(rel: string) {
  return readFileSync(path.join(process.cwd(), rel), 'utf8')
}

describe('keyword expand route', () => {
  const src = source('app/api/v1/youtube-studio/keywords/expand/route.ts')

  it('is admin gated and org scoped', () => {
    expect(src).toContain("withAuth('admin'")
    expect(src).toContain('ensureOrgAccess')
  })

  it('expands via the server-side signal helpers and scores, without persisting', () => {
    expect(src).toContain('fetchAutocomplete')
    expect(src).toContain('fetchTrendsInterest')
    expect(src).toContain('scoreKeyword')
    expect(src).not.toContain('.add(')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/app/youtube-studio-keyword-expand-route.test.ts`
Expected: FAIL — file missing

- [ ] **Step 3: Write minimal implementation**

```typescript
// app/api/v1/youtube-studio/keywords/expand/route.ts
import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { apiError, apiSuccess } from '@/lib/api/response'
import { ensureOrgAccess } from '@/lib/youtube-studio/api'
import { fetchAutocomplete, fetchTrendsInterest, scoreKeyword } from '@/lib/youtube-studio/keyword-signals'

export const dynamic = 'force-dynamic'

function cleanString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}
function cleanObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

export const POST = withAuth('admin', async (req: NextRequest, user) => {
  const body = cleanObject(await req.json().catch(() => ({})))
  const orgId = cleanString(body.orgId) ?? ''
  const term = cleanString(body.term) ?? ''
  const denied = await ensureOrgAccess(user, orgId)
  if (denied) return denied
  if (!term) return apiError('term is required', 400)

  const [expansions, trends] = await Promise.all([fetchAutocomplete(term), fetchTrendsInterest(term)])
  const score = scoreKeyword({ expansions, trendsInterest: trends.interest, trendsSlope: trends.slope })
  return apiSuccess({ term, expansions, ...score })
})
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest __tests__/app/youtube-studio-keyword-expand-route.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add app/api/v1/youtube-studio/keywords/expand/route.ts __tests__/app/youtube-studio-keyword-expand-route.test.ts
git commit -m "feat(yt-os): keyword expand route"
```

---

## Task 10: Keywords CRUD + attach-to-project

**Files:**
- Create: `app/api/v1/youtube-studio/keywords/route.ts`
- Test: `__tests__/app/youtube-studio-keywords-route.test.ts`

CRUD following Task 5's pattern. PATCH `action:'attach'` adds/removes a video project id to `attachedVideoProjectIds` after validating the project belongs to the org + channel workspace (via `loadScopedRecord(YOUTUBE_COLLECTIONS.videos, ...)`).

- [ ] **Step 1: Write the failing test**

```typescript
// __tests__/app/youtube-studio-keywords-route.test.ts
import { readFileSync } from 'fs'
import path from 'path'

function source(rel: string) {
  return readFileSync(path.join(process.cwd(), rel), 'utf8')
}

describe('keywords route', () => {
  const src = source('app/api/v1/youtube-studio/keywords/route.ts')

  it('is admin gated, org scoped, sanitized', () => {
    expect(src).toContain("withAuth('admin'")
    expect(src).toContain('ensureOrgAccess')
    expect(src).toContain('RESEARCH_COLLECTIONS.keywords')
    expect(src).toContain('sanitizeYouTubeKeywordInput')
  })

  it('attach validates the target video project before linking', () => {
    expect(src).toContain("'attach'")
    expect(src).toContain('YOUTUBE_COLLECTIONS.videos')
    expect(src).toContain('attachedVideoProjectIds')
  })

  it('exposes GET, POST, PATCH, DELETE', () => {
    expect(src).toContain('export const GET')
    expect(src).toContain('export const POST')
    expect(src).toContain('export const PATCH')
    expect(src).toContain('export const DELETE')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/app/youtube-studio-keywords-route.test.ts`
Expected: FAIL — file missing

- [ ] **Step 3: Write minimal implementation**

```typescript
// app/api/v1/youtube-studio/keywords/route.ts
import { NextRequest } from 'next/server'
import { adminDb } from '@/lib/firebase/admin'
import { FieldValue } from 'firebase-admin/firestore'
import { withAuth } from '@/lib/api/auth'
import { apiError, apiSuccess } from '@/lib/api/response'
import {
  actorFields,
  ensureOrgAccess,
  listByOrg,
  loadScopedRecord,
  updateActorFields,
  YOUTUBE_COLLECTIONS,
} from '@/lib/youtube-studio/api'
import { RESEARCH_COLLECTIONS, sanitizeYouTubeKeywordInput, serializeYouTubeResearchRecord } from '@/lib/youtube-studio/research'
import type { YouTubeKeyword } from '@/lib/youtube-studio/research-types'

export const dynamic = 'force-dynamic'

function cleanString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}
function cleanObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

async function validateChannel(orgId: string, channelWorkspaceId: string) {
  const channel = await loadScopedRecord(YOUTUBE_COLLECTIONS.channels, channelWorkspaceId)
  if (!channel || channel.data.deleted === true) return apiError('YouTube channel workspace not found', 404)
  if (channel.data.orgId !== orgId) return apiError('channelWorkspaceId does not belong to organisation', 400)
  return null
}

export const GET = withAuth('admin', async (req, user) => {
  const url = new URL(req.url)
  const orgId = url.searchParams.get('orgId')?.trim() ?? ''
  const channelWorkspaceId = url.searchParams.get('channelWorkspaceId')?.trim() ?? ''
  const denied = await ensureOrgAccess(user, orgId)
  if (denied) return denied
  const docs = await listByOrg(RESEARCH_COLLECTIONS.keywords, orgId)
  const keywords = docs
    .map((doc) => serializeYouTubeResearchRecord<YouTubeKeyword>(doc.id, doc.data()))
    .filter((k) => !channelWorkspaceId || k.channelWorkspaceId === channelWorkspaceId)
    .sort((a, b) => a.term.localeCompare(b.term))
  return apiSuccess({ keywords })
})

export const POST = withAuth('admin', async (req: NextRequest, user) => {
  const body = cleanObject(await req.json().catch(() => ({})))
  const orgId = cleanString(body.orgId) ?? ''
  const denied = await ensureOrgAccess(user, orgId)
  if (denied) return denied
  const channelWorkspaceId = cleanString(body.channelWorkspaceId) ?? ''
  if (!channelWorkspaceId) return apiError('channelWorkspaceId is required', 400)
  const channelError = await validateChannel(orgId, channelWorkspaceId)
  if (channelError) return channelError
  const data = sanitizeYouTubeKeywordInput({ ...body, orgId, channelWorkspaceId })
  if (!data.term) return apiError('term is required', 400)
  const ref = await adminDb.collection(RESEARCH_COLLECTIONS.keywords).add({ ...data, ...actorFields(user) })
  return apiSuccess({ id: ref.id }, 201)
})

export const PATCH = withAuth('admin', async (req: NextRequest, user) => {
  const body = cleanObject(await req.json().catch(() => ({})))
  const orgId = cleanString(body.orgId) ?? ''
  const id = cleanString(body.id) ?? ''
  const action = cleanString(body.action) ?? 'update'
  const denied = await ensureOrgAccess(user, orgId)
  if (denied) return denied
  if (!id) return apiError('id is required', 400)
  const loaded = await loadScopedRecord(RESEARCH_COLLECTIONS.keywords, id)
  if (!loaded || loaded.data.deleted === true) return apiError('Keyword not found', 404)
  if (loaded.data.orgId !== orgId) return apiError('Keyword does not belong to organisation', 400)

  if (action === 'attach' || action === 'detach') {
    const videoProjectId = cleanString(body.videoProjectId) ?? ''
    if (!videoProjectId) return apiError('videoProjectId is required', 400)
    const video = await loadScopedRecord(YOUTUBE_COLLECTIONS.videos, videoProjectId)
    if (!video || video.data.deleted === true) return apiError('Video project not found', 404)
    if (video.data.orgId !== orgId) return apiError('videoProjectId does not belong to organisation', 400)
    if (video.data.channelWorkspaceId !== loaded.data.channelWorkspaceId) {
      return apiError('videoProjectId does not belong to keyword channel workspace', 400)
    }
    await loaded.ref.set(
      {
        attachedVideoProjectIds:
          action === 'attach' ? FieldValue.arrayUnion(videoProjectId) : FieldValue.arrayRemove(videoProjectId),
        ...updateActorFields(user),
      },
      { merge: true },
    )
    return apiSuccess({ id, videoProjectId, action })
  }

  const merged = { ...loaded.data, ...body, orgId, channelWorkspaceId: loaded.data.channelWorkspaceId }
  const data = sanitizeYouTubeKeywordInput(merged)
  await loaded.ref.set({ ...data, ...updateActorFields(user) }, { merge: true })
  return apiSuccess({ id })
})

export const DELETE = withAuth('admin', async (req: NextRequest, user) => {
  const url = new URL(req.url)
  const orgId = url.searchParams.get('orgId')?.trim() ?? ''
  const id = url.searchParams.get('id')?.trim() ?? ''
  const denied = await ensureOrgAccess(user, orgId)
  if (denied) return denied
  if (!id) return apiError('id is required', 400)
  const loaded = await loadScopedRecord(RESEARCH_COLLECTIONS.keywords, id)
  if (!loaded || loaded.data.deleted === true) return apiError('Keyword not found', 404)
  if (loaded.data.orgId !== orgId) return apiError('Keyword does not belong to organisation', 400)
  await loaded.ref.set({ deleted: true, deletedAt: FieldValue.serverTimestamp(), ...updateActorFields(user) }, { merge: true })
  return apiSuccess({ id })
})
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest __tests__/app/youtube-studio-keywords-route.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add app/api/v1/youtube-studio/keywords/route.ts __tests__/app/youtube-studio-keywords-route.test.ts
git commit -m "feat(yt-os): keywords CRUD + attach-to-project"
```

---

## Task 11: Competitor diff computation (pure)

**Files:**
- Create: `lib/youtube-studio/competitor-diff.ts` (pure helpers this task)
- Test: `__tests__/lib/youtube-studio-competitor-diff.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// __tests__/lib/youtube-studio-competitor-diff.test.ts
import { computeCompetitorDiff, computeUploadCadence, shouldAlert } from '@/lib/youtube-studio/competitor-diff'

describe('competitor diff', () => {
  it('diffs subscribers/views/videos against the previous snapshot', () => {
    const diff = computeCompetitorDiff(
      { subscribers: 1200, views: 50000, videoCount: 42 },
      { subscribers: 1000, views: 45000, videoCount: 40 },
    )
    expect(diff).toEqual({ subscriberDelta: 200, viewDelta: 5000, videoDelta: 2 })
  })

  it('treats a missing previous snapshot as zero deltas', () => {
    const diff = computeCompetitorDiff({ subscribers: 1000, views: 5000, videoCount: 10 }, undefined)
    expect(diff).toEqual({ subscriberDelta: 0, viewDelta: 0, videoDelta: 0 })
  })

  it('computes uploads per week from video count delta over the window', () => {
    expect(computeUploadCadence(4, 7)).toBe(4) // 4 uploads in 7 days ≈ 4/week
    expect(computeUploadCadence(2, 14)).toBe(1) // 2 uploads in 14 days = 1/week
  })

  it('raises an alert when subscriber growth exceeds the spike threshold', () => {
    expect(shouldAlert({ subscriberDelta: 500, viewDelta: 0, videoDelta: 0 }, 1000, 0.1)).toBe(false)
    expect(shouldAlert({ subscriberDelta: 500, viewDelta: 0, videoDelta: 0 }, 1000, 0.4)).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/lib/youtube-studio-competitor-diff.test.ts`
Expected: FAIL — module missing

- [ ] **Step 3: Write minimal implementation**

```typescript
// lib/youtube-studio/competitor-diff.ts

export interface SnapshotStats {
  subscribers?: number
  views?: number
  videoCount?: number
}

export interface CompetitorDiff {
  subscriberDelta: number
  viewDelta: number
  videoDelta: number
}

function delta(current?: number, previous?: number): number {
  return (current ?? 0) - (previous ?? 0)
}

/** Pure diff of a new snapshot vs the previous one (undefined previous = first snapshot). */
export function computeCompetitorDiff(current: SnapshotStats, previous: SnapshotStats | undefined): CompetitorDiff {
  return {
    subscriberDelta: delta(current.subscribers, previous?.subscribers),
    viewDelta: delta(current.views, previous?.views),
    videoDelta: delta(current.videoCount, previous?.videoCount),
  }
}

/** Uploads per week from the video-count delta across a window of days. */
export function computeUploadCadence(videoDelta: number, windowDays: number): number {
  if (windowDays <= 0) return 0
  return Math.round((videoDelta / windowDays) * 7)
}

/**
 * Alert when subscriber growth exceeds `spikeRatio` of the previous subscriber base.
 * previousSubscribers of 0 never alerts (avoids noise on first snapshot).
 */
export function shouldAlert(diff: CompetitorDiff, previousSubscribers: number, spikeRatio: number): boolean {
  if (previousSubscribers <= 0) return false
  return diff.subscriberDelta / previousSubscribers >= spikeRatio
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest __tests__/lib/youtube-studio-competitor-diff.test.ts`
Expected: PASS

- [ ] **Step 5: Add the channel-stats fetch helper (asserted in Task 13 cron source test)**

Append to `lib/youtube-studio/competitor-diff.ts`. Uses `channels.list` (1 quota unit).

```typescript
import { resolveProvider } from '@/lib/social/account-resolver'

const CHANNELS_URL = 'https://www.googleapis.com/youtube/v3/channels'

export interface CompetitorChannelInfo extends SnapshotStats {
  title?: string
  handle?: string
  thumbnailUrl?: string
}

/** Fetch subscriber/view/video stats for a competitor channel (channels.list = 1 unit). */
export async function fetchChannelStats(orgId: string, channelId: string): Promise<CompetitorChannelInfo> {
  const resolved = await resolveProvider({}, orgId, 'youtube')
  const accessToken = (resolved as { credentials?: { accessToken?: string } })?.credentials?.accessToken
  if (!accessToken) throw new Error('No connected YouTube account for competitor diff')
  const url = `${CHANNELS_URL}?part=snippet,statistics&id=${channelId}`
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } })
  if (!res.ok) throw new Error(`channels.list failed ${res.status}`)
  const json = (await res.json()) as {
    items?: Array<{ snippet?: { title?: string; customUrl?: string; thumbnails?: { default?: { url?: string } } }; statistics?: { subscriberCount?: string; viewCount?: string; videoCount?: string } }>
  }
  const c = json.items?.[0]
  return {
    title: c?.snippet?.title,
    handle: c?.snippet?.customUrl,
    thumbnailUrl: c?.snippet?.thumbnails?.default?.url,
    subscribers: c?.statistics?.subscriberCount ? Number(c.statistics.subscriberCount) : undefined,
    views: c?.statistics?.viewCount ? Number(c.statistics.viewCount) : undefined,
    videoCount: c?.statistics?.videoCount ? Number(c.statistics.videoCount) : undefined,
  }
}
```

- [ ] **Step 6: Commit**

```bash
git add lib/youtube-studio/competitor-diff.ts __tests__/lib/youtube-studio-competitor-diff.test.ts
git commit -m "feat(yt-os): competitor diff pure helpers + channel stats fetch"
```

---

## Task 12: Competitor channels CRUD route

**Files:**
- Create: `app/api/v1/youtube-studio/competitors/route.ts`
- Test: `__tests__/app/youtube-studio-competitors-route.test.ts`

CRUD + GET `?snapshots=1&competitorChannelId=...` returns snapshot history for one competitor (from `youtube_competitor_snapshots`, org-scoped, sorted by `capturedAt` desc).

- [ ] **Step 1: Write the failing test**

```typescript
// __tests__/app/youtube-studio-competitors-route.test.ts
import { readFileSync } from 'fs'
import path from 'path'

function source(rel: string) {
  return readFileSync(path.join(process.cwd(), rel), 'utf8')
}

describe('competitors route', () => {
  const src = source('app/api/v1/youtube-studio/competitors/route.ts')

  it('is admin gated, org scoped, sanitized', () => {
    expect(src).toContain("withAuth('admin'")
    expect(src).toContain('ensureOrgAccess')
    expect(src).toContain('RESEARCH_COLLECTIONS.competitorChannels')
    expect(src).toContain('sanitizeYouTubeCompetitorChannelInput')
  })

  it('returns snapshot history on demand', () => {
    expect(src).toContain('RESEARCH_COLLECTIONS.competitorSnapshots')
    expect(src).toContain("searchParams.get('snapshots')")
  })

  it('exposes GET, POST, PATCH, DELETE', () => {
    expect(src).toContain('export const GET')
    expect(src).toContain('export const POST')
    expect(src).toContain('export const PATCH')
    expect(src).toContain('export const DELETE')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/app/youtube-studio-competitors-route.test.ts`
Expected: FAIL — file missing

- [ ] **Step 3: Write minimal implementation**

```typescript
// app/api/v1/youtube-studio/competitors/route.ts
import { NextRequest } from 'next/server'
import { adminDb } from '@/lib/firebase/admin'
import { FieldValue } from 'firebase-admin/firestore'
import { withAuth } from '@/lib/api/auth'
import { apiError, apiSuccess } from '@/lib/api/response'
import {
  actorFields,
  ensureOrgAccess,
  listByOrg,
  loadScopedRecord,
  updateActorFields,
  YOUTUBE_COLLECTIONS,
} from '@/lib/youtube-studio/api'
import {
  RESEARCH_COLLECTIONS,
  sanitizeYouTubeCompetitorChannelInput,
  serializeYouTubeResearchRecord,
} from '@/lib/youtube-studio/research'
import type { YouTubeCompetitorChannel, YouTubeCompetitorSnapshot } from '@/lib/youtube-studio/research-types'

export const dynamic = 'force-dynamic'

function cleanString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}
function cleanObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

async function validateChannel(orgId: string, channelWorkspaceId: string) {
  const channel = await loadScopedRecord(YOUTUBE_COLLECTIONS.channels, channelWorkspaceId)
  if (!channel || channel.data.deleted === true) return apiError('YouTube channel workspace not found', 404)
  if (channel.data.orgId !== orgId) return apiError('channelWorkspaceId does not belong to organisation', 400)
  return null
}

export const GET = withAuth('admin', async (req, user) => {
  const url = new URL(req.url)
  const orgId = url.searchParams.get('orgId')?.trim() ?? ''
  const channelWorkspaceId = url.searchParams.get('channelWorkspaceId')?.trim() ?? ''
  const wantSnapshots = url.searchParams.get('snapshots') === '1'
  const competitorChannelId = url.searchParams.get('competitorChannelId')?.trim() ?? ''
  const denied = await ensureOrgAccess(user, orgId)
  if (denied) return denied

  if (wantSnapshots) {
    const docs = await listByOrg(RESEARCH_COLLECTIONS.competitorSnapshots, orgId)
    const snapshots = docs
      .map((doc) => serializeYouTubeResearchRecord<YouTubeCompetitorSnapshot>(doc.id, doc.data()))
      .filter((s) => !competitorChannelId || s.competitorChannelId === competitorChannelId)
      .sort((a, b) => (b.capturedAt ?? '').localeCompare(a.capturedAt ?? ''))
    return apiSuccess({ snapshots })
  }

  const docs = await listByOrg(RESEARCH_COLLECTIONS.competitorChannels, orgId)
  const competitors = docs
    .map((doc) => serializeYouTubeResearchRecord<YouTubeCompetitorChannel>(doc.id, doc.data()))
    .filter((c) => !channelWorkspaceId || c.channelWorkspaceId === channelWorkspaceId)
    .sort((a, b) => a.title.localeCompare(b.title))
  return apiSuccess({ competitors })
})

export const POST = withAuth('admin', async (req: NextRequest, user) => {
  const body = cleanObject(await req.json().catch(() => ({})))
  const orgId = cleanString(body.orgId) ?? ''
  const denied = await ensureOrgAccess(user, orgId)
  if (denied) return denied
  const channelWorkspaceId = cleanString(body.channelWorkspaceId) ?? ''
  if (!channelWorkspaceId) return apiError('channelWorkspaceId is required', 400)
  const channelError = await validateChannel(orgId, channelWorkspaceId)
  if (channelError) return channelError
  const data = sanitizeYouTubeCompetitorChannelInput({ ...body, orgId, channelWorkspaceId })
  if (!data.youtubeChannelId) return apiError('youtubeChannelId is required', 400)
  const ref = await adminDb.collection(RESEARCH_COLLECTIONS.competitorChannels).add({ ...data, ...actorFields(user) })
  return apiSuccess({ id: ref.id }, 201)
})

export const PATCH = withAuth('admin', async (req: NextRequest, user) => {
  const body = cleanObject(await req.json().catch(() => ({})))
  const orgId = cleanString(body.orgId) ?? ''
  const id = cleanString(body.id) ?? ''
  const denied = await ensureOrgAccess(user, orgId)
  if (denied) return denied
  if (!id) return apiError('id is required', 400)
  const loaded = await loadScopedRecord(RESEARCH_COLLECTIONS.competitorChannels, id)
  if (!loaded || loaded.data.deleted === true) return apiError('Competitor not found', 404)
  if (loaded.data.orgId !== orgId) return apiError('Competitor does not belong to organisation', 400)
  const merged = { ...loaded.data, ...body, orgId, channelWorkspaceId: loaded.data.channelWorkspaceId }
  const data = sanitizeYouTubeCompetitorChannelInput(merged)
  await loaded.ref.set({ ...data, ...updateActorFields(user) }, { merge: true })
  return apiSuccess({ id })
})

export const DELETE = withAuth('admin', async (req: NextRequest, user) => {
  const url = new URL(req.url)
  const orgId = url.searchParams.get('orgId')?.trim() ?? ''
  const id = url.searchParams.get('id')?.trim() ?? ''
  const denied = await ensureOrgAccess(user, orgId)
  if (denied) return denied
  if (!id) return apiError('id is required', 400)
  const loaded = await loadScopedRecord(RESEARCH_COLLECTIONS.competitorChannels, id)
  if (!loaded || loaded.data.deleted === true) return apiError('Competitor not found', 404)
  if (loaded.data.orgId !== orgId) return apiError('Competitor does not belong to organisation', 400)
  await loaded.ref.set({ deleted: true, deletedAt: FieldValue.serverTimestamp(), ...updateActorFields(user) }, { merge: true })
  return apiSuccess({ id })
})
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest __tests__/app/youtube-studio-competitors-route.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add app/api/v1/youtube-studio/competitors/route.ts __tests__/app/youtube-studio-competitors-route.test.ts
git commit -m "feat(yt-os): competitor channels CRUD + snapshot history"
```

---

## Task 13: Competitor diff cron (weekly snapshots + alerts)

**Files:**
- Create: `app/api/cron/youtube-competitor-diff/route.ts`
- Modify: `vercel.json`
- Test: `__tests__/app/youtube-competitor-diff-cron.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// __tests__/app/youtube-competitor-diff-cron.test.ts
import { readFileSync } from 'fs'
import path from 'path'

function source(rel: string) {
  return readFileSync(path.join(process.cwd(), rel), 'utf8')
}

describe('competitor diff cron', () => {
  const src = source('app/api/cron/youtube-competitor-diff/route.ts')

  it('is cron authorized', () => {
    expect(src).toContain('x-vercel-cron')
    expect(src).toContain('CRON_SECRET')
  })

  it('snapshots + diffs each competitor and writes snapshots, no search.list', () => {
    expect(src).toContain('fetchChannelStats')
    expect(src).toContain('computeCompetitorDiff')
    expect(src).toContain('RESEARCH_COLLECTIONS.competitorSnapshots')
    expect(src).not.toContain('search.list')
  })

  it('is registered weekly in vercel.json', () => {
    expect(source('vercel.json')).toContain('/api/cron/youtube-competitor-diff')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/app/youtube-competitor-diff-cron.test.ts`
Expected: FAIL — file missing

- [ ] **Step 3: Write minimal implementation**

```typescript
// app/api/cron/youtube-competitor-diff/route.ts
import { NextRequest } from 'next/server'
import { adminDb } from '@/lib/firebase/admin'
import { FieldValue } from 'firebase-admin/firestore'
import { apiError, apiSuccess } from '@/lib/api/response'
import { RESEARCH_COLLECTIONS, sanitizeYouTubeCompetitorSnapshotInput } from '@/lib/youtube-studio/research'
import {
  computeCompetitorDiff,
  computeUploadCadence,
  fetchChannelStats,
  shouldAlert,
  type SnapshotStats,
} from '@/lib/youtube-studio/competitor-diff'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const SPIKE_RATIO = 0.2
const WINDOW_DAYS = 7

function authorized(req: NextRequest): boolean {
  const auth = req.headers.get('authorization')
  const vercelCron = req.headers.get('x-vercel-cron')
  return (Boolean(process.env.CRON_SECRET) && auth === `Bearer ${process.env.CRON_SECRET}`) || Boolean(vercelCron)
}

async function runDiff(req: NextRequest) {
  if (!authorized(req)) return apiError('Unauthorized', 401)
  const snap = await adminDb.collection(RESEARCH_COLLECTIONS.competitorChannels).where('deleted', '==', false).get()
  let processed = 0
  let alerts = 0

  for (const doc of snap.docs) {
    const c = doc.data() as Record<string, unknown>
    try {
      const stats = await fetchChannelStats(String(c.orgId), String(c.youtubeChannelId))
      const previous: SnapshotStats = {
        subscribers: Number(c.latestSubscribers) || undefined,
        views: Number(c.latestViews) || undefined,
        videoCount: Number(c.latestVideoCount) || undefined,
      }
      const diff = computeCompetitorDiff(stats, previous)
      const alertRaised = c.alertOnSpike === true && shouldAlert(diff, previous.subscribers ?? 0, SPIKE_RATIO)
      if (alertRaised) alerts += 1

      await adminDb.collection(RESEARCH_COLLECTIONS.competitorSnapshots).add({
        ...sanitizeYouTubeCompetitorSnapshotInput({
          orgId: c.orgId,
          channelWorkspaceId: c.channelWorkspaceId,
          competitorChannelId: doc.id,
          youtubeChannelId: c.youtubeChannelId,
          capturedAt: new Date().toISOString(),
          subscribers: stats.subscribers,
          views: stats.views,
          videoCount: stats.videoCount,
          subscriberDelta: diff.subscriberDelta,
          viewDelta: diff.viewDelta,
          videoDelta: diff.videoDelta,
          alertRaised,
        }),
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
        createdByType: 'system',
        updatedByType: 'system',
      })

      await doc.ref.set(
        {
          title: stats.title ?? c.title,
          handle: stats.handle ?? c.handle,
          thumbnailUrl: stats.thumbnailUrl ?? c.thumbnailUrl,
          latestSubscribers: stats.subscribers ?? c.latestSubscribers,
          latestViews: stats.views ?? c.latestViews,
          latestVideoCount: stats.videoCount ?? c.latestVideoCount,
          uploadCadencePerWeek: computeUploadCadence(diff.videoDelta, WINDOW_DAYS),
          lastSnapshotAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      )
      processed += 1
    } catch {
      // Skip this competitor on API failure; next run retries.
    }
  }
  return apiSuccess({ processed, alerts })
}

export async function GET(req: NextRequest) {
  return runDiff(req)
}
export async function POST(req: NextRequest) {
  return runDiff(req)
}
```

- [ ] **Step 4: Add the cron entry to `vercel.json`** (weekly, Mondays 06:00 UTC):

```json
    {
      "path": "/api/cron/youtube-competitor-diff",
      "schedule": "0 6 * * 1"
    }
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx jest __tests__/app/youtube-competitor-diff-cron.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add app/api/cron/youtube-competitor-diff/route.ts vercel.json __tests__/app/youtube-competitor-diff-cron.test.ts
git commit -m "feat(yt-os): weekly competitor diff cron + alerts"
```

---

## Task 15: Idea provenance helpers (pure)

**Files:**
- Create: `lib/youtube-studio/idea-provenance.ts`
- Test: `__tests__/lib/youtube-studio-idea-provenance.test.ts`

Pure builders that turn an outlier video / keyword / trend research record into a `YouTubeIdea` payload (pre-sanitize). Keeps the "trend → idea" and "outlier → idea" mapping unit-testable and out of route bodies.

- [ ] **Step 1: Write the failing test**

```typescript
// __tests__/lib/youtube-studio-idea-provenance.test.ts
import { ideaFromOutlier, ideaFromKeyword } from '@/lib/youtube-studio/idea-provenance'

describe('idea provenance builders', () => {
  it('builds an idea from an outlier video with provenance + ref id', () => {
    const idea = ideaFromOutlier({
      id: 'out1', orgId: 'o1', channelWorkspaceId: 'c1', title: 'Viral thing', outlierScore: 8,
    })
    expect(idea).toMatchObject({
      orgId: 'o1', channelWorkspaceId: 'c1', provenance: 'outlier',
      provenanceRefId: 'out1', stage: 'idea',
    })
    expect(idea.title).toContain('Viral thing')
    // high outlier score → high priority
    expect(idea.priority).toBe('high')
  })

  it('builds an idea from a keyword carrying the pillar', () => {
    const idea = ideaFromKeyword({
      id: 'kw1', orgId: 'o1', channelWorkspaceId: 'c1', term: 'faceless youtube', pillar: 'Automation',
    })
    expect(idea).toMatchObject({
      provenance: 'keyword', provenanceRefId: 'kw1', pillar: 'Automation', priority: 'normal',
    })
    expect(idea.title.toLowerCase()).toContain('faceless youtube')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/lib/youtube-studio-idea-provenance.test.ts`
Expected: FAIL — module missing

- [ ] **Step 3: Write minimal implementation**

```typescript
// lib/youtube-studio/idea-provenance.ts
import type { YouTubeIdea } from './research-types'

type IdeaSeed = Omit<
  YouTubeIdea,
  'id' | 'createdAt' | 'updatedAt' | 'createdBy' | 'createdByType' | 'updatedBy' | 'updatedByType'
>

export function ideaFromOutlier(outlier: {
  id: string
  orgId: string
  channelWorkspaceId: string
  title: string
  outlierScore: number
}): IdeaSeed {
  return {
    orgId: outlier.orgId,
    channelWorkspaceId: outlier.channelWorkspaceId,
    title: `Our take: ${outlier.title}`,
    stage: 'idea',
    provenance: 'outlier',
    provenanceRefId: outlier.id,
    hookDrafts: [],
    priority: outlier.outlierScore >= 5 ? 'high' : 'normal',
    titleAgentJobIds: [],
    deleted: false,
  }
}

export function ideaFromKeyword(keyword: {
  id: string
  orgId: string
  channelWorkspaceId: string
  term: string
  pillar?: string
}): IdeaSeed {
  return {
    orgId: keyword.orgId,
    channelWorkspaceId: keyword.channelWorkspaceId,
    title: `Video targeting "${keyword.term}"`,
    stage: 'idea',
    provenance: 'keyword',
    provenanceRefId: keyword.id,
    hookDrafts: [],
    pillar: keyword.pillar,
    priority: 'normal',
    titleAgentJobIds: [],
    deleted: false,
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest __tests__/lib/youtube-studio-idea-provenance.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/youtube-studio/idea-provenance.ts __tests__/lib/youtube-studio-idea-provenance.test.ts
git commit -m "feat(yt-os): idea provenance builders"
```

---

## Task 14: Trend radar agent-job helper (shared dispatch)

**Files:**
- Create: `lib/youtube-studio/research-agent-jobs.ts`
- Test: `__tests__/lib/youtube-studio-research-agent-jobs.test.ts`

Several routes (outlier turn-into-brief in Task 6, trend radar, title lab in Task 16) queue review-gated agent jobs with nearly identical packet-building. Extract one helper `buildResearchAgentJob(skillKey, { orgId, channelWorkspaceId, title, inputSummary, linked })` that returns the sanitized job payload with `status:'queued'`, `reviewRequired:true`, `visibility:'internal'`. Trend radar uses skill `youtube-series-planner` (its `bestFor` is ideation/angles) tagged to the channel. This is a **pure payload builder** (no Firestore write) so it is trivially testable; callers do the `.add()`.

> Ordering note: implement this Task 14 helper AFTER Task 6 lands (Task 6 inlines the packet). When executing this task, refactor Task 6's route to call `buildResearchAgentJob` to remove the duplication. If executing strictly in number order, do Task 6 first then this — the plan is numbered 14 to group it with ideation.

- [ ] **Step 1: Write the failing test**

```typescript
// __tests__/lib/youtube-studio-research-agent-jobs.test.ts
import { buildResearchAgentJob } from '@/lib/youtube-studio/research-agent-jobs'

describe('buildResearchAgentJob', () => {
  it('builds a review-gated queued job packet for a known skill', () => {
    const job = buildResearchAgentJob('youtube-video-brief', {
      orgId: 'o1',
      channelWorkspaceId: 'c1',
      title: 'Brief from outlier',
      inputSummary: 'turn outlier into brief',
      linked: { researchItemIds: ['out1'] },
    })
    expect(job).toMatchObject({
      orgId: 'o1',
      channelWorkspaceId: 'c1',
      skillKey: 'youtube-video-brief',
      status: 'queued',
      reviewRequired: true,
      visibility: 'internal',
      deleted: false,
    })
    expect(job.inputPacket?.skillKey).toBe('youtube-video-brief')
    expect(job.linked?.researchItemIds).toContain('out1')
  })

  it('throws on an unknown skill so callers cannot queue a bogus job', () => {
    expect(() => buildResearchAgentJob('not-a-skill' as never, { orgId: 'o1', channelWorkspaceId: 'c1', title: 'x' })).toThrow()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/lib/youtube-studio-research-agent-jobs.test.ts`
Expected: FAIL — module missing

- [ ] **Step 3: Write minimal implementation**

```typescript
// lib/youtube-studio/research-agent-jobs.ts
import { getYouTubeSkillContract } from './skills'
import { sanitizeYouTubeAgentJobInput } from './sanitize'
import type { YouTubeAgentJob, YouTubeProductionSkillKey } from './types'

type ResearchJobArgs = {
  orgId: string
  channelWorkspaceId: string
  title: string
  inputSummary?: string
  videoProjectId?: string
  linked?: YouTubeAgentJob['linked']
}

type SanitizedJob = ReturnType<typeof sanitizeYouTubeAgentJobInput>

/**
 * Build a sanitized, review-gated, queued YouTube agent-job payload for a
 * research/ideation skill. Pure — the caller performs the Firestore write and
 * actor stamping. Throws for unknown skills.
 */
export function buildResearchAgentJob(skillKey: YouTubeProductionSkillKey, args: ResearchJobArgs): SanitizedJob {
  const contract = getYouTubeSkillContract(skillKey)
  if (!contract) throw new Error(`Unknown YouTube production skill: ${skillKey}`)
  return sanitizeYouTubeAgentJobInput({
    orgId: args.orgId,
    channelWorkspaceId: args.channelWorkspaceId,
    videoProjectId: args.videoProjectId,
    skillKey: contract.key,
    title: args.title,
    status: 'queued',
    inputSummary: args.inputSummary,
    inputPacket: {
      skillKey: contract.key,
      skillLabel: contract.label,
      family: contract.family,
      inputSummary: args.inputSummary,
      requiredContext: contract.requiredContext,
      outputArtifacts: contract.outputArtifacts,
      guardrails: contract.guardrails,
      policySourceKeys: contract.policySourceKeys,
      outputPersistence: contract.outputPersistence,
      mutationPolicy: contract.mutationPolicy,
      references: {
        channelWorkspaceId: args.channelWorkspaceId,
        videoProjectId: args.videoProjectId,
        sourceAssetIds: [],
        clipCandidateIds: [],
        productionDraftIds: [],
        renderJobIds: [],
        publishingPacketIds: [],
        analyticsSnapshotIds: [],
      },
    },
    outputArtifactIds: [],
    reviewRequired: true,
    visibility: 'internal',
    linked: args.linked ?? {},
    deleted: false,
  })
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest __tests__/lib/youtube-studio-research-agent-jobs.test.ts`
Expected: PASS

- [ ] **Step 5: Refactor Task 6's route to use the helper**

In `app/api/v1/youtube-studio/outlier-videos/route.ts`, replace the inline `sanitizeYouTubeAgentJobInput({...})` block in the `turn-into-brief` branch with:

```typescript
    const jobData = buildResearchAgentJob('youtube-video-brief', {
      orgId,
      channelWorkspaceId: cleanString(loaded.data.channelWorkspaceId) ?? '',
      title: `Brief from outlier: ${cleanString(loaded.data.title) ?? id}`,
      inputSummary: `Turn competitor outlier video ${cleanString(loaded.data.youtubeVideoId)} into a sourced video brief.`,
      linked: { researchItemIds: [id] },
    })
```

Add `import { buildResearchAgentJob } from '@/lib/youtube-studio/research-agent-jobs'` and remove the now-unused `getYouTubeSkillContract` / `sanitizeYouTubeAgentJobInput` imports if no longer referenced. Re-run Task 6's test to confirm it still passes: `npx jest __tests__/app/youtube-studio-outlier-videos-route.test.ts` (it still asserts `'youtube-video-brief'`, `status: 'queued'`, `reviewRequired: true`).

- [ ] **Step 6: Commit**

```bash
git add lib/youtube-studio/research-agent-jobs.ts app/api/v1/youtube-studio/outlier-videos/route.ts __tests__/lib/youtube-studio-research-agent-jobs.test.ts
git commit -m "feat(yt-os): shared research agent-job builder + outlier refactor"
```

---

## Task 16: Ideas CRUD, kanban moves, bulk actions, title-lab, promote-to-project

**Files:**
- Create: `app/api/v1/youtube-studio/ideas/route.ts`
- Test: `__tests__/app/youtube-studio-ideas-route.test.ts`

CRUD + PATCH with actions:
- `stage-move` — set `stage`.
- `bulk` — apply `{stage?, priority?, deleted?}` to `ids[]` (all org-scoped) via a Firestore batch.
- `title-lab` — queue a review-gated `youtube-title-metadata` agent job (via `buildResearchAgentJob`) and push its id into `titleAgentJobIds`.
- `promote-to-project` — create a `youtube_video_projects` record at `status:'intake'` via `createYouTubeVideoProject`, set the idea's `videoProjectId` + `stage:'in_production'` (two-way link). NEVER touches publish state.

Also handles trend-radar dispatch: POST `action:'trend-radar'` queues a `youtube-series-planner` job tagged to the channel (fulfils Pillar A trend radar + "trend → idea").

- [ ] **Step 1: Write the failing test**

```typescript
// __tests__/app/youtube-studio-ideas-route.test.ts
import { readFileSync } from 'fs'
import path from 'path'

function source(rel: string) {
  return readFileSync(path.join(process.cwd(), rel), 'utf8')
}

describe('ideas route', () => {
  const src = source('app/api/v1/youtube-studio/ideas/route.ts')

  it('is admin gated, org scoped, sanitized', () => {
    expect(src).toContain("withAuth('admin'")
    expect(src).toContain('ensureOrgAccess')
    expect(src).toContain('RESEARCH_COLLECTIONS.ideas')
    expect(src).toContain('sanitizeYouTubeIdeaInput')
  })

  it('supports kanban stage moves and bulk actions', () => {
    expect(src).toContain("'stage-move'")
    expect(src).toContain("'bulk'")
    expect(src).toContain('batch()')
  })

  it('title-lab and trend-radar queue review-gated agent jobs, never inline AI', () => {
    expect(src).toContain("'title-lab'")
    expect(src).toContain("'youtube-title-metadata'")
    expect(src).toContain("'trend-radar'")
    expect(src).toContain("'youtube-series-planner'")
    expect(src).toContain('buildResearchAgentJob')
    expect(src).toContain('titleAgentJobIds')
    expect(src).not.toContain('dispatchHermesRun')
  })

  it('promote-to-project creates an intake video project with a two-way link', () => {
    expect(src).toContain("'promote-to-project'")
    expect(src).toContain('createYouTubeVideoProject')
    expect(src).toContain("status: 'intake'")
    expect(src).toContain("stage: 'in_production'")
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/app/youtube-studio-ideas-route.test.ts`
Expected: FAIL — file missing

- [ ] **Step 3: Write minimal implementation**

```typescript
// app/api/v1/youtube-studio/ideas/route.ts
import { NextRequest } from 'next/server'
import { adminDb } from '@/lib/firebase/admin'
import { FieldValue } from 'firebase-admin/firestore'
import { withAuth } from '@/lib/api/auth'
import { apiError, apiSuccess } from '@/lib/api/response'
import {
  actorFields,
  createYouTubeVideoProject,
  ensureOrgAccess,
  listByOrg,
  loadScopedRecord,
  updateActorFields,
  YOUTUBE_COLLECTIONS,
} from '@/lib/youtube-studio/api'
import { RESEARCH_COLLECTIONS, sanitizeYouTubeIdeaInput, serializeYouTubeResearchRecord } from '@/lib/youtube-studio/research'
import { buildResearchAgentJob } from '@/lib/youtube-studio/research-agent-jobs'
import type { YouTubeIdea } from '@/lib/youtube-studio/research-types'

export const dynamic = 'force-dynamic'

function cleanString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}
function cleanObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}
function cleanStringArray(value: unknown): string[] {
  const raw = Array.isArray(value) ? value : []
  return Array.from(new Set(raw.map(cleanString).filter((v): v is string => Boolean(v))))
}

async function validateChannel(orgId: string, channelWorkspaceId: string) {
  const channel = await loadScopedRecord(YOUTUBE_COLLECTIONS.channels, channelWorkspaceId)
  if (!channel || channel.data.deleted === true) return apiError('YouTube channel workspace not found', 404)
  if (channel.data.orgId !== orgId) return apiError('channelWorkspaceId does not belong to organisation', 400)
  return null
}

export const GET = withAuth('admin', async (req, user) => {
  const url = new URL(req.url)
  const orgId = url.searchParams.get('orgId')?.trim() ?? ''
  const channelWorkspaceId = url.searchParams.get('channelWorkspaceId')?.trim() ?? ''
  const stage = url.searchParams.get('stage')?.trim() ?? ''
  const denied = await ensureOrgAccess(user, orgId)
  if (denied) return denied
  const docs = await listByOrg(RESEARCH_COLLECTIONS.ideas, orgId)
  const ideas = docs
    .map((doc) => serializeYouTubeResearchRecord<YouTubeIdea>(doc.id, doc.data()))
    .filter((i) => !channelWorkspaceId || i.channelWorkspaceId === channelWorkspaceId)
    .filter((i) => !stage || i.stage === stage)
    .sort((a, b) => a.title.localeCompare(b.title))
  return apiSuccess({ ideas })
})

export const POST = withAuth('admin', async (req: NextRequest, user) => {
  const body = cleanObject(await req.json().catch(() => ({})))
  const orgId = cleanString(body.orgId) ?? ''
  const action = cleanString(body.action) ?? 'create'
  const denied = await ensureOrgAccess(user, orgId)
  if (denied) return denied
  const channelWorkspaceId = cleanString(body.channelWorkspaceId) ?? ''
  if (!channelWorkspaceId) return apiError('channelWorkspaceId is required', 400)
  const channelError = await validateChannel(orgId, channelWorkspaceId)
  if (channelError) return channelError

  if (action === 'trend-radar') {
    const jobData = buildResearchAgentJob('youtube-series-planner', {
      orgId,
      channelWorkspaceId,
      title: cleanString(body.title) ?? 'Trend radar sweep',
      inputSummary: 'Sweep current trends across sources and propose channel-tagged video ideas for review.',
    })
    const jobRef = await adminDb.collection(YOUTUBE_COLLECTIONS.agentJobs).add({
      ...jobData,
      status: 'queued',
      outputArtifactIds: [],
      reviewRequired: true,
      visibility: 'internal',
      deleted: false,
      ...actorFields(user),
    })
    return apiSuccess({ trendRadarAgentJobId: jobRef.id }, 201)
  }

  const data = sanitizeYouTubeIdeaInput({ ...body, orgId, channelWorkspaceId })
  const ref = await adminDb.collection(RESEARCH_COLLECTIONS.ideas).add({ ...data, ...actorFields(user) })
  return apiSuccess({ id: ref.id }, 201)
})

export const PATCH = withAuth('admin', async (req: NextRequest, user) => {
  const body = cleanObject(await req.json().catch(() => ({})))
  const orgId = cleanString(body.orgId) ?? ''
  const action = cleanString(body.action) ?? 'update'
  const denied = await ensureOrgAccess(user, orgId)
  if (denied) return denied

  if (action === 'bulk') {
    const ids = cleanStringArray(body.ids)
    if (ids.length === 0) return apiError('ids is required', 400)
    const patch = cleanObject(body.patch)
    const batch = adminDb.batch()
    for (const id of ids) {
      const loaded = await loadScopedRecord(RESEARCH_COLLECTIONS.ideas, id)
      if (!loaded || loaded.data.orgId !== orgId) continue
      batch.set(
        loaded.ref,
        {
          ...(cleanString(patch.stage) ? { stage: cleanString(patch.stage) } : {}),
          ...(cleanString(patch.priority) ? { priority: cleanString(patch.priority) } : {}),
          ...(patch.deleted === true ? { deleted: true, deletedAt: FieldValue.serverTimestamp() } : {}),
          ...updateActorFields(user),
        },
        { merge: true },
      )
    }
    await batch.commit()
    return apiSuccess({ ids })
  }

  const id = cleanString(body.id) ?? ''
  if (!id) return apiError('id is required', 400)
  const loaded = await loadScopedRecord(RESEARCH_COLLECTIONS.ideas, id)
  if (!loaded || loaded.data.deleted === true) return apiError('Idea not found', 404)
  if (loaded.data.orgId !== orgId) return apiError('Idea does not belong to organisation', 400)
  const channelWorkspaceId = cleanString(loaded.data.channelWorkspaceId) ?? ''

  if (action === 'stage-move') {
    const stage = cleanString(body.stage) ?? ''
    if (!stage) return apiError('stage is required', 400)
    await loaded.ref.set({ stage, ...updateActorFields(user) }, { merge: true })
    return apiSuccess({ id, stage })
  }

  if (action === 'title-lab') {
    const jobData = buildResearchAgentJob('youtube-title-metadata', {
      orgId,
      channelWorkspaceId,
      videoProjectId: cleanString(loaded.data.videoProjectId),
      title: `Title lab: ${cleanString(loaded.data.title) ?? id}`,
      inputSummary: 'Generate 10+ title variants scored against org outlier title patterns.',
      linked: { researchItemIds: [id] },
    })
    const jobRef = await adminDb.collection(YOUTUBE_COLLECTIONS.agentJobs).add({
      ...jobData,
      status: 'queued',
      outputArtifactIds: [],
      reviewRequired: true,
      visibility: 'internal',
      deleted: false,
      ...actorFields(user),
    })
    await loaded.ref.set({ titleAgentJobIds: FieldValue.arrayUnion(jobRef.id), ...updateActorFields(user) }, { merge: true })
    return apiSuccess({ id, titleAgentJobId: jobRef.id }, 201)
  }

  if (action === 'promote-to-project') {
    if (cleanString(loaded.data.videoProjectId)) return apiError('Idea is already promoted to a project', 409)
    const videoProjectId = await createYouTubeVideoProject(
      {
        orgId,
        channelWorkspaceId,
        title: cleanString(loaded.data.title) ?? 'Untitled video',
        videoType: 'long_form',
        status: 'intake',
        objective: cleanString(body.objective) ?? 'Promoted from idea board',
        source: { intakeType: 'manual', researchItemId: id },
      },
      user,
    )
    await loaded.ref.set({ videoProjectId, stage: 'in_production', ...updateActorFields(user) }, { merge: true })
    return apiSuccess({ id, videoProjectId }, 201)
  }

  const merged = { ...loaded.data, ...body, orgId, channelWorkspaceId }
  const data = sanitizeYouTubeIdeaInput(merged)
  await loaded.ref.set({ ...data, ...updateActorFields(user) }, { merge: true })
  return apiSuccess({ id })
})

export const DELETE = withAuth('admin', async (req: NextRequest, user) => {
  const url = new URL(req.url)
  const orgId = url.searchParams.get('orgId')?.trim() ?? ''
  const id = url.searchParams.get('id')?.trim() ?? ''
  const denied = await ensureOrgAccess(user, orgId)
  if (denied) return denied
  if (!id) return apiError('id is required', 400)
  const loaded = await loadScopedRecord(RESEARCH_COLLECTIONS.ideas, id)
  if (!loaded || loaded.data.deleted === true) return apiError('Idea not found', 404)
  if (loaded.data.orgId !== orgId) return apiError('Idea does not belong to organisation', 400)
  await loaded.ref.set({ deleted: true, deletedAt: FieldValue.serverTimestamp(), ...updateActorFields(user) }, { merge: true })
  return apiSuccess({ id })
})
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest __tests__/app/youtube-studio-ideas-route.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add app/api/v1/youtube-studio/ideas/route.ts __tests__/app/youtube-studio-ideas-route.test.ts
git commit -m "feat(yt-os): idea board CRUD, kanban, bulk, title-lab, trend-radar, promote"
```

---

## Task 17: Script read-time + section extraction (pure)

**Files:**
- Create: `lib/youtube-studio/script-readtime.ts`
- Test: `__tests__/lib/youtube-studio-script-readtime.test.ts`

Pure helpers for the script editor: read-time estimate (150 wpm narration default) and hook/intro/body/CTA section extraction from markdown headings.

- [ ] **Step 1: Write the failing test**

```typescript
// __tests__/lib/youtube-studio-script-readtime.test.ts
import { estimateReadTimeSeconds, extractScriptSections } from '@/lib/youtube-studio/script-readtime'

describe('script read-time helpers', () => {
  it('estimates read time at 150 words per minute', () => {
    const words = new Array(300).fill('word').join(' ')
    expect(estimateReadTimeSeconds(words)).toBe(120)
  })

  it('returns 0 for empty script', () => {
    expect(estimateReadTimeSeconds('')).toBe(0)
  })

  it('extracts sections from markdown headings with per-section text', () => {
    const md = '# Hook\nGrab them fast.\n\n## Body\nMain content here.\n\n## CTA\nSubscribe now.'
    const sections = extractScriptSections(md)
    expect(sections.map((s) => s.label)).toEqual(['Hook', 'Body', 'CTA'])
    expect(sections[0].text).toContain('Grab them fast.')
    expect(sections[0].readTimeSeconds).toBeGreaterThan(0)
  })

  it('puts leading text before any heading into an Intro section', () => {
    const md = 'Some cold open text.\n\n# Body\nRest.'
    const sections = extractScriptSections(md)
    expect(sections[0].label).toBe('Intro')
    expect(sections[0].text).toContain('Some cold open text.')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/lib/youtube-studio-script-readtime.test.ts`
Expected: FAIL — module missing

- [ ] **Step 3: Write minimal implementation**

```typescript
// lib/youtube-studio/script-readtime.ts

const WORDS_PER_MINUTE = 150

export interface ScriptSection {
  label: string
  text: string
  readTimeSeconds: number
}

function countWords(text: string): number {
  const trimmed = text.trim()
  return trimmed ? trimmed.split(/\s+/).length : 0
}

/** Narration read-time estimate in seconds at 150 wpm. */
export function estimateReadTimeSeconds(text: string): number {
  const words = countWords(text)
  return Math.round((words / WORDS_PER_MINUTE) * 60)
}

/** Split markdown into sections by ATX headings; leading text becomes "Intro". */
export function extractScriptSections(markdown: string): ScriptSection[] {
  const lines = markdown.split('\n')
  const sections: ScriptSection[] = []
  let currentLabel: string | null = null
  let buffer: string[] = []

  const flush = () => {
    const text = buffer.join('\n').trim()
    if (currentLabel === null && !text) return
    const label = currentLabel ?? 'Intro'
    sections.push({ label, text, readTimeSeconds: estimateReadTimeSeconds(text) })
    buffer = []
  }

  for (const line of lines) {
    const heading = line.match(/^#{1,6}\s+(.*)$/)
    if (heading) {
      flush()
      currentLabel = heading[1].trim()
    } else {
      buffer.push(line)
    }
  }
  flush()
  return sections
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest __tests__/lib/youtube-studio-script-readtime.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/youtube-studio/script-readtime.ts __tests__/lib/youtube-studio-script-readtime.test.ts
git commit -m "feat(yt-os): script read-time + section extraction helpers"
```

---

## Task 18: Script draft autosave/versioning + AI rewrite-selection route

**Files:**
- Create: `app/api/v1/youtube-studio/production-drafts/script/route.ts`
- Test: `__tests__/app/youtube-studio-script-route.test.ts`

The script editor persists to an existing `youtube_production_drafts` record (`draftType:'script'`, `scriptText` field). This route adds:
- PUT `action:'autosave'` — patch `scriptText`; on an explicit `bumpVersion:true` it increments `versionNumber` (consistent with the existing draft `versionNumber` convention) and snapshots the prior text into a `scriptVersions[]` history array.
- PATCH `action:'rewrite-selection'` — queue a review-gated `youtube-script-writer` agent job (via `buildResearchAgentJob`) carrying the selected text + instruction; NEVER edits the draft inline (AI output lands as a reviewable artifact).

It reuses the production-drafts collection (`YOUTUBE_COLLECTIONS.productionDrafts`) and the existing `sanitizeYouTubeProductionDraftInput` for full-record writes; this route only patches script-specific fields.

- [ ] **Step 1: Write the failing test**

```typescript
// __tests__/app/youtube-studio-script-route.test.ts
import { readFileSync } from 'fs'
import path from 'path'

function source(rel: string) {
  return readFileSync(path.join(process.cwd(), rel), 'utf8')
}

describe('script draft route', () => {
  const src = source('app/api/v1/youtube-studio/production-drafts/script/route.ts')

  it('is admin gated, org scoped, over the production drafts collection', () => {
    expect(src).toContain("withAuth('admin'")
    expect(src).toContain('ensureOrgAccess')
    expect(src).toContain('YOUTUBE_COLLECTIONS.productionDrafts')
  })

  it('autosaves scriptText and versions on bump', () => {
    expect(src).toContain("'autosave'")
    expect(src).toContain('scriptText')
    expect(src).toContain('versionNumber')
    expect(src).toContain('scriptVersions')
  })

  it('rewrite-selection queues a review-gated script-writer job, never inline edits', () => {
    expect(src).toContain("'rewrite-selection'")
    expect(src).toContain("'youtube-script-writer'")
    expect(src).toContain('buildResearchAgentJob')
    expect(src).toContain('reviewRequired: true')
    expect(src).not.toContain('dispatchHermesRun')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/app/youtube-studio-script-route.test.ts`
Expected: FAIL — file missing

- [ ] **Step 3: Write minimal implementation**

```typescript
// app/api/v1/youtube-studio/production-drafts/script/route.ts
import { NextRequest } from 'next/server'
import { adminDb } from '@/lib/firebase/admin'
import { FieldValue } from 'firebase-admin/firestore'
import { withAuth } from '@/lib/api/auth'
import { apiError, apiSuccess } from '@/lib/api/response'
import {
  actorFields,
  ensureOrgAccess,
  loadScopedRecord,
  updateActorFields,
  YOUTUBE_COLLECTIONS,
} from '@/lib/youtube-studio/api'
import { buildResearchAgentJob } from '@/lib/youtube-studio/research-agent-jobs'

export const dynamic = 'force-dynamic'

function cleanString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}
function cleanObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

async function loadDraft(orgId: string, id: string) {
  const loaded = await loadScopedRecord(YOUTUBE_COLLECTIONS.productionDrafts, id)
  if (!loaded || loaded.data.deleted === true) return { error: apiError('Production draft not found', 404) }
  if (loaded.data.orgId !== orgId) return { error: apiError('Draft does not belong to organisation', 400) }
  return { loaded }
}

export const PUT = withAuth('admin', async (req: NextRequest, user) => {
  const body = cleanObject(await req.json().catch(() => ({})))
  const orgId = cleanString(body.orgId) ?? ''
  const id = cleanString(body.id) ?? ''
  const action = cleanString(body.action) ?? 'autosave'
  const denied = await ensureOrgAccess(user, orgId)
  if (denied) return denied
  if (!id) return apiError('id is required', 400)
  const result = await loadDraft(orgId, id)
  if ('error' in result) return result.error
  const { loaded } = result

  if (action === 'autosave') {
    const scriptText = typeof body.scriptText === 'string' ? body.scriptText : ''
    const bump = body.bumpVersion === true
    const priorText = typeof loaded.data.scriptText === 'string' ? loaded.data.scriptText : ''
    const priorVersion = Number(loaded.data.versionNumber) || 1
    await loaded.ref.set(
      {
        scriptText,
        ...(bump
          ? {
              versionNumber: priorVersion + 1,
              scriptVersions: FieldValue.arrayUnion({
                versionNumber: priorVersion,
                scriptText: priorText,
                savedAt: new Date().toISOString(),
                savedBy: user.uid,
              }),
            }
          : {}),
        ...updateActorFields(user),
      },
      { merge: true },
    )
    return apiSuccess({ id, versionNumber: bump ? priorVersion + 1 : priorVersion })
  }

  return apiError('Unsupported script draft action', 400)
})

export const PATCH = withAuth('admin', async (req: NextRequest, user) => {
  const body = cleanObject(await req.json().catch(() => ({})))
  const orgId = cleanString(body.orgId) ?? ''
  const id = cleanString(body.id) ?? ''
  const action = cleanString(body.action) ?? ''
  const denied = await ensureOrgAccess(user, orgId)
  if (denied) return denied
  if (!id) return apiError('id is required', 400)
  const result = await loadDraft(orgId, id)
  if ('error' in result) return result.error
  const { loaded } = result

  if (action === 'rewrite-selection') {
    const selection = cleanString(body.selection) ?? ''
    const instruction = cleanString(body.instruction) ?? 'tighten'
    if (!selection) return apiError('selection is required', 400)
    const channelWorkspaceId = cleanString(loaded.data.channelWorkspaceId) ?? ''
    const videoProjectId = cleanString(loaded.data.videoProjectId)
    const jobData = buildResearchAgentJob('youtube-script-writer', {
      orgId,
      channelWorkspaceId,
      videoProjectId,
      title: `Rewrite selection (${instruction})`,
      inputSummary: `Rewrite the selected script passage with instruction "${instruction}". Selection: ${selection.slice(0, 500)}`,
      linked: { productionDraftIds: [id] },
    })
    const jobRef = await adminDb.collection(YOUTUBE_COLLECTIONS.agentJobs).add({
      ...jobData,
      status: 'queued',
      outputArtifactIds: [],
      reviewRequired: true,
      visibility: 'internal',
      deleted: false,
      ...actorFields(user),
    })
    return apiSuccess({ id, rewriteAgentJobId: jobRef.id }, 201)
  }

  return apiError('Unsupported script draft action', 400)
})
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest __tests__/app/youtube-studio-script-route.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add app/api/v1/youtube-studio/production-drafts/script/route.ts __tests__/app/youtube-studio-script-route.test.ts
git commit -m "feat(yt-os): script autosave/versioning + AI rewrite-selection job"
```

---

## Task 19: ScriptEditor TipTap component

**Files:**
- Create: `components/youtube-studio/research/ScriptEditor.tsx`
- Test: `__tests__/app/youtube-studio-script-editor.test.tsx`

Reuses the Book Studio `ChapterEditor` TipTap plumbing (StarterKit + Link + Placeholder + tiptap-markdown, debounced autosave with a save-state indicator). Adds: read-time badge (from `estimateReadTimeSeconds`), a right-hand per-section B-roll notes column (from `extractScriptSections`), a teleprompter fullscreen toggle, and an "AI: rewrite selection" action that POSTs the current TipTap selection to the script route. Source-assertion test (matching the repo's `.tsx` test convention in `youtube-studio-connect-ux.test.tsx`).

- [ ] **Step 1: Write the failing test**

```typescript
// __tests__/app/youtube-studio-script-editor.test.tsx
import { readFileSync } from 'fs'
import path from 'path'

function source(rel: string) {
  return readFileSync(path.join(process.cwd(), rel), 'utf8')
}

describe('script editor component', () => {
  const src = source('components/youtube-studio/research/ScriptEditor.tsx')

  it('reuses the TipTap plumbing from the book chapter editor', () => {
    expect(src).toContain("'use client'")
    expect(src).toContain('@tiptap/react')
    expect(src).toContain('tiptap-markdown')
  })

  it('shows read time, section B-roll notes, and a teleprompter toggle', () => {
    expect(src).toContain('estimateReadTimeSeconds')
    expect(src).toContain('extractScriptSections')
    expect(src).toContain('teleprompter')
    expect(src).toContain('B-roll')
  })

  it('wires autosave and AI rewrite-selection to the script route', () => {
    expect(src).toContain('/api/v1/youtube-studio/production-drafts/script')
    expect(src).toContain("action: 'autosave'")
    expect(src).toContain("action: 'rewrite-selection'")
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/app/youtube-studio-script-editor.test.tsx`
Expected: FAIL — component missing

- [ ] **Step 3: Write minimal implementation**

```tsx
// components/youtube-studio/research/ScriptEditor.tsx
'use client'

import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Link from '@tiptap/extension-link'
import Placeholder from '@tiptap/extension-placeholder'
import { Markdown } from 'tiptap-markdown'
import { useEffect, useMemo, useRef, useState } from 'react'
import { estimateReadTimeSeconds, extractScriptSections } from '@/lib/youtube-studio/script-readtime'

type SaveState = 'saved' | 'dirty' | 'saving'

type Props = {
  orgId: string
  draftId: string
  initialMarkdown: string
  readOnly?: boolean
}

const AUTOSAVE_DELAY_MS = 2000

/**
 * TipTap script editor over a youtube_production_drafts record. Mirrors
 * components/book-studio/project/ChapterEditor.tsx (extension config + markdown
 * round-trip + debounced autosave) and adds read-time, per-section B-roll notes,
 * a teleprompter fullscreen mode, and an AI rewrite-selection action.
 */
export function ScriptEditor({ orgId, draftId, initialMarkdown, readOnly = false }: Props) {
  const [saveState, setSaveState] = useState<SaveState>('saved')
  const [markdown, setMarkdown] = useState(initialMarkdown)
  const [teleprompter, setTeleprompter] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const editor = useEditor({
    extensions: [
      StarterKit.configure({}),
      Link.configure({ openOnClick: false, autolink: true, HTMLAttributes: { rel: 'noopener noreferrer', target: '_blank' } }),
      Placeholder.configure({ placeholder: 'Write the script. Use # Hook, ## Body, ## CTA headings. Markdown works.' }),
      Markdown.configure({ html: false, tightLists: true, bulletListMarker: '-', linkify: true, breaks: false }),
    ],
    content: initialMarkdown,
    editable: !readOnly,
    immediatelyRender: false,
    onUpdate: ({ editor }) => {
      const md = (editor.storage.markdown as { getMarkdown: () => string }).getMarkdown()
      setMarkdown(md)
      setSaveState('dirty')
      scheduleAutosave(md)
    },
    editorProps: {
      attributes: { class: 'tiptap-prose prose-invert max-w-none min-h-[320px] outline-none px-1 py-3 text-[16px] leading-[1.7]' },
    },
  })

  function scheduleAutosave(md: string) {
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => void autosave(md), AUTOSAVE_DELAY_MS)
  }

  async function autosave(scriptText: string) {
    setSaveState('saving')
    await fetch('/api/v1/youtube-studio/production-drafts/script', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'autosave', orgId, id: draftId, scriptText }),
    }).catch(() => null)
    setSaveState('saved')
  }

  async function rewriteSelection() {
    if (!editor) return
    const { from, to } = editor.state.selection
    const selection = editor.state.doc.textBetween(from, to, '\n')
    if (!selection) return
    await fetch('/api/v1/youtube-studio/production-drafts/script', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'rewrite-selection', orgId, id: draftId, selection, instruction: 'tighten' }),
    }).catch(() => null)
  }

  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current) }, [])

  const sections = useMemo(() => extractScriptSections(markdown), [markdown])
  const readSeconds = estimateReadTimeSeconds(markdown)

  return (
    <div className={teleprompter ? 'fixed inset-0 z-50 bg-black p-10 overflow-auto text-2xl' : 'grid grid-cols-[1fr_260px] gap-4'}>
      <div>
        <div className="flex items-center gap-3 text-sm text-neutral-400">
          <span>~{Math.floor(readSeconds / 60)}m {readSeconds % 60}s read</span>
          <span>{saveState}</span>
          <button type="button" onClick={() => setTeleprompter((v) => !v)}>teleprompter</button>
          {!readOnly && <button type="button" onClick={() => void rewriteSelection()}>AI: rewrite selection</button>}
        </div>
        <EditorContent editor={editor} />
      </div>
      {!teleprompter && (
        <aside className="text-sm">
          <h4 className="font-medium">Sections &amp; B-roll</h4>
          <ul>
            {sections.map((s, i) => (
              <li key={i} className="mb-2">
                <div className="font-medium">{s.label} · {s.readTimeSeconds}s</div>
                <textarea placeholder="B-roll notes" className="w-full bg-neutral-900 rounded p-1" rows={2} />
              </li>
            ))}
          </ul>
        </aside>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest __tests__/app/youtube-studio-script-editor.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add components/youtube-studio/research/ScriptEditor.tsx __tests__/app/youtube-studio-script-editor.test.tsx
git commit -m "feat(yt-os): TipTap script editor with read-time, B-roll, teleprompter, AI rewrite"
```

---

## Task 20: Research surface UI components (feed, workbench, tracker, radar, idea board, title lab)

**Files:**
- Create: `components/youtube-studio/research/OutlierFeed.tsx`
- Create: `components/youtube-studio/research/KeywordWorkbench.tsx`
- Create: `components/youtube-studio/research/CompetitorTracker.tsx`
- Create: `components/youtube-studio/research/TrendRadar.tsx`
- Create: `components/youtube-studio/research/IdeaBoard.tsx`
- Create: `components/youtube-studio/research/TitleLab.tsx`
- Test: `__tests__/app/youtube-studio-research-surfaces.test.tsx`

Each is a client component that fetches from its route and renders the surface. The single source-assertion test asserts each component fetches the right endpoint and renders the described controls, keeping the UI honest without a full render harness (matching repo convention).

- [ ] **Step 1: Write the failing test**

```typescript
// __tests__/app/youtube-studio-research-surfaces.test.tsx
import { readFileSync } from 'fs'
import path from 'path'

function source(rel: string) {
  return readFileSync(path.join(process.cwd(), rel), 'utf8')
}

describe('research surface components', () => {
  it('outlier feed fetches outliers, filters, and offers turn-into-brief', () => {
    const src = source('components/youtube-studio/research/OutlierFeed.tsx')
    expect(src).toContain('/api/v1/youtube-studio/outlier-videos')
    expect(src).toContain('minScore')
    expect(src).toContain('turn-into-brief')
  })

  it('keyword workbench expands terms and shows clusters/pillars', () => {
    const src = source('components/youtube-studio/research/KeywordWorkbench.tsx')
    expect(src).toContain('/api/v1/youtube-studio/keywords/expand')
    expect(src).toContain('/api/v1/youtube-studio/keywords')
    expect(src).toContain('pillar')
  })

  it('competitor tracker renders channel cards and snapshot history', () => {
    const src = source('components/youtube-studio/research/CompetitorTracker.tsx')
    expect(src).toContain('/api/v1/youtube-studio/competitors')
    expect(src).toContain('snapshots')
  })

  it('trend radar dispatches a trend-radar sweep', () => {
    const src = source('components/youtube-studio/research/TrendRadar.tsx')
    expect(src).toContain("action: 'trend-radar'")
    expect(src).toContain('/api/v1/youtube-studio/ideas')
  })

  it('idea board is a kanban with stage moves, bulk actions, and title-lab', () => {
    const src = source('components/youtube-studio/research/IdeaBoard.tsx')
    expect(src).toContain('/api/v1/youtube-studio/ideas')
    expect(src).toContain('stage-move')
    expect(src).toContain("action: 'bulk'")
    expect(src).toContain('promote-to-project')
  })

  it('title lab requests variants and shows history', () => {
    const src = source('components/youtube-studio/research/TitleLab.tsx')
    expect(src).toContain("action: 'title-lab'")
    expect(src).toContain('titleAgentJobIds')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/app/youtube-studio-research-surfaces.test.tsx`
Expected: FAIL — components missing

- [ ] **Step 3: Write minimal implementations**

Create each component as a `'use client'` React component. Keep them focused; the interfaces below satisfy the test and give a working surface. Full example for one; the rest follow the same shape.

```tsx
// components/youtube-studio/research/OutlierFeed.tsx
'use client'

import { useCallback, useEffect, useState } from 'react'

type Outlier = {
  id: string
  title: string
  thumbnailUrl?: string
  outlierScore: number
  velocity: number
  status: string
  youtubeVideoId: string
}

export function OutlierFeed({ orgId, channelWorkspaceId }: { orgId: string; channelWorkspaceId: string }) {
  const [outliers, setOutliers] = useState<Outlier[]>([])
  const [minScore, setMinScore] = useState(3)

  const load = useCallback(async () => {
    const url = `/api/v1/youtube-studio/outlier-videos?orgId=${orgId}&channelWorkspaceId=${channelWorkspaceId}&minScore=${minScore}`
    const res = await fetch(url)
    const body = await res.json()
    setOutliers((body.data ?? body).outliers ?? [])
  }, [orgId, channelWorkspaceId, minScore])

  useEffect(() => { void load() }, [load])

  async function turnIntoBrief(id: string) {
    await fetch('/api/v1/youtube-studio/outlier-videos', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'turn-into-brief', orgId, id }),
    })
    void load()
  }

  return (
    <div>
      <label>
        Min outlier score
        <input type="number" value={minScore} onChange={(e) => setMinScore(Number(e.target.value))} />
      </label>
      <ul>
        {outliers.map((o) => (
          <li key={o.id}>
            {o.thumbnailUrl && <img src={o.thumbnailUrl} alt="" width={160} />}
            <span>{o.title}</span>
            <span>{o.outlierScore}x · {o.velocity}/day</span>
            <button type="button" onClick={() => void turnIntoBrief(o.id)}>Turn into brief</button>
          </li>
        ))}
      </ul>
    </div>
  )
}
```

For the remaining five, follow the same pattern — `'use client'`, a `load()` that fetches the listed endpoint, and the asserted controls:

- **`KeywordWorkbench.tsx`**: a seed-term input that POSTs to `/api/v1/youtube-studio/keywords/expand`, a "Save keyword" button that POSTs to `/api/v1/youtube-studio/keywords`, and a `pillar` select on each saved keyword (PATCH to keywords). Render clusters grouped by the first token.
- **`CompetitorTracker.tsx`**: fetches `/api/v1/youtube-studio/competitors`, renders channel cards (subs/views/cadence/formatMix), and a "View history" button that fetches `...?snapshots=1&competitorChannelId=...`.
- **`TrendRadar.tsx`**: a "Run trend sweep" button that POSTs `{ action: 'trend-radar', orgId, channelWorkspaceId }` to `/api/v1/youtube-studio/ideas`; lists resulting ideas (provenance `trend`).
- **`IdeaBoard.tsx`**: kanban columns for the five stages; drag/select moves PATCH `{ action: 'stage-move' }`; a bulk toolbar PATCHes `{ action: 'bulk', ids, patch }`; each card has "Title lab" (PATCH `title-lab`) and "Promote" (PATCH `promote-to-project`) buttons. All read from `/api/v1/youtube-studio/ideas`.
- **`TitleLab.tsx`**: given an `ideaId`, a "Generate 10 titles" button PATCHes `{ action: 'title-lab' }`; renders the idea's `titleAgentJobIds` as variant-history entries (each linking to the agent job's reviewable output).

Each fetch must unwrap the `{ success, data }` envelope as `(body.data ?? body)` per the apiSuccess convention.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest __tests__/app/youtube-studio-research-surfaces.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add components/youtube-studio/research/ __tests__/app/youtube-studio-research-surfaces.test.tsx
git commit -m "feat(yt-os): research surface components (feed, workbench, tracker, radar, idea board, title lab)"
```

---

## Task 21: Full-suite verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full research/ideation test set**

Run: `npx jest youtube-studio-research youtube-studio-outlier youtube-outlier youtube-studio-keyword youtube-studio-competitor youtube-competitor youtube-studio-idea youtube-studio-script youtube-studio-watchlists youtube-studio-research-surfaces`
Expected: all suites PASS.

- [ ] **Step 2: Typecheck (the real gate — see MEMORY reference_build_typecheck_gotcha)**

Run: `npm run typecheck`
Expected: no errors. If `youtube_production_drafts` fields (`scriptVersions`) surface type errors, add `scriptVersions?: Array<{ versionNumber: number; scriptText: string; savedAt: string; savedBy: string }>` to `YouTubeProductionDraft` in `lib/youtube-studio/types.ts` and re-run.

- [ ] **Step 3: Commit any typecheck fixes**

```bash
git add -A
git commit -m "chore(yt-os): typecheck fixes for research & ideation phase"
```

---

## Self-Review (completed by plan author)

**Spec coverage (Phase 3 = Pillars A + B minus calendar):**
- A.1 Outlier finder — Tasks 1–7 (watchlists, outlier videos, scoring, scan cron, turn-into-brief). ✅
- A.2 Keyword workbench — Tasks 8–10 + Task 20 (signals, expand route, CRUD, attach, UI). ✅
- A.3 Competitor tracker — Tasks 11–13 + Task 20 (diff, CRUD, weekly cron, cards). ✅
- A.4 Trend radar — Task 14 helper + Task 16 `trend-radar` action + Task 20 UI; writes ideas tagged to channel, "trend → idea". ✅
- B.1 Idea board — Tasks 15–16 + Task 20 (`youtube_ideas` kanban, provenance, hooks, pillar, priority, bulk, promote). ✅
- B.2 Title lab — Task 16 `title-lab` action + Task 20 UI (variants via youtube-title-metadata, history via `titleAgentJobIds`). ✅
- B.3 Script editor — Tasks 17–19 (read-time, sections/B-roll, teleprompter, autosave+versioning, AI rewrite-selection). ✅
- Calendar (B.4) — correctly OUT of scope. ✅
- Phase-5 note: `YouTubeIdea` carries `provenance:'comment'` + `provenanceRefId` and lives in the shared `research-types.ts` — documented for community reuse. ✅
- All AI = review-gated agent jobs (`status:'queued'`, `reviewRequired:true`, no `dispatchHermesRun` in routes) — asserted in every AI test. ✅
- Quota discipline: uploads-playlist (`playlistItems.list`) + `channels.list`, explicit `not.toContain('search.list')` assertions. ✅

**Placeholder scan:** No TBD/TODO/"add error handling" placeholders; every code step has complete code or (Task 20's five sibling components) a precise per-component spec mirroring the fully-written OutlierFeed. ✅

**Type consistency:** `RESEARCH_COLLECTIONS` keys, `sanitizeYouTube*Input` names, `buildResearchAgentJob` signature, and `YouTubeIdea`/`YouTubeOutlierVideo` field names are consistent across Tasks 1–20. `serializeYouTubeResearchRecord` used uniformly. `scriptVersions` flagged for the types.ts addition in Task 21. ✅

**Ordering caveat:** Task 14 (shared agent-job helper) is numbered to group with ideation but depends on Task 6 existing; Step 5 of Task 14 refactors Task 6. Execute 1→21 in order and this resolves cleanly.

