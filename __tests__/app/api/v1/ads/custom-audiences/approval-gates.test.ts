import { POST } from '@/app/api/v1/ads/custom-audiences/route'

jest.mock('@/lib/api/auth', () => ({ withAuth: (_r: string, h: any) => h }))
jest.mock('@/lib/ads/custom-audiences/store', () => ({
  listCustomAudiences: jest.fn(),
  createCustomAudience: jest.fn(),
  setCustomAudienceMetaId: jest.fn(),
  getCustomAudience: jest.fn(),
}))
jest.mock('@/lib/ads/campaigns/store', () => ({ getCampaign: jest.fn() }))
jest.mock('@/lib/ads/api-helpers', () => ({ requireMetaContext: jest.fn() }))
jest.mock('@/lib/ads/providers/meta', () => ({ metaProvider: { customAudienceCRUD: jest.fn() } }))
jest.mock('@/lib/firebase/admin', () => ({ adminDb: { collection: jest.fn() } }))

const audiences = jest.requireMock('@/lib/ads/custom-audiences/store')
const campaigns = jest.requireMock('@/lib/ads/campaigns/store')
const helpers = jest.requireMock('@/lib/ads/api-helpers')
const metaProvider = jest.requireMock('@/lib/ads/providers/meta').metaProvider

beforeEach(() => jest.clearAllMocks())

function postAudience(body: unknown) {
  return POST(new Request('http://x', {
    method: 'POST',
    headers: { 'X-Org-Id': 'org-1', 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }) as any, { uid: 'admin-1' } as any)
}

describe('POST /api/v1/ads/custom-audiences approval gates', () => {
  it('rejects caller-supplied approval state overrides before provider calls', async () => {
    const res = await postAudience({ approvalCampaignId: 'cmp-1', platform: 'google', name: 'Audience', reviewState: 'approved' })
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.error).toMatch(/persisted records/i)
    expect(campaigns.getCampaign).not.toHaveBeenCalled()
  })

  it('requires an approved campaign reference before creating audiences', async () => {
    campaigns.getCampaign.mockResolvedValueOnce({ id: 'cmp-1', orgId: 'org-1', reviewState: 'awaiting' })

    const res = await postAudience({
      approvalCampaignId: 'cmp-1',
      input: { name: 'Audience', type: 'CUSTOMER_LIST', source: { kind: 'CUSTOMER_LIST', csvStoragePath: 'x', hashCount: 1 } },
    })
    const body = await res.json()

    expect(res.status).toBe(403)
    expect(body.error).toMatch(/persisted approval evidence/i)
    expect(audiences.createCustomAudience).not.toHaveBeenCalled()
  })

  it('creates Meta audience after persisted campaign approval and strips approvalCampaignId from input', async () => {
    campaigns.getCampaign.mockResolvedValueOnce({ id: 'cmp-1', orgId: 'org-1', reviewState: 'approved', approvedAt: { seconds: 1 }, approvedBy: 'client-1' })
    helpers.requireMetaContext.mockResolvedValueOnce({ orgId: 'org-1', accessToken: 'tok', adAccountId: 'act_1' })
    audiences.createCustomAudience.mockResolvedValueOnce({ id: 'ca-1', name: 'Audience', type: 'CUSTOMER_LIST' })
    metaProvider.customAudienceCRUD.mockResolvedValueOnce({ metaCaId: '123' })
    audiences.getCustomAudience.mockResolvedValueOnce({ id: 'ca-1' })

    const res = await postAudience({
      approvalCampaignId: 'cmp-1',
      input: { name: 'Audience', type: 'CUSTOMER_LIST', source: { kind: 'CUSTOMER_LIST', csvStoragePath: 'x', hashCount: 1 } },
    })

    expect(res.status).toBe(201)
    expect(audiences.createCustomAudience).toHaveBeenCalledWith(expect.objectContaining({
      input: expect.not.objectContaining({ approvalCampaignId: 'cmp-1' }),
    }))
  })
})
