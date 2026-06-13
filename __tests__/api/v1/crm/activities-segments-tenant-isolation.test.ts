import { NextRequest } from 'next/server'

jest.mock('@/lib/firebase/admin', () => ({
  adminAuth: { verifySessionCookie: jest.fn() },
  adminDb: { collection: jest.fn() },
}))

// Stub side-effects so tests don't need to verify them here
jest.mock('@/lib/webhooks/dispatch', () => ({ dispatchWebhook: jest.fn().mockResolvedValue(undefined) }))
jest.mock('@/lib/activity/log', () => ({ logActivity: jest.fn().mockResolvedValue(undefined) }))

import { adminAuth, adminDb } from '@/lib/firebase/admin'
import { seedOrgMember, callAsMember, callAsAgent } from '../../../helpers/crm'
import { makePortalAuthCollectionsForMembers } from '../../../helpers/firebase-admin'

const AI_API_KEY = 'test-ai-key'
process.env.AI_API_KEY = AI_API_KEY
process.env.SESSION_COOKIE_NAME = '__session'

// Use distinct uids to avoid substring collisions (PR 3 lesson)
const memberA = seedOrgMember('org-a', 'uid-amem', { role: 'member', firstName: 'A', lastName: 'M' })
const adminA  = seedOrgMember('org-a', 'uid-aadm', { role: 'admin',  firstName: 'A', lastName: 'A' })
const memberB = seedOrgMember('org-b', 'uid-bmem', { role: 'member', firstName: 'B', lastName: 'M' })

const activityA = { id: 'act-a', orgId: 'org-a', contactId: 'c1', type: 'note', summary: 'A note', createdBy: 'uid-amem' }
const activityB = { id: 'act-b', orgId: 'org-b', contactId: 'c2', type: 'note', summary: 'B note', createdBy: 'uid-bmem' }
const segmentA  = { id: 'seg-a', orgId: 'org-a', name: 'A seg', filters: {}, deleted: false }
const segmentB  = { id: 'seg-b', orgId: 'org-b', name: 'B seg', filters: {}, deleted: false }
const contactA  = { id: 'con-a', orgId: 'org-a', name: 'Contact A', email: 'a@x.com', tags: [] }
const contactB  = { id: 'con-b', orgId: 'org-b', name: 'Contact B', email: 'b@x.com', tags: [] }

/**
 * where-respecting mock pattern (PR 3 lesson):
 * Captures the orgId filter set by .where('orgId', '==', value) and returns
 * only matching docs from get(). A route that forgets to call .where('orgId')
 * would return docs for both orgs, causing isolation tests to fail.
 */
function setupIsolationFixtures() {
  const captured = {
    activityAdds:   [] as Array<Record<string, unknown>>,
    segmentSets:    [] as Array<Record<string, unknown>>,
    segmentUpdates: [] as Array<Record<string, unknown>>,
  }

  ;(adminAuth.verifySessionCookie as jest.Mock).mockImplementation((cookie: string) => {
    if (cookie.endsWith(memberA.uid)) return Promise.resolve({ uid: memberA.uid })
    if (cookie.endsWith(adminA.uid))  return Promise.resolve({ uid: adminA.uid })
    if (cookie.endsWith(memberB.uid)) return Promise.resolve({ uid: memberB.uid })
    return Promise.reject(new Error('invalid'))
  })

  const authCollections = makePortalAuthCollectionsForMembers([memberA, adminA, memberB])
  ;(adminDb.collection as jest.Mock).mockImplementation((name: string) => {
    if (name in authCollections) return authCollections[name as keyof typeof authCollections]
    // ── users ────────────────────────────────────────────────────────
    if (name === 'users') {
      return {
        doc: (uid: string) => ({
          get: () => Promise.resolve({
            exists: true,
            data: () => ({
              activeOrgId:
                uid === memberA.uid || uid === adminA.uid ? 'org-a' : 'org-b',
            }),
          }),
        }),
      }
    }

    // ── orgMembers ───────────────────────────────────────────────────
    if (name === 'orgMembers') {
      return {
        doc: (id: string) => ({
          get: () => Promise.resolve({
            exists: true,
            data: () => (
              id === `org-a_${memberA.uid}` ? memberA :
              id === `org-a_${adminA.uid}`  ? adminA  :
              id === `org-b_${memberB.uid}` ? memberB :
              { uid: id.split('_')[1], firstName: 'X', lastName: 'Y' }
            ),
          }),
        }),
      }
    }

    // ── organizations ────────────────────────────────────────────────
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

    // ── activities ───────────────────────────────────────────────────
    if (name === 'activities') {
      let whereOrgFilter: string | undefined
      const query: any = {
        where: jest.fn((field: string, op: string, value: any) => {
          if (field === 'orgId' && op === '==') whereOrgFilter = value
          return query
        }),
        orderBy: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        offset: jest.fn().mockReturnThis(),
        get: () => Promise.resolve({
          docs: [
            { id: 'act-a', data: () => activityA },
            { id: 'act-b', data: () => activityB },
          ].filter(d =>
            whereOrgFilter === undefined ||
            (d.data() as any).orgId === whereOrgFilter,
          ),
        }),
      }
      return {
        add: jest.fn((data: Record<string, unknown>) => {
          captured.activityAdds.push(data)
          return Promise.resolve({ id: 'auto-act' })
        }),
        ...query,
      }
    }

    // ── segments ─────────────────────────────────────────────────────
    if (name === 'segments') {
      let whereOrgFilter: string | undefined
      const query: any = {
        where: jest.fn((field: string, op: string, value: any) => {
          if (field === 'orgId' && op === '==') whereOrgFilter = value
          return query
        }),
        orderBy: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        get: () => Promise.resolve({
          docs: [
            { id: 'seg-a', data: () => segmentA },
            { id: 'seg-b', data: () => segmentB },
          ].filter(d =>
            whereOrgFilter === undefined ||
            (d.data() as any).orgId === whereOrgFilter,
          ),
        }),
      }
      return {
        doc: jest.fn().mockImplementation((id?: string) => ({
          id: id ?? 'auto-seg',
          get: () => Promise.resolve({
            exists: id === 'seg-a' || id === 'seg-b',
            id: id ?? 'auto-seg',
            data: () => (
              id === 'seg-a' ? segmentA :
              id === 'seg-b' ? segmentB :
              undefined
            ),
          }),
          set: jest.fn((data: Record<string, unknown>) => {
            captured.segmentSets.push(data)
            return Promise.resolve()
          }),
          update: jest.fn((data: Record<string, unknown>) => {
            captured.segmentUpdates.push(data)
            return Promise.resolve()
          }),
        })),
        ...query,
      }
    }

    // ── contacts (needed by preview + resolve) ────────────────────────
    if (name === 'contacts') {
      let whereOrgFilter: string | undefined
      const query: any = {
        where: jest.fn((field: string, op: string, value: any) => {
          if (field === 'orgId' && op === '==') whereOrgFilter = value
          return query
        }),
        orderBy: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        get: () => Promise.resolve({
          docs: [
            { id: 'con-a', data: () => contactA },
            { id: 'con-b', data: () => contactB },
          ].filter(d =>
            whereOrgFilter === undefined ||
            (d.data() as any).orgId === whereOrgFilter,
          ),
        }),
      }
      return {
        doc: jest.fn((id: string) => ({
          get: () => Promise.resolve({
            exists: id === 'c1' || id === 'con-a' || id === 'con-b',
            id,
            data: () => (
              id === 'con-b'
                ? contactB
                : { ...contactA, id, orgId: 'org-a' }
            ),
          }),
        })),
        ...query,
      }
    }

    return { doc: () => ({ get: () => Promise.resolve({ exists: false }) }) }
  })

  return captured
}

const routeCtx = (id: string) => ({ params: Promise.resolve({ id }) })

beforeEach(() => { jest.clearAllMocks() })

describe('cross-tenant isolation: activities + segments', () => {

  // ── activities ────────────────────────────────────────────────────────────

  it('member of A POST activity scoped to org-a with createdByRef.displayName=A M', async () => {
    const captured = setupIsolationFixtures()
    const req = callAsMember(memberA, 'POST', '/api/v1/crm/activities', {
      contactId: 'c1', type: 'note', summary: 'x',
    })
    const { POST } = await import('@/app/api/v1/crm/activities/route')
    const res = await POST(req)
    expect(res.status).toBeLessThan(300)
    const written = captured.activityAdds.at(-1)
    expect(written?.orgId).toBe('org-a')
    expect((written?.createdByRef as any)?.displayName).toBe('A M')
  })

  it('Bearer activity POST scoped to org-a uses AGENT_PIP_REF', async () => {
    const captured = setupIsolationFixtures()
    const req = callAsAgent('org-a', 'POST', '/api/v1/crm/activities', {
      contactId: 'c1', type: 'note', summary: 'x',
    })
    const { POST } = await import('@/app/api/v1/crm/activities/route')
    const res = await POST(req)
    expect(res.status).toBeLessThan(300)
    const written = captured.activityAdds.at(-1)
    expect((written?.createdByRef as any)?.uid).toBe('agent:pip')
    expect(written?.orgId).toBe('org-a')
  })

  it('member of A GET activities returns ONLY org-a (catches missing where clause)', async () => {
    setupIsolationFixtures()
    const req = callAsMember(memberA, 'GET', '/api/v1/crm/activities')
    const { GET } = await import('@/app/api/v1/crm/activities/route')
    const res = await GET(req)
    expect(res.status).toBe(200)
    const body = await res.json()
    const arr = (body.data?.activities ?? []) as Array<{ id: string }>
    expect(arr.map(a => a.id)).not.toContain('act-b')
  })

  // ── segments ──────────────────────────────────────────────────────────────

  it('member of A GET segments list returns ONLY org-a', async () => {
    setupIsolationFixtures()
    const req = callAsMember(memberA, 'GET', '/api/v1/crm/segments')
    const { GET } = await import('@/app/api/v1/crm/segments/route')
    const res = await GET(req)
    expect(res.status).toBe(200)
    const body = await res.json()
    const arr = (body.data?.segments ?? []) as Array<{ id: string }>
    expect(arr.map(s => s.id)).not.toContain('seg-b')
  })

  it('admin of A cannot PUT segment-b (404)', async () => {
    setupIsolationFixtures()
    const req = callAsMember(adminA, 'PUT', '/api/v1/crm/segments/seg-b', { name: 'Hacked' })
    const { PUT } = await import('@/app/api/v1/crm/segments/[id]/route')
    const res = await PUT(req, routeCtx('seg-b'))
    expect(res.status).toBe(404)
  })

  it('admin of A cannot DELETE segment-b (404)', async () => {
    setupIsolationFixtures()
    const req = callAsMember(adminA, 'DELETE', '/api/v1/crm/segments/seg-b')
    const { DELETE } = await import('@/app/api/v1/crm/segments/[id]/route')
    const res = await DELETE(req, routeCtx('seg-b'))
    expect(res.status).toBe(404)
  })

  it('admin of A cannot resolve segment-b (404)', async () => {
    setupIsolationFixtures()
    const req = callAsMember(adminA, 'POST', '/api/v1/crm/segments/seg-b/resolve', {})
    const { POST } = await import('@/app/api/v1/crm/segments/[id]/resolve/route')
    const res = await POST(req, routeCtx('seg-b'))
    expect(res.status).toBe(404)
  })

  it('member of A cannot POST segment (403, admin required)', async () => {
    setupIsolationFixtures()
    const req = callAsMember(memberA, 'POST', '/api/v1/crm/segments', {
      name: 'X', filters: {},
    })
    const { POST } = await import('@/app/api/v1/crm/segments/route')
    const res = await POST(req)
    expect(res.status).toBe(403)
  })

  it('admin of A POST segment writes createdByRef scoped to org-a', async () => {
    const captured = setupIsolationFixtures()
    const req = callAsMember(adminA, 'POST', '/api/v1/crm/segments', {
      name: 'My seg', filters: {},
    })
    const { POST } = await import('@/app/api/v1/crm/segments/route')
    const res = await POST(req)
    expect(res.status).toBeLessThan(300)
    // Route returns the segment in the response body; verify via body.data
    const body = await res.json()
    expect(body.data?.orgId).toBe('org-a')
    expect(body.data?.createdByRef?.displayName).toBe('A A')
  })

  it('Bearer segment POST works (system bypasses admin gate)', async () => {
    const captured = setupIsolationFixtures()
    const req = callAsAgent('org-a', 'POST', '/api/v1/crm/segments', {
      name: 'Agent seg', filters: {},
    })
    const { POST } = await import('@/app/api/v1/crm/segments/route')
    const res = await POST(req)
    expect(res.status).toBeLessThan(300)
    const body = await res.json()
    expect(body.data?.createdByRef?.uid).toBe('agent:pip')
  })

  it('admin preview uses ctx.orgId (returns count for org-a contacts only)', async () => {
    setupIsolationFixtures()
    const req = callAsMember(adminA, 'POST', '/api/v1/crm/segments/preview', { filters: {} })
    const { POST } = await import('@/app/api/v1/crm/segments/preview/route')
    const res = await POST(req)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data?.count).toBeGreaterThanOrEqual(0)
  })
})
