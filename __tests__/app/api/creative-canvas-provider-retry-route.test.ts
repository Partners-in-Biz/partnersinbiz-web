import { NextRequest } from 'next/server'

const mockRetryCreativeCanvasProviderRun = jest.fn()

jest.mock('@/lib/api/auth', () => ({
  withAuth: (_role: string, handler: any) => async (req: NextRequest, context?: unknown) =>
    handler(req, { uid: 'agent:maya', role: 'ai', agentId: 'maya', authKind: 'test', orgId: 'org-1', orgIds: ['org-1'] }, context),
}))

jest.mock('@/lib/creative-canvas/runs', () => ({
  retryCreativeCanvasProviderRun: mockRetryCreativeCanvasProviderRun,
}))

describe('creative canvas provider retry API', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('requeues a retryable failed provider run', async () => {
    const { PUT } = await import('@/app/api/v1/creative-canvas/[id]/runs/[runId]/retry/route')
    mockRetryCreativeCanvasProviderRun.mockResolvedValue({
      id: 'run-1',
      status: 'queued',
      providerStatus: 'retry_queued',
      providerStatusMessage: 'Retry queued for provider runtime drain.',
    })

    const res = await PUT(new NextRequest('http://test.local/api/v1/creative-canvas/canvas-1/runs/run-1/retry?orgId=org-1', {
      method: 'PUT',
    }), { params: Promise.resolve({ id: 'canvas-1', runId: 'run-1' }) })
    const body = await res.json()

    expect(mockRetryCreativeCanvasProviderRun).toHaveBeenCalledWith('run-1', 'org-1', { uid: 'agent:maya', type: 'agent' })
    expect(body).toMatchObject({
      success: true,
      data: {
        run: {
          id: 'run-1',
          status: 'queued',
          providerStatus: 'retry_queued',
        },
      },
    })
  })

  it('returns a controlled error for non-retryable runs', async () => {
    const { PUT } = await import('@/app/api/v1/creative-canvas/[id]/runs/[runId]/retry/route')
    mockRetryCreativeCanvasProviderRun.mockRejectedValue(new Error('Creative canvas provider run is not marked retryable'))

    const res = await PUT(new NextRequest('http://test.local/api/v1/creative-canvas/canvas-1/runs/run-1/retry?orgId=org-1', {
      method: 'PUT',
    }), { params: Promise.resolve({ id: 'canvas-1', runId: 'run-1' }) })
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body).toMatchObject({
      success: false,
      error: 'Creative canvas provider run is not marked retryable',
    })
  })
})
