// __tests__/api/v1/ads/campaigns/smart-shopping-route.test.ts
// Tests for POST /api/v1/ads/campaigns SMART_SHOPPING branch — Sub-3a-ext Smart Shopping.

import { POST } from '@/app/api/v1/ads/campaigns/route'

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
}))

// ─── Google connection helpers ────────────────────────────────────────────────
jest.mock('@/lib/ads/connections/store', () => ({
  getConnection: jest.fn(),
  decryptAccessToken: jest.fn(),
}))
jest.mock('@/lib/integrations/google_ads/oauth', () => ({
  readDeveloperToken: jest.fn(),
}))

// ─── Google campaign providers ────────────────────────────────────────────────
jest.mock('@/lib/ads/providers/google/campaigns', () => ({
  createSearchCampaign: jest.fn(),
}))
jest.mock('@/lib/ads/providers/google/campaigns-pmax', () => ({
  createPmaxCampaign: jest.fn(),
  createSmartShoppingCampaign: jest.fn(),
}))
jest.mock('@/lib/ads/providers/google/campaigns-shopping', () => ({
  createShoppingCampaign: jest.fn(),
}))
jest.mock('@/lib/ads/providers/google/campaigns-display', () => ({
  createDisplayCampaign: jest.fn(),
}))
jest.mock('@/lib/ads/providers/google/campaigns-youtube', () => ({
  createVideoCampaign: jest.fn(),
}))

// ─── Imports after mocks ──────────────────────────────────────────────────────
const { requireMetaContext } = jest.requireMock('@/lib/ads/api-helpers')
const { createCampaign, updateCampaign } = jest.requireMock('@/lib/ads/campaigns/store')
const { getConnection, decryptAccessToken } = jest.requireMock('@/lib/ads/connections/store')
const { readDeveloperToken } = jest.requireMock('@/lib/integrations/google_ads/oauth')
const { createSmartShoppingCampaign } = jest.requireMock('@/lib/ads/providers/google/campaigns-pmax')

// ─── Shared stubs ─────────────────────────────────────────────────────────────
const fakeCtx = { orgId: 'org-001', adAccountId: 'act_123', accessToken: 'ctx-token', connection: {} }
const fakeCampaign = {
  id: 'camp-ss-001',
  name: 'Smart Shopping Test',
  objective: 'CONVERSIONS',
  status: 'DRAFT',
  providerData: {},
  orgId: 'org-001',
}
const fakeConn = { meta: { google: { loginCustomerId: '1234567890' } }, accessTokenEnc: {} }
const fakeResult = { resourceName: 'customers/1234567890/campaigns/888', id: '888' }

function makeReq(body: object) {
  return new Request('http://x/api/v1/ads/campaigns', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Org-Id': 'org-001' },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  jest.clearAllMocks()
  requireMetaContext.mockResolvedValue(fakeCtx)
  createCampaign.mockResolvedValue(fakeCampaign)
  updateCampaign.mockResolvedValue(undefined)
  getConnection.mockResolvedValue(fakeConn)
  decryptAccessToken.mockReturnValue('access-token')
  readDeveloperToken.mockReturnValue('dev-token')
  createSmartShoppingCampaign.mockResolvedValue(fakeResult)
})

describe('POST /api/v1/ads/campaigns — SMART_SHOPPING branch', () => {
  // Test 1: SMART_SHOPPING with merchantId + feedLabel calls createSmartShoppingCampaign
  it('calls createSmartShoppingCampaign with merchantId and feedLabel when campaignType is SMART_SHOPPING', async () => {
    const res = await POST(
      makeReq({
        platform: 'google',
        input: { name: 'Smart Shopping Test', objective: 'CONVERSIONS' },
        googleAds: {
          campaignType: 'SMART_SHOPPING',
          dailyBudgetMajor: 20,
          shopping: { merchantId: 'merch-99', feedLabel: 'US' },
          smartShopping: { targetRoas: 5.0 },
        },
      }) as any,
      { uid: 'user-001' } as any,
    )

    expect(res.status).toBe(201)
    expect(createSmartShoppingCampaign).toHaveBeenCalledTimes(1)

    const call = createSmartShoppingCampaign.mock.calls[0][0]
    expect(call.customerId).toBe('1234567890')
    expect(call.merchantId).toBe('merch-99')
    expect(call.feedLabel).toBe('US')
    expect(call.targetRoas).toBe(5.0)
    expect(call.dailyBudgetMajor).toBe(20)
    expect(call.canonical).toEqual(fakeCampaign)
  })

  // Test 2: 400 when merchantId missing
  it('returns 400 when merchantId is missing for SMART_SHOPPING', async () => {
    const res = await POST(
      makeReq({
        platform: 'google',
        input: { name: 'Smart Shopping No Merchant', objective: 'CONVERSIONS' },
        googleAds: {
          campaignType: 'SMART_SHOPPING',
          shopping: { feedLabel: 'US' },
        },
      }) as any,
      { uid: 'user-001' } as any,
    )

    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/merchantId/i)
    expect(createSmartShoppingCampaign).not.toHaveBeenCalled()
  })

  // Test 3: Persists campaignSubType SMART_SHOPPING in providerData
  it('persists campaignSubType SMART_SHOPPING in google providerData', async () => {
    await POST(
      makeReq({
        platform: 'google',
        input: { name: 'Smart Shopping Test', objective: 'CONVERSIONS' },
        googleAds: {
          campaignType: 'SMART_SHOPPING',
          shopping: { merchantId: 'merch-99', feedLabel: 'US' },
        },
      }) as any,
      { uid: 'user-001' } as any,
    )

    expect(updateCampaign).toHaveBeenCalledTimes(1)
    const [, updateArg] = updateCampaign.mock.calls[0]
    expect(updateArg.providerData.google.campaignSubType).toBe('SMART_SHOPPING')
    expect(updateArg.providerData.google.campaignResourceName).toBe('customers/1234567890/campaigns/888')
    expect(updateArg.providerData.google.googleCampaignId).toBe('888')
  })
})
