import { NextRequest } from 'next/server'

type MockUser = { uid: string; role: string }

type Handler = (req: NextRequest, user: MockUser, ctx?: unknown) => Promise<Response>

const mockGetAll = jest.fn()
const mockCollection = jest.fn()
const mockGetProjectForUser = jest.fn()
const mockLogActivity = jest.fn()
let mockUser: MockUser = { uid: 'user-1', role: 'admin' }

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: {
    collection: mockCollection,
    getAll: mockGetAll,
  },
}))

jest.mock('firebase-admin/firestore', () => ({
  FieldValue: {
    serverTimestamp: jest.fn(() => '__server_timestamp__'),
  },
}))

jest.mock('@/lib/api/auth', () => ({
  withAuth: (_role: string, handler: Handler) => (req: NextRequest, ctx?: unknown) => handler(req, mockUser, ctx),
}))

jest.mock('@/lib/projects/access', () => ({
  getProjectForUser: (...args: unknown[]) => mockGetProjectForUser(...args),
}))

jest.mock('@/lib/activity/log', () => ({
  logActivity: (...args: unknown[]) => mockLogActivity(...args),
}))

function docSnapshot(id: string, data: Record<string, unknown>, exists = true) {
  return {
    id,
    exists,
    data: () => data,
  }
}

function makeTaskRefs(taskData: Record<string, unknown>) {
  const taskUpdate = jest.fn().mockResolvedValue(undefined)
  const commentSet = jest.fn().mockResolvedValue(undefined)
  const commentDoc = jest.fn(() => ({ id: 'comment-1', set: commentSet }))
  const commentsCollection = jest.fn(() => ({ doc: commentDoc }))
  const taskRef = {
    get: jest.fn().mockResolvedValue(docSnapshot('task-1', taskData)),
    update: taskUpdate,
    collection: commentsCollection,
  }
  const taskDoc = jest.fn((id: string) => {
    if (id === 'task-1') return taskRef
    return { id }
  })
  const tasksCollection = { doc: taskDoc }
  const projectDoc = {
    collection: jest.fn((name: string) => {
      if (name !== 'tasks') throw new Error(`unexpected collection ${name}`)
      return tasksCollection
    }),
  }
  const projectsCollection = {
    doc: jest.fn((id: string) => {
      if (id !== 'project-1') throw new Error(`unexpected project ${id}`)
      return projectDoc
    }),
  }
  mockCollection.mockImplementation((name: string) => {
    if (name !== 'projects') throw new Error(`unexpected root collection ${name}`)
    return projectsCollection
  })
  return { taskUpdate, commentSet }
}

function req() {
  return new NextRequest('http://localhost/api/v1/projects/project-1/tasks/task-1/unblock', { method: 'POST' })
}

const ctx = { params: Promise.resolve({ projectId: 'project-1', taskId: 'task-1' }) }

describe('POST /api/v1/projects/[projectId]/tasks/[taskId]/unblock', () => {
  beforeEach(() => {
    jest.resetModules()
    jest.clearAllMocks()
    mockUser = { uid: 'user-1', role: 'admin' }
    mockLogActivity.mockResolvedValue(undefined)
    mockGetProjectForUser.mockResolvedValue({
      ok: true,
      doc: { data: () => ({ orgId: 'org-1' }) },
    })
  })

  it('adds an audit comment, clears blocked state, and requeues an agent task when gates are satisfied', async () => {
    const { taskUpdate, commentSet } = makeTaskRefs({
      title: 'Awaiting approval',
      columnId: 'blocked',
      agentStatus: 'awaiting-input',
      assigneeAgentId: 'theo',
      labels: ['blocked', 'client'],
      dependsOn: ['dep-1'],
      approvalGateTaskId: 'gate-1',
    })
    mockGetAll.mockResolvedValue([
      docSnapshot('dep-1', { title: 'Dependency', columnId: 'done', agentStatus: 'done' }),
      docSnapshot('gate-1', { title: 'Approval', columnId: 'done', reviewStatus: 'approved', approvalStatus: 'approved' }),
    ])

    const { POST } = await import('@/app/api/v1/projects/[projectId]/tasks/[taskId]/unblock/route')
    const res = await POST(req(), ctx)
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body).toEqual({ success: true, data: { id: 'task-1', requeued: true, commentId: 'comment-1' } })
    expect(taskUpdate).toHaveBeenCalledWith(expect.objectContaining({
      columnId: 'todo',
      agentStatus: 'pending',
      reviewStatus: 'changes-requested',
      labels: ['client'],
      agentConversationId: null,
      agentHeartbeatAt: null,
      updatedAt: '__server_timestamp__',
    }))
    expect(commentSet).toHaveBeenCalledWith(expect.objectContaining({
      text: expect.stringContaining('✅ Unblocked by authorised user.'),
      userId: 'user-1',
      userRole: 'admin',
      agentPickedUp: false,
    }))
  })

  it('returns dependency and approval reasons without clearing blocked state when gates are not satisfied', async () => {
    const { taskUpdate, commentSet } = makeTaskRefs({
      title: 'Blocked implementation',
      columnId: 'blocked',
      agentStatus: 'blocked',
      assigneeAgentId: 'theo',
      dependsOn: ['dep-1'],
      approvalGateTaskId: 'gate-1',
    })
    mockGetAll.mockResolvedValue([
      docSnapshot('dep-1', { title: 'Dependency', columnId: 'blocked', agentStatus: 'blocked' }),
      docSnapshot('gate-1', { title: 'Approval', columnId: 'review', reviewStatus: 'pending' }),
    ])

    const { POST } = await import('@/app/api/v1/projects/[projectId]/tasks/[taskId]/unblock/route')
    const res = await POST(req(), ctx)
    const body = await res.json()

    expect(res.status).toBe(409)
    expect(body).toEqual({
      success: false,
      error: 'Cannot unblock yet',
      reasons: [
        'Dependency “Dependency” is still blocked.',
        'Approval gate “Approval” is not approved yet.',
      ],
    })
    expect(taskUpdate).not.toHaveBeenCalled()
    expect(commentSet).not.toHaveBeenCalled()
  })

  it('does not treat quality review or done column as business approval for approval gates', async () => {
    const { taskUpdate, commentSet } = makeTaskRefs({
      title: 'Blocked implementation',
      columnId: 'blocked',
      agentStatus: 'blocked',
      assigneeAgentId: 'theo',
      dependsOn: [],
      approvalGateTaskId: 'gate-1',
    })
    mockGetAll.mockResolvedValue([
      docSnapshot('gate-1', { title: 'Approval', columnId: 'done', reviewStatus: 'approved', approvalStatus: 'pending' }),
    ])

    const { POST } = await import('@/app/api/v1/projects/[projectId]/tasks/[taskId]/unblock/route')
    const res = await POST(req(), ctx)
    const body = await res.json()

    expect(res.status).toBe(409)
    expect(body.reasons).toEqual(['Approval gate “Approval” is not approved yet.'])
    expect(taskUpdate).not.toHaveBeenCalled()
    expect(commentSet).not.toHaveBeenCalled()
  })

  it('requires business approval when an approval-gate task is listed as an ordinary dependency', async () => {
    const { taskUpdate, commentSet } = makeTaskRefs({
      title: 'Blocked implementation',
      columnId: 'blocked',
      agentStatus: 'blocked',
      assigneeAgentId: 'theo',
      dependsOn: ['gate-1'],
    })
    mockGetAll.mockResolvedValue([
      docSnapshot('gate-1', { title: 'Approval', columnId: 'done', reviewStatus: 'approved', approvalStatus: 'pending', labels: ['approval-gate'] }),
    ])

    const { POST } = await import('@/app/api/v1/projects/[projectId]/tasks/[taskId]/unblock/route')
    const res = await POST(req(), ctx)
    const body = await res.json()

    expect(res.status).toBe(409)
    expect(body.reasons).toEqual(['Approval gate “Approval” is not approved yet.'])
    expect(taskUpdate).not.toHaveBeenCalled()
    expect(commentSet).not.toHaveBeenCalled()
  })

  it('does not unblock an unresolved approval-gate card even when it has no dependencies', async () => {
    const { taskUpdate, commentSet } = makeTaskRefs({
      title: 'Approval gate',
      columnId: 'blocked',
      agentStatus: 'awaiting-input',
      labels: ['approval-gate'],
      approvalGate: 'production-deploy',
      approvalStatus: 'pending',
      dependsOn: [],
    })
    mockGetAll.mockResolvedValue([])

    const { POST } = await import('@/app/api/v1/projects/[projectId]/tasks/[taskId]/unblock/route')
    const res = await POST(req(), ctx)
    const body = await res.json()

    expect(res.status).toBe(409)
    expect(body.reasons).toEqual(['Approval gate “Approval gate” is not approved yet.'])
    expect(taskUpdate).not.toHaveBeenCalled()
    expect(commentSet).not.toHaveBeenCalled()
  })
})
