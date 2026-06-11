// __tests__/app/api/v1/ads/saved-audiences/list-create.test.ts
import { GET, POST } from '@/app/api/v1/ads/saved-audiences/route'

jest.mock('@/lib/api/auth', () => ({ withAuth: (_r: string, h: any) => h }))
jest.mock('@/lib/ads/saved-audiences/store', () => ({
  listSavedAudiences: jest.fn(),
  createSavedAudience: jest.fn(),
  setSavedAudienceMetaId: jest.fn(),
  getSavedAudience: jest.fn(),
}))
jest.mock('@/lib/ads/api-helpers', () => ({
  requireMetaContext: jest.fn(),
}))
jest.mock('@/lib/ads/providers/meta', () => ({
  metaProvider: {
    savedAudienceCRUD: jest.fn(),
  },
}))

const store = jest.requireMock('@/lib/ads/saved-audiences/store')
const helpers = jest.requireMock('@/lib/ads/api-helpers')
const metaMock = jest.requireMock('@/lib/ads/providers/meta')

beforeEach(() => jest.clearAllMocks())

const baseConn = {
  orgId: 'org_1',
  accessToken: 'tok',
  adAccountId: 'act_42',
  connection: { id: 'conn_1' },
}

const baseSA = {
  id: 'sav_abc',
  orgId: 'org_1',
  name: 'My Saved Audience',
  platform: 'meta',
  targeting: { age_min: 25, age_max: 45 },
  providerData: { meta: { savedAudienceId: 'meta_sav_1' } },
}

describe('GET /api/v1/ads/saved-audiences', () => {
  it('returns saved audiences for org', async () => {
    store.listSavedAudiences.mockResolvedValueOnce([baseSA])
    const res = await GET(
      new Request('http://x', { headers: { 'X-Org-Id': 'org_1' } }) as any,
      { uid: 'u1' } as any,
      {} as any,
    )
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.success).toBe(true)
    expect(body.data).toHaveLength(1)
    expect(store.listSavedAudiences).toHaveBeenCalledWith(
      expect.objectContaining({ orgId: 'org_1' }),
    )
  })

  it('returns 400 when X-Org-Id is missing', async () => {
    const res = await GET(new Request('http://x') as any, { uid: 'u1' } as any, {} as any)
    expect(res.status).toBe(400)
  })
})

describe('POST /api/v1/ads/saved-audiences', () => {
  it('creates saved audience and syncs to Meta', async () => {
    helpers.requireMetaContext.mockResolvedValueOnce(baseConn)
    store.createSavedAudience.mockResolvedValueOnce(baseSA)
    metaMock.metaProvider.savedAudienceCRUD.mockResolvedValueOnce({ metaSavId: 'meta_sav_1' })
    store.setSavedAudienceMetaId.mockResolvedValueOnce(undefined)
    store.getSavedAudience.mockResolvedValueOnce({
      ...baseSA,
      providerData: { meta: { savedAudienceId: 'meta_sav_1' } },
    })

    const res = await POST(
      new Request('http://x', {
        method: 'POST',
        headers: { 'X-Org-Id': 'org_1', 'Content-Type': 'application/json' },
        body: JSON.stringify({
          input: {
            name: 'My Saved Audience',
            targeting: { age_min: 25, age_max: 45 },
          },
        }),
      }) as any,
      { uid: 'u1' } as any,
      {} as any,
    )
    const body = await res.json()
    expect(res.status).toBe(201)
    expect(body.success).toBe(true)
    expect(metaMock.metaProvider.savedAudienceCRUD).toHaveBeenCalledWith(
      expect.objectContaining({ op: 'create' }),
    )
    expect(store.setSavedAudienceMetaId).toHaveBeenCalledWith('sav_abc', 'meta_sav_1')
  })

  it('returns 400 when required fields are missing', async () => {
    helpers.requireMetaContext.mockResolvedValueOnce(baseConn)
    const res = await POST(
      new Request('http://x', {
        method: 'POST',
        headers: { 'X-Org-Id': 'org_1', 'Content-Type': 'application/json' },
        body: JSON.stringify({ input: { name: 'No targeting' } }),
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
    store.createSavedAudience.mockResolvedValueOnce(baseSA)
    metaMock.metaProvider.savedAudienceCRUD.mockRejectedValueOnce(new Error('Meta API error'))

    const res = await POST(
      new Request('http://x', {
        method: 'POST',
        headers: { 'X-Org-Id': 'org_1', 'Content-Type': 'application/json' },
        body: JSON.stringify({
          input: {
            name: 'My Saved Audience',
            targeting: { age_min: 25, age_max: 45 },
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

  it('returns 400 when name is missing', async () => {
    helpers.requireMetaContext.mockResolvedValueOnce(baseConn)
    const res = await POST(
      new Request('http://x', {
        method: 'POST',
        headers: { 'X-Org-Id': 'org_1', 'Content-Type': 'application/json' },
        body: JSON.stringify({ input: { targeting: { age_min: 18 } } }),
      }) as any,
      { uid: 'u1' } as any,
      {} as any,
    )
    expect(res.status).toBe(400)
  })
})
