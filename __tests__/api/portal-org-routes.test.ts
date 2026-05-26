import { NextRequest } from 'next/server'

const mockUserGet = jest.fn()
const mockUserDoc = jest.fn()
const mockOrgDoc = jest.fn()
const mockCollection = jest.fn()
const mockResolvePortalActiveOrgId = jest.fn()
const mockGetPortalOrgIdsForUser = jest.fn()
const mockChoosePortalActiveOrgId = jest.fn()

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: { collection: mockCollection },
}))

jest.mock('@/lib/auth/portal-middleware', () => ({
  withPortalAuth:
    (handler: (req: NextRequest, uid: string) => Promise<Response>) =>
      (req: NextRequest) => handler(req, 'admin-1'),
}))

jest.mock('@/lib/portal/org-access', () => ({
  resolvePortalActiveOrgId: mockResolvePortalActiveOrgId,
  getPortalOrgIdsForUser: mockGetPortalOrgIdsForUser,
  choosePortalActiveOrgId: mockChoosePortalActiveOrgId,
}))

beforeEach(() => {
  jest.clearAllMocks()
  mockUserDoc.mockReturnValue({ get: mockUserGet })
  mockCollection.mockImplementation((name: string) => {
    if (name === 'users') return { doc: mockUserDoc }
    if (name === 'organizations') return { doc: mockOrgDoc }
    throw new Error(`Unexpected collection: ${name}`)
  })
})

describe('portal org routes', () => {
  it('returns the active portal org slug for admin view switching', async () => {
    mockResolvePortalActiveOrgId.mockResolvedValue('client-org')
    mockUserGet.mockResolvedValue({
      exists: true,
      data: () => ({ role: 'admin', orgId: 'pib-platform-owner' }),
    })
    mockOrgDoc.mockReturnValue({
      get: async () => ({
        exists: true,
        data: () => ({
          name: 'Client Org',
          slug: 'client-org',
          logoUrl: '/logo.png',
        }),
      }),
    })

    const { GET } = await import('@/app/api/v1/portal/org/route')
    const res = await GET(new NextRequest('http://localhost/api/v1/portal/org'))

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toMatchObject({
      org: { id: 'client-org', name: 'Client Org', slug: 'client-org' },
      user: { uid: 'admin-1', role: 'admin' },
    })
  })

  it('returns slugs for all portal org switcher options', async () => {
    mockUserGet.mockResolvedValue({
      exists: true,
      data: () => ({ role: 'admin', activeOrgId: 'client-b' }),
    })
    mockGetPortalOrgIdsForUser.mockResolvedValue(['client-a', 'client-b'])
    mockChoosePortalActiveOrgId.mockReturnValue('client-b')
    mockOrgDoc.mockImplementation((id: string) => ({
      get: async () => ({
        exists: true,
        id,
        data: () => ({
          name: id === 'client-a' ? 'Client A' : 'Client B',
          slug: id === 'client-a' ? 'client-a' : 'client-b',
          logoUrl: '',
        }),
      }),
    }))

    const { GET } = await import('@/app/api/v1/portal/orgs/route')
    const res = await GET(new NextRequest('http://localhost/api/v1/portal/orgs'))

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({
      activeOrgId: 'client-b',
      orgs: [
        { id: 'client-a', name: 'Client A', slug: 'client-a', logoUrl: '' },
        { id: 'client-b', name: 'Client B', slug: 'client-b', logoUrl: '' },
      ],
    })
  })
})
