import {
  EDITOR_MEDIA_KINDS,
  EDITOR_TEXT_ALIGNS,
  EDITOR_TEXT_ANIMATION_PRESETS,
  EDITOR_TRACK_KINDS,
  EDITOR_TRANSITION_KINDS,
  MEDIA_REF_TYPES,
  VIDEO_EDITOR_ASPECTS,
  VIDEO_EDITOR_FPS_VALUES,
  VIDEO_EDITOR_PROJECT_STATUSES,
  VIDEO_EDITOR_RENDER_JOB_STATUSES,
  defaultVideoEditorSettings,
  emptyEditorTimeline,
} from './types'
import type {
  EditorClip,
  EditorClipTransform,
  EditorEffectInstance,
  EditorKeyframe,
  EditorMediaKind,
  EditorTextPayload,
  EditorTimeline,
  EditorTrack,
  EditorTrackKind,
  EditorTransitionKind,
  MediaRef,
  VideoEditorProject,
  VideoEditorProjectSettings,
  VideoEditorProjectStatus,
  VideoEditorRenderJobError,
  VideoEditorRenderJobOutput,
  VideoEditorRenderJobStatus,
} from './types'

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

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  const num = cleanNumber(value)
  if (num === undefined) return fallback
  return Math.min(Math.max(num, min), max)
}

function pickEnum<T extends string | number>(value: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback
}

function compact<T extends PlainRecord>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as T
}

export function sanitizeVideoEditorSettingsInput(value: unknown): VideoEditorProjectSettings {
  const source = cleanObject(value)
  const defaults = defaultVideoEditorSettings()
  const width = cleanNumber(source.width)
  const height = cleanNumber(source.height)
  const fps = cleanNumber(source.fps)
  const aspect = source.aspect
  const background = cleanString(source.background)

  const valid = width !== undefined
    && width > 0
    && height !== undefined
    && height > 0
    && VIDEO_EDITOR_FPS_VALUES.includes(fps as never)
    && VIDEO_EDITOR_ASPECTS.includes(aspect as never)
    && background !== undefined
    && /^#[0-9a-fA-F]{3,8}$/.test(background)

  if (!valid) return defaults

  return {
    width: Math.round(Math.min(Math.max(width, 16), 4096)),
    height: Math.round(Math.min(Math.max(height, 16), 4096)),
    fps: fps as VideoEditorProjectSettings['fps'],
    aspect: aspect as VideoEditorProjectSettings['aspect'],
    background,
  }
}

export function sanitizeMediaRef(value: unknown): MediaRef | undefined {
  const source = cleanObject(value)
  const type = source.type
  const url = cleanString(source.url)
  const mediaKind = pickEnum(source.mediaKind, EDITOR_MEDIA_KINDS, 'video') as EditorMediaKind
  const sourceDuration = cleanNumber(source.sourceDuration)
  if (!url) return undefined
  if (type === 'upload') {
    const fileId = cleanString(source.fileId)
    if (!fileId) return undefined
    return compact({ type: 'upload', fileId, url, mediaKind, sourceDuration }) as MediaRef
  }
  if (type === 'youtube_source_asset') {
    const sourceAssetId = cleanString(source.sourceAssetId)
    if (!sourceAssetId) return undefined
    return compact({ type: 'youtube_source_asset', sourceAssetId, url, mediaKind, sourceDuration }) as MediaRef
  }
  if (type === 'canvas_output') {
    const canvasId = cleanString(source.canvasId)
    const nodeId = cleanString(source.nodeId)
    const runId = cleanString(source.runId)
    if (!canvasId || !nodeId || !runId) return undefined
    const kind = mediaKind === 'audio' ? 'video' : mediaKind
    return compact({ type: 'canvas_output', canvasId, nodeId, runId, url, mediaKind: kind, sourceDuration }) as MediaRef
  }
  return undefined
}

function sanitizeTextPayload(value: unknown): EditorTextPayload | undefined {
  const source = cleanObject(value)
  const content = cleanString(source.content)
  if (!content) return undefined
  return compact({
    content,
    fontFamily: cleanString(source.fontFamily),
    fontSizePx: Math.round(clampNumber(source.fontSizePx, 8, 400, 48)),
    color: cleanString(source.color) ?? '#ffffff',
    backgroundColor: cleanString(source.backgroundColor),
    align: pickEnum(source.align, EDITOR_TEXT_ALIGNS, 'center'),
    animationPreset: pickEnum(source.animationPreset, EDITOR_TEXT_ANIMATION_PRESETS, 'none'),
  })
}

function sanitizeTransform(value: unknown): EditorClipTransform | undefined {
  const source = cleanObject(value)
  if (!Object.keys(source).length) return undefined
  return {
    x: clampNumber(source.x, -8192, 8192, 0),
    y: clampNumber(source.y, -8192, 8192, 0),
    scale: clampNumber(source.scale, 0.01, 20, 1),
    rotation: clampNumber(source.rotation, -3600, 3600, 0),
    opacity: clampNumber(source.opacity, 0, 1, 1),
  }
}

function sanitizeEffects(value: unknown): EditorEffectInstance[] | undefined {
  if (!Array.isArray(value)) return undefined
  const effects = value.flatMap((entry) => {
    const source = cleanObject(entry)
    const kind = cleanString(source.kind)
    if (!kind) return []
    const params = Object.fromEntries(
      Object.entries(cleanObject(source.params)).filter(([, v]) =>
        typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean'),
    ) as EditorEffectInstance['params']
    return [{ kind, params }]
  })
  return effects.length ? effects : undefined
}

const KEYFRAME_PROPERTIES: EditorKeyframe['property'][] = [
  'transform.x',
  'transform.y',
  'transform.scale',
  'transform.rotation',
  'transform.opacity',
  'volume',
  'speed',
]
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
  const keyframes = value.flatMap((entry): EditorKeyframe[] => {
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
    }) as EditorKeyframe]
  })
  keyframes.sort((a, b) => a.property.localeCompare(b.property) || a.atSeconds - b.atSeconds)
  return keyframes.length ? keyframes : undefined
}

function sanitizeClip(value: unknown): EditorClip | undefined {
  const source = cleanObject(value)
  const id = cleanString(source.id)
  if (!id) return undefined
  const transitionSource = cleanObject(source.transitionAfter)
  const transitionKind = cleanString(transitionSource.kind)
  return compact({
    id,
    groupId: cleanString(source.groupId),
    timelineStart: clampNumber(source.timelineStart, 0, 60 * 60 * 4, 0),
    duration: clampNumber(source.duration, 0, 60 * 60 * 4, 0),
    media: sanitizeMediaRef(source.media),
    text: sanitizeTextPayload(source.text),
    trimStart: source.trimStart === undefined ? undefined : clampNumber(source.trimStart, 0, 60 * 60 * 24, 0),
    speed: source.speed === undefined ? undefined : clampNumber(source.speed, 0.25, 4, 1),
    volume: source.volume === undefined ? undefined : clampNumber(source.volume, 0, 2, 1),
    transform: sanitizeTransform(source.transform),
    transitionAfter: transitionKind
      ? {
          kind: pickEnum(transitionKind, EDITOR_TRANSITION_KINDS, 'cut') as EditorTransitionKind,
          duration: clampNumber(transitionSource.duration, 0, 10, 0.5),
        }
      : undefined,
    effects: sanitizeEffects(source.effects),
    keyframes: sanitizeKeyframes(source.keyframes),
  })
}

function sanitizeTrack(value: unknown): EditorTrack | undefined {
  const source = cleanObject(value)
  const id = cleanString(source.id)
  if (!id) return undefined
  const clips = (Array.isArray(source.clips) ? source.clips : [])
    .map((clip) => sanitizeClip(clip))
    .filter((clip): clip is EditorClip => Boolean(clip))
    .sort((a, b) => a.timelineStart - b.timelineStart)
  return compact({
    id,
    kind: pickEnum(source.kind, EDITOR_TRACK_KINDS, 'video') as EditorTrackKind,
    label: cleanString(source.label),
    muted: typeof source.muted === 'boolean' ? source.muted : undefined,
    locked: typeof source.locked === 'boolean' ? source.locked : undefined,
    clips,
  })
}

export function sanitizeEditorTimeline(value: unknown): EditorTimeline {
  const source = cleanObject(value)
  const tracks = (Array.isArray(source.tracks) ? source.tracks : [])
    .map((track) => sanitizeTrack(track))
    .filter((track): track is EditorTrack => Boolean(track))
  return { version: 1, tracks }
}

export interface TimelineValidationIssue {
  trackId: string
  clipId: string | null
  message: string
}

export function validateEditorTimeline(timeline: EditorTimeline): TimelineValidationIssue[] {
  const issues: TimelineValidationIssue[] = []
  const tracks = Array.isArray(timeline?.tracks) ? timeline.tracks : []

  for (const track of tracks) {
    const trackId = track.id ?? '(missing)'
    if (!EDITOR_TRACK_KINDS.includes(track.kind)) {
      issues.push({ trackId, clipId: null, message: `Invalid track kind '${String(track.kind)}'.` })
    }
    const sorted = [...(track.clips ?? [])].sort((a, b) => a.timelineStart - b.timelineStart)
    let previousEnd = -Infinity
    for (const clip of sorted) {
      const clipId = clip.id ?? '(missing)'
      if (!(typeof clip.duration === 'number') || !(clip.duration > 0)) {
        issues.push({ trackId, clipId, message: 'Clip duration must be greater than zero.' })
      }
      if (!(typeof clip.timelineStart === 'number') || clip.timelineStart < 0) {
        issues.push({ trackId, clipId, message: 'Clip timelineStart must be zero or positive.' })
      }
      if (clip.timelineStart < previousEnd - 0.0005) {
        issues.push({ trackId, clipId, message: 'Clip overlaps the previous clip on this track.' })
      }
      previousEnd = Math.max(previousEnd, clip.timelineStart + Math.max(clip.duration ?? 0, 0))

      if (clip.transitionAfter && !EDITOR_TRANSITION_KINDS.includes(clip.transitionAfter.kind)) {
        issues.push({ trackId, clipId, message: `Invalid transition kind '${String(clip.transitionAfter.kind)}'.` })
      }
      if (clip.media) {
        if (!MEDIA_REF_TYPES.includes(clip.media.type as never)) {
          issues.push({ trackId, clipId, message: `Invalid media reference type '${String(clip.media.type)}'.` })
        }
        if (!/^https?:\/\//.test(clip.media.url ?? '')) {
          issues.push({ trackId, clipId, message: 'Media reference url must be an http(s) URL.' })
        }
        if (!EDITOR_MEDIA_KINDS.includes(clip.media.mediaKind as never)) {
          issues.push({ trackId, clipId, message: `Invalid media kind '${String(clip.media.mediaKind)}'.` })
        }
      }
      if ((track.kind === 'video' || track.kind === 'audio' || track.kind === 'overlay') && !clip.media && !(track.kind === 'overlay' && clip.text)) {
        issues.push({ trackId, clipId, message: `Clip on a ${track.kind} track requires a media reference.` })
      }
      if (track.kind === 'text' && !clip.text) {
        issues.push({ trackId, clipId, message: 'Clip on a text track requires a text payload.' })
      }
      if (track.kind === 'audio' && clip.media && clip.media.mediaKind === 'image') {
        issues.push({ trackId, clipId, message: 'Image media is not allowed on an audio track.' })
      }
    }
  }
  return issues
}

export function sanitizeVideoEditorProjectInput(input: PlainRecord): Omit<VideoEditorProject, 'id'> {
  const timeline = input.timeline === undefined ? emptyEditorTimeline() : sanitizeEditorTimeline(input.timeline)
  return compact({
    orgId: cleanString(input.orgId) ?? '',
    title: cleanString(input.title) ?? '',
    channelWorkspaceId: cleanString(input.channelWorkspaceId),
    videoProjectId: cleanString(input.videoProjectId),
    canvasId: cleanString(input.canvasId),
    settings: sanitizeVideoEditorSettingsInput(input.settings),
    timeline,
    status: pickEnum(input.status, VIDEO_EDITOR_PROJECT_STATUSES, 'draft') as VideoEditorProjectStatus,
    deleted: false,
  }) as Omit<VideoEditorProject, 'id'>
}

const RENDER_JOB_PATCH_STATUSES: VideoEditorRenderJobStatus[] = ['rendering', 'rendered', 'failed', 'cancelled']

export interface VideoEditorRenderJobStatusPatch {
  status?: 'rendering' | 'rendered' | 'failed' | 'cancelled'
  output?: VideoEditorRenderJobOutput
  error?: VideoEditorRenderJobError
}

export function sanitizeVideoEditorRenderJobStatusInput(value: unknown): VideoEditorRenderJobStatusPatch {
  const source = cleanObject(value)
  const status = RENDER_JOB_PATCH_STATUSES.includes(source.status as VideoEditorRenderJobStatus)
    ? (source.status as VideoEditorRenderJobStatusPatch['status'])
    : undefined

  let output: VideoEditorRenderJobOutput | undefined
  const outputSource = cleanObject(source.output)
  const url = cleanString(outputSource.url)
  const storagePath = cleanString(outputSource.storagePath)
  if (url && /^https:\/\//.test(url) && storagePath) {
    output = compact({
      url,
      storagePath,
      durationSeconds: cleanNumber(outputSource.durationSeconds),
      sizeBytes: cleanNumber(outputSource.sizeBytes),
      sha256: cleanString(outputSource.sha256),
    })
  }

  let error: VideoEditorRenderJobError | undefined
  const errorSource = cleanObject(source.error)
  const message = cleanString(errorSource.message)
  if (message) {
    error = {
      code: cleanString(errorSource.code) ?? 'render_failed',
      message: message.slice(0, 4000),
    }
  }

  return compact({ status, output, error })
}

export function serializeVideoEditorRecord<T extends object>(id: string, data: PlainRecord): T & { id: string } {
  return { id, ...(JSON.parse(JSON.stringify(data)) as T) }
}

export const VIDEO_EDITOR_SANITIZE_EXPORTS_FOR_TREE_SHAKING = VIDEO_EDITOR_RENDER_JOB_STATUSES
