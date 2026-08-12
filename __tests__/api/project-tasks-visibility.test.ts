import { NextRequest } from 'next/server'

const mockGetProjectForUser = jest.fn()
const mockProjectDoc = jest.fn()
const mockTaskCollection = jest.fn()
const mockTaskGet = jest.fn()
const mockCollection = jest.fn()
const mockReadModelDoc = jest.fn()
const mockReadModelGet = jest.fn()
const mockReadModelSet = jest.fn()

let canViewInternal = false
let mockUser = { uid: 'external-user', role: 'client' as const, orgId: 'external-org' }

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
  canViewInternal = false
  mockUser = { uid: 'external-user', role: 'client', orgId: 'external-org' }
  mockGetProjectForUser.mockImplementation(async () => ({
    ok: true,
    doc: {
      id: 'project-1',
      data: () => ({ id: 'project-1', orgId: 'owner-org', ownerOrgId: 'owner-org' }),
    },
    projectAccess: { role: 'contributor', source: 'project_organization', canViewInternal },
  }))
  mockTaskGet.mockResolvedValue({
    docs: [
      { id: 'public-task', data: () => ({ title: 'Shared task', order: 1 }) },
      { id: 'internal-task', data: () => ({ title: 'Internal task', internalOnly: true, order: 2 }) },
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

describe('project task visibility', () => {
  it('hides internal-only tasks from external project collaborators', async () => {
    const { GET } = await import('@/app/api/v1/projects/[projectId]/tasks/route')
    const res = await GET(new NextRequest('http://localhost/api/v1/projects/project-1/tasks'), {
      params: Promise.resolve({ projectId: 'project-1' }),
    })
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.data.map((task: { id: string }) => task.id)).toEqual(['public-task'])
  })

  it('shows internal-only tasks to project owner-org collaborators', async () => {
    canViewInternal = true
    const { GET } = await import('@/app/api/v1/projects/[projectId]/tasks/route')
    const res = await GET(new NextRequest('http://localhost/api/v1/projects/project-1/tasks'), {
      params: Promise.resolve({ projectId: 'project-1' }),
    })
    const body = await res.json()

    expect(body.data.map((task: { id: string }) => task.id)).toEqual(['public-task', 'internal-task'])
  })

  it('serves board cards from the compact read model without scanning all tasks', async () => {
    mockReadModelGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({
        schemaVersion: 1,
        tasks: [{ id: 'public-task', title: 'Shared task', order: 1, description: undefined }],
      }),
    })
    const { GET } = await import('@/app/api/v1/projects/[projectId]/tasks/route')
    const res = await GET(new NextRequest('http://localhost/api/v1/projects/project-1/tasks?view=board'), {
      params: Promise.resolve({ projectId: 'project-1' }),
    })
    const body = await res.json()

    expect(body.data).toEqual([{ id: 'public-task', title: 'Shared task', order: 1 }])
    expect(mockTaskGet).not.toHaveBeenCalled()
  })
})
