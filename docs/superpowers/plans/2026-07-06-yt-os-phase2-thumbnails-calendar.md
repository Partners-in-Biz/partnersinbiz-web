# YouTube OS Phase 2 — Thumbnail Studio + Content Calendar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the Thumbnail Studio (layered design canvas, AI variant generation, rotation + export-kit A/B testing, CTR pattern library) and the Content Calendar (month/week over release plans + scheduled publishes, drag-to-reschedule, cadence health, best-time-to-publish) for the YouTube Channel OS on Partners in Biz.

**Architecture:** Everything is org-scoped, `withAuth('admin')`-gated, wrapped in the `apiSuccess({ data })` envelope, and follows the existing `lib/youtube-studio/*` + `app/api/v1/youtube-studio/*` conventions (sanitize → actor-stamp → Firestore add/merge, `serializeYouTubeRecord` on read, soft-delete via `deleted`). New Firestore collections carry versioned JSON. AI thumbnail variants reuse the Creative Canvas inline/Higgsfield generation dispatch + `creative_canvas_credits` charge/refund. Rotation A/B reuses the YouTube provider's OAuth token to call `thumbnails.set` (50 quota units) and the Analytics API for CTR, logged in a per-org quota ledger with a per-org toggle (default ON). The calendar is a read/aggregation surface over `youtube_release_plans` + social scheduled posts with timezone-aware helpers from `lib/email/send-time.ts`.

**Tech Stack:** Next.js 15 App Router (route params are `Promise`), TypeScript, Firebase Admin Firestore, Jest 30 (jsdom + node), React 19 + `pib-card-section` UI, `Intl.DateTimeFormat` for timezone math (no new deps), `sharp` (already a dependency — verify in Task 1) for server-side PNG rasterization.

---

## File Structure

**Types & domain (lib/youtube-studio/)**
- `thumbnail-types.ts` — CREATE. All thumbnail domain types: `YouTubeThumbnailLayer` union, `YouTubeThumbnailDesign`, `YouTubeThumbnailTemplate`, `YouTubeThumbnailExperiment`, `YouTubeThumbnailCtrPattern`, plus enums/status types.
- `thumbnail-sanitize.ts` — CREATE. Input sanitizers for each thumbnail record (mirrors `sanitize.ts` style).
- `thumbnail-render.ts` — CREATE. Pure layer-JSON → 1280×720 PNG rasterization via `sharp`; SVG-string builder from layers; brand-kit variable resolution.
- `thumbnail-templates.ts` — CREATE. Platform (built-in) thumbnail template library + `resolveTemplateWithBrandKit`.
- `thumbnail-experiments.ts` — CREATE. Rotation lifecycle: schedule math, `thumbnails.set` dispatch wrapper, CTR pull + winner statistics, quota-ledger writes.
- `thumbnail-ctr-patterns.ts` — CREATE. Aggregate per-thumbnail CTR outcomes into an org-level "what works" pattern library.
- `background-removal.ts` — CREATE. Provider-backed subject cutout (BYOK via existing connection resolution; graceful `not_configured` fallback).
- `test-kit.ts` — CREATE. Build the "Test kit" export bundle (3 thumbnails + titles + SOP card copy).
- `calendar.ts` — CREATE. Aggregate release plans + social scheduled posts into month/week calendar cells; cadence-health per series; best-time-to-publish from analytics snapshots.
- `quota-ledger.ts` — CREATE. Per-org YouTube quota ledger: record units, forecast remaining, `thumbnails.set` = 50.
- `api.ts` — MODIFY. Add new collection names to `YOUTUBE_COLLECTIONS`.

**Collections (Firestore, all org-scoped, soft-delete):**
- `youtube_thumbnail_designs`, `youtube_thumbnail_templates`, `youtube_thumbnail_experiments`, `youtube_thumbnail_ctr_patterns`, `youtube_quota_ledger`.

**API routes (app/api/v1/youtube-studio/)**
- `thumbnail-designs/route.ts` (GET list, POST create), `thumbnail-designs/[id]/route.ts` (GET, PUT, DELETE)
- `thumbnail-designs/[id]/export/route.ts` (POST → rasterize + register source asset + link packet)
- `thumbnail-designs/[id]/variants/route.ts` (POST → dispatch AI variants)
- `thumbnail-templates/route.ts` (GET platform+org, POST create org template)
- `thumbnail-experiments/route.ts` (GET, POST), `thumbnail-experiments/[id]/route.ts` (GET, PUT toggle/winner)
- `thumbnail-experiments/[id]/test-kit/route.ts` (GET → bundle)
- `thumbnail-ctr-patterns/route.ts` (GET)
- `calendar/route.ts` (GET aggregated), `calendar/reschedule/route.ts` (PUT one release plan)
- `channels/[id]/thumbnail-ab-settings/route.ts` (GET, PUT per-org toggle)
- `app/api/cron/youtube-thumbnail-rotation/route.ts` (cron drain)

**Tests (`__tests__/lib/` and `__tests__/api/`)** — one test file per lib module and per route group.

---

## Task 1: Verify dependencies and add collection names

**Files:**
- Modify: `lib/youtube-studio/api.ts:11-24`
- Test: `__tests__/lib/youtube-studio-thumbnail-collections.test.ts`

- [ ] **Step 1: Verify `sharp` is available**

Run: `cd "/Users/peetstander/Cowork/Partners in Biz — Client Growth/partnersinbiz-web" && node -e "require('sharp'); console.log('sharp ok')"`
Expected: prints `sharp ok`. If it errors with "Cannot find module 'sharp'", run `npm ls sharp` — if absent, `npm install sharp` and note it in the commit. (Do NOT proceed to Task 4 rasterization without a working `sharp`.)

- [ ] **Step 2: Write the failing test**

```ts
// __tests__/lib/youtube-studio-thumbnail-collections.test.ts
import { YOUTUBE_COLLECTIONS } from '@/lib/youtube-studio/api'

describe('YOUTUBE_COLLECTIONS thumbnail + calendar additions', () => {
  it('registers the new collection names', () => {
    expect(YOUTUBE_COLLECTIONS.thumbnailDesigns).toBe('youtube_thumbnail_designs')
    expect(YOUTUBE_COLLECTIONS.thumbnailTemplates).toBe('youtube_thumbnail_templates')
    expect(YOUTUBE_COLLECTIONS.thumbnailExperiments).toBe('youtube_thumbnail_experiments')
    expect(YOUTUBE_COLLECTIONS.thumbnailCtrPatterns).toBe('youtube_thumbnail_ctr_patterns')
    expect(YOUTUBE_COLLECTIONS.quotaLedger).toBe('youtube_quota_ledger')
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx jest __tests__/lib/youtube-studio-thumbnail-collections.test.ts`
Expected: FAIL — `thumbnailDesigns` is undefined.

- [ ] **Step 4: Add the collection names**

In `lib/youtube-studio/api.ts`, extend the `YOUTUBE_COLLECTIONS` object (append inside the `as const` block, after `analytics: 'youtube_analytics_snapshots',`):

```ts
  analytics: 'youtube_analytics_snapshots',
  thumbnailDesigns: 'youtube_thumbnail_designs',
  thumbnailTemplates: 'youtube_thumbnail_templates',
  thumbnailExperiments: 'youtube_thumbnail_experiments',
  thumbnailCtrPatterns: 'youtube_thumbnail_ctr_patterns',
  quotaLedger: 'youtube_quota_ledger',
} as const
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx jest __tests__/lib/youtube-studio-thumbnail-collections.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/youtube-studio/api.ts __tests__/lib/youtube-studio-thumbnail-collections.test.ts
git commit -m "feat(yt): register thumbnail + calendar Firestore collections"
```

---

## Task 2: Thumbnail domain types

**Files:**
- Create: `lib/youtube-studio/thumbnail-types.ts`
- Test: `__tests__/lib/youtube-studio-thumbnail-types.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// __tests__/lib/youtube-studio-thumbnail-types.test.ts
import type {
  YouTubeThumbnailDesign,
  YouTubeThumbnailLayer,
  YouTubeThumbnailExperiment,
} from '@/lib/youtube-studio/thumbnail-types'
import { THUMBNAIL_CANVAS_WIDTH, THUMBNAIL_CANVAS_HEIGHT } from '@/lib/youtube-studio/thumbnail-types'

describe('thumbnail types', () => {
  it('exports the canonical 1280x720 canvas dimensions', () => {
    expect(THUMBNAIL_CANVAS_WIDTH).toBe(1280)
    expect(THUMBNAIL_CANVAS_HEIGHT).toBe(720)
  })

  it('models a text layer, an image layer and a design', () => {
    const textLayer: YouTubeThumbnailLayer = {
      id: 'l1', kind: 'text', x: 40, y: 40, width: 600, height: 200,
      rotation: 0, opacity: 1, z: 1,
      text: 'HOW I {{brandName}} WON', fontFamily: '{{fontFamilyHeadings}}',
      fontSize: 96, color: '{{primaryColor}}', align: 'left', weight: 800,
      stroke: { color: '#000', width: 6 },
      shadow: { color: '#000', blur: 8, offsetX: 4, offsetY: 4 },
    }
    const imageLayer: YouTubeThumbnailLayer = {
      id: 'l2', kind: 'image', x: 700, y: 0, width: 580, height: 720,
      rotation: 0, opacity: 1, z: 0, src: 'https://cdn/x.png', isCutout: true,
    }
    const design: YouTubeThumbnailDesign = {
      orgId: 'org1', channelWorkspaceId: 'ch1', videoProjectId: 'v1',
      title: 'Main thumb', status: 'draft', versionNumber: 1,
      canvas: { width: 1280, height: 720, background: '#101014' },
      layers: [imageLayer, textLayer], deleted: false,
    }
    expect(design.layers).toHaveLength(2)
    expect(design.layers[1].kind).toBe('text')
  })

  it('models an experiment with rotation variants', () => {
    const exp: YouTubeThumbnailExperiment = {
      orgId: 'org1', channelWorkspaceId: 'ch1', videoProjectId: 'v1',
      youtubeVideoId: 'yt123', mode: 'rotation', status: 'running',
      rotationHours: 48,
      variants: [
        { id: 'a', thumbnailAssetId: 'as1', label: 'A' },
        { id: 'b', thumbnailAssetId: 'as2', label: 'B' },
      ],
      periods: [], winnerVariantId: undefined, deleted: false,
    }
    expect(exp.variants).toHaveLength(2)
    expect(exp.mode).toBe('rotation')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/lib/youtube-studio-thumbnail-types.test.ts`
Expected: FAIL — cannot find module `thumbnail-types`.

- [ ] **Step 3: Write the types**

```ts
// lib/youtube-studio/thumbnail-types.ts
import type { ActorType } from './types'

export const THUMBNAIL_CANVAS_WIDTH = 1280
export const THUMBNAIL_CANVAS_HEIGHT = 720

export type ThumbnailLayerKind = 'text' | 'image' | 'shape' | 'sticker'
export type ThumbnailShapeKind = 'rect' | 'ellipse' | 'triangle' | 'arrow'
export type ThumbnailTextAlign = 'left' | 'center' | 'right'

export interface ThumbnailStroke { color: string; width: number }
export interface ThumbnailShadow { color: string; blur: number; offsetX: number; offsetY: number }
export interface ThumbnailGlow { color: string; blur: number }

export interface ThumbnailLayerBase {
  id: string
  kind: ThumbnailLayerKind
  x: number
  y: number
  width: number
  height: number
  rotation: number
  opacity: number
  z: number
  stroke?: ThumbnailStroke
  shadow?: ThumbnailShadow
  glow?: ThumbnailGlow
}

export interface ThumbnailTextLayer extends ThumbnailLayerBase {
  kind: 'text'
  text: string
  fontFamily: string
  fontSize: number
  color: string
  align: ThumbnailTextAlign
  weight: number
  lineHeight?: number
  uppercase?: boolean
}

export interface ThumbnailImageLayer extends ThumbnailLayerBase {
  kind: 'image'
  src: string
  /** True when this image was produced by background removal (subject cutout). */
  isCutout?: boolean
  sourceAssetId?: string
}

export interface ThumbnailShapeLayer extends ThumbnailLayerBase {
  kind: 'shape'
  shape: ThumbnailShapeKind
  fill: string
}

export interface ThumbnailStickerLayer extends ThumbnailLayerBase {
  kind: 'sticker'
  src: string
}

export type YouTubeThumbnailLayer =
  | ThumbnailTextLayer
  | ThumbnailImageLayer
  | ThumbnailShapeLayer
  | ThumbnailStickerLayer

export interface ThumbnailCanvasSettings {
  width: number
  height: number
  background: string
  backgroundImageSrc?: string
}

export type YouTubeThumbnailDesignStatus = 'draft' | 'exported' | 'archived'

export interface YouTubeThumbnailDesign {
  id?: string
  orgId: string
  channelWorkspaceId: string
  videoProjectId?: string
  publishingPacketId?: string
  templateId?: string
  title: string
  status: YouTubeThumbnailDesignStatus
  versionNumber: number
  canvas: ThumbnailCanvasSettings
  layers: YouTubeThumbnailLayer[]
  /** Set once exported: the youtube_source_assets doc id of the rendered PNG. */
  exportedThumbnailAssetId?: string
  visibility?: { showInClientPortal?: boolean }
  internalNotes?: string
  createdAt?: unknown
  updatedAt?: unknown
  createdBy?: string
  createdByType?: ActorType
  updatedBy?: string
  updatedByType?: ActorType
  deleted: boolean
}

export type ThumbnailTemplateScope = 'platform' | 'org'

export interface YouTubeThumbnailTemplate {
  id?: string
  orgId?: string
  scope: ThumbnailTemplateScope
  title: string
  description?: string
  canvas: ThumbnailCanvasSettings
  layers: YouTubeThumbnailLayer[]
  /** Brand-kit variable tokens used in this template, e.g. ["primaryColor","fontFamilyHeadings"]. */
  brandVariables: string[]
  deleted: boolean
  createdAt?: unknown
  updatedAt?: unknown
  createdBy?: string
  createdByType?: ActorType
}

export type ThumbnailExperimentMode = 'rotation' | 'export_kit'
export type ThumbnailExperimentStatus = 'draft' | 'running' | 'paused' | 'complete' | 'cancelled'

export interface ThumbnailExperimentVariant {
  id: string
  thumbnailAssetId: string
  label: string
  titleText?: string
}

export interface ThumbnailExperimentPeriod {
  variantId: string
  startedAt: string
  endedAt?: string
  impressions?: number
  ctr?: number
  views?: number
  /** thumbnails.set quota units spent applying this variant (50 each). */
  quotaUnits?: number
}

export interface YouTubeThumbnailExperiment {
  id?: string
  orgId: string
  channelWorkspaceId: string
  videoProjectId: string
  youtubeVideoId?: string
  mode: ThumbnailExperimentMode
  status: ThumbnailExperimentStatus
  rotationHours?: number
  variants: ThumbnailExperimentVariant[]
  periods: ThumbnailExperimentPeriod[]
  currentVariantId?: string
  lastRotatedAt?: unknown
  winnerVariantId?: string
  winnerAppliedAt?: unknown
  winnerConfidence?: 'low' | 'medium' | 'high'
  deleted: boolean
  createdAt?: unknown
  updatedAt?: unknown
  createdBy?: string
  createdByType?: ActorType
  updatedBy?: string
  updatedByType?: ActorType
}

export interface YouTubeThumbnailCtrPattern {
  id?: string
  orgId: string
  channelWorkspaceId?: string
  /** e.g. "big_face", "high_contrast_text", "red_accent", "number_in_title". */
  patternKey: string
  label: string
  sampleCount: number
  avgCtr: number
  bestCtr: number
  deleted: boolean
  updatedAt?: unknown
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest __tests__/lib/youtube-studio-thumbnail-types.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/youtube-studio/thumbnail-types.ts __tests__/lib/youtube-studio-thumbnail-types.test.ts
git commit -m "feat(yt): thumbnail studio domain types"
```

---

## Task 3: Thumbnail input sanitizers

**Files:**
- Create: `lib/youtube-studio/thumbnail-sanitize.ts`
- Test: `__tests__/lib/youtube-studio-thumbnail-sanitize.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// __tests__/lib/youtube-studio-thumbnail-sanitize.test.ts
import {
  sanitizeThumbnailDesignInput,
  sanitizeThumbnailTemplateInput,
  sanitizeThumbnailExperimentInput,
} from '@/lib/youtube-studio/thumbnail-sanitize'

describe('sanitizeThumbnailDesignInput', () => {
  it('clamps layer geometry into the canvas and drops unknown layer kinds', () => {
    const out = sanitizeThumbnailDesignInput({
      orgId: 'org1',
      channelWorkspaceId: 'ch1',
      title: '  Main  ',
      layers: [
        { id: 'a', kind: 'text', x: -50, y: 10, width: 5000, height: 100, rotation: 0, opacity: 5, z: 1, text: 'Hi', fontFamily: 'Arial', fontSize: 40, color: '#fff', align: 'left', weight: 700 },
        { id: 'b', kind: 'bogus', x: 0, y: 0, width: 10, height: 10 },
      ],
    })
    expect(out.title).toBe('Main')
    expect(out.canvas.width).toBe(1280)
    expect(out.layers).toHaveLength(1)
    expect(out.layers[0].x).toBe(0)           // clamped from -50
    expect(out.layers[0].width).toBe(1280)    // clamped to canvas width
    expect(out.layers[0].opacity).toBe(1)     // clamped from 5
    expect(out.status).toBe('draft')
    expect(out.versionNumber).toBe(1)
  })

  it('requires orgId and channelWorkspaceId to remain, throws on missing title', () => {
    expect(() => sanitizeThumbnailDesignInput({ orgId: 'o', channelWorkspaceId: 'c', title: '' }))
      .toThrow(/title/i)
  })
})

describe('sanitizeThumbnailExperimentInput', () => {
  it('defaults mode to rotation with a sane rotationHours and dedupes variant ids', () => {
    const out = sanitizeThumbnailExperimentInput({
      orgId: 'o', channelWorkspaceId: 'c', videoProjectId: 'v',
      variants: [
        { id: 'x', thumbnailAssetId: 'a1', label: 'A' },
        { id: 'x', thumbnailAssetId: 'a2', label: 'B' },
      ],
      rotationHours: 0,
    })
    expect(out.mode).toBe('rotation')
    expect(out.rotationHours).toBe(48)   // 0 rejected → default
    expect(out.variants).toHaveLength(1) // duplicate id collapsed
    expect(out.status).toBe('draft')
  })
})

describe('sanitizeThumbnailTemplateInput', () => {
  it('extracts brand variables from {{token}} usages', () => {
    const out = sanitizeThumbnailTemplateInput({
      scope: 'org', orgId: 'o', title: 'T',
      layers: [{ id: 'a', kind: 'text', x: 0, y: 0, width: 100, height: 40, rotation: 0, opacity: 1, z: 0, text: 'Hi', fontFamily: '{{fontFamilyHeadings}}', fontSize: 40, color: '{{primaryColor}}', align: 'left', weight: 700 }],
    })
    expect(out.brandVariables.sort()).toEqual(['fontFamilyHeadings', 'primaryColor'])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/lib/youtube-studio-thumbnail-sanitize.test.ts`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Write the sanitizers**

```ts
// lib/youtube-studio/thumbnail-sanitize.ts
import {
  THUMBNAIL_CANVAS_WIDTH,
  THUMBNAIL_CANVAS_HEIGHT,
  type YouTubeThumbnailLayer,
  type YouTubeThumbnailDesign,
  type YouTubeThumbnailTemplate,
  type YouTubeThumbnailExperiment,
  type ThumbnailExperimentMode,
  type ThumbnailTemplateScope,
} from './thumbnail-types'

type RawInput = Record<string, unknown>

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() ? v.trim() : undefined
}
function num(v: unknown, fallback = 0): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback
}
function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v))
}
function bool(v: unknown): boolean | undefined {
  return typeof v === 'boolean' ? v : undefined
}
function obj(v: unknown): RawInput {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as RawInput) : {}
}

const LAYER_KINDS = new Set(['text', 'image', 'shape', 'sticker'])

function sanitizeStroke(v: unknown) {
  const o = obj(v)
  const color = str(o.color)
  if (!color) return undefined
  return { color, width: clamp(num(o.width, 1), 0, 64) }
}
function sanitizeShadow(v: unknown) {
  const o = obj(v)
  const color = str(o.color)
  if (!color) return undefined
  return { color, blur: clamp(num(o.blur), 0, 128), offsetX: num(o.offsetX), offsetY: num(o.offsetY) }
}
function sanitizeGlow(v: unknown) {
  const o = obj(v)
  const color = str(o.color)
  if (!color) return undefined
  return { color, blur: clamp(num(o.blur, 8), 0, 128) }
}

function sanitizeLayer(v: unknown): YouTubeThumbnailLayer | null {
  const o = obj(v)
  const kind = str(o.kind)
  const id = str(o.id)
  if (!id || !kind || !LAYER_KINDS.has(kind)) return null

  const base = {
    id,
    x: clamp(num(o.x), 0, THUMBNAIL_CANVAS_WIDTH),
    y: clamp(num(o.y), 0, THUMBNAIL_CANVAS_HEIGHT),
    width: clamp(num(o.width, 100), 1, THUMBNAIL_CANVAS_WIDTH),
    height: clamp(num(o.height, 100), 1, THUMBNAIL_CANVAS_HEIGHT),
    rotation: clamp(num(o.rotation), -360, 360),
    opacity: clamp(num(o.opacity, 1), 0, 1),
    z: num(o.z),
    stroke: sanitizeStroke(o.stroke),
    shadow: sanitizeShadow(o.shadow),
    glow: sanitizeGlow(o.glow),
  }

  if (kind === 'text') {
    return {
      ...base, kind: 'text',
      text: str(o.text) ?? '',
      fontFamily: str(o.fontFamily) ?? 'sans-serif',
      fontSize: clamp(num(o.fontSize, 48), 4, 400),
      color: str(o.color) ?? '#ffffff',
      align: (['left', 'center', 'right'].includes(String(o.align)) ? o.align : 'left') as 'left' | 'center' | 'right',
      weight: clamp(num(o.weight, 700), 100, 900),
      lineHeight: o.lineHeight === undefined ? undefined : clamp(num(o.lineHeight, 1.1), 0.5, 3),
      uppercase: bool(o.uppercase),
    }
  }
  if (kind === 'image') {
    const src = str(o.src)
    if (!src) return null
    return { ...base, kind: 'image', src, isCutout: bool(o.isCutout), sourceAssetId: str(o.sourceAssetId) }
  }
  if (kind === 'shape') {
    const shape = ['rect', 'ellipse', 'triangle', 'arrow'].includes(String(o.shape)) ? o.shape : 'rect'
    return { ...base, kind: 'shape', shape: shape as 'rect', fill: str(o.fill) ?? '#000000' }
  }
  const src = str(o.src)
  if (!src) return null
  return { ...base, kind: 'sticker', src }
}

function sanitizeCanvas(v: unknown) {
  const o = obj(v)
  return {
    width: THUMBNAIL_CANVAS_WIDTH,
    height: THUMBNAIL_CANVAS_HEIGHT,
    background: str(o.background) ?? '#101014',
    backgroundImageSrc: str(o.backgroundImageSrc),
  }
}

function sanitizeLayers(v: unknown): YouTubeThumbnailLayer[] {
  if (!Array.isArray(v)) return []
  return v.map(sanitizeLayer).filter((l): l is YouTubeThumbnailLayer => l !== null)
}

export function sanitizeThumbnailDesignInput(input: RawInput): Omit<YouTubeThumbnailDesign, 'id' | 'deleted'> {
  const orgId = str(input.orgId)
  const channelWorkspaceId = str(input.channelWorkspaceId)
  const title = str(input.title)
  if (!orgId) throw new Error('orgId is required')
  if (!channelWorkspaceId) throw new Error('channelWorkspaceId is required')
  if (!title) throw new Error('title is required')

  const status = ['draft', 'exported', 'archived'].includes(String(input.status))
    ? (input.status as YouTubeThumbnailDesign['status'])
    : 'draft'

  return {
    orgId,
    channelWorkspaceId,
    videoProjectId: str(input.videoProjectId),
    publishingPacketId: str(input.publishingPacketId),
    templateId: str(input.templateId),
    title,
    status,
    versionNumber: Math.max(1, Math.floor(num(input.versionNumber, 1))),
    canvas: sanitizeCanvas(input.canvas),
    layers: sanitizeLayers(input.layers),
    exportedThumbnailAssetId: str(input.exportedThumbnailAssetId),
    visibility: { showInClientPortal: bool(obj(input.visibility).showInClientPortal) ?? false },
    internalNotes: str(input.internalNotes),
  }
}

const BRAND_VAR_RE = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g

export function extractBrandVariables(layers: YouTubeThumbnailLayer[], canvas: { background: string }): string[] {
  const found = new Set<string>()
  const scan = (s: string | undefined) => {
    if (!s) return
    for (const m of s.matchAll(BRAND_VAR_RE)) found.add(m[1])
  }
  scan(canvas.background)
  for (const l of layers) {
    if (l.kind === 'text') { scan(l.text); scan(l.fontFamily); scan(l.color) }
    if (l.kind === 'shape') scan(l.fill)
    if (l.stroke) scan(l.stroke.color)
  }
  return [...found]
}

export function sanitizeThumbnailTemplateInput(input: RawInput): Omit<YouTubeThumbnailTemplate, 'id' | 'deleted'> {
  const title = str(input.title)
  if (!title) throw new Error('title is required')
  const scope: ThumbnailTemplateScope = input.scope === 'platform' ? 'platform' : 'org'
  const orgId = scope === 'org' ? str(input.orgId) : undefined
  if (scope === 'org' && !orgId) throw new Error('orgId is required for org templates')
  const canvas = sanitizeCanvas(input.canvas)
  const layers = sanitizeLayers(input.layers)
  return {
    scope, orgId, title, description: str(input.description),
    canvas, layers,
    brandVariables: extractBrandVariables(layers, canvas),
  }
}

export function sanitizeThumbnailExperimentInput(input: RawInput): Omit<YouTubeThumbnailExperiment, 'id' | 'deleted'> {
  const orgId = str(input.orgId)
  const channelWorkspaceId = str(input.channelWorkspaceId)
  const videoProjectId = str(input.videoProjectId)
  if (!orgId) throw new Error('orgId is required')
  if (!channelWorkspaceId) throw new Error('channelWorkspaceId is required')
  if (!videoProjectId) throw new Error('videoProjectId is required')

  const mode: ThumbnailExperimentMode = input.mode === 'export_kit' ? 'export_kit' : 'rotation'
  const rawHours = num(input.rotationHours, 48)
  const rotationHours = rawHours >= 1 && rawHours <= 24 * 30 ? rawHours : 48

  const seen = new Set<string>()
  const variants = (Array.isArray(input.variants) ? input.variants : [])
    .map((v) => obj(v))
    .map((v) => ({ id: str(v.id), thumbnailAssetId: str(v.thumbnailAssetId), label: str(v.label), titleText: str(v.titleText) }))
    .filter((v): v is { id: string; thumbnailAssetId: string; label: string; titleText?: string } =>
      Boolean(v.id && v.thumbnailAssetId && v.label))
    .filter((v) => { if (seen.has(v.id)) return false; seen.add(v.id); return true })

  return {
    orgId, channelWorkspaceId, videoProjectId,
    youtubeVideoId: str(input.youtubeVideoId),
    mode,
    status: 'draft',
    rotationHours: mode === 'rotation' ? rotationHours : undefined,
    variants,
    periods: [],
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest __tests__/lib/youtube-studio-thumbnail-sanitize.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/youtube-studio/thumbnail-sanitize.ts __tests__/lib/youtube-studio-thumbnail-sanitize.test.ts
git commit -m "feat(yt): thumbnail design/template/experiment sanitizers"
```

---

## Task 4: Brand-kit resolution + SVG builder + PNG rasterization

**Files:**
- Create: `lib/youtube-studio/thumbnail-render.ts`
- Test: `__tests__/lib/youtube-studio-thumbnail-render.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// __tests__/lib/youtube-studio-thumbnail-render.test.ts
import { resolveBrandVariables, buildThumbnailSvg, rasterizeThumbnail } from '@/lib/youtube-studio/thumbnail-render'
import type { YouTubeThumbnailDesign } from '@/lib/youtube-studio/thumbnail-types'

const brandKit = {
  primaryColor: '#FF0044', secondaryColor: '#222', accentColor: '#0AF',
  backgroundColor: '#101014', textColor: '#EEE', mutedTextColor: '#999',
  fontFamilyPrimary: 'Inter, sans-serif', fontFamilyHeadings: 'Poppins, sans-serif',
} as const

describe('resolveBrandVariables', () => {
  it('substitutes {{token}} with brand kit values and leaves unknown tokens intact', () => {
    expect(resolveBrandVariables('c: {{primaryColor}} f: {{fontFamilyHeadings}} u: {{nope}}', brandKit))
      .toBe('c: #FF0044 f: Poppins, sans-serif u: {{nope}}')
  })
})

describe('buildThumbnailSvg', () => {
  it('emits a 1280x720 svg with resolved text and escaped content', () => {
    const design: YouTubeThumbnailDesign = {
      orgId: 'o', channelWorkspaceId: 'c', title: 'T', status: 'draft', versionNumber: 1,
      canvas: { width: 1280, height: 720, background: '{{backgroundColor}}' },
      layers: [{
        id: 'l1', kind: 'text', x: 40, y: 40, width: 600, height: 200, rotation: 0, opacity: 1, z: 1,
        text: 'A & B <script>', fontFamily: '{{fontFamilyHeadings}}', fontSize: 96,
        color: '{{primaryColor}}', align: 'left', weight: 800,
      }],
      deleted: false,
    }
    const svg = buildThumbnailSvg(design, brandKit)
    expect(svg).toContain('width="1280" height="720"')
    expect(svg).toContain('#FF0044')
    expect(svg).toContain('A &amp; B &lt;script&gt;')
    expect(svg).not.toContain('<script>')
  })
})

describe('rasterizeThumbnail', () => {
  it('produces a non-empty PNG buffer at 1280x720', async () => {
    const design: YouTubeThumbnailDesign = {
      orgId: 'o', channelWorkspaceId: 'c', title: 'T', status: 'draft', versionNumber: 1,
      canvas: { width: 1280, height: 720, background: '#101014' },
      layers: [{ id: 's', kind: 'shape', shape: 'rect', fill: '#FF0044', x: 100, y: 100, width: 300, height: 200, rotation: 0, opacity: 1, z: 0 }],
      deleted: false,
    }
    const png = await rasterizeThumbnail(design, brandKit)
    expect(png.length).toBeGreaterThan(1000)
    expect(png.subarray(1, 4).toString('ascii')).toBe('PNG')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/lib/youtube-studio-thumbnail-render.test.ts`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Write the renderer**

```ts
// lib/youtube-studio/thumbnail-render.ts
import sharp from 'sharp'
import {
  THUMBNAIL_CANVAS_WIDTH,
  THUMBNAIL_CANVAS_HEIGHT,
  type YouTubeThumbnailDesign,
  type YouTubeThumbnailLayer,
} from './thumbnail-types'

/** Subset of the brand kit used to resolve {{token}} variables in designs. */
export interface ThumbnailBrandKit {
  primaryColor: string
  secondaryColor: string
  accentColor: string
  backgroundColor: string
  textColor: string
  mutedTextColor: string
  fontFamilyPrimary: string
  fontFamilyHeadings: string
}

const BRAND_VAR_RE = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g

export function resolveBrandVariables(value: string, brandKit: ThumbnailBrandKit): string {
  return value.replace(BRAND_VAR_RE, (whole, token: string) => {
    const v = (brandKit as Record<string, unknown>)[token]
    return typeof v === 'string' ? v : whole
  })
}

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function layerTransform(l: YouTubeThumbnailLayer): string {
  const cx = l.x + l.width / 2
  const cy = l.y + l.height / 2
  return l.rotation ? ` transform="rotate(${l.rotation} ${cx} ${cy})"` : ''
}

function filterDefs(l: YouTubeThumbnailLayer, id: string): { def: string; ref: string } {
  const parts: string[] = []
  if (l.shadow) {
    parts.push(`<feDropShadow dx="${l.shadow.offsetX}" dy="${l.shadow.offsetY}" stdDeviation="${l.shadow.blur}" flood-color="${esc(l.shadow.color)}"/>`)
  }
  if (l.glow) {
    parts.push(`<feDropShadow dx="0" dy="0" stdDeviation="${l.glow.blur}" flood-color="${esc(l.glow.color)}"/>`)
  }
  if (!parts.length) return { def: '', ref: '' }
  return { def: `<filter id="${id}" x="-50%" y="-50%" width="200%" height="200%">${parts.join('')}</filter>`, ref: ` filter="url(#${id})"` }
}

function renderLayer(l: YouTubeThumbnailLayer, brandKit: ThumbnailBrandKit, index: number): string {
  const fid = `f${index}`
  const { def, ref } = filterDefs(l, fid)
  const t = layerTransform(l)
  const stroke = l.stroke ? ` stroke="${esc(resolveBrandVariables(l.stroke.color, brandKit))}" stroke-width="${l.stroke.width}"` : ''
  const opacity = ` opacity="${l.opacity}"`

  if (l.kind === 'image' || l.kind === 'sticker') {
    return `${def}<image href="${esc(l.src)}" x="${l.x}" y="${l.y}" width="${l.width}" height="${l.height}" preserveAspectRatio="xMidYMid slice"${opacity}${t}${ref}/>`
  }
  if (l.kind === 'shape') {
    const fill = esc(resolveBrandVariables(l.fill, brandKit))
    if (l.shape === 'ellipse') {
      return `${def}<ellipse cx="${l.x + l.width / 2}" cy="${l.y + l.height / 2}" rx="${l.width / 2}" ry="${l.height / 2}" fill="${fill}"${stroke}${opacity}${t}${ref}/>`
    }
    if (l.shape === 'triangle') {
      const pts = `${l.x + l.width / 2},${l.y} ${l.x},${l.y + l.height} ${l.x + l.width},${l.y + l.height}`
      return `${def}<polygon points="${pts}" fill="${fill}"${stroke}${opacity}${t}${ref}/>`
    }
    return `${def}<rect x="${l.x}" y="${l.y}" width="${l.width}" height="${l.height}" fill="${fill}"${stroke}${opacity}${t}${ref}/>`
  }
  // text
  const text = esc(resolveBrandVariables(l.uppercase ? l.text.toUpperCase() : l.text, brandKit))
  const family = esc(resolveBrandVariables(l.fontFamily, brandKit))
  const color = esc(resolveBrandVariables(l.color, brandKit))
  const anchor = l.align === 'center' ? 'middle' : l.align === 'right' ? 'end' : 'start'
  const tx = l.align === 'center' ? l.x + l.width / 2 : l.align === 'right' ? l.x + l.width : l.x
  const ty = l.y + l.fontSize
  return `${def}<text x="${tx}" y="${ty}" font-family="${family}" font-size="${l.fontSize}" font-weight="${l.weight}" fill="${color}" text-anchor="${anchor}"${stroke}${opacity}${t}${ref}>${text}</text>`
}

export function buildThumbnailSvg(design: YouTubeThumbnailDesign, brandKit: ThumbnailBrandKit): string {
  const w = THUMBNAIL_CANVAS_WIDTH
  const h = THUMBNAIL_CANVAS_HEIGHT
  const bg = esc(resolveBrandVariables(design.canvas.background, brandKit))
  const bgImage = design.canvas.backgroundImageSrc
    ? `<image href="${esc(design.canvas.backgroundImageSrc)}" x="0" y="0" width="${w}" height="${h}" preserveAspectRatio="xMidYMid slice"/>`
    : ''
  const ordered = [...design.layers].sort((a, b) => a.z - b.z)
  const body = ordered.map((l, i) => renderLayer(l, brandKit, i)).join('')
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><rect x="0" y="0" width="${w}" height="${h}" fill="${bg}"/>${bgImage}${body}</svg>`
}

/** Rasterize a design to a 1280x720 PNG buffer. Requires network-fetchable image srcs. */
export async function rasterizeThumbnail(design: YouTubeThumbnailDesign, brandKit: ThumbnailBrandKit): Promise<Buffer> {
  const svg = buildThumbnailSvg(design, brandKit)
  return sharp(Buffer.from(svg))
    .resize(THUMBNAIL_CANVAS_WIDTH, THUMBNAIL_CANVAS_HEIGHT, { fit: 'cover' })
    .png()
    .toBuffer()
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest __tests__/lib/youtube-studio-thumbnail-render.test.ts`
Expected: PASS. (If `rasterizeThumbnail` fails because `sharp` cannot fetch remote `href`s — the shape-only test avoids images, so it should pass. Image-layer rendering is validated in the export route test where srcs are data URIs.)

- [ ] **Step 5: Commit**

```bash
git add lib/youtube-studio/thumbnail-render.ts __tests__/lib/youtube-studio-thumbnail-render.test.ts
git commit -m "feat(yt): thumbnail SVG builder + brand-kit resolution + PNG rasterization"
```

---

## Task 5: Platform template library + brand-kit resolution

**Files:**
- Create: `lib/youtube-studio/thumbnail-templates.ts`
- Test: `__tests__/lib/youtube-studio-thumbnail-templates.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// __tests__/lib/youtube-studio-thumbnail-templates.test.ts
import { PLATFORM_THUMBNAIL_TEMPLATES, resolveTemplateWithBrandKit } from '@/lib/youtube-studio/thumbnail-templates'

const brandKit = {
  primaryColor: '#FF0044', secondaryColor: '#222', accentColor: '#0AF',
  backgroundColor: '#101014', textColor: '#EEE', mutedTextColor: '#999',
  fontFamilyPrimary: 'Inter, sans-serif', fontFamilyHeadings: 'Poppins, sans-serif',
} as const

describe('platform thumbnail templates', () => {
  it('ships at least 3 platform templates each 1280x720 with a stable id', () => {
    expect(PLATFORM_THUMBNAIL_TEMPLATES.length).toBeGreaterThanOrEqual(3)
    for (const t of PLATFORM_THUMBNAIL_TEMPLATES) {
      expect(t.scope).toBe('platform')
      expect(t.canvas.width).toBe(1280)
      expect(t.canvas.height).toBe(720)
      expect(typeof t.id).toBe('string')
    }
  })

  it('resolveTemplateWithBrandKit substitutes brand tokens into layers and canvas', () => {
    const tpl = PLATFORM_THUMBNAIL_TEMPLATES.find((t) => t.brandVariables.length > 0)!
    const resolved = resolveTemplateWithBrandKit(tpl, brandKit)
    const serialized = JSON.stringify(resolved)
    expect(serialized).not.toContain('{{primaryColor}}')
    expect(serialized).not.toContain('{{fontFamilyHeadings}}')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/lib/youtube-studio-thumbnail-templates.test.ts`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Write the templates module**

```ts
// lib/youtube-studio/thumbnail-templates.ts
import type { YouTubeThumbnailTemplate, YouTubeThumbnailLayer } from './thumbnail-types'
import { resolveBrandVariables, type ThumbnailBrandKit } from './thumbnail-render'
import { extractBrandVariables } from './thumbnail-sanitize'

function tpl(
  id: string,
  title: string,
  description: string,
  background: string,
  layers: YouTubeThumbnailLayer[],
): YouTubeThumbnailTemplate {
  const canvas = { width: 1280 as const, height: 720 as const, background }
  return {
    id, scope: 'platform', title, description,
    canvas: { width: 1280, height: 720, background },
    layers,
    brandVariables: extractBrandVariables(layers, canvas),
    deleted: false,
  }
}

export const PLATFORM_THUMBNAIL_TEMPLATES: YouTubeThumbnailTemplate[] = [
  tpl('platform-bold-left', 'Bold left text + subject right', 'Big headline on the left, cutout subject on the right.',
    '{{backgroundColor}}', [
      { id: 'subject', kind: 'image', src: '', x: 700, y: 0, width: 580, height: 720, rotation: 0, opacity: 1, z: 0, isCutout: true },
      { id: 'headline', kind: 'text', text: 'YOUR HOOK HERE', fontFamily: '{{fontFamilyHeadings}}', fontSize: 110, color: '{{primaryColor}}', align: 'left', weight: 900, uppercase: true, x: 48, y: 220, width: 620, height: 300, rotation: 0, opacity: 1, z: 2, stroke: { color: '#000000', width: 8 }, shadow: { color: '#000000', blur: 10, offsetX: 4, offsetY: 6 } },
    ]),
  tpl('platform-center-punch', 'Centered punch', 'Centered headline over a full-bleed background.',
    '{{backgroundColor}}', [
      { id: 'headline', kind: 'text', text: 'BIG IDEA', fontFamily: '{{fontFamilyHeadings}}', fontSize: 150, color: '#FFFFFF', align: 'center', weight: 900, uppercase: true, x: 140, y: 260, width: 1000, height: 220, rotation: 0, opacity: 1, z: 2, stroke: { color: '{{primaryColor}}', width: 10 } },
    ]),
  tpl('platform-accent-bar', 'Accent bar lower third', 'Lower-third accent bar with subtitle.',
    '{{backgroundColor}}', [
      { id: 'bar', kind: 'shape', shape: 'rect', fill: '{{accentColor}}', x: 0, y: 560, width: 1280, height: 160, rotation: 0, opacity: 0.9, z: 1 },
      { id: 'sub', kind: 'text', text: 'Subtitle line', fontFamily: '{{fontFamilyPrimary}}', fontSize: 72, color: '#111111', align: 'left', weight: 800, x: 48, y: 588, width: 1180, height: 120, rotation: 0, opacity: 1, z: 2 },
    ]),
]

export function resolveTemplateWithBrandKit(template: YouTubeThumbnailTemplate, brandKit: ThumbnailBrandKit): YouTubeThumbnailTemplate {
  const resolveLayer = (l: YouTubeThumbnailLayer): YouTubeThumbnailLayer => {
    const next = { ...l } as YouTubeThumbnailLayer
    if (next.stroke) next.stroke = { ...next.stroke, color: resolveBrandVariables(next.stroke.color, brandKit) }
    if (next.kind === 'text') { next.text = resolveBrandVariables(next.text, brandKit); next.fontFamily = resolveBrandVariables(next.fontFamily, brandKit); next.color = resolveBrandVariables(next.color, brandKit) }
    if (next.kind === 'shape') next.fill = resolveBrandVariables(next.fill, brandKit)
    return next
  }
  return {
    ...template,
    canvas: { ...template.canvas, background: resolveBrandVariables(template.canvas.background, brandKit) },
    layers: template.layers.map(resolveLayer),
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest __tests__/lib/youtube-studio-thumbnail-templates.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/youtube-studio/thumbnail-templates.ts __tests__/lib/youtube-studio-thumbnail-templates.test.ts
git commit -m "feat(yt): platform thumbnail template library + brand-kit resolution"
```

---

## Task 6: Thumbnail design CRUD routes

**Files:**
- Create: `app/api/v1/youtube-studio/thumbnail-designs/route.ts`
- Create: `app/api/v1/youtube-studio/thumbnail-designs/[id]/route.ts`
- Test: `__tests__/api/youtube-thumbnail-designs.test.ts`

Follow the `source-assets/route.ts` conventions exactly: `withAuth('admin')`, `ensureOrgAccess`, `loadScopedRecord`, `serializeYouTubeRecord`, `actorFields`/`updateActorFields`, `apiSuccess`/`apiError`. Route params are a Promise in Next 15: `{ params }: { params: Promise<{ id: string }> }` then `const { id } = await params`.

- [ ] **Step 1: Write the failing test**

```ts
// __tests__/api/youtube-thumbnail-designs.test.ts
import { NextRequest } from 'next/server'

const mockCollection = jest.fn()
const mockAdd = jest.fn().mockResolvedValue({ id: 'design-1' })
const mockDocGet = jest.fn()
const mockDocSet = jest.fn().mockResolvedValue(undefined)

jest.mock('@/lib/firebase/admin', () => ({ adminDb: { collection: mockCollection } }))
jest.mock('@/lib/api/auth', () => ({
  withAuth: (_r: string, h: (req: NextRequest, u: unknown, c?: unknown) => Promise<Response>) =>
    (req: NextRequest, c?: unknown) => h(req, { uid: 'admin-1', role: 'admin' }, c),
}))
jest.mock('@/lib/api/platformAdmin', () => ({ canAccessOrg: jest.fn(() => true) }))
jest.mock('firebase-admin/firestore', () => ({
  FieldValue: { serverTimestamp: () => 'TS' },
}))

function stage() {
  mockCollection.mockImplementation((name: string) => {
    if (name === 'organizations') return { doc: () => ({ get: async () => ({ exists: true }) }) }
    if (name === 'youtube_channel_workspaces') return { doc: () => ({ get: async () => ({ exists: true, id: 'ch1', data: () => ({ orgId: 'org1', deleted: false }) }) }) }
    if (name === 'youtube_thumbnail_designs') {
      return {
        where: () => ({ get: async () => ({ docs: [{ id: 'design-1', data: () => ({ orgId: 'org1', channelWorkspaceId: 'ch1', title: 'A', status: 'draft', versionNumber: 1, canvas: { width: 1280, height: 720, background: '#000' }, layers: [], deleted: false }) }] }) }),
        add: mockAdd,
        doc: () => ({ get: mockDocGet, set: mockDocSet }),
      }
    }
    throw new Error(`unexpected ${name}`)
  })
}

describe('POST /thumbnail-designs', () => {
  beforeEach(() => { jest.clearAllMocks(); stage() })
  it('creates a design and returns 201 with an id', async () => {
    const { POST } = await import('@/app/api/v1/youtube-studio/thumbnail-designs/route')
    const req = new NextRequest('http://t/api', { method: 'POST', body: JSON.stringify({ orgId: 'org1', channelWorkspaceId: 'ch1', title: 'My thumb', layers: [] }) })
    const res = await POST(req)
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.data.id).toBe('design-1')
    expect(mockAdd).toHaveBeenCalled()
  })
  it('rejects a missing title with 400', async () => {
    const { POST } = await import('@/app/api/v1/youtube-studio/thumbnail-designs/route')
    const req = new NextRequest('http://t/api', { method: 'POST', body: JSON.stringify({ orgId: 'org1', channelWorkspaceId: 'ch1' }) })
    const res = await POST(req)
    expect(res.status).toBe(400)
  })
})

describe('GET /thumbnail-designs', () => {
  beforeEach(() => { jest.clearAllMocks(); stage() })
  it('lists org designs filtered by channel', async () => {
    const { GET } = await import('@/app/api/v1/youtube-studio/thumbnail-designs/route')
    const req = new NextRequest('http://t/api?orgId=org1&channelWorkspaceId=ch1')
    const res = await GET(req)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data.thumbnailDesigns).toHaveLength(1)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/api/youtube-thumbnail-designs.test.ts`
Expected: FAIL — cannot find route module.

- [ ] **Step 3: Write the list/create route**

```ts
// app/api/v1/youtube-studio/thumbnail-designs/route.ts
import { NextRequest } from 'next/server'
import { adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { apiError, apiSuccess } from '@/lib/api/response'
import { actorFields, ensureOrgAccess, listByOrg, loadScopedRecord, YOUTUBE_COLLECTIONS } from '@/lib/youtube-studio/api'
import { serializeYouTubeRecord } from '@/lib/youtube-studio/sanitize'
import { sanitizeThumbnailDesignInput } from '@/lib/youtube-studio/thumbnail-sanitize'
import type { YouTubeThumbnailDesign } from '@/lib/youtube-studio/thumbnail-types'

export const dynamic = 'force-dynamic'

export const GET = withAuth('admin', async (req, user) => {
  const url = new URL(req.url)
  const orgId = url.searchParams.get('orgId')?.trim() ?? ''
  const channelWorkspaceId = url.searchParams.get('channelWorkspaceId')?.trim() ?? ''
  const videoProjectId = url.searchParams.get('videoProjectId')?.trim() ?? ''
  const denied = await ensureOrgAccess(user, orgId)
  if (denied) return denied

  const docs = await listByOrg(YOUTUBE_COLLECTIONS.thumbnailDesigns, orgId)
  const thumbnailDesigns = docs
    .map((doc) => serializeYouTubeRecord<YouTubeThumbnailDesign>(doc.id, doc.data()))
    .filter((d) => !channelWorkspaceId || d.channelWorkspaceId === channelWorkspaceId)
    .filter((d) => !videoProjectId || d.videoProjectId === videoProjectId)
    .sort((a, b) => a.title.localeCompare(b.title))

  return apiSuccess({ thumbnailDesigns })
})

export const POST = withAuth('admin', async (req: NextRequest, user) => {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const orgId = typeof body.orgId === 'string' ? body.orgId.trim() : ''
  const denied = await ensureOrgAccess(user, orgId)
  if (denied) return denied

  let data
  try {
    data = sanitizeThumbnailDesignInput({ ...body, orgId })
  } catch (e) {
    return apiError((e as Error).message, 400)
  }

  const channel = await loadScopedRecord(YOUTUBE_COLLECTIONS.channels, data.channelWorkspaceId)
  if (!channel || channel.data.deleted === true) return apiError('YouTube channel workspace not found', 404)
  if (channel.data.orgId !== orgId) return apiError('channelWorkspaceId does not belong to organisation', 400)

  const ref = await adminDb.collection(YOUTUBE_COLLECTIONS.thumbnailDesigns).add({ ...data, deleted: false, ...actorFields(user) })
  return apiSuccess({ id: ref.id }, 201)
})
```

- [ ] **Step 4: Write the get/put/delete route**

```ts
// app/api/v1/youtube-studio/thumbnail-designs/[id]/route.ts
import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { apiError, apiSuccess } from '@/lib/api/response'
import { ensureOrgAccess, loadScopedRecord, mergePatchForSanitizer, stripUndefinedDeep, updateActorFields, YOUTUBE_COLLECTIONS } from '@/lib/youtube-studio/api'
import { serializeYouTubeRecord } from '@/lib/youtube-studio/sanitize'
import { sanitizeThumbnailDesignInput } from '@/lib/youtube-studio/thumbnail-sanitize'
import type { YouTubeThumbnailDesign } from '@/lib/youtube-studio/thumbnail-types'

export const dynamic = 'force-dynamic'

async function loadOwned(id: string, user: Parameters<typeof updateActorFields>[0]) {
  const record = await loadScopedRecord(YOUTUBE_COLLECTIONS.thumbnailDesigns, id)
  if (!record || record.data.deleted === true) return { error: apiError('Thumbnail design not found', 404) as Response }
  const orgId = typeof record.data.orgId === 'string' ? record.data.orgId : ''
  const denied = await ensureOrgAccess(user, orgId)
  if (denied) return { error: denied }
  return { record, orgId }
}

export const GET = withAuth('admin', async (_req, user, ctx) => {
  const { id } = await (ctx as { params: Promise<{ id: string }> }).params
  const loaded = await loadOwned(id, user)
  if ('error' in loaded) return loaded.error
  return apiSuccess({ thumbnailDesign: serializeYouTubeRecord<YouTubeThumbnailDesign>(loaded.record.id, loaded.record.data) })
})

export const PUT = withAuth('admin', async (req: NextRequest, user, ctx) => {
  const { id } = await (ctx as { params: Promise<{ id: string }> }).params
  const loaded = await loadOwned(id, user)
  if ('error' in loaded) return loaded.error
  const patch = (await req.json().catch(() => ({}))) as Record<string, unknown>
  // Never allow the patch to move the record to another org/channel.
  const locked = { orgId: loaded.orgId, channelWorkspaceId: loaded.record.data.channelWorkspaceId }
  const merged = mergePatchForSanitizer(loaded.record.data, patch, locked)
  let data
  try {
    data = sanitizeThumbnailDesignInput(merged)
  } catch (e) {
    return apiError((e as Error).message, 400)
  }
  await loaded.record.ref.set(stripUndefinedDeep({ ...data, ...updateActorFields(user) }), { merge: true })
  return apiSuccess({ id })
})

export const DELETE = withAuth('admin', async (_req, user, ctx) => {
  const { id } = await (ctx as { params: Promise<{ id: string }> }).params
  const loaded = await loadOwned(id, user)
  if ('error' in loaded) return loaded.error
  await loaded.record.ref.set({ deleted: true, ...updateActorFields(user) }, { merge: true })
  return apiSuccess({ id, deleted: true })
})
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx jest __tests__/api/youtube-thumbnail-designs.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add app/api/v1/youtube-studio/thumbnail-designs __tests__/api/youtube-thumbnail-designs.test.ts
git commit -m "feat(yt): thumbnail design CRUD routes"
```

---

## Task 7: Export design → PNG source asset linked to packet

**Files:**
- Create: `app/api/v1/youtube-studio/thumbnail-designs/[id]/export/route.ts`
- Create: `lib/youtube-studio/thumbnail-export.ts`
- Test: `__tests__/lib/youtube-studio-thumbnail-export.test.ts`

`thumbnail-export.ts` holds the pure orchestration (rasterize → upload buffer to storage → build a `youtube_source_assets` record of type `thumbnail` → optionally patch the packet's `thumbnailAssetId` + set the thumbnail gate to `pass`). The route wires auth + Firestore. Uploading reuses the existing storage helper — verify its name in Step 1.

- [ ] **Step 1: Confirm the storage upload helper**

Run: `cd "/Users/peetstander/Cowork/Partners in Biz — Client Growth/partnersinbiz-web" && grep -rn "export async function upload\|getStorage\|bucket()" lib/firebase lib/storage lib/uploads 2>/dev/null | head`
Expected: identifies the canonical server-side buffer-upload helper (e.g. `uploadBufferToStorage` or a `getStorage().bucket()` pattern). Use whatever exists; if none, upload via `adminStorage.bucket().file(path).save(buffer)` from `@/lib/firebase/admin` and make the file public or return its `gs://`/download path. Record the chosen helper name — the test mocks it by that name.

- [ ] **Step 2: Write the failing test**

```ts
// __tests__/lib/youtube-studio-thumbnail-export.test.ts
import { buildThumbnailSourceAsset, applyThumbnailToPacket } from '@/lib/youtube-studio/thumbnail-export'
import type { YouTubeThumbnailDesign } from '@/lib/youtube-studio/thumbnail-types'

const design: YouTubeThumbnailDesign = {
  id: 'd1', orgId: 'org1', channelWorkspaceId: 'ch1', videoProjectId: 'v1', publishingPacketId: 'p1',
  title: 'Main', status: 'draft', versionNumber: 1,
  canvas: { width: 1280, height: 720, background: '#000' }, layers: [], deleted: false,
}

describe('buildThumbnailSourceAsset', () => {
  it('builds a thumbnail source asset record referencing the storage path', () => {
    const asset = buildThumbnailSourceAsset(design, { storagePath: 'yt/thumb/d1.png', downloadUrl: 'https://cdn/d1.png', sizeBytes: 4242, checksumSha256: 'abc' })
    expect(asset.assetType).toBe('thumbnail')
    expect(asset.mediaFormat).toBe('horizontal')
    expect(asset.channelWorkspaceId).toBe('ch1')
    expect(asset.videoProjectId).toBe('v1')
    expect(asset.storage?.storagePath).toBe('yt/thumb/d1.png')
    expect(asset.storage?.checksumSha256).toBe('abc')
    expect(asset.status).toBe('ready')
  })
})

describe('applyThumbnailToPacket', () => {
  it('produces a merge patch setting thumbnailAssetId and passing the thumbnail gate', () => {
    const patch = applyThumbnailToPacket('asset-9')
    expect(patch.thumbnailAssetId).toBe('asset-9')
    expect((patch.checks as { thumbnail: { status: string } }).thumbnail.status).toBe('pass')
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx jest __tests__/lib/youtube-studio-thumbnail-export.test.ts`
Expected: FAIL — cannot find module.

- [ ] **Step 4: Write the export orchestration lib**

```ts
// lib/youtube-studio/thumbnail-export.ts
import type { YouTubeThumbnailDesign, YouTubeThumbnailLayer } from './thumbnail-types'
import type { YouTubeSourceAsset } from './types'

export interface ThumbnailStorageResult {
  storagePath: string
  downloadUrl?: string
  sizeBytes?: number
  checksumSha256?: string
}

export function buildThumbnailSourceAsset(
  design: YouTubeThumbnailDesign,
  stored: ThumbnailStorageResult,
): Omit<YouTubeSourceAsset, 'id' | 'createdAt' | 'updatedAt' | 'createdBy' | 'createdByType' | 'updatedBy' | 'updatedByType'> {
  return {
    orgId: design.orgId,
    channelWorkspaceId: design.channelWorkspaceId,
    videoProjectId: design.videoProjectId,
    title: `Thumbnail — ${design.title}`,
    assetType: 'thumbnail',
    status: 'ready',
    mediaFormat: 'horizontal',
    sourceUrl: stored.downloadUrl,
    storagePath: stored.storagePath,
    storage: {
      provider: 'firebase_storage',
      storagePath: stored.storagePath,
      originalFilename: `${design.id ?? 'thumbnail'}.png`,
      mimeType: 'image/png',
      sizeBytes: stored.sizeBytes,
      checksumSha256: stored.checksumSha256,
    },
    rights: { status: 'cleared', notes: 'Generated in Thumbnail Studio from org-owned layers.' },
    visibility: { showInClientPortal: true },
    deleted: false,
  }
}

/** Merge patch for the publishing packet once a thumbnail is exported and chosen. */
export function applyThumbnailToPacket(thumbnailAssetId: string) {
  return {
    thumbnailAssetId,
    checks: {
      thumbnail: { status: 'pass' as const, message: 'Thumbnail exported from Thumbnail Studio (1280x720 PNG).' },
    },
  }
}

/** Guard: designs with unresolved brand-variable image cutouts still export (text/shape only ok). */
export function designHasRenderableLayers(layers: YouTubeThumbnailLayer[]): boolean {
  return layers.length > 0
}
```

- [ ] **Step 5: Write the export route**

```ts
// app/api/v1/youtube-studio/thumbnail-designs/[id]/export/route.ts
import { createHash } from 'crypto'
import { NextRequest } from 'next/server'
import { adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { apiError, apiSuccess } from '@/lib/api/response'
import { actorFields, ensureOrgAccess, loadScopedRecord, stripUndefinedDeep, updateActorFields, YOUTUBE_COLLECTIONS } from '@/lib/youtube-studio/api'
import { serializeYouTubeRecord } from '@/lib/youtube-studio/sanitize'
import { getBrandKitForOrg } from '@/lib/brand-kit/store'
import { rasterizeThumbnail, type ThumbnailBrandKit } from '@/lib/youtube-studio/thumbnail-render'
import { buildThumbnailSourceAsset, applyThumbnailToPacket } from '@/lib/youtube-studio/thumbnail-export'
import { uploadThumbnailPng } from '@/lib/youtube-studio/thumbnail-storage'
import type { YouTubeThumbnailDesign } from '@/lib/youtube-studio/thumbnail-types'

export const dynamic = 'force-dynamic'

export const POST = withAuth('admin', async (_req: NextRequest, user, ctx) => {
  const { id } = await (ctx as { params: Promise<{ id: string }> }).params
  const record = await loadScopedRecord(YOUTUBE_COLLECTIONS.thumbnailDesigns, id)
  if (!record || record.data.deleted === true) return apiError('Thumbnail design not found', 404)
  const design = serializeYouTubeRecord<YouTubeThumbnailDesign>(record.id, record.data)
  const denied = await ensureOrgAccess(user, design.orgId)
  if (denied) return denied

  const brandKit = (await getBrandKitForOrg(design.orgId)) as unknown as ThumbnailBrandKit
  const png = await rasterizeThumbnail(design, brandKit)
  const checksum = createHash('sha256').update(png).digest('hex')
  const stored = await uploadThumbnailPng(design.orgId, id, png)

  const asset = buildThumbnailSourceAsset(design, { ...stored, sizeBytes: png.length, checksumSha256: checksum })
  const assetRef = await adminDb.collection(YOUTUBE_COLLECTIONS.sourceAssets).add({ ...asset, ...actorFields(user) })

  const batch = adminDb.batch()
  batch.set(record.ref, stripUndefinedDeep({ status: 'exported', exportedThumbnailAssetId: assetRef.id, ...updateActorFields(user) }), { merge: true })
  if (design.publishingPacketId) {
    const packet = await loadScopedRecord(YOUTUBE_COLLECTIONS.packets, design.publishingPacketId)
    if (packet && packet.data.deleted !== true && packet.data.orgId === design.orgId) {
      batch.set(packet.ref, stripUndefinedDeep({ ...applyThumbnailToPacket(assetRef.id), ...updateActorFields(user) }), { merge: true })
    }
  }
  await batch.commit()

  return apiSuccess({ thumbnailAssetId: assetRef.id, storagePath: stored.storagePath, downloadUrl: stored.downloadUrl }, 201)
})
```

- [ ] **Step 6: Write the storage helper (`lib/youtube-studio/thumbnail-storage.ts`)**

Use the helper identified in Step 1. Minimal Firebase Admin implementation:

```ts
// lib/youtube-studio/thumbnail-storage.ts
import { getStorage } from 'firebase-admin/storage'
import type { ThumbnailStorageResult } from './thumbnail-export'

export async function uploadThumbnailPng(orgId: string, designId: string, png: Buffer): Promise<ThumbnailStorageResult> {
  const bucket = getStorage().bucket()
  const storagePath = `youtube-thumbnails/${orgId}/${designId}-${Date.now()}.png`
  const file = bucket.file(storagePath)
  await file.save(png, { contentType: 'image/png', resumable: false })
  const [downloadUrl] = await file.getSignedUrl({ action: 'read', expires: Date.now() + 365 * 24 * 60 * 60 * 1000 })
  return { storagePath, downloadUrl }
}
```

(If Step 1 found an existing project uploader, call that instead and delete this file. Keep the `ThumbnailStorageResult` return shape.)

- [ ] **Step 7: Run tests to verify they pass**

Run: `npx jest __tests__/lib/youtube-studio-thumbnail-export.test.ts`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add lib/youtube-studio/thumbnail-export.ts lib/youtube-studio/thumbnail-storage.ts app/api/v1/youtube-studio/thumbnail-designs/[id]/export __tests__/lib/youtube-studio-thumbnail-export.test.ts
git commit -m "feat(yt): export thumbnail design to PNG source asset + link packet"
```

---

## Task 8: Background removal (subject cutout) provider wrapper

**Files:**
- Create: `lib/youtube-studio/background-removal.ts`
- Test: `__tests__/lib/youtube-studio-background-removal.test.ts`

Provider-backed cutout with a graceful `not_configured` result so the canvas degrades cleanly when no BYOK key is present. Uses `global.fetch` (isolated for mocking).

- [ ] **Step 1: Write the failing test**

```ts
// __tests__/lib/youtube-studio-background-removal.test.ts
import { removeBackground } from '@/lib/youtube-studio/background-removal'

describe('removeBackground', () => {
  const realFetch = global.fetch
  afterEach(() => { global.fetch = realFetch; jest.restoreAllMocks() })

  it('returns not_configured when no api key is provided or in env', async () => {
    const prev = process.env.REMOVE_BG_API_KEY
    delete process.env.REMOVE_BG_API_KEY
    const res = await removeBackground({ imageUrl: 'https://x/a.png' })
    expect(res.status).toBe('not_configured')
    if (prev !== undefined) process.env.REMOVE_BG_API_KEY = prev
  })

  it('returns a data URL cutout on success', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: async () => new Uint8Array([137, 80, 78, 71]).buffer,
    }) as unknown as typeof fetch
    const res = await removeBackground({ imageUrl: 'https://x/a.png', apiKey: 'k' })
    expect(res.status).toBe('ok')
    expect(res.cutoutDataUrl?.startsWith('data:image/png;base64,')).toBe(true)
  })

  it('returns failed on provider error', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 402, text: async () => 'no credits' }) as unknown as typeof fetch
    const res = await removeBackground({ imageUrl: 'https://x/a.png', apiKey: 'k' })
    expect(res.status).toBe('failed')
    expect(res.message).toMatch(/402|credits/i)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/lib/youtube-studio-background-removal.test.ts`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Write the module**

```ts
// lib/youtube-studio/background-removal.ts
export interface RemoveBackgroundInput {
  imageUrl: string
  /** BYOK remove.bg-compatible key; falls back to REMOVE_BG_API_KEY. */
  apiKey?: string
}

export interface RemoveBackgroundResult {
  status: 'ok' | 'not_configured' | 'failed'
  cutoutDataUrl?: string
  message?: string
}

const REMOVE_BG_URL = 'https://api.remove.bg/v1.0/removebg'

export async function removeBackground(input: RemoveBackgroundInput): Promise<RemoveBackgroundResult> {
  const apiKey = input.apiKey ?? process.env.REMOVE_BG_API_KEY
  if (!apiKey) return { status: 'not_configured', message: 'No background-removal API key configured (BYOK or REMOVE_BG_API_KEY).' }

  try {
    const response = await fetch(REMOVE_BG_URL, {
      method: 'POST',
      headers: { 'X-Api-Key': apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ image_url: input.imageUrl, size: 'auto', format: 'png' }),
    })
    if (!response.ok) {
      const detail = await response.text().catch(() => '')
      return { status: 'failed', message: `Background removal failed (${response.status}) ${detail.slice(0, 200)}`.trim() }
    }
    const buf = Buffer.from(await response.arrayBuffer())
    return { status: 'ok', cutoutDataUrl: `data:image/png;base64,${buf.toString('base64')}` }
  } catch (e) {
    return { status: 'failed', message: (e as Error).message }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest __tests__/lib/youtube-studio-background-removal.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/youtube-studio/background-removal.ts __tests__/lib/youtube-studio-background-removal.test.ts
git commit -m "feat(yt): background-removal subject cutout provider wrapper"
```

---

## Task 9: AI thumbnail variant generation

**Files:**
- Create: `lib/youtube-studio/thumbnail-variants.ts`
- Create: `app/api/v1/youtube-studio/thumbnail-designs/[id]/variants/route.ts`
- Test: `__tests__/lib/youtube-studio-thumbnail-variants.test.ts`

Turns a brief (from the `youtube-thumbnail-brief` skill output) or a manual prompt into 3–6 candidate background images via the Creative Canvas generation dispatch, charging `creative_canvas_credits` per candidate and refunding on failure (idempotent per runId). Each candidate becomes a new draft design (background image layer) referencing the org's `soul-id` when present.

- [ ] **Step 1: Write the failing test**

```ts
// __tests__/lib/youtube-studio-thumbnail-variants.test.ts
import { buildVariantPrompts, buildVariantDesign } from '@/lib/youtube-studio/thumbnail-variants'
import type { YouTubeThumbnailDesign } from '@/lib/youtube-studio/thumbnail-types'

describe('buildVariantPrompts', () => {
  it('clamps count to 3..6 and appends the soul-id reference when present', () => {
    const prompts = buildVariantPrompts({ brief: 'Founder shocked at laptop, bold red', count: 20, soulId: 'soul_abc' })
    expect(prompts).toHaveLength(6)
    expect(prompts[0]).toContain('Founder shocked')
    expect(prompts[0]).toContain('soul_abc')
  })
  it('floors count to 3', () => {
    expect(buildVariantPrompts({ brief: 'x', count: 1 })).toHaveLength(3)
  })
})

describe('buildVariantDesign', () => {
  it('creates a draft design with the generated image as a background layer', () => {
    const base = { orgId: 'o', channelWorkspaceId: 'c', videoProjectId: 'v', title: 'Base' }
    const design: Omit<YouTubeThumbnailDesign, 'id' | 'deleted'> = buildVariantDesign(base, 'https://cdn/gen1.png', 1)
    expect(design.canvas.backgroundImageSrc).toBe('https://cdn/gen1.png')
    expect(design.status).toBe('draft')
    expect(design.title).toContain('Variant 1')
    expect(design.videoProjectId).toBe('v')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/lib/youtube-studio-thumbnail-variants.test.ts`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Write the variants lib**

```ts
// lib/youtube-studio/thumbnail-variants.ts
import type { YouTubeThumbnailDesign } from './thumbnail-types'

export interface BuildVariantPromptsInput {
  brief: string
  count: number
  soulId?: string
}

const THUMB_STYLE_SUFFIX = 'YouTube thumbnail composition, 16:9, high contrast, bold focal subject, space for large headline text, no watermark'

export function buildVariantPrompts(input: BuildVariantPromptsInput): string[] {
  const count = Math.min(6, Math.max(3, Math.floor(input.count || 3)))
  const brief = input.brief.trim() || 'Compelling YouTube thumbnail'
  const soul = input.soulId ? ` [soul_id:${input.soulId}]` : ''
  const angles = ['dramatic close-up', 'wide establishing shot', 'split composition', 'reaction shot', 'product hero', 'text-forward layout']
  return Array.from({ length: count }, (_, i) =>
    `${brief}. ${angles[i % angles.length]}. ${THUMB_STYLE_SUFFIX}${soul}`)
}

export interface VariantBase {
  orgId: string
  channelWorkspaceId: string
  videoProjectId?: string
  publishingPacketId?: string
  title: string
}

export function buildVariantDesign(base: VariantBase, imageUrl: string, index: number): Omit<YouTubeThumbnailDesign, 'id' | 'deleted'> {
  return {
    orgId: base.orgId,
    channelWorkspaceId: base.channelWorkspaceId,
    videoProjectId: base.videoProjectId,
    publishingPacketId: base.publishingPacketId,
    title: `${base.title} — AI Variant ${index}`,
    status: 'draft',
    versionNumber: 1,
    canvas: { width: 1280, height: 720, background: '#000000', backgroundImageSrc: imageUrl },
    layers: [],
    visibility: { showInClientPortal: false },
  }
}
```

- [ ] **Step 4: Write the variants route**

The route: loads the design (org check), reads `{ brief?, prompt?, count?, providerKey?, model? }` from the body, resolves the org soul-id (best-effort: `grep` for the soul-id resolver in Step 5 of Task 9a below — if none, omit), calls `generateInline` per prompt (image providers) charging credits via `recordCanvasCreditUsage`, refunds via `refundCanvasCreditUsage` on failure, and writes each success as a new draft design. Async-only providers (Higgsfield) throw `InlineNotSupportedError` — catch it and return a `202` telling the caller to use the job-based canvas dispatch instead (out of scope for inline path).

```ts
// app/api/v1/youtube-studio/thumbnail-designs/[id]/variants/route.ts
import { NextRequest } from 'next/server'
import { adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { apiError, apiSuccess } from '@/lib/api/response'
import { actorFields, ensureOrgAccess, loadScopedRecord, YOUTUBE_COLLECTIONS } from '@/lib/youtube-studio/api'
import { serializeYouTubeRecord } from '@/lib/youtube-studio/sanitize'
import { generateInline, InlineNotSupportedError } from '@/lib/creative-canvas/inline-generation'
import { getCanvasCredits, hasSufficientCredits, recordCanvasCreditUsage, refundCanvasCreditUsage } from '@/lib/creative-canvas/credits'
import { buildVariantPrompts, buildVariantDesign } from '@/lib/youtube-studio/thumbnail-variants'
import type { YouTubeThumbnailDesign } from '@/lib/youtube-studio/thumbnail-types'

export const dynamic = 'force-dynamic'

const CREDIT_COST_PER_VARIANT = 1

export const POST = withAuth('admin', async (req: NextRequest, user, ctx) => {
  const { id } = await (ctx as { params: Promise<{ id: string }> }).params
  const record = await loadScopedRecord(YOUTUBE_COLLECTIONS.thumbnailDesigns, id)
  if (!record || record.data.deleted === true) return apiError('Thumbnail design not found', 404)
  const base = serializeYouTubeRecord<YouTubeThumbnailDesign>(record.id, record.data)
  const denied = await ensureOrgAccess(user, base.orgId)
  if (denied) return denied

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const brief = typeof body.brief === 'string' && body.brief.trim() ? body.brief.trim()
    : typeof body.prompt === 'string' ? body.prompt.trim() : ''
  if (!brief) return apiError('brief or prompt is required', 400)
  const count = typeof body.count === 'number' ? body.count : 3
  const providerKey = typeof body.providerKey === 'string' ? body.providerKey : 'xai'
  const model = typeof body.model === 'string' ? body.model : ''
  const soulId = typeof body.soulId === 'string' ? body.soulId : undefined

  const prompts = buildVariantPrompts({ brief, count, soulId })
  const credits = await getCanvasCredits(base.orgId)
  if (!hasSufficientCredits(credits, prompts.length * CREDIT_COST_PER_VARIANT)) {
    return apiError('Insufficient creative canvas credits for the requested variant count', 402)
  }

  const created: string[] = []
  const errors: string[] = []
  for (let i = 0; i < prompts.length; i++) {
    const runId = `thumb-variant-${id}-${Date.now()}-${i}`
    await recordCanvasCreditUsage(base.orgId, CREDIT_COST_PER_VARIANT, { runId, model: providerKey })
    try {
      const gen = await generateInline({ providerKey, model, prompt: prompts[i], aspectRatio: '16:9' })
      if (!gen.url) throw new Error('No image returned')
      const design = buildVariantDesign(base, gen.url, i + 1)
      const ref = await adminDb.collection(YOUTUBE_COLLECTIONS.thumbnailDesigns).add({ ...design, deleted: false, ...actorFields(user) })
      created.push(ref.id)
    } catch (e) {
      await refundCanvasCreditUsage(base.orgId, runId)
      if (e instanceof InlineNotSupportedError) {
        return apiError('Selected provider requires the async canvas dispatch; use Creative Canvas Higgsfield generation instead.', 202)
      }
      errors.push((e as Error).message)
    }
  }

  return apiSuccess({ createdDesignIds: created, errors }, created.length ? 201 : 502)
})
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx jest __tests__/lib/youtube-studio-thumbnail-variants.test.ts`
Expected: PASS. (The route's provider/credit wiring is exercised by an integration test in Task 9's optional follow-up; the pure builders are the TDD gate here.)

- [ ] **Step 6: Commit**

```bash
git add lib/youtube-studio/thumbnail-variants.ts app/api/v1/youtube-studio/thumbnail-designs/[id]/variants __tests__/lib/youtube-studio-thumbnail-variants.test.ts
git commit -m "feat(yt): AI thumbnail variant generation with credit metering"
```

---

## Task 10: Thumbnail template routes (platform + org)

**Files:**
- Create: `app/api/v1/youtube-studio/thumbnail-templates/route.ts`
- Test: `__tests__/api/youtube-thumbnail-templates.test.ts`

GET returns platform templates (from `PLATFORM_THUMBNAIL_TEMPLATES`, resolved against the org's brand kit when `orgId` is provided) merged with the org's stored `youtube_thumbnail_templates`. POST creates an org template.

- [ ] **Step 1: Write the failing test**

```ts
// __tests__/api/youtube-thumbnail-templates.test.ts
import { NextRequest } from 'next/server'

const mockCollection = jest.fn()
const mockAdd = jest.fn().mockResolvedValue({ id: 'tpl-1' })

jest.mock('@/lib/firebase/admin', () => ({ adminDb: { collection: mockCollection } }))
jest.mock('@/lib/api/auth', () => ({
  withAuth: (_r: string, h: (req: NextRequest, u: unknown, c?: unknown) => Promise<Response>) =>
    (req: NextRequest, c?: unknown) => h(req, { uid: 'admin-1', role: 'admin' }, c),
}))
jest.mock('@/lib/api/platformAdmin', () => ({ canAccessOrg: jest.fn(() => true) }))
jest.mock('@/lib/brand-kit/store', () => ({
  getBrandKitForOrg: jest.fn(async () => ({
    primaryColor: '#FF0044', secondaryColor: '#222', accentColor: '#0AF',
    backgroundColor: '#101014', textColor: '#EEE', mutedTextColor: '#999',
    fontFamilyPrimary: 'Inter', fontFamilyHeadings: 'Poppins',
  })),
}))
jest.mock('firebase-admin/firestore', () => ({ FieldValue: { serverTimestamp: () => 'TS' } }))

function stage(orgTemplates: unknown[] = []) {
  mockCollection.mockImplementation((name: string) => {
    if (name === 'organizations') return { doc: () => ({ get: async () => ({ exists: true }) }) }
    if (name === 'youtube_thumbnail_templates') return {
      where: () => ({ get: async () => ({ docs: orgTemplates.map((t, i) => ({ id: `org-tpl-${i}`, data: () => t })) }) }),
      add: mockAdd,
    }
    throw new Error(`unexpected ${name}`)
  })
}

describe('GET /thumbnail-templates', () => {
  beforeEach(() => { jest.clearAllMocks(); stage() })
  it('returns brand-resolved platform templates plus org templates', async () => {
    const { GET } = await import('@/app/api/v1/youtube-studio/thumbnail-templates/route')
    const res = await GET(new NextRequest('http://t/api?orgId=org1'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data.templates.length).toBeGreaterThanOrEqual(3)
    expect(JSON.stringify(body.data.templates)).not.toContain('{{primaryColor}}')
  })
})

describe('POST /thumbnail-templates', () => {
  beforeEach(() => { jest.clearAllMocks(); stage() })
  it('creates an org template', async () => {
    const { POST } = await import('@/app/api/v1/youtube-studio/thumbnail-templates/route')
    const req = new NextRequest('http://t/api', { method: 'POST', body: JSON.stringify({ orgId: 'org1', scope: 'org', title: 'Mine', layers: [] }) })
    const res = await POST(req)
    expect(res.status).toBe(201)
    expect((await res.json()).data.id).toBe('tpl-1')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/api/youtube-thumbnail-templates.test.ts`
Expected: FAIL — cannot find route module.

- [ ] **Step 3: Write the route**

```ts
// app/api/v1/youtube-studio/thumbnail-templates/route.ts
import { NextRequest } from 'next/server'
import { adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { apiError, apiSuccess } from '@/lib/api/response'
import { actorFields, ensureOrgAccess, listByOrg, YOUTUBE_COLLECTIONS } from '@/lib/youtube-studio/api'
import { serializeYouTubeRecord } from '@/lib/youtube-studio/sanitize'
import { getBrandKitForOrg } from '@/lib/brand-kit/store'
import { PLATFORM_THUMBNAIL_TEMPLATES, resolveTemplateWithBrandKit } from '@/lib/youtube-studio/thumbnail-templates'
import { sanitizeThumbnailTemplateInput } from '@/lib/youtube-studio/thumbnail-sanitize'
import type { ThumbnailBrandKit } from '@/lib/youtube-studio/thumbnail-render'
import type { YouTubeThumbnailTemplate } from '@/lib/youtube-studio/thumbnail-types'

export const dynamic = 'force-dynamic'

export const GET = withAuth('admin', async (req, user) => {
  const url = new URL(req.url)
  const orgId = url.searchParams.get('orgId')?.trim() ?? ''
  const denied = await ensureOrgAccess(user, orgId)
  if (denied) return denied

  const brandKit = (await getBrandKitForOrg(orgId)) as unknown as ThumbnailBrandKit
  const platform = PLATFORM_THUMBNAIL_TEMPLATES.map((t) => resolveTemplateWithBrandKit(t, brandKit))
  const orgDocs = await listByOrg(YOUTUBE_COLLECTIONS.thumbnailTemplates, orgId)
  const org = orgDocs.map((doc) => serializeYouTubeRecord<YouTubeThumbnailTemplate>(doc.id, doc.data()))

  return apiSuccess({ templates: [...platform, ...org] })
})

export const POST = withAuth('admin', async (req: NextRequest, user) => {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const orgId = typeof body.orgId === 'string' ? body.orgId.trim() : ''
  const denied = await ensureOrgAccess(user, orgId)
  if (denied) return denied

  let data
  try {
    data = sanitizeThumbnailTemplateInput({ ...body, scope: 'org', orgId })
  } catch (e) {
    return apiError((e as Error).message, 400)
  }
  const ref = await adminDb.collection(YOUTUBE_COLLECTIONS.thumbnailTemplates).add({ ...data, deleted: false, ...actorFields(user) })
  return apiSuccess({ id: ref.id }, 201)
})
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest __tests__/api/youtube-thumbnail-templates.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/api/v1/youtube-studio/thumbnail-templates __tests__/api/youtube-thumbnail-templates.test.ts
git commit -m "feat(yt): thumbnail template routes (platform + org)"
```

---

## Task 11: Per-org quota ledger

**Files:**
- Create: `lib/youtube-studio/quota-ledger.ts`
- Test: `__tests__/lib/youtube-studio-quota-ledger.test.ts`

Records YouTube Data API quota spend per org per UTC day, forecasts remaining. `thumbnails.set` = 50 units (spec constant). Default daily quota = 10000 (YouTube standard) unless the channel's `publishingReadiness.quotaDailyLimit` overrides.

- [ ] **Step 1: Write the failing test**

```ts
// __tests__/lib/youtube-studio-quota-ledger.test.ts
import { THUMBNAILS_SET_QUOTA_UNITS, quotaDayKey, forecastRemaining } from '@/lib/youtube-studio/quota-ledger'

describe('quota ledger pure helpers', () => {
  it('exports the thumbnails.set cost as 50', () => {
    expect(THUMBNAILS_SET_QUOTA_UNITS).toBe(50)
  })
  it('bucketizes to a UTC day key', () => {
    expect(quotaDayKey(new Date('2026-07-06T23:59:00Z'))).toBe('2026-07-06')
    expect(quotaDayKey(new Date('2026-07-07T00:01:00Z'))).toBe('2026-07-07')
  })
  it('forecasts remaining units and how many thumbnail sets fit', () => {
    const f = forecastRemaining({ dailyLimit: 10000, usedToday: 9900 })
    expect(f.remaining).toBe(100)
    expect(f.thumbnailSetsRemaining).toBe(2) // floor(100/50)
  })
  it('never returns negative remaining', () => {
    expect(forecastRemaining({ dailyLimit: 100, usedToday: 250 }).remaining).toBe(0)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/lib/youtube-studio-quota-ledger.test.ts`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Write the ledger**

```ts
// lib/youtube-studio/quota-ledger.ts
import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import { YOUTUBE_COLLECTIONS } from './api'

export const THUMBNAILS_SET_QUOTA_UNITS = 50
export const DEFAULT_DAILY_QUOTA = 10000

export function quotaDayKey(when: Date = new Date()): string {
  return when.toISOString().slice(0, 10)
}

export interface QuotaForecast {
  remaining: number
  thumbnailSetsRemaining: number
}

export function forecastRemaining(input: { dailyLimit: number; usedToday: number }): QuotaForecast {
  const remaining = Math.max(0, input.dailyLimit - input.usedToday)
  return { remaining, thumbnailSetsRemaining: Math.floor(remaining / THUMBNAILS_SET_QUOTA_UNITS) }
}

function ledgerDocId(orgId: string, dayKey: string): string {
  return `${orgId}_${dayKey}`
}

export async function getUsedToday(orgId: string, dayKey = quotaDayKey()): Promise<number> {
  const snap = await adminDb.collection(YOUTUBE_COLLECTIONS.quotaLedger).doc(ledgerDocId(orgId, dayKey)).get()
  const used = snap.exists ? (snap.data()?.usedUnits as number | undefined) : 0
  return typeof used === 'number' && Number.isFinite(used) ? used : 0
}

export async function recordQuotaUsage(
  orgId: string,
  units: number,
  meta: { operation: string; channelWorkspaceId?: string; experimentId?: string },
): Promise<void> {
  const dayKey = quotaDayKey()
  const docRef = adminDb.collection(YOUTUBE_COLLECTIONS.quotaLedger).doc(ledgerDocId(orgId, dayKey))
  await docRef.set({
    orgId,
    dayKey,
    usedUnits: FieldValue.increment(units),
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true })
  await docRef.collection('entries').add({
    units,
    operation: meta.operation,
    channelWorkspaceId: meta.channelWorkspaceId ?? null,
    experimentId: meta.experimentId ?? null,
    createdAt: FieldValue.serverTimestamp(),
  })
}

export async function canSpendQuota(orgId: string, units: number, dailyLimit = DEFAULT_DAILY_QUOTA): Promise<boolean> {
  const used = await getUsedToday(orgId)
  return used + units <= dailyLimit
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest __tests__/lib/youtube-studio-quota-ledger.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/youtube-studio/quota-ledger.ts __tests__/lib/youtube-studio-quota-ledger.test.ts
git commit -m "feat(yt): per-org YouTube quota ledger with forecasting"
```

---

## Task 12: Thumbnail A/B experiment lifecycle + statistics

**Files:**
- Create: `lib/youtube-studio/thumbnail-experiments.ts`
- Test: `__tests__/lib/youtube-studio-thumbnail-experiments.test.ts`

Pure lifecycle math: pick the next rotation variant, decide whether a rotation is due, aggregate CTR per variant across periods, and declare a winner with a confidence level (simple two-proportion z-test on impressions/clicks). The Firestore/`thumbnails.set`/Analytics I/O lives in the cron task (Task 14).

- [ ] **Step 1: Write the failing test**

```ts
// __tests__/lib/youtube-studio-thumbnail-experiments.test.ts
import { nextRotationVariantId, isRotationDue, aggregateVariantStats, declareWinner } from '@/lib/youtube-studio/thumbnail-experiments'
import type { YouTubeThumbnailExperiment } from '@/lib/youtube-studio/thumbnail-types'

const base: YouTubeThumbnailExperiment = {
  orgId: 'o', channelWorkspaceId: 'c', videoProjectId: 'v', youtubeVideoId: 'yt',
  mode: 'rotation', status: 'running', rotationHours: 24,
  variants: [
    { id: 'a', thumbnailAssetId: 'as-a', label: 'A' },
    { id: 'b', thumbnailAssetId: 'as-b', label: 'B' },
  ],
  periods: [], deleted: false,
}

describe('nextRotationVariantId', () => {
  it('starts at the first variant when none applied yet', () => {
    expect(nextRotationVariantId(base)).toBe('a')
  })
  it('rotates round-robin from the current variant', () => {
    expect(nextRotationVariantId({ ...base, currentVariantId: 'a' })).toBe('b')
    expect(nextRotationVariantId({ ...base, currentVariantId: 'b' })).toBe('a')
  })
})

describe('isRotationDue', () => {
  it('is due when now exceeds lastRotatedAt + rotationHours', () => {
    const last = new Date('2026-07-01T00:00:00Z').getTime()
    expect(isRotationDue({ ...base, rotationHours: 24 }, last, new Date('2026-07-02T01:00:00Z').getTime())).toBe(true)
    expect(isRotationDue({ ...base, rotationHours: 24 }, last, new Date('2026-07-01T12:00:00Z').getTime())).toBe(false)
  })
  it('is due immediately when never rotated', () => {
    expect(isRotationDue(base, null, Date.now())).toBe(true)
  })
})

describe('aggregateVariantStats', () => {
  it('sums impressions/views and computes weighted CTR per variant', () => {
    const exp: YouTubeThumbnailExperiment = { ...base, periods: [
      { variantId: 'a', startedAt: '', impressions: 1000, ctr: 0.04, views: 40 },
      { variantId: 'a', startedAt: '', impressions: 1000, ctr: 0.06, views: 60 },
      { variantId: 'b', startedAt: '', impressions: 2000, ctr: 0.03, views: 60 },
    ] }
    const stats = aggregateVariantStats(exp)
    const a = stats.find((s) => s.variantId === 'a')!
    expect(a.impressions).toBe(2000)
    expect(a.clicks).toBe(100)
    expect(a.ctr).toBeCloseTo(0.05, 5)
  })
})

describe('declareWinner', () => {
  it('picks the higher-CTR variant and labels confidence high on a strong, large-sample gap', () => {
    const exp: YouTubeThumbnailExperiment = { ...base, periods: [
      { variantId: 'a', startedAt: '', impressions: 10000, views: 800 },  // 8%
      { variantId: 'b', startedAt: '', impressions: 10000, views: 400 },  // 4%
    ] }
    const w = declareWinner(exp)
    expect(w?.variantId).toBe('a')
    expect(w?.confidence).toBe('high')
  })
  it('returns low confidence on tiny samples', () => {
    const exp: YouTubeThumbnailExperiment = { ...base, periods: [
      { variantId: 'a', startedAt: '', impressions: 50, views: 5 },
      { variantId: 'b', startedAt: '', impressions: 50, views: 3 },
    ] }
    expect(declareWinner(exp)?.confidence).toBe('low')
  })
  it('returns null when there is no data', () => {
    expect(declareWinner(base)).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/lib/youtube-studio-thumbnail-experiments.test.ts`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Write the lifecycle module**

```ts
// lib/youtube-studio/thumbnail-experiments.ts
import type { YouTubeThumbnailExperiment } from './thumbnail-types'

export function nextRotationVariantId(exp: YouTubeThumbnailExperiment): string | null {
  if (!exp.variants.length) return null
  const idx = exp.currentVariantId ? exp.variants.findIndex((v) => v.id === exp.currentVariantId) : -1
  const next = exp.variants[(idx + 1) % exp.variants.length]
  return next?.id ?? null
}

export function isRotationDue(exp: YouTubeThumbnailExperiment, lastRotatedMs: number | null, nowMs: number): boolean {
  if (lastRotatedMs === null) return true
  const hours = exp.rotationHours && exp.rotationHours > 0 ? exp.rotationHours : 48
  return nowMs >= lastRotatedMs + hours * 60 * 60 * 1000
}

export interface VariantStats {
  variantId: string
  impressions: number
  clicks: number
  ctr: number
}

export function aggregateVariantStats(exp: YouTubeThumbnailExperiment): VariantStats[] {
  const byVariant = new Map<string, { impressions: number; clicks: number }>()
  for (const p of exp.periods) {
    const acc = byVariant.get(p.variantId) ?? { impressions: 0, clicks: 0 }
    const impressions = p.impressions ?? 0
    // Prefer explicit views (clicks); else derive from ctr*impressions.
    const clicks = p.views ?? (p.ctr !== undefined ? Math.round(p.ctr * impressions) : 0)
    acc.impressions += impressions
    acc.clicks += clicks
    byVariant.set(p.variantId, acc)
  }
  return [...byVariant.entries()].map(([variantId, v]) => ({
    variantId,
    impressions: v.impressions,
    clicks: v.clicks,
    ctr: v.impressions > 0 ? v.clicks / v.impressions : 0,
  }))
}

export interface WinnerResult {
  variantId: string
  confidence: 'low' | 'medium' | 'high'
  ctr: number
  runnerUpCtr: number
  zScore: number
}

/** Two-proportion z-test between the top two variants by CTR. */
export function declareWinner(exp: YouTubeThumbnailExperiment): WinnerResult | null {
  const stats = aggregateVariantStats(exp).filter((s) => s.impressions > 0)
  if (!stats.length) return null
  const sorted = [...stats].sort((a, b) => b.ctr - a.ctr)
  const top = sorted[0]
  const runnerUp = sorted[1]
  if (!runnerUp) {
    return { variantId: top.variantId, confidence: 'low', ctr: top.ctr, runnerUpCtr: 0, zScore: 0 }
  }
  const p1 = top.ctr
  const p2 = runnerUp.ctr
  const n1 = top.impressions
  const n2 = runnerUp.impressions
  const pooled = (top.clicks + runnerUp.clicks) / (n1 + n2)
  const se = Math.sqrt(pooled * (1 - pooled) * (1 / n1 + 1 / n2))
  const z = se > 0 ? (p1 - p2) / se : 0
  const confidence: WinnerResult['confidence'] =
    z >= 2.58 && n1 >= 1000 && n2 >= 1000 ? 'high'
    : z >= 1.96 && n1 >= 300 && n2 >= 300 ? 'medium'
    : 'low'
  return { variantId: top.variantId, confidence, ctr: p1, runnerUpCtr: p2, zScore: z }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest __tests__/lib/youtube-studio-thumbnail-experiments.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/youtube-studio/thumbnail-experiments.ts __tests__/lib/youtube-studio-thumbnail-experiments.test.ts
git commit -m "feat(yt): thumbnail A/B experiment lifecycle + winner statistics"
```

---

## Task 13: Experiment routes + per-org A/B toggle (default ON)

**Files:**
- Create: `app/api/v1/youtube-studio/thumbnail-experiments/route.ts` (GET list, POST create)
- Create: `app/api/v1/youtube-studio/thumbnail-experiments/[id]/route.ts` (GET, PUT status/winner)
- Create: `app/api/v1/youtube-studio/channels/[id]/thumbnail-ab-settings/route.ts` (GET, PUT toggle)
- Test: `__tests__/api/youtube-thumbnail-experiments.test.ts`

The per-org toggle is stored on the channel workspace as `thumbnailAbRotationEnabled` (boolean). GET defaults it to `true` (spec: default ON). Creating a `rotation` experiment is rejected with `409` when the toggle is off.

- [ ] **Step 1: Write the failing test**

```ts
// __tests__/api/youtube-thumbnail-experiments.test.ts
import { NextRequest } from 'next/server'

const mockCollection = jest.fn()
const mockAdd = jest.fn().mockResolvedValue({ id: 'exp-1' })
const mockChannelSet = jest.fn().mockResolvedValue(undefined)

jest.mock('@/lib/firebase/admin', () => ({ adminDb: { collection: mockCollection } }))
jest.mock('@/lib/api/auth', () => ({
  withAuth: (_r: string, h: (req: NextRequest, u: unknown, c?: unknown) => Promise<Response>) =>
    (req: NextRequest, c?: unknown) => h(req, { uid: 'admin-1', role: 'admin' }, c),
}))
jest.mock('@/lib/api/platformAdmin', () => ({ canAccessOrg: jest.fn(() => true) }))
jest.mock('firebase-admin/firestore', () => ({ FieldValue: { serverTimestamp: () => 'TS' } }))

function channelDoc(enabled: boolean | undefined) {
  return { get: async () => ({ exists: true, id: 'ch1', data: () => ({ orgId: 'org1', deleted: false, thumbnailAbRotationEnabled: enabled }) }), set: mockChannelSet }
}

function stage(enabled: boolean | undefined = true) {
  mockCollection.mockImplementation((name: string) => {
    if (name === 'organizations') return { doc: () => ({ get: async () => ({ exists: true }) }) }
    if (name === 'youtube_channel_workspaces') return { doc: () => channelDoc(enabled) }
    if (name === 'youtube_video_projects') return { doc: () => ({ get: async () => ({ exists: true, id: 'v1', data: () => ({ orgId: 'org1', channelWorkspaceId: 'ch1', deleted: false }) }) }) }
    if (name === 'youtube_thumbnail_experiments') return {
      where: () => ({ get: async () => ({ docs: [] }) }), add: mockAdd,
      doc: () => ({ get: async () => ({ exists: true, id: 'exp-1', data: () => ({ orgId: 'org1', deleted: false }) }) }),
    }
    throw new Error(`unexpected ${name}`)
  })
}

describe('POST /thumbnail-experiments', () => {
  beforeEach(() => jest.clearAllMocks())
  it('creates a rotation experiment when the toggle is on', async () => {
    stage(true)
    const { POST } = await import('@/app/api/v1/youtube-studio/thumbnail-experiments/route')
    const req = new NextRequest('http://t/api', { method: 'POST', body: JSON.stringify({ orgId: 'org1', channelWorkspaceId: 'ch1', videoProjectId: 'v1', mode: 'rotation', variants: [{ id: 'a', thumbnailAssetId: 'as-a', label: 'A' }, { id: 'b', thumbnailAssetId: 'as-b', label: 'B' }] }) })
    const res = await POST(req)
    expect(res.status).toBe(201)
  })
  it('rejects a rotation experiment when the toggle is off', async () => {
    stage(false)
    const { POST } = await import('@/app/api/v1/youtube-studio/thumbnail-experiments/route')
    const req = new NextRequest('http://t/api', { method: 'POST', body: JSON.stringify({ orgId: 'org1', channelWorkspaceId: 'ch1', videoProjectId: 'v1', mode: 'rotation', variants: [{ id: 'a', thumbnailAssetId: 'as-a', label: 'A' }, { id: 'b', thumbnailAssetId: 'as-b', label: 'B' }] }) })
    const res = await POST(req)
    expect(res.status).toBe(409)
  })
})

describe('GET+PUT /channels/[id]/thumbnail-ab-settings', () => {
  beforeEach(() => { jest.clearAllMocks(); stage(undefined) })
  it('defaults the toggle to ON when unset', async () => {
    const { GET } = await import('@/app/api/v1/youtube-studio/channels/[id]/thumbnail-ab-settings/route')
    const res = await GET(new NextRequest('http://t/api'), { params: Promise.resolve({ id: 'ch1' }) })
    expect((await res.json()).data.thumbnailAbRotationEnabled).toBe(true)
  })
  it('persists a toggle change', async () => {
    const { PUT } = await import('@/app/api/v1/youtube-studio/channels/[id]/thumbnail-ab-settings/route')
    const req = new NextRequest('http://t/api', { method: 'PUT', body: JSON.stringify({ thumbnailAbRotationEnabled: false }) })
    const res = await PUT(req, { params: Promise.resolve({ id: 'ch1' }) })
    expect(res.status).toBe(200)
    expect(mockChannelSet).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/api/youtube-thumbnail-experiments.test.ts`
Expected: FAIL — cannot find route modules.

- [ ] **Step 3: Write the experiments list/create route**

```ts
// app/api/v1/youtube-studio/thumbnail-experiments/route.ts
import { NextRequest } from 'next/server'
import { adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { apiError, apiSuccess } from '@/lib/api/response'
import { actorFields, ensureOrgAccess, listByOrg, loadScopedRecord, YOUTUBE_COLLECTIONS } from '@/lib/youtube-studio/api'
import { serializeYouTubeRecord } from '@/lib/youtube-studio/sanitize'
import { sanitizeThumbnailExperimentInput } from '@/lib/youtube-studio/thumbnail-sanitize'
import type { YouTubeThumbnailExperiment } from '@/lib/youtube-studio/thumbnail-types'

export const dynamic = 'force-dynamic'

export const GET = withAuth('admin', async (req, user) => {
  const url = new URL(req.url)
  const orgId = url.searchParams.get('orgId')?.trim() ?? ''
  const videoProjectId = url.searchParams.get('videoProjectId')?.trim() ?? ''
  const denied = await ensureOrgAccess(user, orgId)
  if (denied) return denied
  const docs = await listByOrg(YOUTUBE_COLLECTIONS.thumbnailExperiments, orgId)
  const experiments = docs
    .map((doc) => serializeYouTubeRecord<YouTubeThumbnailExperiment>(doc.id, doc.data()))
    .filter((e) => !videoProjectId || e.videoProjectId === videoProjectId)
  return apiSuccess({ experiments })
})

export const POST = withAuth('admin', async (req: NextRequest, user) => {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const orgId = typeof body.orgId === 'string' ? body.orgId.trim() : ''
  const denied = await ensureOrgAccess(user, orgId)
  if (denied) return denied

  let data
  try {
    data = sanitizeThumbnailExperimentInput({ ...body, orgId })
  } catch (e) {
    return apiError((e as Error).message, 400)
  }
  if (data.variants.length < 2) return apiError('An experiment requires at least two variants', 400)

  const channel = await loadScopedRecord(YOUTUBE_COLLECTIONS.channels, data.channelWorkspaceId)
  if (!channel || channel.data.deleted === true) return apiError('YouTube channel workspace not found', 404)
  if (channel.data.orgId !== orgId) return apiError('channelWorkspaceId does not belong to organisation', 400)

  const video = await loadScopedRecord(YOUTUBE_COLLECTIONS.videos, data.videoProjectId)
  if (!video || video.data.deleted === true) return apiError('Video project not found', 404)
  if (video.data.orgId !== orgId) return apiError('videoProjectId does not belong to organisation', 400)

  if (data.mode === 'rotation') {
    const enabled = channel.data.thumbnailAbRotationEnabled
    if (enabled === false) return apiError('Thumbnail rotation A/B is disabled for this channel', 409)
  }

  const ref = await adminDb.collection(YOUTUBE_COLLECTIONS.thumbnailExperiments).add({ ...data, deleted: false, ...actorFields(user) })
  return apiSuccess({ id: ref.id }, 201)
})
```

- [ ] **Step 4: Write the experiment detail route**

```ts
// app/api/v1/youtube-studio/thumbnail-experiments/[id]/route.ts
import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { apiError, apiSuccess } from '@/lib/api/response'
import { ensureOrgAccess, loadScopedRecord, stripUndefinedDeep, updateActorFields, YOUTUBE_COLLECTIONS } from '@/lib/youtube-studio/api'
import { serializeYouTubeRecord } from '@/lib/youtube-studio/sanitize'
import { aggregateVariantStats, declareWinner } from '@/lib/youtube-studio/thumbnail-experiments'
import type { YouTubeThumbnailExperiment } from '@/lib/youtube-studio/thumbnail-types'

export const dynamic = 'force-dynamic'

const STATUSES = new Set(['draft', 'running', 'paused', 'complete', 'cancelled'])

export const GET = withAuth('admin', async (_req, user, ctx) => {
  const { id } = await (ctx as { params: Promise<{ id: string }> }).params
  const record = await loadScopedRecord(YOUTUBE_COLLECTIONS.thumbnailExperiments, id)
  if (!record || record.data.deleted === true) return apiError('Experiment not found', 404)
  const exp = serializeYouTubeRecord<YouTubeThumbnailExperiment>(record.id, record.data)
  const denied = await ensureOrgAccess(user, exp.orgId)
  if (denied) return denied
  return apiSuccess({ experiment: exp, stats: aggregateVariantStats(exp), winner: declareWinner(exp) })
})

export const PUT = withAuth('admin', async (req: NextRequest, user, ctx) => {
  const { id } = await (ctx as { params: Promise<{ id: string }> }).params
  const record = await loadScopedRecord(YOUTUBE_COLLECTIONS.thumbnailExperiments, id)
  if (!record || record.data.deleted === true) return apiError('Experiment not found', 404)
  const exp = serializeYouTubeRecord<YouTubeThumbnailExperiment>(record.id, record.data)
  const denied = await ensureOrgAccess(user, exp.orgId)
  if (denied) return denied

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const patch: Record<string, unknown> = {}
  if (typeof body.status === 'string' && STATUSES.has(body.status)) patch.status = body.status

  // Apply winner: caller passes { applyWinner: true } — recompute + stamp.
  if (body.applyWinner === true) {
    const winner = declareWinner(exp)
    if (!winner) return apiError('No winner can be declared without variant data', 409)
    patch.winnerVariantId = winner.variantId
    patch.winnerConfidence = winner.confidence
    patch.winnerAppliedAt = 'TS_PLACEHOLDER'
    patch.status = 'complete'
  }

  await record.ref.set(stripUndefinedDeep({ ...patch, winnerAppliedAt: body.applyWinner === true ? undefined : patch.winnerAppliedAt, ...updateActorFields(user) }), { merge: true })
  return apiSuccess({ id })
})
```

Note: replace the `'TS_PLACEHOLDER'` line by importing `FieldValue` from `firebase-admin/firestore` and using `FieldValue.serverTimestamp()` (kept literal here only to keep the snippet import-list short — the engineer MUST import and use `FieldValue.serverTimestamp()`; the test mocks `FieldValue.serverTimestamp` to return `'TS'`).

- [ ] **Step 5: Write the per-org A/B settings route**

```ts
// app/api/v1/youtube-studio/channels/[id]/thumbnail-ab-settings/route.ts
import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { apiError, apiSuccess } from '@/lib/api/response'
import { ensureOrgAccess, loadScopedRecord, updateActorFields, YOUTUBE_COLLECTIONS } from '@/lib/youtube-studio/api'

export const dynamic = 'force-dynamic'

async function loadChannel(id: string, user: Parameters<typeof updateActorFields>[0]) {
  const record = await loadScopedRecord(YOUTUBE_COLLECTIONS.channels, id)
  if (!record || record.data.deleted === true) return { error: apiError('Channel not found', 404) as Response }
  const orgId = typeof record.data.orgId === 'string' ? record.data.orgId : ''
  const denied = await ensureOrgAccess(user, orgId)
  if (denied) return { error: denied }
  return { record }
}

export const GET = withAuth('admin', async (_req, user, ctx) => {
  const { id } = await (ctx as { params: Promise<{ id: string }> }).params
  const loaded = await loadChannel(id, user)
  if ('error' in loaded) return loaded.error
  const enabled = loaded.record.data.thumbnailAbRotationEnabled
  return apiSuccess({ thumbnailAbRotationEnabled: enabled === false ? false : true })
})

export const PUT = withAuth('admin', async (req: NextRequest, user, ctx) => {
  const { id } = await (ctx as { params: Promise<{ id: string }> }).params
  const loaded = await loadChannel(id, user)
  if ('error' in loaded) return loaded.error
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  if (typeof body.thumbnailAbRotationEnabled !== 'boolean') return apiError('thumbnailAbRotationEnabled boolean is required', 400)
  await loaded.record.ref.set({ thumbnailAbRotationEnabled: body.thumbnailAbRotationEnabled, ...updateActorFields(user) }, { merge: true })
  return apiSuccess({ thumbnailAbRotationEnabled: body.thumbnailAbRotationEnabled })
})
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx jest __tests__/api/youtube-thumbnail-experiments.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add app/api/v1/youtube-studio/thumbnail-experiments app/api/v1/youtube-studio/channels/[id]/thumbnail-ab-settings __tests__/api/youtube-thumbnail-experiments.test.ts
git commit -m "feat(yt): thumbnail experiment routes + per-org A/B toggle"
```

---

## Task 14: Rotation cron — apply next thumbnail via `thumbnails.set`, pull CTR, log quota

**Files:**
- Create: `lib/youtube-studio/thumbnail-rotation.ts` (I/O orchestration: resolve provider token, call `thumbnails.set`, read CTR, write period + quota)
- Create: `app/api/cron/youtube-thumbnail-rotation/route.ts`
- Test: `__tests__/lib/youtube-studio-thumbnail-rotation.test.ts`

`thumbnails.set` is not on the `YouTubeProvider` class yet. Add a `setThumbnail(videoId, pngUrl)` method to `lib/social/providers/youtube.ts` that POSTs to `https://www.googleapis.com/upload/youtube/v3/thumbnails/set?videoId=...` with the account's `accessToken`. The rotation lib resolves the account via `resolveProvider` (same as publish-executor), applies the due variant, records 50 quota units via `recordQuotaUsage`, then closes the *previous* period by pulling its CTR from the Analytics API (`fetchYouTubeAnalyticsApiSnapshot` returns `metrics.impressionsCtr` + `impressions`).

- [ ] **Step 1: Add `setThumbnail` to the provider (with a focused test)**

Write `__tests__/lib/social/youtube-set-thumbnail.test.ts`:

```ts
import { YouTubeProvider } from '@/lib/social/providers/youtube'

describe('YouTubeProvider.setThumbnail', () => {
  const realFetch = global.fetch
  afterEach(() => { global.fetch = realFetch; jest.restoreAllMocks() })

  it('uploads the thumbnail bytes for a video and returns ok', async () => {
    global.fetch = jest.fn()
      .mockResolvedValueOnce({ ok: true, arrayBuffer: async () => new Uint8Array([137, 80, 78, 71]).buffer }) // fetch png
      .mockResolvedValueOnce({ ok: true, json: async () => ({ items: [{ default: { url: 'https://i/t.jpg' } }] }) }) // set
      as unknown as typeof fetch
    const provider = new YouTubeProvider({ accessToken: 'tok' })
    const res = await provider.setThumbnail('vid123', 'https://cdn/thumb.png')
    expect(res.ok).toBe(true)
  })

  it('throws on quota error (403)', async () => {
    global.fetch = jest.fn()
      .mockResolvedValueOnce({ ok: true, arrayBuffer: async () => new Uint8Array([1]).buffer })
      .mockResolvedValueOnce({ ok: false, status: 403, text: async () => 'quotaExceeded' })
      as unknown as typeof fetch
    const provider = new YouTubeProvider({ accessToken: 'tok' })
    await expect(provider.setThumbnail('vid123', 'https://cdn/thumb.png')).rejects.toThrow(/403|quota/i)
  })
})
```

Run: `npx jest __tests__/lib/social/youtube-set-thumbnail.test.ts` — expect FAIL (no `setThumbnail`). Then add the method to `YouTubeProvider`:

```ts
  /** Set the custom thumbnail for a video (thumbnails.set — 50 quota units). */
  async setThumbnail(videoId: string, thumbnailUrl: string): Promise<{ ok: true; url?: string }> {
    const imgRes = await fetch(thumbnailUrl)
    if (!imgRes.ok) throw new Error(`Could not fetch thumbnail image (${imgRes.status})`)
    const bytes = Buffer.from(await imgRes.arrayBuffer())
    const res = await fetch(
      `https://www.googleapis.com/upload/youtube/v3/thumbnails/set?videoId=${encodeURIComponent(videoId)}&uploadType=media`,
      { method: 'POST', headers: { Authorization: `Bearer ${this.credentials.accessToken}`, 'Content-Type': 'image/png' }, body: bytes },
    )
    if (!res.ok) {
      const detail = await res.text().catch(() => '')
      throw new Error(`thumbnails.set failed (${res.status}) ${detail.slice(0, 200)}`.trim())
    }
    const data = (await res.json().catch(() => ({}))) as { items?: Array<{ default?: { url?: string } }> }
    return { ok: true, url: data.items?.[0]?.default?.url }
  }
```

Run again — expect PASS.

- [ ] **Step 2: Write the failing rotation-lib test**

```ts
// __tests__/lib/youtube-studio-thumbnail-rotation.test.ts
import { buildRotationPeriodClose, buildRotationApply } from '@/lib/youtube-studio/thumbnail-rotation'

describe('buildRotationPeriodClose', () => {
  it('closes the current period with the pulled CTR + impressions', () => {
    const patch = buildRotationPeriodClose(
      { variantId: 'a', startedAt: '2026-07-01T00:00:00Z' },
      { impressionsCtr: 5, impressions: 1000 },
      '2026-07-02T00:00:00Z',
    )
    expect(patch.variantId).toBe('a')
    expect(patch.endedAt).toBe('2026-07-02T00:00:00Z')
    expect(patch.impressions).toBe(1000)
    expect(patch.ctr).toBeCloseTo(0.05, 5) // percent → fraction
    expect(patch.views).toBe(50)
  })
})

describe('buildRotationApply', () => {
  it('opens a new period for the applied variant and stamps quota units', () => {
    const patch = buildRotationApply('b', '2026-07-02T00:00:00Z')
    expect(patch.variantId).toBe('b')
    expect(patch.startedAt).toBe('2026-07-02T00:00:00Z')
    expect(patch.quotaUnits).toBe(50)
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx jest __tests__/lib/youtube-studio-thumbnail-rotation.test.ts`
Expected: FAIL — cannot find module.

- [ ] **Step 4: Write the rotation lib pure helpers + drain**

```ts
// lib/youtube-studio/thumbnail-rotation.ts
import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import { resolveProvider } from '@/lib/social/account-resolver'
import { fetchYouTubeAnalyticsApiSnapshot } from '@/lib/youtube-studio/analytics-ingestion'
import { serializeYouTubeRecord } from '@/lib/youtube-studio/sanitize'
import { YOUTUBE_COLLECTIONS } from '@/lib/youtube-studio/api'
import { recordQuotaUsage, THUMBNAILS_SET_QUOTA_UNITS, canSpendQuota } from '@/lib/youtube-studio/quota-ledger'
import { isRotationDue, nextRotationVariantId } from '@/lib/youtube-studio/thumbnail-experiments'
import type { YouTubeThumbnailExperiment, ThumbnailExperimentPeriod } from '@/lib/youtube-studio/thumbnail-types'

/** Close a period with CTR pulled from Analytics. `impressionsCtr` is a percent (0-100). */
export function buildRotationPeriodClose(
  open: Pick<ThumbnailExperimentPeriod, 'variantId' | 'startedAt' | 'quotaUnits'>,
  metrics: { impressionsCtr?: number; impressions?: number },
  endedAt: string,
): ThumbnailExperimentPeriod {
  const impressions = metrics.impressions ?? 0
  const ctr = (metrics.impressionsCtr ?? 0) / 100
  return {
    variantId: open.variantId,
    startedAt: open.startedAt,
    endedAt,
    impressions,
    ctr,
    views: Math.round(ctr * impressions),
    quotaUnits: open.quotaUnits,
  }
}

export function buildRotationApply(variantId: string, startedAt: string): ThumbnailExperimentPeriod {
  return { variantId, startedAt, quotaUnits: THUMBNAILS_SET_QUOTA_UNITS }
}

export interface RotationDrainResult { due: number; rotated: number; skipped: number; errors: number }

/**
 * Drain all running rotation experiments: for each due one, apply the next
 * variant's thumbnail (thumbnails.set), close the prior period with a CTR pull,
 * and log 50 quota units. Guarded by the per-org daily quota ledger.
 */
export async function drainThumbnailRotations(nowMs: number = Date.now()): Promise<RotationDrainResult> {
  const result: RotationDrainResult = { due: 0, rotated: 0, skipped: 0, errors: 0 }
  const snap = await adminDb.collection(YOUTUBE_COLLECTIONS.thumbnailExperiments)
    .where('status', '==', 'running').where('mode', '==', 'rotation').get()

  for (const doc of snap.docs) {
    if (doc.data()?.deleted === true) continue
    const exp = serializeYouTubeRecord<YouTubeThumbnailExperiment>(doc.id, doc.data())
    const lastMs = toMillis(exp.lastRotatedAt)
    if (!isRotationDue(exp, lastMs, nowMs)) continue
    result.due++

    if (!exp.youtubeVideoId) { result.skipped++; continue }
    if (!(await canSpendQuota(exp.orgId, THUMBNAILS_SET_QUOTA_UNITS))) { result.skipped++; continue }

    const nextId = nextRotationVariantId(exp)
    const variant = exp.variants.find((v) => v.id === nextId)
    if (!variant) { result.skipped++; continue }

    try {
      const assetRec = await adminDb.collection(YOUTUBE_COLLECTIONS.sourceAssets).doc(variant.thumbnailAssetId).get()
      const thumbUrl = (assetRec.data()?.sourceUrl ?? assetRec.data()?.storage?.storagePath) as string | undefined
      if (!thumbUrl) { result.skipped++; continue }

      const { provider } = await resolveProvider(
        { orgId: exp.orgId, platform: 'youtube' } as unknown as Record<string, unknown>, exp.orgId, 'youtube',
      )
      await (provider as unknown as { setThumbnail: (v: string, u: string) => Promise<unknown> })
        .setThumbnail(exp.youtubeVideoId, thumbUrl)

      await recordQuotaUsage(exp.orgId, THUMBNAILS_SET_QUOTA_UNITS, { operation: 'thumbnails.set', channelWorkspaceId: exp.channelWorkspaceId, experimentId: exp.id })

      // Close the previously-open period with a CTR pull, then open the new one.
      const nowIso = new Date(nowMs).toISOString()
      const periods = [...exp.periods]
      const openIdx = periods.findIndex((p) => !p.endedAt)
      if (openIdx >= 0) {
        const metrics = await pullVariantCtr(exp, periods[openIdx].startedAt, nowIso).catch(() => ({}))
        periods[openIdx] = buildRotationPeriodClose(periods[openIdx], metrics, nowIso)
      }
      periods.push(buildRotationApply(variant.id, nowIso))

      await doc.ref.set({ periods, currentVariantId: variant.id, lastRotatedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() }, { merge: true })
      result.rotated++
    } catch {
      result.errors++
    }
  }
  return result
}

async function pullVariantCtr(exp: YouTubeThumbnailExperiment, startIso: string, endIso: string): Promise<{ impressionsCtr?: number; impressions?: number }> {
  const snapshot = await fetchYouTubeAnalyticsApiSnapshot({
    orgId: exp.orgId,
    channelWorkspaceId: exp.channelWorkspaceId,
    youtubeVideoId: exp.youtubeVideoId,
    periodStart: startIso.slice(0, 10),
    periodEnd: endIso.slice(0, 10),
  } as unknown as Parameters<typeof fetchYouTubeAnalyticsApiSnapshot>[0])
  const metrics = (snapshot as { metrics?: { impressionsCtr?: number; impressions?: number } }).metrics ?? {}
  return { impressionsCtr: metrics.impressionsCtr, impressions: metrics.impressions }
}

function toMillis(value: unknown): number | null {
  if (!value) return null
  if (typeof value === 'object' && value !== null && 'toMillis' in value) {
    try { return (value as { toMillis: () => number }).toMillis() } catch { return null }
  }
  const t = Date.parse(String(value))
  return Number.isNaN(t) ? null : t
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx jest __tests__/lib/youtube-studio-thumbnail-rotation.test.ts`
Expected: PASS.

- [ ] **Step 6: Write the cron route (mirror the existing publish cron)**

First inspect the existing cron auth guard: `cat app/api/cron/youtube-studio-publish/route.ts | head -30`. Reuse the same secret check (`CRON_SECRET` header/`Authorization`). Then:

```ts
// app/api/cron/youtube-thumbnail-rotation/route.ts
import { NextRequest } from 'next/server'
import { apiError, apiSuccess } from '@/lib/api/response'
import { drainThumbnailRotations } from '@/lib/youtube-studio/thumbnail-rotation'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization') ?? ''
  const secret = process.env.CRON_SECRET
  if (secret && auth !== `Bearer ${secret}`) return apiError('Unauthorized', 401)
  const result = await drainThumbnailRotations()
  return apiSuccess(result)
}
```

(Match the exact secret-check style found in the existing publish cron — if it uses `x-vercel-cron` or a query token, copy that instead.)

- [ ] **Step 7: Add the cron schedule to `vercel.json`**

Inspect `vercel.json` crons and add an entry (e.g. every 6 hours):

```json
{ "path": "/api/cron/youtube-thumbnail-rotation", "schedule": "0 */6 * * *" }
```

- [ ] **Step 8: Run the full new suite + commit**

Run: `npx jest __tests__/lib/social/youtube-set-thumbnail.test.ts __tests__/lib/youtube-studio-thumbnail-rotation.test.ts`
Expected: PASS.

```bash
git add lib/social/providers/youtube.ts lib/youtube-studio/thumbnail-rotation.ts app/api/cron/youtube-thumbnail-rotation vercel.json __tests__/lib/social/youtube-set-thumbnail.test.ts __tests__/lib/youtube-studio-thumbnail-rotation.test.ts
git commit -m "feat(yt): thumbnail rotation cron (thumbnails.set + CTR pull + quota log)"
```

---

## Task 15: Test-kit export bundle + SOP card

**Files:**
- Create: `lib/youtube-studio/test-kit.ts`
- Create: `app/api/v1/youtube-studio/thumbnail-experiments/[id]/test-kit/route.ts`
- Test: `__tests__/lib/youtube-studio-test-kit.test.ts`

For the native Test & Compare workflow (no API): build a copy-paste bundle of up to 3 thumbnails + titles plus an SOP card explaining how to set the test up in YouTube Studio.

- [ ] **Step 1: Write the failing test**

```ts
// __tests__/lib/youtube-studio-test-kit.test.ts
import { buildTestKit, TEST_KIT_SOP } from '@/lib/youtube-studio/test-kit'
import type { YouTubeThumbnailExperiment } from '@/lib/youtube-studio/thumbnail-types'

const exp: YouTubeThumbnailExperiment = {
  orgId: 'o', channelWorkspaceId: 'c', videoProjectId: 'v', youtubeVideoId: 'yt',
  mode: 'export_kit', status: 'draft',
  variants: [
    { id: 'a', thumbnailAssetId: 'as-a', label: 'A', titleText: 'How I doubled it' },
    { id: 'b', thumbnailAssetId: 'as-b', label: 'B', titleText: 'The 1 change that worked' },
    { id: 'c', thumbnailAssetId: 'as-c', label: 'C' },
    { id: 'd', thumbnailAssetId: 'as-d', label: 'D' },
  ],
  periods: [], deleted: false,
}

const assetUrls = { 'as-a': 'https://cdn/a.png', 'as-b': 'https://cdn/b.png', 'as-c': 'https://cdn/c.png' }

describe('buildTestKit', () => {
  it('caps at 3 variants and resolves asset urls + titles', () => {
    const kit = buildTestKit(exp, assetUrls)
    expect(kit.items).toHaveLength(3)
    expect(kit.items[0]).toEqual({ label: 'A', title: 'How I doubled it', thumbnailUrl: 'https://cdn/a.png' })
    expect(kit.items[2].title).toBe('') // C had no title
    expect(kit.sop).toBe(TEST_KIT_SOP)
    expect(kit.copyText).toContain('How I doubled it')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/lib/youtube-studio-test-kit.test.ts`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Write the test-kit lib**

```ts
// lib/youtube-studio/test-kit.ts
import type { YouTubeThumbnailExperiment } from './thumbnail-types'

export const TEST_KIT_SOP = [
  'YouTube "Test & Compare" setup (native, no API):',
  '1. Open YouTube Studio → Content → the target video → Details.',
  '2. Under Thumbnail, click "Test & compare".',
  '3. Upload thumbnails A, B, C from this kit (max 3).',
  '4. Choose the metric (default: watch-time share of views).',
  '5. Start the test and let YouTube run it (usually up to 2 weeks).',
  '6. When YouTube declares a winner, keep it — then log the winning pattern back in Thumbnail Studio.',
].join('\n')

export interface TestKitItem { label: string; title: string; thumbnailUrl: string }
export interface TestKit { items: TestKitItem[]; sop: string; copyText: string }

export function buildTestKit(exp: YouTubeThumbnailExperiment, assetUrls: Record<string, string>): TestKit {
  const items: TestKitItem[] = exp.variants
    .slice(0, 3)
    .map((v) => ({ label: v.label, title: v.titleText ?? '', thumbnailUrl: assetUrls[v.thumbnailAssetId] ?? '' }))
  const copyText = items
    .map((it) => `${it.label}: ${it.title}\n${it.thumbnailUrl}`)
    .join('\n\n')
  return { items, sop: TEST_KIT_SOP, copyText }
}
```

- [ ] **Step 4: Write the route**

```ts
// app/api/v1/youtube-studio/thumbnail-experiments/[id]/test-kit/route.ts
import { NextRequest } from 'next/server'
import { adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { apiError, apiSuccess } from '@/lib/api/response'
import { ensureOrgAccess, loadScopedRecord, YOUTUBE_COLLECTIONS } from '@/lib/youtube-studio/api'
import { serializeYouTubeRecord } from '@/lib/youtube-studio/sanitize'
import { buildTestKit } from '@/lib/youtube-studio/test-kit'
import type { YouTubeThumbnailExperiment } from '@/lib/youtube-studio/thumbnail-types'
import type { YouTubeSourceAsset } from '@/lib/youtube-studio/types'

export const dynamic = 'force-dynamic'

export const GET = withAuth('admin', async (_req: NextRequest, user, ctx) => {
  const { id } = await (ctx as { params: Promise<{ id: string }> }).params
  const record = await loadScopedRecord(YOUTUBE_COLLECTIONS.thumbnailExperiments, id)
  if (!record || record.data.deleted === true) return apiError('Experiment not found', 404)
  const exp = serializeYouTubeRecord<YouTubeThumbnailExperiment>(record.id, record.data)
  const denied = await ensureOrgAccess(user, exp.orgId)
  if (denied) return denied

  const urls: Record<string, string> = {}
  for (const v of exp.variants.slice(0, 3)) {
    const asset = await loadScopedRecord(YOUTUBE_COLLECTIONS.sourceAssets, v.thumbnailAssetId)
    if (asset && asset.data.deleted !== true && asset.data.orgId === exp.orgId) {
      const a = serializeYouTubeRecord<YouTubeSourceAsset>(asset.id, asset.data)
      urls[v.thumbnailAssetId] = a.sourceUrl ?? a.storagePath ?? ''
    }
  }
  return apiSuccess({ testKit: buildTestKit(exp, urls) })
})
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx jest __tests__/lib/youtube-studio-test-kit.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/youtube-studio/test-kit.ts app/api/v1/youtube-studio/thumbnail-experiments/[id]/test-kit __tests__/lib/youtube-studio-test-kit.test.ts
git commit -m "feat(yt): thumbnail Test-kit export bundle + SOP card"
```

---

## Task 16: CTR pattern library

**Files:**
- Create: `lib/youtube-studio/thumbnail-ctr-patterns.ts`
- Create: `app/api/v1/youtube-studio/thumbnail-ctr-patterns/route.ts`
- Test: `__tests__/lib/youtube-studio-thumbnail-ctr-patterns.test.ts`

Aggregate per-thumbnail CTR outcomes (from completed experiments) into an org-level "what works" library keyed by heuristic pattern tags derived from the winning design's layers.

- [ ] **Step 1: Write the failing test**

```ts
// __tests__/lib/youtube-studio-thumbnail-ctr-patterns.test.ts
import { classifyDesignPatterns, mergePatternOutcome } from '@/lib/youtube-studio/thumbnail-ctr-patterns'
import type { YouTubeThumbnailDesign, YouTubeThumbnailCtrPattern } from '@/lib/youtube-studio/thumbnail-types'

const design: YouTubeThumbnailDesign = {
  orgId: 'o', channelWorkspaceId: 'c', title: 'x', status: 'exported', versionNumber: 1,
  canvas: { width: 1280, height: 720, background: '#101014' },
  layers: [
    { id: 'img', kind: 'image', src: 'x', isCutout: true, x: 0, y: 0, width: 600, height: 720, rotation: 0, opacity: 1, z: 0 },
    { id: 't', kind: 'text', text: '5 WAYS TO WIN', fontFamily: 'x', fontSize: 120, color: '#FF0000', align: 'left', weight: 900, uppercase: true, x: 0, y: 0, width: 600, height: 200, rotation: 0, opacity: 1, z: 1, stroke: { color: '#000', width: 8 } },
  ],
  deleted: false,
}

describe('classifyDesignPatterns', () => {
  it('detects subject cutout, big bold text, number-in-text and outlined text', () => {
    const keys = classifyDesignPatterns(design).sort()
    expect(keys).toContain('subject_cutout')
    expect(keys).toContain('big_bold_text')
    expect(keys).toContain('number_in_text')
    expect(keys).toContain('outlined_text')
  })
})

describe('mergePatternOutcome', () => {
  it('updates running average and best CTR', () => {
    const prev: YouTubeThumbnailCtrPattern = { orgId: 'o', patternKey: 'subject_cutout', label: 'Subject cutout', sampleCount: 1, avgCtr: 0.04, bestCtr: 0.04, deleted: false }
    const next = mergePatternOutcome(prev, 0.08)
    expect(next.sampleCount).toBe(2)
    expect(next.avgCtr).toBeCloseTo(0.06, 5)
    expect(next.bestCtr).toBe(0.08)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/lib/youtube-studio-thumbnail-ctr-patterns.test.ts`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Write the module**

```ts
// lib/youtube-studio/thumbnail-ctr-patterns.ts
import type { YouTubeThumbnailDesign, YouTubeThumbnailCtrPattern } from './thumbnail-types'

const PATTERN_LABELS: Record<string, string> = {
  subject_cutout: 'Subject cutout',
  big_bold_text: 'Big bold text',
  number_in_text: 'Number in text',
  outlined_text: 'Outlined text',
  red_accent: 'Red accent',
  high_contrast: 'High contrast background',
}

export function classifyDesignPatterns(design: YouTubeThumbnailDesign): string[] {
  const keys = new Set<string>()
  for (const l of design.layers) {
    if (l.kind === 'image' && l.isCutout) keys.add('subject_cutout')
    if (l.kind === 'text') {
      if (l.fontSize >= 90 && l.weight >= 800) keys.add('big_bold_text')
      if (/\d/.test(l.text)) keys.add('number_in_text')
      if (l.stroke && l.stroke.width > 0) keys.add('outlined_text')
      if (/^#?(ff0000|f00|e5?0?0?0?0?)/i.test(l.color.replace('#', '#'))) keys.add('red_accent')
    }
  }
  const bg = design.canvas.background.toLowerCase()
  if (bg.includes('#000') || bg.includes('#101014')) keys.add('high_contrast')
  return [...keys]
}

export function patternLabel(key: string): string {
  return PATTERN_LABELS[key] ?? key
}

export function mergePatternOutcome(prev: YouTubeThumbnailCtrPattern, ctr: number): YouTubeThumbnailCtrPattern {
  const sampleCount = prev.sampleCount + 1
  const avgCtr = (prev.avgCtr * prev.sampleCount + ctr) / sampleCount
  return { ...prev, sampleCount, avgCtr, bestCtr: Math.max(prev.bestCtr, ctr) }
}
```

- [ ] **Step 4: Write the GET route**

```ts
// app/api/v1/youtube-studio/thumbnail-ctr-patterns/route.ts
import { withAuth } from '@/lib/api/auth'
import { apiSuccess } from '@/lib/api/response'
import { ensureOrgAccess, listByOrg, YOUTUBE_COLLECTIONS } from '@/lib/youtube-studio/api'
import { serializeYouTubeRecord } from '@/lib/youtube-studio/sanitize'
import type { YouTubeThumbnailCtrPattern } from '@/lib/youtube-studio/thumbnail-types'

export const dynamic = 'force-dynamic'

export const GET = withAuth('admin', async (req, user) => {
  const url = new URL(req.url)
  const orgId = url.searchParams.get('orgId')?.trim() ?? ''
  const denied = await ensureOrgAccess(user, orgId)
  if (denied) return denied
  const docs = await listByOrg(YOUTUBE_COLLECTIONS.thumbnailCtrPatterns, orgId)
  const patterns = docs
    .map((doc) => serializeYouTubeRecord<YouTubeThumbnailCtrPattern>(doc.id, doc.data()))
    .sort((a, b) => b.avgCtr - a.avgCtr)
  return apiSuccess({ patterns })
})
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx jest __tests__/lib/youtube-studio-thumbnail-ctr-patterns.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/youtube-studio/thumbnail-ctr-patterns.ts app/api/v1/youtube-studio/thumbnail-ctr-patterns __tests__/lib/youtube-studio-thumbnail-ctr-patterns.test.ts
git commit -m "feat(yt): thumbnail CTR pattern library"
```

---
