// __tests__/api/v1/ads/google/audiences/browse.test.ts
// Tests for GET /api/v1/ads/google/audiences/browse
// Sub-3a Phase 5 Batch 3 E

import { GET } from '@/app/api/v1/ads/google/audiences/browse/route'

// ─── Auth bypass ─────────────────────────────────────────────────────────────
jest.mock('@/lib/api/auth', () => ({ withAuth: (_r: string, h: any) => h }))

// ─── Google connection helpers ────────────────────────────────────────────────
jest.mock('@/lib/ads/connections/store', () => ({
  getConnection: jest.fn(),
  decryptAccessToken: jest.fn(),
}))
jest.mock('@/lib/integrations/google_ads/oauth', () => ({
  readDeveloperToken: jest.fn(),
}))

// ─── browse-predefined helpers (dynamic imports mocked at module level) ───────
jest.mock('@/lib/ads/providers/google/audiences/browse-predefined', () => ({
  listAffinityAudiences: jest.fn(),
  listInMarketAudiences: jest.fn(),
  listDetailedDemographics: jest.fn(),
}))

// ─── Imports after mocks ──────────────────────────────────────────────────────
const { getConnection, decryptAccessToken } = jest.requireMock('@/lib/ads/connections/store')
const { readDeveloperToken } = jest.requireMock('@/lib/integrations/google_ads/oauth')
const { listAffinityAudiences, listInMarketAudiences, listDetailedDemographics } =
  jest.requireMock('@/lib/ads/providers/google/audiences/browse-predefined')

// ─── Shared stubs ─────────────────────────────────────────────────────────────
const fakeConn = {
  defaultAdAccountId: '1234567890',
  meta: { google: { loginCustomerId: '9999999999' } },
  accessTokenEnc: {},
}
const fakeAffinityAudiences = [
  { resourceName: 'customers/1234567890/userInterests/1', name: 'Sports & Fitness' },
  { resourceName: 'customers/1234567890/userInterests/2', name: 'Travel Buffs' },
]
const fakeInMarketAudiences = [
  { resourceName: 'customers/1234567890/userInterests/100', name: 'Autos & Vehicles' },
]
const fakeDemographics = [
  { resourceName: 'customers/1234567890/userInterests/200', name: 'Homeowners' },
]

function makeReq(params: Record<string, string> = {}) {
  const url = new URL('http://x/api/v1/ads/google/audiences/browse')
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v))
  return new Request(url.toString(), {
    method: 'GET',
    headers: { 'X-Org-Id': 'org-001' },
  }) as any
}

const fakeUser = { uid: 'user-001', email: 'admin@test.com' }

beforeEach(() => {
  jest.clearAllMocks()
  getConnection.mockResolvedValue(fakeConn)
  decryptAccessToken.mockReturnValue('access-token')
  readDeveloperToken.mockReturnValue('dev-token')
  listAffinityAudiences.mockResolvedValue(fakeAffinityAudiences)
  listInMarketAudiences.mockResolvedValue(fakeInMarketAudiences)
  listDetailedDemographics.mockResolvedValue(fakeDemographics)
})

describe('GET /api/v1/ads/google/audiences/browse', () => {
  // Test 1: type=AFFINITY calls listAffinityAudiences
  it('calls listAffinityAudiences when type=AFFINITY', async () => {
    const res = await GET(makeReq({ type: 'AFFINITY' }), fakeUser as any)

    expect(res.status).toBe(200)
    expect(listAffinityAudiences).toHaveBeenCalledTimes(1)
    expect(listInMarketAudiences).not.toHaveBeenCalled()
    expect(listDetailedDemographics).not.toHaveBeenCalled()

    const call = listAffinityAudiences.mock.calls[0][0]
    expect(call.customerId).toBe('1234567890')
    expect(call.loginCustomerId).toBe('9999999999')
    expect(call.accessToken).toBe('access-token')
    expect(call.developerToken).toBe('dev-token')

    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.data.audiences).toEqual(fakeAffinityAudiences)
  })

  // Test 2: type=IN_MARKET calls listInMarketAudiences
  it('calls listInMarketAudiences when type=IN_MARKET', async () => {
    const res = await GET(makeReq({ type: 'IN_MARKET' }), fakeUser as any)

    expect(res.status).toBe(200)
    expect(listInMarketAudiences).toHaveBeenCalledTimes(1)
    expect(listAffinityAudiences).not.toHaveBeenCalled()

    const body = await res.json()
    expect(body.data.audiences).toEqual(fakeInMarketAudiences)
  })

  // Test 3: type=DETAILED_DEMOGRAPHICS calls listDetailedDemographics
  it('calls listDetailedDemographics when type=DETAILED_DEMOGRAPHICS', async () => {
    const res = await GET(makeReq({ type: 'DETAILED_DEMOGRAPHICS' }), fakeUser as any)

    expect(res.status).toBe(200)
    expect(listDetailedDemographics).toHaveBeenCalledTimes(1)
    expect(listAffinityAudiences).not.toHaveBeenCalled()
    expect(listInMarketAudiences).not.toHaveBeenCalled()

    const body = await res.json()
    expect(body.data.audiences).toEqual(fakeDemographics)
  })

  // Test 4: Missing type returns 400
  it('returns 400 when type query param is absent', async () => {
    const res = await GET(makeReq(), fakeUser as any)

    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.success).toBe(false)
    expect(body.error).toMatch(/AFFINITY.*IN_MARKET.*DETAILED_DEMOGRAPHICS/i)
    expect(listAffinityAudiences).not.toHaveBeenCalled()
  })

  // Test 5: Invalid type returns 400
  it('returns 400 for an unrecognised type value', async () => {
    const res = await GET(makeReq({ type: 'LOOKALIKE' }), fakeUser as any)

    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.success).toBe(false)
  })

  // Test 6: No Google connection returns 400
  it('returns 400 when no Google connection exists for org', async () => {
    getConnection.mockResolvedValue(null)

    const res = await GET(makeReq({ type: 'AFFINITY' }), fakeUser as any)

    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/no google ads connection/i)
    expect(listAffinityAudiences).not.toHaveBeenCalled()
  })
})
