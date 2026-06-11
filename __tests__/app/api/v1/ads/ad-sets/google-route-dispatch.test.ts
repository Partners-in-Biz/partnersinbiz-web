// __tests__/app/api/v1/ads/ad-sets/google-route-dispatch.test.ts
// Google platform dispatch tests for ad-set routes — Sub-3a Phase 2 Batch 3
import { POST } from '@/app/api/v1/ads/ad-sets/route'
import { PATCH, DELETE } from '@/app/api/v1/ads/ad-sets/[id]/route'

jest.mock('@/lib/api/auth', () => ({ withAuth: (_r: string, h: any) => h }))

jest.mock('@/lib/ads/adsets/store', () => ({
  listAdSets: jest.fn(),
  createAdSet: jest.fn(),
  getAdSet: jest.fn(),
  updateAdSet: jest.fn(),
  deleteAdSet: jest.fn(),
}))

jest.mock('@/lib/ads/campaigns/store', () => ({
  getCampaign: jest.fn(),
}))

jest.mock('@/lib/ads/api-helpers', () => ({
  requireMetaContext: jest.fn(),
  resolveGoogleAdsCustomerContext: jest.fn((conn) => ({
    customerId: conn.defaultAdAccountId,
    loginCustomerId: conn.meta?.google?.loginCustomerId,
  })),
}))

jest.mock('@/lib/ads/providers/meta', () => ({
  metaProvider: { upsertAdSet: jest.fn() },
}))

jest.mock('@/lib/ads/providers/meta/adsets', () => ({
  deleteAdSet: jest.fn(),
}))

jest.mock('@/lib/ads/providers/google/adgroups', () => ({
  createAdGroup: jest.fn().mockResolvedValue({
    resourceName: 'customers/1234567890/adGroups/888',
    id: '888',
  }),
  updateAdGroup: jest.fn().mockResolvedValue({
    resourceName: 'customers/1234567890/adGroups/888',
    id: '888',
  }),
  removeAdGroup: jest.fn().mockResolvedValue({
    resourceName: 'customers/1234567890/adGroups/888',
    id: '888',
  }),
}))

jest.mock('@/lib/ads/connections/store', () => ({
  getConnection: jest.fn().mockResolvedValue({
    id: 'conn_g1',
    orgId: 'org-1',
    platform: 'google',
    defaultAdAccountId: '1234567890',
    accessTokenEnc: { iv: 'iv', tag: 'tag', data: 'data' },
    meta: { google: { loginCustomerId: '1234567890' } },
  }),
  decryptAccessToken: jest.fn().mockReturnValue('test-access-token'),
}))

jest.mock('@/lib/integrations/google_ads/oauth', () => ({
  readDeveloperToken: jest.fn().mockReturnValue('test-dev-token'),
}))

jest.mock('@/lib/ads/activity', () => ({
  logAdSetActivity: jest.fn().mockResolvedValue(undefined),
}))

const store = jest.requireMock('@/lib/ads/adsets/store')
const campaignsStore = jest.requireMock('@/lib/ads/campaigns/store')
const helpers = jest.requireMock('@/lib/ads/api-helpers')
const googleAdGroups = jest.requireMock('@/lib/ads/providers/google/adgroups')
const connStore = jest.requireMock('@/lib/ads/connections/store')

beforeEach(() => jest.clearAllMocks())

const baseCtx = {
  orgId: 'org-1',
  accessToken: 'meta-tok',
  adAccountId: 'act_42',
  connection: { id: 'conn_meta' },
}

const googleCampaign = {
  id: 'cmp_g1',
  orgId: 'org-1',
  platform: 'google',
  name: 'Google Campaign',
  status: 'ACTIVE',
  providerData: {
    google: { campaignResourceName: 'customers/1234567890/campaigns/999' },
  },
}

const googleAdSet = {
  id: 'ads_g1',
  orgId: 'org-1',
  campaignId: 'cmp_g1',
  platform: 'google',
  name: 'Google AdGroup',
  status: 'DRAFT',
  providerData: {
    google: { adGroupResourceName: 'customers/1234567890/adGroups/888' },
  },
}

// ── POST /api/v1/ads/ad-sets — Google create ──────────────────────────────────

describe('POST /api/v1/ads/ad-sets — Google dispatch', () => {
  it('creates ad set and dispatches createAdGroup for Google platform', async () => {
    helpers.requireMetaContext.mockResolvedValueOnce(baseCtx)
    campaignsStore.getCampaign.mockResolvedValueOnce(googleCampaign)
    const created = { ...googleAdSet, providerData: {} }
    store.createAdSet.mockResolvedValueOnce(created)
    store.updateAdSet.mockResolvedValueOnce(undefined)

    const res = await POST(
      new Request('http://x', {
        method: 'POST',
        headers: { 'X-Org-Id': 'org-1', 'Content-Type': 'application/json' },
        body: JSON.stringify({
          platform: 'google',
          input: {
            campaignId: 'cmp_g1',
            name: 'Google AdGroup',
            status: 'DRAFT',
            optimizationGoal: 'LINK_CLICKS',
            billingEvent: 'IMPRESSIONS',
            targeting: {},
          },
          googleAds: { defaultCpcBidMajor: 0.75 },
        }),
      }) as any,
      { uid: 'u1' } as any,
      {} as any,
    )
    const body = await res.json()
    expect(res.status).toBe(201)
    expect(body.success).toBe(true)
    expect(store.createAdSet).toHaveBeenCalledWith(
      expect.objectContaining({ platform: 'google' }),
    )
    expect(googleAdGroups.createAdGroup).toHaveBeenCalledWith(
      expect.objectContaining({
        customerId: '1234567890',
        campaignResourceName: 'customers/1234567890/campaigns/999',
        defaultCpcBidMajor: 0.75,
      }),
    )
    expect(store.updateAdSet).toHaveBeenCalledWith(
      created.id,
      expect.objectContaining({ providerData: expect.objectContaining({ google: expect.objectContaining({ adGroupResourceName: 'customers/1234567890/adGroups/888' }) }) }),
    )
  })

  it('returns 400 when parent campaign has no Google resource name', async () => {
    helpers.requireMetaContext.mockResolvedValueOnce(baseCtx)
    campaignsStore.getCampaign.mockResolvedValueOnce({ ...googleCampaign, providerData: {} })
    store.createAdSet.mockResolvedValueOnce({ ...googleAdSet, providerData: {} })

    const res = await POST(
      new Request('http://x', {
        method: 'POST',
        headers: { 'X-Org-Id': 'org-1', 'Content-Type': 'application/json' },
        body: JSON.stringify({
          platform: 'google',
          input: { campaignId: 'cmp_g1', name: 'G', status: 'DRAFT', optimizationGoal: 'LINK_CLICKS', billingEvent: 'IMPRESSIONS', targeting: {} },
        }),
      }) as any,
      { uid: 'u1' } as any,
      {} as any,
    )
    expect(res.status).toBe(400)
  })
})

// ── PATCH /api/v1/ads/ad-sets/[id] — Google update ───────────────────────────

describe('PATCH /api/v1/ads/ad-sets/[id] — Google dispatch', () => {
  it('calls googleUpdateAdGroup when adSet.platform === google and resourceName exists', async () => {
    const updated = { ...googleAdSet, name: 'New AdGroup Name' }
    store.getAdSet
      .mockResolvedValueOnce(googleAdSet)
      .mockResolvedValueOnce(updated)
    store.updateAdSet.mockResolvedValueOnce(undefined)

    const res = await PATCH(
      new Request('http://x', {
        method: 'PATCH',
        headers: { 'X-Org-Id': 'org-1', 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'New AdGroup Name' }),
      }) as any,
      {} as any,
      { params: Promise.resolve({ id: 'ads_g1' }) },
    )
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.data.name).toBe('New AdGroup Name')
    expect(googleAdGroups.updateAdGroup).toHaveBeenCalledWith(
      expect.objectContaining({
        resourceName: 'customers/1234567890/adGroups/888',
        name: 'New AdGroup Name',
      }),
    )
  })
})

// ── DELETE /api/v1/ads/ad-sets/[id] — Google remove ──────────────────────────

describe('DELETE /api/v1/ads/ad-sets/[id] — Google dispatch', () => {
  it('calls googleRemoveAdGroup before local delete when resourceName exists', async () => {
    store.getAdSet.mockResolvedValueOnce(googleAdSet)
    store.deleteAdSet.mockResolvedValueOnce(undefined)

    const res = await DELETE(
      new Request('http://x', { headers: { 'X-Org-Id': 'org-1' } }) as any,
      { uid: 'u1', email: 'a@b.com' } as any,
      { params: Promise.resolve({ id: 'ads_g1' }) },
    )
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.data.deleted).toBe(true)
    expect(googleAdGroups.removeAdGroup).toHaveBeenCalledWith(
      expect.objectContaining({ resourceName: 'customers/1234567890/adGroups/888' }),
    )
    expect(store.deleteAdSet).toHaveBeenCalledWith('ads_g1')
  })

  it('still deletes locally even when Google removeAdGroup throws', async () => {
    store.getAdSet.mockResolvedValueOnce(googleAdSet)
    store.deleteAdSet.mockResolvedValueOnce(undefined)
    googleAdGroups.removeAdGroup.mockRejectedValueOnce(new Error('Google down'))

    const res = await DELETE(
      new Request('http://x', { headers: { 'X-Org-Id': 'org-1' } }) as any,
      { uid: 'u1' } as any,
      { params: Promise.resolve({ id: 'ads_g1' }) },
    )
    expect(res.status).toBe(200)
    expect(store.deleteAdSet).toHaveBeenCalledWith('ads_g1')
  })

  it('does not call Google remove when no resource name on providerData', async () => {
    const adSetNoResource = { ...googleAdSet, providerData: { google: {} } }
    store.getAdSet.mockResolvedValueOnce(adSetNoResource)
    store.deleteAdSet.mockResolvedValueOnce(undefined)

    const res = await DELETE(
      new Request('http://x', { headers: { 'X-Org-Id': 'org-1' } }) as any,
      { uid: 'u1' } as any,
      { params: Promise.resolve({ id: 'ads_g1' }) },
    )
    expect(res.status).toBe(200)
    expect(googleAdGroups.removeAdGroup).not.toHaveBeenCalled()
    expect(store.deleteAdSet).toHaveBeenCalledWith('ads_g1')
  })
})
