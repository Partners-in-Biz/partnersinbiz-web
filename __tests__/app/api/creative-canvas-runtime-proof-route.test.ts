import { NextRequest } from 'next/server'

const mockGetCreativeCanvas = jest.fn()
const mockListCreativeCanvasRuns = jest.fn()
const mockBuildCreativeCanvasRuntimeProof = jest.fn()

jest.mock('@/lib/api/auth', () => ({
  withAuth: (_role: string, handler: any) => async (req: NextRequest, context?: unknown) =>
    handler(req, { uid: 'user-1', role: 'client', authKind: 'test', orgId: 'org-1', orgIds: ['org-1'] }, context),
}))

jest.mock('@/lib/creative-canvas/store', () => ({
  getCreativeCanvas: (...args: unknown[]) => mockGetCreativeCanvas(...args),
}))

jest.mock('@/lib/creative-canvas/runs', () => ({
  listCreativeCanvasRuns: (...args: unknown[]) => mockListCreativeCanvasRuns(...args),
}))

jest.mock('@/lib/creative-canvas/runtime-proof', () => ({
  buildCreativeCanvasRuntimeProof: (...args: unknown[]) => mockBuildCreativeCanvasRuntimeProof(...args),
}))

describe('creative canvas runtime proof API', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('returns runtime proof for the requested canvas', async () => {
    const { GET } = await import('@/app/api/v1/creative-canvas/[id]/runtime-proof/route')
    const canvas = { id: 'canvas-1', orgId: 'org-1', linked: { projectId: 'project-1' }, nodes: [], edges: [] }
    const runs = [{ id: 'run-1', status: 'completed' }]
    mockGetCreativeCanvas.mockResolvedValue(canvas)
    mockListCreativeCanvasRuns.mockResolvedValue(runs)
    mockBuildCreativeCanvasRuntimeProof.mockReturnValue({
      canvasId: 'canvas-1',
      orgId: 'org-1',
      status: 'passed',
      readyForLiveProof: true,
      checks: [],
      summary: 'ready',
    })

    const res = await GET(new NextRequest('http://test.local/api/v1/creative-canvas/canvas-1/runtime-proof?orgId=org-1'), {
      params: Promise.resolve({ id: 'canvas-1' }),
    })
    const body = await res.json()

    expect(mockGetCreativeCanvas).toHaveBeenCalledWith('canvas-1', 'org-1')
    expect(mockListCreativeCanvasRuns).toHaveBeenCalledWith('canvas-1', 'org-1')
    expect(mockBuildCreativeCanvasRuntimeProof).toHaveBeenCalledWith({ canvas, runs })
    expect(body).toMatchObject({
      success: true,
      data: { proof: { status: 'passed', readyForLiveProof: true } },
    })
  })

  it('returns 404 when the canvas is missing', async () => {
    const { GET } = await import('@/app/api/v1/creative-canvas/[id]/runtime-proof/route')
    mockGetCreativeCanvas.mockResolvedValue(null)

    const res = await GET(new NextRequest('http://test.local/api/v1/creative-canvas/missing/runtime-proof?orgId=org-1'), {
      params: Promise.resolve({ id: 'missing' }),
    })
    const body = await res.json()

    expect(res.status).toBe(404)
    expect(body).toMatchObject({ success: false, error: 'Creative canvas not found' })
  })
})
