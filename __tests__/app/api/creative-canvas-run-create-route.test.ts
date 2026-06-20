import { NextRequest } from 'next/server'

const mockGetCreativeCanvas = jest.fn()
const mockCreateCreativeCanvasRun = jest.fn()
const mockListCreativeCanvasRuns = jest.fn()
const mockSummarizeCreativeCanvasRuns = jest.fn()

jest.mock('@/lib/api/auth', () => ({
  withAuth: (_role: string, handler: any) => async (req: NextRequest, context?: unknown) =>
    handler(req, { uid: 'agent:maya', role: 'ai', agentId: 'maya', authKind: 'test', orgId: 'org-1', orgIds: ['org-1'] }, context),
}))

jest.mock('@/lib/creative-canvas/store', () => ({
  getCreativeCanvas: mockGetCreativeCanvas,
}))

jest.mock('@/lib/creative-canvas/runs', () => ({
  createCreativeCanvasRun: mockCreateCreativeCanvasRun,
  listCreativeCanvasRuns: mockListCreativeCanvasRuns,
  summarizeCreativeCanvasRuns: mockSummarizeCreativeCanvasRuns,
}))

describe('creative canvas run create API', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockSummarizeCreativeCanvasRuns.mockReturnValue({
      total: 0,
      active: 0,
      failed: 0,
      retryableFailures: 0,
      completed: 0,
      byStatus: { queued: 0, running: 0, waiting_for_review: 0, completed: 0, failed: 0, cancelled: 0 },
      providers: [],
    })
  })

  it('returns a Higgsfield execution manifest with the agent task draft', async () => {
    const { POST } = await import('@/app/api/v1/creative-canvas/[id]/runs/route')
    mockGetCreativeCanvas.mockResolvedValue({
      id: 'canvas-1',
      orgId: 'org-1',
      title: 'Launch Canvas',
      purpose: 'Product launch',
      nodes: [{
        id: 'source-1',
        orgId: 'org-1',
        type: 'source',
        title: 'Product image',
        position: { x: 0, y: 0 },
        data: {},
        source: { kind: 'upload', storagePath: '/tmp/product.png', mimeType: 'image/png' },
      }],
    })
    mockCreateCreativeCanvasRun.mockResolvedValue({
      id: 'run-1',
      orgId: 'org-1',
      canvasId: 'canvas-1',
      nodeId: 'model-1',
      providerKey: 'higgsfield',
      model: 'nano_banana_flash',
      status: 'queued',
      input: {
        promptSummary: 'Create a product launch image',
        sourceNodeIds: ['source-1'],
        sourceArtifactIds: [],
        outputKind: 'image',
        aspectRatio: '1:1',
      },
      provenance: {
        generatedBy: 'agent',
        agentId: 'maya',
        model: 'nano_banana_flash',
        promptStored: 'summary',
        syntheticMedia: true,
      },
    })

    const res = await POST(new NextRequest('http://test.local/api/v1/creative-canvas/canvas-1/runs?orgId=org-1', {
      method: 'POST',
      body: JSON.stringify({
        nodeId: 'model-1',
        providerKey: 'higgsfield',
        model: 'nano_banana_flash',
        input: { promptSummary: 'Create a product launch image', sourceNodeIds: ['source-1'] },
      }),
    }), { params: Promise.resolve({ id: 'canvas-1' }) })
    const body = await res.json()

    expect(mockCreateCreativeCanvasRun).toHaveBeenCalledWith(
      expect.objectContaining({ canvasId: 'canvas-1', providerKey: 'higgsfield' }),
      'org-1',
      { uid: 'agent:maya', type: 'agent' },
    )
    expect(body).toMatchObject({
      success: true,
      data: {
        run: { id: 'run-1', status: 'queued' },
        agentTaskDraft: {
          assigneeAgentId: 'maya',
          agentInput: {
            providerExecution: {
              providerKey: 'higgsfield',
              cli: {
                command: 'higgsfield',
                args: expect.arrayContaining(['generate', 'create', 'nano_banana_flash', '--prompt', 'Create a product launch image', '--image', '/tmp/product.png']),
              },
              dispatch: { path: '/api/v1/creative-canvas/canvas-1/runs/run-1/provider-dispatch?orgId=org-1' },
              callback: { path: '/api/v1/creative-canvas/provider-callbacks/higgsfield' },
            },
          },
        },
      },
    })
  })

  it('lists runs for the selected canvas and org', async () => {
    const { GET } = await import('@/app/api/v1/creative-canvas/[id]/runs/route')
    mockGetCreativeCanvas.mockResolvedValue({
      id: 'canvas-1',
      orgId: 'org-1',
      title: 'Launch Canvas',
      purpose: 'Product launch',
      nodes: [],
    })
    mockListCreativeCanvasRuns.mockResolvedValue([
      {
        id: 'run-1',
        orgId: 'org-1',
        canvasId: 'canvas-1',
        nodeId: 'model-1',
        providerKey: 'higgsfield',
        status: 'running',
        input: { sourceNodeIds: [], sourceArtifactIds: [] },
        provenance: { generatedBy: 'agent', promptStored: 'summary', syntheticMedia: true },
      },
    ])
    mockSummarizeCreativeCanvasRuns.mockReturnValue({
      total: 1,
      active: 1,
      failed: 0,
      retryableFailures: 0,
      completed: 0,
      byStatus: { queued: 0, running: 1, waiting_for_review: 0, completed: 0, failed: 0, cancelled: 0 },
      providers: [{ providerKey: 'higgsfield', total: 1, active: 1, failed: 0, retryableFailures: 0, completed: 0, byStatus: { queued: 0, running: 1, waiting_for_review: 0, completed: 0, failed: 0, cancelled: 0 } }],
    })

    const res = await GET(new NextRequest('http://test.local/api/v1/creative-canvas/canvas-1/runs?orgId=org-1'), {
      params: Promise.resolve({ id: 'canvas-1' }),
    })
    const body = await res.json()

    expect(mockListCreativeCanvasRuns).toHaveBeenCalledWith('canvas-1', 'org-1')
    expect(mockSummarizeCreativeCanvasRuns).toHaveBeenCalledWith([
      expect.objectContaining({ id: 'run-1', status: 'running' }),
    ])
    expect(body).toMatchObject({
      success: true,
      data: {
        runs: [{ id: 'run-1', status: 'running', providerKey: 'higgsfield' }],
        operations: {
          total: 1,
          active: 1,
          providers: [expect.objectContaining({ providerKey: 'higgsfield', active: 1 })],
        },
      },
    })
  })
})
