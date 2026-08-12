import { NextRequest } from 'next/server'

const mockCollection = jest.fn()
const mockWhere = jest.fn()
const mockLimit = jest.fn()
const mockGet = jest.fn()

const user = { uid: 'user-1', role: 'client' as const }

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: { collection: mockCollection },
}))

jest.mock('@/lib/api/auth', () => ({
  withAuth: (_role: string, handler: any) => async (req: NextRequest) => handler(req, user),
}))

jest.mock('@/lib/api/tenant', () => ({
  withTenant: (handler: any) => async (req: NextRequest, actor: typeof user) => handler(req, actor, 'org-1'),
}))

jest.mock('@/lib/social/audit', () => ({
  logAudit: jest.fn(),
}))

beforeEach(() => {
  jest.clearAllMocks()
  const query = {
    where: mockWhere,
    limit: mockLimit,
    get: mockGet,
  }
  mockWhere.mockReturnValue(query)
  mockLimit.mockReturnValue(query)
  mockGet.mockResolvedValue({
    docs: [
      { id: 'org-page', data: () => ({ orgId: 'org-1', displayName: 'Facebook PIB', platform: 'facebook', accountType: 'page', status: 'active' }) },
      { id: 'org-account', data: () => ({ orgId: 'org-1', displayName: 'Org LinkedIn', platform: 'linkedin', status: 'active' }) },
      { id: 'peet-twin', data: () => ({ orgId: 'org-1', displayName: 'Peet Stander', platform: 'twitter', accountType: 'personal', status: 'active' }) },
      { id: 'personal-account', data: () => ({ orgId: 'org-1', displayName: 'Personal X', platform: 'x', status: 'active', accountScope: 'personal', ownerUid: 'user-1' }) },
      { id: 'brand-bluesky', data: () => ({ orgId: 'org-1', displayName: 'partnersinbiz', platform: 'bluesky', status: 'active' }) },
    ],
  })
  mockCollection.mockImplementation((name: string) => {
    if (name === 'social_accounts') return query
    throw new Error(`Unexpected collection ${name}`)
  })
})

describe('GET /api/v1/social/accounts', () => {
  it('bounds org account reads before filtering legacy accountScope rows', async () => {
    const { GET } = await import('@/app/api/v1/social/accounts/route')
    const res = await GET(new NextRequest('http://localhost/api/v1/social/accounts?limit=10&page=2'))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(mockWhere).toHaveBeenCalledWith('orgId', '==', 'org-1')
    expect(mockLimit).toHaveBeenCalledWith(21)
    expect(body.data).toEqual([])
    expect(body.meta).toEqual(expect.objectContaining({ page: 2, limit: 10, hasMore: false }))
  })

  it('uses indexed owner scope for personal social accounts', async () => {
    const { GET } = await import('@/app/api/v1/social/accounts/route')
    const res = await GET(new NextRequest('http://localhost/api/v1/social/accounts?scope=personal&limit=5'))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(mockWhere).toHaveBeenCalledWith('accountScope', '==', 'personal')
    expect(mockWhere).toHaveBeenCalledWith('ownerUid', '==', 'user-1')
    expect(mockLimit).toHaveBeenCalledWith(6)
    expect(body.data.map((account: { id: string }) => account.id)).toEqual(['personal-account'])
  })

  it('lists only company-linked accounts on the org social surface', async () => {
    const { GET } = await import('@/app/api/v1/social/accounts/route')
    const res = await GET(new NextRequest('http://localhost/api/v1/social/accounts?limit=10&page=1'))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.data.map((account: { id: string }) => account.id)).toEqual(['org-page', 'brand-bluesky'])
  })
})
