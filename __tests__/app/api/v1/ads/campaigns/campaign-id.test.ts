// __tests__/app/api/v1/ads/campaigns/campaign-id.test.ts
import { GET, PATCH, DELETE } from '@/app/api/v1/ads/campaigns/[id]/route'

jest.mock('@/lib/api/auth', () => ({ withAuth: (_r: string, h: any) => h }))
jest.mock('@/lib/api/capabilityGate', () => ({ enforceAgentCapability: jest.fn(() => null) }))
jest.mock('@/lib/ads/campaigns/store', () => ({
  getCampaign: jest.fn(),
  updateCampaign: jest.fn(),
  deleteCampaign: jest.fn(),
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

const store = jest.requireMock('@/lib/ads/campaigns/store')
const helpers = jest.requireMock('@/lib/ads/api-helpers')
const metaProviderMock = jest.requireMock('@/lib/ads/providers/meta')
const metaCampaignsMock = jest.requireMock('@/lib/ads/providers/meta/campaigns')

beforeEach(() => jest.clearAllMocks())

const baseCampaign = {
  id: 'cmp_1',
  orgId: 'org_1',
  name: 'Test',
  status: 'DRAFT',
  providerData: {},
}

const approvedCampaign = {
  ...baseCampaign,
  reviewState: 'approved',
  approvedAt: { seconds: 1, nanoseconds: 0 },
  approvedBy: 'client_1',
}

const baseCtx = {
  orgId: 'org_1',
  accessToken: 'tok',
  adAccountId: 'act_42',
  connection: { id: 'conn_1' },
}

function makeReq(orgId = 'org_1', extra?: RequestInit) {
  return new Request('http://x', { headers: { 'X-Org-Id': orgId }, ...extra }) as any
}

describe('GET /api/v1/ads/campaigns/[id]', () => {
  it('returns campaign for correct org', async () => {
    store.getCampaign.mockResolvedValueOnce(baseCampaign)
    const res = await GET(makeReq(), {} as any, { params: Promise.resolve({ id: 'cmp_1' }) })
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.data.id).toBe('cmp_1')
  })

  it('returns 404 when campaign belongs to different org (tenant isolation)', async () => {
    store.getCampaign.mockResolvedValueOnce({ ...baseCampaign, orgId: 'org_other' })
    const res = await GET(makeReq('org_1'), {} as any, { params: Promise.resolve({ id: 'cmp_1' }) })
    expect(res.status).toBe(404)
  })

  it('returns 404 when campaign does not exist', async () => {
    store.getCampaign.mockResolvedValueOnce(null)
    const res = await GET(makeReq(), {} as any, { params: Promise.resolve({ id: 'cmp_missing' }) })
    expect(res.status).toBe(404)
  })

  it('returns 400 when X-Org-Id missing', async () => {
    const res = await GET(
      new Request('http://x') as any,
      {} as any,
      { params: Promise.resolve({ id: 'cmp_1' }) },
    )
    expect(res.status).toBe(400)
  })
})

describe('PATCH /api/v1/ads/campaigns/[id]', () => {
  it('updates campaign locally and returns updated doc', async () => {
    const updated = { ...baseCampaign, name: 'Updated' }
    store.getCampaign
      .mockResolvedValueOnce(baseCampaign) // initial fetch
      .mockResolvedValueOnce(updated) // post-update fetch
    store.updateCampaign.mockResolvedValueOnce(undefined)

    const res = await PATCH(
      new Request('http://x', {
        method: 'PATCH',
        headers: { 'X-Org-Id': 'org_1', 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Updated' }),
      }) as any,
      {} as any,
      { params: Promise.resolve({ id: 'cmp_1' }) },
    )
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.data.name).toBe('Updated')
    expect(store.updateCampaign).toHaveBeenCalledWith('cmp_1', { name: 'Updated' })
  })

  it('includes warnings when Meta sync fails for live campaign', async () => {
    const liveCampaign = {
      ...baseCampaign,
      providerData: { meta: { id: 'meta_123' } },
    }
    store.getCampaign
      .mockResolvedValueOnce(liveCampaign)
      .mockResolvedValueOnce({ ...liveCampaign, name: 'Updated' })
    store.updateCampaign.mockResolvedValueOnce(undefined)
    helpers.requireMetaContext.mockResolvedValueOnce(baseCtx)
    metaProviderMock.metaProvider.upsertCampaign.mockRejectedValueOnce(
      new Error('Meta API error: rate limited'),
    )

    const res = await PATCH(
      new Request('http://x', {
        method: 'PATCH',
        headers: { 'X-Org-Id': 'org_1', 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Updated' }),
      }) as any,
      {} as any,
      { params: Promise.resolve({ id: 'cmp_1' }) },
    )
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.data.warnings).toHaveLength(1)
    expect(body.data.warnings[0]).toMatch(/Meta sync warning/)
  })

  it('returns 404 when campaign belongs to different org', async () => {
    store.getCampaign.mockResolvedValueOnce({ ...baseCampaign, orgId: 'org_other' })
    const res = await PATCH(
      new Request('http://x', {
        method: 'PATCH',
        headers: { 'X-Org-Id': 'org_1', 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'X' }),
      }) as any,
      {} as any,
      { params: Promise.resolve({ id: 'cmp_1' }) },
    )
    expect(res.status).toBe(404)
  })
})

describe('DELETE /api/v1/ads/campaigns/[id]', () => {
  it('blocks destructive campaign delete when persisted approval evidence is missing', async () => {
    store.getCampaign.mockResolvedValueOnce(baseCampaign)
    const res = await DELETE(makeReq(), {} as any, { params: Promise.resolve({ id: 'cmp_1' }) })
    const body = await res.json()

    expect(res.status).toBe(403)
    expect(body.error).toMatch(/persisted approval evidence/i)
    expect(store.deleteCampaign).not.toHaveBeenCalled()
  })

  it('deletes an approved campaign locally and returns {deleted: true}', async () => {
    store.getCampaign.mockResolvedValueOnce(approvedCampaign)
    store.deleteCampaign.mockResolvedValueOnce(undefined)
    const res = await DELETE(makeReq(), {} as any, { params: Promise.resolve({ id: 'cmp_1' }) })
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.data.deleted).toBe(true)
    expect(store.deleteCampaign).toHaveBeenCalledWith('cmp_1')
  })

  it('best-effort calls Meta delete when metaId is set', async () => {
    const campaignWithMeta = { ...approvedCampaign, providerData: { meta: { id: 'meta_123' } } }
    store.getCampaign.mockResolvedValueOnce(campaignWithMeta)
    store.deleteCampaign.mockResolvedValueOnce(undefined)
    helpers.requireMetaContext.mockResolvedValueOnce(baseCtx)
    metaCampaignsMock.deleteCampaign.mockResolvedValueOnce(undefined)

    const res = await DELETE(makeReq(), {} as any, { params: Promise.resolve({ id: 'cmp_1' }) })
    expect(res.status).toBe(200)
    expect(metaCampaignsMock.deleteCampaign).toHaveBeenCalledWith(
      expect.objectContaining({ metaCampaignId: 'meta_123' }),
    )
    expect(store.deleteCampaign).toHaveBeenCalledWith('cmp_1')
  })

  it('still deletes locally even when Meta delete throws', async () => {
    const campaignWithMeta = { ...approvedCampaign, providerData: { meta: { id: 'meta_123' } } }
    store.getCampaign.mockResolvedValueOnce(campaignWithMeta)
    store.deleteCampaign.mockResolvedValueOnce(undefined)
    helpers.requireMetaContext.mockResolvedValueOnce(baseCtx)
    metaCampaignsMock.deleteCampaign.mockRejectedValueOnce(new Error('Meta down'))

    const res = await DELETE(makeReq(), {} as any, { params: Promise.resolve({ id: 'cmp_1' }) })
    expect(res.status).toBe(200)
    expect(store.deleteCampaign).toHaveBeenCalledWith('cmp_1')
  })

  it('returns 404 when campaign belongs to different org', async () => {
    store.getCampaign.mockResolvedValueOnce({ ...baseCampaign, orgId: 'org_other' })
    const res = await DELETE(makeReq('org_1'), {} as any, { params: Promise.resolve({ id: 'cmp_1' }) })
    expect(res.status).toBe(404)
  })
})
