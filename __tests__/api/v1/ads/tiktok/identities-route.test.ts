// __tests__/api/v1/ads/tiktok/identities-route.test.ts
// Verifies GET /api/v1/ads/tiktok/identities — Phase 2 Batch 3A.

import { GET } from '@/app/api/v1/ads/tiktok/identities/route'

// ─── Auth bypass ─────────────────────────────────────────────────────────────
jest.mock('@/lib/api/auth', () => ({ withAuth: (_r: string, h: any) => h }))

// ─── Connection helpers ───────────────────────────────────────────────────────
jest.mock('@/lib/ads/connections/store', () => ({
  getConnection: jest.fn(),
  decryptAccessToken: jest.fn().mockReturnValue('tk-access-token'),
}))

// ─── TikTok identities provider ──────────────────────────────────────────────
jest.mock('@/lib/ads/providers/tiktok/identities', () => ({
  listIdentities: jest.fn(),
}))

// ─── Identity store ───────────────────────────────────────────────────────────
jest.mock('@/lib/ads/identities/store', () => ({
  upsertIdentity: jest.fn(),
}))

// ─── Imports after mocks ──────────────────────────────────────────────────────
const { getConnection, decryptAccessToken } = jest.requireMock('@/lib/ads/connections/store')
const { listIdentities: tiktokListIdentities } = jest.requireMock('@/lib/ads/providers/tiktok/identities')
const { upsertIdentity } = jest.requireMock('@/lib/ads/identities/store')

// ─── Shared stubs ─────────────────────────────────────────────────────────────
const fakeTiktokConn = {
  meta: { tiktok: { selectedAdvertiserId: '123456789' } },
  accessTokenEnc: {},
}

const fakeIdentityRecords = [
  { identityId: 'iden-001', identityType: 'AUTH_CODE', displayName: 'My Brand', profileImageUrl: 'https://img.co/1.jpg' },
  { identityId: 'iden-002', identityType: 'TT_USER', displayName: 'TikTok User' },
]

const fakePersistedIdentities = [
  { id: 'id_abc', orgId: 'org-001', platform: 'tiktok', accountId: '123456789', identityId: 'iden-001', identityType: 'AUTH_CODE', displayName: 'My Brand' },
  { id: 'id_def', orgId: 'org-001', platform: 'tiktok', accountId: '123456789', identityId: 'iden-002', identityType: 'TT_USER', displayName: 'TikTok User' },
]

function makeReq(orgId = 'org-001') {
  return new Request('http://x/api/v1/ads/tiktok/identities', {
    method: 'GET',
    headers: { 'X-Org-Id': orgId },
  })
}

beforeEach(() => {
  jest.clearAllMocks()
  getConnection.mockResolvedValue(fakeTiktokConn)
  decryptAccessToken.mockReturnValue('tk-access-token')
  tiktokListIdentities.mockResolvedValue(fakeIdentityRecords)
  upsertIdentity.mockImplementation((args: { identityId: string }) =>
    Promise.resolve(fakePersistedIdentities.find((p) => p.identityId === args.identityId)),
  )
})

describe('GET /api/v1/ads/tiktok/identities', () => {
  // Test 7: returns 400 if no TikTok connection
  it('returns 400 if no TikTok ads connection for org', async () => {
    getConnection.mockResolvedValue(null)

    const res = await GET(makeReq() as any)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/TikTok ads connection/i)
  })

  // Test 8: lists identities from TikTok and upserts them to ad_identities
  it('lists identities from TikTok and upserts each into ad_identities', async () => {
    const res = await GET(makeReq() as any)
    expect(res.status).toBe(200)

    expect(tiktokListIdentities).toHaveBeenCalledTimes(1)
    const listCall = tiktokListIdentities.mock.calls[0][0]
    expect(listCall.advertiserId).toBe('123456789')

    expect(upsertIdentity).toHaveBeenCalledTimes(2)
    const firstUpsert = upsertIdentity.mock.calls[0][0]
    expect(firstUpsert.orgId).toBe('org-001')
    expect(firstUpsert.platform).toBe('tiktok')
    expect(firstUpsert.accountId).toBe('123456789')
    expect(firstUpsert.identityId).toBe('iden-001')
    expect(firstUpsert.identityType).toBe('AUTH_CODE')
    expect(firstUpsert.displayName).toBe('My Brand')
  })

  // Test 9: returns persisted records in response
  it('returns persisted identity records in the response body', async () => {
    const res = await GET(makeReq() as any)
    expect(res.status).toBe(200)

    const body = await res.json()
    // apiSuccess wraps in { success, data }
    const data = body.data ?? body
    expect(data.identities).toHaveLength(2)
    expect(data.identities[0].identityId).toBe('iden-001')
    expect(data.identities[1].identityId).toBe('iden-002')
  })
})
