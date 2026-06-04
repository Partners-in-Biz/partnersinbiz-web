const mockVerifySessionCookie = jest.fn()
const mockCookies = jest.fn()
const mockUserDoc = jest.fn()
const mockCollection = jest.fn()
const mockGetBrandKitForOrg = jest.fn()
const mockCanUsePortalOrg = jest.fn()
const mockListAdCampaigns = jest.fn()
const whereCalls: Array<[string, string, unknown]> = []

jest.mock('next/headers', () => ({
  cookies: () => mockCookies(),
}))

jest.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw new Error(`redirect:${url}`)
  },
  notFound: () => {
    throw new Error('notFound')
  },
}))

jest.mock('@/lib/firebase/admin', () => ({
  adminAuth: { verifySessionCookie: mockVerifySessionCookie },
  adminDb: { collection: mockCollection },
}))

jest.mock('@/lib/brand-kit/store', () => ({
  getBrandKitForOrg: (...args: unknown[]) => mockGetBrandKitForOrg(...args),
}))

jest.mock('@/lib/campaigns/serialize', () => ({
  serializeForClient: (value: unknown) => value,
}))

jest.mock('@/lib/ads/campaigns/store', () => ({
  listCampaigns: (...args: unknown[]) => mockListAdCampaigns(...args),
}))

jest.mock('@/app/(portal)/portal/campaigns/CampaignRequestPanel', () => ({
  CampaignRequestPanel: () => null,
}))

jest.mock('@/components/campaigns/CampaignProgramCard', () => ({
  CampaignProgramCard: ({ campaign, href }: { campaign: { name?: string }; href: string }) => (
    <a href={href}>{campaign.name}</a>
  ),
}))

function queryCollection(name: string) {
  const chain = {
    where(field: string, op: string, value: unknown) {
      whereCalls.push([field, op, value])
      return chain
    },
    limit() {
      return chain
    },
    async get() {
      return {
        docs:
          name === 'campaigns'
            ? [
                {
                  id: 'lumen-campaign',
                  data: () => ({
                    orgId: 'lumen-org',
                    name: 'Lumen launch',
                    status: 'active',
                    clientType: 'retainer',
                    createdAt: '2026-06-01T00:00:00.000Z',
                    deleted: false,
                  }),
                },
              ]
            : name === 'campaign_requests'
              ? [
                  {
                    id: 'request-1',
                    data: () => ({
                      orgId: 'lumen-org',
                      title: 'Lumen ad launch',
                      status: 'new',
                      deleted: false,
                      createdAt: '2026-06-02T00:00:00.000Z',
                    }),
                  },
                ]
              : [],
      }
    },
  }
  return chain
}

describe('portal campaigns org scope', () => {
  beforeEach(() => {
    jest.resetModules()
    whereCalls.length = 0
    jest.clearAllMocks()
    mockVerifySessionCookie.mockResolvedValue({ uid: 'admin-1' })
    mockCookies.mockResolvedValue({ get: () => ({ value: 'session' }) })
    mockUserDoc.mockReturnValue({
      get: async () => ({
        exists: true,
        data: () => ({ role: 'admin', orgId: 'platform-org' }),
      }),
    })
    mockCanUsePortalOrg.mockResolvedValue(true)
    mockListAdCampaigns.mockResolvedValue([
      {
        id: 'ad-campaign-1',
        orgId: 'lumen-org',
        name: 'Lumen paid launch',
        status: 'PENDING_REVIEW',
        objective: 'LEADS',
      },
    ])
    mockGetBrandKitForOrg.mockResolvedValue({
      primaryColor: '#111111',
      secondaryColor: '#222222',
      accentColor: '#F5A623',
    })
    mockCollection.mockImplementation((name: string) => {
      if (name === 'users') return { doc: mockUserDoc }
      return queryCollection(name)
    })
  })

  it('queries campaigns and brand assets for the requested company workspace org', async () => {
    jest.doMock('@/lib/portal/org-access', () => ({
      canUsePortalOrg: mockCanUsePortalOrg,
    }))
    const Page = (await import('@/app/(portal)/portal/campaigns/page')).default

    await Page({
      searchParams: Promise.resolve({ orgId: 'lumen-org', orgSlug: 'lumen-speeds' }),
    } as never)

    expect(mockCanUsePortalOrg).toHaveBeenCalledWith('admin-1', expect.objectContaining({ orgId: 'platform-org' }), 'lumen-org')
    expect(mockGetBrandKitForOrg).toHaveBeenCalledWith('lumen-org')
    expect(mockListAdCampaigns).toHaveBeenCalledWith({ orgId: 'lumen-org' })
    expect(whereCalls.filter(([field]) => field === 'orgId').map(([, , value]) => value)).toEqual([
      'lumen-org',
      'lumen-org',
      'lumen-org',
      'lumen-org',
      'lumen-org',
      'lumen-org',
    ])
  })
})
