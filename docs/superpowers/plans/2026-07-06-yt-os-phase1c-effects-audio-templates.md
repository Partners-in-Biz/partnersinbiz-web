# YT-OS Phase 1c — Effects, Audio Engineering, Templates & Stock Media Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the Video Editor a full per-clip effect stack (filters, LUTs, masks, chroma key, blend modes, stabilization), real audio engineering (mixer, auto-ducking, noise reduction, fades, beat snapping), PiP layout presets, 16:9→9:16 auto-reframe, a brand-aware template system, and stock/generated media tabs in the library.

**Architecture:** Effect schemas live in typed TS modules (`lib/video-editor/effects.ts`) and are sanitized on every project write; the ffmpeg filtergraph compiler on the VPS executor (`scripts/higgsfield-executor/lib/editor-filtergraph.mjs`) renders them server-side, while the browser preview approximates with CSS filters. Templates and LUTs are org-scoped Firestore collections (`video_editor_templates`, `video_editor_luts`) served by `withAuth` + `apiSuccess` Next 15 routes. Stock search proxies Pexels/Pixabay server-side; imports and Higgsfield generations land in the existing `uploads`/source-library so the Media panel sees them.

**Tech Stack:** Next.js 15 (App Router, `withAuth('client')`, `apiSuccess`/`apiError` envelope), Firestore Admin SDK, ffmpeg on the VPS executor (plain Node `.mjs`, no deps), Jest 30 (`npx jest <path>`), React Testing Library for components.

---

## Pre-flight

Work happens on `development` in `partnersinbiz-web`. Run the git preflight from the project CLAUDE.md first (checkpoint dirty work, `git pull --rebase origin development`). All commands below run from the repo root:
`/Users/peetstander/Cowork/Partners in Biz — Client Growth/partnersinbiz-web`

**Verification gates you will use repeatedly:**
- Unit tests: `npx jest __tests__/lib/video-editor-effects.test.ts` (etc.)
- Typecheck: `npm run typecheck` (this is the real type gate — `next build` has `ignoreBuildErrors`)
- Full build (final task only): `NODE_OPTIONS=--max-old-space-size=10240 npm run build`

**Conventions to respect (verified in code):**
- All `/api/v1/*` responses wrap as `{ success, data }` via `apiSuccess` — clients unwrap `body.data ?? body`.
- Next 15: route `params` is a Promise — `const { id } = await (context as RouteContext).params`.
- Sanitizers never write `undefined` into Firestore payloads (`compact()` pattern in `lib/video-editor/sanitize.ts`).
- Executor filtergraph golden tests run the `.mjs` module in a Node subprocess (see `__tests__/scripts/editor-filtergraph.test.ts` `runModule` helper) — reuse that helper style.
- API route tests mock `@/lib/firebase/admin`, `@/lib/api/auth`, and `firebase-admin/firestore` (see `__tests__/api/youtube-studio-videos-import.test.ts` for the exact pattern).
- **Backwards compatibility:** existing golden tests in `__tests__/scripts/editor-filtergraph.test.ts` must keep passing unmodified. New filtergraph output may only change when new fields (effects, mixer fields, fades) are present.

## File Structure (what gets created/modified)

**Created:**
- `lib/video-editor/effects.ts` — effect kind registry, param defs, sanitizer, defaults
- `lib/video-editor/preview-filters.ts` — effects → CSS `filter` string for preview
- `lib/video-editor/layout-presets.ts` — PiP / side-by-side / top-bottom transform math
- `lib/video-editor/reframe.ts` — 16:9→9:16 variant computation (center-crop + focus keyframes)
- `lib/video-editor/templates.ts` — template types, sanitizer, brand-variable resolution, fragment extract/insert
- `lib/video-editor/stock.ts` — Pexels/Pixabay result normalizers + import host allowlist
- `lib/video-editor/beats.ts` — beat-analysis manifest builder + executor dispatch
- `app/api/v1/video-editor/luts/route.ts` + `app/api/v1/video-editor/luts/[id]/route.ts`
- `app/api/v1/video-editor/templates/route.ts` + `app/api/v1/video-editor/templates/[id]/route.ts` + `app/api/v1/video-editor/templates/[id]/resolve/route.ts`
- `app/api/v1/video-editor/stock/search/route.ts` + `app/api/v1/video-editor/stock/import/route.ts`
- `app/api/v1/video-editor/media/[id]/beats/route.ts`
- `app/api/v1/video-editor/projects/[id]/reframe/route.ts`
- `components/video-editor/EffectsSection.tsx`
- `components/video-editor/AudioMixerPanel.tsx`
- `components/video-editor/TemplateBrowserPanel.tsx`
- `scripts/higgsfield-executor/lib/editor-stabilize.mjs`
- `scripts/higgsfield-executor/lib/editor-beats.mjs`
- Tests: `__tests__/lib/video-editor-effects.test.ts`, `__tests__/lib/video-editor-preview-filters.test.ts`, `__tests__/lib/video-editor-layout-presets.test.ts`, `__tests__/lib/video-editor-reframe.test.ts`, `__tests__/lib/video-editor-templates.test.ts`, `__tests__/lib/video-editor-stock.test.ts`, `__tests__/lib/video-editor-beats.test.ts`, `__tests__/scripts/editor-effects-filtergraph.test.ts`, `__tests__/scripts/editor-audio-filtergraph.test.ts`, `__tests__/scripts/editor-stabilize.test.ts`, `__tests__/scripts/editor-beats-analysis.test.ts`, `__tests__/api/video-editor-luts.test.ts`, `__tests__/api/video-editor-templates.test.ts`, `__tests__/api/video-editor-stock.test.ts`, `__tests__/api/video-editor-beats.test.ts`, `__tests__/api/video-editor-reframe.test.ts`, `__tests__/components/video-editor-effects-section.test.tsx`, `__tests__/components/video-editor-audio-mixer.test.tsx`, `__tests__/components/video-editor-template-browser.test.tsx`, `__tests__/components/video-editor-media-tabs.test.tsx`

**Modified:**
- `lib/video-editor/types.ts` — blend modes, audio roles, track mixer fields, clip fades, template/LUT/beat types
- `lib/video-editor/sanitize.ts` — sanitize new fields via `lib/video-editor/effects.ts`
- `lib/video-editor/dispatch.ts` — manifest gains `effectAssets` (LUT downloads)
- `lib/video-editor/timeline-ops.ts` — `snapToBeats`
- `lib/organizations/types.ts` — `BrandProfile.colors` (additive, optional)
- `scripts/higgsfield-executor/lib/editor-filtergraph.mjs` — effect chains, audio engineering
- `scripts/higgsfield-executor/executor.mjs` — LUT/asset downloads, stabilization pre-pass, `/video-editor/analyze-beats` endpoint
- `components/video-editor/InspectorPanel.tsx`, `MediaLibraryPanel.tsx`, `TimelinePanel.tsx`, `PreviewPlayer.tsx`, `VideoEditorShell.tsx`
- `__tests__/lib/video-editor-dispatch.test.ts`, `__tests__/lib/video-editor-sanitize.test.ts` — extended

**New env vars (Vercel + `.env.local`; document in the final task):** `PEXELS_API_KEY`, `PIXABAY_API_KEY`, optional `STOCK_IMPORT_EXTRA_HOSTS` (comma-separated).

---

### Task 1: Effect schema registry (`lib/video-editor/effects.ts`)

The single source of truth for effect kinds, their parameters, clamps, and defaults. The Inspector UI renders controls from these defs; the sanitizer clamps against them.

**Files:**
- Create: `lib/video-editor/effects.ts`
- Modify: `lib/video-editor/types.ts`
- Test: `__tests__/lib/video-editor-effects.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// __tests__/lib/video-editor-effects.test.ts
import {
  EDITOR_EFFECT_KINDS,
  EDITOR_EFFECT_DEFS,
  defaultEffectInstance,
  sanitizeEffectInstance,
} from '@/lib/video-editor/effects'

describe('editor effect registry', () => {
  it('exposes every locked effect kind with a def', () => {
    expect([...EDITOR_EFFECT_KINDS].sort()).toEqual([
      'blur', 'chroma_key', 'color_adjust', 'glow', 'grain', 'lut', 'mask',
      'noise_reduction', 'sharpen', 'stabilize', 'vignette', 'voice_isolation',
    ])
    for (const kind of EDITOR_EFFECT_KINDS) {
      expect(EDITOR_EFFECT_DEFS[kind].label).toBeTruthy()
      expect(['video', 'audio']).toContain(EDITOR_EFFECT_DEFS[kind].target)
    }
    expect(EDITOR_EFFECT_DEFS.noise_reduction.target).toBe('audio')
    expect(EDITOR_EFFECT_DEFS.voice_isolation.target).toBe('audio')
  })

  it('builds a default instance with every param at its default', () => {
    expect(defaultEffectInstance('color_adjust')).toEqual({
      kind: 'color_adjust',
      params: { brightness: 0, contrast: 1, saturation: 1, temperature: 6500, hue: 0 },
    })
    expect(defaultEffectInstance('chroma_key')).toEqual({
      kind: 'chroma_key',
      params: { color: '#00ff00', similarity: 0.25, blend: 0.1 },
    })
  })

  it('sanitizes: clamps numbers, validates colors/selects, drops unknown kinds and params', () => {
    expect(sanitizeEffectInstance({ kind: 'sparkle_magic', params: {} })).toBeNull()
    expect(sanitizeEffectInstance({ kind: 'blur', params: { sigma: 9999, junk: 'x' } }))
      .toEqual({ kind: 'blur', params: { sigma: 50 } })
    expect(sanitizeEffectInstance({ kind: 'chroma_key', params: { color: 'javascript:evil', similarity: 0.5 } }))
      .toEqual({ kind: 'chroma_key', params: { color: '#00ff00', similarity: 0.5, blend: 0.1 } })
    expect(sanitizeEffectInstance({ kind: 'mask', params: { shape: 'triangle', invert: true } }))
      .toEqual({ kind: 'mask', params: { shape: 'rectangle', x: 0.1, y: 0.1, width: 0.8, height: 0.8, feather: 40, invert: true } })
    // lut keeps only https urls
    expect(sanitizeEffectInstance({ kind: 'lut', params: { lutUrl: 'ftp://x/a.cube', intensity: 2 } }))
      .toEqual({ kind: 'lut', params: { lutUrl: '', intensity: 1 } })
    expect(sanitizeEffectInstance({ kind: 'lut', params: { lutUrl: 'https://firebasestorage.googleapis.com/x.cube', intensity: 0.5 } }))
      .toEqual({ kind: 'lut', params: { lutUrl: 'https://firebasestorage.googleapis.com/x.cube', intensity: 0.5 } })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/lib/video-editor-effects.test.ts`
Expected: FAIL — `Cannot find module '@/lib/video-editor/effects'`

- [ ] **Step 3: Add shared enums to `lib/video-editor/types.ts`**

Append after the `EDITOR_TEXT_ANIMATION_PRESETS` block (line 33):

```ts
export type EditorBlendMode = 'normal' | 'multiply' | 'screen' | 'overlay' | 'lighten' | 'darken' | 'addition' | 'difference'
export const EDITOR_BLEND_MODES: EditorBlendMode[] = ['normal', 'multiply', 'screen', 'overlay', 'lighten', 'darken', 'addition', 'difference']

export type EditorAudioRole = 'voice' | 'music' | 'sfx'
export const EDITOR_AUDIO_ROLES: EditorAudioRole[] = ['voice', 'music', 'sfx']
```

Extend `EditorClip` (after `keyframes?: EditorKeyframe[]`):

```ts
  blendMode?: EditorBlendMode
  fadeInSeconds?: number
  fadeOutSeconds?: number
```

Extend `EditorTrack` (after `locked?: boolean`):

```ts
  gainDb?: number
  pan?: number
  solo?: boolean
  audioRole?: EditorAudioRole
  duckUnderVoice?: boolean
```

- [ ] **Step 4: Write `lib/video-editor/effects.ts`**

```ts
import type { EditorEffectInstance } from './types'

export const EDITOR_EFFECT_KINDS = [
  'color_adjust', 'blur', 'sharpen', 'vignette', 'grain', 'glow',
  'lut', 'mask', 'chroma_key', 'stabilize',
  'noise_reduction', 'voice_isolation',
] as const
export type EditorEffectKind = (typeof EDITOR_EFFECT_KINDS)[number]

export type EffectParamDef =
  | { key: string; label: string; type: 'number'; min: number; max: number; step: number; default: number }
  | { key: string; label: string; type: 'color'; default: string }
  | { key: string; label: string; type: 'select'; options: string[]; default: string }
  | { key: string; label: string; type: 'boolean'; default: boolean }
  | { key: string; label: string; type: 'asset'; default: string }

export interface EditorEffectDef {
  label: string
  target: 'video' | 'audio'
  params: EffectParamDef[]
}

export const EDITOR_EFFECT_DEFS: Record<EditorEffectKind, EditorEffectDef> = {
  color_adjust: {
    label: 'Color adjust', target: 'video',
    params: [
      { key: 'brightness', label: 'Brightness', type: 'number', min: -1, max: 1, step: 0.01, default: 0 },
      { key: 'contrast', label: 'Contrast', type: 'number', min: 0, max: 3, step: 0.01, default: 1 },
      { key: 'saturation', label: 'Saturation', type: 'number', min: 0, max: 3, step: 0.01, default: 1 },
      { key: 'temperature', label: 'Temperature (K)', type: 'number', min: 2000, max: 12000, step: 50, default: 6500 },
      { key: 'hue', label: 'Hue (deg)', type: 'number', min: -180, max: 180, step: 1, default: 0 },
    ],
  },
  blur: {
    label: 'Blur', target: 'video',
    params: [{ key: 'sigma', label: 'Amount', type: 'number', min: 0, max: 50, step: 0.5, default: 5 }],
  },
  sharpen: {
    label: 'Sharpen', target: 'video',
    params: [{ key: 'amount', label: 'Amount', type: 'number', min: 0, max: 3, step: 0.05, default: 1 }],
  },
  vignette: {
    label: 'Vignette', target: 'video',
    params: [{ key: 'intensity', label: 'Intensity', type: 'number', min: 0, max: 1, step: 0.01, default: 0.4 }],
  },
  grain: {
    label: 'Film grain', target: 'video',
    params: [{ key: 'strength', label: 'Strength', type: 'number', min: 0, max: 100, step: 1, default: 12 }],
  },
  glow: {
    label: 'Glow', target: 'video',
    params: [
      { key: 'sigma', label: 'Radius', type: 'number', min: 2, max: 50, step: 0.5, default: 12 },
      { key: 'opacity', label: 'Opacity', type: 'number', min: 0, max: 1, step: 0.01, default: 0.5 },
    ],
  },
  lut: {
    label: 'LUT (.cube)', target: 'video',
    params: [
      { key: 'lutUrl', label: 'LUT file', type: 'asset', default: '' },
      { key: 'intensity', label: 'Intensity', type: 'number', min: 0, max: 1, step: 0.01, default: 1 },
    ],
  },
  mask: {
    label: 'Opacity mask', target: 'video',
    params: [
      { key: 'shape', label: 'Shape', type: 'select', options: ['rectangle', 'ellipse', 'linear'], default: 'rectangle' },
      { key: 'x', label: 'X', type: 'number', min: 0, max: 1, step: 0.01, default: 0.1 },
      { key: 'y', label: 'Y', type: 'number', min: 0, max: 1, step: 0.01, default: 0.1 },
      { key: 'width', label: 'Width', type: 'number', min: 0.01, max: 1, step: 0.01, default: 0.8 },
      { key: 'height', label: 'Height', type: 'number', min: 0.01, max: 1, step: 0.01, default: 0.8 },
      { key: 'feather', label: 'Feather (px)', type: 'number', min: 1, max: 500, step: 1, default: 40 },
      { key: 'invert', label: 'Invert', type: 'boolean', default: false },
    ],
  },
  chroma_key: {
    label: 'Chroma key', target: 'video',
    params: [
      { key: 'color', label: 'Key color', type: 'color', default: '#00ff00' },
      { key: 'similarity', label: 'Similarity', type: 'number', min: 0.01, max: 1, step: 0.01, default: 0.25 },
      { key: 'blend', label: 'Blend', type: 'number', min: 0, max: 1, step: 0.01, default: 0.1 },
    ],
  },
  stabilize: {
    label: 'Stabilize (vidstab)', target: 'video',
    params: [
      { key: 'shakiness', label: 'Shakiness', type: 'number', min: 1, max: 10, step: 1, default: 5 },
      { key: 'smoothing', label: 'Smoothing', type: 'number', min: 1, max: 100, step: 1, default: 10 },
    ],
  },
  noise_reduction: {
    label: 'Noise reduction', target: 'audio',
    params: [{ key: 'amountDb', label: 'Reduction (dB)', type: 'number', min: 0.01, max: 60, step: 0.5, default: 12 }],
  },
  voice_isolation: {
    label: 'Voice isolation', target: 'audio',
    params: [],
  },
}

const HEX_COLOR = /^#[0-9a-fA-F]{3,8}$/

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

export function defaultEffectInstance(kind: EditorEffectKind): EditorEffectInstance {
  const params: EditorEffectInstance['params'] = {}
  for (const def of EDITOR_EFFECT_DEFS[kind].params) params[def.key] = def.default
  return { kind, params }
}

/** Clamp/validate one effect against its def. Unknown kinds → null. Unknown params dropped. */
export function sanitizeEffectInstance(value: unknown): EditorEffectInstance | null {
  const source = value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
  const kind = source.kind
  if (!EDITOR_EFFECT_KINDS.includes(kind as EditorEffectKind)) return null
  const def = EDITOR_EFFECT_DEFS[kind as EditorEffectKind]
  const rawParams = source.params && typeof source.params === 'object' && !Array.isArray(source.params)
    ? (source.params as Record<string, unknown>)
    : {}
  const params: EditorEffectInstance['params'] = {}
  for (const paramDef of def.params) {
    const raw = rawParams[paramDef.key]
    if (paramDef.type === 'number') {
      params[paramDef.key] = typeof raw === 'number' && Number.isFinite(raw)
        ? clamp(raw, paramDef.min, paramDef.max)
        : paramDef.default
    } else if (paramDef.type === 'color') {
      params[paramDef.key] = typeof raw === 'string' && HEX_COLOR.test(raw.trim()) ? raw.trim().toLowerCase() : paramDef.default
    } else if (paramDef.type === 'select') {
      params[paramDef.key] = typeof raw === 'string' && paramDef.options.includes(raw) ? raw : paramDef.default
    } else if (paramDef.type === 'boolean') {
      params[paramDef.key] = typeof raw === 'boolean' ? raw : paramDef.default
    } else {
      // asset: https URLs only
      params[paramDef.key] = typeof raw === 'string' && /^https:\/\//.test(raw.trim()) ? raw.trim() : paramDef.default
    }
  }
  return { kind: kind as string, params }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx jest __tests__/lib/video-editor-effects.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 6: Commit**

```bash
git add lib/video-editor/effects.ts lib/video-editor/types.ts __tests__/lib/video-editor-effects.test.ts
git commit -m "feat(video-editor): typed effect registry with param defs, defaults, sanitizer"
```

---

### Task 2: Sanitizer integration — effects, blend mode, fades, track mixer fields

**Files:**
- Modify: `lib/video-editor/sanitize.ts`
- Test: `__tests__/lib/video-editor-sanitize.test.ts` (extend the existing file)

- [ ] **Step 1: Write the failing tests** — append a new `describe` block to `__tests__/lib/video-editor-sanitize.test.ts`:

```ts
describe('phase 1c fields', () => {
  it('sanitizes effects via the registry, keeps order, drops unknown kinds', () => {
    const timeline = sanitizeEditorTimeline({
      version: 1,
      tracks: [{
        id: 't1', kind: 'video',
        clips: [{
          id: 'c1', timelineStart: 0, duration: 4,
          media: { type: 'upload', fileId: 'f1', url: 'https://x.test/a.mp4', mediaKind: 'video' },
          effects: [
            { kind: 'blur', params: { sigma: 4 } },
            { kind: 'nonsense', params: {} },
            { kind: 'chroma_key', params: { color: '#112233' } },
          ],
          blendMode: 'screen',
          fadeInSeconds: 0.5,
          fadeOutSeconds: 99,
        }],
      }],
    })
    const clip = timeline.tracks[0].clips[0]
    expect(clip.effects?.map((e) => e.kind)).toEqual(['blur', 'chroma_key'])
    expect(clip.effects?.[0].params).toEqual({ sigma: 4 })
    expect(clip.blendMode).toBe('screen')
    expect(clip.fadeInSeconds).toBe(0.5)
    expect(clip.fadeOutSeconds).toBe(30) // clamped
  })

  it('rejects invalid blend modes and sanitizes track mixer fields', () => {
    const timeline = sanitizeEditorTimeline({
      version: 1,
      tracks: [{
        id: 't-a', kind: 'audio', gainDb: -100, pan: 7, solo: true, audioRole: 'music', duckUnderVoice: true,
        clips: [{
          id: 'c1', timelineStart: 0, duration: 4, blendMode: 'hologram',
          media: { type: 'upload', fileId: 'f1', url: 'https://x.test/a.mp3', mediaKind: 'audio' },
        }],
      }],
    })
    const track = timeline.tracks[0]
    expect(track.gainDb).toBe(-60)  // clamped to [-60, 12]
    expect(track.pan).toBe(1)       // clamped to [-1, 1]
    expect(track.solo).toBe(true)
    expect(track.audioRole).toBe('music')
    expect(track.duckUnderVoice).toBe(true)
    expect(timeline.tracks[0].clips[0].blendMode).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npx jest __tests__/lib/video-editor-sanitize.test.ts -t "phase 1c"`
Expected: FAIL — `effects` contains the `nonsense` kind, `blendMode`/mixer fields are `undefined`

- [ ] **Step 3: Implement in `lib/video-editor/sanitize.ts`**

Add imports at the top:

```ts
import { sanitizeEffectInstance } from './effects'
import { EDITOR_AUDIO_ROLES, EDITOR_BLEND_MODES } from './types'
import type { EditorAudioRole, EditorBlendMode } from './types'
```

Replace the body of `sanitizeEffects` (currently lines 147–160) with a registry-delegating version:

```ts
function sanitizeEffects(value: unknown): EditorEffectInstance[] | undefined {
  if (!Array.isArray(value)) return undefined
  const effects = value.flatMap((entry) => {
    const effect = sanitizeEffectInstance(entry)
    return effect ? [effect] : []
  })
  return effects.length ? effects : undefined
}
```

In `sanitizeClip`, inside the `compact({ ... })`, after `effects: sanitizeEffects(source.effects),` add:

```ts
    blendMode: EDITOR_BLEND_MODES.includes(source.blendMode as EditorBlendMode) && source.blendMode !== 'normal'
      ? (source.blendMode as EditorBlendMode)
      : undefined,
    fadeInSeconds: source.fadeInSeconds === undefined ? undefined : clampNumber(source.fadeInSeconds, 0, 30, 0),
    fadeOutSeconds: source.fadeOutSeconds === undefined ? undefined : clampNumber(source.fadeOutSeconds, 0, 30, 0),
```

In `sanitizeTrack`, inside the `compact({ ... })`, after `locked: ...` add:

```ts
    gainDb: source.gainDb === undefined ? undefined : clampNumber(source.gainDb, -60, 12, 0),
    pan: source.pan === undefined ? undefined : clampNumber(source.pan, -1, 1, 0),
    solo: typeof source.solo === 'boolean' ? source.solo : undefined,
    audioRole: EDITOR_AUDIO_ROLES.includes(source.audioRole as EditorAudioRole)
      ? (source.audioRole as EditorAudioRole)
      : undefined,
    duckUnderVoice: typeof source.duckUnderVoice === 'boolean' ? source.duckUnderVoice : undefined,
```

- [ ] **Step 4: Run the whole sanitize suite (regressions matter here)**

Run: `npx jest __tests__/lib/video-editor-sanitize.test.ts`
Expected: PASS — all pre-existing tests plus the two new ones

- [ ] **Step 5: Commit**

```bash
git add lib/video-editor/sanitize.ts __tests__/lib/video-editor-sanitize.test.ts
git commit -m "feat(video-editor): sanitize effect stack, blend mode, audio fades, track mixer fields"
```

---

### Task 3: Filtergraph — filter effects (color, blur, sharpen, vignette, grain, glow)

The compiler change: `buildVisualClipChain` becomes `buildVisualClipChains` (returns an array — split-based effects like glow need extra chain entries), and effect filters run **after** trim/setpts, **before** transform scale/rotate/opacity.

**Files:**
- Modify: `scripts/higgsfield-executor/lib/editor-filtergraph.mjs`
- Test: `__tests__/scripts/editor-effects-filtergraph.test.ts` (new file; reuse the `runModule` subprocess helper from `__tests__/scripts/editor-filtergraph.test.ts`)

- [ ] **Step 1: Write the failing golden tests**

```ts
// __tests__/scripts/editor-effects-filtergraph.test.ts
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'

const modulePath = join(process.cwd(), 'scripts/higgsfield-executor/lib/editor-filtergraph.mjs')

function runModule<T>(code: string): T {
  const stdout = execFileSync(process.execPath, ['--input-type=module', '-e', `
    import * as m from ${JSON.stringify(`file://${modulePath}`)};
    const result = await (async () => { ${code} })();
    process.stdout.write(JSON.stringify(result));
  `], { encoding: 'utf8' })
  return JSON.parse(stdout) as T
}

const settings = { width: 1280, height: 720, fps: 30, background: '#000000' }

function compile(clipExtras: Record<string, unknown>, compileExtras: Record<string, unknown> = {}) {
  return runModule<{ filterComplex: string }>(`return m.compileEditorFiltergraph(${JSON.stringify({
    settings,
    localMediaPaths: { c1: '/tmp/m/c1.mp4' },
    ...compileExtras,
    timeline: {
      version: 1,
      tracks: [{
        id: 't1', kind: 'video',
        clips: [{
          id: 'c1', timelineStart: 0, duration: 4,
          media: { type: 'upload', fileId: 'f1', url: 'https://x.test/a.mp4', mediaKind: 'video' },
          ...clipExtras,
        }],
      }],
    },
  })})`)
}

describe('filter effect compilation', () => {
  it('compiles color_adjust to eq + colortemperature + hue', () => {
    const { filterComplex } = compile({
      effects: [{ kind: 'color_adjust', params: { brightness: 0.1, contrast: 1.2, saturation: 0.8, temperature: 5000, hue: 15 } }],
    })
    expect(filterComplex).toContain('eq=brightness=0.1:contrast=1.2:saturation=0.8')
    expect(filterComplex).toContain('colortemperature=temperature=5000')
    expect(filterComplex).toContain('hue=h=15')
  })

  it('skips no-op color_adjust params', () => {
    const { filterComplex } = compile({
      effects: [{ kind: 'color_adjust', params: { brightness: 0, contrast: 1, saturation: 1, temperature: 6500, hue: 0 } }],
    })
    expect(filterComplex).not.toContain('eq=')
    expect(filterComplex).not.toContain('colortemperature')
    expect(filterComplex).not.toContain('hue=h=')
  })

  it('compiles blur, sharpen, vignette, grain', () => {
    const { filterComplex } = compile({
      effects: [
        { kind: 'blur', params: { sigma: 4 } },
        { kind: 'sharpen', params: { amount: 1.5 } },
        { kind: 'vignette', params: { intensity: 0.5 } },
        { kind: 'grain', params: { strength: 20 } },
      ],
    })
    expect(filterComplex).toContain('gblur=sigma=4')
    expect(filterComplex).toContain('unsharp=5:5:1.5')
    expect(filterComplex).toContain('vignette=angle=0.785')
    expect(filterComplex).toContain('noise=alls=20:allf=t+u')
  })

  it('compiles glow as split + gblur + screen blend, preserving chain continuity', () => {
    const { filterComplex } = compile({
      effects: [{ kind: 'glow', params: { sigma: 10, opacity: 0.6 } }],
    })
    expect(filterComplex).toContain('split=2[fx0a][fx0b]')
    expect(filterComplex).toContain('[fx0b]gblur=sigma=10[fx0c]')
    expect(filterComplex).toContain('[fx0a][fx0c]blend=all_mode=screen:all_opacity=0.6[fx0d]')
    // the effected stream still reaches the overlay
    expect(filterComplex).toContain('[base][vc0]overlay=')
  })

  it('keeps legacy output byte-identical when no effects are present', () => {
    const { filterComplex } = compile({})
    expect(filterComplex).toContain('[1:v]trim=start=0:duration=4,setpts=PTS-STARTPTS[vc0]')
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npx jest __tests__/scripts/editor-effects-filtergraph.test.ts`
Expected: FAIL — no `eq=`/`gblur=` in output (effects are ignored today)

- [ ] **Step 3: Implement in `editor-filtergraph.mjs`**

Add helpers above `buildVisualClipChain`:

```js
function num(value, fallback) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

/**
 * Compile one clip's video effect stack.
 * Simple filters push onto `parts` (single linear chain). Split-based effects
 * (glow, lut-with-intensity) flush `parts` into a chain and continue from a new
 * label. Returns the label the caller should continue from.
 */
function applyVideoEffects({ clip, parts, chains, inLabel, ctx }) {
  let currentIn = inLabel
  const effects = Array.isArray(clip.effects) ? clip.effects : []
  for (let index = 0; index < effects.length; index += 1) {
    const effect = effects[index]
    const p = effect?.params || {}
    if (effect.kind === 'color_adjust') {
      const brightness = num(p.brightness, 0)
      const contrast = num(p.contrast, 1)
      const saturation = num(p.saturation, 1)
      if (brightness !== 0 || contrast !== 1 || saturation !== 1) {
        parts.push(`eq=brightness=${fmt(brightness)}:contrast=${fmt(contrast)}:saturation=${fmt(saturation)}`)
      }
      const temperature = num(p.temperature, 6500)
      if (temperature !== 6500) parts.push(`colortemperature=temperature=${Math.round(temperature)}`)
      const hue = num(p.hue, 0)
      if (hue !== 0) parts.push(`hue=h=${fmt(hue)}`)
    } else if (effect.kind === 'blur') {
      const sigma = num(p.sigma, 5)
      if (sigma > 0) parts.push(`gblur=sigma=${fmt(sigma)}`)
    } else if (effect.kind === 'sharpen') {
      const amount = num(p.amount, 1)
      if (amount > 0) parts.push(`unsharp=5:5:${fmt(amount)}`)
    } else if (effect.kind === 'vignette') {
      const intensity = num(p.intensity, 0.4)
      if (intensity > 0) parts.push(`vignette=angle=${fmt((intensity * Math.PI) / 2)}`)
    } else if (effect.kind === 'grain') {
      const strength = Math.round(num(p.strength, 12))
      if (strength > 0) parts.push(`noise=alls=${strength}:allf=t+u`)
    } else if (effect.kind === 'glow') {
      const label = `fx${ctx.fxCounter}`
      ctx.fxCounter += 1
      chains.push(`[${currentIn}]${[...parts, `split=2[${label}a][${label}b]`].join(',')}`)
      chains.push(`[${label}b]gblur=sigma=${fmt(num(p.sigma, 12))}[${label}c]`)
      chains.push(`[${label}a][${label}c]blend=all_mode=screen:all_opacity=${fmt(num(p.opacity, 0.5))}[${label}d]`)
      parts.length = 0
      currentIn = `${label}d`
    }
    // lut / mask / chroma_key handled in Task 4; stabilize is an executor pre-pass (Task 6)
  }
  return currentIn
}
```

Rewrite `buildVisualClipChain` as `buildVisualClipChains` (returns nothing; pushes onto `chains`; the final label is still `label`):

```js
function buildVisualClipChains(clip, inputIndex, label, chains, ctx) {
  const speed = clipSpeed(clip)
  const transform = clip.transform ?? {}
  const parts = []
  if (clip.media.mediaKind === 'image') {
    parts.push('setpts=PTS-STARTPTS')
  } else {
    const trimStart = clip.trimStart ?? 0
    parts.push(`trim=start=${fmt(trimStart)}:duration=${fmt(clip.duration * speed)}`)
    parts.push(speed === 1 ? 'setpts=PTS-STARTPTS' : `setpts=(PTS-STARTPTS)/${fmt(speed)}`)
  }
  let currentIn = `${inputIndex}:v`
  currentIn = applyVideoEffects({ clip, parts, chains, inLabel: currentIn, ctx })
  const scale = typeof transform.scale === 'number' ? transform.scale : 1
  if (scale !== 1) parts.push(`scale=w=iw*${fmt(scale)}:h=ih*${fmt(scale)}`)
  const rotation = typeof transform.rotation === 'number' ? transform.rotation : 0
  if (rotation !== 0) parts.push(`rotate=${fmt((rotation * Math.PI) / 180)}:c=black@0`)
  const opacity = typeof transform.opacity === 'number' ? transform.opacity : 1
  if (opacity < 1) parts.push('format=yuva420p', `colorchannelmixer=aa=${fmt(opacity)}`)
  chains.push(`[${currentIn}]${parts.length ? parts.join(',') : 'null'}[${label}]`)
}
```

In `compileEditorFiltergraph`: create `const ctx = { fxCounter: 0 }` next to the other counters, and replace the call site
`chains.push(buildVisualClipChain(clip, clipInputIndex.get(clip.id), label))` with
`buildVisualClipChains(clip, clipInputIndex.get(clip.id), label, chains, ctx)`.

Note the `'null'` fallback: an image clip whose only part was consumed by a split-effect flush still needs a filter between labels — `null` is ffmpeg's pass-through video filter.

- [ ] **Step 4: Run new AND legacy golden tests**

Run: `npx jest __tests__/scripts/editor-effects-filtergraph.test.ts __tests__/scripts/editor-filtergraph.test.ts`
Expected: PASS — both suites (legacy output unchanged when `effects` absent)

- [ ] **Step 5: Commit**

```bash
git add scripts/higgsfield-executor/lib/editor-filtergraph.mjs __tests__/scripts/editor-effects-filtergraph.test.ts
git commit -m "feat(executor): compile color/blur/sharpen/vignette/grain/glow effect stack"
```

---

### Task 4: Filtergraph — LUT, chroma key, opacity masks

**Files:**
- Modify: `scripts/higgsfield-executor/lib/editor-filtergraph.mjs`
- Test: `__tests__/scripts/editor-effects-filtergraph.test.ts` (extend)

- [ ] **Step 1: Add failing golden tests** (same file, new `describe`):

```ts
describe('lut, chroma key, masks', () => {
  it('compiles lut3d from a downloaded local path, with intensity blend', () => {
    const { filterComplex } = compile(
      { effects: [{ kind: 'lut', params: { lutUrl: 'https://firebasestorage.googleapis.com/x.cube', intensity: 0.7 } }] },
      { localEffectAssetPaths: { 'c1:0': '/tmp/m/lut0.cube' } },
    )
    expect(filterComplex).toContain('split=2[fx0a][fx0b]')
    expect(filterComplex).toContain("[fx0b]lut3d=file='/tmp/m/lut0.cube'[fx0c]")
    expect(filterComplex).toContain('[fx0a][fx0c]blend=all_mode=normal:all_opacity=0.7[fx0d]')
  })

  it('applies lut3d inline when intensity is 1', () => {
    const { filterComplex } = compile(
      { effects: [{ kind: 'lut', params: { lutUrl: 'https://firebasestorage.googleapis.com/x.cube', intensity: 1 } }] },
      { localEffectAssetPaths: { 'c1:0': '/tmp/m/lut0.cube' } },
    )
    expect(filterComplex).toContain("lut3d=file='/tmp/m/lut0.cube'")
    expect(filterComplex).not.toContain('all_opacity')
  })

  it('throws when a lut effect has no downloaded asset', () => {
    expect(() => compile({ effects: [{ kind: 'lut', params: { lutUrl: 'https://x.test/a.cube', intensity: 1 } }] }))
      .toThrow(/no local effect asset for clip c1/)
  })

  it('compiles chroma key', () => {
    const { filterComplex } = compile({
      effects: [{ kind: 'chroma_key', params: { color: '#00ff00', similarity: 0.3, blend: 0.15 } }],
    })
    expect(filterComplex).toContain('chromakey=color=0x00ff00:similarity=0.3:blend=0.15')
  })

  it('compiles a feathered rectangle mask as a geq alpha ramp', () => {
    const { filterComplex } = compile({
      effects: [{ kind: 'mask', params: { shape: 'rectangle', x: 0.1, y: 0.1, width: 0.8, height: 0.8, feather: 40, invert: false } }],
    })
    expect(filterComplex).toContain('format=yuva444p')
    expect(filterComplex).toContain("geq=lum='lum(X,Y)':cb='cb(X,Y)':cr='cr(X,Y)':a=")
    expect(filterComplex).toContain('min(min(X-(W*0.1)')
  })

  it('compiles ellipse and inverted linear masks', () => {
    const ellipse = compile({ effects: [{ kind: 'mask', params: { shape: 'ellipse', x: 0.1, y: 0.1, width: 0.8, height: 0.8, feather: 40, invert: false } }] })
    expect(ellipse.filterComplex).toContain('hypot(')
    const linear = compile({ effects: [{ kind: 'mask', params: { shape: 'linear', x: 0.2, y: 0, width: 1, height: 1, feather: 120, invert: true } }] })
    expect(linear.filterComplex).toContain('(1-clip((X-(W*0.2))/120')
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npx jest __tests__/scripts/editor-effects-filtergraph.test.ts -t "lut, chroma key"`
Expected: FAIL

- [ ] **Step 3: Implement**

`compileEditorFiltergraph` signature gains `localEffectAssetPaths = {}` (destructure alongside `localMediaPaths`), stored on `ctx`:
`const ctx = { fxCounter: 0, localEffectAssetPaths, clipId: null }` — set `ctx.clipId = clip.id` inside the clip loop before calling `buildVisualClipChains` (or pass `clip` through; the effect index key is `${clip.id}:${index}`).

Extend `applyVideoEffects` with three new branches (before the closing comment):

```js
    } else if (effect.kind === 'lut') {
      const assetPath = ctx.localEffectAssetPaths[`${clip.id}:${index}`]
      if (!assetPath) throw new Error(`no local effect asset for clip ${clip.id} effect ${index} (lut)`)
      const escaped = String(assetPath).replace(/'/g, "\\'")
      const intensity = num(p.intensity, 1)
      if (intensity >= 1) {
        parts.push(`lut3d=file='${escaped}'`)
      } else {
        const label = `fx${ctx.fxCounter}`
        ctx.fxCounter += 1
        chains.push(`[${currentIn}]${[...parts, `split=2[${label}a][${label}b]`].join(',')}`)
        chains.push(`[${label}b]lut3d=file='${escaped}'[${label}c]`)
        chains.push(`[${label}a][${label}c]blend=all_mode=normal:all_opacity=${fmt(intensity)}[${label}d]`)
        parts.length = 0
        currentIn = `${label}d`
      }
    } else if (effect.kind === 'chroma_key') {
      const color = typeof p.color === 'string' ? p.color.replace('#', '0x') : '0x00ff00'
      parts.push(`chromakey=color=${color}:similarity=${fmt(num(p.similarity, 0.25))}:blend=${fmt(num(p.blend, 0.1))}`)
    } else if (effect.kind === 'mask') {
      const x = fmt(num(p.x, 0.1)); const y = fmt(num(p.y, 0.1))
      const w = fmt(num(p.width, 0.8)); const h = fmt(num(p.height, 0.8))
      const feather = fmt(Math.max(1, num(p.feather, 40)))
      let expr
      if (p.shape === 'ellipse') {
        expr = `clip((1-hypot((X-(W*${x})-(W*${w})/2)/((W*${w})/2),(Y-(H*${y})-(H*${h})/2)/((H*${h})/2)))*((W*${w})/2)/${feather},0,1)`
      } else if (p.shape === 'linear') {
        expr = `clip((X-(W*${x}))/${feather},0,1)`
      } else {
        expr = `clip(min(min(X-(W*${x}),(W*${x})+(W*${w})-X),min(Y-(H*${y}),(H*${y})+(H*${h})-Y))/${feather},0,1)`
      }
      if (p.invert === true) expr = `(1-${expr})`
      parts.push('format=yuva444p', `geq=lum='lum(X,Y)':cb='cb(X,Y)':cr='cr(X,Y)':a='alpha(X,Y)*${expr}'`)
    }
```

(`clip` must be in scope of `applyVideoEffects` — it already is via the destructured argument.)

- [ ] **Step 4: Run all filtergraph suites**

Run: `npx jest __tests__/scripts/editor-effects-filtergraph.test.ts __tests__/scripts/editor-filtergraph.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add scripts/higgsfield-executor/lib/editor-filtergraph.mjs __tests__/scripts/editor-effects-filtergraph.test.ts
git commit -m "feat(executor): LUT, chroma key, and feathered opacity masks in the filtergraph"
```

---

### Task 5: Filtergraph — blend modes on overlay clips

When a clip has `blendMode` (screen/multiply/…), the compositor pads the clip to canvas size, time-aligns it, and uses ffmpeg `blend` (which supports `enable`) instead of `overlay`. Groups with xfade transitions keep using `overlay` (blend + xfade groups is out of scope — the sanitizer permits both, the compiler prefers the transition).

**Files:**
- Modify: `scripts/higgsfield-executor/lib/editor-filtergraph.mjs`
- Test: `__tests__/scripts/editor-effects-filtergraph.test.ts` (extend)

- [ ] **Step 1: Add failing golden test**

```ts
describe('blend modes', () => {
  it('composites a blendMode clip with pad + tpad + blend instead of overlay', () => {
    const { filterComplex } = runModule<{ filterComplex: string }>(`return m.compileEditorFiltergraph(${JSON.stringify({
      settings,
      localMediaPaths: { c1: '/tmp/m/c1.mp4' },
      timeline: {
        version: 1,
        tracks: [{
          id: 't1', kind: 'overlay',
          clips: [{
            id: 'c1', timelineStart: 2, duration: 4, blendMode: 'screen',
            transform: { x: 40, y: -20, scale: 1, rotation: 0, opacity: 1 },
            media: { type: 'upload', fileId: 'f1', url: 'https://x.test/a.mp4', mediaKind: 'video' },
          }],
        }],
      },
    })})`)
    expect(filterComplex).toContain('pad=w=1280:h=720:x=(ow-iw)/2+40:y=(oh-ih)/2+-20:color=black@0')
    expect(filterComplex).toContain('tpad=start_duration=2:color=black@0')
    expect(filterComplex).toContain("blend=all_mode=screen:enable='between(t,2,6)'")
    expect(filterComplex).not.toContain('overlay=')
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npx jest __tests__/scripts/editor-effects-filtergraph.test.ts -t "blend modes"`
Expected: FAIL — output still uses `overlay=`

- [ ] **Step 3: Implement**

Add a mode map near `XFADE_TRANSITIONS`:

```js
const BLEND_MODES = {
  multiply: 'multiply', screen: 'screen', overlay: 'overlay',
  lighten: 'lighten', darken: 'darken', addition: 'addition', difference: 'difference',
}
```

In `compileEditorFiltergraph`, inside the per-group compositor loop, replace the unconditional overlay block (the `const { x, y } = overlayPosition(...)` … `chains.push(...overlay...)` lines) with:

```js
      const blendMode = group.length === 1 ? BLEND_MODES[group[0].blendMode] : undefined
      const next = `ov${ovCounter}`
      ovCounter += 1
      if (blendMode) {
        const tx = typeof group[0].transform?.x === 'number' ? group[0].transform.x : 0
        const ty = typeof group[0].transform?.y === 'number' ? group[0].transform.y : 0
        const padded = `bl${ovCounter}`
        chains.push(`[${segmentLabel}]pad=w=${settings.width}:h=${settings.height}:x=(ow-iw)/2+${fmt(tx)}:y=(oh-ih)/2+${fmt(ty)}:color=black@0,format=yuv420p${start > 0 ? `,tpad=start_duration=${fmt(start)}:color=black@0` : ''},tpad=stop=-1[${padded}]`)
        chains.push(`[${current}][${padded}]blend=all_mode=${blendMode}:enable='between(t,${fmt(start)},${fmt(end)})'[${next}]`)
      } else {
        const { x, y } = overlayPosition(group[0].transform)
        chains.push(`[${current}][${segmentLabel}]overlay=x=${x}:y=${y}:enable='between(t,${fmt(start)},${fmt(end)})':eof_action=pass[${next}]`)
      }
      current = next
```

Important detail: the blend path must NOT also apply the `setpts=PTS+start/TB` shift (that is only for `overlay`). Restructure so the `if (start > 0) { …setpts shift… }` block runs **only** in the overlay branch — move it inside the `else`, using `segmentLabel`/`vsCounter` exactly as today. `tpad=stop=-1` clones the last frame so `blend` never starves after the clip ends (the window is disabled there anyway).

- [ ] **Step 4: Run all filtergraph suites**

Run: `npx jest __tests__/scripts/editor-effects-filtergraph.test.ts __tests__/scripts/editor-filtergraph.test.ts`
Expected: PASS (legacy overlay behavior untouched when `blendMode` absent)

- [ ] **Step 5: Commit**

```bash
git add scripts/higgsfield-executor/lib/editor-filtergraph.mjs __tests__/scripts/editor-effects-filtergraph.test.ts
git commit -m "feat(executor): blend-mode compositing for overlay clips via pad+tpad+blend"
```

---

### Task 6: Manifest effect assets + executor LUT download + stabilization pre-pass

Three tightly-coupled pieces: (a) `buildVideoEditorRenderManifest` collects LUT URLs as `effectAssets`, (b) the executor downloads them and passes `localEffectAssetPaths` to the compiler, (c) clips carrying a `stabilize` effect get a two-pass vidstab pre-pass that replaces their local media file before compilation.

**Files:**
- Create: `scripts/higgsfield-executor/lib/editor-stabilize.mjs`
- Modify: `lib/video-editor/dispatch.ts`, `scripts/higgsfield-executor/executor.mjs`
- Test: `__tests__/scripts/editor-stabilize.test.ts` (new), `__tests__/lib/video-editor-dispatch.test.ts` (extend)

- [ ] **Step 1: Write the failing tests**

Append to `__tests__/lib/video-editor-dispatch.test.ts`:

```ts
describe('effect assets in the manifest', () => {
  it('collects lut urls keyed by clip + effect index', () => {
    const manifest = buildVideoEditorRenderManifest({
      jobId: 'job-1', orgId: 'org-1', projectId: 'proj-1',
      settings: defaultVideoEditorSettings(),
      timeline: {
        version: 1,
        tracks: [{
          id: 't1', kind: 'video',
          clips: [{
            id: 'c1', timelineStart: 0, duration: 4,
            media: { type: 'upload', fileId: 'f1', url: 'https://x.test/a.mp4', mediaKind: 'video' },
            effects: [
              { kind: 'blur', params: { sigma: 3 } },
              { kind: 'lut', params: { lutUrl: 'https://firebasestorage.googleapis.com/x.cube', intensity: 1 } },
            ],
          }],
        }],
      },
    })
    expect(manifest.effectAssets).toEqual([
      { clipId: 'c1', effectIndex: 1, url: 'https://firebasestorage.googleapis.com/x.cube' },
    ])
  })
})
```

(If `defaultVideoEditorSettings` is not imported in that test file yet, add the import from `@/lib/video-editor/types`.)

Create `__tests__/scripts/editor-stabilize.test.ts`:

```ts
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'

const modulePath = join(process.cwd(), 'scripts/higgsfield-executor/lib/editor-stabilize.mjs')

function runModule<T>(code: string): T {
  const stdout = execFileSync(process.execPath, ['--input-type=module', '-e', `
    import * as m from ${JSON.stringify(`file://${modulePath}`)};
    const result = await (async () => { ${code} })();
    process.stdout.write(JSON.stringify(result));
  `], { encoding: 'utf8' })
  return JSON.parse(stdout) as T
}

describe('vidstab two-pass arg builders', () => {
  it('builds detect args', () => {
    expect(runModule<string[]>(`return m.buildVidstabDetectArgs('/w/in.mp4', '/w/c1.trf', { shakiness: 7 })`)).toEqual([
      '-y', '-i', '/w/in.mp4',
      '-vf', 'vidstabdetect=shakiness=7:result=/w/c1.trf',
      '-f', 'null', '-',
    ])
  })

  it('builds transform args with defaults clamped', () => {
    expect(runModule<string[]>(`return m.buildVidstabTransformArgs('/w/in.mp4', '/w/c1.trf', '/w/out.mp4', {})`)).toEqual([
      '-y', '-i', '/w/in.mp4',
      '-vf', 'vidstabtransform=input=/w/c1.trf:smoothing=10,unsharp=5:5:0.8:3:3:0.4',
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-c:a', 'copy', '/w/out.mp4',
    ])
  })

  it('finds stabilize effects on a timeline', () => {
    const found = runModule<Array<{ clipId: string; params: Record<string, number> }>>(`return m.collectStabilizeClips(${JSON.stringify({
      version: 1,
      tracks: [{
        id: 't1', kind: 'video',
        clips: [
          { id: 'c1', timelineStart: 0, duration: 4, media: { type: 'upload', fileId: 'f1', url: 'https://x/a.mp4', mediaKind: 'video' }, effects: [{ kind: 'stabilize', params: { shakiness: 6, smoothing: 20 } }] },
          { id: 'c2', timelineStart: 4, duration: 2, media: { type: 'upload', fileId: 'f2', url: 'https://x/b.mp4', mediaKind: 'image' }, effects: [{ kind: 'stabilize', params: {} }] },
        ],
      }],
    })})`)
    expect(found).toEqual([{ clipId: 'c1', params: { shakiness: 6, smoothing: 20 } }])
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npx jest __tests__/scripts/editor-stabilize.test.ts __tests__/lib/video-editor-dispatch.test.ts`
Expected: FAIL — module missing / `effectAssets` undefined

- [ ] **Step 3: Implement `lib/video-editor/dispatch.ts`**

Extend the manifest interface:

```ts
export interface VideoEditorRenderManifest {
  kind: 'video_editor_render'
  job: { id: string; orgId: string; projectId: string }
  settings: VideoEditorProjectSettings
  timeline: EditorTimeline
  media: Array<{ clipId: string; url: string; mediaKind: string }>
  effectAssets: Array<{ clipId: string; effectIndex: number; url: string }>
  report: { method: 'PUT'; path: string }
  upload: { method: 'POST'; path: '/api/v1/upload'; folder: string; filename: string }
}
```

In `buildVideoEditorRenderManifest`, next to the `media` collection loop:

```ts
  const effectAssets: VideoEditorRenderManifest['effectAssets'] = []
  for (const track of input.timeline.tracks ?? []) {
    for (const clip of track.clips ?? []) {
      const effects = Array.isArray(clip.effects) ? clip.effects : []
      effects.forEach((effect, effectIndex) => {
        const lutUrl = effect.kind === 'lut' && typeof effect.params?.lutUrl === 'string' ? effect.params.lutUrl : ''
        if (/^https:\/\//.test(lutUrl)) effectAssets.push({ clipId: clip.id, effectIndex, url: lutUrl })
      })
    }
  }
```

…and include `effectAssets` in the returned object.

- [ ] **Step 4: Implement `scripts/higgsfield-executor/lib/editor-stabilize.mjs`**

```js
/** vidstab two-pass stabilization helpers. Pure arg builders — the executor spawns ffmpeg. */

function clampInt(value, min, max, fallback) {
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.round(Math.min(Math.max(n, min), max))
}

export function buildVidstabDetectArgs(inputPath, trfPath, params = {}) {
  const shakiness = clampInt(params.shakiness, 1, 10, 5)
  return ['-y', '-i', inputPath, '-vf', `vidstabdetect=shakiness=${shakiness}:result=${trfPath}`, '-f', 'null', '-']
}

export function buildVidstabTransformArgs(inputPath, trfPath, outputPath, params = {}) {
  const smoothing = clampInt(params.smoothing, 1, 100, 10)
  return [
    '-y', '-i', inputPath,
    '-vf', `vidstabtransform=input=${trfPath}:smoothing=${smoothing},unsharp=5:5:0.8:3:3:0.4`,
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-c:a', 'copy', outputPath,
  ]
}

/** Video (not image) clips carrying a stabilize effect. */
export function collectStabilizeClips(timeline) {
  const found = []
  for (const track of timeline?.tracks ?? []) {
    for (const clip of track?.clips ?? []) {
      if (!clip?.media || clip.media.mediaKind !== 'video') continue
      const effect = (Array.isArray(clip.effects) ? clip.effects : []).find((entry) => entry?.kind === 'stabilize')
      if (!effect) continue
      found.push({
        clipId: clip.id,
        params: {
          shakiness: clampInt(effect.params?.shakiness, 1, 10, 5),
          smoothing: clampInt(effect.params?.smoothing, 1, 100, 10),
        },
      })
    }
  }
  return found
}
```

- [ ] **Step 5: Wire the executor (`scripts/higgsfield-executor/executor.mjs`)**

Add the import at the top next to the other lib imports:

```js
import { buildVidstabDetectArgs, buildVidstabTransformArgs, collectStabilizeClips } from './lib/editor-stabilize.mjs'
```

In `executeEditorRender`, after the media download loop and **before** `compileEditorFiltergraph`:

```js
    // Effect assets (LUT .cube files)
    const localEffectAssetPaths = {}
    const effectAssets = Array.isArray(manifest.effectAssets) ? manifest.effectAssets : []
    for (let index = 0; index < effectAssets.length; index += 1) {
      const entry = effectAssets[index]
      if (!entry?.clipId || typeof entry.effectIndex !== 'number' || !entry?.url) continue
      try {
        localEffectAssetPaths[`${entry.clipId}:${entry.effectIndex}`] = await downloadEditorMedia(entry.url, workDir, 1000 + index)
      } catch (error) {
        await fail(`Effect asset download failed for clip ${entry.clipId}: ${String(error?.message || error)}`, 'editor_effect_asset_download_failed')
        return
      }
    }

    // Stabilization pre-pass (vidstab two-pass), replaces the clip's local media file.
    for (const stab of collectStabilizeClips(manifest.timeline)) {
      const inputPath = localMediaPaths[stab.clipId]
      if (!inputPath) continue
      const trfPath = join(workDir, `stab-${stab.clipId}.trf`)
      const stabilizedPath = join(workDir, `stab-${stab.clipId}.mp4`)
      const detect = await runFfmpeg(buildVidstabDetectArgs(inputPath, trfPath, stab.params), EDITOR_RENDER_TIMEOUT_MS)
      if (detect.code !== 0) {
        log('warn', 'vidstabdetect failed — rendering unstabilized', { clipId: stab.clipId, stderr: detect.stderr.slice(-200) })
        continue
      }
      const transform = await runFfmpeg(buildVidstabTransformArgs(inputPath, trfPath, stabilizedPath, stab.params), EDITOR_RENDER_TIMEOUT_MS)
      if (transform.code !== 0) {
        log('warn', 'vidstabtransform failed — rendering unstabilized', { clipId: stab.clipId, stderr: transform.stderr.slice(-200) })
        continue
      }
      localMediaPaths[stab.clipId] = stabilizedPath
      log('info', 'stabilized clip media', { clipId: stab.clipId })
    }
```

…and pass the assets into the compiler:

```js
    const compiled = compileEditorFiltergraph({
      timeline: manifest.timeline,
      settings: manifest.settings,
      localMediaPaths,
      localEffectAssetPaths,
      ...(EDITOR_FONT_FILE ? { fontFile: EDITOR_FONT_FILE } : {}),
    })
```

Note: `downloadEditorMedia` sniffs extensions and will reject `.cube` unless allowed — extend `CONTENT_TYPE_EXTENSIONS`/URL-path regex handling: in `downloadEditorMedia`, change the path-extension regex to `/\.(png|jpe?g|webp|gif|mp4|mov|webm|mp3|wav|cube)$/i` and accept `text/plain` for `.cube` URLs by adding a guard before the "could not determine media type" throw:

```js
  if (!extension && /\.cube(\?|$)/i.test(current)) extension = 'cube'
```

(change `const extension` to `let extension`).

- [ ] **Step 6: Run tests**

Run: `npx jest __tests__/scripts/editor-stabilize.test.ts __tests__/lib/video-editor-dispatch.test.ts __tests__/scripts/editor-filtergraph.test.ts __tests__/scripts/editor-effects-filtergraph.test.ts`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add lib/video-editor/dispatch.ts scripts/higgsfield-executor/lib/editor-stabilize.mjs scripts/higgsfield-executor/executor.mjs __tests__/scripts/editor-stabilize.test.ts __tests__/lib/video-editor-dispatch.test.ts
git commit -m "feat(executor): LUT asset downloads + vidstab two-pass stabilization pre-pass"
```

---

### Task 7: Filtergraph audio — track gain/pan/solo, clip fades, noise reduction, voice isolation

The audio section of `compileEditorFiltergraph` learns per-source processing. Legacy behavior (single source → `[aout]`, multi → `amix`) must stay byte-identical when no new fields are present.

**Files:**
- Modify: `scripts/higgsfield-executor/lib/editor-filtergraph.mjs`
- Test: `__tests__/scripts/editor-audio-filtergraph.test.ts` (new; same `runModule` helper as Task 3)

- [ ] **Step 1: Write the failing golden tests**

```ts
// __tests__/scripts/editor-audio-filtergraph.test.ts
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'

const modulePath = join(process.cwd(), 'scripts/higgsfield-executor/lib/editor-filtergraph.mjs')

function runModule<T>(code: string): T {
  const stdout = execFileSync(process.execPath, ['--input-type=module', '-e', `
    import * as m from ${JSON.stringify(`file://${modulePath}`)};
    const result = await (async () => { ${code} })();
    process.stdout.write(JSON.stringify(result));
  `], { encoding: 'utf8' })
  return JSON.parse(stdout) as T
}

const settings = { width: 1280, height: 720, fps: 30, background: '#000000' }

function compileTracks(tracks: unknown[], localMediaPaths: Record<string, string>) {
  return runModule<{ filterComplex: string }>(`return m.compileEditorFiltergraph(${JSON.stringify({
    settings, localMediaPaths, timeline: { version: 1, tracks },
  })})`)
}

const audioClip = (id: string, extra: Record<string, unknown> = {}) => ({
  id, timelineStart: 0, duration: 4,
  media: { type: 'upload', fileId: `f-${id}`, url: `https://x.test/${id}.mp3`, mediaKind: 'audio' },
  volume: 1,
  ...extra,
})

describe('audio engineering', () => {
  it('applies track gainDb and pan to every source on the track', () => {
    const { filterComplex } = compileTracks(
      [{ id: 't-a', kind: 'audio', gainDb: -6, pan: 0.5, clips: [audioClip('c1')] }],
      { c1: '/tmp/m/c1.mp3' },
    )
    expect(filterComplex).toContain('volume=-6dB')
    expect(filterComplex).toContain('stereotools=balance_out=0.5')
  })

  it('applies clip fade in/out with afade at stream-relative times', () => {
    const { filterComplex } = compileTracks(
      [{ id: 't-a', kind: 'audio', clips: [audioClip('c1', { fadeInSeconds: 0.5, fadeOutSeconds: 1 })] }],
      { c1: '/tmp/m/c1.mp3' },
    )
    expect(filterComplex).toContain('afade=t=in:st=0:d=0.5')
    expect(filterComplex).toContain('afade=t=out:st=3:d=1')
  })

  it('compiles noise reduction and voice isolation clip effects', () => {
    const { filterComplex } = compileTracks(
      [{
        id: 't-a', kind: 'audio',
        clips: [audioClip('c1', {
          effects: [
            { kind: 'noise_reduction', params: { amountDb: 18 } },
            { kind: 'voice_isolation', params: {} },
          ],
        })],
      }],
      { c1: '/tmp/m/c1.mp3' },
    )
    expect(filterComplex).toContain('afftdn=nr=18')
    expect(filterComplex).toContain('highpass=f=100,lowpass=f=8000,afftdn=nr=20:nf=-30')
  })

  it('solo on one track excludes non-solo audio tracks', () => {
    const { filterComplex } = compileTracks(
      [
        { id: 't-a', kind: 'audio', solo: true, clips: [audioClip('c1')] },
        { id: 't-b', kind: 'audio', clips: [audioClip('c2')] },
      ],
      { c1: '/tmp/m/c1.mp3', c2: '/tmp/m/c2.mp3' },
    )
    // only c1's input (index 1) feeds audio; c2 (index 2) does not
    expect(filterComplex).toContain('[1:a]')
    expect(filterComplex).not.toContain('[2:a]')
  })

  it('legacy single-source output stays byte-identical without new fields', () => {
    const { filterComplex } = compileTracks(
      [{ id: 't-a', kind: 'audio', clips: [audioClip('c1', { volume: 0.8 })] }],
      { c1: '/tmp/m/c1.mp3' },
    )
    expect(filterComplex).toContain('[1:a]atrim=start=0:duration=4,asetpts=PTS-STARTPTS,volume=0.8[aout]')
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npx jest __tests__/scripts/editor-audio-filtergraph.test.ts`
Expected: FAIL — no `volume=-6dB`, no `afade`, solo not honored

- [ ] **Step 3: Implement**

In the audio-source collection loop of `compileEditorFiltergraph`, first compute solo state and carry the track with each source:

```js
  const anySolo = tracks.some((track) => (track.kind === 'audio' || track.kind === 'video') && track.solo === true)
  const audioSources = []
  for (const track of tracks) {
    if (track.muted) continue
    if (anySolo && track.solo !== true) continue
    for (const clip of sortedClips(track)) {
      if (!clip.media) continue
      if (track.kind === 'audio' && (clip.media.mediaKind === 'audio' || clip.media.mediaKind === 'video')) {
        const volume = typeof clip.volume === 'number' ? clip.volume : 1
        if (volume > 0) audioSources.push({ clip, volume, track })
      } else if (track.kind === 'video' && clip.media.mediaKind === 'video' && typeof clip.volume === 'number' && clip.volume > 0) {
        audioSources.push({ clip, volume: clip.volume, track })
      }
    }
  }
```

Then extend the per-source chain builder. Replace the existing `audioSources.forEach(...)` body's `parts` construction with:

```js
      const speed = clipSpeed(clip)
      const parts = [
        `atrim=start=${fmt(clip.trimStart ?? 0)}:duration=${fmt(clip.duration * speed)}`,
        'asetpts=PTS-STARTPTS',
        ...atempoFactors(speed).map((factor) => `atempo=${fmt(factor)}`),
      ]
      for (const effect of Array.isArray(clip.effects) ? clip.effects : []) {
        if (effect?.kind === 'noise_reduction') {
          const nr = Math.min(Math.max(Number(effect.params?.amountDb) || 12, 0.01), 60)
          parts.push(`afftdn=nr=${fmt(nr)}`)
        } else if (effect?.kind === 'voice_isolation') {
          parts.push('highpass=f=100,lowpass=f=8000,afftdn=nr=20:nf=-30')
        }
      }
      if (typeof clip.fadeInSeconds === 'number' && clip.fadeInSeconds > 0) {
        parts.push(`afade=t=in:st=0:d=${fmt(clip.fadeInSeconds)}`)
      }
      if (typeof clip.fadeOutSeconds === 'number' && clip.fadeOutSeconds > 0) {
        parts.push(`afade=t=out:st=${fmt(Math.max(0, clip.duration - clip.fadeOutSeconds))}:d=${fmt(clip.fadeOutSeconds)}`)
      }
      if (volume !== 1) parts.push(`volume=${fmt(volume)}`)
      if (typeof track.gainDb === 'number' && track.gainDb !== 0) parts.push(`volume=${fmt(track.gainDb)}dB`)
      if (typeof track.pan === 'number' && track.pan !== 0) parts.push(`stereotools=balance_out=${fmt(track.pan)}`)
      if (clip.timelineStart > 0) parts.push(`adelay=${Math.round(clip.timelineStart * 1000)}:all=1`)
```

(destructure `{ clip, volume, track }` in the forEach). Order matters: clip volume → track gain → pan → adelay, so the legacy `volume=0.8[aout]` golden output stays identical when no new fields exist.

- [ ] **Step 4: Run all filtergraph suites**

Run: `npx jest __tests__/scripts/editor-audio-filtergraph.test.ts __tests__/scripts/editor-filtergraph.test.ts __tests__/scripts/editor-effects-filtergraph.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add scripts/higgsfield-executor/lib/editor-filtergraph.mjs __tests__/scripts/editor-audio-filtergraph.test.ts
git commit -m "feat(executor): track mixer (gain/pan/solo), clip fades, noise reduction, voice isolation"
```

---

### Task 8: Filtergraph audio — auto-ducking (sidechaincompress)

Music tracks flagged `duckUnderVoice: true` duck under voice sources. Voice sources = clips from audio tracks with `audioRole: 'voice'` plus any video-track clip audio. If either side is empty, output is unchanged.

**Files:**
- Modify: `scripts/higgsfield-executor/lib/editor-filtergraph.mjs`
- Test: `__tests__/scripts/editor-audio-filtergraph.test.ts` (extend)

- [ ] **Step 1: Add failing golden test**

```ts
describe('auto-ducking', () => {
  it('routes voice through asplit into sidechaincompress against ducked tracks', () => {
    const { filterComplex } = compileTracks(
      [
        { id: 't-voice', kind: 'audio', audioRole: 'voice', clips: [audioClip('c1')] },
        { id: 't-music', kind: 'audio', audioRole: 'music', duckUnderVoice: true, clips: [audioClip('c2')] },
      ],
      { c1: '/tmp/m/c1.mp3', c2: '/tmp/m/c2.mp3' },
    )
    expect(filterComplex).toContain('asplit=2[duckvout][ducksc]')
    expect(filterComplex).toContain('sidechaincompress=threshold=0.05:ratio=8:attack=20:release=400[ducked]')
    expect(filterComplex).toContain('[duckvout][ducked]amix=inputs=2:duration=longest:normalize=0[aout]')
  })

  it('does not duck when no track opts in', () => {
    const { filterComplex } = compileTracks(
      [
        { id: 't-voice', kind: 'audio', audioRole: 'voice', clips: [audioClip('c1')] },
        { id: 't-music', kind: 'audio', audioRole: 'music', clips: [audioClip('c2')] },
      ],
      { c1: '/tmp/m/c1.mp3', c2: '/tmp/m/c2.mp3' },
    )
    expect(filterComplex).not.toContain('sidechaincompress')
    expect(filterComplex).toContain('amix=inputs=2')
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npx jest __tests__/scripts/editor-audio-filtergraph.test.ts -t "auto-ducking"`
Expected: FAIL

- [ ] **Step 3: Implement**

After the per-source chains are pushed (each source labeled `ac${index}` in the multi-source path), replace the final `amix` block with grouping logic:

```js
    if (audioSources.length > 1) {
      const voiceLabels = []
      const duckLabels = []
      const otherLabels = []
      audioSources.forEach(({ clip, track }, index) => {
        const label = `ac${index}`
        const isVoice = track.audioRole === 'voice' || track.kind === 'video'
        if (isVoice) voiceLabels.push(label)
        else if (track.duckUnderVoice === true) duckLabels.push(label)
        else otherLabels.push(label)
      })
      if (voiceLabels.length && duckLabels.length) {
        const voiceMix = voiceLabels.length === 1
          ? voiceLabels[0]
          : (chains.push(`${voiceLabels.map((l) => `[${l}]`).join('')}amix=inputs=${voiceLabels.length}:duration=longest:normalize=0[duckvmix]`), 'duckvmix')
        chains.push(`[${voiceMix}]asplit=2[duckvout][ducksc]`)
        const duckMix = duckLabels.length === 1
          ? duckLabels[0]
          : (chains.push(`${duckLabels.map((l) => `[${l}]`).join('')}amix=inputs=${duckLabels.length}:duration=longest:normalize=0[duckdmix]`), 'duckdmix')
        chains.push(`[${duckMix}][ducksc]sidechaincompress=threshold=0.05:ratio=8:attack=20:release=400[ducked]`)
        const finalInputs = ['duckvout', 'ducked', ...otherLabels]
        chains.push(`${finalInputs.map((l) => `[${l}]`).join('')}amix=inputs=${finalInputs.length}:duration=longest:normalize=0[aout]`)
      } else {
        chains.push(`${labels.map((label) => `[${label}]`).join('')}amix=inputs=${labels.length}:duration=longest:normalize=0[aout]`)
      }
    }
```

Caveat to preserve: in the single-source path (`audioSources.length === 1`) the label is still `aout` directly — ducking requires ≥2 sources by construction, so nothing changes there.

- [ ] **Step 4: Run all filtergraph suites**

Run: `npx jest __tests__/scripts/editor-audio-filtergraph.test.ts __tests__/scripts/editor-filtergraph.test.ts __tests__/scripts/editor-effects-filtergraph.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add scripts/higgsfield-executor/lib/editor-filtergraph.mjs __tests__/scripts/editor-audio-filtergraph.test.ts
git commit -m "feat(executor): auto-ducking — music ducks under voice via sidechaincompress"
```

---

### Task 9: Beat detection — executor analysis module + HTTP endpoint

Onset analysis is pure Node: decode audio to mono 8 kHz PCM via ffmpeg, window the samples, flag energy peaks, derive BPM from median inter-onset interval. The executor exposes `POST /video-editor/analyze-beats` and reports results back with a platform PUT (Task 10 builds the platform side).

**Files:**
- Create: `scripts/higgsfield-executor/lib/editor-beats.mjs`
- Modify: `scripts/higgsfield-executor/executor.mjs`
- Test: `__tests__/scripts/editor-beats-analysis.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// __tests__/scripts/editor-beats-analysis.test.ts
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'

const modulePath = join(process.cwd(), 'scripts/higgsfield-executor/lib/editor-beats.mjs')

function runModule<T>(code: string): T {
  const stdout = execFileSync(process.execPath, ['--input-type=module', '-e', `
    import * as m from ${JSON.stringify(`file://${modulePath}`)};
    const result = await (async () => { ${code} })();
    process.stdout.write(JSON.stringify(result));
  `], { encoding: 'utf8' })
  return JSON.parse(stdout) as T
}

describe('beat onset analysis', () => {
  it('detects clicks at 120 BPM in synthetic PCM and estimates bpm', () => {
    // Build 8s of silence with loud 50ms bursts every 0.5s (120 BPM) at 8kHz s16le.
    const result = runModule<{ beats: number[]; bpm: number }>(`
      const rate = 8000
      const seconds = 8
      const samples = new Int16Array(rate * seconds)
      for (let beat = 0; beat < 16; beat += 1) {
        const start = Math.round(beat * 0.5 * rate)
        for (let i = 0; i < rate * 0.05; i += 1) samples[start + i] = (i % 2 === 0 ? 20000 : -20000)
      }
      return m.analyzeBeatsFromPcm(Buffer.from(samples.buffer), rate)
    `)
    expect(result.bpm).toBeGreaterThanOrEqual(115)
    expect(result.bpm).toBeLessThanOrEqual(125)
    expect(result.beats.length).toBeGreaterThanOrEqual(14)
    expect(result.beats.length).toBeLessThanOrEqual(18)
    // first beat lands near t=0, second near t=0.5
    expect(Math.abs(result.beats[0])).toBeLessThan(0.15)
    expect(Math.abs(result.beats[1] - 0.5)).toBeLessThan(0.15)
  })

  it('returns empty results for silence', () => {
    const result = runModule<{ beats: number[]; bpm: number }>(`
      return m.analyzeBeatsFromPcm(Buffer.alloc(8000 * 4 * 2), 8000)
    `)
    expect(result.beats).toEqual([])
    expect(result.bpm).toBe(0)
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npx jest __tests__/scripts/editor-beats-analysis.test.ts`
Expected: FAIL — module missing

- [ ] **Step 3: Implement `scripts/higgsfield-executor/lib/editor-beats.mjs`**

```js
/**
 * Beat/onset detection from raw PCM (s16le mono).
 * Energy-based: RMS per 64ms window; onset = window whose energy exceeds
 * 1.5× the trailing 1s average AND is a local maximum, with a 250ms refractory
 * period. BPM = 60 / median inter-onset interval, folded into [60, 180).
 */
const WINDOW_SECONDS = 0.064
const REFRACTORY_SECONDS = 0.25
const HISTORY_SECONDS = 1
const THRESHOLD_RATIO = 1.5
const MIN_ENERGY = 500 // absolute RMS floor — ignores near-silence

export function analyzeBeatsFromPcm(buffer, sampleRate) {
  const samples = new Int16Array(buffer.buffer, buffer.byteOffset, Math.floor(buffer.byteLength / 2))
  const windowSize = Math.max(64, Math.round(sampleRate * WINDOW_SECONDS))
  const energies = []
  for (let start = 0; start + windowSize <= samples.length; start += windowSize) {
    let sum = 0
    for (let i = start; i < start + windowSize; i += 1) sum += samples[i] * samples[i]
    energies.push(Math.sqrt(sum / windowSize))
  }
  const historyWindows = Math.max(1, Math.round(HISTORY_SECONDS / WINDOW_SECONDS))
  const beats = []
  let lastBeatAt = -Infinity
  for (let i = 1; i < energies.length - 1; i += 1) {
    const from = Math.max(0, i - historyWindows)
    let avg = 0
    for (let j = from; j < i; j += 1) avg += energies[j]
    avg /= Math.max(1, i - from)
    const at = i * WINDOW_SECONDS
    const isPeak = energies[i] >= energies[i - 1] && energies[i] >= energies[i + 1]
    if (energies[i] > MIN_ENERGY && energies[i] > avg * THRESHOLD_RATIO && isPeak && at - lastBeatAt >= REFRACTORY_SECONDS) {
      beats.push(Math.round(at * 1000) / 1000)
      lastBeatAt = at
    }
  }
  let bpm = 0
  if (beats.length >= 3) {
    const intervals = beats.slice(1).map((t, i) => t - beats[i]).sort((a, b) => a - b)
    const median = intervals[Math.floor(intervals.length / 2)]
    if (median > 0) {
      bpm = 60 / median
      while (bpm >= 180) bpm /= 2
      while (bpm > 0 && bpm < 60) bpm *= 2
      bpm = Math.round(bpm * 10) / 10
    }
  }
  return { beats, bpm }
}

export function buildPcmDecodeArgs(inputPath, outputPath) {
  return ['-y', '-i', inputPath, '-vn', '-ac', '1', '-ar', '8000', '-f', 's16le', outputPath]
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx jest __tests__/scripts/editor-beats-analysis.test.ts`
Expected: PASS. If the synthetic-click test misses beats, tune `THRESHOLD_RATIO`/`MIN_ENERGY` in the module (not the test tolerances) until it passes deterministically.

- [ ] **Step 5: Add the executor endpoint** (`scripts/higgsfield-executor/executor.mjs`)

Import at the top: `import { analyzeBeatsFromPcm, buildPcmDecodeArgs } from './lib/editor-beats.mjs'`

Add the async worker next to `executeEditorRender`:

```js
async function executeBeatAnalysis(job, manifest) {
  const base = baseUrlFrom(manifest)
  const reportPath = manifest.report?.path
    || `/api/v1/video-editor/media/${manifest.uploadId}/beats?orgId=${encodeURIComponent(manifest.orgId)}`
  let workDir
  try {
    workDir = await mkdtemp(join(tmpdir(), 'vbeats-'))
    const mediaPath = await downloadEditorMedia(manifest.media.url, workDir, 0)
    const pcmPath = join(workDir, 'audio.pcm')
    const decoded = await runFfmpeg(buildPcmDecodeArgs(mediaPath, pcmPath), 10 * 60 * 1000)
    if (decoded.code !== 0) throw new Error(`pcm decode failed: ${decoded.stderr.trim().slice(-300)}`)
    const pcm = await readFile(pcmPath)
    const { beats, bpm } = analyzeBeatsFromPcm(pcm, 8000)
    const report = await platformPut(base, reportPath, { status: 'analyzed', beats, bpm })
    if (!report.ok) throw new Error(`platform rejected beat report (HTTP ${report.status})`)
    job.status = 'completed'
    job.providerStatus = 'completed'
    job.providerStatusMessage = `Found ${beats.length} beats (${bpm} BPM).`
    log('info', 'beat analysis completed', { uploadId: manifest.uploadId, beats: beats.length, bpm })
  } catch (error) {
    job.status = 'failed'
    job.providerStatus = 'beat_analysis_failed'
    job.providerStatusMessage = String(error?.message || error).slice(0, 500)
    log('error', 'beat analysis failed', { uploadId: manifest.uploadId, message: job.providerStatusMessage })
    await platformPut(base, reportPath, { status: 'failed', error: { code: 'beat_analysis_failed', message: job.providerStatusMessage } })
  } finally {
    if (workDir) rm(workDir, { recursive: true, force: true }).catch(() => {})
    setTimeout(() => jobs.delete(job.providerJobId), JOB_TTL_MS).unref?.()
  }
}
```

Add the route in the server handler, next to the `/video-editor/renders` block:

```js
    if (req.method === 'POST' && url.pathname === '/video-editor/analyze-beats') {
      const body = JSON.parse(await readBody(req) || 'null')
      if (body?.kind !== 'video_editor_beats' || !body.uploadId || !body.orgId || !body.media?.url) {
        return json(res, 400, { error: 'Valid video_editor_beats manifest is required' })
      }
      const providerJobId = `vbeat-${body.uploadId}-${randomUUID().slice(0, 8)}`
      const job = { providerJobId, uploadId: body.uploadId, status: 'running', providerStatus: 'executor_accepted', providerStatusMessage: 'Beat analysis accepted.', createdAt: Date.now() }
      jobs.set(providerJobId, job)
      log('info', 'beat analysis accepted', { uploadId: body.uploadId, providerJobId })
      executeBeatAnalysis(job, body).catch((error) => log('error', 'executeBeatAnalysis crashed', { uploadId: body.uploadId, error: String(error) }))
      return json(res, 200, { providerJobId, status: 'running', providerStatus: job.providerStatus, providerStatusMessage: job.providerStatusMessage })
    }
```

- [ ] **Step 6: Run the executor test suite again (no regressions)**

Run: `npx jest __tests__/scripts/`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add scripts/higgsfield-executor/lib/editor-beats.mjs scripts/higgsfield-executor/executor.mjs __tests__/scripts/editor-beats-analysis.test.ts
git commit -m "feat(executor): onset-based beat detection endpoint /video-editor/analyze-beats"
```

---

### Task 10: Platform beats routes + `snapToBeats` helper

`app/api/v1/video-editor/media/[id]/beats/route.ts` — GET (read markers), POST (dispatch analysis to the executor), PUT (executor report writes markers onto the `uploads` doc). Plus a pure `snapToBeats` in timeline-ops.

**Files:**
- Create: `lib/video-editor/beats.ts`, `app/api/v1/video-editor/media/[id]/beats/route.ts`
- Modify: `lib/video-editor/timeline-ops.ts`
- Test: `__tests__/api/video-editor-beats.test.ts`, `__tests__/lib/video-editor-timeline-ops.test.ts` (extend)

- [ ] **Step 1: Write the failing tests**

Append to `__tests__/lib/video-editor-timeline-ops.test.ts`:

```ts
describe('snapToBeats', () => {
  it('snaps to the nearest beat inside the threshold, passes through otherwise', () => {
    const beats = [0, 0.5, 1.0, 1.52]
    expect(snapToBeats(0.48, beats)).toBe(0.5)
    expect(snapToBeats(1.6, beats)).toBe(1.52)
    expect(snapToBeats(2.4, beats)).toBe(2.4)          // > 0.25s from any beat
    expect(snapToBeats(0.48, [])).toBe(0.48)
    expect(snapToBeats(0.4, beats, 0.05)).toBe(0.4)    // custom tight threshold
  })
})
```

(add `snapToBeats` to the existing import from `@/lib/video-editor/timeline-ops`)

Create `__tests__/api/video-editor-beats.test.ts` (mock pattern from `__tests__/api/youtube-studio-videos-import.test.ts`):

```ts
import { NextRequest } from 'next/server'
import type { ApiUser } from '@/lib/api/types'

const mockUploadGet = jest.fn()
const mockUploadSet = jest.fn()
const mockFetch = jest.fn()

let mockUser: ApiUser = { uid: 'admin-1', role: 'admin' } as ApiUser

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: {
    collection: (name: string) => {
      if (name === 'uploads') return { doc: () => ({ get: mockUploadGet, set: mockUploadSet }) }
      throw new Error(`Unexpected collection ${name}`)
    },
  },
}))
jest.mock('@/lib/api/auth', () => ({
  withAuth: (_role: string, handler: (req: NextRequest, user: ApiUser, context?: unknown) => Promise<Response>) =>
    (req: NextRequest, context?: unknown) => handler(req, mockUser, context),
}))
jest.mock('@/lib/youtube-studio/api', () => ({
  ensureOrgAccess: jest.fn().mockResolvedValue(null),
  updateActorFields: () => ({ updatedBy: 'admin-1', updatedByType: 'user' }),
}))
jest.mock('firebase-admin/firestore', () => ({ FieldValue: { serverTimestamp: () => 'SERVER_TS' } }))

const context = { params: Promise.resolve({ id: 'upload-1' }) }

describe('video-editor media beats route', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    jest.resetModules()
    global.fetch = mockFetch as unknown as typeof fetch
    process.env.HIGGSFIELD_RUNTIME_URL = 'https://runtime.test'
    process.env.HIGGSFIELD_RUNTIME_API_KEY = 'runtime-key'
    process.env.NEXT_PUBLIC_APP_URL = 'https://app.test'
    mockUploadGet.mockResolvedValue({
      exists: true,
      data: () => ({ orgId: 'org-1', url: 'https://firebasestorage.googleapis.com/m.mp3', deleted: false }),
    })
    mockUploadSet.mockResolvedValue(undefined)
  })

  it('GET returns stored beat markers', async () => {
    mockUploadGet.mockResolvedValue({
      exists: true,
      data: () => ({ orgId: 'org-1', beatMarkers: [0.5, 1.0], beatBpm: 120, deleted: false }),
    })
    const { GET } = await import('@/app/api/v1/video-editor/media/[id]/beats/route')
    const res = await GET(new NextRequest('http://localhost/api/v1/video-editor/media/upload-1/beats?orgId=org-1'), context)
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.data).toEqual({ beats: [0.5, 1.0], bpm: 120, status: 'analyzed' })
  })

  it('POST dispatches an analysis manifest to the executor', async () => {
    mockFetch.mockResolvedValue({ ok: true, text: async () => JSON.stringify({ providerJobId: 'vbeat-1' }) })
    const { POST } = await import('@/app/api/v1/video-editor/media/[id]/beats/route')
    const res = await POST(new NextRequest('http://localhost/api/v1/video-editor/media/upload-1/beats?orgId=org-1', { method: 'POST' }), context)
    expect(res.status).toBe(202)
    const [calledUrl, init] = mockFetch.mock.calls[0]
    expect(calledUrl).toBe('https://runtime.test/video-editor/analyze-beats')
    const payload = JSON.parse((init as RequestInit).body as string)
    expect(payload).toMatchObject({ kind: 'video_editor_beats', uploadId: 'upload-1', orgId: 'org-1', media: { url: 'https://firebasestorage.googleapis.com/m.mp3' } })
    expect(payload.report.path).toBe('/api/v1/video-editor/media/upload-1/beats?orgId=org-1')
  })

  it('PUT stores executor results, clamping junk', async () => {
    const { PUT } = await import('@/app/api/v1/video-editor/media/[id]/beats/route')
    const res = await PUT(new NextRequest('http://localhost/api/v1/video-editor/media/upload-1/beats?orgId=org-1', {
      method: 'PUT',
      body: JSON.stringify({ status: 'analyzed', beats: [0.5, -1, 'x', 3.25], bpm: 128 }),
    }), context)
    expect(res.status).toBe(200)
    expect(mockUploadSet).toHaveBeenCalledWith(
      expect.objectContaining({ beatMarkers: [0.5, 3.25], beatBpm: 128, beatAnalysis: 'analyzed' }),
      { merge: true },
    )
  })

  it('PUT rejects when the upload belongs to another org', async () => {
    mockUploadGet.mockResolvedValue({ exists: true, data: () => ({ orgId: 'org-OTHER', deleted: false }) })
    const { PUT } = await import('@/app/api/v1/video-editor/media/[id]/beats/route')
    const res = await PUT(new NextRequest('http://localhost/api/v1/video-editor/media/upload-1/beats?orgId=org-1', {
      method: 'PUT', body: JSON.stringify({ status: 'analyzed', beats: [], bpm: 0 }),
    }), context)
    expect(res.status).toBe(404)
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npx jest __tests__/api/video-editor-beats.test.ts __tests__/lib/video-editor-timeline-ops.test.ts`
Expected: FAIL — route module and `snapToBeats` missing

- [ ] **Step 3: Implement `snapToBeats`** — append to `lib/video-editor/timeline-ops.ts`:

```ts
/** Snap a timeline position to the nearest beat marker within thresholdSeconds. */
export function snapToBeats(seconds: number, beats: number[], thresholdSeconds = 0.25): number {
  let best = seconds
  let bestDistance = thresholdSeconds
  for (const beat of beats) {
    const distance = Math.abs(beat - seconds)
    if (distance <= bestDistance) {
      best = beat
      bestDistance = distance
    }
  }
  return best
}
```

- [ ] **Step 4: Implement `lib/video-editor/beats.ts`**

```ts
import { videoEditorRuntimeConfigFromEnv } from './dispatch'
import type { VideoEditorRuntimeConfig } from './dispatch'

export interface BeatAnalysisManifest {
  kind: 'video_editor_beats'
  uploadId: string
  orgId: string
  media: { url: string }
  report: { method: 'PUT'; path: string }
}

export function buildBeatAnalysisManifest(input: { uploadId: string; orgId: string; mediaUrl: string }): BeatAnalysisManifest {
  return {
    kind: 'video_editor_beats',
    uploadId: input.uploadId,
    orgId: input.orgId,
    media: { url: input.mediaUrl },
    report: { method: 'PUT', path: `/api/v1/video-editor/media/${input.uploadId}/beats?orgId=${encodeURIComponent(input.orgId)}` },
  }
}

export async function dispatchBeatAnalysis(
  manifest: BeatAnalysisManifest,
  config: VideoEditorRuntimeConfig = videoEditorRuntimeConfigFromEnv(),
): Promise<{ providerJobId: string }> {
  const baseUrl = config.submitUrl?.replace(/\/video-editor\/renders$/, '')
  if (!baseUrl) throw new Error('Video editor runtime is not configured (set HIGGSFIELD_RUNTIME_URL)')
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (config.apiKey) headers.Authorization = `Bearer ${config.apiKey}`
  const response = await fetch(`${baseUrl}/video-editor/analyze-beats`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      ...manifest,
      callback: { url: config.callbackBaseUrl ? `${config.callbackBaseUrl}${manifest.report.path}` : undefined },
    }),
  })
  const text = await response.text().catch(() => '')
  if (!response.ok) throw new Error(`Executor rejected beat analysis (${response.status}): ${text.slice(0, 300)}`)
  let body: Record<string, unknown> = {}
  try { body = JSON.parse(text) as Record<string, unknown> } catch { body = {} }
  const providerJobId = typeof body.providerJobId === 'string' ? body.providerJobId : ''
  if (!providerJobId) throw new Error('Executor accepted beat analysis but returned no providerJobId')
  return { providerJobId }
}
```

- [ ] **Step 5: Implement the route** `app/api/v1/video-editor/media/[id]/beats/route.ts`:

```ts
import { NextRequest } from 'next/server'
import { adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { apiError, apiSuccess } from '@/lib/api/response'
import { ensureOrgAccess, updateActorFields } from '@/lib/youtube-studio/api'
import { buildBeatAnalysisManifest, dispatchBeatAnalysis } from '@/lib/video-editor/beats'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ id: string }> }

async function loadUpload(id: string, orgId: string) {
  const ref = adminDb.collection('uploads').doc(id)
  const snap = await ref.get()
  const data = snap.exists ? (snap.data() as Record<string, unknown>) : undefined
  if (!data || data.deleted === true || data.orgId !== orgId) return null
  return { ref, data }
}

function orgIdFrom(req: NextRequest): string {
  return new URL(req.url).searchParams.get('orgId')?.trim() ?? ''
}

export const GET = withAuth('client', async (req: NextRequest, user, context) => {
  const { id } = await (context as RouteContext).params
  const orgId = orgIdFrom(req)
  const denied = await ensureOrgAccess(user, orgId)
  if (denied) return denied
  const upload = await loadUpload(id, orgId)
  if (!upload) return apiError('Upload not found', 404)
  return apiSuccess({
    beats: Array.isArray(upload.data.beatMarkers) ? upload.data.beatMarkers : [],
    bpm: typeof upload.data.beatBpm === 'number' ? upload.data.beatBpm : 0,
    status: typeof upload.data.beatAnalysis === 'string' ? upload.data.beatAnalysis : 'none',
  })
})

export const POST = withAuth('client', async (req: NextRequest, user, context) => {
  const { id } = await (context as RouteContext).params
  const orgId = orgIdFrom(req)
  const denied = await ensureOrgAccess(user, orgId)
  if (denied) return denied
  const upload = await loadUpload(id, orgId)
  if (!upload) return apiError('Upload not found', 404)
  const mediaUrl = typeof upload.data.url === 'string' ? upload.data.url : ''
  if (!/^https:\/\//.test(mediaUrl)) return apiError('Upload has no analyzable URL', 400)
  try {
    const dispatched = await dispatchBeatAnalysis(buildBeatAnalysisManifest({ uploadId: id, orgId, mediaUrl }))
    await upload.ref.set({ beatAnalysis: 'analyzing', ...updateActorFields(user) }, { merge: true })
    return apiSuccess({ providerJobId: dispatched.providerJobId }, 202)
  } catch (error) {
    return apiError(`Beat analysis dispatch failed: ${error instanceof Error ? error.message : 'unknown'}`, 502)
  }
})

export const PUT = withAuth('client', async (req: NextRequest, user, context) => {
  const { id } = await (context as RouteContext).params
  const orgId = orgIdFrom(req)
  const denied = await ensureOrgAccess(user, orgId)
  if (denied) return denied
  const upload = await loadUpload(id, orgId)
  if (!upload) return apiError('Upload not found', 404)
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  if (body.status === 'failed') {
    await upload.ref.set({ beatAnalysis: 'failed', ...updateActorFields(user) }, { merge: true })
    return apiSuccess({ status: 'failed' })
  }
  const beats = (Array.isArray(body.beats) ? body.beats : [])
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0)
    .slice(0, 5000)
  const bpm = typeof body.bpm === 'number' && Number.isFinite(body.bpm) && body.bpm >= 0 ? body.bpm : 0
  await upload.ref.set({ beatMarkers: beats, beatBpm: bpm, beatAnalysis: 'analyzed', ...updateActorFields(user) }, { merge: true })
  return apiSuccess({ status: 'analyzed', beats: beats.length, bpm })
})
```

- [ ] **Step 6: Run tests**

Run: `npx jest __tests__/api/video-editor-beats.test.ts __tests__/lib/video-editor-timeline-ops.test.ts`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add lib/video-editor/beats.ts lib/video-editor/timeline-ops.ts app/api/v1/video-editor/media __tests__/api/video-editor-beats.test.ts __tests__/lib/video-editor-timeline-ops.test.ts
git commit -m "feat(video-editor): beat analysis dispatch/report routes + snapToBeats"
```

---

### Task 11: LUT library — `video_editor_luts` collection + routes

Org-scoped `.cube` uploads. `POST /api/v1/video-editor/luts` (multipart, validates the .cube header, stores in Firebase Storage), `GET` lists, `DELETE /api/v1/video-editor/luts/[id]` soft-deletes.

**Files:**
- Create: `app/api/v1/video-editor/luts/route.ts`, `app/api/v1/video-editor/luts/[id]/route.ts`
- Modify: `lib/video-editor/api.ts` (collection name)
- Test: `__tests__/api/video-editor-luts.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// __tests__/api/video-editor-luts.test.ts
import { NextRequest } from 'next/server'
import type { ApiUser } from '@/lib/api/types'

const mockLutAdd = jest.fn()
const mockLutGet = jest.fn()
const mockLutDocGet = jest.fn()
const mockLutDocSet = jest.fn()
const mockSave = jest.fn()

let mockUser: ApiUser = { uid: 'admin-1', role: 'admin' } as ApiUser

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: {
    collection: (name: string) => {
      if (name === 'video_editor_luts') {
        return {
          add: mockLutAdd,
          doc: () => ({ get: mockLutDocGet, set: mockLutDocSet }),
          where: () => ({ get: mockLutGet }),
        }
      }
      throw new Error(`Unexpected collection ${name}`)
    },
  },
  getAdminApp: () => ({}),
}))
jest.mock('firebase-admin/storage', () => ({
  getStorage: () => ({ bucket: () => ({ name: 'test-bucket', file: () => ({ save: mockSave }) }) }),
}))
jest.mock('@/lib/api/auth', () => ({
  withAuth: (_role: string, handler: (req: NextRequest, user: ApiUser, context?: unknown) => Promise<Response>) =>
    (req: NextRequest, context?: unknown) => handler(req, mockUser, context),
}))
jest.mock('@/lib/youtube-studio/api', () => ({
  ensureOrgAccess: jest.fn().mockResolvedValue(null),
  actorFields: () => ({ createdBy: 'admin-1', createdByType: 'user' }),
  updateActorFields: () => ({ updatedBy: 'admin-1', updatedByType: 'user' }),
}))
jest.mock('firebase-admin/firestore', () => ({ FieldValue: { serverTimestamp: () => 'SERVER_TS' } }))

const VALID_CUBE = 'TITLE "Test"\nLUT_3D_SIZE 2\n0 0 0\n1 0 0\n0 1 0\n1 1 0\n0 0 1\n1 0 1\n0 1 1\n1 1 1\n'

function uploadReq(content: string, filename = 'grade.cube') {
  const form = new FormData()
  form.set('orgId', 'org-1')
  form.set('title', 'Teal & Orange')
  form.set('file', new File([content], filename, { type: 'text/plain' }))
  return new NextRequest('http://localhost/api/v1/video-editor/luts', { method: 'POST', body: form })
}

describe('video-editor LUT library', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    jest.resetModules()
    mockLutAdd.mockResolvedValue({ id: 'lut-1' })
    mockSave.mockResolvedValue(undefined)
  })

  it('POST validates the .cube header and stores the LUT', async () => {
    const { POST } = await import('@/app/api/v1/video-editor/luts/route')
    const res = await POST(uploadReq(VALID_CUBE))
    const body = await res.json()
    expect(res.status).toBe(201)
    expect(body.data.lut).toMatchObject({ id: 'lut-1', title: 'Teal & Orange' })
    expect(body.data.lut.url).toContain('https://firebasestorage.googleapis.com/')
    expect(mockLutAdd.mock.calls[0][0]).toMatchObject({ orgId: 'org-1', title: 'Teal & Orange', deleted: false })
  })

  it('POST rejects files without a LUT_3D_SIZE header', async () => {
    const { POST } = await import('@/app/api/v1/video-editor/luts/route')
    const res = await POST(uploadReq('not a lut at all'))
    expect(res.status).toBe(400)
  })

  it('GET lists org LUTs', async () => {
    mockLutGet.mockResolvedValue({
      docs: [{ id: 'lut-1', data: () => ({ orgId: 'org-1', title: 'A', url: 'https://x/l.cube', deleted: false }) }],
    })
    const { GET } = await import('@/app/api/v1/video-editor/luts/route')
    const res = await GET(new NextRequest('http://localhost/api/v1/video-editor/luts?orgId=org-1'))
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.data.luts).toEqual([expect.objectContaining({ id: 'lut-1', title: 'A' })])
  })

  it('DELETE soft-deletes an org LUT and 404s on cross-org access', async () => {
    mockLutDocGet.mockResolvedValue({ exists: true, data: () => ({ orgId: 'org-1', deleted: false }) })
    const { DELETE } = await import('@/app/api/v1/video-editor/luts/[id]/route')
    const context = { params: Promise.resolve({ id: 'lut-1' }) }
    const res = await DELETE(new NextRequest('http://localhost/api/v1/video-editor/luts/lut-1?orgId=org-1', { method: 'DELETE' }), context)
    expect(res.status).toBe(200)
    expect(mockLutDocSet).toHaveBeenCalledWith(expect.objectContaining({ deleted: true }), { merge: true })

    mockLutDocGet.mockResolvedValue({ exists: true, data: () => ({ orgId: 'org-OTHER', deleted: false }) })
    const res2 = await DELETE(new NextRequest('http://localhost/api/v1/video-editor/luts/lut-1?orgId=org-1', { method: 'DELETE' }), context)
    expect(res2.status).toBe(404)
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npx jest __tests__/api/video-editor-luts.test.ts`
Expected: FAIL — routes missing

- [ ] **Step 3: Register the collection** — in `lib/video-editor/api.ts` extend the const:

```ts
export const VIDEO_EDITOR_COLLECTIONS = {
  projects: 'video_editor_projects',
  renderJobs: 'video_editor_render_jobs',
  luts: 'video_editor_luts',
  templates: 'video_editor_templates',
} as const
```

- [ ] **Step 4: Implement `app/api/v1/video-editor/luts/route.ts`**

```ts
import crypto from 'crypto'
import { FieldValue } from 'firebase-admin/firestore'
import { getStorage } from 'firebase-admin/storage'
import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { apiError, apiSuccess } from '@/lib/api/response'
import { adminDb, getAdminApp } from '@/lib/firebase/admin'
import { actorFields, ensureOrgAccess } from '@/lib/youtube-studio/api'
import { VIDEO_EDITOR_COLLECTIONS } from '@/lib/video-editor/api'

export const dynamic = 'force-dynamic'

const MAX_LUT_BYTES = 8 * 1024 * 1024

function isValidCube(text: string): boolean {
  const head = text.slice(0, 4000)
  return /^\s*LUT_3D_SIZE\s+\d+/m.test(head)
}

export const GET = withAuth('client', async (req: NextRequest, user) => {
  const orgId = new URL(req.url).searchParams.get('orgId')?.trim() ?? ''
  const denied = await ensureOrgAccess(user, orgId)
  if (denied) return denied
  const snapshot = await adminDb.collection(VIDEO_EDITOR_COLLECTIONS.luts).where('orgId', '==', orgId).get()
  const luts = snapshot.docs
    .map((doc) => ({ id: doc.id, ...(doc.data() as Record<string, unknown>) }))
    .filter((lut) => lut.deleted !== true)
    .sort((a, b) => String(a.title ?? '').localeCompare(String(b.title ?? '')))
  return apiSuccess({ luts })
})

export const POST = withAuth('client', async (req: NextRequest, user) => {
  const formData = await req.formData().catch(() => null)
  if (!formData) return apiError('Invalid form data', 400)
  const orgId = typeof formData.get('orgId') === 'string' ? String(formData.get('orgId')).trim() : ''
  const denied = await ensureOrgAccess(user, orgId)
  if (denied) return denied
  const file = formData.get('file') as File | null
  if (!file) return apiError('No file provided', 400)
  if (!/\.cube$/i.test(file.name)) return apiError('LUTs must be .cube files', 400)
  if (file.size > MAX_LUT_BYTES) return apiError('LUT file is too large (max 8MB)', 413)
  const buffer = Buffer.from(await file.arrayBuffer())
  if (!isValidCube(buffer.toString('utf8', 0, 4000))) return apiError('File is not a valid .cube LUT (missing LUT_3D_SIZE)', 400)

  const title = (typeof formData.get('title') === 'string' && String(formData.get('title')).trim()) || file.name.replace(/\.cube$/i, '')
  const storagePath = `video-editor/${orgId}/luts/${Date.now()}-${crypto.randomUUID()}.cube`
  const bucket = getStorage(getAdminApp()).bucket()
  const downloadToken = crypto.randomUUID()
  await bucket.file(storagePath).save(buffer, {
    metadata: { contentType: 'text/plain', metadata: { firebaseStorageDownloadTokens: downloadToken } },
  })
  const url = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(storagePath)}?alt=media&token=${downloadToken}`
  const ref = await adminDb.collection(VIDEO_EDITOR_COLLECTIONS.luts).add({
    orgId, title, url, storagePath, sizeBytes: buffer.length, deleted: false,
    ...actorFields(user),
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  })
  return apiSuccess({ lut: { id: ref.id, title, url, storagePath, sizeBytes: buffer.length } }, 201)
})
```

- [ ] **Step 5: Implement `app/api/v1/video-editor/luts/[id]/route.ts`**

```ts
import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { apiError, apiSuccess } from '@/lib/api/response'
import { adminDb } from '@/lib/firebase/admin'
import { ensureOrgAccess, updateActorFields } from '@/lib/youtube-studio/api'
import { VIDEO_EDITOR_COLLECTIONS } from '@/lib/video-editor/api'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ id: string }> }

export const DELETE = withAuth('client', async (req: NextRequest, user, context) => {
  const { id } = await (context as RouteContext).params
  const orgId = new URL(req.url).searchParams.get('orgId')?.trim() ?? ''
  const denied = await ensureOrgAccess(user, orgId)
  if (denied) return denied
  const ref = adminDb.collection(VIDEO_EDITOR_COLLECTIONS.luts).doc(id)
  const snap = await ref.get()
  const data = snap.exists ? (snap.data() as Record<string, unknown>) : undefined
  if (!data || data.deleted === true || data.orgId !== orgId) return apiError('LUT not found', 404)
  await ref.set({ deleted: true, ...updateActorFields(user) }, { merge: true })
  return apiSuccess({ id })
})
```

- [ ] **Step 6: Run tests**

Run: `npx jest __tests__/api/video-editor-luts.test.ts`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add app/api/v1/video-editor/luts lib/video-editor/api.ts __tests__/api/video-editor-luts.test.ts
git commit -m "feat(video-editor): org-scoped LUT library (upload/list/delete .cube files)"
```

---

### Task 12: Inspector — Effects section (add/remove/reorder + param controls)

`EffectsSection` renders from `EDITOR_EFFECT_DEFS`: an "Add effect" select, then one card per effect instance with controls per param type, ▲/▼ reorder, and ✕ remove. LUT effects list the org's LUT library in a dropdown that writes `lutUrl`. Also adds fade in/out and blend-mode controls to the Inspector.

**Files:**
- Create: `components/video-editor/EffectsSection.tsx`
- Modify: `components/video-editor/InspectorPanel.tsx` (add `orgId` prop, render EffectsSection, fades, blend mode), `components/video-editor/VideoEditorShell.tsx` (pass `orgId`)
- Test: `__tests__/components/video-editor-effects-section.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// __tests__/components/video-editor-effects-section.test.tsx
import { fireEvent, render, screen } from '@testing-library/react'
import { EffectsSection } from '@/components/video-editor/EffectsSection'
import type { EditorEffectInstance } from '@/lib/video-editor/types'

describe('EffectsSection', () => {
  const luts = [{ id: 'lut-1', title: 'Teal & Orange', url: 'https://x/l.cube' }]

  it('adds a default effect instance when a kind is chosen', () => {
    const onChange = jest.fn()
    render(<EffectsSection effects={[]} luts={luts} onChange={onChange} />)
    fireEvent.change(screen.getByLabelText('Add effect'), { target: { value: 'blur' } })
    expect(onChange).toHaveBeenCalledWith([{ kind: 'blur', params: { sigma: 5 } }])
  })

  it('renders param controls and patches values', () => {
    const onChange = jest.fn()
    const effects: EditorEffectInstance[] = [{ kind: 'blur', params: { sigma: 5 } }]
    render(<EffectsSection effects={effects} luts={luts} onChange={onChange} />)
    fireEvent.change(screen.getByLabelText('Amount'), { target: { value: '12' } })
    expect(onChange).toHaveBeenCalledWith([{ kind: 'blur', params: { sigma: 12 } }])
  })

  it('reorders and removes effects', () => {
    const onChange = jest.fn()
    const effects: EditorEffectInstance[] = [
      { kind: 'blur', params: { sigma: 5 } },
      { kind: 'grain', params: { strength: 12 } },
    ]
    render(<EffectsSection effects={effects} luts={luts} onChange={onChange} />)
    fireEvent.click(screen.getAllByLabelText('Move effect up')[1])
    expect(onChange).toHaveBeenCalledWith([
      { kind: 'grain', params: { strength: 12 } },
      { kind: 'blur', params: { sigma: 5 } },
    ])
    fireEvent.click(screen.getAllByLabelText('Remove effect')[0])
    expect(onChange).toHaveBeenCalledWith([{ kind: 'grain', params: { strength: 12 } }])
  })

  it('offers the LUT library for lut effects', () => {
    const onChange = jest.fn()
    render(<EffectsSection effects={[{ kind: 'lut', params: { lutUrl: '', intensity: 1 } }]} luts={luts} onChange={onChange} />)
    fireEvent.change(screen.getByLabelText('LUT file'), { target: { value: 'https://x/l.cube' } })
    expect(onChange).toHaveBeenCalledWith([{ kind: 'lut', params: { lutUrl: 'https://x/l.cube', intensity: 1 } }])
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npx jest __tests__/components/video-editor-effects-section.test.tsx`
Expected: FAIL — component missing

- [ ] **Step 3: Implement `components/video-editor/EffectsSection.tsx`**

```tsx
'use client'

import { EDITOR_EFFECT_DEFS, EDITOR_EFFECT_KINDS, defaultEffectInstance } from '@/lib/video-editor/effects'
import type { EditorEffectKind, EffectParamDef } from '@/lib/video-editor/effects'
import type { EditorEffectInstance } from '@/lib/video-editor/types'

export interface EffectsSectionLut { id: string; title: string; url: string }

function ParamControl({
  def, value, onChange, luts,
}: {
  def: EffectParamDef
  value: string | number | boolean
  onChange: (next: string | number | boolean) => void
  luts: EffectsSectionLut[]
}) {
  const inputClass = 'mt-1 w-full rounded-lg border border-[var(--color-pib-line)] bg-transparent px-2 py-1 text-sm'
  if (def.type === 'number') {
    return (
      <label className="block text-xs text-on-surface-variant">
        {def.label}
        <input aria-label={def.label} className="mt-1 w-full" type="range" min={def.min} max={def.max} step={def.step}
          value={typeof value === 'number' ? value : def.default}
          onChange={(event) => onChange(Number(event.target.value))} />
        <span className="text-[10px]">{String(value)}</span>
      </label>
    )
  }
  if (def.type === 'color') {
    return (
      <label className="block text-xs text-on-surface-variant">
        {def.label}
        <input aria-label={def.label} className={inputClass} type="color"
          value={typeof value === 'string' ? value : def.default}
          onChange={(event) => onChange(event.target.value)} />
      </label>
    )
  }
  if (def.type === 'select') {
    return (
      <label className="block text-xs text-on-surface-variant">
        {def.label}
        <select aria-label={def.label} className={inputClass} value={String(value ?? def.default)}
          onChange={(event) => onChange(event.target.value)}>
          {def.options.map((option) => <option key={option} value={option}>{option}</option>)}
        </select>
      </label>
    )
  }
  if (def.type === 'boolean') {
    return (
      <label className="flex items-center gap-2 text-xs text-on-surface-variant">
        <input aria-label={def.label} type="checkbox" checked={value === true}
          onChange={(event) => onChange(event.target.checked)} />
        {def.label}
      </label>
    )
  }
  // asset — LUT library picker
  return (
    <label className="block text-xs text-on-surface-variant">
      {def.label}
      <select aria-label={def.label} className={inputClass} value={String(value ?? '')}
        onChange={(event) => onChange(event.target.value)}>
        <option value="">Choose a LUT…</option>
        {luts.map((lut) => <option key={lut.id} value={lut.url}>{lut.title}</option>)}
      </select>
    </label>
  )
}

export function EffectsSection({
  effects, luts, onChange,
}: {
  effects: EditorEffectInstance[]
  luts: EffectsSectionLut[]
  onChange: (next: EditorEffectInstance[]) => void
}) {
  function patchEffect(index: number, key: string, value: string | number | boolean) {
    onChange(effects.map((effect, i) => i === index ? { ...effect, params: { ...effect.params, [key]: value } } : effect))
  }
  function move(index: number, delta: number) {
    const target = index + delta
    if (target < 0 || target >= effects.length) return
    const next = [...effects]
    const [item] = next.splice(index, 1)
    next.splice(target, 0, item)
    onChange(next)
  }
  return (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold text-on-surface">Effects</h3>
      <label className="block text-xs text-on-surface-variant">
        Add effect
        <select aria-label="Add effect" className="mt-1 w-full rounded-lg border border-[var(--color-pib-line)] bg-transparent px-2 py-1 text-sm"
          value="" onChange={(event) => {
            const kind = event.target.value as EditorEffectKind
            if (kind) onChange([...effects, defaultEffectInstance(kind)])
          }}>
          <option value="">Choose an effect…</option>
          {EDITOR_EFFECT_KINDS.map((kind) => <option key={kind} value={kind}>{EDITOR_EFFECT_DEFS[kind].label}</option>)}
        </select>
      </label>
      {effects.map((effect, index) => {
        const def = EDITOR_EFFECT_DEFS[effect.kind as EditorEffectKind]
        if (!def) return null
        return (
          <div key={`${effect.kind}-${index}`} className="rounded-lg border border-[var(--color-pib-line)] p-2">
            <div className="flex items-center justify-between gap-1">
              <span className="text-xs font-medium text-on-surface">{def.label}</span>
              <span className="flex gap-1">
                <button type="button" aria-label="Move effect up" className="pib-btn-ghost px-1 text-xs" onClick={() => move(index, -1)}>▲</button>
                <button type="button" aria-label="Move effect down" className="pib-btn-ghost px-1 text-xs" onClick={() => move(index, 1)}>▼</button>
                <button type="button" aria-label="Remove effect" className="pib-btn-ghost px-1 text-xs" onClick={() => onChange(effects.filter((_, i) => i !== index))}>✕</button>
              </span>
            </div>
            <div className="mt-1 space-y-1">
              {def.params.map((paramDef) => (
                <ParamControl key={paramDef.key} def={paramDef} luts={luts}
                  value={effect.params[paramDef.key] ?? paramDef.default}
                  onChange={(value) => patchEffect(index, paramDef.key, value)} />
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}
```

- [ ] **Step 4: Wire into `InspectorPanel.tsx`**

Change the props to `{ clip, orgId, onPatch }` (add `orgId?: string`). Inside the component, load LUTs once:

```tsx
import { useEffect, useState } from 'react'
import { scopedApiPath } from '@/lib/portal/scoped-routing'
import { EDITOR_BLEND_MODES } from '@/lib/video-editor/types'
import { EffectsSection, type EffectsSectionLut } from './EffectsSection'

// inside the component, before the null-clip early return:
const [luts, setLuts] = useState<EffectsSectionLut[]>([])
useEffect(() => {
  if (!orgId) return
  void fetch(scopedApiPath('/api/v1/video-editor/luts', { orgId }))
    .then((res) => res.json())
    .then((body) => setLuts((body.data?.luts ?? []) as EffectsSectionLut[]))
    .catch(() => setLuts([]))
}, [orgId])
```

(NOTE: hooks must run unconditionally — move the `if (!clip) return …` early-return **below** the hook calls.)

After the Speed slider, render:

```tsx
      <label className="block text-sm text-on-surface-variant">
        Fade in (s)
        <input className="mt-1 w-full" type="range" min={0} max={5} step={0.1} value={clip.fadeInSeconds ?? 0}
          onChange={(event) => onPatch({ fadeInSeconds: Number(event.target.value) || undefined })} />
      </label>
      <label className="block text-sm text-on-surface-variant">
        Fade out (s)
        <input className="mt-1 w-full" type="range" min={0} max={5} step={0.1} value={clip.fadeOutSeconds ?? 0}
          onChange={(event) => onPatch({ fadeOutSeconds: Number(event.target.value) || undefined })} />
      </label>
      <label className="block text-sm text-on-surface-variant">
        Blend mode
        <select className="mt-1 w-full rounded-lg border border-[var(--color-pib-line)] bg-transparent px-3 py-2"
          value={clip.blendMode ?? 'normal'}
          onChange={(event) => onPatch({ blendMode: event.target.value === 'normal' ? undefined : (event.target.value as typeof EDITOR_BLEND_MODES[number]) })}>
          {EDITOR_BLEND_MODES.map((mode) => <option key={mode} value={mode}>{mode}</option>)}
        </select>
      </label>
      <EffectsSection effects={clip.effects ?? []} luts={luts}
        onChange={(effects) => onPatch({ effects: effects.length ? effects : undefined })} />
```

In `VideoEditorShell.tsx` change the call site to `<InspectorPanel clip={selectedClip} orgId={orgId} onPatch={patchSelected} />`.

- [ ] **Step 5: Run tests**

Run: `npx jest __tests__/components/video-editor-effects-section.test.tsx`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add components/video-editor/EffectsSection.tsx components/video-editor/InspectorPanel.tsx components/video-editor/VideoEditorShell.tsx __tests__/components/video-editor-effects-section.test.tsx
git commit -m "feat(video-editor): Inspector effects stack UI with param controls, fades, blend mode"
```

---

### Task 13: Audio mixer panel

Per-track strip: gain fader (-60..+12 dB), pan (-1..1), mute / solo / duck-under-voice toggles, audio role select. Rendered under the timeline for audio+video tracks.

**Files:**
- Create: `components/video-editor/AudioMixerPanel.tsx`
- Modify: `components/video-editor/VideoEditorShell.tsx`
- Test: `__tests__/components/video-editor-audio-mixer.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// __tests__/components/video-editor-audio-mixer.test.tsx
import { fireEvent, render, screen } from '@testing-library/react'
import { AudioMixerPanel } from '@/components/video-editor/AudioMixerPanel'
import type { EditorTimeline } from '@/lib/video-editor/types'

const timeline: EditorTimeline = {
  version: 1,
  tracks: [
    { id: 't-v', kind: 'video', label: 'Video 1', clips: [] },
    { id: 't-m', kind: 'audio', label: 'Music', audioRole: 'music', gainDb: -6, clips: [] },
    { id: 't-t', kind: 'text', label: 'Text', clips: [] },
  ],
}

describe('AudioMixerPanel', () => {
  it('renders strips for audio and video tracks only', () => {
    render(<AudioMixerPanel timeline={timeline} onPatchTrack={jest.fn()} />)
    expect(screen.getByText('Video 1')).toBeInTheDocument()
    expect(screen.getByText('Music')).toBeInTheDocument()
    expect(screen.queryByText('Text')).not.toBeInTheDocument()
  })

  it('patches gain, pan, solo, duck and role', () => {
    const onPatchTrack = jest.fn()
    render(<AudioMixerPanel timeline={timeline} onPatchTrack={onPatchTrack} />)
    fireEvent.change(screen.getAllByLabelText('Gain (dB)')[1], { target: { value: '-12' } })
    expect(onPatchTrack).toHaveBeenCalledWith('t-m', { gainDb: -12 })
    fireEvent.change(screen.getAllByLabelText('Pan')[1], { target: { value: '0.4' } })
    expect(onPatchTrack).toHaveBeenCalledWith('t-m', { pan: 0.4 })
    fireEvent.click(screen.getAllByLabelText('Solo')[1])
    expect(onPatchTrack).toHaveBeenCalledWith('t-m', { solo: true })
    fireEvent.click(screen.getAllByLabelText('Duck under voice')[1])
    expect(onPatchTrack).toHaveBeenCalledWith('t-m', { duckUnderVoice: true })
    fireEvent.change(screen.getAllByLabelText('Role')[1], { target: { value: 'voice' } })
    expect(onPatchTrack).toHaveBeenCalledWith('t-m', { audioRole: 'voice' })
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npx jest __tests__/components/video-editor-audio-mixer.test.tsx`
Expected: FAIL

- [ ] **Step 3: Implement `components/video-editor/AudioMixerPanel.tsx`**

```tsx
'use client'

import { EDITOR_AUDIO_ROLES } from '@/lib/video-editor/types'
import type { EditorTimeline, EditorTrack } from '@/lib/video-editor/types'

export function AudioMixerPanel({
  timeline, onPatchTrack,
}: {
  timeline: EditorTimeline
  onPatchTrack: (trackId: string, patch: Partial<EditorTrack>) => void
}) {
  const tracks = timeline.tracks.filter((track) => track.kind === 'audio' || track.kind === 'video')
  if (!tracks.length) return null
  return (
    <section className="pib-card-section p-4">
      <h2 className="font-headline text-lg font-semibold text-on-surface">Mixer</h2>
      <div className="mt-2 flex gap-4 overflow-x-auto">
        {tracks.map((track) => (
          <div key={track.id} className="w-40 shrink-0 rounded-lg border border-[var(--color-pib-line)] p-3">
            <p className="truncate text-sm font-medium text-on-surface">{track.label ?? track.id}</p>
            <label className="mt-2 block text-xs text-on-surface-variant">
              Gain (dB)
              <input aria-label="Gain (dB)" className="mt-1 w-full" type="range" min={-60} max={12} step={1}
                value={track.gainDb ?? 0}
                onChange={(event) => onPatchTrack(track.id, { gainDb: Number(event.target.value) || undefined })} />
              <span className="text-[10px]">{track.gainDb ?? 0} dB</span>
            </label>
            <label className="mt-1 block text-xs text-on-surface-variant">
              Pan
              <input aria-label="Pan" className="mt-1 w-full" type="range" min={-1} max={1} step={0.05}
                value={track.pan ?? 0}
                onChange={(event) => onPatchTrack(track.id, { pan: Number(event.target.value) || undefined })} />
            </label>
            <div className="mt-2 flex flex-wrap gap-2 text-xs text-on-surface-variant">
              <label className="flex items-center gap-1">
                <input aria-label="Mute" type="checkbox" checked={track.muted === true}
                  onChange={(event) => onPatchTrack(track.id, { muted: event.target.checked || undefined })} />
                Mute
              </label>
              <label className="flex items-center gap-1">
                <input aria-label="Solo" type="checkbox" checked={track.solo === true}
                  onChange={(event) => onPatchTrack(track.id, { solo: event.target.checked || undefined })} />
                Solo
              </label>
              <label className="flex items-center gap-1">
                <input aria-label="Duck under voice" type="checkbox" checked={track.duckUnderVoice === true}
                  onChange={(event) => onPatchTrack(track.id, { duckUnderVoice: event.target.checked || undefined })} />
                Duck
              </label>
            </div>
            <label className="mt-2 block text-xs text-on-surface-variant">
              Role
              <select aria-label="Role" className="mt-1 w-full rounded-lg border border-[var(--color-pib-line)] bg-transparent px-2 py-1 text-xs"
                value={track.audioRole ?? ''}
                onChange={(event) => onPatchTrack(track.id, { audioRole: (event.target.value || undefined) as EditorTrack['audioRole'] })}>
                <option value="">none</option>
                {EDITOR_AUDIO_ROLES.map((role) => <option key={role} value={role}>{role}</option>)}
              </select>
            </label>
          </div>
        ))}
      </div>
    </section>
  )
}
```

- [ ] **Step 4: Wire into the Shell** — in `VideoEditorShell.tsx` add a track patcher and render the panel under `TimelinePanel`:

```tsx
  function patchTrack(trackId: string, patch: Partial<EditorTrack>) {
    void persist({
      ...timeline,
      tracks: timeline.tracks.map((track) => track.id === trackId ? { ...track, ...patch } : track),
    })
  }
```

(import `EditorTrack` from the types module) and after `<TimelinePanel …/>`:

```tsx
          <AudioMixerPanel timeline={timeline} onPatchTrack={patchTrack} />
```

- [ ] **Step 5: Run tests**

Run: `npx jest __tests__/components/video-editor-audio-mixer.test.tsx`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add components/video-editor/AudioMixerPanel.tsx components/video-editor/VideoEditorShell.tsx __tests__/components/video-editor-audio-mixer.test.tsx
git commit -m "feat(video-editor): per-track audio mixer panel (gain, pan, mute/solo, ducking, roles)"
```

---

### Task 14: Snap-to-beat mode in the Shell + preview CSS filter approximation

Two smaller client pieces bundled: (a) a "Snap to beat" toggle — when on, `moveClip` positions snap through `snapToBeats` using the beat markers of upload-backed clips (fetched lazily per upload id); (b) `preview-filters.ts` maps the selected clip's effect stack to a CSS `filter` string applied to the preview canvas.

**Files:**
- Create: `lib/video-editor/preview-filters.ts`
- Modify: `components/video-editor/VideoEditorShell.tsx`, `components/video-editor/PreviewPlayer.tsx`
- Test: `__tests__/lib/video-editor-preview-filters.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// __tests__/lib/video-editor-preview-filters.test.ts
import { effectsToCssFilter } from '@/lib/video-editor/preview-filters'

describe('effectsToCssFilter', () => {
  it('maps color_adjust and blur to CSS filter functions', () => {
    expect(effectsToCssFilter([
      { kind: 'color_adjust', params: { brightness: 0.2, contrast: 1.1, saturation: 0.9, temperature: 6500, hue: 30 } },
      { kind: 'blur', params: { sigma: 4 } },
    ])).toBe('brightness(1.2) contrast(1.1) saturate(0.9) hue-rotate(30deg) blur(4px)')
  })

  it('skips non-CSS-approximable effects and returns empty for none', () => {
    expect(effectsToCssFilter([{ kind: 'chroma_key', params: { color: '#00ff00', similarity: 0.25, blend: 0.1 } }])).toBe('')
    expect(effectsToCssFilter(undefined)).toBe('')
  })

  it('skips no-op params', () => {
    expect(effectsToCssFilter([
      { kind: 'color_adjust', params: { brightness: 0, contrast: 1, saturation: 1, temperature: 6500, hue: 0 } },
    ])).toBe('')
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npx jest __tests__/lib/video-editor-preview-filters.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement `lib/video-editor/preview-filters.ts`**

```ts
import type { EditorEffectInstance } from './types'

function num(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

/** Approximate the server-side effect stack with CSS filter functions. */
export function effectsToCssFilter(effects?: EditorEffectInstance[]): string {
  const parts: string[] = []
  for (const effect of effects ?? []) {
    const p = effect.params ?? {}
    if (effect.kind === 'color_adjust') {
      const brightness = num(p.brightness, 0)
      const contrast = num(p.contrast, 1)
      const saturation = num(p.saturation, 1)
      const hue = num(p.hue, 0)
      if (brightness !== 0) parts.push(`brightness(${Math.round((1 + brightness) * 100) / 100})`)
      if (contrast !== 1) parts.push(`contrast(${contrast})`)
      if (saturation !== 1) parts.push(`saturate(${saturation})`)
      if (hue !== 0) parts.push(`hue-rotate(${hue}deg)`)
    } else if (effect.kind === 'blur') {
      const sigma = num(p.sigma, 5)
      if (sigma > 0) parts.push(`blur(${sigma}px)`)
    } else if (effect.kind === 'grain') {
      const strength = num(p.strength, 12)
      if (strength > 0) parts.push(`contrast(${Math.round((1 + strength / 200) * 100) / 100})`)
    }
    // sharpen/vignette/glow/lut/mask/chroma_key/stabilize: no faithful CSS analog — server render only.
  }
  return parts.join(' ')
}
```

- [ ] **Step 4: Wire preview + snap toggle**

`PreviewPlayer.tsx`: add an optional `previewFilter?: string` prop and apply it to the inner canvas div:

```tsx
        <div className="absolute inset-0 grid place-items-center text-center text-sm text-white/70" style={previewFilter ? { filter: previewFilter } : undefined}>
```

`VideoEditorShell.tsx`:
- state: `const [snapBeats, setSnapBeats] = useState(false)` and `const [beatsByUpload, setBeatsByUpload] = useState<Record<string, number[]>>({})`
- imports: `snapToBeats` from `@/lib/video-editor/timeline-ops`, `effectsToCssFilter` from `@/lib/video-editor/preview-filters`
- lazy beat fetch when snapping turns on:

```tsx
  useEffect(() => {
    if (!snapBeats || !orgId) return
    const uploadIds = new Set<string>()
    for (const track of timeline.tracks) for (const clip of track.clips) {
      if (clip.media?.type === 'upload') uploadIds.add(clip.media.fileId)
    }
    for (const uploadId of uploadIds) {
      if (beatsByUpload[uploadId]) continue
      void fetch(scopedApiPath(`/api/v1/video-editor/media/${uploadId}/beats`, apiScope))
        .then((res) => res.json())
        .then((body) => setBeatsByUpload((current) => ({ ...current, [uploadId]: (body.data?.beats ?? []) as number[] })))
        .catch(() => undefined)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snapBeats, timeline, orgId])
```

- in the `onMoveClip` handler, before calling `moveClip`:

```tsx
              const allBeats = snapBeats ? Object.values(beatsByUpload).flat() : []
              const snapped = allBeats.length ? snapToBeats(toStart, allBeats) : toStart
```

then pass `{ toStart: snapped }`.
- toolbar toggle next to Undo/Redo:

```tsx
          <button type="button" className={snapBeats ? 'pib-btn-primary text-sm' : 'pib-btn-ghost text-sm'} onClick={() => setSnapBeats((value) => !value)}>Snap to beat</button>
```

- preview filter: `<PreviewPlayer … previewFilter={effectsToCssFilter(selectedClip?.effects)} />`.

- [ ] **Step 5: Run tests + typecheck**

Run: `npx jest __tests__/lib/video-editor-preview-filters.test.ts && npm run typecheck`
Expected: PASS / no type errors

- [ ] **Step 6: Commit**

```bash
git add lib/video-editor/preview-filters.ts components/video-editor/PreviewPlayer.tsx components/video-editor/VideoEditorShell.tsx __tests__/lib/video-editor-preview-filters.test.ts
git commit -m "feat(video-editor): snap-to-beat mode + CSS-filter preview approximation"
```

---

### Task 15: PiP layout presets

Pure transform math + Inspector buttons. Presets take the project settings and the selected clips (1 for corner PiP, 2 for side-by-side / top-bottom) and return per-clip transform patches. Positions are canvas-pixel offsets from center (matching `overlayPosition`'s `(W-w)/2+x` semantics), scale assumes the media is roughly canvas-sized (the P1 convention).

**Files:**
- Create: `lib/video-editor/layout-presets.ts`
- Modify: `components/video-editor/InspectorPanel.tsx` (preset buttons), `components/video-editor/VideoEditorShell.tsx` (multi-clip patch helper)
- Test: `__tests__/lib/video-editor-layout-presets.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// __tests__/lib/video-editor-layout-presets.test.ts
import { applyLayoutPreset, LAYOUT_PRESETS } from '@/lib/video-editor/layout-presets'

const settings = { width: 1920, height: 1080, fps: 30 as const, aspect: '16:9' as const, background: '#000000' }

describe('layout presets', () => {
  it('exposes the locked presets', () => {
    expect(LAYOUT_PRESETS.map((preset) => preset.id)).toEqual([
      'pip_top_left', 'pip_top_right', 'pip_bottom_left', 'pip_bottom_right', 'side_by_side', 'top_bottom',
    ])
  })

  it('corner PiP scales the single clip to 0.3 and pins it with a 48px margin', () => {
    const patches = applyLayoutPreset('pip_bottom_right', settings, ['c1'])
    expect(patches).toEqual([{
      clipId: 'c1',
      transform: { x: (1920 - 1920 * 0.3) / 2 - 48, y: (1080 - 1080 * 0.3) / 2 - 48, scale: 0.3, rotation: 0, opacity: 1 },
    }])
  })

  it('side-by-side splits two clips at half scale', () => {
    const patches = applyLayoutPreset('side_by_side', settings, ['c1', 'c2'])
    expect(patches).toEqual([
      { clipId: 'c1', transform: { x: -480, y: 0, scale: 0.5, rotation: 0, opacity: 1 } },
      { clipId: 'c2', transform: { x: 480, y: 0, scale: 0.5, rotation: 0, opacity: 1 } },
    ])
  })

  it('top-bottom stacks two clips', () => {
    const patches = applyLayoutPreset('top_bottom', settings, ['c1', 'c2'])
    expect(patches).toEqual([
      { clipId: 'c1', transform: { x: 0, y: -270, scale: 0.5, rotation: 0, opacity: 1 } },
      { clipId: 'c2', transform: { x: 0, y: 270, scale: 0.5, rotation: 0, opacity: 1 } },
    ])
  })

  it('returns [] when the clip count does not match the preset', () => {
    expect(applyLayoutPreset('side_by_side', settings, ['c1'])).toEqual([])
    expect(applyLayoutPreset('pip_top_left', settings, ['c1', 'c2'])).toEqual([])
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npx jest __tests__/lib/video-editor-layout-presets.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement `lib/video-editor/layout-presets.ts`**

```ts
import type { EditorClipTransform, VideoEditorProjectSettings } from './types'

const PIP_SCALE = 0.3
const PIP_MARGIN = 48

export interface LayoutPreset { id: string; label: string; clipCount: 1 | 2 }

export const LAYOUT_PRESETS: LayoutPreset[] = [
  { id: 'pip_top_left', label: 'PiP top-left', clipCount: 1 },
  { id: 'pip_top_right', label: 'PiP top-right', clipCount: 1 },
  { id: 'pip_bottom_left', label: 'PiP bottom-left', clipCount: 1 },
  { id: 'pip_bottom_right', label: 'PiP bottom-right', clipCount: 1 },
  { id: 'side_by_side', label: 'Side by side', clipCount: 2 },
  { id: 'top_bottom', label: 'Top / bottom', clipCount: 2 },
]

export interface LayoutPatch { clipId: string; transform: EditorClipTransform }

export function applyLayoutPreset(
  presetId: string,
  settings: VideoEditorProjectSettings,
  clipIds: string[],
): LayoutPatch[] {
  const preset = LAYOUT_PRESETS.find((entry) => entry.id === presetId)
  if (!preset || clipIds.length !== preset.clipCount) return []
  const t = (x: number, y: number, scale: number): EditorClipTransform => ({ x, y, scale, rotation: 0, opacity: 1 })
  const edgeX = (settings.width - settings.width * PIP_SCALE) / 2 - PIP_MARGIN
  const edgeY = (settings.height - settings.height * PIP_SCALE) / 2 - PIP_MARGIN
  if (presetId === 'pip_top_left') return [{ clipId: clipIds[0], transform: t(-edgeX, -edgeY, PIP_SCALE) }]
  if (presetId === 'pip_top_right') return [{ clipId: clipIds[0], transform: t(edgeX, -edgeY, PIP_SCALE) }]
  if (presetId === 'pip_bottom_left') return [{ clipId: clipIds[0], transform: t(-edgeX, edgeY, PIP_SCALE) }]
  if (presetId === 'pip_bottom_right') return [{ clipId: clipIds[0], transform: t(edgeX, edgeY, PIP_SCALE) }]
  if (presetId === 'side_by_side') {
    return [
      { clipId: clipIds[0], transform: t(-settings.width / 4, 0, 0.5) },
      { clipId: clipIds[1], transform: t(settings.width / 4, 0, 0.5) },
    ]
  }
  // top_bottom
  return [
    { clipId: clipIds[0], transform: t(0, -settings.height / 4, 0.5) },
    { clipId: clipIds[1], transform: t(0, settings.height / 4, 0.5) },
  ]
}
```

- [ ] **Step 4: Wire the Inspector** — in `InspectorPanel.tsx`, add props `settings: VideoEditorProjectSettings` and `selectedClipIds: string[]` plus `onApplyLayout: (patches: LayoutPatch[]) => void`, and render before the Effects section:

```tsx
      <div>
        <h3 className="text-sm font-semibold text-on-surface">Layout presets</h3>
        <div className="mt-1 flex flex-wrap gap-1">
          {LAYOUT_PRESETS.map((preset) => (
            <button key={preset.id} type="button" className="pib-btn-ghost text-xs"
              disabled={selectedClipIds.length !== preset.clipCount}
              title={preset.clipCount === 2 ? 'Select two clips on one track' : 'Applies to the selected clip'}
              onClick={() => onApplyLayout(applyLayoutPreset(preset.id, settings, selectedClipIds))}>
              {preset.label}
            </button>
          ))}
        </div>
      </div>
```

In `VideoEditorShell.tsx`, pass `settings={settings}` and `selectedClipIds={selection?.clipIds ?? []}` and:

```tsx
  function applyLayoutPatches(patches: LayoutPatch[]) {
    if (!selection || !patches.length) return
    const byId = new Map(patches.map((patch) => [patch.clipId, patch.transform]))
    void persist({
      ...timeline,
      tracks: timeline.tracks.map((track) => track.id === selection.trackId
        ? { ...track, clips: track.clips.map((clip) => byId.has(clip.id) ? { ...clip, transform: byId.get(clip.id)! } : clip) }
        : track),
    })
  }
```

(`TimelineSelection.clipIds` is already an array — multi-select of two clips on a track is supported by the existing selection type.)

- [ ] **Step 5: Run tests + typecheck**

Run: `npx jest __tests__/lib/video-editor-layout-presets.test.ts && npm run typecheck`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add lib/video-editor/layout-presets.ts components/video-editor/InspectorPanel.tsx components/video-editor/VideoEditorShell.tsx __tests__/lib/video-editor-layout-presets.test.ts
git commit -m "feat(video-editor): one-click PiP / side-by-side / top-bottom layout presets"
```

---

### Task 16: Auto-reframe 16:9 → 9:16

Pure math in `lib/video-editor/reframe.ts` + `POST /api/v1/video-editor/projects/[id]/reframe` which duplicates the project as a 1080×1920 variant. Subject tracking: if a clip's `uploads` doc carries a `focusTrack` (`Array<{ atSeconds: number; x: number }>`, `x` normalized 0..1, written by a provider/agent analysis), it becomes `transform.x` keyframes; otherwise the clip gets a deterministic center crop. (The keyframe schema already supports `transform.x` — this is the provider-backed hook without faking a CV provider.)

**Files:**
- Create: `lib/video-editor/reframe.ts`, `app/api/v1/video-editor/projects/[id]/reframe/route.ts`
- Test: `__tests__/lib/video-editor-reframe.test.ts`, `__tests__/api/video-editor-reframe.test.ts`

- [ ] **Step 1: Write the failing lib test**

```ts
// __tests__/lib/video-editor-reframe.test.ts
import { reframeTimelineTo916, REFRAME_TARGET } from '@/lib/video-editor/reframe'
import type { EditorTimeline } from '@/lib/video-editor/types'

const src = { width: 1920, height: 1080, fps: 30 as const, aspect: '16:9' as const, background: '#000000' }

const timeline: EditorTimeline = {
  version: 1,
  tracks: [{
    id: 't1', kind: 'video',
    clips: [{
      id: 'c1', timelineStart: 0, duration: 4,
      media: { type: 'upload', fileId: 'f1', url: 'https://x.test/a.mp4', mediaKind: 'video' },
      transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 },
    }],
  }],
}

describe('reframeTimelineTo916', () => {
  it('produces 1080x1920 settings', () => {
    expect(REFRAME_TARGET).toEqual({ width: 1080, height: 1920, aspect: '9:16' })
  })

  it('center-crops: scale is multiplied by dstHeight/srcHeight, x reset to 0', () => {
    const result = reframeTimelineTo916(timeline, src, {})
    const clip = result.tracks[0].clips[0]
    // 1920/1080 = 1.778
    expect(clip.transform?.scale).toBeCloseTo(1920 / 1080, 3)
    expect(clip.transform?.x).toBe(0)
    expect(clip.keyframes).toBeUndefined()
  })

  it('converts a focus track into clamped transform.x keyframes', () => {
    const result = reframeTimelineTo916(timeline, src, { f1: [{ atSeconds: 0, x: 0.5 }, { atSeconds: 2, x: 1 }] })
    const clip = result.tracks[0].clips[0]
    const scale = 1920 / 1080
    const maxOffset = (1920 * scale - 1080) / 2
    expect(clip.keyframes).toEqual([
      { property: 'transform.x', atSeconds: 0, value: -0, easing: 'ease_in_out' },
      { property: 'transform.x', atSeconds: 2, value: -maxOffset, easing: 'ease_in_out' },
    ])
  })

  it('leaves text and audio clips untouched', () => {
    const withText: EditorTimeline = {
      version: 1,
      tracks: [{ id: 't-text', kind: 'text', clips: [{ id: 'c-t', timelineStart: 0, duration: 3, text: { content: 'Hi', fontSizePx: 48, color: '#fff', align: 'center', animationPreset: 'none' } }] }],
    }
    const result = reframeTimelineTo916(withText, src, {})
    expect(result.tracks[0].clips[0]).toEqual(withText.tracks[0].clips[0])
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npx jest __tests__/lib/video-editor-reframe.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement `lib/video-editor/reframe.ts`**

```ts
import type { EditorKeyframe, EditorTimeline, VideoEditorProjectSettings } from './types'

export const REFRAME_TARGET = { width: 1080, height: 1920, aspect: '9:16' as const }

export interface FocusSample { atSeconds: number; x: number }

export function reframeSettingsTo916(src: VideoEditorProjectSettings): VideoEditorProjectSettings {
  return { ...src, width: REFRAME_TARGET.width, height: REFRAME_TARGET.height, aspect: REFRAME_TARGET.aspect }
}

/**
 * Map a 16:9 timeline onto a 9:16 canvas. Visual clips scale up by
 * dstHeight/srcHeight (cover) and get either a static center crop (x=0) or
 * subject-tracked transform.x keyframes derived from the media's focusTrack.
 * focus x is normalized 0..1 across the source width; offset is clamped so the
 * frame never reveals the canvas edge.
 */
export function reframeTimelineTo916(
  timeline: EditorTimeline,
  src: VideoEditorProjectSettings,
  focusByFileId: Record<string, FocusSample[]>,
): EditorTimeline {
  const scaleFactor = REFRAME_TARGET.height / src.height
  return {
    version: 1,
    tracks: timeline.tracks.map((track) => ({
      ...track,
      clips: track.clips.map((clip) => {
        if (!clip.media || clip.media.mediaKind === 'audio') return clip
        const baseScale = clip.transform?.scale ?? 1
        const scale = Math.round(baseScale * scaleFactor * 1000) / 1000
        const maxOffset = Math.max(0, (src.width * scale - REFRAME_TARGET.width) / 2)
        const focus = clip.media.type === 'upload' ? focusByFileId[clip.media.fileId] : undefined
        const keyframes: EditorKeyframe[] | undefined = focus?.length
          ? focus.map((sample) => ({
              property: 'transform.x' as const,
              atSeconds: Math.max(0, sample.atSeconds),
              value: Math.min(maxOffset, Math.max(-maxOffset, -(Math.min(1, Math.max(0, sample.x)) - 0.5) * src.width * scale)),
              easing: 'ease_in_out' as const,
            }))
          : undefined
        return {
          ...clip,
          transform: { x: 0, y: clip.transform?.y ?? 0, scale, rotation: clip.transform?.rotation ?? 0, opacity: clip.transform?.opacity ?? 1 },
          ...(keyframes ? { keyframes } : {}),
        }
      }),
    })),
  }
}
```

- [ ] **Step 4: Write the failing route test**

```ts
// __tests__/api/video-editor-reframe.test.ts
import { NextRequest } from 'next/server'
import type { ApiUser } from '@/lib/api/types'

const mockProjectAdd = jest.fn()
const mockUploadGet = jest.fn()
const mockLoadScoped = jest.fn()

let mockUser: ApiUser = { uid: 'admin-1', role: 'admin' } as ApiUser

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: {
    collection: (name: string) => {
      if (name === 'video_editor_projects') return { add: mockProjectAdd }
      if (name === 'uploads') return { doc: () => ({ get: mockUploadGet }) }
      throw new Error(`Unexpected collection ${name}`)
    },
  },
}))
jest.mock('@/lib/api/auth', () => ({
  withAuth: (_role: string, handler: (req: NextRequest, user: ApiUser, context?: unknown) => Promise<Response>) =>
    (req: NextRequest, context?: unknown) => handler(req, mockUser, context),
}))
jest.mock('@/lib/youtube-studio/api', () => ({
  ensureOrgAccess: jest.fn().mockResolvedValue(null),
  loadScopedRecord: (...args: unknown[]) => mockLoadScoped(...args),
  actorFields: () => ({ createdBy: 'admin-1', createdByType: 'user' }),
}))
jest.mock('firebase-admin/firestore', () => ({ FieldValue: { serverTimestamp: () => 'SERVER_TS' } }))

const timeline = {
  version: 1,
  tracks: [{
    id: 't1', kind: 'video',
    clips: [{
      id: 'c1', timelineStart: 0, duration: 4,
      media: { type: 'upload', fileId: 'f1', url: 'https://firebasestorage.googleapis.com/a.mp4', mediaKind: 'video' },
    }],
  }],
}

describe('POST /api/v1/video-editor/projects/[id]/reframe', () => {
  const context = { params: Promise.resolve({ id: 'proj-1' }) }

  beforeEach(() => {
    jest.clearAllMocks()
    jest.resetModules()
    mockLoadScoped.mockResolvedValue({
      id: 'proj-1',
      ref: {},
      data: {
        orgId: 'org-1', title: 'My video', deleted: false, timeline,
        settings: { width: 1920, height: 1080, fps: 30, aspect: '16:9', background: '#000000' },
      },
    })
    mockUploadGet.mockResolvedValue({ exists: true, data: () => ({ orgId: 'org-1', focusTrack: [{ atSeconds: 0, x: 0.5 }] }) })
    mockProjectAdd.mockResolvedValue({ id: 'proj-916' })
  })

  it('creates a 9:16 variant project with reframed timeline', async () => {
    const { POST } = await import('@/app/api/v1/video-editor/projects/[id]/reframe/route')
    const res = await POST(new NextRequest('http://localhost/api/v1/video-editor/projects/proj-1/reframe', { method: 'POST' }), context)
    const body = await res.json()
    expect(res.status).toBe(201)
    expect(body.data.id).toBe('proj-916')
    const payload = mockProjectAdd.mock.calls[0][0]
    expect(payload.title).toBe('My video (9:16)')
    expect(payload.settings).toMatchObject({ width: 1080, height: 1920, aspect: '9:16' })
    expect(payload.timeline.tracks[0].clips[0].transform.scale).toBeCloseTo(1920 / 1080, 2)
    expect(payload.timeline.tracks[0].clips[0].keyframes).toHaveLength(1)
  })
})
```

- [ ] **Step 5: Implement `app/api/v1/video-editor/projects/[id]/reframe/route.ts`**

```ts
import { FieldValue } from 'firebase-admin/firestore'
import { NextRequest } from 'next/server'
import { adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { apiError, apiSuccess } from '@/lib/api/response'
import { actorFields, ensureOrgAccess, loadScopedRecord } from '@/lib/youtube-studio/api'
import { VIDEO_EDITOR_COLLECTIONS } from '@/lib/video-editor/api'
import { reframeSettingsTo916, reframeTimelineTo916 } from '@/lib/video-editor/reframe'
import type { FocusSample } from '@/lib/video-editor/reframe'
import { sanitizeEditorTimeline, sanitizeVideoEditorSettingsInput } from '@/lib/video-editor/sanitize'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ id: string }> }

export const POST = withAuth('client', async (_req: NextRequest, user, context) => {
  const { id } = await (context as RouteContext).params
  const loaded = await loadScopedRecord(VIDEO_EDITOR_COLLECTIONS.projects, id)
  if (!loaded || loaded.data.deleted === true) return apiError('Video editor project not found', 404)
  const orgId = String(loaded.data.orgId ?? '')
  const denied = await ensureOrgAccess(user, orgId)
  if (denied) return denied

  const settings = sanitizeVideoEditorSettingsInput(loaded.data.settings)
  if (settings.aspect === '9:16') return apiError('Project is already 9:16', 400)
  const timeline = sanitizeEditorTimeline(loaded.data.timeline)

  // Provider-backed subject tracking when available: read focusTrack off each upload doc.
  const focusByFileId: Record<string, FocusSample[]> = {}
  const fileIds = new Set<string>()
  for (const track of timeline.tracks) for (const clip of track.clips) {
    if (clip.media?.type === 'upload' && clip.media.mediaKind !== 'audio') fileIds.add(clip.media.fileId)
  }
  for (const fileId of fileIds) {
    const snap = await adminDb.collection('uploads').doc(fileId).get()
    const data = snap.exists ? (snap.data() as Record<string, unknown>) : undefined
    if (data?.orgId !== orgId || !Array.isArray(data.focusTrack)) continue
    const samples = (data.focusTrack as unknown[])
      .filter((entry): entry is { atSeconds: number; x: number } =>
        !!entry && typeof entry === 'object'
        && typeof (entry as Record<string, unknown>).atSeconds === 'number'
        && typeof (entry as Record<string, unknown>).x === 'number')
    if (samples.length) focusByFileId[fileId] = samples
  }

  const variantTimeline = reframeTimelineTo916(timeline, settings, focusByFileId)
  const ref = await adminDb.collection(VIDEO_EDITOR_COLLECTIONS.projects).add({
    orgId,
    title: `${String(loaded.data.title ?? 'Untitled')} (9:16)`,
    ...(loaded.data.channelWorkspaceId ? { channelWorkspaceId: loaded.data.channelWorkspaceId } : {}),
    ...(loaded.data.videoProjectId ? { videoProjectId: loaded.data.videoProjectId } : {}),
    ...(loaded.data.canvasId ? { canvasId: loaded.data.canvasId } : {}),
    settings: reframeSettingsTo916(settings),
    timeline: variantTimeline,
    status: 'draft',
    deleted: false,
    reframedFromProjectId: id,
    ...actorFields(user),
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  })
  return apiSuccess({ id: ref.id, subjectTracked: Object.keys(focusByFileId).length > 0 }, 201)
})
```

Add a Shell toolbar button (next to Snap to beat) in `VideoEditorShell.tsx`:

```tsx
          <button type="button" className="pib-btn-ghost text-sm" disabled={busy || settings.aspect === '9:16'} onClick={async () => {
            setBusy(true)
            try {
              const res = await fetch(scopedApiPath(`/api/v1/video-editor/projects/${projectId}/reframe`, apiScope), { method: 'POST' })
              const body = await res.json().catch(() => ({}))
              if (!res.ok) throw new Error(body.error ?? 'Could not reframe')
              setNotice(`Created 9:16 variant (project ${body.data?.id}). Open it from the project list.`)
            } catch (error) {
              setNotice(error instanceof Error ? error.message : 'Could not reframe')
            } finally { setBusy(false) }
          }}>Make 9:16 cut</button>
```

- [ ] **Step 6: Run tests**

Run: `npx jest __tests__/lib/video-editor-reframe.test.ts __tests__/api/video-editor-reframe.test.ts`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add lib/video-editor/reframe.ts app/api/v1/video-editor/projects/\[id\]/reframe components/video-editor/VideoEditorShell.tsx __tests__/lib/video-editor-reframe.test.ts __tests__/api/video-editor-reframe.test.ts
git commit -m "feat(video-editor): auto-reframe 16:9 to 9:16 variant with focus-tracked crop keyframes"
```

---

### Task 17: Template library — types, brand variables, fragment ops

`lib/video-editor/templates.ts` holds the model and the pure logic: variable resolution against the org's brand profile, "save selection as fragment" (normalize to t=0), and fragment insertion (remap ids, offset times, merge tracks by kind). Also extends `BrandProfile` with `colors`.

**Files:**
- Create: `lib/video-editor/templates.ts`
- Modify: `lib/organizations/types.ts` (BrandProfile.colors)
- Test: `__tests__/lib/video-editor-templates.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// __tests__/lib/video-editor-templates.test.ts
import {
  VIDEO_EDITOR_TEMPLATE_CATEGORIES,
  extractSelectionFragment,
  insertFragment,
  resolveTemplateVariables,
  sanitizeVideoEditorTemplateInput,
} from '@/lib/video-editor/templates'
import type { EditorTimeline } from '@/lib/video-editor/types'

const fragment: EditorTimeline = {
  version: 1,
  tracks: [{
    id: 'tpl-text', kind: 'text',
    clips: [{
      id: 'tpl-c1', timelineStart: 0, duration: 3,
      text: { content: '{{channel.title}} — subscribe!', fontSizePx: 64, fontFamily: '{{brand.font}}', color: '{{brand.primaryColor}}', align: 'center', animationPreset: 'fade_in' },
    }],
  }],
}

describe('template variables', () => {
  it('resolves brand + channel variables in text payloads', () => {
    const resolved = resolveTemplateVariables(fragment, {
      brand: { colors: { primary: '#ff5500' }, fonts: { heading: 'Sora' } },
      channelTitle: 'Acme Films',
      orgName: 'Acme',
    })
    const text = resolved.tracks[0].clips[0].text!
    expect(text.content).toBe('Acme Films — subscribe!')
    expect(text.color).toBe('#ff5500')
    expect(text.fontFamily).toBe('Sora')
  })

  it('falls back to defaults for missing brand values', () => {
    const resolved = resolveTemplateVariables(fragment, { orgName: 'Acme' })
    const text = resolved.tracks[0].clips[0].text!
    expect(text.content).toBe('Acme — subscribe!')
    expect(text.color).toBe('#ffffff')
    expect(text.fontFamily).toBe('Inter')
  })
})

describe('fragment extract/insert', () => {
  const timeline: EditorTimeline = {
    version: 1,
    tracks: [
      { id: 't-text', kind: 'text', clips: [{ id: 'c-a', timelineStart: 10, duration: 3, text: { content: 'Hi', fontSizePx: 48, color: '#fff', align: 'center', animationPreset: 'none' } }] },
      { id: 't-video', kind: 'video', clips: [] },
    ],
  }

  it('extracts selected clips normalized to t=0', () => {
    const extracted = extractSelectionFragment(timeline, 't-text', ['c-a'])
    expect(extracted.tracks).toHaveLength(1)
    expect(extracted.tracks[0].kind).toBe('text')
    expect(extracted.tracks[0].clips[0].timelineStart).toBe(0)
  })

  it('inserts a fragment at an offset with fresh clip ids, merging by track kind', () => {
    const next = insertFragment(timeline, fragment, 20)
    const textTrack = next.tracks.find((track) => track.kind === 'text')!
    expect(textTrack.clips).toHaveLength(2)
    const inserted = textTrack.clips.find((clip) => clip.timelineStart === 20)!
    expect(inserted.id).not.toBe('tpl-c1')
    expect(inserted.duration).toBe(3)
  })

  it('appends a new track when no unlocked track of that kind exists', () => {
    const onlyVideo: EditorTimeline = { version: 1, tracks: [{ id: 't-v', kind: 'video', clips: [] }] }
    const next = insertFragment(onlyVideo, fragment, 0)
    expect(next.tracks.some((track) => track.kind === 'text')).toBe(true)
  })
})

describe('sanitizeVideoEditorTemplateInput', () => {
  it('validates category and requires a fragment with at least one clip', () => {
    expect(VIDEO_EDITOR_TEMPLATE_CATEGORIES).toEqual(['intro', 'outro', 'lower_third', 'caption_style', 'end_screen'])
    const result = sanitizeVideoEditorTemplateInput({
      orgId: 'org-1', title: 'Intro pop', category: 'intro', fragment,
    })
    expect(result).toMatchObject({ orgId: 'org-1', title: 'Intro pop', category: 'intro', deleted: false })
    expect(result.fragment.tracks[0].clips).toHaveLength(1)
    expect(() => sanitizeVideoEditorTemplateInput({ orgId: 'org-1', title: 'x', category: 'nope', fragment }))
      .toThrow(/category/)
    expect(() => sanitizeVideoEditorTemplateInput({ orgId: 'org-1', title: 'x', category: 'intro', fragment: { version: 1, tracks: [] } }))
      .toThrow(/fragment/)
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npx jest __tests__/lib/video-editor-templates.test.ts`
Expected: FAIL

- [ ] **Step 3: Add brand colors** — in `lib/organizations/types.ts`, inside `BrandProfile` after `logoMarkUrl?`:

```ts
  colors?: {
    primary?: string      // e.g. "#7c3aed"
    secondary?: string
    accent?: string
  }
```

- [ ] **Step 4: Implement `lib/video-editor/templates.ts`**

```ts
import type { BrandProfile } from '@/lib/organizations/types'
import { sanitizeEditorTimeline } from './sanitize'
import type { ActorType, EditorTimeline, EditorTrack } from './types'

export const VIDEO_EDITOR_TEMPLATE_CATEGORIES = ['intro', 'outro', 'lower_third', 'caption_style', 'end_screen'] as const
export type VideoEditorTemplateCategory = (typeof VIDEO_EDITOR_TEMPLATE_CATEGORIES)[number]

/** orgId 'platform' = available to every org (created by admins). */
export const PLATFORM_TEMPLATE_ORG = 'platform'

export interface VideoEditorTemplate {
  id?: string
  orgId: string
  category: VideoEditorTemplateCategory
  title: string
  description?: string
  fragment: EditorTimeline
  deleted: boolean
  createdBy?: string
  createdByType?: ActorType
  createdAt?: unknown
  updatedAt?: unknown
}

export interface TemplateVariableContext {
  brand?: BrandProfile
  channelTitle?: string
  orgName?: string
}

function variableMap(ctx: TemplateVariableContext): Record<string, string> {
  return {
    '{{brand.primaryColor}}': ctx.brand?.colors?.primary ?? '#ffffff',
    '{{brand.secondaryColor}}': ctx.brand?.colors?.secondary ?? '#000000',
    '{{brand.accentColor}}': ctx.brand?.colors?.accent ?? '#7c3aed',
    '{{brand.font}}': ctx.brand?.fonts?.heading ?? 'Inter',
    '{{brand.bodyFont}}': ctx.brand?.fonts?.body ?? 'Inter',
    '{{brand.logoUrl}}': ctx.brand?.logoUrl ?? '',
    '{{brand.tagline}}': ctx.brand?.tagline ?? '',
    '{{channel.title}}': ctx.channelTitle ?? ctx.orgName ?? '',
    '{{org.name}}': ctx.orgName ?? '',
  }
}

function substitute(value: string, vars: Record<string, string>): string {
  let result = value
  for (const [token, replacement] of Object.entries(vars)) result = result.split(token).join(replacement)
  return result
}

/** Replace {{...}} variables in every string field of a fragment. */
export function resolveTemplateVariables(fragment: EditorTimeline, ctx: TemplateVariableContext): EditorTimeline {
  const vars = variableMap(ctx)
  const walk = (value: unknown): unknown => {
    if (typeof value === 'string') return substitute(value, vars)
    if (Array.isArray(value)) return value.map(walk)
    if (value && typeof value === 'object') {
      return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, entry]) => [key, walk(entry)]))
    }
    return value
  }
  return walk(fragment) as EditorTimeline
}

function freshId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
}

/** Selected clips → standalone fragment normalized to t=0. */
export function extractSelectionFragment(timeline: EditorTimeline, trackId: string, clipIds: string[]): EditorTimeline {
  const track = timeline.tracks.find((entry) => entry.id === trackId)
  const clips = (track?.clips ?? []).filter((clip) => clipIds.includes(clip.id))
  if (!track || !clips.length) return { version: 1, tracks: [] }
  const offset = Math.min(...clips.map((clip) => clip.timelineStart))
  return {
    version: 1,
    tracks: [{
      id: freshId('tpl-track'),
      kind: track.kind,
      ...(track.label ? { label: track.label } : {}),
      clips: clips.map((clip) => ({ ...clip, id: freshId('tpl-clip'), timelineStart: Math.round((clip.timelineStart - offset) * 1000) / 1000 })),
    }],
  }
}

/** Insert a fragment at atSeconds: fresh ids, offset starts, merge into first unlocked track of the same kind (append a track otherwise). */
export function insertFragment(timeline: EditorTimeline, fragment: EditorTimeline, atSeconds: number): EditorTimeline {
  let tracks: EditorTrack[] = timeline.tracks.map((track) => ({ ...track, clips: [...track.clips] }))
  for (const fragmentTrack of fragment.tracks) {
    const clips = fragmentTrack.clips.map((clip) => ({
      ...clip,
      id: freshId('clip'),
      timelineStart: Math.round((clip.timelineStart + Math.max(0, atSeconds)) * 1000) / 1000,
    }))
    const hasRoom = (track: EditorTrack) => clips.every((clip) =>
      !track.clips.some((existing) => clip.timelineStart < existing.timelineStart + existing.duration
        && clip.timelineStart + clip.duration > existing.timelineStart))
    const target = tracks.find((track) => track.kind === fragmentTrack.kind && !track.locked && hasRoom(track))
    if (target) {
      target.clips = [...target.clips, ...clips].sort((a, b) => a.timelineStart - b.timelineStart)
    } else {
      tracks = [...tracks, { id: freshId('track'), kind: fragmentTrack.kind, ...(fragmentTrack.label ? { label: fragmentTrack.label } : {}), clips }]
    }
  }
  return { version: 1, tracks }
}

export function sanitizeVideoEditorTemplateInput(input: Record<string, unknown>): Omit<VideoEditorTemplate, 'id'> {
  const orgId = typeof input.orgId === 'string' && input.orgId.trim() ? input.orgId.trim() : ''
  const title = typeof input.title === 'string' && input.title.trim() ? input.title.trim() : ''
  if (!orgId) throw new Error('orgId is required')
  if (!title) throw new Error('title is required')
  if (!VIDEO_EDITOR_TEMPLATE_CATEGORIES.includes(input.category as VideoEditorTemplateCategory)) {
    throw new Error(`category must be one of ${VIDEO_EDITOR_TEMPLATE_CATEGORIES.join(', ')}`)
  }
  const fragment = sanitizeEditorTimeline(input.fragment)
  if (!fragment.tracks.some((track) => track.clips.length > 0)) throw new Error('fragment must contain at least one clip')
  const description = typeof input.description === 'string' && input.description.trim() ? input.description.trim() : undefined
  return {
    orgId,
    category: input.category as VideoEditorTemplateCategory,
    title,
    ...(description ? { description } : {}),
    fragment,
    deleted: false,
  }
}
```

One nuance: `sanitizeEditorTimeline` inside `sanitizeVideoEditorTemplateInput` runs template fragments through the standard sanitizer — `{{brand.primaryColor}}` in a `color` field survives because `sanitizeTextPayload` only trims strings (`cleanString`), it does not enforce hex on `color`. Verify this while implementing; if `color` validation gets added later, template storage must keep raw tokens.

- [ ] **Step 5: Run tests + typecheck**

Run: `npx jest __tests__/lib/video-editor-templates.test.ts && npm run typecheck`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add lib/video-editor/templates.ts lib/organizations/types.ts __tests__/lib/video-editor-templates.test.ts
git commit -m "feat(video-editor): template model, brand-kit variable resolution, fragment ops"
```

---

### Task 18: Template routes — list/create, CRUD, resolve

`GET /api/v1/video-editor/templates?orgId=` returns platform templates + org templates. `POST` creates an org template (or platform template when `user.role === 'admin'` sends `orgId: 'platform'`). `[id]` GET/PUT/DELETE. `[id]/resolve` returns the fragment with brand variables resolved against the org's brand profile (+ optional `channelWorkspaceId` for `{{channel.title}}`).

**Files:**
- Create: `app/api/v1/video-editor/templates/route.ts`, `app/api/v1/video-editor/templates/[id]/route.ts`, `app/api/v1/video-editor/templates/[id]/resolve/route.ts`
- Test: `__tests__/api/video-editor-templates.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// __tests__/api/video-editor-templates.test.ts
import { NextRequest } from 'next/server'
import type { ApiUser } from '@/lib/api/types'

const mockTemplateAdd = jest.fn()
const mockTemplateWhere = jest.fn()
const mockTemplateDocGet = jest.fn()
const mockTemplateDocSet = jest.fn()
const mockOrgGet = jest.fn()
const mockChannelGet = jest.fn()

let mockUser: ApiUser = { uid: 'admin-1', role: 'admin' } as ApiUser

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: {
    collection: (name: string) => {
      if (name === 'video_editor_templates') {
        return {
          add: mockTemplateAdd,
          doc: () => ({ get: mockTemplateDocGet, set: mockTemplateDocSet }),
          where: (...args: unknown[]) => { mockTemplateWhere(...args); return { get: mockTemplateWhere.getResult } },
        }
      }
      if (name === 'organizations') return { doc: () => ({ get: mockOrgGet }) }
      if (name === 'youtube_channel_workspaces') return { doc: () => ({ get: mockChannelGet }) }
      throw new Error(`Unexpected collection ${name}`)
    },
  },
}))
jest.mock('@/lib/api/auth', () => ({
  withAuth: (_role: string, handler: (req: NextRequest, user: ApiUser, context?: unknown) => Promise<Response>) =>
    (req: NextRequest, context?: unknown) => handler(req, mockUser, context),
}))
jest.mock('@/lib/youtube-studio/api', () => ({
  ensureOrgAccess: jest.fn().mockResolvedValue(null),
  actorFields: () => ({ createdBy: 'admin-1', createdByType: 'user' }),
  updateActorFields: () => ({ updatedBy: 'admin-1', updatedByType: 'user' }),
}))
jest.mock('firebase-admin/firestore', () => ({ FieldValue: { serverTimestamp: () => 'SERVER_TS' } }))

const fragment = {
  version: 1,
  tracks: [{
    id: 'tpl-t', kind: 'text',
    clips: [{ id: 'tpl-c', timelineStart: 0, duration: 3, text: { content: '{{channel.title}}', fontSizePx: 64, color: '{{brand.primaryColor}}', align: 'center', animationPreset: 'none' } }],
  }],
}

function whereResults(orgDocs: unknown[], platformDocs: unknown[]) {
  let call = 0
  mockTemplateWhere.getResult = jest.fn().mockImplementation(() => {
    call += 1
    return Promise.resolve({ docs: call === 1 ? orgDocs : platformDocs })
  })
}

describe('video-editor templates routes', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    jest.resetModules()
    mockTemplateAdd.mockResolvedValue({ id: 'tpl-1' })
    whereResults([], [])
  })

  it('GET merges org and platform templates', async () => {
    whereResults(
      [{ id: 'tpl-org', data: () => ({ orgId: 'org-1', title: 'Org intro', category: 'intro', fragment, deleted: false }) }],
      [{ id: 'tpl-plat', data: () => ({ orgId: 'platform', title: 'Platform outro', category: 'outro', fragment, deleted: false }) }],
    )
    const { GET } = await import('@/app/api/v1/video-editor/templates/route')
    const res = await GET(new NextRequest('http://localhost/api/v1/video-editor/templates?orgId=org-1'))
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.data.templates.map((t: { id: string }) => t.id).sort()).toEqual(['tpl-org', 'tpl-plat'])
  })

  it('POST creates an org template', async () => {
    const { POST } = await import('@/app/api/v1/video-editor/templates/route')
    const res = await POST(new NextRequest('http://localhost/api/v1/video-editor/templates', {
      method: 'POST',
      body: JSON.stringify({ orgId: 'org-1', title: 'Lower third', category: 'lower_third', fragment }),
    }))
    expect(res.status).toBe(201)
    expect(mockTemplateAdd.mock.calls[0][0]).toMatchObject({ orgId: 'org-1', category: 'lower_third', deleted: false })
  })

  it('POST rejects platform templates from non-admins', async () => {
    mockUser = { uid: 'client-1', role: 'client', orgIds: ['org-1'] } as ApiUser
    const { POST } = await import('@/app/api/v1/video-editor/templates/route')
    const res = await POST(new NextRequest('http://localhost/api/v1/video-editor/templates', {
      method: 'POST',
      body: JSON.stringify({ orgId: 'platform', title: 'X', category: 'intro', fragment }),
    }))
    expect(res.status).toBe(403)
  })

  it('resolve returns the fragment with brand + channel variables applied', async () => {
    mockTemplateDocGet.mockResolvedValue({
      exists: true,
      data: () => ({ orgId: 'platform', title: 'Intro', category: 'intro', fragment, deleted: false }),
    })
    mockOrgGet.mockResolvedValue({
      exists: true,
      data: () => ({ name: 'Acme', brandProfile: { colors: { primary: '#ff5500' }, fonts: { heading: 'Sora' } } }),
    })
    mockChannelGet.mockResolvedValue({ exists: true, data: () => ({ orgId: 'org-1', title: 'Acme Films', deleted: false }) })
    const { POST } = await import('@/app/api/v1/video-editor/templates/[id]/resolve/route')
    const context = { params: Promise.resolve({ id: 'tpl-1' }) }
    const res = await POST(new NextRequest('http://localhost/api/v1/video-editor/templates/tpl-1/resolve?orgId=org-1', {
      method: 'POST',
      body: JSON.stringify({ channelWorkspaceId: 'ch-1' }),
    }), context)
    const body = await res.json()
    expect(res.status).toBe(200)
    const text = body.data.fragment.tracks[0].clips[0].text
    expect(text.content).toBe('Acme Films')
    expect(text.color).toBe('#ff5500')
  })

  it('DELETE soft-deletes an org template but never a platform template for non-admins', async () => {
    mockTemplateDocGet.mockResolvedValue({ exists: true, data: () => ({ orgId: 'org-1', deleted: false }) })
    const { DELETE } = await import('@/app/api/v1/video-editor/templates/[id]/route')
    const context = { params: Promise.resolve({ id: 'tpl-1' }) }
    const res = await DELETE(new NextRequest('http://localhost/api/v1/video-editor/templates/tpl-1?orgId=org-1', { method: 'DELETE' }), context)
    expect(res.status).toBe(200)
    expect(mockTemplateDocSet).toHaveBeenCalledWith(expect.objectContaining({ deleted: true }), { merge: true })

    mockUser = { uid: 'client-1', role: 'client', orgIds: ['org-1'] } as ApiUser
    mockTemplateDocGet.mockResolvedValue({ exists: true, data: () => ({ orgId: 'platform', deleted: false }) })
    const res2 = await DELETE(new NextRequest('http://localhost/api/v1/video-editor/templates/tpl-1?orgId=org-1', { method: 'DELETE' }), context)
    expect(res2.status).toBe(403)
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npx jest __tests__/api/video-editor-templates.test.ts`
Expected: FAIL — routes missing

- [ ] **Step 3: Implement `app/api/v1/video-editor/templates/route.ts`**

```ts
import { FieldValue } from 'firebase-admin/firestore'
import { NextRequest } from 'next/server'
import { adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { apiError, apiSuccess } from '@/lib/api/response'
import { actorFields, ensureOrgAccess } from '@/lib/youtube-studio/api'
import { VIDEO_EDITOR_COLLECTIONS } from '@/lib/video-editor/api'
import { PLATFORM_TEMPLATE_ORG, sanitizeVideoEditorTemplateInput } from '@/lib/video-editor/templates'

export const dynamic = 'force-dynamic'

function serialize(id: string, data: Record<string, unknown>) {
  return { id, ...(JSON.parse(JSON.stringify(data)) as Record<string, unknown>) }
}

export const GET = withAuth('client', async (req: NextRequest, user) => {
  const url = new URL(req.url)
  const orgId = url.searchParams.get('orgId')?.trim() ?? ''
  const category = url.searchParams.get('category')?.trim() ?? ''
  const denied = await ensureOrgAccess(user, orgId)
  if (denied) return denied
  const collection = adminDb.collection(VIDEO_EDITOR_COLLECTIONS.templates)
  const [orgSnap, platformSnap] = await Promise.all([
    collection.where('orgId', '==', orgId).get(),
    collection.where('orgId', '==', PLATFORM_TEMPLATE_ORG).get(),
  ])
  const templates = [...orgSnap.docs, ...platformSnap.docs]
    .map((doc) => serialize(doc.id, doc.data() as Record<string, unknown>))
    .filter((template) => template.deleted !== true)
    .filter((template) => !category || template.category === category)
    .sort((a, b) => String(a.title ?? '').localeCompare(String(b.title ?? '')))
  return apiSuccess({ templates })
})

export const POST = withAuth('client', async (req: NextRequest, user) => {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const orgId = typeof body.orgId === 'string' ? body.orgId.trim() : ''
  if (orgId === PLATFORM_TEMPLATE_ORG) {
    if (user.role !== 'admin') return apiError('Only platform admins can create platform templates', 403)
  } else {
    const denied = await ensureOrgAccess(user, orgId)
    if (denied) return denied
  }
  let data
  try {
    data = sanitizeVideoEditorTemplateInput(body)
  } catch (error) {
    return apiError(error instanceof Error ? error.message : 'Invalid template', 400)
  }
  const ref = await adminDb.collection(VIDEO_EDITOR_COLLECTIONS.templates).add({
    ...data,
    ...actorFields(user),
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  })
  return apiSuccess({ id: ref.id }, 201)
})
```

- [ ] **Step 4: Implement `app/api/v1/video-editor/templates/[id]/route.ts`**

```ts
import { NextRequest } from 'next/server'
import { adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { apiError, apiSuccess } from '@/lib/api/response'
import { ensureOrgAccess, updateActorFields } from '@/lib/youtube-studio/api'
import { VIDEO_EDITOR_COLLECTIONS } from '@/lib/video-editor/api'
import { PLATFORM_TEMPLATE_ORG, sanitizeVideoEditorTemplateInput } from '@/lib/video-editor/templates'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ id: string }> }

async function loadTemplate(id: string) {
  const ref = adminDb.collection(VIDEO_EDITOR_COLLECTIONS.templates).doc(id)
  const snap = await ref.get()
  const data = snap.exists ? (snap.data() as Record<string, unknown>) : undefined
  if (!data || data.deleted === true) return null
  return { ref, data }
}

/** Readable if platform-level or in the caller's org; writable only for own org (admins may write platform). */
async function guard(req: NextRequest, user: Parameters<Parameters<typeof withAuth>[1]>[1], id: string, write: boolean) {
  const orgId = new URL(req.url).searchParams.get('orgId')?.trim() ?? ''
  const denied = await ensureOrgAccess(user, orgId)
  if (denied) return { error: denied }
  const template = await loadTemplate(id)
  if (!template) return { error: apiError('Template not found', 404) }
  const templateOrg = String(template.data.orgId ?? '')
  if (templateOrg !== orgId && templateOrg !== PLATFORM_TEMPLATE_ORG) return { error: apiError('Template not found', 404) }
  if (write && templateOrg === PLATFORM_TEMPLATE_ORG && user.role !== 'admin') {
    return { error: apiError('Only platform admins can modify platform templates', 403) }
  }
  return { template, orgId }
}

export const GET = withAuth('client', async (req: NextRequest, user, context) => {
  const { id } = await (context as RouteContext).params
  const result = await guard(req, user, id, false)
  if ('error' in result) return result.error
  return apiSuccess({ template: { id, ...(JSON.parse(JSON.stringify(result.template.data)) as Record<string, unknown>) } })
})

export const PUT = withAuth('client', async (req: NextRequest, user, context) => {
  const { id } = await (context as RouteContext).params
  const result = await guard(req, user, id, true)
  if ('error' in result) return result.error
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  let data
  try {
    data = sanitizeVideoEditorTemplateInput({ ...body, orgId: result.template.data.orgId })
  } catch (error) {
    return apiError(error instanceof Error ? error.message : 'Invalid template', 400)
  }
  await result.template.ref.set({ ...data, ...updateActorFields(user) }, { merge: true })
  return apiSuccess({ id })
})

export const DELETE = withAuth('client', async (req: NextRequest, user, context) => {
  const { id } = await (context as RouteContext).params
  const result = await guard(req, user, id, true)
  if ('error' in result) return result.error
  await result.template.ref.set({ deleted: true, ...updateActorFields(user) }, { merge: true })
  return apiSuccess({ id })
})
```

(If the `Parameters<...>` typing of `guard`'s `user` argument fights the compiler, type it as `ApiUser` from `@/lib/api/types` — that is what the youtube-studio routes do.)

- [ ] **Step 5: Implement `app/api/v1/video-editor/templates/[id]/resolve/route.ts`**

```ts
import { NextRequest } from 'next/server'
import { adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { apiError, apiSuccess } from '@/lib/api/response'
import { ensureOrgAccess } from '@/lib/youtube-studio/api'
import { VIDEO_EDITOR_COLLECTIONS } from '@/lib/video-editor/api'
import { PLATFORM_TEMPLATE_ORG, resolveTemplateVariables } from '@/lib/video-editor/templates'
import { sanitizeEditorTimeline } from '@/lib/video-editor/sanitize'
import type { BrandProfile } from '@/lib/organizations/types'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ id: string }> }

export const POST = withAuth('client', async (req: NextRequest, user, context) => {
  const { id } = await (context as RouteContext).params
  const orgId = new URL(req.url).searchParams.get('orgId')?.trim() ?? ''
  const denied = await ensureOrgAccess(user, orgId)
  if (denied) return denied
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>

  const snap = await adminDb.collection(VIDEO_EDITOR_COLLECTIONS.templates).doc(id).get()
  const template = snap.exists ? (snap.data() as Record<string, unknown>) : undefined
  if (!template || template.deleted === true) return apiError('Template not found', 404)
  const templateOrg = String(template.orgId ?? '')
  if (templateOrg !== orgId && templateOrg !== PLATFORM_TEMPLATE_ORG) return apiError('Template not found', 404)

  const orgSnap = await adminDb.collection('organizations').doc(orgId).get()
  const org = orgSnap.exists ? (orgSnap.data() as Record<string, unknown>) : {}
  const brand = (org?.brandProfile ?? {}) as BrandProfile
  const orgName = typeof org?.name === 'string' ? org.name : ''

  let channelTitle: string | undefined
  const channelWorkspaceId = typeof body.channelWorkspaceId === 'string' ? body.channelWorkspaceId.trim() : ''
  if (channelWorkspaceId) {
    const channelSnap = await adminDb.collection('youtube_channel_workspaces').doc(channelWorkspaceId).get()
    const channel = channelSnap.exists ? (channelSnap.data() as Record<string, unknown>) : undefined
    if (channel && channel.deleted !== true && channel.orgId === orgId && typeof channel.title === 'string') {
      channelTitle = channel.title
    }
  }

  const fragment = resolveTemplateVariables(
    sanitizeEditorTimeline(template.fragment),
    { brand, channelTitle, orgName },
  )
  return apiSuccess({ fragment })
})
```

- [ ] **Step 6: Run tests**

Run: `npx jest __tests__/api/video-editor-templates.test.ts`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add app/api/v1/video-editor/templates __tests__/api/video-editor-templates.test.ts
git commit -m "feat(video-editor): template routes — platform+org listing, CRUD, brand-resolved insert"
```

---

### Task 19: Template browser panel + save-selection-as-template

Left-rail panel: category filter, template cards, "Insert at playhead" (calls `[id]/resolve` then `insertFragment`), and "Save selection as template" (uses `extractSelectionFragment`).

**Files:**
- Create: `components/video-editor/TemplateBrowserPanel.tsx`
- Modify: `components/video-editor/VideoEditorShell.tsx`
- Test: `__tests__/components/video-editor-template-browser.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// __tests__/components/video-editor-template-browser.test.tsx
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { TemplateBrowserPanel } from '@/components/video-editor/TemplateBrowserPanel'

jest.mock('@/lib/portal/scoped-routing', () => ({ scopedApiPath: (path: string) => path }))

const templates = [
  { id: 'tpl-1', orgId: 'platform', title: 'Bold intro', category: 'intro', fragment: { version: 1, tracks: [] } },
  { id: 'tpl-2', orgId: 'org-1', title: 'Acme lower third', category: 'lower_third', fragment: { version: 1, tracks: [] } },
]

describe('TemplateBrowserPanel', () => {
  beforeEach(() => {
    global.fetch = jest.fn().mockImplementation((url: string) => {
      if (String(url).includes('/resolve')) {
        return Promise.resolve({ ok: true, json: async () => ({ success: true, data: { fragment: { version: 1, tracks: [{ id: 't', kind: 'text', clips: [{ id: 'c', timelineStart: 0, duration: 3, text: { content: 'Acme', fontSizePx: 48, color: '#fff', align: 'center', animationPreset: 'none' } }] }] } } }) })
      }
      return Promise.resolve({ ok: true, json: async () => ({ success: true, data: { templates } }) })
    }) as unknown as typeof fetch
  })

  it('lists templates and filters by category', async () => {
    render(<TemplateBrowserPanel orgId="org-1" canSaveSelection={false} onInsert={jest.fn()} onSaveSelection={jest.fn()} />)
    expect(await screen.findByText('Bold intro')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Category'), { target: { value: 'lower_third' } })
    await waitFor(() => expect(screen.queryByText('Bold intro')).not.toBeInTheDocument())
    expect(screen.getByText('Acme lower third')).toBeInTheDocument()
  })

  it('resolves then inserts a template', async () => {
    const onInsert = jest.fn()
    render(<TemplateBrowserPanel orgId="org-1" canSaveSelection={false} onInsert={onInsert} onSaveSelection={jest.fn()} />)
    fireEvent.click(await screen.findAllByText('Insert at playhead').then((buttons) => buttons[0]))
    await waitFor(() => expect(onInsert).toHaveBeenCalled())
    expect(onInsert.mock.calls[0][0].tracks[0].clips[0].text.content).toBe('Acme')
  })

  it('exposes save-selection when a selection exists', async () => {
    const onSaveSelection = jest.fn()
    render(<TemplateBrowserPanel orgId="org-1" canSaveSelection onInsert={jest.fn()} onSaveSelection={onSaveSelection} />)
    fireEvent.click(await screen.findByText('Save selection as template'))
    expect(onSaveSelection).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npx jest __tests__/components/video-editor-template-browser.test.tsx`
Expected: FAIL

- [ ] **Step 3: Implement `components/video-editor/TemplateBrowserPanel.tsx`**

```tsx
'use client'

import { useEffect, useState } from 'react'
import { scopedApiPath } from '@/lib/portal/scoped-routing'
import { VIDEO_EDITOR_TEMPLATE_CATEGORIES } from '@/lib/video-editor/templates'
import type { EditorTimeline } from '@/lib/video-editor/types'

interface TemplateListItem {
  id: string
  orgId: string
  title: string
  category: string
  description?: string
}

export function TemplateBrowserPanel({
  orgId, channelWorkspaceId, canSaveSelection, onInsert, onSaveSelection,
}: {
  orgId?: string
  channelWorkspaceId?: string
  canSaveSelection: boolean
  onInsert: (fragment: EditorTimeline) => void
  onSaveSelection: () => void
}) {
  const [templates, setTemplates] = useState<TemplateListItem[]>([])
  const [category, setCategory] = useState('')
  const [message, setMessage] = useState('')

  useEffect(() => {
    if (!orgId) return
    const query = category ? `&category=${encodeURIComponent(category)}` : ''
    void fetch(scopedApiPath(`/api/v1/video-editor/templates?orgId=${encodeURIComponent(orgId)}${query}`, { orgId }))
      .then((res) => res.json())
      .then((body) => setTemplates((body.data?.templates ?? []) as TemplateListItem[]))
      .catch(() => setTemplates([]))
  }, [orgId, category])

  async function insert(template: TemplateListItem) {
    if (!orgId) return
    setMessage('')
    try {
      const res = await fetch(scopedApiPath(`/api/v1/video-editor/templates/${template.id}/resolve?orgId=${encodeURIComponent(orgId)}`, { orgId }), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channelWorkspaceId }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error ?? 'Could not resolve template')
      onInsert(body.data?.fragment as EditorTimeline)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not insert template')
    }
  }

  return (
    <section className="pib-card-section space-y-3 p-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-headline text-lg font-semibold text-on-surface">Templates</h2>
        {canSaveSelection ? (
          <button type="button" className="pib-btn-ghost text-xs" onClick={onSaveSelection}>Save selection as template</button>
        ) : null}
      </div>
      <label className="block text-xs text-on-surface-variant">
        Category
        <select aria-label="Category" className="mt-1 w-full rounded-lg border border-[var(--color-pib-line)] bg-transparent px-2 py-1 text-sm"
          value={category} onChange={(event) => setCategory(event.target.value)}>
          <option value="">All</option>
          {VIDEO_EDITOR_TEMPLATE_CATEGORIES.map((entry) => <option key={entry} value={entry}>{entry.replace('_', ' ')}</option>)}
        </select>
      </label>
      {message ? <p className="text-xs text-red-300">{message}</p> : null}
      <div className="space-y-2">
        {templates.length === 0 ? <p className="text-sm text-on-surface-variant">No templates yet.</p> : null}
        {templates.map((template) => (
          <div key={template.id} className="rounded-lg border border-[var(--color-pib-line)] p-3">
            <p className="text-sm font-medium text-on-surface">{template.title}</p>
            <p className="text-xs text-on-surface-variant">{template.category.replace('_', ' ')}{template.orgId === 'platform' ? ' · platform' : ''}</p>
            <button type="button" className="pib-btn-ghost mt-1 text-xs" onClick={() => void insert(template)}>Insert at playhead</button>
          </div>
        ))}
      </div>
    </section>
  )
}
```

- [ ] **Step 4: Wire the Shell** — in `VideoEditorShell.tsx`, under `MediaLibraryPanel` in the left column:

```tsx
          <TemplateBrowserPanel
            orgId={orgId}
            channelWorkspaceId={project.channelWorkspaceId}
            canSaveSelection={Boolean(selection?.clipIds.length)}
            onInsert={(fragment) => void persist(insertFragment(timeline, fragment, playhead))}
            onSaveSelection={async () => {
              if (!selection || !orgId) return
              const fragment = extractSelectionFragment(timeline, selection.trackId, selection.clipIds)
              const title = window.prompt('Template name?')
              if (!title) return
              const res = await fetch(scopedApiPath('/api/v1/video-editor/templates', apiScope), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ orgId, title, category: 'lower_third', fragment }),
              })
              const body = await res.json().catch(() => ({}))
              setNotice(res.ok ? `Saved template "${title}".` : body.error ?? 'Could not save template')
            }}
          />
```

with imports `insertFragment, extractSelectionFragment` from `@/lib/video-editor/templates`.

- [ ] **Step 5: Run tests + typecheck**

Run: `npx jest __tests__/components/video-editor-template-browser.test.tsx && npm run typecheck`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add components/video-editor/TemplateBrowserPanel.tsx components/video-editor/VideoEditorShell.tsx __tests__/components/video-editor-template-browser.test.tsx
git commit -m "feat(video-editor): template browser panel with brand-resolved insert + save selection"
```

---

### Task 20: Stock media — normalizers + search/import routes

**Files:**
- Create: `lib/video-editor/stock.ts`
- Create: `app/api/v1/video-editor/stock/search/route.ts`
- Create: `app/api/v1/video-editor/stock/import/route.ts`
- Test: `__tests__/lib/video-editor-stock.test.ts`, `__tests__/api/video-editor-stock.test.ts`

Pexels + Pixabay searched server-side (keys stay in env: `PEXELS_API_KEY`, `PIXABAY_API_KEY`), results normalized to one shape, imports proxied through the platform into org storage so timeline MediaRefs never point at third-party CDNs (render allowlist stays tight).

- [ ] **Step 1: Write the failing lib test** — create `__tests__/lib/video-editor-stock.test.ts`:

```ts
import { normalizePexelsResults, normalizePixabayResults, isAllowedStockImportUrl } from '@/lib/video-editor/stock'

describe('stock normalizers', () => {
  it('normalizes pexels photos and videos to StockResult', () => {
    const photos = normalizePexelsResults({
      photos: [{ id: 1, alt: 'Beach', src: { large2x: 'https://images.pexels.com/1.jpg', medium: 'https://images.pexels.com/1-m.jpg' }, photographer: 'Ann' }],
    })
    expect(photos).toEqual([
      {
        id: 'pexels-photo-1',
        provider: 'pexels',
        mediaKind: 'image',
        title: 'Beach',
        thumbnailUrl: 'https://images.pexels.com/1-m.jpg',
        downloadUrl: 'https://images.pexels.com/1.jpg',
        attribution: 'Ann · Pexels',
      },
    ])
    const videos = normalizePexelsResults({
      videos: [{ id: 2, image: 'https://images.pexels.com/v2.jpg', duration: 12, user: { name: 'Bo' }, video_files: [{ link: 'https://videos.pexels.com/2-hd.mp4', height: 1080 }, { link: 'https://videos.pexels.com/2-sd.mp4', height: 540 }] }],
    })
    expect(videos[0]).toMatchObject({ id: 'pexels-video-2', mediaKind: 'video', downloadUrl: 'https://videos.pexels.com/2-hd.mp4', durationSeconds: 12 })
  })

  it('normalizes pixabay hits', () => {
    const results = normalizePixabayResults({
      hits: [{ id: 3, tags: 'sky, clouds', previewURL: 'https://cdn.pixabay.com/3-p.jpg', largeImageURL: 'https://cdn.pixabay.com/3.jpg', user: 'Cy' }],
    })
    expect(results[0]).toMatchObject({ id: 'pixabay-image-3', provider: 'pixabay', mediaKind: 'image', attribution: 'Cy · Pixabay' })
  })

  it('allows only pexels/pixabay hosts for import', () => {
    expect(isAllowedStockImportUrl('https://videos.pexels.com/x.mp4')).toBe(true)
    expect(isAllowedStockImportUrl('https://cdn.pixabay.com/x.jpg')).toBe(true)
    expect(isAllowedStockImportUrl('https://evil.example.com/x.mp4')).toBe(false)
    expect(isAllowedStockImportUrl('http://169.254.169.254/latest')).toBe(false)
  })
})
```

- [ ] **Step 2: Run it — FAIL (module not found)**

Run: `npx jest __tests__/lib/video-editor-stock.test.ts`

- [ ] **Step 3: Implement `lib/video-editor/stock.ts`**

```ts
export interface StockResult {
  id: string
  provider: 'pexels' | 'pixabay'
  mediaKind: 'image' | 'video'
  title: string
  thumbnailUrl: string
  downloadUrl: string
  attribution: string
  durationSeconds?: number
}

const STOCK_IMPORT_HOSTS = new Set([
  'images.pexels.com',
  'videos.pexels.com',
  'cdn.pixabay.com',
  'pixabay.com',
  ...(process.env.STOCK_IMPORT_EXTRA_HOSTS ?? '').split(',').map((h) => h.trim()).filter(Boolean),
])

export function isAllowedStockImportUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'https:' && STOCK_IMPORT_HOSTS.has(parsed.hostname)
  } catch {
    return false
  }
}

interface PexelsPhoto { id: number; alt?: string; photographer?: string; src?: { large2x?: string; medium?: string } }
interface PexelsVideoFile { link?: string; height?: number }
interface PexelsVideo { id: number; image?: string; duration?: number; user?: { name?: string }; video_files?: PexelsVideoFile[] }

export function normalizePexelsResults(body: { photos?: PexelsPhoto[]; videos?: PexelsVideo[] }): StockResult[] {
  const photos = (body.photos ?? []).map((p): StockResult => ({
    id: `pexels-photo-${p.id}`,
    provider: 'pexels',
    mediaKind: 'image',
    title: p.alt || 'Pexels photo',
    thumbnailUrl: p.src?.medium ?? '',
    downloadUrl: p.src?.large2x ?? '',
    attribution: `${p.photographer ?? 'Unknown'} · Pexels`,
  }))
  const videos = (body.videos ?? []).map((v): StockResult => {
    const best = [...(v.video_files ?? [])].sort((a, b) => (b.height ?? 0) - (a.height ?? 0))[0]
    return {
      id: `pexels-video-${v.id}`,
      provider: 'pexels',
      mediaKind: 'video',
      title: 'Pexels video',
      thumbnailUrl: v.image ?? '',
      downloadUrl: best?.link ?? '',
      attribution: `${v.user?.name ?? 'Unknown'} · Pexels`,
      durationSeconds: v.duration,
    }
  })
  return [...photos, ...videos].filter((r) => r.downloadUrl)
}

interface PixabayHit { id: number; tags?: string; user?: string; previewURL?: string; largeImageURL?: string; videos?: { large?: { url?: string }; medium?: { url?: string } }; duration?: number; picture_id?: string }

export function normalizePixabayResults(body: { hits?: PixabayHit[] }): StockResult[] {
  return (body.hits ?? [])
    .map((h): StockResult => {
      const videoUrl = h.videos?.large?.url ?? h.videos?.medium?.url
      if (videoUrl) {
        return {
          id: `pixabay-video-${h.id}`,
          provider: 'pixabay',
          mediaKind: 'video',
          title: h.tags || 'Pixabay video',
          thumbnailUrl: h.previewURL ?? '',
          downloadUrl: videoUrl,
          attribution: `${h.user ?? 'Unknown'} · Pixabay`,
          durationSeconds: h.duration,
        }
      }
      return {
        id: `pixabay-image-${h.id}`,
        provider: 'pixabay',
        mediaKind: 'image',
        title: h.tags || 'Pixabay image',
        thumbnailUrl: h.previewURL ?? '',
        downloadUrl: h.largeImageURL ?? '',
        attribution: `${h.user ?? 'Unknown'} · Pixabay`,
      }
    })
    .filter((r) => r.downloadUrl)
}
```

- [ ] **Step 4: Run lib test — PASS, commit**

```bash
npx jest __tests__/lib/video-editor-stock.test.ts
git add lib/video-editor/stock.ts __tests__/lib/video-editor-stock.test.ts
git commit -m "feat(video-editor): stock result normalizers + import host allowlist"
```

- [ ] **Step 5: Write the failing API test** — create `__tests__/api/video-editor-stock.test.ts` (mirror the auth/org mocking pattern used by `__tests__/api/video-editor-templates.test.ts` from Task 18):

```ts
import { GET as searchStock } from '@/app/api/v1/video-editor/stock/search/route'
import { POST as importStock } from '@/app/api/v1/video-editor/stock/import/route'
// …withAuth/org mocks exactly as in the Task 18 API test…

describe('stock search route', () => {
  it('returns 400 when q is missing', async () => { /* GET without ?q → 400 */ })
  it('merges pexels + pixabay results', async () => {
    // mock global.fetch: pexels photos/videos endpoints + pixabay endpoint → assert merged, normalized payload
  })
  it('omits a provider whose API key env is unset', async () => { /* delete process.env.PIXABAY_API_KEY → only pexels queried */ })
})

describe('stock import route', () => {
  it('rejects non-allowlisted URLs with 400', async () => { /* downloadUrl https://evil.example.com → 400 */ })
  it('downloads the asset server-side and stores it via the platform upload path, returning the created upload doc', async () => {
    // mock fetch for the CDN download; assert storage write + uploads doc fields { orgId, source: 'stock', attribution }
  })
})
```

Write these five tests in full following the Task 18 test file's mock scaffolding — same `withAuth` mock, same Firestore mock, same request-builder helper. The contracts: `GET /api/v1/video-editor/stock/search?q=beach&kind=video|image|all&page=1` → `{ results: StockResult[] }`; `POST /api/v1/video-editor/stock/import { orgId, result: StockResult }` → `{ upload: { fileId, url, mediaKind } }` ready to use as a `MediaRef { type: 'upload' }`.

- [ ] **Step 6: Implement the two routes**

`app/api/v1/video-editor/stock/search/route.ts`: `withAuth('client')`; read `q`/`kind`/`page`; in parallel (`Promise.allSettled`) call Pexels (`https://api.pexels.com/v1/search` and `/videos/search`, header `Authorization: PEXELS_API_KEY`) and Pixabay (`https://pixabay.com/api/` and `/videos/`, `key=PIXABAY_API_KEY`) — skipping any provider without a key; normalize with Task 20 helpers; cache per (q, kind, page) in a module-level LRU Map (max 100 entries, 10-min TTL); return `apiSuccess({ results })`.

`app/api/v1/video-editor/stock/import/route.ts`: `withAuth('client')` + `ensureOrgAccess`; validate `isAllowedStockImportUrl(result.downloadUrl)` (400 otherwise); server-side `fetch` the asset (50 MB cap via content-length check, reject redirects off-allowlist); store through the same storage helper the upload route uses (`video-editor/{orgId}/stock/{id}.{ext}`); create the `uploads` doc with `source: 'stock'` and the attribution string; return `apiSuccess({ upload })`.

- [ ] **Step 7: Run API tests — PASS, commit**

```bash
npx jest __tests__/api/video-editor-stock.test.ts
git add app/api/v1/video-editor/stock __tests__/api/video-editor-stock.test.ts
git commit -m "feat(video-editor): stock search (pexels+pixabay) and allowlisted server-side import"
```

---

### Task 21: MediaLibraryPanel — Stock + Generate tabs

**Files:**
- Modify: `components/video-editor/MediaLibraryPanel.tsx`
- Test: `__tests__/components/video-editor-media-tabs.test.tsx`

Extend the existing source tabs (Uploads / Source assets / Marketing Studio) with **Stock** and **Generate**.

- [ ] **Step 1: Write the failing test** — create `__tests__/components/video-editor-media-tabs.test.tsx`:

```tsx
/** @jest-environment jsdom */
import React from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MediaLibraryPanel } from '@/components/video-editor/MediaLibraryPanel'

// Reuse the existing MediaLibraryPanel test file's prop scaffolding for the base props.

describe('MediaLibraryPanel stock + generate tabs', () => {
  it('searches stock and imports a result as an upload', async () => {
    const fetchMock = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.includes('/stock/search')) {
        return new Response(JSON.stringify({ success: true, data: { results: [{ id: 'pexels-photo-1', provider: 'pexels', mediaKind: 'image', title: 'Beach', thumbnailUrl: 'https://images.pexels.com/1-m.jpg', downloadUrl: 'https://images.pexels.com/1.jpg', attribution: 'Ann · Pexels' }] } }), { status: 200 })
      }
      if (url.includes('/stock/import') && init?.method === 'POST') {
        return new Response(JSON.stringify({ success: true, data: { upload: { fileId: 'f-1', url: 'https://storage.googleapis.com/f-1.jpg', mediaKind: 'image' } } }), { status: 200 })
      }
      return new Response(JSON.stringify({ success: true, data: {} }), { status: 200 })
    })
    global.fetch = fetchMock as unknown as typeof fetch
    const onInsertMedia = jest.fn()
    render(<MediaLibraryPanel {...baseProps} onInsertMedia={onInsertMedia} />)
    fireEvent.click(screen.getByRole('tab', { name: /stock/i }))
    fireEvent.change(screen.getByPlaceholderText(/search stock/i), { target: { value: 'beach' } })
    fireEvent.click(screen.getByRole('button', { name: /^search$/i }))
    await waitFor(() => expect(screen.getByText('Beach')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: /add to project/i }))
    await waitFor(() => expect(onInsertMedia).toHaveBeenCalledWith(expect.objectContaining({ type: 'upload', fileId: 'f-1', mediaKind: 'image' })))
  })

  it('renders the generate tab with a prompt box and kind selector', () => {
    render(<MediaLibraryPanel {...baseProps} />)
    fireEvent.click(screen.getByRole('tab', { name: /generate/i }))
    expect(screen.getByPlaceholderText(/describe the b-roll/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/image or video/i)).toBeInTheDocument()
  })
})
```

(`baseProps` = whatever the existing MediaLibraryPanel tests already construct; import/copy their helper. `onInsertMedia` = the panel's existing insert callback name — defer to the actual prop name in the component.)

- [ ] **Step 2: Run — FAIL (no stock/generate tabs)**

- [ ] **Step 3: Implement in `MediaLibraryPanel.tsx`**

Stock tab: search box + kind filter → `GET /api/v1/video-editor/stock/search`; result grid (thumbnail, title, attribution footer — attribution is REQUIRED display for Pexels/Pixabay terms); "Add to project" → `POST /api/v1/video-editor/stock/import` → call the panel's existing insert callback with the returned upload as `MediaRef { type: 'upload', fileId, url, mediaKind }`; per-card busy state; import errors surface inline.

Generate tab: prompt textarea (`placeholder="Describe the B-roll you need…"`), image/video selector (`aria-label="Image or video"`), duration selector for video (4/8s), "Generate" button → reuse the existing canvas generation dispatch path (`lib/creative-canvas` run creation with the org's default image/video model, credits charged exactly like canvas runs) targeting a hidden utility canvas per editor project (`video-editor-{projectId}`); poll the run like ExportDialog polls render jobs; on completion insert the output into the library as a `canvas_output` MediaRef and call the insert callback. Reuse `friendlyRunError` for failures.

- [ ] **Step 4: Run tests — PASS**

Run: `npx jest __tests__/components/video-editor-media-tabs.test.tsx`

- [ ] **Step 5: Commit**

```bash
git add components/video-editor/MediaLibraryPanel.tsx __tests__/components/video-editor-media-tabs.test.tsx
git commit -m "feat(video-editor): stock search/import and in-place AI generation tabs in media library"
```

---

### Task 22: Final gates, env vars + VPS executor deploy

- [ ] **Step 1: Env vars** — add to Vercel (development + preview + production) and `.env.local`, using printf (never echo — trailing-newline gotcha):

```bash
printf "%s" "<pexels-key>" | vercel env add PEXELS_API_KEY development
printf "%s" "<pixabay-key>" | vercel env add PIXABAY_API_KEY development
# repeat for preview/production when Peet green-lights production
```

Document both keys in the repo env README where the other third-party keys are listed.

- [ ] **Step 2: Full verification gates**

```bash
npm run typecheck
npx jest __tests__/lib __tests__/api __tests__/components __tests__/scripts
git diff --check
NODE_OPTIONS=--max-old-space-size=10240 npm run build
```

Expected: all clean/PASS. Watch for server-only imports (stabilization/beat modules are executor-side `.mjs` — they must never be imported by client components).

- [ ] **Step 3: VPS deploy (byte-identical policy, dated .bak)**

```bash
ssh root@65.108.146.144 "cp /opt/higgsfield-executor/executor.mjs /opt/higgsfield-executor/executor.mjs.bak-$(date +%Y%m%d)"
scp scripts/higgsfield-executor/executor.mjs root@65.108.146.144:/opt/higgsfield-executor/executor.mjs
scp scripts/higgsfield-executor/lib/*.mjs root@65.108.146.144:/opt/higgsfield-executor/lib/
ssh root@65.108.146.144 "shasum -a 256 /opt/higgsfield-executor/executor.mjs && systemctl restart higgsfield-executor && sleep 2 && curl -s localhost:8787/health"
```

Expected: sha256 matches local; health `{"ok":true,...}`.

- [ ] **Step 4: Live QA script**

Seeded org on a dev server: apply a LUT + vignette to a clip → chroma-key a green-screen fixture over a background → duck music under a voiceover track → snap two cuts to detected beats → apply a corner-PiP layout → auto-reframe the project to 9:16 → insert a lower-third template (brand colors resolve) → import one Pexels video + generate one AI image → render → verify every effect visible in the MP4.

- [ ] **Step 5: Push**

```bash
git push origin development
```

## Self-review addendum (Tasks 20–22)

- Stock URLs never enter timelines directly — imports are proxied into org storage first, so the executor's download allowlist stays unchanged.
- Attribution display satisfies Pexels/Pixabay API terms.
- Generate tab reuses canvas run + credit primitives — no new billing surface.
- Env vars documented and added with printf (newline gotcha).
