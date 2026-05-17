// __tests__/api/v1/ads/ad-sets/linkedin-route-dispatch.test.ts
// Verifies POST /api/v1/ads/ad-sets LinkedIn branch — Batch 3B.

import { POST } from '@/app/api/v1/ads/ad-sets/route'

// ─── Auth bypass ────────────────────────────────────────────────────────────
jest.mock('@/lib/api/auth', () => ({ withAuth: (_r: string, h: any) => h }))

// ─── requireMetaContext ──────────────────────────────────────────────────────
jest.mock('@/lib/ads/api-helpers', () => ({
  requireMetaContext: jest.fn(),
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

// ─── Connection helpers ───────────────────────────────────────────────────────
jest.mock('@/lib/ads/connections/store', () => ({
  getConnection: jest.fn(),
  decryptAccessToken: jest.fn().mockReturnValue('test-token'),
}))
jest.mock('@/lib/integrations/google_ads/oauth', () => ({
  readDeveloperToken: jest.fn().mockReturnValue('dev-token'),
}))

// ─── LinkedIn providers ───────────────────────────────────────────────────────
jest.mock('@/lib/ads/providers/google/adgroups', () => ({
  createAdGroup: jest.fn(),
}))
jest.mock('@/lib/ads/providers/linkedin/adsets', () => ({
  createCampaign: jest.fn().mockResolvedValue({ urn: 'urn:li:sponsoredCampaign:9999', id: '9999' }),
  updateCampaign: jest.fn().mockResolvedValue(undefined),
  archiveCampaign: jest.fn().mockResolvedValue(undefined),
  linkedinObjectiveFromCanonical: jest.fn().mockReturnValue('BRAND_AWARENESS'),
}))
jest.mock('@/lib/ads/providers/linkedin/mappers', () => ({
  linkedinObjectiveFromCanonical: jest.fn().mockReturnValue('BRAND_AWARENESS'),
}))

// ─── Imports after mocks ─────────────────────────────────────────────────────
const { requireMetaContext } = jest.requireMock('@/lib/ads/api-helpers')
const { createAdSet, updateAdSet } = jest.requireMock('@/lib/ads/adsets/store')
const { getCampaign } = jest.requireMock('@/lib/ads/campaigns/store')
const { getConnection, decryptAccessToken } = jest.requireMock('@/lib/ads/connections/store')

// ─── Shared stubs ────────────────────────────────────────────────────────────
const fakeCtx = { orgId: 'org-001', adAccountId: 'act_123', accessToken: 'ctx-token', connection: {} }

const fakeLinkedinCampaign = {
  id: 'camp-li-001',
  orgId: 'org-001',
  platform: 'linkedin',
  objective: 'BRAND_AWARENESS',
  providerData: {
    linkedin: { campaignGroupUrn: 'urn:li:sponsoredCampaignGroup:5555' },
  },
}

const fakeAdSet = {
  id: 'adset-li-001',
  orgId: 'org-001',
  status: 'DRAFT',
  providerData: {},
}

const fakeLinkedinConn = {
  meta: { linkedin: { selectedAdAccountUrn: 'urn:li:sponsoredAccount:12345' } },
  accessTokenEnc: {},
}

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
  getCampaign.mockResolvedValue(fakeLinkedinCampaign)
  createAdSet.mockResolvedValue(fakeAdSet)
  updateAdSet.mockResolvedValue(undefined)
  getConnection.mockResolvedValue(fakeLinkedinConn)
  decryptAccessToken.mockReturnValue('li-access-token')
})

describe('POST /api/v1/ads/ad-sets — LinkedIn Campaign creation', () => {
  // Test 1: success path — creates LinkedIn Campaign + stamps providerData.linkedin.campaignUrn
  it('creates LinkedIn Campaign and stamps providerData.linkedin.campaignUrn', async () => {
    const { createCampaign } = jest.requireMock('@/lib/ads/providers/linkedin/adsets')

    const res = await POST(
      makeReq({
        platform: 'linkedin',
        input: { name: 'LI AdSet', campaignId: 'camp-li-001' },
        linkedinAds: { campaignType: 'SPONSORED_UPDATES', dailyBudgetMajor: 50, currencyCode: 'USD' },
      }) as any,
      { uid: 'user-001' } as any,
    )

    expect(res.status).toBe(201)
    expect(createCampaign).toHaveBeenCalledTimes(1)

    const call = createCampaign.mock.calls[0][0]
    expect(call.accountUrn).toBe('urn:li:sponsoredAccount:12345')
    expect(call.campaignGroupUrn).toBe('urn:li:sponsoredCampaignGroup:5555')
    expect(call.campaignType).toBe('SPONSORED_UPDATES')
    expect(call.dailyBudgetMajor).toBe(50)

    expect(updateAdSet).toHaveBeenCalledTimes(1)
    const updateCall = updateAdSet.mock.calls[0][1]
    expect(updateCall.providerData.linkedin.campaignUrn).toBe('urn:li:sponsoredCampaign:9999')
  })

  // Test 2: returns 400 if parent campaign has no campaignGroupUrn
  it('returns 400 if parent campaign has no LinkedIn campaignGroupUrn', async () => {
    getCampaign.mockResolvedValue({
      ...fakeLinkedinCampaign,
      providerData: { linkedin: {} }, // no campaignGroupUrn
    })

    const res = await POST(
      makeReq({
        platform: 'linkedin',
        input: { name: 'LI AdSet', campaignId: 'camp-li-001' },
      }) as any,
      { uid: 'user-001' } as any,
    )

    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/Campaign Group URN/i)
  })

  // Test 3: returns 400 if connection missing
  it('returns 400 if no LinkedIn connection found for org', async () => {
    getConnection.mockResolvedValue(null)

    const res = await POST(
      makeReq({
        platform: 'linkedin',
        input: { name: 'LI AdSet', campaignId: 'camp-li-001' },
      }) as any,
      { uid: 'user-001' } as any,
    )

    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/LinkedIn ads connection/i)
  })

  // Test 4: returns 400 if selectedAdAccountUrn missing from connection meta
  it('returns 400 if selectedAdAccountUrn is missing from LinkedIn connection', async () => {
    getConnection.mockResolvedValue({
      meta: { linkedin: {} }, // no selectedAdAccountUrn
      accessTokenEnc: {},
    })

    const res = await POST(
      makeReq({
        platform: 'linkedin',
        input: { name: 'LI AdSet', campaignId: 'camp-li-001' },
      }) as any,
      { uid: 'user-001' } as any,
    )

    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/Ad Account URN/i)
  })

  // Test 5: stamps liCampaignType in providerData defaulting to SPONSORED_UPDATES
  it('defaults liCampaignType to SPONSORED_UPDATES when not specified', async () => {
    const res = await POST(
      makeReq({
        platform: 'linkedin',
        input: { name: 'LI AdSet', campaignId: 'camp-li-001' },
        // no linkedinAds.campaignType
      }) as any,
      { uid: 'user-001' } as any,
    )

    expect(res.status).toBe(201)
    const updateCall = updateAdSet.mock.calls[0][1]
    expect(updateCall.providerData.linkedin.liCampaignType).toBe('SPONSORED_UPDATES')
  })
})
