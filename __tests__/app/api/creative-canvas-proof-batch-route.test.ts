import { NextRequest } from 'next/server'

const mockGetCreativeCanvas = jest.fn()
const mockListCreativeCanvasRuns = jest.fn()
const mockQueueCreativeCanvasProofBatchRuns = jest.fn()

jest.mock('@/lib/api/auth', () => ({
  withAuth: (_role: string, handler: any) => async (req: NextRequest, context?: unknown) =>
    handler(req, { uid: 'agent:maya', role: 'ai', agentId: 'maya', authKind: 'test', orgId: 'org-1', orgIds: ['org-1'] }, context),
}))

jest.mock('@/lib/creative-canvas/store', () => ({
  getCreativeCanvas: mockGetCreativeCanvas,
}))

jest.mock('@/lib/creative-canvas/runs', () => ({
  listCreativeCanvasRuns: mockListCreativeCanvasRuns,
  queueCreativeCanvasProofBatchRuns: mockQueueCreativeCanvasProofBatchRuns,
}))

describe('creative canvas proof batch API', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('queues reliability proof runs for the selected canvas', async () => {
    const { POST } = await import('@/app/api/v1/creative-canvas/[id]/runs/proof-batch/route')
    const canvas = { id: 'canvas-1', orgId: 'org-1', title: 'Launch Canvas', nodes: [], edges: [] }
    const runs = [{ id: 'run-active', status: 'running', input: { outputKind: 'video' } }]
    mockGetCreativeCanvas.mockResolvedValue(canvas)
    mockListCreativeCanvasRuns.mockResolvedValue(runs)
    mockQueueCreativeCanvasProofBatchRuns.mockResolvedValue({
      queuedRuns: [{ id: 'proof-image', status: 'queued', providerKey: 'higgsfield' }],
      skippedCategories: [{ category: 'video_social', reason: 'Proof run already active', runId: 'run-active' }],
      operations: {
        total: 2,
        active: 2,
        failed: 0,
        retryableFailures: 0,
        completed: 0,
        byStatus: { queued: 1, running: 1, waiting_for_review: 0, completed: 0, failed: 0, cancelled: 0 },
        providers: [],
      },
    })

    const res = await POST(new NextRequest('http://test.local/api/v1/creative-canvas/canvas-1/runs/proof-batch?orgId=org-1', {
      method: 'POST',
    }), { params: Promise.resolve({ id: 'canvas-1' }) })
    const body = await res.json()

    expect(mockGetCreativeCanvas).toHaveBeenCalledWith('canvas-1', 'org-1')
    expect(mockListCreativeCanvasRuns).toHaveBeenCalledWith('canvas-1', 'org-1')
    expect(mockQueueCreativeCanvasProofBatchRuns).toHaveBeenCalledWith(canvas, 'org-1', { uid: 'agent:maya', type: 'agent' }, runs)
    expect(res.status).toBe(201)
    expect(body).toMatchObject({
      success: true,
      data: {
        queuedRuns: [{ id: 'proof-image', status: 'queued' }],
        skippedCategories: [{ category: 'video_social', runId: 'run-active' }],
        operations: { total: 2, active: 2 },
      },
    })
  })

  it('returns not found when the canvas is missing', async () => {
    const { POST } = await import('@/app/api/v1/creative-canvas/[id]/runs/proof-batch/route')
    mockGetCreativeCanvas.mockResolvedValue(null)

    const res = await POST(new NextRequest('http://test.local/api/v1/creative-canvas/missing/runs/proof-batch?orgId=org-1', {
      method: 'POST',
    }), { params: Promise.resolve({ id: 'missing' }) })
    const body = await res.json()

    expect(res.status).toBe(404)
    expect(body).toMatchObject({
      success: false,
      error: 'Creative canvas not found',
    })
  })
})
