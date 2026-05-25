import { NextRequest } from 'next/server'

type MockUser = { uid: string; role: 'admin' | 'client' | 'ai'; orgId?: string; orgIds?: string[]; agentId?: string }
type MockHandler = (req: NextRequest, user: MockUser, ctx?: unknown) => Promise<Response>

let mockUser: MockUser = { uid: 'admin-1', role: 'admin' }
const mockAdd = jest.fn()
const mockGet = jest.fn()
const mockWhere = jest.fn()
const mockDoc = jest.fn()
const mockUpdate = jest.fn()
const mockCollection = jest.fn()
const mockServerTimestamp = jest.fn(() => 'SERVER_TIMESTAMP')

jest.mock('@/lib/firebase/admin', () => ({ adminDb: { collection: mockCollection } }))
jest.mock('@/lib/api/auth', () => ({
  withAuth: (_role: string, handler: MockHandler) => async (req: NextRequest, ctx?: unknown) => handler(req, mockUser, ctx),
}))
jest.mock('firebase-admin/firestore', () => ({ FieldValue: { serverTimestamp: mockServerTimestamp } }))
jest.mock('@/lib/activity/log', () => ({ logActivity: jest.fn(() => Promise.resolve()) }))

beforeEach(() => {
  jest.clearAllMocks()
  mockUser = { uid: 'admin-1', role: 'admin' }
  const query = { where: mockWhere, get: mockGet }
  mockWhere.mockReturnValue(query)
  mockDoc.mockReturnValue({ get: mockGet, update: mockUpdate })
  mockCollection.mockImplementation((name: string) => {
    if (name !== 'workspace_folders') throw new Error(`Unexpected collection: ${name}`)
    return { add: mockAdd, where: mockWhere, get: mockGet, doc: mockDoc }
  })
})

describe('workspace folder CRUD routes', () => {
  it('creates tenant-scoped folder mappings with many linked resources', async () => {
    mockAdd.mockResolvedValue({ id: 'folder-1' })
    const { POST } = await import('@/app/api/v1/workspace-folders/route')
    const req = new NextRequest('http://localhost/api/v1/workspace-folders', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ orgId: 'org-1', name: 'Admin Assets', resourceType: 'project', resourceId: 'proj-1', visibility: 'admin_agents', driveFolderId: 'drive-1' }),
    })

    const res = await POST(req)

    expect(res.status).toBe(201)
    expect(mockAdd).toHaveBeenCalledWith(expect.objectContaining({
      orgId: 'org-1',
      name: 'Admin Assets',
      resourceType: 'project',
      resourceId: 'proj-1',
      visibility: 'admin_agents',
      drive: { folderId: 'drive-1', folderUrl: null },
      createdAt: 'SERVER_TIMESTAMP',
      updatedAt: 'SERVER_TIMESTAMP',
    }))
  })

  it('lists only the requested org and filters out folders hidden from clients', async () => {
    mockUser = { uid: 'client-1', role: 'client', orgId: 'org-1' }
    mockGet.mockResolvedValue({ docs: [
      { id: 'shared', data: () => ({ orgId: 'org-1', name: 'Shared', visibility: 'admin_agents_clients', permissions: { allowedAgentIds: [] }, tags: [], sortOrder: 2, deleted: false }) },
      { id: 'agent', data: () => ({ orgId: 'org-1', name: 'Agent', visibility: 'admin_agents', permissions: { allowedAgentIds: [] }, tags: [], sortOrder: 1, deleted: false }) },
    ] })
    const { GET } = await import('@/app/api/v1/workspace-folders/route')
    const res = await GET(new NextRequest('http://localhost/api/v1/workspace-folders?orgId=org-1'))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(mockWhere).toHaveBeenCalledWith('orgId', '==', 'org-1')
    expect(body.data.map((item: { id: string }) => item.id)).toEqual(['shared'])
  })

  it('rejects updates when the existing folder belongs to another org', async () => {
    mockGet.mockResolvedValue({ exists: true, id: 'folder-1', data: () => ({ orgId: 'org-2', name: 'Other', deleted: false }) })
    const { PATCH } = await import('@/app/api/v1/workspace-folders/[id]/route')
    const req = new NextRequest('http://localhost/api/v1/workspace-folders/folder-1?orgId=org-1', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Renamed' }),
    })
    const res = await PATCH(req, { params: Promise.resolve({ id: 'folder-1' }) })

    expect(res.status).toBe(403)
    expect(mockUpdate).not.toHaveBeenCalled()
  })
})

describe('stable agent workspace folder lookup', () => {
  it('returns agent-readable folders for a resource sorted by sort order', async () => {
    mockUser = { uid: 'agent:theo', role: 'ai', agentId: 'theo' }
    mockGet.mockResolvedValue({ docs: [
      { id: 'client', data: () => ({ orgId: 'org-1', name: 'Client', resourceType: 'project', resourceId: 'proj-1', visibility: 'admin_agents_clients', permissions: { allowedAgentIds: [] }, tags: ['assets'], sortOrder: 20, deleted: false }) },
      { id: 'private', data: () => ({ orgId: 'org-1', name: 'Private', resourceType: 'project', resourceId: 'proj-1', visibility: 'admin_only', permissions: { allowedAgentIds: [] }, tags: ['assets'], sortOrder: 10, deleted: false }) },
      { id: 'other', data: () => ({ orgId: 'org-1', name: 'Other', resourceType: 'project', resourceId: 'proj-2', visibility: 'admin_agents', permissions: { allowedAgentIds: [] }, tags: ['assets'], sortOrder: 1, deleted: false }) },
    ] })
    const { GET } = await import('@/app/api/v1/agent/workspace-folders/route')
    const res = await GET(new NextRequest('http://localhost/api/v1/agent/workspace-folders?orgId=org-1&resourceType=project&resourceId=proj-1&tag=assets'))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.data.folders.map((item: { id: string }) => item.id)).toEqual(['client'])
    expect(body.data.lookup).toEqual({ orgId: 'org-1', resourceType: 'project', resourceId: 'proj-1', parentId: null, tag: 'assets' })
  })
})
