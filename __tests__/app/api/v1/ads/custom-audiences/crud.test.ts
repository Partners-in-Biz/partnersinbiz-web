// __tests__/app/api/v1/ads/custom-audiences/crud.test.ts
import { GET, PATCH, DELETE } from '@/app/api/v1/ads/custom-audiences/[id]/route'

jest.mock('@/lib/api/auth', () => ({ withAuth: (_r: string, h: any) => h }))
jest.mock('@/lib/ads/custom-audiences/store', () => ({
  getCustomAudience: jest.fn(),
  updateCustomAudience: jest.fn(),
  deleteCustomAudience: jest.fn(),
}))
jest.mock('@/lib/ads/api-helpers', () => ({
  requireMetaContext: jest.fn(),
}))
jest.mock('@/lib/ads/providers/meta', () => ({
  metaProvider: {
    customAudienceCRUD: jest.fn(),
  },
}))
jest.mock('@/lib/ads/campaigns/store', () => ({
  getCampaign: jest.fn(),
}))

const store = jest.requireMock('@/lib/ads/custom-audiences/store')
const helpers = jest.requireMock('@/lib/ads/api-helpers')
const metaMock = jest.requireMock('@/lib/ads/providers/meta')
const campaignStore = jest.requireMock('@/lib/ads/campaigns/store')

beforeEach(() => jest.clearAllMocks())

const baseCA = {
  id: 'ca_1',
  orgId: 'org_1',
  name: 'My Audience',
  type: 'CUSTOMER_LIST',
  status: 'BUILDING',
  platform: 'meta',
  providerData: { meta: { customAudienceId: 'meta_ca_1' } },
}

const baseCtx = {
  orgId: 'org_1',
  accessToken: 'tok',
  adAccountId: 'act_42',
  connection: { id: 'conn_1' },
}

const approvedCampaign = {
  id: 'cmp_1',
  orgId: 'org_1',
  reviewState: 'approved',
  approvedAt: { seconds: 1 },
  approvedBy: 'approver_1',
}

function makeReq(orgId = 'org_1', extra?: RequestInit) {
  return new Request('http://x', { headers: { 'X-Org-Id': orgId }, ...extra }) as any
}

function makeDeleteReq(orgId = 'org_1') {
  return new Request('http://x?approvalCampaignId=cmp_1', { headers: { 'X-Org-Id': orgId } }) as any
}

describe('GET /api/v1/ads/custom-audiences/[id]', () => {
  it('returns the custom audience for the correct org', async () => {
    store.getCustomAudience.mockResolvedValueOnce(baseCA)
    const res = await GET(makeReq(), {} as any, { params: Promise.resolve({ id: 'ca_1' }) })
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.data.id).toBe('ca_1')
  })

  it('returns 404 for wrong org (tenant isolation)', async () => {
    store.getCustomAudience.mockResolvedValueOnce({ ...baseCA, orgId: 'org_other' })
    const res = await GET(makeReq('org_1'), {} as any, { params: Promise.resolve({ id: 'ca_1' }) })
    expect(res.status).toBe(404)
  })

  it('returns 404 when audience does not exist', async () => {
    store.getCustomAudience.mockResolvedValueOnce(null)
    const res = await GET(makeReq(), {} as any, { params: Promise.resolve({ id: 'ca_missing' }) })
    expect(res.status).toBe(404)
  })
})

describe('PATCH /api/v1/ads/custom-audiences/[id]', () => {
  it('updates audience and returns updated doc', async () => {
    const updated = { ...baseCA, name: 'Updated Audience' }
    store.getCustomAudience
      .mockResolvedValueOnce(baseCA) // initial fetch
      .mockResolvedValueOnce(updated) // post-update fetch
    store.updateCustomAudience.mockResolvedValueOnce(undefined)

    const res = await PATCH(
      new Request('http://x', {
        method: 'PATCH',
        headers: { 'X-Org-Id': 'org_1', 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Updated Audience' }),
      }) as any,
      {} as any,
      { params: Promise.resolve({ id: 'ca_1' }) },
    )
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.data.name).toBe('Updated Audience')
    expect(store.updateCustomAudience).toHaveBeenCalledWith('ca_1', { name: 'Updated Audience' })
  })

  it('returns 404 when audience belongs to different org', async () => {
    store.getCustomAudience.mockResolvedValueOnce({ ...baseCA, orgId: 'org_other' })
    const res = await PATCH(
      new Request('http://x', {
        method: 'PATCH',
        headers: { 'X-Org-Id': 'org_1', 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'X' }),
      }) as any,
      {} as any,
      { params: Promise.resolve({ id: 'ca_1' }) },
    )
    expect(res.status).toBe(404)
  })
})

describe('DELETE /api/v1/ads/custom-audiences/[id]', () => {
  it('does best-effort Meta delete then deletes locally', async () => {
    store.getCustomAudience.mockResolvedValueOnce(baseCA)
    campaignStore.getCampaign.mockResolvedValueOnce(approvedCampaign)
    helpers.requireMetaContext.mockResolvedValueOnce(baseCtx)
    metaMock.metaProvider.customAudienceCRUD.mockResolvedValueOnce({ success: true })
    store.deleteCustomAudience.mockResolvedValueOnce(undefined)

    const res = await DELETE(makeDeleteReq(), {} as any, { params: Promise.resolve({ id: 'ca_1' }) })
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.data.deleted).toBe(true)
    expect(metaMock.metaProvider.customAudienceCRUD).toHaveBeenCalledWith(
      expect.objectContaining({ op: 'delete', metaCaId: 'meta_ca_1' }),
    )
    expect(store.deleteCustomAudience).toHaveBeenCalledWith('ca_1')
  })

  it('deletes locally even when no metaCaId is set', async () => {
    const caWithoutMeta = { ...baseCA, providerData: { meta: {} } }
    store.getCustomAudience.mockResolvedValueOnce(caWithoutMeta)
    campaignStore.getCampaign.mockResolvedValueOnce(approvedCampaign)
    store.deleteCustomAudience.mockResolvedValueOnce(undefined)

    const res = await DELETE(makeDeleteReq(), {} as any, { params: Promise.resolve({ id: 'ca_1' }) })
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.data.deleted).toBe(true)
    expect(metaMock.metaProvider.customAudienceCRUD).not.toHaveBeenCalled()
    expect(store.deleteCustomAudience).toHaveBeenCalledWith('ca_1')
  })

  it('returns 404 when audience belongs to different org', async () => {
    store.getCustomAudience.mockResolvedValueOnce({ ...baseCA, orgId: 'org_other' })
    const res = await DELETE(makeReq('org_1'), {} as any, { params: Promise.resolve({ id: 'ca_1' }) })
    expect(res.status).toBe(404)
  })
})
