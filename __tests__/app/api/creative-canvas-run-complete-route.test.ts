import { NextRequest } from 'next/server'

const mockCompleteCreativeCanvasRun = jest.fn()

jest.mock('@/lib/api/auth', () => ({
  withAuth: (_role: string, handler: any) => async (req: NextRequest, context?: unknown) =>
    handler(req, { uid: 'user-1', role: 'admin', authKind: 'test', orgId: 'org-1', orgIds: ['org-1'] }, context),
}))

jest.mock('@/lib/creative-canvas/runs', () => ({
  completeCreativeCanvasRun: mockCompleteCreativeCanvasRun,
}))

describe('creative canvas run completion API', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('completes a run for the selected org', async () => {
    const { PUT } = await import('@/app/api/v1/creative-canvas/[id]/runs/[runId]/complete/route')
    mockCompleteCreativeCanvasRun.mockResolvedValue({
      run: { id: 'run-1', status: 'completed' },
      outputNode: { id: 'output-1' },
    })

    const res = await PUT(new NextRequest('http://test.local/api/v1/creative-canvas/canvas-1/runs/run-1/complete?orgId=org-1', {
      method: 'PUT',
      body: JSON.stringify({ outputNodeId: 'output-1', output: { kind: 'image', textPreview: 'Launch hero' } }),
    }), { params: Promise.resolve({ id: 'canvas-1', runId: 'run-1' }) })
    const body = await res.json()

    expect(mockCompleteCreativeCanvasRun).toHaveBeenCalledWith(
      'run-1',
      'org-1',
      { outputNodeId: 'output-1', output: { kind: 'image', textPreview: 'Launch hero' } },
      { uid: 'user-1', type: 'user' },
    )
    expect(body).toMatchObject({
      success: true,
      data: {
        run: { id: 'run-1', status: 'completed' },
        outputNode: { id: 'output-1' },
      },
    })
  })
})
