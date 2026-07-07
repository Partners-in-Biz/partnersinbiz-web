import { NextRequest } from 'next/server'
import type { ApiUser } from '@/lib/api/types'

const mockProjectAdd = jest.fn()
const mockUploadGet = jest.fn()
const mockLoadScoped = jest.fn()

const mockUser: ApiUser = { uid: 'admin-1', role: 'admin' } as ApiUser

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: {
    collection: (name: string) => {
      if (name === 'video_editor_projects') return { add: mockProjectAdd }
      if (name === 'uploads') return { doc: () => ({ get: mockUploadGet }) }
      if (name === 'organizations') return { doc: () => ({ get: jest.fn().mockResolvedValue({ exists: true }) }) }
      throw new Error(`Unexpected collection ${name}`)
    },
  },
}))

jest.mock('@/lib/api/auth', () => ({
  withAuth: (_role: string, handler: (req: NextRequest, user: ApiUser, context?: unknown) => Promise<Response>) =>
    (req: NextRequest, context?: unknown) => handler(req, mockUser, context),
}))

jest.mock('@/lib/api/platformAdmin', () => ({
  canAccessOrg: jest.fn().mockReturnValue(true),
}))

jest.mock('@/lib/youtube-studio/api', () => {
  const actual = jest.requireActual('@/lib/youtube-studio/api')
  return {
    ...actual,
    loadScopedRecord: (...args: unknown[]) => mockLoadScoped(...args),
  }
})

jest.mock('firebase-admin/firestore', () => ({ FieldValue: { serverTimestamp: () => 'SERVER_TS' } }))

const timeline = {
  version: 1,
  tracks: [{
    id: 't1',
    kind: 'video',
    clips: [{
      id: 'c1',
      timelineStart: 0,
      duration: 4,
      media: { type: 'upload', fileId: 'f1', url: 'https://firebasestorage.googleapis.com/a.mp4', mediaKind: 'video' },
    }],
  }],
}

describe('POST /api/v1/video-editor/projects/[id]/reframe', () => {
  const context = { params: Promise.resolve({ id: 'proj-1' }) }

  beforeEach(() => {
    jest.clearAllMocks()
    jest.resetModules()
    mockProjectAdd.mockResolvedValue({ id: 'proj-916' })
    mockLoadScoped.mockResolvedValue({
      id: 'proj-1',
      data: {
        orgId: 'org-1',
        title: 'Landscape edit',
        status: 'draft',
        lastRender: { url: 'https://x.test/horizontal.mp4' },
        settings: { width: 1920, height: 1080, fps: 30, aspect: '16:9', background: '#000000' },
        timeline,
        deleted: false,
      },
    })
    mockUploadGet.mockResolvedValue({
      exists: true,
      data: () => ({
        orgId: 'org-1',
        deleted: false,
        focusTrack: [{ atSeconds: 0, x: 0.5 }, { atSeconds: 2, x: 1 }],
      }),
    })
  })

  it('duplicates a project as a 9:16 reframed variant with focus keyframes', async () => {
    const { POST } = await import('@/app/api/v1/video-editor/projects/[id]/reframe/route')
    const res = await POST(new NextRequest('http://localhost/api/v1/video-editor/projects/proj-1/reframe'), context)
    const body = await res.json()

    expect(res.status).toBe(201)
    expect(body.data).toEqual({
      id: 'proj-916',
      projectId: 'proj-916',
      settings: { width: 1080, height: 1920, fps: 30, aspect: '9:16', background: '#000000' },
    })
    expect(mockProjectAdd).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Landscape edit - 9:16',
      status: 'draft',
      sourceProjectId: 'proj-1',
      settings: { width: 1080, height: 1920, fps: 30, aspect: '9:16', background: '#000000' },
      createdBy: 'admin-1',
      updatedBy: 'admin-1',
    }))
    const written = mockProjectAdd.mock.calls[0][0]
    expect(written.lastRender).toBeUndefined()
    expect(written.timeline.tracks[0].clips[0].transform.scale).toBeCloseTo(1920 / 1080, 3)
    expect(written.timeline.tracks[0].clips[0].keyframes).toHaveLength(2)
  })

  it('rejects projects that are already vertical', async () => {
    mockLoadScoped.mockResolvedValue({
      id: 'proj-1',
      data: {
        orgId: 'org-1',
        title: 'Vertical edit',
        status: 'draft',
        settings: { width: 1080, height: 1920, fps: 30, aspect: '9:16', background: '#000000' },
        timeline,
        deleted: false,
      },
    })
    const { POST } = await import('@/app/api/v1/video-editor/projects/[id]/reframe/route')
    const res = await POST(new NextRequest('http://localhost/api/v1/video-editor/projects/proj-1/reframe'), context)
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.error).toContain('already a 9:16')
    expect(mockProjectAdd).not.toHaveBeenCalled()
  })

  it('returns 404 for missing projects', async () => {
    mockLoadScoped.mockResolvedValue(null)
    const { POST } = await import('@/app/api/v1/video-editor/projects/[id]/reframe/route')
    const res = await POST(new NextRequest('http://localhost/api/v1/video-editor/projects/proj-1/reframe'), context)
    expect(res.status).toBe(404)
    expect(mockProjectAdd).not.toHaveBeenCalled()
  })
})
