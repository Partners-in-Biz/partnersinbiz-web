// __tests__/api/v1/ads/custom-audiences/google-dispatch.test.ts
// Google audience dispatch tests for POST /api/v1/ads/custom-audiences.
// Sub-3a Phase 5 Batch 3 E

import { POST } from '@/app/api/v1/ads/custom-audiences/route'

// ─── Auth bypass ─────────────────────────────────────────────────────────────
jest.mock('@/lib/api/auth', () => ({ withAuth: (_r: string, h: any) => h }))

// ─── requireMetaContext — not used for Google branch ────────────────────────
jest.mock('@/lib/ads/api-helpers', () => ({
  requireMetaContext: jest.fn(),
  resolveGoogleAdsCustomerContext: jest.fn((conn: any) => ({
    customerId: conn.defaultAdAccountId,
    loginCustomerId: conn.meta?.google?.loginCustomerId,
  })),
}))

// ─── Custom audience store ────────────────────────────────────────────────────
jest.mock('@/lib/ads/custom-audiences/store', () => ({
  createCustomAudience: jest.fn(),
  listCustomAudiences: jest.fn(),
  setCustomAudienceMetaId: jest.fn(),
  getCustomAudience: jest.fn(),
}))

// ─── Google connection helpers ────────────────────────────────────────────────
jest.mock('@/lib/ads/connections/store', () => ({
  getConnection: jest.fn(),
  decryptAccessToken: jest.fn(),
}))
jest.mock('@/lib/integrations/google_ads/oauth', () => ({
  readDeveloperToken: jest.fn(),
}))

// ─── Firebase admin (for direct adminDb writes in the Google branch) ─────────
jest.mock('@/lib/firebase/admin', () => ({
  adminDb: {
    collection: jest.fn().mockReturnValue({
      doc: jest.fn().mockReturnValue({
        set: jest.fn().mockResolvedValue(undefined),
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

// ─── Google audience helpers (dynamic imports are mocked at module level) ─────
jest.mock('@/lib/ads/providers/google/audiences/customer-match', () => ({
  createCustomerMatchList: jest.fn(),
}))
jest.mock('@/lib/ads/providers/google/audiences/remarketing', () => ({
  createRemarketingList: jest.fn(),
  removeRemarketingList: jest.fn(),
}))
jest.mock('@/lib/ads/providers/google/audiences/custom-segments', () => ({
  createCustomSegment: jest.fn(),
  removeCustomSegment: jest.fn(),
}))

// ─── Meta provider (not used in Google branch) ───────────────────────────────
jest.mock('@/lib/ads/providers/meta', () => ({
  metaProvider: { customAudienceCRUD: jest.fn() },
}))
jest.mock('@/lib/ads/activity', () => ({
  logCustomAudienceActivity: jest.fn(),
}))

// ─── Imports after mocks ──────────────────────────────────────────────────────
const { getConnection, decryptAccessToken } = jest.requireMock('@/lib/ads/connections/store')
const { readDeveloperToken } = jest.requireMock('@/lib/integrations/google_ads/oauth')
const { createCustomerMatchList } = jest.requireMock('@/lib/ads/providers/google/audiences/customer-match')
const { createRemarketingList } = jest.requireMock('@/lib/ads/providers/google/audiences/remarketing')
const { createCustomSegment } = jest.requireMock('@/lib/ads/providers/google/audiences/custom-segments')

// ─── Shared stubs ─────────────────────────────────────────────────────────────
const fakeConn = {
  defaultAdAccountId: '1234567890',
  meta: { google: { loginCustomerId: '9999999999' } },
  accessTokenEnc: {},
}
const fakeResult = { resourceName: 'customers/1234567890/userLists/42', id: '42' }

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
  decryptAccessToken.mockReturnValue('access-token')
  readDeveloperToken.mockReturnValue('dev-token')
  createCustomerMatchList.mockResolvedValue(fakeResult)
  createRemarketingList.mockResolvedValue(fakeResult)
  createCustomSegment.mockResolvedValue({ resourceName: 'customers/1234567890/customAudiences/99', id: '99' })
})

describe('POST /api/v1/ads/custom-audiences — Google dispatch', () => {
  // Test 1: CUSTOMER_MATCH calls createCustomerMatchList
  it('calls createCustomerMatchList for CUSTOMER_MATCH subtype', async () => {
    const res = await POST(
      makeReq({
        platform: 'google',
        name: 'My CRM List',
        description: 'Test list',
        providerData: {
          google: {
            subtype: 'CUSTOMER_MATCH',
            uploadKeyType: 'CONTACT_INFO',
          },
        },
      }),
      fakeUser as any,
    )

    expect(res.status).toBe(201)
    expect(createCustomerMatchList).toHaveBeenCalledTimes(1)
    const call = createCustomerMatchList.mock.calls[0][0]
    expect(call.customerId).toBe('1234567890')
    expect(call.loginCustomerId).toBe('9999999999')
    expect(call.name).toBe('My CRM List')
    expect(call.uploadKeyType).toBe('CONTACT_INFO')

    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.data.platform).toBe('google')
    expect(body.data.providerData.google.userListResourceName).toBe(fakeResult.resourceName)
  })

  // Test 2: REMARKETING calls createRemarketingList
  it('calls createRemarketingList for REMARKETING subtype', async () => {
    const res = await POST(
      makeReq({
        platform: 'google',
        name: 'Site Visitors',
        providerData: {
          google: {
            subtype: 'REMARKETING',
            membershipLifeSpanDays: 30,
            rule: { kind: 'URL_CONTAINS', value: '/checkout' },
          },
        },
      }),
      fakeUser as any,
    )

    expect(res.status).toBe(201)
    expect(createRemarketingList).toHaveBeenCalledTimes(1)
    const call = createRemarketingList.mock.calls[0][0]
    expect(call.customerId).toBe('1234567890')
    expect(call.loginCustomerId).toBe('9999999999')
    expect(call.name).toBe('Site Visitors')
    expect(call.membershipLifeSpanDays).toBe(30)
    expect(call.rule).toEqual({ kind: 'URL_CONTAINS', value: '/checkout' })
  })

  // Test 3: CUSTOM_SEGMENT missing segmentType / values returns 400
  it('returns 400 for CUSTOM_SEGMENT when segmentType or values is missing', async () => {
    const res = await POST(
      makeReq({
        platform: 'google',
        name: 'My Segment',
        providerData: {
          google: {
            subtype: 'CUSTOM_SEGMENT',
            // segmentType and values intentionally omitted
          },
        },
      }),
      fakeUser as any,
    )

    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/segmentType/i)
    expect(createCustomSegment).not.toHaveBeenCalled()
  })

  // Test 4: CUSTOM_SEGMENT calls createCustomSegment with correct args
  it('calls createCustomSegment for CUSTOM_SEGMENT subtype', async () => {
    const res = await POST(
      makeReq({
        platform: 'google',
        name: 'Keyword Segment',
        providerData: {
          google: {
            subtype: 'CUSTOM_SEGMENT',
            segmentType: 'KEYWORD',
            values: ['running shoes', 'gym equipment'],
          },
        },
      }),
      fakeUser as any,
    )

    expect(res.status).toBe(201)
    expect(createCustomSegment).toHaveBeenCalledTimes(1)
    const call = createCustomSegment.mock.calls[0][0]
    expect(call.type).toBe('KEYWORD')
    expect(call.values).toEqual(['running shoes', 'gym equipment'])
  })

  // Test 5: AFFINITY persists canonical doc with audienceResourceName
  it('persists canonical doc for AFFINITY predefined subtype without calling mutate', async () => {
    const res = await POST(
      makeReq({
        platform: 'google',
        name: 'Sports Fans',
        providerData: {
          google: {
            subtype: 'AFFINITY',
            audienceResourceName: 'customers/1234567890/userInterests/876543',
            categoryName: 'Sports & Fitness',
          },
        },
      }),
      fakeUser as any,
    )

    expect(res.status).toBe(201)
    // No mutate helpers called for predefined
    expect(createCustomerMatchList).not.toHaveBeenCalled()
    expect(createRemarketingList).not.toHaveBeenCalled()
    expect(createCustomSegment).not.toHaveBeenCalled()

    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.data.providerData.google.userListResourceName).toBe(
      'customers/1234567890/userInterests/876543',
    )
  })

  // Test 6: Missing subtype returns 400
  it('returns 400 when providerData.google.subtype is absent', async () => {
    const res = await POST(
      makeReq({
        platform: 'google',
        name: 'No Subtype',
        providerData: { google: {} },
      }),
      fakeUser as any,
    )

    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/subtype/i)
  })

  // Test 7: Meta platform still uses existing path
  it('falls through to Meta path for platform: meta', async () => {
    const { requireMetaContext } = jest.requireMock('@/lib/ads/api-helpers')
    // Return a response (e.g. 400) to short-circuit — proves we entered the Meta branch
    requireMetaContext.mockResolvedValue(
      new Response(JSON.stringify({ success: false, error: 'no meta ctx' }), { status: 400 }),
    )

    const res = await POST(
      makeReq({
        platform: 'meta',
        input: { name: 'Meta Audience', type: 'CUSTOMER_LIST', source: { kind: 'CUSTOMER_LIST' } },
      }),
      fakeUser as any,
    )

    expect(requireMetaContext).toHaveBeenCalledTimes(1)
    expect(createCustomerMatchList).not.toHaveBeenCalled()
    // Meta path returned the short-circuit response
    expect(res.status).toBe(400)
  })
})
