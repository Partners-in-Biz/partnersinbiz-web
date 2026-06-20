import { NextRequest } from 'next/server'

const mockGetProjectForUser = jest.fn()
const mockTaskGet = jest.fn()
const mockTaskUpdate = jest.fn()
const mockTaskDoc = jest.fn()
const mockTasksCollection = jest.fn()
const mockProjectDoc = jest.fn()
const mockCollection = jest.fn()
let currentUser = { uid: 'client-1', role: 'client', authKind: 'session' }

jest.mock('firebase-admin/firestore', () => ({
  FieldValue: {
    serverTimestamp: jest.fn(() => 'SERVER_TIMESTAMP'),
  },
}))

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: { collection: mockCollection },
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
  currentUser = { uid: 'client-1', role: 'client', authKind: 'session' }
  mockGetProjectForUser.mockResolvedValue({
    ok: true,
    doc: { data: () => ({ orgId: 'org-1' }) },
    projectAccess: { role: 'member' },
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
  mockTaskDoc.mockReturnValue({ get: mockTaskGet, update: mockTaskUpdate })
  mockTasksCollection.mockReturnValue({ doc: mockTaskDoc })
  mockProjectDoc.mockReturnValue({ collection: mockTasksCollection, get: jest.fn(async () => ({ data: () => ({ orgId: 'org-1' }) })) })
  mockCollection.mockImplementation((name: string) => {
    if (name === 'projects') return { doc: mockProjectDoc }
    if (name === 'notifications') return { add: jest.fn() }
    throw new Error(`Unexpected collection ${name}`)
  })
})

describe('project task approval gate route guards', () => {
  it('blocks non-admin users from changing approval-gate metadata on gated tasks', async () => {
    const { PATCH } = await import('@/app/api/v1/projects/[projectId]/tasks/[taskId]/route')
    const res = await PATCH(req({ approvalGate: 'none' }), ctx)
    const body = await res.json()

    expect(res.status).toBe(403)
    expect(body.error).toMatch(/Only an admin approver/)
    expect(mockTaskUpdate).not.toHaveBeenCalled()
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
