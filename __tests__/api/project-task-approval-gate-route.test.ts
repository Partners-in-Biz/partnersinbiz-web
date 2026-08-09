import { NextRequest } from 'next/server'

const mockGetProjectForUser = jest.fn()
const mockTaskGet = jest.fn()
const mockTaskUpdate = jest.fn()
const mockTaskDelete = jest.fn()
const mockTaskDoc = jest.fn()
const mockTasksCollection = jest.fn()
const mockProjectDoc = jest.fn()
const mockCollection = jest.fn()
const mockPlanningMutationBlocker = jest.fn((_project: Record<string, unknown>): null | { code: 'planning_discovery_required'; message: string; revision: number } => null)
let currentUser: {
  uid: string
  role: 'client' | 'admin' | 'ai'
  authKind: string
  orgId?: string
  agentId?: string
  delegationId?: string
  actingForUserId?: string
} = {
  uid: 'client-1', role: 'client', authKind: 'session',
}

jest.mock('firebase-admin/firestore', () => ({
  FieldValue: {
    serverTimestamp: jest.fn(() => 'SERVER_TIMESTAMP'),
  },
}))

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: {
    collection: mockCollection,
    runTransaction: jest.fn(async (callback: (tx: unknown) => unknown) => callback({
      get: jest.fn(async (ref: { get: () => unknown }) => ref.get()),
      update: jest.fn((ref: { update: (value: unknown) => unknown }, value: unknown) => ref.update(value)),
      delete: jest.fn((ref: { delete: () => unknown }) => ref.delete()),
    })),
  },
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

jest.mock('@/lib/projects/planningDiscovery', () => ({
  ...jest.requireActual('@/lib/projects/planningDiscovery'),
  planningMutationBlocker: (project: Record<string, unknown>) => mockPlanningMutationBlocker(project),
}))

jest.mock('@/lib/projects/planningDiscoveryStore', () => ({
  planningContextMutationTransition: (project: Record<string, unknown>) => {
    const blocker = mockPlanningMutationBlocker(project)
    return blocker
      ? { allowed: false, blocker, state: null, event: null }
      : { allowed: true, state: null, event: null }
  },
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
  mockPlanningMutationBlocker.mockReturnValue(null)
  currentUser = { uid: 'client-1', role: 'client', authKind: 'session' }
  mockGetProjectForUser.mockResolvedValue({
    ok: true,
    doc: { data: () => ({ orgId: 'org-1' }) },
    projectAccess: { role: 'contributor', source: 'project_member', canViewInternal: true },
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
  mockTaskDelete.mockResolvedValue(undefined)
  mockTaskDoc.mockReturnValue({ get: mockTaskGet, update: mockTaskUpdate, delete: mockTaskDelete })
  mockTasksCollection.mockReturnValue({ doc: mockTaskDoc })
  mockProjectDoc.mockReturnValue({
    collection: mockTasksCollection,
    get: jest.fn(async () => ({ exists: true, data: () => ({ orgId: 'org-1' }) })),
  })
  mockCollection.mockImplementation((name: string) => {
    if (name === 'projects') return { doc: mockProjectDoc }
    if (name === 'notifications') return { add: jest.fn() }
    if (name === 'agent_org_nodes') return { where: jest.fn(() => ({ get: jest.fn(async () => ({ docs: [] })) })) }
    throw new Error(`Unexpected collection ${name}`)
  })
})

describe('project task approval gate route guards', () => {
  it('fails closed for material task-intent updates when planning is not ready', async () => {
    mockPlanningMutationBlocker.mockReturnValue({
      code: 'planning_discovery_required', message: 'Planning discovery required', revision: 0,
    })
    const { PATCH } = await import('@/app/api/v1/projects/[projectId]/tasks/[taskId]/route')
    const res = await PATCH(req({ title: 'Changed task intent' }), ctx)

    expect(res.status).toBe(409)
    expect(mockTaskGet).toHaveBeenCalled()
    expect(mockTaskUpdate).not.toHaveBeenCalled()
  })

  it('forces narrative-only operational completion to changes-requested even when planning has since become stale', async () => {
    mockPlanningMutationBlocker.mockReturnValue({
      code: 'planning_discovery_required', message: 'Planning discovery required', revision: 8,
    })
    mockTaskGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({ title: 'In-flight task', labels: [], assigneeAgentId: 'theo', agentStatus: 'in-progress' }),
    })
    const { PATCH } = await import('@/app/api/v1/projects/[projectId]/tasks/[taskId]/route')
    const res = await PATCH(req({ agentStatus: 'done', agentOutput: { summary: 'Completed safely' } }), ctx)

    expect(res.status).toBe(200)
    expect(mockTaskUpdate).toHaveBeenCalledWith(expect.objectContaining({
      agentStatus: 'blocked',
      columnId: 'blocked',
      reviewStatus: 'changes-requested',
      completionIntegrityFailureReasons: ['completion_integrity_verification_required'],
      agentOutput: expect.objectContaining({ summary: expect.stringContaining('Completion integrity blocked') }),
    }))
  })

  it('accepts a typed no-code exception as staged evidence without allowing direct completion', async () => {
    mockTaskGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({ title: 'Read-only audit', labels: [], assigneeAgentId: 'sage', agentStatus: 'in-progress' }),
    })
    const { PATCH } = await import('@/app/api/v1/projects/[projectId]/tasks/[taskId]/route')
    const res = await PATCH(req({
      completionEvidence: {
        schemaVersion: 1,
        workKind: 'no-code',
        noCodeReason: 'Read-only database audit; no repository files changed.',
        changedFiles: [],
        testCommand: 'node scripts/verify-audit.mjs',
        testResult: 'passed',
        worktreeState: 'not-applicable',
      },
    }), ctx)

    expect(res.status).toBe(200)
    expect(mockTaskUpdate).toHaveBeenCalledWith(expect.objectContaining({
      completionEvidence: expect.objectContaining({ workKind: 'no-code', changedFiles: [] }),
    }))
    expect(mockTaskUpdate).not.toHaveBeenCalledWith(expect.objectContaining({ agentStatus: 'done' }))
  })

  it('persists typed code evidence so the watcher can verify it after the agent run', async () => {
    mockTaskGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({ title: 'Implementation', labels: [], assigneeAgentId: 'theo', agentStatus: 'in-progress' }),
    })
    const { PATCH } = await import('@/app/api/v1/projects/[projectId]/tasks/[taskId]/route')
    const res = await PATCH(req({
      completionEvidence: {
        schemaVersion: 1,
        workKind: 'code',
        commitSha: 'a'.repeat(40),
        changedFiles: ['app/api/v1/agent/project/[projectId]/route.ts'],
        testCommand: 'npx jest --runInBand __tests__/api/agent-project-context.test.ts',
        testResult: 'passed',
        worktreeState: 'clean',
      },
    }), ctx)

    expect(res.status).toBe(200)
    expect(mockTaskUpdate).toHaveBeenCalledWith(expect.objectContaining({
      completionEvidence: {
        schemaVersion: 1,
        workKind: 'code',
        commitSha: 'a'.repeat(40),
        changedFiles: ['app/api/v1/agent/project/[projectId]/route.ts'],
        testCommand: 'npx jest --runInBand __tests__/api/agent-project-context.test.ts',
        testResult: 'passed',
        worktreeState: 'clean',
      },
    }))
  })

  it('does not allow a reviewer assignment to make narrative-only completion reviewable', async () => {
    mockTaskGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({
        title: 'Reviewed task',
        labels: [],
        assigneeAgentId: 'theo',
        reviewerAgentId: 'qa-release',
        agentStatus: 'in-progress',
        reviewStatus: 'pending',
      }),
    })
    const { PATCH } = await import('@/app/api/v1/projects/[projectId]/tasks/[taskId]/route')
    const res = await PATCH(req({ agentStatus: 'done', agentOutput: { summary: 'Done, awaiting review' } }), ctx)

    expect(res.status).toBe(200)
    expect(mockTaskUpdate).toHaveBeenCalledWith(expect.objectContaining({
      agentStatus: 'blocked',
      columnId: 'blocked',
      reviewStatus: 'changes-requested',
      completionIntegrityFailureReasons: ['completion_integrity_verification_required'],
    }))
  })

  it('blocks dragging an unverified agent card into Done', async () => {
    mockTaskGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({
        title: 'Reviewed task',
        labels: [],
        assigneeAgentId: 'theo',
        reviewerAgentId: 'qa-release',
        agentStatus: 'done',
        reviewStatus: 'pending',
      }),
    })
    const { PATCH } = await import('@/app/api/v1/projects/[projectId]/tasks/[taskId]/route')
    const res = await PATCH(req({ columnId: 'done' }), ctx)

    expect(res.status).toBe(200)
    expect(mockTaskUpdate).toHaveBeenCalledWith(expect.objectContaining({
      agentStatus: 'blocked',
      columnId: 'blocked',
      reviewStatus: 'changes-requested',
      completionIntegrityFailureReasons: ['completion_integrity_verification_required'],
    }))
  })

  it('fails closed before deleting a task when planning is not ready', async () => {
    mockPlanningMutationBlocker.mockReturnValue({
      code: 'planning_discovery_required', message: 'Planning discovery required', revision: 2,
    })
    mockTaskGet.mockResolvedValue({
      exists: true,
      data: () => ({ title: 'Ordinary task', labels: [] }),
    })
    const { DELETE } = await import('@/app/api/v1/projects/[projectId]/tasks/[taskId]/route')
    const res = await DELETE(new NextRequest('http://localhost/api/v1/projects/project-1/tasks/task-1', { method: 'DELETE' }), ctx)

    expect(res.status).toBe(409)
    expect(mockTaskGet).toHaveBeenCalled()
    expect(mockTaskDelete).not.toHaveBeenCalled()
  })

  it('requires contributor write permission before updating a task', async () => {
    mockGetProjectForUser.mockResolvedValueOnce({
      ok: true,
      doc: { data: () => ({ orgId: 'org-1' }) },
      projectAccess: { role: 'viewer', source: 'project_member', canViewInternal: true },
    })
    const { PATCH } = await import('@/app/api/v1/projects/[projectId]/tasks/[taskId]/route')
    const res = await PATCH(req({ title: 'No write access' }), ctx)

    expect(res.status).toBe(403)
    expect(mockTaskGet).not.toHaveBeenCalled()
    expect(mockTaskUpdate).not.toHaveBeenCalled()
  })

  it('requires explicit matching organisation scope for agent task updates', async () => {
    currentUser = { uid: 'agent:theo', role: 'ai', authKind: 'agent_api_key', orgId: 'org-1' }
    const { PATCH } = await import('@/app/api/v1/projects/[projectId]/tasks/[taskId]/route')
    const missing = await PATCH(req({ title: 'Unsafe' }), ctx)
    const mismatch = await PATCH(new NextRequest('http://localhost/api/v1/projects/project-1/tasks/task-1', {
      method: 'PATCH', headers: { 'x-org-id': 'other-org' }, body: JSON.stringify({ title: 'Unsafe' }),
    }), ctx)

    expect(missing.status).toBe(400)
    expect(mismatch.status).toBe(403)
    expect(mockTaskUpdate).not.toHaveBeenCalled()
  })

  it('blocks non-admin users from changing approval-gate metadata on gated tasks', async () => {
    const { PATCH } = await import('@/app/api/v1/projects/[projectId]/tasks/[taskId]/route')
    const res = await PATCH(req({ approvalGate: 'none' }), ctx)
    const body = await res.json()

    expect(res.status).toBe(403)
    expect(body.error).toMatch(/Only an admin approver/)
    expect(mockTaskUpdate).not.toHaveBeenCalled()
  })

  it('allows a valid delegated admin session to approve an approval-gate task', async () => {
    currentUser = {
      uid: 'admin-1',
      role: 'admin',
      authKind: 'user_delegation',
      orgId: 'org-1',
      agentId: 'pip',
      delegationId: 'dlg-1',
      actingForUserId: 'admin-1',
    }
    const { PATCH } = await import('@/app/api/v1/projects/[projectId]/tasks/[taskId]/route')
    const res = await PATCH(new NextRequest('http://localhost/api/v1/projects/project-1/tasks/task-1', {
      method: 'PATCH',
      headers: { 'x-org-id': 'org-1' },
      body: JSON.stringify({ approvalStatus: 'approved' }),
    }), ctx)
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.success).toBe(true)
    expect(mockTaskUpdate).toHaveBeenCalledWith(expect.objectContaining({
      approvalStatus: 'approved',
      columnId: 'done',
      reviewStatus: 'approved',
      agentStatus: 'done',
      approvedBy: 'admin-1',
      approvedByType: 'delegated_user',
      approvedByAgentId: 'pip',
      approvalDelegationId: 'dlg-1',
    }))
  })

  it('is idempotent when a delegated admin re-approves an already approved gate', async () => {
    currentUser = {
      uid: 'admin-1',
      role: 'admin',
      authKind: 'user_delegation',
      orgId: 'org-1',
      agentId: 'pip',
      delegationId: 'dlg-1',
      actingForUserId: 'admin-1',
    }
    mockTaskGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({
        title: 'Approval task',
        labels: ['approval-gate'],
        approvalGate: 'production-deploy',
        approvalStatus: 'approved',
        columnId: 'done',
        reviewStatus: 'approved',
        agentStatus: 'done',
      }),
    })
    const { PATCH } = await import('@/app/api/v1/projects/[projectId]/tasks/[taskId]/route')
    const res = await PATCH(new NextRequest('http://localhost/api/v1/projects/project-1/tasks/task-1', {
      method: 'PATCH',
      headers: { 'x-org-id': 'org-1' },
      body: JSON.stringify({ approvalStatus: 'approved', columnId: 'done', reviewStatus: 'approved' }),
    }), ctx)

    expect(res.status).toBe(200)
    expect(mockTaskUpdate).toHaveBeenCalled()
  })

  it('blocks agent API keys from setting approvalStatus even when role projects as admin', async () => {
    currentUser = { uid: 'admin-1', role: 'admin', authKind: 'agent_api_key', orgId: 'org-1', agentId: 'pip' }
    const { PATCH } = await import('@/app/api/v1/projects/[projectId]/tasks/[taskId]/route')
    const res = await PATCH(new NextRequest('http://localhost/api/v1/projects/project-1/tasks/task-1', {
      method: 'PATCH',
      headers: { 'x-org-id': 'org-1' },
      body: JSON.stringify({ approvalStatus: 'approved' }),
    }), ctx)

    expect(res.status).toBe(403)
    expect(mockTaskUpdate).not.toHaveBeenCalled()
  })

  it('blocks incomplete delegated sessions from approving', async () => {
    currentUser = { uid: 'admin-1', role: 'admin', authKind: 'user_delegation', orgId: 'org-1' }
    const { PATCH } = await import('@/app/api/v1/projects/[projectId]/tasks/[taskId]/route')
    const res = await PATCH(new NextRequest('http://localhost/api/v1/projects/project-1/tasks/task-1', {
      method: 'PATCH',
      headers: { 'x-org-id': 'org-1' },
      body: JSON.stringify({ approvalStatus: 'approved' }),
    }), ctx)

    expect(res.status).toBe(403)
    expect(mockTaskUpdate).not.toHaveBeenCalled()
  })

  it('blocks delegated non-admin users from approving', async () => {
    currentUser = {
      uid: 'client-1',
      role: 'client',
      authKind: 'user_delegation',
      orgId: 'org-1',
      agentId: 'pip',
      delegationId: 'dlg-2',
      actingForUserId: 'client-1',
    }
    const { PATCH } = await import('@/app/api/v1/projects/[projectId]/tasks/[taskId]/route')
    const res = await PATCH(new NextRequest('http://localhost/api/v1/projects/project-1/tasks/task-1', {
      method: 'PATCH',
      headers: { 'x-org-id': 'org-1' },
      body: JSON.stringify({ approvalStatus: 'approved' }),
    }), ctx)

    expect(res.status).toBe(403)
    expect(mockTaskUpdate).not.toHaveBeenCalled()
  })

  it('rejects moving an approval gate to Done without approvalStatus=approved', async () => {
    currentUser = { uid: 'admin-1', role: 'admin', authKind: 'session' }
    const { PATCH } = await import('@/app/api/v1/projects/[projectId]/tasks/[taskId]/route')
    const res = await PATCH(req({ columnId: 'done' }), ctx)
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.error).toMatch(/approvalStatus=approved/)
    expect(mockTaskUpdate).not.toHaveBeenCalled()
  })

  it('allows a direct human admin to approve and persists canonical approval state', async () => {
    currentUser = { uid: 'admin-1', role: 'admin', authKind: 'session' }
    const { PATCH } = await import('@/app/api/v1/projects/[projectId]/tasks/[taskId]/route')
    const res = await PATCH(req({
      approvalStatus: 'approved',
      reviewStatus: 'approved',
      columnId: 'done',
      agentStatus: 'done',
    }), ctx)

    expect(res.status).toBe(200)
    expect(mockTaskUpdate).toHaveBeenCalledWith(expect.objectContaining({
      approvalStatus: 'approved',
      reviewStatus: 'approved',
      columnId: 'done',
      agentStatus: 'done',
      approvedBy: 'admin-1',
      approvedByType: 'user',
    }))
  })

  it('allows delegated admin handoff metadata updates when planning is ready without reopening discovery', async () => {
    currentUser = {
      uid: 'admin-1',
      role: 'admin',
      authKind: 'user_delegation',
      orgId: 'org-1',
      agentId: 'pip',
      delegationId: 'dlg-1',
      actingForUserId: 'admin-1',
    }
    const { PATCH } = await import('@/app/api/v1/projects/[projectId]/tasks/[taskId]/route')
    const res = await PATCH(new NextRequest('http://localhost/api/v1/projects/project-1/tasks/task-1', {
      method: 'PATCH',
      headers: { 'x-org-id': 'org-1' },
      body: JSON.stringify({
        expectedArtifacts: ['ledger module'],
        verifierChecklist: ['double-entry balances'],
        sourceDocumentId: 'doc-1',
        sourceSpecVersion: 'v1',
      }),
    }), ctx)

    expect(res.status).toBe(200)
    expect(mockTaskUpdate).toHaveBeenCalledWith(expect.objectContaining({
      expectedArtifacts: ['ledger module'],
      verifierChecklist: ['double-entry balances'],
      sourceDocumentId: 'doc-1',
      sourceSpecVersion: 'v1',
    }))
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

  it('blocks non-admin users from deleting approval-gate tasks', async () => {
    const { DELETE } = await import('@/app/api/v1/projects/[projectId]/tasks/[taskId]/route')
    const res = await DELETE(new NextRequest('http://localhost/api/v1/projects/project-1/tasks/task-1', { method: 'DELETE' }), ctx)
    const body = await res.json()

    expect(res.status).toBe(403)
    expect(body.error).toMatch(/Only an admin approver/)
    expect(mockTaskDelete).not.toHaveBeenCalled()
  })

  it('allows admin users to delete approval-gate tasks', async () => {
    currentUser = { uid: 'admin-1', role: 'admin', authKind: 'session' }

    const { DELETE } = await import('@/app/api/v1/projects/[projectId]/tasks/[taskId]/route')
    const res = await DELETE(new NextRequest('http://localhost/api/v1/projects/project-1/tasks/task-1', { method: 'DELETE' }), ctx)
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.success).toBe(true)
    expect(mockTaskDelete).toHaveBeenCalledTimes(1)
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
