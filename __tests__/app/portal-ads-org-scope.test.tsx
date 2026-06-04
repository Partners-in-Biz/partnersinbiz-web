const mockVerifySessionCookie = jest.fn()
const mockCookies = jest.fn()
const mockUserDoc = jest.fn()
const mockCollection = jest.fn()
const mockCanUsePortalOrg = jest.fn()
const mockResolvePortalActiveOrgId = jest.fn()
const mockListCampaigns = jest.fn()
const mockGetCampaign = jest.fn()
const mockListAdSets = jest.fn()
const mockListAds = jest.fn()
const mockGetAd = jest.fn()
const activityWhereCalls: Array<[string, string, unknown]> = []

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

jest.mock('@/lib/portal/org-access', () => ({
  canUsePortalOrg: (...args: unknown[]) => mockCanUsePortalOrg(...args),
  resolvePortalActiveOrgId: (...args: unknown[]) => mockResolvePortalActiveOrgId(...args),
}))

jest.mock('@/lib/ads/campaigns/store', () => ({
  listCampaigns: (...args: unknown[]) => mockListCampaigns(...args),
  getCampaign: (...args: unknown[]) => mockGetCampaign(...args),
}))

jest.mock('@/lib/ads/adsets/store', () => ({
  listAdSets: (...args: unknown[]) => mockListAdSets(...args),
}))

jest.mock('@/lib/ads/ads/store', () => ({
  listAds: (...args: unknown[]) => mockListAds(...args),
  getAd: (...args: unknown[]) => mockGetAd(...args),
}))

jest.mock('@/components/ads/InsightsChart', () => ({
  InsightsChart: () => null,
}))

jest.mock('@/app/(portal)/portal/ads/campaigns/[id]/ApprovalActions', () => ({
  ApprovalActions: () => null,
}))

jest.mock('@/app/(portal)/portal/ads/ads/[id]/CommentThread', () => ({
  CommentThread: ({ orgId }: { orgId?: string }) => <div data-testid="comment-thread" data-org-id={orgId} />,
}))

function activityCollection(name: string) {
  if (name === 'users') return { doc: mockUserDoc }
  if (name !== 'activity') return { doc: () => ({ get: async () => ({ exists: false }) }) }

  const chain = {
    where(field: string, op: string, value: unknown) {
      activityWhereCalls.push([field, op, value])
      return chain
    },
    orderBy() {
      return chain
    },
    limit() {
      return chain
    },
    async get() {
      return {
        docs: [
          {
            id: 'activity-1',
            data: () => ({
              orgId: 'lumen-org',
              type: 'ad_campaign.created',
              actorName: 'Pip',
              entityTitle: 'Lumen paid launch',
              createdAt: new Date(),
            }),
          },
        ],
      }
    },
  }
  return chain
}

describe('portal ads org scope', () => {
  beforeEach(() => {
    jest.resetModules()
    jest.clearAllMocks()
    activityWhereCalls.length = 0
    mockVerifySessionCookie.mockResolvedValue({ uid: 'admin-1' })
    mockCookies.mockResolvedValue({ get: () => ({ value: 'session' }) })
    mockCanUsePortalOrg.mockResolvedValue(true)
    mockResolvePortalActiveOrgId.mockResolvedValue('platform-org')
    mockUserDoc.mockReturnValue({
      get: async () => ({
        exists: true,
        data: () => ({ role: 'admin', orgId: 'platform-org', activeOrgId: 'platform-org' }),
      }),
    })
    mockCollection.mockImplementation(activityCollection)
    mockListCampaigns.mockResolvedValue([
      {
        id: 'ad-campaign-1',
        orgId: 'lumen-org',
        platform: 'meta',
        adAccountId: 'act_1',
        name: 'Lumen paid launch',
        objective: 'LEADS',
        status: 'PENDING_REVIEW',
        reviewState: 'awaiting',
        cboEnabled: false,
        specialAdCategories: [],
        providerData: {},
      },
    ])
    mockGetCampaign.mockResolvedValue({
      id: 'ad-campaign-1',
      orgId: 'lumen-org',
      platform: 'meta',
      adAccountId: 'act_1',
      name: 'Lumen paid launch',
      objective: 'LEADS',
      status: 'PENDING_REVIEW',
      reviewState: 'awaiting',
      cboEnabled: false,
      specialAdCategories: [],
      providerData: {},
    })
    mockListAdSets.mockResolvedValue([])
    mockListAds.mockResolvedValue([])
    mockGetAd.mockResolvedValue({
      id: 'ad-1',
      orgId: 'lumen-org',
      campaignId: 'ad-campaign-1',
      adSetId: 'ad-set-1',
      platform: 'meta',
      name: 'Lumen ad',
      status: 'DRAFT',
      format: 'SINGLE_IMAGE',
      creativeIds: [],
      providerData: {},
      copy: { headline: 'Lumen', primaryText: 'Fast internet' },
    })
  })

  it('lists campaigns for the requested company workspace org', async () => {
    const Page = (await import('@/app/(portal)/portal/ads/page')).default

    await Page({
      searchParams: Promise.resolve({ orgId: 'lumen-org', orgSlug: 'lumen-speeds' }),
    } as never)

    expect(mockCanUsePortalOrg).toHaveBeenCalledWith(
      'admin-1',
      expect.objectContaining({ orgId: 'platform-org' }),
      'lumen-org',
    )
    expect(mockListCampaigns).toHaveBeenCalledWith({ orgId: 'lumen-org' })
  })

  it('opens campaign details for the requested company workspace org', async () => {
    const Page = (await import('@/app/(portal)/portal/ads/campaigns/[id]/page')).default

    await expect(
      Page({
        params: Promise.resolve({ id: 'ad-campaign-1' }),
        searchParams: Promise.resolve({ orgId: 'lumen-org', orgSlug: 'lumen-speeds' }),
      } as never),
    ).resolves.toBeTruthy()

    expect(mockCanUsePortalOrg).toHaveBeenCalledWith(
      'admin-1',
      expect.objectContaining({ orgId: 'platform-org' }),
      'lumen-org',
    )
    expect(mockListAdSets).toHaveBeenCalledWith({ orgId: 'lumen-org', campaignId: 'ad-campaign-1' })
    expect(mockListAds).toHaveBeenCalledWith({ orgId: 'lumen-org', campaignId: 'ad-campaign-1' })
  })

  it('loads activity for the requested company workspace org', async () => {
    const Page = (await import('@/app/(portal)/portal/ads/activity/page')).default

    await Page({
      searchParams: Promise.resolve({ orgId: 'lumen-org', orgSlug: 'lumen-speeds' }),
    } as never)

    expect(mockCanUsePortalOrg).toHaveBeenCalledWith(
      'admin-1',
      expect.objectContaining({ orgId: 'platform-org' }),
      'lumen-org',
    )
    expect(activityWhereCalls).toContainEqual(['orgId', '==', 'lumen-org'])
  })

  it('opens ad details for the requested company workspace org', async () => {
    const Page = (await import('@/app/(portal)/portal/ads/ads/[id]/page')).default

    await expect(
      Page({
        params: Promise.resolve({ id: 'ad-1' }),
        searchParams: Promise.resolve({ orgId: 'lumen-org', orgSlug: 'lumen-speeds' }),
      } as never),
    ).resolves.toBeTruthy()

    expect(mockCanUsePortalOrg).toHaveBeenCalledWith(
      'admin-1',
      expect.objectContaining({ orgId: 'platform-org' }),
      'lumen-org',
    )
  })
})
