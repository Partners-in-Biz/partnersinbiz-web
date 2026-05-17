// __tests__/api/v1/ads/custom-audiences/linkedin-route-dispatch.test.ts
// LinkedIn audience dispatch tests for POST /api/v1/ads/custom-audiences.
// Sub-3b Phase 3 Batch 2B

import { POST } from '@/app/api/v1/ads/custom-audiences/route'

// ─── Auth bypass ─────────────────────────────────────────────────────────────
jest.mock('@/lib/api/auth', () => ({ withAuth: (_r: string, h: any) => h }))

// ─── requireMetaContext — not used for LinkedIn branch ───────────────────────
jest.mock('@/lib/ads/api-helpers', () => ({
  requireMetaContext: jest.fn(),
}))

// ─── Custom audience store ────────────────────────────────────────────────────
jest.mock('@/lib/ads/custom-audiences/store', () => ({
  createCustomAudience: jest.fn().mockResolvedValue({
    id: 'ca_test123',
    orgId: 'org-001',
    platform: 'linkedin',
    name: 'Test LinkedIn Audience',
    description: '',
    type: 'CUSTOMER_LIST',
    status: 'BUILDING',
    source: { kind: 'CUSTOMER_LIST', csvStoragePath: '', hashCount: 0, uploadedAt: { seconds: 1000000, nanoseconds: 0 } },
    providerData: {},
    createdBy: 'user-001',
    createdAt: { seconds: 1000000, nanoseconds: 0 },
    updatedAt: { seconds: 1000000, nanoseconds: 0 },
  }),
  listCustomAudiences: jest.fn(),
  setCustomAudienceMetaId: jest.fn(),
  getCustomAudience: jest.fn().mockResolvedValue({
    id: 'ca_test123',
    orgId: 'org-001',
    platform: 'linkedin',
    name: 'Test LinkedIn Audience',
    description: '',
    type: 'CUSTOMER_LIST',
    status: 'BUILDING',
    source: { kind: 'CUSTOMER_LIST', csvStoragePath: '', hashCount: 0, uploadedAt: { seconds: 1000000, nanoseconds: 0 } },
    providerData: { linkedin: { dmpSegmentUrn: 'urn:li:dmpSegment:99' } },
    createdBy: 'user-001',
    createdAt: { seconds: 1000000, nanoseconds: 0 },
    updatedAt: { seconds: 1000000, nanoseconds: 0 },
  }),
}))

// ─── LinkedIn connection helpers ──────────────────────────────────────────────
jest.mock('@/lib/ads/connections/store', () => ({
  getConnection: jest.fn(),
  decryptAccessToken: jest.fn(),
}))

// ─── Google oauth (imported by route but not used in LinkedIn branch) ─────────
jest.mock('@/lib/integrations/google_ads/oauth', () => ({
  readDeveloperToken: jest.fn(),
}))

// ─── Firebase admin (for direct adminDb writes in LinkedIn branch) ────────────
const mockUpdate = jest.fn().mockResolvedValue(undefined)
const mockSet = jest.fn().mockResolvedValue(undefined)
jest.mock('@/lib/firebase/admin', () => ({
  adminDb: {
    collection: jest.fn().mockReturnValue({
      doc: jest.fn().mockReturnValue({
        set: mockSet,
        update: mockUpdate,
      }),
    }),
  },
}))

// ─── firebase-admin/firestore Timestamp ──────────────────────────────────────
jest.mock('firebase-admin/firestore', () => ({
  Timestamp: {
    now: jest.fn().mockReturnValue({ seconds: 1000000, nanoseconds: 0 }),
  },
}))

// ─── crypto — deterministic id generation ────────────────────────────────────
jest.mock('crypto', () => ({
  ...jest.requireActual('crypto'),
  randomBytes: jest.fn().mockReturnValue(Buffer.from('deadbeefcafebabe', 'hex')),
}))

// ─── LinkedIn audience helpers (dynamic imports mocked at module level) ───────
jest.mock('@/lib/ads/providers/linkedin/audiences', () => ({
  createContactListAudience: jest.fn().mockResolvedValue({ urn: 'urn:li:dmpSegment:99', id: '99' }),
  createWebsiteAudience: jest.fn().mockResolvedValue({ urn: 'urn:li:dmpSegment:100', id: '100' }),
  createLookalikeAudience: jest.fn().mockResolvedValue({ urn: 'urn:li:dmpSegment:101', id: '101' }),
  createEngagementAudience: jest.fn().mockResolvedValue({ urn: 'urn:li:dmpSegment:102', id: '102' }),
  createAppAudience: jest.fn(),
  getAudienceStatus: jest.fn(),
  archiveAudience: jest.fn(),
}))

// ─── Meta provider (not used in LinkedIn branch) ─────────────────────────────
jest.mock('@/lib/ads/providers/meta', () => ({
  metaProvider: { customAudienceCRUD: jest.fn() },
}))
jest.mock('@/lib/ads/activity', () => ({
  logCustomAudienceActivity: jest.fn(),
}))

// ─── Imports after mocks ──────────────────────────────────────────────────────
const { getConnection, decryptAccessToken } = jest.requireMock('@/lib/ads/connections/store')
const { createContactListAudience, createWebsiteAudience, createLookalikeAudience, createEngagementAudience } =
  jest.requireMock('@/lib/ads/providers/linkedin/audiences')

// ─── Shared stubs ─────────────────────────────────────────────────────────────
const fakeConn = {
  meta: { linkedin: { selectedAdAccountUrn: 'urn:li:sponsoredAccount:123456' } },
  accessTokenEnc: {},
}

function makeReq(body: object) {
  return new Request('http://x/api/v1/ads/custom-audiences', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Org-Id': 'org-001' },
    body: JSON.stringify(body),
  }) as any
}

const fakeUser = { uid: 'user-001', email: 'admin@test.com' }

beforeEach(() => {
  jest.clearAllMocks()
  getConnection.mockResolvedValue(fakeConn)
  decryptAccessToken.mockReturnValue('li-access-token')
  createContactListAudience.mockResolvedValue({ urn: 'urn:li:dmpSegment:99', id: '99' })
  createWebsiteAudience.mockResolvedValue({ urn: 'urn:li:dmpSegment:100', id: '100' })
  createLookalikeAudience.mockResolvedValue({ urn: 'urn:li:dmpSegment:101', id: '101' })
  createEngagementAudience.mockResolvedValue({ urn: 'urn:li:dmpSegment:102', id: '102' })
  mockUpdate.mockResolvedValue(undefined)
})

describe('POST /api/v1/ads/custom-audiences — LinkedIn dispatch', () => {
  // Test 1: CUSTOMER_LIST creates audience + stamps providerData.linkedin.dmpSegmentUrn
  it('creates CUSTOMER_LIST audience and stamps dmpSegmentUrn in providerData', async () => {
    const res = await POST(
      makeReq({
        platform: 'linkedin',
        name: 'My CRM List',
        type: 'CUSTOMER_LIST',
      }),
      fakeUser as any,
    )

    expect(res.status).toBe(201)
    expect(createContactListAudience).toHaveBeenCalledTimes(1)
    const createCall = createContactListAudience.mock.calls[0][0]
    expect(createCall.accountUrn).toBe('urn:li:sponsoredAccount:123456')
    expect(createCall.accessToken).toBe('li-access-token')
    expect(createCall.name).toBe('My CRM List')

    // adminDb.update called to stamp dmpSegmentUrn
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        providerData: expect.objectContaining({
          linkedin: expect.objectContaining({ dmpSegmentUrn: 'urn:li:dmpSegment:99' }),
        }),
      }),
    )

    const body = await res.json()
    expect(body.success).toBe(true)
  })

  // Test 2: WEBSITE without insightTagId returns 400
  it('returns 400 for WEBSITE when insightTagId is missing', async () => {
    const res = await POST(
      makeReq({
        platform: 'linkedin',
        name: 'Site Visitors',
        type: 'WEBSITE',
        providerData: {
          linkedin: {
            websiteRules: [{ matchType: 'CONTAINS', url: '/checkout' }],
            // insightTagId intentionally omitted
          },
        },
      }),
      fakeUser as any,
    )

    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/insightTagId/i)
    expect(createWebsiteAudience).not.toHaveBeenCalled()
  })

  // Test 3: WEBSITE with empty websiteRules returns 400
  it('returns 400 for WEBSITE when websiteRules is empty', async () => {
    const res = await POST(
      makeReq({
        platform: 'linkedin',
        name: 'Site Visitors',
        type: 'WEBSITE',
        providerData: {
          linkedin: {
            insightTagId: 'tag-123',
            websiteRules: [], // empty — should be rejected
          },
        },
      }),
      fakeUser as any,
    )

    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/websiteRules/i)
    expect(createWebsiteAudience).not.toHaveBeenCalled()
  })

  // Test 4: LOOKALIKE without sourceSegmentUrn returns 400
  it('returns 400 for LOOKALIKE when sourceSegmentUrn is missing', async () => {
    const res = await POST(
      makeReq({
        platform: 'linkedin',
        name: 'Lookalike from CRM',
        type: 'LOOKALIKE',
        providerData: { linkedin: {} },
      }),
      fakeUser as any,
    )

    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/sourceSegmentUrn/i)
    expect(createLookalikeAudience).not.toHaveBeenCalled()
  })

  // Test 5: ENGAGEMENT without engagementType returns 400
  it('returns 400 for ENGAGEMENT when engagementType is missing', async () => {
    const res = await POST(
      makeReq({
        platform: 'linkedin',
        name: 'Page Followers',
        type: 'ENGAGEMENT',
        providerData: {
          linkedin: {
            organizationUrn: 'urn:li:organization:99999',
            // engagementType intentionally omitted
          },
        },
      }),
      fakeUser as any,
    )

    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/engagementType/i)
    expect(createEngagementAudience).not.toHaveBeenCalled()
  })

  // Test 6: APP type returns 400 with workaround guidance
  it('returns 400 for APP type with shim guidance message', async () => {
    const res = await POST(
      makeReq({
        platform: 'linkedin',
        name: 'App Users',
        type: 'APP',
      }),
      fakeUser as any,
    )

    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/CUSTOMER_LIST/i)
    expect(body.error).toMatch(/LOOKALIKE/i)
  })

  // Test 7: Returns 400 if no LinkedIn connection exists
  it('returns 400 when no LinkedIn connection is found for org', async () => {
    getConnection.mockResolvedValue(null)

    const res = await POST(
      makeReq({
        platform: 'linkedin',
        name: 'My List',
        type: 'CUSTOMER_LIST',
      }),
      fakeUser as any,
    )

    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/LinkedIn/i)
    expect(createContactListAudience).not.toHaveBeenCalled()
  })

  // Test 8: Returns 400 if no selectedAdAccountUrn on connection meta
  it('returns 400 when connection has no selectedAdAccountUrn', async () => {
    getConnection.mockResolvedValue({
      meta: { linkedin: {} }, // no selectedAdAccountUrn
      accessTokenEnc: {},
    })

    const res = await POST(
      makeReq({
        platform: 'linkedin',
        name: 'My List',
        type: 'CUSTOMER_LIST',
      }),
      fakeUser as any,
    )

    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/Ad Account URN/i)
    expect(createContactListAudience).not.toHaveBeenCalled()
  })
})
