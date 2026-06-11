// __tests__/app/api/v1/ads/campaigns/launch-pause-validate.test.ts
import { POST as launchPOST } from '@/app/api/v1/ads/campaigns/[id]/launch/route'
import { POST as pausePOST } from '@/app/api/v1/ads/campaigns/[id]/pause/route'
import { POST as validatePOST } from '@/app/api/v1/ads/campaigns/[id]/validate/route'

jest.mock('@/lib/api/auth', () => ({ withAuth: (_r: string, h: any) => h }))
jest.mock('@/lib/api/capabilityGate', () => ({ enforceAgentCapability: jest.fn(() => null) }))
jest.mock('@/lib/ads/campaigns/store', () => ({
  getCampaign: jest.fn(),
  updateCampaign: jest.fn(),
  setCampaignMetaId: jest.fn(),
}))
jest.mock('@/lib/ads/api-helpers', () => ({
  requireMetaContext: jest.fn(),
}))
jest.mock('@/lib/ads/providers/meta', () => ({
  metaProvider: { upsertCampaign: jest.fn() },
}))
jest.mock('@/lib/ads/providers/meta/campaigns', () => ({
  validateCampaign: jest.fn(),
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
  reviewState: 'approved',
  approvedAt: { seconds: 1 },
  approvedBy: 'approver_1',
}

const baseCtx = {
  orgId: 'org_1',
  accessToken: 'tok',
  adAccountId: 'act_42',
  connection: { id: 'conn_1' },
}

function makeReq(orgId = 'org_1') {
  return new Request('http://x', {
    method: 'POST',
    headers: { 'X-Org-Id': orgId },
  }) as any
}

// ── Launch ────────────────────────────────────────────────────────────────────

describe('POST /api/v1/ads/campaigns/[id]/launch', () => {
  it('creates campaign in Meta and persists metaCampaignId when no metaId exists', async () => {
    const afterUpdate = { ...baseCampaign, status: 'ACTIVE' }
    store.getCampaign
      .mockResolvedValueOnce(baseCampaign)
      .mockResolvedValueOnce(afterUpdate)
    store.updateCampaign.mockResolvedValueOnce(undefined)
    store.setCampaignMetaId.mockResolvedValueOnce(undefined)
    helpers.requireMetaContext.mockResolvedValueOnce(baseCtx)
    metaProviderMock.metaProvider.upsertCampaign.mockResolvedValueOnce({
      metaCampaignId: 'meta_new_123',
      created: true,
    })

    const res = await launchPOST(makeReq(), {} as any, {
      params: Promise.resolve({ id: 'cmp_1' }),
    })
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.data.status).toBe('ACTIVE')
    expect(store.setCampaignMetaId).toHaveBeenCalledWith('cmp_1', 'meta_new_123')
    expect(store.updateCampaign).toHaveBeenCalledWith('cmp_1', { status: 'ACTIVE' })
  })

  it('does not call setCampaignMetaId when Meta returns created=false (already exists)', async () => {
    const campaignWithMeta = { ...baseCampaign, providerData: { meta: { id: 'meta_123' } } }
    store.getCampaign
      .mockResolvedValueOnce(campaignWithMeta)
      .mockResolvedValueOnce({ ...campaignWithMeta, status: 'ACTIVE' })
    store.updateCampaign.mockResolvedValueOnce(undefined)
    helpers.requireMetaContext.mockResolvedValueOnce(baseCtx)
    metaProviderMock.metaProvider.upsertCampaign.mockResolvedValueOnce({
      metaCampaignId: 'meta_123',
      created: false,
    })

    await launchPOST(makeReq(), {} as any, { params: Promise.resolve({ id: 'cmp_1' }) })
    expect(store.setCampaignMetaId).not.toHaveBeenCalled()
  })

  it('does not mark campaign ACTIVE when provider readiness fails first', async () => {
    store.getCampaign.mockResolvedValueOnce(baseCampaign)
    helpers.requireMetaContext.mockResolvedValueOnce(new Response(JSON.stringify({ success: false }), { status: 404 }))

    const res = await launchPOST(makeReq(), {} as any, { params: Promise.resolve({ id: 'cmp_1' }) })

    expect(res.status).toBe(404)
    expect(store.updateCampaign).not.toHaveBeenCalledWith('cmp_1', { status: 'ACTIVE' })
  })

  it('returns 404 when campaign belongs to different org', async () => {
    store.getCampaign.mockResolvedValueOnce({ ...baseCampaign, orgId: 'org_other' })
    const res = await launchPOST(makeReq('org_1'), {} as any, {
      params: Promise.resolve({ id: 'cmp_1' }),
    })
    expect(res.status).toBe(404)
  })
})

// ── Pause ─────────────────────────────────────────────────────────────────────

describe('POST /api/v1/ads/campaigns/[id]/pause', () => {
  it('updates status to PAUSED locally', async () => {
    const afterPause = { ...baseCampaign, status: 'PAUSED' }
    store.getCampaign
      .mockResolvedValueOnce(baseCampaign)
      .mockResolvedValueOnce(afterPause)
    store.updateCampaign.mockResolvedValueOnce(undefined)

    const res = await pausePOST(makeReq(), {} as any, {
      params: Promise.resolve({ id: 'cmp_1' }),
    })
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.data.status).toBe('PAUSED')
    expect(store.updateCampaign).toHaveBeenCalledWith('cmp_1', { status: 'PAUSED' })
  })

  it('best-effort syncs to Meta when metaId is set; does not fail on Meta error', async () => {
    const campaignWithMeta = {
      ...baseCampaign,
      status: 'ACTIVE',
      providerData: { meta: { id: 'meta_123' } },
    }
    store.getCampaign
      .mockResolvedValueOnce(campaignWithMeta)
      .mockResolvedValueOnce({ ...campaignWithMeta, status: 'PAUSED' })
    store.updateCampaign.mockResolvedValueOnce(undefined)
    helpers.requireMetaContext.mockResolvedValueOnce(baseCtx)
    metaProviderMock.metaProvider.upsertCampaign.mockRejectedValueOnce(new Error('Meta down'))

    const res = await pausePOST(makeReq(), {} as any, {
      params: Promise.resolve({ id: 'cmp_1' }),
    })
    expect(res.status).toBe(200)
    // local status still PAUSED even though Meta failed
    expect((await res.json()).data.status).toBe('PAUSED')
  })
})

// ── Validate ──────────────────────────────────────────────────────────────────

describe('POST /api/v1/ads/campaigns/[id]/validate', () => {
  it('returns {valid: true, warnings: []} when Meta validate passes', async () => {
    const campaignWithMeta = { ...baseCampaign, providerData: { meta: { id: 'meta_123' } } }
    store.getCampaign.mockResolvedValueOnce(campaignWithMeta)
    helpers.requireMetaContext.mockResolvedValueOnce(baseCtx)
    metaCampaignsMock.validateCampaign.mockResolvedValueOnce({ success: true })

    const res = await validatePOST(makeReq(), {} as any, {
      params: Promise.resolve({ id: 'cmp_1' }),
    })
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.data.valid).toBe(true)
    expect(body.data.warnings).toHaveLength(0)
  })

  it('returns {valid: false, warnings: [...]} when Meta validate throws', async () => {
    const campaignWithMeta = { ...baseCampaign, providerData: { meta: { id: 'meta_123' } } }
    store.getCampaign.mockResolvedValueOnce(campaignWithMeta)
    helpers.requireMetaContext.mockResolvedValueOnce(baseCtx)
    metaCampaignsMock.validateCampaign.mockRejectedValueOnce(
      new Error('Budget too low'),
    )

    const res = await validatePOST(makeReq(), {} as any, {
      params: Promise.resolve({ id: 'cmp_1' }),
    })
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.data.valid).toBe(false)
    expect(body.data.warnings[0]).toMatch(/Budget too low/)
  })

  it('returns {valid: true, warnings: [not pushed]} when no metaId', async () => {
    store.getCampaign.mockResolvedValueOnce(baseCampaign) // no providerData.meta.id
    helpers.requireMetaContext.mockResolvedValueOnce(baseCtx)

    const res = await validatePOST(makeReq(), {} as any, {
      params: Promise.resolve({ id: 'cmp_1' }),
    })
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.data.valid).toBe(true)
    expect(body.data.warnings[0]).toMatch(/not yet pushed/)
  })
})
