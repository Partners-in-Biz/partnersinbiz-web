/**
 * Tests for GET /api/v1/crm/companies/:id/contacts
 * (A1 W3-H — linked contacts endpoint)
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
import { uidFor, buildCompany } from './_fixtures'

const AI_API_KEY = 'test-ai-key-id-contacts'
process.env.AI_API_KEY = AI_API_KEY
process.env.SESSION_COOKIE_NAME = '__session'

// ── stageAuth helper ──────────────────────────────────────────────────────────

function stageAuth(
  member: { uid: string; orgId: string; role: string },
  contactsDocs: Array<{ id: string; data: Record<string, unknown> }> = [],
) {
  ;(adminAuth.verifySessionCookie as jest.Mock).mockResolvedValue({ uid: member.uid })
  ;(adminDb.collection as jest.Mock).mockImplementation((name: string) => {
    if (name === 'users') {
      return {
        doc: () => ({
          get: () => Promise.resolve({ exists: true, data: () => ({ activeOrgId: member.orgId }) }),
        }),
      }
    }
    if (name === 'orgMembers') {
      return {
        doc: () => ({
          get: () => Promise.resolve({ exists: true, data: () => member }),
        }),
        where: jest.fn().mockReturnValue({
          get: () => Promise.resolve({ docs: [{ id: `${member.orgId}_${member.uid}`, data: () => member }] }),
        }),
      }
    }
    if (name === 'organizations') {
      return {
        doc: () => ({
          get: () => Promise.resolve({ exists: true, data: () => ({ settings: { permissions: {} } }) }),
        }),
      }
    }
    if (name === 'contacts') {
      const docs = contactsDocs.map((c) => ({ id: c.id, data: () => c.data }))
      return {
        where: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        get: jest.fn().mockResolvedValue({ docs }),
      }
    }
    return { doc: () => ({ get: () => Promise.resolve({ exists: false }) }) }
  })
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('GET /api/v1/crm/companies/:id/contacts', () => {
  const orgId = 'org-test-ic'
  const companyId = `co_${Math.random().toString(36).slice(2, 8)}`
  const viewerUid = uidFor('viewer-ic')

  beforeEach(() => {
    ;(loadCompany as jest.Mock).mockReset()
  })

  it('returns linked contacts for a valid company (happy path)', async () => {
    const member = seedOrgMember(orgId, viewerUid, { role: 'viewer' })
    const company = buildCompany({ id: companyId, orgId })
    ;(loadCompany as jest.Mock).mockResolvedValue({ data: company })

    const contactDocs = [
      { id: 'c1', data: { orgId, companyId, name: 'Alice', email: 'alice@acme.com' } },
      { id: 'c2', data: { orgId, companyLinks: [{ companyId, companyName: 'Acme', roleTitle: 'Advisor' }], name: 'Bob', email: 'bob@acme.com' } },
    ]
    stageAuth(member, contactDocs)

    const req = callAsMember(member, 'GET', `/api/v1/crm/companies/${companyId}/contacts`)
    const { GET } = await import('@/app/api/v1/crm/companies/[id]/contacts/route')
    const res = await GET(req, { params: Promise.resolve({ id: companyId }) })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(Array.isArray(body.data.contacts)).toBe(true)
    expect(body.data.contacts).toHaveLength(2)
    expect(body.data.contacts[0].name).toBe('Alice')
  })

  it('also returns mirrored contacts linked by recipient org id', async () => {
    const member = seedOrgMember(orgId, uidFor('viewer-linked-org'), { role: 'viewer' })
    const company = { ...buildCompany({ id: companyId, orgId }), linkedOrgId: 'client-org-1' }
    ;(loadCompany as jest.Mock).mockResolvedValue({ data: company })

    stageAuth(member, [
      { id: 'c-linked', data: { orgId, linkedOrgId: 'client-org-1', name: 'Client Member', email: 'client@example.com' } },
      { id: 'c-other', data: { orgId, linkedOrgId: 'other-org', name: 'Other Member' } },
    ])

    const req = callAsMember(member, 'GET', `/api/v1/crm/companies/${companyId}/contacts`)
    const { GET } = await import('@/app/api/v1/crm/companies/[id]/contacts/route')
    const res = await GET(req, { params: Promise.resolve({ id: companyId }) })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data.contacts.map((contact: { id: string }) => contact.id)).toEqual(['c-linked'])
  })

  it('returns empty array when company has no linked contacts', async () => {
    const member = seedOrgMember(orgId, uidFor('viewer-empty'), { role: 'viewer' })
    const company = buildCompany({ id: companyId, orgId })
    ;(loadCompany as jest.Mock).mockResolvedValue({ data: company })

    stageAuth(member, []) // no contacts docs

    const req = callAsMember(member, 'GET', `/api/v1/crm/companies/${companyId}/contacts`)
    const { GET } = await import('@/app/api/v1/crm/companies/[id]/contacts/route')
    const res = await GET(req, { params: Promise.resolve({ id: companyId }) })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data.contacts).toHaveLength(0)
  })

  it('returns 404 for cross-tenant company (isolation)', async () => {
    const member = seedOrgMember('org-a', uidFor('viewer-iso'), { role: 'viewer' })
    // loadCompany returns null for cross-tenant lookup
    ;(loadCompany as jest.Mock).mockResolvedValue(null)

    stageAuth(member)

    const req = callAsMember(member, 'GET', `/api/v1/crm/companies/co-other-org/contacts`)
    const { GET } = await import('@/app/api/v1/crm/companies/[id]/contacts/route')
    const res = await GET(req, { params: Promise.resolve({ id: 'co-other-org' }) })
    expect(res.status).toBe(404)
  })

  it('respects pagination limit param', async () => {
    const member = seedOrgMember(orgId, uidFor('viewer-pag'), { role: 'viewer' })
    const company = buildCompany({ id: companyId, orgId })
    ;(loadCompany as jest.Mock).mockResolvedValue({ data: company })

    const contactDocs = Array.from({ length: 5 }, (_, i) => ({
      id: `c-pag-${i}`,
      data: { orgId, companyId, name: `Contact ${i}` },
    }))
    stageAuth(member, contactDocs)

    const req = callAsMember(member, 'GET', `/api/v1/crm/companies/${companyId}/contacts?limit=5`)
    const { GET } = await import('@/app/api/v1/crm/companies/[id]/contacts/route')
    const res = await GET(req, { params: Promise.resolve({ id: companyId }) })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data.contacts).toHaveLength(5)
  })

  it('viewer role gets 200 (min role is viewer)', async () => {
    const viewer = seedOrgMember(orgId, uidFor('viewer-role'), { role: 'viewer' })
    const company = buildCompany({ id: companyId, orgId })
    ;(loadCompany as jest.Mock).mockResolvedValue({ data: company })

    stageAuth(viewer, [])

    const req = callAsMember(viewer, 'GET', `/api/v1/crm/companies/${companyId}/contacts`)
    const { GET } = await import('@/app/api/v1/crm/companies/[id]/contacts/route')
    const res = await GET(req, { params: Promise.resolve({ id: companyId }) })
    expect(res.status).toBe(200)
  })
})
