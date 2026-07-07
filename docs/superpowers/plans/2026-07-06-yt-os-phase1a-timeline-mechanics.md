# YT-OS Phase 1a — Video Editor Timeline Mechanics Parity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship Editor E2 timeline mechanics from the [[2026-07-06-youtube-channel-operating-system-spec]]: ripple-correct editing across all tracks with linked-clip groups, roll/slip edits, a full keyframes UI (transform/volume, ease presets + bezier editor) rendered by both the preview and the ffmpeg filtergraph, keyframed speed ramps with CapCut-style presets, timeline waveforms + filmstrip thumbnails, and a 540p proxy workflow with a per-org 20 GB LRU-evicted cap.

**Architecture:** All timeline mutations stay pure functions in `lib/video-editor/timeline-ops.ts` (ripple/roll/slip/group ops added beside the existing split/trim/move). Keyframe interpolation and speed-ramp math get two deliberately mirrored implementations: a browser-safe TS module pair (`lib/video-editor/keyframes.ts`, `lib/video-editor/speed-ramps.ts`) that drives the Inspector/Preview, and a Node-ESM module (`scripts/higgsfield-executor/lib/editor-keyframes.mjs`) that drives the filtergraph compiler — a parity Jest test pins both to the same fixtures. The filtergraph compiler renders keyframes as ffmpeg per-frame expressions (`overlay` x/y, `rotate` angle, `scale eval=frame`, `volume eval=frame`) plus a `sendcmd`-driven `colorchannelmixer` for opacity, and compiles speed ramps as piecewise constant-speed `trim+setpts`/`atrim+atempo` segments joined with `concat`. Waveform peaks, filmstrip sprites, and 540p proxies are produced by a new `video_editor_media_preview` job family on the VPS executor, cached in Firebase Storage, tracked in two new Firestore collections (`video_editor_media_previews`, `video_editor_proxy_ledger`), with LRU eviction decided by the executor and executed by a platform DELETE route. Renders keep the P1 charge-on-dispatch/refund-on-failure credit model untouched; preview generation is never credit-charged. Render manifests keep pointing at ORIGINAL media URLs — proxies are preview-only.

**Tech Stack:** Next.js App Router (Next 15 — `params` is a Promise, `use(params)`/`await params`), TypeScript, Firestore via `firebase-admin`, Firebase Storage (`firebase-admin/storage` `getStorage().bucket()`), Jest 30 (`ts-jest`; node project runs `__tests__/**/*.test.ts`, jsdom project runs `__tests__/**/*.test.tsx`; `.mjs` already transformed per `jest.config.ts`), React 18 client components with the `pib-card-section` Tailwind system, Node ESM `.mjs` executor on hermes-vps-01 with ffmpeg/ffprobe.

**Branch rule:** All work on `development` in `partnersinbiz-web`. Run the git preflight before Task 1. Never touch `main`. No worktrees.

**Scope guard (Phase 1a only):** Auto-captions, TTS, audio mixer/ducking/noise-reduction, effects/LUT/chroma/masks, PiP presets, templates, stock media, auto-reframe, retention overlay are LATER phases. The P1 credit model (2 credits/output-minute, ×2 UHD) is unchanged — speed ramps change source consumption, not output duration, so `estimateEditorRenderCredits` needs no edits. Media-preview/proxy jobs are free (no credit code is touched).

---

## File Structure

All paths relative to `/Users/peetstander/Cowork/Partners in Biz — Client Growth/partnersinbiz-web`.

### Created

| File | Responsibility |
|---|---|
| `lib/video-editor/keyframes.ts` | Pure keyframe interpolation: ease-preset bezier table, cubic-bezier solver, `interpolateKeyframes`, `clipTransformAt`, `clipVolumeAt` |
| `lib/video-editor/speed-ramps.ts` | Speed-ramp presets (montage/hero_time/flash_in/flash_out/bullet), `speedAt`, `sourceOffsetAt`, `rampSegments` piecewise approximation |
| `lib/video-editor/media-previews.ts` | Browser-safe media-preview domain: `mediaKeyForRef`, preview/ledger types re-exports, `sanitizeMediaPreviewReportInput` |
| `lib/video-editor/media-previews-server.ts` | Server-only: `ensureMediaPreviews` (dedupe + create pending docs + dispatch to executor), ledger record helpers (firebase-admin — kept out of browser bundles per the tsc-vs-next-build split rule) |
| `app/api/v1/video-editor/media-previews/route.ts` | POST ensure previews for MediaRefs / GET previews by keys (touches proxy LRU timestamps) |
| `app/api/v1/video-editor/media-previews/[id]/route.ts` | PUT executor report (waveform/filmstrip/proxy/status), creates ledger entries |
| `app/api/v1/video-editor/proxy-ledger/route.ts` | GET org ledger entries ordered by `lastAccessAt` asc + `totalBytes` (executor eviction input) |
| `app/api/v1/video-editor/proxy-ledger/[id]/route.ts` | DELETE evict: remove Storage object, ledger doc, clear preview proxy field |
| `scripts/higgsfield-executor/lib/editor-keyframes.mjs` | Executor-side keyframe/ramp math + ffmpeg expression builders (`keyframeExpr`, `sendcmdOpacityCommands`, `rampSegments`) |
| `components/video-editor/KeyframeEditor.tsx` | Per-property keyframe lanes (transform x/y/scale/rotation/opacity + volume), add-at-playhead, value/easing editing |
| `components/video-editor/BezierCurveEditor.tsx` | SVG cubic-bezier curve editor with two draggable control handles |
| `components/video-editor/SpeedRampSection.tsx` | Preset buttons + custom-curve hint + clear-ramp for the Inspector |
| `components/video-editor/WaveformStrip.tsx` | Canvas waveform painter from peaks JSON for timeline clips |
| `__tests__/lib/video-editor-keyframes.test.ts` | Interpolation/easing/bezier unit tests |
| `__tests__/lib/video-editor-speed-ramps.test.ts` | Preset + integration (`sourceOffsetAt`) + segmentation tests |
| `__tests__/lib/video-editor-media-previews.test.ts` | `mediaKeyForRef` + report sanitizer tests |
| `__tests__/lib/video-editor-keyframe-parity.test.ts` | TS ↔ `.mjs` fixture parity (same numbers from both implementations) |
| `__tests__/scripts/editor-keyframes-mjs.test.ts` | Expression-builder golden tests (`keyframeExpr`, sendcmd, ramp segments) |
| `__tests__/app/video-editor-keyframe-editor.test.tsx` | KeyframeEditor + BezierCurveEditor jsdom tests |
| `__tests__/app/video-editor-timeline-mechanics.test.tsx` | TimelinePanel trim-handle/edit-mode/keyframe-marker/waveform jsdom tests |

### Modified

| File | Change |
|---|---|
| `lib/video-editor/types.ts` | `EditorClip.groupId`, bezier easing + control points on `EditorKeyframe`, `SpeedRampPresetId`, media-preview + proxy-ledger record types, collection constants for previews |
| `lib/video-editor/sanitize.ts` | Sanitize `groupId`, bezier keyframes (clamped control points), speed-keyframe value clamp 0.25–4, keyframe sort; media-preview report sanitizer lives in `media-previews.ts` |
| `lib/video-editor/timeline-ops.ts` | `shiftDownstream` helper; `rippleDeleteClip`, `rippleTrimClip`, `rollEdit`, `slipClip`, `setClipGroup`, `clearClipGroup`, `groupMembers`, `moveClipGroup`, `removeClipGroup` |
| `lib/video-editor/dispatch.ts` | `previewSubmitUrl` in runtime config; `buildMediaPreviewManifest` + `dispatchMediaPreviewJob` |
| `lib/video-editor/register-outputs.ts` | Fire-and-forget `ensureMediaPreviews` for freshly rendered outputs |
| `scripts/higgsfield-executor/lib/editor-filtergraph.mjs` | Keyframed transforms (overlay x/y, rotate, scale eval=frame), opacity via sendcmd+colorchannelmixer, keyframed volume, speed-ramp segment compilation with concat |
| `scripts/higgsfield-executor/executor.mjs` | `video_editor_media_preview` job family: waveform peaks, filmstrip sprite, 540p proxy, ledger LRU eviction calls |
| `components/video-editor/TimelinePanel.tsx` | Trim handles (fixes the stub wire-up), edit-mode toolbar (normal/ripple/roll/slip), multi-select + link/unlink, keyframe diamonds, waveform/filmstrip clip bodies |
| `components/video-editor/InspectorPanel.tsx` | Mounts KeyframeEditor + SpeedRampSection; receives playhead context |
| `components/video-editor/PreviewPlayer.tsx` | Real clip rendering (video/img elements), keyframe-interpolated CSS transform/opacity/volume, proxy URLs, ramp-aware seek + playbackRate |
| `components/video-editor/VideoEditorShell.tsx` | Edit-mode state, ripple/roll/slip/group handlers, media-preview loading + ensure calls, new selection model |
| `components/video-editor/MediaLibraryPanel.tsx` | Proxy/preview status chips per source |
| `__tests__/lib/video-editor-timeline-ops.test.ts` | New describe blocks for ripple/roll/slip/group ops |
| `__tests__/lib/video-editor-sanitize.test.ts` | groupId + bezier keyframe sanitizer cases |
| `__tests__/scripts/editor-filtergraph.test.ts` | Golden tests for keyframed transforms/volume/opacity and ramp concat chains |
| `firestore.indexes.json` | Composite index `video_editor_proxy_ledger (orgId ASC, lastAccessAt ASC)` |
| VPS `/opt/higgsfield-executor/` | Manual deploy: byte-identical `executor.mjs` + `lib/*.mjs`, dated `.bak` (Task 16, Peet-approved access) |

---

## Task 0: Git preflight

- [ ] `cd "/Users/peetstander/Cowork/Partners in Biz — Client Growth/partnersinbiz-web"`
- [ ] `git status --short --branch` — confirm branch `development`. If not: `git checkout development` (create per CLAUDE.md rules if missing).
- [ ] If dirty: `git add -A && git commit -m "chore(agent): checkpoint existing local work before sync"`
- [ ] `git pull --rebase origin development`
- [ ] `git status --short --branch` again — clean, on `development`.

No commit for this task.

---

## Task 1: Types — groups, bezier keyframes, ramp presets, media previews

**Files:**
- Modify: `lib/video-editor/types.ts`
- Test: `__tests__/lib/video-editor-types.test.ts`

- [ ] **Step 1.1: Write the failing tests** — append to `__tests__/lib/video-editor-types.test.ts`:

```ts
import {
  EDITOR_KEYFRAME_EASINGS,
  MEDIA_PREVIEW_STATUSES,
  SPEED_RAMP_PRESET_IDS,
  VIDEO_EDITOR_PREVIEW_COLLECTIONS,
} from '@/lib/video-editor/types'
import type { EditorClip, EditorKeyframe, VideoEditorMediaPreview, VideoEditorProxyLedgerEntry } from '@/lib/video-editor/types'

describe('phase 1a type surface', () => {
  it('exposes bezier easing and ramp preset ids', () => {
    expect(EDITOR_KEYFRAME_EASINGS).toEqual(['linear', 'ease_in', 'ease_out', 'ease_in_out', 'bezier'])
    expect(SPEED_RAMP_PRESET_IDS).toEqual(['montage', 'hero_time', 'flash_in', 'flash_out', 'bullet'])
    expect(MEDIA_PREVIEW_STATUSES).toEqual(['pending', 'processing', 'ready', 'failed', 'skipped'])
    expect(VIDEO_EDITOR_PREVIEW_COLLECTIONS).toEqual({
      mediaPreviews: 'video_editor_media_previews',
      proxyLedger: 'video_editor_proxy_ledger',
    })
  })

  it('type-checks a grouped clip with a bezier keyframe and preview records', () => {
    const keyframe: EditorKeyframe = {
      property: 'transform.opacity',
      atSeconds: 1,
      value: 0.5,
      easing: 'bezier',
      bezier: [0.3, 0, 0.7, 1],
    }
    const clip: EditorClip = { id: 'c', timelineStart: 0, duration: 2, groupId: 'grp-1', keyframes: [keyframe] }
    expect(clip.groupId).toBe('grp-1')

    const preview: VideoEditorMediaPreview = {
      orgId: 'org1',
      mediaKey: 'upload:f1',
      sourceUrl: 'https://x.test/a.mp4',
      mediaKind: 'video',
      status: 'ready',
      waveform: { url: 'https://x.test/w.json', storagePath: 'p/w.json', peaksPerSecond: 20, peakCount: 100 },
      filmstrip: { url: 'https://x.test/f.jpg', storagePath: 'p/f.jpg', frameIntervalSeconds: 2, frameWidth: 160, frameHeight: 90, frameCount: 10 },
      proxy: { url: 'https://x.test/p.mp4', storagePath: 'p/p.mp4', sizeBytes: 1000, width: 960, height: 540 },
      deleted: false,
    }
    const ledger: VideoEditorProxyLedgerEntry = {
      orgId: 'org1', mediaKey: 'upload:f1', previewId: 'pv1', storagePath: 'p/p.mp4', sizeBytes: 1000,
    }
    expect(preview.status).toBe('ready')
    expect(ledger.sizeBytes).toBe(1000)
  })
})
```

- [ ] **Step 1.2: Run tests to verify they fail**

Run: `npx jest __tests__/lib/video-editor-types.test.ts --silent`
Expected: FAIL — `EDITOR_KEYFRAME_EASINGS` etc. not exported.

- [ ] **Step 1.3: Implement the type additions** — in `lib/video-editor/types.ts`:

Replace the `EditorKeyframe` interface with:

```ts
export type EditorKeyframeEasing = 'linear' | 'ease_in' | 'ease_out' | 'ease_in_out' | 'bezier'
export const EDITOR_KEYFRAME_EASINGS: EditorKeyframeEasing[] = ['linear', 'ease_in', 'ease_out', 'ease_in_out', 'bezier']

export type EditorKeyframeProperty =
  | 'transform.x'
  | 'transform.y'
  | 'transform.scale'
  | 'transform.rotation'
  | 'transform.opacity'
  | 'volume'
  | 'speed'

export const EDITOR_KEYFRAME_PROPERTIES: EditorKeyframeProperty[] = [
  'transform.x',
  'transform.y',
  'transform.scale',
  'transform.rotation',
  'transform.opacity',
  'volume',
  'speed',
]

export interface EditorKeyframe {
  property: EditorKeyframeProperty
  /** Clip-relative seconds (0 = the clip's first visible frame on the timeline). */
  atSeconds: number
  value: number
  /** Easing of the segment that STARTS at this keyframe. Default linear. */
  easing?: EditorKeyframeEasing
  /** cubic-bezier(p1x, p1y, p2x, p2y) — only read when easing === 'bezier'. x values in [0,1]. */
  bezier?: [number, number, number, number]
}
```

Add `groupId` to `EditorClip` (after `id`):

```ts
export interface EditorClip {
  id: string
  /** Linked-clip group: clips sharing a groupId move/ripple together. */
  groupId?: string
  timelineStart: number
  duration: number
  media?: MediaRef
  text?: EditorTextPayload
  trimStart?: number
  speed?: number
  volume?: number
  transform?: EditorClipTransform
  transitionAfter?: EditorClipTransition
  effects?: EditorEffectInstance[]
  keyframes?: EditorKeyframe[]
}
```

Append at the end of the file:

```ts
// ---------------------------------------------------------------------------
// Phase 1a — speed ramp presets, media previews, proxy ledger
// ---------------------------------------------------------------------------

export type SpeedRampPresetId = 'montage' | 'hero_time' | 'flash_in' | 'flash_out' | 'bullet'
export const SPEED_RAMP_PRESET_IDS: SpeedRampPresetId[] = ['montage', 'hero_time', 'flash_in', 'flash_out', 'bullet']

export type VideoEditorMediaPreviewStatus = 'pending' | 'processing' | 'ready' | 'failed' | 'skipped'
export const MEDIA_PREVIEW_STATUSES: VideoEditorMediaPreviewStatus[] = ['pending', 'processing', 'ready', 'failed', 'skipped']

export const VIDEO_EDITOR_PREVIEW_COLLECTIONS = {
  mediaPreviews: 'video_editor_media_previews',
  proxyLedger: 'video_editor_proxy_ledger',
} as const

export interface MediaPreviewWaveform {
  url: string
  storagePath: string
  peaksPerSecond: number
  peakCount: number
}

export interface MediaPreviewFilmstrip {
  url: string
  storagePath: string
  frameIntervalSeconds: number
  frameWidth: number
  frameHeight: number
  frameCount: number
}

export interface MediaPreviewProxy {
  url: string
  storagePath: string
  sizeBytes: number
  width: number
  height: number
}

export interface VideoEditorMediaPreview {
  id?: string
  orgId: string
  /** Deterministic identity of the source media — see mediaKeyForRef(). */
  mediaKey: string
  sourceUrl: string
  mediaKind: EditorMediaKind
  status: VideoEditorMediaPreviewStatus
  waveform?: MediaPreviewWaveform
  filmstrip?: MediaPreviewFilmstrip
  proxy?: MediaPreviewProxy
  error?: { code: string; message: string }
  deleted: boolean
  createdBy?: string
  createdByType?: ActorType
  updatedBy?: string
  updatedByType?: ActorType
  createdAt?: unknown
  updatedAt?: unknown
}

export interface VideoEditorProxyLedgerEntry {
  id?: string
  orgId: string
  mediaKey: string
  previewId: string
  storagePath: string
  sizeBytes: number
  lastAccessAt?: unknown
  createdAt?: unknown
}
```

- [ ] **Step 1.4: Run tests to verify they pass**

Run: `npx jest __tests__/lib/video-editor-types.test.ts --silent`
Expected: PASS. Also run `npm run typecheck` — the widened `EditorKeyframe['easing']` union must not break `sanitize.ts` (its local `KEYFRAME_EASINGS` array is still assignable). If sanitize errors, that is fixed in Task 2.

- [ ] **Step 1.5: Commit**

```bash
git add lib/video-editor/types.ts __tests__/lib/video-editor-types.test.ts
git commit -m "feat(video-editor): clip groups, bezier keyframes, ramp preset + media preview types"
```

---

## Task 2: Sanitizer — groupId, bezier keyframes, speed clamp

**Files:**
- Modify: `lib/video-editor/sanitize.ts`
- Test: `__tests__/lib/video-editor-sanitize.test.ts`

- [ ] **Step 2.1: Write the failing tests** — append to `__tests__/lib/video-editor-sanitize.test.ts`:

```ts
import { sanitizeEditorTimeline } from '@/lib/video-editor/sanitize'

describe('phase 1a sanitizer additions', () => {
  const track = (clips: unknown[]) => ({ version: 1, tracks: [{ id: 't1', kind: 'video', clips }] })

  it('keeps groupId strings and drops junk groupIds', () => {
    const timeline = sanitizeEditorTimeline(track([
      { id: 'a', timelineStart: 0, duration: 2, groupId: ' grp-1 ' },
      { id: 'b', timelineStart: 2, duration: 2, groupId: 42 },
    ]))
    expect(timeline.tracks[0].clips[0].groupId).toBe('grp-1')
    expect(timeline.tracks[0].clips[1].groupId).toBeUndefined()
  })

  it('accepts bezier easing with clamped control-point x values and drops malformed tuples', () => {
    const timeline = sanitizeEditorTimeline(track([{
      id: 'a', timelineStart: 0, duration: 4,
      keyframes: [
        { property: 'transform.opacity', atSeconds: 1, value: 0.5, easing: 'bezier', bezier: [1.5, -2, -0.5, 3] },
        { property: 'volume', atSeconds: 0, value: 1, easing: 'bezier', bezier: [0.1, 0.2] },
        { property: 'volume', atSeconds: 2, value: 0, easing: 'ease_out', bezier: [0.1, 0.2, 0.3, 0.4] },
      ],
    }]))
    const kfs = timeline.tracks[0].clips[0].keyframes ?? []
    // sorted property-then-time: [transform.opacity@1, volume@0, volume@2]
    expect(kfs[0]).toMatchObject({ property: 'transform.opacity', easing: 'bezier', bezier: [1, -2, 0, 3] })
    expect(kfs.find((k) => k.atSeconds === 0 && k.property === 'volume')).toMatchObject({ easing: 'linear' })
    expect(kfs.find((k) => k.atSeconds === 2)?.bezier).toBeUndefined()
  })

  it('sorts keyframes by property then atSeconds and clamps speed values to 0.25-4', () => {
    const timeline = sanitizeEditorTimeline(track([{
      id: 'a', timelineStart: 0, duration: 4,
      keyframes: [
        { property: 'speed', atSeconds: 3, value: 99 },
        { property: 'speed', atSeconds: 0, value: 0.01 },
      ],
    }]))
    const kfs = timeline.tracks[0].clips[0].keyframes ?? []
    expect(kfs.map((k) => [k.atSeconds, k.value])).toEqual([[0, 0.25], [3, 4]])
  })
})
```

- [ ] **Step 2.2: Run tests to verify they fail**

Run: `npx jest __tests__/lib/video-editor-sanitize.test.ts --silent`
Expected: FAIL — groupId dropped, bezier dropped, no clamping.

- [ ] **Step 2.3: Implement** — in `lib/video-editor/sanitize.ts`:

Replace the `KEYFRAME_EASINGS` constant and `sanitizeKeyframes` with:

```ts
const KEYFRAME_EASINGS: NonNullable<EditorKeyframe['easing']>[] = ['linear', 'ease_in', 'ease_out', 'ease_in_out', 'bezier']

function sanitizeBezier(value: unknown): [number, number, number, number] | undefined {
  if (!Array.isArray(value) || value.length !== 4) return undefined
  const nums = value.map((entry) => cleanNumber(entry))
  if (nums.some((entry) => entry === undefined)) return undefined
  const [p1x, p1y, p2x, p2y] = nums as number[]
  return [
    Math.min(Math.max(p1x, 0), 1),
    Math.min(Math.max(p1y, -10), 10),
    Math.min(Math.max(p2x, 0), 1),
    Math.min(Math.max(p2y, -10), 10),
  ]
}

function sanitizeKeyframes(value: unknown): EditorKeyframe[] | undefined {
  if (!Array.isArray(value)) return undefined
  const keyframes = value.flatMap((entry) => {
    const source = cleanObject(entry)
    const property = source.property
    const atSeconds = cleanNumber(source.atSeconds)
    const rawValue = cleanNumber(source.value)
    if (!KEYFRAME_PROPERTIES.includes(property as never) || atSeconds === undefined || rawValue === undefined) return []
    const kfValue = property === 'speed' ? Math.min(Math.max(rawValue, 0.25), 4) : rawValue
    const bezier = sanitizeBezier(source.bezier)
    const easing = KEYFRAME_EASINGS.includes(source.easing as never)
      ? (source.easing as EditorKeyframe['easing'])
      : undefined
    if (easing === 'bezier' && !bezier) {
      return [compact({ property: property as EditorKeyframe['property'], atSeconds: Math.max(0, atSeconds), value: kfValue, easing: 'linear' as const })]
    }
    return [compact({
      property: property as EditorKeyframe['property'],
      atSeconds: Math.max(0, atSeconds),
      value: kfValue,
      easing,
      ...(easing === 'bezier' && bezier ? { bezier } : {}),
    })]
  })
  keyframes.sort((a, b) => a.property.localeCompare(b.property) || a.atSeconds - b.atSeconds)
  return keyframes.length ? keyframes : undefined
}
```

In `sanitizeClip`, add `groupId` right after `id` inside the returned `compact({ ... })`:

```ts
  return compact({
    id,
    groupId: cleanString(source.groupId),
    timelineStart: clampNumber(source.timelineStart, 0, 60 * 60 * 4, 0),
    // ... rest unchanged
```

- [ ] **Step 2.4: Run tests to verify they pass**

Run: `npx jest __tests__/lib/video-editor-sanitize.test.ts __tests__/lib/video-editor-types.test.ts --silent`
Expected: PASS.

- [ ] **Step 2.5: Commit**

```bash
git add lib/video-editor/sanitize.ts __tests__/lib/video-editor-sanitize.test.ts
git commit -m "feat(video-editor): sanitize clip groups and bezier/speed keyframes"
```

---

## Task 3: Pure ops — linked-clip groups

**Files:**
- Modify: `lib/video-editor/timeline-ops.ts`
- Test: `__tests__/lib/video-editor-timeline-ops.test.ts`

- [ ] **Step 3.1: Write the failing tests** — append to `__tests__/lib/video-editor-timeline-ops.test.ts`:

```ts
import {
  clearClipGroup,
  groupMembers,
  moveClipGroup,
  removeClipGroup,
  setClipGroup,
} from '@/lib/video-editor/timeline-ops'

function groupedTimeline(): EditorTimeline {
  return {
    version: 1,
    tracks: [
      { id: 'v1', kind: 'video', clips: [clip('a', 0, 4), clip('b', 4, 3)] },
      { id: 'a1', kind: 'audio', clips: [clip('m', 0, 4, { media: { type: 'upload', fileId: 'file-m', url: 'https://x.test/m.mp3', mediaKind: 'audio' } })] },
    ],
  }
}

describe('linked clip groups', () => {
  it('links clips across tracks under one groupId and lists members', () => {
    const linked = setClipGroup(groupedTimeline(), [
      { trackId: 'v1', clipId: 'a' },
      { trackId: 'a1', clipId: 'm' },
    ])
    const groupId = linked.tracks[0].clips[0].groupId
    expect(groupId).toBeTruthy()
    expect(linked.tracks[1].clips[0].groupId).toBe(groupId)
    expect(groupMembers(linked, groupId!)).toEqual([
      { trackId: 'v1', clipId: 'a' },
      { trackId: 'a1', clipId: 'm' },
    ])
    const cleared = clearClipGroup(linked, groupId!)
    expect(cleared.tracks[0].clips[0].groupId).toBeUndefined()
    expect(cleared.tracks[1].clips[0].groupId).toBeUndefined()
  })

  it('rejects linking fewer than two clips or unknown clips', () => {
    expect(() => setClipGroup(groupedTimeline(), [{ trackId: 'v1', clipId: 'a' }])).toThrow(TimelineOpError)
    expect(() => setClipGroup(groupedTimeline(), [
      { trackId: 'v1', clipId: 'a' },
      { trackId: 'v1', clipId: 'nope' },
    ])).toThrow(TimelineOpError)
  })

  it('moves every member by the same delta and rejects collisions atomically', () => {
    const linked = setClipGroup(groupedTimeline(), [
      { trackId: 'v1', clipId: 'a' },
      { trackId: 'a1', clipId: 'm' },
    ])
    const groupId = linked.tracks[0].clips[0].groupId!
    const moved = moveClipGroup(linked, groupId, 10)
    expect(moved.tracks[0].clips.find((c) => c.id === 'a')?.timelineStart).toBe(10)
    expect(moved.tracks[1].clips[0].timelineStart).toBe(10)
    // moving left below zero clamps as a whole-group error, not per clip
    expect(() => moveClipGroup(linked, groupId, -1)).toThrow(TimelineOpError)
    // collision with clip b on v1 rejects the whole move
    expect(() => moveClipGroup(linked, groupId, 1)).toThrow(TimelineOpError)
  })

  it('removes all group members at once', () => {
    const linked = setClipGroup(groupedTimeline(), [
      { trackId: 'v1', clipId: 'a' },
      { trackId: 'a1', clipId: 'm' },
    ])
    const groupId = linked.tracks[0].clips[0].groupId!
    const removed = removeClipGroup(linked, groupId)
    expect(removed.tracks[0].clips.map((c) => c.id)).toEqual(['b'])
    expect(removed.tracks[1].clips).toHaveLength(0)
    expect(() => removeClipGroup(groupedTimeline(), 'missing-group')).toThrow(TimelineOpError)
  })
})
```

- [ ] **Step 3.2: Run tests to verify they fail**

Run: `npx jest __tests__/lib/video-editor-timeline-ops.test.ts --silent`
Expected: FAIL — `setClipGroup` is not exported.

- [ ] **Step 3.3: Implement group ops** — append to `lib/video-editor/timeline-ops.ts`:

```ts
export interface ClipRef {
  trackId: string
  clipId: string
}

function uniqueGroupId(timeline: EditorTimeline): string {
  const existing = new Set<string>()
  for (const track of timeline.tracks) for (const clip of track.clips) if (clip.groupId) existing.add(clip.groupId)
  let index = 1
  let id = `group-${index}`
  while (existing.has(id)) {
    index += 1
    id = `group-${index}`
  }
  return id
}

export function setClipGroup(timeline: EditorTimeline, members: ClipRef[], groupId?: string): EditorTimeline {
  if (members.length < 2) throw new TimelineOpError('Linking needs at least two clips.')
  const next = cloneTimeline(timeline)
  const id = groupId ?? uniqueGroupId(next)
  for (const member of members) {
    const track = findTrack(next, member.trackId)
    const clip = findClip(track, member.clipId)
    clip.groupId = id
  }
  return next
}

export function clearClipGroup(timeline: EditorTimeline, groupId: string): EditorTimeline {
  const next = cloneTimeline(timeline)
  let found = false
  for (const track of next.tracks) {
    for (const clip of track.clips) {
      if (clip.groupId === groupId) {
        delete clip.groupId
        found = true
      }
    }
  }
  if (!found) throw new TimelineOpError(`Group '${groupId}' not found.`)
  return next
}

export function groupMembers(timeline: EditorTimeline, groupId: string): ClipRef[] {
  const members: ClipRef[] = []
  for (const track of timeline.tracks) {
    for (const clip of track.clips) {
      if (clip.groupId === groupId) members.push({ trackId: track.id, clipId: clip.id })
    }
  }
  return members
}

export function moveClipGroup(timeline: EditorTimeline, groupId: string, deltaSeconds: number): EditorTimeline {
  const next = cloneTimeline(timeline)
  const members = groupMembers(next, groupId)
  if (!members.length) throw new TimelineOpError(`Group '${groupId}' not found.`)
  const touchedTracks = new Set<EditorTrack>()
  for (const member of members) {
    const track = findTrack(next, member.trackId)
    const clip = findClip(track, member.clipId)
    const start = clip.timelineStart + deltaSeconds
    if (start < -EPSILON) throw new TimelineOpError('Group move would push a clip before the timeline start.')
    clip.timelineStart = round3(Math.max(0, start))
    touchedTracks.add(track)
  }
  for (const track of touchedTracks) assertNoOverlap(track)
  return next
}

export function removeClipGroup(timeline: EditorTimeline, groupId: string): EditorTimeline {
  const next = cloneTimeline(timeline)
  const members = groupMembers(next, groupId)
  if (!members.length) throw new TimelineOpError(`Group '${groupId}' not found.`)
  for (const track of next.tracks) {
    track.clips = track.clips.filter((clip) => clip.groupId !== groupId)
  }
  return next
}
```

- [ ] **Step 3.4: Run tests to verify they pass**

Run: `npx jest __tests__/lib/video-editor-timeline-ops.test.ts --silent`
Expected: PASS.

- [ ] **Step 3.5: Commit**

```bash
git add lib/video-editor/timeline-ops.ts __tests__/lib/video-editor-timeline-ops.test.ts
git commit -m "feat(video-editor): linked clip group pure ops"
```

---

## Task 4: Pure ops — ripple delete and ripple trim across all tracks

**Files:**
- Modify: `lib/video-editor/timeline-ops.ts`
- Test: `__tests__/lib/video-editor-timeline-ops.test.ts`

**Semantics (the CapCut fix, matching Premiere):**
- Ripple delete removes the clip and shifts every clip on every unlocked track whose `timelineStart >= removedEnd − ε` left by the removed duration. Clips overlapping the removed span stay put; if a shifted clip would collide with one, the whole op throws `TimelineOpError` (atomic — the UI surfaces the message).
- Ripple trim performs the normal trim, then shifts every clip on every unlocked track starting at/after the trimmed clip's OLD end by the change in that end (`+delta` for end-trims; `−delta` for start-trims, whose in-point advances while `timelineStart` stays fixed).
- Locked tracks never shift (explicit user choice); the trimmed/deleted clip's own track is included in the sweep like any other.

- [ ] **Step 4.1: Write the failing tests** — append to `__tests__/lib/video-editor-timeline-ops.test.ts`:

```ts
import { rippleDeleteClip, rippleTrimClip } from '@/lib/video-editor/timeline-ops'

function rippleTimeline(): EditorTimeline {
  return {
    version: 1,
    tracks: [
      { id: 'v1', kind: 'video', clips: [clip('a', 0, 4), clip('b', 4, 3), clip('c', 9, 2)] },
      { id: 'v2', kind: 'video', clips: [clip('x', 5, 2)] },
      { id: 'a1', kind: 'audio', locked: true, clips: [clip('m', 4, 6, { media: { type: 'upload', fileId: 'file-m', url: 'https://x.test/m.mp3', mediaKind: 'audio' } })] },
    ],
  }
}

describe('rippleDeleteClip', () => {
  it('removes the clip and closes the gap on every unlocked track', () => {
    const next = rippleDeleteClip(rippleTimeline(), 'v1', 'a')
    // downstream of removedEnd=4 shifts left by 4
    expect(next.tracks[0].clips.map((c) => [c.id, c.timelineStart])).toEqual([['b', 0], ['c', 5]])
    expect(next.tracks[1].clips[0].timelineStart).toBe(1) // x: 5 -> 1
    expect(next.tracks[2].clips[0].timelineStart).toBe(4) // locked track untouched
  })

  it('leaves clips that overlap the removed span and throws on collisions', () => {
    const timeline: EditorTimeline = {
      version: 1,
      tracks: [
        { id: 'v1', kind: 'video', clips: [clip('a', 2, 4), clip('b', 6, 2)] },
        { id: 'v2', kind: 'video', clips: [clip('spanning', 0, 8), clip('later', 8, 4)] },
      ],
    }
    // deleting a (span 2-6, duration 4): 'later' would shift 8->4, colliding with 'spanning' (0-8)
    expect(() => rippleDeleteClip(timeline, 'v1', 'a')).toThrow(TimelineOpError)
  })

  it('supports single-track mode', () => {
    const next = rippleDeleteClip(rippleTimeline(), 'v1', 'a', { allTracks: false })
    expect(next.tracks[0].clips.map((c) => [c.id, c.timelineStart])).toEqual([['b', 0], ['c', 5]])
    expect(next.tracks[1].clips[0].timelineStart).toBe(5) // v2 untouched
  })
})

describe('rippleTrimClip', () => {
  it('end-trim shorter pulls downstream clips left on all unlocked tracks', () => {
    const next = rippleTrimClip(rippleTimeline(), 'v1', 'a', { edge: 'end', deltaSeconds: -1 })
    expect(next.tracks[0].clips.map((c) => [c.id, c.timelineStart, c.duration])).toEqual([['a', 0, 3], ['b', 3, 3], ['c', 8, 2]])
    expect(next.tracks[1].clips[0].timelineStart).toBe(4)
    expect(next.tracks[2].clips[0].timelineStart).toBe(4) // locked
  })

  it('end-trim longer pushes downstream clips right', () => {
    const next = rippleTrimClip(rippleTimeline(), 'v1', 'b', { edge: 'end', deltaSeconds: 2 })
    expect(next.tracks[0].clips.map((c) => [c.id, c.timelineStart])).toEqual([['a', 0], ['b', 4], ['c', 11]])
    // x starts at 5 < oldEnd 7, so it stays
    expect(next.tracks[1].clips[0].timelineStart).toBe(5)
  })

  it('start-trim keeps timelineStart, advances trimStart, and closes the gap downstream', () => {
    const timeline: EditorTimeline = {
      version: 1,
      tracks: [{ id: 'v1', kind: 'video', clips: [clip('a', 0, 4, { trimStart: 1, speed: 2 }), clip('b', 4, 3)] }],
    }
    const next = rippleTrimClip(timeline, 'v1', 'a', { edge: 'start', deltaSeconds: 1 })
    expect(next.tracks[0].clips[0]).toMatchObject({ id: 'a', timelineStart: 0, duration: 3, trimStart: 3 })
    expect(next.tracks[0].clips[1].timelineStart).toBe(3)
  })

  it('rejects trims that remove the clip or rewind the source', () => {
    expect(() => rippleTrimClip(rippleTimeline(), 'v1', 'a', { edge: 'end', deltaSeconds: -4 })).toThrow(TimelineOpError)
    expect(() => rippleTrimClip(rippleTimeline(), 'v1', 'a', { edge: 'start', deltaSeconds: -1 })).toThrow(TimelineOpError)
  })
})
```

- [ ] **Step 4.2: Run tests to verify they fail**

Run: `npx jest __tests__/lib/video-editor-timeline-ops.test.ts --silent`
Expected: FAIL — `rippleDeleteClip` not exported.

- [ ] **Step 4.3: Implement** — append to `lib/video-editor/timeline-ops.ts`:

```ts
/**
 * Shift every clip starting at/after `fromSeconds` by `deltaSeconds` on every
 * unlocked track (or only `onlyTrackId` when given). Throws atomically if any
 * shifted clip would start below zero or overlap a stationary clip.
 */
function shiftDownstream(
  timeline: EditorTimeline,
  fromSeconds: number,
  deltaSeconds: number,
  options: { onlyTrackId?: string; excludeClipIds?: Set<string> } = {},
): void {
  if (Math.abs(deltaSeconds) < EPSILON) return
  for (const track of timeline.tracks) {
    if (track.locked) continue
    if (options.onlyTrackId && track.id !== options.onlyTrackId) continue
    for (const clip of track.clips) {
      if (options.excludeClipIds?.has(clip.id)) continue
      if (clip.timelineStart >= fromSeconds - EPSILON) {
        const start = clip.timelineStart + deltaSeconds
        if (start < -EPSILON) throw new TimelineOpError(`Ripple would push clip '${clip.id}' before the timeline start.`)
        clip.timelineStart = round3(Math.max(0, start))
      }
    }
    assertNoOverlap(track)
  }
}

export function rippleDeleteClip(
  timeline: EditorTimeline,
  trackId: string,
  clipId: string,
  options: { allTracks?: boolean } = {},
): EditorTimeline {
  const allTracks = options.allTracks !== false
  const next = cloneTimeline(timeline)
  const track = findTrack(next, trackId)
  const clip = findClip(track, clipId)
  const removedEnd = clip.timelineStart + clip.duration
  track.clips = track.clips.filter((item) => item.id !== clipId)
  shiftDownstream(next, removedEnd, -clip.duration, allTracks ? {} : { onlyTrackId: trackId })
  return next
}

export function rippleTrimClip(
  timeline: EditorTimeline,
  trackId: string,
  clipId: string,
  options: { edge: 'start' | 'end'; deltaSeconds: number; allTracks?: boolean },
): EditorTimeline {
  const allTracks = options.allTracks !== false
  const next = cloneTimeline(timeline)
  const track = findTrack(next, trackId)
  const clip = findClip(track, clipId)
  const speed = clip.speed && clip.speed > 0 ? clip.speed : 1
  const oldEnd = clip.timelineStart + clip.duration
  const sweep = allTracks ? {} : { onlyTrackId: trackId }

  if (options.edge === 'end') {
    const duration = clip.duration + options.deltaSeconds
    if (!(duration > EPSILON)) throw new TimelineOpError('Trim would remove the whole clip.')
    clip.duration = round3(duration)
    shiftDownstream(next, oldEnd, options.deltaSeconds, { ...sweep, excludeClipIds: new Set([clipId]) })
  } else {
    // Ripple in-trim: the in-point advances, the clip stays anchored at its
    // timelineStart, and everything downstream closes the gap.
    const duration = clip.duration - options.deltaSeconds
    const trimStart = (clip.trimStart ?? 0) + options.deltaSeconds * speed
    if (!(duration > EPSILON)) throw new TimelineOpError('Trim would remove the whole clip.')
    if (trimStart < -EPSILON) throw new TimelineOpError('Trim would rewind before the source start.')
    clip.duration = round3(duration)
    clip.trimStart = round3(Math.max(0, trimStart))
    shiftDownstream(next, oldEnd, -options.deltaSeconds, { ...sweep, excludeClipIds: new Set([clipId]) })
  }
  assertNoOverlap(track)
  return next
}
```

- [ ] **Step 4.4: Run tests to verify they pass**

Run: `npx jest __tests__/lib/video-editor-timeline-ops.test.ts --silent`
Expected: PASS.

- [ ] **Step 4.5: Commit**

```bash
git add lib/video-editor/timeline-ops.ts __tests__/lib/video-editor-timeline-ops.test.ts
git commit -m "feat(video-editor): ripple delete/trim across all unlocked tracks"
```

---

## Task 5: Pure ops — roll and slip edits

**Files:**
- Modify: `lib/video-editor/timeline-ops.ts`
- Test: `__tests__/lib/video-editor-timeline-ops.test.ts`

**Semantics:**
- **Roll** moves the shared boundary between two adjacent clips: the left clip's out-point and the right clip's in-point move together; total duration is unchanged, nothing else shifts. Right clip's `trimStart` advances by `delta × rightSpeed`; if the left clip's media carries `sourceDuration`, rolling right must not run past its source.
- **Slip** changes which part of the source plays inside a fixed timeline window: `trimStart += delta × speed`; `timelineStart`/`duration` untouched. Only valid for media clips.

- [ ] **Step 5.1: Write the failing tests** — append to `__tests__/lib/video-editor-timeline-ops.test.ts`:

```ts
import { rollEdit, slipClip } from '@/lib/video-editor/timeline-ops'

describe('rollEdit', () => {
  const rollTimeline = (): EditorTimeline => ({
    version: 1,
    tracks: [{
      id: 'v1',
      kind: 'video',
      clips: [
        clip('a', 0, 4, { media: { type: 'upload', fileId: 'file-a', url: 'https://x.test/a.mp4', mediaKind: 'video', sourceDuration: 5 } }),
        clip('b', 4, 3, { trimStart: 2, speed: 2 }),
      ],
    }],
  })

  it('moves the boundary keeping total duration constant', () => {
    const next = rollEdit(rollTimeline(), 'v1', 'a', 'b', 1)
    const [a, b] = next.tracks[0].clips
    expect(a).toMatchObject({ id: 'a', timelineStart: 0, duration: 5 })
    expect(b).toMatchObject({ id: 'b', timelineStart: 5, duration: 2, trimStart: 4 }) // 2 + 1*2
  })

  it('rolls left, rewinding the right clip into its source', () => {
    const next = rollEdit(rollTimeline(), 'v1', 'a', 'b', -1)
    const [a, b] = next.tracks[0].clips
    expect(a.duration).toBe(3)
    expect(b).toMatchObject({ timelineStart: 3, duration: 4, trimStart: 0 })
  })

  it('rejects non-adjacent pairs, source exhaustion and vanishing clips', () => {
    const gap: EditorTimeline = { version: 1, tracks: [{ id: 'v1', kind: 'video', clips: [clip('a', 0, 2), clip('b', 5, 2)] }] }
    expect(() => rollEdit(gap, 'v1', 'a', 'b', 1)).toThrow(TimelineOpError)
    // left source has 5s total; trimStart 0, speed 1 → max duration 5; delta 2 needs 6
    expect(() => rollEdit(rollTimeline(), 'v1', 'a', 'b', 2)).toThrow(TimelineOpError)
    // right trimStart 2 with speed 2 → rolling left past -1s rewinds below source start
    expect(() => rollEdit(rollTimeline(), 'v1', 'a', 'b', -1.5)).toThrow(TimelineOpError)
    expect(() => rollEdit(rollTimeline(), 'v1', 'a', 'b', 3)).toThrow(TimelineOpError)
    expect(() => rollEdit(rollTimeline(), 'v1', 'a', 'b', -4)).toThrow(TimelineOpError)
  })
})

describe('slipClip', () => {
  it('slips the source window without moving the clip', () => {
    const timeline: EditorTimeline = {
      version: 1,
      tracks: [{
        id: 'v1',
        kind: 'video',
        clips: [clip('a', 3, 4, { trimStart: 2, speed: 2, media: { type: 'upload', fileId: 'file-a', url: 'https://x.test/a.mp4', mediaKind: 'video', sourceDuration: 20 } })],
      }],
    }
    const next = slipClip(timeline, 'v1', 'a', 1.5)
    expect(next.tracks[0].clips[0]).toMatchObject({ timelineStart: 3, duration: 4, trimStart: 5 })
  })

  it('rejects slips past the source bounds and slips on text clips', () => {
    const timeline: EditorTimeline = {
      version: 1,
      tracks: [{
        id: 'v1',
        kind: 'video',
        clips: [clip('a', 0, 4, { trimStart: 1, media: { type: 'upload', fileId: 'file-a', url: 'https://x.test/a.mp4', mediaKind: 'video', sourceDuration: 6 } })],
      }],
    }
    expect(() => slipClip(timeline, 'v1', 'a', -2)).toThrow(TimelineOpError)   // trimStart -1
    expect(() => slipClip(timeline, 'v1', 'a', 2)).toThrow(TimelineOpError)    // 3 + 4 > 6
    const text: EditorTimeline = {
      version: 1,
      tracks: [{ id: 't1', kind: 'text', clips: [{ id: 'x', timelineStart: 0, duration: 2, text: { content: 'Hi', fontSizePx: 48, color: '#fff', align: 'center', animationPreset: 'none' } }] }],
    }
    expect(() => slipClip(text, 't1', 'x', 1)).toThrow(TimelineOpError)
  })
})
```

- [ ] **Step 5.2: Run tests to verify they fail**

Run: `npx jest __tests__/lib/video-editor-timeline-ops.test.ts --silent`
Expected: FAIL — `rollEdit` not exported.

- [ ] **Step 5.3: Implement** — append to `lib/video-editor/timeline-ops.ts`:

```ts
export function rollEdit(
  timeline: EditorTimeline,
  trackId: string,
  leftClipId: string,
  rightClipId: string,
  deltaSeconds: number,
): EditorTimeline {
  const next = cloneTimeline(timeline)
  const track = findTrack(next, trackId)
  const left = findClip(track, leftClipId)
  const right = findClip(track, rightClipId)
  if (Math.abs((left.timelineStart + left.duration) - right.timelineStart) > EPSILON) {
    throw new TimelineOpError('Roll edits need two adjacent clips.')
  }
  const leftSpeed = left.speed && left.speed > 0 ? left.speed : 1
  const rightSpeed = right.speed && right.speed > 0 ? right.speed : 1
  const leftDuration = left.duration + deltaSeconds
  const rightDuration = right.duration - deltaSeconds
  const rightTrimStart = (right.trimStart ?? 0) + deltaSeconds * rightSpeed
  if (!(leftDuration > EPSILON) || !(rightDuration > EPSILON)) {
    throw new TimelineOpError('Roll would remove one of the clips.')
  }
  if (rightTrimStart < -EPSILON) throw new TimelineOpError('Roll would rewind the right clip before its source start.')
  const leftSourceDuration = left.media?.sourceDuration
  if (typeof leftSourceDuration === 'number'
    && (left.trimStart ?? 0) + leftDuration * leftSpeed > leftSourceDuration + EPSILON) {
    throw new TimelineOpError('Roll would run past the end of the left clip\'s source media.')
  }
  left.duration = round3(leftDuration)
  right.timelineStart = round3(right.timelineStart + deltaSeconds)
  right.duration = round3(rightDuration)
  right.trimStart = round3(Math.max(0, rightTrimStart))
  assertNoOverlap(track)
  return next
}

export function slipClip(
  timeline: EditorTimeline,
  trackId: string,
  clipId: string,
  deltaSeconds: number,
): EditorTimeline {
  const next = cloneTimeline(timeline)
  const track = findTrack(next, trackId)
  const clip = findClip(track, clipId)
  if (!clip.media) throw new TimelineOpError('Only media clips can be slipped.')
  const speed = clip.speed && clip.speed > 0 ? clip.speed : 1
  const trimStart = (clip.trimStart ?? 0) + deltaSeconds * speed
  if (trimStart < -EPSILON) throw new TimelineOpError('Slip would rewind before the source start.')
  const sourceDuration = clip.media.sourceDuration
  if (typeof sourceDuration === 'number' && trimStart + clip.duration * speed > sourceDuration + EPSILON) {
    throw new TimelineOpError('Slip would run past the end of the source media.')
  }
  clip.trimStart = round3(Math.max(0, trimStart))
  return next
}
```

- [ ] **Step 5.4: Run tests to verify they pass**

Run: `npx jest __tests__/lib/video-editor-timeline-ops.test.ts --silent`
Expected: PASS (all describe blocks including P1's originals).

- [ ] **Step 5.5: Commit**

```bash
git add lib/video-editor/timeline-ops.ts __tests__/lib/video-editor-timeline-ops.test.ts
git commit -m "feat(video-editor): roll and slip pure edits"
```

---

## Task 6: `lib/video-editor/keyframes.ts` — interpolation + easing

**Files:**
- Create: `lib/video-editor/keyframes.ts`
- Test: `__tests__/lib/video-editor-keyframes.test.ts`

**Conventions locked here (used by Inspector, Preview, and mirrored in the executor):**
- `atSeconds` is clip-relative OUTPUT time (0 = the clip's first frame on the timeline).
- The `easing`/`bezier` stored on a keyframe shapes the segment that STARTS at that keyframe.
- Before the first keyframe → first value. After the last → last value. No keyframes → fallback.

- [ ] **Step 6.1: Write the failing tests** — create `__tests__/lib/video-editor-keyframes.test.ts`:

```ts
import {
  EASE_BEZIER,
  clipTransformAt,
  clipVolumeAt,
  cubicBezierProgress,
  interpolateKeyframes,
  keyframesForProperty,
} from '@/lib/video-editor/keyframes'
import type { EditorClip, EditorKeyframe } from '@/lib/video-editor/types'

const kf = (atSeconds: number, value: number, extra: Partial<EditorKeyframe> = {}): EditorKeyframe =>
  ({ property: 'transform.opacity', atSeconds, value, ...extra })

describe('cubicBezierProgress', () => {
  it('hits the endpoints exactly and clamps x', () => {
    expect(cubicBezierProgress(0.42, 0, 1, 1, 0)).toBe(0)
    expect(cubicBezierProgress(0.42, 0, 1, 1, 1)).toBe(1)
    expect(cubicBezierProgress(0.42, 0, 1, 1, -0.5)).toBe(0)
    expect(cubicBezierProgress(0.42, 0, 1, 1, 1.5)).toBe(1)
  })

  it('is linear for the identity curve and slow-starting for ease_in', () => {
    expect(cubicBezierProgress(0, 0, 1, 1, 0.25)).toBeCloseTo(0.25, 5)
    expect(cubicBezierProgress(...EASE_BEZIER.ease_in, 0.25)).toBeLessThan(0.25)
    expect(cubicBezierProgress(...EASE_BEZIER.ease_out, 0.25)).toBeGreaterThan(0.25)
  })
})

describe('interpolateKeyframes', () => {
  const frames = [kf(1, 10), kf(3, 30, { easing: 'linear' })]

  it('returns fallback with no keyframes and clamps outside the range', () => {
    expect(interpolateKeyframes(undefined, 'transform.opacity', 2, 0.7)).toBe(0.7)
    expect(interpolateKeyframes(frames, 'transform.opacity', 0, 99)).toBe(10)
    expect(interpolateKeyframes(frames, 'transform.opacity', 9, 99)).toBe(30)
  })

  it('interpolates linearly and honors easing + custom bezier', () => {
    expect(interpolateKeyframes(frames, 'transform.opacity', 2, 0)).toBeCloseTo(20, 5)
    const eased = [kf(0, 0, { easing: 'ease_in' }), kf(2, 100)]
    expect(interpolateKeyframes(eased, 'transform.opacity', 1, 0)).toBeLessThan(50)
    const bez = [kf(0, 0, { easing: 'bezier', bezier: [0, 0, 1, 1] }), kf(2, 100)]
    expect(interpolateKeyframes(bez, 'transform.opacity', 1, 0)).toBeCloseTo(50, 5)
  })

  it('only reads keyframes for the requested property, sorted', () => {
    const mixed = [kf(2, 5), { property: 'volume', atSeconds: 2, value: 0 } as EditorKeyframe, kf(0, 1)]
    expect(keyframesForProperty(mixed, 'transform.opacity').map((k) => k.atSeconds)).toEqual([0, 2])
    expect(interpolateKeyframes(mixed, 'volume', 2, 1)).toBe(0)
  })
})

describe('clip helpers', () => {
  const clip: EditorClip = {
    id: 'c',
    timelineStart: 5,
    duration: 4,
    volume: 0.8,
    transform: { x: 100, y: 0, scale: 1, rotation: 0, opacity: 1 },
    keyframes: [
      { property: 'transform.x', atSeconds: 0, value: 0 },
      { property: 'transform.x', atSeconds: 4, value: 200 },
      { property: 'volume', atSeconds: 0, value: 0 },
      { property: 'volume', atSeconds: 2, value: 0.8 },
    ],
  }

  it('merges keyframed values over the static transform', () => {
    expect(clipTransformAt(clip, 2)).toEqual({ x: 100, y: 0, scale: 1, rotation: 0, opacity: 1 })
    // transform.x keyframes override the static x
    expect(clipTransformAt(clip, 2).x).toBe(100) // (0 -> 200 at t=2) = 100
    expect(clipTransformAt(clip, 0).x).toBe(0)
  })

  it('interpolates volume with clip.volume fallback', () => {
    expect(clipVolumeAt(clip, 1)).toBeCloseTo(0.4, 5)
    expect(clipVolumeAt({ id: 'p', timelineStart: 0, duration: 1 }, 0.5)).toBe(1)
    expect(clipVolumeAt({ id: 'p', timelineStart: 0, duration: 1, volume: 0.3 }, 0.5)).toBe(0.3)
  })
})
```

- [ ] **Step 6.2: Run tests to verify they fail**

Run: `npx jest __tests__/lib/video-editor-keyframes.test.ts --silent`
Expected: FAIL — module not found.

- [ ] **Step 6.3: Implement** — create `lib/video-editor/keyframes.ts`:

```ts
import type { EditorClip, EditorClipTransform, EditorKeyframe, EditorKeyframeProperty } from './types'

/** cubic-bezier control points for the named ease presets (CSS-equivalent). */
export const EASE_BEZIER: Record<'linear' | 'ease_in' | 'ease_out' | 'ease_in_out', [number, number, number, number]> = {
  linear: [0, 0, 1, 1],
  ease_in: [0.42, 0, 1, 1],
  ease_out: [0, 0, 0.58, 1],
  ease_in_out: [0.42, 0, 0.58, 1],
}

function bezierAxis(p1: number, p2: number, u: number): number {
  const inv = 1 - u
  return 3 * inv * inv * u * p1 + 3 * inv * u * u * p2 + u * u * u
}

/**
 * Solve y for a given x on cubic-bezier((p1x,p1y),(p2x,p2y)) with endpoints
 * (0,0)→(1,1). Newton first, bisection fallback — matches CSS timing curves.
 */
export function cubicBezierProgress(p1x: number, p1y: number, p2x: number, p2y: number, x: number): number {
  if (x <= 0) return 0
  if (x >= 1) return 1
  let u = x
  for (let i = 0; i < 8; i += 1) {
    const currentX = bezierAxis(p1x, p2x, u) - x
    if (Math.abs(currentX) < 1e-7) return bezierAxis(p1y, p2y, u)
    const dx = 3 * (1 - u) * (1 - u) * p1x + 6 * (1 - u) * u * (p2x - p1x) + 3 * u * u * (1 - p2x)
    if (Math.abs(dx) < 1e-7) break
    u -= currentX / dx
    u = Math.min(Math.max(u, 0), 1)
  }
  let lo = 0
  let hi = 1
  for (let i = 0; i < 32; i += 1) {
    u = (lo + hi) / 2
    if (bezierAxis(p1x, p2x, u) < x) lo = u
    else hi = u
  }
  return bezierAxis(p1y, p2y, (lo + hi) / 2)
}

export function easeProgress(keyframe: EditorKeyframe, progress: number): number {
  const easing = keyframe.easing ?? 'linear'
  if (easing === 'linear') return progress
  if (easing === 'bezier') {
    const [p1x, p1y, p2x, p2y] = keyframe.bezier ?? EASE_BEZIER.linear
    return cubicBezierProgress(p1x, p1y, p2x, p2y, progress)
  }
  const [p1x, p1y, p2x, p2y] = EASE_BEZIER[easing]
  return cubicBezierProgress(p1x, p1y, p2x, p2y, progress)
}

export function keyframesForProperty(
  keyframes: EditorKeyframe[] | undefined,
  property: EditorKeyframeProperty,
): EditorKeyframe[] {
  return (keyframes ?? [])
    .filter((keyframe) => keyframe.property === property)
    .sort((a, b) => a.atSeconds - b.atSeconds)
}

export function interpolateKeyframes(
  keyframes: EditorKeyframe[] | undefined,
  property: EditorKeyframeProperty,
  atSeconds: number,
  fallback: number,
): number {
  const frames = keyframesForProperty(keyframes, property)
  if (!frames.length) return fallback
  if (atSeconds <= frames[0].atSeconds) return frames[0].value
  const last = frames[frames.length - 1]
  if (atSeconds >= last.atSeconds) return last.value
  for (let i = 0; i < frames.length - 1; i += 1) {
    const from = frames[i]
    const to = frames[i + 1]
    if (atSeconds >= from.atSeconds && atSeconds <= to.atSeconds) {
      const span = to.atSeconds - from.atSeconds
      if (span <= 0) return to.value
      const progress = easeProgress(from, (atSeconds - from.atSeconds) / span)
      return from.value + (to.value - from.value) * progress
    }
  }
  return last.value
}

const DEFAULT_TRANSFORM: EditorClipTransform = { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 }

/** Effective transform at a clip-relative time: static transform + keyframe overrides. */
export function clipTransformAt(clip: EditorClip, clipSeconds: number): EditorClipTransform {
  const base = clip.transform ?? DEFAULT_TRANSFORM
  return {
    x: interpolateKeyframes(clip.keyframes, 'transform.x', clipSeconds, base.x),
    y: interpolateKeyframes(clip.keyframes, 'transform.y', clipSeconds, base.y),
    scale: interpolateKeyframes(clip.keyframes, 'transform.scale', clipSeconds, base.scale),
    rotation: interpolateKeyframes(clip.keyframes, 'transform.rotation', clipSeconds, base.rotation),
    opacity: interpolateKeyframes(clip.keyframes, 'transform.opacity', clipSeconds, base.opacity),
  }
}

export function clipVolumeAt(clip: EditorClip, clipSeconds: number): number {
  return interpolateKeyframes(clip.keyframes, 'volume', clipSeconds, clip.volume ?? 1)
}
```

- [ ] **Step 6.4: Run tests to verify they pass**

Run: `npx jest __tests__/lib/video-editor-keyframes.test.ts --silent`
Expected: PASS.

- [ ] **Step 6.5: Commit**

```bash
git add lib/video-editor/keyframes.ts __tests__/lib/video-editor-keyframes.test.ts
git commit -m "feat(video-editor): keyframe interpolation with ease presets and bezier curves"
```

---

## Task 7: `lib/video-editor/speed-ramps.ts` — presets + ramp math

**Files:**
- Create: `lib/video-editor/speed-ramps.ts`
- Test: `__tests__/lib/video-editor-speed-ramps.test.ts`

**Conventions:** speed keyframes are defined over clip-relative OUTPUT time; a ramp changes how much SOURCE the clip consumes, never the clip's timeline duration (so credits are unaffected). `rampSegments` approximates the ramp as piecewise constant-speed slices: 1 slice when a segment's endpoint speeds are equal, otherwise `subdivisions` slices whose speed is sampled at each slice's output-time midpoint (midpoint rule — exact for linear segments).

- [ ] **Step 7.1: Write the failing tests** — create `__tests__/lib/video-editor-speed-ramps.test.ts`:

```ts
import {
  SPEED_RAMP_PRESETS,
  hasSpeedRamp,
  rampSegments,
  sourceOffsetAt,
  speedAt,
} from '@/lib/video-editor/speed-ramps'
import { SPEED_RAMP_PRESET_IDS } from '@/lib/video-editor/types'
import type { EditorClip } from '@/lib/video-editor/types'

const rampClip = (extra: Partial<EditorClip> = {}): EditorClip => ({
  id: 'c',
  timelineStart: 0,
  duration: 4,
  media: { type: 'upload', fileId: 'f', url: 'https://x.test/a.mp4', mediaKind: 'video' },
  keyframes: [
    { property: 'speed', atSeconds: 0, value: 1 },
    { property: 'speed', atSeconds: 4, value: 2 },
  ],
  ...extra,
})

describe('speedAt / hasSpeedRamp', () => {
  it('falls back to clip.speed then 1 without speed keyframes', () => {
    expect(hasSpeedRamp({ id: 'p', timelineStart: 0, duration: 2 })).toBe(false)
    expect(speedAt({ id: 'p', timelineStart: 0, duration: 2, speed: 1.5 }, 1)).toBe(1.5)
    expect(speedAt({ id: 'p', timelineStart: 0, duration: 2 }, 1)).toBe(1)
    expect(hasSpeedRamp(rampClip())).toBe(true)
    expect(speedAt(rampClip(), 2)).toBeCloseTo(1.5, 5)
  })
})

describe('sourceOffsetAt', () => {
  it('integrates the ramp: linear 1→2 over 4s consumes 6s of source', () => {
    expect(sourceOffsetAt(rampClip(), 0)).toBeCloseTo(0, 5)
    expect(sourceOffsetAt(rampClip(), 4)).toBeCloseTo(6, 3)
    expect(sourceOffsetAt(rampClip(), 2)).toBeCloseTo(2.5, 3) // ∫0..2 (1+t/4) dt
  })

  it('is just speed × time for constant-speed clips', () => {
    expect(sourceOffsetAt({ id: 'p', timelineStart: 0, duration: 4, speed: 2 }, 3)).toBe(6)
  })
})

describe('rampSegments', () => {
  it('returns one segment for constant speed', () => {
    expect(rampSegments({ id: 'p', timelineStart: 0, duration: 4, speed: 2 })).toEqual([
      { outputStart: 0, outputDuration: 4, sourceStart: 0, sourceDuration: 8, speed: 2 },
    ])
  })

  it('subdivides ramped intervals with midpoint speeds that integrate exactly for linear ramps', () => {
    const segments = rampSegments(rampClip(), 4)
    expect(segments).toHaveLength(4)
    expect(segments.map((s) => s.speed)).toEqual([1.125, 1.375, 1.625, 1.875])
    expect(segments.reduce((sum, s) => sum + s.outputDuration, 0)).toBeCloseTo(4, 5)
    expect(segments.reduce((sum, s) => sum + s.sourceDuration, 0)).toBeCloseTo(6, 3)
    // sourceStart is cumulative
    expect(segments[1].sourceStart).toBeCloseTo(segments[0].sourceDuration, 5)
  })
})

describe('SPEED_RAMP_PRESETS', () => {
  it('builds sorted, clamped speed keyframes for every preset id', () => {
    for (const id of SPEED_RAMP_PRESET_IDS) {
      const frames = SPEED_RAMP_PRESETS[id].build(10)
      expect(frames.length).toBeGreaterThanOrEqual(2)
      expect(frames.every((f) => f.property === 'speed' && f.value >= 0.25 && f.value <= 4)).toBe(true)
      expect(frames[0].atSeconds).toBe(0)
      expect(frames[frames.length - 1].atSeconds).toBe(10)
      const times = frames.map((f) => f.atSeconds)
      expect([...times].sort((a, b) => a - b)).toEqual(times)
    }
    expect(SPEED_RAMP_PRESETS.hero_time.build(10).some((f) => f.value < 1)).toBe(true) // slow-mo core
    expect(SPEED_RAMP_PRESETS.flash_in.build(10)[0].value).toBeGreaterThan(1)
  })
})
```

- [ ] **Step 7.2: Run tests to verify they fail**

Run: `npx jest __tests__/lib/video-editor-speed-ramps.test.ts --silent`
Expected: FAIL — module not found.

- [ ] **Step 7.3: Implement** — create `lib/video-editor/speed-ramps.ts`:

```ts
import { interpolateKeyframes, keyframesForProperty } from './keyframes'
import type { EditorClip, EditorKeyframe, SpeedRampPresetId } from './types'

export interface RampSegment {
  /** Clip-relative output start (seconds). */
  outputStart: number
  outputDuration: number
  /** Source offset relative to the clip's trimStart. */
  sourceStart: number
  sourceDuration: number
  speed: number
}

export function hasSpeedRamp(clip: EditorClip): boolean {
  return keyframesForProperty(clip.keyframes, 'speed').length > 0
}

export function speedAt(clip: EditorClip, clipSeconds: number): number {
  const fallback = clip.speed && clip.speed > 0 ? clip.speed : 1
  const value = interpolateKeyframes(clip.keyframes, 'speed', clipSeconds, fallback)
  return Math.min(Math.max(value, 0.25), 4)
}

const round3 = (value: number): number => Math.round(value * 1000) / 1000

export function rampSegments(clip: EditorClip, subdivisions = 4): RampSegment[] {
  const duration = clip.duration
  if (!hasSpeedRamp(clip)) {
    const speed = clip.speed && clip.speed > 0 ? clip.speed : 1
    return [{ outputStart: 0, outputDuration: duration, sourceStart: 0, sourceDuration: round3(duration * speed), speed }]
  }
  const frames = keyframesForProperty(clip.keyframes, 'speed')
  const boundaries = [0, ...frames.map((frame) => frame.atSeconds).filter((t) => t > 0 && t < duration), duration]
    .filter((t, index, all) => index === 0 || t - all[index - 1] > 0.0005)
  const segments: RampSegment[] = []
  let sourceCursor = 0
  for (let i = 0; i < boundaries.length - 1; i += 1) {
    const from = boundaries[i]
    const to = boundaries[i + 1]
    const flat = Math.abs(speedAt(clip, from) - speedAt(clip, to)) < 0.0005
    const slices = flat ? 1 : Math.max(1, subdivisions)
    const sliceDuration = (to - from) / slices
    for (let s = 0; s < slices; s += 1) {
      const outputStart = from + s * sliceDuration
      const speed = speedAt(clip, outputStart + sliceDuration / 2)
      const sourceDuration = sliceDuration * speed
      segments.push({
        outputStart: round3(outputStart),
        outputDuration: round3(sliceDuration),
        sourceStart: round3(sourceCursor),
        sourceDuration: round3(sourceDuration),
        speed: round3(speed),
      })
      sourceCursor += sourceDuration
    }
  }
  return segments
}

/** Source seconds consumed after `clipSeconds` of output — ∫ speed dt via the same segmentation. */
export function sourceOffsetAt(clip: EditorClip, clipSeconds: number): number {
  if (!hasSpeedRamp(clip)) {
    const speed = clip.speed && clip.speed > 0 ? clip.speed : 1
    return clipSeconds * speed
  }
  const target = Math.min(Math.max(clipSeconds, 0), clip.duration)
  let total = 0
  for (const segment of rampSegments(clip, 16)) {
    if (segment.outputStart >= target) break
    const covered = Math.min(segment.outputDuration, target - segment.outputStart)
    total += covered * segment.speed
  }
  return total
}

export const SPEED_RAMP_PRESETS: Record<SpeedRampPresetId, {
  label: string
  description: string
  build: (durationSeconds: number) => EditorKeyframe[]
}> = {
  montage: {
    label: 'Montage',
    description: 'Speeds up through the middle, settles back for the ending.',
    build: (d) => [
      { property: 'speed', atSeconds: 0, value: 1, easing: 'ease_in_out' },
      { property: 'speed', atSeconds: round3(d * 0.5), value: 2.5, easing: 'ease_in_out' },
      { property: 'speed', atSeconds: d, value: 1 },
    ],
  },
  hero_time: {
    label: 'Hero Time',
    description: 'Dramatic slow-motion core with normal-speed bookends.',
    build: (d) => [
      { property: 'speed', atSeconds: 0, value: 1, easing: 'ease_out' },
      { property: 'speed', atSeconds: round3(d * 0.35), value: 0.3, easing: 'linear' },
      { property: 'speed', atSeconds: round3(d * 0.65), value: 0.3, easing: 'ease_in' },
      { property: 'speed', atSeconds: d, value: 1 },
    ],
  },
  flash_in: {
    label: 'Flash In',
    description: 'Blazes in fast, relaxes to real time.',
    build: (d) => [
      { property: 'speed', atSeconds: 0, value: 3, easing: 'ease_out' },
      { property: 'speed', atSeconds: round3(d * 0.3), value: 1, easing: 'linear' },
      { property: 'speed', atSeconds: d, value: 1 },
    ],
  },
  flash_out: {
    label: 'Flash Out',
    description: 'Real time, then accelerates out of the shot.',
    build: (d) => [
      { property: 'speed', atSeconds: 0, value: 1, easing: 'linear' },
      { property: 'speed', atSeconds: round3(d * 0.7), value: 1, easing: 'ease_in' },
      { property: 'speed', atSeconds: d, value: 3 },
    ],
  },
  bullet: {
    label: 'Bullet',
    description: 'Snaps into a near-freeze at the midpoint, then snaps out.',
    build: (d) => [
      { property: 'speed', atSeconds: 0, value: 1, easing: 'linear' },
      { property: 'speed', atSeconds: round3(d * 0.4), value: 1, easing: 'ease_out' },
      { property: 'speed', atSeconds: round3(d * 0.45), value: 0.25, easing: 'linear' },
      { property: 'speed', atSeconds: round3(d * 0.55), value: 0.25, easing: 'ease_in' },
      { property: 'speed', atSeconds: round3(d * 0.6), value: 1, easing: 'linear' },
      { property: 'speed', atSeconds: d, value: 1 },
    ],
  },
}
```

- [ ] **Step 7.4: Run tests to verify they pass**

Run: `npx jest __tests__/lib/video-editor-speed-ramps.test.ts --silent`
Expected: PASS.

- [ ] **Step 7.5: Commit**

```bash
git add lib/video-editor/speed-ramps.ts __tests__/lib/video-editor-speed-ramps.test.ts
git commit -m "feat(video-editor): speed ramp math and CapCut-style presets"
```

---

## Task 8: Executor math mirror — `editor-keyframes.mjs` + parity test

**Files:**
- Create: `scripts/higgsfield-executor/lib/editor-keyframes.mjs`
- Test: `__tests__/scripts/editor-keyframes-mjs.test.ts`
- Test: `__tests__/lib/video-editor-keyframe-parity.test.ts`

The executor cannot import the TS lib, so the math is mirrored in Node ESM and pinned to the TS implementation by a parity test. This module also owns the ffmpeg **expression builders** used by Task 9.

- [ ] **Step 8.1: Write the failing golden tests** — create `__tests__/scripts/editor-keyframes-mjs.test.ts` (uses the same `runModule` pattern as `editor-filtergraph.test.ts`):

```ts
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'

const modulePath = join(process.cwd(), 'scripts/higgsfield-executor/lib/editor-keyframes.mjs')

function runModule<T>(code: string): T {
  const stdout = execFileSync(process.execPath, ['--input-type=module', '-e', `
    import * as m from ${JSON.stringify(`file://${modulePath}`)};
    const result = await (async () => { ${code} })();
    process.stdout.write(JSON.stringify(result));
  `], { encoding: 'utf8' })
  return JSON.parse(stdout) as T
}

describe('keyframeExpr', () => {
  it('builds a piecewise-linear ffmpeg expression for linear keyframes', () => {
    const expr = runModule<string>(`return m.keyframeExpr(${JSON.stringify([
      { property: 'volume', atSeconds: 0, value: 1 },
      { property: 'volume', atSeconds: 2, value: 0 },
    ])}, 1, 't')`)
    expect(expr).toBe('if(lt(t,0),1,if(lt(t,2),1+(0-1)*(t-0)/2,0))')
  })

  it('pre-samples eased segments into 8 linear sub-segments', () => {
    const expr = runModule<string>(`return m.keyframeExpr(${JSON.stringify([
      { property: 'transform.x', atSeconds: 0, value: 0, easing: 'ease_in' },
      { property: 'transform.x', atSeconds: 4, value: 100 },
    ])}, 0, '(t-3)')`)
    // 8 sub-segments → 9 breakpoints → 8 nested lerps + 1 before-first guard
    expect(expr.match(/if\(lt\(/g)?.length).toBe(9)
    expect(expr).toContain('(t-3)')
    expect(expr).toMatch(/,100\)+$/) // constant after the last breakpoint
  })

  it('returns a constant for a single keyframe', () => {
    expect(runModule<string>(`return m.keyframeExpr(${JSON.stringify([
      { property: 'volume', atSeconds: 1, value: 0.5 },
    ])}, 1, 't')`)).toBe('0.5')
  })
})

describe('sendcmdOpacityCommands', () => {
  it('samples opacity keyframes every 0.25s with deduped values', () => {
    const commands = runModule<string>(`return m.sendcmdOpacityCommands(${JSON.stringify([
      { property: 'transform.opacity', atSeconds: 0, value: 1 },
      { property: 'transform.opacity', atSeconds: 1, value: 0 },
    ])}, 1, 'op0', 2, 0.25)`)
    expect(commands).toBe([
      '0 colorchannelmixer@op0 aa 1',
      '0.25 colorchannelmixer@op0 aa 0.75',
      '0.5 colorchannelmixer@op0 aa 0.5',
      '0.75 colorchannelmixer@op0 aa 0.25',
      '1 colorchannelmixer@op0 aa 0',
    ].join(';'))
  })
})

describe('rampSegments (mjs)', () => {
  it('matches the TS segmentation for a linear ramp', () => {
    const segments = runModule<Array<{ speed: number; sourceDuration: number }>>(`return m.rampSegments(${JSON.stringify({
      id: 'c', timelineStart: 0, duration: 4,
      keyframes: [
        { property: 'speed', atSeconds: 0, value: 1 },
        { property: 'speed', atSeconds: 4, value: 2 },
      ],
    })}, 4)`)
    expect(segments.map((s) => s.speed)).toEqual([1.125, 1.375, 1.625, 1.875])
  })
})
```

- [ ] **Step 8.2: Write the failing parity test** — create `__tests__/lib/video-editor-keyframe-parity.test.ts`:

```ts
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { interpolateKeyframes } from '@/lib/video-editor/keyframes'
import { rampSegments, sourceOffsetAt } from '@/lib/video-editor/speed-ramps'
import type { EditorClip, EditorKeyframe } from '@/lib/video-editor/types'

const modulePath = join(process.cwd(), 'scripts/higgsfield-executor/lib/editor-keyframes.mjs')

function runModule<T>(code: string): T {
  const stdout = execFileSync(process.execPath, ['--input-type=module', '-e', `
    import * as m from ${JSON.stringify(`file://${modulePath}`)};
    const result = await (async () => { ${code} })();
    process.stdout.write(JSON.stringify(result));
  `], { encoding: 'utf8' })
  return JSON.parse(stdout) as T
}

const opacityFrames: EditorKeyframe[] = [
  { property: 'transform.opacity', atSeconds: 0, value: 1, easing: 'ease_in_out' },
  { property: 'transform.opacity', atSeconds: 2, value: 0.2, easing: 'bezier', bezier: [0.3, 0, 0.7, 1] },
  { property: 'transform.opacity', atSeconds: 5, value: 0.9 },
]

const rampedClip: EditorClip = {
  id: 'c',
  timelineStart: 0,
  duration: 6,
  keyframes: [
    { property: 'speed', atSeconds: 0, value: 1, easing: 'ease_out' },
    { property: 'speed', atSeconds: 2, value: 0.3, easing: 'linear' },
    { property: 'speed', atSeconds: 4, value: 0.3, easing: 'ease_in' },
    { property: 'speed', atSeconds: 6, value: 1 },
  ],
}

describe('TS ↔ executor mjs parity', () => {
  it('interpolates identical values at 25 sample points', () => {
    const times = Array.from({ length: 25 }, (_, i) => i * 0.25)
    const mjs = runModule<number[]>(`return ${JSON.stringify(times)}.map((t) => m.interpolateKeyframes(${JSON.stringify(opacityFrames)}, 'transform.opacity', t, 1))`)
    times.forEach((t, i) => {
      expect(mjs[i]).toBeCloseTo(interpolateKeyframes(opacityFrames, 'transform.opacity', t, 1), 6)
    })
  })

  it('produces identical ramp segments and source offsets', () => {
    const mjsSegments = runModule<ReturnType<typeof rampSegments>>(`return m.rampSegments(${JSON.stringify(rampedClip)}, 4)`)
    expect(mjsSegments).toEqual(rampSegments(rampedClip, 4))
    const mjsOffset = runModule<number>(`return m.sourceOffsetAt(${JSON.stringify(rampedClip)}, 5)`)
    expect(mjsOffset).toBeCloseTo(sourceOffsetAt(rampedClip, 5), 6)
  })
})
```

- [ ] **Step 8.3: Run tests to verify they fail**

Run: `npx jest __tests__/scripts/editor-keyframes-mjs.test.ts __tests__/lib/video-editor-keyframe-parity.test.ts --silent`
Expected: FAIL — `editor-keyframes.mjs` does not exist.

- [ ] **Step 8.4: Implement** — create `scripts/higgsfield-executor/lib/editor-keyframes.mjs`:

```js
// Executor-side mirror of lib/video-editor/keyframes.ts + speed-ramps.ts.
// Kept in exact numeric lockstep by __tests__/lib/video-editor-keyframe-parity.test.ts —
// if you change one side, change the other and re-run the parity test.
import { fmt } from './editor-filtergraph.mjs'

export const EASE_BEZIER = {
  linear: [0, 0, 1, 1],
  ease_in: [0.42, 0, 1, 1],
  ease_out: [0, 0, 0.58, 1],
  ease_in_out: [0.42, 0, 0.58, 1],
}

function bezierAxis(p1, p2, u) {
  const inv = 1 - u
  return 3 * inv * inv * u * p1 + 3 * inv * u * u * p2 + u * u * u
}

export function cubicBezierProgress(p1x, p1y, p2x, p2y, x) {
  if (x <= 0) return 0
  if (x >= 1) return 1
  let u = x
  for (let i = 0; i < 8; i += 1) {
    const currentX = bezierAxis(p1x, p2x, u) - x
    if (Math.abs(currentX) < 1e-7) return bezierAxis(p1y, p2y, u)
    const dx = 3 * (1 - u) * (1 - u) * p1x + 6 * (1 - u) * u * (p2x - p1x) + 3 * u * u * (1 - p2x)
    if (Math.abs(dx) < 1e-7) break
    u -= currentX / dx
    u = Math.min(Math.max(u, 0), 1)
  }
  let lo = 0
  let hi = 1
  for (let i = 0; i < 32; i += 1) {
    u = (lo + hi) / 2
    if (bezierAxis(p1x, p2x, u) < x) lo = u
    else hi = u
  }
  return bezierAxis(p1y, p2y, (lo + hi) / 2)
}

export function easeProgress(keyframe, progress) {
  const easing = keyframe.easing ?? 'linear'
  if (easing === 'linear') return progress
  const points = easing === 'bezier' ? (keyframe.bezier ?? EASE_BEZIER.linear) : EASE_BEZIER[easing]
  if (!points) return progress
  return cubicBezierProgress(points[0], points[1], points[2], points[3], progress)
}

export function keyframesForProperty(keyframes, property) {
  return (keyframes ?? [])
    .filter((keyframe) => keyframe.property === property)
    .sort((a, b) => a.atSeconds - b.atSeconds)
}

export function interpolateKeyframes(keyframes, property, atSeconds, fallback) {
  const frames = keyframesForProperty(keyframes, property)
  if (!frames.length) return fallback
  if (atSeconds <= frames[0].atSeconds) return frames[0].value
  const last = frames[frames.length - 1]
  if (atSeconds >= last.atSeconds) return last.value
  for (let i = 0; i < frames.length - 1; i += 1) {
    const from = frames[i]
    const to = frames[i + 1]
    if (atSeconds >= from.atSeconds && atSeconds <= to.atSeconds) {
      const span = to.atSeconds - from.atSeconds
      if (span <= 0) return to.value
      const progress = easeProgress(from, (atSeconds - from.atSeconds) / span)
      return from.value + (to.value - from.value) * progress
    }
  }
  return last.value
}

const round3 = (value) => Math.round(value * 1000) / 1000

export function hasSpeedRamp(clip) {
  return keyframesForProperty(clip.keyframes, 'speed').length > 0
}

export function speedAt(clip, clipSeconds) {
  const fallback = clip.speed && clip.speed > 0 ? clip.speed : 1
  const value = interpolateKeyframes(clip.keyframes, 'speed', clipSeconds, fallback)
  return Math.min(Math.max(value, 0.25), 4)
}

export function rampSegments(clip, subdivisions = 4) {
  const duration = clip.duration
  if (!hasSpeedRamp(clip)) {
    const speed = clip.speed && clip.speed > 0 ? clip.speed : 1
    return [{ outputStart: 0, outputDuration: duration, sourceStart: 0, sourceDuration: round3(duration * speed), speed }]
  }
  const frames = keyframesForProperty(clip.keyframes, 'speed')
  const boundaries = [0, ...frames.map((frame) => frame.atSeconds).filter((t) => t > 0 && t < duration), duration]
    .filter((t, index, all) => index === 0 || t - all[index - 1] > 0.0005)
  const segments = []
  let sourceCursor = 0
  for (let i = 0; i < boundaries.length - 1; i += 1) {
    const from = boundaries[i]
    const to = boundaries[i + 1]
    const flat = Math.abs(speedAt(clip, from) - speedAt(clip, to)) < 0.0005
    const slices = flat ? 1 : Math.max(1, subdivisions)
    const sliceDuration = (to - from) / slices
    for (let s = 0; s < slices; s += 1) {
      const outputStart = from + s * sliceDuration
      const speed = speedAt(clip, outputStart + sliceDuration / 2)
      const sourceDuration = sliceDuration * speed
      segments.push({
        outputStart: round3(outputStart),
        outputDuration: round3(sliceDuration),
        sourceStart: round3(sourceCursor),
        sourceDuration: round3(sourceDuration),
        speed: round3(speed),
      })
      sourceCursor += sourceDuration
    }
  }
  return segments
}

export function sourceOffsetAt(clip, clipSeconds) {
  if (!hasSpeedRamp(clip)) {
    const speed = clip.speed && clip.speed > 0 ? clip.speed : 1
    return clipSeconds * speed
  }
  const target = Math.min(Math.max(clipSeconds, 0), clip.duration)
  let total = 0
  for (const segment of rampSegments(clip, 16)) {
    if (segment.outputStart >= target) break
    const covered = Math.min(segment.outputDuration, target - segment.outputStart)
    total += covered * segment.speed
  }
  return total
}

// ---------------------------------------------------------------------------
// ffmpeg expression builders
// ---------------------------------------------------------------------------

const EASED_SUBSEGMENTS = 8

/** Pre-sample keyframes into piecewise-linear breakpoints (eased/bezier → 8 slices). */
export function keyframeBreakpoints(keyframes) {
  const frames = [...keyframes].sort((a, b) => a.atSeconds - b.atSeconds)
  const points = []
  for (let i = 0; i < frames.length; i += 1) {
    const from = frames[i]
    points.push({ t: from.atSeconds, v: from.value })
    const to = frames[i + 1]
    if (!to) break
    const easing = from.easing ?? 'linear'
    if (easing === 'linear') continue
    const span = to.atSeconds - from.atSeconds
    if (span <= 0) continue
    for (let s = 1; s < EASED_SUBSEGMENTS; s += 1) {
      const progress = s / EASED_SUBSEGMENTS
      points.push({
        t: from.atSeconds + span * progress,
        v: from.value + (to.value - from.value) * easeProgress(from, progress),
      })
    }
  }
  return points
}

/**
 * Piecewise-linear ffmpeg expression over `timeExpr` (e.g. 't' or '(t-3)').
 * Constant before the first and after the last breakpoint.
 */
export function keyframeExpr(keyframes, fallback, timeExpr = 't') {
  if (!keyframes?.length) return fmt(fallback)
  const points = keyframeBreakpoints(keyframes)
  if (points.length === 1) return fmt(points[0].v)
  let expr = fmt(points[points.length - 1].v)
  for (let i = points.length - 2; i >= 0; i -= 1) {
    const from = points[i]
    const to = points[i + 1]
    const span = to.t - from.t
    const lerp = span > 0
      ? `${fmt(from.v)}+(${fmt(to.v)}-${fmt(from.v)})*(${timeExpr}-${fmt(from.t)})/${fmt(span)}`
      : fmt(to.v)
    expr = `if(lt(${timeExpr},${fmt(to.t)}),${lerp},${expr})`
  }
  return `if(lt(${timeExpr},${fmt(points[0].t)}),${fmt(points[0].v)},${expr})`
}

/**
 * sendcmd command script driving `colorchannelmixer@{label} aa` — sampled because
 * colorchannelmixer takes commands, not per-frame expressions.
 */
export function sendcmdOpacityCommands(keyframes, fallback, label, durationSeconds, stepSeconds = 0.1) {
  const commands = []
  let previous = null
  for (let t = 0; t <= durationSeconds + 1e-9; t = round3(t + stepSeconds)) {
    const value = round3(Math.min(Math.max(interpolateKeyframes(keyframes, 'transform.opacity', t, fallback), 0), 1))
    if (previous !== null && value === previous) continue
    commands.push(`${fmt(t)} colorchannelmixer@${label} aa ${fmt(value)}`)
    previous = value
  }
  return commands.join(';')
}
```

- [ ] **Step 8.5: Run tests to verify they pass**

Run: `npx jest __tests__/scripts/editor-keyframes-mjs.test.ts __tests__/lib/video-editor-keyframe-parity.test.ts --silent`
Expected: PASS. If the `keyframeExpr` golden differs by whitespace/parenthesis count, fix the BUILDER to match the golden — the golden strings are the contract.

- [ ] **Step 8.6: Commit**

```bash
git add scripts/higgsfield-executor/lib/editor-keyframes.mjs __tests__/scripts/editor-keyframes-mjs.test.ts __tests__/lib/video-editor-keyframe-parity.test.ts
git commit -m "feat(executor): keyframe/ramp math mirror with ffmpeg expression builders"
```

---

## Task 9: Filtergraph compiler — keyframed transforms/volume + speed ramps

**Files:**
- Modify: `scripts/higgsfield-executor/lib/editor-filtergraph.mjs`
- Test: `__tests__/scripts/editor-filtergraph.test.ts`

**Compilation strategy (t is clip-local in every clip chain because `setpts=PTS-STARTPTS` resets timestamps; overlay x/y run on OUTPUT time so those expressions use `(t-START)`):**

| Property | Mechanism |
|---|---|
| `transform.scale` keyframes | `scale=w='iw*(EXPR)':h='ih*(EXPR)':eval=frame` |
| `transform.rotation` keyframes | `rotate=a='(EXPR)*PI/180':c=black@0` (rotate's `a` is evaluated per frame) |
| `transform.opacity` keyframes | `format=yuva420p,sendcmd=c='CMDS',colorchannelmixer@op{n}=aa={initial}` |
| `transform.x/y` keyframes | quoted overlay position expressions over `(t-START)` |
| `volume` keyframes | `volume=volume='(EXPR)':eval=frame` in the audio chain |
| `speed` keyframes (video) | `split=N` → per-segment `trim+setpts=(PTS-STARTPTS)/speed` → `concat=n=N:v=1:a=0` |
| `speed` keyframes (audio) | `asplit=N` → per-segment `atrim+asetpts+atempo` → `concat=n=N:v=0:a=1` (atempo keeps pitch) |

- [ ] **Step 9.1: Write the failing golden tests** — append to `__tests__/scripts/editor-filtergraph.test.ts` (inside the existing `describe`, reusing `runModule` and `settings`):

```ts
  it('compiles keyframed volume, scale, rotation and overlay position', () => {
    const result = runModule<{ filterComplex: string }>(`return m.compileEditorFiltergraph(${JSON.stringify({
      settings,
      localMediaPaths: { c1: '/tmp/m/c1.mp4' },
      timeline: {
        version: 1,
        tracks: [{
          id: 't1',
          kind: 'video',
          clips: [{
            id: 'c1',
            timelineStart: 2,
            duration: 4,
            volume: 1,
            media: { type: 'upload', fileId: 'f1', url: 'https://x.test/a.mp4', mediaKind: 'video' },
            keyframes: [
              { property: 'volume', atSeconds: 0, value: 1 },
              { property: 'volume', atSeconds: 2, value: 0 },
              { property: 'transform.scale', atSeconds: 0, value: 1 },
              { property: 'transform.scale', atSeconds: 4, value: 2 },
              { property: 'transform.rotation', atSeconds: 0, value: 0 },
              { property: 'transform.rotation', atSeconds: 4, value: 90 },
              { property: 'transform.x', atSeconds: 0, value: 0 },
              { property: 'transform.x', atSeconds: 4, value: 300 },
            ],
          }],
        }],
      },
    })})`)
    const scaleExpr = "if(lt(t,0),1,if(lt(t,4),1+(2-1)*(t-0)/4,2))"
    const rotationExpr = "if(lt(t,0),0,if(lt(t,4),0+(90-0)*(t-0)/4,90))"
    const xExpr = "if(lt((t-2),0),0,if(lt((t-2),4),0+(300-0)*((t-2)-0)/4,300))"
    const volumeExpr = "if(lt(t,0),1,if(lt(t,2),1+(0-1)*(t-0)/2,0))"
    expect(result.filterComplex).toContain(`scale=w='iw*(${scaleExpr})':h='ih*(${scaleExpr})':eval=frame`)
    expect(result.filterComplex).toContain(`rotate=a='(${rotationExpr})*PI/180':c=black@0`)
    expect(result.filterComplex).toContain(`overlay=x='(W-w)/2+(${xExpr})':y=(H-h)/2:enable='between(t,2,6)':eof_action=pass`)
    expect(result.filterComplex).toContain(`volume=volume='(${volumeExpr})':eval=frame`)
  })

  it('compiles opacity keyframes as sendcmd + colorchannelmixer commands', () => {
    const result = runModule<{ filterComplex: string }>(`return m.compileEditorFiltergraph(${JSON.stringify({
      settings,
      localMediaPaths: { c1: '/tmp/m/c1.mp4' },
      timeline: {
        version: 1,
        tracks: [{
          id: 't1',
          kind: 'video',
          clips: [{
            id: 'c1',
            timelineStart: 0,
            duration: 1,
            media: { type: 'upload', fileId: 'f1', url: 'https://x.test/a.mp4', mediaKind: 'video' },
            keyframes: [
              { property: 'transform.opacity', atSeconds: 0, value: 1 },
              { property: 'transform.opacity', atSeconds: 1, value: 0 },
            ],
          }],
        }],
      },
    })})`)
    expect(result.filterComplex).toContain("format=yuva420p,sendcmd=c='0 colorchannelmixer@op0 aa 1;")
    expect(result.filterComplex).toContain("',colorchannelmixer@op0=aa=1[vc0]")
  })

  it('compiles a speed ramp as split/trim/setpts segments joined with concat (video + audio)', () => {
    const result = runModule<{ filterComplex: string }>(`return m.compileEditorFiltergraph(${JSON.stringify({
      settings,
      localMediaPaths: { c1: '/tmp/m/c1.mp4' },
      timeline: {
        version: 1,
        tracks: [{
          id: 't1',
          kind: 'video',
          clips: [{
            id: 'c1',
            timelineStart: 0,
            duration: 4,
            trimStart: 1,
            volume: 1,
            media: { type: 'upload', fileId: 'f1', url: 'https://x.test/a.mp4', mediaKind: 'video' },
            keyframes: [
              { property: 'speed', atSeconds: 0, value: 1 },
              { property: 'speed', atSeconds: 4, value: 2 },
            ],
          }],
        }],
      },
    })})`)
    // video: split into 4 constant-speed slices, trims offset by trimStart=1
    expect(result.filterComplex).toContain('[1:v]split=4[vr0i0][vr0i1][vr0i2][vr0i3]')
    expect(result.filterComplex).toContain('[vr0i0]trim=start=1:duration=1.125,setpts=(PTS-STARTPTS)/1.125[vr0s0]')
    expect(result.filterComplex).toContain('[vr0i1]trim=start=2.125:duration=1.375,setpts=(PTS-STARTPTS)/1.375[vr0s1]')
    expect(result.filterComplex).toContain('[vr0s0][vr0s1][vr0s2][vr0s3]concat=n=4:v=1:a=0[vc0]')
    // audio: asplit + atrim + atempo per slice, then concat
    expect(result.filterComplex).toContain('[1:a]asplit=4[ar0i0][ar0i1][ar0i2][ar0i3]')
    expect(result.filterComplex).toContain('[ar0i0]atrim=start=1:duration=1.125,asetpts=PTS-STARTPTS,atempo=1.125[ar0s0]')
    expect(result.filterComplex).toContain('[ar0s0][ar0s1][ar0s2][ar0s3]concat=n=4:v=0:a=1[aout]')
  })
```

- [ ] **Step 9.2: Run tests to verify they fail**

Run: `npx jest __tests__/scripts/editor-filtergraph.test.ts --silent`
Expected: The three new tests FAIL; the three P1 tests still PASS.

- [ ] **Step 9.3: Implement** — in `scripts/higgsfield-executor/lib/editor-filtergraph.mjs`:

Add the import at the top:

```js
import { hasSpeedRamp, keyframeExpr, keyframesForProperty, rampSegments, sendcmdOpacityCommands } from './editor-keyframes.mjs'
```

Replace `buildVisualClipChain` with a chains-emitting version (it now needs the `chains` array, a per-clip unique index, and returns the final label):

```js
function propertyFrames(clip, property) {
  const frames = keyframesForProperty(clip.keyframes, property)
  return frames.length ? frames : null
}

function buildVisualClipChain(clip, inputIndex, label, chains, clipOrdinal) {
  const transform = clip.transform ?? {}
  const transformParts = buildTransformParts(clip, transform, clipOrdinal)

  if (clip.media.mediaKind !== 'image' && hasSpeedRamp(clip)) {
    const segments = rampSegments(clip, 4)
    const trimStart = clip.trimStart ?? 0
    const inputLabels = segments.map((_, i) => `vr${clipOrdinal}i${i}`)
    chains.push(`[${inputIndex}:v]split=${segments.length}${inputLabels.map((l) => `[${l}]`).join('')}`)
    const segmentLabels = segments.map((segment, i) => {
      const segLabel = `vr${clipOrdinal}s${i}`
      chains.push(`[${inputLabels[i]}]trim=start=${fmt(trimStart + segment.sourceStart)}:duration=${fmt(segment.sourceDuration)},setpts=(PTS-STARTPTS)/${fmt(segment.speed)}[${segLabel}]`)
      return segLabel
    })
    // concat the constant-speed slices straight into the final label when there
    // is no transform work; otherwise concat to an intermediate and transform.
    const concatLabel = transformParts.length ? `vr${clipOrdinal}c` : label
    chains.push(`${segmentLabels.map((l) => `[${l}]`).join('')}concat=n=${segments.length}:v=1:a=0[${concatLabel}]`)
    if (transformParts.length) chains.push(`[${concatLabel}]${transformParts.join(',')}[${label}]`)
    return label
  }

  const leading = []
  if (clip.media.mediaKind === 'image') {
    leading.push('setpts=PTS-STARTPTS')
  } else {
    const speed = clipSpeed(clip)
    const trimStart = clip.trimStart ?? 0
    leading.push(`trim=start=${fmt(trimStart)}:duration=${fmt(clip.duration * speed)}`)
    leading.push(speed === 1 ? 'setpts=PTS-STARTPTS' : `setpts=(PTS-STARTPTS)/${fmt(speed)}`)
  }
  chains.push(`[${inputIndex}:v]${[...leading, ...transformParts].join(',')}[${label}]`)
  return label
}

/** Ordered transform filter parts (scale → rotate → opacity), keyframe-aware. */
function buildTransformParts(clip, transform, clipOrdinal) {
  const parts = []

  const scaleFrames = propertyFrames(clip, 'transform.scale')
  const staticScale = typeof transform.scale === 'number' ? transform.scale : 1
  if (scaleFrames) {
    const expr = keyframeExpr(scaleFrames, staticScale, 't')
    parts.push(`scale=w='iw*(${expr})':h='ih*(${expr})':eval=frame`)
  } else if (staticScale !== 1) {
    parts.push(`scale=w=iw*${fmt(staticScale)}:h=ih*${fmt(staticScale)}`)
  }

  const rotationFrames = propertyFrames(clip, 'transform.rotation')
  const staticRotation = typeof transform.rotation === 'number' ? transform.rotation : 0
  if (rotationFrames) {
    parts.push(`rotate=a='(${keyframeExpr(rotationFrames, staticRotation, 't')})*PI/180':c=black@0`)
  } else if (staticRotation !== 0) {
    parts.push(`rotate=${fmt((staticRotation * Math.PI) / 180)}:c=black@0`)
  }

  const opacityFrames = propertyFrames(clip, 'transform.opacity')
  const staticOpacity = typeof transform.opacity === 'number' ? transform.opacity : 1
  if (opacityFrames) {
    const commands = sendcmdOpacityCommands(opacityFrames, staticOpacity, `op${clipOrdinal}`, clip.duration, 0.1)
    const initial = Math.min(Math.max(opacityFrames[0].atSeconds <= 0 ? opacityFrames[0].value : staticOpacity, 0), 1)
    parts.push('format=yuva420p', `sendcmd=c='${commands}'`, `colorchannelmixer@op${clipOrdinal}=aa=${fmt(initial)}`)
  } else if (staticOpacity < 1) {
    parts.push('format=yuva420p', `colorchannelmixer=aa=${fmt(staticOpacity)}`)
  }

  return parts
}
```

Replace `overlayPosition` with a keyframe-aware version taking the clip and its timeline start (overlay expressions run on OUTPUT time):

```js
function overlayPosition(clip, startSeconds) {
  const transform = clip.transform ?? {}
  const timeExpr = startSeconds > 0 ? `(t-${fmt(startSeconds)})` : 't'
  const xFrames = propertyFrames(clip, 'transform.x')
  const yFrames = propertyFrames(clip, 'transform.y')
  const staticX = typeof transform.x === 'number' ? transform.x : 0
  const staticY = typeof transform.y === 'number' ? transform.y : 0
  const x = xFrames
    ? `'(W-w)/2+(${keyframeExpr(xFrames, staticX, timeExpr)})'`
    : staticX !== 0 ? `(W-w)/2+${fmt(staticX)}` : '(W-w)/2'
  const y = yFrames
    ? `'(H-h)/2+(${keyframeExpr(yFrames, staticY, timeExpr)})'`
    : staticY !== 0 ? `(H-h)/2+${fmt(staticY)}` : '(H-h)/2'
  return { x, y }
}
```

Update the two call sites:
1. In the visual-track group loop, the map body becomes (the builder now pushes its own chains instead of returning one, and needs the ordinal that names its labels):

```js
      const labels = group.map((clip) => {
        const label = `vc${vcCounter}`
        buildVisualClipChain(clip, clipInputIndex.get(clip.id), label, chains, vcCounter)
        vcCounter += 1
        return { clip, label }
      })
```

2. `const { x, y } = overlayPosition(group[0], group[0].timelineStart)` replaces `overlayPosition(group[0].transform)`.

Replace the audio-source chain builder inside the `audioSources.forEach` with a ramp/keyframe-aware version:

```js
    audioSources.forEach(({ clip, volume }, index) => {
      const volumeFrames = keyframesForProperty(clip.keyframes, 'volume')
      const label = audioSources.length === 1 ? 'aout' : `ac${index}`
      const trimStart = clip.trimStart ?? 0
      const tailParts = []
      if (volumeFrames.length) {
        tailParts.push(`volume=volume='(${keyframeExpr(volumeFrames, volume, 't')})':eval=frame`)
      } else if (volume !== 1) {
        tailParts.push(`volume=${fmt(volume)}`)
      }
      if (clip.timelineStart > 0) tailParts.push(`adelay=${Math.round(clip.timelineStart * 1000)}:all=1`)

      if (hasSpeedRamp(clip)) {
        const segments = rampSegments(clip, 4)
        const inputLabels = segments.map((_, i) => `ar${index}i${i}`)
        chains.push(`[${clipInputIndex.get(clip.id)}:a]asplit=${segments.length}${inputLabels.map((l) => `[${l}]`).join('')}`)
        const segmentLabels = segments.map((segment, i) => {
          const segLabel = `ar${index}s${i}`
          const atempo = atempoFactors(segment.speed).map((factor) => `atempo=${fmt(factor)}`)
          const chain = [
            `atrim=start=${fmt(trimStart + segment.sourceStart)}:duration=${fmt(segment.sourceDuration)}`,
            'asetpts=PTS-STARTPTS',
            ...(atempo.length ? atempo : []),
          ]
          chains.push(`[${inputLabels[i]}]${chain.join(',')}[${segLabel}]`)
          return segLabel
        })
        const concatTarget = tailParts.length ? `ar${index}c` : label
        chains.push(`${segmentLabels.map((l) => `[${l}]`).join('')}concat=n=${segments.length}:v=0:a=1[${concatTarget}]`)
        if (tailParts.length) chains.push(`[${concatTarget}]${tailParts.join(',')}[${label}]`)
      } else {
        const speed = clipSpeed(clip)
        const parts = [
          `atrim=start=${fmt(trimStart)}:duration=${fmt(clip.duration * speed)}`,
          'asetpts=PTS-STARTPTS',
          ...atempoFactors(speed).map((factor) => `atempo=${fmt(factor)}`),
          ...tailParts,
        ]
        chains.push(`[${clipInputIndex.get(clip.id)}:a]${parts.join(',')}[${label}]`)
      }
      labels.push(label)
    })
```

Also update the `atempoFactors` golden expectation: `atempo=1.125` etc. — `atempoFactors(1.125)` returns `[1.125]`, matching the golden.

**Careful with the existing P1 goldens:** the plain-clip path must keep emitting byte-identical strings (`[1:v]trim=start=2:duration=4,setpts=PTS-STARTPTS[vc0]` and `overlay=x=(W-w)/2:y=(H-h)/2:...`). Run the FULL filtergraph test file after the refactor and fix regressions in the refactor, not the goldens.

- [ ] **Step 9.4: Run tests to verify they pass**

Run: `npx jest __tests__/scripts/editor-filtergraph.test.ts --silent`
Expected: PASS — all P1 goldens AND the three new tests.

- [ ] **Step 9.5: Optional local ffmpeg contract check** (if ffmpeg is installed locally):

Run: `RUN_FFMPEG_CONTRACT=1 npx jest __tests__/scripts/editor-filtergraph.test.ts --silent` (P1's gated contract test). Additionally sanity-run one keyframed graph by hand:

```bash
ffmpeg -y -f lavfi -i "color=c=black:s=320x180:r=30:d=2" -f lavfi -t 2 -i "testsrc=size=160x90:rate=30" \
  -filter_complex "[0:v]format=yuv420p[base];[1:v]setpts=PTS-STARTPTS,scale=w='iw*(if(lt(t,0),1,if(lt(t,2),1+(2-1)*(t-0)/2,2)))':h='ih*(if(lt(t,0),1,if(lt(t,2),1+(2-1)*(t-0)/2,2)))':eval=frame[vc0];[base][vc0]overlay=x=(W-w)/2:y=(H-h)/2:enable='between(t,0,2)':eof_action=pass[vout]" \
  -map "[vout]" -t 2 /tmp/kf-check.mp4
```
Expected: exit 0 and a video with a growing test pattern.

- [ ] **Step 9.6: Commit**

```bash
git add scripts/higgsfield-executor/lib/editor-filtergraph.mjs __tests__/scripts/editor-filtergraph.test.ts
git commit -m "feat(executor): keyframed transforms/volume and speed-ramp segments in the filtergraph"
```

---

## Task 10: TimelinePanel + Shell — trim handles, edit modes, multi-select, groups

**Files:**
- Modify: `components/video-editor/TimelinePanel.tsx`
- Modify: `components/video-editor/VideoEditorShell.tsx`
- Test: `__tests__/app/video-editor-timeline-mechanics.test.tsx`

**Selection model change:** `TimelineSelection` becomes `Array<{ trackId: string; clipId: string }>` (multi-select across tracks, needed for linking). The Shell's `selectedClip` is the first entry. Check `__tests__/app/video-editor-happy-path.test.tsx` after the change — it drives the UI through clicks, so it should not need edits, but run it.

**Edit modes:** `'select' | 'ripple' | 'roll' | 'slip'` owned by the Shell.
- select: trim = `trimClip`, delete = `removeClip` (group-aware: delete removes the whole group; move moves the whole group via `moveClipGroup`).
- ripple: trim = `rippleTrimClip`, delete = `rippleDeleteClip` (all tracks).
- roll: dragging a clip's START handle rolls against its left-adjacent neighbor (`rollEdit`).
- slip: dragging the clip BODY slips the source window (`slipClip`).

- [ ] **Step 10.1: Write the failing tests** — create `__tests__/app/video-editor-timeline-mechanics.test.tsx`:

```tsx
import { fireEvent, render, screen } from '@testing-library/react'
import { TimelinePanel, trimDeltaFromDrag } from '@/components/video-editor/TimelinePanel'
import type { EditorTimeline } from '@/lib/video-editor/types'

const timeline: EditorTimeline = {
  version: 1,
  tracks: [{
    id: 'v1',
    kind: 'video',
    clips: [
      { id: 'a', timelineStart: 0, duration: 4, groupId: 'grp-1', media: { type: 'upload', fileId: 'f', url: 'https://x.test/a.mp4', mediaKind: 'video' }, keyframes: [{ property: 'transform.x', atSeconds: 1, value: 10 }] },
      { id: 'b', timelineStart: 4, duration: 3, media: { type: 'upload', fileId: 'f2', url: 'https://x.test/b.mp4', mediaKind: 'video' } },
    ],
  }],
}

function makeProps(overrides: Partial<Parameters<typeof TimelinePanel>[0]> = {}) {
  return {
    timeline,
    selection: [{ trackId: 'v1', clipId: 'a' }],
    playheadSeconds: 0,
    pxPerSecond: 60,
    editMode: 'select' as const,
    mediaPreviews: {},
    onEditModeChange: jest.fn(),
    onSelectionChange: jest.fn(),
    onSeek: jest.fn(),
    onZoomChange: jest.fn(),
    onMoveClip: jest.fn(),
    onTrimClip: jest.fn(),
    onRollEdit: jest.fn(),
    onSlipClip: jest.fn(),
    onSplitAtPlayhead: jest.fn(),
    onRemoveSelected: jest.fn(),
    onLinkSelection: jest.fn(),
    onUnlinkSelection: jest.fn(),
    onToggleTrackFlag: jest.fn(),
    onAddTrack: jest.fn(),
    onAddTextClip: jest.fn(),
    ...overrides,
  }
}

describe('trimDeltaFromDrag', () => {
  it('converts pixel drags to second deltas per edge', () => {
    expect(trimDeltaFromDrag('end', 30, 60)).toBe(0.5)
    expect(trimDeltaFromDrag('end', -30, 60)).toBe(-0.5)
    expect(trimDeltaFromDrag('start', 30, 60)).toBe(0.5) // dragging the start handle right trims away
  })
})

describe('TimelinePanel mechanics', () => {
  it('shows edit mode buttons and reports mode changes', () => {
    const props = makeProps()
    render(<TimelinePanel {...props} />)
    fireEvent.click(screen.getByRole('button', { name: 'Ripple mode' }))
    expect(props.onEditModeChange).toHaveBeenCalledWith('ripple')
    fireEvent.click(screen.getByRole('button', { name: 'Roll mode' }))
    expect(props.onEditModeChange).toHaveBeenCalledWith('roll')
    fireEvent.click(screen.getByRole('button', { name: 'Slip mode' }))
    expect(props.onEditModeChange).toHaveBeenCalledWith('slip')
  })

  it('renders trim handles on selected clips and fires onTrimClip after a drag', () => {
    const props = makeProps()
    render(<TimelinePanel {...props} />)
    const handle = screen.getByTestId('trim-handle-end-a')
    fireEvent.pointerDown(handle, { clientX: 240, pointerId: 1 })
    fireEvent.pointerMove(handle, { clientX: 300, pointerId: 1 })
    fireEvent.pointerUp(handle, { clientX: 300, pointerId: 1 })
    expect(props.onTrimClip).toHaveBeenCalledWith('v1', 'a', 'end', 1)
  })

  it('routes a start-handle drag to onRollEdit in roll mode', () => {
    const props = makeProps({ editMode: 'roll', selection: [{ trackId: 'v1', clipId: 'b' }] })
    render(<TimelinePanel {...props} />)
    const handle = screen.getByTestId('trim-handle-start-b')
    fireEvent.pointerDown(handle, { clientX: 240, pointerId: 1 })
    fireEvent.pointerMove(handle, { clientX: 180, pointerId: 1 })
    fireEvent.pointerUp(handle, { clientX: 180, pointerId: 1 })
    expect(props.onRollEdit).toHaveBeenCalledWith('v1', 'a', 'b', -1)
  })

  it('routes a body drag to onSlipClip in slip mode', () => {
    const props = makeProps({ editMode: 'slip' })
    render(<TimelinePanel {...props} />)
    const body = screen.getByTestId('timeline-clip-a')
    fireEvent.pointerDown(body, { clientX: 100, pointerId: 1 })
    fireEvent.pointerMove(body, { clientX: 160, pointerId: 1 })
    fireEvent.pointerUp(body, { clientX: 160, pointerId: 1 })
    expect(props.onSlipClip).toHaveBeenCalledWith('v1', 'a', 1)
  })

  it('shift-click extends the selection and link/unlink buttons reflect it', () => {
    const props = makeProps()
    render(<TimelinePanel {...props} />)
    fireEvent.click(screen.getByTestId('timeline-clip-b'), { shiftKey: true })
    expect(props.onSelectionChange).toHaveBeenCalledWith([
      { trackId: 'v1', clipId: 'a' },
      { trackId: 'v1', clipId: 'b' },
    ])
    // selected clip 'a' is grouped → Unlink enabled
    expect(screen.getByRole('button', { name: 'Unlink clips' })).toBeEnabled()
  })

  it('renders keyframe markers and a group badge', () => {
    render(<TimelinePanel {...makeProps()} />)
    expect(screen.getByTestId('keyframe-marker-a-0')).toBeInTheDocument()
    expect(screen.getByTestId('group-badge-a')).toBeInTheDocument()
  })
})
```

- [ ] **Step 10.2: Run tests to verify they fail**

Run: `npx jest __tests__/app/video-editor-timeline-mechanics.test.tsx --silent`
Expected: FAIL — new props/exports missing.

- [ ] **Step 10.3: Rewrite `components/video-editor/TimelinePanel.tsx`:**

```tsx
'use client'

import { useRef, useState } from 'react'
import type { EditorClip, EditorTimeline, EditorTrackKind, VideoEditorMediaPreview } from '@/lib/video-editor/types'
import { mediaKeyForRef } from '@/lib/video-editor/media-previews'
import { WaveformStrip } from './WaveformStrip'

export type TimelineSelection = Array<{ trackId: string; clipId: string }>
export type TimelineEditMode = 'select' | 'ripple' | 'roll' | 'slip'

interface TimelinePanelProps {
  timeline: EditorTimeline
  selection: TimelineSelection
  playheadSeconds: number
  pxPerSecond: number
  editMode: TimelineEditMode
  mediaPreviews: Record<string, VideoEditorMediaPreview>
  onEditModeChange: (mode: TimelineEditMode) => void
  onSelectionChange: (selection: TimelineSelection) => void
  onSeek: (seconds: number) => void
  onZoomChange: (pxPerSecond: number) => void
  onMoveClip: (trackId: string, clipId: string, toStart: number) => void
  onTrimClip: (trackId: string, clipId: string, edge: 'start' | 'end', deltaSeconds: number) => void
  onRollEdit: (trackId: string, leftClipId: string, rightClipId: string, deltaSeconds: number) => void
  onSlipClip: (trackId: string, clipId: string, deltaSeconds: number) => void
  onSplitAtPlayhead: () => void
  onRemoveSelected: () => void
  onLinkSelection: () => void
  onUnlinkSelection: () => void
  onToggleTrackFlag: (trackId: string, flag: 'muted' | 'locked') => void
  onAddTrack: (kind: EditorTrackKind) => void
  onAddTextClip: () => void
}

export function snapSeconds(target: number, candidates: number[], threshold = 0.2): number {
  const nearest = candidates.reduce<{ value: number; distance: number } | null>((best, candidate) => {
    const distance = Math.abs(candidate - target)
    if (distance > threshold) return best
    if (!best || distance < best.distance) return { value: candidate, distance }
    return best
  }, null)
  return Math.max(0, nearest?.value ?? target)
}

/** Pixel drag → signed seconds. Positive start-handle drags trim source away. */
export function trimDeltaFromDrag(edge: 'start' | 'end', dxPx: number, pxPerSecond: number): number {
  return Math.round((dxPx / pxPerSecond) * 1000) / 1000
}

const EDIT_MODES: Array<{ id: TimelineEditMode; label: string; icon: string }> = [
  { id: 'select', label: 'Select mode', icon: 'arrow_selector_tool' },
  { id: 'ripple', label: 'Ripple mode', icon: 'keyboard_double_arrow_left' },
  { id: 'roll', label: 'Roll mode', icon: 'swap_horiz' },
  { id: 'slip', label: 'Slip mode', icon: 'open_with' },
]

export function TimelinePanel(props: TimelinePanelProps) {
  const {
    timeline, selection, playheadSeconds, pxPerSecond, editMode, mediaPreviews,
    onEditModeChange, onSelectionChange, onSeek, onZoomChange, onMoveClip, onTrimClip,
    onRollEdit, onSlipClip, onSplitAtPlayhead, onRemoveSelected, onLinkSelection,
    onUnlinkSelection, onToggleTrackFlag, onAddTrack, onAddTextClip,
  } = props
  const drag = useRef<{ kind: 'trim' | 'slip'; trackId: string; clipId: string; edge?: 'start' | 'end'; startX: number; lastX: number } | null>(null)
  const [dragPreviewPx, setDragPreviewPx] = useState(0)

  const duration = Math.max(30, ...timeline.tracks.flatMap((track) => track.clips.map((clip) => clip.timelineStart + clip.duration)))
  const rulerTicks = Array.from({ length: Math.ceil(duration / 5) + 1 }, (_, index) => index * 5)
  const snapCandidates = timeline.tracks.flatMap((track) => track.clips.flatMap((clip) => [clip.timelineStart, clip.timelineStart + clip.duration]))
  const isSelected = (trackId: string, clipId: string) => selection.some((item) => item.trackId === trackId && item.clipId === clipId)
  const selectedGrouped = selection.some((item) => {
    const track = timeline.tracks.find((t) => t.id === item.trackId)
    return Boolean(track?.clips.find((c) => c.id === item.clipId)?.groupId)
  })

  function leftNeighbor(trackId: string, clip: EditorClip): EditorClip | null {
    const track = timeline.tracks.find((t) => t.id === trackId)
    if (!track) return null
    return track.clips.find((item) => Math.abs(item.timelineStart + item.duration - clip.timelineStart) < 0.0005) ?? null
  }

  function finishDrag(trackId: string, clip: EditorClip, clientX: number) {
    const state = drag.current
    drag.current = null
    setDragPreviewPx(0)
    if (!state) return
    const dx = clientX - state.startX
    if (Math.abs(dx) < 2) return
    const delta = trimDeltaFromDrag(state.edge ?? 'end', dx, pxPerSecond)
    if (state.kind === 'slip') {
      onSlipClip(trackId, clip.id, delta)
      return
    }
    if (editMode === 'roll' && state.edge === 'start') {
      const neighbor = leftNeighbor(trackId, clip)
      if (neighbor) onRollEdit(trackId, neighbor.id, clip.id, delta)
      return
    }
    onTrimClip(trackId, clip.id, state.edge ?? 'end', delta)
  }

  function handleClipClick(event: React.MouseEvent, trackId: string, clipId: string) {
    event.stopPropagation()
    if (event.shiftKey) {
      if (isSelected(trackId, clipId)) onSelectionChange(selection.filter((item) => item.clipId !== clipId || item.trackId !== trackId))
      else onSelectionChange([...selection, { trackId, clipId }])
      return
    }
    onSelectionChange([{ trackId, clipId }])
  }

  return (
    <section className="pib-card-section overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--color-pib-line)] p-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-lg border border-[var(--color-pib-line)]">
            {EDIT_MODES.map((mode) => (
              <button
                key={mode.id}
                type="button"
                aria-label={mode.label}
                aria-pressed={editMode === mode.id}
                className={['px-2 py-1 text-sm', editMode === mode.id ? 'bg-[var(--color-pib-primary)]/20 text-on-surface' : 'text-on-surface-variant'].join(' ')}
                onClick={() => onEditModeChange(mode.id)}
              >
                <span className="material-symbols-rounded text-base">{mode.icon}</span>
              </button>
            ))}
          </div>
          <button type="button" className="pib-btn-ghost text-sm" onClick={onSplitAtPlayhead} aria-label="Split at playhead">
            <span className="material-symbols-rounded text-base">content_cut</span>
          </button>
          <button type="button" className="pib-btn-ghost text-sm" onClick={onRemoveSelected} aria-label="Delete selected">
            <span className="material-symbols-rounded text-base">delete</span>
          </button>
          <button type="button" className="pib-btn-ghost text-sm" disabled={selection.length < 2} onClick={onLinkSelection} aria-label="Link clips">
            <span className="material-symbols-rounded text-base">link</span>
          </button>
          <button type="button" className="pib-btn-ghost text-sm" disabled={!selectedGrouped} onClick={onUnlinkSelection} aria-label="Unlink clips">
            <span className="material-symbols-rounded text-base">link_off</span>
          </button>
          <button type="button" className="pib-btn-ghost text-sm" onClick={() => onZoomChange(Math.min(180, Math.round(pxPerSecond * 1.25)))} aria-label="Zoom in">
            <span className="material-symbols-rounded text-base">zoom_in</span>
          </button>
          <button type="button" className="pib-btn-ghost text-sm" onClick={() => onZoomChange(Math.max(20, Math.round(pxPerSecond / 1.25)))} aria-label="Zoom out">
            <span className="material-symbols-rounded text-base">zoom_out</span>
          </button>
        </div>
        <label className="text-sm text-on-surface-variant">
          Add to timeline
          <select
            className="ml-2 rounded-lg border border-[var(--color-pib-line)] bg-transparent px-2 py-1"
            defaultValue=""
            onChange={(event) => {
              if (!event.target.value) return
              if (event.target.value === 'text') onAddTextClip()
              else onAddTrack(event.target.value as EditorTrackKind)
              event.target.value = ''
            }}
          >
            <option value="">Choose</option>
            <option value="video">Video track</option>
            <option value="overlay">Overlay track</option>
            <option value="text">Text title clip</option>
            <option value="audio">Audio track</option>
          </select>
        </label>
      </div>
      <div className="overflow-x-auto">
        <div style={{ width: `${duration * pxPerSecond + 220}px` }} className="min-w-full">
          <div className="flex border-b border-[var(--color-pib-line)] text-xs text-on-surface-variant">
            <div className="w-48 shrink-0 p-2">Timeline</div>
            <div
              data-testid="timeline-ruler"
              className="relative h-8 flex-1 cursor-pointer"
              onClick={(event) => {
                const rect = event.currentTarget.getBoundingClientRect()
                onSeek(Math.max(0, (event.clientX - rect.left) / pxPerSecond))
              }}
            >
              {rulerTicks.map((tick) => (
                <span key={tick} style={{ left: `${tick * pxPerSecond}px` }} className="absolute top-2">{tick}s</span>
              ))}
              <span style={{ left: `${playheadSeconds * pxPerSecond}px` }} className="absolute inset-y-0 w-px bg-[var(--color-pib-primary)]" />
            </div>
          </div>
          {timeline.tracks.map((track) => (
            <div key={track.id} className="flex border-b border-[var(--color-pib-line)]">
              <div className="w-48 shrink-0 space-y-2 p-2">
                <p className="truncate text-sm font-medium text-on-surface">{track.label || track.kind}</p>
                <div className="flex gap-1">
                  <button type="button" className="rounded border border-[var(--color-pib-line)] px-2 py-1 text-xs" onClick={() => onToggleTrackFlag(track.id, 'muted')} aria-label={`Mute ${track.label || track.kind}`}>M</button>
                  <button type="button" className="rounded border border-[var(--color-pib-line)] px-2 py-1 text-xs" onClick={() => onToggleTrackFlag(track.id, 'locked')} aria-label={`Lock ${track.label || track.kind}`}>L</button>
                </div>
              </div>
              <div className="relative h-20 flex-1">
                {track.clips.map((clip) => {
                  const selected = isSelected(track.id, clip.id)
                  const previewKey = clip.media ? mediaKeyForRef(clip.media) : ''
                  const preview = previewKey ? mediaPreviews[previewKey] : undefined
                  const filmstrip = preview?.filmstrip
                  return (
                    <div
                      key={clip.id}
                      data-testid={`timeline-clip-${clip.id}`}
                      role="button"
                      tabIndex={0}
                      style={{
                        left: `${clip.timelineStart * pxPerSecond}px`,
                        width: `${clip.duration * pxPerSecond}px`,
                        ...(filmstrip ? {
                          backgroundImage: `url(${filmstrip.url})`,
                          backgroundSize: `auto 100%`,
                          backgroundRepeat: 'repeat-x',
                        } : {}),
                      }}
                      className={[
                        'absolute top-3 h-12 cursor-pointer overflow-hidden rounded-md border px-2 text-left text-xs',
                        selected ? 'border-[var(--color-pib-primary)] bg-[var(--color-pib-primary)]/20 text-on-surface' : 'border-[var(--color-pib-line)] bg-white/[0.04] text-on-surface-variant',
                        editMode === 'slip' ? 'cursor-ew-resize' : '',
                      ].join(' ')}
                      onClick={(event) => handleClipClick(event, track.id, clip.id)}
                      onDoubleClick={() => onMoveClip(track.id, clip.id, snapSeconds(clip.timelineStart + 1, snapCandidates))}
                      onPointerDown={(event) => {
                        if (editMode !== 'slip' || !clip.media) return
                        drag.current = { kind: 'slip', trackId: track.id, clipId: clip.id, startX: event.clientX, lastX: event.clientX }
                        ;(event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId)
                      }}
                      onPointerMove={(event) => {
                        if (drag.current?.kind === 'slip' && drag.current.clipId === clip.id) setDragPreviewPx(event.clientX - drag.current.startX)
                      }}
                      onPointerUp={(event) => {
                        if (drag.current?.kind === 'slip' && drag.current.clipId === clip.id) finishDrag(track.id, clip, event.clientX)
                      }}
                    >
                      {preview?.waveform && track.kind === 'audio' ? (
                        <WaveformStrip waveformUrl={preview.waveform.url} className="pointer-events-none absolute inset-0 opacity-60" />
                      ) : null}
                      <span className="pointer-events-none relative block truncate">{clip.text?.content || clip.media?.mediaKind || clip.id}</span>
                      <span className="pointer-events-none relative block truncate">{clip.duration}s</span>
                      {clip.groupId ? (
                        <span data-testid={`group-badge-${clip.id}`} className="absolute right-1 top-1 rounded bg-[var(--color-pib-primary)]/40 px-1 text-[10px]" title={`Linked group ${clip.groupId}`}>
                          <span className="material-symbols-rounded text-[10px]">link</span>
                        </span>
                      ) : null}
                      {(clip.keyframes ?? []).map((keyframe, index) => (
                        <span
                          key={`${keyframe.property}-${index}`}
                          data-testid={`keyframe-marker-${clip.id}-${index}`}
                          title={`${keyframe.property} @ ${keyframe.atSeconds}s`}
                          style={{ left: `${keyframe.atSeconds * pxPerSecond}px` }}
                          className="absolute bottom-0.5 h-1.5 w-1.5 rotate-45 bg-amber-300"
                        />
                      ))}
                      {selected ? (
                        <>
                          <span
                            data-testid={`trim-handle-start-${clip.id}`}
                            className="absolute inset-y-0 left-0 w-2 cursor-ew-resize bg-[var(--color-pib-primary)]/60"
                            onPointerDown={(event) => {
                              event.stopPropagation()
                              drag.current = { kind: 'trim', trackId: track.id, clipId: clip.id, edge: 'start', startX: event.clientX, lastX: event.clientX }
                              ;(event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId)
                            }}
                            onPointerMove={(event) => { if (drag.current?.clipId === clip.id) setDragPreviewPx(event.clientX - drag.current.startX) }}
                            onPointerUp={(event) => { event.stopPropagation(); finishDrag(track.id, clip, event.clientX) }}
                          />
                          <span
                            data-testid={`trim-handle-end-${clip.id}`}
                            className="absolute inset-y-0 right-0 w-2 cursor-ew-resize bg-[var(--color-pib-primary)]/60"
                            onPointerDown={(event) => {
                              event.stopPropagation()
                              drag.current = { kind: 'trim', trackId: track.id, clipId: clip.id, edge: 'end', startX: event.clientX, lastX: event.clientX }
                              ;(event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId)
                            }}
                            onPointerMove={(event) => { if (drag.current?.clipId === clip.id) setDragPreviewPx(event.clientX - drag.current.startX) }}
                            onPointerUp={(event) => { event.stopPropagation(); finishDrag(track.id, clip, event.clientX) }}
                          />
                        </>
                      ) : null}
                    </div>
                  )
                })}
                {dragPreviewPx !== 0 ? <span className="sr-only" data-testid="drag-preview">{dragPreviewPx}</span> : null}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
```

Note: `WaveformStrip` and `mediaKeyForRef` are created in Tasks 13/15. To keep this task self-contained and green, create the two minimal placeholders NOW as their real final homes (Task 13 fills in the server side; Task 15 fills in the canvas painter):

Create `lib/video-editor/media-previews.ts` (final `mediaKeyForRef` — Task 13 appends the sanitizer to this same file):

```ts
import type { MediaRef } from './types'

/** Deterministic identity for a media source, shared by client, platform APIs and the executor. */
export function mediaKeyForRef(media: MediaRef): string {
  if (media.type === 'upload') return `upload:${media.fileId}`
  if (media.type === 'youtube_source_asset') return `yt:${media.sourceAssetId}`
  return `canvas:${media.canvasId}:${media.nodeId}:${media.runId}`
}
```

Create `components/video-editor/WaveformStrip.tsx` (final component — Task 15 tests it):

```tsx
'use client'

import { useEffect, useRef, useState } from 'react'

/** Fetches a waveform peaks JSON ({ peaks: number[] }) and paints it into a canvas. */
export function WaveformStrip({ waveformUrl, className }: { waveformUrl: string; className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [peaks, setPeaks] = useState<number[] | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch(waveformUrl)
      .then((res) => (res.ok ? res.json() : null))
      .then((body) => {
        if (!cancelled && body && Array.isArray(body.peaks)) setPeaks(body.peaks as number[])
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [waveformUrl])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !peaks?.length) return
    const context = canvas.getContext('2d')
    if (!context) return
    const { width, height } = canvas
    context.clearRect(0, 0, width, height)
    context.fillStyle = 'rgba(255,255,255,0.55)'
    const step = width / peaks.length
    peaks.forEach((peak, index) => {
      const barHeight = Math.max(1, Math.min(1, Math.abs(peak)) * height)
      context.fillRect(index * step, (height - barHeight) / 2, Math.max(1, step - 0.5), barHeight)
    })
  }, [peaks])

  return <canvas ref={canvasRef} data-testid="waveform-canvas" width={480} height={40} className={className} />
}
```

- [ ] **Step 10.4: Wire the Shell** — in `components/video-editor/VideoEditorShell.tsx`:

Update imports and state:

```tsx
import {
  addClip, addTrack, clearClipGroup, moveClip, moveClipGroup, removeClip, removeClipGroup,
  rippleDeleteClip, rippleTrimClip, rollEdit, setClipGroup, slipClip, splitClip, trimClip,
} from '@/lib/video-editor/timeline-ops'
import { TimelinePanel, type TimelineEditMode, type TimelineSelection } from './TimelinePanel'
```

State changes inside the component:

```tsx
  const [selection, setSelection] = useState<TimelineSelection>([])
  const [editMode, setEditMode] = useState<TimelineEditMode>('select')

  const selectedClip = useMemo(() => {
    const first = selection[0]
    if (!first) return null
    const track = timeline.tracks.find((item) => item.id === first.trackId)
    return track?.clips.find((clip) => clip.id === first.clipId) ?? null
  }, [selection, timeline])
```

Replace `patchSelected` (multi-select aware — patches every selected clip):

```tsx
  function patchSelected(patch: Partial<EditorClip>) {
    if (!selection.length) return
    const next: EditorTimeline = {
      ...timeline,
      tracks: timeline.tracks.map((track) => ({
        ...track,
        clips: track.clips.map((clip) =>
          selection.some((item) => item.trackId === track.id && item.clipId === clip.id) ? { ...clip, ...patch } : clip),
      })),
    }
    void persist(next)
  }
```

Add the mechanics handlers (place after `patchSelected`; every op call is wrapped in the same try/notice pattern already used for move):

```tsx
  function runOp(op: () => EditorTimeline, failure: string) {
    try { void persist(op()) } catch (error) { setNotice(error instanceof Error ? error.message : failure) }
  }

  function handleTrim(trackId: string, clipId: string, edge: 'start' | 'end', deltaSeconds: number) {
    if (editMode === 'ripple') runOp(() => rippleTrimClip(timeline, trackId, clipId, { edge, deltaSeconds }), 'Could not ripple trim')
    else runOp(() => trimClip(timeline, trackId, clipId, { edge, deltaSeconds }), 'Could not trim clip')
  }

  function handleRemoveSelected() {
    const first = selection[0]
    if (!first) return
    const track = timeline.tracks.find((item) => item.id === first.trackId)
    const clip = track?.clips.find((item) => item.id === first.clipId)
    if (!clip) return
    if (editMode === 'ripple') runOp(() => rippleDeleteClip(timeline, first.trackId, first.clipId), 'Could not ripple delete')
    else if (clip.groupId) runOp(() => removeClipGroup(timeline, clip.groupId!), 'Could not delete linked clips')
    else runOp(() => removeClip(timeline, first.trackId, first.clipId), 'Could not remove clip')
    setSelection([])
  }

  function handleMoveClip(trackId: string, clipId: string, toStart: number) {
    const track = timeline.tracks.find((item) => item.id === trackId)
    const clip = track?.clips.find((item) => item.id === clipId)
    if (clip?.groupId) runOp(() => moveClipGroup(timeline, clip.groupId!, toStart - clip.timelineStart), 'Could not move linked clips')
    else runOp(() => moveClip(timeline, trackId, clipId, { toStart }), 'Could not move clip')
  }

  function handleLinkSelection() {
    if (selection.length < 2) return
    runOp(() => setClipGroup(timeline, selection.map((item) => ({ trackId: item.trackId, clipId: item.clipId }))), 'Could not link clips')
  }

  function handleUnlinkSelection() {
    const grouped = selection
      .map((item) => timeline.tracks.find((t) => t.id === item.trackId)?.clips.find((c) => c.id === item.clipId)?.groupId)
      .find(Boolean)
    if (grouped) runOp(() => clearClipGroup(timeline, grouped), 'Could not unlink clips')
  }
```

Update the `TimelinePanel` usage (replacing the old props, including the `onTrimClip={() => undefined}` stub):

```tsx
          <TimelinePanel
            timeline={timeline}
            selection={selection}
            playheadSeconds={playhead}
            pxPerSecond={pxPerSecond}
            editMode={editMode}
            mediaPreviews={mediaPreviews}
            onEditModeChange={setEditMode}
            onSelectionChange={setSelection}
            onSeek={setPlayhead}
            onZoomChange={setPxPerSecond}
            onMoveClip={handleMoveClip}
            onTrimClip={handleTrim}
            onRollEdit={(trackId, leftId, rightId, delta) => runOp(() => rollEdit(timeline, trackId, leftId, rightId, delta), 'Could not roll edit')}
            onSlipClip={(trackId, clipId, delta) => runOp(() => slipClip(timeline, trackId, clipId, delta), 'Could not slip clip')}
            onSplitAtPlayhead={() => {
              const first = selection[0]
              if (!first) return
              runOp(() => splitClip(timeline, first.trackId, first.clipId, playhead), 'Could not split clip')
            }}
            onRemoveSelected={handleRemoveSelected}
            onLinkSelection={handleLinkSelection}
            onUnlinkSelection={handleUnlinkSelection}
            onToggleTrackFlag={(trackId, flag) => {
              void persist({ ...timeline, tracks: timeline.tracks.map((track) => track.id === trackId ? { ...track, [flag]: !track[flag] } : track) })
            }}
            onAddTrack={(kind: EditorTrackKind) => void persist(addTrack(timeline, { kind, label: kind }))}
            onAddTextClip={addTextClip}
          />
```

Until Task 15 lands, define a placeholder in the Shell: `const mediaPreviews = useMemo<Record<string, VideoEditorMediaPreview>>(() => ({}), [])` (Task 15 replaces it with real loading), and update the two `setSelection({ trackId, clipIds: [...] })` calls in `addMediaClip`/`addTextClip` to the new array shape: `setSelection([{ trackId: targetTrack.id, clipId: clip.id }])`.

- [ ] **Step 10.5: Run tests to verify they pass**

Run: `npx jest __tests__/app/video-editor-timeline-mechanics.test.tsx __tests__/app/video-editor-happy-path.test.tsx --silent`
Expected: PASS. Then `npm run typecheck` — clean (the Shell/Panel selection type change must compile end-to-end).

- [ ] **Step 10.6: Commit**

```bash
git add components/video-editor/TimelinePanel.tsx components/video-editor/VideoEditorShell.tsx components/video-editor/WaveformStrip.tsx lib/video-editor/media-previews.ts __tests__/app/video-editor-timeline-mechanics.test.tsx
git commit -m "feat(video-editor): trim handles, ripple/roll/slip modes, multi-select and linked groups in the timeline UI"
```

---

## Task 11: Inspector — keyframe lanes, bezier editor, speed-ramp presets

**Files:**
- Create: `components/video-editor/KeyframeEditor.tsx`
- Create: `components/video-editor/BezierCurveEditor.tsx`
- Create: `components/video-editor/SpeedRampSection.tsx`
- Modify: `components/video-editor/InspectorPanel.tsx`
- Modify: `components/video-editor/VideoEditorShell.tsx` (pass playhead into the Inspector)
- Test: `__tests__/app/video-editor-keyframe-editor.test.tsx`

- [ ] **Step 11.1: Write the failing tests** — create `__tests__/app/video-editor-keyframe-editor.test.tsx`:

```tsx
import { fireEvent, render, screen } from '@testing-library/react'
import { BezierCurveEditor } from '@/components/video-editor/BezierCurveEditor'
import { KeyframeEditor } from '@/components/video-editor/KeyframeEditor'
import { SpeedRampSection } from '@/components/video-editor/SpeedRampSection'
import type { EditorClip } from '@/lib/video-editor/types'

const clip: EditorClip = {
  id: 'c1',
  timelineStart: 10,
  duration: 4,
  media: { type: 'upload', fileId: 'f', url: 'https://x.test/a.mp4', mediaKind: 'video' },
  transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 },
  keyframes: [{ property: 'transform.opacity', atSeconds: 1, value: 0.5, easing: 'ease_in' }],
}

describe('KeyframeEditor', () => {
  it('adds a keyframe at the playhead with the current property value', () => {
    const onPatch = jest.fn()
    render(<KeyframeEditor clip={clip} playheadSeconds={12} onPatch={onPatch} />)
    fireEvent.click(screen.getByRole('button', { name: 'Add opacity keyframe at playhead' }))
    const patch = onPatch.mock.calls[0][0]
    expect(patch.keyframes).toContainEqual(expect.objectContaining({ property: 'transform.opacity', atSeconds: 2 }))
    expect(patch.keyframes).toHaveLength(2)
  })

  it('edits a keyframe value and easing, and removes keyframes', () => {
    const onPatch = jest.fn()
    render(<KeyframeEditor clip={clip} playheadSeconds={10} onPatch={onPatch} />)
    fireEvent.change(screen.getByLabelText('opacity keyframe 1 value'), { target: { value: '0.9' } })
    expect(onPatch).toHaveBeenCalledWith({ keyframes: [expect.objectContaining({ value: 0.9 })] })
    fireEvent.change(screen.getByLabelText('opacity keyframe 1 easing'), { target: { value: 'bezier' } })
    expect(onPatch).toHaveBeenLastCalledWith({ keyframes: [expect.objectContaining({ easing: 'bezier', bezier: [0.42, 0, 0.58, 1] })] })
    fireEvent.click(screen.getByRole('button', { name: 'Remove opacity keyframe 1' }))
    expect(onPatch).toHaveBeenLastCalledWith({ keyframes: undefined })
  })

  it('shows the bezier editor only for bezier keyframes', () => {
    const bezierClip: EditorClip = {
      ...clip,
      keyframes: [{ property: 'volume', atSeconds: 0, value: 1, easing: 'bezier', bezier: [0.3, 0, 0.7, 1] }],
    }
    render(<KeyframeEditor clip={bezierClip} playheadSeconds={10} onPatch={jest.fn()} />)
    expect(screen.getByTestId('bezier-editor')).toBeInTheDocument()
  })
})

describe('BezierCurveEditor', () => {
  it('reports control point changes from the numeric inputs', () => {
    const onChange = jest.fn()
    render(<BezierCurveEditor value={[0.3, 0, 0.7, 1]} onChange={onChange} />)
    fireEvent.change(screen.getByLabelText('P1 x'), { target: { value: '0.5' } })
    expect(onChange).toHaveBeenCalledWith([0.5, 0, 0.7, 1])
  })
})

describe('SpeedRampSection', () => {
  it('applies a preset replacing existing speed keyframes and clears ramps', () => {
    const onPatch = jest.fn()
    const ramped: EditorClip = {
      ...clip,
      keyframes: [
        ...clip.keyframes!,
        { property: 'speed', atSeconds: 0, value: 1 },
        { property: 'speed', atSeconds: 4, value: 2 },
      ],
    }
    render(<SpeedRampSection clip={ramped} onPatch={onPatch} />)
    fireEvent.click(screen.getByRole('button', { name: 'Hero Time' }))
    const applied = onPatch.mock.calls[0][0].keyframes as Array<{ property: string }>
    expect(applied.filter((k) => k.property === 'speed')).toHaveLength(4)
    expect(applied.filter((k) => k.property === 'transform.opacity')).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: 'Clear ramp' }))
    const cleared = onPatch.mock.calls[1][0].keyframes as Array<{ property: string }>
    expect(cleared.every((k) => k.property !== 'speed')).toBe(true)
  })
})
```

- [ ] **Step 11.2: Run tests to verify they fail**

Run: `npx jest __tests__/app/video-editor-keyframe-editor.test.tsx --silent`
Expected: FAIL — components missing.

- [ ] **Step 11.3: Create `components/video-editor/BezierCurveEditor.tsx`:**

```tsx
'use client'

import { useRef } from 'react'

type BezierTuple = [number, number, number, number]

const WIDTH = 160
const HEIGHT = 120

function toSvg(x: number, y: number): { cx: number; cy: number } {
  return { cx: x * WIDTH, cy: HEIGHT - y * HEIGHT }
}

export function BezierCurveEditor({ value, onChange }: { value: BezierTuple; onChange: (next: BezierTuple) => void }) {
  const svgRef = useRef<SVGSVGElement>(null)
  const dragging = useRef<0 | 1 | null>(null)
  const [p1x, p1y, p2x, p2y] = value
  const p1 = toSvg(p1x, p1y)
  const p2 = toSvg(p2x, p2y)

  function pointFromEvent(event: React.PointerEvent): { x: number; y: number } {
    const rect = svgRef.current?.getBoundingClientRect()
    if (!rect) return { x: 0, y: 0 }
    return {
      x: Math.min(Math.max((event.clientX - rect.left) / rect.width, 0), 1),
      y: Math.min(Math.max(1 - (event.clientY - rect.top) / rect.height, -0.5), 1.5),
    }
  }

  function update(index: 0 | 1, x: number, y: number) {
    const next: BezierTuple = index === 0 ? [x, y, p2x, p2y] : [p1x, p1y, x, y]
    onChange(next.map((entry) => Math.round(entry * 100) / 100) as BezierTuple)
  }

  const setField = (index: number) => (event: React.ChangeEvent<HTMLInputElement>) => {
    const num = Number(event.target.value)
    if (!Number.isFinite(num)) return
    const next = [...value] as BezierTuple
    next[index] = num
    onChange(next)
  }

  return (
    <div data-testid="bezier-editor" className="space-y-2">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="h-28 w-full touch-none rounded-lg border border-[var(--color-pib-line)] bg-white/[0.03]"
        onPointerMove={(event) => {
          if (dragging.current === null) return
          const { x, y } = pointFromEvent(event)
          update(dragging.current, x, y)
        }}
        onPointerUp={() => { dragging.current = null }}
        onPointerLeave={() => { dragging.current = null }}
      >
        <path
          d={`M 0 ${HEIGHT} C ${p1.cx} ${p1.cy}, ${p2.cx} ${p2.cy}, ${WIDTH} 0`}
          fill="none"
          stroke="var(--color-pib-primary)"
          strokeWidth="2"
        />
        <line x1={0} y1={HEIGHT} x2={p1.cx} y2={p1.cy} stroke="rgba(255,255,255,0.3)" />
        <line x1={WIDTH} y1={0} x2={p2.cx} y2={p2.cy} stroke="rgba(255,255,255,0.3)" />
        <circle cx={p1.cx} cy={p1.cy} r={6} fill="#fbbf24" className="cursor-grab" onPointerDown={() => { dragging.current = 0 }} />
        <circle cx={p2.cx} cy={p2.cy} r={6} fill="#60a5fa" className="cursor-grab" onPointerDown={() => { dragging.current = 1 }} />
      </svg>
      <div className="grid grid-cols-4 gap-1 text-xs text-on-surface-variant">
        {(['P1 x', 'P1 y', 'P2 x', 'P2 y'] as const).map((label, index) => (
          <label key={label} className="block">
            {label}
            <input
              aria-label={label}
              className="mt-0.5 w-full rounded border border-[var(--color-pib-line)] bg-transparent px-1 py-0.5"
              type="number"
              step="0.05"
              value={value[index]}
              onChange={setField(index)}
            />
          </label>
        ))}
      </div>
    </div>
  )
}
```

- [ ] **Step 11.4: Create `components/video-editor/KeyframeEditor.tsx`:**

```tsx
'use client'

import { EASE_BEZIER } from '@/lib/video-editor/keyframes'
import type { EditorClip, EditorKeyframe, EditorKeyframeProperty } from '@/lib/video-editor/types'
import { BezierCurveEditor } from './BezierCurveEditor'

const LANES: Array<{ property: EditorKeyframeProperty; label: string; step: number; fallback: (clip: EditorClip) => number }> = [
  { property: 'transform.x', label: 'x', step: 1, fallback: (clip) => clip.transform?.x ?? 0 },
  { property: 'transform.y', label: 'y', step: 1, fallback: (clip) => clip.transform?.y ?? 0 },
  { property: 'transform.scale', label: 'scale', step: 0.05, fallback: (clip) => clip.transform?.scale ?? 1 },
  { property: 'transform.rotation', label: 'rotation', step: 1, fallback: (clip) => clip.transform?.rotation ?? 0 },
  { property: 'transform.opacity', label: 'opacity', step: 0.05, fallback: (clip) => clip.transform?.opacity ?? 1 },
  { property: 'volume', label: 'volume', step: 0.05, fallback: (clip) => clip.volume ?? 1 },
]

const EASING_OPTIONS = ['linear', 'ease_in', 'ease_out', 'ease_in_out', 'bezier'] as const

function replaceKeyframes(clip: EditorClip, next: EditorKeyframe[]): { keyframes: EditorKeyframe[] | undefined } {
  const sorted = [...next].sort((a, b) => a.property.localeCompare(b.property) || a.atSeconds - b.atSeconds)
  return { keyframes: sorted.length ? sorted : undefined }
}

export function KeyframeEditor({
  clip,
  playheadSeconds,
  onPatch,
}: {
  clip: EditorClip
  playheadSeconds: number
  onPatch: (patch: Partial<EditorClip>) => void
}) {
  const keyframes = clip.keyframes ?? []
  const clipSeconds = Math.round(Math.min(Math.max(playheadSeconds - clip.timelineStart, 0), clip.duration) * 1000) / 1000

  function addAtPlayhead(lane: (typeof LANES)[number]) {
    const others = keyframes.filter((k) => !(k.property === lane.property && Math.abs(k.atSeconds - clipSeconds) < 0.001))
    onPatch(replaceKeyframes(clip, [...others, { property: lane.property, atSeconds: clipSeconds, value: lane.fallback(clip) }]))
  }

  function updateKeyframe(target: EditorKeyframe, patch: Partial<EditorKeyframe>) {
    onPatch(replaceKeyframes(clip, keyframes.map((k) => (k === target ? { ...k, ...patch } : k))))
  }

  function removeKeyframe(target: EditorKeyframe) {
    onPatch(replaceKeyframes(clip, keyframes.filter((k) => k !== target)))
  }

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold text-on-surface">Keyframes</h3>
      {LANES.map((lane) => {
        const laneFrames = keyframes
          .filter((k) => k.property === lane.property)
          .sort((a, b) => a.atSeconds - b.atSeconds)
        return (
          <div key={lane.property} className="rounded-lg border border-[var(--color-pib-line)] p-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium uppercase text-on-surface-variant">{lane.label}</span>
              <button
                type="button"
                className="pib-btn-ghost text-xs"
                aria-label={`Add ${lane.label} keyframe at playhead`}
                onClick={() => addAtPlayhead(lane)}
              >
                ◆ {clipSeconds}s
              </button>
            </div>
            {laneFrames.map((keyframe, index) => (
              <div key={`${keyframe.atSeconds}-${index}`} className="mt-2 space-y-1 border-t border-[var(--color-pib-line)] pt-2">
                <div className="grid grid-cols-[1fr_1fr_1fr_auto] items-end gap-1 text-xs text-on-surface-variant">
                  <label className="block">
                    at (s)
                    <input aria-label={`${lane.label} keyframe ${index + 1} time`} className="mt-0.5 w-full rounded border border-[var(--color-pib-line)] bg-transparent px-1 py-0.5" type="number" step="0.1" min="0" max={clip.duration} value={keyframe.atSeconds}
                      onChange={(event) => updateKeyframe(keyframe, { atSeconds: Math.min(Math.max(Number(event.target.value), 0), clip.duration) })} />
                  </label>
                  <label className="block">
                    value
                    <input aria-label={`${lane.label} keyframe ${index + 1} value`} className="mt-0.5 w-full rounded border border-[var(--color-pib-line)] bg-transparent px-1 py-0.5" type="number" step={lane.step} value={keyframe.value}
                      onChange={(event) => updateKeyframe(keyframe, { value: Number(event.target.value) })} />
                  </label>
                  <label className="block">
                    easing
                    <select aria-label={`${lane.label} keyframe ${index + 1} easing`} className="mt-0.5 w-full rounded border border-[var(--color-pib-line)] bg-transparent px-1 py-0.5" value={keyframe.easing ?? 'linear'}
                      onChange={(event) => {
                        const easing = event.target.value as EditorKeyframe['easing']
                        updateKeyframe(keyframe, easing === 'bezier'
                          ? { easing, bezier: keyframe.bezier ?? EASE_BEZIER.ease_in_out }
                          : { easing, bezier: undefined })
                      }}>
                      {EASING_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}
                    </select>
                  </label>
                  <button type="button" className="pib-btn-ghost text-xs" aria-label={`Remove ${lane.label} keyframe ${index + 1}`} onClick={() => removeKeyframe(keyframe)}>
                    <span className="material-symbols-rounded text-sm">close</span>
                  </button>
                </div>
                {keyframe.easing === 'bezier' ? (
                  <BezierCurveEditor
                    value={keyframe.bezier ?? EASE_BEZIER.ease_in_out}
                    onChange={(bezier) => updateKeyframe(keyframe, { bezier })}
                  />
                ) : null}
              </div>
            ))}
          </div>
        )
      })}
    </div>
  )
}
```

- [ ] **Step 11.5: Create `components/video-editor/SpeedRampSection.tsx`:**

```tsx
'use client'

import { SPEED_RAMP_PRESETS, hasSpeedRamp } from '@/lib/video-editor/speed-ramps'
import { SPEED_RAMP_PRESET_IDS } from '@/lib/video-editor/types'
import type { EditorClip, EditorKeyframe } from '@/lib/video-editor/types'

export function SpeedRampSection({ clip, onPatch }: { clip: EditorClip; onPatch: (patch: Partial<EditorClip>) => void }) {
  const nonSpeed = (clip.keyframes ?? []).filter((keyframe) => keyframe.property !== 'speed')

  function apply(keyframes: EditorKeyframe[]) {
    const merged = [...nonSpeed, ...keyframes]
      .sort((a, b) => a.property.localeCompare(b.property) || a.atSeconds - b.atSeconds)
    onPatch({ keyframes: merged.length ? merged : undefined })
  }

  return (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold text-on-surface">Speed ramp</h3>
      <div className="flex flex-wrap gap-1">
        {SPEED_RAMP_PRESET_IDS.map((id) => (
          <button
            key={id}
            type="button"
            className="pib-btn-ghost text-xs"
            title={SPEED_RAMP_PRESETS[id].description}
            onClick={() => apply(SPEED_RAMP_PRESETS[id].build(clip.duration))}
          >
            {SPEED_RAMP_PRESETS[id].label}
          </button>
        ))}
        <button type="button" className="pib-btn-ghost text-xs" disabled={!hasSpeedRamp(clip)} onClick={() => apply([])}>
          Clear ramp
        </button>
      </div>
      <p className="text-xs text-on-surface-variant">
        Presets write <code>speed</code> keyframes — fine-tune them (including custom bezier curves) in the Keyframes panel above. Audio pitch is preserved on render.
      </p>
    </div>
  )
}
```

- [ ] **Step 11.6: Mount in the Inspector** — in `components/video-editor/InspectorPanel.tsx`, change the signature and add the sections after the Speed slider:

```tsx
import { KeyframeEditor } from './KeyframeEditor'
import { SpeedRampSection } from './SpeedRampSection'

export function InspectorPanel({
  clip,
  playheadSeconds,
  onPatch,
}: {
  clip: EditorClip | null
  playheadSeconds: number
  onPatch: (patch: Partial<EditorClip>) => void
}) {
```

…and inside the returned `<section>`, after the Speed `<label>` block:

```tsx
      {clip.media ? <SpeedRampSection clip={clip} onPatch={onPatch} /> : null}
      <KeyframeEditor clip={clip} playheadSeconds={playheadSeconds} onPatch={onPatch} />
```

In `VideoEditorShell.tsx`, update the usage: `<InspectorPanel clip={selectedClip} playheadSeconds={playhead} onPatch={patchSelected} />`.

- [ ] **Step 11.7: Run tests to verify they pass**

Run: `npx jest __tests__/app/video-editor-keyframe-editor.test.tsx __tests__/app/ --silent && npm run typecheck`
Expected: PASS + clean typecheck.

- [ ] **Step 11.8: Commit**

```bash
git add components/video-editor/KeyframeEditor.tsx components/video-editor/BezierCurveEditor.tsx components/video-editor/SpeedRampSection.tsx components/video-editor/InspectorPanel.tsx components/video-editor/VideoEditorShell.tsx __tests__/app/video-editor-keyframe-editor.test.tsx
git commit -m "feat(video-editor): keyframe lanes, bezier curve editor and speed ramp presets in the inspector"
```

---

## Task 12: PreviewPlayer — real clip rendering with keyframe interpolation + proxies

**Files:**
- Modify: `components/video-editor/PreviewPlayer.tsx`
- Modify: `components/video-editor/VideoEditorShell.tsx` (pass `mediaPreviews`)
- Test: `__tests__/app/video-editor-preview-player.test.tsx` (create)

The preview stays an approximation (no compositing pipeline): active visual clips render as absolutely-positioned `<video>`/`<img>` elements with CSS transforms/opacity computed by `clipTransformAt`, audio volume via `clipVolumeAt`, sources swapped to 540p proxies when available, and ramped clips seek via `sourceOffsetAt` with `playbackRate = speedAt` while playing.

- [ ] **Step 12.1: Write the failing tests** — create `__tests__/app/video-editor-preview-player.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import { PreviewPlayer, visibleClipsAt } from '@/components/video-editor/PreviewPlayer'
import type { EditorTimeline, VideoEditorMediaPreview } from '@/lib/video-editor/types'

const timeline: EditorTimeline = {
  version: 1,
  tracks: [
    {
      id: 'v1',
      kind: 'video',
      clips: [{
        id: 'c1', timelineStart: 0, duration: 4, trimStart: 1,
        media: { type: 'upload', fileId: 'f1', url: 'https://x.test/original.mp4', mediaKind: 'video' },
        keyframes: [
          { property: 'transform.opacity', atSeconds: 0, value: 1 },
          { property: 'transform.opacity', atSeconds: 4, value: 0 },
        ],
      }],
    },
    { id: 't1', kind: 'text', clips: [{ id: 'x1', timelineStart: 0, duration: 2, text: { content: 'Hello', fontSizePx: 48, color: '#fff', align: 'center', animationPreset: 'none' } }] },
  ],
}

const settings = { width: 1920, height: 1080, fps: 30 as const, aspect: '16:9' as const, background: '#000000' }

const previews: Record<string, VideoEditorMediaPreview> = {
  'upload:f1': {
    orgId: 'o', mediaKey: 'upload:f1', sourceUrl: 'https://x.test/original.mp4', mediaKind: 'video', status: 'ready', deleted: false,
    proxy: { url: 'https://x.test/proxy-540.mp4', storagePath: 'p', sizeBytes: 1, width: 960, height: 540 },
  },
}

describe('visibleClipsAt', () => {
  it('returns visual clips under the playhead with their track kind', () => {
    expect(visibleClipsAt(timeline, 1).map((entry) => entry.clip.id)).toEqual(['c1', 'x1'])
    expect(visibleClipsAt(timeline, 3).map((entry) => entry.clip.id)).toEqual(['c1'])
    expect(visibleClipsAt(timeline, 9)).toEqual([])
  })
})

describe('PreviewPlayer', () => {
  it('renders active video clips through their proxy URL with keyframed opacity', () => {
    render(<PreviewPlayer timeline={timeline} settings={settings} mediaPreviews={previews} playheadSeconds={2} playing={false} onPlayToggle={jest.fn()} onSeek={jest.fn()} />)
    const video = screen.getByTestId('preview-video-c1') as HTMLVideoElement
    expect(video.src).toBe('https://x.test/proxy-540.mp4')
    expect(video.parentElement?.style.opacity).toBe('0.5')
  })

  it('falls back to the original URL without a proxy and shows active text', () => {
    render(<PreviewPlayer timeline={timeline} settings={settings} mediaPreviews={{}} playheadSeconds={1} playing={false} onPlayToggle={jest.fn()} onSeek={jest.fn()} />)
    expect((screen.getByTestId('preview-video-c1') as HTMLVideoElement).src).toBe('https://x.test/original.mp4')
    expect(screen.getByText('Hello')).toBeInTheDocument()
  })
})
```

- [ ] **Step 12.2: Run tests to verify they fail**

Run: `npx jest __tests__/app/video-editor-preview-player.test.tsx --silent`
Expected: FAIL — `visibleClipsAt` not exported.

- [ ] **Step 12.3: Rewrite `components/video-editor/PreviewPlayer.tsx`:**

```tsx
'use client'

import { useEffect, useRef } from 'react'
import { clipTransformAt, clipVolumeAt } from '@/lib/video-editor/keyframes'
import { mediaKeyForRef } from '@/lib/video-editor/media-previews'
import { sourceOffsetAt, speedAt } from '@/lib/video-editor/speed-ramps'
import type { EditorClip, EditorTimeline, EditorTrack, VideoEditorMediaPreview, VideoEditorProjectSettings } from '@/lib/video-editor/types'

export interface VisibleClip {
  track: EditorTrack
  clip: EditorClip
  /** Playhead in clip-relative seconds. */
  clipSeconds: number
}

/** Visual clips (video/overlay media + text anywhere) under the playhead, stacked top track last. */
export function visibleClipsAt(timeline: EditorTimeline, seconds: number): VisibleClip[] {
  const result: VisibleClip[] = []
  for (const track of timeline.tracks) {
    for (const clip of track.clips) {
      const within = seconds >= clip.timelineStart && seconds <= clip.timelineStart + clip.duration
      if (!within) continue
      const visualMedia = clip.media && clip.media.mediaKind !== 'audio' && (track.kind === 'video' || track.kind === 'overlay')
      const isText = Boolean(clip.text) && (track.kind === 'text' || track.kind === 'overlay')
      if (visualMedia || isText) result.push({ track, clip, clipSeconds: seconds - clip.timelineStart })
    }
  }
  return result
}

function SeekingVideo({ clip, clipSeconds, playing, src, volume, muted }: {
  clip: EditorClip
  clipSeconds: number
  playing: boolean
  src: string
  volume: number
  muted: boolean
}) {
  const ref = useRef<HTMLVideoElement>(null)

  useEffect(() => {
    const video = ref.current
    if (!video) return
    const want = (clip.trimStart ?? 0) + sourceOffsetAt(clip, clipSeconds)
    if (Math.abs(video.currentTime - want) > 0.2) video.currentTime = want
    video.volume = Math.min(Math.max(volume, 0), 1)
    video.muted = muted || volume <= 0
    if (playing) {
      video.playbackRate = Math.min(Math.max(speedAt(clip, clipSeconds), 0.25), 4)
      void video.play().catch(() => {})
    } else {
      video.pause()
    }
  }, [clip, clipSeconds, playing, volume, muted])

  return <video ref={ref} data-testid={`preview-video-${clip.id}`} src={src} className="h-full w-full object-contain" playsInline preload="auto" />
}

export function PreviewPlayer({
  timeline,
  settings,
  mediaPreviews,
  playheadSeconds,
  playing,
  onPlayToggle,
  onSeek,
}: {
  timeline: EditorTimeline
  settings: VideoEditorProjectSettings
  mediaPreviews: Record<string, VideoEditorMediaPreview>
  playheadSeconds: number
  playing: boolean
  onPlayToggle: () => void
  onSeek: (seconds: number) => void
}) {
  const duration = Math.max(1, ...timeline.tracks.flatMap((track) => track.clips.map((clip) => clip.timelineStart + clip.duration)))
  const visible = visibleClipsAt(timeline, playheadSeconds)

  return (
    <section className="pib-card-section space-y-3 p-4">
      <div className="relative overflow-hidden rounded-lg border border-[var(--color-pib-line)]" style={{ aspectRatio: `${settings.width}/${settings.height}`, background: settings.background || '#000' }}>
        {visible.length === 0 ? (
          <div className="absolute inset-0 grid place-items-center text-sm text-white/50">Preview canvas</div>
        ) : null}
        {visible.map(({ track, clip, clipSeconds }) => {
          const transform = clipTransformAt(clip, clipSeconds)
          const style: React.CSSProperties = {
            transform: [
              `translate(-50%, -50%)`,
              `translate(${(transform.x / settings.width) * 100}%, ${(transform.y / settings.height) * 100}%)`,
              `scale(${transform.scale})`,
              `rotate(${transform.rotation}deg)`,
            ].join(' '),
            opacity: transform.opacity,
          }
          if (clip.media) {
            const key = mediaKeyForRef(clip.media)
            const src = mediaPreviews[key]?.proxy?.url ?? clip.media.url
            return (
              <div key={clip.id} className="absolute left-1/2 top-1/2 h-full w-full" style={style}>
                {clip.media.mediaKind === 'image' ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img data-testid={`preview-image-${clip.id}`} src={src} alt="" className="h-full w-full object-contain" />
                ) : (
                  <SeekingVideo clip={clip} clipSeconds={clipSeconds} playing={playing} src={src} volume={clipVolumeAt(clip, clipSeconds)} muted={Boolean(track.muted)} />
                )}
              </div>
            )
          }
          return (
            <div key={clip.id} className="absolute left-1/2 top-1/2" style={style}>
              <span
                className="block max-w-[80vw] whitespace-pre-wrap font-bold text-white"
                style={{ fontSize: `${(clip.text!.fontSizePx / settings.height) * 100}%`, color: clip.text!.color, textAlign: clip.text!.align, backgroundColor: clip.text!.backgroundColor }}
              >
                {clip.text!.content}
              </span>
            </div>
          )
        })}
      </div>
      <div className="flex items-center gap-3">
        <button type="button" className="pib-btn-primary text-sm" onClick={onPlayToggle} aria-label={playing ? 'Pause preview' : 'Play preview'}>
          <span className="material-symbols-rounded text-base">{playing ? 'pause' : 'play_arrow'}</span>
        </button>
        <input className="w-full" type="range" min={0} max={duration} step={0.1} value={playheadSeconds} onChange={(event) => onSeek(Number(event.target.value))} />
        <span className="w-16 text-right text-xs text-on-surface-variant">{playheadSeconds.toFixed(1)}s</span>
      </div>
    </section>
  )
}
```

(The translate offsets are percentages of the full-bleed wrapper, approximating the project's pixel space; the ffmpeg render remains ground truth.)

In `VideoEditorShell.tsx`, pass the map: `<PreviewPlayer timeline={timeline} settings={settings} mediaPreviews={mediaPreviews} playheadSeconds={playhead} playing={playing} onPlayToggle={() => setPlaying((value) => !value)} onSeek={setPlayhead} />`.

- [ ] **Step 12.4: Run tests to verify they pass**

Run: `npx jest __tests__/app/video-editor-preview-player.test.tsx __tests__/app/ --silent && npm run typecheck`
Expected: PASS + clean typecheck. If jsdom complains about `HTMLMediaElement.play`, add to the test file top: `Object.defineProperty(HTMLMediaElement.prototype, 'play', { configurable: true, value: jest.fn().mockResolvedValue(undefined) })` and a matching `pause` stub.

- [ ] **Step 12.5: Commit**

```bash
git add components/video-editor/PreviewPlayer.tsx components/video-editor/VideoEditorShell.tsx __tests__/app/video-editor-preview-player.test.tsx
git commit -m "feat(video-editor): preview renders real media with keyframe interpolation, ramps and proxies"
```

---

## Task 13: Media previews — sanitizer, server ensure, dispatch, API routes, ledger, index

**Files:**
- Modify: `lib/video-editor/media-previews.ts` (append sanitizer)
- Create: `lib/video-editor/media-previews-server.ts`
- Modify: `lib/video-editor/dispatch.ts`
- Modify: `lib/video-editor/sanitize.ts` (export the existing private `sanitizeMediaRef`)
- Modify: `lib/video-editor/register-outputs.ts`
- Create: `app/api/v1/video-editor/media-previews/route.ts`
- Create: `app/api/v1/video-editor/media-previews/[id]/route.ts`
- Create: `app/api/v1/video-editor/proxy-ledger/route.ts`
- Create: `app/api/v1/video-editor/proxy-ledger/[id]/route.ts`
- Modify: `firestore.indexes.json`
- Test: `__tests__/lib/video-editor-media-previews.test.ts`

- [ ] **Step 13.1: Write the failing pure-unit tests** — create `__tests__/lib/video-editor-media-previews.test.ts`:

```ts
import { mediaKeyForRef, sanitizeMediaPreviewReportInput } from '@/lib/video-editor/media-previews'

describe('mediaKeyForRef', () => {
  it('is deterministic per ref type', () => {
    expect(mediaKeyForRef({ type: 'upload', fileId: 'f1', url: 'https://x.test/a.mp4', mediaKind: 'video' })).toBe('upload:f1')
    expect(mediaKeyForRef({ type: 'youtube_source_asset', sourceAssetId: 's1', url: 'https://x.test/a.mp4', mediaKind: 'video' })).toBe('yt:s1')
    expect(mediaKeyForRef({ type: 'canvas_output', canvasId: 'c', nodeId: 'n', runId: 'r', url: 'https://x.test/a.mp4', mediaKind: 'video' })).toBe('canvas:c:n:r')
  })
})

describe('sanitizeMediaPreviewReportInput', () => {
  it('accepts a full ready report', () => {
    const patch = sanitizeMediaPreviewReportInput({
      status: 'ready',
      waveform: { url: 'https://x.test/w.json', storagePath: 'p/w.json', peaksPerSecond: 20, peakCount: 80, junk: true },
      filmstrip: { url: 'https://x.test/f.jpg', storagePath: 'p/f.jpg', frameIntervalSeconds: 2, frameWidth: 160, frameHeight: 90, frameCount: 10 },
      proxy: { url: 'https://x.test/p.mp4', storagePath: 'p/p.mp4', sizeBytes: 1234, width: 960, height: 540 },
    })
    expect(patch.status).toBe('ready')
    expect(patch.waveform).toEqual({ url: 'https://x.test/w.json', storagePath: 'p/w.json', peaksPerSecond: 20, peakCount: 80 })
    expect(patch.proxy?.sizeBytes).toBe(1234)
  })

  it('rejects invalid statuses, http urls and partial artifacts', () => {
    expect(sanitizeMediaPreviewReportInput({ status: 'exploded' }).status).toBeUndefined()
    expect(sanitizeMediaPreviewReportInput({ status: 'ready', proxy: { url: 'http://x.test/p.mp4', storagePath: 'p', sizeBytes: 1, width: 1, height: 1 } }).proxy).toBeUndefined()
    expect(sanitizeMediaPreviewReportInput({ status: 'ready', waveform: { url: 'https://x.test/w.json' } }).waveform).toBeUndefined()
    expect(sanitizeMediaPreviewReportInput({ status: 'failed', error: { message: 'boom' } }).error).toEqual({ code: 'preview_failed', message: 'boom' })
  })
})
```

- [ ] **Step 13.2: Run tests to verify they fail**

Run: `npx jest __tests__/lib/video-editor-media-previews.test.ts --silent`
Expected: FAIL — `sanitizeMediaPreviewReportInput` missing.

- [ ] **Step 13.3: Append the sanitizer** to `lib/video-editor/media-previews.ts`:

```ts
import { MEDIA_PREVIEW_STATUSES } from './types'
import type {
  MediaPreviewFilmstrip,
  MediaPreviewProxy,
  MediaPreviewWaveform,
  VideoEditorMediaPreviewStatus,
} from './types'

type PlainRecord = Record<string, unknown>

const clean = (value: unknown): PlainRecord =>
  (value && typeof value === 'object' && !Array.isArray(value) ? (value as PlainRecord) : {})
const str = (value: unknown): string | undefined =>
  (typeof value === 'string' && value.trim() ? value.trim() : undefined)
const num = (value: unknown): number | undefined =>
  (typeof value === 'number' && Number.isFinite(value) ? value : undefined)
const httpsUrl = (value: unknown): string | undefined => {
  const url = str(value)
  return url && /^https:\/\//.test(url) ? url : undefined
}

export interface MediaPreviewReportPatch {
  status?: VideoEditorMediaPreviewStatus
  waveform?: MediaPreviewWaveform
  filmstrip?: MediaPreviewFilmstrip
  proxy?: MediaPreviewProxy
  error?: { code: string; message: string }
}

export function sanitizeMediaPreviewReportInput(value: unknown): MediaPreviewReportPatch {
  const source = clean(value)
  const patch: MediaPreviewReportPatch = {}
  if (MEDIA_PREVIEW_STATUSES.includes(source.status as VideoEditorMediaPreviewStatus)) {
    patch.status = source.status as VideoEditorMediaPreviewStatus
  }
  const waveform = clean(source.waveform)
  const waveformUrl = httpsUrl(waveform.url)
  const waveformPath = str(waveform.storagePath)
  const peaksPerSecond = num(waveform.peaksPerSecond)
  const peakCount = num(waveform.peakCount)
  if (waveformUrl && waveformPath && peaksPerSecond && peakCount) {
    patch.waveform = { url: waveformUrl, storagePath: waveformPath, peaksPerSecond, peakCount }
  }
  const filmstrip = clean(source.filmstrip)
  const filmstripUrl = httpsUrl(filmstrip.url)
  const filmstripPath = str(filmstrip.storagePath)
  const frameIntervalSeconds = num(filmstrip.frameIntervalSeconds)
  const frameWidth = num(filmstrip.frameWidth)
  const frameHeight = num(filmstrip.frameHeight)
  const frameCount = num(filmstrip.frameCount)
  if (filmstripUrl && filmstripPath && frameIntervalSeconds && frameWidth && frameHeight && frameCount) {
    patch.filmstrip = { url: filmstripUrl, storagePath: filmstripPath, frameIntervalSeconds, frameWidth, frameHeight, frameCount }
  }
  const proxy = clean(source.proxy)
  const proxyUrl = httpsUrl(proxy.url)
  const proxyPath = str(proxy.storagePath)
  const sizeBytes = num(proxy.sizeBytes)
  const width = num(proxy.width)
  const height = num(proxy.height)
  if (proxyUrl && proxyPath && sizeBytes && width && height) {
    patch.proxy = { url: proxyUrl, storagePath: proxyPath, sizeBytes, width, height }
  }
  const error = clean(source.error)
  const message = str(error.message)
  if (message) patch.error = { code: str(error.code) ?? 'preview_failed', message: message.slice(0, 2000) }
  return patch
}
```

Run: `npx jest __tests__/lib/video-editor-media-previews.test.ts --silent` — PASS.

- [ ] **Step 13.4: Extend `lib/video-editor/dispatch.ts`** — add to `VideoEditorRuntimeConfig` and the env reader:

```ts
export interface VideoEditorRuntimeConfig {
  submitUrl?: string
  previewSubmitUrl?: string
  apiKey?: string
  callbackBaseUrl?: string
}
```

…and inside `videoEditorRuntimeConfigFromEnv`, after `submitUrl`:

```ts
  const previewSubmitUrl = cleanString(env.VIDEO_EDITOR_PREVIEW_SUBMIT_URL)
    ?? (baseUrl ? `${baseUrl}/video-editor/media-previews` : undefined)
```

…and spread it into the return: `...(previewSubmitUrl ? { previewSubmitUrl } : {}),`

Append the manifest builder + dispatcher:

```ts
export const VIDEO_EDITOR_PROXY_CAP_BYTES = Number(process.env.VIDEO_EDITOR_PROXY_CAP_BYTES || 20 * 1024 * 1024 * 1024)

export interface VideoEditorMediaPreviewManifest {
  kind: 'video_editor_media_preview'
  preview: { id: string; orgId: string; mediaKey: string; url: string; mediaKind: string }
  options: { waveform: boolean; filmstrip: boolean; proxy: boolean }
  report: { method: 'PUT'; path: string }
  upload: { method: 'POST'; path: '/api/v1/upload'; folder: string }
  proxyLedger: { listPath: string; deletePathTemplate: string; capBytes: number }
}

export function buildMediaPreviewManifest(input: {
  previewId: string
  orgId: string
  mediaKey: string
  url: string
  mediaKind: string
}): VideoEditorMediaPreviewManifest {
  const org = encodeURIComponent(input.orgId)
  const isVideo = input.mediaKind === 'video'
  const isAudio = input.mediaKind === 'audio'
  return {
    kind: 'video_editor_media_preview',
    preview: { id: input.previewId, orgId: input.orgId, mediaKey: input.mediaKey, url: input.url, mediaKind: input.mediaKind },
    options: { waveform: isVideo || isAudio, filmstrip: isVideo, proxy: isVideo },
    report: { method: 'PUT', path: `/api/v1/video-editor/media-previews/${input.previewId}?orgId=${org}` },
    upload: { method: 'POST', path: '/api/v1/upload', folder: `video-editor/${input.orgId}/previews` },
    proxyLedger: {
      listPath: `/api/v1/video-editor/proxy-ledger?orgId=${org}`,
      deletePathTemplate: `/api/v1/video-editor/proxy-ledger/{id}?orgId=${org}`,
      capBytes: VIDEO_EDITOR_PROXY_CAP_BYTES,
    },
  }
}

export async function dispatchMediaPreviewJob(
  manifest: VideoEditorMediaPreviewManifest,
  config: VideoEditorRuntimeConfig,
): Promise<{ providerJobId: string }> {
  if (!config.previewSubmitUrl) {
    throw new Error('Media preview runtime is not configured (set HIGGSFIELD_RUNTIME_URL or VIDEO_EDITOR_PREVIEW_SUBMIT_URL)')
  }
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (config.apiKey) headers.Authorization = `Bearer ${config.apiKey}`
  const response = await fetch(config.previewSubmitUrl, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      ...manifest,
      callback: { url: config.callbackBaseUrl ? `${config.callbackBaseUrl}/api/v1/video-editor/media-previews/${manifest.preview.id}` : undefined },
    }),
  })
  const text = await response.text().catch(() => '')
  if (!response.ok) throw new Error(`Executor rejected the preview job (${response.status}): ${text.slice(0, 300)}`)
  let body: Record<string, unknown> = {}
  try { body = JSON.parse(text) as Record<string, unknown> } catch { body = {} }
  const providerJobId = typeof body.providerJobId === 'string' ? body.providerJobId : ''
  if (!providerJobId) throw new Error('Executor accepted the preview job but returned no providerJobId')
  return { providerJobId }
}
```

Add unit coverage to `__tests__/lib/video-editor-dispatch.test.ts` (append):

```ts
import { buildMediaPreviewManifest } from '@/lib/video-editor/dispatch'

describe('buildMediaPreviewManifest', () => {
  it('enables artifacts per media kind and carries the ledger endpoints', () => {
    const video = buildMediaPreviewManifest({ previewId: 'pv1', orgId: 'org 1', mediaKey: 'upload:f1', url: 'https://x.test/a.mp4', mediaKind: 'video' })
    expect(video.options).toEqual({ waveform: true, filmstrip: true, proxy: true })
    expect(video.report.path).toBe('/api/v1/video-editor/media-previews/pv1?orgId=org%201')
    expect(video.proxyLedger.deletePathTemplate).toBe('/api/v1/video-editor/proxy-ledger/{id}?orgId=org%201')
    const audio = buildMediaPreviewManifest({ previewId: 'pv2', orgId: 'o', mediaKey: 'upload:f2', url: 'https://x.test/a.mp3', mediaKind: 'audio' })
    expect(audio.options).toEqual({ waveform: true, filmstrip: false, proxy: false })
  })
})
```

Run: `npx jest __tests__/lib/video-editor-dispatch.test.ts --silent` — PASS.

- [ ] **Step 13.5: Create `lib/video-editor/media-previews-server.ts`:**

First, in `lib/video-editor/sanitize.ts`, change `function sanitizeMediaRef` to `export function sanitizeMediaRef` (no other change).

```ts
import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import type { ApiUser } from '@/lib/api/auth'
import { actorFields } from '@/lib/youtube-studio/api'
import {
  buildMediaPreviewManifest,
  dispatchMediaPreviewJob,
  videoEditorRuntimeConfigFromEnv,
} from './dispatch'
import { mediaKeyForRef } from './media-previews'
import { VIDEO_EDITOR_PREVIEW_COLLECTIONS } from './types'
import type { MediaRef, VideoEditorMediaPreview } from './types'

/**
 * Idempotently make sure a preview record exists (and a preview job is running)
 * for every media ref. Image refs are marked 'skipped' (nothing to generate).
 * Dispatch failures mark the record 'failed' — the editor still works, it just
 * shows originals without waveforms/filmstrips/proxies.
 */
export async function ensureMediaPreviews(
  orgId: string,
  refs: MediaRef[],
  user: ApiUser,
): Promise<Array<VideoEditorMediaPreview & { id: string }>> {
  const collection = adminDb.collection(VIDEO_EDITOR_PREVIEW_COLLECTIONS.mediaPreviews)
  const results: Array<VideoEditorMediaPreview & { id: string }> = []
  const seen = new Set<string>()

  for (const media of refs) {
    const mediaKey = mediaKeyForRef(media)
    if (seen.has(mediaKey)) continue
    seen.add(mediaKey)

    const existing = await collection
      .where('orgId', '==', orgId)
      .where('mediaKey', '==', mediaKey)
      .limit(1)
      .get()
    if (!existing.empty) {
      const doc = existing.docs[0]
      results.push({ id: doc.id, ...(doc.data() as VideoEditorMediaPreview) })
      continue
    }

    const record: VideoEditorMediaPreview = {
      orgId,
      mediaKey,
      sourceUrl: media.url,
      mediaKind: media.mediaKind,
      status: media.mediaKind === 'image' ? 'skipped' : 'pending',
      deleted: false,
    }
    const ref = await collection.add({
      ...record,
      ...actorFields(user),
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    })

    if (record.status === 'pending') {
      try {
        await dispatchMediaPreviewJob(
          buildMediaPreviewManifest({ previewId: ref.id, orgId, mediaKey, url: media.url, mediaKind: media.mediaKind }),
          videoEditorRuntimeConfigFromEnv(),
        )
      } catch (error) {
        record.status = 'failed'
        record.error = { code: 'dispatch_failed', message: error instanceof Error ? error.message : 'dispatch failed' }
        await ref.set({ status: 'failed', error: record.error, updatedAt: FieldValue.serverTimestamp() }, { merge: true })
      }
    }
    results.push({ id: ref.id, ...record })
  }
  return results
}
```

- [ ] **Step 13.6: Create the four routes.**

`app/api/v1/video-editor/media-previews/route.ts`:

```ts
import { NextRequest } from 'next/server'
import { FieldValue, Timestamp } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { apiError, apiSuccess } from '@/lib/api/response'
import { ensureOrgAccess } from '@/lib/youtube-studio/api'
import { ensureMediaPreviews } from '@/lib/video-editor/media-previews-server'
import { sanitizeMediaRef, serializeVideoEditorRecord } from '@/lib/video-editor/sanitize'
import { VIDEO_EDITOR_PREVIEW_COLLECTIONS } from '@/lib/video-editor/types'
import type { MediaRef, VideoEditorMediaPreview } from '@/lib/video-editor/types'

export const dynamic = 'force-dynamic'

const LEDGER_TOUCH_MIN_AGE_MS = 60 * 60 * 1000

export const POST = withAuth('client', async (req: NextRequest, user) => {
  const body = await req.json().catch(() => ({}))
  const orgId = typeof body.orgId === 'string' && body.orgId.trim()
    ? body.orgId.trim()
    : new URL(req.url).searchParams.get('orgId') ?? ''
  if (!orgId) return apiError('orgId is required', 400)
  const denied = await ensureOrgAccess(user, orgId)
  if (denied) return denied
  const refs = (Array.isArray(body.refs) ? body.refs : [])
    .map((entry: unknown) => sanitizeMediaRef(entry))
    .filter((entry: MediaRef | undefined): entry is MediaRef => Boolean(entry))
  if (!refs.length) return apiError('At least one valid media ref is required', 400)
  if (refs.length > 50) return apiError('Too many refs (max 50 per call)', 400)
  const previews = await ensureMediaPreviews(orgId, refs, user)
  return apiSuccess({ previews })
})

export const GET = withAuth('client', async (req: NextRequest, user) => {
  const url = new URL(req.url)
  const orgId = url.searchParams.get('orgId') ?? ''
  if (!orgId) return apiError('orgId is required', 400)
  const denied = await ensureOrgAccess(user, orgId)
  if (denied) return denied
  const keys = (url.searchParams.get('keys') ?? '').split(',').map((key) => key.trim()).filter(Boolean).slice(0, 100)

  const collection = adminDb.collection(VIDEO_EDITOR_PREVIEW_COLLECTIONS.mediaPreviews)
  let docs
  if (keys.length) {
    docs = []
    for (let i = 0; i < keys.length; i += 10) {
      const chunk = await collection.where('orgId', '==', orgId).where('mediaKey', 'in', keys.slice(i, i + 10)).get()
      docs.push(...chunk.docs)
    }
  } else {
    docs = (await collection.where('orgId', '==', orgId).limit(200).get()).docs
  }

  const previews = docs
    .filter((doc) => doc.data().deleted !== true)
    .map((doc) => serializeVideoEditorRecord<VideoEditorMediaPreview>(doc.id, doc.data()))

  // LRU touch: previews with a proxy that were last accessed over an hour ago.
  const ledger = adminDb.collection(VIDEO_EDITOR_PREVIEW_COLLECTIONS.proxyLedger)
  const cutoffMillis = Date.now() - LEDGER_TOUCH_MIN_AGE_MS
  await Promise.all(previews.filter((preview) => preview.proxy).map(async (preview) => {
    const entry = await ledger.doc(preview.id).get()
    const lastAccessAt = entry.get('lastAccessAt') as Timestamp | undefined
    if (entry.exists && (!lastAccessAt || lastAccessAt.toMillis() < cutoffMillis)) {
      await entry.ref.set({ lastAccessAt: FieldValue.serverTimestamp() }, { merge: true })
    }
  }))

  return apiSuccess({ previews })
})
```

`app/api/v1/video-editor/media-previews/[id]/route.ts` (executor report — mirrors the render-jobs PUT auth pattern):

```ts
import { NextRequest } from 'next/server'
import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { apiError, apiSuccess } from '@/lib/api/response'
import { ensureOrgAccess, loadScopedRecord, updateActorFields } from '@/lib/youtube-studio/api'
import { sanitizeMediaPreviewReportInput } from '@/lib/video-editor/media-previews'
import { serializeVideoEditorRecord } from '@/lib/video-editor/sanitize'
import { VIDEO_EDITOR_PREVIEW_COLLECTIONS } from '@/lib/video-editor/types'
import type { VideoEditorMediaPreview } from '@/lib/video-editor/types'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ id: string }> }

export const GET = withAuth('client', async (_req: NextRequest, user, context) => {
  const { id } = await (context as RouteContext).params
  const loaded = await loadScopedRecord(VIDEO_EDITOR_PREVIEW_COLLECTIONS.mediaPreviews, id)
  if (!loaded || loaded.data.deleted === true) return apiError('Media preview not found', 404)
  const denied = await ensureOrgAccess(user, String(loaded.data.orgId ?? ''))
  if (denied) return denied
  return apiSuccess({ preview: serializeVideoEditorRecord<VideoEditorMediaPreview>(loaded.id, loaded.data) })
})

export const PUT = withAuth('client', async (req: NextRequest, user, context) => {
  const { id } = await (context as RouteContext).params
  const loaded = await loadScopedRecord(VIDEO_EDITOR_PREVIEW_COLLECTIONS.mediaPreviews, id)
  if (!loaded || loaded.data.deleted === true) return apiError('Media preview not found', 404)
  const orgId = String(loaded.data.orgId ?? '')
  const denied = await ensureOrgAccess(user, orgId)
  if (denied) return denied

  const body = await req.json().catch(() => ({}))
  const patch = sanitizeMediaPreviewReportInput(body)
  if (!patch.status && !patch.waveform && !patch.filmstrip && !patch.proxy) {
    return apiError('A valid status or artifact payload is required', 400)
  }

  await loaded.ref.set({
    ...(patch.status ? { status: patch.status } : {}),
    ...(patch.waveform ? { waveform: patch.waveform } : {}),
    ...(patch.filmstrip ? { filmstrip: patch.filmstrip } : {}),
    ...(patch.proxy ? { proxy: patch.proxy } : {}),
    ...(patch.error ? { error: patch.error } : {}),
    ...updateActorFields(user),
  }, { merge: true })

  if (patch.proxy) {
    await adminDb.collection(VIDEO_EDITOR_PREVIEW_COLLECTIONS.proxyLedger).doc(id).set({
      orgId,
      mediaKey: String(loaded.data.mediaKey ?? ''),
      previewId: id,
      storagePath: patch.proxy.storagePath,
      sizeBytes: patch.proxy.sizeBytes,
      lastAccessAt: FieldValue.serverTimestamp(),
      createdAt: FieldValue.serverTimestamp(),
    }, { merge: true })
  }
  return apiSuccess({ id, status: patch.status ?? String(loaded.data.status ?? '') })
})
```

`app/api/v1/video-editor/proxy-ledger/route.ts`:

```ts
import { NextRequest } from 'next/server'
import { adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { apiError, apiSuccess } from '@/lib/api/response'
import { ensureOrgAccess } from '@/lib/youtube-studio/api'
import { serializeVideoEditorRecord } from '@/lib/video-editor/sanitize'
import { VIDEO_EDITOR_PREVIEW_COLLECTIONS } from '@/lib/video-editor/types'
import type { VideoEditorProxyLedgerEntry } from '@/lib/video-editor/types'

export const dynamic = 'force-dynamic'

export const GET = withAuth('client', async (req: NextRequest, user) => {
  const orgId = new URL(req.url).searchParams.get('orgId') ?? ''
  if (!orgId) return apiError('orgId is required', 400)
  const denied = await ensureOrgAccess(user, orgId)
  if (denied) return denied
  const snapshot = await adminDb.collection(VIDEO_EDITOR_PREVIEW_COLLECTIONS.proxyLedger)
    .where('orgId', '==', orgId)
    .orderBy('lastAccessAt', 'asc')
    .limit(500)
    .get()
  const entries = snapshot.docs.map((doc) => serializeVideoEditorRecord<VideoEditorProxyLedgerEntry>(doc.id, doc.data()))
  const totalBytes = entries.reduce((sum, entry) => sum + (typeof entry.sizeBytes === 'number' ? entry.sizeBytes : 0), 0)
  return apiSuccess({ entries, totalBytes })
})
```

`app/api/v1/video-editor/proxy-ledger/[id]/route.ts`:

```ts
import { NextRequest } from 'next/server'
import { FieldValue } from 'firebase-admin/firestore'
import { getStorage } from 'firebase-admin/storage'
import { adminDb } from '@/lib/firebase/admin'
import { getAdminApp } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { apiError, apiSuccess } from '@/lib/api/response'
import { ensureOrgAccess, loadScopedRecord } from '@/lib/youtube-studio/api'
import { VIDEO_EDITOR_PREVIEW_COLLECTIONS } from '@/lib/video-editor/types'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ id: string }> }

export const DELETE = withAuth('client', async (_req: NextRequest, user, context) => {
  const { id } = await (context as RouteContext).params
  const loaded = await loadScopedRecord(VIDEO_EDITOR_PREVIEW_COLLECTIONS.proxyLedger, id)
  if (!loaded) return apiError('Proxy ledger entry not found', 404)
  const orgId = String(loaded.data.orgId ?? '')
  const denied = await ensureOrgAccess(user, orgId)
  if (denied) return denied

  const storagePath = String(loaded.data.storagePath ?? '')
  if (storagePath) {
    try {
      await getStorage(getAdminApp()).bucket().file(storagePath).delete({ ignoreNotFound: true })
    } catch (error) {
      console.error('[video-editor] proxy storage delete failed:', error)
    }
  }
  const previewId = String(loaded.data.previewId ?? id)
  await adminDb.collection(VIDEO_EDITOR_PREVIEW_COLLECTIONS.mediaPreviews).doc(previewId)
    .set({ proxy: FieldValue.delete(), updatedAt: FieldValue.serverTimestamp() }, { merge: true })
    .catch(() => {})
  await loaded.ref.delete()
  return apiSuccess({ id, evicted: true })
})
```

- [ ] **Step 13.7: Hook output registration** — in `lib/video-editor/register-outputs.ts`, at the end of `registerVideoEditorRenderOutputs` (right before the final `return`), enqueue a preview for the freshly rendered file, fire-and-forget:

```ts
  // Kick off waveform/filmstrip/proxy generation for the fresh render so it is
  // scrub-ready when re-imported into a timeline. Never blocks registration.
  try {
    const { ensureMediaPreviews } = await import('./media-previews-server')
    await ensureMediaPreviews(project.orgId, [
      { type: 'youtube_source_asset', sourceAssetId: `video-editor-${jobId}`, url: output.url, mediaKind: 'video' },
    ], user)
  } catch (error) {
    console.error('[video-editor] media preview enqueue failed:', error)
  }
```

(Adapt the identifier names to the function's actual signature — it receives the jobId, project and output; if it has no `user`, pass the system actor the file already uses for `actorFields`. Read the function before editing.)

- [ ] **Step 13.8: Firestore index** — in `firestore.indexes.json`, add to the `indexes` array:

```json
{
  "collectionGroup": "video_editor_proxy_ledger",
  "queryScope": "COLLECTION",
  "fields": [
    { "fieldPath": "orgId", "order": "ASCENDING" },
    { "fieldPath": "lastAccessAt", "order": "ASCENDING" }
  ]
}
```

Per [[reference_firebase_json_indexes_gotcha]], confirm `firebase.json` maps `firestore.indexes` → `firestore.indexes.json` (it does since 2026-05-08). Deploy with `npx firebase deploy --only firestore:indexes --project partners-in-biz-85059` during Task 17 QA (needs Peet-level gcloud auth — if unavailable, list it in the wrap-up notes).

- [ ] **Step 13.9: Verify**

Run: `npx jest __tests__/lib/video-editor- --silent && npm run typecheck`
Expected: PASS + clean.

- [ ] **Step 13.10: Commit**

```bash
git add lib/video-editor app/api/v1/video-editor firestore.indexes.json __tests__/lib/video-editor-media-previews.test.ts __tests__/lib/video-editor-dispatch.test.ts
git commit -m "feat(video-editor): media preview records, ensure+report APIs and proxy ledger with LRU eviction endpoints"
```

---

## Task 14: Executor — `video_editor_media_preview` job family

**Files:**
- Modify: `scripts/higgsfield-executor/executor.mjs`
- Modify: `scripts/higgsfield-executor/lib/editor-media.mjs` (pure peaks helper)
- Test: `__tests__/scripts/editor-media.test.ts`

- [ ] **Step 14.1: Write the failing pure-unit test** — append to `__tests__/scripts/editor-media.test.ts` (it uses the same `runModule` pattern; check the file top for the exact harness and reuse it):

```ts
describe('computePeaksFromPcm', () => {
  it('computes normalized max-abs peaks per bucket from s16le PCM', () => {
    // 8 samples, 4 per bucket: [0, 16384, -32768, 8192] → 1.0 ; [0, 0, 3277, -6554] → 0.2
    const samples = [0, 16384, -32768, 8192, 0, 0, 3277, -6554]
    const buffer = Buffer.alloc(samples.length * 2)
    samples.forEach((sample, index) => buffer.writeInt16LE(sample, index * 2))
    const peaks = runModule<number[]>(`return m.computePeaksFromPcm(Buffer.from(${JSON.stringify([...buffer])}), 4)`)
    expect(peaks).toEqual([1, 0.2])
  })

  it('caps the number of peaks at 20000', () => {
    const peaks = runModule<number>(`
      const buffer = Buffer.alloc(2 * 50000);
      return m.computePeaksFromPcm(buffer, 1).length;
    `)
    expect(peaks).toBe(20000)
  })
})
```

Run: `npx jest __tests__/scripts/editor-media.test.ts --silent` — the new block FAILS.

- [ ] **Step 14.2: Implement the peaks helper** — append to `scripts/higgsfield-executor/lib/editor-media.mjs`:

```js
export const MAX_WAVEFORM_PEAKS = 20000

/**
 * Max-abs peak per bucket from signed 16-bit little-endian mono PCM,
 * normalized to 0..1 and rounded to 3 decimals.
 */
export function computePeaksFromPcm(buffer, samplesPerPeak) {
  const totalSamples = Math.floor(buffer.length / 2)
  const bucket = Math.max(1, Math.floor(samplesPerPeak))
  const peaks = []
  for (let start = 0; start < totalSamples && peaks.length < MAX_WAVEFORM_PEAKS; start += bucket) {
    let max = 0
    const end = Math.min(start + bucket, totalSamples)
    for (let i = start; i < end; i += 1) {
      const value = Math.abs(buffer.readInt16LE(i * 2))
      if (value > max) max = value
    }
    peaks.push(Math.round((max / 32768) * 1000) / 1000)
  }
  return peaks
}
```

Run the test file — PASS.

- [ ] **Step 14.3: Implement the executor job family** — in `scripts/higgsfield-executor/executor.mjs`:

Add near the other editor constants:

```js
const FFPROBE_BIN = process.env.FFPROBE_BIN || 'ffprobe'
const PREVIEW_TIMEOUT_MS = Number(process.env.PREVIEW_TIMEOUT_MS || 15 * 60 * 1000)
const PROXY_MIN_BYTES = Number(process.env.PROXY_MIN_BYTES || 25_000_000)
const WAVEFORM_PEAKS_PER_SECOND = 20
```

Update the import from `./lib/editor-media.mjs`:

```js
import { assertAllowedMediaUrl, computePeaksFromPcm } from './lib/editor-media.mjs'
```

Add helpers after `runFfmpeg`:

```js
/** Run ffmpeg capturing stdout as a Buffer (for PCM decode). */
function runFfmpegStdout(args, timeoutMs) {
  return new Promise((resolve) => {
    const child = spawn(FFMPEG_BIN, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    const chunks = []
    let stderr = ''
    const timer = setTimeout(() => { child.kill('SIGKILL') }, timeoutMs)
    child.stdout.on('data', (d) => { chunks.push(d) })
    child.stderr.on('data', (d) => { stderr += d })
    child.on('close', (code) => { clearTimeout(timer); resolve({ code, stdout: Buffer.concat(chunks), stderr }) })
    child.on('error', (error) => { clearTimeout(timer); resolve({ code: -1, stdout: Buffer.alloc(0), stderr: String(error) }) })
  })
}

/** ffprobe → { durationSeconds, width, height } (zeros when a field is missing). */
async function probeMedia(filePath) {
  const result = await new Promise((resolve) => {
    const child = spawn(FFPROBE_BIN, [
      '-v', 'error', '-select_streams', 'v:0',
      '-show_entries', 'stream=width,height', '-show_entries', 'format=duration',
      '-of', 'json', filePath,
    ], { stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    child.stdout.on('data', (d) => { stdout += d })
    child.on('close', () => resolve(stdout))
    child.on('error', () => resolve(''))
  })
  try {
    const parsed = JSON.parse(result)
    return {
      durationSeconds: Number(parsed?.format?.duration) || 0,
      width: Number(parsed?.streams?.[0]?.width) || 0,
      height: Number(parsed?.streams?.[0]?.height) || 0,
    }
  } catch {
    return { durationSeconds: 0, width: 0, height: 0 }
  }
}

async function platformGet(base, path) {
  const response = await fetch(`${base}${path}`, {
    headers: { Authorization: `Bearer ${PIB_AGENT_API_KEY}` },
  })
  const text = await response.text().catch(() => '')
  let body = {}
  try { body = JSON.parse(text) } catch { /* keep empty */ }
  return { ok: response.ok, status: response.status, body: body?.data ?? body }
}

async function platformDelete(base, path) {
  const response = await fetch(`${base}${path}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${PIB_AGENT_API_KEY}` },
  })
  if (!response.ok) log('warn', 'platform DELETE failed', { path, status: response.status })
  return response.ok
}

async function uploadPreviewArtifact(base, buffer, orgId, folder, filename, contentType) {
  const form = new FormData()
  form.set('file', new Blob([buffer], { type: contentType }), filename)
  form.set('folder', folder)
  form.set('filename', filename)
  form.set('orgId', orgId)
  const response = await fetch(`${base}/api/v1/upload`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${PIB_AGENT_API_KEY}` },
    body: form,
  })
  const text = await response.text().catch(() => '')
  if (!response.ok) throw new Error(`preview artifact upload failed (${response.status}): ${text.slice(0, 300)}`)
  let body = {}
  try { body = JSON.parse(text) } catch { /* keep empty */ }
  const data = body?.data ?? body
  if (!data?.url || !data?.storagePath) throw new Error('preview artifact upload returned no url/storagePath')
  return { url: data.url, storagePath: data.storagePath }
}
```

Add the job executor (after `executeEditorRender`):

```js
async function executeMediaPreview(job, manifest) {
  const base = baseUrlFrom(manifest)
  const preview = manifest.preview
  const reportPath = manifest.report?.path
    || `/api/v1/video-editor/media-previews/${preview.id}?orgId=${encodeURIComponent(preview.orgId)}`
  const folder = manifest.upload?.folder || `video-editor/${preview.orgId}/previews`
  const safeKey = String(preview.mediaKey).replace(/[^A-Za-z0-9_-]/g, '_')

  const fail = async (message, code = 'preview_failed') => {
    job.status = 'failed'
    job.providerStatus = code
    job.providerStatusMessage = message.slice(0, 1500)
    log('error', 'media preview failed', { previewId: preview.id, code, message: job.providerStatusMessage })
    await platformPut(base, reportPath, { status: 'failed', error: { code, message: message.slice(0, 2000) } })
  }

  let workDir
  try {
    await platformPut(base, reportPath, { status: 'processing' })
    workDir = await mkdtemp(join(tmpdir(), 'vprev-'))
    const localFile = await downloadEditorMedia(preview.url, workDir, 0)
    const stats = await stat(localFile)
    const probe = await probeMedia(localFile)
    const report = { status: 'ready' }

    if (manifest.options?.waveform) {
      const pcm = await runFfmpegStdout(['-i', localFile, '-vn', '-ac', '1', '-ar', '8000', '-f', 's16le', '-'], PREVIEW_TIMEOUT_MS)
      if (pcm.code === 0 && pcm.stdout.length) {
        const peaks = computePeaksFromPcm(pcm.stdout, Math.round(8000 / WAVEFORM_PEAKS_PER_SECOND))
        const payload = Buffer.from(JSON.stringify({ version: 1, peaksPerSecond: WAVEFORM_PEAKS_PER_SECOND, peaks }))
        const uploaded = await uploadPreviewArtifact(base, payload, preview.orgId, folder, `${safeKey}-waveform.json`, 'application/json')
        report.waveform = { ...uploaded, peaksPerSecond: WAVEFORM_PEAKS_PER_SECOND, peakCount: peaks.length }
      } else {
        log('warn', 'waveform decode failed — continuing', { previewId: preview.id, stderr: pcm.stderr.slice(-200) })
      }
    }

    if (manifest.options?.filmstrip && probe.durationSeconds > 0) {
      const frameCount = Math.min(40, Math.max(5, Math.round(probe.durationSeconds / 2)))
      const interval = probe.durationSeconds / frameCount
      const stripPath = join(workDir, 'filmstrip.jpg')
      const result = await runFfmpeg([
        '-y', '-i', localFile,
        '-vf', `fps=1/${fmtNumber(interval)},scale=160:-2,tile=${frameCount}x1`,
        '-frames:v', '1', '-q:v', '5', stripPath,
      ], PREVIEW_TIMEOUT_MS)
      if (result.code === 0) {
        const buffer = await readFile(stripPath)
        const uploaded = await uploadPreviewArtifact(base, buffer, preview.orgId, folder, `${safeKey}-filmstrip.jpg`, 'image/jpeg')
        const frameHeight = probe.width > 0 ? Math.round((160 / probe.width) * probe.height / 2) * 2 : 90
        report.filmstrip = { ...uploaded, frameIntervalSeconds: Math.round(interval * 1000) / 1000, frameWidth: 160, frameHeight, frameCount }
      } else {
        log('warn', 'filmstrip render failed — continuing', { previewId: preview.id, stderr: result.stderr.slice(-200) })
      }
    }

    if (manifest.options?.proxy && stats.size >= PROXY_MIN_BYTES) {
      const proxyPath = join(workDir, 'proxy.mp4')
      const scale = probe.height > 540 ? 'scale=-2:540' : 'scale=trunc(iw/2)*2:trunc(ih/2)*2'
      const result = await runFfmpeg([
        '-y', '-i', localFile, '-vf', scale,
        '-c:v', 'libx264', '-crf', '28', '-preset', 'veryfast', '-pix_fmt', 'yuv420p',
        '-c:a', 'aac', '-b:a', '96k', '-movflags', '+faststart', proxyPath,
      ], PREVIEW_TIMEOUT_MS)
      if (result.code === 0) {
        const proxyStats = await stat(proxyPath)
        // LRU eviction BEFORE uploading the new proxy so the org stays under cap.
        const capBytes = Number(manifest.proxyLedger?.capBytes) || 20 * 1024 * 1024 * 1024
        const listPath = manifest.proxyLedger?.listPath
        const deleteTemplate = manifest.proxyLedger?.deletePathTemplate
        if (listPath && deleteTemplate) {
          const ledger = await platformGet(base, listPath)
          if (ledger.ok) {
            let totalBytes = Number(ledger.body?.totalBytes) || 0
            const entries = Array.isArray(ledger.body?.entries) ? ledger.body.entries : []
            for (const entry of entries) {
              if (totalBytes + proxyStats.size <= capBytes) break
              if (!entry?.id) continue
              const evicted = await platformDelete(base, deleteTemplate.replace('{id}', encodeURIComponent(entry.id)))
              if (evicted) {
                totalBytes -= Number(entry.sizeBytes) || 0
                log('info', 'evicted LRU proxy', { previewId: preview.id, evictedId: entry.id })
              }
            }
          }
        }
        const buffer = await readFile(proxyPath)
        const uploaded = await uploadPreviewArtifact(base, buffer, preview.orgId, folder, `${safeKey}-proxy540.mp4`, 'video/mp4')
        const proxyProbe = await probeMedia(proxyPath)
        report.proxy = { ...uploaded, sizeBytes: proxyStats.size, width: proxyProbe.width || 960, height: proxyProbe.height || 540 }
      } else {
        log('warn', 'proxy transcode failed — continuing', { previewId: preview.id, stderr: result.stderr.slice(-200) })
      }
    }

    const put = await platformPut(base, reportPath, report)
    if (!put.ok) {
      await fail(`Preview generated but the platform rejected the report (HTTP ${put.status})`, 'platform_report_failed')
      return
    }
    job.status = 'completed'
    job.providerStatus = 'completed'
    job.providerStatusMessage = 'Media preview generated.'
    log('info', 'media preview completed', {
      previewId: preview.id,
      waveform: Boolean(report.waveform),
      filmstrip: Boolean(report.filmstrip),
      proxy: Boolean(report.proxy),
    })
  } catch (error) {
    await fail(`Executor error: ${String(error?.message || error).slice(0, 800)}`, 'executor_error')
  } finally {
    if (workDir) rm(workDir, { recursive: true, force: true }).catch(() => {})
    setTimeout(() => jobs.delete(job.providerJobId), JOB_TTL_MS).unref?.()
  }
}

function fmtNumber(value) {
  return String(Math.round(Number(value) * 1000) / 1000)
}
```

Add the endpoints inside the request handler, after the `/video-editor/renders` POST block:

```js
    if (req.method === 'POST' && url.pathname === '/video-editor/media-previews') {
      const body = JSON.parse(await readBody(req) || 'null')
      if (body?.kind !== 'video_editor_media_preview' || !body.preview?.id || !body.preview?.orgId || !body.preview?.url) {
        return json(res, 400, { error: 'Valid video_editor_media_preview manifest is required' })
      }
      const providerJobId = `vprev-${body.preview.id}-${randomUUID().slice(0, 8)}`
      const job = {
        providerJobId,
        previewId: body.preview.id,
        status: 'running',
        providerStatus: 'executor_accepted',
        providerStatusMessage: 'Media preview accepted.',
        createdAt: Date.now(),
      }
      jobs.set(providerJobId, job)
      log('info', 'media preview accepted', { previewId: body.preview.id, providerJobId, mediaKind: body.preview.mediaKind })
      executeMediaPreview(job, body).catch((error) => log('error', 'executeMediaPreview crashed', { previewId: body.preview.id, error: String(error) }))
      return json(res, 200, { providerJobId, status: 'running', providerStatus: job.providerStatus, providerStatusMessage: job.providerStatusMessage })
    }

    const previewStatusMatch = url.pathname.match(/^\/video-editor\/media-previews\/([A-Za-z0-9-]+)$/)
    if (req.method === 'GET' && previewStatusMatch) {
      const job = jobs.get(previewStatusMatch[1])
      if (!job) return json(res, 404, { error: 'Job not found' })
      return json(res, 200, {
        providerJobId: job.providerJobId,
        status: job.status,
        providerStatus: job.providerStatus,
        providerStatusMessage: job.providerStatusMessage,
      })
    }
```

- [ ] **Step 14.4: Verify**

Run: `npx jest __tests__/scripts/ --silent && node --check scripts/higgsfield-executor/executor.mjs`
Expected: tests PASS; `node --check` exits 0 (syntax gate for the .mjs).

- [ ] **Step 14.5: Commit**

```bash
git add scripts/higgsfield-executor __tests__/scripts/editor-media.test.ts
git commit -m "feat(executor): media preview job family — waveform peaks, filmstrip sprites, 540p proxies with LRU eviction"
```

---

## Task 15: Surface previews — Shell loading, timeline waveforms/filmstrips, proxy chips

**Files:**
- Modify: `components/video-editor/VideoEditorShell.tsx`
- Modify: `components/video-editor/MediaLibraryPanel.tsx`
- Test: `__tests__/app/video-editor-timeline-mechanics.test.tsx` (extend)

- [ ] **Step 15.1: Write the failing tests** — append to `__tests__/app/video-editor-timeline-mechanics.test.tsx`:

```tsx
import type { VideoEditorMediaPreview } from '@/lib/video-editor/types'

describe('TimelinePanel media previews', () => {
  const previews: Record<string, VideoEditorMediaPreview> = {
    'upload:f': {
      orgId: 'o', mediaKey: 'upload:f', sourceUrl: 'https://x.test/a.mp4', mediaKind: 'video', status: 'ready', deleted: false,
      filmstrip: { url: 'https://x.test/strip.jpg', storagePath: 'p', frameIntervalSeconds: 1, frameWidth: 160, frameHeight: 90, frameCount: 4 },
    },
  }

  it('paints the filmstrip as the clip background when available', () => {
    render(<TimelinePanel {...makeProps({ mediaPreviews: previews })} />)
    const clipEl = screen.getByTestId('timeline-clip-a')
    expect(clipEl.style.backgroundImage).toContain('strip.jpg')
  })
})
```

And a small waveform test in the same file:

```tsx
import { WaveformStrip } from '@/components/video-editor/WaveformStrip'

describe('WaveformStrip', () => {
  it('fetches the peaks JSON and renders a canvas', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ peaks: [0.1, 0.9, 0.4] }) }) as jest.Mock
    render(<WaveformStrip waveformUrl="https://x.test/w.json" />)
    expect(await screen.findByTestId('waveform-canvas')).toBeInTheDocument()
    expect(global.fetch).toHaveBeenCalledWith('https://x.test/w.json')
  })
})
```

Run: `npx jest __tests__/app/video-editor-timeline-mechanics.test.tsx --silent` — filmstrip test FAILS if Task 10's background wiring regressed; both must pass after this step (the filmstrip rendering itself shipped in Task 10 — this pins it).

- [ ] **Step 15.2: Load previews in the Shell** — in `VideoEditorShell.tsx`, replace the Task-10 placeholder `mediaPreviews` with real state + loading:

```tsx
import { mediaKeyForRef } from '@/lib/video-editor/media-previews'
import type { MediaRef, VideoEditorMediaPreview } from '@/lib/video-editor/types'

  const [mediaPreviews, setMediaPreviews] = useState<Record<string, VideoEditorMediaPreview>>({})

  const timelineRefs = useMemo(() => {
    const refs: MediaRef[] = []
    const seen = new Set<string>()
    for (const track of timeline.tracks) {
      for (const clip of track.clips) {
        if (!clip.media) continue
        const key = mediaKeyForRef(clip.media)
        if (seen.has(key)) continue
        seen.add(key)
        refs.push(clip.media)
      }
    }
    return refs
  }, [timeline])

  async function ensurePreviews(refs: MediaRef[]) {
    if (!orgId || !refs.length) return
    const res = await fetch(scopedApiPath('/api/v1/video-editor/media-previews', apiScope), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orgId, refs }),
    })
    const body = await res.json().catch(() => ({}))
    if (!res.ok) return
    const previews = (body.data?.previews ?? []) as Array<VideoEditorMediaPreview & { id: string }>
    setMediaPreviews((current) => {
      const next = { ...current }
      for (const preview of previews) next[preview.mediaKey] = preview
      return next
    })
  }

  // Ensure previews whenever the set of referenced media changes; poll while pending.
  useEffect(() => {
    void ensurePreviews(timelineRefs)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timelineRefs.map((ref) => mediaKeyForRef(ref)).join(','), orgId])

  useEffect(() => {
    const pending = Object.values(mediaPreviews).some((preview) => preview.status === 'pending' || preview.status === 'processing')
    if (!pending || !orgId) return
    const timer = window.setInterval(() => {
      const keys = Object.values(mediaPreviews)
        .filter((preview) => preview.status === 'pending' || preview.status === 'processing')
        .map((preview) => preview.mediaKey)
      void fetch(scopedApiPath(`/api/v1/video-editor/media-previews?orgId=${encodeURIComponent(orgId)}&keys=${encodeURIComponent(keys.join(','))}`, apiScope))
        .then((res) => res.json())
        .then((body) => {
          const previews = (body.data?.previews ?? []) as VideoEditorMediaPreview[]
          if (previews.length) {
            setMediaPreviews((current) => {
              const next = { ...current }
              for (const preview of previews) next[preview.mediaKey] = preview
              return next
            })
          }
        })
        .catch(() => {})
    }, 15000)
    return () => window.clearInterval(timer)
  }, [mediaPreviews, orgId, apiScope])
```

Pass `mediaPreviews={mediaPreviews}` to BOTH `TimelinePanel` and `PreviewPlayer` (already prop-typed in Tasks 10/12), and to `MediaLibraryPanel`.

- [ ] **Step 15.3: Proxy status chips** — in `components/video-editor/MediaLibraryPanel.tsx`:

Add to the props: `mediaPreviews?: Record<string, VideoEditorMediaPreview>` (import the type and `mediaKeyForRef`; also import `toMediaRef` is already local). Inside the source row render (after the `sourceKindLabel` line), compute and show the chip:

```tsx
                  {(() => {
                    if (!media || mediaKind === 'image') return null
                    const preview = mediaPreviews?.[mediaKeyForRef(media)]
                    if (!preview) return null
                    const chip = preview.proxy
                      ? { label: 'Proxy ready', className: 'text-emerald-300 border-emerald-300/40' }
                      : preview.status === 'pending' || preview.status === 'processing'
                        ? { label: 'Preparing preview…', className: 'text-amber-200 border-amber-200/40' }
                        : { label: 'Original', className: 'text-on-surface-variant border-[var(--color-pib-line)]' }
                    return (
                      <span data-testid={`proxy-chip-${source.id ?? ''}`} className={`mt-1 inline-block rounded border px-1.5 py-0.5 text-[10px] ${chip.className}`}>
                        {chip.label}
                      </span>
                    )
                  })()}
```

- [ ] **Step 15.4: Run tests to verify they pass**

Run: `npx jest __tests__/app/ --silent && npm run typecheck`
Expected: PASS + clean typecheck.

- [ ] **Step 15.5: Commit**

```bash
git add components/video-editor __tests__/app/video-editor-timeline-mechanics.test.tsx
git commit -m "feat(video-editor): load media previews in the shell, waveform/filmstrip clips and proxy chips"
```

---

## Task 16: VPS deploy — **requires Peet-approved VPS access** (root@65.108.146.144, hermes-vps-01)

Byte-identical repo↔`/opt` policy with a dated `.bak` first. Run from the repo root. **Do not run without Peet's go-ahead for VPS access.**

- [ ] **Step 16.1: Back up the live executor:**

```bash
ssh root@65.108.146.144 "cp /opt/higgsfield-executor/executor.mjs /opt/higgsfield-executor/executor.mjs.bak-$(date +%Y-%m-%d) && cp /opt/higgsfield-executor/lib/editor-filtergraph.mjs /opt/higgsfield-executor/lib/editor-filtergraph.mjs.bak-$(date +%Y-%m-%d)"
```

- [ ] **Step 16.2: Ship the files:**

```bash
scp scripts/higgsfield-executor/executor.mjs root@65.108.146.144:/opt/higgsfield-executor/executor.mjs
scp scripts/higgsfield-executor/lib/editor-filtergraph.mjs root@65.108.146.144:/opt/higgsfield-executor/lib/editor-filtergraph.mjs
scp scripts/higgsfield-executor/lib/editor-keyframes.mjs root@65.108.146.144:/opt/higgsfield-executor/lib/editor-keyframes.mjs
scp scripts/higgsfield-executor/lib/editor-media.mjs root@65.108.146.144:/opt/higgsfield-executor/lib/editor-media.mjs
```

- [ ] **Step 16.3: Verify byte-identical + ffprobe present:**

```bash
ssh root@65.108.146.144 "sha256sum /opt/higgsfield-executor/executor.mjs /opt/higgsfield-executor/lib/*.mjs && which ffprobe"
shasum -a 256 scripts/higgsfield-executor/executor.mjs scripts/higgsfield-executor/lib/*.mjs
```
Expected: hashes match pairwise; `ffprobe` resolves (it ships with the ffmpeg package — if missing, `apt-get install -y ffmpeg`).

- [ ] **Step 16.4: Restart + health check:**

```bash
ssh root@65.108.146.144 "systemctl restart higgsfield-executor && systemctl status higgsfield-executor --no-pager"
ssh root@65.108.146.144 "curl -s localhost:8690/health"
```
Expected: `active (running)` and `{"ok":true,...}`.

No commit for this task (server-side only).

---

## Task 17: Final gates, manual QA, wrap-up

### Step 17.1: Automated gates

- [ ] `npm run typecheck` — clean (the real type gate; `next build` has `ignoreBuildErrors`).
- [ ] `npx jest --silent` — full suite green (all new node + jsdom projects and every P1 video-editor test untouched).
- [ ] `RUN_FFMPEG_CONTRACT=1 npx jest __tests__/scripts/editor-filtergraph.test.ts` — contract test green locally (requires ffmpeg installed).
- [ ] `NODE_OPTIONS=--max-old-space-size=10240 npx next build --webpack` — completes; `/api/v1/video-editor/media-previews` and `/api/v1/video-editor/proxy-ledger` routes appear in the output manifest.
- [ ] `npx firebase deploy --only firestore:indexes --project partners-in-biz-85059` — the `video_editor_proxy_ledger` composite index deploys (skip + note in wrap-up if gcloud auth is unavailable).
- [ ] `git status --short` — everything committed; `git push origin development`.

### Step 17.2: Manual QA script (localhost:3010, real org, real VPS)

Prereqs: dev server with `.env.local` pulled, Task 16 deployed, a test org with `youtubeStudio` enabled, an editor project with ≥2 video clips on V1, one clip on V2, and one audio clip.

- [ ] **Ripple:** switch to Ripple mode → delete the first V1 clip → every downstream clip on V1, V2 AND the audio track closes the gap; lock the audio track, undo, ripple-delete again → audio stays put. Undo/redo restores both states.
- [ ] **Trim handles:** in Select mode drag the end handle of clip 1 shorter → only that clip changes; in Ripple mode the downstream clips follow.
- [ ] **Roll/slip:** Roll mode → drag clip 2's start handle left 1s → boundary moves, total duration constant. Slip mode → drag clip 2's body → content shifts (verify in preview), clip position unchanged.
- [ ] **Link:** shift-click a V1 clip + the audio clip → Link → drag one → both move; delete → both go; Unlink works.
- [ ] **Keyframes:** select a clip → add opacity keyframes (1 → 0 across the clip) → preview fades the clip out while scrubbing; set easing to bezier and reshape the curve → preview updates. Diamond markers appear on the clip.
- [ ] **Speed ramp:** apply "Hero Time" to a clip → preview slows through the middle (playbackRate changes audibly/visibly); Export → rendered MP4 shows the slow-mo with pitch-preserved audio; render duration equals the timeline duration; credits charged exactly as before the ramp.
- [ ] **Keyframed render:** export the opacity-keyframed timeline → MP4 fades the clip; VPS journal shows a normal `editor render completed` (no ffmpeg parse errors — this validates the sendcmd/expression quoting end-to-end).
- [ ] **Waveforms/filmstrips:** open a project referencing an uploaded video ≥25MB and an MP3 → chips show "Preparing preview…" → within ~2 min the audio clip shows a waveform, video clips show filmstrips, the video source shows "Proxy ready"; `video_editor_media_previews` docs show `status: ready`; the preview `<video src>` uses the `-proxy540.mp4` URL (devtools) while the render manifest (Firestore `timelineSnapshot`) still carries the ORIGINAL URL.
- [ ] **Ledger + eviction:** `video_editor_proxy_ledger/{previewId}` exists with `sizeBytes`; temporarily set `PROXY_MIN_BYTES=1` and `capBytes` low via `VIDEO_EDITOR_PROXY_CAP_BYTES` on a re-dispatch → executor journal logs `evicted LRU proxy` and the evicted preview doc loses its `proxy` field; restore env values.
- [ ] **No credit charges for previews:** org credit usage shows render charges only.

### Step 17.3: Wrap-up

- [ ] Append QA results + deviations to this plan file; refresh `~/Cowork/Cowork/agents/partners/wiki/hot.md`; write the session log per Wiki Persistence Rules.
- [ ] Final commit + push of QA-driven fixes to `origin/development`. No production promotion — `development` Preview only, per Production Branch Safety.

### Deferred (explicitly OUT of Phase 1a)

- Auto-captions/transcription, TTS voiceover (Phase 1b of Editor E2).
- Audio mixer, auto-ducking, noise reduction, beat detection.
- Effects/LUT stack, chroma key, masks, blend modes, stabilization, PiP presets, templates, stock media.
- Retention overlay, script-driven editing, AI auto-edit, multi-format render queue (E3).
- Keyframed `speed` in the PREVIEW is an approximation (playbackRate steps + segment-mapped seeks); the render is ground truth.
- Waveform peaks are mono max-abs at 20 peaks/sec (no min/max pairs, no per-channel).
- Proxy eviction races (two executors evicting concurrently) — single-executor deployment today; revisit with a transaction if a second executor appears.

---

## Self-review checklist (run after writing code, before hand-off)

1. **Spec coverage** — ripple-across-tracks ✔ (Task 4), linked groups ✔ (Task 3/10), roll+slip ✔ (Task 5/10), keyframes UI + ease + bezier ✔ (Task 2/6/11), preview interpolation ✔ (Task 12), filtergraph keyframes via expressions/sendcmd ✔ (Task 8/9), speed ramps + presets + atempo pitch ✔ (Task 7/9/11), waveforms + filmstrips server-generated & cached ✔ (Task 13/14/15), proxies + 20 GB LRU ledger + eviction in executor + status chips ✔ (Task 13/14/15), renders keep originals + credits untouched ✔ (asserted in QA), VPS deploy with dated .bak ✔ (Task 16).
2. **Type consistency spot-checks** — `TimelineSelection` array shape is used by Shell + Panel + tests; `mediaKeyForRef` signatures match across Panel/Preview/MediaLibrary/server; `VideoEditorMediaPreview.mediaKind` is `EditorMediaKind`; `rampSegments(clip, subdivisions)` has identical signatures in TS and mjs.
3. **Ordering hazards** — Task 10 depends on `lib/video-editor/media-previews.ts` + `WaveformStrip` placeholders created in Step 10.3; Task 9 depends on Task 8's mjs; Task 15 replaces Task 10's `mediaPreviews` placeholder. Execute tasks in order.



