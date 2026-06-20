import { NextRequest } from 'next/server'

const mockGetCreativeCanvas = jest.fn()
const mockCreateCreativeCanvasOrchestrationTasks = jest.fn()

jest.mock('@/lib/api/auth', () => ({
  withAuth: (_role: string, handler: any) => async (req: NextRequest, context?: unknown) =>
    handler(req, { uid: 'user-1', role: 'admin', authKind: 'test', orgId: 'org-1', orgIds: ['org-1'] }, context),
}))

jest.mock('@/lib/creative-canvas/store', () => ({
  getCreativeCanvas: mockGetCreativeCanvas,
}))

jest.mock('@/lib/creative-canvas/orchestration-tasks', () => ({
  createCreativeCanvasOrchestrationTasks: mockCreateCreativeCanvasOrchestrationTasks,
}))

describe('creative canvas orchestration tasks API', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('creates project tasks for a selected canvas orchestration plan', async () => {
    const { POST } = await import('@/app/api/v1/creative-canvas/[id]/orchestration-tasks/route')
    const canvas = { id: 'canvas-1', orgId: 'org-1', title: 'Launch Canvas', linked: { projectId: 'project-1' }, nodes: [], edges: [] }
    mockGetCreativeCanvas.mockResolvedValue(canvas)
    mockCreateCreativeCanvasOrchestrationTasks.mockResolvedValue({
      projectId: 'project-1',
      createdTasks: [{ id: 'task-1', nodeId: 'source-1', agentId: 'pip', title: 'Creative Canvas: Source' }],
      skippedSteps: [],
    })

    const res = await POST(new NextRequest('http://test.local/api/v1/creative-canvas/canvas-1/orchestration-tasks?orgId=org-1', {
      method: 'POST',
      body: JSON.stringify({ projectId: 'project-1' }),
    }), { params: Promise.resolve({ id: 'canvas-1' }) })
    const body = await res.json()

    expect(mockGetCreativeCanvas).toHaveBeenCalledWith('canvas-1', 'org-1')
    expect(mockCreateCreativeCanvasOrchestrationTasks).toHaveBeenCalledWith(
      canvas,
      { projectId: 'project-1' },
      { uid: 'user-1', type: 'user' },
    )
    expect(res.status).toBe(201)
    expect(body).toMatchObject({
      success: true,
      data: {
        projectId: 'project-1',
        createdTasks: [{ id: 'task-1', nodeId: 'source-1', agentId: 'pip' }],
      },
    })
  })

  it('returns a 404 when the canvas is missing for the selected org', async () => {
    const { POST } = await import('@/app/api/v1/creative-canvas/[id]/orchestration-tasks/route')
    mockGetCreativeCanvas.mockResolvedValue(null)

    const res = await POST(new NextRequest('http://test.local/api/v1/creative-canvas/canvas-1/orchestration-tasks?orgId=org-1', {
      method: 'POST',
      body: JSON.stringify({}),
    }), { params: Promise.resolve({ id: 'canvas-1' }) })

    expect(res.status).toBe(404)
    expect(mockCreateCreativeCanvasOrchestrationTasks).not.toHaveBeenCalled()
  })
})
