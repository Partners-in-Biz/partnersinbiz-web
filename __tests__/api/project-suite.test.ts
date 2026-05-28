import { NextRequest } from 'next/server'

const mockGetProjectForUser = jest.fn()
const mockCollection = jest.fn()
const mockProjectDoc = jest.fn()
const mockSubCollection = jest.fn()
const mockTasksGet = jest.fn()
const mockMilestonesGet = jest.fn()
const mockApprovalsGet = jest.fn()
const mockRisksGet = jest.fn()
const mockDecisionsGet = jest.fn()
const mockMilestoneAdd = jest.fn()

let mockUser = { uid: 'owner-1', role: 'admin' as const, orgId: 'owner-org' }

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: { collection: mockCollection },
}))

jest.mock('@/lib/api/auth', () => ({
  withAuth: (_role: string, handler: any) => async (req: NextRequest, ctx?: unknown) =>
    handler(req, mockUser, ctx),
}))

jest.mock('@/lib/projects/access', () => ({
  getProjectForUser: (...args: unknown[]) => mockGetProjectForUser(...args),
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
    { id: 'task-1', data: { title: 'Public blocked task', columnId: 'blocked', dueDate: '2026-01-01' } },
    { id: 'task-internal', data: { title: 'Internal blocked task', columnId: 'blocked', internalOnly: true } },
  ]))
  mockMilestonesGet.mockResolvedValue(docs([
    { id: 'milestone-1', data: { title: 'Launch', dueDate: '2026-01-02', status: 'active' } },
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
  mockMilestoneAdd.mockResolvedValue({ id: 'milestone-new' })
  mockSubCollection.mockImplementation((name: string) => {
    if (name === 'tasks') return { get: mockTasksGet }
    if (name === 'milestones') return { get: mockMilestonesGet, add: mockMilestoneAdd }
    if (name === 'approvals') return { get: mockApprovalsGet }
    if (name === 'risks') return { get: mockRisksGet }
    if (name === 'decisions') return { get: mockDecisionsGet }
    throw new Error(`Unexpected subcollection ${name}`)
  })
  mockProjectDoc.mockReturnValue({ collection: mockSubCollection })
  mockCollection.mockImplementation((name: string) => {
    if (name === 'projects') return { doc: mockProjectDoc }
    throw new Error(`Unexpected collection ${name}`)
  })
})

describe('project suite API', () => {
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
    expect(body.data.health.level).toBe('at_risk')
    expect(body.data.health.blockedTasks).toBe(1)
  })

  it('creates a milestone record with internal visibility support', async () => {
    const { POST } = await import('@/app/api/v1/projects/[projectId]/suite/route')
    const res = await POST(new NextRequest('http://localhost/api/v1/projects/project-1/suite', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        type: 'milestone',
        title: 'Public launch',
        dueDate: '2026-07-01',
        internalOnly: true,
      }),
    }), {
      params: Promise.resolve({ projectId: 'project-1' }),
    })

    expect(res.status).toBe(201)
    expect(mockMilestoneAdd).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Public launch',
      dueDate: '2026-07-01',
      internalOnly: true,
      createdBy: 'owner-1',
    }))
  })
})
