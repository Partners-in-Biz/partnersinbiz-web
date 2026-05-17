/**
 * Tests for GET /api/v1/crm/companies/:id/deals
 */

jest.mock('@/lib/firebase/admin', () => ({
  adminAuth: { verifySessionCookie: jest.fn() },
  adminDb: { collection: jest.fn() },
}))

jest.mock('firebase-admin/firestore', () => {
  return {
    FieldValue: {
      serverTimestamp: () => ({ _type: 'serverTimestamp' }),
      delete: () => ({ _type: 'deleteField' }),
    },
    Timestamp: {
      now: () => ({ seconds: 2000, nanoseconds: 0, toDate: () => new Date() }),
    },
  }
})

// Mock companies store — loadCompany controls authorization
jest.mock('@/lib/companies/store', () => ({
  loadCompany: jest.fn(),
}))

import { adminAuth, adminDb } from '@/lib/firebase/admin'
import * as companiesStore from '@/lib/companies/store'
import { seedOrgMember, callAsMember, callAsAgent } from '../../../../helpers/crm'
import { buildCompany, uidFor } from './_fixtures'

const AI_API_KEY = 'test-ai-key-id-deals'
process.env.AI_API_KEY = AI_API_KEY
process.env.SESSION_COOKIE_NAME = '__session'

function makeDealDoc(id: string, data: Record<string, unknown>) {
  return { id, data: () => data }
}

function stageAuth(
  member: { uid: string; orgId: string; role: string; firstName?: string; lastName?: string },
  deals: Array<{ id: string; data: Record<string, unknown> }> = [],
) {
  ;(adminAuth.verifySessionCookie as jest.Mock).mockResolvedValue({ uid: member.uid })
  ;(adminDb.collection as jest.Mock).mockImplementation((name: string) => {
    if (name === 'users') {
      return { doc: () => ({ get: () => Promise.resolve({ exists: true, data: () => ({ activeOrgId: member.orgId }) }) }) }
    }
    if (name === 'orgMembers') {
      return { doc: () => ({ get: () => Promise.resolve({ exists: true, data: () => member }) }) }
    }
    if (name === 'organizations') {
      return { doc: () => ({ get: () => Promise.resolve({ exists: true, data: () => ({ settings: { permissions: {} } }) }) }) }
    }
    if (name === 'deals') {
      const docs = deals.map(d => makeDealDoc(d.id, d.data))
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

const routeCtx = (id: string) => ({ params: Promise.resolve({ id }) })

describe('GET /api/v1/crm/companies/:id/deals', () => {
  beforeEach(() => jest.clearAllMocks())

  it('happy path — returns deals linked to the company', async () => {
    const member = seedOrgMember('org-a', uidFor('m'), { role: 'viewer' })
    const company = buildCompany({ id: 'co-1', orgId: 'org-a' })
    ;(companiesStore.loadCompany as jest.Mock).mockResolvedValue({ ref: {}, data: company })
    stageAuth(member, [
      { id: 'd-1', data: { orgId: 'org-a', companyId: 'co-1', title: 'Deal One', deleted: false } },
      { id: 'd-2', data: { orgId: 'org-a', companyId: 'co-1', title: 'Deal Two', deleted: false } },
    ])
    const req = callAsMember(member, 'GET', '/api/v1/crm/companies/co-1/deals')
    const { GET } = await import('@/app/api/v1/crm/companies/[id]/deals/route')
    const res = await GET(req, routeCtx('co-1'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.data.deals).toHaveLength(2)
    expect(body.data.deals[0].id).toBe('d-1')
  })

  it('returns empty array when company has no linked deals', async () => {
    const member = seedOrgMember('org-a', uidFor('m'), { role: 'viewer' })
    const company = buildCompany({ id: 'co-empty', orgId: 'org-a' })
    ;(companiesStore.loadCompany as jest.Mock).mockResolvedValue({ ref: {}, data: company })
    stageAuth(member, [])
    const req = callAsMember(member, 'GET', '/api/v1/crm/companies/co-empty/deals')
    const { GET } = await import('@/app/api/v1/crm/companies/[id]/deals/route')
    const res = await GET(req, routeCtx('co-empty'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data.deals).toHaveLength(0)
  })

  it('returns 404 when company does not exist or belongs to another org', async () => {
    const member = seedOrgMember('org-a', uidFor('m'), { role: 'viewer' })
    ;(companiesStore.loadCompany as jest.Mock).mockResolvedValue(null)
    stageAuth(member, [])
    const req = callAsMember(member, 'GET', '/api/v1/crm/companies/co-other/deals')
    const { GET } = await import('@/app/api/v1/crm/companies/[id]/deals/route')
    const res = await GET(req, routeCtx('co-other'))
    expect(res.status).toBe(404)
  })

  it('respects limit query param (capped at 200)', async () => {
    const member = seedOrgMember('org-a', uidFor('m'), { role: 'viewer' })
    const company = buildCompany({ id: 'co-limit', orgId: 'org-a' })
    ;(companiesStore.loadCompany as jest.Mock).mockResolvedValue({ ref: {}, data: company })
    const dealsQuery = {
      where: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      get: jest.fn().mockResolvedValue({ docs: [] }),
    }
    ;(adminAuth.verifySessionCookie as jest.Mock).mockResolvedValue({ uid: member.uid })
    ;(adminDb.collection as jest.Mock).mockImplementation((name: string) => {
      if (name === 'users') return { doc: () => ({ get: () => Promise.resolve({ exists: true, data: () => ({ activeOrgId: 'org-a' }) }) }) }
      if (name === 'orgMembers') return { doc: () => ({ get: () => Promise.resolve({ exists: true, data: () => member }) }) }
      if (name === 'organizations') return { doc: () => ({ get: () => Promise.resolve({ exists: true, data: () => ({ settings: { permissions: {} } }) }) }) }
      if (name === 'deals') return dealsQuery
      return { doc: () => ({ get: () => Promise.resolve({ exists: false }) }) }
    })
    // Request limit=999 — should be capped to 200
    const req = callAsMember(member, 'GET', '/api/v1/crm/companies/co-limit/deals?limit=999')
    const { GET } = await import('@/app/api/v1/crm/companies/[id]/deals/route')
    await GET(req, routeCtx('co-limit'))
    expect(dealsQuery.limit).toHaveBeenCalledWith(200)
  })

  it('viewer role can access the endpoint', async () => {
    const member = seedOrgMember('org-a', uidFor('viewer'), { role: 'viewer' })
    const company = buildCompany({ id: 'co-v', orgId: 'org-a' })
    ;(companiesStore.loadCompany as jest.Mock).mockResolvedValue({ ref: {}, data: company })
    stageAuth(member, [])
    const req = callAsMember(member, 'GET', '/api/v1/crm/companies/co-v/deals')
    const { GET } = await import('@/app/api/v1/crm/companies/[id]/deals/route')
    const res = await GET(req, routeCtx('co-v'))
    expect(res.status).toBe(200)
  })
})
