import { NextRequest } from 'next/server'

jest.mock('@/lib/firebase/admin', () => ({
  adminAuth: { verifySessionCookie: jest.fn() },
  adminDb: { collection: jest.fn() },
}))

// Stub side-effects so tests don't need to verify them here
jest.mock('@/lib/webhooks/dispatch', () => ({ dispatchWebhook: jest.fn().mockResolvedValue(undefined) }))
jest.mock('@/lib/activity/log', () => ({ logActivity: jest.fn().mockResolvedValue(undefined) }))
jest.mock('@/lib/email-analytics/attribution-hooks', () => ({ tryAttributeDealWon: jest.fn().mockResolvedValue(undefined) }))
jest.mock('@/lib/automations/trigger', () => ({ fireTrigger: jest.fn().mockResolvedValue(undefined) }))

// Mock pipelines store — tenant isolation tests don't test pipeline logic
jest.mock('@/lib/pipelines/store', () => ({
  loadPipeline: jest.fn().mockImplementation((_id: string, orgId: string) =>
    Promise.resolve({
      ref: {},
      data: {
        id: 'pl-default', orgId,
        stages: [
          { id: 'discovery', label: 'Discovery', kind: 'open', order: 0, probability: 10 },
          { id: 'proposal',  label: 'Proposal',  kind: 'open', order: 1, probability: 30 },
          { id: 'won',       label: 'Won',        kind: 'won',  order: 3, probability: 100 },
          { id: 'lost',      label: 'Lost',       kind: 'lost', order: 4, probability: 0 },
        ],
      },
    })
  ),
  getDefaultPipelineForOrg: jest.fn().mockImplementation((orgId: string) =>
    Promise.resolve({
      id: 'pl-default', orgId,
      stages: [
        { id: 'discovery', label: 'Discovery', kind: 'open', order: 0, probability: 10 },
        { id: 'proposal',  label: 'Proposal',  kind: 'open', order: 1, probability: 30 },
        { id: 'won',       label: 'Won',        kind: 'won',  order: 3, probability: 100 },
        { id: 'lost',      label: 'Lost',       kind: 'lost', order: 4, probability: 0 },
      ],
    })
  ),
}))

import { adminAuth, adminDb } from '@/lib/firebase/admin'
import { seedOrgMember, seedDeal, callAsMember, callAsAgent } from '../../../helpers/crm'

const AI_API_KEY = 'test-ai-key'
process.env.AI_API_KEY = AI_API_KEY
process.env.SESSION_COOKIE_NAME = '__session'

const memberA = seedOrgMember('org-a', 'uid-a', { role: 'member', firstName: 'A', lastName: 'A' })
const memberB = seedOrgMember('org-b', 'uid-b', { role: 'member', firstName: 'B', lastName: 'B' })
const adminA = seedOrgMember('org-a', 'uid-admin-a', { role: 'admin', firstName: 'Adm', lastName: 'A' })

const dealA = seedDeal('org-a', { id: 'a1', title: 'Deal A', pipelineId: 'pl-default', stageId: 'discovery', value: 100 })
const dealB = seedDeal('org-b', { id: 'b1', title: 'Deal B', pipelineId: 'pl-default', stageId: 'discovery', value: 200 })

/**
 * PR 3 pattern 3: `deals.where('orgId').get()` mock RESPECTS the filter.
 * If a route forgets `where('orgId')`, this suite would fail (returns both deals).
 *
 * The GET route calls: adminDb.collection('deals').where('orgId', '==', orgId)...
 * and filters optional fields in memory to avoid composite-index requirements.
 */
function setupIsolationFixtures(perms: Record<string, unknown> = {}) {
  const captured = {
    setCalls: [] as Array<Record<string, unknown>>,
    updateCalls: [] as Array<Record<string, unknown>>,
  }

  ;(adminAuth.verifySessionCookie as jest.Mock).mockImplementation((cookie: string) => {
    // Use endsWith to avoid uid-a matching uid-admin-a (substring collision)
    if (cookie.endsWith(adminA.uid)) return Promise.resolve({ uid: adminA.uid })
    if (cookie.endsWith(memberA.uid)) return Promise.resolve({ uid: memberA.uid })
    if (cookie.endsWith(memberB.uid)) return Promise.resolve({ uid: memberB.uid })
    return Promise.reject(new Error('invalid'))
  })

  ;(adminDb.collection as jest.Mock).mockImplementation((name: string) => {
    if (name === 'users') {
      return {
        doc: (uid: string) => ({
          get: () => Promise.resolve({
            exists: true,
            data: () => ({
              activeOrgId: uid === memberA.uid || uid === adminA.uid ? 'org-a' : 'org-b',
            }),
          }),
        }),
      }
    }
    if (name === 'orgMembers') {
      return {
        doc: (id: string) => ({
          get: () => Promise.resolve({
            exists: true,
            data: () => (
              id === `org-a_${memberA.uid}` ? memberA :
              id === `org-b_${memberB.uid}` ? memberB :
              id === `org-a_${adminA.uid}` ? adminA :
              // fallback for ownerUid lookups by the route (resolveMemberRef)
              { uid: id.split('_')[1], firstName: 'F', lastName: 'L' }
            ),
          }),
        }),
        where: (_field: string, _op: string, uid: string) => ({
          get: () => Promise.resolve({
            docs: [
              uid === memberA.uid ? { data: () => ({ orgId: 'org-a', uid: memberA.uid, role: memberA.role }) } : null,
              uid === memberB.uid ? { data: () => ({ orgId: 'org-b', uid: memberB.uid, role: memberB.role }) } : null,
              uid === adminA.uid ? { data: () => ({ orgId: 'org-a', uid: adminA.uid, role: adminA.role }) } : null,
            ].filter(Boolean),
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
    if (name === 'deals') {
      // Track the orgId filter set by .where('orgId', '==', value)
      let whereOrgFilter: string | undefined

      const queryMock: any = {
        where: jest.fn((field: string, op: string, value: any) => {
          if (field === 'orgId' && op === '==') whereOrgFilter = value
          return queryMock
        }),
        limit: jest.fn().mockReturnThis(),
        get: () => Promise.resolve({
          docs: [
            { id: 'a1', data: () => dealA, ref: { id: 'a1' } },
            { id: 'b1', data: () => dealB, ref: { id: 'b1' } },
          ].filter(d =>
            // If no orgId filter was captured, return all (route should always filter)
            whereOrgFilter === undefined ||
            (d.data() as any).orgId === whereOrgFilter,
          ),
        }),
      }

      return {
        // For collection-level chainable query (GET list)
        ...queryMock,
        // For doc-level operations (POST create, PUT/DELETE by id)
        doc: jest.fn().mockImplementation((id?: string) => ({
          id: id ?? 'auto-id',
          get: () => Promise.resolve({
            exists: id === 'a1' || id === 'b1',
            id: id ?? 'auto-id',
            data: () => (id === 'a1' ? dealA : id === 'b1' ? dealB : undefined),
          }),
          set: jest.fn((data: Record<string, unknown>) => {
            captured.setCalls.push(data)
            return Promise.resolve()
          }),
          update: jest.fn((data: Record<string, unknown>) => {
            captured.updateCalls.push(data)
            return Promise.resolve()
          }),
        })),
      }
    }
    return { doc: () => ({ get: () => Promise.resolve({ exists: false }) }) }
  })

  return captured
}

const routeCtx = (id: string) => ({ params: Promise.resolve({ id }) })

beforeEach(() => { jest.clearAllMocks() })

describe('cross-tenant isolation: deals (consolidated)', () => {
  it('member of A POST writes createdByRef.displayName=A A scoped to org-a', async () => {
    const captured = setupIsolationFixtures()
    const req = callAsMember(memberA, 'POST', '/api/v1/crm/deals', {
      contactId: 'c1', title: 'New deal', value: 50, currency: 'ZAR',
      pipelineId: 'pl-default', stageId: 'discovery',
    })
    const { POST } = await import('@/app/api/v1/crm/deals/route')
    const res = await POST(req)
    expect(res.status).toBeLessThan(300)
    const written = captured.setCalls.at(-1)
    expect(written?.orgId).toBe('org-a')
    expect((written?.createdByRef as any)?.displayName).toBe('A A')
    expect((written?.createdByRef as any)?.kind).toBe('human')
  })

  it('Bearer with X-Org-Id=org-a POST writes AGENT_PIP_REF scoped to org-a', async () => {
    const captured = setupIsolationFixtures()
    const req = callAsAgent('org-a', 'POST', '/api/v1/crm/deals', {
      contactId: 'c1', title: 'A deal', value: 0, currency: 'ZAR',
      pipelineId: 'pl-default', stageId: 'discovery',
    })
    const { POST } = await import('@/app/api/v1/crm/deals/route')
    const res = await POST(req)
    expect(res.status).toBeLessThan(300)
    const written = captured.setCalls.at(-1)
    expect((written?.createdByRef as any)?.uid).toBe('agent:pip')
    expect(written?.orgId).toBe('org-a')
    expect(written?.createdBy).toBeUndefined()
  })

  it('member of A GET list returns ONLY org-a deals (catches missing where clause)', async () => {
    setupIsolationFixtures()
    const req = callAsMember(memberA, 'GET', '/api/v1/crm/deals')
    const { GET } = await import('@/app/api/v1/crm/deals/route')
    const res = await GET(req)
    expect(res.status).toBe(200)
    const body = await res.json()
    // GET /deals returns apiSuccess(deals) where deals is a plain array → body.data is Array
    const arr = (Array.isArray(body.data) ? body.data : (body.data?.deals ?? [])) as Array<{ id: string }>
    const ids = arr.map((d: { id: string }) => d.id)
    expect(ids).not.toContain('b1')
  })

  it('Bearer with X-Org-Id=org-a GET list returns only org-a deals', async () => {
    setupIsolationFixtures()
    const req = callAsAgent('org-a', 'GET', '/api/v1/crm/deals')
    const { GET } = await import('@/app/api/v1/crm/deals/route')
    const res = await GET(req)
    expect(res.status).toBe(200)
    const body = await res.json()
    const arr = (Array.isArray(body.data) ? body.data : (body.data?.deals ?? [])) as Array<{ id: string }>
    const ids = arr.map((d: { id: string }) => d.id)
    expect(ids).not.toContain('b1')
  })

  it('member of A cannot PUT org-b deal (404)', async () => {
    setupIsolationFixtures()
    const req = callAsMember(memberA, 'PUT', '/api/v1/crm/deals/b1', { title: 'Hacked' })
    const { PUT } = await import('@/app/api/v1/crm/deals/[id]/route')
    const res = await PUT(req, routeCtx('b1'))
    expect(res.status).toBe(404)
  })

  it('admin of A cannot DELETE org-b deal (404)', async () => {
    setupIsolationFixtures()
    const req = callAsMember(adminA, 'DELETE', '/api/v1/crm/deals/b1')
    const { DELETE } = await import('@/app/api/v1/crm/deals/[id]/route')
    const res = await DELETE(req, routeCtx('b1'))
    expect(res.status).toBe(404)
  })

  it('Bearer with X-Org-Id=org-a cannot access org-b deal (404)', async () => {
    setupIsolationFixtures()
    const req = callAsAgent('org-a', 'PUT', '/api/v1/crm/deals/b1', { title: 'Hacked' })
    const { PUT } = await import('@/app/api/v1/crm/deals/[id]/route')
    const res = await PUT(req, routeCtx('b1'))
    expect(res.status).toBe(404)
  })

  it('member PUT stageId to won fires deal.won webhook', async () => {
    setupIsolationFixtures()
    const { dispatchWebhook } = await import('@/lib/webhooks/dispatch')
    ;(dispatchWebhook as jest.Mock).mockClear()
    const req = callAsMember(memberA, 'PUT', '/api/v1/crm/deals/a1', { stageId: 'won' })
    const { PUT } = await import('@/app/api/v1/crm/deals/[id]/route')
    const res = await PUT(req, routeCtx('a1'))
    expect(res.status).toBeLessThan(300)
    const wonCalls = (dispatchWebhook as jest.Mock).mock.calls.filter((c: unknown[]) => c[1] === 'deal.won')
    expect(wonCalls.length).toBeGreaterThan(0)
  })

  it('member DELETE returns 403 (admin role required)', async () => {
    setupIsolationFixtures()
    const req = callAsMember(memberA, 'DELETE', '/api/v1/crm/deals/a1')
    const { DELETE } = await import('@/app/api/v1/crm/deals/[id]/route')
    const res = await DELETE(req, routeCtx('a1'))
    expect(res.status).toBe(403)
  })

  it('admin DELETE succeeds + writes deleted:true and updatedByRef', async () => {
    const captured = setupIsolationFixtures()
    const req = callAsMember(adminA, 'DELETE', '/api/v1/crm/deals/a1')
    const { DELETE } = await import('@/app/api/v1/crm/deals/[id]/route')
    const res = await DELETE(req, routeCtx('a1'))
    expect(res.status).toBeLessThan(300)
    const patch = captured.updateCalls.at(-1)
    expect(patch?.deleted).toBe(true)
    expect((patch?.updatedByRef as any)?.displayName).toBe('Adm A')
  })
})
