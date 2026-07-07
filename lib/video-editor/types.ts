export type ActorType = 'user' | 'agent' | 'system'

export type VideoEditorFps = 24 | 25 | 30 | 60
export type VideoEditorAspect = '16:9' | '9:16' | '1:1'
export type VideoEditorProjectStatus = 'draft' | 'rendering' | 'rendered' | 'archived'

export const VIDEO_EDITOR_FPS_VALUES: VideoEditorFps[] = [24, 25, 30, 60]
export const VIDEO_EDITOR_ASPECTS: VideoEditorAspect[] = ['16:9', '9:16', '1:1']
export const VIDEO_EDITOR_PROJECT_STATUSES: VideoEditorProjectStatus[] = ['draft', 'rendering', 'rendered', 'archived']

export interface VideoEditorProjectSettings {
  width: number
  height: number
  fps: VideoEditorFps
  aspect: VideoEditorAspect
  background: string
}

export function defaultVideoEditorSettings(): VideoEditorProjectSettings {
  return { width: 1920, height: 1080, fps: 30, aspect: '16:9', background: '#000000' }
}

export type EditorTrackKind = 'video' | 'audio' | 'text' | 'overlay'
export type EditorTransitionKind = 'cut' | 'crossfade' | 'fade_black' | 'slide_left' | 'slide_right' | 'wipe'
export type EditorMediaKind = 'video' | 'audio' | 'image'
export type EditorTextAlign = 'left' | 'center' | 'right'
export type EditorTextAnimationPreset = 'none' | 'fade_in' | 'slide_up'

export const EDITOR_TRACK_KINDS: EditorTrackKind[] = ['video', 'audio', 'text', 'overlay']
export const EDITOR_TRANSITION_KINDS: EditorTransitionKind[] = ['cut', 'crossfade', 'fade_black', 'slide_left', 'slide_right', 'wipe']
export const EDITOR_MEDIA_KINDS: EditorMediaKind[] = ['video', 'audio', 'image']
export const EDITOR_TEXT_ALIGNS: EditorTextAlign[] = ['left', 'center', 'right']
export const EDITOR_TEXT_ANIMATION_PRESETS: EditorTextAnimationPreset[] = ['none', 'fade_in', 'slide_up']

export type MediaRef =
  | { type: 'upload'; fileId: string; url: string; mediaKind: EditorMediaKind; sourceDuration?: number }
  | { type: 'youtube_source_asset'; sourceAssetId: string; url: string; mediaKind: EditorMediaKind; sourceDuration?: number }
  | { type: 'canvas_output'; canvasId: string; nodeId: string; runId: string; url: string; mediaKind: 'video' | 'image'; sourceDuration?: number }

export const MEDIA_REF_TYPES = ['upload', 'youtube_source_asset', 'canvas_output'] as const
export type MediaRefType = (typeof MEDIA_REF_TYPES)[number]

export interface EditorTextPayload {
  content: string
  fontFamily?: string
  fontSizePx: number
  color: string
  backgroundColor?: string
  align: EditorTextAlign
  animationPreset: EditorTextAnimationPreset
}

export interface EditorClipTransform {
  x: number
  y: number
  scale: number
  rotation: number
  opacity: number
}

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

export interface EditorEffectInstance {
  kind: string
  params: Record<string, string | number | boolean>
}

export interface EditorClipTransition {
  kind: EditorTransitionKind
  duration: number
}

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

export interface EditorTrack {
  id: string
  kind: EditorTrackKind
  label?: string
  muted?: boolean
  locked?: boolean
  clips: EditorClip[]
}

export interface EditorTimeline {
  version: 1
  tracks: EditorTrack[]
}

export function emptyEditorTimeline(): EditorTimeline {
  return {
    version: 1,
    tracks: [
      { id: `track-text-${Date.now().toString(36)}`, kind: 'text', label: 'Text', clips: [] },
      { id: `track-video-${(Date.now() + 1).toString(36)}`, kind: 'video', label: 'Video 1', clips: [] },
      { id: `track-audio-${(Date.now() + 2).toString(36)}`, kind: 'audio', label: 'Music', clips: [] },
    ],
  }
}

export interface VideoEditorProjectLastRender {
  jobId: string
  url?: string
  renderedAt?: unknown
  durationSeconds?: number
}

export interface VideoEditorProject {
  id?: string
  orgId: string
  title: string
  channelWorkspaceId?: string
  videoProjectId?: string
  canvasId?: string
  settings: VideoEditorProjectSettings
  timeline: EditorTimeline
  status: VideoEditorProjectStatus
  lastRender?: VideoEditorProjectLastRender
  deleted: boolean
  createdBy?: string
  createdByType?: ActorType
  updatedBy?: string
  updatedByType?: ActorType
  createdAt?: unknown
  updatedAt?: unknown
}

export type VideoEditorRenderJobStatus = 'queued' | 'dispatched' | 'rendering' | 'rendered' | 'failed' | 'cancelled'
export const VIDEO_EDITOR_RENDER_JOB_STATUSES: VideoEditorRenderJobStatus[] = [
  'queued',
  'dispatched',
  'rendering',
  'rendered',
  'failed',
  'cancelled',
]

export interface VideoEditorRenderJobOutput {
  url: string
  storagePath: string
  durationSeconds?: number
  sizeBytes?: number
  sha256?: string
}

export interface VideoEditorRenderJobError {
  code: string
  message: string
}

export interface VideoEditorRenderJobCredits {
  estimated: number
  charged: number
  refunded: number
}

export interface VideoEditorRenderJob {
  id?: string
  orgId: string
  projectId: string
  status: VideoEditorRenderJobStatus
  timelineSnapshot: EditorTimeline
  settingsSnapshot: VideoEditorProjectSettings
  providerJobId?: string
  output?: VideoEditorRenderJobOutput
  error?: VideoEditorRenderJobError
  credits: VideoEditorRenderJobCredits
  provenance?: {
    costLabel: 'video_editor_render'
    dispatchedBy?: string
    dispatchedByType?: ActorType
  }
  deleted: boolean
  createdBy?: string
  createdByType?: ActorType
  updatedBy?: string
  updatedByType?: ActorType
  createdAt?: unknown
  updatedAt?: unknown
}

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
