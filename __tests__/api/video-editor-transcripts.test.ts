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
