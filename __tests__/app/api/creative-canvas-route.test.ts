import { NextRequest } from 'next/server'

const mockCreateCreativeCanvas = jest.fn()
const mockListCreativeCanvases = jest.fn()
const mockGetCreativeCanvas = jest.fn()
const mockUpdateCreativeCanvas = jest.fn()
const mockUpdateCreativeCanvasGraph = jest.fn()

class MockCreativeCanvasVersionConflictError extends Error {
  currentActiveVersion: number
  expectedActiveVersion: number
  conflicts: string[]

  constructor(currentActiveVersion: number, expectedActiveVersion: number, conflicts: string[] = []) {
    super('Creative canvas graph has changed since it was loaded')
    this.name = 'CreativeCanvasVersionConflictError'
    this.currentActiveVersion = currentActiveVersion
    this.expectedActiveVersion = expectedActiveVersion
    this.conflicts = conflicts
  }
}

jest.mock('@/lib/api/auth', () => ({
  withAuth: (_role: string, handler: any) => async (req: NextRequest, context?: unknown) =>
    handler(req, { uid: 'user-1', role: 'admin', authKind: 'test', orgId: 'org-1', orgIds: ['org-1'] }, context),
}))

jest.mock('@/lib/creative-canvas/store', () => ({
  CreativeCanvasVersionConflictError: MockCreativeCanvasVersionConflictError,
  createCreativeCanvas: mockCreateCreativeCanvas,
  listCreativeCanvases: mockListCreativeCanvases,
  getCreativeCanvas: mockGetCreativeCanvas,
  updateCreativeCanvas: mockUpdateCreativeCanvas,
  updateCreativeCanvasGraph: mockUpdateCreativeCanvasGraph,
}))

describe('creative canvas API routes', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('lists canvases for the selected org', async () => {
    const { GET } = await import('@/app/api/v1/creative-canvas/route')
    mockListCreativeCanvases.mockResolvedValue([{ id: 'canvas-1', title: 'Launch' }])

    const res = await GET(new NextRequest('http://test.local/api/v1/creative-canvas?orgId=org-1'))
    const body = await res.json()

    expect(mockListCreativeCanvases).toHaveBeenCalledWith('org-1')
    expect(body).toMatchObject({ success: true, data: { canvases: [{ id: 'canvas-1', title: 'Launch' }] } })
  })

  it('creates a canvas for the selected org', async () => {
    const { POST } = await import('@/app/api/v1/creative-canvas/route')
    mockCreateCreativeCanvas.mockResolvedValue({ id: 'canvas-1', orgId: 'org-1', title: 'Launch' })

    const res = await POST(new NextRequest('http://test.local/api/v1/creative-canvas?orgId=org-1', {
      method: 'POST',
      body: JSON.stringify({ title: 'Launch' }),
    }))
    const body = await res.json()

    expect(mockCreateCreativeCanvas).toHaveBeenCalledWith({ title: 'Launch' }, 'org-1', { uid: 'user-1', type: 'user' })
    expect(res.status).toBe(201)
    expect(body.data.canvas.id).toBe('canvas-1')
  })

  it('saves a graph for the selected org', async () => {
    const { PUT } = await import('@/app/api/v1/creative-canvas/[id]/graph/route')
    mockUpdateCreativeCanvasGraph.mockResolvedValue({ id: 'canvas-1', activeVersion: 2 })

    const res = await PUT(new NextRequest('http://test.local/api/v1/creative-canvas/canvas-1/graph?orgId=org-1', {
      method: 'PUT',
      body: JSON.stringify({ expectedActiveVersion: 1, nodes: [], edges: [] }),
    }), { params: Promise.resolve({ id: 'canvas-1' }) })
    const body = await res.json()

    expect(mockUpdateCreativeCanvasGraph).toHaveBeenCalledWith(
      'canvas-1',
      'org-1',
      { expectedActiveVersion: 1, nodes: [], edges: [] },
      { uid: 'user-1', type: 'user' },
      { expectedActiveVersion: 1, mergeOnConflict: false, baseGraphInput: undefined },
    )
    expect(body.data.canvas.activeVersion).toBe(2)
  })

  it('passes merge context when saving a graph from a stale collaboration base', async () => {
    const { PUT } = await import('@/app/api/v1/creative-canvas/[id]/graph/route')
    mockUpdateCreativeCanvasGraph.mockResolvedValue({ id: 'canvas-1', activeVersion: 5 })
    const baseGraph = { nodes: [{ id: 'source-1' }], edges: [] }

    const res = await PUT(new NextRequest('http://test.local/api/v1/creative-canvas/canvas-1/graph?orgId=org-1', {
      method: 'PUT',
      body: JSON.stringify({ expectedActiveVersion: 2, mergeOnConflict: true, baseGraph, nodes: [], edges: [] }),
    }), { params: Promise.resolve({ id: 'canvas-1' }) })
    const body = await res.json()

    expect(mockUpdateCreativeCanvasGraph).toHaveBeenCalledWith(
      'canvas-1',
      'org-1',
      { expectedActiveVersion: 2, mergeOnConflict: true, baseGraph, nodes: [], edges: [] },
      { uid: 'user-1', type: 'user' },
      { expectedActiveVersion: 2, mergeOnConflict: true, baseGraphInput: baseGraph },
    )
    expect(body.data.canvas.activeVersion).toBe(5)
  })

  it('returns a conflict when a graph save is based on a stale version', async () => {
    const { PUT } = await import('@/app/api/v1/creative-canvas/[id]/graph/route')
    mockUpdateCreativeCanvasGraph.mockRejectedValue(new MockCreativeCanvasVersionConflictError(4, 2, ['node:source-1']))

    const res = await PUT(new NextRequest('http://test.local/api/v1/creative-canvas/canvas-1/graph?orgId=org-1', {
      method: 'PUT',
      body: JSON.stringify({ expectedActiveVersion: 2, nodes: [], edges: [] }),
    }), { params: Promise.resolve({ id: 'canvas-1' }) })
    const body = await res.json()

    expect(res.status).toBe(409)
    expect(body).toMatchObject({
      success: false,
      code: 'creative_canvas_version_conflict',
      currentActiveVersion: 4,
      expectedActiveVersion: 2,
      conflicts: ['node:source-1'],
    })
  })
})
