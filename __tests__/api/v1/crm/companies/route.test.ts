/**
 * Tests for GET /api/v1/crm/companies and POST /api/v1/crm/companies
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
      now: () => ({ seconds: 1000, nanoseconds: 0, toDate: () => new Date() }),
    },
  }
})

// Silence store helpers that hit adminDb during module load
jest.mock('@/lib/companies/store', () => ({
  loadCompany: jest.fn(),
  sanitizeCompanyForWrite: jest.fn((input: Record<string, unknown>) => ({ tags: [], notes: '', ...input })),
  validateParentChain: jest.fn().mockResolvedValue(true),
  validateAccountManager: jest.fn().mockResolvedValue(true),
  clearCompanyIdOnCollection: jest.fn().mockResolvedValue(0),
  // Default: a valid AM resolves to a MemberRef. Tests that need invalid-AM
  // override with mockResolvedValueOnce(null).
  loadMemberRef: jest.fn().mockResolvedValue({ uid: 'am-uid', displayName: 'AM User' }),
}))

// Mock custom fields store for validation tests
jest.mock('@/lib/customFields/store', () => ({
  getDefinitionsForResource: jest.fn().mockResolvedValue([]),
}))
import { getDefinitionsForResource } from '@/lib/customFields/store'

import { adminAuth, adminDb } from '@/lib/firebase/admin'
import { seedOrgMember, callAsMember, callAsAgent } from '../../../../helpers/crm'
import { buildCompany, uidFor, buildMemberDoc } from './_fixtures'

const AI_API_KEY = 'test-ai-key-companies-root'
process.env.AI_API_KEY = AI_API_KEY
process.env.SESSION_COOKIE_NAME = '__session'

// ── stageAuth helper ──────────────────────────────────────────────────────────

type CompaniesListBehavior = {
  list?: () => Promise<{ docs: Array<{ id: string; data: () => unknown }> }>
  capturedDocSet?: jest.Mock
}

function stageAuth(
  member: { uid: string; orgId: string; role: string; firstName?: string; lastName?: string },
  perms: Record<string, unknown> = {},
  companiesBehavior: CompaniesListBehavior = {},
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
    if (name === 'companies') {
      const setFn = companiesBehavior.capturedDocSet ?? jest.fn().mockResolvedValue(undefined)
      return {
        doc: jest.fn().mockReturnValue({
          id: 'auto-co-id',
          set: setFn,
          get: jest.fn().mockResolvedValue({ exists: true, data: () => ({}) }),
        }),
        where: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        startAfter: jest.fn().mockReturnThis(),
        get: companiesBehavior.list ?? (() => Promise.resolve({ docs: [] })),
      }
    }
    return { doc: () => ({ get: () => Promise.resolve({ exists: false }) }) }
  })
}

// ── Tests ─────────────────────────────────────────────────────────────────────

beforeEach(() => { jest.clearAllMocks() })

describe('GET /api/v1/crm/companies', () => {
  it('returns empty list for a viewer with no companies', async () => {
    const uid = uidFor('viewer')
    const member = seedOrgMember('org-test', uid, { role: 'viewer' })
    stageAuth(member, {})
    const req = callAsMember(member, 'GET', '/api/v1/crm/companies')
    const { GET } = await import('@/app/api/v1/crm/companies/route')
    const res = await GET(req)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(Array.isArray(body.data.companies)).toBe(true)
    expect(body.data.companies).toHaveLength(0)
  })

  it('returns list of companies', async () => {
    const uid = uidFor('viewer2')
    const member = seedOrgMember('org-a', uid, { role: 'viewer' })
    const co = buildCompany({ id: 'co1', orgId: 'org-a', name: 'Acme' })
    stageAuth(member, {}, {
      list: () => Promise.resolve({ docs: [{ id: 'co1', data: () => co }] }),
    })
    const req = callAsMember(member, 'GET', '/api/v1/crm/companies')
    const { GET } = await import('@/app/api/v1/crm/companies/route')
    const res = await GET(req)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data.companies).toHaveLength(1)
    expect(body.data.companies[0].name).toBe('Acme')
  })

  it('returns 401 without auth', async () => {
    const req = new NextRequest('http://localhost/api/v1/crm/companies')
    const { GET } = await import('@/app/api/v1/crm/companies/route')
    const res = await GET(req)
    expect(res.status).toBe(401)
  })

  it('viewer can GET (role gate is viewer)', async () => {
    const uid = uidFor('viewer3')
    const member = seedOrgMember('org-b', uid, { role: 'viewer' })
    stageAuth(member, {})
    const req = callAsMember(member, 'GET', '/api/v1/crm/companies')
    const { GET } = await import('@/app/api/v1/crm/companies/route')
    const res = await GET(req)
    expect(res.status).toBe(200)
  })

  it('agent (Bearer) can GET', async () => {
    ;(adminDb.collection as jest.Mock).mockImplementation((name: string) => {
      if (name === 'organizations') {
        return {
          doc: () => ({ get: () => Promise.resolve({ exists: true, data: () => ({ settings: { permissions: {} } }) }) }),
        }
      }
      if (name === 'companies') {
        return {
          where: jest.fn().mockReturnThis(),
          orderBy: jest.fn().mockReturnThis(),
          limit: jest.fn().mockReturnThis(),
          startAfter: jest.fn().mockReturnThis(),
          get: () => Promise.resolve({ docs: [] }),
        }
      }
      return { doc: () => ({ get: () => Promise.resolve({ exists: false }) }) }
    })
    const req = callAsAgent('org-agent', 'GET', '/api/v1/crm/companies', undefined, AI_API_KEY)
    const { GET } = await import('@/app/api/v1/crm/companies/route')
    const res = await GET(req)
    expect(res.status).toBe(200)
  })
})

describe('POST /api/v1/crm/companies', () => {
  it('creates a company and returns 201', async () => {
    const uid = uidFor('member')
    const member = seedOrgMember('org-c', uid, { role: 'member', firstName: 'Alice', lastName: 'M' })
    const captured = jest.fn().mockResolvedValue(undefined)
    stageAuth(member, {}, { capturedDocSet: captured })
    const req = callAsMember(member, 'POST', '/api/v1/crm/companies', { name: 'NewCo Ltd' })
    const { POST } = await import('@/app/api/v1/crm/companies/route')
    const res = await POST(req)
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.data.company.id).toBe('auto-co-id')
  })

  it('returns 400 when name is missing', async () => {
    const uid = uidFor('member2')
    const member = seedOrgMember('org-c', uid, { role: 'member' })
    stageAuth(member, {})
    const req = callAsMember(member, 'POST', '/api/v1/crm/companies', { name: '' })
    const { POST } = await import('@/app/api/v1/crm/companies/route')
    const res = await POST(req)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/Name is required/i)
  })

  it('returns 403 when viewer tries to POST', async () => {
    const uid = uidFor('viewer4')
    const member = seedOrgMember('org-c', uid, { role: 'viewer' })
    stageAuth(member, {})
    const req = callAsMember(member, 'POST', '/api/v1/crm/companies', { name: 'Sneaky Co' })
    const { POST } = await import('@/app/api/v1/crm/companies/route')
    const res = await POST(req)
    expect(res.status).toBe(403)
  })

  it('writes orgId and createdByRef on POST', async () => {
    const uid = uidFor('member3')
    const member = seedOrgMember('org-d', uid, { role: 'member', firstName: 'Bob', lastName: 'K' })
    const captured = jest.fn().mockResolvedValue(undefined)
    stageAuth(member, {}, { capturedDocSet: captured })
    const req = callAsMember(member, 'POST', '/api/v1/crm/companies', { name: 'Test Corp' })
    const { POST } = await import('@/app/api/v1/crm/companies/route')
    const res = await POST(req)
    expect(res.status).toBe(201)
    const written = captured.mock.calls[0][0]
    expect(written.orgId).toBe('org-d')
    expect(written.createdByRef.displayName).toBe('Bob K')
    expect(written.createdByRef.kind).toBe('human')
  })

  it('validates invalid parentCompanyId cycle and returns 400', async () => {
    const { validateParentChain } = await import('@/lib/companies/store')
    ;(validateParentChain as jest.Mock).mockResolvedValueOnce(false)
    const uid = uidFor('member4')
    const member = seedOrgMember('org-e', uid, { role: 'member' })
    stageAuth(member, {})
    const req = callAsMember(member, 'POST', '/api/v1/crm/companies', {
      name: 'Cyclic Corp',
      parentCompanyId: 'some-parent-id',
    })
    const { POST } = await import('@/app/api/v1/crm/companies/route')
    const res = await POST(req)
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/parentCompanyId/i)
  })

  it('validates invalid accountManagerUid and returns 400', async () => {
    const { loadMemberRef } = await import('@/lib/companies/store')
    ;(loadMemberRef as jest.Mock).mockResolvedValueOnce(null)
    const uid = uidFor('member5')
    const member = seedOrgMember('org-f', uid, { role: 'member' })
    stageAuth(member, {})
    const req = callAsMember(member, 'POST', '/api/v1/crm/companies', {
      name: 'Bad AM Corp',
      accountManagerUid: 'nonexistent-uid',
    })
    const { POST } = await import('@/app/api/v1/crm/companies/route')
    const res = await POST(req)
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/accountManagerUid/i)
  })

  it('agent (Bearer) creates a company as system actor', async () => {
    const captured = jest.fn().mockResolvedValue(undefined)
    ;(adminDb.collection as jest.Mock).mockImplementation((name: string) => {
      if (name === 'organizations') {
        return {
          doc: () => ({ get: () => Promise.resolve({ exists: true, data: () => ({ settings: { permissions: {} } }) }) }),
        }
      }
      if (name === 'companies') {
        return {
          doc: jest.fn().mockReturnValue({ id: 'agent-co-id', set: captured }),
          where: jest.fn().mockReturnThis(),
          orderBy: jest.fn().mockReturnThis(),
          limit: jest.fn().mockReturnThis(),
          get: () => Promise.resolve({ docs: [] }),
        }
      }
      return { doc: () => ({ get: () => Promise.resolve({ exists: false }) }) }
    })
    const req = callAsAgent('org-agent2', 'POST', '/api/v1/crm/companies', { name: 'Agent Co' }, AI_API_KEY)
    const { POST } = await import('@/app/api/v1/crm/companies/route')
    const res = await POST(req)
    expect(res.status).toBe(201)
    const written = captured.mock.calls[0][0]
    expect(written.createdByRef.uid).toBe('agent:pip')
    expect(written.createdByRef.kind).toBe('agent')
    expect(written.createdBy).toBeUndefined()
  })
})

describe('POST /api/v1/crm/companies — custom field validation', () => {
  it('accepts write when customFields match definitions', async () => {
    const uid = uidFor('cf-co-ok')
    const member = seedOrgMember('org-cf-co', uid, { role: 'member' })
    const captured = jest.fn().mockResolvedValue(undefined)
    stageAuth(member, {}, { capturedDocSet: captured })
    ;(getDefinitionsForResource as jest.Mock).mockResolvedValueOnce([
      { id: 'd1', key: 'compliance_notes', type: 'longtext', required: false, maxLength: 5000, orgId: 'org-cf-co', resource: 'company', label: 'Compliance Notes', order: 0, createdAt: null, updatedAt: null },
    ])
    const req = callAsMember(member, 'POST', '/api/v1/crm/companies', {
      name: 'CF Corp',
      customFields: { compliance_notes: 'All good' },
    })
    const { POST } = await import('@/app/api/v1/crm/companies/route')
    const res = await POST(req)
    expect(res.status).toBe(201)
  })

  it('rejects write with 400 when customFields violate definitions', async () => {
    const uid = uidFor('cf-co-bad')
    const member = seedOrgMember('org-cf-co', uid, { role: 'member' })
    stageAuth(member, {})
    ;(getDefinitionsForResource as jest.Mock).mockResolvedValueOnce([
      { id: 'd1', key: 'verified', type: 'checkbox', required: true, orgId: 'org-cf-co', resource: 'company', label: 'Verified', order: 0, createdAt: null, updatedAt: null },
    ])
    const req = callAsMember(member, 'POST', '/api/v1/crm/companies', {
      name: 'CF Corp Bad',
      customFields: { verified: 'not-a-bool' },
    })
    const { POST } = await import('@/app/api/v1/crm/companies/route')
    const res = await POST(req)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/custom field/i)
  })
})
