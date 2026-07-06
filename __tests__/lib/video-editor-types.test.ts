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

describe('video editor types', () => {
  it('exposes the spec enums', () => {
    expect(EDITOR_TRACK_KINDS).toEqual(['video', 'audio', 'text', 'overlay'])
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
