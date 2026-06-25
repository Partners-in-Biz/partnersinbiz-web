// __tests__/app/api/v1/ads/campaigns/list-create.test.ts
import { GET, POST } from '@/app/api/v1/ads/campaigns/route'

jest.mock('@/lib/api/auth', () => ({ withAuth: (_r: string, h: any) => h }))
jest.mock('@/lib/ads/campaigns/store', () => ({
  listCampaigns: jest.fn(),
  createCampaign: jest.fn(),
}))
jest.mock('@/lib/ads/api-helpers', () => ({
  requireMetaContext: jest.fn(),
}))

const store = jest.requireMock('@/lib/ads/campaigns/store')
const helpers = jest.requireMock('@/lib/ads/api-helpers')

// resetAllMocks (not clearAllMocks) so leftover mockResolvedValueOnce queue
// entries from validation tests — which return before requireMetaContext is
// called — don't leak into later tests.
beforeEach(() => jest.resetAllMocks())

const baseConn = {
  orgId: 'org_1',
  accessToken: 'tok',
  adAccountId: 'act_42',
  connection: { id: 'conn_1' },
}

describe('GET /api/v1/ads/campaigns', () => {
  it('returns campaigns for org', async () => {
    const campaigns = [{ id: 'cmp_1', orgId: 'org_1', name: 'A', status: 'DRAFT' }]
    store.listCampaigns.mockResolvedValueOnce(campaigns)
    const res = await GET(
      new Request('http://x', { headers: { 'X-Org-Id': 'org_1' } }) as any,
      { uid: 'u1' } as any,
      {} as any,
    )
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.success).toBe(true)
    expect(body.data).toHaveLength(1)
    expect(store.listCampaigns).toHaveBeenCalledWith(
      expect.objectContaining({ orgId: 'org_1' }),
    )
  })

  it('passes status filter when ?status is set', async () => {
    store.listCampaigns.mockResolvedValueOnce([])
    await GET(
      new Request('http://x?status=ACTIVE', { headers: { 'X-Org-Id': 'org_1' } }) as any,
      { uid: 'u1' } as any,
      {} as any,
    )
    expect(store.listCampaigns).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'ACTIVE' }),
    )
  })

  it('returns 400 when X-Org-Id is missing', async () => {
    const res = await GET(new Request('http://x') as any, { uid: 'u1' } as any, {} as any)
    expect(res.status).toBe(400)
  })
})

describe('POST /api/v1/ads/campaigns', () => {
  it('creates campaign with adAccountId from connection', async () => {
    helpers.requireMetaContext.mockResolvedValueOnce(baseConn)
    const created = { id: 'cmp_new', orgId: 'org_1', name: 'Test', objective: 'TRAFFIC' }
    store.createCampaign.mockResolvedValueOnce(created)

    const res = await POST(
      new Request('http://x', {
        method: 'POST',
        headers: { 'X-Org-Id': 'org_1', 'Content-Type': 'application/json' },
        body: JSON.stringify({ input: { name: 'Test', objective: 'TRAFFIC', status: 'DRAFT', specialAdCategories: [], cboEnabled: false } }),
      }) as any,
      { uid: 'u1' } as any,
      {} as any,
    )
    const body = await res.json()
    expect(res.status).toBe(201)
    expect(body.success).toBe(true)
    expect(store.createCampaign).toHaveBeenCalledWith(
      expect.objectContaining({ input: expect.objectContaining({ adAccountId: 'act_42' }) }),
    )
  })

  it('returns 400 when name or objective is missing', async () => {
    const res = await POST(
      new Request('http://x', {
        method: 'POST',
        headers: { 'X-Org-Id': 'org_1', 'Content-Type': 'application/json' },
        body: JSON.stringify({ input: { name: 'Test' } }), // objective missing
      }) as any,
      { uid: 'u1' } as any,
      {} as any,
    )
    expect(res.status).toBe(400)
  })

  it('short-circuits with connection error when requireMetaContext returns Response', async () => {
    const errRes = new Response(JSON.stringify({ success: false, error: 'no conn' }), { status: 404 })
    helpers.requireMetaContext.mockResolvedValueOnce(errRes)
    const res = await POST(
      new Request('http://x', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ input: { name: 'Test', objective: 'TRAFFIC' } }),
      }) as any,
      { uid: 'u1' } as any,
      {} as any,
    )
    expect(res.status).toBe(404)
  })
})
