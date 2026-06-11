// __tests__/app/api/v1/ads/custom-audiences/upload-list.test.ts
import { POST } from '@/app/api/v1/ads/custom-audiences/[id]/upload-list/route'

jest.mock('@/lib/api/auth', () => ({ withAuth: (_r: string, h: any) => h }))
jest.mock('@/lib/ads/custom-audiences/store', () => ({
  getCustomAudience: jest.fn(),
  updateCustomAudience: jest.fn(),
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
  name: 'My List',
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

function makeCsvFormData(csv: string, columns = ['EMAIL']) {
  const file = new Blob([csv], { type: 'text/csv' })
  const form = new FormData()
  form.append('file', file, 'list.csv')
  form.append('columns', JSON.stringify(columns))
  form.append('approvalCampaignId', 'cmp_1')
  return form
}

function makeFormReq(orgId: string, formData: FormData) {
  return new Request('http://x', {
    method: 'POST',
    headers: { 'X-Org-Id': orgId },
    body: formData,
  }) as any
}

describe('POST /api/v1/ads/custom-audiences/[id]/upload-list', () => {
  it('hashes CSV rows and calls Meta upload-users', async () => {
    const csv = 'EMAIL,NAME\ntest@example.com,Alice\nfoo@bar.com,Bob\n'
    store.getCustomAudience
      .mockResolvedValueOnce(baseCA)
      .mockResolvedValueOnce({ ...baseCA, status: 'BUILDING' })
    campaignStore.getCampaign.mockResolvedValueOnce(approvedCampaign)
    helpers.requireMetaContext.mockResolvedValueOnce(baseCtx)
    metaMock.metaProvider.customAudienceCRUD.mockResolvedValueOnce({ numReceived: 2 })
    store.updateCustomAudience.mockResolvedValueOnce(undefined)

    const res = await POST(
      makeFormReq('org_1', makeCsvFormData(csv)),
      {} as any,
      { params: Promise.resolve({ id: 'ca_1' }) },
    )
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.success).toBe(true)
    expect(body.data.uploadStats.rowsHashed).toBe(2)
    expect(metaMock.metaProvider.customAudienceCRUD).toHaveBeenCalledWith(
      expect.objectContaining({ op: 'upload-users', metaCaId: 'meta_ca_1' }),
    )
    // Hashes should be SHA-256 hex strings (64 chars each)
    const uploadCall = metaMock.metaProvider.customAudienceCRUD.mock.calls[0][0]
    expect(uploadCall.uploadPayload.hashedRows[0][0]).toHaveLength(64)
    expect(uploadCall.uploadPayload.hashedRows[0][0]).toMatch(/^[a-f0-9]+$/)
  })

  it('returns 404 when audience does not belong to org', async () => {
    store.getCustomAudience.mockResolvedValueOnce({ ...baseCA, orgId: 'org_other' })
    const csv = 'EMAIL\ntest@example.com\n'
    const res = await POST(
      makeFormReq('org_1', makeCsvFormData(csv)),
      {} as any,
      { params: Promise.resolve({ id: 'ca_1' }) },
    )
    expect(res.status).toBe(404)
  })

  it('returns 400 when audience type is not CUSTOMER_LIST', async () => {
    store.getCustomAudience.mockResolvedValueOnce({ ...baseCA, type: 'WEBSITE' })
    const csv = 'EMAIL\ntest@example.com\n'
    const res = await POST(
      makeFormReq('org_1', makeCsvFormData(csv)),
      {} as any,
      { params: Promise.resolve({ id: 'ca_1' }) },
    )
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toContain('CUSTOMER_LIST')
  })

  it('returns 400 when audience is not yet synced to Meta', async () => {
    store.getCustomAudience.mockResolvedValueOnce({ ...baseCA, providerData: { meta: {} } })
    campaignStore.getCampaign.mockResolvedValueOnce(approvedCampaign)
    const csv = 'EMAIL\ntest@example.com\n'
    const res = await POST(
      makeFormReq('org_1', makeCsvFormData(csv)),
      {} as any,
      { params: Promise.resolve({ id: 'ca_1' }) },
    )
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toContain('not yet synced')
  })

  it('returns 400 when columns are invalid', async () => {
    store.getCustomAudience.mockResolvedValueOnce(baseCA)
    campaignStore.getCampaign.mockResolvedValueOnce(approvedCampaign)
    helpers.requireMetaContext.mockResolvedValueOnce(baseCtx)
    const csv = 'EMAIL\ntest@example.com\n'
    const form = new FormData()
    form.append('file', new Blob([csv], { type: 'text/csv' }), 'list.csv')
    form.append('columns', JSON.stringify(['INVALID_COL']))
    form.append('approvalCampaignId', 'cmp_1')

    const res = await POST(
      makeFormReq('org_1', form),
      {} as any,
      { params: Promise.resolve({ id: 'ca_1' }) },
    )
    expect(res.status).toBe(400)
    expect((await res.json()).error).toContain('EMAIL')
  })
})
