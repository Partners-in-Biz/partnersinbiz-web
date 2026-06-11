// __tests__/app/api/v1/ads/pixel-configs/pxc-id.test.ts
import { GET, PATCH, DELETE } from '@/app/api/v1/ads/pixel-configs/[id]/route'

jest.mock('@/lib/api/auth', () => ({ withAuth: (_r: string, h: any) => h }))
jest.mock('@/lib/ads/pixel-configs/store', () => ({
  getPixelConfig: jest.fn(),
  updatePixelConfig: jest.fn(),
  deletePixelConfig: jest.fn(),
  setPlatformCapiToken: jest.fn(),
}))
jest.mock('@/lib/ads/campaigns/store', () => ({ getCampaign: jest.fn() }))

const store = jest.requireMock('@/lib/ads/pixel-configs/store')
const campaigns = jest.requireMock('@/lib/ads/campaigns/store')

const approvedCampaign = { id: 'cmp_1', orgId: 'org_1', reviewState: 'approved', approvedAt: { seconds: 1 }, approvedBy: 'client_1' }

beforeEach(() => jest.clearAllMocks())

const baseConfig = {
  id: 'pxc_1',
  orgId: 'org_1',
  name: 'My Pixel',
  eventMappings: [],
  meta: { pixelId: 'px_meta', capiTokenEnc: { iv: 'iv', ciphertext: 'ct', tag: 'tg' } },
  createdBy: 'user_1',
  createdAt: { seconds: 0, nanoseconds: 0 },
  updatedAt: { seconds: 0, nanoseconds: 0 },
}

function makeReq(orgId = 'org_1', extra?: RequestInit) {
  return new Request('http://x?approvalCampaignId=cmp_1', { headers: { 'X-Org-Id': orgId }, ...extra }) as any
}

// ─── GET ─────────────────────────────────────────────────────────────────────

describe('GET /api/v1/ads/pixel-configs/[id]', () => {
  it('returns config with capiTokenEnc stripped for correct org', async () => {
    store.getPixelConfig.mockResolvedValueOnce(baseConfig)
    const res = await GET(makeReq(), {} as any, { params: Promise.resolve({ id: 'pxc_1' }) })
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.data.id).toBe('pxc_1')
    // capiTokenEnc must not be present
    expect(body.data.meta?.capiTokenEnc).toBeUndefined()
    // pixelId should still be present
    expect(body.data.meta?.pixelId).toBe('px_meta')
  })

  it('returns 404 when config belongs to different org (tenant isolation)', async () => {
    store.getPixelConfig.mockResolvedValueOnce({ ...baseConfig, orgId: 'org_other' })
    const res = await GET(makeReq('org_1'), {} as any, { params: Promise.resolve({ id: 'pxc_1' }) })
    expect(res.status).toBe(404)
  })
})

// ─── PATCH ───────────────────────────────────────────────────────────────────

describe('PATCH /api/v1/ads/pixel-configs/[id]', () => {
  it('updates plain fields and returns updated config', async () => {
    const updated = { ...baseConfig, name: 'Renamed Pixel' }
    store.getPixelConfig
      .mockResolvedValueOnce(baseConfig) // ownership check
      .mockResolvedValueOnce(updated)    // post-update fetch
    store.updatePixelConfig.mockResolvedValueOnce(undefined)

    campaigns.getCampaign.mockResolvedValueOnce(approvedCampaign)
    const res = await PATCH(
      new Request('http://x', {
        method: 'PATCH',
        headers: { 'X-Org-Id': 'org_1', 'Content-Type': 'application/json' },
        body: JSON.stringify({ approvalCampaignId: 'cmp_1', name: 'Renamed Pixel' }),
      }) as any,
      {} as any,
      { params: Promise.resolve({ id: 'pxc_1' }) },
    )
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.data.name).toBe('Renamed Pixel')
    expect(store.updatePixelConfig).toHaveBeenCalledWith('pxc_1', { name: 'Renamed Pixel' })
    expect(store.setPlatformCapiToken).not.toHaveBeenCalled()
  })

  it('returns 404 when config belongs to different org', async () => {
    store.getPixelConfig.mockResolvedValueOnce({ ...baseConfig, orgId: 'org_other' })
    const res = await PATCH(
      new Request('http://x', {
        method: 'PATCH',
        headers: { 'X-Org-Id': 'org_1', 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'X' }),
      }) as any,
      {} as any,
      { params: Promise.resolve({ id: 'pxc_1' }) },
    )
    expect(res.status).toBe(404)
  })

  it('blocks pixel config changes when persisted approval evidence is missing', async () => {
    store.getPixelConfig.mockResolvedValueOnce(baseConfig)
    campaigns.getCampaign.mockResolvedValueOnce({ id: 'cmp_1', orgId: 'org_1', reviewState: 'awaiting' })

    const res = await PATCH(
      new Request('http://x', {
        method: 'PATCH',
        headers: { 'X-Org-Id': 'org_1', 'Content-Type': 'application/json' },
        body: JSON.stringify({ approvalCampaignId: 'cmp_1', name: 'Blocked Pixel' }),
      }) as any,
      {} as any,
      { params: Promise.resolve({ id: 'pxc_1' }) },
    )
    const body = await res.json()
    expect(res.status).toBe(403)
    expect(body.error).toMatch(/persisted approval evidence/i)
    expect(store.updatePixelConfig).not.toHaveBeenCalled()
  })

  it('rejects caller-supplied approval overrides on pixel changes', async () => {
    store.getPixelConfig.mockResolvedValueOnce(baseConfig)

    const res = await PATCH(
      new Request('http://x', {
        method: 'PATCH',
        headers: { 'X-Org-Id': 'org_1', 'Content-Type': 'application/json' },
        body: JSON.stringify({ approvalCampaignId: 'cmp_1', approvedBy: 'client_1', name: 'Blocked Pixel' }),
      }) as any,
      {} as any,
      { params: Promise.resolve({ id: 'pxc_1' }) },
    )
    const body = await res.json()
    expect(res.status).toBe(400)
    expect(body.error).toMatch(/persisted records/i)
    expect(store.updatePixelConfig).not.toHaveBeenCalled()
  })

  it('calls setPlatformCapiToken for each platform with a plain capiToken and strips it from updatePixelConfig call', async () => {
    const updated = { ...baseConfig }
    store.getPixelConfig
      .mockResolvedValueOnce(baseConfig) // ownership check
      .mockResolvedValueOnce(updated)    // post-update fetch
    store.updatePixelConfig.mockResolvedValueOnce(undefined)
    store.setPlatformCapiToken.mockResolvedValue(undefined)

    campaigns.getCampaign.mockResolvedValueOnce(approvedCampaign)
    const res = await PATCH(
      new Request('http://x', {
        method: 'PATCH',
        headers: { 'X-Org-Id': 'org_1', 'Content-Type': 'application/json' },
        body: JSON.stringify({
          approvalCampaignId: 'cmp_1',
          meta: { pixelId: 'px_meta', capiToken: 'secret_token_123' },
        }),
      }) as any,
      {} as any,
      { params: Promise.resolve({ id: 'pxc_1' }) },
    )
    expect(res.status).toBe(200)
    // setPlatformCapiToken must have been called with the plaintext token
    expect(store.setPlatformCapiToken).toHaveBeenCalledWith('pxc_1', 'meta', 'secret_token_123')
    // updatePixelConfig patch must NOT contain capiToken
    const patchArg = store.updatePixelConfig.mock.calls[0][1]
    expect(patchArg.meta?.capiToken).toBeUndefined()
    // pixelId should still be in the patch
    expect(patchArg.meta?.pixelId).toBe('px_meta')
  })
})

// ─── DELETE ──────────────────────────────────────────────────────────────────

describe('DELETE /api/v1/ads/pixel-configs/[id]', () => {
  it('hard-deletes config and returns { deleted: true }', async () => {
    store.getPixelConfig.mockResolvedValueOnce(baseConfig)
    store.deletePixelConfig.mockResolvedValueOnce(undefined)
    campaigns.getCampaign.mockResolvedValueOnce(approvedCampaign)

    const res = await DELETE(makeReq(), {} as any, { params: Promise.resolve({ id: 'pxc_1' }) })
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.data.deleted).toBe(true)
    expect(store.deletePixelConfig).toHaveBeenCalledWith('pxc_1')
  })

  it('blocks pixel config delete when persisted approval evidence is missing', async () => {
    store.getPixelConfig.mockResolvedValueOnce(baseConfig)
    campaigns.getCampaign.mockResolvedValueOnce({ id: 'cmp_1', orgId: 'org_1', reviewState: 'draft' })

    const res = await DELETE(makeReq(), {} as any, { params: Promise.resolve({ id: 'pxc_1' }) })
    const body = await res.json()
    expect(res.status).toBe(403)
    expect(body.error).toMatch(/persisted approval evidence/i)
    expect(store.deletePixelConfig).not.toHaveBeenCalled()
  })

  it('returns 404 when config belongs to different org', async () => {
    store.getPixelConfig.mockResolvedValueOnce({ ...baseConfig, orgId: 'org_other' })
    const res = await DELETE(makeReq('org_1'), {} as any, { params: Promise.resolve({ id: 'pxc_1' }) })
    expect(res.status).toBe(404)
    expect(store.deletePixelConfig).not.toHaveBeenCalled()
  })
})
