// __tests__/app/api/v1/ads/ads/list-create.test.ts
import { GET, POST } from '@/app/api/v1/ads/ads/route'

jest.mock('@/lib/api/auth', () => ({ withAuth: (_r: string, h: any) => h }))
jest.mock('@/lib/ads/ads/store', () => ({
  listAds: jest.fn(),
  createAd: jest.fn(),
}))
jest.mock('@/lib/ads/adsets/store', () => ({
  getAdSet: jest.fn(),
}))
jest.mock('@/lib/ads/api-helpers', () => ({
  requireMetaContext: jest.fn(),
}))

const store = jest.requireMock('@/lib/ads/ads/store')
const adSetsStore = jest.requireMock('@/lib/ads/adsets/store')
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

const baseAdSet = {
  id: 'ads_1',
  orgId: 'org_1',
  campaignId: 'cmp_1',
  name: 'AdSet',
  status: 'ACTIVE',
  providerData: { meta: { id: 'meta_ads_123' } },
}

describe('GET /api/v1/ads/ads', () => {
  it('returns ads for org', async () => {
    const ads = [{ id: 'ad_1', orgId: 'org_1', name: 'A', status: 'DRAFT' }]
    store.listAds.mockResolvedValueOnce(ads)
    const res = await GET(
      new Request('http://x', { headers: { 'X-Org-Id': 'org_1' } }) as any,
      { uid: 'u1' } as any,
      {} as any,
    )
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.success).toBe(true)
    expect(body.data).toHaveLength(1)
    expect(store.listAds).toHaveBeenCalledWith(
      expect.objectContaining({ orgId: 'org_1' }),
    )
  })

  it('passes status filter when ?status is set', async () => {
    store.listAds.mockResolvedValueOnce([])
    await GET(
      new Request('http://x?status=ACTIVE', { headers: { 'X-Org-Id': 'org_1' } }) as any,
      { uid: 'u1' } as any,
      {} as any,
    )
    expect(store.listAds).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'ACTIVE' }),
    )
  })

  it('passes adSetId filter when ?adSetId is set', async () => {
    store.listAds.mockResolvedValueOnce([])
    await GET(
      new Request('http://x?adSetId=ads_1', { headers: { 'X-Org-Id': 'org_1' } }) as any,
      { uid: 'u1' } as any,
      {} as any,
    )
    expect(store.listAds).toHaveBeenCalledWith(
      expect.objectContaining({ adSetId: 'ads_1' }),
    )
  })

  it('passes campaignId filter when ?campaignId is set', async () => {
    store.listAds.mockResolvedValueOnce([])
    await GET(
      new Request('http://x?campaignId=cmp_1', { headers: { 'X-Org-Id': 'org_1' } }) as any,
      { uid: 'u1' } as any,
      {} as any,
    )
    expect(store.listAds).toHaveBeenCalledWith(
      expect.objectContaining({ campaignId: 'cmp_1' }),
    )
  })

  it('returns 400 when X-Org-Id is missing', async () => {
    const res = await GET(new Request('http://x') as any, { uid: 'u1' } as any, {} as any)
    expect(res.status).toBe(400)
  })
})

describe('POST /api/v1/ads/ads', () => {
  it('creates ad with adSetId and validates parent ad set', async () => {
    helpers.requireMetaContext.mockResolvedValueOnce(baseConn)
    adSetsStore.getAdSet.mockResolvedValueOnce(baseAdSet)
    const created = {
      id: 'ad_new',
      orgId: 'org_1',
      adSetId: 'ads_1',
      campaignId: 'cmp_1',
      name: 'Test Ad',
      status: 'DRAFT',
    }
    store.createAd.mockResolvedValueOnce(created)

    const res = await POST(
      new Request('http://x', {
        method: 'POST',
        headers: { 'X-Org-Id': 'org_1', 'Content-Type': 'application/json' },
        body: JSON.stringify({
          input: {
            adSetId: 'ads_1',
            campaignId: 'cmp_1',
            name: 'Test Ad',
            status: 'DRAFT',
            format: 'SINGLE_IMAGE',
            creativeIds: [],
            copy: { primaryText: 'Hello', headline: 'World' },
          },
        }),
      }) as any,
      { uid: 'u1' } as any,
      {} as any,
    )
    const body = await res.json()
    expect(res.status).toBe(201)
    expect(body.success).toBe(true)
    expect(store.createAd).toHaveBeenCalledWith(
      expect.objectContaining({ orgId: 'org_1' }),
    )
    expect(adSetsStore.getAdSet).toHaveBeenCalledWith('ads_1')
  })

  it('returns 400 when name is missing', async () => {
    helpers.requireMetaContext.mockResolvedValueOnce(baseConn)
    const res = await POST(
      new Request('http://x', {
        method: 'POST',
        headers: { 'X-Org-Id': 'org_1', 'Content-Type': 'application/json' },
        body: JSON.stringify({ input: { adSetId: 'ads_1' } }), // name missing
      }) as any,
      { uid: 'u1' } as any,
      {} as any,
    )
    expect(res.status).toBe(400)
  })

  it('returns 400 when adSetId is missing', async () => {
    helpers.requireMetaContext.mockResolvedValueOnce(baseConn)
    const res = await POST(
      new Request('http://x', {
        method: 'POST',
        headers: { 'X-Org-Id': 'org_1', 'Content-Type': 'application/json' },
        body: JSON.stringify({ input: { name: 'Test' } }), // adSetId missing
      }) as any,
      { uid: 'u1' } as any,
      {} as any,
    )
    expect(res.status).toBe(400)
  })

  it('returns 404 when ad set does not exist', async () => {
    helpers.requireMetaContext.mockResolvedValueOnce(baseConn)
    adSetsStore.getAdSet.mockResolvedValueOnce(null)
    const res = await POST(
      new Request('http://x', {
        method: 'POST',
        headers: { 'X-Org-Id': 'org_1', 'Content-Type': 'application/json' },
        body: JSON.stringify({ input: { adSetId: 'ads_missing', name: 'Test' } }),
      }) as any,
      { uid: 'u1' } as any,
      {} as any,
    )
    expect(res.status).toBe(404)
  })

  it('returns 404 when ad set belongs to different org (tenant isolation)', async () => {
    helpers.requireMetaContext.mockResolvedValueOnce(baseConn)
    adSetsStore.getAdSet.mockResolvedValueOnce({ ...baseAdSet, orgId: 'org_other' })
    const res = await POST(
      new Request('http://x', {
        method: 'POST',
        headers: { 'X-Org-Id': 'org_1', 'Content-Type': 'application/json' },
        body: JSON.stringify({ input: { adSetId: 'ads_1', name: 'Test' } }),
      }) as any,
      { uid: 'u1' } as any,
      {} as any,
    )
    expect(res.status).toBe(404)
  })

  it('short-circuits with connection error when requireMetaContext returns Response', async () => {
    const errRes = new Response(JSON.stringify({ success: false, error: 'no conn' }), { status: 404 })
    adSetsStore.getAdSet.mockResolvedValueOnce(baseAdSet)
    helpers.requireMetaContext.mockResolvedValueOnce(errRes)
    const res = await POST(
      new Request('http://x', {
        method: 'POST',
        headers: { 'X-Org-Id': 'org_1', 'Content-Type': 'application/json' },
        body: JSON.stringify({ input: { adSetId: 'ads_1', name: 'Test' } }),
      }) as any,
      { uid: 'u1' } as any,
      {} as any,
    )
    expect(res.status).toBe(404)
  })
})
