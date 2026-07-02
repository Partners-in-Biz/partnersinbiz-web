import { NextRequest } from 'next/server'

const mockGet = jest.fn()
const mockWhere = jest.fn()
const mockOrderBy = jest.fn()
const mockLimit = jest.fn()
const mockCollectionGroup = jest.fn()
const mockCollection = jest.fn()
const mockGetAll = jest.fn()

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: {
    collectionGroup: mockCollectionGroup,
    collection: mockCollection,
    getAll: mockGetAll,
  },
}))

jest.mock('@/lib/api/auth', () => ({
  withAuth: (_role: string, handler: Function) => (req: NextRequest) => handler(req, { uid: 'admin-1', role: 'admin', allowedOrgIds: [] }),
}))

function taskDoc(id: string, data: Record<string, unknown>) {
  return {
    id,
    data: () => data,
    ref: { parent: { parent: null } },
  }
}

describe('GET /api/v1/admin/agent-tasks', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    const query = { where: mockWhere, orderBy: mockOrderBy, limit: mockLimit, get: mockGet }
    mockWhere.mockReturnValue(query)
    mockOrderBy.mockReturnValue(query)
    mockLimit.mockReturnValue(query)
    mockCollectionGroup.mockReturnValue(query)
    mockCollection.mockImplementation((name: string) => ({
      doc: (id: string) => ({ path: `${name}/${id}` }),
    }))
  })

  it('serves cross-client dashboard reads without an ordered composite-index query and builds org-scoped hrefs', async () => {
    mockGet.mockResolvedValue({
      docs: [
        taskDoc('old-task', { orgId: 'org-1', title: 'Older task', assigneeAgentId: 'theo', agentStatus: 'pending', updatedAt: '2026-05-24T10:00:00.000Z' }),
        taskDoc('new-task', { orgId: 'org-1', title: 'Newer task', assigneeAgentId: 'theo', agentStatus: 'in-progress', updatedAt: '2026-05-25T10:00:00.000Z' }),
        taskDoc('ready-task', { orgId: 'org-1', title: 'Ready task', assigneeAgentId: 'theo', agentStatus: 'pending', columnId: 'todo', updatedAt: '2026-05-26T10:00:00.000Z' }),
        taskDoc('approval-task', { orgId: 'org-1', title: 'Approval task', assigneeAgentId: 'theo', agentStatus: 'pending', columnId: 'todo', approvalStatus: 'pending', updatedAt: '2026-05-27T10:00:00.000Z' }),
      ],
    })
    mockGetAll.mockResolvedValue([
      { id: 'org-1', exists: true, data: () => ({ name: 'Acme Co', slug: 'acme-co' }) },
    ])

    const { GET } = await import('@/app/api/v1/admin/agent-tasks/route')
    const res = await GET(new NextRequest('http://localhost/api/v1/admin/agent-tasks?assigneeAgentId=theo'))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(mockOrderBy).not.toHaveBeenCalled()
    expect(mockLimit).toHaveBeenCalledWith(500)
    expect(body.data.cards.map((card: { id: string }) => card.id)).toEqual(['approval-task', 'ready-task', 'new-task', 'old-task'])
    expect(body.data.cards[2].href).toBe('/admin/org/acme-co/agent/board?task=new-task')
    expect(body.data.orgNames).toEqual({ 'org-1': 'Acme Co' })
    expect(body.data.cards.find((card: { id: string }) => card.id === 'ready-task')).toEqual(expect.objectContaining({
      dispatchReady: true,
      dispatchBlocker: null,
    }))
    expect(body.data.cards.find((card: { id: string }) => card.id === 'approval-task')).toEqual(expect.objectContaining({
      dispatchReady: false,
      dispatchBlocker: 'approval-pending',
    }))
  })
})
