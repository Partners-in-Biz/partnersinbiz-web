// __tests__/api/v1/ads/tiktok/tiktok-route-dispatch.test.ts
// Verifies POST /api/v1/ads/campaigns, /ad-sets, /ads TikTok branches — Phase 2 Batch 3A.

import { POST as campaignsPost } from '@/app/api/v1/ads/campaigns/route'
import { POST as adSetsPost } from '@/app/api/v1/ads/ad-sets/route'
import { POST as adsPost } from '@/app/api/v1/ads/ads/route'

// ─── Auth bypass ─────────────────────────────────────────────────────────────
jest.mock('@/lib/api/auth', () => ({ withAuth: (_r: string, h: any) => h }))

// ─── requireMetaContext ───────────────────────────────────────────────────────
jest.mock('@/lib/ads/api-helpers', () => ({
  requireMetaContext: jest.fn(),
}))

// ─── Campaign store ───────────────────────────────────────────────────────────
jest.mock('@/lib/ads/campaigns/store', () => ({
  createCampaign: jest.fn(),
  updateCampaign: jest.fn(),
  listCampaigns: jest.fn(),
  getCampaign: jest.fn(),
}))

// ─── AdSet store ─────────────────────────────────────────────────────────────
jest.mock('@/lib/ads/adsets/store', () => ({
  createAdSet: jest.fn(),
  updateAdSet: jest.fn(),
  listAdSets: jest.fn(),
  getAdSet: jest.fn(),
}))

// ─── Ad store ─────────────────────────────────────────────────────────────────
jest.mock('@/lib/ads/ads/store', () => ({
  createAd: jest.fn(),
  updateAd: jest.fn(),
  listAds: jest.fn(),
}))

// ─── Connection helpers ───────────────────────────────────────────────────────
jest.mock('@/lib/ads/connections/store', () => ({
  getConnection: jest.fn(),
  decryptAccessToken: jest.fn().mockReturnValue('tk-access-token'),
}))
jest.mock('@/lib/integrations/google_ads/oauth', () => ({
  readDeveloperToken: jest.fn().mockReturnValue('dev-token'),
}))

// ─── Google / LinkedIn providers (prevent actual imports) ────────────────────
jest.mock('@/lib/ads/providers/google/campaigns', () => ({ createSearchCampaign: jest.fn() }))
jest.mock('@/lib/ads/providers/google/adgroups', () => ({ createAdGroup: jest.fn() }))
jest.mock('@/lib/ads/providers/google/ads', () => ({ createResponsiveSearchAd: jest.fn() }))

// ─── TikTok providers ────────────────────────────────────────────────────────
jest.mock('@/lib/ads/providers/tiktok/campaigns', () => ({
  createCampaign: jest.fn().mockResolvedValue({ campaignId: 'tk-camp-001' }),
}))
jest.mock('@/lib/ads/providers/tiktok/adgroups', () => ({
  createAdGroup: jest.fn().mockResolvedValue({ adgroupId: 'tk-adgroup-001' }),
}))
jest.mock('@/lib/ads/providers/tiktok/ads', () => ({
  createAd: jest.fn().mockResolvedValue({ adId: 'tk-ad-001', identityId: 'iden-001', identityType: 'AUTH_CODE' }),
}))
jest.mock('@/lib/ads/providers/tiktok/mappers', () => ({
  tiktokObjectiveFromCanonical: jest.fn().mockReturnValue('TRAFFIC'),
}))

// ─── Imports after mocks ──────────────────────────────────────────────────────
const { requireMetaContext } = jest.requireMock('@/lib/ads/api-helpers')
const { createCampaign: storeCampaign, updateCampaign: storeUpdateCampaign, getCampaign } =
  jest.requireMock('@/lib/ads/campaigns/store')
const { createAdSet: storeCreateAdSet, updateAdSet: storeUpdateAdSet, getAdSet } =
  jest.requireMock('@/lib/ads/adsets/store')
const { createAd: storeCreateAd, updateAd: storeUpdateAd } = jest.requireMock('@/lib/ads/ads/store')
const { getConnection, decryptAccessToken } = jest.requireMock('@/lib/ads/connections/store')

// ─── Shared stubs ─────────────────────────────────────────────────────────────
const fakeCtx = { orgId: 'org-001', adAccountId: 'act_123', accessToken: 'ctx-token', connection: {} }

const fakeTiktokConn = {
  meta: { tiktok: { selectedAdvertiserId: '123456789' } },
  accessTokenEnc: {},
}

const fakeCanonicalCampaign = {
  id: 'camp-001',
  name: 'TikTok Campaign',
  objective: 'TRAFFIC',
  status: 'DRAFT',
  providerData: {},
  orgId: 'org-001',
}

const fakeTiktokCampaignWithId = {
  ...fakeCanonicalCampaign,
  providerData: { tiktok: { campaignId: 'tk-camp-001' } },
}

const fakeCanonicalAdSet = {
  id: 'adset-001',
  name: 'TikTok AdSet',
  campaignId: 'camp-001',
  status: 'DRAFT',
  providerData: {},
  orgId: 'org-001',
  platform: 'tiktok',
}

const fakeCanonicalAd = {
  id: 'ad-001',
  name: 'TikTok Ad',
  adSetId: 'adset-001',
  status: 'DRAFT',
  providerData: {},
  orgId: 'org-001',
}

const fakeTiktokAdSet = {
  ...fakeCanonicalAdSet,
  providerData: { tiktok: { adgroupId: 'tk-adgroup-001' } },
}

function makeReq(url: string, body: object, orgId = 'org-001') {
  return new Request(`http://x${url}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Org-Id': orgId },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  jest.clearAllMocks()
  requireMetaContext.mockResolvedValue(fakeCtx)
  storeCampaign.mockResolvedValue(fakeCanonicalCampaign)
  storeUpdateCampaign.mockResolvedValue(undefined)
  getCampaign.mockResolvedValue(fakeTiktokCampaignWithId)
  storeCreateAdSet.mockResolvedValue(fakeCanonicalAdSet)
  storeUpdateAdSet.mockResolvedValue(undefined)
  getAdSet.mockResolvedValue(fakeTiktokAdSet)
  storeCreateAd.mockResolvedValue(fakeCanonicalAd)
  storeUpdateAd.mockResolvedValue(undefined)
  getConnection.mockResolvedValue(fakeTiktokConn)
  decryptAccessToken.mockReturnValue('tk-access-token')
})

// ─── Test 1: POST /campaigns creates TikTok campaign + stamps providerData ────

describe('POST /api/v1/ads/campaigns — TikTok dispatch', () => {
  it('creates campaign via TikTok provider and stamps providerData.tiktok.campaignId', async () => {
    const { createCampaign: tiktokCreateCampaign } = jest.requireMock('@/lib/ads/providers/tiktok/campaigns')

    const res = await campaignsPost(
      makeReq('/api/v1/ads/campaigns', {
        platform: 'tiktok',
        input: { name: 'TikTok Campaign', objective: 'TRAFFIC' },
        tiktokAds: { budgetMajor: 50 },
      }) as any,
      { uid: 'user-001' } as any,
    )

    expect(res.status).toBe(201)
    expect(tiktokCreateCampaign).toHaveBeenCalledTimes(1)

    const call = tiktokCreateCampaign.mock.calls[0][0]
    expect(call.advertiserId).toBe('123456789')
    expect(call.budgetMajor).toBe(50)
    expect(call.canonical).toEqual(fakeCanonicalCampaign)

    expect(storeUpdateCampaign).toHaveBeenCalledTimes(1)
    const updateCall = storeUpdateCampaign.mock.calls[0][1]
    expect(updateCall.providerData.tiktok.campaignId).toBe('tk-camp-001')
    expect(updateCall.providerData.tiktok.tkStatus).toBe('DISABLE')
  })

  // ─── Test 2: returns 400 if no TikTok connection ──────────────────────────
  it('returns 400 if no TikTok ads connection for org', async () => {
    getConnection.mockResolvedValue(null)

    const res = await campaignsPost(
      makeReq('/api/v1/ads/campaigns', {
        platform: 'tiktok',
        input: { name: 'TikTok Campaign', objective: 'TRAFFIC' },
      }) as any,
      { uid: 'user-001' } as any,
    )

    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/TikTok ads connection/i)
  })

  // ─── Test 3: returns 400 if no selectedAdvertiserId on conn meta ──────────
  it('returns 400 if no selectedAdvertiserId on TikTok connection meta', async () => {
    getConnection.mockResolvedValue({ meta: { tiktok: {} }, accessTokenEnc: {} })

    const res = await campaignsPost(
      makeReq('/api/v1/ads/campaigns', {
        platform: 'tiktok',
        input: { name: 'TikTok Campaign', objective: 'TRAFFIC' },
      }) as any,
      { uid: 'user-001' } as any,
    )

    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/advertiserId/i)
  })
})

// ─── Test 4: POST /ad-sets returns 400 if parent campaign has no tiktok.campaignId ─

describe('POST /api/v1/ads/ad-sets — TikTok dispatch', () => {
  it('returns 400 if parent campaign has no providerData.tiktok.campaignId', async () => {
    getCampaign.mockResolvedValue({
      ...fakeCanonicalCampaign,
      providerData: { tiktok: {} }, // no campaignId
    })

    const res = await adSetsPost(
      makeReq('/api/v1/ads/ad-sets', {
        platform: 'tiktok',
        input: { name: 'TikTok AdSet', campaignId: 'camp-001' },
      }) as any,
      { uid: 'user-001' } as any,
    )

    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/campaign id/i)
  })

  it('creates adgroup via TikTok provider and stamps providerData.tiktok.adgroupId', async () => {
    const { createAdGroup: tiktokCreateAdGroup } = jest.requireMock('@/lib/ads/providers/tiktok/adgroups')

    const res = await adSetsPost(
      makeReq('/api/v1/ads/ad-sets', {
        platform: 'tiktok',
        input: { name: 'TikTok AdSet', campaignId: 'camp-001' },
        tiktokAds: { budgetMajor: 20 },
      }) as any,
      { uid: 'user-001' } as any,
    )

    expect(res.status).toBe(201)
    expect(tiktokCreateAdGroup).toHaveBeenCalledTimes(1)
    const call = tiktokCreateAdGroup.mock.calls[0][0]
    expect(call.advertiserId).toBe('123456789')
    expect(call.campaignId).toBe('tk-camp-001')

    expect(storeUpdateAdSet).toHaveBeenCalledTimes(1)
    const updateCall = storeUpdateAdSet.mock.calls[0][1]
    expect(updateCall.providerData.tiktok.adgroupId).toBe('tk-adgroup-001')
    expect(updateCall.providerData.tiktok.campaignId).toBe('tk-camp-001')
  })
})

// ─── Tests 5 & 6: POST /ads TikTok validation + creation ─────────────────────

describe('POST /api/v1/ads/ads — TikTok dispatch', () => {
  // Test 5: returns 400 if required tiktokAds fields missing
  it('returns 400 if tiktokAds required fields are missing', async () => {
    const res = await adsPost(
      makeReq('/api/v1/ads/ads', {
        platform: 'tiktok',
        input: { name: 'TikTok Ad', adSetId: 'adset-001' },
        // no tiktokAds
      }) as any,
      { uid: 'user-001' } as any,
    )

    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/tiktokAds/i)
  })

  it('returns 400 if tiktokAds.identityId is missing', async () => {
    const res = await adsPost(
      makeReq('/api/v1/ads/ads', {
        platform: 'tiktok',
        input: { name: 'TikTok Ad', adSetId: 'adset-001' },
        tiktokAds: {
          // identityId missing
          identityType: 'AUTH_CODE',
          adText: 'Buy now',
          callToAction: 'SHOP_NOW',
          landingPageUrl: 'https://example.com',
        },
      }) as any,
      { uid: 'user-001' } as any,
    )

    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/tiktokAds/i)
  })

  // Test 6: creates ad + stamps providerData.tiktok.adId and identityId
  it('creates TikTok ad and stamps providerData.tiktok.{adId, identityId}', async () => {
    const { createAd: tiktokCreateAd } = jest.requireMock('@/lib/ads/providers/tiktok/ads')

    const res = await adsPost(
      makeReq('/api/v1/ads/ads', {
        platform: 'tiktok',
        input: { name: 'TikTok Ad', adSetId: 'adset-001' },
        tiktokAds: {
          identityId: 'iden-001',
          identityType: 'AUTH_CODE',
          adText: 'Check this out',
          callToAction: 'LEARN_MORE',
          landingPageUrl: 'https://example.com',
          imageIds: ['img-001'],
        },
      }) as any,
      { uid: 'user-001' } as any,
    )

    expect(res.status).toBe(201)
    expect(tiktokCreateAd).toHaveBeenCalledTimes(1)

    const call = tiktokCreateAd.mock.calls[0][0]
    expect(call.advertiserId).toBe('123456789')
    expect(call.adgroupId).toBe('tk-adgroup-001')
    expect(call.identityId).toBe('iden-001')
    expect(call.identityType).toBe('AUTH_CODE')
    expect(call.adText).toBe('Check this out')

    expect(storeUpdateAd).toHaveBeenCalledTimes(1)
    const updateCall = storeUpdateAd.mock.calls[0][1]
    expect(updateCall.providerData.tiktok.adId).toBe('tk-ad-001')
    expect(updateCall.providerData.tiktok.identityId).toBe('iden-001')
    expect(updateCall.providerData.tiktok.adgroupId).toBe('tk-adgroup-001')
  })
})
