/**
 * Tests for GET /api/v1/crm/companies/:id/activities
 * (A1 W3-K — linked activities endpoint)
 */
jest.mock('@/lib/firebase/admin', () => ({
  adminAuth: { verifySessionCookie: jest.fn() },
  adminDb: { collection: jest.fn() },
}))

jest.mock('firebase-admin/firestore', () => {
  const serverTimestampSentinel = { _type: 'serverTimestamp' }
  const deleteSentinel = { _type: 'deleteField' }
  return {
    FieldValue: {
      serverTimestamp: () => serverTimestampSentinel,
      delete: () => deleteSentinel,
      arrayUnion: (...vals: unknown[]) => ({ _type: 'arrayUnion', vals }),
      arrayRemove: (...vals: unknown[]) => ({ _type: 'arrayRemove', vals }),
    },
    Timestamp: {
      now: () => ({ seconds: 1000, nanoseconds: 0, toDate: () => new Date() }),
    },
  }
})

jest.mock('@/lib/companies/store', () => ({
  loadCompany: jest.fn(),
}))

import { adminAuth, adminDb } from '@/lib/firebase/admin'
import { loadCompany } from '@/lib/companies/store'
import { seedOrgMember, callAsMember } from '../../../../helpers/crm'
import { installPortalAuthCollectionMock, makeFirestoreDoc, makeFirestoreQuery } from '../../../../helpers/firebase-admin'
import { uidFor, buildCompany } from './_fixtures'

const AI_API_KEY = 'test-ai-key-id-activities'
process.env.AI_API_KEY = AI_API_KEY
process.env.SESSION_COOKIE_NAME = '__session'

// ── stageAuth helper ──────────────────────────────────────────────────────────

function stageAuth(
  member: { uid: string; orgId: string; role: string },
  activityDocs: Array<{ id: string; data: Record<string, unknown> }> = [],
) {
  ;(adminAuth.verifySessionCookie as jest.Mock).mockResolvedValue({ uid: member.uid })
  installPortalAuthCollectionMock(adminDb.collection as jest.Mock, member, {
    collections: {
      activities: makeFirestoreQuery(activityDocs.map((activity) => makeFirestoreDoc(activity.id, activity.data))),
    },
  })
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('GET /api/v1/crm/companies/:id/activities', () => {
  const orgId = 'org-test-ia'
  const companyId = `co_${Math.random().toString(36).slice(2, 8)}`
  const viewerUid = uidFor('viewer-ia')

  beforeEach(() => {
    ;(loadCompany as jest.Mock).mockReset()
  })

  it('returns linked activities for a valid company (happy path)', async () => {
    const member = seedOrgMember(orgId, viewerUid, { role: 'viewer' })
    const company = buildCompany({ id: companyId, orgId })
    ;(loadCompany as jest.Mock).mockResolvedValue({ data: company })

    const actDocs = [
      { id: 'a1', data: { orgId, companyId, type: 'call', summary: 'Discovery call', contactId: 'c1' } },
      { id: 'a2', data: { orgId, companyId, type: 'note', summary: 'Post-call note', contactId: 'c2' } },
    ]
    stageAuth(member, actDocs)

    const req = callAsMember(member, 'GET', `/api/v1/crm/companies/${companyId}/activities`)
    const { GET } = await import('@/app/api/v1/crm/companies/[id]/activities/route')
    const res = await GET(req, { params: Promise.resolve({ id: companyId }) })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(Array.isArray(body.data.activities)).toBe(true)
    expect(body.data.activities).toHaveLength(2)
    expect(body.data.activities[0].type).toBe('call')
  })

  it('returns empty array when company has no linked activities', async () => {
    const member = seedOrgMember(orgId, uidFor('viewer-empty-ia'), { role: 'viewer' })
    const company = buildCompany({ id: companyId, orgId })
    ;(loadCompany as jest.Mock).mockResolvedValue({ data: company })

    stageAuth(member, [])

    const req = callAsMember(member, 'GET', `/api/v1/crm/companies/${companyId}/activities`)
    const { GET } = await import('@/app/api/v1/crm/companies/[id]/activities/route')
    const res = await GET(req, { params: Promise.resolve({ id: companyId }) })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data.activities).toHaveLength(0)
  })

  it('returns 404 for cross-tenant company (isolation)', async () => {
    const member = seedOrgMember('org-a', uidFor('viewer-iso-ia'), { role: 'viewer' })
    ;(loadCompany as jest.Mock).mockResolvedValue(null)  // loadCompany returns null for cross-tenant

    stageAuth(member)

    const req = callAsMember(member, 'GET', `/api/v1/crm/companies/co-other-org/activities`)
    const { GET } = await import('@/app/api/v1/crm/companies/[id]/activities/route')
    const res = await GET(req, { params: Promise.resolve({ id: 'co-other-org' }) })
    expect(res.status).toBe(404)
  })

  it('respects pagination limit param', async () => {
    const member = seedOrgMember(orgId, uidFor('viewer-pag-ia'), { role: 'viewer' })
    const company = buildCompany({ id: companyId, orgId })
    ;(loadCompany as jest.Mock).mockResolvedValue({ data: company })

    const actDocs = Array.from({ length: 10 }, (_, i) => ({
      id: `a-pag-${i}`,
      data: { orgId, companyId, type: 'note', summary: `Note ${i}`, contactId: `c${i}` },
    }))
    stageAuth(member, actDocs)

    const req = callAsMember(member, 'GET', `/api/v1/crm/companies/${companyId}/activities?limit=10`)
    const { GET } = await import('@/app/api/v1/crm/companies/[id]/activities/route')
    const res = await GET(req, { params: Promise.resolve({ id: companyId }) })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data.activities).toHaveLength(10)
  })

  it('viewer role gets 200 (min role is viewer)', async () => {
    const viewer = seedOrgMember(orgId, uidFor('viewer-role-ia'), { role: 'viewer' })
    const company = buildCompany({ id: companyId, orgId })
    ;(loadCompany as jest.Mock).mockResolvedValue({ data: company })

    stageAuth(viewer, [])

    const req = callAsMember(viewer, 'GET', `/api/v1/crm/companies/${companyId}/activities`)
    const { GET } = await import('@/app/api/v1/crm/companies/[id]/activities/route')
    const res = await GET(req, { params: Promise.resolve({ id: companyId }) })
    expect(res.status).toBe(200)
  })
})
