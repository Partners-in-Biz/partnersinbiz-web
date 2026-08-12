import { NextRequest } from 'next/server'

const mockGetProjectForUser = jest.fn()
const mockCollection = jest.fn()
const mockProjectDoc = jest.fn()
const mockTaskCollection = jest.fn()
const mockTaskGet = jest.fn()
const mockReadModelDoc = jest.fn()
const mockReadModelGet = jest.fn()
const mockReadModelSet = jest.fn()

const mockUser = { uid: 'client-1', role: 'client' as const, orgId: 'client-org' }

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

beforeEach(() => {
  jest.clearAllMocks()
  mockGetProjectForUser.mockResolvedValue({
    ok: true,
    doc: {
      id: 'project-1',
      data: () => ({ name: 'Email Marketing V2', status: 'active', orgId: 'owner-org' }),
    },
    projectAccess: { role: 'contributor', source: 'project_organization', canViewInternal: false },
  })
  mockTaskGet.mockResolvedValue({
    docs: [
      { id: 'done', data: () => ({ title: 'Draft copy', columnId: 'review', agentStatus: 'done', assigneeAgentId: 'maya' }) },
      { id: 'ready', data: () => ({ title: 'Run QA', columnId: 'todo', agentStatus: 'pending', dependsOn: ['done'] }) },
      { id: 'internal', data: () => ({ title: 'Internal note', columnId: 'todo', internalOnly: true }) },
    ],
  })
  mockTaskCollection.mockReturnValue({ get: mockTaskGet })
  mockReadModelGet.mockResolvedValue({ exists: false, data: () => undefined })
  mockReadModelSet.mockResolvedValue(undefined)
  mockReadModelDoc.mockReturnValue({ get: mockReadModelGet, set: mockReadModelSet })
  mockProjectDoc.mockImplementation(() => ({
    collection: (name: string) => {
      if (name === 'tasks') return mockTaskCollection()
      if (name === '_readModels') return { doc: mockReadModelDoc }
      throw new Error(`Unexpected project subcollection ${name}`)
    },
  }))
  mockCollection.mockImplementation((name: string) => {
    if (name === 'projects') return { doc: mockProjectDoc }
    throw new Error(`Unexpected collection ${name}`)
  })
})

describe('project chat progress API', () => {
  it('returns a visibility-filtered progress read model', async () => {
    const { GET } = await import('@/app/api/v1/projects/[projectId]/chat-progress/route')
    const res = await GET(new NextRequest('http://localhost/api/v1/projects/project-1/chat-progress'), {
      params: Promise.resolve({ projectId: 'project-1' }),
    })
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.data.project).toEqual({ id: 'project-1', name: 'Email Marketing V2', status: 'active' })
    expect(body.data.counts).toMatchObject({ total: 2, complete: 1 })
    expect(body.data.tasks.map((task: { id: string }) => task.id)).toEqual(['done', 'ready'])
    expect(body.data.next).toMatchObject({ id: 'ready', state: 'ready' })
    expect(body.data.asOf).toEqual(expect.any(String))
    expect(mockReadModelSet).toHaveBeenCalledWith(expect.objectContaining({ schemaVersion: 1, tasks: expect.any(Array) }))
  })

  it('returns the project access failure without reading tasks', async () => {
    mockGetProjectForUser.mockResolvedValueOnce({ ok: false, error: 'Forbidden', status: 403 })
    const { GET } = await import('@/app/api/v1/projects/[projectId]/chat-progress/route')
    const res = await GET(new NextRequest('http://localhost/api/v1/projects/project-1/chat-progress'), {
      params: Promise.resolve({ projectId: 'project-1' }),
    })

    expect(res.status).toBe(403)
    expect(mockTaskGet).not.toHaveBeenCalled()
  })

  it('uses the compact task model when one is available', async () => {
    mockReadModelGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({
        schemaVersion: 1,
        tasks: [
          { id: 'done', title: 'Draft copy', columnId: 'review', agentStatus: 'done', assigneeAgentId: 'maya' },
          { id: 'ready', title: 'Run QA', columnId: 'todo', agentStatus: 'pending', dependsOn: ['done'] },
          { id: 'internal', title: 'Internal note', columnId: 'todo', internalOnly: true },
        ],
      }),
    })
    const { GET } = await import('@/app/api/v1/projects/[projectId]/chat-progress/route')
    const res = await GET(new NextRequest('http://localhost/api/v1/projects/project-1/chat-progress'), {
      params: Promise.resolve({ projectId: 'project-1' }),
    })
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.data.tasks.map((task: { id: string }) => task.id)).toEqual(['done', 'ready'])
    expect(mockTaskGet).not.toHaveBeenCalled()
  })
})
