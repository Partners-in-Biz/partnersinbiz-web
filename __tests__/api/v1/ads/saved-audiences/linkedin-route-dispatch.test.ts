// __tests__/api/v1/ads/saved-audiences/linkedin-route-dispatch.test.ts
// LinkedIn saved-audience route dispatch tests.
// Sub-3b Phase 3 Batch 2C.

// ─── Auth bypass ─────────────────────────────────────────────────────────────
jest.mock('@/lib/api/auth', () => ({ withAuth: (_r: string, h: any) => h }))

// ─── requireMetaContext — not used for LinkedIn branch ───────────────────────
jest.mock('@/lib/ads/api-helpers', () => ({
  requireMetaContext: jest.fn(),
}))

// ─── Saved audience store ────────────────────────────────────────────────────
const mockCreateSavedAudience = jest.fn()
const mockGetSavedAudience = jest.fn()
const mockDeleteSavedAudience = jest.fn()
jest.mock('@/lib/ads/saved-audiences/store', () => ({
  createSavedAudience: (...args: any[]) => mockCreateSavedAudience(...args),
  getSavedAudience: (...args: any[]) => mockGetSavedAudience(...args),
  listSavedAudiences: jest.fn(),
  setSavedAudienceMetaId: jest.fn(),
  updateSavedAudience: jest.fn(),
  deleteSavedAudience: (...args: any[]) => mockDeleteSavedAudience(...args),
}))

// ─── LinkedIn connection helpers ──────────────────────────────────────────────
const mockGetConnection = jest.fn()
const mockDecryptAccessToken = jest.fn()
jest.mock('@/lib/ads/connections/store', () => ({
  getConnection: (...args: any[]) => mockGetConnection(...args),
  decryptAccessToken: (...args: any[]) => mockDecryptAccessToken(...args),
}))

// ─── LinkedIn saved-audiences provider (dynamic import mock) ─────────────────
const mockCreateLinkedinSavedAudience = jest.fn()
const mockArchiveSavedAudience = jest.fn()
jest.mock('@/lib/ads/providers/linkedin/saved-audiences', () => ({
  createSavedAudience: (...args: any[]) => mockCreateLinkedinSavedAudience(...args),
  archiveSavedAudience: (...args: any[]) => mockArchiveSavedAudience(...args),
}))

// ─── Meta provider (not used in LinkedIn branch) ────────────────────────────
jest.mock('@/lib/ads/providers/meta', () => ({
  metaProvider: { savedAudienceCRUD: jest.fn() },
}))

// ─── Meta saved-audiences provider (not used in LinkedIn branch) ─────────────
jest.mock('@/lib/ads/providers/meta/saved-audiences', () => ({
  deleteMetaSavedAudience: jest.fn(),
}))

// ─── Firebase admin ──────────────────────────────────────────────────────────
const mockDocUpdate = jest.fn().mockResolvedValue(undefined)
const mockDocDelete = jest.fn().mockResolvedValue(undefined)
jest.mock('@/lib/firebase/admin', () => ({
  adminDb: {
    collection: jest.fn().mockReturnValue({
      doc: jest.fn().mockReturnValue({
        update: (...args: any[]) => mockDocUpdate(...args),
        delete: (...args: any[]) => mockDocDelete(...args),
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

// ─── crypto ──────────────────────────────────────────────────────────────────
jest.mock('crypto', () => ({
  ...jest.requireActual('crypto'),
  randomBytes: jest.fn().mockReturnValue(Buffer.from('deadbeefcafebabe', 'hex')),
}))

// ─── Import routes after mocks ────────────────────────────────────────────────
import { POST } from '@/app/api/v1/ads/saved-audiences/route'
import { DELETE } from '@/app/api/v1/ads/saved-audiences/[id]/route'

// ─── Helpers ─────────────────────────────────────────────────────────────────
const fakeConn = {
  meta: { linkedin: { selectedAdAccountUrn: 'urn:li:sponsoredAccount:123456' } },
  accessTokenEnc: {},
}
const fakeTargeting = { include: { facets: [{ type: 'SENIORITY', values: ['MANAGER'] }] } }
const fakeLinkedinResult = { urn: 'urn:li:adTargetingTemplate:9999', id: '9999' }
const fakeSavedAudience = {
  id: 'sav_deadbeef',
  orgId: 'org-001',
  platform: 'linkedin',
  name: 'LinkedIn Audience',
  targeting: {},
  providerData: { linkedin: { audienceTemplateUrn: 'urn:li:adTargetingTemplate:9999' } },
  createdBy: 'user-001',
  createdAt: { seconds: 1000000, nanoseconds: 0 },
  updatedAt: { seconds: 1000000, nanoseconds: 0 },
}
const fakeUser = { uid: 'user-001' }

function makePostReq(body: object) {
  return new Request('http://x/api/v1/ads/saved-audiences', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Org-Id': 'org-001' },
    body: JSON.stringify(body),
  }) as any
}

function makeDeleteReq(orgId = 'org-001') {
  return {
    headers: { get: (k: string) => (k === 'X-Org-Id' ? orgId : null) },
    json: async () => ({}),
  } as any
}

beforeEach(() => {
  jest.clearAllMocks()
  mockGetConnection.mockResolvedValue(fakeConn)
  mockDecryptAccessToken.mockReturnValue('li-access-token')
  mockCreateLinkedinSavedAudience.mockResolvedValue(fakeLinkedinResult)
  mockArchiveSavedAudience.mockResolvedValue(undefined)
  mockCreateSavedAudience.mockResolvedValue({ id: 'sav_deadbeef', orgId: 'org-001', platform: 'linkedin' })
  mockGetSavedAudience.mockResolvedValue(fakeSavedAudience)
  mockDeleteSavedAudience.mockResolvedValue(undefined)
})

describe('POST /api/v1/ads/saved-audiences — LinkedIn dispatch', () => {
  // Test 1: Creates Audience Template + stamps providerData.linkedin.audienceTemplateUrn
  it('creates LinkedIn Audience Template and stamps audienceTemplateUrn', async () => {
    const res = await POST(
      makePostReq({ platform: 'linkedin', name: 'LinkedIn Audience', targeting: fakeTargeting }),
      fakeUser as any,
    )

    expect(res.status).toBe(201)
    expect(mockCreateLinkedinSavedAudience).toHaveBeenCalledTimes(1)
    const call = mockCreateLinkedinSavedAudience.mock.calls[0][0]
    expect(call.accountUrn).toBe('urn:li:sponsoredAccount:123456')
    expect(call.accessToken).toBe('li-access-token')
    expect(call.name).toBe('LinkedIn Audience')
    expect(call.targeting).toEqual(fakeTargeting)

    // Should have stamped audienceTemplateUrn via adminDb.update
    expect(mockDocUpdate).toHaveBeenCalledWith({
      providerData: { linkedin: { audienceTemplateUrn: 'urn:li:adTargetingTemplate:9999' } },
    })

    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.data.providerData.linkedin.audienceTemplateUrn).toBe('urn:li:adTargetingTemplate:9999')
  })

  // Test 2: Returns 400 if no LinkedIn connection
  it('returns 400 if no LinkedIn connection exists for org', async () => {
    mockGetConnection.mockResolvedValue(null)

    const res = await POST(
      makePostReq({ platform: 'linkedin', name: 'Test', targeting: fakeTargeting }),
      fakeUser as any,
    )

    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/no linkedin ads connection/i)
    expect(mockCreateLinkedinSavedAudience).not.toHaveBeenCalled()
  })

  // Test 3: Returns 400 if no selectedAdAccountUrn
  it('returns 400 if selectedAdAccountUrn is missing from LinkedIn connection', async () => {
    mockGetConnection.mockResolvedValue({
      meta: { linkedin: {} }, // no selectedAdAccountUrn
      accessTokenEnc: {},
    })

    const res = await POST(
      makePostReq({ platform: 'linkedin', name: 'Test', targeting: fakeTargeting }),
      fakeUser as any,
    )

    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/no ad account urn/i)
    expect(mockCreateLinkedinSavedAudience).not.toHaveBeenCalled()
  })
})

describe('DELETE /api/v1/ads/saved-audiences/[id] — LinkedIn dispatch', () => {
  // Test 4: Archives LinkedIn Audience Template + soft-deletes local doc
  it('archives Audience Template on LinkedIn and hard-deletes local doc', async () => {
    mockGetSavedAudience.mockResolvedValue(fakeSavedAudience)

    const res = await DELETE(
      makeDeleteReq(),
      null as any,
      { params: Promise.resolve({ id: 'sav_deadbeef' }) } as any,
    )

    expect(res.status).toBe(200)
    expect(mockArchiveSavedAudience).toHaveBeenCalledTimes(1)
    const call = mockArchiveSavedAudience.mock.calls[0][0]
    expect(call.accountUrn).toBe('urn:li:sponsoredAccount:123456')
    expect(call.accessToken).toBe('li-access-token')
    expect(call.templateUrn).toBe('urn:li:adTargetingTemplate:9999')

    expect(mockDeleteSavedAudience).toHaveBeenCalledWith('sav_deadbeef')

    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.data.deleted).toBe(true)
  })
})
