import { NextRequest } from 'next/server'

type MockUser = { uid: string; role: 'admin'; orgId: string; allowedOrgIds?: string[] }
type MockHandler = (req: NextRequest, user: MockUser, ctx?: unknown) => Promise<Response>

const mockCollection = jest.fn()
const mockWhere = jest.fn()
const mockGet = jest.fn()
const mockDoc = jest.fn()
const mockSet = jest.fn()
const mockUpdate = jest.fn()

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: { collection: mockCollection },
}))

jest.mock('@/lib/api/auth', () => ({
  withAuth: (_role: string, handler: MockHandler) => async (req: NextRequest, ctx?: unknown) =>
    handler(req, { uid: 'admin-1', role: 'admin', orgId: 'platform' }, ctx),
}))

jest.mock('firebase-admin/firestore', () => ({
  FieldValue: {
    serverTimestamp: jest.fn(() => 'SERVER_TIMESTAMP'),
  },
}))

beforeEach(() => {
  jest.clearAllMocks()
  const docRef = { id: 'research-1', set: mockSet, update: mockUpdate, get: mockGet, collection: mockCollection }
  const query = { where: mockWhere, get: mockGet }
  mockDoc.mockReturnValue(docRef)
  mockWhere.mockReturnValue(query)
  mockCollection.mockReturnValue({ doc: mockDoc, where: mockWhere, get: mockGet })
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
