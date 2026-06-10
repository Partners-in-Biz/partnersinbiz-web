// __tests__/app/api/v1/ads/custom-audiences/list-create.test.ts
import { GET, POST } from '@/app/api/v1/ads/custom-audiences/route'

jest.mock('@/lib/api/auth', () => ({ withAuth: (_r: string, h: any) => h }))
jest.mock('@/lib/ads/custom-audiences/store', () => ({
  listCustomAudiences: jest.fn(),
  createCustomAudience: jest.fn(),
  setCustomAudienceMetaId: jest.fn(),
  getCustomAudience: jest.fn(),
}))
jest.mock('@/lib/ads/api-helpers', () => ({
  requireMetaContext: jest.fn(),
}))
jest.mock('@/lib/ads/providers/meta', () => ({
  metaProvider: {
    customAudienceCRUD: jest.fn(),
  },
}))
jest.mock('@/lib/ads/activity', () => ({
  logCustomAudienceActivity: jest.fn().mockResolvedValue(undefined),
}))

const store = jest.requireMock('@/lib/ads/custom-audiences/store')
const helpers = jest.requireMock('@/lib/ads/api-helpers')
const metaMock = jest.requireMock('@/lib/ads/providers/meta')

beforeEach(() => jest.clearAllMocks())

const baseConn = {
  orgId: 'org_1',
  accessToken: 'tok',
  adAccountId: 'act_42',
  connection: { id: 'conn_1' },
}

const baseCA = {
  id: 'ca_abc',
  orgId: 'org_1',
  name: 'My Audience',
  type: 'CUSTOMER_LIST',
  status: 'BUILDING',
  platform: 'meta',
  providerData: { meta: { customAudienceId: 'meta_ca_1' } },
}

describe('GET /api/v1/ads/custom-audiences', () => {
  it('returns audiences for org', async () => {
    store.listCustomAudiences.mockResolvedValueOnce([baseCA])
    const res = await GET(
      new Request('http://x', { headers: { 'X-Org-Id': 'org_1' } }) as any,
      { uid: 'u1' } as any,
      {} as any,
    )
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.success).toBe(true)
    expect(body.data).toHaveLength(1)
    expect(store.listCustomAudiences).toHaveBeenCalledWith(
      expect.objectContaining({ orgId: 'org_1' }),
    )
  })

  it('passes type filter when ?type is set', async () => {
    store.listCustomAudiences.mockResolvedValueOnce([])
    await GET(
      new Request('http://x?type=CUSTOMER_LIST', { headers: { 'X-Org-Id': 'org_1' } }) as any,
      { uid: 'u1' } as any,
      {} as any,
    )
    expect(store.listCustomAudiences).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'CUSTOMER_LIST' }),
    )
  })

  it('passes status filter when ?status is set', async () => {
    store.listCustomAudiences.mockResolvedValueOnce([])
    await GET(
      new Request('http://x?status=READY', { headers: { 'X-Org-Id': 'org_1' } }) as any,
      { uid: 'u1' } as any,
      {} as any,
    )
    expect(store.listCustomAudiences).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'READY' }),
    )
  })

  it('returns 400 when X-Org-Id is missing', async () => {
    const res = await GET(new Request('http://x') as any, { uid: 'u1' } as any, {} as any)
    expect(res.status).toBe(400)
  })
})

describe('POST /api/v1/ads/custom-audiences', () => {
  it('creates audience and syncs to Meta', async () => {
    helpers.requireMetaContext.mockResolvedValueOnce(baseConn)
    store.createCustomAudience.mockResolvedValueOnce(baseCA)
    metaMock.metaProvider.customAudienceCRUD.mockResolvedValueOnce({ metaCaId: 'meta_ca_1' })
    store.setCustomAudienceMetaId.mockResolvedValueOnce(undefined)
    store.getCustomAudience.mockResolvedValueOnce({ ...baseCA, providerData: { meta: { customAudienceId: 'meta_ca_1' } } })

    const res = await POST(
      new Request('http://x', {
        method: 'POST',
        headers: { 'X-Org-Id': 'org_1', 'Content-Type': 'application/json' },
        body: JSON.stringify({
          input: {
            name: 'My Audience',
            type: 'CUSTOMER_LIST',
            source: { kind: 'CUSTOMER_LIST', csvStoragePath: 'orgs/org_1/uploads/list.csv', hashCount: 0, uploadedAt: null },
          },
        }),
      }) as any,
      { uid: 'u1' } as any,
      {} as any,
    )
    const body = await res.json()
    expect(res.status).toBe(201)
    expect(body.success).toBe(true)
    expect(metaMock.metaProvider.customAudienceCRUD).toHaveBeenCalledWith(
      expect.objectContaining({ op: 'create' }),
    )
    expect(store.setCustomAudienceMetaId).toHaveBeenCalledWith('ca_abc', 'meta_ca_1')
  })

  it('returns 400 when required fields are missing', async () => {
    helpers.requireMetaContext.mockResolvedValueOnce(baseConn)
    const res = await POST(
      new Request('http://x', {
        method: 'POST',
        headers: { 'X-Org-Id': 'org_1', 'Content-Type': 'application/json' },
        body: JSON.stringify({ input: { name: 'No type or source' } }),
      }) as any,
      { uid: 'u1' } as any,
      {} as any,
    )
    expect(res.status).toBe(400)
  })

  it('short-circuits when requireMetaContext returns Response', async () => {
    const errRes = new Response(JSON.stringify({ success: false, error: 'no conn' }), { status: 404 })
    helpers.requireMetaContext.mockResolvedValueOnce(errRes)
    const res = await POST(
      new Request('http://x', {
        method: 'POST',
        headers: { 'X-Org-Id': 'org_1', 'Content-Type': 'application/json' },
        body: JSON.stringify({ input: {} }),
      }) as any,
      { uid: 'u1' } as any,
      {} as any,
    )
    expect(res.status).toBe(404)
  })

  it('returns 500 when Meta sync fails', async () => {
    helpers.requireMetaContext.mockResolvedValueOnce(baseConn)
    store.createCustomAudience.mockResolvedValueOnce(baseCA)
    metaMock.metaProvider.customAudienceCRUD.mockRejectedValueOnce(new Error('Meta API error'))

    const res = await POST(
      new Request('http://x', {
        method: 'POST',
        headers: { 'X-Org-Id': 'org_1', 'Content-Type': 'application/json' },
        body: JSON.stringify({
          input: {
            name: 'My Audience',
            type: 'CUSTOMER_LIST',
            source: { kind: 'CUSTOMER_LIST', csvStoragePath: 'orgs/org_1/uploads/list.csv', hashCount: 0, uploadedAt: null },
          },
        }),
      }) as any,
      { uid: 'u1' } as any,
      {} as any,
    )
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.error).toContain('Meta sync failed')
  })
})
