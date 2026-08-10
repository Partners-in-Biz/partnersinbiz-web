import { NextRequest } from 'next/server'

const mockGetProjectForUser = jest.fn()
const mockCollection = jest.fn()
const mockProjectDoc = jest.fn()
const mockSubCollection = jest.fn()
const mockTasksGet = jest.fn()
const mockTaskAdd = jest.fn()
const mockMilestonesGet = jest.fn()
const mockApprovalsGet = jest.fn()
const mockRisksGet = jest.fn()
const mockDecisionsGet = jest.fn()
const mockBaselinesGet = jest.fn()
const mockPlaybooksGet = jest.fn()
const mockAutomationsGet = jest.fn()
const mockPermissionsGet = jest.fn()
const mockAuditGet = jest.fn()
const mockNotificationSettingsGet = jest.fn()
const mockCapacitiesGet = jest.fn()
const mockRevenueGet = jest.fn()
const mockMilestoneAdd = jest.fn()
const mockPlaybookAdd = jest.fn()
const mockAutomationAdd = jest.fn()
const mockPermissionAdd = jest.fn()
const mockNotificationAdd = jest.fn()
const mockNotificationFeedAdd = jest.fn()
const mockCapacityAdd = jest.fn()
const mockRevenueAdd = jest.fn()
const mockAuditAdd = jest.fn()
const mockProjectMemberWhere = jest.fn()
const mockProjectMemberGet = jest.fn()
const mockMilestoneDoc = jest.fn()
const mockPlaybookDoc = jest.fn()
const mockMilestoneDocGet = jest.fn()
const mockPlaybookDocGet = jest.fn()
const mockMilestoneUpdate = jest.fn()
const mockPlaybookUpdate = jest.fn()
const mockRunProjectPlaybookTemplate = jest.fn()

const mockUser = { uid: 'owner-1', role: 'admin' as const, orgId: 'owner-org' }
type MockAuthHandler = (req: NextRequest, user: typeof mockUser, ctx?: unknown) => unknown

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: {
    collection: mockCollection,
    runTransaction: jest.fn(async (callback: (tx: {
      get: (ref: { get: () => unknown }) => unknown
      set: (ref: { set: (value: unknown) => unknown }, value: unknown) => unknown
      update: (ref: { update: (value: unknown) => unknown }, value: unknown) => unknown
    }) => unknown) => callback({
      get: (ref) => ref.get(),
      set: (ref, value) => ref.set(value),
      update: (ref, value) => ref.update(value),
    })),
  },
}))

jest.mock('@/lib/api/auth', () => ({
  withAuth: (_role: string, handler: MockAuthHandler) => async (req: NextRequest, ctx?: unknown) =>
    handler(req, mockUser, ctx),
}))

jest.mock('@/lib/projects/access', () => ({
  getProjectForUser: (...args: unknown[]) => mockGetProjectForUser(...args),
}))

jest.mock('@/lib/projects/planningDiscovery', () => ({
  planningMutationBlocker: jest.fn(() => null),
  preparePlanningContextMutation: jest.fn(() => ({
    ok: true,
    state: { enforced: true, status: 'interviewing', revision: 2 },
    event: { type: 'reopened', reason: 'suite.mutation' },
  })),
}))

// Suite fixture projects are planning-ready; do not reopen the brief or write
// planningDiscovery fields during suite CRUD assertions.
jest.mock('@/lib/projects/planningDiscoveryStore', () => ({
  planningContextMutationTransition: jest.fn(() => ({ allowed: true })),
}))

jest.mock('@/lib/projects/playbooks', () => ({
  ...jest.requireActual('@/lib/projects/playbooks'),
  runProjectPlaybookTemplate: (...args: unknown[]) => mockRunProjectPlaybookTemplate(...args),
}))

jest.mock('firebase-admin/firestore', () => ({
  FieldValue: {
    serverTimestamp: jest.fn(() => 'SERVER_TIMESTAMP'),
  },
}))

function docs(items: Array<{ id: string; data: Record<string, unknown> }>) {
  return { docs: items.map((item) => ({ id: item.id, data: () => item.data })) }
}

beforeEach(() => {
  jest.clearAllMocks()
  mockGetProjectForUser.mockResolvedValue({
    ok: true,
    doc: {
      id: 'project-1',
      data: () => ({ id: 'project-1', orgId: 'owner-org', ownerOrgId: 'owner-org' }),
    },
    projectAccess: { role: 'manager', source: 'project_member', canViewInternal: false },
  })
  mockTasksGet.mockResolvedValue(docs([
    {
      id: 'task-1',
      data: {
        title: 'Public blocked task',
        columnId: 'blocked',
        startDate: '2026-01-01',
        dueDate: '2026-01-10',
        baselineDueDate: '2026-01-05',
        estimateMinutes: 120,
        assigneeIds: ['owner-1'],
        dependsOn: ['task-0'],
      },
    },
    { id: 'task-internal', data: { title: 'Internal blocked task', columnId: 'blocked', internalOnly: true } },
  ]))
  mockTaskAdd.mockResolvedValueOnce({ id: 'task-from-playbook-1' }).mockResolvedValueOnce({ id: 'task-from-playbook-2' })
  mockMilestonesGet.mockResolvedValue(docs([
    {
      id: 'milestone-1',
      data: {
        title: 'Launch',
        startDate: '2026-01-01',
        dueDate: '2026-01-15',
        baselineDueDate: '2026-01-10',
        status: 'active',
        dependsOn: ['task-1'],
      },
    },
  ]))
  mockApprovalsGet.mockResolvedValue(docs([
    { id: 'approval-1', data: { title: 'Client approval', status: 'pending' } },
  ]))
  mockRisksGet.mockResolvedValue(docs([
    { id: 'risk-1', data: { title: 'Scope drift', severity: 'high' } },
  ]))
  mockDecisionsGet.mockResolvedValue(docs([
    { id: 'decision-1', data: { title: 'Use staged launch', status: 'accepted' } },
  ]))
  mockBaselinesGet.mockResolvedValue(docs([
    { id: 'baseline-1', data: { title: 'Website launch baseline', status: 'active' } },
  ]))
  mockPlaybooksGet.mockResolvedValue(docs([
    { id: 'playbook-1', data: { title: 'Weekly client report', status: 'active' } },
  ]))
  mockAutomationsGet.mockResolvedValue(docs([
    { id: 'automation-1', data: { title: 'Notify when milestone slips', status: 'active' } },
  ]))
  mockPermissionsGet.mockResolvedValue(docs([
    { id: 'permission-1', data: { title: 'Client-visible tasks only', visibility: 'external', allowedRoleIds: ['reviewer'] } },
    { id: 'permission-internal', data: { title: 'Internal controls', visibility: 'internal' } },
  ]))
  mockAuditGet.mockResolvedValue(docs([
    { id: 'audit-1', data: { title: 'Project created', actorName: 'Peet Stander', createdAt: '2026-01-01' } },
  ]))
  mockNotificationSettingsGet.mockResolvedValue(docs([
    { id: 'notification-1', data: { title: 'Approval reminders', channel: 'email', status: 'active' } },
  ]))
  mockCapacitiesGet.mockResolvedValue(docs([
    { id: 'capacity-1', data: { uid: 'owner-1', displayName: 'Peet Stander', capacityMinutes: 480 } },
    { id: 'capacity-2', data: { uid: 'designer-1', displayName: 'Design Lead', capacityMinutes: 600 } },
  ]))
  mockRevenueGet.mockResolvedValue(docs([
    { id: 'revenue-1', data: { amount: 12500, currency: 'ZAR' } },
  ]))
  mockMilestoneAdd.mockResolvedValue({ id: 'milestone-new' })
  mockPlaybookAdd.mockResolvedValue({ id: 'playbook-new' })
  mockAutomationAdd.mockResolvedValue({ id: 'automation-new' })
  mockPermissionAdd.mockResolvedValue({ id: 'permission-new' })
  mockNotificationAdd.mockResolvedValue({ id: 'notification-new' })
  mockNotificationFeedAdd.mockResolvedValue({ id: 'feed-notification-new' })
  mockCapacityAdd.mockResolvedValue({ id: 'capacity-new' })
  mockRevenueAdd.mockResolvedValue({ id: 'revenue-new' })
  mockAuditAdd.mockResolvedValue({ id: 'audit-new' })
  mockProjectMemberWhere.mockReturnValue({ get: mockProjectMemberGet })
  mockProjectMemberGet.mockResolvedValue(docs([
    { id: 'pm-owner', data: { projectId: 'project-1', uid: 'owner-1', role: 'owner', status: 'active', orgId: 'owner-org' } },
    { id: 'pm-manager', data: { projectId: 'project-1', uid: 'manager-1', role: 'manager', status: 'active', orgId: 'owner-org' } },
    { id: 'pm-reviewer', data: { projectId: 'project-1', uid: 'reviewer-1', role: 'reviewer', status: 'active', orgId: 'client-org' } },
  ]))
  mockMilestoneDocGet.mockResolvedValue({ exists: true, data: () => ({ title: 'Launch', status: 'active' }) })
  mockPlaybookDocGet.mockResolvedValue({ exists: true, data: () => ({ title: 'Weekly client report', status: 'active', templateSteps: ['Kickoff', 'QA'] }) })
  mockMilestoneUpdate.mockResolvedValue(undefined)
  mockPlaybookUpdate.mockResolvedValue(undefined)
  mockRunProjectPlaybookTemplate.mockResolvedValue({
    ok: true,
    data: {
      playbookId: 'playbook-1',
      playbookRunId: 'playbook-1_manual-key',
      createdTaskIds: ['task-from-playbook-1', 'task-from-playbook-2'],
      taskCount: 2,
      deduplicated: false,
    },
  })
  mockMilestoneDoc.mockImplementation((id?: string) => id
    ? { id, get: mockMilestoneDocGet, update: mockMilestoneUpdate }
    : { id: 'milestone-new', get: mockMilestoneDocGet, set: mockMilestoneAdd, update: mockMilestoneUpdate })
  mockPlaybookDoc.mockImplementation((id?: string) => id
    ? { id, get: mockPlaybookDocGet, update: mockPlaybookUpdate }
    : { id: 'playbook-new', get: mockPlaybookDocGet, set: mockPlaybookAdd, update: mockPlaybookUpdate })
  mockSubCollection.mockImplementation((name: string) => {
    if (name === 'tasks') return { get: mockTasksGet, add: mockTaskAdd }
    if (name === 'milestones') return { get: mockMilestonesGet, add: mockMilestoneAdd, doc: mockMilestoneDoc }
    if (name === 'approvals') return { get: mockApprovalsGet }
    if (name === 'risks') return { get: mockRisksGet }
    if (name === 'decisions') return { get: mockDecisionsGet }
    if (name === 'baselines') return { get: mockBaselinesGet }
    if (name === 'playbooks') return { get: mockPlaybooksGet, add: mockPlaybookAdd, doc: mockPlaybookDoc }
    if (name === 'automations') return { get: mockAutomationsGet, add: mockAutomationAdd, doc: jest.fn(() => ({ id: 'automation-new', set: mockAutomationAdd })) }
    if (name === 'permissions') return { get: mockPermissionsGet, add: mockPermissionAdd, doc: jest.fn(() => ({ id: 'permission-new', set: mockPermissionAdd })) }
    if (name === 'audit') return { get: mockAuditGet, add: mockAuditAdd }
    if (name === 'notificationSettings') return { get: mockNotificationSettingsGet, add: mockNotificationAdd, doc: jest.fn(() => ({ id: 'notification-new', set: mockNotificationAdd })) }
    if (name === 'capacities') return { get: mockCapacitiesGet, add: mockCapacityAdd, doc: jest.fn(() => ({ id: 'capacity-new', set: mockCapacityAdd })) }
    if (name === 'revenue') return { get: mockRevenueGet, add: mockRevenueAdd, doc: jest.fn(() => ({ id: 'revenue-new', set: mockRevenueAdd })) }
    throw new Error(`Unexpected subcollection ${name}`)
  })
  mockProjectDoc.mockReturnValue({
    collection: mockSubCollection,
    get: jest.fn(async () => ({
      exists: true,
      data: () => ({ id: 'project-1', orgId: 'owner-org', ownerOrgId: 'owner-org' }),
    })),
  })
  mockCollection.mockImplementation((name: string) => {
    if (name === 'projects') return { doc: mockProjectDoc }
    if (name === 'projectMembers') return { where: mockProjectMemberWhere }
    if (name === 'notifications') return { add: mockNotificationFeedAdd }
    throw new Error(`Unexpected collection ${name}`)
  })
})

describe('project suite API', () => {
  it('fails closed before suite helpers when project access is absent', async () => {
    mockGetProjectForUser.mockResolvedValueOnce({
      ok: false,
      status: 403,
      error: 'Project access denied',
    })

    const { GET } = await import('@/app/api/v1/projects/[projectId]/suite/route')
    const res = await GET(new NextRequest('http://localhost/api/v1/projects/project-1/suite'), {
      params: Promise.resolve({ projectId: 'project-1' }),
    })

    expect(res.status).toBe(403)
    expect(mockCollection).not.toHaveBeenCalled()
  })

  it('filters every Project Suite decision surface to a cross-org grant item allowlist', async () => {
    mockGetProjectForUser.mockResolvedValueOnce({
      ok: true,
      doc: {
        id: 'project-1',
        data: () => ({ id: 'project-1', orgId: 'owner-org', ownerOrgId: 'owner-org' }),
      },
      projectAccess: {
        role: 'reviewer',
        source: 'project_organization',
        canViewInternal: false,
        crossOrgGrant: {
          grantId: 'grant-project-1',
          actions: ['project.read'],
          items: ['task-ok', 'milestone-ok', 'approval-ok', 'risk-ok', 'budget-ok'],
        },
      },
    })
    mockTasksGet.mockResolvedValue(docs([
      { id: 'task-ok', data: { title: 'Partner task', columnId: 'blocked' } },
      { id: 'task-no', data: { title: 'Internal task', columnId: 'blocked' } },
    ]))
    mockMilestonesGet.mockResolvedValue(docs([
      { id: 'milestone-ok', data: { title: 'Partner milestone', status: 'active' } },
      { id: 'milestone-no', data: { title: 'Internal milestone', status: 'active' } },
    ]))
    mockApprovalsGet.mockResolvedValue(docs([
      { id: 'approval-ok', data: { title: 'Partner approval', status: 'pending' } },
      { id: 'approval-no', data: { title: 'Internal approval', status: 'pending' } },
    ]))
    mockRisksGet.mockResolvedValue(docs([
      { id: 'risk-ok', data: { title: 'Partner risk', severity: 'high' } },
      { id: 'risk-no', data: { title: 'Internal risk', severity: 'high' } },
    ]))
    mockRevenueGet.mockResolvedValue(docs([
      { id: 'budget-ok', data: { amount: 100, currency: 'ZAR' } },
      { id: 'budget-no', data: { amount: 500, currency: 'ZAR' } },
    ]))

    const { GET } = await import('@/app/api/v1/projects/[projectId]/suite/route')
    const res = await GET(new NextRequest('http://localhost/api/v1/projects/project-1/suite'), {
      params: Promise.resolve({ projectId: 'project-1' }),
    })
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.data.tasks.map((item: { id: string }) => item.id)).toEqual(['task-ok'])
    expect(body.data.milestones.map((item: { id: string }) => item.id)).toEqual(['milestone-ok'])
    expect(body.data.approvals.map((item: { id: string }) => item.id)).toEqual(['approval-ok'])
    expect(body.data.risks.map((item: { id: string }) => item.id)).toEqual(['risk-ok'])
    expect(body.data.revenue.map((item: { id: string }) => item.id)).toEqual(['budget-ok'])
    expect(body.data.reports.revenue.trackedAmount).toBe(100)
  })

  it('denies a restricted cross-org suite grant from updating another item', async () => {
    mockGetProjectForUser.mockResolvedValueOnce({
      ok: true,
      doc: { id: 'project-1', data: () => ({ id: 'project-1', orgId: 'owner-org', ownerOrgId: 'owner-org' }) },
      projectAccess: {
        role: 'manager',
        source: 'project_organization',
        canViewInternal: false,
        crossOrgGrant: { grantId: 'grant-project-1', actions: ['project.write'], items: ['milestone-other'] },
      },
    })

    const { PATCH } = await import('@/app/api/v1/projects/[projectId]/suite/route')
    const res = await PATCH(new NextRequest('http://localhost/api/v1/projects/project-1/suite', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'milestone', id: 'milestone-1', title: 'Forbidden update' }),
    }), { params: Promise.resolve({ projectId: 'project-1' }) })

    expect(res.status).toBe(403)
    expect(mockMilestoneUpdate).not.toHaveBeenCalled()
  })

  it('denies an item-scoped cross-org grant from creating an unscoped suite record', async () => {
    mockGetProjectForUser.mockResolvedValueOnce({
      ok: true,
      doc: { id: 'project-1', data: () => ({ id: 'project-1', orgId: 'owner-org', ownerOrgId: 'owner-org' }) },
      projectAccess: {
        role: 'manager', source: 'project_organization', canViewInternal: false,
        crossOrgGrant: { grantId: 'grant-project-1', actions: ['project.write'], items: ['milestone-existing'] },
      },
    })

    const { POST } = await import('@/app/api/v1/projects/[projectId]/suite/route')
    const res = await POST(new NextRequest('http://localhost/api/v1/projects/project-1/suite', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'milestone', title: 'Unscoped external milestone' }),
    }), { params: Promise.resolve({ projectId: 'project-1' }) })

    expect(res.status).toBe(403)
    expect(mockMilestoneAdd).not.toHaveBeenCalled()
  })

  it('denies a playbook run outside an item-scoped cross-org grant', async () => {
    mockGetProjectForUser.mockResolvedValueOnce({
      ok: true,
      doc: { id: 'project-1', data: () => ({ id: 'project-1', orgId: 'owner-org', ownerOrgId: 'owner-org' }) },
      projectAccess: {
        role: 'manager', source: 'project_organization', canViewInternal: false,
        crossOrgGrant: { grantId: 'grant-project-1', actions: ['project.write'], items: ['playbook-other'] },
      },
    })

    const { POST } = await import('@/app/api/v1/projects/[projectId]/suite/route')
    const res = await POST(new NextRequest('http://localhost/api/v1/projects/project-1/suite', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'playbook', action: 'run', id: 'playbook-1' }),
    }), { params: Promise.resolve({ projectId: 'project-1' }) })

    expect(res.status).toBe(403)
    expect(mockRunProjectPlaybookTemplate).not.toHaveBeenCalled()
  })

  it('denies a cross-org contributor a Project Suite mutation without project.write', async () => {
    mockGetProjectForUser.mockResolvedValueOnce({
      ok: true,
      doc: {
        id: 'project-1',
        data: () => ({ id: 'project-1', orgId: 'owner-org', ownerOrgId: 'owner-org' }),
      },
      projectAccess: {
        role: 'contributor',
        source: 'project_organization',
        canViewInternal: false,
        crossOrgGrant: { grantId: 'grant-project-1', actions: ['project.read'], items: [] },
      },
    })

    const { POST } = await import('@/app/api/v1/projects/[projectId]/suite/route')
    const res = await POST(new NextRequest('http://localhost/api/v1/projects/project-1/suite', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'milestone', title: 'Attempted external write' }),
    }), { params: Promise.resolve({ projectId: 'project-1' }) })

    expect(res.status).toBe(403)
    expect(mockMilestoneAdd).not.toHaveBeenCalled()
  })

  it('returns PM suite data, computed health, and filters internal-only records', async () => {
    const { GET } = await import('@/app/api/v1/projects/[projectId]/suite/route')
    const res = await GET(new NextRequest('http://localhost/api/v1/projects/project-1/suite'), {
      params: Promise.resolve({ projectId: 'project-1' }),
    })
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.data.tasks.map((task: { id: string }) => task.id)).toEqual(['task-1'])
    expect(body.data.milestones).toHaveLength(1)
    expect(body.data.approvals).toHaveLength(1)
    expect(body.data.risks).toHaveLength(1)
    expect(body.data.decisions).toHaveLength(1)
    expect(body.data.baselines).toHaveLength(1)
    expect(body.data.playbooks).toHaveLength(1)
    expect(body.data.automations).toHaveLength(1)
    expect(body.data.permissions.map((permission: { id: string }) => permission.id)).toEqual(['permission-1'])
    expect(body.data.audit).toHaveLength(1)
    expect(body.data.notificationSettings).toHaveLength(1)
    expect(body.data.timeline.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'task-1', kind: 'task', dependencies: ['task-0'], baselineDriftDays: 5 }),
      expect.objectContaining({ id: 'milestone-1', kind: 'milestone', dependencies: ['task-1'], baselineDriftDays: 5 }),
    ]))
    expect(body.data.workload.assignees).toEqual(expect.arrayContaining([
      expect.objectContaining({ uid: 'owner-1', name: 'Peet Stander', assignedTasks: 1, estimateMinutes: 120, capacityMinutes: 480, utilizationPercent: 25, remainingMinutes: 360 }),
      expect.objectContaining({ uid: 'designer-1', name: 'Design Lead', assignedTasks: 0, estimateMinutes: 0, capacityMinutes: 600, utilizationPercent: 0, remainingMinutes: 600 }),
    ]))
    expect(body.data.workload.totalRemainingMinutes).toBeGreaterThanOrEqual(960)
    expect(body.data.reports.tasks).toEqual(expect.objectContaining({ total: 1, blocked: 1 }))
    expect(body.data.reports.revenue).toEqual(expect.objectContaining({ trackedAmount: 12500, currency: 'ZAR' }))
    expect(body.data.health.level).toBe('at_risk')
    expect(body.data.health.blockedTasks).toBe(1)
  })

  it('applies targeted permission policies before filtering suite items', async () => {
    mockGetProjectForUser.mockResolvedValueOnce({
      ok: true,
      doc: {
        id: 'project-1',
        data: () => ({ id: 'project-1', orgId: 'owner-org', ownerOrgId: 'owner-org' }),
      },
      projectAccess: { role: 'reviewer', source: 'project_member', canViewInternal: false },
    })
    mockPermissionsGet.mockResolvedValueOnce(docs([
      {
        id: 'permission-manager-milestone',
        data: {
          title: 'Manager-only milestone',
          itemType: 'milestone',
          itemId: 'milestone-1',
          visibility: 'restricted',
          allowedRoleIds: ['manager'],
        },
      },
      {
        id: 'permission-reviewer-risk',
        data: {
          title: 'Reviewer risk',
          itemType: 'risk',
          itemId: 'risk-1',
          visibility: 'restricted',
          allowedRoleIds: ['reviewer'],
        },
      },
    ]))

    const { GET } = await import('@/app/api/v1/projects/[projectId]/suite/route')
    const res = await GET(new NextRequest('http://localhost/api/v1/projects/project-1/suite'), {
      params: Promise.resolve({ projectId: 'project-1' }),
    })
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.data.milestones.map((milestone: { id: string }) => milestone.id)).not.toContain('milestone-1')
    expect(body.data.risks.map((risk: { id: string }) => risk.id)).toContain('risk-1')
    expect(body.data.permissions.map((permission: { id: string }) => permission.id)).toEqual(['permission-reviewer-risk'])
  })

  it('creates a milestone record with internal visibility support', async () => {
    const { POST } = await import('@/app/api/v1/projects/[projectId]/suite/route')
    const res = await POST(new NextRequest('http://localhost/api/v1/projects/project-1/suite', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        type: 'milestone',
        title: 'Public launch',
        startDate: '2026-06-15',
        dueDate: '2026-07-01',
        baselineDueDate: '2026-06-20',
        dependsOn: ['task-1'],
        internalOnly: true,
      }),
    }), {
      params: Promise.resolve({ projectId: 'project-1' }),
    })

    expect(res.status).toBe(201)
    expect(mockMilestoneAdd).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Public launch',
      startDate: '2026-06-15',
      dueDate: '2026-07-01',
      baselineDueDate: '2026-06-20',
      dependsOn: ['task-1'],
      internalOnly: true,
      createdBy: 'owner-1',
    }))
  })

  it('creates automation records with configurable visibility controls', async () => {
    const { POST } = await import('@/app/api/v1/projects/[projectId]/suite/route')
    const res = await POST(new NextRequest('http://localhost/api/v1/projects/project-1/suite', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        type: 'automation',
        title: 'Notify when milestone slips',
        trigger: 'milestone_drift',
        visibility: 'restricted',
        allowedRoleIds: ['manager'],
        notificationChannels: ['email', 'in_app'],
      }),
    }), {
      params: Promise.resolve({ projectId: 'project-1' }),
    })

    expect(res.status).toBe(201)
    expect(mockAutomationAdd).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Notify when milestone slips',
      trigger: 'milestone_drift',
      visibility: 'restricted',
      allowedRoleIds: ['manager'],
      notificationChannels: ['email', 'in_app'],
      createdBy: 'owner-1',
    }))
  })

  it('creates targeted permission policies with user, org, and role rules', async () => {
    const { POST } = await import('@/app/api/v1/projects/[projectId]/suite/route')
    const res = await POST(new NextRequest('http://localhost/api/v1/projects/project-1/suite', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        type: 'permission',
        title: 'Manager-only launch gate',
        itemType: 'milestone',
        itemId: 'milestone-1',
        visibility: 'restricted',
        allowedUserIds: ['owner-1'],
        allowedOrgIds: ['owner-org'],
        allowedRoleIds: ['manager'],
      }),
    }), {
      params: Promise.resolve({ projectId: 'project-1' }),
    })

    expect(res.status).toBe(201)
    expect(mockPermissionAdd).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Manager-only launch gate',
      itemType: 'milestone',
      itemId: 'milestone-1',
      visibility: 'restricted',
      allowedUserIds: ['owner-1'],
      allowedOrgIds: ['owner-org'],
      allowedRoleIds: ['manager'],
      createdBy: 'owner-1',
    }))
  })

  it('creates notification controls with event, recipient, and enabled settings', async () => {
    const { POST } = await import('@/app/api/v1/projects/[projectId]/suite/route')
    const res = await POST(new NextRequest('http://localhost/api/v1/projects/project-1/suite', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        type: 'notification',
        title: 'Approval waiting reminders',
        eventType: 'approval_waiting',
        itemType: 'approval',
        channel: 'both',
        recipientRoleIds: ['manager', 'reviewer'],
        enabled: true,
        visibility: 'project',
      }),
    }), {
      params: Promise.resolve({ projectId: 'project-1' }),
    })

    expect(res.status).toBe(201)
    expect(mockNotificationAdd).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Approval waiting reminders',
      eventType: 'approval_waiting',
      itemType: 'approval',
      channel: 'both',
      recipientRoleIds: ['manager', 'reviewer'],
      enabled: true,
      visibility: 'project',
      createdBy: 'owner-1',
    }))
  })

  it('creates recurring playbook templates with reusable steps', async () => {
    const { POST } = await import('@/app/api/v1/projects/[projectId]/suite/route')
    const res = await POST(new NextRequest('http://localhost/api/v1/projects/project-1/suite', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        type: 'playbook',
        title: 'Monthly launch template',
        cadence: 'monthly',
        templateKind: 'delivery',
        recurrenceRule: 'FREQ=MONTHLY;INTERVAL=1',
        nextRunAt: '2026-06-01',
        autoCreateTasks: true,
        templateSteps: ['Kickoff', 'QA', 'Client signoff'],
        visibility: 'project',
      }),
    }), {
      params: Promise.resolve({ projectId: 'project-1' }),
    })

    expect(res.status).toBe(201)
    expect(mockPlaybookAdd).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Monthly launch template',
      cadence: 'monthly',
      templateKind: 'delivery',
      recurrenceRule: 'FREQ=MONTHLY;INTERVAL=1',
      nextRunAt: '2026-06-01',
      autoCreateTasks: true,
      templateSteps: ['Kickoff', 'QA', 'Client signoff'],
      visibility: 'project',
      createdBy: 'owner-1',
    }))
  })

  it('runs a playbook template into project tasks and records an audit event', async () => {
    const { POST } = await import('@/app/api/v1/projects/[projectId]/suite/route')
    const res = await POST(new NextRequest('http://localhost/api/v1/projects/project-1/suite', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': 'manual-key' },
      body: JSON.stringify({
        type: 'playbook',
        id: 'playbook-1',
        action: 'run',
      }),
    }), {
      params: Promise.resolve({ projectId: 'project-1' }),
    })
    const body = await res.json()

    expect(res.status).toBe(201)
    expect(body.data).toEqual(expect.objectContaining({
      playbookId: 'playbook-1',
      createdTaskIds: ['task-from-playbook-1', 'task-from-playbook-2'],
      taskCount: 2,
    }))
    expect(mockRunProjectPlaybookTemplate).toHaveBeenCalledWith(expect.objectContaining({
      projectId: 'project-1',
      playbookId: 'playbook-1',
      actorUid: 'owner-1',
      runKey: 'manual-key',
      project: expect.objectContaining({ orgId: 'owner-org' }),
    }))
  })

  it('creates capacity records with user identity fields for workload planning', async () => {
    const { POST } = await import('@/app/api/v1/projects/[projectId]/suite/route')
    const res = await POST(new NextRequest('http://localhost/api/v1/projects/project-1/suite', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        type: 'capacity',
        title: 'Peet Stander weekly capacity',
        uid: 'owner-1',
        displayName: 'Peet Stander',
        capacityMinutes: 1200,
        visibility: 'internal',
      }),
    }), {
      params: Promise.resolve({ projectId: 'project-1' }),
    })

    expect(res.status).toBe(201)
    expect(mockCapacityAdd).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Peet Stander weekly capacity',
      uid: 'owner-1',
      displayName: 'Peet Stander',
      capacityMinutes: 1200,
      visibility: 'internal',
      createdBy: 'owner-1',
    }))
  })

  it('creates revenue records for project reporting', async () => {
    const { POST } = await import('@/app/api/v1/projects/[projectId]/suite/route')
    const res = await POST(new NextRequest('http://localhost/api/v1/projects/project-1/suite', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        type: 'revenue',
        title: 'Launch retainer',
        amount: 25000,
        currency: 'ZAR',
        visibility: 'internal',
      }),
    }), {
      params: Promise.resolve({ projectId: 'project-1' }),
    })

    expect(res.status).toBe(201)
    expect(mockRevenueAdd).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Launch retainer',
      amount: 25000,
      currency: 'ZAR',
      visibility: 'internal',
      createdBy: 'owner-1',
    }))
  })

  it('updates editable suite timeline records and writes an audit event', async () => {
    const { PATCH } = await import('@/app/api/v1/projects/[projectId]/suite/route')
    const res = await PATCH(new NextRequest('http://localhost/api/v1/projects/project-1/suite', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        type: 'milestone',
        id: 'milestone-1',
        title: 'Launch readiness',
        startDate: '2026-06-01',
        dueDate: '2026-06-25',
        baselineDueDate: '2026-06-15',
        dependsOn: ['task-1', 'approval-1'],
        visibility: 'restricted',
        allowedRoleIds: ['manager'],
      }),
    }), {
      params: Promise.resolve({ projectId: 'project-1' }),
    })

    expect(res.status).toBe(200)
    expect(mockMilestoneDoc).toHaveBeenCalledWith('milestone-1')
    expect(mockMilestoneUpdate).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Launch readiness',
      startDate: '2026-06-01',
      dueDate: '2026-06-25',
      baselineDueDate: '2026-06-15',
      dependsOn: ['task-1', 'approval-1'],
      visibility: 'restricted',
      allowedRoleIds: ['manager'],
      updatedBy: 'owner-1',
    }))
    expect(mockAuditAdd).toHaveBeenCalledWith(expect.objectContaining({
      eventType: 'suite_updated',
      itemType: 'milestone',
      itemId: 'milestone-1',
      actorUid: 'owner-1',
    }))
  })

  it('fans out configured suite lifecycle notifications to project collaborators', async () => {
    mockNotificationSettingsGet.mockResolvedValueOnce(docs([
      {
        id: 'notification-suite-update',
        data: {
          title: 'Milestone changes',
          eventType: 'suite_updated',
          itemType: 'milestone',
          recipientRoleIds: ['manager'],
          recipientUserIds: ['reviewer-1'],
          channel: 'in_app',
          enabled: true,
        },
      },
    ]))

    const { PATCH } = await import('@/app/api/v1/projects/[projectId]/suite/route')
    const res = await PATCH(new NextRequest('http://localhost/api/v1/projects/project-1/suite', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        type: 'milestone',
        id: 'milestone-1',
        title: 'Launch readiness',
      }),
    }), {
      params: Promise.resolve({ projectId: 'project-1' }),
    })

    expect(res.status).toBe(200)
    expect(mockNotificationFeedAdd).toHaveBeenCalledTimes(2)
    expect(mockNotificationFeedAdd).toHaveBeenCalledWith(expect.objectContaining({
      orgId: 'owner-org',
      userId: 'manager-1',
      type: 'project.suite_updated',
      title: 'Milestone changes',
      body: 'Launch readiness',
      link: '/portal/projects/project-1?suite=milestone&item=milestone-1',
      data: expect.objectContaining({
        projectId: 'project-1',
        itemType: 'milestone',
        itemId: 'milestone-1',
        eventType: 'suite_updated',
        notificationSettingId: 'notification-suite-update',
      }),
      status: 'unread',
      priority: 'normal',
    }))
    expect(mockNotificationFeedAdd).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'reviewer-1',
    }))
    expect(mockNotificationFeedAdd).not.toHaveBeenCalledWith(expect.objectContaining({
      userId: 'owner-1',
    }))
  })

  it('archives suite records instead of hard deleting them and writes an audit event', async () => {
    const { DELETE } = await import('@/app/api/v1/projects/[projectId]/suite/route')
    const res = await DELETE(new NextRequest('http://localhost/api/v1/projects/project-1/suite', {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        type: 'playbook',
        id: 'playbook-1',
      }),
    }), {
      params: Promise.resolve({ projectId: 'project-1' }),
    })

    expect(res.status).toBe(200)
    expect(mockPlaybookDoc).toHaveBeenCalledWith('playbook-1')
    expect(mockPlaybookUpdate).toHaveBeenCalledWith(expect.objectContaining({
      deleted: true,
      status: 'archived',
      updatedBy: 'owner-1',
    }))
    expect(mockAuditAdd).toHaveBeenCalledWith(expect.objectContaining({
      eventType: 'suite_archived',
      itemType: 'playbook',
      itemId: 'playbook-1',
    }))
  })
})
