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

interface ActivityFixture {
  id: string
  orgId: string
  contactId: string
  type: string
  summary: string
  deleted?: boolean
}

function buildQueryChain(activities: ActivityFixture[]) {
  const docs = activities.map((a) => ({ id: a.id, data: () => a }))
  const chain: Record<string, jest.Mock> = {}
  chain.where = jest.fn().mockReturnValue(chain)
  chain.orderBy = jest.fn().mockReturnValue(chain)
  chain.limit = jest.fn().mockReturnValue(chain)
  chain.offset = jest.fn().mockReturnValue(chain)
  chain.get = jest.fn().mockResolvedValue({ docs, size: docs.length })
  return chain
}

function stageAuth(
  member: { uid: string; orgId: string; role: string; firstName?: string; lastName?: string },
  perms: Record<string, unknown> = {},
  opts?: { existingActivities?: ActivityFixture[] },
) {
  ;(adminAuth.verifySessionCookie as jest.Mock).mockResolvedValue({ uid: member.uid })
  const authCollections = makePortalAuthCollections(member, { permissions: perms })
  ;(adminDb.collection as jest.Mock).mockImplementation((name: string) => {
    if (name in authCollections) return authCollections[name as keyof typeof authCollections]
    if (name === 'users') return { doc: () => ({ get: () => Promise.resolve({ exists: true, data: () => ({ activeOrgId: member.orgId }) }) }) }
    if (name === 'orgMembers') return { doc: () => ({ get: () => Promise.resolve({ exists: true, data: () => member }) }) }
    if (name === 'organizations') return { doc: () => ({ get: () => Promise.resolve({ exists: true, data: () => ({ settings: { permissions: perms } }) }) }) }
    if (name === 'activities') return buildQueryChain(opts?.existingActivities ?? [])
    return { doc: () => ({ get: () => Promise.resolve({ exists: false }) }) }
  })
}

describe('GET /api/v1/crm/activities', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('returns 401 without auth', async () => {
    const req = new NextRequest('http://localhost/api/v1/crm/activities')
    const { GET } = await import('@/app/api/v1/crm/activities/route')
    const res = await GET(req)
    expect(res.status).toBe(401)
  })

  it('viewer can GET list (read-only)', async () => {
    const viewer = seedOrgMember('org-1', 'uid-1', { role: 'viewer' })
    stageAuth(viewer)
    const req = callAsMember(viewer, 'GET', '/api/v1/crm/activities?contactId=c1')
    const { GET } = await import('@/app/api/v1/crm/activities/route')
    const res = await GET(req)
    expect(res.status).toBe(200)
  })

  it('member can GET activities list', async () => {
    const member = seedOrgMember('org-1', 'uid-1', { role: 'member' })
    const acts: ActivityFixture[] = [
      { id: 'a1', orgId: 'org-1', contactId: 'c1', type: 'note', summary: 'note 1' },
      { id: 'a2', orgId: 'org-1', contactId: 'c1', type: 'email_sent', summary: 'email' },
    ]
    stageAuth(member, {}, { existingActivities: acts })
    const req = callAsMember(member, 'GET', '/api/v1/crm/activities?contactId=c1')
    const { GET } = await import('@/app/api/v1/crm/activities/route')
    const res = await GET(req)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(Array.isArray(body.data.activities)).toBe(true)
    expect(body.data.activities).toHaveLength(2)
  })

  it('agent Bearer GET returns 200', async () => {
    ;(adminDb.collection as jest.Mock).mockImplementation((name: string) => {
      if (name === 'organizations') {
        return {
          doc: () => ({
            get: () => Promise.resolve({ exists: true, data: () => ({ settings: { permissions: {} } }) }),
          }),
        }
      }
      if (name === 'activities') return buildQueryChain([])
      return { doc: () => ({ get: () => Promise.resolve({ exists: false }) }) }
    })
    const req = callAsAgent('org-agent', 'GET', '/api/v1/crm/activities', undefined, AI_API_KEY)
    const { GET } = await import('@/app/api/v1/crm/activities/route')
    const res = await GET(req)
    expect(res.status).toBe(200)
  })

  it('respects pagination params (limit, page)', async () => {
    const member = seedOrgMember('org-1', 'uid-1', { role: 'member' })
    stageAuth(member)
    const req = callAsMember(member, 'GET', '/api/v1/crm/activities?limit=25&page=3')
    const { GET } = await import('@/app/api/v1/crm/activities/route')
    const res = await GET(req)
    expect(res.status).toBe(200)
    // Verify pagination is reflected in response
    const body = await res.json()
    expect(body.data.limit).toBe(25)
    expect(body.data.page).toBe(3)
  })

  it('caps limit at 200', async () => {
    const member = seedOrgMember('org-1', 'uid-1', { role: 'member' })
    const chain = buildQueryChain([])
    ;(adminAuth.verifySessionCookie as jest.Mock).mockResolvedValue({ uid: member.uid })
    const authCollections = makePortalAuthCollections(member)
    ;(adminDb.collection as jest.Mock).mockImplementation((name: string) => {
      if (name in authCollections) return authCollections[name as keyof typeof authCollections]
      if (name === 'users') return { doc: () => ({ get: () => Promise.resolve({ exists: true, data: () => ({ activeOrgId: member.orgId }) }) }) }
      if (name === 'orgMembers') return { doc: () => ({ get: () => Promise.resolve({ exists: true, data: () => member }) }) }
      if (name === 'organizations') return { doc: () => ({ get: () => Promise.resolve({ exists: true, data: () => ({ settings: { permissions: {} } }) }) }) }
      if (name === 'activities') return chain
      return { doc: () => ({ get: () => Promise.resolve({ exists: false }) }) }
    })
    const req = callAsMember(member, 'GET', '/api/v1/crm/activities?limit=500')
    const { GET } = await import('@/app/api/v1/crm/activities/route')
    const res = await GET(req)
    expect(res.status).toBe(200)
    expect(chain.limit).toHaveBeenCalledWith(200)
  })

  it('filters by contactId when provided', async () => {
    const member = seedOrgMember('org-1', 'uid-1', { role: 'member' })
    const chain = buildQueryChain([])
    ;(adminAuth.verifySessionCookie as jest.Mock).mockResolvedValue({ uid: member.uid })
    const authCollections = makePortalAuthCollections(member)
    ;(adminDb.collection as jest.Mock).mockImplementation((name: string) => {
      if (name in authCollections) return authCollections[name as keyof typeof authCollections]
      if (name === 'users') return { doc: () => ({ get: () => Promise.resolve({ exists: true, data: () => ({ activeOrgId: member.orgId }) }) }) }
      if (name === 'orgMembers') return { doc: () => ({ get: () => Promise.resolve({ exists: true, data: () => member }) }) }
      if (name === 'organizations') return { doc: () => ({ get: () => Promise.resolve({ exists: true, data: () => ({ settings: { permissions: {} } }) }) }) }
      if (name === 'activities') return chain
      return { doc: () => ({ get: () => Promise.resolve({ exists: false }) }) }
    })
    const req = callAsMember(member, 'GET', '/api/v1/crm/activities?contactId=c99')
    const { GET } = await import('@/app/api/v1/crm/activities/route')
    const res = await GET(req)
    expect(res.status).toBe(200)
    expect(chain.where).toHaveBeenCalledWith('contactId', '==', 'c99')
  })

  it('rejects an inaccessible orgId query param before listing activities', async () => {
    const member = seedOrgMember('org-1', 'uid-1', { role: 'member' })
    const chain = buildQueryChain([])
    ;(adminAuth.verifySessionCookie as jest.Mock).mockResolvedValue({ uid: member.uid })
    const authCollections = makePortalAuthCollections(member)
    ;(adminDb.collection as jest.Mock).mockImplementation((name: string) => {
      if (name in authCollections) return authCollections[name as keyof typeof authCollections]
      if (name === 'users') return { doc: () => ({ get: () => Promise.resolve({ exists: true, data: () => ({ activeOrgId: member.orgId }) }) }) }
      if (name === 'orgMembers') return { doc: () => ({ get: () => Promise.resolve({ exists: true, data: () => member }) }) }
      if (name === 'organizations') return { doc: () => ({ get: () => Promise.resolve({ exists: true, data: () => ({ settings: { permissions: {} } }) }) }) }
      if (name === 'activities') return chain
      return { doc: () => ({ get: () => Promise.resolve({ exists: false }) }) }
    })
    // Pass a different orgId in query param — the auth layer must reject it before the route queries activities.
    const req = callAsMember(member, 'GET', '/api/v1/crm/activities?orgId=org-EVIL')
    const { GET } = await import('@/app/api/v1/crm/activities/route')
    const res = await GET(req)
    expect(res.status).toBe(403)
    expect(chain.where).not.toHaveBeenCalledWith('orgId', '==', 'org-EVIL')
  })
})
