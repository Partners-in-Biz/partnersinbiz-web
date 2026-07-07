import {
  EDITOR_MEDIA_KINDS,
  EDITOR_TEXT_ALIGNS,
  EDITOR_TEXT_ANIMATION_PRESETS,
  EDITOR_TRACK_KINDS,
  EDITOR_TRANSITION_KINDS,
  VIDEO_EDITOR_ASPECTS,
  VIDEO_EDITOR_FPS_VALUES,
  VIDEO_EDITOR_PROJECT_STATUSES,
  VIDEO_EDITOR_RENDER_JOB_STATUSES,
  defaultVideoEditorSettings,
  emptyEditorTimeline,
} from '@/lib/video-editor/types'
import type { EditorClip, EditorTimeline, VideoEditorProject, VideoEditorRenderJob } from '@/lib/video-editor/types'
import {
  EDITOR_KEYFRAME_EASINGS,
  MEDIA_PREVIEW_STATUSES,
  SPEED_RAMP_PRESET_IDS,
  VIDEO_EDITOR_PREVIEW_COLLECTIONS,
} from '@/lib/video-editor/types'
import type { EditorKeyframe, VideoEditorMediaPreview, VideoEditorProxyLedgerEntry } from '@/lib/video-editor/types'
import {
  EDITOR_CAPTION_ANIMATION_PRESETS,
  EDITOR_CAPTION_STYLE_PRESETS,
  VIDEO_EDITOR_TRANSCRIPT_SOURCES,
  VIDEO_EDITOR_TRANSCRIPT_STATUSES,
} from '@/lib/video-editor/types'

describe('video editor types', () => {
  it('exposes the spec enums', () => {
    expect(EDITOR_TRACK_KINDS).toEqual(['video', 'audio', 'text', 'overlay', 'caption'])
    expect(EDITOR_TRANSITION_KINDS).toEqual(['cut', 'crossfade', 'fade_black', 'slide_left', 'slide_right', 'wipe'])
    expect(EDITOR_MEDIA_KINDS).toEqual(['video', 'audio', 'image'])
    expect(EDITOR_TEXT_ALIGNS).toEqual(['left', 'center', 'right'])
    expect(EDITOR_TEXT_ANIMATION_PRESETS).toEqual(['none', 'fade_in', 'slide_up'])
    expect(VIDEO_EDITOR_FPS_VALUES).toEqual([24, 25, 30, 60])
    expect(VIDEO_EDITOR_ASPECTS).toEqual(['16:9', '9:16', '1:1'])
    expect(VIDEO_EDITOR_PROJECT_STATUSES).toEqual(['draft', 'rendering', 'rendered', 'archived'])
    expect(VIDEO_EDITOR_RENDER_JOB_STATUSES).toEqual(['queued', 'dispatched', 'rendering', 'rendered', 'failed', 'cancelled'])
  })

  it('defaults to 1080p 16:9 at 30fps on black', () => {
    expect(defaultVideoEditorSettings()).toEqual({
      width: 1920,
      height: 1080,
      fps: 30,
      aspect: '16:9',
      background: '#000000',
    })
  })

  it('creates an empty v1 timeline with a video, audio and text track', () => {
    const timeline = emptyEditorTimeline()
    expect(timeline.version).toBe(1)
    expect(timeline.tracks.map((track) => track.kind)).toEqual(['text', 'video', 'audio'])
    expect(timeline.tracks.every((track) => track.clips.length === 0)).toBe(true)
    expect(new Set(timeline.tracks.map((track) => track.id)).size).toBe(3)
  })

  it('compiles the full clip shape including P2 optional fields', () => {
    const clip: EditorClip = {
      id: 'c1',
      timelineStart: 0,
      duration: 4,
      media: { type: 'upload', fileId: 'f1', url: 'https://firebasestorage.googleapis.com/x', mediaKind: 'video', sourceDuration: 10 },
      trimStart: 2,
      speed: 1.5,
      volume: 0.8,
      transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 },
      transitionAfter: { kind: 'crossfade', duration: 0.5 },
      effects: [{ kind: 'lut', params: { name: 'warm' } }],
      keyframes: [{ property: 'transform.opacity', atSeconds: 0, value: 0 }],
    }
    const timeline: EditorTimeline = { version: 1, tracks: [{ id: 't1', kind: 'video', clips: [clip] }] }
    const project: Partial<VideoEditorProject> = { orgId: 'org-1', title: 'Test', timeline }
    const job: Partial<VideoEditorRenderJob> = {
      orgId: 'org-1',
      projectId: 'p1',
      status: 'queued',
      credits: { estimated: 2, charged: 2, refunded: 0 },
    }
    expect(project.timeline?.tracks[0].clips[0].id).toBe('c1')
    expect(job.status).toBe('queued')
  })
})

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
