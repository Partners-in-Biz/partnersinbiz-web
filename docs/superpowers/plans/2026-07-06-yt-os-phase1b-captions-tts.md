# YT-OS Phase 1b — Captions, Transcription & TTS Voiceover Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the PiB video editor a full caption + voiceover system: async word-level transcription of any clip or rendered timeline, a first-class caption track with styled/animated presets, `.ass` burn-in + `.srt`/`.vtt` sidecar export, Gateway/BYOK TTS voiceover placed on the timeline, and transcript translation for multilingual caption tracks — all credit-metered.

**Architecture:** Transcription runs on the **VPS executor** (new `POST /video-editor/transcriptions` endpoint) because the executor already owns allowlisted media download (`editor-media.mjs`), ffmpeg (audio extraction), and long-running work — a 2 GB source file cannot pass through a Vercel function. The provider call is an OpenAI-compatible `/audio/transcriptions` (Whisper `verbose_json` + word timestamps), defaulting to the **Vercel AI Gateway** OpenAI-compat endpoint billed to the platform, with a per-org **BYOK override** via a new `openai_audio` entry in the existing `creative_provider_connections` framework (BYOK keys travel per-job in the manifest exactly like the Higgsfield `byokCredentials` path — never persisted on the VPS). Results land in a new `video_editor_transcripts` collection via the same executor→platform `PUT` report contract render jobs use. **TTS runs API-side inline** (small payloads, seconds of latency, and the output must become an `uploads` doc / `MediaRef {type:'upload'}` — all platform-side primitives). Captions are a **new first-class track kind `'caption'`** (not text clips with a `captionOf` link): burn-in uses libass, validation rules differ, and sidecar export must find them without heuristics. The desync-proof invariant: **caption cues are only ever generated from a `video_editor_transcripts` doc** — ElevenLabs TTS produces one from its character-alignment timestamps, Gateway TTS produces one with proportional (estimated) word timing that a one-click forced-alignment transcription of the generated audio can refine, and media transcription produces one from Whisper word timestamps. Credits use the existing creative-canvas ledger: charge on dispatch, idempotent refund on failure.

**Tech Stack:** Next.js 15 App Router (`withAuth` + `apiSuccess` envelope), Firestore (admin SDK), Vercel AI Gateway (`generateText` for translation; OpenAI-compat REST for Whisper/TTS), ElevenLabs `with-timestamps` API (BYOK), ffmpeg + libass on the VPS executor (plain `.mjs`, byte-identical deploy policy), Jest 30.

**Branch:** `development` (run the git preflight from CLAUDE.md first). **Never** touch `main`; no worktrees; no feature branches.

**Decisions locked by Peet (spec §6.1):** transcription + TTS are **platform-billed via AI Gateway by default**, per-org **BYOK override** supported; both **credit-metered** (charge on dispatch, refund on failure).

---

## File structure

| File | Responsibility |
|---|---|
| `lib/video-editor/types.ts` (modify) | `'caption'` track kind, `EditorCaptionPayload`/`EditorCaptionWord`, transcript doc types |
| `lib/video-editor/sanitize.ts` (modify) | Sanitize + validate caption clips |
| `lib/video-editor/caption-presets.ts` (new) | Style/animation preset registry (names + UI metadata) |
| `lib/video-editor/transcripts.ts` (new) | Transcript segment sanitizers + executor-report patch sanitizer |
| `lib/video-editor/credits.ts` (modify) | Credit estimators for transcription / TTS / translation |
| `lib/video-editor/captions.ts` (new) | Cue engine: transcript→caption clips, split/merge/nudge, SRT/VTT serializers, proportional word timing |
| `lib/video-editor/storage.ts` (new) | Server-side buffer→Firebase Storage + `uploads` doc helper |
| `lib/video-editor/transcribe-dispatch.ts` (new) | Transcription manifest builder + executor dispatch |
| `lib/video-editor/tts.ts` (new) | Voice registry, Gateway + ElevenLabs synthesis, WAV duration parser, char-alignment→words |
| `lib/video-editor/api.ts` (modify) | New collection names |
| `lib/creative-canvas/types.ts` + `providers.ts` (modify) | `openai_audio` + `elevenlabs` BYOK provider entries |
| `app/api/v1/video-editor/transcripts/route.ts` (new) | POST create+charge+dispatch, GET list |
| `app/api/v1/video-editor/transcripts/[id]/route.ts` (new) | GET, PUT (executor report), DELETE |
| `app/api/v1/video-editor/transcripts/[id]/translate/route.ts` (new) | POST translation → new transcript |
| `app/api/v1/video-editor/projects/[id]/captions/generate/route.ts` (new) | POST transcript → caption track on the timeline |
| `app/api/v1/video-editor/tts/voices/route.ts` (new) | GET voice list (static + BYOK ElevenLabs) |
| `app/api/v1/video-editor/projects/[id]/tts/route.ts` (new) | POST voiceover generation + clip placement + shared transcript |
| `app/api/v1/video-editor/projects/[id]/render/route.ts` (modify) | Sidecar `.srt`/`.vtt` generation at dispatch |
| `scripts/higgsfield-executor/lib/editor-captions.mjs` (new) | `.ass` builder (karaoke `\k` tags), subtitles-path escaping |
| `scripts/higgsfield-executor/lib/editor-transcribe.mjs` (new) | ffmpeg audio-extract args, Whisper request/response mapping |
| `scripts/higgsfield-executor/lib/editor-filtergraph.mjs` (modify) | `captionAssPath` → `subtitles=` filter |
| `scripts/higgsfield-executor/executor.mjs` (modify) | `/video-editor/transcriptions` endpoint; render writes `captions.ass` |
| `components/video-editor/CaptionsPanel.tsx` (new) | Caption editor panel |
| `components/video-editor/TtsPanel.tsx` (new) | Voiceover panel |
| `components/video-editor/VideoEditorShell.tsx` (modify) | Right-panel tabs + API wiring |

---

### Task 0: Git preflight & baseline

**Files:** none (repo state only)

- [ ] **Step 1: Sync `development`**

```bash
cd "/Users/peetstander/Cowork/Partners in Biz — Client Growth/partnersinbiz-web"
git status --short --branch
# If dirty: git add -A && git commit -m "chore(agent): checkpoint existing local work before sync"
git checkout development
git pull --rebase origin development
git status --short --branch
```

Expected: `## development...origin/development` and a clean tree.

- [ ] **Step 2: Verify the existing editor suite is green before touching anything**

```bash
npx jest __tests__/lib/video-editor-types.test.ts __tests__/lib/video-editor-sanitize.test.ts __tests__/lib/video-editor-credits.test.ts __tests__/scripts/editor-filtergraph.test.ts
```

Expected: PASS (all existing suites). If not, stop and fix upstream first — do not build on a red base.

---

### Task 1: Caption types — `'caption'` track kind + payload

**Files:**
- Modify: `lib/video-editor/types.ts`
- Test: `__tests__/lib/video-editor-types.test.ts`

- [ ] **Step 1: Write the failing test** — append to `__tests__/lib/video-editor-types.test.ts`:

```ts
import {
  EDITOR_CAPTION_ANIMATION_PRESETS,
  EDITOR_CAPTION_STYLE_PRESETS,
  EDITOR_TRACK_KINDS,
  VIDEO_EDITOR_TRANSCRIPT_SOURCES,
  VIDEO_EDITOR_TRANSCRIPT_STATUSES,
} from '@/lib/video-editor/types'

describe('caption + transcript type registries', () => {
  it('adds the caption track kind', () => {
    expect(EDITOR_TRACK_KINDS).toContain('caption')
  })
  it('pins caption preset registries', () => {
    expect(EDITOR_CAPTION_STYLE_PRESETS).toEqual(['clean', 'boxed', 'outline', 'lower_third', 'karaoke_bar'])
    expect(EDITOR_CAPTION_ANIMATION_PRESETS).toEqual(['none', 'pop', 'fade', 'slide_up', 'bounce', 'karaoke'])
  })
  it('pins transcript statuses and sources', () => {
    expect(VIDEO_EDITOR_TRANSCRIPT_STATUSES).toEqual(['queued', 'dispatched', 'processing', 'completed', 'failed'])
    expect(VIDEO_EDITOR_TRANSCRIPT_SOURCES).toEqual(['media', 'timeline_render', 'tts', 'translation'])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/lib/video-editor-types.test.ts`
Expected: FAIL — `EDITOR_CAPTION_STYLE_PRESETS` is not exported.

- [ ] **Step 3: Implement** — in `lib/video-editor/types.ts`:

Change the track kind union/array (line 23/29):

```ts
export type EditorTrackKind = 'video' | 'audio' | 'text' | 'overlay' | 'caption'
// ...
export const EDITOR_TRACK_KINDS: EditorTrackKind[] = ['video', 'audio', 'text', 'overlay', 'caption']
```

Add after `EDITOR_TEXT_ANIMATION_PRESETS`:

```ts
export type EditorCaptionStylePreset = 'clean' | 'boxed' | 'outline' | 'lower_third' | 'karaoke_bar'
export type EditorCaptionAnimationPreset = 'none' | 'pop' | 'fade' | 'slide_up' | 'bounce' | 'karaoke'

export const EDITOR_CAPTION_STYLE_PRESETS: EditorCaptionStylePreset[] = ['clean', 'boxed', 'outline', 'lower_third', 'karaoke_bar']
export const EDITOR_CAPTION_ANIMATION_PRESETS: EditorCaptionAnimationPreset[] = ['none', 'pop', 'fade', 'slide_up', 'bounce', 'karaoke']

export interface EditorCaptionWord {
  text: string
  /** Seconds relative to the clip's timelineStart (NOT absolute timeline seconds). */
  offsetStart: number
  offsetEnd: number
}

export interface EditorCaptionPayload {
  text: string
  words: EditorCaptionWord[]
  stylePreset: EditorCaptionStylePreset
  animationPreset: EditorCaptionAnimationPreset
  transcriptId?: string
  language?: string
}
```

Add `caption` to `EditorClip` (after `text?: EditorTextPayload`):

```ts
  caption?: EditorCaptionPayload
```

Add transcript types at the end of the file (before `VideoEditorRenderJob` types is also fine — keep them together after the render-job block):

```ts
export type VideoEditorTranscriptStatus = 'queued' | 'dispatched' | 'processing' | 'completed' | 'failed'
export type VideoEditorTranscriptSource = 'media' | 'timeline_render' | 'tts' | 'translation'

export const VIDEO_EDITOR_TRANSCRIPT_STATUSES: VideoEditorTranscriptStatus[] = ['queued', 'dispatched', 'processing', 'completed', 'failed']
export const VIDEO_EDITOR_TRANSCRIPT_SOURCES: VideoEditorTranscriptSource[] = ['media', 'timeline_render', 'tts', 'translation']

export interface TranscriptWord {
  text: string
  /** Absolute seconds within the transcribed media. */
  start: number
  end: number
}

export interface TranscriptSegment {
  id: string
  start: number
  end: number
  text: string
  words: TranscriptWord[]
}

export interface VideoEditorTranscript {
  id?: string
  orgId: string
  projectId: string
  /** Set when a single clip was transcribed; absent for timeline_render / tts scope. */
  clipId?: string
  source: VideoEditorTranscriptSource
  status: VideoEditorTranscriptStatus
  language: string
  media?: { url: string; mediaKind: 'video' | 'audio' }
  segments: TranscriptSegment[]
  text: string
  /** 'gateway' or 'byok:<provider>' — billing/audit provenance. */
  provider: string
  model?: string
  /** 'provider' = exact word timestamps; 'estimated' = proportional distribution (Gateway TTS). */
  alignment: 'provider' | 'estimated'
  translationOf?: string
  durationSeconds?: number
  providerJobId?: string
  credits: { estimated: number; charged: number; refunded: number }
  error?: { code: string; message: string }
  deleted: boolean
  createdBy?: string
  createdByType?: ActorType
  updatedBy?: string
  updatedByType?: ActorType
  createdAt?: unknown
  updatedAt?: unknown
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest __tests__/lib/video-editor-types.test.ts __tests__/lib/video-editor-sanitize.test.ts __tests__/lib/video-editor-timeline-ops.test.ts`
Expected: PASS (existing suites must not regress — the union widening is additive).

- [ ] **Step 5: Commit**

```bash
git add lib/video-editor/types.ts __tests__/lib/video-editor-types.test.ts
git commit -m "feat(video-editor): caption track kind, caption payload and transcript types"
```

---

### Task 2: Sanitize + validate caption clips

**Files:**
- Modify: `lib/video-editor/sanitize.ts`
- Test: `__tests__/lib/video-editor-sanitize.test.ts`

- [ ] **Step 1: Write the failing test** — append to `__tests__/lib/video-editor-sanitize.test.ts`:

```ts
import { sanitizeEditorTimeline, validateEditorTimeline } from '@/lib/video-editor/sanitize'

describe('caption clip sanitize + validation', () => {
  const rawCaptionTimeline = {
    version: 1,
    tracks: [{
      id: 'track-caption-1',
      kind: 'caption',
      clips: [{
        id: 'cue-1',
        timelineStart: 1,
        duration: 2.4,
        caption: {
          text: 'Hello world',
          words: [
            { text: 'Hello', offsetStart: 0, offsetEnd: 0.6 },
            { text: 'world', offsetStart: 0.7, offsetEnd: 1.2 },
            { text: '', offsetStart: 2, offsetEnd: 1 }, // dropped: empty + inverted
          ],
          stylePreset: 'karaoke_bar',
          animationPreset: 'karaoke',
          transcriptId: 't-1',
          language: 'en',
        },
      }],
    }],
  }

  it('sanitizes caption payloads and drops invalid words', () => {
    const timeline = sanitizeEditorTimeline(rawCaptionTimeline)
    const clip = timeline.tracks[0].clips[0]
    expect(timeline.tracks[0].kind).toBe('caption')
    expect(clip.caption).toEqual({
      text: 'Hello world',
      words: [
        { text: 'Hello', offsetStart: 0, offsetEnd: 0.6 },
        { text: 'world', offsetStart: 0.7, offsetEnd: 1.2 },
      ],
      stylePreset: 'karaoke_bar',
      animationPreset: 'karaoke',
      transcriptId: 't-1',
      language: 'en',
    })
    expect(validateEditorTimeline(timeline)).toEqual([])
  })

  it('falls back to clean/none for unknown presets', () => {
    const timeline = sanitizeEditorTimeline({
      version: 1,
      tracks: [{
        id: 't', kind: 'caption',
        clips: [{ id: 'c', timelineStart: 0, duration: 1, caption: { text: 'x', words: [], stylePreset: 'nope', animationPreset: 'nope' } }],
      }],
    })
    expect(timeline.tracks[0].clips[0].caption).toMatchObject({ stylePreset: 'clean', animationPreset: 'none' })
  })

  it('flags caption clips without payloads and media on caption tracks', () => {
    const issues = validateEditorTimeline({
      version: 1,
      tracks: [{
        id: 't', kind: 'caption',
        clips: [
          { id: 'no-payload', timelineStart: 0, duration: 1 },
          { id: 'has-media', timelineStart: 2, duration: 1, caption: { text: 'x', words: [], stylePreset: 'clean', animationPreset: 'none' }, media: { type: 'upload', fileId: 'f', url: 'https://x.test/a.mp4', mediaKind: 'video' } },
        ],
      }],
    })
    expect(issues).toEqual([
      { trackId: 't', clipId: 'no-payload', message: 'Clip on a caption track requires a caption payload.' },
      { trackId: 't', clipId: 'has-media', message: 'Media is not allowed on a caption track.' },
    ])
  })

  it('flags caption payloads outside caption tracks', () => {
    const issues = validateEditorTimeline({
      version: 1,
      tracks: [{
        id: 't', kind: 'text',
        clips: [{ id: 'c', timelineStart: 0, duration: 1, text: { content: 'x', fontSizePx: 48, color: '#fff', align: 'center', animationPreset: 'none' }, caption: { text: 'x', words: [], stylePreset: 'clean', animationPreset: 'none' } }],
      }],
    })
    expect(issues).toEqual([{ trackId: 't', clipId: 'c', message: 'Caption payloads are only allowed on caption tracks.' }])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/lib/video-editor-sanitize.test.ts -t "caption"`
Expected: FAIL — `clip.caption` is stripped (unknown field) and validation issues are missing.

- [ ] **Step 3: Implement** — in `lib/video-editor/sanitize.ts`:

Add to the `./types` imports: `EDITOR_CAPTION_ANIMATION_PRESETS, EDITOR_CAPTION_STYLE_PRESETS` (value imports) and `EditorCaptionPayload, EditorCaptionWord` (type imports).

Add after `sanitizeTextPayload`:

```ts
function sanitizeCaptionWords(value: unknown): EditorCaptionWord[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((entry) => {
    const source = cleanObject(entry)
    const text = cleanString(source.text)
    const offsetStart = cleanNumber(source.offsetStart)
    const offsetEnd = cleanNumber(source.offsetEnd)
    if (!text || offsetStart === undefined || offsetEnd === undefined || offsetEnd < offsetStart) return []
    return [{ text, offsetStart: Math.max(0, offsetStart), offsetEnd: Math.max(0, offsetEnd) }]
  })
}

function sanitizeCaptionPayload(value: unknown): EditorCaptionPayload | undefined {
  const source = cleanObject(value)
  const text = cleanString(source.text)
  if (!text) return undefined
  return compact({
    text,
    words: sanitizeCaptionWords(source.words),
    stylePreset: pickEnum(source.stylePreset, EDITOR_CAPTION_STYLE_PRESETS, 'clean'),
    animationPreset: pickEnum(source.animationPreset, EDITOR_CAPTION_ANIMATION_PRESETS, 'none'),
    transcriptId: cleanString(source.transcriptId),
    language: cleanString(source.language),
  }) as EditorCaptionPayload
}
```

In `sanitizeClip`, add after `text: sanitizeTextPayload(source.text),`:

```ts
    caption: sanitizeCaptionPayload(source.caption),
```

In `validateEditorTimeline`, add inside the per-clip loop (after the `track.kind === 'text'` check):

```ts
      if (track.kind === 'caption' && !clip.caption) {
        issues.push({ trackId, clipId, message: 'Clip on a caption track requires a caption payload.' })
      }
      if (track.kind === 'caption' && clip.media) {
        issues.push({ trackId, clipId, message: 'Media is not allowed on a caption track.' })
      }
      if (track.kind !== 'caption' && clip.caption) {
        issues.push({ trackId, clipId, message: 'Caption payloads are only allowed on caption tracks.' })
      }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest __tests__/lib/video-editor-sanitize.test.ts`
Expected: PASS (all, including pre-existing cases).

- [ ] **Step 5: Commit**

```bash
git add lib/video-editor/sanitize.ts __tests__/lib/video-editor-sanitize.test.ts
git commit -m "feat(video-editor): sanitize and validate caption clips"
```

---

### Task 3: Caption preset registry (TS side)

**Files:**
- Create: `lib/video-editor/caption-presets.ts`
- Test: `__tests__/lib/video-editor-caption-presets.test.ts`

- [ ] **Step 1: Write the failing test** — create `__tests__/lib/video-editor-caption-presets.test.ts`:

```ts
import { CAPTION_STYLE_PRESETS, CAPTION_ANIMATION_LABELS } from '@/lib/video-editor/caption-presets'
import { EDITOR_CAPTION_ANIMATION_PRESETS, EDITOR_CAPTION_STYLE_PRESETS } from '@/lib/video-editor/types'

describe('caption presets', () => {
  it('covers every style preset key exactly once', () => {
    expect(Object.keys(CAPTION_STYLE_PRESETS).sort()).toEqual([...EDITOR_CAPTION_STYLE_PRESETS].sort())
  })
  it('covers every animation preset with a label', () => {
    expect(Object.keys(CAPTION_ANIMATION_LABELS).sort()).toEqual([...EDITOR_CAPTION_ANIMATION_PRESETS].sort())
  })
  it('karaoke_bar has a highlight color for word-by-word rendering', () => {
    expect(CAPTION_STYLE_PRESETS.karaoke_bar.highlightColor).toBe('#ffd400')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/lib/video-editor-caption-presets.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement** — create `lib/video-editor/caption-presets.ts`:

```ts
import type { EditorCaptionAnimationPreset, EditorCaptionStylePreset } from './types'

export interface CaptionStylePresetSpec {
  label: string
  /** Font size as a fraction of output height — the .ass builder on the executor uses the same scales. */
  fontScale: number
  color: string
  outlineColor: string
  backgroundColor: string | null
  bold: boolean
  /** ASS alignment (numpad): 2 = bottom-center, 8 = top-center. */
  alignment: 2 | 8
  /** Vertical margin as a fraction of output height. */
  marginVScale: number
  /** Karaoke word-highlight (SecondaryColour in ASS). */
  highlightColor: string
}

export const CAPTION_STYLE_PRESETS: Record<EditorCaptionStylePreset, CaptionStylePresetSpec> = {
  clean: {
    label: 'Clean', fontScale: 0.055, color: '#ffffff', outlineColor: '#000000',
    backgroundColor: null, bold: true, alignment: 2, marginVScale: 0.08, highlightColor: '#ffd400',
  },
  boxed: {
    label: 'Boxed', fontScale: 0.05, color: '#ffffff', outlineColor: '#000000',
    backgroundColor: '#000000b3', bold: false, alignment: 2, marginVScale: 0.08, highlightColor: '#ffd400',
  },
  outline: {
    label: 'Outline', fontScale: 0.06, color: '#ffffff', outlineColor: '#111111',
    backgroundColor: null, bold: true, alignment: 2, marginVScale: 0.08, highlightColor: '#ffd400',
  },
  lower_third: {
    label: 'Lower third', fontScale: 0.045, color: '#ffffff', outlineColor: '#000000',
    backgroundColor: '#101828cc', bold: false, alignment: 2, marginVScale: 0.05, highlightColor: '#ffd400',
  },
  karaoke_bar: {
    label: 'Karaoke bar', fontScale: 0.055, color: '#ffffff', outlineColor: '#000000',
    backgroundColor: '#000000cc', bold: true, alignment: 2, marginVScale: 0.1, highlightColor: '#ffd400',
  },
}

export const CAPTION_ANIMATION_LABELS: Record<EditorCaptionAnimationPreset, string> = {
  none: 'None',
  pop: 'Pop',
  fade: 'Fade',
  slide_up: 'Slide up',
  bounce: 'Bounce',
  karaoke: 'Karaoke (word highlight)',
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest __tests__/lib/video-editor-caption-presets.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/video-editor/caption-presets.ts __tests__/lib/video-editor-caption-presets.test.ts
git commit -m "feat(video-editor): caption style and animation preset registry"
```

---

### Task 4: Transcript sanitizers + collections

**Files:**
- Create: `lib/video-editor/transcripts.ts`
- Modify: `lib/video-editor/api.ts` (collection names)
- Test: `__tests__/lib/video-editor-transcripts.test.ts`

- [ ] **Step 1: Write the failing test** — create `__tests__/lib/video-editor-transcripts.test.ts`:

```ts
import {
  sanitizeTranscriptSegments,
  sanitizeTranscriptReportPatch,
  transcriptPlainText,
} from '@/lib/video-editor/transcripts'
import { VIDEO_EDITOR_COLLECTIONS } from '@/lib/video-editor/api'

describe('transcript sanitizers', () => {
  it('registers the transcripts and tts-jobs collections', () => {
    expect(VIDEO_EDITOR_COLLECTIONS.transcripts).toBe('video_editor_transcripts')
    expect(VIDEO_EDITOR_COLLECTIONS.ttsJobs).toBe('video_editor_tts_jobs')
  })

  it('sanitizes segments, drops invalid words, clamps times', () => {
    const segments = sanitizeTranscriptSegments([
      {
        id: 's1', start: -1, end: 2.5, text: ' Hello world ',
        words: [
          { text: 'Hello', start: 0, end: 0.5 },
          { text: 'world', start: 0.6, end: 1.1 },
          { text: '', start: 1, end: 2 },
          { text: 'bad', start: 3, end: 2 },
        ],
      },
      { id: '', start: 0, end: 1, text: 'dropped — no id', words: [] },
      { id: 's2', start: 3, end: 2, text: 'dropped — inverted', words: [] },
    ])
    expect(segments).toEqual([{
      id: 's1', start: 0, end: 2.5, text: 'Hello world',
      words: [
        { text: 'Hello', start: 0, end: 0.5 },
        { text: 'world', start: 0.6, end: 1.1 },
      ],
    }])
  })

  it('accepts a completed executor report and requires segments', () => {
    const patch = sanitizeTranscriptReportPatch({
      status: 'completed',
      language: ' en ',
      durationSeconds: 12.2,
      segments: [{ id: 's1', start: 0, end: 1, text: 'Hi', words: [{ text: 'Hi', start: 0, end: 1 }] }],
    })
    expect(patch.status).toBe('completed')
    expect(patch.language).toBe('en')
    expect(patch.durationSeconds).toBe(12.2)
    expect(patch.segments).toHaveLength(1)

    expect(sanitizeTranscriptReportPatch({ status: 'completed', segments: [] }).status).toBeUndefined()
    expect(sanitizeTranscriptReportPatch({ status: 'nonsense' }).status).toBeUndefined()
  })

  it('accepts processing and failed reports', () => {
    expect(sanitizeTranscriptReportPatch({ status: 'processing' })).toEqual({ status: 'processing' })
    const failed = sanitizeTranscriptReportPatch({ status: 'failed', error: { code: 'x', message: 'boom' } })
    expect(failed).toEqual({ status: 'failed', error: { code: 'x', message: 'boom' } })
    expect(sanitizeTranscriptReportPatch({ status: 'failed' }).error).toEqual({ code: 'transcription_failed', message: 'Transcription failed.' })
  })

  it('joins segment text into plain text', () => {
    expect(transcriptPlainText([
      { id: 's1', start: 0, end: 1, text: 'Hello world.', words: [] },
      { id: 's2', start: 1, end: 2, text: 'Second line.', words: [] },
    ])).toBe('Hello world. Second line.')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/lib/video-editor-transcripts.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

In `lib/video-editor/api.ts` change the collections const:

```ts
export const VIDEO_EDITOR_COLLECTIONS = {
  projects: 'video_editor_projects',
  renderJobs: 'video_editor_render_jobs',
  transcripts: 'video_editor_transcripts',
  ttsJobs: 'video_editor_tts_jobs',
} as const
```

Create `lib/video-editor/transcripts.ts`:

```ts
import type { TranscriptSegment, TranscriptWord, VideoEditorTranscriptStatus } from './types'

type PlainRecord = Record<string, unknown>

function cleanObject(value: unknown): PlainRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as PlainRecord) : {}
}
function cleanString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}
function cleanNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function sanitizeWords(value: unknown): TranscriptWord[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((entry) => {
    const source = cleanObject(entry)
    const text = cleanString(source.text)
    const start = cleanNumber(source.start)
    const end = cleanNumber(source.end)
    if (!text || start === undefined || end === undefined || end < start) return []
    return [{ text, start: Math.max(0, start), end: Math.max(0, end) }]
  })
}

export function sanitizeTranscriptSegments(value: unknown): TranscriptSegment[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((entry) => {
    const source = cleanObject(entry)
    const id = cleanString(source.id)
    const start = cleanNumber(source.start)
    const end = cleanNumber(source.end)
    const text = cleanString(source.text)
    if (!id || start === undefined || end === undefined || !text) return []
    const safeStart = Math.max(0, start)
    if (end < safeStart) return []
    return [{ id, start: safeStart, end, text, words: sanitizeWords(source.words) }]
  })
}

export function transcriptPlainText(segments: TranscriptSegment[]): string {
  return segments.map((segment) => segment.text).join(' ').trim()
}

const REPORT_STATUSES: VideoEditorTranscriptStatus[] = ['processing', 'completed', 'failed']

export interface TranscriptReportPatch {
  status?: 'processing' | 'completed' | 'failed'
  segments?: TranscriptSegment[]
  language?: string
  durationSeconds?: number
  error?: { code: string; message: string }
}

/**
 * Sanitizes the executor's PUT report. A `completed` report without at least
 * one valid segment is rejected (status stripped) so an empty provider
 * response can never overwrite a transcript as "done".
 */
export function sanitizeTranscriptReportPatch(value: unknown): TranscriptReportPatch {
  const source = cleanObject(value)
  const status = REPORT_STATUSES.includes(source.status as VideoEditorTranscriptStatus)
    ? (source.status as TranscriptReportPatch['status'])
    : undefined

  if (status === 'processing') return { status: 'processing' }

  if (status === 'completed') {
    const segments = sanitizeTranscriptSegments(source.segments)
    if (!segments.length) return {}
    const patch: TranscriptReportPatch = { status: 'completed', segments }
    const language = cleanString(source.language)
    if (language) patch.language = language
    const durationSeconds = cleanNumber(source.durationSeconds)
    if (durationSeconds !== undefined && durationSeconds >= 0) patch.durationSeconds = durationSeconds
    return patch
  }

  if (status === 'failed') {
    const errorSource = cleanObject(source.error)
    return {
      status: 'failed',
      error: {
        code: cleanString(errorSource.code) ?? 'transcription_failed',
        message: (cleanString(errorSource.message) ?? 'Transcription failed.').slice(0, 4000),
      },
    }
  }
  return {}
}

/**
 * Firestore docs cap at ~1 MiB. If the segments (with words) would blow the
 * cap, drop word arrays (keep cue-level timing) and flag it.
 */
export function fitSegmentsForFirestore(segments: TranscriptSegment[]): { segments: TranscriptSegment[]; wordsTruncated: boolean } {
  if (JSON.stringify(segments).length <= 850_000) return { segments, wordsTruncated: false }
  return { segments: segments.map((segment) => ({ ...segment, words: [] })), wordsTruncated: true }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest __tests__/lib/video-editor-transcripts.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/video-editor/transcripts.ts lib/video-editor/api.ts __tests__/lib/video-editor-transcripts.test.ts
git commit -m "feat(video-editor): transcript sanitizers and collections"
```

---

### Task 5: Credit estimators for transcription / TTS / translation

**Files:**
- Modify: `lib/video-editor/credits.ts`
- Test: `__tests__/lib/video-editor-credits.test.ts`

- [ ] **Step 1: Write the failing test** — append to `__tests__/lib/video-editor-credits.test.ts`:

```ts
import {
  VIDEO_EDITOR_TRANSCRIBE_COST_LABEL,
  VIDEO_EDITOR_TTS_COST_LABEL,
  VIDEO_EDITOR_TRANSLATE_COST_LABEL,
  estimateTranscriptionCredits,
  estimateTtsCredits,
  estimateTranslationCredits,
} from '@/lib/video-editor/credits'

describe('captions/tts credit estimators', () => {
  it('pins cost labels', () => {
    expect(VIDEO_EDITOR_TRANSCRIBE_COST_LABEL).toBe('video_editor_transcription')
    expect(VIDEO_EDITOR_TTS_COST_LABEL).toBe('video_editor_tts')
    expect(VIDEO_EDITOR_TRANSLATE_COST_LABEL).toBe('video_editor_translation')
  })
  it('transcription: 1 credit per started 10 minutes, min 1', () => {
    expect(estimateTranscriptionCredits(0)).toBe(0)
    expect(estimateTranscriptionCredits(30)).toBe(1)
    expect(estimateTranscriptionCredits(600)).toBe(1)
    expect(estimateTranscriptionCredits(601)).toBe(2)
  })
  it('tts: 1 credit per started 1000 chars, min 1', () => {
    expect(estimateTtsCredits(0)).toBe(0)
    expect(estimateTtsCredits(1)).toBe(1)
    expect(estimateTtsCredits(1000)).toBe(1)
    expect(estimateTtsCredits(1001)).toBe(2)
  })
  it('translation: 1 credit per started 5000 chars, min 1', () => {
    expect(estimateTranslationCredits(0)).toBe(0)
    expect(estimateTranslationCredits(4999)).toBe(1)
    expect(estimateTranslationCredits(5001)).toBe(2)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/lib/video-editor-credits.test.ts`
Expected: FAIL — new exports missing.

- [ ] **Step 3: Implement** — append to `lib/video-editor/credits.ts`:

```ts
export const VIDEO_EDITOR_TRANSCRIBE_COST_LABEL = 'video_editor_transcription'
export const VIDEO_EDITOR_TTS_COST_LABEL = 'video_editor_tts'
export const VIDEO_EDITOR_TRANSLATE_COST_LABEL = 'video_editor_translation'

export const VIDEO_EDITOR_TRANSCRIBE_CREDITS_PER_10_MINUTES = 1
export const VIDEO_EDITOR_TTS_CREDITS_PER_1000_CHARS = 1
export const VIDEO_EDITOR_TRANSLATE_CREDITS_PER_5000_CHARS = 1

/** 1 credit per started 10 minutes of source audio; 0 for empty input. */
export function estimateTranscriptionCredits(sourceDurationSeconds: number): number {
  if (!Number.isFinite(sourceDurationSeconds) || sourceDurationSeconds <= 0) return 0
  return Math.max(1, Math.ceil(sourceDurationSeconds / 600)) * VIDEO_EDITOR_TRANSCRIBE_CREDITS_PER_10_MINUTES
}

/** 1 credit per started 1000 characters of input text; 0 for empty input. */
export function estimateTtsCredits(charCount: number): number {
  if (!Number.isFinite(charCount) || charCount <= 0) return 0
  return Math.max(1, Math.ceil(charCount / 1000)) * VIDEO_EDITOR_TTS_CREDITS_PER_1000_CHARS
}

/** 1 credit per started 5000 characters of transcript text; 0 for empty input. */
export function estimateTranslationCredits(charCount: number): number {
  if (!Number.isFinite(charCount) || charCount <= 0) return 0
  return Math.max(1, Math.ceil(charCount / 5000)) * VIDEO_EDITOR_TRANSLATE_CREDITS_PER_5000_CHARS
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest __tests__/lib/video-editor-credits.test.ts`
Expected: PASS (including pre-existing render-credit cases).

- [ ] **Step 5: Commit**

```bash
git add lib/video-editor/credits.ts __tests__/lib/video-editor-credits.test.ts
git commit -m "feat(video-editor): credit estimators for transcription, tts and translation"
```

---

### Task 6: Cue engine — transcript → caption clips + proportional word timing

**Files:**
- Create: `lib/video-editor/captions.ts`
- Test: `__tests__/lib/video-editor-captions.test.ts`

- [ ] **Step 1: Write the failing test** — create `__tests__/lib/video-editor-captions.test.ts`:

```ts
import {
  cuesFromSegments,
  captionClipsFromTranscript,
  distributeWordsAcrossSpan,
} from '@/lib/video-editor/captions'
import type { TranscriptSegment, VideoEditorTranscript } from '@/lib/video-editor/types'

function seg(id: string, start: number, end: number, text: string, words: Array<[string, number, number]>): TranscriptSegment {
  return { id, start, end, text, words: words.map(([t, s, e]) => ({ text: t, start: s, end: e })) }
}

describe('cuesFromSegments', () => {
  it('groups words into cues and breaks on max chars', () => {
    const words: Array<[string, number, number]> = []
    for (let i = 0; i < 20; i += 1) words.push([`word${i}`, i * 0.3, i * 0.3 + 0.25])
    const cues = cuesFromSegments([seg('s1', 0, 6, words.map(([t]) => t).join(' '), words)], { maxCharsPerCue: 24 })
    expect(cues.length).toBeGreaterThan(1)
    for (const cue of cues) {
      expect(cue.text.length).toBeLessThanOrEqual(24)
      expect(cue.end).toBeGreaterThan(cue.start)
      expect(cue.words.length).toBeGreaterThan(0)
    }
    // No word lost, order preserved
    expect(cues.flatMap((c) => c.words.map((w) => w.text))).toEqual(words.map(([t]) => t))
  })

  it('breaks on silence gaps and sentence punctuation', () => {
    const cues = cuesFromSegments([
      seg('s1', 0, 5, 'Hello there. After a pause', [
        ['Hello', 0, 0.4], ['there.', 0.5, 0.9],
        ['After', 2.5, 2.9], ['a', 3.0, 3.1], ['pause', 3.2, 3.6],
      ]),
    ], { gapBreakSeconds: 0.6 })
    expect(cues.map((c) => c.text)).toEqual(['Hello there.', 'After a pause'])
    expect(cues[1].start).toBe(2.5)
  })

  it('falls back to whole segments when a segment has no words', () => {
    const cues = cuesFromSegments([seg('s1', 1, 3, 'No word timing here', [])], {})
    expect(cues).toEqual([{
      start: 1, end: 3, text: 'No word timing here',
      words: distributeWordsAcrossSpan('No word timing here', 1, 3),
    }])
  })
})

describe('distributeWordsAcrossSpan', () => {
  it('distributes proportionally to word length and covers the span', () => {
    const words = distributeWordsAcrossSpan('a bb ccc', 10, 16)
    expect(words.map((w) => w.text)).toEqual(['a', 'bb', 'ccc'])
    expect(words[0].start).toBe(10)
    expect(words[2].end).toBe(16)
    expect(words[1].start).toBeCloseTo(words[0].end, 5)
    // longer words get more time
    expect(words[2].end - words[2].start).toBeGreaterThan(words[0].end - words[0].start)
  })
  it('returns [] for empty text or inverted spans', () => {
    expect(distributeWordsAcrossSpan('', 0, 1)).toEqual([])
    expect(distributeWordsAcrossSpan('x', 2, 1)).toEqual([])
  })
})

describe('captionClipsFromTranscript', () => {
  const transcript = {
    id: 'tr-1', orgId: 'o', projectId: 'p', source: 'media', status: 'completed', language: 'en',
    segments: [seg('s1', 0.5, 2.0, 'Hello world', [['Hello', 0.5, 1.0], ['world', 1.2, 1.9]])],
    text: 'Hello world', provider: 'gateway', alignment: 'provider',
    credits: { estimated: 1, charged: 1, refunded: 0 }, deleted: false,
  } as VideoEditorTranscript & { id: string }

  it('produces caption clips with clip-relative word offsets', () => {
    const clips = captionClipsFromTranscript(transcript, { stylePreset: 'boxed', animationPreset: 'karaoke', idPrefix: 'cap-tr-1' })
    expect(clips).toHaveLength(1)
    expect(clips[0]).toMatchObject({
      id: 'cap-tr-1-1',
      timelineStart: 0.5,
      duration: 1.5,
      caption: {
        text: 'Hello world',
        stylePreset: 'boxed',
        animationPreset: 'karaoke',
        transcriptId: 'tr-1',
        language: 'en',
        words: [
          { text: 'Hello', offsetStart: 0, offsetEnd: 0.5 },
          { text: 'world', offsetStart: 0.7, offsetEnd: 1.4 },
        ],
      },
    })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/lib/video-editor-captions.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement** — create `lib/video-editor/captions.ts`:

```ts
import type {
  EditorCaptionAnimationPreset,
  EditorCaptionStylePreset,
  EditorClip,
  TranscriptSegment,
  TranscriptWord,
  VideoEditorTranscript,
} from './types'

export interface CaptionCue {
  /** Absolute timeline seconds. */
  start: number
  end: number
  text: string
  words: TranscriptWord[]
}

export interface CueOptions {
  maxCharsPerCue?: number
  maxCueDurationSeconds?: number
  gapBreakSeconds?: number
}

const DEFAULT_MAX_CHARS = 42
const DEFAULT_MAX_DURATION = 5
const DEFAULT_GAP_BREAK = 0.6
const MIN_CUE_DURATION = 0.2

function round3(value: number): number {
  return Math.round(value * 1000) / 1000
}

/**
 * Estimated word timing when a provider gives none (Gateway TTS, wordless
 * segments): distribute the span across words proportionally to
 * (characters + 1) so longer words hold longer.
 */
export function distributeWordsAcrossSpan(text: string, startSeconds: number, endSeconds: number): TranscriptWord[] {
  const tokens = text.split(/\s+/).filter(Boolean)
  const span = endSeconds - startSeconds
  if (!tokens.length || !(span > 0)) return []
  const weights = tokens.map((token) => token.length + 1)
  const total = weights.reduce((sum, weight) => sum + weight, 0)
  const words: TranscriptWord[] = []
  let cursor = startSeconds
  tokens.forEach((token, index) => {
    const slice = (weights[index] / total) * span
    const end = index === tokens.length - 1 ? endSeconds : cursor + slice
    words.push({ text: token, start: round3(cursor), end: round3(end) })
    cursor = end
  })
  return words
}

function flushCue(cues: CaptionCue[], words: TranscriptWord[]) {
  if (!words.length) return
  cues.push({
    start: round3(words[0].start),
    end: round3(Math.max(words[words.length - 1].end, words[0].start + MIN_CUE_DURATION)),
    text: words.map((word) => word.text).join(' '),
    words: [...words],
  })
  words.length = 0
}

/**
 * Chunk transcript words into readable cues. Break when adding a word would
 * exceed maxChars or maxDuration, after a silence gap, or after sentence-final
 * punctuation once the cue has some substance.
 */
export function cuesFromSegments(segments: TranscriptSegment[], options: CueOptions = {}): CaptionCue[] {
  const maxChars = options.maxCharsPerCue ?? DEFAULT_MAX_CHARS
  const maxDuration = options.maxCueDurationSeconds ?? DEFAULT_MAX_DURATION
  const gapBreak = options.gapBreakSeconds ?? DEFAULT_GAP_BREAK
  const cues: CaptionCue[] = []
  const pending: TranscriptWord[] = []

  for (const segment of segments) {
    const words = segment.words.length ? segment.words : distributeWordsAcrossSpan(segment.text, segment.start, segment.end)
    for (const word of words) {
      if (pending.length) {
        const previous = pending[pending.length - 1]
        const nextText = `${pending.map((w) => w.text).join(' ')} ${word.text}`
        const nextDuration = word.end - pending[0].start
        const gap = word.start - previous.end
        const sentenceEnd = /[.!?]$/.test(previous.text) && pending.map((w) => w.text).join(' ').length >= 12
        if (nextText.length > maxChars || nextDuration > maxDuration || gap > gapBreak || sentenceEnd) {
          flushCue(cues, pending)
        }
      }
      pending.push(word)
    }
    // Segment boundaries are natural cue boundaries for wordless segments.
    if (!segment.words.length) flushCue(cues, pending)
  }
  flushCue(cues, pending)
  return cues
}

export function captionClipsFromTranscript(
  transcript: VideoEditorTranscript & { id: string },
  options: {
    stylePreset: EditorCaptionStylePreset
    animationPreset: EditorCaptionAnimationPreset
    idPrefix: string
    cueOptions?: CueOptions
  },
): EditorClip[] {
  const cues = cuesFromSegments(transcript.segments ?? [], options.cueOptions ?? {})
  return cues.map((cue, index) => ({
    id: `${options.idPrefix}-${index + 1}`,
    timelineStart: cue.start,
    duration: round3(Math.max(cue.end - cue.start, MIN_CUE_DURATION)),
    caption: {
      text: cue.text,
      words: cue.words.map((word) => ({
        text: word.text,
        offsetStart: round3(Math.max(0, word.start - cue.start)),
        offsetEnd: round3(Math.max(0, word.end - cue.start)),
      })),
      stylePreset: options.stylePreset,
      animationPreset: options.animationPreset,
      transcriptId: transcript.id,
      language: transcript.language,
    },
  }))
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest __tests__/lib/video-editor-captions.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/video-editor/captions.ts __tests__/lib/video-editor-captions.test.ts
git commit -m "feat(video-editor): caption cue engine from transcripts"
```

---

### Task 7: Cue ops (split/merge/nudge) + SRT/VTT serializers

**Files:**
- Modify: `lib/video-editor/captions.ts`
- Test: `__tests__/lib/video-editor-captions.test.ts`

- [ ] **Step 1: Write the failing test** — append to `__tests__/lib/video-editor-captions.test.ts`:

```ts
import {
  collectCaptionCues,
  mergeCaptionCueWithNext,
  nudgeCaptionCue,
  serializeSrt,
  serializeVtt,
  splitCaptionCue,
} from '@/lib/video-editor/captions'
import type { EditorTimeline } from '@/lib/video-editor/types'

function captionTimeline(): EditorTimeline {
  return {
    version: 1,
    tracks: [{
      id: 'track-caption-1',
      kind: 'caption',
      clips: [
        {
          id: 'cue-1', timelineStart: 1, duration: 2,
          caption: {
            text: 'Hello there world', stylePreset: 'clean', animationPreset: 'none',
            words: [
              { text: 'Hello', offsetStart: 0, offsetEnd: 0.5 },
              { text: 'there', offsetStart: 0.6, offsetEnd: 1.1 },
              { text: 'world', offsetStart: 1.3, offsetEnd: 1.9 },
            ],
          },
        },
        {
          id: 'cue-2', timelineStart: 3.5, duration: 1,
          caption: {
            text: 'Second cue', stylePreset: 'clean', animationPreset: 'none',
            words: [
              { text: 'Second', offsetStart: 0, offsetEnd: 0.4 },
              { text: 'cue', offsetStart: 0.5, offsetEnd: 0.9 },
            ],
          },
        },
      ],
    }],
  }
}

describe('caption cue ops', () => {
  it('splits a cue at the nearest word boundary', () => {
    const next = splitCaptionCue(captionTimeline(), 'track-caption-1', 'cue-1', 1.65)
    const clips = next.tracks[0].clips
    expect(clips).toHaveLength(3)
    expect(clips[0].caption!.text).toBe('Hello')
    expect(clips[0].duration).toBeCloseTo(0.6, 3)
    expect(clips[1].id).toBe('cue-1-s1')
    expect(clips[1].caption!.text).toBe('there world')
    expect(clips[1].timelineStart).toBeCloseTo(1.6, 3)
    expect(clips[1].caption!.words[0]).toEqual({ text: 'there', offsetStart: 0, offsetEnd: 0.5 })
  })

  it('refuses to split a one-word cue', () => {
    const one = captionTimeline()
    one.tracks[0].clips[0].caption!.words = [{ text: 'Hello', offsetStart: 0, offsetEnd: 1.9 }]
    one.tracks[0].clips[0].caption!.text = 'Hello'
    expect(() => splitCaptionCue(one, 'track-caption-1', 'cue-1', 1.5)).toThrow('at least two words')
  })

  it('merges a cue with the next one', () => {
    const next = mergeCaptionCueWithNext(captionTimeline(), 'track-caption-1', 'cue-1')
    const clips = next.tracks[0].clips
    expect(clips).toHaveLength(1)
    expect(clips[0].caption!.text).toBe('Hello there world Second cue')
    expect(clips[0].timelineStart).toBe(1)
    expect(clips[0].duration).toBeCloseTo(3.5, 3) // ends where cue-2 ended (4.5)
    // cue-2 words re-offset against cue-1 start: 3.5 - 1 = 2.5
    expect(clips[0].caption!.words[3]).toEqual({ text: 'Second', offsetStart: 2.5, offsetEnd: 2.9 })
  })

  it('nudges a cue and rejects overlaps', () => {
    const next = nudgeCaptionCue(captionTimeline(), 'track-caption-1', 'cue-2', -0.3)
    expect(next.tracks[0].clips[1].timelineStart).toBeCloseTo(3.2, 3)
    expect(() => nudgeCaptionCue(captionTimeline(), 'track-caption-1', 'cue-2', -1)).toThrow('overlap')
  })
})

describe('sidecar serializers', () => {
  it('collects absolute cues from caption tracks', () => {
    const cues = collectCaptionCues(captionTimeline())
    expect(cues.map((c) => [c.start, c.end, c.text])).toEqual([
      [1, 3, 'Hello there world'],
      [3.5, 4.5, 'Second cue'],
    ])
  })
  it('serializes SRT', () => {
    expect(serializeSrt(collectCaptionCues(captionTimeline()))).toBe(
      '1\n00:00:01,000 --> 00:00:03,000\nHello there world\n\n2\n00:00:03,500 --> 00:00:04,500\nSecond cue\n',
    )
  })
  it('serializes VTT', () => {
    expect(serializeVtt(collectCaptionCues(captionTimeline()))).toBe(
      'WEBVTT\n\n00:00:01.000 --> 00:00:03.000\nHello there world\n\n00:00:03.500 --> 00:00:04.500\nSecond cue\n',
    )
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/lib/video-editor-captions.test.ts -t "cue ops"`
Expected: FAIL — new exports missing.

- [ ] **Step 3: Implement** — append to `lib/video-editor/captions.ts`:

```ts
import type { EditorTimeline, EditorTrack } from './types' // merge into the existing import block at the top

export class CaptionOpError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CaptionOpError'
  }
}

function cloneTimeline(timeline: EditorTimeline): EditorTimeline {
  return JSON.parse(JSON.stringify(timeline)) as EditorTimeline
}

function findCaptionClip(timeline: EditorTimeline, trackId: string, clipId: string) {
  const track = timeline.tracks.find((item) => item.id === trackId)
  if (!track || track.kind !== 'caption') throw new CaptionOpError(`Caption track '${trackId}' not found.`)
  const index = track.clips.findIndex((item) => item.id === clipId)
  if (index < 0 || !track.clips[index].caption) throw new CaptionOpError(`Caption cue '${clipId}' not found.`)
  return { track, index }
}

function assertNoCaptionOverlap(track: EditorTrack) {
  const sorted = [...track.clips].sort((a, b) => a.timelineStart - b.timelineStart)
  let previousEnd = -Infinity
  let previousId = ''
  for (const clip of sorted) {
    if (clip.timelineStart < previousEnd - 0.0005) {
      throw new CaptionOpError(`Cues '${previousId}' and '${clip.id}' overlap on track '${track.id}'.`)
    }
    previousEnd = clip.timelineStart + clip.duration
    previousId = clip.id
  }
  track.clips = sorted
}

/** Split at the word boundary nearest to atTimelineSeconds. */
export function splitCaptionCue(timeline: EditorTimeline, trackId: string, clipId: string, atTimelineSeconds: number): EditorTimeline {
  const next = cloneTimeline(timeline)
  const { track, index } = findCaptionClip(next, trackId, clipId)
  const clip = track.clips[index]
  const words = clip.caption!.words
  if (words.length < 2) throw new CaptionOpError('Splitting a cue requires at least two words.')

  const targetOffset = atTimelineSeconds - clip.timelineStart
  let splitAt = 1
  let best = Infinity
  for (let i = 1; i < words.length; i += 1) {
    const distance = Math.abs(words[i].offsetStart - targetOffset)
    if (distance < best) { best = distance; splitAt = i }
  }

  const leftWords = words.slice(0, splitAt)
  const rightWords = words.slice(splitAt)
  const rightStartOffset = rightWords[0].offsetStart
  const originalEnd = clip.timelineStart + clip.duration

  const existingIds = new Set(track.clips.map((item) => item.id))
  let suffix = 1
  while (existingIds.has(`${clipId}-s${suffix}`)) suffix += 1

  const right = {
    ...(JSON.parse(JSON.stringify(clip)) as typeof clip),
    id: `${clipId}-s${suffix}`,
    timelineStart: round3(clip.timelineStart + rightStartOffset),
    duration: round3(originalEnd - (clip.timelineStart + rightStartOffset)),
  }
  right.caption = {
    ...clip.caption!,
    text: rightWords.map((word) => word.text).join(' '),
    words: rightWords.map((word) => ({
      text: word.text,
      offsetStart: round3(word.offsetStart - rightStartOffset),
      offsetEnd: round3(word.offsetEnd - rightStartOffset),
    })),
  }

  clip.duration = round3(leftWords[leftWords.length - 1].offsetEnd)
  clip.caption = { ...clip.caption!, text: leftWords.map((word) => word.text).join(' '), words: leftWords }

  track.clips.splice(index + 1, 0, right)
  assertNoCaptionOverlap(track)
  return next
}

export function mergeCaptionCueWithNext(timeline: EditorTimeline, trackId: string, clipId: string): EditorTimeline {
  const next = cloneTimeline(timeline)
  const { track, index } = findCaptionClip(next, trackId, clipId)
  const clip = track.clips[index]
  const sibling = track.clips[index + 1]
  if (!sibling?.caption) throw new CaptionOpError('There is no next cue to merge with.')

  const shift = sibling.timelineStart - clip.timelineStart
  clip.caption = {
    ...clip.caption!,
    text: `${clip.caption!.text} ${sibling.caption.text}`,
    words: [
      ...clip.caption!.words,
      ...sibling.caption.words.map((word) => ({
        text: word.text,
        offsetStart: round3(word.offsetStart + shift),
        offsetEnd: round3(word.offsetEnd + shift),
      })),
    ],
  }
  clip.duration = round3(shift + sibling.duration)
  track.clips.splice(index + 1, 1)
  assertNoCaptionOverlap(track)
  return next
}

export function nudgeCaptionCue(timeline: EditorTimeline, trackId: string, clipId: string, deltaSeconds: number): EditorTimeline {
  const next = cloneTimeline(timeline)
  const { track, index } = findCaptionClip(next, trackId, clipId)
  const clip = track.clips[index]
  clip.timelineStart = round3(Math.max(0, clip.timelineStart + deltaSeconds))
  assertNoCaptionOverlap(track)
  return next
}

export function collectCaptionCues(timeline: EditorTimeline, trackId?: string): CaptionCue[] {
  const cues: CaptionCue[] = []
  for (const track of timeline.tracks ?? []) {
    if (track.kind !== 'caption') continue
    if (trackId && track.id !== trackId) continue
    for (const clip of track.clips ?? []) {
      if (!clip.caption) continue
      cues.push({
        start: clip.timelineStart,
        end: round3(clip.timelineStart + clip.duration),
        text: clip.caption.text,
        words: clip.caption.words.map((word) => ({
          text: word.text,
          start: round3(clip.timelineStart + word.offsetStart),
          end: round3(clip.timelineStart + word.offsetEnd),
        })),
      })
    }
  }
  return cues.sort((a, b) => a.start - b.start)
}

function pad(value: number, width: number): string {
  return String(value).padStart(width, '0')
}

function clockParts(seconds: number) {
  const total = Math.max(0, seconds)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = Math.floor(total % 60)
  const ms = Math.round((total - Math.floor(total)) * 1000)
  return { h, m, s, ms }
}

export function formatSrtTime(seconds: number): string {
  const { h, m, s, ms } = clockParts(seconds)
  return `${pad(h, 2)}:${pad(m, 2)}:${pad(s, 2)},${pad(ms, 3)}`
}

export function formatVttTime(seconds: number): string {
  const { h, m, s, ms } = clockParts(seconds)
  return `${pad(h, 2)}:${pad(m, 2)}:${pad(s, 2)}.${pad(ms, 3)}`
}

export function serializeSrt(cues: CaptionCue[]): string {
  return cues
    .map((cue, index) => `${index + 1}\n${formatSrtTime(cue.start)} --> ${formatSrtTime(cue.end)}\n${cue.text}\n`)
    .join('\n')
}

export function serializeVtt(cues: CaptionCue[]): string {
  const body = cues
    .map((cue) => `${formatVttTime(cue.start)} --> ${formatVttTime(cue.end)}\n${cue.text}\n`)
    .join('\n')
  return `WEBVTT\n\n${body}`
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest __tests__/lib/video-editor-captions.test.ts`
Expected: PASS (all describes).

- [ ] **Step 5: Commit**

```bash
git add lib/video-editor/captions.ts __tests__/lib/video-editor-captions.test.ts
git commit -m "feat(video-editor): caption cue ops and srt/vtt sidecar serializers"
```

---

### Task 8: Server-side storage helper for generated files

**Files:**
- Create: `lib/video-editor/storage.ts`
- Test: `__tests__/lib/video-editor-storage.test.ts`

The `/api/v1/upload` route couples Storage writes to multipart requests. TTS audio and caption sidecars are generated server-side, so extract the same save-buffer + `uploads`-doc logic into a helper both can use (behaviour parity with `app/api/v1/upload/route.ts` lines 36–63).

- [ ] **Step 1: Write the failing test** — create `__tests__/lib/video-editor-storage.test.ts`:

```ts
const saveMock = jest.fn().mockResolvedValue(undefined)
const addMock = jest.fn().mockResolvedValue({ id: 'upload-1' })

jest.mock('@/lib/firebase/admin', () => ({
  getAdminApp: jest.fn(() => ({})),
  adminDb: { collection: jest.fn(() => ({ add: addMock })) },
}))
jest.mock('firebase-admin/storage', () => ({
  getStorage: jest.fn(() => ({
    bucket: jest.fn(() => ({ name: 'pib-bucket', file: jest.fn(() => ({ save: saveMock })) })),
  })),
}))
jest.mock('firebase-admin/firestore', () => ({
  FieldValue: { serverTimestamp: jest.fn(() => 'ts') },
}))

import { saveVideoEditorUpload } from '@/lib/video-editor/storage'
import type { ApiUser } from '@/lib/api/types'

const user = { uid: 'u1', role: 'admin', email: 'p@x.test' } as ApiUser

describe('saveVideoEditorUpload', () => {
  beforeEach(() => jest.clearAllMocks())

  it('saves the buffer and creates an uploads doc', async () => {
    const result = await saveVideoEditorUpload(Buffer.from('abc'), {
      orgId: 'org-1',
      folder: 'video-editor/org-1/p-1',
      filename: 'voiceover-1.wav',
      mimeType: 'audio/wav',
      user,
    })
    expect(result.id).toBe('upload-1')
    expect(result.storagePath).toBe('video-editor/org-1/p-1/voiceover-1.wav')
    expect(result.url).toContain('firebasestorage.googleapis.com')
    expect(result.url).toContain(encodeURIComponent('video-editor/org-1/p-1/voiceover-1.wav'))
    expect(saveMock).toHaveBeenCalledTimes(1)
    expect(addMock).toHaveBeenCalledWith(expect.objectContaining({
      orgId: 'org-1', mimeType: 'audio/wav', deleted: false, size: 3,
    }))
  })

  it('strips unsafe filename characters', async () => {
    const result = await saveVideoEditorUpload(Buffer.from('x'), {
      orgId: 'org-1', folder: 'video-editor/org-1/p-1', filename: '../..//evil name!.wav', mimeType: 'audio/wav', user,
    })
    expect(result.storagePath).toBe('video-editor/org-1/p-1/....evilname.wav')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/lib/video-editor-storage.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement** — create `lib/video-editor/storage.ts`:

```ts
import crypto from 'crypto'
import { FieldValue } from 'firebase-admin/firestore'
import { getStorage } from 'firebase-admin/storage'
import { adminDb, getAdminApp } from '@/lib/firebase/admin'
import { actorFrom } from '@/lib/api/actor'
import type { ApiUser } from '@/lib/api/types'

export interface SavedVideoEditorUpload {
  id: string
  url: string
  storagePath: string
  sizeBytes: number
}

/**
 * Server-side twin of POST /api/v1/upload: writes a generated buffer to
 * Firebase Storage with a download token and records an `uploads` doc so the
 * file is a first-class MediaRef ({ type: 'upload', fileId }).
 */
export async function saveVideoEditorUpload(
  buffer: Buffer,
  input: { orgId: string; folder: string; filename: string; mimeType: string; user: ApiUser; relatedTo?: { type: string; id: string } },
): Promise<SavedVideoEditorUpload> {
  const safeFilename = input.filename.replace(/[^a-zA-Z0-9._-]/g, '').slice(0, 120)
  if (!safeFilename) throw new Error('A filename is required')
  const storagePath = `${input.folder}/${safeFilename}`

  const bucket = getStorage(getAdminApp()).bucket()
  const downloadToken = crypto.randomUUID()
  await bucket.file(storagePath).save(buffer, {
    metadata: { contentType: input.mimeType, metadata: { firebaseStorageDownloadTokens: downloadToken } },
  })
  const url = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(storagePath)}?alt=media&token=${downloadToken}`

  const docRef = await adminDb.collection('uploads').add({
    orgId: input.orgId,
    name: safeFilename,
    storagePath,
    url,
    mimeType: input.mimeType,
    size: buffer.length,
    folder: input.folder,
    relatedTo: input.relatedTo ?? null,
    ...actorFrom(input.user),
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
    deleted: false,
  })

  return { id: docRef.id, url, storagePath, sizeBytes: buffer.length }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest __tests__/lib/video-editor-storage.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/video-editor/storage.ts __tests__/lib/video-editor-storage.test.ts
git commit -m "feat(video-editor): server-side upload helper for generated audio and sidecars"
```

---

### Task 9: BYOK provider entries — `openai_audio` + `elevenlabs`

**Files:**
- Modify: `lib/creative-canvas/types.ts` (union at line ~49)
- Modify: `lib/creative-canvas/providers.ts`
- Test: `__tests__/lib/creative-canvas-audio-providers.test.ts`

The existing connections framework (`lib/creative-canvas/connections/*`) is generic over `CreativeCanvasProviderKey` — adding two keys gives us encrypted per-org/per-user key storage, the resolver precedence (user → org → shared), masked API responses and the connections UI for free. `resolveCreativeProviderCredential` returns `connection_required` for unknown-shared providers; our routes interpret that as "no BYOK → use the platform Gateway default", so the resolver needs **no change**.

- [ ] **Step 1: Write the failing test** — create `__tests__/lib/creative-canvas-audio-providers.test.ts`:

```ts
import { getCreativeCanvasProvider } from '@/lib/creative-canvas/providers'

describe('audio BYOK providers', () => {
  it('registers openai_audio with api_key connection support', () => {
    const provider = getCreativeCanvasProvider('openai_audio')
    expect(provider?.label).toBe('OpenAI-compatible audio (Whisper + TTS)')
    expect(provider?.connection?.authKind).toBe('api_key')
    expect(provider?.connection?.credentialFields.map((f) => f.key)).toEqual(['apiKey', 'baseUrl'])
  })
  it('registers elevenlabs with api_key connection support', () => {
    const provider = getCreativeCanvasProvider('elevenlabs')
    expect(provider?.label).toBe('ElevenLabs (TTS)')
    expect(provider?.connection?.authKind).toBe('api_key')
    expect(provider?.connection?.credentialFields.map((f) => f.key)).toEqual(['apiKey'])
  })
})
```

> If `providers.ts` exports a lookup with a different name, mirror how existing tests/API routes read the registry (check `grep -n "export" lib/creative-canvas/providers.ts`) and use that accessor — the assertions stay the same.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/lib/creative-canvas-audio-providers.test.ts`
Expected: FAIL — unknown provider keys.

- [ ] **Step 3: Implement**

In `lib/creative-canvas/types.ts`, extend the union:

```ts
export type CreativeCanvasProviderKey =
  | 'higgsfield'
  | 'xai'
  | 'google'
  | 'fal'
  | 'recraft'
  | 'manual_upload'
  | 'text_generation'
  | 'document_generation'
  | 'agent_task'
  | 'openai_audio'
  | 'elevenlabs'
```

In `lib/creative-canvas/providers.ts`, append to the `PROVIDERS` array (field-for-field the same shape as the `xai` entry — copy any additional required fields the file's entries carry):

```ts
  {
    key: 'openai_audio',
    label: 'OpenAI-compatible audio (Whisper + TTS)',
    capabilities: ['analyze_media'],
    supportedInputKinds: ['upload', 'url'],
    supportedOutputKinds: ['audio', 'caption'],
    isAsync: true,
    usesExternalCredits: true,
    riskLevel: 'low',
    requiresApprovalBeforeClientVisibility: false,
    ownerAgentId: 'maya',
    connection: {
      authKind: 'api_key',
      credentialFields: [
        { key: 'apiKey', label: 'API key', secret: true, placeholder: 'sk-…' },
        { key: 'baseUrl', label: 'Base URL (optional, OpenAI-compatible)', secret: false, placeholder: 'https://api.openai.com/v1' },
      ],
      consoleUrl: 'https://platform.openai.com/api-keys',
      docsUrl: 'https://platform.openai.com/docs/guides/speech-to-text',
    },
  },
  {
    key: 'elevenlabs',
    label: 'ElevenLabs (TTS)',
    capabilities: ['analyze_media'],
    supportedInputKinds: ['upload', 'url'],
    supportedOutputKinds: ['audio', 'caption'],
    isAsync: false,
    usesExternalCredits: true,
    riskLevel: 'low',
    requiresApprovalBeforeClientVisibility: false,
    ownerAgentId: 'maya',
    connection: {
      authKind: 'api_key',
      credentialFields: [{ key: 'apiKey', label: 'API key', secret: true, placeholder: 'sk_…' }],
      consoleUrl: 'https://elevenlabs.io/app/settings/api-keys',
      docsUrl: 'https://elevenlabs.io/docs/api-reference/text-to-speech',
    },
  },
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest __tests__/lib/creative-canvas-audio-providers.test.ts && npx jest __tests__/lib/creative-canvas 2>/dev/null; npx jest creative-canvas`
Expected: PASS, and no regressions in existing creative-canvas suites (the union widening is additive; if any exhaustive `switch` over provider keys fails typecheck, add `openai_audio`/`elevenlabs` no-op branches there).

- [ ] **Step 5: Commit**

```bash
git add lib/creative-canvas/types.ts lib/creative-canvas/providers.ts __tests__/lib/creative-canvas-audio-providers.test.ts
git commit -m "feat(creative-canvas): openai_audio and elevenlabs BYOK provider entries"
```

---

### Task 10: Transcription manifest + executor dispatch

**Files:**
- Create: `lib/video-editor/transcribe-dispatch.ts`
- Test: `__tests__/lib/video-editor-transcribe-dispatch.test.ts`

- [ ] **Step 1: Write the failing test** — create `__tests__/lib/video-editor-transcribe-dispatch.test.ts`:

```ts
import {
  buildTranscriptionManifest,
  dispatchTranscriptionJob,
  transcriptionRuntimeConfigFromEnv,
} from '@/lib/video-editor/transcribe-dispatch'

describe('transcriptionRuntimeConfigFromEnv', () => {
  it('derives the submit url from HIGGSFIELD_RUNTIME_URL', () => {
    const config = transcriptionRuntimeConfigFromEnv({
      HIGGSFIELD_RUNTIME_URL: 'https://vps.example/higgsfield-executor/',
      HIGGSFIELD_RUNTIME_API_KEY: 'k',
      NEXT_PUBLIC_APP_URL: 'https://partnersinbiz.online/',
    } as NodeJS.ProcessEnv)
    expect(config).toEqual({
      submitUrl: 'https://vps.example/higgsfield-executor/video-editor/transcriptions',
      apiKey: 'k',
      callbackBaseUrl: 'https://partnersinbiz.online',
    })
  })
  it('honours the explicit override', () => {
    const config = transcriptionRuntimeConfigFromEnv({
      VIDEO_EDITOR_TRANSCRIBE_SUBMIT_URL: 'https://other.example/transcriptions',
    } as NodeJS.ProcessEnv)
    expect(config.submitUrl).toBe('https://other.example/transcriptions')
  })
})

describe('buildTranscriptionManifest', () => {
  it('builds the executor contract', () => {
    const manifest = buildTranscriptionManifest({
      transcriptId: 't-1', orgId: 'org-1', projectId: 'p-1',
      media: { url: 'https://firebasestorage.googleapis.com/v0/b/x/o/a.mp4?alt=media', mediaKind: 'video' },
      language: 'en',
      byok: { apiKey: 'sk-user', baseUrl: 'https://api.openai.com/v1' },
    })
    expect(manifest).toEqual({
      kind: 'video_editor_transcription',
      job: { id: 't-1', orgId: 'org-1', projectId: 'p-1' },
      media: { url: 'https://firebasestorage.googleapis.com/v0/b/x/o/a.mp4?alt=media', mediaKind: 'video' },
      language: 'en',
      byok: { apiKey: 'sk-user', baseUrl: 'https://api.openai.com/v1' },
      report: { method: 'PUT', path: '/api/v1/video-editor/transcripts/t-1?orgId=org-1' },
    })
  })
  it('omits byok when the platform gateway is used', () => {
    const manifest = buildTranscriptionManifest({
      transcriptId: 't-2', orgId: 'org-1', projectId: 'p-1',
      media: { url: 'https://x.test/a.mp3', mediaKind: 'audio' },
    })
    expect(manifest.byok).toBeUndefined()
    expect(manifest.language).toBeUndefined()
  })
})

describe('dispatchTranscriptionJob', () => {
  const manifest = buildTranscriptionManifest({
    transcriptId: 't-1', orgId: 'org-1', projectId: 'p-1',
    media: { url: 'https://x.test/a.mp3', mediaKind: 'audio' },
  })

  afterEach(() => { (global.fetch as jest.Mock | undefined)?.mockRestore?.() })

  it('POSTs the manifest with callback and returns providerJobId', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({ providerJobId: 'vtx-1' }),
    }) as unknown as typeof fetch
    const result = await dispatchTranscriptionJob(manifest, {
      submitUrl: 'https://vps.example/video-editor/transcriptions', apiKey: 'k', callbackBaseUrl: 'https://app.example',
    })
    expect(result).toEqual({ providerJobId: 'vtx-1' })
    const [url, init] = (global.fetch as jest.Mock).mock.calls[0]
    expect(url).toBe('https://vps.example/video-editor/transcriptions')
    expect(init.headers.Authorization).toBe('Bearer k')
    const body = JSON.parse(init.body)
    expect(body.callback.url).toBe('https://app.example/api/v1/video-editor/transcripts/t-1')
  })

  it('throws when the executor rejects or omits providerJobId', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 503, text: async () => 'down' }) as unknown as typeof fetch
    await expect(dispatchTranscriptionJob(manifest, { submitUrl: 'https://vps.example/x' })).rejects.toThrow('503')
    global.fetch = jest.fn().mockResolvedValue({ ok: true, text: async () => '{}' }) as unknown as typeof fetch
    await expect(dispatchTranscriptionJob(manifest, { submitUrl: 'https://vps.example/x' })).rejects.toThrow('providerJobId')
    await expect(dispatchTranscriptionJob(manifest, {})).rejects.toThrow('not configured')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/lib/video-editor-transcribe-dispatch.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement** — create `lib/video-editor/transcribe-dispatch.ts` (mirrors `dispatch.ts` shape):

```ts
export interface TranscriptionRuntimeConfig {
  submitUrl?: string
  apiKey?: string
  callbackBaseUrl?: string
}

function cleanString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

export function transcriptionRuntimeConfigFromEnv(env: NodeJS.ProcessEnv = process.env): TranscriptionRuntimeConfig {
  const baseUrl = cleanString(env.HIGGSFIELD_RUNTIME_URL)?.replace(/\/$/, '')
  const appUrl = (cleanString(env.NEXT_PUBLIC_APP_URL) ?? cleanString(env.NEXT_PUBLIC_BASE_URL))?.replace(/\/$/, '')
  const submitUrl = cleanString(env.VIDEO_EDITOR_TRANSCRIBE_SUBMIT_URL)
    ?? (baseUrl ? `${baseUrl}/video-editor/transcriptions` : undefined)
  return {
    ...(submitUrl ? { submitUrl } : {}),
    ...(cleanString(env.HIGGSFIELD_RUNTIME_API_KEY) ? { apiKey: cleanString(env.HIGGSFIELD_RUNTIME_API_KEY) } : {}),
    ...(appUrl ? { callbackBaseUrl: appUrl } : {}),
  }
}

export interface VideoEditorTranscriptionManifest {
  kind: 'video_editor_transcription'
  job: { id: string; orgId: string; projectId: string }
  media: { url: string; mediaKind: 'video' | 'audio' }
  language?: string
  /** BYOK override — scoped to this job only; the executor must never persist it. */
  byok?: { apiKey: string; baseUrl?: string; model?: string }
  report: { method: 'PUT'; path: string }
}

export function buildTranscriptionManifest(input: {
  transcriptId: string
  orgId: string
  projectId: string
  media: { url: string; mediaKind: 'video' | 'audio' }
  language?: string
  byok?: { apiKey: string; baseUrl?: string; model?: string }
}): VideoEditorTranscriptionManifest {
  return {
    kind: 'video_editor_transcription',
    job: { id: input.transcriptId, orgId: input.orgId, projectId: input.projectId },
    media: input.media,
    ...(input.language ? { language: input.language } : {}),
    ...(input.byok ? { byok: input.byok } : {}),
    report: {
      method: 'PUT',
      path: `/api/v1/video-editor/transcripts/${input.transcriptId}?orgId=${encodeURIComponent(input.orgId)}`,
    },
  }
}

export async function dispatchTranscriptionJob(
  manifest: VideoEditorTranscriptionManifest,
  config: TranscriptionRuntimeConfig,
): Promise<{ providerJobId: string }> {
  if (!config.submitUrl) {
    throw new Error('Transcription runtime is not configured (set HIGGSFIELD_RUNTIME_URL or VIDEO_EDITOR_TRANSCRIBE_SUBMIT_URL)')
  }
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (config.apiKey) headers.Authorization = `Bearer ${config.apiKey}`
  const response = await fetch(config.submitUrl, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      ...manifest,
      callback: {
        url: config.callbackBaseUrl
          ? `${config.callbackBaseUrl}/api/v1/video-editor/transcripts/${manifest.job.id}`
          : undefined,
      },
    }),
  })
  const text = await response.text().catch(() => '')
  if (!response.ok) throw new Error(`Executor rejected the transcription (${response.status}): ${text.slice(0, 300)}`)
  let body: Record<string, unknown> = {}
  try { body = JSON.parse(text) as Record<string, unknown> } catch { body = {} }
  const providerJobId = typeof body.providerJobId === 'string' ? body.providerJobId : ''
  if (!providerJobId) throw new Error('Executor accepted the transcription but returned no providerJobId')
  return { providerJobId }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest __tests__/lib/video-editor-transcribe-dispatch.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/video-editor/transcribe-dispatch.ts __tests__/lib/video-editor-transcribe-dispatch.test.ts
git commit -m "feat(video-editor): transcription manifest and executor dispatch"
```

---

### Task 11: API — create + list transcripts

**Files:**
- Create: `app/api/v1/video-editor/transcripts/route.ts`
- Test: `__tests__/api/video-editor-transcripts.test.ts`

Contract: `POST { projectId, clipId?, language? }` — with `clipId`, transcribe that clip's media (video/audio); without, transcribe the project's `lastRender` (the "whole timeline" action; if the project has never rendered, return 400 telling the caller to render first — transcribing an unrendered multi-track mix would mean rendering it anyway). Charge on dispatch, refund on dispatch failure. `GET ?projectId=` lists transcripts for a project (equality-only filters — no composite index needed).

- [ ] **Step 1: Write the failing test** — create `__tests__/api/video-editor-transcripts.test.ts`:

```ts
import { NextRequest } from 'next/server'

jest.mock('@/lib/api/auth', () => ({
  withAuth: (_role: string, handler: (...args: unknown[]) => unknown) =>
    (req: NextRequest, context?: unknown) => handler(req, { uid: 'u1', role: 'admin', email: 'p@x.test' }, context),
}))
jest.mock('@/lib/youtube-studio/api', () => ({
  actorFields: jest.fn(() => ({ createdBy: 'u1', createdByType: 'user' })),
  updateActorFields: jest.fn(() => ({ updatedBy: 'u1', updatedByType: 'user' })),
  ensureOrgAccess: jest.fn().mockResolvedValue(null),
  loadScopedRecord: jest.fn(),
}))
jest.mock('@/lib/creative-canvas/credits', () => ({
  getCanvasCredits: jest.fn().mockResolvedValue({ orgId: 'org-1', used: 0, limit: null, updatedAt: null }),
  hasSufficientCredits: jest.fn().mockReturnValue(true),
  recordCanvasCreditUsage: jest.fn().mockResolvedValue({}),
  refundCanvasCreditUsage: jest.fn().mockResolvedValue({ amount: 1, adjusted: true }),
}))
jest.mock('@/lib/creative-canvas/connections/resolve', () => ({
  resolveCreativeProviderCredential: jest.fn().mockResolvedValue({ kind: 'connection_required' }),
}))
jest.mock('@/lib/video-editor/transcribe-dispatch', () => {
  const actual = jest.requireActual('@/lib/video-editor/transcribe-dispatch')
  return {
    ...actual,
    transcriptionRuntimeConfigFromEnv: jest.fn(() => ({ submitUrl: 'https://vps.example/t', apiKey: 'k' })),
    dispatchTranscriptionJob: jest.fn().mockResolvedValue({ providerJobId: 'vtx-1' }),
  }
})

const transcriptSet = jest.fn().mockResolvedValue(undefined)
const transcriptAdd = jest.fn().mockResolvedValue({ id: 'tr-1' })
const listGet = jest.fn().mockResolvedValue({ docs: [] })
jest.mock('@/lib/firebase/admin', () => ({
  adminDb: {
    collection: jest.fn(() => ({
      add: transcriptAdd,
      doc: jest.fn(() => ({ set: transcriptSet })),
      where: jest.fn().mockReturnThis(),
      get: listGet,
    })),
  },
}))

import { loadScopedRecord } from '@/lib/youtube-studio/api'
import { recordCanvasCreditUsage, refundCanvasCreditUsage, hasSufficientCredits } from '@/lib/creative-canvas/credits'
import { dispatchTranscriptionJob } from '@/lib/video-editor/transcribe-dispatch'
import { POST, GET } from '@/app/api/v1/video-editor/transcripts/route'

const project = {
  id: 'p-1',
  ref: { set: jest.fn() },
  data: {
    orgId: 'org-1', deleted: false,
    lastRender: { jobId: 'j1', url: 'https://firebasestorage.googleapis.com/render.mp4', durationSeconds: 120 },
    timeline: {
      version: 1,
      tracks: [{
        id: 't1', kind: 'video',
        clips: [{ id: 'c1', timelineStart: 0, duration: 30, media: { type: 'upload', fileId: 'f1', url: 'https://firebasestorage.googleapis.com/a.mp4', mediaKind: 'video', sourceDuration: 45 } }],
      }],
    },
  },
}

function postReq(body: Record<string, unknown>) {
  return new NextRequest('http://localhost/api/v1/video-editor/transcripts', {
    method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' },
  })
}

beforeEach(() => {
  jest.clearAllMocks()
  ;(loadScopedRecord as jest.Mock).mockResolvedValue(project)
  ;(hasSufficientCredits as jest.Mock).mockReturnValue(true)
})

describe('POST /api/v1/video-editor/transcripts', () => {
  it('creates, charges and dispatches a clip transcription', async () => {
    const res = await POST(postReq({ projectId: 'p-1', clipId: 'c1', language: 'en' }))
    expect(res.status).toBe(202)
    const body = await res.json()
    expect(body.data.transcriptId).toBe('tr-1')
    expect(body.data.credits).toBe(1) // 45s source → 1 credit
    expect(transcriptAdd).toHaveBeenCalledWith(expect.objectContaining({
      orgId: 'org-1', projectId: 'p-1', clipId: 'c1', source: 'media', status: 'queued', provider: 'gateway',
    }))
    expect(recordCanvasCreditUsage).toHaveBeenCalledWith('org-1', 1, { runId: 'tr-1', model: 'video_editor_transcription' })
    expect(dispatchTranscriptionJob).toHaveBeenCalled()
  })

  it('uses lastRender for whole-timeline scope', async () => {
    const res = await POST(postReq({ projectId: 'p-1' }))
    expect(res.status).toBe(202)
    expect(transcriptAdd).toHaveBeenCalledWith(expect.objectContaining({ source: 'timeline_render' }))
  })

  it('400s for whole-timeline scope when the project has no render', async () => {
    ;(loadScopedRecord as jest.Mock).mockResolvedValue({ ...project, data: { ...project.data, lastRender: undefined } })
    const res = await POST(postReq({ projectId: 'p-1' }))
    expect(res.status).toBe(400)
  })

  it('402s when credits are insufficient', async () => {
    ;(hasSufficientCredits as jest.Mock).mockReturnValue(false)
    const res = await POST(postReq({ projectId: 'p-1', clipId: 'c1' }))
    expect(res.status).toBe(402)
    expect(dispatchTranscriptionJob).not.toHaveBeenCalled()
  })

  it('refunds and marks failed when dispatch fails', async () => {
    ;(dispatchTranscriptionJob as jest.Mock).mockRejectedValue(new Error('executor down'))
    const res = await POST(postReq({ projectId: 'p-1', clipId: 'c1' }))
    expect(res.status).toBe(502)
    expect(refundCanvasCreditUsage).toHaveBeenCalledWith('org-1', 'tr-1')
    expect(transcriptSet).toHaveBeenCalledWith(expect.objectContaining({ status: 'failed' }), { merge: true })
  })
})

describe('GET /api/v1/video-editor/transcripts', () => {
  it('requires projectId', async () => {
    const res = await GET(new NextRequest('http://localhost/api/v1/video-editor/transcripts'))
    expect(res.status).toBe(400)
  })
  it('lists transcripts for the project', async () => {
    const res = await GET(new NextRequest('http://localhost/api/v1/video-editor/transcripts?projectId=p-1'))
    expect(res.status).toBe(200)
    expect((await res.json()).data.transcripts).toEqual([])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/api/video-editor-transcripts.test.ts`
Expected: FAIL — route module not found.

- [ ] **Step 3: Implement** — create `app/api/v1/video-editor/transcripts/route.ts`:

```ts
import { NextRequest } from 'next/server'
import { adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { apiError, apiSuccess } from '@/lib/api/response'
import { actorFields, ensureOrgAccess, loadScopedRecord, updateActorFields } from '@/lib/youtube-studio/api'
import {
  getCanvasCredits,
  hasSufficientCredits,
  recordCanvasCreditUsage,
  refundCanvasCreditUsage,
} from '@/lib/creative-canvas/credits'
import { resolveCreativeProviderCredential } from '@/lib/creative-canvas/connections/resolve'
import { VIDEO_EDITOR_COLLECTIONS } from '@/lib/video-editor/api'
import { VIDEO_EDITOR_TRANSCRIBE_COST_LABEL, estimateTranscriptionCredits } from '@/lib/video-editor/credits'
import { sanitizeEditorTimeline } from '@/lib/video-editor/sanitize'
import { serializeVideoEditorRecord } from '@/lib/video-editor/sanitize'
import {
  buildTranscriptionManifest,
  dispatchTranscriptionJob,
  transcriptionRuntimeConfigFromEnv,
} from '@/lib/video-editor/transcribe-dispatch'
import type { VideoEditorTranscript } from '@/lib/video-editor/types'

export const dynamic = 'force-dynamic'

function cleanString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

export const GET = withAuth('client', async (req: NextRequest, user) => {
  const projectId = req.nextUrl.searchParams.get('projectId')
  if (!projectId) return apiError('projectId is required', 400)
  const loaded = await loadScopedRecord(VIDEO_EDITOR_COLLECTIONS.projects, projectId)
  if (!loaded || loaded.data.deleted === true) return apiError('Video editor project not found', 404)
  const orgId = String(loaded.data.orgId ?? '')
  const denied = await ensureOrgAccess(user, orgId)
  if (denied) return denied

  const snap = await adminDb.collection(VIDEO_EDITOR_COLLECTIONS.transcripts)
    .where('orgId', '==', orgId)
    .where('projectId', '==', projectId)
    .where('deleted', '==', false)
    .get()
  const transcripts = snap.docs.map((doc) =>
    serializeVideoEditorRecord<VideoEditorTranscript>(doc.id, doc.data() as Record<string, unknown>))
  return apiSuccess({ transcripts })
})

export const POST = withAuth('client', async (req: NextRequest, user) => {
  const body = await req.json().catch(() => ({})) as Record<string, unknown>
  const projectId = cleanString(body.projectId)
  const clipId = cleanString(body.clipId)
  const language = cleanString(body.language)
  if (!projectId) return apiError('projectId is required', 400)

  const loaded = await loadScopedRecord(VIDEO_EDITOR_COLLECTIONS.projects, projectId)
  if (!loaded || loaded.data.deleted === true) return apiError('Video editor project not found', 404)
  const orgId = String(loaded.data.orgId ?? '')
  const denied = await ensureOrgAccess(user, orgId)
  if (denied) return denied

  // Resolve what to transcribe.
  let media: { url: string; mediaKind: 'video' | 'audio' } | null = null
  let source: VideoEditorTranscript['source'] = 'media'
  let durationSeconds = 0
  if (clipId) {
    const timeline = sanitizeEditorTimeline(loaded.data.timeline)
    for (const track of timeline.tracks) {
      const clip = track.clips.find((item) => item.id === clipId)
      if (clip?.media && (clip.media.mediaKind === 'video' || clip.media.mediaKind === 'audio')) {
        media = { url: clip.media.url, mediaKind: clip.media.mediaKind }
        durationSeconds = clip.media.sourceDuration ?? clip.duration
        break
      }
    }
    if (!media) return apiError('Clip not found or has no transcribable media (video/audio required)', 400)
  } else {
    const lastRender = loaded.data.lastRender as Record<string, unknown> | undefined
    const url = cleanString(lastRender?.url)
    if (!url) return apiError('Render the timeline first — whole-timeline transcription uses the last rendered output', 400)
    media = { url, mediaKind: 'video' }
    source = 'timeline_render'
    durationSeconds = typeof lastRender?.durationSeconds === 'number' ? lastRender.durationSeconds : 600
  }

  const credits = estimateTranscriptionCredits(durationSeconds)
  if (credits <= 0) return apiError('Nothing to transcribe — source duration is zero', 400)

  const config = transcriptionRuntimeConfigFromEnv()
  if (!config.submitUrl) return apiError('Transcription runtime is not configured', 503)

  const state = await getCanvasCredits(orgId)
  if (!hasSufficientCredits(state, credits)) {
    return apiError(`Insufficient credits: this transcription needs ${credits} and the organisation is at its limit`, 402)
  }

  // BYOK override: per-org/per-user openai_audio key beats the platform gateway.
  const credential = await resolveCreativeProviderCredential({ provider: 'openai_audio', orgId, uid: user.uid })
  const byok = credential.kind === 'byok' && typeof credential.credentials.apiKey === 'string'
    ? {
        apiKey: credential.credentials.apiKey,
        ...(typeof credential.credentials.baseUrl === 'string' && credential.credentials.baseUrl.trim()
          ? { baseUrl: credential.credentials.baseUrl.trim() }
          : {}),
      }
    : undefined

  const docRef = await adminDb.collection(VIDEO_EDITOR_COLLECTIONS.transcripts).add({
    orgId,
    projectId,
    ...(clipId ? { clipId } : {}),
    source,
    status: 'queued',
    language: language ?? 'auto',
    media,
    segments: [],
    text: '',
    provider: byok ? 'byok:openai_audio' : 'gateway',
    alignment: 'provider',
    credits: { estimated: credits, charged: 0, refunded: 0 },
    deleted: false,
    ...actorFields(user),
  })

  await recordCanvasCreditUsage(orgId, credits, { runId: docRef.id, model: VIDEO_EDITOR_TRANSCRIBE_COST_LABEL })
  const docHandle = adminDb.collection(VIDEO_EDITOR_COLLECTIONS.transcripts).doc(docRef.id)
  await docHandle.set({ credits: { estimated: credits, charged: credits, refunded: 0 } }, { merge: true })

  const manifest = buildTranscriptionManifest({
    transcriptId: docRef.id, orgId, projectId, media,
    ...(language ? { language } : {}),
    ...(byok ? { byok } : {}),
  })

  try {
    const dispatched = await dispatchTranscriptionJob(manifest, config)
    await docHandle.set({ status: 'dispatched', providerJobId: dispatched.providerJobId, ...updateActorFields(user) }, { merge: true })
    return apiSuccess({ transcriptId: docRef.id, providerJobId: dispatched.providerJobId, credits }, 202)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Transcription dispatch failed'
    const refund = await refundCanvasCreditUsage(orgId, docRef.id)
    await docHandle.set({
      status: 'failed',
      error: { code: 'dispatch_failed', message: message.slice(0, 2000) },
      credits: { estimated: credits, charged: credits, refunded: refund.amount },
      ...updateActorFields(user),
    }, { merge: true })
    return apiError(`Transcription dispatch failed: ${message}`, 502)
  }
})
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest __tests__/api/video-editor-transcripts.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/api/v1/video-editor/transcripts/route.ts __tests__/api/video-editor-transcripts.test.ts
git commit -m "feat(video-editor): transcript create/list API with charge-on-dispatch"
```

---

### Task 12: API — transcript detail: GET / PUT (executor report) / DELETE

**Files:**
- Create: `app/api/v1/video-editor/transcripts/[id]/route.ts`
- Test: `__tests__/api/video-editor-transcript-report.test.ts`

- [ ] **Step 1: Write the failing test** — create `__tests__/api/video-editor-transcript-report.test.ts`:

```ts
import { NextRequest } from 'next/server'

jest.mock('@/lib/api/auth', () => ({
  withAuth: (_role: string, handler: (...args: unknown[]) => unknown) =>
    (req: NextRequest, context?: unknown) => handler(req, { uid: 'agent-1', role: 'ai', email: 'a@x.test' }, context),
}))
jest.mock('@/lib/youtube-studio/api', () => ({
  updateActorFields: jest.fn(() => ({ updatedBy: 'agent-1', updatedByType: 'agent' })),
  ensureOrgAccess: jest.fn().mockResolvedValue(null),
  loadScopedRecord: jest.fn(),
}))
jest.mock('@/lib/creative-canvas/credits', () => ({
  refundCanvasCreditUsage: jest.fn().mockResolvedValue({ amount: 1, adjusted: true }),
}))
jest.mock('@/lib/firebase/admin', () => ({ adminDb: { collection: jest.fn() } }))

import { loadScopedRecord } from '@/lib/youtube-studio/api'
import { refundCanvasCreditUsage } from '@/lib/creative-canvas/credits'
import { GET, PUT, DELETE } from '@/app/api/v1/video-editor/transcripts/[id]/route'

const setMock = jest.fn().mockResolvedValue(undefined)
const baseDoc = {
  id: 'tr-1',
  ref: { set: setMock },
  data: {
    orgId: 'org-1', projectId: 'p-1', status: 'dispatched', deleted: false,
    credits: { estimated: 1, charged: 1, refunded: 0 }, segments: [], text: '',
  },
}
const context = { params: Promise.resolve({ id: 'tr-1' }) }

function putReq(body: Record<string, unknown>) {
  return new NextRequest('http://localhost/api/v1/video-editor/transcripts/tr-1', {
    method: 'PUT', body: JSON.stringify(body), headers: { 'content-type': 'application/json' },
  })
}

beforeEach(() => {
  jest.clearAllMocks()
  ;(loadScopedRecord as jest.Mock).mockResolvedValue(baseDoc)
})

describe('transcript [id] route', () => {
  it('GET returns the transcript', async () => {
    const res = await GET(new NextRequest('http://localhost/x'), context)
    expect(res.status).toBe(200)
    expect((await res.json()).data.transcript.id).toBe('tr-1')
  })

  it('PUT completed stores segments, text and duration', async () => {
    const res = await PUT(putReq({
      status: 'completed',
      language: 'en',
      durationSeconds: 42,
      segments: [{ id: 's1', start: 0, end: 2, text: 'Hello world', words: [{ text: 'Hello', start: 0, end: 1 }, { text: 'world', start: 1, end: 2 }] }],
    }), context)
    expect(res.status).toBe(200)
    expect(setMock).toHaveBeenCalledWith(expect.objectContaining({
      status: 'completed', text: 'Hello world', language: 'en', durationSeconds: 42, wordsTruncated: false,
    }), { merge: true })
  })

  it('PUT failed refunds the charge', async () => {
    const res = await PUT(putReq({ status: 'failed', error: { code: 'whisper_error', message: 'boom' } }), context)
    expect(res.status).toBe(200)
    expect(refundCanvasCreditUsage).toHaveBeenCalledWith('org-1', 'tr-1')
    expect(setMock).toHaveBeenCalledWith(expect.objectContaining({ status: 'failed' }), { merge: true })
  })

  it('PUT is a no-op on terminal transcripts', async () => {
    ;(loadScopedRecord as jest.Mock).mockResolvedValue({ ...baseDoc, data: { ...baseDoc.data, status: 'completed' } })
    const res = await PUT(putReq({ status: 'failed' }), context)
    expect((await res.json()).data.alreadyTerminal).toBe(true)
    expect(setMock).not.toHaveBeenCalled()
  })

  it('PUT rejects an invalid report', async () => {
    const res = await PUT(putReq({ status: 'completed', segments: [] }), context)
    expect(res.status).toBe(400)
  })

  it('DELETE soft-deletes', async () => {
    const res = await DELETE(new NextRequest('http://localhost/x', { method: 'DELETE' }), context)
    expect(res.status).toBe(200)
    expect(setMock).toHaveBeenCalledWith(expect.objectContaining({ deleted: true }), { merge: true })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/api/video-editor-transcript-report.test.ts`
Expected: FAIL — route module not found.

- [ ] **Step 3: Implement** — create `app/api/v1/video-editor/transcripts/[id]/route.ts`:

```ts
import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { apiError, apiSuccess } from '@/lib/api/response'
import { ensureOrgAccess, loadScopedRecord, updateActorFields } from '@/lib/youtube-studio/api'
import { refundCanvasCreditUsage } from '@/lib/creative-canvas/credits'
import { VIDEO_EDITOR_COLLECTIONS } from '@/lib/video-editor/api'
import { serializeVideoEditorRecord } from '@/lib/video-editor/sanitize'
import { fitSegmentsForFirestore, sanitizeTranscriptReportPatch, transcriptPlainText } from '@/lib/video-editor/transcripts'
import type { VideoEditorTranscript } from '@/lib/video-editor/types'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ id: string }> }

const TERMINAL_STATUSES = new Set(['completed', 'failed'])

async function loadTranscript(id: string) {
  const loaded = await loadScopedRecord(VIDEO_EDITOR_COLLECTIONS.transcripts, id)
  if (!loaded || loaded.data.deleted === true) return null
  return loaded
}

export const GET = withAuth('client', async (_req: NextRequest, user, context) => {
  const { id } = await (context as RouteContext).params
  const loaded = await loadTranscript(id)
  if (!loaded) return apiError('Transcript not found', 404)
  const denied = await ensureOrgAccess(user, String(loaded.data.orgId ?? ''))
  if (denied) return denied
  return apiSuccess({ transcript: serializeVideoEditorRecord<VideoEditorTranscript>(loaded.id, loaded.data) })
})

export const PUT = withAuth('client', async (req: NextRequest, user, context) => {
  const { id } = await (context as RouteContext).params
  const loaded = await loadTranscript(id)
  if (!loaded) return apiError('Transcript not found', 404)
  const orgId = String(loaded.data.orgId ?? '')
  const denied = await ensureOrgAccess(user, orgId)
  if (denied) return denied

  const body = await req.json().catch(() => ({}))
  const patch = sanitizeTranscriptReportPatch(body)
  if (!patch.status) return apiError('A valid status (processing | completed | failed) with required fields is needed', 400)

  const currentStatus = String(loaded.data.status ?? '')
  if (TERMINAL_STATUSES.has(currentStatus)) {
    return apiSuccess({ id, status: currentStatus, alreadyTerminal: true })
  }

  if (patch.status === 'processing') {
    await loaded.ref.set({ status: 'processing', ...updateActorFields(user) }, { merge: true })
    return apiSuccess({ id, status: 'processing' })
  }

  if (patch.status === 'completed') {
    const fitted = fitSegmentsForFirestore(patch.segments ?? [])
    await loaded.ref.set({
      status: 'completed',
      segments: fitted.segments,
      wordsTruncated: fitted.wordsTruncated,
      text: transcriptPlainText(fitted.segments),
      ...(patch.language ? { language: patch.language } : {}),
      ...(patch.durationSeconds !== undefined ? { durationSeconds: patch.durationSeconds } : {}),
      ...updateActorFields(user),
    }, { merge: true })
    return apiSuccess({ id, status: 'completed', segmentCount: fitted.segments.length })
  }

  const refund = await refundCanvasCreditUsage(orgId, id)
  const existingCredits = (loaded.data.credits as Record<string, unknown> | undefined) ?? {}
  await loaded.ref.set({
    status: 'failed',
    ...(patch.error ? { error: patch.error } : {}),
    credits: { ...existingCredits, refunded: refund.amount },
    ...updateActorFields(user),
  }, { merge: true })
  return apiSuccess({ id, status: 'failed', refunded: refund.amount })
})

export const DELETE = withAuth('client', async (_req: NextRequest, user, context) => {
  const { id } = await (context as RouteContext).params
  const loaded = await loadTranscript(id)
  if (!loaded) return apiError('Transcript not found', 404)
  const denied = await ensureOrgAccess(user, String(loaded.data.orgId ?? ''))
  if (denied) return denied
  await loaded.ref.set({ deleted: true, ...updateActorFields(user) }, { merge: true })
  return apiSuccess({ id, deleted: true })
})
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest __tests__/api/video-editor-transcript-report.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add "app/api/v1/video-editor/transcripts/[id]/route.ts" __tests__/api/video-editor-transcript-report.test.ts
git commit -m "feat(video-editor): transcript detail route with executor report contract"
```

---

### Task 13: API — generate caption track from a transcript

**Files:**
- Create: `app/api/v1/video-editor/projects/[id]/captions/generate/route.ts`
- Test: `__tests__/api/video-editor-captions-generate.test.ts`

- [ ] **Step 1: Write the failing test** — create `__tests__/api/video-editor-captions-generate.test.ts`:

```ts
import { NextRequest } from 'next/server'

jest.mock('@/lib/api/auth', () => ({
  withAuth: (_role: string, handler: (...args: unknown[]) => unknown) =>
    (req: NextRequest, context?: unknown) => handler(req, { uid: 'u1', role: 'admin', email: 'p@x.test' }, context),
}))
jest.mock('@/lib/youtube-studio/api', () => ({
  updateActorFields: jest.fn(() => ({ updatedBy: 'u1', updatedByType: 'user' })),
  ensureOrgAccess: jest.fn().mockResolvedValue(null),
  loadScopedRecord: jest.fn(),
}))
jest.mock('@/lib/firebase/admin', () => ({ adminDb: { collection: jest.fn() } }))

import { loadScopedRecord } from '@/lib/youtube-studio/api'
import { POST } from '@/app/api/v1/video-editor/projects/[id]/captions/generate/route'

const projectSet = jest.fn().mockResolvedValue(undefined)
const project = {
  id: 'p-1',
  ref: { set: projectSet },
  data: { orgId: 'org-1', deleted: false, timeline: { version: 1, tracks: [] } },
}
const transcript = {
  id: 'tr-1',
  ref: { set: jest.fn() },
  data: {
    orgId: 'org-1', projectId: 'p-1', status: 'completed', deleted: false, language: 'en',
    segments: [{ id: 's1', start: 0.5, end: 2, text: 'Hello world', words: [{ text: 'Hello', start: 0.5, end: 1 }, { text: 'world', start: 1.2, end: 1.9 }] }],
  },
}
const context = { params: Promise.resolve({ id: 'p-1' }) }

function req(body: Record<string, unknown>) {
  return new NextRequest('http://localhost/x', { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } })
}

beforeEach(() => {
  jest.clearAllMocks()
  ;(loadScopedRecord as jest.Mock).mockImplementation(async (collection: string) =>
    collection === 'video_editor_projects' ? project : transcript)
})

describe('POST /projects/[id]/captions/generate', () => {
  it('adds a caption track built from the transcript and saves the timeline', async () => {
    const res = await POST(req({ transcriptId: 'tr-1', stylePreset: 'boxed', animationPreset: 'karaoke' }), context)
    expect(res.status).toBe(200)
    const body = await res.json()
    const captionTrack = body.data.timeline.tracks.find((t: { kind: string }) => t.kind === 'caption')
    expect(captionTrack.clips).toHaveLength(1)
    expect(captionTrack.clips[0].caption).toMatchObject({ text: 'Hello world', stylePreset: 'boxed', animationPreset: 'karaoke', transcriptId: 'tr-1' })
    expect(projectSet).toHaveBeenCalledWith(expect.objectContaining({ timeline: expect.anything() }), { merge: true })
  })

  it('replaces clips when an existing caption trackId is given', async () => {
    ;(loadScopedRecord as jest.Mock).mockImplementation(async (collection: string) =>
      collection === 'video_editor_projects'
        ? { ...project, data: { ...project.data, timeline: { version: 1, tracks: [{ id: 'track-caption-1', kind: 'caption', clips: [{ id: 'old', timelineStart: 0, duration: 1, caption: { text: 'old', words: [], stylePreset: 'clean', animationPreset: 'none' } }] }] } } }
        : transcript)
    const res = await POST(req({ transcriptId: 'tr-1', trackId: 'track-caption-1' }), context)
    const body = await res.json()
    const track = body.data.timeline.tracks[0]
    expect(track.id).toBe('track-caption-1')
    expect(track.clips.map((c: { caption: { text: string } }) => c.caption.text)).toEqual(['Hello world'])
  })

  it('rejects incomplete transcripts', async () => {
    ;(loadScopedRecord as jest.Mock).mockImplementation(async (collection: string) =>
      collection === 'video_editor_projects' ? project : { ...transcript, data: { ...transcript.data, status: 'processing' } })
    const res = await POST(req({ transcriptId: 'tr-1' }), context)
    expect(res.status).toBe(400)
  })

  it('rejects transcripts from another project', async () => {
    ;(loadScopedRecord as jest.Mock).mockImplementation(async (collection: string) =>
      collection === 'video_editor_projects' ? project : { ...transcript, data: { ...transcript.data, projectId: 'other' } })
    const res = await POST(req({ transcriptId: 'tr-1' }), context)
    expect(res.status).toBe(400)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/api/video-editor-captions-generate.test.ts`
Expected: FAIL — route module not found.

- [ ] **Step 3: Implement** — create `app/api/v1/video-editor/projects/[id]/captions/generate/route.ts`:

```ts
import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { apiError, apiSuccess } from '@/lib/api/response'
import { ensureOrgAccess, loadScopedRecord, updateActorFields } from '@/lib/youtube-studio/api'
import { VIDEO_EDITOR_COLLECTIONS } from '@/lib/video-editor/api'
import { captionClipsFromTranscript } from '@/lib/video-editor/captions'
import { sanitizeEditorTimeline, serializeVideoEditorRecord, validateEditorTimeline } from '@/lib/video-editor/sanitize'
import {
  EDITOR_CAPTION_ANIMATION_PRESETS,
  EDITOR_CAPTION_STYLE_PRESETS,
} from '@/lib/video-editor/types'
import type {
  EditorCaptionAnimationPreset,
  EditorCaptionStylePreset,
  VideoEditorTranscript,
} from '@/lib/video-editor/types'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ id: string }> }

function pickEnum<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback
}

export const POST = withAuth('client', async (req: NextRequest, user, context) => {
  const { id } = await (context as RouteContext).params
  const loaded = await loadScopedRecord(VIDEO_EDITOR_COLLECTIONS.projects, id)
  if (!loaded || loaded.data.deleted === true) return apiError('Video editor project not found', 404)
  const orgId = String(loaded.data.orgId ?? '')
  const denied = await ensureOrgAccess(user, orgId)
  if (denied) return denied

  const body = await req.json().catch(() => ({})) as Record<string, unknown>
  const transcriptId = typeof body.transcriptId === 'string' ? body.transcriptId.trim() : ''
  if (!transcriptId) return apiError('transcriptId is required', 400)
  const trackId = typeof body.trackId === 'string' && body.trackId.trim() ? body.trackId.trim() : undefined
  const stylePreset = pickEnum<EditorCaptionStylePreset>(body.stylePreset, EDITOR_CAPTION_STYLE_PRESETS, 'clean')
  const animationPreset = pickEnum<EditorCaptionAnimationPreset>(body.animationPreset, EDITOR_CAPTION_ANIMATION_PRESETS, 'none')

  const transcriptLoaded = await loadScopedRecord(VIDEO_EDITOR_COLLECTIONS.transcripts, transcriptId)
  if (!transcriptLoaded || transcriptLoaded.data.deleted === true) return apiError('Transcript not found', 404)
  const transcript = serializeVideoEditorRecord<VideoEditorTranscript>(transcriptLoaded.id, transcriptLoaded.data)
  if (transcript.orgId !== orgId || transcript.projectId !== id) return apiError('Transcript does not belong to this project', 400)
  if (transcript.status !== 'completed') return apiError('Transcript is not completed yet', 400)
  if (!transcript.segments?.length) return apiError('Transcript has no segments', 400)

  const timeline = sanitizeEditorTimeline(loaded.data.timeline)
  const clips = captionClipsFromTranscript(transcript, {
    stylePreset,
    animationPreset,
    idPrefix: `cap-${transcriptId.slice(0, 8)}-${Date.now().toString(36)}`,
  })

  if (trackId) {
    const track = timeline.tracks.find((item) => item.id === trackId && item.kind === 'caption')
    if (!track) return apiError(`Caption track '${trackId}' not found`, 400)
    track.clips = clips
  } else {
    timeline.tracks.unshift({
      id: `track-caption-${Date.now().toString(36)}`,
      kind: 'caption',
      label: `Captions (${transcript.language})`,
      clips,
    })
  }

  const issues = validateEditorTimeline(timeline)
  if (issues.length) return apiError('Generated captions produced an invalid timeline', 500, { details: issues })

  await loaded.ref.set({ timeline, ...updateActorFields(user) }, { merge: true })
  return apiSuccess({ timeline, cueCount: clips.length })
})
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest __tests__/api/video-editor-captions-generate.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add "app/api/v1/video-editor/projects/[id]/captions/generate/route.ts" __tests__/api/video-editor-captions-generate.test.ts
git commit -m "feat(video-editor): generate caption track from transcript"
```

---

### Task 14: TTS library — voices, Gateway + ElevenLabs synthesis, WAV parsing

**Files:**
- Create: `lib/video-editor/tts.ts`
- Test: `__tests__/lib/video-editor-tts.test.ts`

Gateway path: OpenAI-compatible `POST {base}/audio/speech` against `https://ai-gateway.vercel.sh/v1` with `AI_GATEWAY_API_KEY`, `response_format: 'wav'` (WAV headers give us the exact clip duration without probing). BYOK `openai_audio` swaps base URL + key. ElevenLabs BYOK uses `/v1/text-to-speech/{voiceId}/with-timestamps` which returns base64 MP3 **plus character alignment** — exact word timing for the shared transcript.

- [ ] **Step 1: Write the failing test** — create `__tests__/lib/video-editor-tts.test.ts`:

```ts
import {
  OPENAI_TTS_VOICES,
  synthesizeSpeechOpenAiCompat,
  synthesizeSpeechElevenLabs,
  wavDurationSeconds,
  wordsFromCharAlignment,
} from '@/lib/video-editor/tts'

function makeWav(dataBytes: number, byteRate: number): Buffer {
  // Minimal RIFF/WAVE with fmt (16 bytes) + data chunks.
  const buffer = Buffer.alloc(44 + dataBytes)
  buffer.write('RIFF', 0); buffer.writeUInt32LE(36 + dataBytes, 4); buffer.write('WAVE', 8)
  buffer.write('fmt ', 12); buffer.writeUInt32LE(16, 16)
  buffer.writeUInt16LE(1, 20); buffer.writeUInt16LE(1, 22)
  buffer.writeUInt32LE(24000, 24); buffer.writeUInt32LE(byteRate, 28)
  buffer.writeUInt16LE(2, 32); buffer.writeUInt16LE(16, 34)
  buffer.write('data', 36); buffer.writeUInt32LE(dataBytes, 40)
  return buffer
}

describe('wavDurationSeconds', () => {
  it('computes duration from the data chunk and byte rate', () => {
    expect(wavDurationSeconds(makeWav(48000 * 2, 48000))).toBeCloseTo(2, 3)
  })
  it('returns 0 for non-wav buffers', () => {
    expect(wavDurationSeconds(Buffer.from('not a wav file at all'))).toBe(0)
  })
})

describe('wordsFromCharAlignment', () => {
  it('groups character timings into word timings', () => {
    const words = wordsFromCharAlignment({
      characters: ['H', 'i', ' ', 'y', 'o', 'u'],
      character_start_times_seconds: [0, 0.1, 0.2, 0.3, 0.4, 0.5],
      character_end_times_seconds: [0.1, 0.2, 0.3, 0.4, 0.5, 0.6],
    })
    expect(words).toEqual([
      { text: 'Hi', start: 0, end: 0.2 },
      { text: 'you', start: 0.3, end: 0.6 },
    ])
  })
})

describe('synthesizeSpeechOpenAiCompat', () => {
  afterEach(() => { (global.fetch as jest.Mock | undefined)?.mockRestore?.() })

  it('POSTs to /audio/speech and returns the wav buffer + duration', async () => {
    const wav = makeWav(24000, 48000) // 0.5s
    global.fetch = jest.fn().mockResolvedValue({ ok: true, arrayBuffer: async () => wav.buffer.slice(wav.byteOffset, wav.byteOffset + wav.byteLength) }) as unknown as typeof fetch
    const result = await synthesizeSpeechOpenAiCompat({
      text: 'Hello', voice: 'alloy', baseUrl: 'https://ai-gateway.vercel.sh/v1', apiKey: 'gk', model: 'openai/tts-1',
    })
    expect(result.mimeType).toBe('audio/wav')
    expect(result.durationSeconds).toBeCloseTo(0.5, 3)
    expect(result.words).toBeNull() // no provider timing marks — caller estimates
    const [url, init] = (global.fetch as jest.Mock).mock.calls[0]
    expect(url).toBe('https://ai-gateway.vercel.sh/v1/audio/speech')
    expect(JSON.parse(init.body)).toEqual({ model: 'openai/tts-1', voice: 'alloy', input: 'Hello', response_format: 'wav' })
  })

  it('throws with provider detail on failure', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 400, text: async () => 'bad voice' }) as unknown as typeof fetch
    await expect(synthesizeSpeechOpenAiCompat({ text: 'x', voice: 'v', baseUrl: 'https://b', apiKey: 'k', model: 'm' })).rejects.toThrow('400')
  })
})

describe('synthesizeSpeechElevenLabs', () => {
  afterEach(() => { (global.fetch as jest.Mock | undefined)?.mockRestore?.() })

  it('returns mp3 buffer, alignment words and duration from the alignment', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        audio_base64: Buffer.from('mp3data').toString('base64'),
        alignment: {
          characters: ['H', 'i'],
          character_start_times_seconds: [0, 0.2],
          character_end_times_seconds: [0.2, 0.4],
        },
      }),
    }) as unknown as typeof fetch
    const result = await synthesizeSpeechElevenLabs({ text: 'Hi', voiceId: 'v-1', apiKey: 'ek' })
    expect(result.mimeType).toBe('audio/mpeg')
    expect(result.durationSeconds).toBeCloseTo(0.4, 3)
    expect(result.words).toEqual([{ text: 'Hi', start: 0, end: 0.4 }])
    const [url, init] = (global.fetch as jest.Mock).mock.calls[0]
    expect(url).toBe('https://api.elevenlabs.io/v1/text-to-speech/v-1/with-timestamps')
    expect(init.headers['xi-api-key']).toBe('ek')
  })
})

describe('voice registry', () => {
  it('exposes the OpenAI voices', () => {
    expect(OPENAI_TTS_VOICES.map((v) => v.id)).toEqual(
      expect.arrayContaining(['alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer']),
    )
    expect(OPENAI_TTS_VOICES.every((v) => v.provider === 'gateway')).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/lib/video-editor-tts.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement** — create `lib/video-editor/tts.ts`:

```ts
import type { TranscriptWord } from './types'

export const DEFAULT_TTS_GATEWAY_BASE_URL = 'https://ai-gateway.vercel.sh/v1'
export const DEFAULT_TTS_MODEL = 'openai/tts-1'
export const DEFAULT_TTS_BYOK_MODEL = 'tts-1'

export interface TtsVoice {
  id: string
  label: string
  provider: 'gateway' | 'elevenlabs'
}

export const OPENAI_TTS_VOICES: TtsVoice[] = [
  { id: 'alloy', label: 'Alloy (neutral)', provider: 'gateway' },
  { id: 'ash', label: 'Ash (warm male)', provider: 'gateway' },
  { id: 'coral', label: 'Coral (warm female)', provider: 'gateway' },
  { id: 'echo', label: 'Echo (male)', provider: 'gateway' },
  { id: 'fable', label: 'Fable (British)', provider: 'gateway' },
  { id: 'onyx', label: 'Onyx (deep male)', provider: 'gateway' },
  { id: 'nova', label: 'Nova (female)', provider: 'gateway' },
  { id: 'sage', label: 'Sage (calm female)', provider: 'gateway' },
  { id: 'shimmer', label: 'Shimmer (bright female)', provider: 'gateway' },
]

export interface SynthesizedSpeech {
  audio: Buffer
  mimeType: 'audio/wav' | 'audio/mpeg'
  durationSeconds: number
  /** Exact word timings when the provider returns them; null → caller estimates. */
  words: TranscriptWord[] | null
}

/**
 * Parse a RIFF/WAVE header: duration = data-chunk bytes / fmt byteRate.
 * Returns 0 when the buffer is not a WAV file.
 */
export function wavDurationSeconds(buffer: Buffer): number {
  if (buffer.length < 44 || buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WAVE') return 0
  let offset = 12
  let byteRate = 0
  let dataBytes = 0
  while (offset + 8 <= buffer.length) {
    const chunkId = buffer.toString('ascii', offset, offset + 4)
    const chunkSize = buffer.readUInt32LE(offset + 4)
    if (chunkId === 'fmt ' && offset + 16 + 8 <= buffer.length) byteRate = buffer.readUInt32LE(offset + 8 + 8)
    if (chunkId === 'data') dataBytes = chunkSize
    offset += 8 + chunkSize + (chunkSize % 2)
  }
  if (!byteRate || !dataBytes) return 0
  return Math.round((dataBytes / byteRate) * 1000) / 1000
}

export interface ElevenLabsAlignment {
  characters: string[]
  character_start_times_seconds: number[]
  character_end_times_seconds: number[]
}

/** Group ElevenLabs character alignment into whitespace-delimited word timings. */
export function wordsFromCharAlignment(alignment: ElevenLabsAlignment): TranscriptWord[] {
  const words: TranscriptWord[] = []
  let text = ''
  let start = 0
  let end = 0
  alignment.characters.forEach((char, index) => {
    if (/\s/.test(char)) {
      if (text) words.push({ text, start, end })
      text = ''
      return
    }
    if (!text) start = alignment.character_start_times_seconds[index] ?? 0
    text += char
    end = alignment.character_end_times_seconds[index] ?? end
  })
  if (text) words.push({ text, start, end })
  return words
}

export async function synthesizeSpeechOpenAiCompat(input: {
  text: string
  voice: string
  baseUrl: string
  apiKey: string
  model: string
}): Promise<SynthesizedSpeech> {
  const response = await fetch(`${input.baseUrl.replace(/\/$/, '')}/audio/speech`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${input.apiKey}` },
    body: JSON.stringify({ model: input.model, voice: input.voice, input: input.text, response_format: 'wav' }),
  })
  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    throw new Error(`TTS provider rejected the request (${response.status}): ${detail.slice(0, 300)}`)
  }
  const audio = Buffer.from(await response.arrayBuffer())
  return { audio, mimeType: 'audio/wav', durationSeconds: wavDurationSeconds(audio), words: null }
}

export async function synthesizeSpeechElevenLabs(input: {
  text: string
  voiceId: string
  apiKey: string
  modelId?: string
}): Promise<SynthesizedSpeech> {
  const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(input.voiceId)}/with-timestamps`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'xi-api-key': input.apiKey },
    body: JSON.stringify({ text: input.text, model_id: input.modelId ?? 'eleven_multilingual_v2' }),
  })
  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    throw new Error(`ElevenLabs rejected the request (${response.status}): ${detail.slice(0, 300)}`)
  }
  const body = await response.json() as { audio_base64?: string; alignment?: ElevenLabsAlignment }
  if (!body.audio_base64) throw new Error('ElevenLabs returned no audio')
  const words = body.alignment ? wordsFromCharAlignment(body.alignment) : null
  const durationSeconds = words?.length ? words[words.length - 1].end : 0
  return { audio: Buffer.from(body.audio_base64, 'base64'), mimeType: 'audio/mpeg', durationSeconds, words }
}

/** Fetch the org's ElevenLabs voices (BYOK only). */
export async function listElevenLabsVoices(apiKey: string): Promise<TtsVoice[]> {
  const response = await fetch('https://api.elevenlabs.io/v1/voices', { headers: { 'xi-api-key': apiKey } })
  if (!response.ok) return []
  const body = await response.json().catch(() => ({})) as { voices?: Array<{ voice_id?: string; name?: string }> }
  return (body.voices ?? [])
    .filter((voice) => typeof voice.voice_id === 'string' && voice.voice_id)
    .map((voice) => ({ id: voice.voice_id!, label: voice.name || voice.voice_id!, provider: 'elevenlabs' as const }))
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest __tests__/lib/video-editor-tts.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/video-editor/tts.ts __tests__/lib/video-editor-tts.test.ts
git commit -m "feat(video-editor): tts synthesis lib with gateway default and elevenlabs alignment"
```

---

### Task 15: API — TTS voices + voiceover generation with shared transcript

**Files:**
- Create: `app/api/v1/video-editor/tts/voices/route.ts`
- Create: `app/api/v1/video-editor/projects/[id]/tts/route.ts`
- Test: `__tests__/api/video-editor-tts.test.ts`

Contract: `POST /projects/[id]/tts { sections: [{ text }], voice, provider?: 'gateway' | 'elevenlabs', trackId?, startAtSeconds? }`. For each section: synthesize → `saveVideoEditorUpload` → audio clip appended sequentially (0.35 s gap) on the chosen/new audio track. **The shared transcript:** one `video_editor_transcripts` doc (`source: 'tts'`, status `completed`) is created covering all sections — word timings come from ElevenLabs alignment (`alignment: 'provider'`) or `distributeWordsAcrossSpan` over each section's measured audio duration (`alignment: 'estimated'`). Captions generated from it can never desync from the voiceover, and the "Transcribe clip" action can later refine estimated timings via forced alignment. Charge `estimateTtsCredits(totalChars)` on dispatch against a `video_editor_tts_jobs` doc; refund on failure.

- [ ] **Step 1: Write the failing test** — create `__tests__/api/video-editor-tts.test.ts`:

```ts
import { NextRequest } from 'next/server'

jest.mock('@/lib/api/auth', () => ({
  withAuth: (_role: string, handler: (...args: unknown[]) => unknown) =>
    (req: NextRequest, context?: unknown) => handler(req, { uid: 'u1', role: 'admin', email: 'p@x.test' }, context),
}))
jest.mock('@/lib/youtube-studio/api', () => ({
  actorFields: jest.fn(() => ({ createdBy: 'u1', createdByType: 'user' })),
  updateActorFields: jest.fn(() => ({ updatedBy: 'u1', updatedByType: 'user' })),
  ensureOrgAccess: jest.fn().mockResolvedValue(null),
  loadScopedRecord: jest.fn(),
}))
jest.mock('@/lib/creative-canvas/credits', () => ({
  getCanvasCredits: jest.fn().mockResolvedValue({ orgId: 'org-1', used: 0, limit: null, updatedAt: null }),
  hasSufficientCredits: jest.fn().mockReturnValue(true),
  recordCanvasCreditUsage: jest.fn().mockResolvedValue({}),
  refundCanvasCreditUsage: jest.fn().mockResolvedValue({ amount: 1, adjusted: true }),
}))
jest.mock('@/lib/creative-canvas/connections/resolve', () => ({
  resolveCreativeProviderCredential: jest.fn().mockResolvedValue({ kind: 'connection_required' }),
}))
jest.mock('@/lib/video-editor/storage', () => ({
  saveVideoEditorUpload: jest.fn().mockResolvedValue({ id: 'up-1', url: 'https://storage.example/v.wav', storagePath: 'p', sizeBytes: 10 }),
}))
jest.mock('@/lib/video-editor/tts', () => {
  const actual = jest.requireActual('@/lib/video-editor/tts')
  return {
    ...actual,
    synthesizeSpeechOpenAiCompat: jest.fn().mockResolvedValue({
      audio: Buffer.from('wav'), mimeType: 'audio/wav', durationSeconds: 2, words: null,
    }),
    synthesizeSpeechElevenLabs: jest.fn(),
    listElevenLabsVoices: jest.fn().mockResolvedValue([]),
  }
})

const ttsJobSet = jest.fn().mockResolvedValue(undefined)
const ttsJobAdd = jest.fn().mockResolvedValue({ id: 'tts-1' })
const transcriptAdd = jest.fn().mockResolvedValue({ id: 'tr-tts-1' })
jest.mock('@/lib/firebase/admin', () => ({
  adminDb: {
    collection: jest.fn((name: string) => ({
      add: name === 'video_editor_transcripts' ? transcriptAdd : ttsJobAdd,
      doc: jest.fn(() => ({ set: ttsJobSet })),
    })),
  },
}))

import { loadScopedRecord } from '@/lib/youtube-studio/api'
import { recordCanvasCreditUsage, refundCanvasCreditUsage } from '@/lib/creative-canvas/credits'
import { synthesizeSpeechOpenAiCompat } from '@/lib/video-editor/tts'
import { POST } from '@/app/api/v1/video-editor/projects/[id]/tts/route'
import { GET as getVoices } from '@/app/api/v1/video-editor/tts/voices/route'

const projectSet = jest.fn().mockResolvedValue(undefined)
const project = {
  id: 'p-1',
  ref: { set: projectSet },
  data: { orgId: 'org-1', deleted: false, timeline: { version: 1, tracks: [] } },
}
const context = { params: Promise.resolve({ id: 'p-1' }) }

function req(body: Record<string, unknown>) {
  return new NextRequest('http://localhost/x', { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } })
}

beforeEach(() => {
  jest.clearAllMocks()
  ;(loadScopedRecord as jest.Mock).mockResolvedValue(project)
  process.env.AI_GATEWAY_API_KEY = 'gk'
})

describe('GET /api/v1/video-editor/tts/voices', () => {
  it('returns the gateway voices without BYOK', async () => {
    const res = await getVoices(new NextRequest('http://localhost/x?orgId=org-1'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data.voices.some((v: { id: string }) => v.id === 'alloy')).toBe(true)
  })
})

describe('POST /projects/[id]/tts', () => {
  it('synthesizes sections, places clips, and creates ONE shared transcript', async () => {
    const res = await POST(req({ sections: [{ text: 'Hello world' }, { text: 'Second section' }], voice: 'alloy' }), context)
    expect(res.status).toBe(200)
    const body = await res.json()

    expect(synthesizeSpeechOpenAiCompat).toHaveBeenCalledTimes(2)
    expect(recordCanvasCreditUsage).toHaveBeenCalledWith('org-1', 1, { runId: 'tts-1', model: 'video_editor_tts' })

    const audioTrack = body.data.timeline.tracks.find((t: { kind: string }) => t.kind === 'audio')
    expect(audioTrack.clips).toHaveLength(2)
    expect(audioTrack.clips[0]).toMatchObject({ timelineStart: 0, duration: 2 })
    expect(audioTrack.clips[1].timelineStart).toBeCloseTo(2.35, 3) // 2s + 0.35s gap

    expect(transcriptAdd).toHaveBeenCalledTimes(1)
    const transcriptDoc = transcriptAdd.mock.calls[0][0]
    expect(transcriptDoc).toMatchObject({ source: 'tts', status: 'completed', alignment: 'estimated' })
    expect(transcriptDoc.segments).toHaveLength(2)
    expect(transcriptDoc.segments[0].words.length).toBeGreaterThan(0)
    expect(body.data.transcriptId).toBe('tr-tts-1')
    expect(projectSet).toHaveBeenCalled()
  })

  it('refunds when synthesis fails mid-run', async () => {
    ;(synthesizeSpeechOpenAiCompat as jest.Mock).mockRejectedValueOnce(new Error('provider down'))
    const res = await POST(req({ sections: [{ text: 'Hello' }], voice: 'alloy' }), context)
    expect(res.status).toBe(502)
    expect(refundCanvasCreditUsage).toHaveBeenCalledWith('org-1', 'tts-1')
  })

  it('rejects empty sections', async () => {
    const res = await POST(req({ sections: [], voice: 'alloy' }), context)
    expect(res.status).toBe(400)
  })

  it('503s without a gateway key and without BYOK', async () => {
    delete process.env.AI_GATEWAY_API_KEY
    const res = await POST(req({ sections: [{ text: 'Hi' }], voice: 'alloy' }), context)
    expect(res.status).toBe(503)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/api/video-editor-tts.test.ts`
Expected: FAIL — route modules not found.

- [ ] **Step 3: Implement**

Create `app/api/v1/video-editor/tts/voices/route.ts`:

```ts
import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { apiSuccess } from '@/lib/api/response'
import { resolveCreativeProviderCredential } from '@/lib/creative-canvas/connections/resolve'
import { OPENAI_TTS_VOICES, listElevenLabsVoices } from '@/lib/video-editor/tts'

export const dynamic = 'force-dynamic'

export const GET = withAuth('client', async (req: NextRequest, user) => {
  const orgId = req.nextUrl.searchParams.get('orgId') ?? ''
  const voices = [...OPENAI_TTS_VOICES]
  if (orgId) {
    const credential = await resolveCreativeProviderCredential({ provider: 'elevenlabs', orgId, uid: user.uid })
    if (credential.kind === 'byok' && typeof credential.credentials.apiKey === 'string') {
      voices.push(...await listElevenLabsVoices(credential.credentials.apiKey).catch(() => []))
    }
  }
  return apiSuccess({ voices })
})
```

Create `app/api/v1/video-editor/projects/[id]/tts/route.ts`:

```ts
import { NextRequest } from 'next/server'
import { adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { apiError, apiSuccess } from '@/lib/api/response'
import { actorFields, ensureOrgAccess, loadScopedRecord, updateActorFields } from '@/lib/youtube-studio/api'
import {
  getCanvasCredits,
  hasSufficientCredits,
  recordCanvasCreditUsage,
  refundCanvasCreditUsage,
} from '@/lib/creative-canvas/credits'
import { resolveCreativeProviderCredential } from '@/lib/creative-canvas/connections/resolve'
import { VIDEO_EDITOR_COLLECTIONS } from '@/lib/video-editor/api'
import { distributeWordsAcrossSpan } from '@/lib/video-editor/captions'
import { VIDEO_EDITOR_TTS_COST_LABEL, estimateTtsCredits } from '@/lib/video-editor/credits'
import { sanitizeEditorTimeline, validateEditorTimeline } from '@/lib/video-editor/sanitize'
import { saveVideoEditorUpload } from '@/lib/video-editor/storage'
import {
  DEFAULT_TTS_BYOK_MODEL,
  DEFAULT_TTS_GATEWAY_BASE_URL,
  DEFAULT_TTS_MODEL,
  synthesizeSpeechElevenLabs,
  synthesizeSpeechOpenAiCompat,
} from '@/lib/video-editor/tts'
import { transcriptPlainText } from '@/lib/video-editor/transcripts'
import type { EditorClip, TranscriptSegment } from '@/lib/video-editor/types'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ id: string }> }

const SECTION_GAP_SECONDS = 0.35
const MAX_SECTIONS = 40
const MAX_SECTION_CHARS = 4000

function round3(value: number): number {
  return Math.round(value * 1000) / 1000
}

export const POST = withAuth('client', async (req: NextRequest, user, context) => {
  const { id } = await (context as RouteContext).params
  const loaded = await loadScopedRecord(VIDEO_EDITOR_COLLECTIONS.projects, id)
  if (!loaded || loaded.data.deleted === true) return apiError('Video editor project not found', 404)
  const orgId = String(loaded.data.orgId ?? '')
  const denied = await ensureOrgAccess(user, orgId)
  if (denied) return denied

  const body = await req.json().catch(() => ({})) as Record<string, unknown>
  const rawSections = Array.isArray(body.sections) ? body.sections : []
  const sections = rawSections
    .map((entry) => (entry && typeof entry === 'object' ? String((entry as Record<string, unknown>).text ?? '').trim() : ''))
    .filter(Boolean)
    .slice(0, MAX_SECTIONS)
    .map((text) => text.slice(0, MAX_SECTION_CHARS))
  const voice = typeof body.voice === 'string' && body.voice.trim() ? body.voice.trim() : ''
  const providerChoice = body.provider === 'elevenlabs' ? 'elevenlabs' : 'gateway'
  const trackId = typeof body.trackId === 'string' && body.trackId.trim() ? body.trackId.trim() : undefined
  const startAtSeconds = typeof body.startAtSeconds === 'number' && Number.isFinite(body.startAtSeconds)
    ? Math.max(0, body.startAtSeconds)
    : 0
  if (!sections.length) return apiError('At least one non-empty section is required', 400)
  if (!voice) return apiError('voice is required', 400)

  // Provider resolution: BYOK beats platform gateway; ElevenLabs is BYOK-only.
  const elevenCred = providerChoice === 'elevenlabs'
    ? await resolveCreativeProviderCredential({ provider: 'elevenlabs', orgId, uid: user.uid })
    : null
  if (providerChoice === 'elevenlabs' && (elevenCred?.kind !== 'byok' || typeof elevenCred.credentials.apiKey !== 'string')) {
    return apiError('ElevenLabs requires a connected API key for this organisation', 400)
  }
  const openAiCred = providerChoice === 'gateway'
    ? await resolveCreativeProviderCredential({ provider: 'openai_audio', orgId, uid: user.uid })
    : null
  const byokOpenAi = openAiCred?.kind === 'byok' && typeof openAiCred.credentials.apiKey === 'string'
    ? {
        apiKey: openAiCred.credentials.apiKey,
        baseUrl: typeof openAiCred.credentials.baseUrl === 'string' && openAiCred.credentials.baseUrl.trim()
          ? openAiCred.credentials.baseUrl.trim()
          : 'https://api.openai.com/v1',
      }
    : null
  const gatewayKey = (process.env.AI_GATEWAY_API_KEY ?? '').trim()
  if (providerChoice === 'gateway' && !byokOpenAi && !gatewayKey) {
    return apiError('TTS is not configured (set AI_GATEWAY_API_KEY or connect an OpenAI-compatible key)', 503)
  }

  const totalChars = sections.reduce((sum, text) => sum + text.length, 0)
  const credits = estimateTtsCredits(totalChars)
  const state = await getCanvasCredits(orgId)
  if (!hasSufficientCredits(state, credits)) {
    return apiError(`Insufficient credits: this voiceover needs ${credits} and the organisation is at its limit`, 402)
  }

  const providerLabel = providerChoice === 'elevenlabs' ? 'byok:elevenlabs' : (byokOpenAi ? 'byok:openai_audio' : 'gateway')
  const jobRef = await adminDb.collection(VIDEO_EDITOR_COLLECTIONS.ttsJobs).add({
    orgId, projectId: id, status: 'processing', voice, provider: providerLabel,
    sectionCount: sections.length, totalChars,
    credits: { estimated: credits, charged: 0, refunded: 0 },
    deleted: false,
    ...actorFields(user),
  })
  await recordCanvasCreditUsage(orgId, credits, { runId: jobRef.id, model: VIDEO_EDITOR_TTS_COST_LABEL })
  const jobDoc = adminDb.collection(VIDEO_EDITOR_COLLECTIONS.ttsJobs).doc(jobRef.id)
  await jobDoc.set({ credits: { estimated: credits, charged: credits, refunded: 0 } }, { merge: true })

  try {
    const clips: EditorClip[] = []
    const segments: TranscriptSegment[] = []
    let alignment: 'provider' | 'estimated' = 'provider'
    let cursor = startAtSeconds

    for (let index = 0; index < sections.length; index += 1) {
      const text = sections[index]
      const synthesized = providerChoice === 'elevenlabs'
        ? await synthesizeSpeechElevenLabs({ text, voiceId: voice, apiKey: String(elevenCred!.credentials.apiKey) })
        : await synthesizeSpeechOpenAiCompat({
            text,
            voice,
            baseUrl: byokOpenAi ? byokOpenAi.baseUrl : DEFAULT_TTS_GATEWAY_BASE_URL,
            apiKey: byokOpenAi ? byokOpenAi.apiKey : gatewayKey,
            model: (process.env.VIDEO_EDITOR_TTS_MODEL ?? '').trim() || (byokOpenAi ? DEFAULT_TTS_BYOK_MODEL : DEFAULT_TTS_MODEL),
          })
      const duration = Math.max(synthesized.durationSeconds, 0.2)
      const extension = synthesized.mimeType === 'audio/wav' ? 'wav' : 'mp3'
      const uploaded = await saveVideoEditorUpload(synthesized.audio, {
        orgId,
        folder: `video-editor/${orgId}/${id}`,
        filename: `tts-${jobRef.id}-${index + 1}.${extension}`,
        mimeType: synthesized.mimeType,
        user,
        relatedTo: { type: 'video_editor_project', id },
      })
      clips.push({
        id: `tts-${jobRef.id}-${index + 1}`,
        timelineStart: round3(cursor),
        duration: round3(duration),
        volume: 1,
        media: { type: 'upload', fileId: uploaded.id, url: uploaded.url, mediaKind: 'audio', sourceDuration: duration },
      })
      const words = synthesized.words?.length
        ? synthesized.words.map((word) => ({ text: word.text, start: round3(cursor + word.start), end: round3(cursor + word.end) }))
        : distributeWordsAcrossSpan(text, cursor, cursor + duration)
      if (!synthesized.words?.length) alignment = 'estimated'
      segments.push({ id: `tts-s${index + 1}`, start: round3(cursor), end: round3(cursor + duration), text, words })
      cursor += duration + SECTION_GAP_SECONDS
    }

    // Place clips on the requested or a new "Voiceover" audio track.
    const timeline = sanitizeEditorTimeline(loaded.data.timeline)
    let track = trackId ? timeline.tracks.find((item) => item.id === trackId && item.kind === 'audio') : undefined
    if (trackId && !track) return apiError(`Audio track '${trackId}' not found`, 400)
    if (!track) {
      track = { id: `track-audio-vo-${Date.now().toString(36)}`, kind: 'audio', label: 'Voiceover', clips: [] }
      timeline.tracks.push(track)
    }
    track.clips.push(...clips)
    const issues = validateEditorTimeline(timeline)
    if (issues.length) return apiError('Voiceover clips would overlap existing audio — pick a different start time or track', 400, { details: issues })

    // THE shared transcript: captions generated from this can never desync from the voiceover.
    const transcriptRef = await adminDb.collection(VIDEO_EDITOR_COLLECTIONS.transcripts).add({
      orgId, projectId: id, source: 'tts', status: 'completed',
      language: 'auto', segments, text: transcriptPlainText(segments),
      provider: providerLabel, alignment,
      durationSeconds: round3(cursor - SECTION_GAP_SECONDS - startAtSeconds),
      credits: { estimated: 0, charged: 0, refunded: 0 },
      deleted: false,
      ...actorFields(user),
    })

    await loaded.ref.set({ timeline, ...updateActorFields(user) }, { merge: true })
    await jobDoc.set({ status: 'completed', transcriptId: transcriptRef.id, trackId: track.id, ...updateActorFields(user) }, { merge: true })
    return apiSuccess({ jobId: jobRef.id, transcriptId: transcriptRef.id, trackId: track.id, timeline, alignment, credits })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'TTS generation failed'
    const refund = await refundCanvasCreditUsage(orgId, jobRef.id)
    await jobDoc.set({
      status: 'failed',
      error: { code: 'tts_failed', message: message.slice(0, 2000) },
      credits: { estimated: credits, charged: credits, refunded: refund.amount },
      ...updateActorFields(user),
    }, { merge: true })
    return apiError(`TTS generation failed: ${message}`, 502)
  }
})
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest __tests__/api/video-editor-tts.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/api/v1/video-editor/tts "app/api/v1/video-editor/projects/[id]/tts/route.ts" __tests__/api/video-editor-tts.test.ts
git commit -m "feat(video-editor): tts voiceover generation with shared transcript placement"
```

---

### Task 16: API — transcript translation (multilingual caption tracks)

**Files:**
- Create: `app/api/v1/video-editor/transcripts/[id]/translate/route.ts`
- Test: `__tests__/api/video-editor-transcript-translate.test.ts`

Translation goes through the Vercel AI Gateway `generateText` (`DRAFT_MODEL`, same as email/SEO generators — plain `provider/model` strings route through the gateway automatically). The translated transcript keeps the ORIGINAL segment timings; per-segment word timings are re-estimated with `distributeWordsAcrossSpan` (word counts change across languages — proportional distribution inside the fixed segment window is the correct behaviour).

- [ ] **Step 1: Write the failing test** — create `__tests__/api/video-editor-transcript-translate.test.ts`:

```ts
import { NextRequest } from 'next/server'

jest.mock('@/lib/api/auth', () => ({
  withAuth: (_role: string, handler: (...args: unknown[]) => unknown) =>
    (req: NextRequest, context?: unknown) => handler(req, { uid: 'u1', role: 'admin', email: 'p@x.test' }, context),
}))
jest.mock('@/lib/youtube-studio/api', () => ({
  actorFields: jest.fn(() => ({ createdBy: 'u1', createdByType: 'user' })),
  updateActorFields: jest.fn(() => ({ updatedBy: 'u1', updatedByType: 'user' })),
  ensureOrgAccess: jest.fn().mockResolvedValue(null),
  loadScopedRecord: jest.fn(),
}))
jest.mock('@/lib/creative-canvas/credits', () => ({
  getCanvasCredits: jest.fn().mockResolvedValue({ orgId: 'org-1', used: 0, limit: null, updatedAt: null }),
  hasSufficientCredits: jest.fn().mockReturnValue(true),
  recordCanvasCreditUsage: jest.fn().mockResolvedValue({}),
  refundCanvasCreditUsage: jest.fn().mockResolvedValue({ amount: 1, adjusted: true }),
}))
jest.mock('ai', () => ({ generateText: jest.fn() }))

const translationAdd = jest.fn().mockResolvedValue({ id: 'tr-es-1' })
jest.mock('@/lib/firebase/admin', () => ({
  adminDb: { collection: jest.fn(() => ({ add: translationAdd, doc: jest.fn(() => ({ set: jest.fn() })) })) },
}))

import { generateText } from 'ai'
import { loadScopedRecord } from '@/lib/youtube-studio/api'
import { recordCanvasCreditUsage, refundCanvasCreditUsage } from '@/lib/creative-canvas/credits'
import { POST } from '@/app/api/v1/video-editor/transcripts/[id]/translate/route'

const transcript = {
  id: 'tr-1',
  ref: { set: jest.fn() },
  data: {
    orgId: 'org-1', projectId: 'p-1', status: 'completed', deleted: false, language: 'en',
    text: 'Hello world. Second line.',
    segments: [
      { id: 's1', start: 0, end: 2, text: 'Hello world.', words: [{ text: 'Hello', start: 0, end: 1 }, { text: 'world.', start: 1, end: 2 }] },
      { id: 's2', start: 2.5, end: 4, text: 'Second line.', words: [] },
    ],
  },
}
const context = { params: Promise.resolve({ id: 'tr-1' }) }

function req(body: Record<string, unknown>) {
  return new NextRequest('http://localhost/x', { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } })
}

beforeEach(() => {
  jest.clearAllMocks()
  ;(loadScopedRecord as jest.Mock).mockResolvedValue(transcript)
  ;(generateText as jest.Mock).mockResolvedValue({ text: JSON.stringify(['Hola mundo.', 'Segunda línea.']) })
})

describe('POST /transcripts/[id]/translate', () => {
  it('creates a translated transcript with original timings and estimated words', async () => {
    const res = await POST(req({ language: 'es' }), context)
    expect(res.status).toBe(200)
    expect((await res.json()).data.transcriptId).toBe('tr-es-1')
    expect(recordCanvasCreditUsage).toHaveBeenCalledWith('org-1', 1, expect.objectContaining({ model: 'video_editor_translation' }))
    const doc = translationAdd.mock.calls[0][0]
    expect(doc).toMatchObject({ source: 'translation', translationOf: 'tr-1', language: 'es', status: 'completed', alignment: 'estimated' })
    expect(doc.segments[0]).toMatchObject({ id: 's1', start: 0, end: 2, text: 'Hola mundo.' })
    expect(doc.segments[0].words.map((w: { text: string }) => w.text)).toEqual(['Hola', 'mundo.'])
    expect(doc.segments[1]).toMatchObject({ start: 2.5, end: 4, text: 'Segunda línea.' })
  })

  it('refunds when the model returns malformed output', async () => {
    ;(generateText as jest.Mock).mockResolvedValue({ text: 'not json' })
    const res = await POST(req({ language: 'es' }), context)
    expect(res.status).toBe(502)
    expect(refundCanvasCreditUsage).toHaveBeenCalled()
  })

  it('rejects missing language and incomplete transcripts', async () => {
    expect((await POST(req({}), context)).status).toBe(400)
    ;(loadScopedRecord as jest.Mock).mockResolvedValue({ ...transcript, data: { ...transcript.data, status: 'processing' } })
    expect((await POST(req({ language: 'es' }), context)).status).toBe(400)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/api/video-editor-transcript-translate.test.ts`
Expected: FAIL — route module not found.

- [ ] **Step 3: Implement** — create `app/api/v1/video-editor/transcripts/[id]/translate/route.ts`:

```ts
import { NextRequest } from 'next/server'
import { generateText } from 'ai'
import { adminDb } from '@/lib/firebase/admin'
import { DRAFT_MODEL } from '@/lib/ai/client'
import { withAuth } from '@/lib/api/auth'
import { apiError, apiSuccess } from '@/lib/api/response'
import { actorFields, ensureOrgAccess, loadScopedRecord } from '@/lib/youtube-studio/api'
import {
  getCanvasCredits,
  hasSufficientCredits,
  recordCanvasCreditUsage,
  refundCanvasCreditUsage,
} from '@/lib/creative-canvas/credits'
import { VIDEO_EDITOR_COLLECTIONS } from '@/lib/video-editor/api'
import { distributeWordsAcrossSpan } from '@/lib/video-editor/captions'
import { VIDEO_EDITOR_TRANSLATE_COST_LABEL, estimateTranslationCredits } from '@/lib/video-editor/credits'
import { serializeVideoEditorRecord } from '@/lib/video-editor/sanitize'
import { transcriptPlainText } from '@/lib/video-editor/transcripts'
import type { TranscriptSegment, VideoEditorTranscript } from '@/lib/video-editor/types'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ id: string }> }

function parseTranslations(raw: string, expected: number): string[] | null {
  const match = raw.match(/\[[\s\S]*\]/)
  if (!match) return null
  try {
    const parsed = JSON.parse(match[0]) as unknown
    if (!Array.isArray(parsed) || parsed.length !== expected) return null
    const items = parsed.map((item) => (typeof item === 'string' ? item.trim() : ''))
    return items.every(Boolean) ? items : null
  } catch {
    return null
  }
}

export const POST = withAuth('client', async (req: NextRequest, user, context) => {
  const { id } = await (context as RouteContext).params
  const loaded = await loadScopedRecord(VIDEO_EDITOR_COLLECTIONS.transcripts, id)
  if (!loaded || loaded.data.deleted === true) return apiError('Transcript not found', 404)
  const orgId = String(loaded.data.orgId ?? '')
  const denied = await ensureOrgAccess(user, orgId)
  if (denied) return denied

  const body = await req.json().catch(() => ({})) as Record<string, unknown>
  const language = typeof body.language === 'string' && body.language.trim() ? body.language.trim().toLowerCase() : ''
  if (!language) return apiError('language is required (e.g. "es", "af", "de")', 400)

  const transcript = serializeVideoEditorRecord<VideoEditorTranscript>(loaded.id, loaded.data)
  if (transcript.status !== 'completed' || !transcript.segments?.length) {
    return apiError('Only completed transcripts with segments can be translated', 400)
  }

  const credits = estimateTranslationCredits(transcript.text.length || transcriptPlainText(transcript.segments).length)
  const state = await getCanvasCredits(orgId)
  if (!hasSufficientCredits(state, credits)) {
    return apiError(`Insufficient credits: this translation needs ${credits} and the organisation is at its limit`, 402)
  }

  const runId = `translate-${id}-${language}-${Date.now().toString(36)}`
  await recordCanvasCreditUsage(orgId, credits, { runId, model: VIDEO_EDITOR_TRANSLATE_COST_LABEL })

  try {
    const numbered = transcript.segments.map((segment, index) => `${index + 1}. ${segment.text}`).join('\n')
    const { text } = await generateText({
      model: DRAFT_MODEL,
      prompt: [
        `Translate each numbered subtitle line into ${language}.`,
        'Keep meaning and register; keep lines short enough to work as on-screen captions.',
        `Respond with ONLY a JSON array of ${transcript.segments.length} strings, one per line, same order. No commentary.`,
        '',
        numbered,
      ].join('\n'),
    })
    const translations = parseTranslations(text, transcript.segments.length)
    if (!translations) throw new Error('Model returned malformed translation output')

    const segments: TranscriptSegment[] = transcript.segments.map((segment, index) => ({
      id: segment.id,
      start: segment.start,
      end: segment.end,
      text: translations[index],
      words: distributeWordsAcrossSpan(translations[index], segment.start, segment.end),
    }))

    const docRef = await adminDb.collection(VIDEO_EDITOR_COLLECTIONS.transcripts).add({
      orgId,
      projectId: transcript.projectId,
      ...(transcript.clipId ? { clipId: transcript.clipId } : {}),
      source: 'translation',
      translationOf: id,
      status: 'completed',
      language,
      segments,
      text: transcriptPlainText(segments),
      provider: 'gateway',
      model: DRAFT_MODEL,
      alignment: 'estimated',
      ...(transcript.durationSeconds !== undefined ? { durationSeconds: transcript.durationSeconds } : {}),
      credits: { estimated: credits, charged: credits, refunded: 0 },
      deleted: false,
      ...actorFields(user),
    })
    return apiSuccess({ transcriptId: docRef.id, language, segmentCount: segments.length, credits })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Translation failed'
    await refundCanvasCreditUsage(orgId, runId)
    return apiError(`Translation failed: ${message}`, 502)
  }
})
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest __tests__/api/video-editor-transcript-translate.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add "app/api/v1/video-editor/transcripts/[id]/translate/route.ts" __tests__/api/video-editor-transcript-translate.test.ts
git commit -m "feat(video-editor): transcript translation via ai gateway"
```

---

### Task 17: Executor — `.ass` subtitle builder with karaoke tags (golden tests)

**Files:**
- Create: `scripts/higgsfield-executor/lib/editor-captions.mjs`
- Test: `__tests__/scripts/editor-captions.test.ts`

The executor is dependency-free plain Node (byte-identical deploy policy), so the `.ass` builder lives in `.mjs` and deliberately duplicates the preset *values* from `lib/video-editor/caption-presets.ts`. A parity test pins the preset name lists together so they cannot drift silently.

- [ ] **Step 1: Write the failing test** — create `__tests__/scripts/editor-captions.test.ts` (same subprocess pattern as `editor-filtergraph.test.ts`):

```ts
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { EDITOR_CAPTION_STYLE_PRESETS } from '@/lib/video-editor/types'

const modulePath = join(process.cwd(), 'scripts/higgsfield-executor/lib/editor-captions.mjs')

function runModule<T>(code: string): T {
  const stdout = execFileSync(process.execPath, ['--input-type=module', '-e', `
    import * as m from ${JSON.stringify(`file://${modulePath}`)};
    const result = await (async () => { ${code} })();
    process.stdout.write(JSON.stringify(result));
  `], { encoding: 'utf8' })
  return JSON.parse(stdout) as T
}

const settings = { width: 1280, height: 720, fps: 30, background: '#000000' }

function captionTimeline(animationPreset: string) {
  return {
    version: 1,
    tracks: [{
      id: 'track-caption-1', kind: 'caption',
      clips: [{
        id: 'cue-1', timelineStart: 1, duration: 2,
        caption: {
          text: 'Hello world', stylePreset: 'clean', animationPreset,
          words: [
            { text: 'Hello', offsetStart: 0, offsetEnd: 0.5 },
            { text: 'world', offsetStart: 0.7, offsetEnd: 1.2 },
          ],
        },
      }],
    }],
  }
}

describe('editor-captions .ass builder', () => {
  it('style preset names match the TS registry', () => {
    const names = runModule<string[]>('return Object.keys(m.ASS_STYLE_PRESETS)')
    expect(names.sort()).toEqual([...EDITOR_CAPTION_STYLE_PRESETS].sort())
  })

  it('formats ASS timestamps', () => {
    expect(runModule<string>('return m.assTimestamp(0)')).toBe('0:00:00.00')
    expect(runModule<string>('return m.assTimestamp(3661.25)')).toBe('1:01:01.25')
  })

  it('escapes ASS text', () => {
    expect(runModule<string>('return m.escapeAssText("a{b}\\nc")')).toBe('a\\{b\\}\\Nc')
  })

  it('builds a plain dialogue document (golden)', () => {
    const ass = runModule<string>(`return m.buildAssDocument({ timeline: ${JSON.stringify(captionTimeline('none'))}, settings: ${JSON.stringify(settings)} })`)
    expect(ass).toContain('PlayResX: 1280')
    expect(ass).toContain('PlayResY: 720')
    expect(ass).toContain('Style: clean,DejaVu Sans,')
    expect(ass).toContain('Dialogue: 0,0:00:01.00,0:00:03.00,clean,,0,0,0,,Hello world')
  })

  it('emits karaoke \\kf tags from word offsets (golden)', () => {
    const ass = runModule<string>(`return m.buildAssDocument({ timeline: ${JSON.stringify(captionTimeline('karaoke'))}, settings: ${JSON.stringify(settings)} })`)
    // Hello: 0.5s → 50cs; gap 0.2s folded into next word lead-in; world: 0.5s → 50cs
    expect(ass).toContain('{\\kf50}Hello {\\kf20}{\\kf50}world')
  })

  it('emits pop animation override tags (golden)', () => {
    const ass = runModule<string>(`return m.buildAssDocument({ timeline: ${JSON.stringify(captionTimeline('pop'))}, settings: ${JSON.stringify(settings)} })`)
    expect(ass).toContain('{\\fscx60\\fscy60\\t(0,120,\\fscx105\\fscy105)\\t(120,200,\\fscx100\\fscy100)}Hello world')
  })

  it('escapes subtitles filter paths', () => {
    expect(runModule<string>(`return m.escapeSubtitlesPath("/tmp/dir:with 'quote'/captions.ass")`))
      .toBe("'/tmp/dir\\:with '\\\\''quote'\\\\''/captions.ass'")
  })

  it('reports whether a timeline has caption cues', () => {
    expect(runModule<boolean>(`return m.timelineHasCaptions(${JSON.stringify(captionTimeline('none'))})`)).toBe(true)
    expect(runModule<boolean>('return m.timelineHasCaptions({ version: 1, tracks: [] })')).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/scripts/editor-captions.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement** — create `scripts/higgsfield-executor/lib/editor-captions.mjs`:

```js
/**
 * .ass subtitle builder for the editor's caption tracks.
 * Preset VALUES mirror lib/video-editor/caption-presets.ts — the jest parity
 * test (__tests__/scripts/editor-captions.test.ts) pins the name lists together.
 */

export const ASS_STYLE_PRESETS = {
  clean:       { fontScale: 0.055, color: '#ffffff', outlineColor: '#000000', backgroundColor: null,        bold: true,  alignment: 2, marginVScale: 0.08, highlightColor: '#ffd400' },
  boxed:       { fontScale: 0.05,  color: '#ffffff', outlineColor: '#000000', backgroundColor: '#000000b3', bold: false, alignment: 2, marginVScale: 0.08, highlightColor: '#ffd400' },
  outline:     { fontScale: 0.06,  color: '#ffffff', outlineColor: '#111111', backgroundColor: null,        bold: true,  alignment: 2, marginVScale: 0.08, highlightColor: '#ffd400' },
  lower_third: { fontScale: 0.045, color: '#ffffff', outlineColor: '#000000', backgroundColor: '#101828cc', bold: false, alignment: 2, marginVScale: 0.05, highlightColor: '#ffd400' },
  karaoke_bar: { fontScale: 0.055, color: '#ffffff', outlineColor: '#000000', backgroundColor: '#000000cc', bold: true,  alignment: 2, marginVScale: 0.1,  highlightColor: '#ffd400' },
}

const DEFAULT_FONT_NAME = 'DejaVu Sans'

/** #rrggbb or #rrggbbaa → ASS &HAABBGGRR (ASS alpha: 00 opaque, FF transparent). */
export function assColor(hex) {
  const raw = String(hex || '#ffffff').replace('#', '')
  const r = raw.slice(0, 2) || 'ff'
  const g = raw.slice(2, 4) || 'ff'
  const b = raw.slice(4, 6) || 'ff'
  const cssAlpha = raw.length >= 8 ? parseInt(raw.slice(6, 8), 16) : 255
  const assAlpha = (255 - cssAlpha).toString(16).padStart(2, '0')
  return `&H${assAlpha}${b}${g}${r}`.toUpperCase().replace('&H', '&H')
}

export function assTimestamp(seconds) {
  const total = Math.max(0, Number(seconds) || 0)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = Math.floor(total % 60)
  const cs = Math.round((total - Math.floor(total)) * 100)
  const pad = (v) => String(v).padStart(2, '0')
  return `${h}:${pad(m)}:${pad(s)}.${pad(cs)}`
}

export function escapeAssText(text) {
  return String(text)
    .replace(/\\/g, '\\\\')
    .replace(/\{/g, '\\{')
    .replace(/\}/g, '\\}')
    .replace(/\r?\n/g, '\\N')
}

function animationTags(animationPreset, style, settings) {
  if (animationPreset === 'pop') return '{\\fscx60\\fscy60\\t(0,120,\\fscx105\\fscy105)\\t(120,200,\\fscx100\\fscy100)}'
  if (animationPreset === 'fade') return '{\\fad(150,80)}'
  if (animationPreset === 'bounce') return '{\\fscx50\\fscy50\\t(0,120,\\fscx115\\fscy115)\\t(120,220,\\fscx95\\fscy95)\\t(220,300,\\fscx100\\fscy100)}'
  if (animationPreset === 'slide_up') {
    const x = Math.round(settings.width / 2)
    const y = Math.round(settings.height - settings.height * style.marginVScale)
    return `{\\move(${x},${y + 40},${x},${y},0,180)}`
  }
  return ''
}

function karaokeText(caption) {
  const parts = []
  let cursor = 0
  for (const word of caption.words) {
    const lead = Math.round((word.offsetStart - cursor) * 100)
    if (lead > 0) parts.push(`{\\kf${lead}}`)
    const duration = Math.max(1, Math.round((word.offsetEnd - word.offsetStart) * 100))
    parts.push(`{\\kf${duration}}${escapeAssText(word.text)} `)
    cursor = word.offsetEnd
  }
  return parts.join('').trimEnd()
}

export function timelineHasCaptions(timeline) {
  return (timeline?.tracks ?? []).some((track) =>
    track?.kind === 'caption' && (track.clips ?? []).some((clip) => clip?.caption?.text))
}

export function buildAssDocument({ timeline, settings }) {
  const usedStyles = new Set()
  const events = []
  for (const track of timeline?.tracks ?? []) {
    if (track?.kind !== 'caption') continue
    const clips = [...(track.clips ?? [])].sort((a, b) => (a.timelineStart ?? 0) - (b.timelineStart ?? 0))
    for (const clip of clips) {
      const caption = clip?.caption
      if (!caption?.text) continue
      const styleName = ASS_STYLE_PRESETS[caption.stylePreset] ? caption.stylePreset : 'clean'
      const style = ASS_STYLE_PRESETS[styleName]
      usedStyles.add(styleName)
      const start = assTimestamp(clip.timelineStart ?? 0)
      const end = assTimestamp((clip.timelineStart ?? 0) + (clip.duration ?? 0))
      const useKaraoke = caption.animationPreset === 'karaoke' && Array.isArray(caption.words) && caption.words.length > 0
      const text = useKaraoke
        ? karaokeText(caption)
        : `${animationTags(caption.animationPreset, style, settings)}${escapeAssText(caption.text)}`
      events.push(`Dialogue: 0,${start},${end},${styleName},,0,0,0,,${text}`)
    }
  }
  if (!usedStyles.size) usedStyles.add('clean')

  const styleLines = [...usedStyles].sort().map((name) => {
    const style = ASS_STYLE_PRESETS[name]
    const fontSize = Math.round(settings.height * style.fontScale)
    const marginV = Math.round(settings.height * style.marginVScale)
    const borderStyle = style.backgroundColor ? 4 : 1
    const backColor = assColor(style.backgroundColor || '#00000000')
    return `Style: ${name},${DEFAULT_FONT_NAME},${fontSize},${assColor(style.color)},${assColor(style.highlightColor)},${assColor(style.outlineColor)},${backColor},${style.bold ? -1 : 0},0,0,0,100,100,0,0,${borderStyle},3,0,${style.alignment},60,60,${marginV},1`
  })

  return [
    '[Script Info]',
    'ScriptType: v4.00+',
    `PlayResX: ${settings.width}`,
    `PlayResY: ${settings.height}`,
    'WrapStyle: 2',
    'ScaledBorderAndShadow: yes',
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    ...styleLines,
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
    ...events,
    '',
  ].join('\n')
}

/** Escape a filesystem path for use in ffmpeg's subtitles=filename= inside -filter_complex. */
export function escapeSubtitlesPath(path) {
  const escaped = String(path).replace(/\\/g, '\\\\').replace(/:/g, '\\:').replace(/'/g, "'\\\\''")
  return `'${escaped}'`
}
```

> If a golden assertion mismatches on exact escaping output, adjust the TEST to the actual deterministic output after manually verifying the generated `.ass` loads in ffmpeg (`ffmpeg -f lavfi -i color=black:s=1280x720:d=3 -vf "subtitles=/tmp/test.ass" -frames:v 1 /tmp/out.png` locally) — the golden's job is to freeze known-good behaviour, not to guess ffmpeg's parser.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest __tests__/scripts/editor-captions.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/higgsfield-executor/lib/editor-captions.mjs __tests__/scripts/editor-captions.test.ts
git commit -m "feat(executor): .ass caption builder with karaoke and animation presets"
```

---

### Task 18: Executor — transcription helpers + filtergraph `captionAssPath` (golden tests)

**Files:**
- Create: `scripts/higgsfield-executor/lib/editor-transcribe.mjs`
- Modify: `scripts/higgsfield-executor/lib/editor-filtergraph.mjs`
- Test: `__tests__/scripts/editor-transcribe.test.ts`, extend `__tests__/scripts/editor-filtergraph.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `__tests__/scripts/editor-transcribe.test.ts`:

```ts
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'

const modulePath = join(process.cwd(), 'scripts/higgsfield-executor/lib/editor-transcribe.mjs')

function runModule<T>(code: string): T {
  const stdout = execFileSync(process.execPath, ['--input-type=module', '-e', `
    import * as m from ${JSON.stringify(`file://${modulePath}`)};
    const result = await (async () => { ${code} })();
    process.stdout.write(JSON.stringify(result));
  `], { encoding: 'utf8' })
  return JSON.parse(stdout) as T
}

describe('editor-transcribe helpers', () => {
  it('builds mono 16k mp3 extraction args', () => {
    expect(runModule<string[]>(`return m.audioExtractArgs('/tmp/in.mp4', '/tmp/audio.mp3')`)).toEqual([
      '-y', '-i', '/tmp/in.mp4', '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'libmp3lame', '-b:a', '64k', '/tmp/audio.mp3',
    ])
  })

  it('maps whisper verbose_json into word-filled segments', () => {
    const payload = {
      language: 'english',
      duration: 4.2,
      segments: [
        { id: 0, start: 0, end: 2.0, text: ' Hello world ' },
        { id: 1, start: 2.5, end: 4.2, text: ' Second line ' },
      ],
      words: [
        { word: 'Hello', start: 0.1, end: 0.6 },
        { word: 'world', start: 0.7, end: 1.4 },
        { word: 'Second', start: 2.5, end: 3.0 },
        { word: 'line', start: 3.1, end: 3.9 },
      ],
    }
    const result = runModule<{
      language: string
      durationSeconds: number
      segments: Array<{ id: string; start: number; end: number; text: string; words: Array<{ text: string; start: number; end: number }> }>
    }>(`return m.segmentsFromVerboseJson(${JSON.stringify(payload)})`)
    expect(result.language).toBe('english')
    expect(result.durationSeconds).toBe(4.2)
    expect(result.segments).toEqual([
      { id: 'seg-0', start: 0, end: 2, text: 'Hello world', words: [
        { text: 'Hello', start: 0.1, end: 0.6 }, { text: 'world', start: 0.7, end: 1.4 },
      ] },
      { id: 'seg-1', start: 2.5, end: 4.2, text: 'Second line', words: [
        { text: 'Second', start: 2.5, end: 3 }, { text: 'line', start: 3.1, end: 3.9 },
      ] },
    ])
  })

  it('tolerates payloads without word granularity', () => {
    const result = runModule<{ segments: Array<{ words: unknown[] }> }>(
      `return m.segmentsFromVerboseJson({ segments: [{ id: 0, start: 0, end: 1, text: 'Hi' }] })`,
    )
    expect(result.segments[0].words).toEqual([])
  })
})
```

Append to `__tests__/scripts/editor-filtergraph.test.ts`:

```ts
  it('inserts the subtitles filter when captionAssPath is provided', () => {
    const result = runModule<{ filterComplex: string }>(`return m.compileEditorFiltergraph(${JSON.stringify({
      settings,
      localMediaPaths: { c1: '/tmp/media/c1.mp4' },
      captionAssPath: '/tmp/work/captions.ass',
      timeline: {
        version: 1,
        tracks: [{
          id: 't1', kind: 'video',
          clips: [{ id: 'c1', timelineStart: 0, duration: 4, media: { type: 'upload', fileId: 'f1', url: 'https://x.test/a.mp4', mediaKind: 'video' } }],
        }],
      },
    })})`)
    expect(result.filterComplex).toContain("subtitles=filename='/tmp/work/captions.ass'[cap0]")
    expect(result.filterComplex).toContain('[cap0]format=yuv420p[vout]')
  })

  it('does not add a subtitles filter without captionAssPath', () => {
    const result = runModule<{ filterComplex: string }>(`return m.compileEditorFiltergraph(${JSON.stringify({
      settings,
      localMediaPaths: {},
      timeline: { version: 1, tracks: [] },
    })})`)
    expect(result.filterComplex).not.toContain('subtitles=')
  })
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest __tests__/scripts/editor-transcribe.test.ts __tests__/scripts/editor-filtergraph.test.ts`
Expected: FAIL — module missing / `captionAssPath` ignored.

- [ ] **Step 3: Implement**

Create `scripts/higgsfield-executor/lib/editor-transcribe.mjs`:

```js
/**
 * Whisper-compatible transcription helpers for the executor.
 * Pure functions only — the HTTP orchestration lives in executor.mjs.
 */

/** Extract mono 16 kHz mp3 — small upload, ample quality for ASR. */
export function audioExtractArgs(inputPath, outputPath) {
  return ['-y', '-i', inputPath, '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'libmp3lame', '-b:a', '64k', outputPath]
}

const round3 = (value) => Math.round(Number(value) * 1000) / 1000

/**
 * Map an OpenAI verbose_json transcription payload into the platform's
 * TranscriptSegment shape. Top-level `words` are assigned to segments by
 * time containment (word.start within [segment.start, segment.end)).
 */
export function segmentsFromVerboseJson(payload) {
  const rawSegments = Array.isArray(payload?.segments) ? payload.segments : []
  const rawWords = Array.isArray(payload?.words) ? payload.words : []
  const segments = rawSegments
    .filter((segment) => segment && typeof segment.start === 'number' && typeof segment.end === 'number' && String(segment.text ?? '').trim())
    .map((segment, index) => {
      const start = round3(Math.max(0, segment.start))
      const end = round3(Math.max(start, segment.end))
      const words = rawWords
        .filter((word) => word && typeof word.start === 'number' && typeof word.end === 'number'
          && String(word.word ?? '').trim() && word.start >= start - 0.001 && word.start < end)
        .map((word) => ({ text: String(word.word).trim(), start: round3(word.start), end: round3(word.end) }))
      return { id: `seg-${segment.id ?? index}`, start, end, text: String(segment.text).trim(), words }
    })
  return {
    language: typeof payload?.language === 'string' ? payload.language : undefined,
    durationSeconds: typeof payload?.duration === 'number' ? round3(payload.duration) : undefined,
    segments,
  }
}
```

In `scripts/higgsfield-executor/lib/editor-filtergraph.mjs`:

1. Add the import at the top: `import { escapeSubtitlesPath } from './editor-captions.mjs'`
2. Change the signature: `export function compileEditorFiltergraph({ timeline, settings, localMediaPaths, fontFile, captionAssPath }) {`
3. Immediately before the line `chains.push(`[${current}]format=yuv420p[vout]`)`, insert:

```js
  if (captionAssPath) {
    const label = 'cap0'
    chains.push(`[${current}]subtitles=filename=${escapeSubtitlesPath(captionAssPath)}[${label}]`)
    current = label
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest __tests__/scripts/editor-transcribe.test.ts __tests__/scripts/editor-filtergraph.test.ts`
Expected: PASS (all existing filtergraph goldens still green — the new argument is optional).

- [ ] **Step 5: Commit**

```bash
git add scripts/higgsfield-executor/lib/editor-transcribe.mjs scripts/higgsfield-executor/lib/editor-filtergraph.mjs __tests__/scripts/editor-transcribe.test.ts __tests__/scripts/editor-filtergraph.test.ts
git commit -m "feat(executor): transcription helpers and subtitles burn-in in the filtergraph"
```

---

### Task 19: Executor — `/video-editor/transcriptions` endpoint + render `.ass` wiring

**Files:**
- Modify: `scripts/higgsfield-executor/executor.mjs`

`executor.mjs` boots an HTTP server on import, so it has no jest coverage (same as today) — all new logic beyond orchestration already lives in the tested lib modules. Verify with `node --check` and the deploy-time smoke test (Task 25).

- [ ] **Step 1: Add imports and env** — top of `executor.mjs`, extend the imports:

```js
import { buildAssDocument, timelineHasCaptions } from './lib/editor-captions.mjs'
import { audioExtractArgs, segmentsFromVerboseJson } from './lib/editor-transcribe.mjs'
```

Below the `EDITOR_FONT_FILE` const, add:

```js
const TRANSCRIBE_BASE_URL = (process.env.TRANSCRIBE_BASE_URL || 'https://ai-gateway.vercel.sh/v1').replace(/\/$/, '')
const TRANSCRIBE_API_KEY = process.env.TRANSCRIBE_API_KEY || ''
const TRANSCRIBE_MODEL = process.env.TRANSCRIBE_MODEL || 'openai/whisper-1'
const TRANSCRIBE_BYOK_DEFAULT_MODEL = 'whisper-1'
const EDITOR_TRANSCRIBE_TIMEOUT_MS = Number(process.env.EDITOR_TRANSCRIBE_TIMEOUT_MS || 15 * 60 * 1000)
```

- [ ] **Step 2: Wire `.ass` into `executeEditorRender`** — replace the `compileEditorFiltergraph` call block with:

```js
    let captionAssPath
    if (timelineHasCaptions(manifest.timeline)) {
      captionAssPath = join(workDir, 'captions.ass')
      await writeFile(captionAssPath, buildAssDocument({ timeline: manifest.timeline, settings: manifest.settings }), 'utf8')
    }

    const compiled = compileEditorFiltergraph({
      timeline: manifest.timeline,
      settings: manifest.settings,
      localMediaPaths,
      ...(EDITOR_FONT_FILE ? { fontFile: EDITOR_FONT_FILE } : {}),
      ...(captionAssPath ? { captionAssPath } : {}),
    })
```

- [ ] **Step 3: Add `executeEditorTranscription`** — after `executeEditorRender`:

```js
async function executeEditorTranscription(job, manifest) {
  const base = baseUrlFrom(manifest)
  const reportPath = manifest.report?.path
    || `/api/v1/video-editor/transcripts/${manifest.job.id}?orgId=${encodeURIComponent(manifest.job.orgId)}`

  const fail = async (message, code = 'transcription_error') => {
    job.status = 'failed'
    job.providerStatus = code
    job.providerStatusMessage = message.slice(0, 1500)
    log('error', 'transcription failed', { jobId: manifest.job.id, code, message: job.providerStatusMessage })
    await platformPut(base, reportPath, { status: 'failed', error: { code, message: message.slice(0, 4000) } })
  }

  let workDir
  try {
    await platformPut(base, reportPath, { status: 'processing' })
    workDir = await mkdtemp(join(tmpdir(), 'vtrans-'))

    const mediaFile = await downloadEditorMedia(manifest.media.url, workDir, 0)
    const audioFile = join(workDir, 'audio.mp3')
    const extract = await runFfmpeg(audioExtractArgs(mediaFile, audioFile), 10 * 60 * 1000)
    if (extract.code !== 0) {
      await fail(`ffmpeg audio extraction exited ${extract.code}: ${extract.stderr.trim().slice(-800)}`, 'audio_extract_failed')
      return
    }

    // BYOK (per-job, never persisted) beats the platform gateway defaults.
    const byok = manifest.byok && typeof manifest.byok.apiKey === 'string' ? manifest.byok : null
    const baseUrl = (byok?.baseUrl || (byok ? 'https://api.openai.com/v1' : TRANSCRIBE_BASE_URL)).replace(/\/$/, '')
    const apiKey = byok ? byok.apiKey : TRANSCRIBE_API_KEY
    const model = byok?.model || (byok ? TRANSCRIBE_BYOK_DEFAULT_MODEL : TRANSCRIBE_MODEL)
    if (!apiKey) {
      await fail('No transcription credential available (set TRANSCRIBE_API_KEY or supply BYOK)', 'transcription_not_configured')
      return
    }

    const form = new FormData()
    form.set('file', new Blob([await readFile(audioFile)], { type: 'audio/mpeg' }), 'audio.mp3')
    form.set('model', model)
    form.set('response_format', 'verbose_json')
    form.append('timestamp_granularities[]', 'word')
    form.append('timestamp_granularities[]', 'segment')
    if (typeof manifest.language === 'string' && manifest.language && manifest.language !== 'auto') {
      form.set('language', manifest.language)
    }

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), EDITOR_TRANSCRIBE_TIMEOUT_MS)
    let response
    try {
      response = await fetch(`${baseUrl}/audio/transcriptions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}` },
        body: form,
        signal: controller.signal,
      })
    } finally {
      clearTimeout(timer)
    }
    const text = await response.text().catch(() => '')
    if (!response.ok) {
      await fail(`Transcription provider rejected the request (${response.status}): ${text.slice(0, 500)}`, 'provider_rejected')
      return
    }
    let payload = {}
    try { payload = JSON.parse(text) } catch { payload = {} }
    const mapped = segmentsFromVerboseJson(payload)
    if (!mapped.segments.length) {
      await fail('Provider returned no usable segments', 'empty_transcription')
      return
    }

    const report = await platformPut(base, reportPath, {
      status: 'completed',
      segments: mapped.segments,
      ...(mapped.language ? { language: mapped.language } : {}),
      ...(mapped.durationSeconds !== undefined ? { durationSeconds: mapped.durationSeconds } : {}),
    })
    if (!report.ok) {
      await fail(`Transcription succeeded but the platform rejected completion (HTTP ${report.status}): ${(report.body || '').slice(0, 300)}`, 'platform_complete_failed')
      return
    }

    job.status = 'completed'
    job.providerStatus = 'completed'
    job.providerStatusMessage = 'Transcribed by higgsfield-executor.'
    log('info', 'transcription completed', { jobId: manifest.job.id, segments: mapped.segments.length })
  } catch (error) {
    await fail(`Executor error: ${String(error?.message || error).slice(0, 800)}`, 'executor_error')
  } finally {
    if (workDir) rm(workDir, { recursive: true, force: true }).catch(() => {})
    setTimeout(() => jobs.delete(job.providerJobId), JOB_TTL_MS).unref?.()
  }
}
```

- [ ] **Step 4: Add the endpoint** — in the `createServer` handler, after the `POST /video-editor/renders` block:

```js
    if (req.method === 'POST' && url.pathname === '/video-editor/transcriptions') {
      const body = JSON.parse(await readBody(req) || 'null')
      if (body?.kind !== 'video_editor_transcription' || !body.job?.id || !body.job?.orgId || !body.job?.projectId
          || !body.media?.url) {
        return json(res, 400, { error: 'Valid video_editor_transcription manifest is required' })
      }
      const providerJobId = `vtx-${body.job.id}-${randomUUID().slice(0, 8)}`
      const job = {
        providerJobId,
        jobId: body.job.id,
        status: 'running',
        providerStatus: 'executor_accepted',
        providerStatusMessage: 'Transcription accepted.',
        createdAt: Date.now(),
      }
      jobs.set(providerJobId, job)
      log('info', 'transcription accepted', { jobId: body.job.id, providerJobId, byok: Boolean(body.byok) })
      executeEditorTranscription(job, body).catch((error) => log('error', 'executeEditorTranscription crashed', { jobId: body.job.id, error: String(error) }))
      return json(res, 200, { providerJobId, status: 'running', providerStatus: job.providerStatus, providerStatusMessage: job.providerStatusMessage })
    }

    const transcriptionStatusMatch = url.pathname.match(/^\/video-editor\/transcriptions\/([A-Za-z0-9-]+)$/)
    if (req.method === 'GET' && transcriptionStatusMatch) {
      const job = jobs.get(transcriptionStatusMatch[1])
      if (!job) return json(res, 404, { error: 'Job not found' })
      return json(res, 200, {
        providerJobId: job.providerJobId,
        status: job.status,
        providerStatus: job.providerStatus,
        providerStatusMessage: job.providerStatusMessage,
      })
    }
```

> **Never log `body.byok` contents** — the accepted-log line above logs only its presence.

- [ ] **Step 5: Verify syntax + full script suite, then commit**

```bash
node --check scripts/higgsfield-executor/executor.mjs
npx jest __tests__/scripts
git add scripts/higgsfield-executor/executor.mjs
git commit -m "feat(executor): transcription endpoint and .ass burn-in wiring"
```

Expected: `node --check` silent (exit 0); jest PASS.

---

### Task 20: `CaptionsPanel` — caption editor UI

**Files:**
- Create: `components/video-editor/CaptionsPanel.tsx`
- Test: `__tests__/components/video-editor-captions-panel.test.tsx`

The panel lists the caption track's cues (one row per caption clip), lets the client edit text inline, split/merge/nudge cues via the pure ops from Task 7, switch style/animation presets for the whole track, transcribe media ("Transcribe project audio" → `POST /api/v1/video-editor/transcripts`), and generate the caption track from a completed transcript (`POST /api/v1/video-editor/projects/[id]/captions/generate`). All timeline mutations go through the shell's `applyTimeline` callback so undo/redo and autosave behave exactly like TimelinePanel edits.

- [ ] **Step 1: Write the failing test** — create `__tests__/components/video-editor-captions-panel.test.tsx`:

```tsx
/** @jest-environment jsdom */
import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import { CaptionsPanel } from '@/components/video-editor/CaptionsPanel'
import { emptyEditorTimeline } from '@/lib/video-editor/types'
import type { EditorTimeline } from '@/lib/video-editor/types'

const timelineWithCaptions = (): EditorTimeline => ({
  version: 1,
  tracks: [
    {
      id: 'cap-track',
      kind: 'caption',
      clips: [
        {
          id: 'cue-1',
          timelineStart: 0,
          duration: 2,
          caption: { text: 'Hello world', stylePreset: 'clean', animationPreset: 'none', words: [] },
        },
        {
          id: 'cue-2',
          timelineStart: 2,
          duration: 2,
          caption: { text: 'Second cue', stylePreset: 'clean', animationPreset: 'none', words: [] },
        },
      ],
    },
  ],
})

describe('CaptionsPanel', () => {
  it('shows an empty state with transcribe + generate actions when no caption track exists', () => {
    render(
      <CaptionsPanel
        timeline={emptyEditorTimeline()}
        transcripts={[]}
        busy={false}
        onApplyTimeline={jest.fn()}
        onTranscribe={jest.fn()}
        onGenerateCaptions={jest.fn()}
        onSeek={jest.fn()}
      />,
    )
    expect(screen.getByText(/no captions yet/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /transcribe project audio/i })).toBeInTheDocument()
  })

  it('renders one editable row per cue and applies a text edit through onApplyTimeline', () => {
    const onApplyTimeline = jest.fn()
    render(
      <CaptionsPanel
        timeline={timelineWithCaptions()}
        transcripts={[]}
        busy={false}
        onApplyTimeline={onApplyTimeline}
        onTranscribe={jest.fn()}
        onGenerateCaptions={jest.fn()}
        onSeek={jest.fn()}
      />,
    )
    const input = screen.getByDisplayValue('Hello world')
    fireEvent.change(input, { target: { value: 'Hello there' } })
    fireEvent.blur(input)
    expect(onApplyTimeline).toHaveBeenCalledTimes(1)
    const next: EditorTimeline = onApplyTimeline.mock.calls[0][0]
    expect(next.tracks[0].clips[0].caption?.text).toBe('Hello there')
  })

  it('splits a cue at its midpoint via the row Split action', () => {
    const onApplyTimeline = jest.fn()
    render(
      <CaptionsPanel
        timeline={timelineWithCaptions()}
        transcripts={[]}
        busy={false}
        onApplyTimeline={onApplyTimeline}
        onTranscribe={jest.fn()}
        onGenerateCaptions={jest.fn()}
        onSeek={jest.fn()}
      />,
    )
    fireEvent.click(screen.getAllByRole('button', { name: /split/i })[0])
    const next: EditorTimeline = onApplyTimeline.mock.calls[0][0]
    expect(next.tracks[0].clips).toHaveLength(3)
  })

  it('disables generate until a completed transcript is selected', () => {
    const onGenerateCaptions = jest.fn()
    render(
      <CaptionsPanel
        timeline={emptyEditorTimeline()}
        transcripts={[{ id: 'tr-1', status: 'completed', label: 'Main audio', language: 'en' }]}
        busy={false}
        onApplyTimeline={jest.fn()}
        onTranscribe={jest.fn()}
        onGenerateCaptions={onGenerateCaptions}
        onSeek={jest.fn()}
      />,
    )
    fireEvent.change(screen.getByLabelText(/transcript/i), { target: { value: 'tr-1' } })
    fireEvent.click(screen.getByRole('button', { name: /generate captions/i }))
    expect(onGenerateCaptions).toHaveBeenCalledWith('tr-1')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/components/video-editor-captions-panel.test.tsx`
Expected: FAIL — `Cannot find module '@/components/video-editor/CaptionsPanel'`

- [ ] **Step 3: Implement `components/video-editor/CaptionsPanel.tsx`**

```tsx
'use client'

import { useMemo, useState } from 'react'
import type { EditorTimeline, EditorTrack } from '@/lib/video-editor/types'
import { EDITOR_CAPTION_STYLE_PRESETS, EDITOR_CAPTION_ANIMATION_PRESETS } from '@/lib/video-editor/types'
import { splitCaptionCue, mergeCaptionCueWithNext, nudgeCaptionCue } from '@/lib/video-editor/caption-ops'

export interface CaptionsPanelTranscriptOption {
  id: string
  status: string
  label: string
  language?: string
}

interface CaptionsPanelProps {
  timeline: EditorTimeline
  transcripts: CaptionsPanelTranscriptOption[]
  busy: boolean
  onApplyTimeline: (next: EditorTimeline, description: string) => void
  onTranscribe: () => void
  onGenerateCaptions: (transcriptId: string) => void
  onSeek: (seconds: number) => void
}

function captionTrack(timeline: EditorTimeline): EditorTrack | undefined {
  return timeline.tracks.find((track) => track.kind === 'caption')
}

export function CaptionsPanel({
  timeline,
  transcripts,
  busy,
  onApplyTimeline,
  onTranscribe,
  onGenerateCaptions,
  onSeek,
}: CaptionsPanelProps) {
  const track = useMemo(() => captionTrack(timeline), [timeline])
  const [selectedTranscript, setSelectedTranscript] = useState('')
  const completed = transcripts.filter((t) => t.status === 'completed')

  const updateCueText = (clipId: string, text: string) => {
    if (!track) return
    const next: EditorTimeline = {
      ...timeline,
      tracks: timeline.tracks.map((t) =>
        t.id !== track.id
          ? t
          : {
              ...t,
              clips: t.clips.map((clip) =>
                clip.id === clipId && clip.caption ? { ...clip, caption: { ...clip.caption, text } } : clip,
              ),
            },
      ),
    }
    onApplyTimeline(next, 'Edit caption text')
  }

  const applyOp = (fn: (timeline: EditorTimeline, trackId: string, clipId: string) => EditorTimeline, clipId: string, description: string) => {
    if (!track) return
    onApplyTimeline(fn(timeline, track.id, clipId), description)
  }

  const setTrackPreset = (key: 'stylePreset' | 'animationPreset', value: string) => {
    if (!track) return
    const next: EditorTimeline = {
      ...timeline,
      tracks: timeline.tracks.map((t) =>
        t.id !== track.id
          ? t
          : { ...t, clips: t.clips.map((clip) => (clip.caption ? { ...clip, caption: { ...clip.caption, [key]: value } } : clip)) },
      ),
    }
    onApplyTimeline(next, 'Change caption preset')
  }

  return (
    <div className="pib-card-section flex flex-col gap-3" aria-label="Captions">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">Captions</h3>
        <button type="button" className="pib-button-secondary text-xs" onClick={onTranscribe} disabled={busy}>
          Transcribe project audio
        </button>
      </div>

      <div className="flex items-end gap-2">
        <label className="flex flex-1 flex-col gap-1 text-xs">
          <span>Transcript</span>
          <select
            className="pib-input"
            value={selectedTranscript}
            onChange={(event) => setSelectedTranscript(event.target.value)}
          >
            <option value="">Select a transcript…</option>
            {completed.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label} {t.language ? `(${t.language})` : ''}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className="pib-button-primary text-xs"
          disabled={busy || !selectedTranscript}
          onClick={() => onGenerateCaptions(selectedTranscript)}
        >
          Generate captions
        </button>
      </div>

      {track ? (
        <>
          <div className="flex gap-2">
            <label className="flex flex-1 flex-col gap-1 text-xs">
              <span>Style</span>
              <select className="pib-input" onChange={(event) => setTrackPreset('stylePreset', event.target.value)} defaultValue={track.clips[0]?.caption?.stylePreset ?? 'clean'}>
                {EDITOR_CAPTION_STYLE_PRESETS.map((preset) => (
                  <option key={preset} value={preset}>{preset}</option>
                ))}
              </select>
            </label>
            <label className="flex flex-1 flex-col gap-1 text-xs">
              <span>Animation</span>
              <select className="pib-input" onChange={(event) => setTrackPreset('animationPreset', event.target.value)} defaultValue={track.clips[0]?.caption?.animationPreset ?? 'none'}>
                {EDITOR_CAPTION_ANIMATION_PRESETS.map((preset) => (
                  <option key={preset} value={preset}>{preset}</option>
                ))}
              </select>
            </label>
          </div>
          <ol className="flex max-h-80 flex-col gap-1 overflow-y-auto">
            {track.clips.map((clip, index) => (
              <li key={clip.id} className="flex items-center gap-2 rounded border border-slate-200 p-2">
                <button type="button" className="text-xs tabular-nums text-slate-500" onClick={() => onSeek(clip.timelineStart)}>
                  {clip.timelineStart.toFixed(2)}s
                </button>
                <input
                  className="pib-input flex-1 text-sm"
                  defaultValue={clip.caption?.text ?? ''}
                  onBlur={(event) => {
                    if (event.target.value !== clip.caption?.text) updateCueText(clip.id, event.target.value)
                  }}
                  aria-label={`Caption ${index + 1} text`}
                />
                <button type="button" className="pib-button-secondary text-xs" onClick={() => applyOp((tl, trackId, clipId) => splitCaptionCue(tl, trackId, clipId), clip.id, 'Split caption')}>
                  Split
                </button>
                <button
                  type="button"
                  className="pib-button-secondary text-xs"
                  disabled={index === track.clips.length - 1}
                  onClick={() => applyOp((tl, trackId, clipId) => mergeCaptionCueWithNext(tl, trackId, clipId), clip.id, 'Merge caption')}
                >
                  Merge ↓
                </button>
                <button type="button" className="pib-button-secondary text-xs" aria-label={`Nudge caption ${index + 1} later`} onClick={() => applyOp((tl, trackId, clipId) => nudgeCaptionCue(tl, trackId, clipId, 0.1), clip.id, 'Nudge caption')}>
                  +0.1s
                </button>
              </li>
            ))}
          </ol>
        </>
      ) : (
        <p className="text-xs text-slate-500">
          No captions yet. Transcribe your project audio (or generate a voiceover) and captions are created from the
          transcript with word-level timing.
        </p>
      )}
    </div>
  )
}
```

Note: if Task 7 exported the cue ops with different signatures, adapt the three `applyOp` call sites to match Task 7's actual exports — the ops are the source of truth, not this panel.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest __tests__/components/video-editor-captions-panel.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add components/video-editor/CaptionsPanel.tsx __tests__/components/video-editor-captions-panel.test.tsx
git commit -m "feat(video-editor): caption editor panel with cue edit/split/merge/nudge and presets"
```

---

### Task 21: `TtsPanel` — voiceover UI

**Files:**
- Create: `components/video-editor/TtsPanel.tsx`
- Test: `__tests__/components/video-editor-tts-panel.test.tsx`

Sections textarea (one paragraph per section), voice picker fed by `GET /api/v1/video-editor/tts/voices`, provider chip (Gateway default / ElevenLabs when the org has a BYOK connection), credit estimate from `estimateTtsCredits`, and a Generate button posting to `POST /api/v1/video-editor/projects/[id]/tts` (contract from Task 15). On success the shell refreshes the project (new audio clips + shared transcript appear).

- [ ] **Step 1: Write the failing test** — create `__tests__/components/video-editor-tts-panel.test.tsx`:

```tsx
/** @jest-environment jsdom */
import React from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { TtsPanel } from '@/components/video-editor/TtsPanel'

describe('TtsPanel', () => {
  const voices = [
    { id: 'alloy', label: 'Alloy', provider: 'gateway' },
    { id: 'el-rachel', label: 'Rachel', provider: 'elevenlabs' },
  ]

  it('shows a live credit estimate for the entered text', () => {
    render(<TtsPanel voices={voices} busy={false} onGenerate={jest.fn()} />)
    fireEvent.change(screen.getByLabelText(/voiceover script/i), { target: { value: 'a'.repeat(2000) } })
    expect(screen.getByText(/credits/i)).toBeInTheDocument()
  })

  it('splits paragraphs into sections and calls onGenerate with voice + sections', async () => {
    const onGenerate = jest.fn().mockResolvedValue(undefined)
    render(<TtsPanel voices={voices} busy={false} onGenerate={onGenerate} />)
    fireEvent.change(screen.getByLabelText(/voiceover script/i), {
      target: { value: 'First section.\n\nSecond section.' },
    })
    fireEvent.change(screen.getByLabelText(/voice/i), { target: { value: 'el-rachel' } })
    fireEvent.click(screen.getByRole('button', { name: /generate voiceover/i }))
    await waitFor(() =>
      expect(onGenerate).toHaveBeenCalledWith({
        voice: 'el-rachel',
        provider: 'elevenlabs',
        sections: [{ text: 'First section.' }, { text: 'Second section.' }],
      }),
    )
  })

  it('disables generate while busy or empty', () => {
    render(<TtsPanel voices={voices} busy onGenerate={jest.fn()} />)
    expect(screen.getByRole('button', { name: /generate voiceover/i })).toBeDisabled()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/components/video-editor-tts-panel.test.tsx`
Expected: FAIL — module not found

- [ ] **Step 3: Implement `components/video-editor/TtsPanel.tsx`**

```tsx
'use client'

import { useMemo, useState } from 'react'
import { estimateTtsCredits } from '@/lib/video-editor/credits'

export interface TtsVoiceOption {
  id: string
  label: string
  provider: 'gateway' | 'elevenlabs'
}

export interface TtsGenerateRequest {
  voice: string
  provider: 'gateway' | 'elevenlabs'
  sections: Array<{ text: string }>
}

interface TtsPanelProps {
  voices: TtsVoiceOption[]
  busy: boolean
  onGenerate: (request: TtsGenerateRequest) => Promise<void>
}

export function TtsPanel({ voices, busy, onGenerate }: TtsPanelProps) {
  const [script, setScript] = useState('')
  const [voiceId, setVoiceId] = useState(voices[0]?.id ?? '')

  const sections = useMemo(
    () =>
      script
        .split(/\n{2,}/)
        .map((part) => part.trim())
        .filter(Boolean)
        .map((text) => ({ text })),
    [script],
  )
  const credits = useMemo(() => estimateTtsCredits(script.replace(/\s+/g, ' ').length), [script])
  const voice = voices.find((v) => v.id === voiceId)

  return (
    <div className="pib-card-section flex flex-col gap-3" aria-label="Voiceover">
      <h3 className="text-sm font-semibold">AI voiceover</h3>
      <label className="flex flex-col gap-1 text-xs">
        <span>Voiceover script (blank line = new section)</span>
        <textarea
          className="pib-input min-h-32 text-sm"
          value={script}
          onChange={(event) => setScript(event.target.value)}
          aria-label="Voiceover script"
        />
      </label>
      <label className="flex flex-col gap-1 text-xs">
        <span>Voice</span>
        <select className="pib-input" value={voiceId} onChange={(event) => setVoiceId(event.target.value)} aria-label="Voice">
          {voices.map((v) => (
            <option key={v.id} value={v.id}>
              {v.label} {v.provider === 'elevenlabs' ? '· ElevenLabs (your key)' : '· Platform'}
            </option>
          ))}
        </select>
      </label>
      <div className="flex items-center justify-between">
        <span className="text-xs text-slate-500">
          {sections.length} section{sections.length === 1 ? '' : 's'} · ~{credits} credits
        </span>
        <button
          type="button"
          className="pib-button-primary text-xs"
          disabled={busy || sections.length === 0 || !voice}
          onClick={() => {
            if (!voice) return
            void onGenerate({ voice: voice.id, provider: voice.provider, sections })
          }}
        >
          Generate voiceover
        </button>
      </div>
      <p className="text-[11px] text-slate-400">
        Captions generated afterwards use this voiceover's own word timing — they can never drift out of sync.
      </p>
    </div>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest __tests__/components/video-editor-tts-panel.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add components/video-editor/TtsPanel.tsx __tests__/components/video-editor-tts-panel.test.tsx
git commit -m "feat(video-editor): TTS voiceover panel with voice picker and credit estimate"
```

---

### Task 22: Shell wiring — Captions/Voiceover tabs + API calls

**Files:**
- Modify: `components/video-editor/VideoEditorShell.tsx`
- Test: extend `__tests__/components/video-editor-captions-panel.test.tsx` is NOT needed; add `__tests__/components/video-editor-shell-captions.test.tsx`

Add right-panel tabs `Inspector | Captions | Voiceover`. The shell owns the fetch glue:
- `loadTranscripts()` → `GET /api/v1/video-editor/transcripts?projectId={id}` on mount and after actions.
- `handleTranscribe()` → `POST /api/v1/video-editor/transcripts { projectId }`, then poll the transcript until `completed`/`failed` (10 s interval, same pattern as render-job polling), toast on completion.
- `handleGenerateCaptions(transcriptId)` → `POST /api/v1/video-editor/projects/{id}/captions/generate { transcriptId }`, then reload the project and push the returned timeline into the undo history as one step.
- `handleTtsGenerate(request)` → `POST /api/v1/video-editor/projects/{id}/tts`, reload project + transcripts.
- Voices loaded once via `GET /api/v1/video-editor/tts/voices`.

- [ ] **Step 1: Write the failing test** — create `__tests__/components/video-editor-shell-captions.test.tsx` asserting: (a) the three tab buttons render, (b) switching to Captions renders the CaptionsPanel empty state, (c) `fetch` was called for transcripts and voices on mount. Mock `fetch` globally with route-keyed responses (copy the fetch-mock helper style from the existing `__tests__/components/video-editor-*.test.tsx` suites) and mock heavy children (`PreviewPlayer`, `TimelinePanel`) with `jest.mock` stubs exactly as the existing shell tests do.

```tsx
/** @jest-environment jsdom */
import React from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

jest.mock('@/components/video-editor/PreviewPlayer', () => ({ PreviewPlayer: () => <div data-testid="preview" /> }))
jest.mock('@/components/video-editor/TimelinePanel', () => ({ TimelinePanel: () => <div data-testid="timeline" /> }))

import { VideoEditorShell } from '@/components/video-editor/VideoEditorShell'

const fetchMock = jest.fn(async (input: RequestInfo | URL) => {
  const url = String(input)
  if (url.includes('/video-editor/projects/')) {
    return new Response(JSON.stringify({ success: true, data: { project: { id: 'p-1', orgId: 'o-1', title: 'T', settings: { width: 1920, height: 1080, fps: 30, aspect: '16:9', background: '#000000' }, timeline: { version: 1, tracks: [] }, status: 'draft' } } }), { status: 200 })
  }
  if (url.includes('/video-editor/transcripts')) {
    return new Response(JSON.stringify({ success: true, data: { transcripts: [] } }), { status: 200 })
  }
  if (url.includes('/video-editor/tts/voices')) {
    return new Response(JSON.stringify({ success: true, data: { voices: [{ id: 'alloy', label: 'Alloy', provider: 'gateway' }] } }), { status: 200 })
  }
  return new Response(JSON.stringify({ success: true, data: {} }), { status: 200 })
})

beforeEach(() => {
  global.fetch = fetchMock as unknown as typeof fetch
  fetchMock.mockClear()
})

describe('VideoEditorShell caption tabs', () => {
  it('renders Inspector/Captions/Voiceover tabs and loads transcripts + voices', async () => {
    render(<VideoEditorShell projectId="p-1" apiScope="portal" />)
    await waitFor(() => expect(screen.getByRole('tab', { name: /captions/i })).toBeInTheDocument())
    expect(screen.getByRole('tab', { name: /inspector/i })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /voiceover/i })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('tab', { name: /captions/i }))
    await waitFor(() => expect(screen.getByText(/no captions yet/i)).toBeInTheDocument())
    const urls = fetchMock.mock.calls.map((call) => String(call[0]))
    expect(urls.some((u) => u.includes('/video-editor/transcripts'))).toBe(true)
    expect(urls.some((u) => u.includes('/video-editor/tts/voices'))).toBe(true)
  })
})
```

Adjust the `VideoEditorShell` props in the test to the component's real prop names (check the existing shell tests) — the assertions, not the prop spelling, are the contract here.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/components/video-editor-shell-captions.test.tsx`
Expected: FAIL — no tabs rendered

- [ ] **Step 3: Implement in `VideoEditorShell.tsx`**

Add state + glue (adapt fetch paths through the shell's existing `scopedApiPath` helper):

```tsx
type RightPanelTab = 'inspector' | 'captions' | 'voiceover'
const [rightTab, setRightTab] = useState<RightPanelTab>('inspector')
const [transcripts, setTranscripts] = useState<CaptionsPanelTranscriptOption[]>([])
const [voices, setVoices] = useState<TtsVoiceOption[]>([])
const [captionsBusy, setCaptionsBusy] = useState(false)

const loadTranscripts = useCallback(async () => {
  const res = await fetch(scopedApiPath(`/api/v1/video-editor/transcripts?projectId=${projectId}`, apiScope))
  const body = await res.json().catch(() => ({}))
  const data = body.data ?? body
  setTranscripts(
    (data.transcripts ?? []).map((t: { id: string; status: string; source: string; language?: string }) => ({
      id: t.id,
      status: t.status,
      language: t.language,
      label: t.source === 'tts' ? 'Voiceover transcript' : 'Audio transcript',
    })),
  )
}, [projectId, apiScope])

useEffect(() => {
  void loadTranscripts()
  void (async () => {
    const res = await fetch(scopedApiPath('/api/v1/video-editor/tts/voices', apiScope))
    const body = await res.json().catch(() => ({}))
    setVoices((body.data ?? body).voices ?? [])
  })()
}, [loadTranscripts, apiScope])

const handleTranscribe = useCallback(async () => {
  setCaptionsBusy(true)
  try {
    await fetch(scopedApiPath('/api/v1/video-editor/transcripts', apiScope), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId }),
    })
    await loadTranscripts()
  } finally {
    setCaptionsBusy(false)
  }
}, [projectId, apiScope, loadTranscripts])

const handleGenerateCaptions = useCallback(
  async (transcriptId: string) => {
    setCaptionsBusy(true)
    try {
      const res = await fetch(scopedApiPath(`/api/v1/video-editor/projects/${projectId}/captions/generate`, apiScope), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transcriptId }),
      })
      const body = await res.json().catch(() => ({}))
      const nextTimeline = (body.data ?? body).timeline
      if (nextTimeline) applyTimeline(nextTimeline, 'Generate captions')
    } finally {
      setCaptionsBusy(false)
    }
  },
  [projectId, apiScope, applyTimeline],
)

const handleTtsGenerate = useCallback(
  async (request: TtsGenerateRequest) => {
    await fetch(scopedApiPath(`/api/v1/video-editor/projects/${projectId}/tts`, apiScope), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    })
    await Promise.all([reloadProject(), loadTranscripts()])
  },
  [projectId, apiScope, reloadProject, loadTranscripts],
)
```

Render the tab strip (role="tab" buttons) above the right panel and switch between `<InspectorPanel …/>`, `<CaptionsPanel timeline={timeline} transcripts={transcripts} busy={captionsBusy} onApplyTimeline={applyTimeline} onTranscribe={handleTranscribe} onGenerateCaptions={handleGenerateCaptions} onSeek={seekTo} />`, and `<TtsPanel voices={voices} busy={captionsBusy} onGenerate={handleTtsGenerate} />`. Use the shell's real `applyTimeline`/`reloadProject`/`seekTo` names (they exist from P1 — verify before wiring; if named differently, use the existing names).

Add transcript polling: while any transcript is `queued`/`running`, `setInterval` 10 s → `loadTranscripts()`, cleared on unmount (mirror the render-job polling effect that already exists in the shell).

- [ ] **Step 4: Run the shell + panel suites**

Run: `npx jest __tests__/components/video-editor-shell-captions.test.tsx __tests__/components/video-editor-captions-panel.test.tsx __tests__/components/video-editor-tts-panel.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add components/video-editor/VideoEditorShell.tsx __tests__/components/video-editor-shell-captions.test.tsx
git commit -m "feat(video-editor): captions + voiceover tabs wired to transcript/TTS APIs"
```

---

### Task 23: Final gates + VPS executor deploy

**Files:**
- No new files; verification + deploy.

- [ ] **Step 1: Full verification gates**

```bash
npm run typecheck
npx jest __tests__/lib __tests__/api __tests__/components __tests__/scripts
git diff --check
```

Expected: typecheck clean; all suites PASS; no whitespace errors.

- [ ] **Step 2: Heavy build gate**

Run: `NODE_OPTIONS=--max-old-space-size=10240 npm run build`
Expected: build completes (typecheck is the real type gate; this catches server/client bundling boundaries — e.g. the TTS provider module must never be imported into a client component).

- [ ] **Step 3: VPS deploy (Peet-approved access, byte-identical policy)**

```bash
ssh root@65.108.146.144 "cp /opt/higgsfield-executor/executor.mjs /opt/higgsfield-executor/executor.mjs.bak-$(date +%Y%m%d)"
scp scripts/higgsfield-executor/executor.mjs root@65.108.146.144:/opt/higgsfield-executor/executor.mjs
scp scripts/higgsfield-executor/lib/editor-captions.mjs scripts/higgsfield-executor/lib/editor-transcribe.mjs scripts/higgsfield-executor/lib/editor-filtergraph.mjs root@65.108.146.144:/opt/higgsfield-executor/lib/
ssh root@65.108.146.144 "shasum -a 256 /opt/higgsfield-executor/executor.mjs" # compare against local shasum
ssh root@65.108.146.144 "systemctl restart higgsfield-executor && sleep 2 && curl -s localhost:8787/health"
```

Expected: sha256 matches local; health returns `{"ok":true,...}`.

- [ ] **Step 4: Live QA script**

On a dev server with the seeded org (Phase 0 seed script): upload a short MP4 → Transcribe → captions generate with word timing → edit a cue → generate a voiceover (Gateway voice) → confirm the caption track regenerated from the TTS transcript matches the audio → render → download the MP4 (captions burned in) and confirm the sidecar `.srt` is attached to the render output record.

- [ ] **Step 5: Push**

```bash
git push origin development
```

## Self-review addendum (Tasks 20–23)

- Tasks 20–22 consume only names defined earlier in this plan (`EDITOR_CAPTION_STYLE_PRESETS`, cue ops from Task 7, `estimateTtsCredits` from Task 5, routes from Tasks 11–16); each task notes to defer to the earlier task's actual export signatures if they differ.
- The desync-proof invariant is enforced end-to-end: the UI offers no path to captions except through a transcript.
- VPS deploy follows the byte-identical + dated-.bak policy from the P1 plan.
