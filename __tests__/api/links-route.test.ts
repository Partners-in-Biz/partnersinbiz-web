import { NextRequest } from 'next/server'

type MockUser = { uid: string; role: 'client'; orgId: string }
type MockHandler = (req: NextRequest, user: MockUser, orgId: string) => Promise<Response>

const mockCollection = jest.fn()
const mockWhere = jest.fn()
const mockOrderBy = jest.fn()
const mockGet = jest.fn()

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: { collection: mockCollection },
}))

jest.mock('@/lib/api/auth', () => ({
  withAuth: (_role: string, handler: (req: NextRequest, user: MockUser) => Promise<Response>) =>
    (req: NextRequest) => handler(req, { uid: 'client-1', role: 'client', orgId: 'org-1' }),
}))

jest.mock('@/lib/api/tenant', () => ({
  withTenant: (handler: MockHandler) =>
    (req: NextRequest, user: MockUser) => handler(req, user, 'org-1'),
}))

function linkDoc(id: string, data: Record<string, unknown>) {
  return { id, data: () => data }
}

describe('GET /api/v1/links', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    const query = { where: mockWhere, orderBy: mockOrderBy, get: mockGet }
    mockWhere.mockReturnValue(query)
    mockCollection.mockReturnValue(query)
    mockOrderBy.mockImplementation(() => {
      throw new Error('The query requires an index')
    })
  })

  it('lists tracked links without a composite-index orderBy query', async () => {
    mockGet.mockResolvedValue({
      size: 3,
      docs: [
        linkDoc('oldest', {
          orgId: 'org-1',
          propertyId: 'property-1',
          shortCode: 'old',
          createdAt: { seconds: 100 },
        }),
        linkDoc('newest', {
          orgId: 'org-1',
          propertyId: 'property-1',
          shortCode: 'new',
          createdAt: { seconds: 300 },
        }),
        linkDoc('middle', {
          orgId: 'org-1',
          propertyId: 'property-1',
          shortCode: 'mid',
          createdAt: { seconds: 200 },
        }),
      ],
    })

    const { GET } = await import('@/app/api/v1/links/route')
    const res = await GET(new NextRequest('http://localhost/api/v1/links?page=1&limit=2&propertyId=property-1'))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(mockWhere).toHaveBeenCalledWith('orgId', '==', 'org-1')
    expect(mockWhere).toHaveBeenCalledWith('propertyId', '==', 'property-1')
    expect(mockOrderBy).not.toHaveBeenCalled()
    expect(body.data.map((item: { id: string }) => item.id)).toEqual(['newest', 'middle'])
    expect(body.meta).toEqual(expect.objectContaining({ total: 3, page: 1, limit: 2 }))
  })
})
