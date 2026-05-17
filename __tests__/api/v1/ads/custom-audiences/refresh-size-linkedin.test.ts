// __tests__/api/v1/ads/custom-audiences/refresh-size-linkedin.test.ts
// LinkedIn arm of POST /api/v1/ads/custom-audiences/[id]/refresh-size.
// Sub-3b Phase 3 Batch 2C.

// ─── Auth bypass ─────────────────────────────────────────────────────────────
jest.mock('@/lib/api/auth', () => ({ withAuth: (_r: string, h: any) => h }))

// ─── requireMetaContext — not used for LinkedIn branch ───────────────────────
jest.mock('@/lib/ads/api-helpers', () => ({
  requireMetaContext: jest.fn(),
}))

// ─── Custom audience store ────────────────────────────────────────────────────
const mockGetCustomAudience = jest.fn()
const mockUpdateCustomAudience = jest.fn()
jest.mock('@/lib/ads/custom-audiences/store', () => ({
  getCustomAudience: (...args: any[]) => mockGetCustomAudience(...args),
  updateCustomAudience: (...args: any[]) => mockUpdateCustomAudience(...args),
}))

// ─── LinkedIn connection helpers ──────────────────────────────────────────────
const mockGetConnection = jest.fn()
const mockDecryptAccessToken = jest.fn()
jest.mock('@/lib/ads/connections/store', () => ({
  getConnection: (...args: any[]) => mockGetConnection(...args),
  decryptAccessToken: (...args: any[]) => mockDecryptAccessToken(...args),
}))

// ─── LinkedIn audiences provider (dynamic import mock) ───────────────────────
const mockGetAudienceStatus = jest.fn()
jest.mock('@/lib/ads/providers/linkedin/audiences', () => ({
  getAudienceStatus: (...args: any[]) => mockGetAudienceStatus(...args),
}))

// ─── Meta provider (not used in LinkedIn branch) ────────────────────────────
jest.mock('@/lib/ads/providers/meta', () => ({
  metaProvider: { customAudienceCRUD: jest.fn() },
}))

// ─── Import route after mocks ─────────────────────────────────────────────────
import { POST } from '@/app/api/v1/ads/custom-audiences/[id]/refresh-size/route'

// ─── Helpers ─────────────────────────────────────────────────────────────────
const fakeConn = {
  meta: { linkedin: { selectedAdAccountUrn: 'urn:li:sponsoredAccount:123456' } },
  accessTokenEnc: {},
}
const fakeAudience = {
  id: 'ca_deadbeef',
  orgId: 'org-001',
  platform: 'linkedin',
  name: 'LinkedIn Audience',
  status: 'BUILDING',
  approximateSize: undefined,
  providerData: { linkedin: { dmpSegmentUrn: 'urn:li:dmpSegment:88888' } },
}

function makeReq(orgId = 'org-001') {
  return {
    headers: { get: (k: string) => (k === 'X-Org-Id' ? orgId : null) },
    json: async () => ({}),
  } as any
}

beforeEach(() => {
  jest.clearAllMocks()
  mockGetConnection.mockResolvedValue(fakeConn)
  mockDecryptAccessToken.mockReturnValue('li-access-token')
  mockGetCustomAudience.mockResolvedValue(fakeAudience)
  mockUpdateCustomAudience.mockResolvedValue(undefined)
  mockGetAudienceStatus.mockResolvedValue({ status: 'READY', approximateMemberCount: 12500 })
})

describe('POST /api/v1/ads/custom-audiences/[id]/refresh-size — LinkedIn dispatch', () => {
  // Test 5: Calls getAudienceStatus + updates status + memberCount
  it('calls getAudienceStatus and updates canonical status and memberCount', async () => {
    const res = await POST(
      makeReq(),
      null as any,
      { params: Promise.resolve({ id: 'ca_deadbeef' }) } as any,
    )

    expect(res.status).toBe(200)
    expect(mockGetAudienceStatus).toHaveBeenCalledTimes(1)
    const call = mockGetAudienceStatus.mock.calls[0][0]
    expect(call.accountUrn).toBe('urn:li:sponsoredAccount:123456')
    expect(call.accessToken).toBe('li-access-token')
    expect(call.segmentUrn).toBe('urn:li:dmpSegment:88888')

    expect(mockUpdateCustomAudience).toHaveBeenCalledWith('ca_deadbeef', {
      status: 'READY',
      approximateSize: 12500,
    })

    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.data.status).toBe('READY')
    expect(body.data.memberCount).toBe(12500)
  })

  // Test 6: Returns 400 if dmpSegmentUrn missing on audience
  it('returns 400 when dmpSegmentUrn is absent from audience providerData', async () => {
    mockGetCustomAudience.mockResolvedValue({
      ...fakeAudience,
      providerData: { linkedin: {} }, // dmpSegmentUrn intentionally missing
    })

    const res = await POST(
      makeReq(),
      null as any,
      { params: Promise.resolve({ id: 'ca_deadbeef' }) } as any,
    )

    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/dmpSegmentUrn/i)
    expect(mockGetAudienceStatus).not.toHaveBeenCalled()
  })

  // Test 7: Maps LinkedIn BUILDING status → canonical BUILDING
  it('maps LinkedIn BUILDING status to canonical BUILDING', async () => {
    mockGetAudienceStatus.mockResolvedValue({ status: 'BUILDING', approximateMemberCount: undefined })

    const res = await POST(
      makeReq(),
      null as any,
      { params: Promise.resolve({ id: 'ca_deadbeef' }) } as any,
    )

    expect(res.status).toBe(200)
    expect(mockUpdateCustomAudience).toHaveBeenCalledWith('ca_deadbeef', {
      status: 'BUILDING',
      approximateSize: undefined,
    })

    const body = await res.json()
    expect(body.data.status).toBe('BUILDING')
    expect(body.data.memberCount).toBeUndefined()
  })
})
