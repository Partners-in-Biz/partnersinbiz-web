// __tests__/api/v1/ads/ads/google-route-dispatch.test.ts
// Verifies POST /api/v1/ads/ads branches RSA vs RDA based on body assets.
// Additive — Sub-3a Phase 3 Batch 3.

import { POST } from '@/app/api/v1/ads/ads/route'

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

// ─── Ad + AdSet stores ───────────────────────────────────────────────────────
jest.mock('@/lib/ads/ads/store', () => ({
  createAd: jest.fn(),
  updateAd: jest.fn(),
  listAds: jest.fn(),
}))
jest.mock('@/lib/ads/adsets/store', () => ({
  getAdSet: jest.fn(),
}))

// ─── Google connection helpers ───────────────────────────────────────────────
jest.mock('@/lib/ads/connections/store', () => ({
  getConnection: jest.fn(),
  decryptAccessToken: jest.fn(),
}))
jest.mock('@/lib/integrations/google_ads/oauth', () => ({
  readDeveloperToken: jest.fn(),
}))

// ─── Google ad providers ─────────────────────────────────────────────────────
jest.mock('@/lib/ads/providers/google/ads', () => ({
  createResponsiveSearchAd: jest.fn(),
}))
jest.mock('@/lib/ads/providers/google/display-ads', () => ({
  createResponsiveDisplayAd: jest.fn(),
}))
jest.mock('@/lib/ads/providers/google/shopping-ads', () => ({
  createProductAd: jest.fn().mockResolvedValue({ resourceName: 'customers/1234567890/adGroupAds/888', id: '888' }),
}))

// ─── Imports after mocks ─────────────────────────────────────────────────────
const { requireMetaContext } = jest.requireMock('@/lib/ads/api-helpers')
const { createAd, updateAd } = jest.requireMock('@/lib/ads/ads/store')
const { getAdSet } = jest.requireMock('@/lib/ads/adsets/store')
const { getConnection, decryptAccessToken } = jest.requireMock('@/lib/ads/connections/store')
const { readDeveloperToken } = jest.requireMock('@/lib/integrations/google_ads/oauth')
const { createResponsiveSearchAd } = jest.requireMock('@/lib/ads/providers/google/ads')
const { createResponsiveDisplayAd } = jest.requireMock('@/lib/ads/providers/google/display-ads')
const { createProductAd } = jest.requireMock('@/lib/ads/providers/google/shopping-ads')

// ─── Shared stubs ────────────────────────────────────────────────────────────
const fakeCtx = { orgId: 'org-001', adAccountId: 'act_123', accessToken: 'ctx-token', connection: {} }
const fakeAdSet = {
  id: 'adset-001',
  orgId: 'org-001',
  platform: 'google',
  providerData: { google: { adGroupResourceName: 'customers/1234567890/adGroups/777' } },
}
const fakeAd = {
  id: 'ad-001',
  orgId: 'org-001',
  status: 'DRAFT',
  providerData: {},
}
const fakeConn = {
  defaultAdAccountId: '1234567890',
  meta: { google: { loginCustomerId: '9999999999' } },
  accessTokenEnc: {},
}
const fakeResult = { resourceName: 'customers/1234567890/adGroupAds/888', id: '888' }

const validRsaAssets = {
  headlines: [{ text: 'Headline 1' }, { text: 'Headline 2' }, { text: 'Headline 3' }],
  descriptions: [{ text: 'Description 1' }, { text: 'Description 2' }],
  finalUrls: ['https://example.com'],
}

const validRdaAssets = {
  marketingImages: ['https://img.example.com/marketing.jpg'],
  squareMarketingImages: ['https://img.example.com/square.jpg'],
  headlines: ['Short headline'],
  longHeadlines: ['A longer headline for display'],
  descriptions: ['A description for the ad'],
  businessName: 'Acme Corp',
  finalUrls: ['https://example.com'],
}

function makeReq(body: object) {
  return new Request('http://x/api/v1/ads/ads', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Org-Id': 'org-001' },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  jest.clearAllMocks()
  requireMetaContext.mockResolvedValue(fakeCtx)
  getAdSet.mockResolvedValue(fakeAdSet)
  createAd.mockResolvedValue(fakeAd)
  updateAd.mockResolvedValue(undefined)
  getConnection.mockResolvedValue(fakeConn)
  decryptAccessToken.mockReturnValue('access-token')
  readDeveloperToken.mockReturnValue('dev-token')
  createResponsiveSearchAd.mockResolvedValue(fakeResult)
  createResponsiveDisplayAd.mockResolvedValue(fakeResult)
  createProductAd.mockResolvedValue({ resourceName: 'customers/1234567890/adGroupAds/888', id: '888' })
})

describe('POST /api/v1/ads/ads — Google dispatch branching', () => {
  // Test 1: rdaAssets present → createResponsiveDisplayAd called
  it('calls createResponsiveDisplayAd when rdaAssets is present', async () => {
    const res = await POST(
      makeReq({
        platform: 'google',
        input: { name: 'Display Ad', adSetId: 'adset-001' },
        rdaAssets: validRdaAssets,
      }) as any,
      { uid: 'user-001' } as any,
    )

    expect(res.status).toBe(201)
    expect(createResponsiveDisplayAd).toHaveBeenCalledTimes(1)
    expect(createResponsiveSearchAd).not.toHaveBeenCalled()

    const call = createResponsiveDisplayAd.mock.calls[0][0]
    expect(call.customerId).toBe('1234567890')
    expect(call.loginCustomerId).toBe('9999999999')
    expect(call.adGroupResourceName).toBe('customers/1234567890/adGroups/777')
    expect(call.rdaAssets).toEqual(validRdaAssets)
  })

  // Test 2: rsaAssets present → createResponsiveSearchAd called
  it('calls createResponsiveSearchAd when rsaAssets is present', async () => {
    const res = await POST(
      makeReq({
        platform: 'google',
        input: { name: 'Search Ad', adSetId: 'adset-001' },
        rsaAssets: validRsaAssets,
      }) as any,
      { uid: 'user-001' } as any,
    )

    expect(res.status).toBe(201)
    expect(createResponsiveSearchAd).toHaveBeenCalledTimes(1)
    expect(createResponsiveDisplayAd).not.toHaveBeenCalled()

    const call = createResponsiveSearchAd.mock.calls[0][0]
    expect(call.rsaAssets).toEqual(validRsaAssets)
  })

  // Test 3: neither rsaAssets nor rdaAssets nor productAd → 400
  it('returns 400 when neither rsaAssets, rdaAssets, nor productAd is provided', async () => {
    const res = await POST(
      makeReq({
        platform: 'google',
        input: { name: 'Bare Ad', adSetId: 'adset-001' },
      }) as any,
      { uid: 'user-001' } as any,
    )

    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/rsaAssets|rdaAssets|productAd/i)
    expect(createResponsiveSearchAd).not.toHaveBeenCalled()
    expect(createResponsiveDisplayAd).not.toHaveBeenCalled()
  })

  // ─── ProductAd tests (Sub-3a Phase 4 Batch 3 F) ───────────────────────────

  // Test 4: productAd: true → createProductAd called
  it('calls createProductAd when productAd is true', async () => {
    const res = await POST(
      makeReq({
        platform: 'google',
        input: { name: 'Shopping Product Ad', adSetId: 'adset-001' },
        productAd: true,
      }) as any,
      { uid: 'user-001' } as any,
    )

    expect(res.status).toBe(201)
    expect(createProductAd).toHaveBeenCalledTimes(1)

    const call = createProductAd.mock.calls[0][0]
    expect(call.customerId).toBe('1234567890')
    expect(call.loginCustomerId).toBe('9999999999')
    expect(call.adGroupResourceName).toBe('customers/1234567890/adGroups/777')
    expect(call.canonical).toEqual(fakeAd)
  })

  // Test 5: productAd: true does not call RSA or RDA helpers
  it('does not call RSA or RDA helpers when productAd is true', async () => {
    await POST(
      makeReq({
        platform: 'google',
        input: { name: 'Shopping Product Ad', adSetId: 'adset-001' },
        productAd: true,
      }) as any,
      { uid: 'user-001' } as any,
    )

    expect(createResponsiveSearchAd).not.toHaveBeenCalled()
    expect(createResponsiveDisplayAd).not.toHaveBeenCalled()
    expect(createProductAd).toHaveBeenCalledTimes(1)
  })

  // Test 6: neither rsaAssets, rdaAssets, nor productAd → 400 with updated error message
  it('returns 400 error mentioning Shopping when no ad type is specified', async () => {
    const res = await POST(
      makeReq({
        platform: 'google',
        input: { name: 'No Type Ad', adSetId: 'adset-001' },
      }) as any,
      { uid: 'user-001' } as any,
    )

    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/Shopping/i)
    expect(createProductAd).not.toHaveBeenCalled()
    expect(createResponsiveSearchAd).not.toHaveBeenCalled()
    expect(createResponsiveDisplayAd).not.toHaveBeenCalled()
  })
})
