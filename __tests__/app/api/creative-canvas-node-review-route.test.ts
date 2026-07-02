import { NextRequest } from 'next/server'

const mockUpdateCreativeCanvasNodeReview = jest.fn()
const mockGetCreativeCanvas = jest.fn()
const mockUpdateCreativeCanvasGraph = jest.fn()

// Mutable auth identity so individual tests can flip role between client/admin.
const mockAuthUser: { uid: string; role: string; orgId: string; orgIds: string[] } = {
  uid: 'client-1',
  role: 'client',
  orgId: 'org-1',
  orgIds: ['org-1'],
}

jest.mock('@/lib/api/auth', () => ({
  withAuth: (_role: string, handler: any) => async (req: NextRequest, context?: unknown) =>
    handler(req, { ...mockAuthUser, authKind: 'test' }, context),
}))

jest.mock('@/lib/creative-canvas/collaboration', () => ({
  updateCreativeCanvasNodeReview: mockUpdateCreativeCanvasNodeReview,
}))

jest.mock('@/lib/creative-canvas/store', () => ({
  getCreativeCanvas: mockGetCreativeCanvas,
  updateCreativeCanvasGraph: mockUpdateCreativeCanvasGraph,
}))

function buildCanvas(overrides: Record<string, unknown> = {}) {
  return {
    id: 'canvas-1',
    orgId: 'org-1',
    visibility: 'admin_agents_clients',
    activeVersion: 4,
    nodes: [
      {
        id: 'node-1',
        orgId: 'org-1',
        type: 'output',
        title: 'Hero image',
        position: { x: 0, y: 0 },
        data: {},
        review: { status: 'needed', rightsStatus: 'cleared' },
        output: { kind: 'image', url: 'https://cdn.example.com/hero.png' },
      },
      {
        id: 'node-2',
        orgId: 'org-1',
        type: 'brief',
        title: 'Copy block',
        position: { x: 10, y: 10 },
        data: { text: 'Launch copy' },
      },
    ],
    edges: [],
    ...overrides,
  }
}

function reviewRequest(body: unknown, nodeId = 'node-1') {
  return new NextRequest(`http://test.local/api/v1/creative-canvas/canvas-1/nodes/${nodeId}/review?orgId=org-1`, {
    method: 'PUT',
    body: JSON.stringify(body),
  })
}

function routeContext(nodeId = 'node-1') {
  return { params: Promise.resolve({ id: 'canvas-1', nodeId }) }
}

describe('creative canvas node client-review route', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockAuthUser.uid = 'client-1'
    mockAuthUser.role = 'client'
    mockUpdateCreativeCanvasGraph.mockResolvedValue({ id: 'canvas-1', activeVersion: 5 })
  })

  it('approves a node and persists via updateCreativeCanvasGraph with client_review reason', async () => {
    const { PUT } = await import('@/app/api/v1/creative-canvas/[id]/nodes/[nodeId]/review/route')
    const canvas = buildCanvas()
    mockGetCreativeCanvas.mockResolvedValue(canvas)

    const res = await PUT(reviewRequest({ action: 'approve' }), routeContext())
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.success).toBe(true)
    expect(body.data.node.id).toBe('node-1')
    expect(body.data.node.review).toMatchObject({
      status: 'passed',
      rightsStatus: 'cleared',
      reviewedBy: 'client-1',
      reviewedByType: 'user',
    })
    expect(typeof body.data.node.review.reviewedAt).toBe('string')
    expect(body.data.node.data.clientReview).toMatchObject({ action: 'approve', status: 'passed', note: null })

    expect(mockUpdateCreativeCanvasGraph).toHaveBeenCalledTimes(1)
    const [id, orgId, graph, actor, options] = mockUpdateCreativeCanvasGraph.mock.calls[0]
    expect(id).toBe('canvas-1')
    expect(orgId).toBe('org-1')
    expect(actor).toEqual({ uid: 'client-1', type: 'user' })
    expect(options).toMatchObject({
      expectedActiveVersion: 4,
      mergeOnConflict: true,
      reason: 'client_review',
    })
    expect(options.baseGraphInput).toEqual({ nodes: canvas.nodes, edges: canvas.edges })
    const mutated = graph.nodes.find((node: { id: string }) => node.id === 'node-1')
    expect(mutated.review.status).toBe('passed')
    // Untouched sibling node passes through unchanged.
    expect(graph.nodes.find((node: { id: string }) => node.id === 'node-2')).toEqual(canvas.nodes[1])
    expect(mockUpdateCreativeCanvasNodeReview).not.toHaveBeenCalled()
  })

  it('requests changes with a trimmed note capped at 1000 chars', async () => {
    const { PUT } = await import('@/app/api/v1/creative-canvas/[id]/nodes/[nodeId]/review/route')
    mockGetCreativeCanvas.mockResolvedValue(buildCanvas())

    const longNote = `  ${'x'.repeat(1200)}  `
    const res = await PUT(reviewRequest({ action: 'request_changes', note: longNote }), routeContext())
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.data.node.review.status).toBe('needed')
    expect(body.data.node.review.clientNote).toBe('x'.repeat(1000))
    expect(body.data.node.data.clientReview).toMatchObject({
      action: 'request_changes',
      note: 'x'.repeat(1000),
      reviewedBy: 'client-1',
    })
  })

  it('returns 403 for a client when the canvas is not client-visible', async () => {
    const { PUT } = await import('@/app/api/v1/creative-canvas/[id]/nodes/[nodeId]/review/route')
    mockGetCreativeCanvas.mockResolvedValue(buildCanvas({ visibility: 'admin_agents' }))

    const res = await PUT(reviewRequest({ action: 'approve' }), routeContext())
    const body = await res.json()

    expect(res.status).toBe(403)
    expect(body.success).toBe(false)
    expect(mockUpdateCreativeCanvasGraph).not.toHaveBeenCalled()
  })

  it('lets an admin review a canvas that is not client-visible', async () => {
    const { PUT } = await import('@/app/api/v1/creative-canvas/[id]/nodes/[nodeId]/review/route')
    mockAuthUser.uid = 'admin-1'
    mockAuthUser.role = 'admin'
    mockGetCreativeCanvas.mockResolvedValue(buildCanvas({ visibility: 'admin_agents' }))

    const res = await PUT(reviewRequest({ action: 'approve' }), routeContext())

    expect(res.status).toBe(200)
    expect(mockUpdateCreativeCanvasGraph).toHaveBeenCalledTimes(1)
  })

  it('returns 404 for an unknown canvas', async () => {
    const { PUT } = await import('@/app/api/v1/creative-canvas/[id]/nodes/[nodeId]/review/route')
    mockGetCreativeCanvas.mockResolvedValue(null)

    const res = await PUT(reviewRequest({ action: 'approve' }), routeContext())

    expect(res.status).toBe(404)
    expect(mockUpdateCreativeCanvasGraph).not.toHaveBeenCalled()
  })

  it('returns 404 for an unknown node', async () => {
    const { PUT } = await import('@/app/api/v1/creative-canvas/[id]/nodes/[nodeId]/review/route')
    mockGetCreativeCanvas.mockResolvedValue(buildCanvas())

    const res = await PUT(reviewRequest({ action: 'approve' }, 'missing-node'), routeContext('missing-node'))

    expect(res.status).toBe(404)
    expect(mockUpdateCreativeCanvasGraph).not.toHaveBeenCalled()
  })

  it('returns 400 for an unsupported action', async () => {
    const { PUT } = await import('@/app/api/v1/creative-canvas/[id]/nodes/[nodeId]/review/route')

    const res = await PUT(reviewRequest({ action: 'reject' }), routeContext())

    expect(res.status).toBe(400)
    expect(mockGetCreativeCanvas).not.toHaveBeenCalled()
    expect(mockUpdateCreativeCanvasGraph).not.toHaveBeenCalled()
  })

  it('keeps the legacy review-gate patch contract when no action is supplied', async () => {
    const { PUT } = await import('@/app/api/v1/creative-canvas/[id]/nodes/[nodeId]/review/route')
    mockUpdateCreativeCanvasNodeReview.mockResolvedValue({ id: 'canvas-1', nodes: [] })

    const res = await PUT(
      reviewRequest({ status: 'passed', rightsStatus: 'cleared', brandStatus: 'passed' }),
      routeContext(),
    )

    expect(res.status).toBe(200)
    expect(mockUpdateCreativeCanvasNodeReview).toHaveBeenCalledWith(
      'canvas-1',
      'org-1',
      'node-1',
      { status: 'passed', rightsStatus: 'cleared', brandStatus: 'passed' },
      { uid: 'client-1', type: 'user' },
    )
    expect(mockUpdateCreativeCanvasGraph).not.toHaveBeenCalled()
  })
})
