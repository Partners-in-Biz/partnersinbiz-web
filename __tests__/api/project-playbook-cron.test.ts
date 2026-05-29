import { NextRequest } from 'next/server'

const mockCollectionGroup = jest.fn()
const mockCollection = jest.fn()
const mockPlaybookWhere = jest.fn()
const mockPlaybookLimit = jest.fn()
const mockPlaybookGet = jest.fn()
const mockProjectDoc = jest.fn()
const mockProjectGet = jest.fn()
const mockProjectCollection = jest.fn()
const mockTaskAdd = jest.fn()
const mockPlaybookDoc = jest.fn()
const mockPlaybookUpdate = jest.fn()
const mockAuditAdd = jest.fn()

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: {
    collection: mockCollection,
    collectionGroup: mockCollectionGroup,
  },
}))

jest.mock('firebase-admin/firestore', () => ({
  FieldValue: {
    serverTimestamp: jest.fn(() => 'SERVER_TIMESTAMP'),
  },
}))

beforeEach(() => {
  jest.clearAllMocks()
  jest.useFakeTimers()
  jest.setSystemTime(new Date('2026-05-02T12:00:00.000Z'))
  process.env.CRON_SECRET = 'cron-secret'

  const projectRef = { id: 'project-1' }
  mockPlaybookGet.mockResolvedValue({
    docs: [{
      id: 'playbook-1',
      data: () => ({
        title: 'Weekly delivery rhythm',
        status: 'active',
        autoCreateTasks: true,
        nextRunAt: '2026-05-01',
        recurrenceRule: 'FREQ=WEEKLY;INTERVAL=1',
        templateSteps: ['Kickoff', 'QA'],
        runCount: 2,
      }),
      ref: { parent: { parent: projectRef } },
    }],
  })
  mockPlaybookLimit.mockReturnValue({ get: mockPlaybookGet })
  mockPlaybookWhere.mockReturnValue({ limit: mockPlaybookLimit })
  mockCollectionGroup.mockReturnValue({ where: mockPlaybookWhere })

  mockProjectGet.mockResolvedValue({
    exists: true,
    data: () => ({ id: 'project-1', orgId: 'owner-org', ownerOrgId: 'owner-org' }),
  })
  mockTaskAdd.mockResolvedValueOnce({ id: 'task-1' }).mockResolvedValueOnce({ id: 'task-2' })
  mockPlaybookUpdate.mockResolvedValue(undefined)
  mockAuditAdd.mockResolvedValue({ id: 'audit-1' })
  mockPlaybookDoc.mockReturnValue({ update: mockPlaybookUpdate })
  mockProjectCollection.mockImplementation((name: string) => {
    if (name === 'tasks') return { add: mockTaskAdd }
    if (name === 'playbooks') return { doc: mockPlaybookDoc }
    if (name === 'audit') return { add: mockAuditAdd }
    throw new Error(`Unexpected project subcollection ${name}`)
  })
  mockProjectDoc.mockReturnValue({ get: mockProjectGet, collection: mockProjectCollection })
  mockCollection.mockImplementation((name: string) => {
    if (name === 'projects') return { doc: mockProjectDoc }
    throw new Error(`Unexpected collection ${name}`)
  })
})

afterEach(() => {
  jest.useRealTimers()
})

describe('GET /api/cron/project-playbooks', () => {
  it('runs due auto-create playbooks and advances their next run date', async () => {
    const { GET } = await import('@/app/api/cron/project-playbooks/route')
    const res = await GET(new NextRequest('http://localhost/api/cron/project-playbooks', {
      headers: { authorization: 'Bearer cron-secret' },
    }))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(mockCollectionGroup).toHaveBeenCalledWith('playbooks')
    expect(mockPlaybookWhere).toHaveBeenCalledWith('autoCreateTasks', '==', true)
    expect(mockProjectDoc).toHaveBeenCalledWith('project-1')
    expect(mockTaskAdd).toHaveBeenCalledTimes(2)
    expect(mockTaskAdd).toHaveBeenNthCalledWith(1, expect.objectContaining({
      title: 'Kickoff',
      projectId: 'project-1',
      orgId: 'owner-org',
      sourcePlaybookId: 'playbook-1',
      sourcePlaybookTitle: 'Weekly delivery rhythm',
      createdBy: 'cron',
    }))
    expect(mockPlaybookUpdate).toHaveBeenCalledWith(expect.objectContaining({
      lastRunBy: 'cron',
      lastRunTaskIds: ['task-1', 'task-2'],
      runCount: 3,
      nextRunAt: '2026-05-08',
    }))
    expect(mockAuditAdd).toHaveBeenCalledWith(expect.objectContaining({
      eventType: 'playbook_run',
      itemType: 'playbook',
      itemId: 'playbook-1',
      actorUid: 'cron',
      taskCount: 2,
      createdTaskIds: ['task-1', 'task-2'],
    }))
    expect(body.data).toEqual(expect.objectContaining({
      scanned: 1,
      processed: 1,
      createdTasks: 2,
    }))
    expect(body.data.results[0]).toEqual(expect.objectContaining({
      projectId: 'project-1',
      playbookId: 'playbook-1',
      ok: true,
      taskCount: 2,
      nextRunAt: '2026-05-08',
    }))
  })

  it('rejects unauthenticated cron requests', async () => {
    const { GET } = await import('@/app/api/cron/project-playbooks/route')
    const res = await GET(new NextRequest('http://localhost/api/cron/project-playbooks'))

    expect(res.status).toBe(401)
    expect(mockCollectionGroup).not.toHaveBeenCalled()
  })
})
