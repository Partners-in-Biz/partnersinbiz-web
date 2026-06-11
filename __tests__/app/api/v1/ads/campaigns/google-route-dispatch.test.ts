// __tests__/app/api/v1/ads/campaigns/google-route-dispatch.test.ts
// Google platform dispatch tests for campaign routes — Sub-3a Phase 2 Batch 3
import { POST } from '@/app/api/v1/ads/campaigns/route'
import { PATCH, DELETE } from '@/app/api/v1/ads/campaigns/[id]/route'
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
  resolveGoogleAdsCustomerContext: jest.fn((conn) => ({
    customerId: conn.defaultAdAccountId,
    loginCustomerId: conn.meta?.google?.loginCustomerId,
  })),
}))

jest.mock('@/lib/ads/providers/meta', () => ({
  metaProvider: { upsertCampaign: jest.fn() },
}))

jest.mock('@/lib/ads/providers/meta/campaigns', () => ({
  deleteCampaign: jest.fn(),
}))

jest.mock('@/lib/ads/providers/google/campaigns', () => ({
  createSearchCampaign: jest.fn().mockResolvedValue({
    resourceName: 'customers/1234567890/campaigns/999',
    id: '999',
  }),
  updateCampaign: jest.fn().mockResolvedValue({
    resourceName: 'customers/1234567890/campaigns/999',
    id: '999',
  }),
  pauseCampaign: jest.fn().mockResolvedValue({
    resourceName: 'customers/1234567890/campaigns/999',
    id: '999',
  }),
  resumeCampaign: jest.fn().mockResolvedValue({
    resourceName: 'customers/1234567890/campaigns/999',
    id: '999',
  }),
  removeCampaign: jest.fn().mockResolvedValue({
    resourceName: 'customers/1234567890/campaigns/999',
    id: '999',
  }),
}))

jest.mock('@/lib/ads/connections/store', () => ({
  getConnection: jest.fn().mockResolvedValue({
    id: 'conn_g1',
    orgId: 'org-1',
    platform: 'google',
    defaultAdAccountId: '1234567890',
    accessTokenEnc: { iv: 'iv', tag: 'tag', data: 'data' },
    meta: { google: { loginCustomerId: '1234567890' } },
  }),
  decryptAccessToken: jest.fn().mockReturnValue('test-access-token'),
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
const googleCampaigns = jest.requireMock('@/lib/ads/providers/google/campaigns')
const connStore = jest.requireMock('@/lib/ads/connections/store')

beforeEach(() => jest.clearAllMocks())

const baseCtx = {
  orgId: 'org-1',
  accessToken: 'meta-tok',
  adAccountId: 'act_42',
  connection: { id: 'conn_meta' },
}

const googleCampaign = {
  id: 'cmp_g1',
  orgId: 'org-1',
  platform: 'google',
  name: 'Google Campaign',
  status: 'DRAFT',
  objective: 'TRAFFIC',
  providerData: {
    google: { campaignResourceName: 'customers/1234567890/campaigns/999' },
  },
}

const approvedGoogleCampaign = {
  ...googleCampaign,
  reviewState: 'approved',
  approvedAt: { seconds: 1, nanoseconds: 0 },
  approvedBy: 'client-1',
}

// ── POST /api/v1/ads/campaigns — Google create ────────────────────────────────

describe('POST /api/v1/ads/campaigns — Google dispatch', () => {
  it('creates campaign in Firestore and dispatches createSearchCampaign for Google platform', async () => {
    helpers.requireMetaContext.mockResolvedValueOnce(baseCtx)
    const created = { ...googleCampaign, providerData: {} }
    store.createCampaign.mockResolvedValueOnce(created)
    store.updateCampaign.mockResolvedValueOnce(undefined)

    const res = await POST(
      new Request('http://x', {
        method: 'POST',
        headers: { 'X-Org-Id': 'org-1', 'Content-Type': 'application/json' },
        body: JSON.stringify({
          platform: 'google',
          input: { name: 'Google Campaign', objective: 'TRAFFIC', status: 'DRAFT', specialAdCategories: [], cboEnabled: false },
          googleAds: { dailyBudgetMajor: 15 },
        }),
      }) as any,
      { uid: 'u1' } as any,
      {} as any,
    )
    const body = await res.json()
    expect(res.status).toBe(201)
    expect(body.success).toBe(true)
    expect(store.createCampaign).toHaveBeenCalledWith(
      expect.objectContaining({ platform: 'google' }),
    )
    expect(googleCampaigns.createSearchCampaign).toHaveBeenCalledWith(
      expect.objectContaining({
        customerId: '1234567890',
        accessToken: 'test-access-token',
        developerToken: 'test-dev-token',
        dailyBudgetMajor: 15,
      }),
    )
    expect(store.updateCampaign).toHaveBeenCalledWith(
      created.id,
      expect.objectContaining({ providerData: expect.objectContaining({ google: expect.objectContaining({ campaignResourceName: 'customers/1234567890/campaigns/999' }) }) }),
    )
  })

  it('returns 400 when Google connection is missing', async () => {
    helpers.requireMetaContext.mockResolvedValueOnce(baseCtx)
    store.createCampaign.mockResolvedValueOnce({ ...googleCampaign, providerData: {} })
    connStore.getConnection.mockResolvedValueOnce(null)

    const res = await POST(
      new Request('http://x', {
        method: 'POST',
        headers: { 'X-Org-Id': 'org-1', 'Content-Type': 'application/json' },
        body: JSON.stringify({
          platform: 'google',
          input: { name: 'G', objective: 'TRAFFIC', status: 'DRAFT', specialAdCategories: [], cboEnabled: false },
        }),
      }) as any,
      { uid: 'u1' } as any,
      {} as any,
    )
    expect(res.status).toBe(400)
  })
})

// ── PATCH /api/v1/ads/campaigns/[id] — Google update ─────────────────────────

describe('PATCH /api/v1/ads/campaigns/[id] — Google dispatch', () => {
  it('calls googleUpdateCampaign when campaign.platform === google and resourceName exists', async () => {
    const updated = { ...googleCampaign, name: 'New Name' }
    store.getCampaign
      .mockResolvedValueOnce(googleCampaign)
      .mockResolvedValueOnce(updated)
    store.updateCampaign.mockResolvedValueOnce(undefined)

    const res = await PATCH(
      new Request('http://x', {
        method: 'PATCH',
        headers: { 'X-Org-Id': 'org-1', 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'New Name' }),
      }) as any,
      {} as any,
      { params: Promise.resolve({ id: 'cmp_g1' }) },
    )
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.data.name).toBe('New Name')
    expect(googleCampaigns.updateCampaign).toHaveBeenCalledWith(
      expect.objectContaining({
        resourceName: 'customers/1234567890/campaigns/999',
        name: 'New Name',
      }),
    )
  })
})

// ── DELETE /api/v1/ads/campaigns/[id] — Google remove ────────────────────────

describe('DELETE /api/v1/ads/campaigns/[id] — Google dispatch', () => {
  it('calls googleRemoveCampaign before local delete when resourceName exists', async () => {
    store.getCampaign.mockResolvedValueOnce(approvedGoogleCampaign)
    store.deleteCampaign.mockResolvedValueOnce(undefined)

    const res = await DELETE(
      new Request('http://x', { headers: { 'X-Org-Id': 'org-1' } }) as any,
      { uid: 'u1', email: 'a@b.com' } as any,
      { params: Promise.resolve({ id: 'cmp_g1' }) },
    )
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.data.deleted).toBe(true)
    expect(googleCampaigns.removeCampaign).toHaveBeenCalledWith(
      expect.objectContaining({ resourceName: 'customers/1234567890/campaigns/999' }),
    )
    expect(store.deleteCampaign).toHaveBeenCalledWith('cmp_g1')
  })

  it('still deletes locally even when Google remove throws', async () => {
    store.getCampaign.mockResolvedValueOnce(approvedGoogleCampaign)
    store.deleteCampaign.mockResolvedValueOnce(undefined)
    googleCampaigns.removeCampaign.mockRejectedValueOnce(new Error('Google down'))

    const res = await DELETE(
      new Request('http://x', { headers: { 'X-Org-Id': 'org-1' } }) as any,
      { uid: 'u1' } as any,
      { params: Promise.resolve({ id: 'cmp_g1' }) },
    )
    expect(res.status).toBe(200)
    expect(store.deleteCampaign).toHaveBeenCalledWith('cmp_g1')
  })
})

// ── POST /api/v1/ads/campaigns/[id]/launch — Google resume ───────────────────

describe('POST /api/v1/ads/campaigns/[id]/launch — Google dispatch', () => {
  it('blocks launch when persisted campaign approval evidence is missing', async () => {
    store.getCampaign.mockResolvedValueOnce(googleCampaign)

    const res = await launchPOST(
      new Request('http://x', { method: 'POST', headers: { 'X-Org-Id': 'org-1' } }) as any,
      { uid: 'u1' } as any,
      { params: Promise.resolve({ id: 'cmp_g1' }) },
    )
    const body = await res.json()

    expect(res.status).toBe(403)
    expect(body.error).toMatch(/persisted approval evidence/i)
    expect(store.updateCampaign).not.toHaveBeenCalled()
    expect(googleCampaigns.resumeCampaign).not.toHaveBeenCalled()
  })

  it('calls googleResumeCampaign and sets status ACTIVE for an approved Google campaign', async () => {
    const afterUpdate = { ...approvedGoogleCampaign, status: 'ACTIVE' }
    store.getCampaign
      .mockResolvedValueOnce(approvedGoogleCampaign)
      .mockResolvedValueOnce(afterUpdate)
    store.updateCampaign.mockResolvedValueOnce(undefined)

    const res = await launchPOST(
      new Request('http://x', { method: 'POST', headers: { 'X-Org-Id': 'org-1' } }) as any,
      { uid: 'u1' } as any,
      { params: Promise.resolve({ id: 'cmp_g1' }) },
    )
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(store.updateCampaign).toHaveBeenCalledWith('cmp_g1', { status: 'ACTIVE' })
    expect(googleCampaigns.resumeCampaign).toHaveBeenCalledWith(
      expect.objectContaining({ resourceName: 'customers/1234567890/campaigns/999' }),
    )
    // Meta upsertCampaign must NOT be called
    const metaProvider = jest.requireMock('@/lib/ads/providers/meta')
    expect(metaProvider.metaProvider.upsertCampaign).not.toHaveBeenCalled()
  })
})

// ── POST /api/v1/ads/campaigns/[id]/pause — Google pause ─────────────────────

describe('POST /api/v1/ads/campaigns/[id]/pause — Google dispatch', () => {
  it('calls googlePauseCampaign best-effort and sets status PAUSED for Google campaign', async () => {
    const afterPause = { ...googleCampaign, status: 'PAUSED' }
    store.getCampaign
      .mockResolvedValueOnce(googleCampaign)
      .mockResolvedValueOnce(afterPause)
    store.updateCampaign.mockResolvedValueOnce(undefined)

    const res = await pausePOST(
      new Request('http://x', { method: 'POST', headers: { 'X-Org-Id': 'org-1' } }) as any,
      { uid: 'u1' } as any,
      { params: Promise.resolve({ id: 'cmp_g1' }) },
    )
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.data.status).toBe('PAUSED')
    expect(googleCampaigns.pauseCampaign).toHaveBeenCalledWith(
      expect.objectContaining({ resourceName: 'customers/1234567890/campaigns/999' }),
    )
  })

  it('still pauses locally even when Google pause throws', async () => {
    const afterPause = { ...googleCampaign, status: 'PAUSED' }
    store.getCampaign
      .mockResolvedValueOnce(googleCampaign)
      .mockResolvedValueOnce(afterPause)
    store.updateCampaign.mockResolvedValueOnce(undefined)
    googleCampaigns.pauseCampaign.mockRejectedValueOnce(new Error('Google down'))

    const res = await pausePOST(
      new Request('http://x', { method: 'POST', headers: { 'X-Org-Id': 'org-1' } }) as any,
      { uid: 'u1' } as any,
      { params: Promise.resolve({ id: 'cmp_g1' }) },
    )
    expect(res.status).toBe(200)
    expect(store.updateCampaign).toHaveBeenCalledWith('cmp_g1', { status: 'PAUSED' })
  })
})
