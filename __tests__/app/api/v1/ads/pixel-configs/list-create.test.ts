// __tests__/app/api/v1/ads/pixel-configs/list-create.test.ts
import { GET, POST } from '@/app/api/v1/ads/pixel-configs/route'

jest.mock('@/lib/api/auth', () => ({ withAuth: (_r: string, h: any) => h }))
jest.mock('@/lib/ads/pixel-configs/store', () => ({
  listPixelConfigs: jest.fn(),
  createPixelConfig: jest.fn(),
  setPlatformCapiToken: jest.fn(),
}))
jest.mock('@/lib/ads/campaigns/store', () => ({
  getCampaign: jest.fn(),
}))
jest.mock('@/lib/api/capabilityGate', () => ({ enforceAgentCapability: jest.fn(() => null) }))

const store = jest.requireMock('@/lib/ads/pixel-configs/store')
const campaignStore = jest.requireMock('@/lib/ads/campaigns/store')

beforeEach(() => jest.clearAllMocks())

const baseConfig = {
  id: 'pxc_abc123',
  orgId: 'org_1',
  name: 'My Pixel Config',
  eventMappings: [],
  meta: {
    pixelId: 'px_111',
    capiTokenEnc: { ciphertext: 'enc_data', iv: 'iv_data', tag: 'tag_data' },
  },
  createdBy: 'u1',
  createdAt: { toDate: () => new Date() },
  updatedAt: { toDate: () => new Date() },
}

const approvedCampaign = {
  id: 'cmp_1',
  orgId: 'org_1',
  reviewState: 'approved',
  approvedAt: { seconds: 1 },
  approvedBy: 'approver_1',
}

describe('GET /api/v1/ads/pixel-configs', () => {
  it('returns configs with capiTokenEnc stripped', async () => {
    store.listPixelConfigs.mockResolvedValueOnce([baseConfig])

    const res = await GET(
      new Request('http://x', { headers: { 'X-Org-Id': 'org_1' } }) as any,
      { uid: 'u1' } as any,
      {} as any,
    )
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.success).toBe(true)
    expect(body.data).toHaveLength(1)
    // Secret must be stripped
    expect(body.data[0].meta?.capiTokenEnc).toBeUndefined()
    // pixelId should still be present
    expect(body.data[0].meta?.pixelId).toBe('px_111')
    expect(store.listPixelConfigs).toHaveBeenCalledWith({ orgId: 'org_1', propertyId: undefined })
  })

  it('returns 400 when X-Org-Id header is missing', async () => {
    const res = await GET(new Request('http://x') as any, { uid: 'u1' } as any, {} as any)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.success).toBe(false)
  })

  it('filters by propertyId when query param is provided', async () => {
    store.listPixelConfigs.mockResolvedValueOnce([])

    const res = await GET(
      new Request('http://x?propertyId=prop_99', {
        headers: { 'X-Org-Id': 'org_1' },
      }) as any,
      { uid: 'u1' } as any,
      {} as any,
    )
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(store.listPixelConfigs).toHaveBeenCalledWith({
      orgId: 'org_1',
      propertyId: 'prop_99',
    })
    expect(body.data).toHaveLength(0)
  })
})

describe('POST /api/v1/ads/pixel-configs', () => {
  it('creates config and calls setPlatformCapiToken for plaintext token', async () => {
    campaignStore.getCampaign.mockResolvedValueOnce(approvedCampaign)
    store.createPixelConfig.mockResolvedValueOnce(baseConfig)
    store.setPlatformCapiToken.mockResolvedValue(undefined)

    const res = await POST(
      new Request('http://x', {
        method: 'POST',
        headers: { 'X-Org-Id': 'org_1', 'Content-Type': 'application/json' },
        body: JSON.stringify({
          approvalCampaignId: 'cmp_1',
          input: {
            name: 'My Pixel Config',
            eventMappings: [],
            meta: { pixelId: 'px_111', capiToken: 'plain_secret_token' },
          },
        }),
      }) as any,
      { uid: 'u1' } as any,
      {} as any,
    )
    const body = await res.json()

    expect(res.status).toBe(201)
    expect(body.success).toBe(true)
    // Encryption call must have been made with the plaintext token
    expect(store.setPlatformCapiToken).toHaveBeenCalledWith('pxc_abc123', 'meta', 'plain_secret_token')
    // Secret stripped from response
    expect(body.data?.meta?.capiTokenEnc).toBeUndefined()
  })

  it('returns 400 when name is missing after approval gate passes', async () => {
    campaignStore.getCampaign.mockResolvedValueOnce(approvedCampaign)
    const res = await POST(
      new Request('http://x', {
        method: 'POST',
        headers: { 'X-Org-Id': 'org_1', 'Content-Type': 'application/json' },
        body: JSON.stringify({
          approvalCampaignId: 'cmp_1',
          input: { eventMappings: [], meta: { pixelId: 'px_111' } },
        }),
      }) as any,
      { uid: 'u1' } as any,
      {} as any,
    )

    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.success).toBe(false)
    expect(store.createPixelConfig).not.toHaveBeenCalled()
  })
})
