/**
 * Tests for GET/PUT/PATCH/DELETE /api/v1/crm/companies/:id
 */
import { NextRequest } from 'next/server'

jest.mock('@/lib/firebase/admin', () => ({
  adminAuth: { verifySessionCookie: jest.fn() },
  adminDb: { collection: jest.fn(), batch: jest.fn() },
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
      now: () => ({ seconds: 2000, nanoseconds: 0, toDate: () => new Date() }),
    },
  }
})

// Mocked store — all functions are jest.fn() so we can control them per test
jest.mock('@/lib/companies/store', () => ({
  loadCompany: jest.fn(),
  sanitizeCompanyForWrite: jest.fn((input: Record<string, unknown>) => ({ ...input })),
  validateParentChain: jest.fn().mockResolvedValue(true),
  validateAccountManager: jest.fn().mockResolvedValue(true),
  clearCompanyIdOnCollection: jest.fn().mockResolvedValue(0),
  loadMemberRef: jest.fn().mockResolvedValue({ uid: 'am-uid', displayName: 'AM User' }),
}))

import { adminAuth, adminDb } from '@/lib/firebase/admin'
// Import store mocks so we can control them
import * as companiesStore from '@/lib/companies/store'
import { seedOrgMember, callAsMember } from '../../../../helpers/crm'
import { buildCompany, uidFor } from './_fixtures'

const AI_API_KEY = 'test-ai-key-companies-id'
process.env.AI_API_KEY = AI_API_KEY
process.env.SESSION_COOKIE_NAME = '__session'

// ── stageAuth ────────────────────────────────────────────────────────────────

function stageAuth(
  member: { uid: string; orgId: string; role: string; firstName?: string; lastName?: string },
  perms: Record<string, unknown> = {},
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
      }
    }
    if (name === 'organizations') {
      return {
        doc: () => ({
          get: () => Promise.resolve({ exists: true, data: () => ({ settings: { permissions: perms } }) }),
        }),
      }
    }
    return { doc: () => ({ get: () => Promise.resolve({ exists: false }) }) }
  })
}

function routeCtx(id: string) {
  return { params: Promise.resolve({ id }) }
}

const updateFn = jest.fn().mockResolvedValue(undefined)

function makeLoadedCompany(company: ReturnType<typeof buildCompany>) {
  updateFn.mockResolvedValue(undefined)
  return {
    ref: { update: updateFn, id: company.id },
    data: company,
  }
}

// Import the route module once (module cache is stable per test file)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let routeModule: any

beforeAll(async () => {
  routeModule = await import('@/app/api/v1/crm/companies/[id]/route')
})

beforeEach(() => {
  jest.clearAllMocks()
  ;(companiesStore.validateParentChain as jest.Mock).mockResolvedValue(true)
  ;(companiesStore.validateAccountManager as jest.Mock).mockResolvedValue(true)
  ;(companiesStore.clearCompanyIdOnCollection as jest.Mock).mockResolvedValue(0)
  ;(companiesStore.sanitizeCompanyForWrite as jest.Mock).mockImplementation((input: Record<string, unknown>) => ({ ...input }))
})

// ─────────────────────────────────────────────────────────────────────────────

describe('GET /api/v1/crm/companies/:id', () => {
  it('returns company for viewer', async () => {
    const uid = uidFor('viewer')
    const member = seedOrgMember('org-a', uid, { role: 'viewer' })
    stageAuth(member)
    const co = buildCompany({ id: 'co-x', orgId: 'org-a', name: 'Acme' })
    ;(companiesStore.loadCompany as jest.Mock).mockResolvedValue(makeLoadedCompany(co))
    const req = callAsMember(member, 'GET', '/api/v1/crm/companies/co-x')
    const res = await routeModule.GET(req, routeCtx('co-x'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data.company.name).toBe('Acme')
  })

  it('returns 404 when company not found', async () => {
    const uid = uidFor('viewer2')
    const member = seedOrgMember('org-a', uid, { role: 'viewer' })
    stageAuth(member)
    ;(companiesStore.loadCompany as jest.Mock).mockResolvedValue(null)
    const req = callAsMember(member, 'GET', '/api/v1/crm/companies/ghost')
    const res = await routeModule.GET(req, routeCtx('ghost'))
    expect(res.status).toBe(404)
  })

  it('returns 401 without auth', async () => {
    const req = new NextRequest('http://localhost/api/v1/crm/companies/co-1')
    const res = await routeModule.GET(req, routeCtx('co-1'))
    expect(res.status).toBe(401)
  })

  it('viewer can GET (role gate is viewer)', async () => {
    const uid = uidFor('viewer3')
    const member = seedOrgMember('org-b', uid, { role: 'viewer' })
    stageAuth(member)
    const co = buildCompany({ id: 'co-b', orgId: 'org-b' })
    ;(companiesStore.loadCompany as jest.Mock).mockResolvedValue(makeLoadedCompany(co))
    const req = callAsMember(member, 'GET', '/api/v1/crm/companies/co-b')
    const res = await routeModule.GET(req, routeCtx('co-b'))
    expect(res.status).toBe(200)
  })
})

describe('PATCH /api/v1/crm/companies/:id', () => {
  it('updates company and returns merged data', async () => {
    const uid = uidFor('member')
    const member = seedOrgMember('org-a', uid, { role: 'member', firstName: 'Alice', lastName: 'Z' })
    stageAuth(member)
    const co = buildCompany({ id: 'co-patch', orgId: 'org-a', name: 'Old Name' })
    ;(companiesStore.loadCompany as jest.Mock).mockResolvedValue(makeLoadedCompany(co))
    const req = callAsMember(member, 'PATCH', '/api/v1/crm/companies/co-patch', { name: 'New Name' })
    const res = await routeModule.PATCH(req, routeCtx('co-patch'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data.company.name).toBe('New Name')
    expect(updateFn).toHaveBeenCalledTimes(1)
  })

  it('returns 400 on empty body', async () => {
    const uid = uidFor('member2')
    const member = seedOrgMember('org-a', uid, { role: 'member' })
    stageAuth(member)
    // loadCompany should not be called since body validation fails first... but it is called after
    // Actually, the route checks body before loadCompany in this implementation
    const req = callAsMember(member, 'PATCH', '/api/v1/crm/companies/co-empty', {})
    const res = await routeModule.PATCH(req, routeCtx('co-empty'))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/Empty body/i)
  })

  it('returns 404 when company not found', async () => {
    const uid = uidFor('member3')
    const member = seedOrgMember('org-a', uid, { role: 'member' })
    stageAuth(member)
    ;(companiesStore.loadCompany as jest.Mock).mockResolvedValue(null)
    const req = callAsMember(member, 'PATCH', '/api/v1/crm/companies/ghost2', { name: 'X' })
    const res = await routeModule.PATCH(req, routeCtx('ghost2'))
    expect(res.status).toBe(404)
  })

  it('returns 403 for viewer trying to PATCH', async () => {
    const uid = uidFor('viewer5')
    const member = seedOrgMember('org-a', uid, { role: 'viewer' })
    stageAuth(member)
    const req = callAsMember(member, 'PATCH', '/api/v1/crm/companies/co-a', { name: 'X' })
    const res = await routeModule.PATCH(req, routeCtx('co-a'))
    expect(res.status).toBe(403)
  })

  it('writes updatedByRef on PATCH', async () => {
    const uid = uidFor('member4')
    const member = seedOrgMember('org-a', uid, { role: 'member', firstName: 'Bob', lastName: 'P' })
    stageAuth(member)
    const co = buildCompany({ id: 'co-ref', orgId: 'org-a' })
    ;(companiesStore.loadCompany as jest.Mock).mockResolvedValue(makeLoadedCompany(co))
    const req = callAsMember(member, 'PATCH', '/api/v1/crm/companies/co-ref', { industry: 'FinTech' })
    await routeModule.PATCH(req, routeCtx('co-ref'))
    const written = updateFn.mock.calls[0][0]
    expect(written.updatedByRef.displayName).toBe('Bob P')
    expect(written.updatedByRef.kind).toBe('human')
  })
})

describe('PUT /api/v1/crm/companies/:id', () => {
  it('full replace update works like PATCH', async () => {
    const uid = uidFor('member-put')
    const member = seedOrgMember('org-put', uid, { role: 'member' })
    stageAuth(member)
    const co = buildCompany({ id: 'co-put', orgId: 'org-put' })
    ;(companiesStore.loadCompany as jest.Mock).mockResolvedValue(makeLoadedCompany(co))
    const req = callAsMember(member, 'PUT', '/api/v1/crm/companies/co-put', { name: 'Replaced' })
    const res = await routeModule.PUT(req, routeCtx('co-put'))
    expect(res.status).toBe(200)
    expect((await res.json()).data.company.name).toBe('Replaced')
  })
})

describe('DELETE /api/v1/crm/companies/:id', () => {
  it('soft deletes company and returns { id }', async () => {
    const uid = uidFor('admin')
    const member = seedOrgMember('org-a', uid, { role: 'admin' })
    stageAuth(member)
    const co = buildCompany({ id: 'co-del', orgId: 'org-a' })
    ;(companiesStore.loadCompany as jest.Mock).mockResolvedValue(makeLoadedCompany(co))
    const req = callAsMember(member, 'DELETE', '/api/v1/crm/companies/co-del')
    const res = await routeModule.DELETE(req, routeCtx('co-del'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data.id).toBe('co-del')
    const written = updateFn.mock.calls[0][0]
    expect(written.deleted).toBe(true)
  })

  it('returns 404 when company not found for DELETE', async () => {
    const uid = uidFor('admin2')
    const member = seedOrgMember('org-a', uid, { role: 'admin' })
    stageAuth(member)
    ;(companiesStore.loadCompany as jest.Mock).mockResolvedValue(null)
    const req = callAsMember(member, 'DELETE', '/api/v1/crm/companies/ghost3')
    const res = await routeModule.DELETE(req, routeCtx('ghost3'))
    expect(res.status).toBe(404)
  })

  it('returns 403 when member (non-admin) tries to DELETE', async () => {
    const uid = uidFor('member-del')
    const member = seedOrgMember('org-a', uid, { role: 'member' })
    stageAuth(member)
    const req = callAsMember(member, 'DELETE', '/api/v1/crm/companies/co-m')
    const res = await routeModule.DELETE(req, routeCtx('co-m'))
    expect(res.status).toBe(403)
  })

  it('triggers cascade on DELETE (all 4 collections)', async () => {
    const uid = uidFor('admin3')
    const member = seedOrgMember('org-a', uid, { role: 'admin' })
    stageAuth(member)
    const co = buildCompany({ id: 'co-cascade', orgId: 'org-a' })
    ;(companiesStore.loadCompany as jest.Mock).mockResolvedValue(makeLoadedCompany(co))
    ;(companiesStore.clearCompanyIdOnCollection as jest.Mock).mockResolvedValue(5)
    const req = callAsMember(member, 'DELETE', '/api/v1/crm/companies/co-cascade')
    const res = await routeModule.DELETE(req, routeCtx('co-cascade'))
    expect(res.status).toBe(200)
    expect(companiesStore.clearCompanyIdOnCollection).toHaveBeenCalledWith('contacts', 'org-a', 'co-cascade')
    expect(companiesStore.clearCompanyIdOnCollection).toHaveBeenCalledWith('deals', 'org-a', 'co-cascade')
    expect(companiesStore.clearCompanyIdOnCollection).toHaveBeenCalledWith('quotes', 'org-a', 'co-cascade')
    expect(companiesStore.clearCompanyIdOnCollection).toHaveBeenCalledWith('activities', 'org-a', 'co-cascade')
  })

  it('cascade failure does not fail the DELETE response', async () => {
    const uid = uidFor('admin4')
    const member = seedOrgMember('org-a', uid, { role: 'admin' })
    stageAuth(member)
    const co = buildCompany({ id: 'co-cascade-fail', orgId: 'org-a' })
    ;(companiesStore.loadCompany as jest.Mock).mockResolvedValue(makeLoadedCompany(co))
    ;(companiesStore.clearCompanyIdOnCollection as jest.Mock).mockRejectedValue(new Error('Firestore timeout'))
    const req = callAsMember(member, 'DELETE', '/api/v1/crm/companies/co-cascade-fail')
    const res = await routeModule.DELETE(req, routeCtx('co-cascade-fail'))
    expect(res.status).toBe(200)
    expect((await res.json()).data.id).toBe('co-cascade-fail')
  })
})
