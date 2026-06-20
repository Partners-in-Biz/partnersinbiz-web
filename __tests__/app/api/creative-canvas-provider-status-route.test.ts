import { NextRequest } from 'next/server'

const mockRefreshCreativeCanvasProviderRunStatus = jest.fn()

jest.mock('@/lib/api/auth', () => ({
  withAuth: (_role: string, handler: any) => async (req: NextRequest, context?: unknown) =>
    handler(req, { uid: 'agent:maya', role: 'ai', agentId: 'maya', authKind: 'test', orgId: 'org-1', orgIds: ['org-1'] }, context),
}))

jest.mock('@/lib/creative-canvas/runs', () => ({
  refreshCreativeCanvasProviderRunStatus: mockRefreshCreativeCanvasProviderRunStatus,
}))

describe('creative canvas provider status API', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('refreshes provider run status for an agent run', async () => {
    const { PUT } = await import('@/app/api/v1/creative-canvas/[id]/runs/[runId]/provider-status/route')
    mockRefreshCreativeCanvasProviderRunStatus.mockResolvedValue({
      id: 'run-1',
      status: 'failed',
      providerStatus: 'error',
      providerStatusMessage: 'Model queue timed out',
    })

    const res = await PUT(new NextRequest('http://test.local/api/v1/creative-canvas/canvas-1/runs/run-1/provider-status?orgId=org-1', {
      method: 'PUT',
      body: JSON.stringify({
        status: 'failed',
        providerStatus: 'error',
        providerStatusMessage: 'Model queue timed out',
        error: { code: 'provider_timeout', message: 'Higgsfield job timed out', retryable: true },
      }),
    }), { params: Promise.resolve({ id: 'canvas-1', runId: 'run-1' }) })
    const body = await res.json()

    expect(mockRefreshCreativeCanvasProviderRunStatus).toHaveBeenCalledWith(
      'run-1',
      'org-1',
      {
        status: 'failed',
        providerStatus: 'error',
        providerStatusMessage: 'Model queue timed out',
        error: { code: 'provider_timeout', message: 'Higgsfield job timed out', retryable: true },
      },
      { uid: 'agent:maya', type: 'agent' },
    )
    expect(body).toMatchObject({
      success: true,
      data: {
        run: {
          id: 'run-1',
          status: 'failed',
          providerStatus: 'error',
        },
      },
    })
  })
})
