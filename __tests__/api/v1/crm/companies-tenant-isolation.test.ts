/**
 * Consolidated tenant-isolation suite for /api/v1/crm/companies (A1 Task 12)
 *
 * Pattern: "where-respecting" mock — the Firestore mock honours every
 * .where('orgId', '==', value) clause. A route that forgets to add that
 * clause will surface org-b records, causing the relevant test to fail.
 *
 * 13 assertions, one per endpoint:
 *  1  GET  /companies          — list excludes cross-org records
 *  2  POST /companies          — orgId override is always ctx.orgId
 *  3  GET  /companies/:id      — 404 for cross-org id
 *  4  PUT  /companies/:id      — 404 for cross-org id
 *  5  PATCH /companies/:id     — 404 for cross-org id
 *  6  DELETE /companies/:id    — 404 for cross-org id
 *  7  POST /companies/bulk     — cross-org ids skipped, not mutated
 *  8  POST /companies/:id/upload-logo  — 404 for cross-org id
 *  9  POST /companies/migrate-from-contacts — contacts query scoped to org-a
 * 10  GET  /companies/:id/contacts    — 404 for cross-org company id
 * 11  GET  /companies/:id/deals       — 404 for cross-org company id
 * 12  GET  /companies/:id/quotes      — 404 for cross-org company id
 * 13  GET  /companies/:id/activities  — 404 for cross-org company id
 */

import { NextRequest } from 'next/server'

jest.mock('@/lib/firebase/admin', () => ({
  adminAuth: { verifySessionCookie: jest.fn() },
  adminDb: { collection: jest.fn(), batch: jest.fn() },
  getAdminApp: jest.fn().mockReturnValue({}),
}))

// Stub Firebase Storage so upload-logo doesn't try to hit a real bucket
jest.mock('firebase-admin/storage', () => ({
  getStorage: jest.fn().mockReturnValue({
    bucket: jest.fn().mockReturnValue({
      name: 'test-bucket.appspot.com',
      file: jest.fn().mockReturnValue({
        save: jest.fn().mockResolvedValue(undefined),
      }),
    }),
  }),
}))

// Suppress noisy side-effect modules
jest.mock('@/lib/webhooks/dispatch', () => ({ dispatchWebhook: jest.fn().mockResolvedValue(undefined) }))
jest.mock('@/lib/activity/log', () => ({ logActivity: jest.fn().mockResolvedValue(undefined) }))

// Mock migration helpers — we only want to assert the Firestore query is scoped
jest.mock('@/lib/companies/migration', () => ({
  groupContactsByCompanyKey: jest.fn().mockReturnValue([]),
  applyMigration: jest.fn().mockResolvedValue([]),
}))

import { adminAuth, adminDb } from '@/lib/firebase/admin'
import { uidFor, buildCompany } from './companies/_fixtures'
import { seedOrgMember, callAsMember } from '../../../helpers/crm'

const AI_API_KEY = 'test-ai-key'
process.env.AI_API_KEY = AI_API_KEY
process.env.SESSION_COOKIE_NAME = '__session'

// ── fixtures ─────────────────────────────────────────────────────────────────

// Distinct UIDs — avoids substring-collision (uid-a matching uid-admin-a)
const orgAUid = uidFor('orgA-admin')
const orgBUid = uidFor('orgB-admin')

const adminA = seedOrgMember('org-a', orgAUid, { role: 'admin', firstName: 'Admin', lastName: 'A' })
const memberB = seedOrgMember('org-b', orgBUid, { role: 'member', firstName: 'User', lastName: 'B' })

const coA = buildCompany({ id: 'co-a-1', orgId: 'org-a', name: 'Org A Company' })
const coB = buildCompany({ id: 'co-b-1', orgId: 'org-b', name: 'Org B Company' })

type MockDoc<T extends { orgId?: string }> = {
  id: string
  data: () => T
  ref: { id: string; update: jest.Mock }
}

type ChainableQuery<T extends { orgId?: string }> = {
  where: jest.Mock
  orderBy: jest.Mock
  limit: jest.Mock
  offset?: jest.Mock
  startAfter?: jest.Mock
  get: () => Promise<{ docs: Array<MockDoc<T>>; empty?: boolean }>
}

// ── where-respecting Firestore mock ──────────────────────────────────────────

/**
 * Sets up the Firestore mock for isolation testing.
 *
 * Key design decision:
 *  - For list-style queries the mock tracks which orgId filter was applied
 *    via .where('orgId', '==', value). It returns ONLY the records matching
 *    that filter (or ALL records if the filter is absent — which is how the
 *    test catches a missing isolation guard).
 *  - For doc-level operations the mock returns the correct company snapshot,
 *    but the route itself must check data.orgId === ctx.orgId (via loadCompany).
 *
 * Returns a `captured` object for write-side assertions.
 */
function setupIsolationFixtures() {
  const captured = {
    setCalls:    [] as Array<Record<string, unknown>>,
    updateCalls: [] as Array<Record<string, unknown>>,
    batchUpdateCalls: [] as Array<Record<string, unknown>>,
    contactsWhereOrgFilters: [] as Array<string | undefined>,
  }

  ;(adminAuth.verifySessionCookie as jest.Mock).mockImplementation((cookie: string) => {
    if (cookie.endsWith(adminA.uid))   return Promise.resolve({ uid: adminA.uid })
    if (cookie.endsWith(memberB.uid))  return Promise.resolve({ uid: memberB.uid })
    return Promise.reject(new Error('invalid'))
  })

  // Shared batch stub (used by bulk + cascade-on-delete internally)
  ;(adminDb as { batch: jest.Mock }).batch = jest.fn().mockReturnValue({
    update: jest.fn((ref: unknown, data: Record<string, unknown>) => {
      captured.batchUpdateCalls.push(data)
    }),
    commit: jest.fn().mockResolvedValue(undefined),
    set: jest.fn(),
  })

  ;(adminDb.collection as jest.Mock).mockImplementation((name: string) => {

    // ── users ────────────────────────────────────────────────────────────
    if (name === 'users') {
      return {
        doc: (uid: string) => ({
          get: () => Promise.resolve({
            exists: true,
            data: () => ({
              activeOrgId: uid === adminA.uid ? 'org-a' : 'org-b',
            }),
          }),
        }),
      }
    }

    // ── orgMembers ───────────────────────────────────────────────────────
    if (name === 'orgMembers') {
      const docs = [
        {
          id: `org-a_${adminA.uid}`,
          exists: true,
          data: () => ({ ...adminA, orgId: 'org-a', uid: adminA.uid }),
        },
        {
          id: `org-b_${memberB.uid}`,
          exists: true,
          data: () => ({ ...memberB, orgId: 'org-b', uid: memberB.uid }),
        },
      ]

      return {
        where: (field: string, op: string, value: string) => ({
          get: () => {
            if (field === 'uid' && op === '==') {
              return Promise.resolve({ docs: docs.filter(doc => doc.data().uid === value) })
            }
            return Promise.resolve({ docs: [] })
          },
        }),
        doc: (id: string) => ({
          get: () => Promise.resolve({
            exists: true,
            data: () => docs.find(doc => doc.id === id)?.data() ?? { uid: id.split('_')[1], firstName: 'X', lastName: 'Y', role: 'member' },
          }),
        }),
      }
    }

    // ── organizations ────────────────────────────────────────────────────
    if (name === 'organizations') {
      return {
        doc: () => ({
          get: () => Promise.resolve({
            exists: true,
            data: () => ({ settings: { permissions: {} } }),
          }),
        }),
      }
    }

    // ── companies (where-respecting) ─────────────────────────────────────
    if (name === 'companies') {
      let whereOrgFilter: string | undefined

      const docs: Array<MockDoc<typeof coA>> = [
        { id: 'co-a-1', data: () => coA, ref: { id: 'co-a-1', update: jest.fn().mockResolvedValue(undefined) } },
        { id: 'co-b-1', data: () => coB, ref: { id: 'co-b-1', update: jest.fn().mockResolvedValue(undefined) } },
      ]

      const queryMock: ChainableQuery<typeof coA> = {
        where: jest.fn((field: string, op: string, value: unknown) => {
          if (field === 'orgId' && op === '==' && typeof value === 'string') whereOrgFilter = value
          return queryMock
        }),
        orderBy:    jest.fn().mockReturnThis(),
        limit:      jest.fn().mockReturnThis(),
        offset:     jest.fn().mockReturnThis(),
        startAfter: jest.fn().mockReturnThis(),
        get: () => Promise.resolve({
          docs: docs.filter(d =>
            // A missing orgId filter returns ALL rows — that's the test trap.
            whereOrgFilter === undefined ||
            d.data().orgId === whereOrgFilter,
          ),
        }),
      }

      return {
        ...queryMock,
        doc: jest.fn().mockImplementation((id?: string) => {
          const data = id === 'co-a-1' ? coA : id === 'co-b-1' ? coB : undefined
          const updateFn = jest.fn((patch: Record<string, unknown>) => {
            captured.updateCalls.push(patch)
            return Promise.resolve()
          })
          return {
            id: id ?? 'auto-id',
            get: () => Promise.resolve({
              exists: id === 'co-a-1' || id === 'co-b-1',
              id: id ?? 'auto-id',
              data: () => data,
              ref: { id, update: updateFn },
            }),
            set: jest.fn((d: Record<string, unknown>) => {
              captured.setCalls.push(d)
              return Promise.resolve()
            }),
            update: updateFn,
          }
        }),
      }
    }

    // ── contacts (where-respecting) ───────────────────────────────────────
    if (name === 'contacts') {
      let whereOrgFilter: string | undefined

      const orgAContact = { id: 'c-a-1', orgId: 'org-a', companyId: 'co-a-1', company: 'Org A Co' }
      const orgBContact = { id: 'c-b-1', orgId: 'org-b', companyId: 'co-b-1', company: 'Org B Co' }

      const contactDocs: Array<MockDoc<typeof orgAContact>> = [
        { id: 'c-a-1', data: () => orgAContact, ref: { id: 'c-a-1', update: jest.fn() } },
        { id: 'c-b-1', data: () => orgBContact, ref: { id: 'c-b-1', update: jest.fn() } },
      ]

      const contactQuery: ChainableQuery<typeof orgAContact> = {
        where: jest.fn((field: string, op: string, value: unknown) => {
          if (field === 'orgId' && op === '==') {
            whereOrgFilter = typeof value === 'string' ? value : undefined
            captured.contactsWhereOrgFilters.push(whereOrgFilter)
          }
          return contactQuery
        }),
        orderBy: jest.fn().mockReturnThis(),
        limit:   jest.fn().mockReturnThis(),
        get: () => Promise.resolve({
          docs: contactDocs.filter(d =>
            whereOrgFilter === undefined ||
            d.data().orgId === whereOrgFilter,
          ),
        }),
      }

      return {
        ...contactQuery,
        doc: jest.fn().mockReturnValue({
          get: () => Promise.resolve({ exists: false }),
          update: jest.fn().mockResolvedValue(undefined),
        }),
      }
    }

    // ── deals ─────────────────────────────────────────────────────────────
    if (name === 'deals') {
      return {
        where: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        get: () => Promise.resolve({ docs: [], empty: true }),
        doc: jest.fn().mockReturnValue({ get: () => Promise.resolve({ exists: false }) }),
      }
    }

    // ── quotes, activities ─────────────────────────────────────────────────
    if (name === 'quotes' || name === 'activities') {
      return {
        where: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        get: () => Promise.resolve({ docs: [], empty: true }),
        doc: jest.fn().mockReturnValue({ get: () => Promise.resolve({ exists: false }) }),
      }
    }

    return { doc: () => ({ get: () => Promise.resolve({ exists: false }) }) }
  })

  return captured
}

const routeCtx = (id: string) => ({ params: Promise.resolve({ id }) })

beforeEach(() => { jest.clearAllMocks() })

// ─────────────────────────────────────────────────────────────────────────────
// SUITE
// ─────────────────────────────────────────────────────────────────────────────

describe('cross-tenant isolation: companies (consolidated)', () => {

  // 1. GET /companies — list must exclude org-b records
  it('1. GET /companies: org-a actor gets no org-b companies (where clause respected)', async () => {
    setupIsolationFixtures()
    const req = callAsMember(adminA, 'GET', '/api/v1/crm/companies')
    const { GET } = await import('@/app/api/v1/crm/companies/route')
    const res = await GET(req)
    expect(res.status).toBe(200)
    const body = await res.json()
    const companies = (body.data?.companies ?? body.data ?? []) as Array<{ id: string }>
    const ids = companies.map((c) => c.id)
    expect(ids).not.toContain('co-b-1')
  })

  // 2. POST /companies — orgId from body is ignored; middleware sets ctx.orgId
  it('2. POST /companies: body orgId=org-b is overridden to org-a', async () => {
    const captured = setupIsolationFixtures()
    const req = callAsMember(adminA, 'POST', '/api/v1/crm/companies', {
      name: 'Trojan Corp',
      orgId: 'org-b',       // attacker tries to inject a different orgId
    })
    const { POST } = await import('@/app/api/v1/crm/companies/route')
    const res = await POST(req)
    expect(res.status).toBeLessThan(300)
    const written = captured.setCalls.at(-1)
    expect(written?.orgId).toBe('org-a')
    expect(written?.orgId).not.toBe('org-b')
  })

  // 3. GET /companies/:id — cross-org id returns 404
  it('3. GET /companies/:id: org-a actor cannot GET org-b company (404)', async () => {
    setupIsolationFixtures()
    const req = callAsMember(adminA, 'GET', '/api/v1/crm/companies/co-b-1')
    const { GET } = await import('@/app/api/v1/crm/companies/[id]/route')
    const res = await GET(req, routeCtx('co-b-1'))
    expect(res.status).toBe(404)
  })

  // 4. PUT /companies/:id — cross-org id returns 404
  it('4. PUT /companies/:id: org-a actor cannot PUT org-b company (404)', async () => {
    setupIsolationFixtures()
    const req = callAsMember(adminA, 'PUT', '/api/v1/crm/companies/co-b-1', { name: 'Hacked' })
    const { PUT } = await import('@/app/api/v1/crm/companies/[id]/route')
    const res = await PUT(req, routeCtx('co-b-1'))
    expect(res.status).toBe(404)
  })

  // 5. PATCH /companies/:id — cross-org id returns 404
  it('5. PATCH /companies/:id: org-a actor cannot PATCH org-b company (404)', async () => {
    setupIsolationFixtures()
    const req = callAsMember(adminA, 'PATCH', '/api/v1/crm/companies/co-b-1', { notes: 'Hacked' })
    const { PATCH } = await import('@/app/api/v1/crm/companies/[id]/route')
    const res = await PATCH(req, routeCtx('co-b-1'))
    expect(res.status).toBe(404)
  })

  // 6. DELETE /companies/:id — cross-org id returns 404
  it('6. DELETE /companies/:id: org-a admin cannot DELETE org-b company (404)', async () => {
    setupIsolationFixtures()
    const req = callAsMember(adminA, 'DELETE', '/api/v1/crm/companies/co-b-1')
    const { DELETE } = await import('@/app/api/v1/crm/companies/[id]/route')
    const res = await DELETE(req, routeCtx('co-b-1'))
    expect(res.status).toBe(404)
  })

  // 7. POST /companies/bulk — org-b ids in the body are skipped (not updated)
  it('7. POST /companies/bulk: org-b ids in body are skipped (not updated)', async () => {
    const captured = setupIsolationFixtures()
    const req = callAsMember(adminA, 'POST', '/api/v1/crm/companies/bulk', {
      ids: ['co-b-1'],        // cross-org id
      patch: { tier: 'enterprise' },
    })
    const { POST } = await import('@/app/api/v1/crm/companies/bulk/route')
    const res = await POST(req)
    expect(res.status).toBe(200)
    const body = await res.json()
    // The cross-org id must be counted as skipped, not updated
    expect(body.data.updated).toBe(0)
    expect(body.data.skipped).toBeGreaterThanOrEqual(1)
    // No batch updates should have been applied for org-b records
    expect(captured.batchUpdateCalls).toHaveLength(0)
  })

  // 8. POST /companies/:id/upload-logo — cross-org id returns 404
  it('8. POST /companies/:id/upload-logo: org-a actor cannot upload logo for org-b company (404)', async () => {
    setupIsolationFixtures()
    // Build a minimal multipart request — the 404 fires before storage is touched
    const formData = new FormData()
    formData.append('file', new Blob(['x'], { type: 'image/png' }), 'logo.png')
    const req = new NextRequest('http://localhost/api/v1/crm/companies/co-b-1/upload-logo', {
      method: 'POST',
      headers: new Headers({ cookie: `__session=test-session-${adminA.uid}` }),
      body: formData,
    })
    const { POST } = await import('@/app/api/v1/crm/companies/[id]/upload-logo/route')
    const res = await POST(req, routeCtx('co-b-1'))
    expect(res.status).toBe(404)
  })

  // 9. POST /companies/migrate-from-contacts — contacts query must be scoped to org-a
  it('9. POST /companies/migrate-from-contacts: contacts query is scoped to actor\'s org', async () => {
    const captured = setupIsolationFixtures()
    const req = callAsMember(adminA, 'POST', '/api/v1/crm/companies/migrate-from-contacts', {
      mode: 'preview',
    })
    const { POST } = await import('@/app/api/v1/crm/companies/migrate-from-contacts/route')
    const res = await POST(req)
    expect(res.status).toBe(200)
    // The contacts query MUST have been scoped to org-a
    // (captured.contactsWhereOrgFilters records every orgId filter applied to contacts)
    expect(captured.contactsWhereOrgFilters.length).toBeGreaterThan(0)
    expect(captured.contactsWhereOrgFilters.every(f => f === 'org-a')).toBe(true)
  })

  // 10. GET /companies/:id/contacts — cross-org company id returns 404
  it('10. GET /companies/:id/contacts: org-a actor cannot list contacts for org-b company (404)', async () => {
    setupIsolationFixtures()
    const req = callAsMember(adminA, 'GET', '/api/v1/crm/companies/co-b-1/contacts')
    const { GET } = await import('@/app/api/v1/crm/companies/[id]/contacts/route')
    const res = await GET(req, routeCtx('co-b-1'))
    expect(res.status).toBe(404)
  })

  // 11. GET /companies/:id/deals — cross-org company id returns 404
  it('11. GET /companies/:id/deals: org-a actor cannot list deals for org-b company (404)', async () => {
    setupIsolationFixtures()
    const req = callAsMember(adminA, 'GET', '/api/v1/crm/companies/co-b-1/deals')
    const { GET } = await import('@/app/api/v1/crm/companies/[id]/deals/route')
    const res = await GET(req, routeCtx('co-b-1'))
    expect(res.status).toBe(404)
  })

  // 12. GET /companies/:id/quotes — cross-org company id returns 404
  it('12. GET /companies/:id/quotes: org-a actor cannot list quotes for org-b company (404)', async () => {
    setupIsolationFixtures()
    const req = callAsMember(adminA, 'GET', '/api/v1/crm/companies/co-b-1/quotes')
    const { GET } = await import('@/app/api/v1/crm/companies/[id]/quotes/route')
    const res = await GET(req, routeCtx('co-b-1'))
    expect(res.status).toBe(404)
  })

  // 13. GET /companies/:id/activities — cross-org company id returns 404
  it('13. GET /companies/:id/activities: org-a actor cannot list activities for org-b company (404)', async () => {
    setupIsolationFixtures()
    const req = callAsMember(adminA, 'GET', '/api/v1/crm/companies/co-b-1/activities')
    const { GET } = await import('@/app/api/v1/crm/companies/[id]/activities/route')
    const res = await GET(req, routeCtx('co-b-1'))
    expect(res.status).toBe(404)
  })
})
