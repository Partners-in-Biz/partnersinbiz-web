import { NextRequest } from 'next/server'

const mockGet = jest.fn()
const mockWhere = jest.fn()
const mockOrderBy = jest.fn()
const mockLimit = jest.fn()
const mockOffset = jest.fn()
const mockCollection = jest.fn()

jest.mock('firebase-admin/firestore', () => ({
  FieldValue: { serverTimestamp: jest.fn(() => 'SERVER_TIMESTAMP') },
}))

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: { collection: mockCollection },
}))

jest.mock('@/lib/api/auth', () => ({
  withAuth: (
    _role: string,
    handler: (req: NextRequest, user: { uid: string; role: string; allowedOrgIds: string[] }) => Promise<Response>,
  ) => (req: NextRequest) => handler(req, { uid: 'admin-1', role: 'admin', allowedOrgIds: [] }),
}))

jest.mock('@/lib/activity/log', () => ({
  logActivity: jest.fn(() => Promise.resolve()),
}))

function taskDoc(id: string, data: Record<string, unknown>) {
  return { id, data: () => data }
}

describe('GET /api/v1/tasks', () => {
  beforeEach(() => {
    jest.resetModules()
    jest.clearAllMocks()
    const query = { where: mockWhere, orderBy: mockOrderBy, limit: mockLimit, offset: mockOffset, get: mockGet }
    mockWhere.mockImplementation((field: string) => {
      if (field.startsWith('assignedTo.')) {
        throw new Error('Firestore composite index missing for nested assignedTo query')
      }
      return query
    })
    mockOrderBy.mockReturnValue(query)
    mockLimit.mockReturnValue(query)
    mockOffset.mockReturnValue(query)
    mockCollection.mockReturnValue(query)
  })

  it('filters assignedTo=agent by top-level assigneeAgentId without the nested assignedTo query', async () => {
    mockGet.mockResolvedValue({
      docs: [
        taskDoc('top-level-agent', { orgId: 'pib-platform-owner', title: 'Top-level Theo task', assigneeAgentId: 'theo', createdAt: 3 }),
        taskDoc('legacy-agent', { orgId: 'pib-platform-owner', title: 'Legacy Theo task', assignedTo: { type: 'agent', id: 'theo' }, createdAt: 2 }),
        taskDoc('other-agent', { orgId: 'pib-platform-owner', title: 'Pip task', assigneeAgentId: 'pip', createdAt: 1 }),
        taskDoc('deleted-agent', { orgId: 'pib-platform-owner', title: 'Deleted Theo task', assigneeAgentId: 'theo', deleted: true, createdAt: 0 }),
      ],
    })

    const { GET } = await import('@/app/api/v1/tasks/route')
    const res = await GET(new NextRequest('http://localhost/api/v1/tasks?orgId=pib-platform-owner&assignedTo=agent:theo&limit=5'))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(mockWhere).toHaveBeenCalledWith('orgId', '==', 'pib-platform-owner')
    expect(mockWhere).not.toHaveBeenCalledWith('assignedTo.type', '==', 'agent')
    expect(mockWhere).not.toHaveBeenCalledWith('assignedTo.id', '==', 'theo')
    expect(body.data.map((task: { id: string }) => task.id)).toEqual(['top-level-agent', 'legacy-agent'])
  })

  it('keeps contact task lookups index-safe by filtering contactId in memory', async () => {
    mockWhere.mockImplementation((field: string) => {
      if (field === 'contactId') {
        throw new Error('Firestore composite index missing for contact task lookup')
      }
      const query = { where: mockWhere, orderBy: mockOrderBy, limit: mockLimit, offset: mockOffset, get: mockGet }
      return query
    })
    mockGet.mockResolvedValue({
      docs: [
        taskDoc('shayne-follow-up', { orgId: 'pib-platform-owner', title: 'Follow up call', contactId: 'contact-shayne', createdAt: 3 }),
        taskDoc('other-contact-task', { orgId: 'pib-platform-owner', title: 'Other follow up', contactId: 'contact-other', createdAt: 2 }),
        taskDoc('deleted-contact-task', { orgId: 'pib-platform-owner', title: 'Deleted follow up', contactId: 'contact-shayne', deleted: true, createdAt: 1 }),
      ],
    })

    const { GET } = await import('@/app/api/v1/tasks/route')
    const res = await GET(new NextRequest('http://localhost/api/v1/tasks?orgId=pib-platform-owner&contactId=contact-shayne&limit=5'))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(mockWhere).toHaveBeenCalledWith('orgId', '==', 'pib-platform-owner')
    expect(mockWhere).not.toHaveBeenCalledWith('contactId', '==', 'contact-shayne')
    expect(body.data.map((task: { id: string }) => task.id)).toEqual(['shayne-follow-up'])
  })

  it('preserves assignedTo=user filtering through the existing assignedTo fields', async () => {
    const query = { where: mockWhere, orderBy: mockOrderBy, limit: mockLimit, offset: mockOffset, get: mockGet }
    mockWhere.mockReturnValue(query)
    mockGet.mockResolvedValue({
      docs: [
        taskDoc('user-task', { orgId: 'pib-platform-owner', title: 'User task', assignedTo: { type: 'user', id: 'user-1' } }),
      ],
    })

    const { GET } = await import('@/app/api/v1/tasks/route')
    const res = await GET(new NextRequest('http://localhost/api/v1/tasks?orgId=pib-platform-owner&assignedTo=user:user-1&limit=5'))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(mockWhere).toHaveBeenCalledWith('assignedTo.type', '==', 'user')
    expect(mockWhere).toHaveBeenCalledWith('assignedTo.id', '==', 'user-1')
    expect(body.data.map((task: { id: string }) => task.id)).toEqual(['user-task'])
  })
})
