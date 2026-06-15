import { NextRequest } from 'next/server'

type MockUser = { uid: string; role: 'admin' | 'client' | 'ai'; orgId?: string; orgIds?: string[]; allowedOrgIds?: string[] }
type MockHandler = (req: NextRequest, user: MockUser, ctx?: unknown) => Promise<Response>

const mockCollection = jest.fn()
const mockWhere = jest.fn()
const mockGet = jest.fn()
const mockDoc = jest.fn()
const mockSet = jest.fn()
const mockUpdate = jest.fn()
let mockUser: MockUser = { uid: 'admin-1', role: 'admin', orgId: 'platform' }
let organizationSettings: Record<string, unknown>
let organizationMembers: Array<Record<string, unknown>>
let orgMemberRoles: Record<string, string>

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: { collection: mockCollection },
}))

jest.mock('@/lib/api/auth', () => ({
  withAuth: (requiredRole: 'admin' | 'client', handler: MockHandler) => async (req: NextRequest, ctx?: unknown) => {
    const roleOk =
      mockUser.role === 'ai' ||
      mockUser.role === 'admin' ||
      (requiredRole === 'client' && mockUser.role === 'client')
    if (!roleOk) {
      return new Response(JSON.stringify({ success: false, error: 'Forbidden' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      })
    }
    return handler(req, mockUser, ctx)
  },
}))

jest.mock('firebase-admin/firestore', () => ({
  FieldValue: {
    serverTimestamp: jest.fn(() => 'SERVER_TIMESTAMP'),
  },
}))

beforeEach(() => {
  mockUser = { uid: 'admin-1', role: 'admin', orgId: 'platform' }
  organizationSettings = {}
  organizationMembers = [{ userId: 'client-1', role: 'member' }]
  orgMemberRoles = {}
  jest.clearAllMocks()
  const docRef = { id: 'research-1', set: mockSet, update: mockUpdate, get: mockGet, collection: mockCollection }
  const query = { where: mockWhere, get: mockGet }
  mockDoc.mockReturnValue(docRef)
  mockWhere.mockReturnValue(query)
  mockCollection.mockImplementation((name: string) => {
    if (name === 'organizations') {
      return {
        doc: jest.fn((id: string) => ({
          id,
          get: jest.fn().mockResolvedValue({
            exists: true,
            id,
            data: () => ({
              id,
              members: organizationMembers,
              settings: organizationSettings,
            }),
          }),
        })),
      }
    }

    if (name === 'orgMembers') {
      return {
        doc: jest.fn((id: string) => ({
          id,
          get: jest.fn().mockResolvedValue(
            orgMemberRoles[id]
              ? { exists: true, id, data: () => ({ role: orgMemberRoles[id] }) }
              : { exists: false, id, data: () => undefined },
          ),
        })),
      }
    }

    return { doc: mockDoc, where: mockWhere, get: mockGet }
  })
})

describe('research API', () => {
  it('creates structured research scoped to an org', async () => {
    const { POST } = await import('@/app/api/v1/research/route')
    const req = new NextRequest('http://localhost/api/v1/research', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        orgId: 'org-1',
        title: 'Competitor audit',
        kind: 'competitor',
        visibility: 'client_visible',
        summary: 'Summary',
      }),
    })

    const res = await POST(req)

    expect(res.status).toBe(201)
    expect(mockSet).toHaveBeenCalledWith(expect.objectContaining({
      orgId: 'org-1',
      title: 'Competitor audit',
      kind: 'competitor',
      visibility: 'client_visible',
    }))
  })

  it('allows client org members to create research when the organisation policy permits it', async () => {
    mockUser = { uid: 'client-1', role: 'client', orgId: 'org-1', orgIds: ['org-1'] }
    organizationSettings = {
      modulePolicies: {
        research: {
          actions: {
            create: { owner: true, admin: true, member: true },
          },
        },
      },
    }
    const { POST } = await import('@/app/api/v1/research/route')
    const req = new NextRequest('http://localhost/api/v1/research', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        orgId: 'org-1',
        title: 'Client research note',
        kind: 'market',
        visibility: 'internal',
      }),
    })

    const res = await POST(req)

    expect(res.status).toBe(201)
    expect(mockSet).toHaveBeenCalledWith(expect.objectContaining({
      orgId: 'org-1',
      title: 'Client research note',
    }))
  })

  it('lists research using tenant-only query filters and in-memory search', async () => {
    mockGet.mockResolvedValue({
      docs: [
        { id: 'r1', data: () => ({ orgId: 'org-1', title: 'Competitor audit', kind: 'competitor', status: 'draft', visibility: 'client_visible', deleted: false }) },
        { id: 'r2', data: () => ({ orgId: 'org-1', title: 'Old audit', kind: 'seo', status: 'draft', visibility: 'internal', deleted: false }) },
      ],
    })

    const { GET } = await import('@/app/api/v1/research/route')
    const req = new NextRequest('http://localhost/api/v1/research?orgId=org-1&q=competitor')

    const res = await GET(req)
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(mockWhere).toHaveBeenCalledWith('orgId', '==', 'org-1')
    expect(body.data).toHaveLength(1)
    expect(body.data[0].id).toBe('r1')
  })
})
