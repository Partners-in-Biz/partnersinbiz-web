import { NextRequest } from 'next/server'

const mockListCreativeCanvasVersions = jest.fn()
const mockRestoreCreativeCanvasVersion = jest.fn()
const mockForkCreativeCanvasVersion = jest.fn()

jest.mock('@/lib/api/auth', () => ({
  withAuth: (_role: string, handler: any) => async (req: NextRequest, context?: unknown) =>
    handler(req, { uid: 'user-1', role: 'admin', authKind: 'test', orgId: 'org-1', orgIds: ['org-1'] }, context),
}))

jest.mock('@/lib/creative-canvas/collaboration', () => ({
  listCreativeCanvasVersions: mockListCreativeCanvasVersions,
  restoreCreativeCanvasVersion: mockRestoreCreativeCanvasVersion,
  forkCreativeCanvasVersion: mockForkCreativeCanvasVersion,
}))

describe('creative canvas versions route', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('lists graph versions for the selected org', async () => {
    const { GET } = await import('@/app/api/v1/creative-canvas/[id]/versions/route')
    mockListCreativeCanvasVersions.mockResolvedValue([{ id: 'v2', version: 2 }])

    const res = await GET(new NextRequest('http://test.local/api/v1/creative-canvas/canvas-1/versions?orgId=org-1'), {
      params: Promise.resolve({ id: 'canvas-1' }),
    })
    const body = await res.json()

    expect(mockListCreativeCanvasVersions).toHaveBeenCalledWith('canvas-1', 'org-1')
    expect(body.data.versions).toEqual([{ id: 'v2', version: 2 }])
  })

  it('restores a selected version', async () => {
    const { POST } = await import('@/app/api/v1/creative-canvas/[id]/versions/route')
    mockRestoreCreativeCanvasVersion.mockResolvedValue({ canvas: { id: 'canvas-1', activeVersion: 4 }, version: { id: 'v4' } })

    const res = await POST(new NextRequest('http://test.local/api/v1/creative-canvas/canvas-1/versions?orgId=org-1', {
      method: 'POST',
      body: JSON.stringify({ action: 'restore', versionId: 'v2' }),
    }), { params: Promise.resolve({ id: 'canvas-1' }) })
    const body = await res.json()

    expect(mockRestoreCreativeCanvasVersion).toHaveBeenCalledWith('canvas-1', 'org-1', 'v2', { uid: 'user-1', type: 'user' })
    expect(res.status).toBe(200)
    expect(body.data.canvas.activeVersion).toBe(4)
  })

  it('forks a selected version into a new canvas', async () => {
    const { POST } = await import('@/app/api/v1/creative-canvas/[id]/versions/route')
    mockForkCreativeCanvasVersion.mockResolvedValue({ canvas: { id: 'canvas-fork', activeVersion: 1 }, version: { id: 'fork-v1' } })

    const res = await POST(new NextRequest('http://test.local/api/v1/creative-canvas/canvas-1/versions?orgId=org-1', {
      method: 'POST',
      body: JSON.stringify({ action: 'fork', versionId: 'v2', title: 'Alternate launch' }),
    }), { params: Promise.resolve({ id: 'canvas-1' }) })
    const body = await res.json()

    expect(mockForkCreativeCanvasVersion).toHaveBeenCalledWith('canvas-1', 'org-1', 'v2', { title: 'Alternate launch' }, { uid: 'user-1', type: 'user' })
    expect(res.status).toBe(201)
    expect(body.data.canvas.id).toBe('canvas-fork')
  })
})
