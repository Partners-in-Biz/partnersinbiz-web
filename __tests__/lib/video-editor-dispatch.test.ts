import {
  buildVideoEditorRenderManifest,
  dispatchVideoEditorRenderJob,
  videoEditorRuntimeConfigFromEnv,
} from '@/lib/video-editor/dispatch'
import { defaultVideoEditorSettings } from '@/lib/video-editor/types'
import type { EditorTimeline } from '@/lib/video-editor/types'

const timeline: EditorTimeline = {
  version: 1,
  tracks: [
    {
      id: 't1',
      kind: 'video',
      clips: [
        { id: 'c1', timelineStart: 0, duration: 4, media: { type: 'upload', fileId: 'f1', url: 'https://firebasestorage.googleapis.com/a.mp4', mediaKind: 'video' } },
        { id: 'c2', timelineStart: 4, duration: 2, media: { type: 'canvas_output', canvasId: 'cv1', nodeId: 'n1', runId: 'r1', url: 'https://d1.cloudfront.net/b.mp4', mediaKind: 'video' } },
      ],
    },
    { id: 't2', kind: 'text', clips: [{ id: 'c3', timelineStart: 0, duration: 2, text: { content: 'Hi', fontSizePx: 48, color: '#fff', align: 'center', animationPreset: 'none' } }] },
  ],
}

describe('videoEditorRuntimeConfigFromEnv', () => {
  it('derives the submit url from HIGGSFIELD_RUNTIME_URL with override support', () => {
    expect(videoEditorRuntimeConfigFromEnv({
      HIGGSFIELD_RUNTIME_URL: 'https://vps.test/higgsfield-executor/',
      HIGGSFIELD_RUNTIME_API_KEY: 'key-1',
      NEXT_PUBLIC_APP_URL: 'https://partnersinbiz.online',
    } as NodeJS.ProcessEnv)).toEqual({
      submitUrl: 'https://vps.test/higgsfield-executor/video-editor/renders',
      previewSubmitUrl: 'https://vps.test/higgsfield-executor/video-editor/media-previews',
      apiKey: 'key-1',
      callbackBaseUrl: 'https://partnersinbiz.online',
    })
    expect(videoEditorRuntimeConfigFromEnv({
      VIDEO_EDITOR_RUNTIME_SUBMIT_URL: 'https://other.test/renders',
    } as NodeJS.ProcessEnv).submitUrl).toBe('https://other.test/renders')
    expect(videoEditorRuntimeConfigFromEnv({} as NodeJS.ProcessEnv).submitUrl).toBeUndefined()
  })
})

describe('buildVideoEditorRenderManifest', () => {
  it('collects media refs by clip id and pins report/upload paths', () => {
    const manifest = buildVideoEditorRenderManifest({
      jobId: 'job-1',
      orgId: 'org-1',
      projectId: 'proj-1',
      timeline,
      settings: defaultVideoEditorSettings(),
    })
    expect(manifest.kind).toBe('video_editor_render')
    expect(manifest.job).toEqual({ id: 'job-1', orgId: 'org-1', projectId: 'proj-1' })
    expect(manifest.media).toEqual([
      { clipId: 'c1', url: 'https://firebasestorage.googleapis.com/a.mp4', mediaKind: 'video' },
      { clipId: 'c2', url: 'https://d1.cloudfront.net/b.mp4', mediaKind: 'video' },
    ])
    expect(manifest.report).toEqual({ method: 'PUT', path: '/api/v1/video-editor/render-jobs/job-1?orgId=org-1' })
    expect(manifest.upload).toEqual({ method: 'POST', path: '/api/v1/upload', folder: 'video-editor/org-1/proj-1', filename: 'job-1.mp4' })
  })

  it('collects lut urls keyed by clip and effect index', () => {
    const manifest = buildVideoEditorRenderManifest({
      jobId: 'job-1',
      orgId: 'org-1',
      projectId: 'proj-1',
      settings: defaultVideoEditorSettings(),
      timeline: {
        version: 1,
        tracks: [{
          id: 't1',
          kind: 'video',
          clips: [{
            id: 'c1',
            timelineStart: 0,
            duration: 4,
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

describe('dispatchVideoEditorRenderJob', () => {
  const manifest = buildVideoEditorRenderManifest({
    jobId: 'job-1',
    orgId: 'org-1',
    projectId: 'proj-1',
    timeline,
    settings: defaultVideoEditorSettings(),
  })

  afterEach(() => {
    ;(global.fetch as jest.Mock | undefined)?.mockReset?.()
  })

  it('POSTs the manifest with bearer auth and returns the providerJobId', async () => {
    global.fetch = jest.fn(async () => new Response(JSON.stringify({ providerJobId: 'vedit-job-1-abc', status: 'running' }), { status: 200 })) as unknown as typeof fetch
    const result = await dispatchVideoEditorRenderJob(manifest, {
      submitUrl: 'https://vps.test/video-editor/renders',
      apiKey: 'key-1',
      callbackBaseUrl: 'https://app.test',
    })
    expect(result).toEqual({ providerJobId: 'vedit-job-1-abc' })
    const [url, init] = (global.fetch as jest.Mock).mock.calls[0]
    expect(url).toBe('https://vps.test/video-editor/renders')
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer key-1')
    const body = JSON.parse(init.body as string)
    expect(body.kind).toBe('video_editor_render')
    expect(body.callback.url).toBe('https://app.test/api/v1/video-editor/render-jobs/job-1')
  })

  it('throws on non-2xx, missing providerJobId and missing config', async () => {
    global.fetch = jest.fn(async () => new Response('nope', { status: 503 })) as unknown as typeof fetch
    await expect(dispatchVideoEditorRenderJob(manifest, { submitUrl: 'https://vps.test/x' }))
      .rejects.toThrow('Executor rejected the render (503)')
    global.fetch = jest.fn(async () => new Response('{}', { status: 200 })) as unknown as typeof fetch
    await expect(dispatchVideoEditorRenderJob(manifest, { submitUrl: 'https://vps.test/x' }))
      .rejects.toThrow('no providerJobId')
    await expect(dispatchVideoEditorRenderJob(manifest, {})).rejects.toThrow('not configured')
  })
})

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
