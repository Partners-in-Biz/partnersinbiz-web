import { NextRequest } from 'next/server'

const mockGetCreativeCanvas = jest.fn()
const mockCreateCreativeCanvasRun = jest.fn()
const mockListCreativeCanvasRuns = jest.fn()
const mockBuildCreativeCanvasAgentTask = jest.fn()

jest.mock('@/lib/api/auth', () => ({
  withAuth: (_role: string, handler: any) => async (req: NextRequest, context?: unknown) =>
    handler(req, { uid: 'uid-9', role: 'client', authKind: 'test', orgId: 'org-1', orgIds: ['org-1'] }, context),
}))

jest.mock('@/lib/creative-canvas/store', () => ({
  getCreativeCanvas: mockGetCreativeCanvas,
}))

jest.mock('@/lib/creative-canvas/runs', () => ({
  createCreativeCanvasRun: mockCreateCreativeCanvasRun,
  listCreativeCanvasRuns: mockListCreativeCanvasRuns,
  summarizeCreativeCanvasRuns: jest.fn(() => ({})),
}))

jest.mock('@/lib/creative-canvas/agent-bridge', () => ({
  buildCreativeCanvasAgentTask: mockBuildCreativeCanvasAgentTask,
}))

jest.mock('@/lib/creative-canvas/provider-runtime', () => ({
  getHiggsfieldRuntimeReadiness: jest.fn(() => ({})),
}))

import { POST } from '@/app/api/v1/creative-canvas/[id]/runs/route'

function makeRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/v1/creative-canvas/canvas-1/runs?orgId=org-1', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  })
}

const context = { params: Promise.resolve({ id: 'canvas-1' }) }

describe('POST /creative-canvas/[id]/runs — provenance forging guard', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockGetCreativeCanvas.mockResolvedValue({ id: 'canvas-1', orgId: 'org-1' })
    mockCreateCreativeCanvasRun.mockResolvedValue({ id: 'run-1', nodeId: 'n1', input: {} })
    mockBuildCreativeCanvasAgentTask.mockReturnValue(null)
  })

  it('strips client-supplied provenance so cost stamps and connection ids cannot be forged', async () => {
    const res = await POST(
      makeRequest({
        nodeId: 'n1',
        providerKey: 'higgsfield',
        model: 'text2image_soul_v2',
        provenance: { costUnits: 0, costLabel: 'byok:higgsfield', connectionId: 'user:victim:higgsfield' },
      }),
      context,
    )
    expect(res.status).toBe(201)
    expect(mockCreateCreativeCanvasRun).toHaveBeenCalledTimes(1)
    const payload = mockCreateCreativeCanvasRun.mock.calls[0][0]
    expect(payload.provenance).toBeUndefined()
    expect(payload.nodeId).toBe('n1')
    expect(payload.canvasId).toBe('canvas-1')
  })
})
