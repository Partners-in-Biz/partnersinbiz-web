import { NextRequest } from 'next/server'

const mockGetProjectForUser = jest.fn()
const mockTaskGet = jest.fn()
const mockTaskUpdate = jest.fn()
const mockTaskDoc = jest.fn()
const mockTasksCollection = jest.fn()
const mockProjectDoc = jest.fn()
const mockCollection = jest.fn()
let currentUser = { uid: 'client-1', role: 'client', authKind: 'session' }

jest.mock('firebase-admin/firestore', () => ({
  FieldValue: {
    serverTimestamp: jest.fn(() => 'SERVER_TIMESTAMP'),
  },
}))

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: { collection: mockCollection },
}))

jest.mock('@/lib/api/auth', () => ({
  withAuth: (
    _role: string,
    handler: (
      req: NextRequest,
      user: typeof currentUser,
      ctx?: unknown,
    ) => Promise<Response>,
  ) => async (req: NextRequest, ctx?: unknown) => handler(req, currentUser, ctx),
}))

jest.mock('@/lib/projects/access', () => ({
  getProjectForUser: (...args: unknown[]) => mockGetProjectForUser(...args),
}))

jest.mock('@/lib/activity/log', () => ({
  logActivity: jest.fn(() => Promise.resolve()),
}))

jest.mock('@/lib/projects/links', () => ({
  adminProjectTaskLink: jest.fn(async () => '/admin/org/test/projects/project-1?task=task-1'),
}))

const ctx = { params: Promise.resolve({ projectId: 'project-1', taskId: 'task-1' }) }

function req(body: Record<string, unknown>) {
  return new NextRequest('http://localhost/api/v1/projects/project-1/tasks/task-1', {
    method: 'PATCH',
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  jest.resetModules()
  jest.clearAllMocks()
  currentUser = { uid: 'client-1', role: 'client', authKind: 'session' }
  mockGetProjectForUser.mockResolvedValue({
    ok: true,
    doc: { data: () => ({ orgId: 'org-1' }) },
    projectAccess: { role: 'member' },
  })
  mockTaskGet.mockResolvedValue({
    exists: true,
    data: () => ({
      title: 'Approval task',
      labels: ['approval-gate'],
      approvalGate: 'production-deploy',
      approvalStatus: 'pending',
    }),
  })
  mockTaskUpdate.mockResolvedValue(undefined)
  mockTaskDoc.mockReturnValue({ get: mockTaskGet, update: mockTaskUpdate })
  mockTasksCollection.mockReturnValue({ doc: mockTaskDoc })
  mockProjectDoc.mockReturnValue({ collection: mockTasksCollection, get: jest.fn(async () => ({ data: () => ({ orgId: 'org-1' }) })) })
  mockCollection.mockImplementation((name: string) => {
    if (name === 'projects') return { doc: mockProjectDoc }
    if (name === 'notifications') return { add: jest.fn() }
    throw new Error(`Unexpected collection ${name}`)
  })
})

describe('project task approval gate route guards', () => {
  it('blocks non-admin users from changing approval-gate metadata on gated tasks', async () => {
    const { PATCH } = await import('@/app/api/v1/projects/[projectId]/tasks/[taskId]/route')
    const res = await PATCH(req({ approvalGate: 'none' }), ctx)
    const body = await res.json()

    expect(res.status).toBe(403)
    expect(body.error).toMatch(/Only an admin approver/)
    expect(mockTaskUpdate).not.toHaveBeenCalled()
  })

  it('blocks non-admin users from adding a gate and execution state in the same request', async () => {
    mockTaskGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({ title: 'Ungated task', labels: [] }),
    })

    const { PATCH } = await import('@/app/api/v1/projects/[projectId]/tasks/[taskId]/route')
    const res = await PATCH(req({ approvalGateTaskId: 'gate-1', columnId: 'done' }), ctx)
    const body = await res.json()

    expect(res.status).toBe(403)
    expect(body.error).toMatch(/Only an admin approver/)
    expect(mockTaskUpdate).not.toHaveBeenCalled()
  })

  it('blocks non-admin users from indirectly completing approval-gated tasks', async () => {
    const { PATCH } = await import('@/app/api/v1/projects/[projectId]/tasks/[taskId]/route')
    const res = await PATCH(req({ columnId: 'done', reviewStatus: 'approved' }), ctx)
    const body = await res.json()

    expect(res.status).toBe(403)
    expect(body.error).toMatch(/Only an admin approver/)
    expect(mockTaskUpdate).not.toHaveBeenCalled()
  })

  it('blocks non-admin users from indirectly completing tasks gated by approvalGateTaskId', async () => {
    const mockGateGet = jest.fn().mockResolvedValue({
      exists: true,
      data: () => ({ title: 'Approval gate', approvalStatus: 'pending' }),
    })
    mockTaskDoc.mockImplementation((id: string) => {
      if (id === 'gate-1') return { get: mockGateGet }
      return { get: mockTaskGet, update: mockTaskUpdate }
    })
    mockTaskGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({ title: 'Specialist task', approvalGateTaskId: 'gate-1', labels: [] }),
    })

    const { PATCH } = await import('@/app/api/v1/projects/[projectId]/tasks/[taskId]/route')
    const res = await PATCH(req({ columnId: 'done', reviewStatus: 'approved' }), ctx)
    const body = await res.json()

    expect(res.status).toBe(403)
    expect(body.error).toMatch(/Only an admin approver/)
    expect(mockTaskUpdate).not.toHaveBeenCalled()
  })

  it('blocks non-admin reassignment from deriving pending agent state before an approvalGateTaskId is approved', async () => {
    const mockGateGet = jest.fn().mockResolvedValue({
      exists: true,
      data: () => ({ title: 'Approval gate', approvalStatus: 'pending' }),
    })
    mockTaskDoc.mockImplementation((id: string) => {
      if (id === 'gate-1') return { get: mockGateGet }
      return { get: mockTaskGet, update: mockTaskUpdate }
    })
    mockTaskGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({ title: 'Specialist task', approvalGateTaskId: 'gate-1', labels: [] }),
    })

    const { PATCH } = await import('@/app/api/v1/projects/[projectId]/tasks/[taskId]/route')
    const res = await PATCH(req({ assigneeAgentId: 'theo' }), ctx)
    const body = await res.json()

    expect(res.status).toBe(403)
    expect(body.error).toMatch(/Only an admin approver/)
    expect(mockTaskUpdate).not.toHaveBeenCalled()
  })

  it('blocks non-admin release scheduling from deriving backlog state before an approvalGateTaskId is approved', async () => {
    const mockGateGet = jest.fn().mockResolvedValue({
      exists: true,
      data: () => ({ title: 'Approval gate', approvalStatus: 'pending' }),
    })
    mockTaskDoc.mockImplementation((id: string) => {
      if (id === 'gate-1') return { get: mockGateGet }
      return { get: mockTaskGet, update: mockTaskUpdate }
    })
    mockTaskGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({ title: 'Specialist task', approvalGateTaskId: 'gate-1', labels: [] }),
    })

    const { PATCH } = await import('@/app/api/v1/projects/[projectId]/tasks/[taskId]/route')
    const res = await PATCH(req({ agentReleaseAt: '2026-06-21T10:00:00.000Z' }), ctx)
    const body = await res.json()

    expect(res.status).toBe(403)
    expect(body.error).toMatch(/Only an admin approver/)
    expect(mockTaskUpdate).not.toHaveBeenCalled()
  })

  it('allows non-admin users to update normal execution state after an approvalGateTaskId is approved', async () => {
    const mockGateGet = jest.fn().mockResolvedValue({
      exists: true,
      data: () => ({ title: 'Approval gate', approvalStatus: 'approved' }),
    })
    mockTaskDoc.mockImplementation((id: string) => {
      if (id === 'gate-1') return { get: mockGateGet }
      return { get: mockTaskGet, update: mockTaskUpdate }
    })
    mockTaskGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({ title: 'Specialist task', approvalGateTaskId: 'gate-1', labels: [] }),
    })

    const { PATCH } = await import('@/app/api/v1/projects/[projectId]/tasks/[taskId]/route')
    const res = await PATCH(req({ columnId: 'in_progress', agentStatus: 'in-progress' }), ctx)
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.success).toBe(true)
    expect(mockTaskUpdate).toHaveBeenCalledWith(expect.objectContaining({
      columnId: 'in_progress',
      agentStatus: 'in-progress',
    }))
  })

  it('rejects approvalStatus changes on legacy tasks with null status but no real gate', async () => {
    currentUser = { uid: 'admin-1', role: 'admin', authKind: 'session' }
    mockTaskGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({ title: 'Legacy task', approvalStatus: null, labels: [], approvalGate: null }),
    })

    const { PATCH } = await import('@/app/api/v1/projects/[projectId]/tasks/[taskId]/route')
    const res = await PATCH(req({ approvalStatus: 'approved' }), ctx)
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.error).toMatch(/approvalStatus can only/)
    expect(mockTaskUpdate).not.toHaveBeenCalled()
  })
})
