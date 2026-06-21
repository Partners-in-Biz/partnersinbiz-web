import { NextRequest } from 'next/server'

const mockListCreativeCanvasVersions = jest.fn()
const mockCreateCreativeCanvasComment = jest.fn()
const mockListCreativeCanvasComments = jest.fn()
const mockListCreativeCanvasPresence = jest.fn()
const mockHeartbeatCreativeCanvasPresence = jest.fn()
const mockAttachCreativeCanvasNodeOutput = jest.fn()
const mockUpdateCreativeCanvasNodeReview = jest.fn()
const mockGetCreativeCanvas = jest.fn()

jest.mock('@/lib/api/auth', () => ({
  withAuth: (_role: string, handler: any) => async (req: NextRequest, context?: unknown) =>
    handler(req, { uid: 'user-1', role: 'admin', authKind: 'test', orgId: 'org-1', orgIds: ['org-1'] }, context),
}))

jest.mock('@/lib/creative-canvas/collaboration', () => ({
  listCreativeCanvasVersions: mockListCreativeCanvasVersions,
  createCreativeCanvasComment: mockCreateCreativeCanvasComment,
  listCreativeCanvasComments: mockListCreativeCanvasComments,
  listCreativeCanvasPresence: mockListCreativeCanvasPresence,
  heartbeatCreativeCanvasPresence: mockHeartbeatCreativeCanvasPresence,
  attachCreativeCanvasNodeOutput: mockAttachCreativeCanvasNodeOutput,
  updateCreativeCanvasNodeReview: mockUpdateCreativeCanvasNodeReview,
}))

jest.mock('@/lib/creative-canvas/store', () => ({
  getCreativeCanvas: mockGetCreativeCanvas,
}))

describe('creative canvas collaboration API routes', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('lists version history for a selected canvas', async () => {
    const { GET } = await import('@/app/api/v1/creative-canvas/[id]/versions/route')
    mockListCreativeCanvasVersions.mockResolvedValue([{ id: 'v2', version: 2 }])

    const res = await GET(new NextRequest('http://test.local/api/v1/creative-canvas/canvas-1/versions?orgId=org-1'), {
      params: Promise.resolve({ id: 'canvas-1' }),
    })
    const body = await res.json()

    expect(mockListCreativeCanvasVersions).toHaveBeenCalledWith('canvas-1', 'org-1')
    expect(body).toMatchObject({ success: true, data: { versions: [{ id: 'v2', version: 2 }] } })
  })

  it('creates a node comment', async () => {
    const { POST } = await import('@/app/api/v1/creative-canvas/[id]/comments/route')
    mockCreateCreativeCanvasComment.mockResolvedValue({ id: 'comment-1', body: 'Needs review' })

    const res = await POST(new NextRequest('http://test.local/api/v1/creative-canvas/canvas-1/comments?orgId=org-1', {
      method: 'POST',
      body: JSON.stringify({ nodeId: 'node-1', body: 'Needs review' }),
    }), { params: Promise.resolve({ id: 'canvas-1' }) })
    const body = await res.json()

    expect(mockCreateCreativeCanvasComment).toHaveBeenCalledWith(
      'canvas-1',
      'org-1',
      { nodeId: 'node-1', body: 'Needs review' },
      { uid: 'user-1', type: 'user' },
    )
    expect(body.data.comment.id).toBe('comment-1')
  })

  it('lists canvas comments for the selected canvas', async () => {
    const { GET } = await import('@/app/api/v1/creative-canvas/[id]/comments/route')
    mockListCreativeCanvasComments.mockResolvedValue([{ id: 'comment-1', nodeId: 'node-1', body: 'Needs review' }])

    const res = await GET(new NextRequest('http://test.local/api/v1/creative-canvas/canvas-1/comments?orgId=org-1'), {
      params: Promise.resolve({ id: 'canvas-1' }),
    })
    const body = await res.json()

    expect(mockListCreativeCanvasComments).toHaveBeenCalledWith('canvas-1', 'org-1')
    expect(body).toMatchObject({ success: true, data: { comments: [{ id: 'comment-1', nodeId: 'node-1' }] } })
  })

  it('lists active collaborators for a canvas', async () => {
    const { GET } = await import('@/app/api/v1/creative-canvas/[id]/presence/route')
    mockListCreativeCanvasPresence.mockResolvedValue([{ id: 'presence-1', actorUid: 'maya' }])

    const res = await GET(new NextRequest('http://test.local/api/v1/creative-canvas/canvas-1/presence?orgId=org-1'), {
      params: Promise.resolve({ id: 'canvas-1' }),
    })
    const body = await res.json()

    expect(mockListCreativeCanvasPresence).toHaveBeenCalledWith('canvas-1', 'org-1')
    expect(body.data.presence).toEqual([{ id: 'presence-1', actorUid: 'maya' }])
  })

  it('heartbeats active collaborator focus', async () => {
    const { POST } = await import('@/app/api/v1/creative-canvas/[id]/presence/route')
    mockHeartbeatCreativeCanvasPresence.mockResolvedValue({ id: 'canvas-1_user-1', actorUid: 'user-1' })

    const res = await POST(new NextRequest('http://test.local/api/v1/creative-canvas/canvas-1/presence?orgId=org-1', {
      method: 'POST',
      body: JSON.stringify({ selectedNodeId: 'edit-1', focus: 'canvas' }),
    }), { params: Promise.resolve({ id: 'canvas-1' }) })
    const body = await res.json()

    expect(mockHeartbeatCreativeCanvasPresence).toHaveBeenCalledWith(
      'canvas-1',
      'org-1',
      { selectedNodeId: 'edit-1', focus: 'canvas' },
      { uid: 'user-1', type: 'user' },
    )
    expect(body.data.presence).toEqual([{ id: 'canvas-1_user-1', actorUid: 'user-1' }])
  })

  it('streams live collaboration snapshots for a canvas', async () => {
    const { GET } = await import('@/app/api/v1/creative-canvas/[id]/presence/events/route')
    mockGetCreativeCanvas.mockResolvedValue({ id: 'canvas-1', activeVersion: 2 })
    mockListCreativeCanvasPresence.mockResolvedValue([{
      id: 'presence-1',
      actorUid: 'maya',
      actorType: 'agent',
      latestMutation: {
        operation: 'node_move',
        touchedNodeIds: ['node-a'],
        touchedEdgeIds: [],
        occurredAt: '2026-06-21T12:00:00.000Z',
      },
    }])

    const res = await GET(new NextRequest('http://test.local/api/v1/creative-canvas/canvas-1/presence/events?orgId=org-1'), {
      params: Promise.resolve({ id: 'canvas-1' }),
    })

    expect(res.headers.get('content-type')).toContain('text/event-stream')
    const reader = res.body?.getReader()
    expect(reader).toBeTruthy()
    const first = await reader!.read()
    const second = await reader!.read()
    await reader!.cancel()
    const text = `${new TextDecoder().decode(first.value)}${new TextDecoder().decode(second.value)}`

    expect(mockGetCreativeCanvas).toHaveBeenCalledWith('canvas-1', 'org-1')
    expect(mockListCreativeCanvasPresence).toHaveBeenCalledWith('canvas-1', 'org-1')
    expect(text).toContain('event: collaboration')
    expect(text).toContain('"activeVersion":2')
    expect(text).toContain('"actorUid":"maya"')
    expect(text).toContain('"mutations":[{"actorUid":"maya","actorType":"agent","operation":"node_move","touchedNodeIds":["node-a"],"touchedEdgeIds":[],"source":"stream","occurredAt":"2026-06-21T12:00:00.000Z"}]')
  })

  it('attaches output to a node', async () => {
    const { PUT } = await import('@/app/api/v1/creative-canvas/[id]/nodes/[nodeId]/output/route')
    mockAttachCreativeCanvasNodeOutput.mockResolvedValue({ id: 'canvas-1', nodes: [] })

    const res = await PUT(new NextRequest('http://test.local/api/v1/creative-canvas/canvas-1/nodes/output-1/output?orgId=org-1', {
      method: 'PUT',
      body: JSON.stringify({ kind: 'image', url: 'https://cdn.example.com/output.png' }),
    }), { params: Promise.resolve({ id: 'canvas-1', nodeId: 'output-1' }) })

    expect(mockAttachCreativeCanvasNodeOutput).toHaveBeenCalledWith(
      'canvas-1',
      'org-1',
      'output-1',
      { kind: 'image', url: 'https://cdn.example.com/output.png' },
      { uid: 'user-1', type: 'user' },
    )
    expect(res.status).toBe(200)
  })

  it('updates review metadata on a node', async () => {
    const { PUT } = await import('@/app/api/v1/creative-canvas/[id]/nodes/[nodeId]/review/route')
    mockUpdateCreativeCanvasNodeReview.mockResolvedValue({ id: 'canvas-1', nodes: [] })

    const res = await PUT(new NextRequest('http://test.local/api/v1/creative-canvas/canvas-1/nodes/review-1/review?orgId=org-1', {
      method: 'PUT',
      body: JSON.stringify({ status: 'passed', rightsStatus: 'cleared', brandStatus: 'passed' }),
    }), { params: Promise.resolve({ id: 'canvas-1', nodeId: 'review-1' }) })

    expect(mockUpdateCreativeCanvasNodeReview).toHaveBeenCalledWith(
      'canvas-1',
      'org-1',
      'review-1',
      { status: 'passed', rightsStatus: 'cleared', brandStatus: 'passed' },
      { uid: 'user-1', type: 'user' },
    )
    expect(res.status).toBe(200)
  })
})
