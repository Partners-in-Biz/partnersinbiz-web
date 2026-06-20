import { NextRequest } from 'next/server'

const mockRetryCreativeCanvasProviderRunsForCanvas = jest.fn()

jest.mock('@/lib/api/auth', () => ({
  withAuth: (_role: string, handler: any) => async (req: NextRequest, context?: unknown) =>
    handler(req, { uid: 'agent:maya', role: 'ai', agentId: 'maya', authKind: 'test', orgId: 'org-1', orgIds: ['org-1'] }, context),
}))

jest.mock('@/lib/creative-canvas/runs', () => ({
  retryCreativeCanvasProviderRunsForCanvas: mockRetryCreativeCanvasProviderRunsForCanvas,
}))

describe('creative canvas provider batch retry API', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('requeues all retryable failed provider runs for a canvas', async () => {
    const { PUT } = await import('@/app/api/v1/creative-canvas/[id]/runs/retry/route')
    mockRetryCreativeCanvasProviderRunsForCanvas.mockResolvedValue({
      retriedRuns: [{ id: 'run-1', status: 'queued', providerStatus: 'retry_queued' }],
      skippedRuns: [{ id: 'run-2', status: 'failed', reason: 'Failed run is not retryable' }],
      operations: {
        total: 2,
        active: 1,
        failed: 1,
        retryableFailures: 0,
        completed: 0,
        byStatus: { queued: 1, running: 0, waiting_for_review: 0, completed: 0, failed: 1, cancelled: 0 },
        providers: [],
      },
    })

    const res = await PUT(new NextRequest('http://test.local/api/v1/creative-canvas/canvas-1/runs/retry?orgId=org-1', {
      method: 'PUT',
    }), { params: Promise.resolve({ id: 'canvas-1' }) })
    const body = await res.json()

    expect(mockRetryCreativeCanvasProviderRunsForCanvas).toHaveBeenCalledWith('canvas-1', 'org-1', { uid: 'agent:maya', type: 'agent' })
    expect(body).toMatchObject({
      success: true,
      data: {
        retriedRuns: [expect.objectContaining({ id: 'run-1', status: 'queued' })],
        skippedRuns: [expect.objectContaining({ id: 'run-2' })],
        operations: expect.objectContaining({ retryableFailures: 0 }),
      },
    })
  })

  it('returns a controlled error when batch retry fails', async () => {
    const { PUT } = await import('@/app/api/v1/creative-canvas/[id]/runs/retry/route')
    mockRetryCreativeCanvasProviderRunsForCanvas.mockRejectedValue(new Error('Creative canvas provider batch retry failed'))

    const res = await PUT(new NextRequest('http://test.local/api/v1/creative-canvas/canvas-1/runs/retry?orgId=org-1', {
      method: 'PUT',
    }), { params: Promise.resolve({ id: 'canvas-1' }) })
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body).toMatchObject({
      success: false,
      error: 'Creative canvas provider batch retry failed',
    })
  })
})
