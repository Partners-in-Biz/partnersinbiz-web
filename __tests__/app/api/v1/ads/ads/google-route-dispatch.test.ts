// __tests__/app/api/v1/ads/ads/google-route-dispatch.test.ts
// Google platform dispatch tests for ad routes — Sub-3a Phase 2 Batch 3
import { POST } from '@/app/api/v1/ads/ads/route'
import { PATCH, DELETE } from '@/app/api/v1/ads/ads/[id]/route'

jest.mock('@/lib/api/auth', () => ({ withAuth: (_r: string, h: any) => h }))

jest.mock('@/lib/ads/ads/store', () => ({
  listAds: jest.fn(),
  createAd: jest.fn(),
  getAd: jest.fn(),
  updateAd: jest.fn(),
  deleteAd: jest.fn(),
}))

jest.mock('@/lib/ads/adsets/store', () => ({
  getAdSet: jest.fn(),
}))

jest.mock('@/lib/ads/api-helpers', () => ({
  requireMetaContext: jest.fn(),
  resolveGoogleAdsCustomerContext: jest.fn((conn) => ({
    customerId: conn.defaultAdAccountId,
    loginCustomerId: conn.meta?.google?.loginCustomerId,
  })),
}))

jest.mock('@/lib/ads/providers/meta', () => ({
  metaProvider: { upsertAd: jest.fn() },
}))

jest.mock('@/lib/ads/providers/meta/ads', () => ({
  deleteAd: jest.fn(),
}))

jest.mock('@/lib/ads/providers/google/ads', () => ({
  createResponsiveSearchAd: jest.fn().mockResolvedValue({
    resourceName: 'customers/1234567890/adGroupAds/888~777',
    id: '888~777',
  }),
  updateAdGroupAd: jest.fn().mockResolvedValue({
    resourceName: 'customers/1234567890/adGroupAds/888~777',
    id: '888~777',
  }),
  removeAdGroupAd: jest.fn().mockResolvedValue({
    resourceName: 'customers/1234567890/adGroupAds/888~777',
    id: '888~777',
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
  logAdActivity: jest.fn().mockResolvedValue(undefined),
}))

const store = jest.requireMock('@/lib/ads/ads/store')
const adSetStore = jest.requireMock('@/lib/ads/adsets/store')
const helpers = jest.requireMock('@/lib/ads/api-helpers')
const googleAds = jest.requireMock('@/lib/ads/providers/google/ads')
const connStore = jest.requireMock('@/lib/ads/connections/store')

beforeEach(() => jest.clearAllMocks())

const baseCtx = {
  orgId: 'org-1',
  accessToken: 'meta-tok',
  adAccountId: 'act_42',
  connection: { id: 'conn_meta' },
}

const googleAdSet = {
  id: 'ads_g1',
  orgId: 'org-1',
  campaignId: 'cmp_g1',
  platform: 'google',
  name: 'Google AdGroup',
  status: 'ACTIVE',
  providerData: {
    google: { adGroupResourceName: 'customers/1234567890/adGroups/888' },
  },
}

const googleAd = {
  id: 'ad_g1',
  orgId: 'org-1',
  adSetId: 'ads_g1',
  campaignId: 'cmp_g1',
  platform: 'google',
  name: 'Google RSA',
  status: 'DRAFT',
  format: 'SINGLE_IMAGE',
  creativeIds: [],
  copy: { primaryText: 'Buy now', headline: 'Great deal' },
  providerData: {
    google: { adGroupAdResourceName: 'customers/1234567890/adGroupAds/888~777' },
  },
}

const validRsaAssets = {
  headlines: [
    { text: 'Headline One' },
    { text: 'Headline Two' },
    { text: 'Headline Three' },
  ],
  descriptions: [
    { text: 'Description one here now' },
    { text: 'Description two here now' },
  ],
  finalUrls: ['https://example.com'],
}

// ── POST /api/v1/ads/ads — Google create ─────────────────────────────────────

describe('POST /api/v1/ads/ads — Google dispatch', () => {
  it('creates RSA ad and dispatches createResponsiveSearchAd for Google platform', async () => {
    helpers.requireMetaContext.mockResolvedValueOnce(baseCtx)
    adSetStore.getAdSet.mockResolvedValueOnce(googleAdSet)
    const created = { ...googleAd, providerData: {} }
    store.createAd.mockResolvedValueOnce(created)
    store.updateAd.mockResolvedValueOnce(undefined)

    const res = await POST(
      new Request('http://x', {
        method: 'POST',
        headers: { 'X-Org-Id': 'org-1', 'Content-Type': 'application/json' },
        body: JSON.stringify({
          platform: 'google',
          input: {
            adSetId: 'ads_g1',
            campaignId: 'cmp_g1',
            name: 'Google RSA',
            status: 'DRAFT',
            format: 'SINGLE_IMAGE',
            creativeIds: [],
            copy: { primaryText: 'Buy now', headline: 'Great deal' },
          },
          rsaAssets: validRsaAssets,
        }),
      }) as any,
      { uid: 'u1' } as any,
      {} as any,
    )
    const body = await res.json()
    expect(res.status).toBe(201)
    expect(body.success).toBe(true)
    expect(store.createAd).toHaveBeenCalledWith(
      expect.objectContaining({ platform: 'google' }),
    )
    expect(googleAds.createResponsiveSearchAd).toHaveBeenCalledWith(
      expect.objectContaining({
        customerId: '1234567890',
        adGroupResourceName: 'customers/1234567890/adGroups/888',
        rsaAssets: validRsaAssets,
      }),
    )
    expect(store.updateAd).toHaveBeenCalledWith(
      created.id,
      expect.objectContaining({ providerData: expect.objectContaining({ google: expect.objectContaining({ adGroupAdResourceName: 'customers/1234567890/adGroupAds/888~777' }) }) }),
    )
  })

  it('returns 400 when rsaAssets missing for Google ad', async () => {
    helpers.requireMetaContext.mockResolvedValueOnce(baseCtx)
    adSetStore.getAdSet.mockResolvedValueOnce(googleAdSet)
    store.createAd.mockResolvedValueOnce({ ...googleAd, providerData: {} })

    const res = await POST(
      new Request('http://x', {
        method: 'POST',
        headers: { 'X-Org-Id': 'org-1', 'Content-Type': 'application/json' },
        body: JSON.stringify({
          platform: 'google',
          input: { adSetId: 'ads_g1', campaignId: 'cmp_g1', name: 'G', status: 'DRAFT', format: 'SINGLE_IMAGE', creativeIds: [], copy: { primaryText: 'x', headline: 'y' } },
          // rsaAssets intentionally omitted
        }),
      }) as any,
      { uid: 'u1' } as any,
      {} as any,
    )
    expect(res.status).toBe(400)
  })
})

// ── PATCH /api/v1/ads/ads/[id] — Google update ───────────────────────────────

describe('PATCH /api/v1/ads/ads/[id] — Google dispatch', () => {
  it('calls googleUpdateAdGroupAd when ad.platform === google and resourceName exists', async () => {
    const updated = { ...googleAd, status: 'ACTIVE' }
    store.getAd
      .mockResolvedValueOnce(googleAd)
      .mockResolvedValueOnce(updated)
    store.updateAd.mockResolvedValueOnce(undefined)

    const res = await PATCH(
      new Request('http://x', {
        method: 'PATCH',
        headers: { 'X-Org-Id': 'org-1', 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'ACTIVE' }),
      }) as any,
      {} as any,
      { params: Promise.resolve({ id: 'ad_g1' }) },
    )
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.data.status).toBe('ACTIVE')
    expect(googleAds.updateAdGroupAd).toHaveBeenCalledWith(
      expect.objectContaining({
        resourceName: 'customers/1234567890/adGroupAds/888~777',
        status: 'ACTIVE',
      }),
    )
    // Meta upsertAd must NOT be called
    const metaProvider = jest.requireMock('@/lib/ads/providers/meta')
    expect(metaProvider.metaProvider.upsertAd).not.toHaveBeenCalled()
  })

  it('includes Google Ads sync warning in response when updateAdGroupAd throws', async () => {
    const updated = { ...googleAd, status: 'PAUSED' }
    store.getAd
      .mockResolvedValueOnce(googleAd)
      .mockResolvedValueOnce(updated)
    store.updateAd.mockResolvedValueOnce(undefined)
    googleAds.updateAdGroupAd.mockRejectedValueOnce(new Error('Google API rate limited'))

    const res = await PATCH(
      new Request('http://x', {
        method: 'PATCH',
        headers: { 'X-Org-Id': 'org-1', 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'PAUSED' }),
      }) as any,
      {} as any,
      { params: Promise.resolve({ id: 'ad_g1' }) },
    )
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.data.warnings).toHaveLength(1)
    expect(body.data.warnings[0]).toMatch(/Google Ads sync warning/)
  })
})

// ── DELETE /api/v1/ads/ads/[id] — Google remove ──────────────────────────────

describe('DELETE /api/v1/ads/ads/[id] — Google dispatch', () => {
  it('calls googleRemoveAdGroupAd before local delete when resourceName exists', async () => {
    store.getAd.mockResolvedValueOnce(googleAd)
    store.deleteAd.mockResolvedValueOnce(undefined)

    const res = await DELETE(
      new Request('http://x', { headers: { 'X-Org-Id': 'org-1' } }) as any,
      { uid: 'u1', email: 'a@b.com' } as any,
      { params: Promise.resolve({ id: 'ad_g1' }) },
    )
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.data.deleted).toBe(true)
    expect(googleAds.removeAdGroupAd).toHaveBeenCalledWith(
      expect.objectContaining({ resourceName: 'customers/1234567890/adGroupAds/888~777' }),
    )
    expect(store.deleteAd).toHaveBeenCalledWith('ad_g1')
  })

  it('still deletes locally even when Google removeAdGroupAd throws', async () => {
    store.getAd.mockResolvedValueOnce(googleAd)
    store.deleteAd.mockResolvedValueOnce(undefined)
    googleAds.removeAdGroupAd.mockRejectedValueOnce(new Error('Google down'))

    const res = await DELETE(
      new Request('http://x', { headers: { 'X-Org-Id': 'org-1' } }) as any,
      { uid: 'u1' } as any,
      { params: Promise.resolve({ id: 'ad_g1' }) },
    )
    expect(res.status).toBe(200)
    expect(store.deleteAd).toHaveBeenCalledWith('ad_g1')
  })

  it('does not call Google remove when no resource name on providerData', async () => {
    const adNoResource = { ...googleAd, providerData: { google: {} } }
    store.getAd.mockResolvedValueOnce(adNoResource)
    store.deleteAd.mockResolvedValueOnce(undefined)

    const res = await DELETE(
      new Request('http://x', { headers: { 'X-Org-Id': 'org-1' } }) as any,
      { uid: 'u1' } as any,
      { params: Promise.resolve({ id: 'ad_g1' }) },
    )
    expect(res.status).toBe(200)
    expect(googleAds.removeAdGroupAd).not.toHaveBeenCalled()
    expect(store.deleteAd).toHaveBeenCalledWith('ad_g1')
  })
})
