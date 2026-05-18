// __tests__/api/v1/ads/ad-sets/google-route-dispatch.test.ts
// Verifies POST /api/v1/ads/ad-sets passes optional type to createAdGroup.
// Additive — Sub-3a Phase 3 Batch 3.

import { POST } from '@/app/api/v1/ads/ad-sets/route'

// ─── Auth bypass ────────────────────────────────────────────────────────────
jest.mock('@/lib/api/auth', () => ({ withAuth: (_r: string, h: any) => h }))

// ─── requireMetaContext ──────────────────────────────────────────────────────
jest.mock('@/lib/ads/api-helpers', () => ({
  requireMetaContext: jest.fn(),
  resolveGoogleAdsCustomerContext: jest.fn((conn: any) => ({
    customerId: conn.defaultAdAccountId,
    loginCustomerId: conn.meta?.google?.loginCustomerId,
  })),
}))

// ─── AdSet + Campaign stores ─────────────────────────────────────────────────
jest.mock('@/lib/ads/adsets/store', () => ({
  listAdSets: jest.fn(),
  createAdSet: jest.fn(),
  updateAdSet: jest.fn(),
}))
jest.mock('@/lib/ads/campaigns/store', () => ({
  getCampaign: jest.fn(),
}))

// ─── Google connection helpers ───────────────────────────────────────────────
jest.mock('@/lib/ads/connections/store', () => ({
  getConnection: jest.fn(),
  decryptAccessToken: jest.fn(),
}))
jest.mock('@/lib/integrations/google_ads/oauth', () => ({
  readDeveloperToken: jest.fn(),
}))

// ─── createAdGroup ───────────────────────────────────────────────────────────
jest.mock('@/lib/ads/providers/google/adgroups', () => ({
  createAdGroup: jest.fn(),
}))

// ─── Imports after mocks ─────────────────────────────────────────────────────
const { requireMetaContext } = jest.requireMock('@/lib/ads/api-helpers')
const { createAdSet, updateAdSet } = jest.requireMock('@/lib/ads/adsets/store')
const { getCampaign } = jest.requireMock('@/lib/ads/campaigns/store')
const { getConnection, decryptAccessToken } = jest.requireMock('@/lib/ads/connections/store')
const { readDeveloperToken } = jest.requireMock('@/lib/integrations/google_ads/oauth')
const { createAdGroup } = jest.requireMock('@/lib/ads/providers/google/adgroups')

// ─── Shared stubs ────────────────────────────────────────────────────────────
const fakeCtx = { orgId: 'org-001', adAccountId: 'act_123', accessToken: 'ctx-token', connection: {} }
const fakeCampaign = {
  id: 'camp-001',
  orgId: 'org-001',
  platform: 'google',
  providerData: { google: { campaignResourceName: 'customers/1234567890/campaigns/555' } },
}
const fakeAdSet = { id: 'adset-001', orgId: 'org-001', status: 'DRAFT', providerData: {} }
const fakeConn = { defaultAdAccountId: '1234567890', meta: { google: { loginCustomerId: '9999999999' } }, accessTokenEnc: {} }
const fakeResult = { resourceName: 'customers/1234567890/adGroups/444', id: '444' }

function makeReq(body: object) {
  return new Request('http://x/api/v1/ads/ad-sets', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Org-Id': 'org-001' },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  jest.clearAllMocks()
  requireMetaContext.mockResolvedValue(fakeCtx)
  getCampaign.mockResolvedValue(fakeCampaign)
  createAdSet.mockResolvedValue(fakeAdSet)
  updateAdSet.mockResolvedValue(undefined)
  getConnection.mockResolvedValue(fakeConn)
  decryptAccessToken.mockReturnValue('access-token')
  readDeveloperToken.mockReturnValue('dev-token')
  createAdGroup.mockResolvedValue(fakeResult)
})

describe('POST /api/v1/ads/ad-sets — Google adgroup type passthrough', () => {
  // Test 1: DISPLAY_STANDARD type is passed through to createAdGroup
  it('passes googleAds.type DISPLAY_STANDARD to createAdGroup', async () => {
    const res = await POST(
      makeReq({
        platform: 'google',
        input: { name: 'Display Ad Group', campaignId: 'camp-001' },
        googleAds: { type: 'DISPLAY_STANDARD', defaultCpcBidMajor: 0.75 },
      }) as any,
      { uid: 'user-001' } as any,
    )

    expect(res.status).toBe(201)
    expect(createAdGroup).toHaveBeenCalledTimes(1)

    const call = createAdGroup.mock.calls[0][0]
    expect(call.type).toBe('DISPLAY_STANDARD')
    expect(call.defaultCpcBidMajor).toBe(0.75)
    expect(call.customerId).toBe('1234567890')
    expect(call.loginCustomerId).toBe('9999999999')
    expect(call.campaignResourceName).toBe('customers/1234567890/campaigns/555')
  })

  // Test 2: No type provided → type arg is undefined (createAdGroup defaults to SEARCH_STANDARD)
  it('passes no type arg when googleAds.type is absent (createAdGroup defaults to SEARCH_STANDARD)', async () => {
    const res = await POST(
      makeReq({
        platform: 'google',
        input: { name: 'Search Ad Group', campaignId: 'camp-001' },
        googleAds: { defaultCpcBidMajor: 0.50 },
      }) as any,
      { uid: 'user-001' } as any,
    )

    expect(res.status).toBe(201)
    expect(createAdGroup).toHaveBeenCalledTimes(1)

    const call = createAdGroup.mock.calls[0][0]
    expect(call.type).toBeUndefined()
  })
})
