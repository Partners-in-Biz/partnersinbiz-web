import { NextRequest } from 'next/server'

const mockGetProjectForUser = jest.fn()
const mockCollection = jest.fn()
const mockRunTransaction = jest.fn()
const mockTaskGet = jest.fn()
const mockTaskAdd = jest.fn()
const mockTaskUpdate = jest.fn()
const mockTaskDelete = jest.fn()
const mockTransactionGet = jest.fn()
const mockTransactionSet = jest.fn()
const mockTransactionUpdate = jest.fn()
const mockTransactionDelete = jest.fn()
const mockPlanningMutationBlocker = jest.fn((project: Record<string, unknown>) => project.planningReady === true
  ? null
  : { code: 'planning_discovery_required', message: 'Planning discovery required', revision: 0 })
const mockPlanningContextMutationTransition = jest.fn((project: Record<string, unknown>, input: { reason: string; reopenWhenReady?: boolean }) => project.planningReady === true
  ? input.reopenWhenReady === false
    ? { allowed: true }
    : { allowed: true, state: { enforced: true, status: 'interviewing', revision: 8 }, event: { type: 'reopened', reason: input.reason } }
  : { allowed: false, blocker: { code: 'planning_discovery_required', message: 'Planning discovery required', revision: 0 }, state: { enforced: true, status: 'interviewing', revision: 1 }, event: { type: 'started' } })

const user = { uid: 'admin-1', role: 'admin' as const, orgId: 'org-1', authKind: 'session' as const }
let accessProject: Record<string, unknown>
let liveProject: Record<string, unknown>

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: { collection: mockCollection, runTransaction: mockRunTransaction },
}))

jest.mock('@/lib/api/auth', () => ({
  withAuth: (_role: string, handler: (req: NextRequest, actor: typeof user, ctx?: unknown) => unknown) =>
    async (req: NextRequest, ctx?: unknown) => handler(req, user, ctx),
}))

jest.mock('@/lib/projects/access', () => ({
  getProjectForUser: (...args: unknown[]) => mockGetProjectForUser(...args),
}))

jest.mock('@/lib/projects/planningDiscovery', () => ({
  planningMutationBlocker: (project: Record<string, unknown>) => mockPlanningMutationBlocker(project),
  isProjectTaskPlanningMutation: jest.requireActual('@/lib/projects/planningDiscovery').isProjectTaskPlanningMutation,
  isProjectTaskContextMutation: jest.requireActual('@/lib/projects/planningDiscovery').isProjectTaskContextMutation,
}))
jest.mock('@/lib/projects/planningDiscoveryStore', () => ({
  planningContextMutationTransition: (project: Record<string, unknown>, input: { reason: string; reopenWhenReady?: boolean }) => mockPlanningContextMutationTransition(project, input),
}))

jest.mock('@/lib/activity/log', () => ({ logActivity: jest.fn(() => Promise.resolve()) }))
jest.mock('@/lib/llm-providers/store', () => ({
  listLlmProviderConnections: jest.fn(async () => []),
}))
jest.mock('@/lib/llm-providers/sync-hermes', () => ({
  syncLlmConnectionToHermes: jest.fn(),
}))
jest.mock('@/lib/projects/links', () => ({ adminProjectTaskLink: jest.fn(async () => '/admin/task-1') }))
jest.mock('@/lib/context-references/registry', () => ({ resolveContextReferences: jest.fn(async () => []) }))
jest.mock('@/lib/conversations/conversations', () => ({ getConversation: jest.fn() }))

jest.mock('firebase-admin/firestore', () => ({
  FieldValue: { serverTimestamp: jest.fn(() => 'SERVER_TIMESTAMP') },
}))

const projectRef = { path: 'projects/project-1' } as Record<string, unknown>
const taskRef = { path: 'projects/project-1/tasks/task-1', id: 'task-1' } as Record<string, unknown>

beforeEach(() => {
  jest.resetModules()
  jest.clearAllMocks()
  accessProject = { orgId: 'org-1', planningReady: true }
  liveProject = { orgId: 'org-1', planningReady: true }

  mockGetProjectForUser.mockImplementation(async () => ({
    ok: true,
    doc: { id: 'project-1', data: () => accessProject },
    projectAccess: { role: 'owner', canViewInternal: true },
  }))
  mockTaskGet.mockResolvedValue({ exists: true, data: () => ({ title: 'Existing task', labels: [] }) })
  mockTaskAdd.mockResolvedValue({ id: 'task-direct' })
  mockTaskUpdate.mockResolvedValue(undefined)
  mockTaskDelete.mockResolvedValue(undefined)

  Object.assign(taskRef, { get: mockTaskGet, update: mockTaskUpdate, delete: mockTaskDelete })
  const taskCollection = {
    doc: jest.fn(() => taskRef),
    add: mockTaskAdd,
    where: jest.fn(() => ({ where: jest.fn(() => ({ limit: jest.fn(() => ({ get: jest.fn(async () => ({ empty: true, docs: [] })) })) })) })),
  }
  Object.assign(projectRef, {
    collection: jest.fn((name: string) => {
      if (name === 'tasks') return taskCollection
      if (name === 'planningDiscoveryEvents') return { doc: jest.fn(() => ({ path: 'projects/project-1/planningDiscoveryEvents/event-1' })) }
      throw new Error(`Unexpected project subcollection ${name}`)
    }),
  })
  mockCollection.mockImplementation((name: string) => {
    if (name === 'projects') return { doc: jest.fn(() => projectRef) }
    if (name === 'users') return { doc: jest.fn(() => ({ get: jest.fn(async () => ({ data: () => ({ displayName: 'Admin' }) })) })) }
    if (name === 'notifications') return { add: jest.fn(async () => ({ id: 'notification-1' })) }
    throw new Error(`Unexpected collection ${name}`)
  })
  mockTransactionGet.mockImplementation(async (ref: unknown) => {
    if (ref === projectRef) return { exists: true, data: () => liveProject }
    if (ref === taskRef) return { exists: true, data: () => ({ title: 'Existing task', labels: [] }) }
    throw new Error('Unexpected transaction read')
  })
  mockRunTransaction.mockImplementation(async (callback: (tx: unknown) => unknown) => callback({
    get: mockTransactionGet,
    set: mockTransactionSet,
    update: mockTransactionUpdate,
    delete: mockTransactionDelete,
  }))
})

const collectionCtx = { params: Promise.resolve({ projectId: 'project-1' }) }
const itemCtx = { params: Promise.resolve({ projectId: 'project-1', taskId: 'task-1' }) }

function request(method: string, body?: Record<string, unknown>) {
  return new NextRequest('http://localhost/api/v1/projects/project-1/tasks/task-1', {
    method,
    headers: { 'content-type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
}

describe('project task planning mutation atomicity', () => {
  it('checks live planning readiness and creates the task without reopening the confirmed brief', async () => {
    const { POST } = await import('@/app/api/v1/projects/[projectId]/tasks/route')
    const res = await POST(request('POST', { title: 'Planned task' }), collectionCtx)

    expect(res.status).toBe(201)
    expect(mockGetProjectForUser).toHaveBeenCalledWith(
      'project-1', user, undefined, { action: 'project.write' },
    )
    expect(mockRunTransaction).toHaveBeenCalledTimes(1)
    expect(mockTransactionGet).toHaveBeenCalledWith(projectRef)
    expect(mockTransactionSet).toHaveBeenCalledWith(taskRef, expect.objectContaining({ title: 'Planned task' }))
    expect(mockTransactionUpdate).not.toHaveBeenCalledWith(projectRef, expect.objectContaining({
      planningDiscovery: expect.anything(),
    }))
    expect(mockTransactionSet).not.toHaveBeenCalledWith(
      expect.objectContaining({ path: expect.stringContaining('/planningDiscoveryEvents/') }),
      expect.anything(),
    )
    expect(mockTaskAdd).not.toHaveBeenCalled()
  })

  it('does not create after planning becomes stale between access lookup and commit', async () => {
    liveProject = { orgId: 'org-1', planningReady: false }
    const { POST } = await import('@/app/api/v1/projects/[projectId]/tasks/route')
    const res = await POST(request('POST', { title: 'Stale planned task' }), collectionCtx)

    expect(res.status).toBe(409)
    expect(mockTransactionUpdate).toHaveBeenCalledWith(projectRef, expect.objectContaining({
      planningDiscovery: expect.objectContaining({ status: 'interviewing', revision: 1 }),
    }))
    expect(mockTransactionSet).not.toHaveBeenCalledWith(taskRef, expect.anything())
    expect(mockTaskAdd).not.toHaveBeenCalled()
  })

  it.each(['title', 'description', 'dueDate', 'priority', 'reviewerAgentId', 'expectedArtifacts'])(
    'blocks legacy task planning updates through %s',
    async (field) => {
      accessProject = { orgId: 'org-1' }
      liveProject = { orgId: 'org-1' }
      const values: Record<string, unknown> = {
        title: 'Retitled task',
        description: 'Changed intent',
        dueDate: '2026-08-01',
        priority: 'high',
        reviewerAgentId: 'qa-release',
        expectedArtifacts: ['test evidence'],
      }
      const { PATCH } = await import('@/app/api/v1/projects/[projectId]/tasks/[taskId]/route')
      const res = await PATCH(request('PATCH', { [field]: values[field] }), itemCtx)

      expect(res.status).toBe(409)
      expect(mockTaskUpdate).not.toHaveBeenCalled()
      expect(mockTransactionUpdate).not.toHaveBeenCalledWith(taskRef, expect.anything())
    },
  )

  it('allows an existing operational execution status update while discovery is incomplete', async () => {
    accessProject = { orgId: 'org-1' }
    liveProject = { orgId: 'org-1' }
    const { PATCH } = await import('@/app/api/v1/projects/[projectId]/tasks/[taskId]/route')
    const res = await PATCH(request('PATCH', { agentStatus: 'done' }), itemCtx)

    expect(res.status).toBe(200)
    expect(mockTransactionUpdate).toHaveBeenCalledWith(taskRef, expect.objectContaining({ agentStatus: 'done' }))
  })

  it('checks live readiness and updates a planning-sensitive task without reopening the Decision Brief', async () => {
    const { PATCH } = await import('@/app/api/v1/projects/[projectId]/tasks/[taskId]/route')
    const res = await PATCH(request('PATCH', { title: 'Updated plan' }), itemCtx)

    expect(res.status).toBe(200)
    expect(mockTransactionGet).toHaveBeenCalledWith(projectRef)
    expect(mockTransactionUpdate).toHaveBeenCalledWith(taskRef, expect.objectContaining({ title: 'Updated plan' }))
    // Ordinary project_task.updated must not stale a confirmed brief.
    expect(mockPlanningContextMutationTransition).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ reason: 'project_task.updated', reopenWhenReady: false }),
    )
    expect(mockTransactionUpdate).not.toHaveBeenCalledWith(projectRef, expect.objectContaining({
      planningDiscovery: expect.anything(),
    }))
    expect(mockTaskUpdate).not.toHaveBeenCalled()
  })

  it('blocks task deletion on a legacy project and never deletes outside a transaction', async () => {
    accessProject = { orgId: 'org-1' }
    liveProject = { orgId: 'org-1' }
    const { DELETE } = await import('@/app/api/v1/projects/[projectId]/tasks/[taskId]/route')
    const res = await DELETE(request('DELETE'), itemCtx)

    expect(res.status).toBe(409)
    expect(mockTaskDelete).not.toHaveBeenCalled()
    expect(mockTransactionDelete).not.toHaveBeenCalled()
  })

  it('checks live readiness and deletes a task in one transaction', async () => {
    const { DELETE } = await import('@/app/api/v1/projects/[projectId]/tasks/[taskId]/route')
    const res = await DELETE(request('DELETE'), itemCtx)

    expect(res.status).toBe(200)
    expect(mockTransactionGet).toHaveBeenCalledWith(projectRef)
    expect(mockTransactionDelete).toHaveBeenCalledWith(taskRef)
    expect(mockTransactionUpdate).toHaveBeenCalledWith(projectRef, expect.objectContaining({
      planningDiscovery: expect.objectContaining({ status: 'interviewing', revision: 8 }),
    }))
    expect(mockTaskDelete).not.toHaveBeenCalled()
  })
})
