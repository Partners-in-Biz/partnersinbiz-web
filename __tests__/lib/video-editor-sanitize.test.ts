import {
  sanitizeEditorTimeline,
  sanitizeVideoEditorProjectInput,
  sanitizeVideoEditorRenderJobStatusInput,
  sanitizeVideoEditorSettingsInput,
  serializeVideoEditorRecord,
  validateEditorTimeline,
} from '@/lib/video-editor/sanitize'
import { defaultVideoEditorSettings } from '@/lib/video-editor/types'
import type { EditorTimeline } from '@/lib/video-editor/types'

function findUndefinedPaths(value: unknown, path = 'payload'): string[] {
  if (value === undefined) return [path]
  if (Array.isArray(value)) return value.flatMap((item, index) => findUndefinedPaths(item, `${path}[${index}]`))
  if (!value || typeof value !== 'object') return []
  return Object.entries(value).flatMap(([key, entry]) => findUndefinedPaths(entry, `${path}.${key}`))
}

const validTimeline: EditorTimeline = {
  version: 1,
  tracks: [
    {
      id: 't-video',
      kind: 'video',
      label: 'Video 1',
      clips: [
        {
          id: 'c1',
          timelineStart: 0,
          duration: 4,
          trimStart: 2,
          speed: 1,
          media: { type: 'upload', fileId: 'f1', url: 'https://firebasestorage.googleapis.com/v0/b/x/o/a.mp4', mediaKind: 'video' },
          transitionAfter: { kind: 'crossfade', duration: 1 },
        },
        {
          id: 'c2',
          timelineStart: 4,
          duration: 3,
          media: { type: 'upload', fileId: 'f2', url: 'https://firebasestorage.googleapis.com/v0/b/x/o/b.mp4', mediaKind: 'video' },
        },
      ],
    },
    {
      id: 't-audio',
      kind: 'audio',
      label: 'Music',
      clips: [{
        id: 'c3',
        timelineStart: 0,
        duration: 7,
        volume: 0.8,
        media: { type: 'upload', fileId: 'f3', url: 'https://firebasestorage.googleapis.com/v0/b/x/o/m.mp3', mediaKind: 'audio' },
      }],
    },
    {
      id: 't-text',
      kind: 'text',
      clips: [{
        id: 'c4',
        timelineStart: 1,
        duration: 3,
        text: { content: 'Hello', fontSizePx: 48, color: '#ffffff', align: 'center', animationPreset: 'fade_in' },
      }],
    },
  ],
}

describe('sanitizeVideoEditorSettingsInput', () => {
  it('falls back to defaults for garbage input', () => {
    expect(sanitizeVideoEditorSettingsInput(undefined)).toEqual(defaultVideoEditorSettings())
    expect(sanitizeVideoEditorSettingsInput({ fps: 23, aspect: 'nope', width: -4, background: 12 })).toEqual(defaultVideoEditorSettings())
  })

  it('keeps valid overrides and clamps dimensions', () => {
    expect(sanitizeVideoEditorSettingsInput({ width: 3840, height: 2160, fps: 60, aspect: '16:9', background: '#112233' }))
      .toEqual({ width: 3840, height: 2160, fps: 60, aspect: '16:9', background: '#112233' })
    const clamped = sanitizeVideoEditorSettingsInput({ width: 99999, height: 2, fps: 25, aspect: '9:16', background: '#fff' })
    expect(clamped.width).toBe(4096)
    expect(clamped.height).toBe(16)
  })
})

describe('sanitizeEditorTimeline', () => {
  it('round-trips a valid timeline losslessly including P2 fields', () => {
    const withP2: EditorTimeline = JSON.parse(JSON.stringify(validTimeline))
    withP2.tracks[0].clips[0].effects = [{ kind: 'lut', params: { name: 'warm' } }]
    withP2.tracks[0].clips[0].keyframes = [{ property: 'transform.opacity', atSeconds: 0, value: 0 }]
    const result = sanitizeEditorTimeline(withP2)
    expect(result).toEqual(withP2)
    expect(findUndefinedPaths(result)).toEqual([])
  })

  it('clamps numeric fields and drops unknown keys', () => {
    const result = sanitizeEditorTimeline({
      version: 7,
      tracks: [{
        id: 't1',
        kind: 'video',
        evil: true,
        clips: [{
          id: 'c1',
          timelineStart: -5,
          duration: 3,
          speed: 99,
          volume: 9,
          trimStart: -2,
          transform: { x: 0, y: 0, scale: 200, rotation: 720, opacity: 4 },
          media: { type: 'upload', fileId: 'f1', url: 'https://x.test/a.mp4', mediaKind: 'video' },
          hack: 'yes',
        }],
      }],
    })
    expect(result.version).toBe(1)
    const clip = result.tracks[0].clips[0]
    expect(clip.timelineStart).toBe(0)
    expect(clip.speed).toBe(4)
    expect(clip.volume).toBe(2)
    expect(clip.trimStart).toBe(0)
    expect(clip.transform).toEqual({ x: 0, y: 0, scale: 20, rotation: 720, opacity: 1 })
    expect((clip as Record<string, unknown>).hack).toBeUndefined()
    expect((result.tracks[0] as Record<string, unknown>).evil).toBeUndefined()
  })

  it('drops clips with no id and tracks with no id', () => {
    const result = sanitizeEditorTimeline({
      version: 1,
      tracks: [
        { kind: 'video', clips: [] },
        { id: 't1', kind: 'video', clips: [{ timelineStart: 0, duration: 1 }] },
      ],
    })
    expect(result.tracks).toHaveLength(1)
    expect(result.tracks[0].clips).toHaveLength(0)
  })
})

describe('validateEditorTimeline', () => {
  it('accepts a valid timeline', () => {
    expect(validateEditorTimeline(validTimeline)).toEqual([])
  })

  it('rejects overlapping clips within a track with clip-level paths', () => {
    const bad: EditorTimeline = JSON.parse(JSON.stringify(validTimeline))
    bad.tracks[0].clips[1].timelineStart = 2
    expect(validateEditorTimeline(bad)).toEqual([
      { trackId: 't-video', clipId: 'c2', message: 'Clip overlaps the previous clip on this track.' },
    ])
  })

  it('rejects non-positive durations', () => {
    const bad: EditorTimeline = JSON.parse(JSON.stringify(validTimeline))
    bad.tracks[2].clips[0].duration = 0
    expect(validateEditorTimeline(bad)).toEqual([
      { trackId: 't-text', clipId: 'c4', message: 'Clip duration must be greater than zero.' },
    ])
  })

  it('rejects invalid enum values', () => {
    const issues = validateEditorTimeline({
      version: 1,
      tracks: [{
        id: 't1',
        kind: 'holograph' as never,
        clips: [{
          id: 'c1',
          timelineStart: 0,
          duration: 2,
          media: { type: 'torrent', url: 'https://x.test/a.mp4', mediaKind: 'video' } as never,
          transitionAfter: { kind: 'explode' as never, duration: 1 },
        }],
      }],
    })
    expect(issues).toContainEqual({ trackId: 't1', clipId: null, message: "Invalid track kind 'holograph'." })
    expect(issues).toContainEqual({ trackId: 't1', clipId: 'c1', message: "Invalid transition kind 'explode'." })
    expect(issues).toContainEqual({ trackId: 't1', clipId: 'c1', message: "Invalid media reference type 'torrent'." })
  })

  it('requires media/text and http(s) media urls', () => {
    const issues = validateEditorTimeline({
      version: 1,
      tracks: [
        { id: 't1', kind: 'video', clips: [{ id: 'c1', timelineStart: 0, duration: 2 }] },
        { id: 't2', kind: 'text', clips: [{ id: 'c2', timelineStart: 0, duration: 2 }] },
        {
          id: 't3',
          kind: 'audio',
          clips: [{ id: 'c3', timelineStart: 0, duration: 2, media: { type: 'upload', fileId: 'f', url: 'ftp://nope', mediaKind: 'audio' } }],
        },
      ],
    })
    expect(issues).toContainEqual({ trackId: 't1', clipId: 'c1', message: 'Clip on a video track requires a media reference.' })
    expect(issues).toContainEqual({ trackId: 't2', clipId: 'c2', message: 'Clip on a text track requires a text payload.' })
    expect(issues).toContainEqual({ trackId: 't3', clipId: 'c3', message: 'Media reference url must be an http(s) URL.' })
  })
})

describe('sanitizeVideoEditorProjectInput', () => {
  it('builds a complete create payload with defaults', () => {
    const result = sanitizeVideoEditorProjectInput({ orgId: ' org-1 ', title: '  My cut  ' })
    expect(result.orgId).toBe('org-1')
    expect(result.title).toBe('My cut')
    expect(result.status).toBe('draft')
    expect(result.settings).toEqual(defaultVideoEditorSettings())
    expect(result.timeline.version).toBe(1)
    expect(result.deleted).toBe(false)
    expect(findUndefinedPaths(result)).toEqual([])
  })

  it('whitelists linkage ids and ignores unknown/server-owned fields', () => {
    const result = sanitizeVideoEditorProjectInput({
      orgId: 'org-1',
      title: 'Linked',
      channelWorkspaceId: ' ch-1 ',
      videoProjectId: 'vp-1',
      canvasId: 'cv-1',
      status: 'rendering',
      lastRender: { jobId: 'nope' },
      deleted: true,
      admin: true,
    })
    expect(result.channelWorkspaceId).toBe('ch-1')
    expect(result.videoProjectId).toBe('vp-1')
    expect(result.canvasId).toBe('cv-1')
    expect(result.status).toBe('rendering')
    expect((result as Record<string, unknown>).lastRender).toBeUndefined()
    expect(result.deleted).toBe(false)
    expect((result as Record<string, unknown>).admin).toBeUndefined()
  })
})

describe('sanitizeVideoEditorRenderJobStatusInput', () => {
  it('accepts executor status patches and clamps the error message', () => {
    const patch = sanitizeVideoEditorRenderJobStatusInput({
      status: 'rendered',
      output: {
        url: 'https://firebasestorage.googleapis.com/v0/b/x/o/out.mp4?alt=media',
        storagePath: 'video-editor/org-1/proj-1/job-1.mp4',
        durationSeconds: 61.5,
        sizeBytes: 1234567,
        sha256: 'a'.repeat(64),
        evil: true,
      },
    })
    expect(patch.status).toBe('rendered')
    expect(patch.output).toEqual({
      url: 'https://firebasestorage.googleapis.com/v0/b/x/o/out.mp4?alt=media',
      storagePath: 'video-editor/org-1/proj-1/job-1.mp4',
      durationSeconds: 61.5,
      sizeBytes: 1234567,
      sha256: 'a'.repeat(64),
    })

    const failed = sanitizeVideoEditorRenderJobStatusInput({
      status: 'failed',
      error: { message: `x${'y'.repeat(5000)}` },
    })
    expect(failed.status).toBe('failed')
    expect(failed.error?.code).toBe('render_failed')
    expect(failed.error?.message).toHaveLength(4000)
  })

  it('drops invalid statuses, non-https output urls and incomplete outputs', () => {
    expect(sanitizeVideoEditorRenderJobStatusInput({ status: 'exploded' }).status).toBeUndefined()
    expect(sanitizeVideoEditorRenderJobStatusInput({
      status: 'rendered',
      output: { url: 'http://insecure.test/out.mp4', storagePath: 'x.mp4' },
    }).output).toBeUndefined()
    expect(sanitizeVideoEditorRenderJobStatusInput({
      status: 'rendered',
      output: { url: 'https://x.test/out.mp4' },
    }).output).toBeUndefined()
    expect(sanitizeVideoEditorRenderJobStatusInput(null)).toEqual({})
  })
})

describe('serializeVideoEditorRecord', () => {
  it('deep-serializes firestore data with the doc id', () => {
    const record = serializeVideoEditorRecord<{ title: string }>('abc', { title: 'x', nested: { a: 1 } })
    expect(record).toEqual({ id: 'abc', title: 'x', nested: { a: 1 } })
  })
})
