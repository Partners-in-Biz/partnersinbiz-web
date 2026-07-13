import { buildVideoEditorProjectModel } from '@/lib/chat-context/adapters/videoEditor'
import type { VideoEditorProject, VideoEditorRenderJob, VideoEditorTranscript } from '@/lib/video-editor/types'

const project: VideoEditorProject & { id: string } = {
  id: 'project-1', orgId: 'org-1', title: 'Launch cut', status: 'rendering', deleted: false,
  settings: { width: 1080, height: 1920, fps: 30, aspect: '9:16', background: '#000000' },
  timeline: { version: 1, tracks: [
    { id: 'video', kind: 'video', clips: [{ id: 'clip-1', timelineStart: 0, duration: 12, media: { type: 'upload', fileId: 'upload-1', url: 'https://cdn.test/source.mp4', mediaKind: 'video' } }] },
    { id: 'captions', kind: 'caption', clips: [{ id: 'caption-1', timelineStart: 0, duration: 5, caption: { text: 'Hello', words: [], stylePreset: 'clean', animationPreset: 'none' } }] },
  ] }, channelWorkspaceId: 'channel-1', videoProjectId: 'youtube-1', canvasId: 'canvas-1',
}

function job(status: VideoEditorRenderJob['status'], extra: Partial<VideoEditorRenderJob> = {}): VideoEditorRenderJob & { id: string } {
  return { id: `job-${status}`, orgId: 'org-1', projectId: 'project-1', status, timelineSnapshot: project.timeline,
    settingsSnapshot: project.settings, credits: { estimated: 2, charged: 2, refunded: 0 }, deleted: false, ...extra }
}

describe('Video Editor chat context mapping', () => {
  it.each([
    ['queued', 'waiting'], ['dispatched', 'waiting'], ['rendering', 'running'], ['rendered', 'complete'], ['failed', 'blocked'], ['cancelled', 'archived'],
  ] as const)('maps %s without calling a render published', (status, state) => {
    const model = buildVideoEditorProjectModel({ project, jobs: [job(status)], transcripts: [], role: 'client' })
    const render = model.artifacts.find((item) => item.resourceType === 'render')
    expect(render).toEqual(expect.objectContaining({ state, statusLabel: status[0].toUpperCase() + status.slice(1) }))
    expect(render?.state).not.toBe('published')
  })

  it('surfaces timeline, latest output, existing render action, and linked Studio handoffs', () => {
    const rendered = job('rendered', { output: { url: 'https://cdn.test/output.mp4', storagePath: 'renders/output.mp4', durationSeconds: 12 }, updatedAt: '2026-07-13T10:00:00Z' })
    const model = buildVideoEditorProjectModel({ project, jobs: [rendered], transcripts: [], role: 'client' })

    expect(model.context.href).toBe('/portal/video-editor?projectId=project-1&orgId=org-1')
    expect(model.pulse.metrics).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'tracks', value: 2 }), expect.objectContaining({ id: 'clips', value: 2 }), expect.objectContaining({ id: 'duration', value: '12s' }),
    ]))
    expect(model.groups).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'timeline', items: expect.arrayContaining([
      expect.objectContaining({ id: 'video', detail: '1 clip' }), expect.objectContaining({ id: 'captions', detail: '1 clip' }),
    ]) })]))
    expect(model.artifacts.find((item) => item.resourceId === rendered.id)).toEqual(expect.objectContaining({
      state: 'complete', statusLabel: 'Rendered', preview: { kind: 'video', url: 'https://cdn.test/output.mp4' },
      actions: expect.arrayContaining([expect.objectContaining({ id: 'review-output', href: '/portal/video-editor?projectId=project-1&orgId=org-1' })]),
    }))
    expect(model.artifacts.find((item) => item.resourceType === 'project')?.actions).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'render', method: 'POST', href: '/api/v1/video-editor/projects/project-1/render' }),
      expect.objectContaining({ id: 'youtube-handoff', href: '/portal/youtube-studio/editor/youtube-1' }),
      expect.objectContaining({ id: 'marketing-handoff', href: '/portal/creative-canvas?canvasId=canvas-1&orgId=org-1' }),
    ]))
  })

  it('surfaces failures without leaking provider details to clients or exposing a made-up retry API', () => {
    const failed = job('failed', { error: { code: 'runtime', message: 'Renderer unavailable' } })
    const transcript = { id: 'transcript-1', orgId: 'org-1', projectId: 'project-1', source: 'media', status: 'failed', language: 'en',
      segments: [], text: '', provider: 'gateway', alignment: 'provider', credits: { estimated: 1, charged: 1, refunded: 1 },
      error: { code: 'transcribe_failed', message: 'Audio could not be processed' }, deleted: false,
    } as VideoEditorTranscript & { id: string }
    const model = buildVideoEditorProjectModel({ project, jobs: [failed], transcripts: [transcript], role: 'client' })

    expect(model.attention).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'render-failure:job-failed', state: 'blocked', detail: 'The render could not be completed. Try again later.', actions: [expect.objectContaining({ id: 'retry-render', method: 'POST', href: '/api/v1/video-editor/projects/project-1/render' })] }),
      expect.objectContaining({ id: 'transcript-failure:transcript-1', state: 'blocked', detail: 'Captions could not be processed. Review the source media and try again.' }),
    ]))
    expect(model.attention.find((item) => item.id === 'transcript-failure:transcript-1')?.actions?.some((action) => action.id === 'retry')).toBe(false)
  })

  it('never exposes raw persisted runtime failure details for any role', () => {
    const failed = job('failed', { error: { code: 'provider_auth', message: 'Secret provider host rejected key sk-live-sensitive' } })
    for (const role of ['client', 'admin', 'ai'] as const) {
      const model = buildVideoEditorProjectModel({ project, jobs: [failed], transcripts: [], role })
      expect(JSON.stringify(model)).not.toContain('sk-live-sensitive')
      expect(model.attention[0]?.detail).toBe('The render could not be completed. Try again later.')
    }
  })

  it('uses the latest timestamped job as the pulse render and ignores deleted inputs', () => {
    const older = job('rendered', { id: 'older', updatedAt: '2026-07-13T08:00:00Z', output: { url: 'https://cdn.test/old.mp4', storagePath: 'old' } })
    const latest = job('rendering', { id: 'latest', updatedAt: '2026-07-13T09:00:00Z' })
    const deleted = job('failed', { id: 'deleted', deleted: true, updatedAt: '2026-07-13T11:00:00Z' })
    const model = buildVideoEditorProjectModel({ project, jobs: [older, deleted, latest], transcripts: [], role: 'admin' })
    expect(model.pulse.headline).toBe('Latest render: Rendering')
    expect(model.artifacts.some((item) => item.resourceId === 'deleted')).toBe(false)
  })

  it('keeps archived projects readable while suppressing every mutation action', () => {
    const archivedProject = { ...project, status: 'archived' as const }
    const failed = job('failed', { error: { code: 'runtime', message: 'Renderer unavailable' } })
    const model = buildVideoEditorProjectModel({ project: archivedProject, jobs: [failed], transcripts: [], role: 'client' })

    expect(model.context.href).toBe('/portal/video-editor?projectId=project-1&orgId=org-1')
    expect(model.artifacts.find((item) => item.resourceType === 'project')).toEqual(expect.objectContaining({
      state: 'archived', statusLabel: 'Archived',
    }))
    expect(model.artifacts.flatMap((item) => item.actions).every((action) => !action.method)).toBe(true)
    expect(model.attention.flatMap((item) => item.actions ?? []).every((action) => !action.method)).toBe(true)
    expect(model.capabilities).toEqual(['view', 'review_output'])
  })

  it('suppresses client mutations when Marketing create is denied by organisation policy', () => {
    const failed = job('failed')
    const model = buildVideoEditorProjectModel({
      project, jobs: [failed], transcripts: [], role: 'client',
      mutationCapabilities: { canCreate: false },
    })

    expect(model.artifacts.flatMap((item) => item.actions).every((action) => !action.method)).toBe(true)
    expect(model.attention.flatMap((item) => item.actions ?? []).every((action) => !action.method)).toBe(true)
    expect(model.capabilities).not.toContain('create_draft')
    expect(model.capabilities).not.toContain('render')
  })
})
