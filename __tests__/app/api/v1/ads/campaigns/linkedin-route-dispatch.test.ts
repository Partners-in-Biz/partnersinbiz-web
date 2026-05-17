// __tests__/app/api/v1/ads/campaigns/linkedin-route-dispatch.test.ts
// LinkedIn platform dispatch tests for campaign routes — Sub-3b Phase 2 Batch 3A
import { POST } from '@/app/api/v1/ads/campaigns/route'
import { POST as launchPOST } from '@/app/api/v1/ads/campaigns/[id]/launch/route'
import { POST as pausePOST } from '@/app/api/v1/ads/campaigns/[id]/pause/route'

jest.mock('@/lib/api/auth', () => ({ withAuth: (_r: string, h: any) => h }))

jest.mock('@/lib/ads/campaigns/store', () => ({
  listCampaigns: jest.fn(),
  createCampaign: jest.fn(),
  getCampaign: jest.fn(),
  updateCampaign: jest.fn(),
  deleteCampaign: jest.fn(),
  setCampaignMetaId: jest.fn(),
}))

jest.mock('@/lib/ads/api-helpers', () => ({
  requireMetaContext: jest.fn(),
}))

jest.mock('@/lib/ads/providers/meta', () => ({
  metaProvider: { upsertCampaign: jest.fn() },
}))

jest.mock('@/lib/ads/providers/meta/campaigns', () => ({
  deleteCampaign: jest.fn(),
}))

jest.mock('@/lib/ads/providers/google/campaigns', () => ({
  createSearchCampaign: jest.fn(),
  updateCampaign: jest.fn(),
  pauseCampaign: jest.fn(),
  resumeCampaign: jest.fn(),
  removeCampaign: jest.fn(),
}))

jest.mock('@/lib/ads/providers/linkedin/campaigns', () => ({
  createCampaignGroup: jest.fn().mockResolvedValue({
    urn: 'urn:li:sponsoredCampaignGroup:98765',
    id: '98765',
  }),
  updateCampaignGroup: jest.fn().mockResolvedValue(undefined),
  pauseCampaignGroup: jest.fn().mockResolvedValue(undefined),
  resumeCampaignGroup: jest.fn().mockResolvedValue(undefined),
  archiveCampaignGroup: jest.fn().mockResolvedValue(undefined),
}))

jest.mock('@/lib/ads/connections/store', () => ({
  getConnection: jest.fn().mockResolvedValue({
    id: 'conn_li1',
    orgId: 'org-1',
    platform: 'linkedin',
    accessTokenEnc: { iv: 'iv', tag: 'tag', data: 'data' },
    meta: { linkedin: { selectedAdAccountUrn: 'urn:li:sponsoredAccount:123' } },
  }),
  decryptAccessToken: jest.fn().mockReturnValue('li-access-token'),
}))

jest.mock('@/lib/integrations/google_ads/oauth', () => ({
  readDeveloperToken: jest.fn().mockReturnValue('test-dev-token'),
}))

jest.mock('@/lib/ads/activity', () => ({
  logCampaignActivity: jest.fn().mockResolvedValue(undefined),
}))

jest.mock('@/lib/ads/notifications', () => ({
  notifyCampaignLaunched: jest.fn().mockResolvedValue(undefined),
  notifyCampaignPaused: jest.fn().mockResolvedValue(undefined),
}))

const store = jest.requireMock('@/lib/ads/campaigns/store')
const helpers = jest.requireMock('@/lib/ads/api-helpers')
const linkedinCampaigns = jest.requireMock('@/lib/ads/providers/linkedin/campaigns')
const connStore = jest.requireMock('@/lib/ads/connections/store')

beforeEach(() => jest.clearAllMocks())

const baseCtx = {
  orgId: 'org-1',
  accessToken: 'meta-tok',
  adAccountId: 'act_42',
  connection: { id: 'conn_meta' },
}

const linkedinCampaign = {
  id: 'cmp_li1',
  orgId: 'org-1',
  platform: 'linkedin',
  name: 'LinkedIn Campaign Group',
  status: 'DRAFT',
  objective: 'BRAND_AWARENESS',
  providerData: {
    linkedin: { campaignGroupUrn: 'urn:li:sponsoredCampaignGroup:98765', liStatus: 'DRAFT' },
  },
}

// ── POST /api/v1/ads/campaigns — LinkedIn create ──────────────────────────────

describe('POST /api/v1/ads/campaigns — LinkedIn dispatch', () => {
  it('creates Campaign Group on LinkedIn and stamps providerData.linkedin.campaignGroupUrn', async () => {
    helpers.requireMetaContext.mockResolvedValueOnce(baseCtx)
    const created = { ...linkedinCampaign, providerData: {} }
    store.createCampaign.mockResolvedValueOnce(created)
    store.updateCampaign.mockResolvedValueOnce(undefined)

    const res = await POST(
      new Request('http://x', {
        method: 'POST',
        headers: { 'X-Org-Id': 'org-1', 'Content-Type': 'application/json' },
        body: JSON.stringify({
          platform: 'linkedin',
          input: { name: 'LinkedIn Campaign Group', objective: 'BRAND_AWARENESS', status: 'DRAFT', specialAdCategories: [], cboEnabled: false },
          linkedinAds: { totalBudgetMajor: 500, currencyCode: 'USD' },
        }),
      }) as any,
      { uid: 'u1' } as any,
      {} as any,
    )
    const body = await res.json()
    expect(res.status).toBe(201)
    expect(body.success).toBe(true)
    expect(store.createCampaign).toHaveBeenCalledWith(
      expect.objectContaining({ platform: 'linkedin' }),
    )
    expect(linkedinCampaigns.createCampaignGroup).toHaveBeenCalledWith(
      expect.objectContaining({
        accountUrn: 'urn:li:sponsoredAccount:123',
        accessToken: 'li-access-token',
        totalBudgetMajor: 500,
        currencyCode: 'USD',
      }),
    )
    expect(store.updateCampaign).toHaveBeenCalledWith(
      created.id,
      expect.objectContaining({
        providerData: expect.objectContaining({
          linkedin: expect.objectContaining({ campaignGroupUrn: 'urn:li:sponsoredCampaignGroup:98765' }),
        }),
      }),
    )
  })

  it('returns 400 if no LinkedIn connection found', async () => {
    helpers.requireMetaContext.mockResolvedValueOnce(baseCtx)
    store.createCampaign.mockResolvedValueOnce({ ...linkedinCampaign, providerData: {} })
    connStore.getConnection.mockResolvedValueOnce(null)

    const res = await POST(
      new Request('http://x', {
        method: 'POST',
        headers: { 'X-Org-Id': 'org-1', 'Content-Type': 'application/json' },
        body: JSON.stringify({
          platform: 'linkedin',
          input: { name: 'LI Campaign', objective: 'BRAND_AWARENESS', status: 'DRAFT', specialAdCategories: [], cboEnabled: false },
        }),
      }) as any,
      { uid: 'u1' } as any,
      {} as any,
    )
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/No LinkedIn ads connection/i)
  })

  it('returns 400 if selectedAdAccountUrn is missing from connection meta', async () => {
    helpers.requireMetaContext.mockResolvedValueOnce(baseCtx)
    store.createCampaign.mockResolvedValueOnce({ ...linkedinCampaign, providerData: {} })
    connStore.getConnection.mockResolvedValueOnce({
      id: 'conn_li_nourn',
      orgId: 'org-1',
      platform: 'linkedin',
      accessTokenEnc: { iv: 'iv', tag: 'tag', data: 'data' },
      meta: { linkedin: {} }, // no selectedAdAccountUrn
    })

    const res = await POST(
      new Request('http://x', {
        method: 'POST',
        headers: { 'X-Org-Id': 'org-1', 'Content-Type': 'application/json' },
        body: JSON.stringify({
          platform: 'linkedin',
          input: { name: 'LI Campaign', objective: 'BRAND_AWARENESS', status: 'DRAFT', specialAdCategories: [], cboEnabled: false },
        }),
      }) as any,
      { uid: 'u1' } as any,
      {} as any,
    )
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/No Ad Account URN/i)
  })
})

// ── POST /api/v1/ads/campaigns/[id]/launch — LinkedIn resume ─────────────────

describe('POST /api/v1/ads/campaigns/[id]/launch — LinkedIn dispatch', () => {
  it('flips status ACTIVE locally and calls resumeCampaignGroup', async () => {
    const afterUpdate = { ...linkedinCampaign, status: 'ACTIVE' }
    store.getCampaign
      .mockResolvedValueOnce(linkedinCampaign)
      .mockResolvedValueOnce(afterUpdate)
    store.updateCampaign.mockResolvedValueOnce(undefined)

    const res = await launchPOST(
      new Request('http://x', { method: 'POST', headers: { 'X-Org-Id': 'org-1' } }) as any,
      { uid: 'u1' } as any,
      { params: Promise.resolve({ id: 'cmp_li1' }) },
    )
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(store.updateCampaign).toHaveBeenCalledWith('cmp_li1', { status: 'ACTIVE' })
    expect(linkedinCampaigns.resumeCampaignGroup).toHaveBeenCalledWith(
      expect.objectContaining({
        accountUrn: 'urn:li:sponsoredAccount:123',
        accessToken: 'li-access-token',
        groupUrn: 'urn:li:sponsoredCampaignGroup:98765',
      }),
    )
    // Meta must NOT be called
    const metaProvider = jest.requireMock('@/lib/ads/providers/meta')
    expect(metaProvider.metaProvider.upsertCampaign).not.toHaveBeenCalled()
  })

  it('returns 400 if campaignGroupUrn is missing (campaign was never pushed to LinkedIn)', async () => {
    const noPushCampaign = { ...linkedinCampaign, providerData: { linkedin: {} } }
    store.getCampaign.mockResolvedValueOnce(noPushCampaign)

    const res = await launchPOST(
      new Request('http://x', { method: 'POST', headers: { 'X-Org-Id': 'org-1' } }) as any,
      { uid: 'u1' } as any,
      { params: Promise.resolve({ id: 'cmp_li1' }) },
    )
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/create first/i)
  })
})

// ── POST /api/v1/ads/campaigns/[id]/pause — LinkedIn pause ───────────────────

describe('POST /api/v1/ads/campaigns/[id]/pause — LinkedIn dispatch', () => {
  it('flips local status PAUSED + best-effort syncs to LinkedIn', async () => {
    const afterPause = { ...linkedinCampaign, status: 'PAUSED' }
    store.getCampaign
      .mockResolvedValueOnce(linkedinCampaign)
      .mockResolvedValueOnce(afterPause)
    store.updateCampaign.mockResolvedValueOnce(undefined)

    const res = await pausePOST(
      new Request('http://x', { method: 'POST', headers: { 'X-Org-Id': 'org-1' } }) as any,
      { uid: 'u1' } as any,
      { params: Promise.resolve({ id: 'cmp_li1' }) },
    )
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(store.updateCampaign).toHaveBeenCalledWith('cmp_li1', { status: 'PAUSED' })
    expect(linkedinCampaigns.pauseCampaignGroup).toHaveBeenCalledWith(
      expect.objectContaining({
        accountUrn: 'urn:li:sponsoredAccount:123',
        groupUrn: 'urn:li:sponsoredCampaignGroup:98765',
      }),
    )
  })

  it('still returns PAUSED locally even if pauseCampaignGroup throws', async () => {
    const afterPause = { ...linkedinCampaign, status: 'PAUSED' }
    store.getCampaign
      .mockResolvedValueOnce(linkedinCampaign)
      .mockResolvedValueOnce(afterPause)
    store.updateCampaign.mockResolvedValueOnce(undefined)
    linkedinCampaigns.pauseCampaignGroup.mockRejectedValueOnce(new Error('LinkedIn API down'))

    const res = await pausePOST(
      new Request('http://x', { method: 'POST', headers: { 'X-Org-Id': 'org-1' } }) as any,
      { uid: 'u1' } as any,
      { params: Promise.resolve({ id: 'cmp_li1' }) },
    )
    expect(res.status).toBe(200)
    expect(store.updateCampaign).toHaveBeenCalledWith('cmp_li1', { status: 'PAUSED' })
    const body = await res.json()
    expect(body.success).toBe(true)
  })
})
