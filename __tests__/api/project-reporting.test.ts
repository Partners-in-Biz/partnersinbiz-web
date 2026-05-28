import { NextRequest } from 'next/server'

const mockCollection = jest.fn()
const mockProjectWhere = jest.fn()
const mockProjectDoc = jest.fn()
const mockSubCollection = jest.fn()
const mockGetProjectForUser = jest.fn()
const mockCanAccessOrg = jest.fn()

const mockUser = { uid: 'owner-1', role: 'admin' as const, orgId: 'owner-org', allowedOrgIds: ['owner-org'] }
type MockAuthHandler = (req: NextRequest, user: typeof mockUser, ctx?: unknown) => unknown

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: { collection: mockCollection },
}))

jest.mock('@/lib/api/auth', () => ({
  withAuth: (_role: string, handler: MockAuthHandler) => async (req: NextRequest, ctx?: unknown) =>
    handler(req, mockUser, ctx),
}))

jest.mock('@/lib/api/platformAdmin', () => ({
  canAccessOrg: (...args: unknown[]) => mockCanAccessOrg(...args),
  isSuperAdmin: jest.fn(() => false),
}))

jest.mock('@/lib/projects/access', () => ({
  getProjectForUser: (...args: unknown[]) => mockGetProjectForUser(...args),
}))

function snap(items: Array<{ id: string; data: Record<string, unknown> }>) {
  return { empty: items.length === 0, docs: items.map((item) => ({ id: item.id, data: () => item.data })) }
}

const projects = [
  {
    id: 'project-1',
    data: {
      name: 'Website launch',
      status: 'development',
      ownerOrgId: 'owner-org',
      clientOrgId: 'client-1',
      clientName: 'Client One',
      createdAt: { seconds: 20 },
    },
  },
  {
    id: 'project-2',
    data: {
      name: 'SEO sprint',
      status: 'review',
      ownerOrgId: 'owner-org',
      clientOrgId: 'client-2',
      clientName: 'Client Two',
      createdAt: { seconds: 10 },
    },
  },
]

const subcollections: Record<string, Record<string, Array<{ id: string; data: Record<string, unknown> }>>> = {
  'project-1': {
    tasks: [
      { id: 'task-1', data: { title: 'Blocked task', columnId: 'blocked', assigneeIds: ['owner-1'], estimateMinutes: 300, dueDate: '2020-01-01' } },
    ],
    milestones: [
      { id: 'milestone-1', data: { title: 'Launch', dueDate: '2026-06-20', baselineDueDate: '2026-06-10' } },
    ],
    approvals: [
      { id: 'approval-1', data: { title: 'Client signoff', status: 'pending' } },
    ],
    risks: [
      { id: 'risk-1', data: { title: 'Scope drift', severity: 'high', status: 'open' } },
    ],
    capacities: [
      { id: 'capacity-1', data: { uid: 'owner-1', displayName: 'Peet Stander', capacityMinutes: 600 } },
    ],
    revenue: [
      { id: 'revenue-1', data: { title: 'Launch retainer', amount: 25000, currency: 'ZAR' } },
    ],
  },
  'project-2': {
    tasks: [
      { id: 'task-2', data: { title: 'SEO plan', columnId: 'doing', assigneeIds: ['owner-1'], estimateMinutes: 900, dueDate: '2027-01-01' } },
    ],
    milestones: [],
    approvals: [],
    risks: [],
    capacities: [
      { id: 'capacity-2', data: { uid: 'owner-1', displayName: 'Peet Stander', capacityMinutes: 600 } },
    ],
    revenue: [
      { id: 'revenue-2', data: { title: 'SEO retainer', amount: 10000, currency: 'ZAR' } },
    ],
  },
}

beforeEach(() => {
  jest.clearAllMocks()
  mockCanAccessOrg.mockReturnValue(true)
  mockGetProjectForUser.mockResolvedValue({
    ok: true,
    projectAccess: { role: 'manager', source: 'project_member', canViewInternal: true },
  })
  mockProjectWhere.mockImplementation((field: string, _op: string, value: string) => ({
    get: jest.fn(async () => field === 'ownerOrgId' && value === 'owner-org' ? snap(projects) : snap([])),
  }))
  mockSubCollection.mockImplementation((name: string) => ({
    get: jest.fn(async () => {
      const projectId = mockProjectDoc.mock.calls[mockProjectDoc.mock.calls.length - 1]?.[0] as string
      return snap(subcollections[projectId]?.[name] ?? [])
    }),
  }))
  mockProjectDoc.mockImplementation((projectId: string) => ({
    collection: (name: string) => ({
      get: jest.fn(async () => snap(subcollections[projectId]?.[name] ?? [])),
    }),
  }))
  mockCollection.mockImplementation((name: string) => {
    if (name === 'projects') return { where: mockProjectWhere, doc: mockProjectDoc }
    throw new Error(`Unexpected collection ${name}`)
  })
})

describe('GET /api/v1/projects/reporting', () => {
  it('rolls up projects by client, person, health, and revenue', async () => {
    const { GET } = await import('@/app/api/v1/projects/reporting/route')
    const res = await GET(new NextRequest('http://localhost/api/v1/projects/reporting?orgId=owner-org'))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(mockProjectWhere).toHaveBeenCalledWith('ownerOrgId', '==', 'owner-org')
    expect(body.data.summary).toEqual(expect.objectContaining({
      totalProjects: 2,
      totalTasks: 2,
      blockedTasks: 1,
      waitingApprovals: 1,
      highRisks: 1,
      trackedRevenue: 35000,
      currency: 'ZAR',
    }))
    expect(body.data.clients).toEqual(expect.arrayContaining([
      expect.objectContaining({ clientOrgId: 'client-1', clientName: 'Client One', projectCount: 1, trackedRevenue: 25000, openTasks: 1 }),
      expect.objectContaining({ clientOrgId: 'client-2', clientName: 'Client Two', projectCount: 1, trackedRevenue: 10000, openTasks: 1 }),
    ]))
    expect(body.data.people).toEqual([
      expect.objectContaining({
        uid: 'owner-1',
        name: 'Peet Stander',
        assignedTasks: 2,
        estimateMinutes: 1200,
        capacityMinutes: 1200,
        utilizationPercent: 100,
      }),
    ])
    expect(body.data.projects).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'project-1',
        name: 'Website launch',
        clientOrgId: 'client-1',
        reports: expect.objectContaining({
          revenue: expect.objectContaining({ trackedAmount: 25000 }),
        }),
      }),
    ]))
  })

  it('requires access to the requested organisation', async () => {
    mockCanAccessOrg.mockReturnValue(false)
    const { GET } = await import('@/app/api/v1/projects/reporting/route')
    const res = await GET(new NextRequest('http://localhost/api/v1/projects/reporting?orgId=owner-org'))
    const body = await res.json()

    expect(res.status).toBe(403)
    expect(body.error).toBe('Forbidden')
  })
})
