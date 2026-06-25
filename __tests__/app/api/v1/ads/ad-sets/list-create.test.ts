// __tests__/app/api/v1/ads/ad-sets/list-create.test.ts
import { GET, POST } from '@/app/api/v1/ads/ad-sets/route'

jest.mock('@/lib/api/auth', () => ({ withAuth: (_r: string, h: any) => h }))
jest.mock('@/lib/ads/adsets/store', () => ({
  listAdSets: jest.fn(),
  createAdSet: jest.fn(),
}))
jest.mock('@/lib/ads/campaigns/store', () => ({
  getCampaign: jest.fn(),
}))
jest.mock('@/lib/ads/api-helpers', () => ({
  requireMetaContext: jest.fn(),
}))

const store = jest.requireMock('@/lib/ads/adsets/store')
const campaignsStore = jest.requireMock('@/lib/ads/campaigns/store')
const helpers = jest.requireMock('@/lib/ads/api-helpers')

// resetAllMocks (not clearAllMocks) so leftover mockResolvedValueOnce queue
// entries from validation/not-found tests — which return before
// requireMetaContext is called — don't leak into later tests.
beforeEach(() => jest.resetAllMocks())

const baseConn = {
  orgId: 'org_1',
  accessToken: 'tok',
  adAccountId: 'act_42',
  connection: { id: 'conn_1' },
}

const baseCampaign = {
  id: 'cmp_1',
  orgId: 'org_1',
  name: 'Campaign',
  status: 'ACTIVE',
  providerData: { meta: { id: 'meta_cmp_123' } },
}

describe('GET /api/v1/ads/ad-sets', () => {
  it('returns ad sets for org', async () => {
    const adSets = [{ id: 'ads_1', orgId: 'org_1', name: 'A', status: 'DRAFT' }]
    store.listAdSets.mockResolvedValueOnce(adSets)
    const res = await GET(
      new Request('http://x', { headers: { 'X-Org-Id': 'org_1' } }) as any,
      { uid: 'u1' } as any,
      {} as any,
    )
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.success).toBe(true)
    expect(body.data).toHaveLength(1)
    expect(store.listAdSets).toHaveBeenCalledWith(
      expect.objectContaining({ orgId: 'org_1' }),
    )
  })

  it('passes status filter when ?status is set', async () => {
    store.listAdSets.mockResolvedValueOnce([])
    await GET(
      new Request('http://x?status=ACTIVE', { headers: { 'X-Org-Id': 'org_1' } }) as any,
      { uid: 'u1' } as any,
      {} as any,
    )
    expect(store.listAdSets).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'ACTIVE' }),
    )
  })

  it('passes campaignId filter when ?campaignId is set', async () => {
    store.listAdSets.mockResolvedValueOnce([])
    await GET(
      new Request('http://x?campaignId=cmp_1', { headers: { 'X-Org-Id': 'org_1' } }) as any,
      { uid: 'u1' } as any,
      {} as any,
    )
    expect(store.listAdSets).toHaveBeenCalledWith(
      expect.objectContaining({ campaignId: 'cmp_1' }),
    )
  })

  it('returns 400 when X-Org-Id is missing', async () => {
    const res = await GET(new Request('http://x') as any, { uid: 'u1' } as any, {} as any)
    expect(res.status).toBe(400)
  })
})

describe('POST /api/v1/ads/ad-sets', () => {
  it('creates ad set with adAccountId from connection and validates parent campaign', async () => {
    helpers.requireMetaContext.mockResolvedValueOnce(baseConn)
    campaignsStore.getCampaign.mockResolvedValueOnce(baseCampaign)
    const created = {
      id: 'ads_new',
      orgId: 'org_1',
      campaignId: 'cmp_1',
      name: 'Test AdSet',
      status: 'DRAFT',
    }
    store.createAdSet.mockResolvedValueOnce(created)

    const res = await POST(
      new Request('http://x', {
        method: 'POST',
        headers: { 'X-Org-Id': 'org_1', 'Content-Type': 'application/json' },
        body: JSON.stringify({
          input: {
            campaignId: 'cmp_1',
            name: 'Test AdSet',
            status: 'DRAFT',
            optimizationGoal: 'LINK_CLICKS',
            billingEvent: 'IMPRESSIONS',
            targeting: {},
            dailyBudget: 1000,
          },
        }),
      }) as any,
      { uid: 'u1' } as any,
      {} as any,
    )
    const body = await res.json()
    expect(res.status).toBe(201)
    expect(body.success).toBe(true)
    expect(store.createAdSet).toHaveBeenCalledWith(
      expect.objectContaining({ orgId: 'org_1' }),
    )
    expect(campaignsStore.getCampaign).toHaveBeenCalledWith('cmp_1')
  })

  it('returns 400 when name is missing', async () => {
    helpers.requireMetaContext.mockResolvedValueOnce(baseConn)
    const res = await POST(
      new Request('http://x', {
        method: 'POST',
        headers: { 'X-Org-Id': 'org_1', 'Content-Type': 'application/json' },
        body: JSON.stringify({ input: { campaignId: 'cmp_1' } }), // name missing
      }) as any,
      { uid: 'u1' } as any,
      {} as any,
    )
    expect(res.status).toBe(400)
  })

  it('returns 400 when campaignId is missing', async () => {
    helpers.requireMetaContext.mockResolvedValueOnce(baseConn)
    const res = await POST(
      new Request('http://x', {
        method: 'POST',
        headers: { 'X-Org-Id': 'org_1', 'Content-Type': 'application/json' },
        body: JSON.stringify({ input: { name: 'Test' } }), // campaignId missing
      }) as any,
      { uid: 'u1' } as any,
      {} as any,
    )
    expect(res.status).toBe(400)
  })

  it('returns 404 when campaign does not exist', async () => {
    helpers.requireMetaContext.mockResolvedValueOnce(baseConn)
    campaignsStore.getCampaign.mockResolvedValueOnce(null)
    const res = await POST(
      new Request('http://x', {
        method: 'POST',
        headers: { 'X-Org-Id': 'org_1', 'Content-Type': 'application/json' },
        body: JSON.stringify({ input: { campaignId: 'cmp_missing', name: 'Test' } }),
      }) as any,
      { uid: 'u1' } as any,
      {} as any,
    )
    expect(res.status).toBe(404)
  })

  it('returns 404 when campaign belongs to different org (tenant isolation)', async () => {
    helpers.requireMetaContext.mockResolvedValueOnce(baseConn)
    campaignsStore.getCampaign.mockResolvedValueOnce({ ...baseCampaign, orgId: 'org_other' })
    const res = await POST(
      new Request('http://x', {
        method: 'POST',
        headers: { 'X-Org-Id': 'org_1', 'Content-Type': 'application/json' },
        body: JSON.stringify({ input: { campaignId: 'cmp_1', name: 'Test' } }),
      }) as any,
      { uid: 'u1' } as any,
      {} as any,
    )
    expect(res.status).toBe(404)
  })

  it('short-circuits with connection error when requireMetaContext returns Response', async () => {
    const errRes = new Response(JSON.stringify({ success: false, error: 'no conn' }), { status: 404 })
    campaignsStore.getCampaign.mockResolvedValueOnce(baseCampaign)
    helpers.requireMetaContext.mockResolvedValueOnce(errRes)
    const res = await POST(
      new Request('http://x', {
        method: 'POST',
        headers: { 'X-Org-Id': 'org_1', 'Content-Type': 'application/json' },
        body: JSON.stringify({ input: { campaignId: 'cmp_1', name: 'Test' } }),
      }) as any,
      { uid: 'u1' } as any,
      {} as any,
    )
    expect(res.status).toBe(404)
  })
})
