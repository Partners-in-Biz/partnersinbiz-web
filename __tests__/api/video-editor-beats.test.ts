import { NextRequest } from 'next/server'
import type { ApiUser } from '@/lib/api/types'

const mockUploadGet = jest.fn()
const mockUploadSet = jest.fn()
const mockFetch = jest.fn()

const mockUser: ApiUser = { uid: 'admin-1', role: 'admin' } as ApiUser

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: {
    collection: (name: string) => {
      if (name === 'uploads') return { doc: () => ({ get: mockUploadGet, set: mockUploadSet }) }
      if (name === 'organizations') return { doc: () => ({ get: jest.fn().mockResolvedValue({ exists: true }) }) }
      throw new Error(`Unexpected collection ${name}`)
    },
  },
}))

jest.mock('@/lib/api/auth', () => ({
  withAuth: (_role: string, handler: (req: NextRequest, user: ApiUser, context?: unknown) => Promise<Response>) =>
    (req: NextRequest, context?: unknown) => handler(req, mockUser, context),
}))

jest.mock('@/lib/youtube-studio/api', () => ({
  ensureOrgAccess: jest.fn().mockResolvedValue(null),
  updateActorFields: () => ({ updatedBy: 'admin-1', updatedByType: 'user' }),
}))

const context = { params: Promise.resolve({ id: 'upload-1' }) }

describe('video-editor media beats route', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    jest.resetModules()
    global.fetch = mockFetch as unknown as typeof fetch
    process.env.HIGGSFIELD_RUNTIME_URL = 'https://runtime.test'
    process.env.HIGGSFIELD_RUNTIME_API_KEY = 'runtime-key'
    process.env.NEXT_PUBLIC_APP_URL = 'https://app.test'
    delete process.env.VIDEO_EDITOR_BEATS_SUBMIT_URL
    mockUploadGet.mockResolvedValue({
      exists: true,
      data: () => ({
        orgId: 'org-1',
        url: 'https://firebasestorage.googleapis.com/m.mp3',
        deleted: false,
      }),
    })
    mockUploadSet.mockResolvedValue(undefined)
  })

  afterEach(() => {
    delete process.env.HIGGSFIELD_RUNTIME_URL
    delete process.env.HIGGSFIELD_RUNTIME_API_KEY
    delete process.env.NEXT_PUBLIC_APP_URL
    delete process.env.VIDEO_EDITOR_BEATS_SUBMIT_URL
  })

  it('GET returns stored beat markers', async () => {
    mockUploadGet.mockResolvedValue({
      exists: true,
      data: () => ({ orgId: 'org-1', beatMarkers: [0.5, 1.0], beatBpm: 120, beatAnalysis: 'analyzed', deleted: false }),
    })
    const { GET } = await import('@/app/api/v1/video-editor/media/[id]/beats/route')
    const res = await GET(new NextRequest('http://localhost/api/v1/video-editor/media/upload-1/beats?orgId=org-1'), context)
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.data).toEqual({ beats: [0.5, 1.0], bpm: 120, status: 'analyzed' })
  })

  it('POST dispatches an analysis manifest to the executor', async () => {
    mockFetch.mockResolvedValue(new Response(JSON.stringify({ providerJobId: 'vbeat-1' }), { status: 200 }))
    const { POST } = await import('@/app/api/v1/video-editor/media/[id]/beats/route')
    const res = await POST(new NextRequest('http://localhost/api/v1/video-editor/media/upload-1/beats?orgId=org-1', { method: 'POST' }), context)
    const body = await res.json()

    expect(res.status).toBe(202)
    expect(body.data).toEqual({ providerJobId: 'vbeat-1' })
    const [calledUrl, init] = mockFetch.mock.calls[0]
    expect(calledUrl).toBe('https://runtime.test/video-editor/analyze-beats')
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer runtime-key')
    const payload = JSON.parse((init as RequestInit).body as string)
    expect(payload).toMatchObject({
      kind: 'video_editor_beats',
      uploadId: 'upload-1',
      orgId: 'org-1',
      media: { url: 'https://firebasestorage.googleapis.com/m.mp3' },
      report: { method: 'PUT', path: '/api/v1/video-editor/media/upload-1/beats?orgId=org-1' },
    })
    expect(payload.callback.url).toBe('https://app.test/api/v1/video-editor/media/upload-1/beats?orgId=org-1')
    expect(mockUploadSet).toHaveBeenCalledWith(
      expect.objectContaining({ beatAnalysis: 'analyzing', updatedBy: 'admin-1' }),
      { merge: true },
    )
  })

  it('POST returns 502 when the runtime is not configured', async () => {
    delete process.env.HIGGSFIELD_RUNTIME_URL
    const { POST } = await import('@/app/api/v1/video-editor/media/[id]/beats/route')
    const res = await POST(new NextRequest('http://localhost/api/v1/video-editor/media/upload-1/beats?orgId=org-1', { method: 'POST' }), context)
    const body = await res.json()

    expect(res.status).toBe(502)
    expect(body.error).toContain('Beat analysis dispatch failed')
    expect(mockUploadSet).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ beatAnalysis: 'analyzing' }),
      { merge: true },
    )
    expect(mockUploadSet).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ beatAnalysis: 'failed' }),
      { merge: true },
    )
  })

  it('PUT stores executor results, clamping junk', async () => {
    const { PUT } = await import('@/app/api/v1/video-editor/media/[id]/beats/route')
    const res = await PUT(new NextRequest('http://localhost/api/v1/video-editor/media/upload-1/beats?orgId=org-1', {
      method: 'PUT',
      body: JSON.stringify({ status: 'analyzed', beats: [0.5, -1, 'x', 3.25], bpm: 128 }),
    }), context)
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.data).toEqual({ status: 'analyzed', beats: 2, bpm: 128 })
    expect(mockUploadSet).toHaveBeenCalledWith(
      expect.objectContaining({ beatMarkers: [0.5, 3.25], beatBpm: 128, beatAnalysis: 'analyzed' }),
      { merge: true },
    )
  })

  it('PUT stores failed reports', async () => {
    const { PUT } = await import('@/app/api/v1/video-editor/media/[id]/beats/route')
    const res = await PUT(new NextRequest('http://localhost/api/v1/video-editor/media/upload-1/beats?orgId=org-1', {
      method: 'PUT',
      body: JSON.stringify({ status: 'failed', error: { code: 'beat_analysis_failed', message: 'decode failed' } }),
    }), context)

    expect(res.status).toBe(200)
    expect(mockUploadSet).toHaveBeenCalledWith(
      expect.objectContaining({ beatAnalysis: 'failed' }),
      { merge: true },
    )
  })

  it('PUT rejects unknown statuses and malformed analyzed reports', async () => {
    const { PUT } = await import('@/app/api/v1/video-editor/media/[id]/beats/route')
    const unknown = await PUT(new NextRequest('http://localhost/api/v1/video-editor/media/upload-1/beats?orgId=org-1', {
      method: 'PUT',
      body: JSON.stringify({ status: 'processing' }),
    }), context)
    expect(unknown.status).toBe(400)

    const malformed = await PUT(new NextRequest('http://localhost/api/v1/video-editor/media/upload-1/beats?orgId=org-1', {
      method: 'PUT',
      body: JSON.stringify({ status: 'analyzed' }),
    }), context)
    expect(malformed.status).toBe(400)
  })

  it('PUT rejects when the upload belongs to another org', async () => {
    mockUploadGet.mockResolvedValue({ exists: true, data: () => ({ orgId: 'org-OTHER', deleted: false }) })
    const { PUT } = await import('@/app/api/v1/video-editor/media/[id]/beats/route')
    const res = await PUT(new NextRequest('http://localhost/api/v1/video-editor/media/upload-1/beats?orgId=org-1', {
      method: 'PUT',
      body: JSON.stringify({ status: 'analyzed', beats: [], bpm: 0 }),
    }), context)

    expect(res.status).toBe(404)
  })
})
