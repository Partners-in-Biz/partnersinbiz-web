import { NextRequest } from 'next/server'

const mockDispatchCreativeCanvasProviderRun = jest.fn()

jest.mock('@/lib/api/auth', () => ({
  withAuth: (_role: string, handler: any) => async (req: NextRequest, context?: unknown) =>
    handler(req, { uid: 'agent:maya', role: 'ai', agentId: 'maya', authKind: 'test', orgId: 'org-1', orgIds: ['org-1'] }, context),
}))

jest.mock('@/lib/creative-canvas/runs', () => ({
  dispatchCreativeCanvasProviderRun: mockDispatchCreativeCanvasProviderRun,
}))

describe('creative canvas provider dispatch API', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('records provider dispatch metadata for an agent run', async () => {
    const { PUT } = await import('@/app/api/v1/creative-canvas/[id]/runs/[runId]/provider-dispatch/route')
    mockDispatchCreativeCanvasProviderRun.mockResolvedValue({
      id: 'run-1',
      status: 'running',
      provenance: { providerJobId: 'hf-job-2' },
    })

    const res = await PUT(new NextRequest('http://test.local/api/v1/creative-canvas/canvas-1/runs/run-1/provider-dispatch?orgId=org-1', {
      method: 'PUT',
      body: JSON.stringify({
        providerJobId: 'hf-job-2',
        providerStatusUrl: 'https://api.higgsfield.ai/jobs/hf-job-2',
      }),
    }), { params: Promise.resolve({ id: 'canvas-1', runId: 'run-1' }) })
    const body = await res.json()

    expect(mockDispatchCreativeCanvasProviderRun).toHaveBeenCalledWith(
      'run-1',
      'org-1',
      {
        providerJobId: 'hf-job-2',
        providerStatusUrl: 'https://api.higgsfield.ai/jobs/hf-job-2',
      },
      { uid: 'agent:maya', type: 'agent' },
    )
    expect(body).toMatchObject({
      success: true,
      data: {
        run: { id: 'run-1', status: 'running' },
      },
    })
  })
})
