import { NextRequest } from 'next/server'

const mockListCreativeCanvasVersions = jest.fn()
const mockCreateCreativeCanvasComment = jest.fn()
const mockAttachCreativeCanvasNodeOutput = jest.fn()
const mockUpdateCreativeCanvasNodeReview = jest.fn()

jest.mock('@/lib/api/auth', () => ({
  withAuth: (_role: string, handler: any) => async (req: NextRequest, context?: unknown) =>
    handler(req, { uid: 'user-1', role: 'admin', authKind: 'test', orgId: 'org-1', orgIds: ['org-1'] }, context),
}))

jest.mock('@/lib/creative-canvas/collaboration', () => ({
  listCreativeCanvasVersions: mockListCreativeCanvasVersions,
  createCreativeCanvasComment: mockCreateCreativeCanvasComment,
  attachCreativeCanvasNodeOutput: mockAttachCreativeCanvasNodeOutput,
  updateCreativeCanvasNodeReview: mockUpdateCreativeCanvasNodeReview,
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
