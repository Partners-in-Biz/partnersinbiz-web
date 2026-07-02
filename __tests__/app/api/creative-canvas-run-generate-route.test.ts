import { NextRequest } from 'next/server'

const mockGetCreativeCanvas = jest.fn()
const mockCreateCreativeCanvasRun = jest.fn()
const mockCompleteCreativeCanvasRun = jest.fn()
const mockGenerateInline = jest.fn()
const mockBuildCreativeCanvasAgentTask = jest.fn()

jest.mock('@/lib/api/auth', () => ({
  withAuth: (_role: string, handler: any) => async (req: NextRequest, context?: unknown) =>
    handler(req, { uid: 'agent:maya', role: 'ai', agentId: 'maya', authKind: 'test', orgId: 'org-1', orgIds: ['org-1'] }, context),
}))

jest.mock('@/lib/creative-canvas/store', () => ({
  getCreativeCanvas: mockGetCreativeCanvas,
}))

jest.mock('@/lib/creative-canvas/runs', () => ({
  createCreativeCanvasRun: mockCreateCreativeCanvasRun,
  completeCreativeCanvasRun: mockCompleteCreativeCanvasRun,
}))

jest.mock('@/lib/creative-canvas/agent-bridge', () => ({
  buildCreativeCanvasAgentTask: mockBuildCreativeCanvasAgentTask,
}))

// Immediate dispatch: stub so the route's "kick to runtime now" call is a no-op
// in tests (no Firestore/network). Behaviour is the same as runtime-not-configured.
jest.mock('@/lib/creative-canvas/provider-runtime', () => ({
  dispatchCreativeCanvasRunNow: jest.fn(async () => 'not_configured'),
}))

// Model registry: stub two models so the route's sync + async branches are
// tested independently of the real catalog (which is now all-Higgsfield/async).
jest.mock('@/lib/creative-canvas/model-registry', () => ({
  getCanvasModel: (id: string) => {
    if (id === 'grok-image') {
      return { id, label: 'Sync', family: 'Test', featured: false, kind: 'image', providerKey: 'xai', capabilities: [], aspectRatios: [], maxBatch: 4, creditCost: 2, execution: 'sync' }
    }
    if (id === 'seedance_2_0') {
      return { id, label: 'Async', family: 'Test', featured: true, kind: 'video', providerKey: 'higgsfield', capabilities: [], aspectRatios: [], durations: [8], maxBatch: 4, creditCost: 68, execution: 'async' }
    }
    if (id === 'agent-llm') {
      return { id, label: 'LLM Assistant', family: 'PiB Agents', featured: false, kind: 'text', providerKey: 'agent_task', capabilities: [], aspectRatios: [], maxBatch: 1, creditCost: 1, execution: 'sync' }
    }
    return undefined
  },
}))

// Credit metering: default to no configured limit (always allowed) so the
// generation flow under test is unchanged; record usage is a no-op here.
jest.mock('@/lib/creative-canvas/credits', () => ({
  getCanvasCredits: jest.fn(async (orgId: string) => ({ orgId, used: 0, limit: null, updatedAt: null })),
  hasSufficientCredits: jest.fn(() => true),
  recordCanvasCreditUsage: jest.fn(async () => undefined),
}))

// Keep the real InlineNotSupportedError class so `instanceof` works, but mock generateInline.
jest.mock('@/lib/creative-canvas/inline-generation', () => {
  const actual = jest.requireActual('@/lib/creative-canvas/inline-generation')
  return {
    ...actual,
    generateInline: mockGenerateInline,
  }
})

const CANVAS = {
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
}

describe('creative canvas run generate API', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockBuildCreativeCanvasAgentTask.mockReturnValue({ assigneeAgentId: 'maya', agentInput: {} })
  })

  it('runs a sync model inline and returns a completed run with the output url', async () => {
    const { POST } = await import('@/app/api/v1/creative-canvas/[id]/runs/generate/route')
    mockGetCreativeCanvas.mockResolvedValue(CANVAS)
    mockCreateCreativeCanvasRun.mockResolvedValue({
      id: 'run-1',
      orgId: 'org-1',
      canvasId: 'canvas-1',
      nodeId: 'source-1',
      providerKey: 'xai',
      model: 'grok-image',
      status: 'queued',
      input: { promptSummary: 'A neon product shot', sourceNodeIds: ['source-1'], sourceArtifactIds: [] },
      provenance: { generatedBy: 'agent', agentId: 'maya', promptStored: 'summary', syntheticMedia: true },
    })
    mockGenerateInline.mockResolvedValue({ url: 'https://cdn.example.com/out.png', mimeType: 'image/png' })
    mockCompleteCreativeCanvasRun.mockResolvedValue({
      run: {
        id: 'run-1',
        status: 'completed',
        providerKey: 'xai',
        output: { outputNodeId: 'source-1-output', url: 'https://cdn.example.com/out.png' },
      },
      outputNode: { id: 'source-1-output', type: 'output', output: { kind: 'image', url: 'https://cdn.example.com/out.png' } },
    })

    const res = await POST(new NextRequest('http://test.local/api/v1/creative-canvas/canvas-1/runs/generate?orgId=org-1', {
      method: 'POST',
      body: JSON.stringify({
        nodeId: 'source-1',
        model: 'grok-image',
        prompt: 'A neon product shot',
        aspectRatio: '1:1',
      }),
    }), { params: Promise.resolve({ id: 'canvas-1' }) })
    const body = await res.json()

    expect(mockCreateCreativeCanvasRun).toHaveBeenCalledWith(
      expect.objectContaining({ canvasId: 'canvas-1', providerKey: 'xai', model: 'grok-image' }),
      'org-1',
      { uid: 'agent:maya', type: 'agent' },
    )
    expect(mockGenerateInline).toHaveBeenCalledWith(
      expect.objectContaining({ providerKey: 'xai', model: 'grok-image', prompt: 'A neon product shot', aspectRatio: '1:1' }),
    )
    expect(mockCompleteCreativeCanvasRun).toHaveBeenCalledWith(
      'run-1',
      'org-1',
      expect.objectContaining({ output: expect.objectContaining({ url: 'https://cdn.example.com/out.png' }) }),
      { uid: 'agent:maya', type: 'agent' },
    )
    expect(body).toMatchObject({
      success: true,
      data: {
        run: { id: 'run-1', status: 'completed', output: { url: 'https://cdn.example.com/out.png' } },
        node: { id: 'source-1-output' },
        pending: false,
      },
    })
  })

  it('runs agent-llm text edits inline and completes with a copy textPreview (never dispatched to the executor)', async () => {
    const { POST } = await import('@/app/api/v1/creative-canvas/[id]/runs/generate/route')
    const providerRuntime = await import('@/lib/creative-canvas/provider-runtime')
    mockGetCreativeCanvas.mockResolvedValue(CANVAS)
    mockCreateCreativeCanvasRun.mockResolvedValue({
      id: 'run-3',
      orgId: 'org-1',
      canvasId: 'canvas-1',
      nodeId: 'source-1',
      providerKey: 'agent_task',
      model: 'agent-llm',
      status: 'queued',
      input: { promptSummary: 'Rewrite the chapter', sourceNodeIds: ['source-1'], sourceArtifactIds: [] },
      provenance: { generatedBy: 'agent', agentId: 'maya', promptStored: 'summary', syntheticMedia: true },
    })
    mockGenerateInline.mockResolvedValue({ text: 'The rewritten chapter.', mimeType: 'text/plain' })
    mockCompleteCreativeCanvasRun.mockResolvedValue({
      run: { id: 'run-3', status: 'completed', providerKey: 'agent_task', output: { outputNodeId: 'source-1-output', textPreview: 'The rewritten chapter.' } },
      outputNode: { id: 'source-1-output', type: 'output', output: { kind: 'copy', textPreview: 'The rewritten chapter.' } },
    })

    const res = await POST(new NextRequest('http://test.local/api/v1/creative-canvas/canvas-1/runs/generate?orgId=org-1', {
      method: 'POST',
      body: JSON.stringify({ nodeId: 'source-1', model: 'agent-llm', prompt: 'Rewrite the chapter' }),
    }), { params: Promise.resolve({ id: 'canvas-1' }) })
    const body = await res.json()

    expect(mockGenerateInline).toHaveBeenCalledWith(
      expect.objectContaining({ providerKey: 'agent_task', model: 'agent-llm', prompt: 'Rewrite the chapter' }),
    )
    expect(mockCompleteCreativeCanvasRun).toHaveBeenCalledWith(
      'run-3',
      'org-1',
      { output: { kind: 'copy', textPreview: 'The rewritten chapter.' } },
      { uid: 'agent:maya', type: 'agent' },
    )
    expect(providerRuntime.dispatchCreativeCanvasRunNow).not.toHaveBeenCalled()
    expect(body).toMatchObject({
      success: true,
      data: {
        run: { id: 'run-3', status: 'completed' },
        node: { id: 'source-1-output', output: { kind: 'copy', textPreview: 'The rewritten chapter.' } },
        pending: false,
      },
    })
  })

  it('queues an async model without calling generateInline', async () => {
    const { POST } = await import('@/app/api/v1/creative-canvas/[id]/runs/generate/route')
    mockGetCreativeCanvas.mockResolvedValue(CANVAS)
    mockCreateCreativeCanvasRun.mockResolvedValue({
      id: 'run-2',
      orgId: 'org-1',
      canvasId: 'canvas-1',
      nodeId: 'source-1',
      providerKey: 'higgsfield',
      model: 'seedance_2_0',
      status: 'queued',
      input: { promptSummary: 'A product hero video', sourceNodeIds: ['source-1'], sourceArtifactIds: [] },
      provenance: { generatedBy: 'agent', agentId: 'maya', promptStored: 'summary', syntheticMedia: true },
    })

    const res = await POST(new NextRequest('http://test.local/api/v1/creative-canvas/canvas-1/runs/generate?orgId=org-1', {
      method: 'POST',
      body: JSON.stringify({
        nodeId: 'source-1',
        model: 'seedance_2_0',
        prompt: 'A product hero video',
        aspectRatio: '9:16',
        duration: 8,
      }),
    }), { params: Promise.resolve({ id: 'canvas-1' }) })
    const body = await res.json()

    expect(mockGenerateInline).not.toHaveBeenCalled()
    expect(mockCompleteCreativeCanvasRun).not.toHaveBeenCalled()
    expect(mockCreateCreativeCanvasRun).toHaveBeenCalledWith(
      expect.objectContaining({ canvasId: 'canvas-1', providerKey: 'higgsfield', model: 'seedance_2_0' }),
      'org-1',
      { uid: 'agent:maya', type: 'agent' },
    )
    expect(res.status).toBe(201)
    expect(body).toMatchObject({
      success: true,
      data: {
        run: { id: 'run-2', status: 'queued', providerKey: 'higgsfield' },
        pending: true,
      },
    })
  })

  it('rejects the same way the create route does when the canvas is not in the org', async () => {
    const { POST } = await import('@/app/api/v1/creative-canvas/[id]/runs/generate/route')
    // Tenancy guard: getCreativeCanvas is org-scoped, so a foreign canvas resolves to null → 404.
    mockGetCreativeCanvas.mockResolvedValue(null)

    const res = await POST(new NextRequest('http://test.local/api/v1/creative-canvas/canvas-1/runs/generate?orgId=org-1', {
      method: 'POST',
      body: JSON.stringify({ nodeId: 'source-1', model: 'grok-image', prompt: 'x' }),
    }), { params: Promise.resolve({ id: 'canvas-1' }) })
    const body = await res.json()

    expect(mockGetCreativeCanvas).toHaveBeenCalledWith('canvas-1', 'org-1')
    expect(mockCreateCreativeCanvasRun).not.toHaveBeenCalled()
    expect(mockGenerateInline).not.toHaveBeenCalled()
    expect(res.status).toBe(404)
    expect(body).toMatchObject({ success: false, error: 'Creative canvas not found' })
  })

  it('blocks generation with 402 when the org is over its credit limit', async () => {
    const { POST } = await import('@/app/api/v1/creative-canvas/[id]/runs/generate/route')
    const credits = await import('@/lib/creative-canvas/credits')
    mockGetCreativeCanvas.mockResolvedValue(CANVAS)
    ;(credits.hasSufficientCredits as jest.Mock).mockReturnValueOnce(false)

    const res = await POST(new NextRequest('http://test.local/api/v1/creative-canvas/canvas-1/runs/generate?orgId=org-1', {
      method: 'POST',
      body: JSON.stringify({ nodeId: 'source-1', model: 'grok-image', prompt: 'x' }),
    }), { params: Promise.resolve({ id: 'canvas-1' }) })
    const body = await res.json()

    expect(mockCreateCreativeCanvasRun).not.toHaveBeenCalled()
    expect(mockGenerateInline).not.toHaveBeenCalled()
    expect(res.status).toBe(402)
    expect(body).toMatchObject({ success: false, error: 'Insufficient creative canvas credits' })
  })
})
