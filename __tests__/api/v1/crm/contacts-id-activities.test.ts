import { NextRequest } from 'next/server'

jest.mock('@/lib/firebase/admin', () => ({
  adminAuth: { verifySessionCookie: jest.fn() },
  adminDb: { collection: jest.fn() },
}))

import { adminAuth, adminDb } from '@/lib/firebase/admin'
import { seedOrgMember, callAsMember, callAsAgent } from '../../../helpers/crm'
import { makePortalAuthCollections } from '../../../helpers/firebase-admin'

const AI_API_KEY = 'test-ai-key-abc'
process.env.AI_API_KEY = AI_API_KEY
process.env.SESSION_COOKIE_NAME = '__session'

function stageAuth(
  member: { uid: string; orgId: string; role: string; firstName?: string; lastName?: string },
  opts?: {
    contact?: { id: string; data: Record<string, unknown> } | null
    activities?: Array<{ id: string; data: Record<string, unknown> }>
  },
) {
  ;(adminAuth.verifySessionCookie as jest.Mock).mockResolvedValue({ uid: member.uid })
  const authCollections = makePortalAuthCollections(member)
  ;(adminDb.collection as jest.Mock).mockImplementation((name: string) => {
    if (name in authCollections) return authCollections[name as keyof typeof authCollections]
    if (name === 'users') return { doc: () => ({ get: () => Promise.resolve({ exists: true, data: () => ({ activeOrgId: member.orgId }) }) }) }
    if (name === 'orgMembers') return { doc: () => ({ get: () => Promise.resolve({ exists: true, data: () => member }) }) }
    if (name === 'organizations') return { doc: () => ({ get: () => Promise.resolve({ exists: true, data: () => ({ settings: { permissions: {} } }) }) }) }
    if (name === 'contacts') {
      return {
        doc: jest.fn().mockReturnValue({
          id: opts?.contact?.id ?? 'a1',
          get: jest.fn().mockResolvedValue({
            exists: opts?.contact != null,
            id: opts?.contact?.id ?? 'a1',
            data: () => opts?.contact?.data ?? {},
          }),
        }),
      }
    }
    if (name === 'activities') {
      const docs = (opts?.activities ?? []).map(a => ({ id: a.id, data: () => a.data }))
      return {
        where: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        get: jest.fn().mockResolvedValue({ docs, size: docs.length }),
      }
    }
    return { doc: () => ({ get: () => Promise.resolve({ exists: false }) }) }
  })
}

const routeCtx = (id: string) => ({ params: Promise.resolve({ id }) })

describe('GET /api/v1/crm/contacts/[id]/activities', () => {
  it('viewer can read activities for a contact in own org', async () => {
    const viewer = seedOrgMember('org-1', 'uid-1', { role: 'viewer' })
    stageAuth(viewer, {
      contact: { id: 'a1', data: { orgId: 'org-1' } },
      activities: [
        { id: 'act-1', data: { orgId: 'org-1', contactId: 'a1', type: 'note', body: 'Hello' } },
        { id: 'act-2', data: { orgId: 'org-1', contactId: 'a1', type: 'call' } },
      ],
    })
    const req = callAsMember(viewer, 'GET', '/api/v1/crm/contacts/a1/activities')
    const { GET } = await import('@/app/api/v1/crm/contacts/[id]/activities/route')
    const res = await GET(req, routeCtx('a1'))
    expect(res.status).toBe(200)
    const body = await res.json()
    // Route preserves existing array envelope: body.data is the activities array
    expect(Array.isArray(body.data)).toBe(true)
    expect(body.data).toHaveLength(2)
  })

  it('viewer cannot read activities for a contact in another org (404)', async () => {
    const viewer = seedOrgMember('org-1', 'uid-1', { role: 'viewer' })
    stageAuth(viewer, {
      contact: { id: 'b1', data: { orgId: 'org-2' } },
      activities: [],
    })
    const req = callAsMember(viewer, 'GET', '/api/v1/crm/contacts/b1/activities')
    const { GET } = await import('@/app/api/v1/crm/contacts/[id]/activities/route')
    const res = await GET(req, routeCtx('b1'))
    expect(res.status).toBe(404)
  })

  it('agent (Bearer) can read activities', async () => {
    const member = seedOrgMember('org-1', 'uid-1', { role: 'member' })
    stageAuth(member, {
      contact: { id: 'a1', data: { orgId: 'org-1' } },
      activities: [{ id: 'act-1', data: { orgId: 'org-1', contactId: 'a1' } }],
    })
    const req = callAsAgent('org-1', 'GET', '/api/v1/crm/contacts/a1/activities')
    const { GET } = await import('@/app/api/v1/crm/contacts/[id]/activities/route')
    const res = await GET(req, routeCtx('a1'))
    expect(res.status).toBe(200)
  })

  it('returns empty list when contact has no activities (not an error)', async () => {
    const viewer = seedOrgMember('org-1', 'uid-1', { role: 'viewer' })
    stageAuth(viewer, {
      contact: { id: 'a1', data: { orgId: 'org-1' } },
      activities: [],
    })
    const req = callAsMember(viewer, 'GET', '/api/v1/crm/contacts/a1/activities')
    const { GET } = await import('@/app/api/v1/crm/contacts/[id]/activities/route')
    const res = await GET(req, routeCtx('a1'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(Array.isArray(body.data)).toBe(true)
    expect(body.data).toEqual([])
  })
})
