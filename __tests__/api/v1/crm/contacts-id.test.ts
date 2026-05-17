import { NextRequest } from 'next/server'

jest.mock('@/lib/firebase/admin', () => ({
  adminAuth: { verifySessionCookie: jest.fn() },
  adminDb: { collection: jest.fn() },
}))

import { adminAuth, adminDb } from '@/lib/firebase/admin'
import { seedOrgMember, callAsMember, callAsAgent } from '../../../helpers/crm'

const AI_API_KEY = 'test-ai-key-abc'
process.env.AI_API_KEY = AI_API_KEY
process.env.SESSION_COOKIE_NAME = '__session'

// Suppress logActivity and dispatchWebhook noise in tests
jest.mock('@/lib/activity/log', () => ({ logActivity: jest.fn().mockResolvedValue(undefined) }))
jest.mock('@/lib/webhooks/dispatch', () => ({ dispatchWebhook: jest.fn().mockResolvedValue(undefined) }))

// Mock loadCompany for companyId tests
jest.mock('@/lib/companies/store', () => ({
  loadCompany: jest.fn(),
}))
import { loadCompany } from '@/lib/companies/store'

function stageAuth(
  member: { uid: string; orgId: string; role: string; firstName?: string; lastName?: string },
  perms: Record<string, unknown> = {},
  opts?: {
    contact?: { id: string; data: Record<string, unknown> } | null
    capturedUpdate?: jest.Mock
    capturedDelete?: jest.Mock
  },
) {
  ;(adminAuth.verifySessionCookie as jest.Mock).mockResolvedValue({ uid: member.uid })
  ;(adminDb.collection as jest.Mock).mockImplementation((name: string) => {
    if (name === 'users') {
      return {
        doc: () => ({
          get: () =>
            Promise.resolve({
              exists: true,
              data: () => ({ activeOrgId: member.orgId }),
            }),
        }),
      }
    }
    if (name === 'orgMembers') {
      return {
        doc: () => ({
          get: () =>
            Promise.resolve({
              exists: true,
              data: () => member,
            }),
        }),
      }
    }
    if (name === 'organizations') {
      return {
        doc: () => ({
          get: () =>
            Promise.resolve({
              exists: true,
              data: () => ({ settings: { permissions: perms } }),
            }),
        }),
      }
    }
    if (name === 'contacts') {
      const updateFn = opts?.capturedUpdate ?? jest.fn().mockResolvedValue(undefined)
      const deleteFn = opts?.capturedDelete ?? jest.fn().mockResolvedValue(undefined)
      return {
        doc: jest.fn().mockReturnValue({
          id: opts?.contact?.id ?? 'a1',
          get: jest.fn().mockResolvedValue({
            exists: opts?.contact != null,
            id: opts?.contact?.id ?? 'a1',
            data: () => opts?.contact?.data ?? {},
          }),
          update: updateFn,
          delete: deleteFn,
          set: jest.fn().mockResolvedValue(undefined),
        }),
      }
    }
    return { doc: () => ({ get: () => Promise.resolve({ exists: false }) }) }
  })
}

// ---------------------------------------------------------------------------
// GET /api/v1/crm/contacts/:id
// ---------------------------------------------------------------------------

describe('GET /api/v1/crm/contacts/:id', () => {

  it('returns contact when found', async () => {
    const member = seedOrgMember('org-test', 'uid-viewer', { role: 'viewer' })
    stageAuth(member, {}, {
      contact: { id: 'a1', data: { orgId: 'org-test', name: 'John', email: 'john@test.com', deleted: false } },
    })
    const req = callAsMember(member, 'GET', '/api/v1/crm/contacts/a1')
    const { GET } = await import('@/app/api/v1/crm/contacts/[id]/route')
    const res = await GET(req, { params: Promise.resolve({ id: 'a1' }) })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data.contact.name).toBe('John')
  })

  it('returns 404 when not found', async () => {
    const member = seedOrgMember('org-test', 'uid-viewer', { role: 'viewer' })
    stageAuth(member, {}, { contact: null })
    const req = callAsMember(member, 'GET', '/api/v1/crm/contacts/a1')
    const { GET } = await import('@/app/api/v1/crm/contacts/[id]/route')
    const res = await GET(req, { params: Promise.resolve({ id: 'a1' }) })
    expect(res.status).toBe(404)
  })
})

// ---------------------------------------------------------------------------
// PUT /api/v1/crm/contacts/:id
// ---------------------------------------------------------------------------

describe('PUT /api/v1/crm/contacts/:id', () => {

  it('updates contact and returns 200', async () => {
    const member = seedOrgMember('org-test', 'uid-member', { role: 'member' })
    const captured = jest.fn().mockResolvedValue(undefined)
    stageAuth(member, {}, {
      contact: { id: 'a1', data: { orgId: 'org-test', name: 'John', email: 'john@test.com' } },
      capturedUpdate: captured,
    })
    const req = callAsMember(member, 'PUT', '/api/v1/crm/contacts/a1', { name: 'John Updated', stage: 'contacted' })
    const { PUT } = await import('@/app/api/v1/crm/contacts/[id]/route')
    const res = await PUT(req, { params: Promise.resolve({ id: 'a1' }) })
    expect(res.status).toBe(200)
    expect(captured).toHaveBeenCalled()
  })

  it('returns 404 when contact does not exist', async () => {
    const member = seedOrgMember('org-test', 'uid-member', { role: 'member' })
    stageAuth(member, {}, { contact: null })
    const req = callAsMember(member, 'PUT', '/api/v1/crm/contacts/a1', { name: 'X' })
    const { PUT } = await import('@/app/api/v1/crm/contacts/[id]/route')
    const res = await PUT(req, { params: Promise.resolve({ id: 'a1' }) })
    expect(res.status).toBe(404)
  })
})

// ---------------------------------------------------------------------------
// DELETE /api/v1/crm/contacts/:id
// ---------------------------------------------------------------------------

describe('DELETE /api/v1/crm/contacts/:id', () => {

  it('soft-deletes contact and returns 200', async () => {
    const member = seedOrgMember('org-test', 'uid-member', { role: 'member' })
    const captured = jest.fn().mockResolvedValue(undefined)
    stageAuth(member, { membersCanDeleteContacts: true }, {
      contact: { id: 'a1', data: { orgId: 'org-test', name: 'John', deleted: false } },
      capturedUpdate: captured,
    })
    const req = callAsMember(member, 'DELETE', '/api/v1/crm/contacts/a1')
    const { DELETE } = await import('@/app/api/v1/crm/contacts/[id]/route')
    const res = await DELETE(req, { params: Promise.resolve({ id: 'a1' }) })
    expect(res.status).toBe(200)
    expect(captured).toHaveBeenCalledWith(expect.objectContaining({ deleted: true }))
  })
})

// ---------------------------------------------------------------------------
// GET /api/v1/crm/contacts/:id/activities
// ---------------------------------------------------------------------------

describe('GET /api/v1/crm/contacts/:id/activities', () => {

  it('returns activities for a contact', async () => {
    // activities route now uses withCrmAuth('viewer') — AI_API_KEY Bearer satisfies it
    // Contacts collection needed for tenant-isolation preflight check
    ;(adminDb.collection as jest.Mock).mockImplementation((name: string) => {
      if (name === 'users') {
        return {
          doc: () => ({
            get: () => Promise.resolve({ exists: true, data: () => ({ activeOrgId: 'org-test' }) }),
          }),
        }
      }
      if (name === 'orgMembers') {
        return {
          doc: () => ({
            get: () => Promise.resolve({ exists: true, data: () => ({ uid: 'uid-agent', orgId: 'org-test', role: 'member' }) }),
          }),
        }
      }
      if (name === 'organizations') {
        return {
          doc: () => ({
            get: () => Promise.resolve({ exists: true, data: () => ({ settings: { permissions: {} } }) }),
          }),
        }
      }
      if (name === 'contacts') {
        return {
          doc: jest.fn().mockReturnValue({
            id: 'a1',
            get: jest.fn().mockResolvedValue({
              exists: true,
              id: 'a1',
              data: () => ({ orgId: 'org-test' }),
            }),
          }),
        }
      }
      if (name === 'activities') {
        return {
          where: jest.fn().mockReturnThis(),
          orderBy: jest.fn().mockReturnThis(),
          get: jest.fn().mockResolvedValue({
            docs: [{ id: 'act1', data: () => ({ type: 'note', summary: 'Called' }) }],
          }),
        }
      }
      return { doc: () => ({ get: () => Promise.resolve({ exists: false }) }) }
    })

    const req = callAsAgent('org-test', 'GET', '/api/v1/crm/contacts/a1/activities', undefined, AI_API_KEY)
    const { GET: GET_ACTIVITIES } = await import('@/app/api/v1/crm/contacts/[id]/activities/route')
    const res = await GET_ACTIVITIES(req, { params: Promise.resolve({ id: 'a1' }) })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(Array.isArray(body.data)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// New tests: Attribution & DELETE toggle
// ---------------------------------------------------------------------------

describe('PATCH attribution & DELETE toggle', () => {

  it('writes updatedByRef on PATCH', async () => {
    const member = seedOrgMember('org-1', 'uid-1', { role: 'member', firstName: 'Alice', lastName: 'B' })
    const captured = jest.fn().mockResolvedValue(undefined)
    stageAuth(member, {}, {
      contact: { id: 'a1', data: { orgId: 'org-1', name: 'Old', email: 'a@y.com' } },
      capturedUpdate: captured,
    })
    const req = callAsMember(member, 'PATCH', '/api/v1/crm/contacts/a1', { name: 'New' })
    const { PATCH } = await import('@/app/api/v1/crm/contacts/[id]/route')
    const res = await PATCH(req, { params: Promise.resolve({ id: 'a1' }) })
    expect(res.status).toBeLessThan(300)
    const patch = captured.mock.calls[0][0]
    expect(patch.updatedByRef.displayName).toBe('Alice B')
    expect(patch.updatedByRef.kind).toBe('human')
  })

  it('writes assignedToRef when assignedTo changes', async () => {
    const member = seedOrgMember('org-1', 'uid-1', { role: 'member', firstName: 'Alice', lastName: 'B' })
    const captured = jest.fn().mockResolvedValue(undefined)
    ;(adminAuth.verifySessionCookie as jest.Mock).mockResolvedValue({ uid: member.uid })
    ;(adminDb.collection as jest.Mock).mockImplementation((name: string) => {
      if (name === 'users') {
        return {
          doc: () => ({
            get: () =>
              Promise.resolve({
                exists: true,
                data: () => ({ activeOrgId: 'org-1' }),
              }),
          }),
        }
      }
      if (name === 'orgMembers') {
        return {
          doc: jest.fn().mockImplementation((id: string) => ({
            get: () =>
              Promise.resolve(
                id === 'org-1_uid-1'
                  ? { exists: true, data: () => member }
                  : id === 'org-1_uid-2'
                    ? { exists: true, data: () => ({ uid: 'uid-2', firstName: 'Bob', lastName: 'C' }) }
                    : { exists: false },
              ),
          })),
        }
      }
      if (name === 'organizations') {
        return {
          doc: () => ({
            get: () =>
              Promise.resolve({ exists: true, data: () => ({ settings: { permissions: {} } }) }),
          }),
        }
      }
      if (name === 'contacts') {
        return {
          doc: jest.fn().mockReturnValue({
            id: 'a1',
            get: jest.fn().mockResolvedValue({
              exists: true,
              id: 'a1',
              data: () => ({ orgId: 'org-1', name: 'X', email: 'a@y.com' }),
            }),
            update: captured,
          }),
        }
      }
      return { doc: () => ({ get: () => Promise.resolve({ exists: false }) }) }
    })

    const req = callAsMember(member, 'PATCH', '/api/v1/crm/contacts/a1', { assignedTo: 'uid-2' })
    const { PATCH } = await import('@/app/api/v1/crm/contacts/[id]/route')
    const res = await PATCH(req, { params: Promise.resolve({ id: 'a1' }) })
    expect(res.status).toBeLessThan(300)
    const patch = captured.mock.calls[0][0]
    expect(patch.assignedTo).toBe('uid-2')
    expect(patch.assignedToRef.displayName).toBe('Bob C')
  })

  it('blocks DELETE for member when membersCanDeleteContacts is false', async () => {
    const member = seedOrgMember('org-1', 'uid-1', { role: 'member' })
    stageAuth(member, { membersCanDeleteContacts: false }, {
      contact: { id: 'a1', data: { orgId: 'org-1' } },
    })
    const req = callAsMember(member, 'DELETE', '/api/v1/crm/contacts/a1')
    const { DELETE } = await import('@/app/api/v1/crm/contacts/[id]/route')
    const res = await DELETE(req, { params: Promise.resolve({ id: 'a1' }) })
    expect(res.status).toBe(403)
  })

  it('allows DELETE for member when membersCanDeleteContacts is true', async () => {
    const member = seedOrgMember('org-1', 'uid-1', { role: 'member' })
    stageAuth(member, { membersCanDeleteContacts: true }, {
      contact: { id: 'a1', data: { orgId: 'org-1' } },
    })
    const req = callAsMember(member, 'DELETE', '/api/v1/crm/contacts/a1')
    const { DELETE } = await import('@/app/api/v1/crm/contacts/[id]/route')
    const res = await DELETE(req, { params: Promise.resolve({ id: 'a1' }) })
    expect(res.status).toBeLessThan(300)
  })

  it('allows DELETE for admin regardless of toggle', async () => {
    const admin = seedOrgMember('org-1', 'uid-admin', { role: 'admin' })
    stageAuth(admin, { membersCanDeleteContacts: false }, {
      contact: { id: 'a1', data: { orgId: 'org-1' } },
    })
    const req = callAsMember(admin, 'DELETE', '/api/v1/crm/contacts/a1')
    const { DELETE } = await import('@/app/api/v1/crm/contacts/[id]/route')
    const res = await DELETE(req, { params: Promise.resolve({ id: 'a1' }) })
    expect(res.status).toBeLessThan(300)
  })
})

// ---------------------------------------------------------------------------
// PATCH /api/v1/crm/contacts/:id — companyId wiring tests
// ---------------------------------------------------------------------------

describe('PATCH companyId behavior', () => {
  beforeEach(() => {
    ;(loadCompany as jest.Mock).mockReset()
  })

  it('writes companyId + companyName via lookup on PATCH', async () => {
    const member = seedOrgMember('org-co', 'uid-co-patch', { role: 'member' })
    const captured = jest.fn().mockResolvedValue(undefined)
    stageAuth(member, {}, {
      contact: { id: 'c1', data: { orgId: 'org-co', name: 'Existing Contact' } },
      capturedUpdate: captured,
    })
    ;(loadCompany as jest.Mock).mockResolvedValue({ data: { name: 'Globex Inc' } })

    const req = callAsMember(member, 'PATCH', '/api/v1/crm/contacts/c1', {
      companyId: 'co-globex-1',
    })
    const { PATCH } = await import('@/app/api/v1/crm/contacts/[id]/route')
    const res = await PATCH(req, { params: Promise.resolve({ id: 'c1' }) })
    expect(res.status).toBeLessThan(300)
    const patch = captured.mock.calls[0][0]
    expect(patch.companyId).toBe('co-globex-1')
    expect(patch.companyName).toBe('Globex Inc')
    expect(loadCompany).toHaveBeenCalledWith('co-globex-1', 'org-co')
  })

  it("clears companyId + companyName when body has companyId: ''", async () => {
    const member = seedOrgMember('org-co', 'uid-co-clear', { role: 'member' })
    const captured = jest.fn().mockResolvedValue(undefined)
    stageAuth(member, {}, {
      contact: { id: 'c2', data: { orgId: 'org-co', name: 'Had Company', companyId: 'co-old', companyName: 'Old Corp' } },
      capturedUpdate: captured,
    })

    const req = callAsMember(member, 'PATCH', '/api/v1/crm/contacts/c2', {
      companyId: '',
    })
    const { PATCH } = await import('@/app/api/v1/crm/contacts/[id]/route')
    const res = await PATCH(req, { params: Promise.resolve({ id: 'c2' }) })
    expect(res.status).toBeLessThan(300)
    const patch = captured.mock.calls[0][0]
    // Both fields should be FieldValue.delete() — check they are not plain strings
    expect(typeof patch.companyId).not.toBe('string')
    expect(typeof patch.companyName).not.toBe('string')
    // loadCompany should NOT be called for a clear operation
    expect(loadCompany).not.toHaveBeenCalled()
  })

  it('does NOT overwrite orgId when body injects { orgId: "org-other" }', async () => {
    // Regression: body spread previously allowed `{ orgId }` to corrupt the
    // tenant-scoped document. sanitizeContactForWrite must strip it.
    const member = seedOrgMember('org-co', 'uid-co-inject', { role: 'member' })
    const captured = jest.fn().mockResolvedValue(undefined)
    stageAuth(member, {}, {
      contact: { id: 'c4', data: { orgId: 'org-co', name: 'Victim' } },
      capturedUpdate: captured,
    })
    const req = callAsMember(member, 'PATCH', '/api/v1/crm/contacts/c4', {
      orgId: 'org-other',
      firstName: 'Hacked',
    })
    const { PATCH } = await import('@/app/api/v1/crm/contacts/[id]/route')
    const res = await PATCH(req, { params: Promise.resolve({ id: 'c4' }) })
    expect(res.status).toBeLessThan(300)
    const patch = captured.mock.calls[0][0]
    expect(patch.orgId).toBeUndefined()
    expect(patch.firstName).toBe('Hacked')
  })

  it('returns 400 when PATCH provides non-existent cross-tenant companyId', async () => {
    const member = seedOrgMember('org-co', 'uid-co-bad', { role: 'member' })
    stageAuth(member, {}, {
      contact: { id: 'c3', data: { orgId: 'org-co', name: 'Contact C3' } },
    })
    ;(loadCompany as jest.Mock).mockResolvedValue(null)

    const req = callAsMember(member, 'PATCH', '/api/v1/crm/contacts/c3', {
      companyId: 'co-from-other-org',
    })
    const { PATCH } = await import('@/app/api/v1/crm/contacts/[id]/route')
    const res = await PATCH(req, { params: Promise.resolve({ id: 'c3' }) })
    expect(res.status).toBe(400)
  })
})
