import { NextRequest } from 'next/server'

jest.mock('@/lib/firebase/admin', () => ({
  adminAuth: { verifySessionCookie: jest.fn() },
  adminDb: { collection: jest.fn(), batch: jest.fn() },
}))

import { adminAuth, adminDb } from '@/lib/firebase/admin'
import { seedOrgMember, seedContact, callAsMember, callAsAgent } from '../../../helpers/crm'
import { makePortalAuthCollectionsForMembers } from '../../../helpers/firebase-admin'

const AI_API_KEY = 'test-ai-key'
process.env.AI_API_KEY = AI_API_KEY
process.env.SESSION_COOKIE_NAME = '__session'

const memberA = seedOrgMember('org-a', 'uid-a', { role: 'member', firstName: 'A', lastName: 'A' })
const memberB = seedOrgMember('org-b', 'uid-b', { role: 'member', firstName: 'B', lastName: 'B' })

const contactA = seedContact('org-a', { id: 'a1', name: 'Contact A' })
const contactB = seedContact('org-b', { id: 'b1', name: 'Contact B' })

/**
 * Stage Firestore mocks so that:
 *  - users/{uid-a}.activeOrgId = 'org-a'; users/{uid-b}.activeOrgId = 'org-b'
 *  - orgMembers reflects each
 *  - organizations.settings.permissions overridable via `perms` arg
 *  - contacts.doc(id) → contactA for 'a1', contactB for 'b1', exists:false otherwise
 *  - activities returns empty list (no activities seeded — isolation is about the access check, not the data)
 *  - capture_sources returns exists:false (import without source)
 *  - batch is a no-op stub that just resolves
 *  - capturedDocSet / capturedUpdate / capturedDelete recorded if accessors passed
 */
function setupIsolationFixtures(perms: Record<string, unknown> = { membersCanDeleteContacts: true }) {
  const captured = {
    setCalls: [] as Array<Record<string, unknown>>,
    updateCalls: [] as Array<Record<string, unknown>>,
    deleteCalls: [] as Array<unknown>,
    batchSetCalls: [] as Array<{ ref: any; data: Record<string, unknown> }>,
    batchUpdateCalls: [] as Array<{ ref: any; data: Record<string, unknown> }>,
  }

  ;(adminAuth.verifySessionCookie as jest.Mock).mockImplementation((cookie: string) => {
    if (cookie.includes(memberA.uid)) return Promise.resolve({ uid: memberA.uid })
    if (cookie.includes(memberB.uid)) return Promise.resolve({ uid: memberB.uid })
    return Promise.reject(new Error('invalid session'))
  })

  ;(adminDb as any).batch = jest.fn().mockReturnValue({
    set: (ref: any, data: Record<string, unknown>) => captured.batchSetCalls.push({ ref, data }),
    update: (ref: any, data: Record<string, unknown>) => captured.batchUpdateCalls.push({ ref, data }),
    commit: jest.fn().mockResolvedValue(undefined),
  })

  const authCollections = makePortalAuthCollectionsForMembers([memberA, memberB], { permissions: perms })
  ;(adminDb.collection as jest.Mock).mockImplementation((name: string) => {
    if (name in authCollections) return authCollections[name as keyof typeof authCollections]
    if (name === 'users') {
      return {
        doc: (uid: string) => ({
          get: () => Promise.resolve({
            exists: true,
            data: () => ({ activeOrgId: uid === memberA.uid ? 'org-a' : 'org-b' }),
          }),
        }),
      }
    }
    if (name === 'orgMembers') {
      return {
        doc: (id: string) => ({
          get: () => Promise.resolve({
            exists: true,
            data: () => (id.startsWith('org-a') ? memberA : memberB),
          }),
        }),
      }
    }
    if (name === 'organizations') {
      return {
        doc: () => ({
          get: () => Promise.resolve({
            exists: true,
            data: () => ({ settings: { permissions: perms } }),
          }),
        }),
      }
    }
    if (name === 'contacts') {
      const allDocs = [
        { id: 'a1', data: () => contactA, ref: { id: 'a1' } },
        { id: 'b1', data: () => contactB, ref: { id: 'b1' } },
      ]
      // The POST duplicate-email / linkedUserId guards issue
      // .where('orgId').where('email'|'linkedUserId').limit(1).get(). Honour the
      // email/linkedUserId filter so a brand-new contact (distinct email) is not
      // wrongly treated as a duplicate. List reads (orgId-only) return all docs.
      const makeQuery = (filters: Array<{ field: string; value: unknown }>) => {
        const chain: Record<string, any> = {}
        chain.where = (field: string, _op: string, value: unknown) =>
          makeQuery([...filters, { field, value }])
        chain.orderBy = () => chain
        chain.limit = () => chain
        chain.get = () => {
          let docs = allDocs
          for (const f of filters) {
            if (f.field === 'email') docs = docs.filter((d) => (d.data() as any)?.email === f.value)
            if (f.field === 'linkedUserId') docs = docs.filter((d) => (d.data() as any)?.linkedUserId === f.value)
          }
          return Promise.resolve({ docs })
        }
        return chain
      }
      return {
        doc: jest.fn().mockImplementation((id?: string) => ({
          id: id ?? 'auto-id',
          get: () => Promise.resolve({
            exists: id === 'a1' || id === 'b1',
            id: id ?? 'auto-id',
            data: () => (id === 'a1' ? contactA : id === 'b1' ? contactB : undefined),
          }),
          set: jest.fn((data: Record<string, unknown>) => { captured.setCalls.push(data); return Promise.resolve() }),
          update: jest.fn((data: Record<string, unknown>) => { captured.updateCalls.push(data); return Promise.resolve() }),
          delete: jest.fn(() => { captured.deleteCalls.push(true); return Promise.resolve() }),
        })),
        where: (field: string, op: string, value: unknown) => makeQuery([]).where(field, op, value),
        orderBy: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        get: () => Promise.resolve({ docs: allDocs }),
      }
    }
    if (name === 'activities') {
      return {
        where: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        get: () => Promise.resolve({ docs: [] }),
      }
    }
    if (name === 'capture_sources') {
      return {
        doc: () => ({ get: () => Promise.resolve({ exists: false }) }),
      }
    }
    return { doc: () => ({ get: () => Promise.resolve({ exists: false }) }) }
  })

  return captured
}

const routeCtx = (id: string) => ({ params: Promise.resolve({ id }) })

beforeEach(() => { jest.clearAllMocks() })

describe('cross-tenant isolation: contacts (consolidated)', () => {
  it('member of A POST writes createdByRef with displayName A A, scoped to org-a', async () => {
    const captured = setupIsolationFixtures()
    const req = callAsMember(memberA, 'POST', '/api/v1/crm/contacts', { name: 'X', email: 'x@y.com', source: 'manual' })
    const { POST } = await import('@/app/api/v1/crm/contacts/route')
    const res = await POST(req)
    expect(res.status).toBeLessThan(300)
    const written = captured.setCalls.at(-1)
    expect(written?.orgId).toBe('org-a')
    expect((written?.createdByRef as any)?.displayName).toBe('A A')
    expect((written?.createdByRef as any)?.kind).toBe('human')
  })

  it('Bearer with X-Org-Id=org-a POST writes AGENT_PIP_REF, scoped to org-a', async () => {
    const captured = setupIsolationFixtures()
    const req = callAsAgent('org-a', 'POST', '/api/v1/crm/contacts', { name: 'X', email: 'x@y.com', source: 'manual' })
    const { POST } = await import('@/app/api/v1/crm/contacts/route')
    const res = await POST(req)
    expect(res.status).toBeLessThan(300)
    const written = captured.setCalls.at(-1)
    expect(written?.orgId).toBe('org-a')
    expect((written?.createdByRef as any)?.uid).toBe('agent:pip')
    expect((written?.createdByRef as any)?.kind).toBe('agent')
    expect(written?.createdBy).toBeUndefined()
  })

  it('member of A cannot GET org B contact by id (404)', async () => {
    setupIsolationFixtures()
    const req = callAsMember(memberA, 'GET', '/api/v1/crm/contacts/b1')
    const { GET } = await import('@/app/api/v1/crm/contacts/[id]/route')
    const res = await GET(req, routeCtx('b1'))
    expect(res.status).toBe(404)
  })

  it('Bearer with X-Org-Id=org-a cannot access org B contact by id (404)', async () => {
    setupIsolationFixtures()
    const req = callAsAgent('org-a', 'GET', '/api/v1/crm/contacts/b1')
    const { GET } = await import('@/app/api/v1/crm/contacts/[id]/route')
    const res = await GET(req, routeCtx('b1'))
    expect(res.status).toBe(404)
  })

  it('member DELETE is blocked when membersCanDeleteContacts is false (403)', async () => {
    setupIsolationFixtures({ membersCanDeleteContacts: false })
    const req = callAsMember(memberA, 'DELETE', '/api/v1/crm/contacts/a1')
    const { DELETE } = await import('@/app/api/v1/crm/contacts/[id]/route')
    const res = await DELETE(req, routeCtx('a1'))
    expect(res.status).toBe(403)
  })

  it('agent (Bearer) DELETE succeeds even when toggle is off', async () => {
    setupIsolationFixtures({ membersCanDeleteContacts: false })
    const req = callAsAgent('org-a', 'DELETE', '/api/v1/crm/contacts/a1')
    const { DELETE } = await import('@/app/api/v1/crm/contacts/[id]/route')
    const res = await DELETE(req, routeCtx('a1'))
    expect(res.status).toBeLessThan(300)
  })

  it('Bearer import: every imported contact gets AGENT_PIP_REF', async () => {
    const captured = setupIsolationFixtures()
    const req = callAsAgent('org-a', 'POST', '/api/v1/crm/contacts/import', {
      rows: [
        { name: 'I1', email: 'i1@y.com' },
        { name: 'I2', email: 'i2@y.com' },
      ],
    })
    const { POST } = await import('@/app/api/v1/crm/contacts/import/route')
    const res = await POST(req)
    expect(res.status).toBeLessThan(300)
    const writes = captured.batchSetCalls.map(c => c.data)
    const contactWrites = writes.filter(w => typeof w.email === 'string')
    expect(contactWrites.length).toBeGreaterThanOrEqual(2)
    for (const w of contactWrites) {
      expect((w.createdByRef as any)?.uid).toBe('agent:pip')
      expect(w.orgId).toBe('org-a')
      expect(w.createdBy).toBeUndefined()
    }
  })
})
