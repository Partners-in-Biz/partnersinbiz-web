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
