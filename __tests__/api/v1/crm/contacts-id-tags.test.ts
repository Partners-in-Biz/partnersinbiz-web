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
    capturedUpdate?: jest.Mock
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
      const updateFn = opts?.capturedUpdate ?? jest.fn().mockResolvedValue(undefined)
      return {
        doc: jest.fn().mockReturnValue({
          id: opts?.contact?.id ?? 'a1',
          get: jest.fn().mockResolvedValue({
            exists: opts?.contact != null,
            id: opts?.contact?.id ?? 'a1',
            data: () => opts?.contact?.data ?? {},
          }),
          update: updateFn,
        }),
      }
    }
    return { doc: () => ({ get: () => Promise.resolve({ exists: false }) }) }
  })
}

const routeCtx = (id: string) => ({ params: Promise.resolve({ id }) })

describe('POST /api/v1/crm/contacts/[id]/tags', () => {
  it('member can add tags to a contact in own org', async () => {
    const member = seedOrgMember('org-1', 'uid-1', { role: 'member', firstName: 'Alice', lastName: 'B' })
    const captured = jest.fn().mockResolvedValue(undefined)
    stageAuth(member, { contact: { id: 'a1', data: { orgId: 'org-1', tags: ['x'] } }, capturedUpdate: captured })
    const req = callAsMember(member, 'POST', '/api/v1/crm/contacts/a1/tags', { add: ['y', 'z'] })
    const { POST } = await import('@/app/api/v1/crm/contacts/[id]/tags/route')
    const res = await POST(req, routeCtx('a1'))
    expect(res.status).toBeLessThan(300)
    const patch = captured.mock.calls[0][0]
    expect(patch.tags).toBeDefined()
    expect(patch.updatedByRef.displayName).toBe('Alice B')
    expect(patch.updatedByRef.kind).toBe('human')
  })

  it('member cannot add tags to a contact in a different org (404)', async () => {
    const member = seedOrgMember('org-1', 'uid-1', { role: 'member' })
    stageAuth(member, { contact: { id: 'b1', data: { orgId: 'org-2' } } })
    const req = callAsMember(member, 'POST', '/api/v1/crm/contacts/b1/tags', { add: ['x'] })
    const { POST } = await import('@/app/api/v1/crm/contacts/[id]/tags/route')
    const res = await POST(req, routeCtx('b1'))
    expect(res.status).toBe(404)
  })

  it('agent (Bearer) can add tags with agent attribution', async () => {
    const member = seedOrgMember('org-1', 'uid-1', { role: 'member' })
    const captured = jest.fn().mockResolvedValue(undefined)
    stageAuth(member, { contact: { id: 'a1', data: { orgId: 'org-1', tags: [] } }, capturedUpdate: captured })
    const req = callAsAgent('org-1', 'POST', '/api/v1/crm/contacts/a1/tags', { add: ['x'] })
    const { POST } = await import('@/app/api/v1/crm/contacts/[id]/tags/route')
    const res = await POST(req, routeCtx('a1'))
    expect(res.status).toBeLessThan(300)
    const patch = captured.mock.calls[0][0]
    expect(patch.updatedByRef.uid).toBe('agent:pip')
    expect(patch.updatedByRef.kind).toBe('agent')
    expect(patch.updatedBy).toBeUndefined()  // agent omits updatedBy uid
  })

  it('viewer cannot add tags (403)', async () => {
    const viewer = seedOrgMember('org-1', 'uid-1', { role: 'viewer' })
    stageAuth(viewer, { contact: { id: 'a1', data: { orgId: 'org-1' } } })
    const req = callAsMember(viewer, 'POST', '/api/v1/crm/contacts/a1/tags', { add: ['x'] })
    const { POST } = await import('@/app/api/v1/crm/contacts/[id]/tags/route')
    const res = await POST(req, routeCtx('a1'))
    expect(res.status).toBe(403)
  })
})
