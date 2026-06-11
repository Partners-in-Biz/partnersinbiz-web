// __tests__/app/api/v1/ads/creatives/sync-platform.test.ts
import { POST } from '@/app/api/v1/ads/creatives/[id]/sync/[platform]/route'

jest.mock('@/lib/api/auth', () => ({ withAuth: (_r: string, h: any) => h }))
jest.mock('@/lib/ads/creatives/store', () => ({
  getCreative: jest.fn(),
}))
jest.mock('@/lib/ads/api-helpers', () => ({
  requireMetaContext: jest.fn(),
}))
jest.mock('@/lib/ads/types', () => {
  const actual = jest.requireActual('@/lib/ads/types')
  return {
    ...actual,
    isAdPlatform: jest.fn((v: unknown) =>
      ['meta', 'google', 'linkedin', 'tiktok'].includes(String(v)),
    ),
  }
})
jest.mock('@/lib/ads/registry', () => ({
  getProvider: jest.fn(),
}))

const store = jest.requireMock('@/lib/ads/creatives/store')
const helpers = jest.requireMock('@/lib/ads/api-helpers')
const registryMock = jest.requireMock('@/lib/ads/registry')

beforeEach(() => jest.clearAllMocks())

const baseCreative = {
  id: 'crv_1',
  orgId: 'org_1',
  type: 'image',
  name: 'Hero',
  storagePath: 'orgs/org_1/ad_creatives/crv_1/source.jpg',
  sourceUrl: 'https://storage.googleapis.com/bucket/source.jpg',
  mimeType: 'image/jpeg',
  fileSize: 250_000,
  status: 'READY',
  approvalStatus: 'approved',
  approvalTaskId: 'task_approved',
  platformRefs: {},
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

describe('POST /api/v1/ads/creatives/[id]/sync/[platform]', () => {
  it('meta happy path: returns creativeId + alreadySynced', async () => {
    store.getCreative.mockResolvedValueOnce(baseCreative)
    helpers.requireMetaContext.mockResolvedValueOnce(baseCtx)
    registryMock.getProvider.mockReturnValueOnce({
      syncCreative: jest.fn().mockResolvedValueOnce({
        metaCreativeId: 'imgh_abc123',
        alreadySynced: false,
      }),
    })

    const res = await POST(
      makeReq(),
      {} as any,
      { params: Promise.resolve({ id: 'crv_1', platform: 'meta' }) },
    )
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.success).toBe(true)
    expect(body.data.platform).toBe('meta')
    expect(body.data.creativeId).toBe('imgh_abc123')
    expect(body.data.alreadySynced).toBe(false)
  })

  it('google platform → 501 not implemented', async () => {
    store.getCreative.mockResolvedValueOnce(baseCreative)

    const res = await POST(
      makeReq(),
      {} as any,
      { params: Promise.resolve({ id: 'crv_1', platform: 'google' }) },
    )
    expect(res.status).toBe(501)
  })

  it('missing meta connection → 404 from requireMetaContext', async () => {
    store.getCreative.mockResolvedValueOnce(baseCreative)
    const errRes = new Response(
      JSON.stringify({ success: false, error: 'No meta connection for this org' }),
      { status: 404 },
    )
    helpers.requireMetaContext.mockResolvedValueOnce(errRes)

    const res = await POST(
      makeReq(),
      {} as any,
      { params: Promise.resolve({ id: 'crv_1', platform: 'meta' }) },
    )
    expect(res.status).toBe(404)
  })

  it('blocks approved-looking creatives when paid-media approval evidence is absent before provider sync', async () => {
    store.getCreative.mockResolvedValueOnce({
      ...baseCreative,
      approvalStatus: 'draft',
      approvalTaskId: undefined,
      approvalDocumentId: undefined,
      approvalCommentId: undefined,
    })

    const res = await POST(
      makeReq(),
      {} as any,
      { params: Promise.resolve({ id: 'crv_1', platform: 'meta' }) },
    )
    const body = await res.json()

    expect(res.status).toBe(403)
    expect(body.error).toMatch(/approval evidence/i)
    expect(helpers.requireMetaContext).not.toHaveBeenCalled()
    expect(registryMock.getProvider).not.toHaveBeenCalled()
  })
})
