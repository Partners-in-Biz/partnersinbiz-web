import { NextRequest } from 'next/server'

const mockGetProjectForUser = jest.fn()
const mockCollection = jest.fn()
const mockRunTransaction = jest.fn()
const mockTransactionGet = jest.fn()
const mockTransactionSet = jest.fn()
const mockTransactionUpdate = jest.fn()
const mockMilestoneAdd = jest.fn()
const mockMilestoneUpdate = jest.fn()
const mockPlaybookUpdate = jest.fn()
const mockAuditAdd = jest.fn()
const mockPlanningMutationBlocker = jest.fn((project: Record<string, unknown>) => project.planningReady === true
  ? null
  : { code: 'planning_discovery_required', message: 'Planning discovery required', revision: 0 })
const mockPlanningContextMutationTransition = jest.fn((project: Record<string, unknown>, input: { reason: string }) => project.planningReady === true
  ? { allowed: true, state: { enforced: true, status: 'interviewing', revision: 8 }, event: { type: 'reopened', reason: input.reason } }
  : { allowed: false, blocker: { code: 'planning_discovery_required', message: 'Planning discovery required', revision: 0 }, state: { enforced: true, status: 'interviewing', revision: 1 }, event: { type: 'started' } })

const user = { uid: 'manager-1', role: 'admin' as const, orgId: 'org-1', authKind: 'session' as const }
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
}))
jest.mock('@/lib/projects/planningDiscoveryStore', () => ({
  planningContextMutationTransition: (project: Record<string, unknown>, input: { reason: string }) => mockPlanningContextMutationTransition(project, input),
}))

jest.mock('@/lib/projects/playbooks', () => ({
  normalizeProjectPlaybookTemplate: jest.fn(),
  validateProjectPlaybookTemplate: jest.fn(),
  runProjectPlaybookTemplate: jest.fn(),
}))

jest.mock('firebase-admin/firestore', () => ({
  FieldValue: { serverTimestamp: jest.fn(() => 'SERVER_TIMESTAMP') },
}))

const projectRef = { path: 'projects/project-1' } as Record<string, unknown>
const milestoneRef = { path: 'projects/project-1/milestones/milestone-1', id: 'milestone-1' } as Record<string, unknown>
const playbookRef = { path: 'projects/project-1/playbooks/playbook-1', id: 'playbook-1' } as Record<string, unknown>
const auditRef = { path: 'projects/project-1/audit/audit-1', id: 'audit-1' }
const planningEventRef = { path: 'projects/project-1/planningDiscoveryEvents/event-1', id: 'event-1' }

beforeEach(() => {
  jest.resetModules()
  jest.clearAllMocks()
  accessProject = { orgId: 'org-1', planningReady: true }
  liveProject = { orgId: 'org-1', planningReady: true }

  mockGetProjectForUser.mockResolvedValue({
    ok: true,
    doc: { id: 'project-1', data: () => accessProject },
    projectAccess: { role: 'manager', canViewInternal: true },
  })
  mockMilestoneAdd.mockResolvedValue({ id: 'milestone-direct' })
  mockMilestoneUpdate.mockResolvedValue(undefined)
  mockPlaybookUpdate.mockResolvedValue(undefined)
  mockAuditAdd.mockResolvedValue({ id: 'audit-direct' })

  Object.assign(milestoneRef, {
    get: jest.fn(async () => ({ exists: true, data: () => ({ title: 'Launch', status: 'active' }) })),
    update: mockMilestoneUpdate,
  })
  Object.assign(playbookRef, {
    get: jest.fn(async () => ({ exists: true, data: () => ({ title: 'Plan', status: 'active' }) })),
    update: mockPlaybookUpdate,
  })
  Object.assign(projectRef, {
    collection: jest.fn((name: string) => {
      if (name === 'milestones') return { add: mockMilestoneAdd, doc: jest.fn(() => milestoneRef) }
      if (name === 'playbooks') return { doc: jest.fn(() => playbookRef) }
      if (name === 'audit') return { add: mockAuditAdd, doc: jest.fn(() => auditRef) }
      if (name === 'planningDiscoveryEvents') return { doc: jest.fn(() => planningEventRef) }
      if (name === 'notificationSettings') return { get: jest.fn(async () => ({ docs: [] })) }
      throw new Error(`Unexpected project subcollection ${name}`)
    }),
  })
  mockCollection.mockImplementation((name: string) => {
    if (name === 'projects') return { doc: jest.fn(() => projectRef) }
    if (name === 'projectMembers') return { where: jest.fn(() => ({ get: jest.fn(async () => ({ docs: [] })) })) }
    if (name === 'notifications') return { add: jest.fn() }
    throw new Error(`Unexpected collection ${name}`)
  })
  mockTransactionGet.mockImplementation(async (ref: unknown) => {
    if (ref === projectRef) return { exists: true, data: () => liveProject }
    if (ref === milestoneRef) return { exists: true, data: () => ({ title: 'Launch', status: 'active' }) }
    if (ref === playbookRef) return { exists: true, data: () => ({ title: 'Plan', status: 'active' }) }
    throw new Error('Unexpected transaction read')
  })
  mockRunTransaction.mockImplementation(async (callback: (tx: unknown) => unknown) => callback({
    get: mockTransactionGet,
    set: mockTransactionSet,
    update: mockTransactionUpdate,
  }))
})

const ctx = { params: Promise.resolve({ projectId: 'project-1' }) }

function request(method: string, body: Record<string, unknown>) {
  return new NextRequest('http://localhost/api/v1/projects/project-1/suite', {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('project suite planning mutation atomicity', () => {
  it('checks live readiness and creates a planned suite record in one transaction', async () => {
    const { POST } = await import('@/app/api/v1/projects/[projectId]/suite/route')
    const res = await POST(request('POST', { type: 'milestone', title: 'Launch' }), ctx)

    expect(res.status).toBe(201)
    expect(mockTransactionGet).toHaveBeenCalledWith(projectRef)
    expect(mockTransactionSet).toHaveBeenCalledWith(milestoneRef, expect.objectContaining({ title: 'Launch' }))
    expect(mockTransactionUpdate).toHaveBeenCalledWith(projectRef, expect.objectContaining({
      planningDiscovery: expect.objectContaining({ status: 'interviewing', revision: 8 }),
    }))
    expect(mockMilestoneAdd).not.toHaveBeenCalled()
  })

  it('does not create when planning becomes stale before commit', async () => {
    liveProject = { orgId: 'org-1' }
    const { POST } = await import('@/app/api/v1/projects/[projectId]/suite/route')
    const res = await POST(request('POST', { type: 'milestone', title: 'Unsafe launch' }), ctx)

    expect(res.status).toBe(409)
    expect(mockTransactionUpdate).toHaveBeenCalledWith(projectRef, expect.objectContaining({
      planningDiscovery: expect.objectContaining({ status: 'interviewing', revision: 1 }),
    }))
    expect(mockTransactionSet).not.toHaveBeenCalledWith(milestoneRef, expect.anything())
    expect(mockMilestoneAdd).not.toHaveBeenCalled()
  })

  it('checks live readiness and updates a planned suite record in one transaction', async () => {
    const { PATCH } = await import('@/app/api/v1/projects/[projectId]/suite/route')
    const res = await PATCH(request('PATCH', { type: 'milestone', id: 'milestone-1', title: 'Launch readiness' }), ctx)

    expect(res.status).toBe(200)
    expect(mockTransactionGet).toHaveBeenCalledWith(projectRef)
    expect(mockTransactionGet).toHaveBeenCalledWith(milestoneRef)
    expect(mockTransactionUpdate).toHaveBeenCalledWith(milestoneRef, expect.objectContaining({ title: 'Launch readiness' }))
    expect(mockTransactionUpdate).toHaveBeenCalledWith(projectRef, expect.objectContaining({
      planningDiscovery: expect.objectContaining({ status: 'interviewing', revision: 8 }),
    }))
    expect(mockMilestoneUpdate).not.toHaveBeenCalled()
  })

  it('blocks planned-suite archival on a legacy project', async () => {
    accessProject = { orgId: 'org-1' }
    liveProject = { orgId: 'org-1' }
    const { DELETE } = await import('@/app/api/v1/projects/[projectId]/suite/route')
    const res = await DELETE(request('DELETE', { type: 'playbook', id: 'playbook-1' }), ctx)

    expect(res.status).toBe(409)
    expect(mockPlaybookUpdate).not.toHaveBeenCalled()
    expect(mockTransactionUpdate).not.toHaveBeenCalledWith(playbookRef, expect.anything())
  })

  it('checks live readiness and archives a planned suite record in one transaction', async () => {
    const { DELETE } = await import('@/app/api/v1/projects/[projectId]/suite/route')
    const res = await DELETE(request('DELETE', { type: 'playbook', id: 'playbook-1' }), ctx)

    expect(res.status).toBe(200)
    expect(mockTransactionGet).toHaveBeenCalledWith(projectRef)
    expect(mockTransactionGet).toHaveBeenCalledWith(playbookRef)
    expect(mockTransactionUpdate).toHaveBeenCalledWith(playbookRef, expect.objectContaining({
      deleted: true,
      status: 'archived',
    }))
    expect(mockTransactionUpdate).toHaveBeenCalledWith(projectRef, expect.objectContaining({
      planningDiscovery: expect.objectContaining({ status: 'interviewing', revision: 8 }),
    }))
    expect(mockPlaybookUpdate).not.toHaveBeenCalled()
  })
})
