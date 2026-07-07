# YT-OS Phase 4 — Growth Loop (Editor E3 + Analytics) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the moat phase of the [[2026-07-06-youtube-channel-operating-system-spec]]: store full YouTube retention curves and overlay them on the video-editor timeline mapped to output time (with drop-off cliff markers attached to the clips playing then), Descript-style transcript-driven ripple editing, AI auto-edit (long footage → assembled draft timeline), a multi-format render queue (one timeline → 16:9 + 9:16 + 1:1 in one dispatch, one credit charge), frame-accurate client review comments pinned to timecodes with per-version approval, a channel + per-video analytics dashboard with a weekly agent-written report, repurposing automation (long-form → Shorts renders → social drafts), and a per-org/day YouTube API quota ledger.

**Architecture:** All retention math lives in browser-safe pure modules (`lib/youtube-studio/retention-curve.ts` for cliff detection via a first-derivative threshold, `lib/video-editor/retention-overlay.ts` for output-time↔source-time mapping) so both the Inspector overlay and the Jest suite share one implementation. Retention curves are stored raw in a new `youtube_retention_curves` collection (one doc per video/period, `elapsedVideoTimeRatio`-indexed `audienceWatchRatio`/`relativeRetentionPerformance` points) written by an extended analytics ingestion path. Timeline-driven editing reuses the existing pure `lib/video-editor/timeline-ops.ts` ripple ops (Phase 1a `rippleDeleteClip`) and the Phase 1b `video_editor_transcripts` collection + `'caption'` track kind; the transcript↔timeline mapping is a new pure module. The multi-format render queue is a NEW collection `video_editor_render_batches` that fans one timeline out into N existing `video_editor_render_jobs` (one per format, per-format caption-layout overrides), charging credits ONCE across the batch with per-format line items, then registering each output back to source assets. Frame-accurate review reuses the unified `comments` collection by adding a `video_editor_render_version` resource type and putting `{ timecodeSeconds }` in the existing `anchor` field; per-version approval reuses the `YouTubePacketApprovalState` shape via a new lightweight `video_editor_review_versions` collection. The analytics dashboard is read-only over existing `youtube_analytics_snapshots` + the new curves; the weekly report and all AI edit/repurpose/retention-annotation jobs are **review-gated `youtube_agent_jobs`** (existing pattern — created `waiting_for_review`, never mutating publish/schedule/visibility state). The quota ledger is a new `youtube_api_quota_ledger` collection (per org/day; Phase 5 reuses it) with a pure forecasting module.

**Tech Stack:** Next.js 15 App Router (`withAuth('admin', …)` + `apiSuccess`/`apiError` envelope; `params` is a Promise — `await ctx.params`), Firestore via `firebase-admin` (`FieldValue.serverTimestamp()`, `stripUndefinedDeep`), React 18 client components with the `pib-card-section` Tailwind system, `googleapis` youtubeAnalytics v2, Jest 30 (`ts-jest`; node project runs `__tests__/**/*.test.ts`, jsdom project runs `__tests__/**/*.test.tsx`). The VPS ffmpeg executor is **not** modified in this phase — the multi-format queue dispatches N of the existing `video_editor_render` manifests the executor already understands. No executor deploy task is required.

**Branch rule:** All work on `development` in `partnersinbiz-web`. Run the git preflight (Task 0) before Task 1. Never touch `main`. No worktrees. No feature branches.

**Scope guard (Phase 4 only):** Community/comments inbox, sponsorship CRM, P&L, and the cockpit UX redesign are LATER phases (0/5). Auto-reframe/subject-tracking smart crop is a Phase 1c/E2 concern — the 9:16 and 1:1 formats here use the render settings' aspect + a per-format caption-layout override only (dumb center-crop is the executor's existing behaviour). Transcription itself is Phase 1b — Phase 4 *consumes* `video_editor_transcripts` docs and only adds a review-gated dispatch that *requests* a transcript when one is missing.

**Naming consistency (locked to Phase 1a/1b):** transcript collection `video_editor_transcripts`; transcript types `VideoEditorTranscript`, `TranscriptSegment`, `TranscriptWord` (absolute media seconds); caption track kind `'caption'`; ripple op `rippleDeleteClip(timeline, trackId, clipId)` from `lib/video-editor/timeline-ops.ts`; credit ledger label pattern like `video_editor_render`; `YOUTUBE_COLLECTIONS` map in `lib/youtube-studio/api.ts`; `VIDEO_EDITOR_COLLECTIONS` map in `lib/video-editor/api.ts`.

---

## File Structure

All paths relative to `/Users/peetstander/Cowork/Partners in Biz — Client Growth/partnersinbiz-web`.

### Created

| File | Responsibility |
|---|---|
| `lib/youtube-studio/retention-curve.ts` | Pure curve domain: `RetentionCurvePoint`/`YouTubeRetentionCurve` types, `parseRetentionReportToCurve` (from Analytics API report rows), `detectRetentionCliffs` (first-derivative threshold), `sanitizeRetentionCurveInput` |
| `lib/video-editor/retention-overlay.ts` | Pure output-time↔source math: `buildOutputTimeline` (clip → absolute output ranges honouring speed), `mapCurveToTimeline` (curve ratio → output seconds → owning clip), `cliffMarkersForTimeline` |
| `lib/video-editor/transcript-sync.ts` | Pure Descript mapping: `wordsToClipRanges` (transcript word range → `{trackId, clipId, startSeconds, endSeconds}` on video/caption tracks), `fillerWordSpans` (um/uh + custom list), `rippleRemoveRanges` (fold ranges into repeated `rippleDeleteClip`) |
| `lib/video-editor/render-batch.ts` | Pure multi-format domain: `RenderBatchFormat`, `VideoEditorRenderBatch` types, `planRenderBatch` (timeline + formats + caption overrides → per-format job specs), `batchCreditLineItems` (one total, per-format breakdown) |
| `lib/video-editor/review-versions.ts` | Pure review domain: `VideoEditorReviewVersion` type, `reviewVersionFromRenderJob`, `applyReviewDecision` (reuses `YouTubePacketApprovalStatus`) |
| `lib/youtube-studio/quota-ledger.ts` | Pure quota domain: `QuotaOp`/`YOUTUBE_QUOTA_COSTS`, `YouTubeApiQuotaLedgerEntry`, `quotaLedgerDocId`, `applyQuotaUsage`, `forecastRemainingUploads` |
| `lib/youtube-studio/channel-report.ts` | Pure report builder: `buildWeeklyChannelReport` (snapshots + curves → markdown-ish report sections + recommendation summary) |
| `app/api/v1/youtube-studio/retention-curves/route.ts` | GET curves by orgId/videoProjectId; POST ingest a curve (admin) |
| `app/api/v1/youtube-studio/retention-curves/[id]/route.ts` | GET one curve; PUT retention-review annotations (cut-candidate/hook-fix notes) |
| `app/api/v1/youtube-studio/quota-ledger/route.ts` | GET org ledger (range) + today forecast; POST record a quota op |
| `app/api/v1/youtube-studio/channel-report/route.ts` | POST create a review-gated `youtube-retention-review`/report agent job; GET latest report artifact |
| `app/api/v1/video-editor/projects/[id]/retention-overlay/route.ts` | GET mapped curve + cliff markers for a project whose linked video is published |
| `app/api/v1/video-editor/projects/[id]/transcript-edit/route.ts` | POST apply transcript-driven ripple removals (ranges or filler-all) → new timeline |
| `app/api/v1/video-editor/projects/[id]/auto-edit/route.ts` | POST review-gated `youtube-clip-finder` auto-edit job → new draft editor project |
| `app/api/v1/video-editor/render-batches/route.ts` | POST create a batch (charge once, fan out N render jobs); GET list batches |
| `app/api/v1/video-editor/render-batches/[id]/route.ts` | GET batch + child job status; PUT roll-up child completion |
| `app/api/v1/video-editor/review-versions/route.ts` | GET review versions for a project; POST create from a render job |
| `app/api/v1/video-editor/review-versions/[id]/route.ts` | GET one; PUT approval decision (approve/changes_requested) |
| `app/api/v1/youtube-studio/videos/[id]/repurpose-clips/route.ts` | POST review-gated auto-clip repurpose (transcript → clip-finder → multi-format Shorts batch → social drafts) |
| `app/api/v1/portal/video-editor/review-versions/[id]/route.ts` | Portal GET review version + comments; PUT client approval decision |
| `components/video-editor/RetentionOverlay.tsx` | Canvas retention curve painted above the timeline ruler, cliff-marker pins |
| `components/video-editor/TranscriptPanel.tsx` | Two-way transcript panel: click word → playhead; select sentences + delete → ripple; filler-word remove-all |
| `components/video-editor/RenderBatchDialog.tsx` | Multi-format picker + per-format caption-layout override + single credit total |
| `components/video-editor/ReviewCommentsPanel.tsx` | Timecode-pinned comments on a rendered preview + per-version approval controls |
| `components/youtube-studio/AnalyticsDashboard.tsx` | Channel + per-video dashboard (trends, Shorts vs long-form, traffic, demographics, revenue-when-granted, freshness labels) |
| `components/youtube-studio/RetentionExplorer.tsx` | Per-video retention curve + hook (first 30s) scorecard |
| `app/(admin)/youtube-studio/analytics/page.tsx` | Analytics dashboard route |
| `app/portal/video-editor/review/[id]/page.tsx` | Client frame-accurate review page |
| `__tests__/lib/youtube-retention-curve.test.ts` | Curve parse + cliff detection + sanitizer |
| `__tests__/lib/video-editor-retention-overlay.test.ts` | Output-time mapping + curve→clip attribution + speed handling |
| `__tests__/lib/video-editor-transcript-sync.test.ts` | word→clip ranges, filler spans, ripple fold |
| `__tests__/lib/video-editor-render-batch.test.ts` | plan fan-out, single-charge line items, caption overrides |
| `__tests__/lib/video-editor-review-versions.test.ts` | version-from-job, decision transitions |
| `__tests__/lib/youtube-quota-ledger.test.ts` | doc id, apply usage, upload forecast |
| `__tests__/lib/youtube-channel-report.test.ts` | report sections + recommendation summary |
| `__tests__/app/youtube-retention-curves-route.test.ts` | curves GET/POST/PUT auth + tenant |
| `__tests__/app/video-editor-render-batches-route.test.ts` | batch single-charge + fan-out |
| `__tests__/app/video-editor-review-versions-route.test.ts` | version + portal approval |
| `__tests__/app/youtube-quota-ledger-route.test.ts` | ledger record + forecast |
| `__tests__/app/youtube-repurpose-clips-route.test.ts` | review-gated auto-clip job creation |

### Modified

| File | Change |
|---|---|
| `lib/youtube-studio/api.ts` | Add `retentionCurves: 'youtube_retention_curves'`, `quotaLedger: 'youtube_api_quota_ledger'` to `YOUTUBE_COLLECTIONS` |
| `lib/video-editor/api.ts` | Add `renderBatches: 'video_editor_render_batches'`, `reviewVersions: 'video_editor_review_versions'` to `VIDEO_EDITOR_COLLECTIONS` |
| `lib/youtube-studio/analytics-ingestion.ts` | Also return the raw retention curve (`buildRetentionCurveFromReport`) so the ingest route can persist it |
| `lib/youtube-studio/publish-executor.ts` | On `upload_succeeded`, record the upload quota op in the ledger (`applyQuotaUsage`) alongside the existing channel decrement |
| `lib/comments/types.ts` | Add `'video_editor_render_version'` to `CommentResourceType` + `VALID_COMMENT_RESOURCE_TYPES` |
| `app/api/v1/comments/route.ts` | Accept a numeric `anchor.timecodeSeconds` for the new resource type |
| `lib/video-editor/credits.ts` | `estimateRenderBatchCredits` (sum of per-format estimates, one charge) |
| `components/video-editor/VideoEditorShell.tsx` | Right-panel tabs: Transcript / Review; retention overlay mount; render-batch + review wiring |
| `components/youtube-studio/YouTubeStudioWorkspace.tsx` (or the cockpit shell) | Add an "Analytics" entry pointing at the dashboard route |
| `firestore.indexes.json` | `youtube_retention_curves (orgId ASC, videoProjectId ASC)`, `youtube_api_quota_ledger (orgId ASC, day ASC)`, `video_editor_render_batches (orgId ASC, projectId ASC)`, `video_editor_review_versions (orgId ASC, projectId ASC)` |

---

## Task 0: Git preflight

**Files:** none (repo state only)

- [ ] **Step 0.1: Sync `development`**

```bash
cd "/Users/peetstander/Cowork/Partners in Biz — Client Growth/partnersinbiz-web"
git status --short --branch
# If dirty: git add -A && git commit -m "chore(agent): checkpoint existing local work before sync"
git checkout development
git pull --rebase origin development
git status --short --branch
```

Expected: `## development...origin/development` and a clean tree.

- [ ] **Step 0.2: Verify the base editor + youtube suites are green before touching anything**

Run: `npx jest __tests__/lib/video-editor-types.test.ts __tests__/lib/youtube-studio-sanitize.test.ts --silent`
Expected: PASS. If a suite is red, stop and fix upstream first — do not build on a red base.

No commit for this task.

---

## Task 1: Collection names — new Firestore collections

**Files:**
- Modify: `lib/youtube-studio/api.ts:11-24`
- Modify: `lib/video-editor/api.ts:6-9`
- Test: `__tests__/lib/youtube-quota-ledger.test.ts` (created here, expanded later)

- [ ] **Step 1.1: Write the failing test** — create `__tests__/lib/youtube-quota-ledger.test.ts`:

```ts
import { YOUTUBE_COLLECTIONS } from '@/lib/youtube-studio/api'
import { VIDEO_EDITOR_COLLECTIONS } from '@/lib/video-editor/api'

describe('phase 4 collection names', () => {
  it('adds retention-curve and quota-ledger collections', () => {
    expect(YOUTUBE_COLLECTIONS.retentionCurves).toBe('youtube_retention_curves')
    expect(YOUTUBE_COLLECTIONS.quotaLedger).toBe('youtube_api_quota_ledger')
  })
  it('adds render-batch and review-version collections', () => {
    expect(VIDEO_EDITOR_COLLECTIONS.renderBatches).toBe('video_editor_render_batches')
    expect(VIDEO_EDITOR_COLLECTIONS.reviewVersions).toBe('video_editor_review_versions')
  })
})
```

- [ ] **Step 1.2: Run test to verify it fails**

Run: `npx jest __tests__/lib/youtube-quota-ledger.test.ts --silent`
Expected: FAIL — `retentionCurves` is undefined.

- [ ] **Step 1.3: Implement** — in `lib/youtube-studio/api.ts`, add two keys to `YOUTUBE_COLLECTIONS` (after `analytics: 'youtube_analytics_snapshots',`):

```ts
  retentionCurves: 'youtube_retention_curves',
  quotaLedger: 'youtube_api_quota_ledger',
```

In `lib/video-editor/api.ts`, extend `VIDEO_EDITOR_COLLECTIONS`:

```ts
export const VIDEO_EDITOR_COLLECTIONS = {
  projects: 'video_editor_projects',
  renderJobs: 'video_editor_render_jobs',
  renderBatches: 'video_editor_render_batches',
  reviewVersions: 'video_editor_review_versions',
} as const
```

- [ ] **Step 1.4: Run test to verify it passes**

Run: `npx jest __tests__/lib/youtube-quota-ledger.test.ts --silent`
Expected: PASS.

- [ ] **Step 1.5: Commit**

```bash
git add lib/youtube-studio/api.ts lib/video-editor/api.ts __tests__/lib/youtube-quota-ledger.test.ts
git commit -m "feat(yt-os): phase 4 collection names for curves, quota, batches, review versions"
```

---

## Task 2: Retention curve domain — parse + cliff detection (THE MOAT, part 1)

**Files:**
- Create: `lib/youtube-studio/retention-curve.ts`
- Test: `__tests__/lib/youtube-retention-curve.test.ts`

- [ ] **Step 2.1: Write the failing test** — create `__tests__/lib/youtube-retention-curve.test.ts`:

```ts
import {
  detectRetentionCliffs,
  parseRetentionReportToCurve,
  sanitizeRetentionCurveInput,
} from '@/lib/youtube-studio/retention-curve'

describe('parseRetentionReportToCurve', () => {
  it('maps elapsedVideoTimeRatio rows to ordered points', () => {
    const report = {
      columnHeaders: [
        { name: 'elapsedVideoTimeRatio' },
        { name: 'audienceWatchRatio' },
        { name: 'relativeRetentionPerformance' },
      ],
      rows: [
        [0, 1, 0.5],
        [0.5, 0.6, 0.4],
        [0.25, 0.8, 0.45],
      ],
    }
    const curve = parseRetentionReportToCurve(report)
    expect(curve.map((p) => p.elapsedRatio)).toEqual([0, 0.25, 0.5])
    expect(curve[0]).toEqual({ elapsedRatio: 0, audienceWatchRatio: 1, relativeRetentionPerformance: 0.5 })
  })
})

describe('detectRetentionCliffs', () => {
  it('flags a drop steeper than the derivative threshold', () => {
    const curve = [
      { elapsedRatio: 0, audienceWatchRatio: 1 },
      { elapsedRatio: 0.1, audienceWatchRatio: 0.95 },
      { elapsedRatio: 0.2, audienceWatchRatio: 0.5 }, // -0.45 over 0.1 => slope -4.5
      { elapsedRatio: 0.3, audienceWatchRatio: 0.48 },
    ]
    const cliffs = detectRetentionCliffs(curve, { slopeThreshold: -2 })
    expect(cliffs).toHaveLength(1)
    expect(cliffs[0].fromRatio).toBeCloseTo(0.1)
    expect(cliffs[0].toRatio).toBeCloseTo(0.2)
    expect(cliffs[0].dropMagnitude).toBeCloseTo(0.45)
  })

  it('returns no cliffs for a gently declining curve', () => {
    const curve = [
      { elapsedRatio: 0, audienceWatchRatio: 1 },
      { elapsedRatio: 0.5, audienceWatchRatio: 0.9 },
      { elapsedRatio: 1, audienceWatchRatio: 0.8 },
    ]
    expect(detectRetentionCliffs(curve, { slopeThreshold: -2 })).toEqual([])
  })
})

describe('sanitizeRetentionCurveInput', () => {
  it('clamps ratios to [0,1], drops non-finite, sorts by elapsedRatio', () => {
    const clean = sanitizeRetentionCurveInput({
      orgId: 'org1',
      channelWorkspaceId: 'ch1',
      videoProjectId: 'v1',
      youtubeVideoId: 'yt1',
      periodStart: '2026-06-01',
      periodEnd: '2026-06-30',
      points: [
        { elapsedRatio: 1.4, audienceWatchRatio: 0.2 },
        { elapsedRatio: 0.5, audienceWatchRatio: 2 },
        { elapsedRatio: Number.NaN, audienceWatchRatio: 0.5 },
      ],
    })
    expect(clean.points.map((p) => p.elapsedRatio)).toEqual([0.5, 1])
    expect(clean.points[0].audienceWatchRatio).toBe(1)
    expect(clean.deleted).toBe(false)
  })
})
```

- [ ] **Step 2.2: Run test to verify it fails**

Run: `npx jest __tests__/lib/youtube-retention-curve.test.ts --silent`
Expected: FAIL — module not found.

- [ ] **Step 2.3: Implement** — create `lib/youtube-studio/retention-curve.ts`:

```ts
import type { ActorType } from './types'

export interface RetentionCurvePoint {
  /** elapsedVideoTimeRatio: 0 = start, 1 = end of the video. */
  elapsedRatio: number
  /** 1.0 = an average video holds this fraction; higher is better. */
  audienceWatchRatio: number
  relativeRetentionPerformance?: number
}

export interface RetentionCliff {
  fromRatio: number
  toRatio: number
  /** Positive number: how much audienceWatchRatio fell across the segment. */
  dropMagnitude: number
  slope: number
}

export interface YouTubeRetentionCurve {
  id?: string
  orgId: string
  channelWorkspaceId: string
  videoProjectId?: string
  youtubeVideoId?: string
  periodStart: string
  periodEnd: string
  points: RetentionCurvePoint[]
  /** Attached by the youtube-retention-review agent job (Task 4). */
  annotations?: Array<{
    fromRatio: number
    toRatio: number
    kind: 'cut_candidate' | 'hook_fix' | 'note'
    note: string
    createdBy?: string
    createdByType?: ActorType
  }>
  visibility?: { showInClientPortal?: boolean }
  createdAt?: unknown
  updatedAt?: unknown
  createdBy?: string
  createdByType?: ActorType
  updatedBy?: string
  updatedByType?: ActorType
  deleted: boolean
}

interface ReportLike {
  columnHeaders?: Array<{ name?: string | null }> | null
  rows?: unknown[][] | null
}

function num(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return undefined
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value))
}

export function parseRetentionReportToCurve(report: ReportLike): RetentionCurvePoint[] {
  const headers = (report.columnHeaders ?? []).map((h) => h?.name ?? '')
  const iElapsed = headers.indexOf('elapsedVideoTimeRatio')
  const iWatch = headers.indexOf('audienceWatchRatio')
  const iRel = headers.indexOf('relativeRetentionPerformance')
  if (iElapsed < 0 || iWatch < 0) return []
  const rows = Array.isArray(report.rows) ? report.rows : []
  return rows
    .flatMap((row) => {
      const elapsed = num(row[iElapsed])
      const watch = num(row[iWatch])
      if (elapsed === undefined || watch === undefined) return []
      const rel = iRel >= 0 ? num(row[iRel]) : undefined
      const point: RetentionCurvePoint = { elapsedRatio: clamp01(elapsed), audienceWatchRatio: Math.max(0, watch) }
      if (rel !== undefined) point.relativeRetentionPerformance = rel
      return [point]
    })
    .sort((a, b) => a.elapsedRatio - b.elapsedRatio)
}

/**
 * Flag segments where audienceWatchRatio falls faster than `slopeThreshold`
 * (a NEGATIVE slope per unit elapsedRatio). Default threshold −2 means a >2x
 * drop in retained fraction per full-video-length unit — i.e. a sharp cliff.
 */
export function detectRetentionCliffs(
  points: RetentionCurvePoint[],
  options: { slopeThreshold?: number } = {},
): RetentionCliff[] {
  const threshold = options.slopeThreshold ?? -2
  const cliffs: RetentionCliff[] = []
  for (let i = 1; i < points.length; i += 1) {
    const prev = points[i - 1]
    const cur = points[i]
    const dx = cur.elapsedRatio - prev.elapsedRatio
    if (dx <= 0) continue
    const dy = cur.audienceWatchRatio - prev.audienceWatchRatio
    const slope = dy / dx
    if (slope <= threshold) {
      cliffs.push({ fromRatio: prev.elapsedRatio, toRatio: cur.elapsedRatio, dropMagnitude: Math.abs(dy), slope })
    }
  }
  return cliffs
}

export interface RetentionCurveInput {
  orgId: string
  channelWorkspaceId: string
  videoProjectId?: string
  youtubeVideoId?: string
  periodStart: string
  periodEnd: string
  points: Array<{ elapsedRatio: unknown; audienceWatchRatio: unknown; relativeRetentionPerformance?: unknown }>
}

export function sanitizeRetentionCurveInput(input: RetentionCurveInput): Omit<YouTubeRetentionCurve, 'id'> {
  const points = (input.points ?? [])
    .flatMap((raw) => {
      const elapsed = num(raw.elapsedRatio)
      const watch = num(raw.audienceWatchRatio)
      if (elapsed === undefined || watch === undefined) return []
      const point: RetentionCurvePoint = { elapsedRatio: clamp01(elapsed), audienceWatchRatio: clamp01(watch) }
      const rel = num(raw.relativeRetentionPerformance)
      if (rel !== undefined) point.relativeRetentionPerformance = rel
      return [point]
    })
    .sort((a, b) => a.elapsedRatio - b.elapsedRatio)
  return {
    orgId: input.orgId,
    channelWorkspaceId: input.channelWorkspaceId,
    ...(input.videoProjectId ? { videoProjectId: input.videoProjectId } : {}),
    ...(input.youtubeVideoId ? { youtubeVideoId: input.youtubeVideoId } : {}),
    periodStart: input.periodStart,
    periodEnd: input.periodEnd,
    points,
    deleted: false,
  }
}
```

- [ ] **Step 2.4: Run test to verify it passes**

Run: `npx jest __tests__/lib/youtube-retention-curve.test.ts --silent`
Expected: PASS.

- [ ] **Step 2.5: Commit**

```bash
git add lib/youtube-studio/retention-curve.ts __tests__/lib/youtube-retention-curve.test.ts
git commit -m "feat(yt-os): retention curve parse + cliff detection domain"
```

---

## Task 3: Ingestion + curve persistence + curve routes

**Files:**
- Modify: `lib/youtube-studio/analytics-ingestion.ts`
- Create: `app/api/v1/youtube-studio/retention-curves/route.ts`
- Create: `app/api/v1/youtube-studio/retention-curves/[id]/route.ts`
- Test: `__tests__/lib/youtube-retention-curve.test.ts` (extend), `__tests__/app/youtube-retention-curves-route.test.ts`

- [ ] **Step 3.1: Write the failing ingestion test** — append to `__tests__/lib/youtube-retention-curve.test.ts`:

```ts
import { buildRetentionCurveFromReport } from '@/lib/youtube-studio/analytics-ingestion'

describe('buildRetentionCurveFromReport', () => {
  it('returns a persistable curve doc from a retention report', () => {
    const doc = buildRetentionCurveFromReport({
      request: {
        orgId: 'org1',
        channelWorkspaceId: 'ch1',
        videoProjectId: 'v1',
        youtubeVideoId: 'yt1',
        periodStart: '2026-06-01',
        periodEnd: '2026-06-30',
      },
      retentionReport: {
        columnHeaders: [{ name: 'elapsedVideoTimeRatio' }, { name: 'audienceWatchRatio' }],
        rows: [[0, 1], [0.5, 0.6]],
      },
    })
    expect(doc?.orgId).toBe('org1')
    expect(doc?.points).toHaveLength(2)
    expect(doc?.deleted).toBe(false)
  })

  it('returns null when the report has no retention rows', () => {
    expect(
      buildRetentionCurveFromReport({
        request: { orgId: 'org1', channelWorkspaceId: 'ch1', periodStart: '2026-06-01', periodEnd: '2026-06-30' },
        retentionReport: {},
      }),
    ).toBeNull()
  })
})
```

- [ ] **Step 3.2: Run test to verify it fails**

Run: `npx jest __tests__/lib/youtube-retention-curve.test.ts --silent`
Expected: FAIL — `buildRetentionCurveFromReport` not exported.

- [ ] **Step 3.3: Implement in `lib/youtube-studio/analytics-ingestion.ts`** — add imports at the top:

```ts
import { parseRetentionReportToCurve, type YouTubeRetentionCurve } from './retention-curve'
```

Add the exported builder (after `buildYouTubeAnalyticsSnapshotFromApiReports`):

```ts
export function buildRetentionCurveFromReport(args: {
  request: {
    orgId: string
    channelWorkspaceId: string
    videoProjectId?: string
    youtubeVideoId?: string
    periodStart: string
    periodEnd: string
  }
  retentionReport?: { columnHeaders?: Array<{ name?: string | null }> | null; rows?: unknown[][] | null }
}): Omit<YouTubeRetentionCurve, 'id' | 'createdAt' | 'updatedAt' | 'createdBy' | 'createdByType' | 'updatedBy' | 'updatedByType'> | null {
  const points = parseRetentionReportToCurve(args.retentionReport ?? {})
  if (points.length === 0) return null
  return {
    orgId: args.request.orgId,
    channelWorkspaceId: args.request.channelWorkspaceId,
    ...(args.request.videoProjectId ? { videoProjectId: args.request.videoProjectId } : {}),
    ...(args.request.youtubeVideoId ? { youtubeVideoId: args.request.youtubeVideoId } : {}),
    periodStart: args.request.periodStart,
    periodEnd: args.request.periodEnd,
    points,
    visibility: { showInClientPortal: false },
    deleted: false,
  }
}
```

- [ ] **Step 3.4: Run test to verify it passes**

Run: `npx jest __tests__/lib/youtube-retention-curve.test.ts --silent`
Expected: PASS.

- [ ] **Step 3.5: Write the failing route test** — create `__tests__/app/youtube-retention-curves-route.test.ts`. Mock `@/lib/firebase/admin` and `@/lib/api/auth` following the pattern in `__tests__/app/youtube-analytics-route.test.ts` (read that file first for the exact mock shape). Assert: GET returns curves filtered by `videoProjectId`; POST with a valid body writes one doc to `youtube_retention_curves` and returns `{ curve }`; a cross-org GET is denied.

```ts
import { GET, POST } from '@/app/api/v1/youtube-studio/retention-curves/route'

// (mocks mirror __tests__/app/youtube-analytics-route.test.ts — withAuth passes an admin user
//  with orgId 'org1'; ensureOrgAccess returns null for matching org, a 403 Response otherwise.)

describe('retention-curves route', () => {
  it('POST persists a curve for the org', async () => {
    const req = new Request('http://t/api/v1/youtube-studio/retention-curves', {
      method: 'POST',
      body: JSON.stringify({
        orgId: 'org1',
        channelWorkspaceId: 'ch1',
        videoProjectId: 'v1',
        periodStart: '2026-06-01',
        periodEnd: '2026-06-30',
        points: [{ elapsedRatio: 0, audienceWatchRatio: 1 }, { elapsedRatio: 1, audienceWatchRatio: 0.4 }],
      }),
    })
    const res = await POST(req as never, { uid: 'u1', orgId: 'org1', role: 'admin' } as never)
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.data.curve.points).toHaveLength(2)
  })
})
```

- [ ] **Step 3.6: Run the route test to verify it fails**

Run: `npx jest __tests__/app/youtube-retention-curves-route.test.ts --silent`
Expected: FAIL — route module not found.

- [ ] **Step 3.7: Implement `app/api/v1/youtube-studio/retention-curves/route.ts`**:

```ts
import { NextRequest } from 'next/server'
import { adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { apiError, apiSuccess } from '@/lib/api/response'
import {
  actorFields,
  ensureOrgAccess,
  listByOrg,
  stripUndefinedDeep,
  YOUTUBE_COLLECTIONS,
} from '@/lib/youtube-studio/api'
import { serializeYouTubeRecord } from '@/lib/youtube-studio/sanitize'
import { sanitizeRetentionCurveInput, type YouTubeRetentionCurve } from '@/lib/youtube-studio/retention-curve'

export const dynamic = 'force-dynamic'

function cleanString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

export const GET = withAuth('admin', async (req, user) => {
  const url = new URL(req.url)
  const orgId = url.searchParams.get('orgId')?.trim() ?? ''
  const videoProjectId = url.searchParams.get('videoProjectId')?.trim() ?? ''
  const denied = await ensureOrgAccess(user, orgId)
  if (denied) return denied
  const docs = await listByOrg(YOUTUBE_COLLECTIONS.retentionCurves, orgId)
  const curves = docs
    .map((doc) => serializeYouTubeRecord<YouTubeRetentionCurve>(doc.id, doc.data()))
    .filter((c) => !c.deleted)
    .filter((c) => !videoProjectId || c.videoProjectId === videoProjectId)
    .sort((a, b) => b.periodEnd.localeCompare(a.periodEnd))
  return apiSuccess({ curves })
})

export const POST = withAuth('admin', async (req: NextRequest, user) => {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const orgId = cleanString(body.orgId) ?? ''
  const channelWorkspaceId = cleanString(body.channelWorkspaceId) ?? ''
  const periodStart = cleanString(body.periodStart) ?? ''
  const periodEnd = cleanString(body.periodEnd) ?? ''
  if (!orgId || !channelWorkspaceId || !periodStart || !periodEnd) {
    return apiError('orgId, channelWorkspaceId, periodStart and periodEnd are required')
  }
  const denied = await ensureOrgAccess(user, orgId)
  if (denied) return denied
  const clean = sanitizeRetentionCurveInput({
    orgId,
    channelWorkspaceId,
    videoProjectId: cleanString(body.videoProjectId),
    youtubeVideoId: cleanString(body.youtubeVideoId),
    periodStart,
    periodEnd,
    points: Array.isArray(body.points) ? (body.points as RetentionCurvePointInput[]) : [],
  })
  const ref = await adminDb.collection(YOUTUBE_COLLECTIONS.retentionCurves).add(
    stripUndefinedDeep({ ...clean, ...actorFields(user) }),
  )
  return apiSuccess({ curve: { id: ref.id, ...clean } })
})

type RetentionCurvePointInput = { elapsedRatio: unknown; audienceWatchRatio: unknown; relativeRetentionPerformance?: unknown }
```

- [ ] **Step 3.8: Implement `app/api/v1/youtube-studio/retention-curves/[id]/route.ts`** — GET one curve (org-checked via `loadScopedRecord`) and PUT annotations. PUT body: `{ annotations: Array<{ fromRatio, toRatio, kind, note }> }`; merge onto the doc with `updateActorFields(user)`; annotation `kind` restricted to `'cut_candidate' | 'hook_fix' | 'note'`:

```ts
import { NextRequest } from 'next/server'
import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { apiError, apiSuccess } from '@/lib/api/response'
import {
  ensureOrgAccess,
  loadScopedRecord,
  stripUndefinedDeep,
  updateActorFields,
  YOUTUBE_COLLECTIONS,
} from '@/lib/youtube-studio/api'
import { serializeYouTubeRecord } from '@/lib/youtube-studio/sanitize'
import type { YouTubeRetentionCurve } from '@/lib/youtube-studio/retention-curve'

export const dynamic = 'force-dynamic'
const KINDS = ['cut_candidate', 'hook_fix', 'note'] as const

export const GET = withAuth('admin', async (_req, user, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params
  const record = await loadScopedRecord(YOUTUBE_COLLECTIONS.retentionCurves, id)
  if (!record || record.data.deleted === true) return apiError('Not found', 404)
  const curve = serializeYouTubeRecord<YouTubeRetentionCurve>(record.id, record.data)
  const denied = await ensureOrgAccess(user, curve.orgId)
  if (denied) return denied
  return apiSuccess({ curve })
})

export const PUT = withAuth('admin', async (req: NextRequest, user, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params
  const record = await loadScopedRecord(YOUTUBE_COLLECTIONS.retentionCurves, id)
  if (!record || record.data.deleted === true) return apiError('Not found', 404)
  const curve = serializeYouTubeRecord<YouTubeRetentionCurve>(record.id, record.data)
  const denied = await ensureOrgAccess(user, curve.orgId)
  if (denied) return denied
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const raw = Array.isArray(body.annotations) ? body.annotations : []
  const annotations = raw.flatMap((a) => {
    const item = a as Record<string, unknown>
    const kind = typeof item.kind === 'string' && (KINDS as readonly string[]).includes(item.kind) ? item.kind : 'note'
    const note = typeof item.note === 'string' ? item.note.trim() : ''
    const fromRatio = Number(item.fromRatio)
    const toRatio = Number(item.toRatio)
    if (!note || !Number.isFinite(fromRatio) || !Number.isFinite(toRatio)) return []
    return [{ fromRatio, toRatio, kind, note, createdBy: user.uid, createdByType: user.role === 'ai' ? 'agent' : 'user' }]
  })
  await record.ref.set(stripUndefinedDeep({ annotations, ...updateActorFields(user) }), { merge: true })
  return apiSuccess({ curve: { ...curve, annotations } })
})
```

- [ ] **Step 3.9: Wire ingestion to persist the curve** — in the analytics **ingest** route (`app/api/v1/youtube-studio/analytics/ingest/route.ts`), after the snapshot is written, if `buildRetentionCurveFromReport(...)` returns non-null, `adminDb.collection(YOUTUBE_COLLECTIONS.retentionCurves).add(stripUndefinedDeep({ ...curve, ...actorFields(user) }))`. Read that route first to match its existing report-fetch wiring; the retention report is already fetched by `fetchYouTubeAnalyticsApiSnapshot` for per-video pulls — thread it through or re-call `queryReport` for the retention dimensions.

- [ ] **Step 3.10: Run both suites**

Run: `npx jest __tests__/lib/youtube-retention-curve.test.ts __tests__/app/youtube-retention-curves-route.test.ts --silent`
Expected: PASS.

- [ ] **Step 3.11: Commit**

```bash
git add lib/youtube-studio/analytics-ingestion.ts app/api/v1/youtube-studio/retention-curves __tests__/lib/youtube-retention-curve.test.ts __tests__/app/youtube-retention-curves-route.test.ts app/api/v1/youtube-studio/analytics/ingest/route.ts
git commit -m "feat(yt-os): persist retention curves + curve GET/POST/PUT routes"
```

---

## Task 4: Retention overlay math — output-time mapping (THE MOAT, part 2)

**Files:**
- Create: `lib/video-editor/retention-overlay.ts`
- Test: `__tests__/lib/video-editor-retention-overlay.test.ts`

- [ ] **Step 4.1: Write the failing test** — create `__tests__/lib/video-editor-retention-overlay.test.ts`:

```ts
import {
  buildOutputTimeline,
  cliffMarkersForTimeline,
  mapCurveToTimeline,
} from '@/lib/video-editor/retention-overlay'
import type { EditorTimeline } from '@/lib/video-editor/types'

const timeline: EditorTimeline = {
  version: 1,
  tracks: [
    {
      id: 'video-1',
      kind: 'video',
      clips: [
        { id: 'clipA', timelineStart: 0, duration: 10 },
        { id: 'clipB', timelineStart: 10, duration: 10 },
      ],
    },
  ],
}

describe('buildOutputTimeline', () => {
  it('produces absolute output ranges per video clip, honouring speed', () => {
    const speedTimeline: EditorTimeline = {
      version: 1,
      tracks: [{ id: 'v', kind: 'video', clips: [{ id: 'fast', timelineStart: 0, duration: 5, speed: 2 }] }],
    }
    const ranges = buildOutputTimeline(speedTimeline)
    // speed only changes source consumption, not output placement — output span = timeline span
    expect(ranges).toEqual([{ trackId: 'v', clipId: 'fast', outputStart: 0, outputEnd: 5 }])
  })
})

describe('mapCurveToTimeline', () => {
  it('maps each curve point to the clip playing at that output second', () => {
    const totalOutput = 20
    const curve = [
      { elapsedRatio: 0.1, audienceWatchRatio: 0.9 }, // 2s → clipA
      { elapsedRatio: 0.75, audienceWatchRatio: 0.4 }, // 15s → clipB
    ]
    const mapped = mapCurveToTimeline(curve, timeline, totalOutput)
    expect(mapped[0]).toMatchObject({ outputSeconds: 2, clipId: 'clipA' })
    expect(mapped[1]).toMatchObject({ outputSeconds: 15, clipId: 'clipB' })
  })
})

describe('cliffMarkersForTimeline', () => {
  it('attaches a cliff to the clip playing at the drop', () => {
    const totalOutput = 20
    const curve = [
      { elapsedRatio: 0.5, audienceWatchRatio: 1 }, // 10s
      { elapsedRatio: 0.6, audienceWatchRatio: 0.4 }, // 12s, steep drop
    ]
    const markers = cliffMarkersForTimeline(curve, timeline, totalOutput, { slopeThreshold: -2 })
    expect(markers).toHaveLength(1)
    expect(markers[0].clipId).toBe('clipB')
    expect(markers[0].outputStart).toBeCloseTo(10)
  })
})
```

- [ ] **Step 4.2: Run test to verify it fails**

Run: `npx jest __tests__/lib/video-editor-retention-overlay.test.ts --silent`
Expected: FAIL — module not found.

- [ ] **Step 4.3: Implement** — create `lib/video-editor/retention-overlay.ts`:

```ts
import type { EditorTimeline } from './types'
import { detectRetentionCliffs, type RetentionCurvePoint } from '@/lib/youtube-studio/retention-curve'

export interface OutputClipRange {
  trackId: string
  clipId: string
  outputStart: number
  outputEnd: number
}

export interface MappedCurvePoint extends RetentionCurvePoint {
  outputSeconds: number
  trackId?: string
  clipId?: string
}

export interface TimelineCliffMarker {
  outputStart: number
  outputEnd: number
  dropMagnitude: number
  trackId?: string
  clipId?: string
}

/**
 * Video-track clips define the visible output. `speed` changes how much source
 * is consumed, NOT the clip's placement on the timeline, so output ranges equal
 * timeline ranges (matches the Phase 1a render model).
 */
export function buildOutputTimeline(timeline: EditorTimeline): OutputClipRange[] {
  const ranges: OutputClipRange[] = []
  for (const track of timeline.tracks ?? []) {
    if (track.kind !== 'video') continue
    for (const clip of track.clips ?? []) {
      ranges.push({
        trackId: track.id,
        clipId: clip.id,
        outputStart: clip.timelineStart,
        outputEnd: clip.timelineStart + clip.duration,
      })
    }
  }
  return ranges.sort((a, b) => a.outputStart - b.outputStart)
}

function clipAtOutputSecond(ranges: OutputClipRange[], seconds: number): OutputClipRange | undefined {
  return ranges.find((r) => seconds >= r.outputStart && seconds < r.outputEnd)
    ?? (ranges.length ? ranges[ranges.length - 1] : undefined)
}

export function mapCurveToTimeline(
  curve: RetentionCurvePoint[],
  timeline: EditorTimeline,
  totalOutputSeconds: number,
): MappedCurvePoint[] {
  const ranges = buildOutputTimeline(timeline)
  return curve.map((point) => {
    const outputSeconds = point.elapsedRatio * totalOutputSeconds
    const owner = clipAtOutputSecond(ranges, outputSeconds)
    return {
      ...point,
      outputSeconds,
      ...(owner ? { trackId: owner.trackId, clipId: owner.clipId } : {}),
    }
  })
}

export function cliffMarkersForTimeline(
  curve: RetentionCurvePoint[],
  timeline: EditorTimeline,
  totalOutputSeconds: number,
  options: { slopeThreshold?: number } = {},
): TimelineCliffMarker[] {
  const ranges = buildOutputTimeline(timeline)
  return detectRetentionCliffs(curve, options).map((cliff) => {
    const outputStart = cliff.fromRatio * totalOutputSeconds
    const outputEnd = cliff.toRatio * totalOutputSeconds
    const owner = clipAtOutputSecond(ranges, outputStart)
    return {
      outputStart,
      outputEnd,
      dropMagnitude: cliff.dropMagnitude,
      ...(owner ? { trackId: owner.trackId, clipId: owner.clipId } : {}),
    }
  })
}
```

- [ ] **Step 4.4: Run test to verify it passes**

Run: `npx jest __tests__/lib/video-editor-retention-overlay.test.ts --silent`
Expected: PASS.

- [ ] **Step 4.5: Commit**

```bash
git add lib/video-editor/retention-overlay.ts __tests__/lib/video-editor-retention-overlay.test.ts
git commit -m "feat(yt-os): output-time retention overlay + cliff-to-clip mapping"
```

---

## Task 5: Retention-overlay project route

**Files:**
- Create: `app/api/v1/video-editor/projects/[id]/retention-overlay/route.ts`
- Test: `__tests__/app/video-editor-retention-overlay-route.test.ts`

- [ ] **Step 5.1: Write the failing test** — create `__tests__/app/video-editor-retention-overlay-route.test.ts`. Mock `@/lib/firebase/admin` + `@/lib/api/auth`. Set up: a `video_editor_projects` doc `p1` (orgId `org1`, `videoProjectId: 'v1'`, a 20s timeline), a `youtube_video_projects` doc `v1` (`youtubeVideoId: 'yt1'`, `status: 'live'`), and a `youtube_retention_curves` doc for `v1`. Assert GET returns `{ mapped, cliffMarkers, totalOutputSeconds }` with cliff markers carrying `clipId`.

```ts
import { GET } from '@/app/api/v1/video-editor/projects/[id]/retention-overlay/route'

describe('project retention-overlay route', () => {
  it('returns mapped curve + cliff markers for a published linked video', async () => {
    const res = await GET(
      new Request('http://t/api/v1/video-editor/projects/p1/retention-overlay?orgId=org1') as never,
      { uid: 'u1', orgId: 'org1', role: 'admin' } as never,
      { params: Promise.resolve({ id: 'p1' }) } as never,
    )
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.data.totalOutputSeconds).toBe(20)
    expect(Array.isArray(json.data.cliffMarkers)).toBe(true)
  })

  it('404s when the project has no published linked video', async () => {
    const res = await GET(
      new Request('http://t/api/v1/video-editor/projects/nolink/retention-overlay?orgId=org1') as never,
      { uid: 'u1', orgId: 'org1', role: 'admin' } as never,
      { params: Promise.resolve({ id: 'nolink' }) } as never,
    )
    expect(res.status).toBe(404)
  })
})
```

- [ ] **Step 5.2: Run test to verify it fails**

Run: `npx jest __tests__/app/video-editor-retention-overlay-route.test.ts --silent`
Expected: FAIL — route not found.

- [ ] **Step 5.3: Implement** `app/api/v1/video-editor/projects/[id]/retention-overlay/route.ts`:

```ts
import { adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { apiError, apiSuccess } from '@/lib/api/response'
import { VIDEO_EDITOR_COLLECTIONS } from '@/lib/video-editor/api'
import { YOUTUBE_COLLECTIONS } from '@/lib/youtube-studio/api'
import { timelineDurationSeconds } from '@/lib/video-editor/credits'
import { cliffMarkersForTimeline, mapCurveToTimeline } from '@/lib/video-editor/retention-overlay'
import type { VideoEditorProject } from '@/lib/video-editor/types'
import type { YouTubeRetentionCurve } from '@/lib/youtube-studio/retention-curve'
import type { YouTubeVideoProject } from '@/lib/youtube-studio/types'

export const dynamic = 'force-dynamic'

export const GET = withAuth('admin', async (_req, user, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params
  const snap = await adminDb.collection(VIDEO_EDITOR_COLLECTIONS.projects).doc(id).get()
  if (!snap.exists) return apiError('Project not found', 404)
  const project = { id: snap.id, ...(snap.data() as VideoEditorProject) }
  if (user.role !== 'ai' && project.orgId !== user.orgId) return apiError('Access denied', 403)
  if (!project.videoProjectId) return apiError('No linked YouTube video', 404)

  const videoSnap = await adminDb.collection(YOUTUBE_COLLECTIONS.videos).doc(project.videoProjectId).get()
  const video = videoSnap.exists ? (videoSnap.data() as YouTubeVideoProject) : undefined
  if (!video || video.orgId !== project.orgId || video.status !== 'live') {
    return apiError('Linked video is not published', 404)
  }

  const curveQuery = await adminDb
    .collection(YOUTUBE_COLLECTIONS.retentionCurves)
    .where('orgId', '==', project.orgId)
    .where('videoProjectId', '==', project.videoProjectId)
    .get()
  const curveDoc = curveQuery.docs
    .map((d) => ({ id: d.id, ...(d.data() as YouTubeRetentionCurve) }))
    .filter((c) => !c.deleted)
    .sort((a, b) => b.periodEnd.localeCompare(a.periodEnd))[0]
  if (!curveDoc) return apiError('No retention curve yet', 404)

  const totalOutputSeconds = timelineDurationSeconds(project.timeline)
  return apiSuccess({
    totalOutputSeconds,
    mapped: mapCurveToTimeline(curveDoc.points, project.timeline, totalOutputSeconds),
    cliffMarkers: cliffMarkersForTimeline(curveDoc.points, project.timeline, totalOutputSeconds),
    annotations: curveDoc.annotations ?? [],
  })
})
```

- [ ] **Step 5.4: Run test to verify it passes**

Run: `npx jest __tests__/app/video-editor-retention-overlay-route.test.ts --silent`
Expected: PASS.

- [ ] **Step 5.5: Commit**

```bash
git add app/api/v1/video-editor/projects/[id]/retention-overlay __tests__/app/video-editor-retention-overlay-route.test.ts
git commit -m "feat(yt-os): retention-overlay project route (curve mapped to editor timeline)"
```

---

## Task 6: Retention-review agent job (annotate cliffs → next-video brief feed)

**Files:**
- Create: `app/api/v1/youtube-studio/channel-report/route.ts` (shared agent-job creator, also used by Task 13)
- Test: `__tests__/app/youtube-channel-report-route.test.ts`

- [ ] **Step 6.1: Write the failing test** — create `__tests__/app/youtube-channel-report-route.test.ts`. Mock admin + auth. Assert POST with `{ orgId, channelWorkspaceId, skillKey: 'youtube-retention-review', videoProjectId }` creates one `youtube_agent_jobs` doc with `status: 'waiting_for_review'`, `reviewRequired: true`, and `skillKey: 'youtube-retention-review'`; and rejects an unknown skill key.

```ts
import { POST } from '@/app/api/v1/youtube-studio/channel-report/route'

describe('channel-report agent job route', () => {
  it('creates a review-gated retention-review job', async () => {
    const res = await POST(
      new Request('http://t/api/v1/youtube-studio/channel-report', {
        method: 'POST',
        body: JSON.stringify({ orgId: 'org1', channelWorkspaceId: 'ch1', videoProjectId: 'v1', skillKey: 'youtube-retention-review' }),
      }) as never,
      { uid: 'u1', orgId: 'org1', role: 'admin' } as never,
    )
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.data.job.status).toBe('waiting_for_review')
    expect(json.data.job.reviewRequired).toBe(true)
  })

  it('rejects an unknown skill key', async () => {
    const res = await POST(
      new Request('http://t/api/v1/youtube-studio/channel-report', {
        method: 'POST',
        body: JSON.stringify({ orgId: 'org1', channelWorkspaceId: 'ch1', skillKey: 'not-a-skill' }),
      }) as never,
      { uid: 'u1', orgId: 'org1', role: 'admin' } as never,
    )
    expect(res.status).toBe(400)
  })
})
```

- [ ] **Step 6.2: Run test to verify it fails**

Run: `npx jest __tests__/app/youtube-channel-report-route.test.ts --silent`
Expected: FAIL — route not found.

- [ ] **Step 6.3: Implement** `app/api/v1/youtube-studio/channel-report/route.ts`. Reuse the exact agent-job creation shape from `app/api/v1/youtube-studio/agent-jobs/route.ts` (read that file first; it already builds `inputPacket` from `getYouTubeSkillContract` and writes `status: 'waiting_for_review'` when `reviewRequired`). Restrict `skillKey` to `youtube-retention-review` and `youtube-next-video-brief`; GET returns the latest completed report artifact for the channel:

```ts
import { NextRequest } from 'next/server'
import { adminDb } from '@/lib/firebase/admin'
import { FieldValue } from 'firebase-admin/firestore'
import { withAuth } from '@/lib/api/auth'
import { apiError, apiSuccess } from '@/lib/api/response'
import {
  actorFields,
  ensureOrgAccess,
  stripUndefinedDeep,
  YOUTUBE_COLLECTIONS,
} from '@/lib/youtube-studio/api'
import { getYouTubeSkillContract } from '@/lib/youtube-studio/skills'
import type { YouTubeAgentJob } from '@/lib/youtube-studio/types'

export const dynamic = 'force-dynamic'
const ALLOWED = ['youtube-retention-review', 'youtube-next-video-brief'] as const

function cleanString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

export const POST = withAuth('admin', async (req: NextRequest, user) => {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const orgId = cleanString(body.orgId) ?? ''
  const channelWorkspaceId = cleanString(body.channelWorkspaceId) ?? ''
  const skillKey = cleanString(body.skillKey) ?? ''
  if (!orgId || !channelWorkspaceId) return apiError('orgId and channelWorkspaceId are required')
  if (!(ALLOWED as readonly string[]).includes(skillKey)) return apiError('Unsupported skillKey', 400)
  const contract = getYouTubeSkillContract(skillKey)
  if (!contract) return apiError('Unknown skill', 400)
  const denied = await ensureOrgAccess(user, orgId)
  if (denied) return denied

  const job: Omit<YouTubeAgentJob, 'id'> = {
    orgId,
    channelWorkspaceId,
    videoProjectId: cleanString(body.videoProjectId),
    skillKey: contract.key,
    title: cleanString(body.title) ?? contract.label,
    status: 'waiting_for_review',
    priority: 'normal',
    outputArtifactIds: [],
    reviewRequired: true,
    visibility: 'internal',
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
        videoProjectId: cleanString(body.videoProjectId),
        sourceAssetIds: [],
        clipCandidateIds: [],
        productionDraftIds: [],
        renderJobIds: [],
        publishingPacketIds: [],
        analyticsSnapshotIds: [],
      },
    },
    linked: {},
    deleted: false,
  }
  const ref = await adminDb.collection(YOUTUBE_COLLECTIONS.agentJobs).add(
    stripUndefinedDeep({ ...job, ...actorFields(user) }),
  )
  return apiSuccess({ job: { id: ref.id, ...job } })
})

export const GET = withAuth('admin', async (req, user) => {
  const url = new URL(req.url)
  const orgId = url.searchParams.get('orgId')?.trim() ?? ''
  const channelWorkspaceId = url.searchParams.get('channelWorkspaceId')?.trim() ?? ''
  const denied = await ensureOrgAccess(user, orgId)
  if (denied) return denied
  const q = await adminDb
    .collection(YOUTUBE_COLLECTIONS.agentJobs)
    .where('orgId', '==', orgId)
    .where('channelWorkspaceId', '==', channelWorkspaceId)
    .where('skillKey', '==', 'youtube-retention-review')
    .get()
  const jobs = q.docs.map((d) => ({ id: d.id, ...(d.data() as YouTubeAgentJob) })).filter((j) => !j.deleted)
  return apiSuccess({ jobs })
})
```

- [ ] **Step 6.4: Run test to verify it passes**

Run: `npx jest __tests__/app/youtube-channel-report-route.test.ts --silent`
Expected: PASS.

- [ ] **Step 6.5: Commit**

```bash
git add app/api/v1/youtube-studio/channel-report __tests__/app/youtube-channel-report-route.test.ts
git commit -m "feat(yt-os): review-gated retention-review / next-video-brief agent job route"
```

---

## Task 7: Transcript-driven editing math (Descript model)

**Files:**
- Create: `lib/video-editor/transcript-sync.ts`
- Test: `__tests__/lib/video-editor-transcript-sync.test.ts`

- [ ] **Step 7.1: Write the failing test** — create `__tests__/lib/video-editor-transcript-sync.test.ts`:

```ts
import {
  fillerWordSpans,
  rippleRemoveRanges,
  wordsToClipRanges,
} from '@/lib/video-editor/transcript-sync'
import type { EditorTimeline } from '@/lib/video-editor/types'
import type { TranscriptWord } from '@/lib/video-editor/types'

const timeline: EditorTimeline = {
  version: 1,
  tracks: [
    { id: 'v', kind: 'video', clips: [{ id: 'c1', timelineStart: 0, duration: 10 }] },
    { id: 'cap', kind: 'caption', clips: [] },
  ],
}

describe('wordsToClipRanges', () => {
  it('maps an absolute word window to a video-clip time range', () => {
    const ranges = wordsToClipRanges([{ text: 'hello', start: 2, end: 4 }], timeline)
    expect(ranges).toEqual([{ trackId: 'v', clipId: 'c1', startSeconds: 2, endSeconds: 4 }])
  })
})

describe('fillerWordSpans', () => {
  it('finds default fillers and org custom words case-insensitively', () => {
    const words: TranscriptWord[] = [
      { text: 'Um', start: 0, end: 0.3 },
      { text: 'okay', start: 0.3, end: 0.8 },
      { text: 'like', start: 0.8, end: 1.1 },
    ]
    const spans = fillerWordSpans(words, { customFillers: ['like'] })
    expect(spans.map((s) => s.text)).toEqual(['Um', 'like'])
  })
})

describe('rippleRemoveRanges', () => {
  it('folds ranges into a shorter timeline via ripple deletes', () => {
    // removing 2s..4s from a single 10s clip splits+ripple-removes → 8s total
    const next = rippleRemoveRanges(timeline, [{ trackId: 'v', clipId: 'c1', startSeconds: 2, endSeconds: 4 }])
    const clips = next.tracks[0].clips
    const total = clips.reduce((sum, c) => sum + c.duration, 0)
    expect(total).toBeCloseTo(8)
  })
})
```

- [ ] **Step 7.2: Run test to verify it fails**

Run: `npx jest __tests__/lib/video-editor-transcript-sync.test.ts --silent`
Expected: FAIL — module not found.

- [ ] **Step 7.3: Implement** — create `lib/video-editor/transcript-sync.ts`. Reuse `splitClip` + `rippleDeleteClip` from `timeline-ops.ts` (Phase 1a). `DEFAULT_FILLERS` = `['um', 'uh', 'erm', 'ah', 'like', 'you know']`:

```ts
import type { EditorTimeline, TranscriptWord } from './types'
import { rippleDeleteClip, splitClip } from './timeline-ops'

export const DEFAULT_FILLERS = ['um', 'uh', 'erm', 'ah', 'you know']

export interface ClipTimeRange {
  trackId: string
  clipId: string
  startSeconds: number
  endSeconds: number
}

export interface FillerSpan {
  text: string
  start: number
  end: number
}

function normalize(word: string): string {
  return word.toLowerCase().replace(/[^a-z']/g, '')
}

/** Map absolute transcript seconds onto the video clip covering that window. */
export function wordsToClipRanges(words: TranscriptWord[], timeline: EditorTimeline): ClipTimeRange[] {
  const videoTrack = (timeline.tracks ?? []).find((t) => t.kind === 'video')
  if (!videoTrack) return []
  return words.flatMap((word) => {
    const clip = videoTrack.clips.find(
      (c) => word.start >= c.timelineStart && word.start < c.timelineStart + c.duration,
    )
    if (!clip) return []
    return [{
      trackId: videoTrack.id,
      clipId: clip.id,
      startSeconds: Math.max(word.start, clip.timelineStart),
      endSeconds: Math.min(word.end, clip.timelineStart + clip.duration),
    }]
  })
}

export function fillerWordSpans(
  words: TranscriptWord[],
  options: { customFillers?: string[] } = {},
): FillerSpan[] {
  const set = new Set([...DEFAULT_FILLERS, ...(options.customFillers ?? [])].map(normalize))
  return words
    .filter((w) => set.has(normalize(w.text)))
    .map((w) => ({ text: w.text, start: w.start, end: w.end }))
}

/**
 * Fold time ranges out of the timeline. Process ranges back-to-front so earlier
 * splits don't invalidate later ranges' clip ids. Each range: split at start,
 * split the remainder at end, ripple-delete the middle segment.
 */
export function rippleRemoveRanges(timeline: EditorTimeline, ranges: ClipTimeRange[]): EditorTimeline {
  const ordered = [...ranges].sort((a, b) => b.startSeconds - a.startSeconds)
  let next = timeline
  for (const range of ordered) {
    const track = next.tracks.find((t) => t.id === range.trackId)
    const clip = track?.clips.find((c) => c.id === range.clipId)
    if (!track || !clip) continue
    const afterStart = splitClip(next, range.trackId, range.clipId, range.startSeconds)
    const startTrack = afterStart.tracks.find((t) => t.id === range.trackId)!
    // the clip created after the start-split is the one starting at range.startSeconds
    const middle = startTrack.clips.find((c) => Math.abs(c.timelineStart - range.startSeconds) < 1e-6)
    if (!middle) { next = afterStart; continue }
    const afterEnd = splitClip(afterStart, range.trackId, middle.id, range.endSeconds)
    next = rippleDeleteClip(afterEnd, range.trackId, middle.id)
  }
  return next
}
```

> Note: confirm the exact `splitClip`/`rippleDeleteClip` signatures in `lib/video-editor/timeline-ops.ts` before writing — Phase 1a defines `rippleDeleteClip(timeline, trackId, clipId)` and `splitClip(timeline, trackId, clipId, atSeconds)`. If `splitClip` takes absolute timeline seconds, the code above is correct; if it takes clip-relative seconds, subtract `clip.timelineStart` first.

- [ ] **Step 7.4: Run test to verify it passes**

Run: `npx jest __tests__/lib/video-editor-transcript-sync.test.ts --silent`
Expected: PASS.

- [ ] **Step 7.5: Commit**

```bash
git add lib/video-editor/transcript-sync.ts __tests__/lib/video-editor-transcript-sync.test.ts
git commit -m "feat(yt-os): transcript-driven ripple editing math (Descript model)"
```

---

## Task 8: Transcript-edit + auto-edit routes

**Files:**
- Create: `app/api/v1/video-editor/projects/[id]/transcript-edit/route.ts`
- Create: `app/api/v1/video-editor/projects/[id]/auto-edit/route.ts`
- Test: `__tests__/app/video-editor-transcript-edit-route.test.ts`

- [ ] **Step 8.1: Write the failing test** — create `__tests__/app/video-editor-transcript-edit-route.test.ts`. Mock admin + auth. Seed a `video_editor_projects` doc `p1` (org `org1`, 10s single-clip timeline) and a `video_editor_transcripts` doc for it with words. Assert: POST `{ mode: 'ranges', ranges: [{trackId,clipId,startSeconds:2,endSeconds:4}] }` writes a shorter timeline back and returns `{ project }`; POST `{ mode: 'filler_all' }` removes filler spans using the transcript.

```ts
import { POST } from '@/app/api/v1/video-editor/projects/[id]/transcript-edit/route'

describe('transcript-edit route', () => {
  it('ripple-removes explicit ranges', async () => {
    const res = await POST(
      new Request('http://t/x', { method: 'POST', body: JSON.stringify({ orgId: 'org1', mode: 'ranges', ranges: [{ trackId: 'v', clipId: 'c1', startSeconds: 2, endSeconds: 4 }] }) }) as never,
      { uid: 'u1', orgId: 'org1', role: 'admin' } as never,
      { params: Promise.resolve({ id: 'p1' }) } as never,
    )
    expect(res.status).toBe(200)
  })
})
```

- [ ] **Step 8.2: Run test to verify it fails**

Run: `npx jest __tests__/app/video-editor-transcript-edit-route.test.ts --silent`
Expected: FAIL — route not found.

- [ ] **Step 8.3: Implement** `app/api/v1/video-editor/projects/[id]/transcript-edit/route.ts`. Load the project (org-check), load the latest completed `video_editor_transcripts` doc for the project when `mode: 'filler_all'`, compute ranges (`fillerWordSpans` → `TranscriptWord[]` → `wordsToClipRanges`), else use body `ranges`; apply `rippleRemoveRanges`; write the new `timeline` back with `updatedBy`/`updatedByType`/`updatedAt`; return `{ project }`:

```ts
import { NextRequest } from 'next/server'
import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { apiError, apiSuccess } from '@/lib/api/response'
import { VIDEO_EDITOR_COLLECTIONS } from '@/lib/video-editor/api'
import { fillerWordSpans, rippleRemoveRanges, wordsToClipRanges, type ClipTimeRange } from '@/lib/video-editor/transcript-sync'
import type { VideoEditorProject, VideoEditorTranscript } from '@/lib/video-editor/types'

export const dynamic = 'force-dynamic'

export const POST = withAuth('admin', async (req: NextRequest, user, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params
  const ref = adminDb.collection(VIDEO_EDITOR_COLLECTIONS.projects).doc(id)
  const snap = await ref.get()
  if (!snap.exists) return apiError('Project not found', 404)
  const project = { id: snap.id, ...(snap.data() as VideoEditorProject) }
  if (user.role !== 'ai' && project.orgId !== user.orgId) return apiError('Access denied', 403)

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const mode = body.mode === 'filler_all' ? 'filler_all' : 'ranges'
  let ranges: ClipTimeRange[] = []
  if (mode === 'ranges') {
    ranges = Array.isArray(body.ranges) ? (body.ranges as ClipTimeRange[]) : []
  } else {
    const tq = await adminDb
      .collection('video_editor_transcripts')
      .where('orgId', '==', project.orgId)
      .where('projectId', '==', id)
      .where('status', '==', 'completed')
      .get()
    const transcript = tq.docs.map((d) => d.data() as VideoEditorTranscript)[0]
    if (!transcript) return apiError('No completed transcript for this project', 404)
    const words = transcript.segments.flatMap((s) => s.words)
    const customFillers = Array.isArray(body.customFillers) ? (body.customFillers as string[]) : []
    ranges = wordsToClipRanges(fillerWordSpans(words, { customFillers }).map((s) => ({ text: s.text, start: s.start, end: s.end })), project.timeline)
  }
  if (ranges.length === 0) return apiError('No ranges to remove')
  const timeline = rippleRemoveRanges(project.timeline, ranges)
  await ref.set({ timeline, updatedBy: user.uid, updatedByType: user.role === 'ai' ? 'agent' : 'user', updatedAt: FieldValue.serverTimestamp() }, { merge: true })
  return apiSuccess({ project: { ...project, timeline } })
})
```

- [ ] **Step 8.4: Implement** `app/api/v1/video-editor/projects/[id]/auto-edit/route.ts`. This is **review-gated**: it does NOT auto-produce a timeline. It creates a `youtube_agent_jobs` doc with `skillKey: 'youtube-clip-finder'`, `status: 'waiting_for_review'`, `reviewRequired: true`, referencing the source asset (`sourceAssetIds`) and a target of "assemble a draft editor project (silence removal, jump cuts, chapter markers)". Mirror the agent-job creation shape from Task 6. The actual assembly is performed by the reviewer/agent runner that later creates a new `video_editor_projects` draft — this route only queues the review-gated job. Return `{ job }`.

- [ ] **Step 8.5: Run the test to verify it passes**

Run: `npx jest __tests__/app/video-editor-transcript-edit-route.test.ts --silent`
Expected: PASS.

- [ ] **Step 8.6: Commit**

```bash
git add app/api/v1/video-editor/projects/[id]/transcript-edit app/api/v1/video-editor/projects/[id]/auto-edit __tests__/app/video-editor-transcript-edit-route.test.ts
git commit -m "feat(yt-os): transcript-edit ripple route + review-gated auto-edit job"
```

---

## Task 9: Multi-format render batch domain

**Files:**
- Create: `lib/video-editor/render-batch.ts`
- Modify: `lib/video-editor/credits.ts`
- Test: `__tests__/lib/video-editor-render-batch.test.ts`

- [ ] **Step 9.1: Write the failing test** — create `__tests__/lib/video-editor-render-batch.test.ts`:

```ts
import {
  RENDER_BATCH_FORMATS,
  batchCreditLineItems,
  planRenderBatch,
} from '@/lib/video-editor/render-batch'
import { estimateRenderBatchCredits } from '@/lib/video-editor/credits'
import type { EditorTimeline, VideoEditorProjectSettings } from '@/lib/video-editor/types'

const timeline: EditorTimeline = {
  version: 1,
  tracks: [{ id: 'v', kind: 'video', clips: [{ id: 'c', timelineStart: 0, duration: 90 }] }],
}
const settings: VideoEditorProjectSettings = { width: 1920, height: 1080, fps: 30, aspect: '16:9', background: '#000' }

describe('planRenderBatch', () => {
  it('produces one job spec per format with per-format settings + caption override', () => {
    const specs = planRenderBatch({
      timeline,
      settings,
      formats: ['16:9', '9:16', '1:1'],
      captionOverrides: { '9:16': { fontScale: 1.4 } },
    })
    expect(specs.map((s) => s.format)).toEqual(['16:9', '9:16', '1:1'])
    expect(specs[1].settings.aspect).toBe('9:16')
    expect(specs[1].settings.width).toBe(1080)
    expect(specs[1].settings.height).toBe(1920)
    expect(specs[1].captionOverride).toEqual({ fontScale: 1.4 })
    expect(specs[0].settings.width).toBe(1920)
  })
})

describe('batchCreditLineItems + estimateRenderBatchCredits', () => {
  it('charges one total with a per-format breakdown', () => {
    const specs = planRenderBatch({ timeline, settings, formats: ['16:9', '9:16'] })
    const items = batchCreditLineItems(specs)
    expect(items.lineItems).toHaveLength(2)
    expect(items.totalCredits).toBe(items.lineItems.reduce((s, i) => s + i.credits, 0))
    expect(estimateRenderBatchCredits(specs).totalCredits).toBe(items.totalCredits)
  })
})
```

- [ ] **Step 9.2: Run test to verify it fails**

Run: `npx jest __tests__/lib/video-editor-render-batch.test.ts --silent`
Expected: FAIL — module not found.

- [ ] **Step 9.3: Implement** — create `lib/video-editor/render-batch.ts`:

```ts
import type { ActorType, EditorTimeline, VideoEditorAspect, VideoEditorProjectSettings } from './types'
import { estimateEditorRenderCredits } from './credits'

export type RenderBatchFormat = VideoEditorAspect
export const RENDER_BATCH_FORMATS: RenderBatchFormat[] = ['16:9', '9:16', '1:1']

export interface CaptionLayoutOverride {
  fontScale?: number
  marginVerticalPct?: number
  align?: 'top' | 'center' | 'bottom'
}

export interface RenderBatchFormatSpec {
  format: RenderBatchFormat
  settings: VideoEditorProjectSettings
  captionOverride?: CaptionLayoutOverride
}

const DIMENSIONS: Record<RenderBatchFormat, { width: number; height: number }> = {
  '16:9': { width: 1920, height: 1080 },
  '9:16': { width: 1080, height: 1920 },
  '1:1': { width: 1080, height: 1080 },
}

export function planRenderBatch(input: {
  timeline: EditorTimeline
  settings: VideoEditorProjectSettings
  formats: RenderBatchFormat[]
  captionOverrides?: Partial<Record<RenderBatchFormat, CaptionLayoutOverride>>
}): RenderBatchFormatSpec[] {
  const seen = new Set<RenderBatchFormat>()
  return input.formats
    .filter((f) => RENDER_BATCH_FORMATS.includes(f) && !seen.has(f) && (seen.add(f), true))
    .map((format) => {
      const dims = DIMENSIONS[format]
      const spec: RenderBatchFormatSpec = {
        format,
        settings: { ...input.settings, aspect: format, width: dims.width, height: dims.height },
      }
      const override = input.captionOverrides?.[format]
      if (override) spec.captionOverride = override
      return spec
    })
}

export interface BatchCreditLineItem {
  format: RenderBatchFormat
  billedMinutes: number
  credits: number
}

export function batchCreditLineItems(specs: RenderBatchFormatSpec[]): {
  lineItems: BatchCreditLineItem[]
  totalCredits: number
} {
  const lineItems = specs.map((spec) => {
    const est = estimateEditorRenderCredits(spec.settings.width && spec.settings.height ? { version: 1, tracks: [] } as EditorTimeline : { version: 1, tracks: [] }, spec.settings)
    return { format: spec.format, billedMinutes: est.billedMinutes, credits: est.credits }
  })
  return { lineItems, totalCredits: lineItems.reduce((s, i) => s + i.credits, 0) }
}

export type RenderBatchStatus = 'planning' | 'dispatched' | 'partial' | 'completed' | 'failed'

export interface VideoEditorRenderBatch {
  id?: string
  orgId: string
  projectId: string
  status: RenderBatchStatus
  formats: RenderBatchFormat[]
  childJobIds: string[]
  credits: { estimated: number; charged: number; refunded: number; lineItems: BatchCreditLineItem[] }
  deleted: boolean
  createdBy?: string
  createdByType?: ActorType
  updatedBy?: string
  updatedByType?: ActorType
  createdAt?: unknown
  updatedAt?: unknown
}
```

> **Fix before running:** `batchCreditLineItems` above passes an empty timeline — that mis-estimates. Instead thread the real timeline through: change `batchCreditLineItems(specs, timeline)` and estimate with `estimateEditorRenderCredits(timeline, spec.settings)`. The test in Step 9.1 must be updated to pass the timeline; do this correction as you implement so the numbers reflect the 90s timeline (2 credits/min → 2 minutes billed → 4 credits per non-UHD format).

- [ ] **Step 9.4: Add `estimateRenderBatchCredits` to `lib/video-editor/credits.ts`**:

```ts
import type { RenderBatchFormatSpec } from './render-batch'

export function estimateRenderBatchCredits(specs: RenderBatchFormatSpec[], timeline: EditorTimeline): {
  lineItems: Array<{ format: string; billedMinutes: number; credits: number }>
  totalCredits: number
} {
  const lineItems = specs.map((spec) => {
    const est = estimateEditorRenderCredits(timeline, spec.settings)
    return { format: spec.format, billedMinutes: est.billedMinutes, credits: est.credits }
  })
  return { lineItems, totalCredits: lineItems.reduce((s, i) => s + i.credits, 0) }
}
```

> Reconcile the two helpers: keep `estimateRenderBatchCredits(specs, timeline)` in `credits.ts` as the single source of truth, and have `batchCreditLineItems(specs, timeline)` in `render-batch.ts` delegate to it (avoid a circular import by having `render-batch.ts` import from `credits.ts` only — which it already does). Update the Step 9.1 test calls to `batchCreditLineItems(specs, timeline)` and `estimateRenderBatchCredits(specs, timeline)`.

- [ ] **Step 9.5: Run test to verify it passes**

Run: `npx jest __tests__/lib/video-editor-render-batch.test.ts --silent`
Expected: PASS.

- [ ] **Step 9.6: Commit**

```bash
git add lib/video-editor/render-batch.ts lib/video-editor/credits.ts __tests__/lib/video-editor-render-batch.test.ts
git commit -m "feat(yt-os): multi-format render batch domain + single-charge credit line items"
```

---

## Task 10: Render batch routes (charge once, fan out N jobs, register per format)

**Files:**
- Create: `app/api/v1/video-editor/render-batches/route.ts`
- Create: `app/api/v1/video-editor/render-batches/[id]/route.ts`
- Test: `__tests__/app/video-editor-render-batches-route.test.ts`

- [ ] **Step 10.1: Write the failing test** — create `__tests__/app/video-editor-render-batches-route.test.ts`. Read `__tests__/app/video-editor-render-jobs-route.test.ts` first for the credit-ledger + dispatch mock pattern. Assert: POST `{ orgId, projectId, formats: ['16:9','9:16'] }` charges credits exactly ONCE (spy on the ledger charge helper — called once with `totalCredits`), creates one `video_editor_render_batches` doc, and creates 2 `video_editor_render_jobs` docs (one per format) each dispatched. GET lists batches for the project.

```ts
import { POST } from '@/app/api/v1/video-editor/render-batches/route'

describe('render-batches route', () => {
  it('charges once and fans out one job per format', async () => {
    const res = await POST(
      new Request('http://t/x', { method: 'POST', body: JSON.stringify({ orgId: 'org1', projectId: 'p1', formats: ['16:9', '9:16'] }) }) as never,
      { uid: 'u1', orgId: 'org1', role: 'admin' } as never,
    )
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.data.batch.childJobIds).toHaveLength(2)
  })
})
```

- [ ] **Step 10.2: Run test to verify it fails**

Run: `npx jest __tests__/app/video-editor-render-batches-route.test.ts --silent`
Expected: FAIL — route not found.

- [ ] **Step 10.3: Implement** `app/api/v1/video-editor/render-batches/route.ts`. Steps in the POST handler:
  1. Load project (org-check).
  2. `specs = planRenderBatch({ timeline: project.timeline, settings: project.settings, formats, captionOverrides })`.
  3. `estimate = estimateRenderBatchCredits(specs, project.timeline)`.
  4. Charge credits ONCE via the same creative-canvas ledger helper the render-jobs route uses (read `app/api/v1/video-editor/render-jobs/route.ts` for the exact helper import + call, e.g. `chargeCredits({ orgId, credits: estimate.totalCredits, costLabel: 'video_editor_render_batch', ... })`). Use a new cost label `video_editor_render_batch`.
  5. For each spec: create a `video_editor_render_jobs` doc with `settingsSnapshot: spec.settings`, `timelineSnapshot: project.timeline`, `credits: { estimated: lineItem.credits, charged: 0, refunded: 0 }` (charge is on the batch, not the child — set child `charged: 0` and mark `provenance.costLabel: 'video_editor_render_batch'`), then `buildVideoEditorRenderManifest` + `dispatchVideoEditorRenderJob`.
  6. Create the `video_editor_render_batches` doc with `childJobIds`, `credits: { estimated: total, charged: total, refunded: 0, lineItems }`, `status: 'dispatched'`.
  7. Return `{ batch }`.
  Refund policy: if ANY dispatch throws, refund the whole batch charge once (idempotent) and mark `status: 'failed'` — reuse the render-jobs route's refund helper.

- [ ] **Step 10.4: Implement** `app/api/v1/video-editor/render-batches/[id]/route.ts`. GET returns the batch plus its child jobs' statuses (load each `childJobId`). PUT rolls up completion: recompute `status` from child statuses (`completed` when all `rendered`, `partial` when some, `failed` when all failed) and, for each newly-`rendered` child, call `registerVideoEditorRenderOutputs(childJobId, project, output, spec.settings)` so every format registers its own source asset. Guard against double-registration with an idempotency flag on the child job (`outputsRegistered: true`).

- [ ] **Step 10.5: Run the test to verify it passes**

Run: `npx jest __tests__/app/video-editor-render-batches-route.test.ts --silent`
Expected: PASS.

- [ ] **Step 10.6: Commit**

```bash
git add app/api/v1/video-editor/render-batches __tests__/app/video-editor-render-batches-route.test.ts
git commit -m "feat(yt-os): multi-format render batch routes (single charge, per-format outputs)"
```

---

## Task 11: Frame-accurate review — comments resource type + review-version domain

**Files:**
- Modify: `lib/comments/types.ts:11-38`
- Modify: `app/api/v1/comments/route.ts` (POST anchor validation)
- Create: `lib/video-editor/review-versions.ts`
- Test: `__tests__/lib/video-editor-review-versions.test.ts`, `__tests__/lib/comments-types.test.ts` (extend if present, else create)

- [ ] **Step 11.1: Write the failing test** — create `__tests__/lib/video-editor-review-versions.test.ts`:

```ts
import {
  applyReviewDecision,
  reviewVersionFromRenderJob,
} from '@/lib/video-editor/review-versions'
import { VALID_COMMENT_RESOURCE_TYPES } from '@/lib/comments/types'

describe('review resource type', () => {
  it('registers the render-version comment resource type', () => {
    expect(VALID_COMMENT_RESOURCE_TYPES).toContain('video_editor_render_version')
  })
})

describe('reviewVersionFromRenderJob', () => {
  it('builds a v1 review version pending internal + client', () => {
    const version = reviewVersionFromRenderJob({
      orgId: 'org1',
      projectId: 'p1',
      renderJobId: 'j1',
      previewUrl: 'https://x/p.mp4',
      versionNumber: 1,
    })
    expect(version.versionNumber).toBe(1)
    expect(version.approvalState.internalStatus).toBe('not_requested')
    expect(version.approvalState.clientStatus).toBe('not_requested')
  })
})

describe('applyReviewDecision', () => {
  it('records a client approval', () => {
    const v = reviewVersionFromRenderJob({ orgId: 'org1', projectId: 'p1', renderJobId: 'j1', previewUrl: 'u', versionNumber: 1 })
    const next = applyReviewDecision(v, { party: 'client', status: 'approved', actorId: 'c1', actorName: 'Client', notes: 'ship it' })
    expect(next.approvalState.clientStatus).toBe('approved')
    expect(next.approvalState.clientApproval?.decidedBy).toBe('c1')
  })
})
```

- [ ] **Step 11.2: Run test to verify it fails**

Run: `npx jest __tests__/lib/video-editor-review-versions.test.ts --silent`
Expected: FAIL — `video_editor_render_version` not in the list; module not found.

- [ ] **Step 11.3: Implement comment type** — in `lib/comments/types.ts` add `'video_editor_render_version'` to BOTH the `CommentResourceType` union and the `VALID_COMMENT_RESOURCE_TYPES` array.

- [ ] **Step 11.4: Implement anchor validation** — in `app/api/v1/comments/route.ts` POST, when `resourceType === 'video_editor_render_version'`, accept `body.anchor` only when it is `{ timecodeSeconds: number }` (finite, >= 0); otherwise drop it. Read the existing POST body handling first so the anchor is stored via the same `stripUndefinedDeep`/write path.

- [ ] **Step 11.5: Implement** `lib/video-editor/review-versions.ts` (reuses the packet approval shape):

```ts
import type { ActorType } from './types'
import type { YouTubePacketApprovalState, YouTubePacketApprovalStatus } from '@/lib/youtube-studio/types'

export interface VideoEditorReviewVersion {
  id?: string
  orgId: string
  projectId: string
  renderJobId: string
  renderBatchId?: string
  versionNumber: number
  previewUrl: string
  approvalState: YouTubePacketApprovalState
  visibility?: { showInClientPortal?: boolean }
  deleted: boolean
  createdBy?: string
  createdByType?: ActorType
  updatedBy?: string
  updatedByType?: ActorType
  createdAt?: unknown
  updatedAt?: unknown
}

export function reviewVersionFromRenderJob(input: {
  orgId: string
  projectId: string
  renderJobId: string
  renderBatchId?: string
  previewUrl: string
  versionNumber: number
}): Omit<VideoEditorReviewVersion, 'id' | 'createdAt' | 'updatedAt'> {
  return {
    orgId: input.orgId,
    projectId: input.projectId,
    renderJobId: input.renderJobId,
    ...(input.renderBatchId ? { renderBatchId: input.renderBatchId } : {}),
    versionNumber: input.versionNumber,
    previewUrl: input.previewUrl,
    approvalState: {
      internalStatus: 'not_requested',
      clientStatus: 'not_requested',
      changeRequestStatus: 'none',
    },
    visibility: { showInClientPortal: true },
    deleted: false,
  }
}

export function applyReviewDecision(
  version: Omit<VideoEditorReviewVersion, 'id' | 'createdAt' | 'updatedAt'>,
  decision: { party: 'internal' | 'client'; status: YouTubePacketApprovalStatus; actorId: string; actorName?: string; notes?: string },
): Omit<VideoEditorReviewVersion, 'id' | 'createdAt' | 'updatedAt'> {
  const record = {
    status: decision.status,
    decidedBy: decision.actorId,
    decidedByName: decision.actorName,
    notes: decision.notes,
  }
  if (decision.party === 'client') {
    return {
      ...version,
      approvalState: { ...version.approvalState, clientStatus: decision.status, clientApproval: record },
    }
  }
  return {
    ...version,
    approvalState: { ...version.approvalState, internalStatus: decision.status, internalApproval: record },
  }
}
```

- [ ] **Step 11.6: Run test to verify it passes**

Run: `npx jest __tests__/lib/video-editor-review-versions.test.ts --silent`
Expected: PASS.

- [ ] **Step 11.7: Commit**

```bash
git add lib/comments/types.ts app/api/v1/comments/route.ts lib/video-editor/review-versions.ts __tests__/lib/video-editor-review-versions.test.ts
git commit -m "feat(yt-os): timecode comment resource type + review-version approval domain"
```

---

## Task 12: Review-version routes (admin + portal)

**Files:**
- Create: `app/api/v1/video-editor/review-versions/route.ts`
- Create: `app/api/v1/video-editor/review-versions/[id]/route.ts`
- Create: `app/api/v1/portal/video-editor/review-versions/[id]/route.ts`
- Test: `__tests__/app/video-editor-review-versions-route.test.ts`

- [ ] **Step 12.1: Write the failing test** — create `__tests__/app/video-editor-review-versions-route.test.ts`. Assert: admin POST creates a `video_editor_review_versions` doc from a render job; admin PUT `{ party: 'internal', status: 'approved' }` records the internal approval; portal PUT `{ status: 'approved' }` (client) records the client approval and is org-scoped via the portal auth wrapper. Read `__tests__/app/*portal*review*` or a nearby portal route test for the portal-auth mock.

```ts
import { POST } from '@/app/api/v1/video-editor/review-versions/route'

describe('review-versions admin route', () => {
  it('creates a review version from a render job', async () => {
    const res = await POST(
      new Request('http://t/x', { method: 'POST', body: JSON.stringify({ orgId: 'org1', projectId: 'p1', renderJobId: 'j1' }) }) as never,
      { uid: 'u1', orgId: 'org1', role: 'admin' } as never,
    )
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.data.version.versionNumber).toBeGreaterThanOrEqual(1)
  })
})
```

- [ ] **Step 12.2: Run test to verify it fails**

Run: `npx jest __tests__/app/video-editor-review-versions-route.test.ts --silent`
Expected: FAIL — route not found.

- [ ] **Step 12.3: Implement** `app/api/v1/video-editor/review-versions/route.ts`. GET: list versions for a `projectId` (org-check). POST: load the render job (org-check), compute the next `versionNumber` (count existing versions for the project + 1), build via `reviewVersionFromRenderJob({ previewUrl: job.output?.url ?? '', ... })`, write to `VIDEO_EDITOR_COLLECTIONS.reviewVersions` with `actorFields`-style stamping (reuse the video-editor stamping convention), return `{ version }`.

- [ ] **Step 12.4: Implement** `app/api/v1/video-editor/review-versions/[id]/route.ts`. GET one (org-check) + its timecode comments (query `comments` where `resourceType == 'video_editor_render_version'` and `resourceId == id`). PUT: `applyReviewDecision(version, { party, status, actorId: user.uid, ... })`, persist, return `{ version }`.

- [ ] **Step 12.5: Implement** `app/api/v1/portal/video-editor/review-versions/[id]/route.ts` using the portal auth wrapper (find it via `grep -rl "withPortalAuth\|portalAuth" app/api/v1/portal | head`). GET returns the version + comments only when `visibility.showInClientPortal`; PUT applies a **client** decision (`party: 'client'`) with the portal user as actor. Client cannot set internal status.

- [ ] **Step 12.6: Run test to verify it passes**

Run: `npx jest __tests__/app/video-editor-review-versions-route.test.ts --silent`
Expected: PASS.

- [ ] **Step 12.7: Commit**

```bash
git add app/api/v1/video-editor/review-versions app/api/v1/portal/video-editor/review-versions __tests__/app/video-editor-review-versions-route.test.ts
git commit -m "feat(yt-os): review-version admin + portal routes (per-version approval)"
```

---

## Task 13: YouTube API quota ledger domain (Phase 5 reuses this — define cleanly)

**Files:**
- Create: `lib/youtube-studio/quota-ledger.ts`
- Test: `__tests__/lib/youtube-quota-ledger.test.ts` (extend Task 1's file)

- [ ] **Step 13.1: Write the failing test** — append to `__tests__/lib/youtube-quota-ledger.test.ts`:

```ts
import {
  YOUTUBE_QUOTA_COSTS,
  applyQuotaUsage,
  forecastRemainingUploads,
  quotaLedgerDocId,
} from '@/lib/youtube-studio/quota-ledger'

describe('quota ledger domain', () => {
  it('pins per-op costs used across the platform', () => {
    expect(YOUTUBE_QUOTA_COSTS).toEqual({
      upload: 1600,
      thumbnail_set: 50,
      captions_insert: 400,
      comment_write: 50,
      playlist_items_list: 1,
      analytics_query: 0,
    })
  })

  it('builds a deterministic per-org-per-day doc id', () => {
    expect(quotaLedgerDocId('org1', '2026-07-06')).toBe('org1_2026-07-06')
  })

  it('accumulates usage and totals units', () => {
    const entry = applyQuotaUsage(
      { orgId: 'org1', day: '2026-07-06', dailyLimit: 10000, usedUnits: 0, ops: {}, deleted: false },
      { op: 'upload', count: 2 },
    )
    expect(entry.usedUnits).toBe(3200)
    expect(entry.ops.upload).toBe(2)
    const entry2 = applyQuotaUsage(entry, { op: 'thumbnail_set', count: 1 })
    expect(entry2.usedUnits).toBe(3250)
  })

  it('forecasts how many more uploads fit in the daily budget', () => {
    const entry = { orgId: 'org1', day: '2026-07-06', dailyLimit: 10000, usedUnits: 3200, ops: { upload: 2 }, deleted: false }
    expect(forecastRemainingUploads(entry)).toBe(4) // (10000-3200)/1600 = 4.25 → 4
  })
})
```

- [ ] **Step 13.2: Run test to verify it fails**

Run: `npx jest __tests__/lib/youtube-quota-ledger.test.ts --silent`
Expected: FAIL — module not found.

- [ ] **Step 13.3: Implement** — create `lib/youtube-studio/quota-ledger.ts`:

```ts
import type { ActorType } from './types'

export type QuotaOp =
  | 'upload'
  | 'thumbnail_set'
  | 'captions_insert'
  | 'comment_write'
  | 'playlist_items_list'
  | 'analytics_query'

/** YouTube Data API v3 quota costs (units). analytics_query uses the Analytics API (separate budget) — tracked as 0 here. */
export const YOUTUBE_QUOTA_COSTS: Record<QuotaOp, number> = {
  upload: 1600,
  thumbnail_set: 50,
  captions_insert: 400,
  comment_write: 50,
  playlist_items_list: 1,
  analytics_query: 0,
}

export const YOUTUBE_DEFAULT_DAILY_QUOTA = 10000

export interface YouTubeApiQuotaLedgerEntry {
  id?: string
  orgId: string
  /** UTC calendar day, YYYY-MM-DD — YouTube quota resets at midnight Pacific; document the offset in the UI. */
  day: string
  dailyLimit: number
  usedUnits: number
  ops: Partial<Record<QuotaOp, number>>
  channelWorkspaceId?: string
  deleted: boolean
  createdAt?: unknown
  updatedAt?: unknown
  updatedBy?: string
  updatedByType?: ActorType
}

export function quotaLedgerDocId(orgId: string, day: string): string {
  return `${orgId}_${day}`
}

export function applyQuotaUsage(
  entry: YouTubeApiQuotaLedgerEntry,
  usage: { op: QuotaOp; count?: number },
): YouTubeApiQuotaLedgerEntry {
  const count = Math.max(1, Math.floor(usage.count ?? 1))
  const cost = YOUTUBE_QUOTA_COSTS[usage.op] * count
  return {
    ...entry,
    usedUnits: entry.usedUnits + cost,
    ops: { ...entry.ops, [usage.op]: (entry.ops[usage.op] ?? 0) + count },
  }
}

export function forecastRemainingUploads(entry: YouTubeApiQuotaLedgerEntry): number {
  const remaining = Math.max(0, entry.dailyLimit - entry.usedUnits)
  return Math.floor(remaining / YOUTUBE_QUOTA_COSTS.upload)
}
```

- [ ] **Step 13.4: Run test to verify it passes**

Run: `npx jest __tests__/lib/youtube-quota-ledger.test.ts --silent`
Expected: PASS.

- [ ] **Step 13.5: Commit**

```bash
git add lib/youtube-studio/quota-ledger.ts __tests__/lib/youtube-quota-ledger.test.ts
git commit -m "feat(yt-os): youtube_api_quota_ledger domain (shared with phase 5)"
```

---

## Task 14: Quota ledger route + wire the publish executor to record uploads

**Files:**
- Create: `app/api/v1/youtube-studio/quota-ledger/route.ts`
- Modify: `lib/youtube-studio/publish-executor.ts`
- Test: `__tests__/app/youtube-quota-ledger-route.test.ts`

- [ ] **Step 14.1: Write the failing test** — create `__tests__/app/youtube-quota-ledger-route.test.ts`. Assert: POST `{ orgId, op: 'upload', count: 1 }` upserts `youtube_api_quota_ledger/org1_<today>` and returns `{ entry, forecast }` with `forecast.remainingUploads`; GET `?orgId=org1` returns today's entry + forecast.

```ts
import { POST } from '@/app/api/v1/youtube-studio/quota-ledger/route'

describe('quota-ledger route', () => {
  it('records an upload op and returns a forecast', async () => {
    const res = await POST(
      new Request('http://t/x', { method: 'POST', body: JSON.stringify({ orgId: 'org1', op: 'upload', count: 1 }) }) as never,
      { uid: 'u1', orgId: 'org1', role: 'admin' } as never,
    )
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.data.entry.usedUnits).toBeGreaterThanOrEqual(1600)
    expect(json.data.forecast.remainingUploads).toBeGreaterThanOrEqual(0)
  })
})
```

- [ ] **Step 14.2: Run test to verify it fails**

Run: `npx jest __tests__/app/youtube-quota-ledger-route.test.ts --silent`
Expected: FAIL — route not found.

- [ ] **Step 14.3: Implement** `app/api/v1/youtube-studio/quota-ledger/route.ts`. Use a Firestore transaction on `youtube_api_quota_ledger/{quotaLedgerDocId(orgId, day)}`: read (or seed `{ dailyLimit: YOUTUBE_DEFAULT_DAILY_QUOTA, usedUnits: 0, ops: {} }`), `applyQuotaUsage`, write with `updatedBy`/`updatedByType`/`updatedAt`. GET reads today's doc (or a `day` param) and returns `{ entry, forecast: { remainingUploads: forecastRemainingUploads(entry) } }`. `day` derived UTC via `new Date().toISOString().slice(0,10)`.

- [ ] **Step 14.4: Wire the publish executor** — in `lib/youtube-studio/publish-executor.ts`, inside `publishLoadedReleasePlan` after the successful `batch.commit()` (the `upload_succeeded` path), record the quota op. Add a helper that upserts the ledger doc using `applyQuotaUsage(..., { op: 'upload', count: 1 })` in its own transaction (do NOT add it to the publish batch — a ledger write failure must not fail a successful publish; wrap in `.catch(() => {})`). Import `quotaLedgerDocId`, `applyQuotaUsage`, `YOUTUBE_DEFAULT_DAILY_QUOTA` from `./quota-ledger` and `YOUTUBE_COLLECTIONS` is already imported.

- [ ] **Step 14.5: Write a failing test for the executor wiring** — append to the existing `__tests__/lib/youtube-publish-executor.test.ts` (read it first): after a mocked successful publish, assert a write to `youtube_api_quota_ledger/<orgId>_<day>` occurred with an `upload` op. If the mock harness makes this awkward, extract the ledger upsert into an exported `recordUploadQuota(orgId, day)` helper in `publish-executor.ts` and unit-test that directly.

- [ ] **Step 14.6: Run tests to verify they pass**

Run: `npx jest __tests__/app/youtube-quota-ledger-route.test.ts __tests__/lib/youtube-publish-executor.test.ts --silent`
Expected: PASS.

- [ ] **Step 14.7: Commit**

```bash
git add app/api/v1/youtube-studio/quota-ledger lib/youtube-studio/publish-executor.ts __tests__/app/youtube-quota-ledger-route.test.ts __tests__/lib/youtube-publish-executor.test.ts
git commit -m "feat(yt-os): quota-ledger route + publish executor records upload quota"
```

---

## Task 15: Weekly channel report builder + agent job

**Files:**
- Create: `lib/youtube-studio/channel-report.ts`
- Test: `__tests__/lib/youtube-channel-report.test.ts`

- [ ] **Step 15.1: Write the failing test** — create `__tests__/lib/youtube-channel-report.test.ts`:

```ts
import { buildWeeklyChannelReport } from '@/lib/youtube-studio/channel-report'
import type { YouTubeAnalyticsSnapshot } from '@/lib/youtube-studio/types'

const snapshot: YouTubeAnalyticsSnapshot = {
  orgId: 'org1',
  channelWorkspaceId: 'ch1',
  periodStart: '2026-06-23',
  periodEnd: '2026-06-30',
  source: 'youtube_analytics_api',
  sourceFreshness: 'delayed',
  metrics: { views: 1000, watchTimeMinutes: 500, impressionsCtr: 2.5, subscribersGained: 40, subscribersLost: 5 },
  recommendations: [{ type: 'thumbnail_test', summary: 'Low CTR', confidence: 'high', status: 'suggested' }],
  deleted: false,
}

describe('buildWeeklyChannelReport', () => {
  it('summarises headline metrics, net subs, freshness, and top recommendations', () => {
    const report = buildWeeklyChannelReport({ periodStart: '2026-06-23', periodEnd: '2026-06-30', snapshots: [snapshot] })
    expect(report.headline).toContain('1000 views')
    expect(report.netSubscribers).toBe(35)
    expect(report.freshness).toBe('delayed')
    expect(report.recommendations[0].summary).toBe('Low CTR')
    expect(report.sections.length).toBeGreaterThan(0)
  })

  it('handles an empty week without throwing', () => {
    const report = buildWeeklyChannelReport({ periodStart: '2026-06-23', periodEnd: '2026-06-30', snapshots: [] })
    expect(report.netSubscribers).toBe(0)
    expect(report.headline).toContain('No analytics')
  })
})
```

- [ ] **Step 15.2: Run test to verify it fails**

Run: `npx jest __tests__/lib/youtube-channel-report.test.ts --silent`
Expected: FAIL — module not found.

- [ ] **Step 15.3: Implement** — create `lib/youtube-studio/channel-report.ts`:

```ts
import type { YouTubeAnalyticsRecommendation, YouTubeAnalyticsSnapshot } from './types'

export interface WeeklyChannelReport {
  periodStart: string
  periodEnd: string
  headline: string
  netSubscribers: number
  freshness: string
  sections: Array<{ title: string; body: string }>
  recommendations: YouTubeAnalyticsRecommendation[]
}

function sumMetric(snapshots: YouTubeAnalyticsSnapshot[], key: 'views' | 'watchTimeMinutes' | 'subscribersGained' | 'subscribersLost'): number {
  return snapshots.reduce((total, snap) => total + (snap.metrics[key] ?? 0), 0)
}

export function buildWeeklyChannelReport(input: {
  periodStart: string
  periodEnd: string
  snapshots: YouTubeAnalyticsSnapshot[]
}): WeeklyChannelReport {
  const { snapshots, periodStart, periodEnd } = input
  const views = sumMetric(snapshots, 'views')
  const watch = sumMetric(snapshots, 'watchTimeMinutes')
  const netSubscribers = sumMetric(snapshots, 'subscribersGained') - sumMetric(snapshots, 'subscribersLost')
  const freshness = snapshots[0]?.sourceFreshness ?? 'estimated'
  const recommendations = snapshots
    .flatMap((snap) => snap.recommendations ?? [])
    .filter((rec) => rec.confidence === 'high' || rec.confidence === 'medium')
    .slice(0, 5)

  const headline = snapshots.length
    ? `${views} views, ${watch} watch minutes, ${netSubscribers >= 0 ? '+' : ''}${netSubscribers} subscribers this week.`
    : `No analytics landed for ${periodStart} to ${periodEnd} yet.`

  const sections: WeeklyChannelReport['sections'] = []
  if (snapshots.length) {
    sections.push({ title: 'Reach', body: `${views} views and ${watch} watch minutes across ${snapshots.length} tracked period(s).` })
    sections.push({ title: 'Audience', body: `Net subscriber change: ${netSubscribers}. Data freshness: ${freshness}.` })
    if (recommendations.length) {
      sections.push({ title: 'Do next', body: recommendations.map((r) => `- ${r.summary}`).join('\n') })
    }
  }

  return { periodStart, periodEnd, headline, netSubscribers, freshness, sections, recommendations }
}
```

- [ ] **Step 15.4: Run test to verify it passes**

Run: `npx jest __tests__/lib/youtube-channel-report.test.ts --silent`
Expected: PASS.

- [ ] **Step 15.5: Note on delivery** — the weekly report is delivered by a review-gated agent job created via the Task 6 `channel-report` route (`skillKey: 'youtube-retention-review'` at channel scope) whose reviewed output artifact carries the `buildWeeklyChannelReport` payload; the portal + dynamic chat surface read the completed artifact. No new delivery route is needed in Phase 4 — the artifact + portal visibility already exist.

- [ ] **Step 15.6: Commit**

```bash
git add lib/youtube-studio/channel-report.ts __tests__/lib/youtube-channel-report.test.ts
git commit -m "feat(yt-os): weekly channel report builder"
```

---

## Task 16: Repurposing automation route (long-form → Shorts batch → social drafts)

**Files:**
- Create: `app/api/v1/youtube-studio/videos/[id]/repurpose-clips/route.ts`
- Test: `__tests__/app/youtube-repurpose-clips-route.test.ts`

- [ ] **Step 16.1: Write the failing test** — create `__tests__/app/youtube-repurpose-clips-route.test.ts`. Seed a LIVE `youtube_video_projects` doc `v1` (org `org1`, `youtubeVideoId: 'yt1'`). Assert: POST creates a review-gated `youtube_agent_jobs` doc with `skillKey: 'youtube-clip-finder'`, `status: 'waiting_for_review'`, `visibility: 'internal'`, referencing the video; and returns `{ job }`. A non-live video is rejected (409/400).

```ts
import { POST } from '@/app/api/v1/youtube-studio/videos/[id]/repurpose-clips/route'

describe('repurpose-clips route', () => {
  it('queues a review-gated auto-clip job for a live video', async () => {
    const res = await POST(
      new Request('http://t/x', { method: 'POST', body: JSON.stringify({ platforms: ['tiktok', 'instagram'], formats: ['9:16'] }) }) as never,
      { uid: 'u1', orgId: 'org1', role: 'admin' } as never,
      { params: Promise.resolve({ id: 'v1' }) } as never,
    )
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.data.job.skillKey).toBe('youtube-clip-finder')
    expect(json.data.job.status).toBe('waiting_for_review')
  })
})
```

- [ ] **Step 16.2: Run test to verify it fails**

Run: `npx jest __tests__/app/youtube-repurpose-clips-route.test.ts --silent`
Expected: FAIL — route not found.

- [ ] **Step 16.3: Implement** `app/api/v1/youtube-studio/videos/[id]/repurpose-clips/route.ts`. This is the **auto-clip** variant that complements the existing link-share `repurpose` route. It is approval-gated end to end and does NOT itself render or post:
  1. Load the video (org-check); require `status === 'live'` (else `apiError('Video is not live', 409)`).
  2. Create a review-gated `youtube_agent_jobs` doc (`skillKey: 'youtube-clip-finder'`, `reviewRequired: true`, `status: 'waiting_for_review'`), with `inputPacket` mirroring Task 6 and `inputSummary` describing the pipeline: "transcript → clip-finder → multi-format Shorts render batch (formats: <formats>) → social drafts (<platforms>) with per-platform captions; approval-gated at each hop." Store the requested `platforms` + `formats` in `inputPacket.references` (or a small `linked` note) so the reviewer/runner can drive Task 10's render-batch route then the existing `videos/[id]/repurpose` social-draft route.
  3. Return `{ job }`.
  Document in a code comment the downstream sequence (clip-finder → `render-batches` POST → `repurpose` POST) so the runner has an unambiguous contract. Nothing publishes without the existing social approval flow.

- [ ] **Step 16.4: Run test to verify it passes**

Run: `npx jest __tests__/app/youtube-repurpose-clips-route.test.ts --silent`
Expected: PASS.

- [ ] **Step 16.5: Commit**

```bash
git add app/api/v1/youtube-studio/videos/[id]/repurpose-clips __tests__/app/youtube-repurpose-clips-route.test.ts
git commit -m "feat(yt-os): review-gated auto-clip repurpose job (long-form -> shorts -> social)"
```

---

## Task 17: Analytics dashboard + retention explorer UI

**Files:**
- Create: `components/youtube-studio/AnalyticsDashboard.tsx`
- Create: `components/youtube-studio/RetentionExplorer.tsx`
- Create: `app/(admin)/youtube-studio/analytics/page.tsx`
- Test: `__tests__/app/youtube-analytics-dashboard.test.tsx`

- [ ] **Step 17.1: Write the failing test** — create `__tests__/app/youtube-analytics-dashboard.test.tsx`. Render `<AnalyticsDashboard snapshots={[...]} curves={[...]} />` with jsdom (`@testing-library/react`). Assert: headline metrics render (views/watch/CTR), a "Shorts vs long-form" section appears when `metrics.shortsVsLongForm` is present, a freshness label renders the snapshot's `sourceFreshness`, and the revenue section is hidden when no `revenue`/RPM metric is present.

```tsx
import { render, screen } from '@testing-library/react'
import { AnalyticsDashboard } from '@/components/youtube-studio/AnalyticsDashboard'

describe('AnalyticsDashboard', () => {
  it('renders headline metrics and a freshness label', () => {
    render(
      <AnalyticsDashboard
        snapshots={[{
          orgId: 'org1', channelWorkspaceId: 'ch1', periodStart: '2026-06-23', periodEnd: '2026-06-30',
          source: 'youtube_analytics_api', sourceFreshness: 'delayed',
          metrics: { views: 1000, watchTimeMinutes: 500, impressionsCtr: 2.5 }, recommendations: [], deleted: false,
        }]}
        curves={[]}
      />,
    )
    expect(screen.getByText(/1000/)).toBeInTheDocument()
    expect(screen.getByText(/delayed/i)).toBeInTheDocument()
  })
})
```

- [ ] **Step 17.2: Run test to verify it fails**

Run: `npx jest __tests__/app/youtube-analytics-dashboard.test.tsx --silent`
Expected: FAIL — component not found.

- [ ] **Step 17.3: Implement** `components/youtube-studio/AnalyticsDashboard.tsx` — a client component (`'use client'`) taking `{ snapshots: YouTubeAnalyticsSnapshot[]; curves: YouTubeRetentionCurve[] }`. Use the `pib-card-section` Tailwind system. Render: headline metric cards (views, watch minutes, CTR, net subs), a trends list (per-period), a "Shorts vs long-form" split table from `metrics.shortsVsLongForm`, a traffic-sources list from `metrics.trafficSources`, a demographics list from `metrics.audience`, and a revenue card ONLY when a revenue/RPM metric is present (scope-gated — absent by default). Each period card shows a freshness badge from `sourceFreshness`. Mount `<RetentionExplorer>` per selected video.

- [ ] **Step 17.4: Implement** `components/youtube-studio/RetentionExplorer.tsx` — `{ curve: YouTubeRetentionCurve }`. Paint the retention curve on a `<canvas>` (x = `elapsedRatio`, y = `audienceWatchRatio`), draw `detectRetentionCliffs` markers, and compute a hook (first-30s) scorecard: find the point nearest `elapsedRatio` corresponding to `30 / durationSeconds` (accept `durationSeconds` as a prop; if absent, use the first ~10% of points) and show the retained fraction as "Hook strength". Import `detectRetentionCliffs` from `lib/youtube-studio/retention-curve`.

- [ ] **Step 17.5: Implement** `app/(admin)/youtube-studio/analytics/page.tsx` — server component that reads `orgId`/`channelWorkspaceId` from `searchParams` (Next 15: `searchParams` is a Promise — `await searchParams`), fetches snapshots + curves via the existing API (or direct admin reads following sibling pages), and renders `<AnalyticsDashboard>`. Add the route to the studio nav in the studio workspace shell (Modified file in File Structure).

- [ ] **Step 17.6: Run test to verify it passes**

Run: `npx jest __tests__/app/youtube-analytics-dashboard.test.tsx --silent`
Expected: PASS.

- [ ] **Step 17.7: Commit**

```bash
git add components/youtube-studio/AnalyticsDashboard.tsx components/youtube-studio/RetentionExplorer.tsx "app/(admin)/youtube-studio/analytics/page.tsx" __tests__/app/youtube-analytics-dashboard.test.tsx
git commit -m "feat(yt-os): analytics dashboard + retention explorer UI"
```

---

## Task 18: Editor UI — retention overlay, transcript panel, render batch, review comments

**Files:**
- Create: `components/video-editor/RetentionOverlay.tsx`
- Create: `components/video-editor/TranscriptPanel.tsx`
- Create: `components/video-editor/RenderBatchDialog.tsx`
- Create: `components/video-editor/ReviewCommentsPanel.tsx`
- Create: `app/portal/video-editor/review/[id]/page.tsx`
- Modify: `components/video-editor/VideoEditorShell.tsx`
- Test: `__tests__/app/video-editor-phase4-ui.test.tsx`

- [ ] **Step 18.1: Write the failing test** — create `__tests__/app/video-editor-phase4-ui.test.tsx`. Assert (jsdom): `<TranscriptPanel words={[...]} onSeek={fn} onRippleRemove={fn} />` renders words and clicking a word calls `onSeek(word.start)`; a "Remove all filler words" button calls `onRippleRemove` with the filler ranges; `<RetentionOverlay mapped={[...]} cliffMarkers={[...]} pxPerSecond={10} />` renders a canvas/marker per cliff; `<RenderBatchDialog formats total credits />` shows a single credit total.

```tsx
import { render, screen, fireEvent } from '@testing-library/react'
import { TranscriptPanel } from '@/components/video-editor/TranscriptPanel'

describe('TranscriptPanel', () => {
  it('seeks to a word start on click', () => {
    const onSeek = jest.fn()
    render(<TranscriptPanel words={[{ text: 'hello', start: 2, end: 4 }]} onSeek={onSeek} onRippleRemove={jest.fn()} customFillers={[]} />)
    fireEvent.click(screen.getByText('hello'))
    expect(onSeek).toHaveBeenCalledWith(2)
  })
})
```

- [ ] **Step 18.2: Run test to verify it fails**

Run: `npx jest __tests__/app/video-editor-phase4-ui.test.tsx --silent`
Expected: FAIL — component not found.

- [ ] **Step 18.3: Implement** the four components:
  - `RetentionOverlay.tsx` — `{ mapped: MappedCurvePoint[]; cliffMarkers: TimelineCliffMarker[]; pxPerSecond: number }`. A canvas strip painted above the timeline ruler (curve line by `outputSeconds`), plus absolutely-positioned cliff pins at `outputStart * pxPerSecond` with a tooltip showing `dropMagnitude` and any annotation note.
  - `TranscriptPanel.tsx` — `{ words: TranscriptWord[]; onSeek: (s: number) => void; onRippleRemove: (ranges: ClipTimeRange[] | 'filler_all') => void; customFillers: string[] }`. Renders clickable words (click → `onSeek(word.start)`); sentence selection (shift-click range) + a Delete button → `onRippleRemove(selectedRanges)`; a "Remove all filler words" button → `onRippleRemove('filler_all')`. Highlight filler words via `fillerWordSpans`.
  - `RenderBatchDialog.tsx` — `{ formats, onToggleFormat, captionOverrides, credits: { totalCredits, lineItems }, onDispatch }`. Format checkboxes (16:9/9:16/1:1), per-format caption override inputs, and ONE credit total with a per-format breakdown; a Dispatch button POSTs to `render-batches`.
  - `ReviewCommentsPanel.tsx` — `{ version, comments, onAddComment, onDecision }`. A preview `<video>` with a "Comment at current time" button that POSTs a `comments` doc with `anchor: { timecodeSeconds }`; a comment list sorted by timecode (click → seek); approve / request-changes buttons calling `onDecision`.

- [ ] **Step 18.4: Implement** `app/portal/video-editor/review/[id]/page.tsx` — the client-facing frame-accurate review page. Fetch the portal review-version route (Task 12) + comments; render `<ReviewCommentsPanel>` in read-only-plus-approve mode wired to the portal PUT.

- [ ] **Step 18.5: Wire `VideoEditorShell.tsx`** — add right-panel tabs "Transcript" and "Review"; on project load, if `project.videoProjectId` is set, GET `retention-overlay` and mount `<RetentionOverlay>`; wire `TranscriptPanel.onRippleRemove` to the `transcript-edit` route and refresh the timeline; add a "Render all formats" action opening `RenderBatchDialog`. Keep all new panels behind tabs so the existing single-format flow is unchanged.

- [ ] **Step 18.6: Run test to verify it passes**

Run: `npx jest __tests__/app/video-editor-phase4-ui.test.tsx --silent`
Expected: PASS.

- [ ] **Step 18.7: Commit**

```bash
git add components/video-editor/RetentionOverlay.tsx components/video-editor/TranscriptPanel.tsx components/video-editor/RenderBatchDialog.tsx components/video-editor/ReviewCommentsPanel.tsx "app/portal/video-editor/review/[id]/page.tsx" components/video-editor/VideoEditorShell.tsx __tests__/app/video-editor-phase4-ui.test.tsx
git commit -m "feat(yt-os): editor UI - retention overlay, transcript panel, render batch, review comments"
```

---

## Task 19: Firestore indexes

**Files:**
- Modify: `firestore.indexes.json`

- [ ] **Step 19.1: Add composite indexes** — append to the `indexes` array in `firestore.indexes.json` (verify the file has a top-level `"indexes"` key per the `firebase.json indexes mapping gotcha` in MEMORY — a missing key silently deploys zero indexes):

```json
{ "collectionGroup": "youtube_retention_curves", "queryScope": "COLLECTION", "fields": [ { "fieldPath": "orgId", "order": "ASCENDING" }, { "fieldPath": "videoProjectId", "order": "ASCENDING" } ] },
{ "collectionGroup": "youtube_api_quota_ledger", "queryScope": "COLLECTION", "fields": [ { "fieldPath": "orgId", "order": "ASCENDING" }, { "fieldPath": "day", "order": "ASCENDING" } ] },
{ "collectionGroup": "video_editor_render_batches", "queryScope": "COLLECTION", "fields": [ { "fieldPath": "orgId", "order": "ASCENDING" }, { "fieldPath": "projectId", "order": "ASCENDING" } ] },
{ "collectionGroup": "video_editor_review_versions", "queryScope": "COLLECTION", "fields": [ { "fieldPath": "orgId", "order": "ASCENDING" }, { "fieldPath": "projectId", "order": "ASCENDING" } ] }
```

- [ ] **Step 19.2: Validate JSON**

Run: `node -e "JSON.parse(require('fs').readFileSync('firestore.indexes.json','utf8')); console.log('ok')"`
Expected: `ok`.

- [ ] **Step 19.3: Commit**

```bash
git add firestore.indexes.json
git commit -m "feat(yt-os): phase 4 composite indexes"
```

---

## Task 20: Full verification + typecheck

**Files:** none

- [ ] **Step 20.1: Run the whole Phase 4 test surface**

Run:
```bash
npx jest \
  __tests__/lib/youtube-retention-curve.test.ts \
  __tests__/lib/video-editor-retention-overlay.test.ts \
  __tests__/lib/video-editor-transcript-sync.test.ts \
  __tests__/lib/video-editor-render-batch.test.ts \
  __tests__/lib/video-editor-review-versions.test.ts \
  __tests__/lib/youtube-quota-ledger.test.ts \
  __tests__/lib/youtube-channel-report.test.ts \
  __tests__/app/youtube-retention-curves-route.test.ts \
  __tests__/app/video-editor-retention-overlay-route.test.ts \
  __tests__/app/youtube-channel-report-route.test.ts \
  __tests__/app/video-editor-transcript-edit-route.test.ts \
  __tests__/app/video-editor-render-batches-route.test.ts \
  __tests__/app/video-editor-review-versions-route.test.ts \
  __tests__/app/youtube-quota-ledger-route.test.ts \
  __tests__/app/youtube-repurpose-clips-route.test.ts \
  __tests__/app/youtube-analytics-dashboard.test.tsx \
  __tests__/app/video-editor-phase4-ui.test.tsx
```
Expected: all PASS.

- [ ] **Step 20.2: Typecheck (the real gate — `next build` skips type errors)**

Run: `npm run typecheck`
Expected: no errors. (Per MEMORY `reference_build_typecheck_gotcha`: this uses `tsconfig.typecheck.json`; `next build` has `ignoreBuildErrors` so typecheck is the gate.)

- [ ] **Step 20.3: Run the broader editor + youtube suites to catch regressions**

Run: `npx jest __tests__/lib/video-editor __tests__/lib/youtube __tests__/app/youtube __tests__/app/video-editor --silent`
Expected: all PASS (existing + new).

- [ ] **Step 20.4: Final commit if anything changed during verification**

```bash
git add -A
git commit -m "chore(yt-os): phase 4 verification fixes" --allow-empty
git push origin development
```

---

## Self-Review

**Spec coverage (§3 Pillar F + E3 items → task):**
1. Retention-on-timeline overlay + `youtube_retention_curves` + cliff markers + retention-review annotations feeding next-video briefs → Tasks 2, 3, 4, 5, 6. ✔
2. Script-driven editing (transcript panel ↔ timeline, filler removal, ripple) → Tasks 7, 8, 18. ✔
3. AI auto-edit (long footage → clip-finder → draft timeline, review-gated) → Task 8 (auto-edit route). ✔
4. Multi-format render queue (one timeline → 16:9/9:16/1:1, one charge, per-format captions + outputs) → Tasks 9, 10. ✔
5. Frame-accurate review (timecode comments + per-version approval + portal page) → Tasks 11, 12, 18. ✔
6. Analytics dashboard (channel + per-video, Shorts vs long-form, traffic, demographics, revenue-gated, freshness) + weekly agent report → Tasks 15, 17, 6. ✔
7. Repurposing automation (long-form → shorts → social drafts, approval-gated) → Task 16. ✔
8. Quota ledger `youtube_api_quota_ledger` (per op costs, forecasting, publish surfaces) → Tasks 13, 14. ✔

**Naming consistency:** `video_editor_transcripts` (consumed in Task 8), `'caption'` track kind (Task 7 timeline), `rippleDeleteClip`/`splitClip` from `timeline-ops.ts` (Task 7), `VIDEO_EDITOR_COLLECTIONS`/`YOUTUBE_COLLECTIONS` maps (Task 1), `YouTubePacketApprovalState` reused (Task 11). ✔

**Placeholder scan:** no "TBD"/"handle edge cases" left; UI tasks name concrete props + one concrete jsdom assertion each; the two credit-estimator helpers are explicitly reconciled in Task 9 (Step 9.3/9.4 notes flag the empty-timeline bug to fix during implementation). ✔

**Phase 5 note:** `youtube_api_quota_ledger` is defined as a standalone domain (Task 13) with a deterministic doc id and pure ops so Phase 5's comments-inbox `comment_write` ops reuse it without change.

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-07-06-yt-os-phase4-growth-loop.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — dispatch a fresh subagent per task, review between tasks, fast iteration (REQUIRED SUB-SKILL: superpowers:subagent-driven-development).

**2. Inline Execution** — execute tasks in this session with checkpoints (REQUIRED SUB-SKILL: superpowers:executing-plans).

**Which approach?**
