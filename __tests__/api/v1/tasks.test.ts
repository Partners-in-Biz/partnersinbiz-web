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
    handler: (req: NextRequest, user: { uid: string; role: string; allowedOrgIds: string[] }, context?: unknown) => Promise<Response>,
  ) => (req: NextRequest, context?: unknown) => handler(req, { uid: 'admin-1', role: 'admin', allowedOrgIds: [] }, context),
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

  it('keeps priority=high filtering index-safe by filtering priority in memory', async () => {
    mockWhere.mockImplementation((field: string) => {
      if (field === 'priority') {
        throw new Error('Firestore composite index missing for priority task lookup')
      }
      const query = { where: mockWhere, orderBy: mockOrderBy, limit: mockLimit, offset: mockOffset, get: mockGet }
      return query
    })
    mockGet.mockResolvedValue({
      docs: [
        taskDoc('high-task', { orgId: 'pib-platform-owner', title: 'High task', priority: 'high', createdAt: 3 }),
        taskDoc('normal-task', { orgId: 'pib-platform-owner', title: 'Normal task', priority: 'normal', createdAt: 2 }),
        taskDoc('deleted-high-task', { orgId: 'pib-platform-owner', title: 'Deleted high task', priority: 'high', deleted: true, createdAt: 1 }),
      ],
    })

    const { GET } = await import('@/app/api/v1/tasks/route')
    const res = await GET(new NextRequest('http://localhost/api/v1/tasks?orgId=pib-platform-owner&priority=high&limit=5'))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(mockWhere).toHaveBeenCalledWith('orgId', '==', 'pib-platform-owner')
    expect(mockWhere).not.toHaveBeenCalledWith('priority', '==', 'high')
    expect(body.data.map((task: { id: string }) => task.id)).toEqual(['high-task'])
  })

  it('keeps priority=urgent filtering index-safe by filtering priority in memory', async () => {
    mockWhere.mockImplementation((field: string) => {
      if (field === 'priority') {
        throw new Error('Firestore composite index missing for priority task lookup')
      }
      const query = { where: mockWhere, orderBy: mockOrderBy, limit: mockLimit, offset: mockOffset, get: mockGet }
      return query
    })
    mockGet.mockResolvedValue({
      docs: [
        taskDoc('urgent-task', { orgId: 'pib-platform-owner', title: 'Urgent task', priority: 'urgent', createdAt: 3 }),
        taskDoc('high-task', { orgId: 'pib-platform-owner', title: 'High task', priority: 'high', createdAt: 2 }),
      ],
    })

    const { GET } = await import('@/app/api/v1/tasks/route')
    const res = await GET(new NextRequest('http://localhost/api/v1/tasks?orgId=pib-platform-owner&priority=urgent&limit=5'))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(mockWhere).toHaveBeenCalledWith('orgId', '==', 'pib-platform-owner')
    expect(mockWhere).not.toHaveBeenCalledWith('priority', '==', 'urgent')
    expect(body.data.map((task: { id: string }) => task.id)).toEqual(['urgent-task'])
  })

  it('keeps status=todo&priority=high index-safe by querying status and filtering priority in memory', async () => {
    mockWhere.mockImplementation((field: string) => {
      if (field === 'priority') {
        throw new Error('Firestore composite index missing for priority task lookup')
      }
      const query = { where: mockWhere, orderBy: mockOrderBy, limit: mockLimit, offset: mockOffset, get: mockGet }
      return query
    })
    mockGet.mockResolvedValue({
      docs: [
        taskDoc('todo-high-task', { orgId: 'pib-platform-owner', title: 'Todo high task', status: 'todo', priority: 'high', createdAt: 3 }),
        taskDoc('todo-normal-task', { orgId: 'pib-platform-owner', title: 'Todo normal task', status: 'todo', priority: 'normal', createdAt: 2 }),
      ],
    })

    const { GET } = await import('@/app/api/v1/tasks/route')
    const res = await GET(new NextRequest('http://localhost/api/v1/tasks?orgId=pib-platform-owner&status=todo&priority=high&limit=5'))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(mockWhere).toHaveBeenCalledWith('status', '==', 'todo')
    expect(mockWhere).not.toHaveBeenCalledWith('priority', '==', 'high')
    expect(body.data.map((task: { id: string }) => task.id)).toEqual(['todo-high-task'])
  })

  it('keeps tags filtering index-safe by filtering tag intersections in memory', async () => {
    mockWhere.mockImplementation((field: string) => {
      if (field === 'tags') {
        throw new Error('Firestore composite index missing for tags task lookup')
      }
      const query = { where: mockWhere, orderBy: mockOrderBy, limit: mockLimit, offset: mockOffset, get: mockGet }
      return query
    })
    mockGet.mockResolvedValue({
      docs: [
        taskDoc('growth-task', { orgId: 'pib-platform-owner', title: 'Growth task', tags: ['growth', 'daily'], createdAt: 3 }),
        taskDoc('ops-task', { orgId: 'pib-platform-owner', title: 'Ops task', tags: ['ops'], createdAt: 2 }),
        taskDoc('deleted-growth-task', { orgId: 'pib-platform-owner', title: 'Deleted growth task', tags: ['growth'], deleted: true, createdAt: 1 }),
      ],
    })

    const { GET } = await import('@/app/api/v1/tasks/route')
    const res = await GET(new NextRequest('http://localhost/api/v1/tasks?orgId=pib-platform-owner&tags=growth,daily&limit=5'))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(mockWhere).toHaveBeenCalledWith('orgId', '==', 'pib-platform-owner')
    expect(mockWhere).not.toHaveBeenCalledWith('tags', 'array-contains-any', ['growth', 'daily'])
    expect(body.data.map((task: { id: string }) => task.id)).toEqual(['growth-task'])
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

describe('PUT /api/v1/tasks/[id]', () => {
  const mockTaskGet = jest.fn()
  const mockTaskUpdate = jest.fn()
  const mockNotificationAdd = jest.fn()

  function req(body: Record<string, unknown>) {
    return new NextRequest('http://localhost/api/v1/tasks/task-1', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  }

  beforeEach(() => {
    jest.resetModules()
    jest.clearAllMocks()
    mockTaskGet.mockResolvedValue({
      exists: true,
      id: 'task-1',
      data: () => ({
        orgId: 'pib-platform-owner',
        title: 'Daily growth agent queue',
        description: '',
        status: 'in_progress',
        priority: 'high',
        dueDate: null,
        assignedTo: { type: 'agent', id: 'sales' },
        tags: ['pib-ceo-ai-employees-sprint-2026-06-30', 'daily-growth'],
        createdBy: 'peet',
        assigneeAgentId: 'sales',
        agentStatus: 'in-progress',
        deleted: false,
      }),
    })
    mockTaskUpdate.mockResolvedValue(undefined)
    mockNotificationAdd.mockResolvedValue({ id: 'notification-1' })
    mockCollection.mockImplementation((name: string) => {
      if (name === 'tasks') {
        return {
          doc: (id: string) => ({ id, get: mockTaskGet, update: mockTaskUpdate }),
        }
      }
      if (name === 'notifications') {
        return { add: mockNotificationAdd }
      }
      throw new Error(`Unexpected collection: ${name}`)
    })
  })

  it('preserves existing tags when an agent completion payload carries an empty tag snapshot', async () => {
    const { PUT } = await import('@/app/api/v1/tasks/[id]/route')

    const res = await PUT(req({
      agentStatus: 'done',
      status: 'done',
      reviewStatus: 'pending',
      agentOutput: {
        summary: 'Completed CRM shortlist.',
        artifacts: [{ type: 'message-thread', ref: 'pip-20260630-daily-growth-agent-queue' }],
      },
      tags: [],
    }), { params: Promise.resolve({ id: 'task-1' }) })

    expect(res.status).toBe(200)
    expect(mockTaskUpdate).toHaveBeenCalledWith(expect.not.objectContaining({ tags: [] }))
    expect(mockTaskUpdate).toHaveBeenCalledWith(expect.objectContaining({
      agentStatus: 'done',
      status: 'done',
      reviewStatus: 'pending',
      completedAt: 'SERVER_TIMESTAMP',
    }))
  })

  it('still allows an explicit tag-only update to clear tags', async () => {
    const { PUT } = await import('@/app/api/v1/tasks/[id]/route')

    const res = await PUT(req({ tags: [] }), { params: Promise.resolve({ id: 'task-1' }) })

    expect(res.status).toBe(200)
    expect(mockTaskUpdate).toHaveBeenCalledWith(expect.objectContaining({ tags: [] }))
  })
})
