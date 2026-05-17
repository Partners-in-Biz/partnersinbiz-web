// __tests__/api/v1/ads/ads/linkedin-route-dispatch.test.ts
// Verifies POST /api/v1/ads/ads LinkedIn branch — Batch 3B.

import { POST } from '@/app/api/v1/ads/ads/route'

// ─── Auth bypass ────────────────────────────────────────────────────────────
jest.mock('@/lib/api/auth', () => ({ withAuth: (_r: string, h: any) => h }))

// ─── requireMetaContext ──────────────────────────────────────────────────────
jest.mock('@/lib/ads/api-helpers', () => ({
  requireMetaContext: jest.fn(),
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

// ─── Connection helpers ───────────────────────────────────────────────────────
jest.mock('@/lib/ads/connections/store', () => ({
  getConnection: jest.fn(),
  decryptAccessToken: jest.fn().mockReturnValue('test-token'),
}))
jest.mock('@/lib/integrations/google_ads/oauth', () => ({
  readDeveloperToken: jest.fn().mockReturnValue('dev-token'),
}))

// ─── Google ad providers (prevent actual imports) ────────────────────────────
jest.mock('@/lib/ads/providers/google/ads', () => ({
  createResponsiveSearchAd: jest.fn(),
}))
jest.mock('@/lib/ads/providers/google/display-ads', () => ({
  createResponsiveDisplayAd: jest.fn(),
}))
jest.mock('@/lib/ads/providers/google/shopping-ads', () => ({
  createProductAd: jest.fn(),
}))

// ─── LinkedIn creative provider ───────────────────────────────────────────────
jest.mock('@/lib/ads/providers/linkedin/ads', () => ({
  createCreative: jest.fn().mockResolvedValue({ urn: 'urn:li:sponsoredCreative:7777', id: '7777' }),
  updateCreative: jest.fn().mockResolvedValue(undefined),
  archiveCreative: jest.fn().mockResolvedValue(undefined),
}))

// ─── Imports after mocks ─────────────────────────────────────────────────────
const { requireMetaContext } = jest.requireMock('@/lib/ads/api-helpers')
const { createAd, updateAd } = jest.requireMock('@/lib/ads/ads/store')
const { getAdSet } = jest.requireMock('@/lib/ads/adsets/store')
const { getConnection, decryptAccessToken } = jest.requireMock('@/lib/ads/connections/store')

// ─── Shared stubs ────────────────────────────────────────────────────────────
const fakeCtx = { orgId: 'org-001', adAccountId: 'act_123', accessToken: 'ctx-token', connection: {} }

const fakeLinkedinAdSet = {
  id: 'adset-li-001',
  orgId: 'org-001',
  platform: 'linkedin',
  providerData: {
    linkedin: { campaignUrn: 'urn:li:sponsoredCampaign:9999' },
  },
}

const fakeAd = {
  id: 'ad-li-001',
  orgId: 'org-001',
  status: 'DRAFT',
  providerData: {},
}

const fakeLinkedinConn = {
  meta: { linkedin: { selectedAdAccountUrn: 'urn:li:sponsoredAccount:12345' } },
  accessTokenEnc: {},
}

const fakeReferenceUrn = 'urn:li:ugcPost:99887766'

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
  getAdSet.mockResolvedValue(fakeLinkedinAdSet)
  createAd.mockResolvedValue(fakeAd)
  updateAd.mockResolvedValue(undefined)
  getConnection.mockResolvedValue(fakeLinkedinConn)
  decryptAccessToken.mockReturnValue('li-access-token')
})

describe('POST /api/v1/ads/ads — LinkedIn Creative creation', () => {
  // Test 1: success — creates Creative + stamps providerData.linkedin.creativeUrn
  it('creates LinkedIn Creative and stamps providerData.linkedin.creativeUrn', async () => {
    const { createCreative } = jest.requireMock('@/lib/ads/providers/linkedin/ads')

    const res = await POST(
      makeReq({
        platform: 'linkedin',
        input: { name: 'LI Ad', adSetId: 'adset-li-001' },
        linkedinAds: { referenceUrn: fakeReferenceUrn },
      }) as any,
      { uid: 'user-001' } as any,
    )

    expect(res.status).toBe(201)
    expect(createCreative).toHaveBeenCalledTimes(1)

    const call = createCreative.mock.calls[0][0]
    expect(call.accountUrn).toBe('urn:li:sponsoredAccount:12345')
    expect(call.campaignUrn).toBe('urn:li:sponsoredCampaign:9999')
    expect(call.referenceUrn).toBe(fakeReferenceUrn)

    expect(updateAd).toHaveBeenCalledTimes(1)
    const updateCall = updateAd.mock.calls[0][1]
    expect(updateCall.providerData.linkedin.creativeUrn).toBe('urn:li:sponsoredCreative:7777')
    expect(updateCall.providerData.linkedin.contentReferenceUrn).toBe(fakeReferenceUrn)
  })

  // Test 2: returns 400 if linkedinAds.referenceUrn is omitted
  it('returns 400 if linkedinAds.referenceUrn is omitted', async () => {
    const res = await POST(
      makeReq({
        platform: 'linkedin',
        input: { name: 'LI Ad', adSetId: 'adset-li-001' },
        // no linkedinAds.referenceUrn
      }) as any,
      { uid: 'user-001' } as any,
    )

    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/referenceUrn/i)
  })

  // Test 3: returns 400 if linkedinAds.referenceUrn is empty string
  it('returns 400 if linkedinAds.referenceUrn is empty string', async () => {
    const res = await POST(
      makeReq({
        platform: 'linkedin',
        input: { name: 'LI Ad', adSetId: 'adset-li-001' },
        linkedinAds: { referenceUrn: '' },
      }) as any,
      { uid: 'user-001' } as any,
    )

    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/referenceUrn/i)
  })

  // Test 4: returns 400 if parent ad-set has no campaignUrn
  it('returns 400 if parent ad-set has no LinkedIn campaignUrn', async () => {
    getAdSet.mockResolvedValue({
      ...fakeLinkedinAdSet,
      providerData: { linkedin: {} }, // no campaignUrn
    })

    const res = await POST(
      makeReq({
        platform: 'linkedin',
        input: { name: 'LI Ad', adSetId: 'adset-li-001' },
        linkedinAds: { referenceUrn: fakeReferenceUrn },
      }) as any,
      { uid: 'user-001' } as any,
    )

    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/Campaign URN/i)
  })

  // Test 5: returns 400 if no LinkedIn connection found
  it('returns 400 if no LinkedIn ads connection for org', async () => {
    getConnection.mockResolvedValue(null)

    const res = await POST(
      makeReq({
        platform: 'linkedin',
        input: { name: 'LI Ad', adSetId: 'adset-li-001' },
        linkedinAds: { referenceUrn: fakeReferenceUrn },
      }) as any,
      { uid: 'user-001' } as any,
    )

    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/LinkedIn ads connection/i)
  })

  // Test 6: returns 400 if selectedAdAccountUrn missing from connection meta
  it('returns 400 if selectedAdAccountUrn is missing from LinkedIn connection', async () => {
    getConnection.mockResolvedValue({
      meta: { linkedin: {} }, // no selectedAdAccountUrn
      accessTokenEnc: {},
    })

    const res = await POST(
      makeReq({
        platform: 'linkedin',
        input: { name: 'LI Ad', adSetId: 'adset-li-001' },
        linkedinAds: { referenceUrn: fakeReferenceUrn },
      }) as any,
      { uid: 'user-001' } as any,
    )

    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/Ad Account URN/i)
  })
})
