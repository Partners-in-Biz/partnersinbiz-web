import { NextRequest } from 'next/server'

jest.mock('@/lib/firebase/admin', () => ({
  adminAuth: { verifySessionCookie: jest.fn() },
  adminDb: { collection: jest.fn() },
}))

import { adminAuth, adminDb } from '@/lib/firebase/admin'
import { seedOrgMember, callAsMember, callAsAgent } from '../../../helpers/crm'
import { makePortalAuthCollections } from '../../../helpers/firebase-admin'

const AI_API_KEY = 'test-ai-key'
process.env.AI_API_KEY = AI_API_KEY
process.env.SESSION_COOKIE_NAME = '__session'

const routeCtx = (id: string) => ({ params: Promise.resolve({ id }) })

function stageAuth(
  member: { uid: string; orgId: string; role: string; firstName?: string; lastName?: string },
  opts?: {
    existingForm?: { id: string; data: Record<string, unknown> } | null
    capturedUpdate?: jest.Mock
    capturedDelete?: jest.Mock
    submissionsExist?: boolean
    slugConflict?: boolean
  },
) {
  ;(adminAuth.verifySessionCookie as jest.Mock).mockResolvedValue({ uid: member.uid })
  const authCollections = makePortalAuthCollections(member)
  ;(adminDb.collection as jest.Mock).mockImplementation((name: string) => {
    if (name in authCollections) return authCollections[name as keyof typeof authCollections]
    if (name === 'form_submissions') {
      const hasSubs = opts?.submissionsExist ?? false
      return {
        where: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        get: jest.fn().mockResolvedValue({ empty: !hasSubs, docs: hasSubs ? [{ id: 'sub-1' }] : [] }),
      }
    }
    if (name === 'forms') {
      const updateFn = opts?.capturedUpdate ?? jest.fn().mockResolvedValue(undefined)
      const deleteFn = opts?.capturedDelete ?? jest.fn().mockResolvedValue(undefined)
      // For slug uniqueness checks, return a conflict doc if requested
      const slugConflictDocs = opts?.slugConflict
        ? [{ id: 'other-form', data: () => ({ deleted: false }) }]
        : []
      return {
        doc: jest.fn().mockImplementation((id?: string) => {
          const formExists =
            opts?.existingForm != null &&
            (id === opts.existingForm?.id || id === undefined)
          return {
            id: id ?? 'auto-form',
            get: () =>
              Promise.resolve({
                exists: formExists,
                id: opts?.existingForm?.id ?? id ?? 'auto-form',
                data: () => opts?.existingForm?.data,
              }),
            update: updateFn,
            delete: deleteFn,
          }
        }),
        where: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        get: jest.fn().mockResolvedValue({
          docs: slugConflictDocs,
          empty: slugConflictDocs.length === 0,
        }),
      }
    }
    return { doc: () => ({ get: () => Promise.resolve({ exists: false }) }) }
  })
}

// ---------------------------------------------------------------------------
// GET /api/v1/forms/[id]
// ---------------------------------------------------------------------------

describe('GET /api/v1/forms/[id]', () => {
  beforeEach(() => jest.clearAllMocks())

  it('viewer GET own org → 200', async () => {
    const viewer = seedOrgMember('org-1', 'uid-v', { role: 'viewer' })
    stageAuth(viewer, {
      existingForm: { id: 'form-1', data: { orgId: 'org-1', name: 'Form A', deleted: false } },
    })
    const req = callAsMember(viewer, 'GET', '/api/v1/forms/form-1')
    const { GET } = await import('@/app/api/v1/forms/[id]/route')
    const res = await GET(req, routeCtx('form-1'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
  })

  it('GET cross-org → 404', async () => {
    const viewer = seedOrgMember('org-1', 'uid-v', { role: 'viewer' })
    stageAuth(viewer, {
      existingForm: { id: 'form-x', data: { orgId: 'org-2', name: 'Other', deleted: false } },
    })
    const req = callAsMember(viewer, 'GET', '/api/v1/forms/form-x')
    const { GET } = await import('@/app/api/v1/forms/[id]/route')
    const res = await GET(req, routeCtx('form-x'))
    expect(res.status).toBe(404)
  })

  it('GET soft-deleted → 404', async () => {
    const viewer = seedOrgMember('org-1', 'uid-v', { role: 'viewer' })
    stageAuth(viewer, {
      existingForm: { id: 'form-del', data: { orgId: 'org-1', name: 'Gone', deleted: true } },
    })
    const req = callAsMember(viewer, 'GET', '/api/v1/forms/form-del')
    const { GET } = await import('@/app/api/v1/forms/[id]/route')
    const res = await GET(req, routeCtx('form-del'))
    expect(res.status).toBe(404)
  })
})

// ---------------------------------------------------------------------------
// PUT /api/v1/forms/[id]
// ---------------------------------------------------------------------------

describe('PUT /api/v1/forms/[id]', () => {
  beforeEach(() => jest.clearAllMocks())

  it('admin PUT updates name/title + writes updatedByRef', async () => {
    const admin = seedOrgMember('org-1', 'uid-a', { role: 'admin', firstName: 'Ada', lastName: 'Min' })
    const captured = jest.fn().mockResolvedValue(undefined)
    stageAuth(admin, {
      existingForm: {
        id: 'form-1',
        data: { orgId: 'org-1', name: 'Old', slug: 'old-slug', deleted: false },
      },
      capturedUpdate: captured,
    })
    const req = callAsMember(admin, 'PUT', '/api/v1/forms/form-1', {
      name: 'New Name',
      title: 'New Title',
    })
    const { PUT } = await import('@/app/api/v1/forms/[id]/route')
    const res = await PUT(req, routeCtx('form-1'))
    expect(res.status).toBeLessThan(300)
    const patch = captured.mock.calls[0][0]
    expect(patch.name).toBe('New Name')
    expect(patch.title).toBe('New Title')
    expect(patch.updatedByRef).toBeDefined()
    expect(patch.updatedByRef.displayName).toBe('Ada Min')
  })

  it('admin PUT empty body → 400', async () => {
    const admin = seedOrgMember('org-1', 'uid-a', { role: 'admin' })
    stageAuth(admin, {
      existingForm: {
        id: 'form-1',
        data: { orgId: 'org-1', name: 'Form', slug: 'form', deleted: false },
      },
    })
    const req = callAsMember(admin, 'PUT', '/api/v1/forms/form-1', {})
    const { PUT } = await import('@/app/api/v1/forms/[id]/route')
    const res = await PUT(req, routeCtx('form-1'))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/no editable fields/i)
  })

  it('admin PUT slug change BLOCKED when submissions exist → 409', async () => {
    const admin = seedOrgMember('org-1', 'uid-a', { role: 'admin' })
    stageAuth(admin, {
      existingForm: {
        id: 'form-1',
        data: { orgId: 'org-1', name: 'Form', slug: 'old-slug', deleted: false },
      },
      submissionsExist: true,
    })
    const req = callAsMember(admin, 'PUT', '/api/v1/forms/form-1', { slug: 'new-slug' })
    const { PUT } = await import('@/app/api/v1/forms/[id]/route')
    const res = await PUT(req, routeCtx('form-1'))
    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.error).toMatch(/cannot change slug/i)
  })

  it('admin PUT slug change OK when no submissions', async () => {
    const admin = seedOrgMember('org-1', 'uid-a', { role: 'admin' })
    const captured = jest.fn().mockResolvedValue(undefined)
    stageAuth(admin, {
      existingForm: {
        id: 'form-1',
        data: { orgId: 'org-1', name: 'Form', slug: 'old-slug', deleted: false },
      },
      capturedUpdate: captured,
      submissionsExist: false,
      slugConflict: false,
    })
    const req = callAsMember(admin, 'PUT', '/api/v1/forms/form-1', { slug: 'new-slug' })
    const { PUT } = await import('@/app/api/v1/forms/[id]/route')
    const res = await PUT(req, routeCtx('form-1'))
    expect(res.status).toBeLessThan(300)
    const patch = captured.mock.calls[0][0]
    expect(patch.slug).toBe('new-slug')
  })

  it('agent PUT uses AGENT_PIP_REF in updatedByRef', async () => {
    ;(adminDb.collection as jest.Mock).mockImplementation((name: string) => {
      if (name === 'organizations')
        return {
          doc: () => ({
            get: () =>
              Promise.resolve({
                exists: true,
                data: () => ({ settings: { permissions: {} } }),
              }),
          }),
        }
      if (name === 'forms') {
        const updateFn = jest.fn().mockResolvedValue(undefined)
        return {
          doc: jest.fn().mockReturnValue({
            id: 'form-1',
            get: () =>
              Promise.resolve({
                exists: true,
                id: 'form-1',
                data: () => ({
                  orgId: 'org-agent',
                  name: 'Agent Form',
                  slug: 'agent-form',
                  deleted: false,
                }),
              }),
            update: updateFn,
          }),
          where: jest.fn().mockReturnThis(),
          limit: jest.fn().mockReturnThis(),
          get: jest.fn().mockResolvedValue({ docs: [], empty: true }),
          __capturedUpdate: updateFn,
        }
      }
      return { doc: () => ({ get: () => Promise.resolve({ exists: false }) }) }
    })
    const req = callAsAgent('org-agent', 'PUT', '/api/v1/forms/form-1', { name: 'Updated' }, AI_API_KEY)
    const { PUT } = await import('@/app/api/v1/forms/[id]/route')
    const res = await PUT(req, routeCtx('form-1'))
    expect(res.status).toBeLessThan(300)
  })

  it('viewer cannot PUT → 403', async () => {
    const viewer = seedOrgMember('org-1', 'uid-v', { role: 'viewer' })
    stageAuth(viewer, {
      existingForm: { id: 'form-1', data: { orgId: 'org-1', deleted: false } },
    })
    const req = callAsMember(viewer, 'PUT', '/api/v1/forms/form-1', { name: 'X' })
    const { PUT } = await import('@/app/api/v1/forms/[id]/route')
    const res = await PUT(req, routeCtx('form-1'))
    expect(res.status).toBe(403)
  })

  it('member cannot PUT → 403', async () => {
    const member = seedOrgMember('org-1', 'uid-1', { role: 'member' })
    stageAuth(member, {
      existingForm: { id: 'form-1', data: { orgId: 'org-1', deleted: false } },
    })
    const req = callAsMember(member, 'PUT', '/api/v1/forms/form-1', { name: 'X' })
    const { PUT } = await import('@/app/api/v1/forms/[id]/route')
    const res = await PUT(req, routeCtx('form-1'))
    expect(res.status).toBe(403)
  })

  it('cross-org PUT → 404', async () => {
    const admin = seedOrgMember('org-1', 'uid-a', { role: 'admin' })
    stageAuth(admin, {
      existingForm: { id: 'form-x', data: { orgId: 'org-2', deleted: false } },
    })
    const req = callAsMember(admin, 'PUT', '/api/v1/forms/form-x', { name: 'X' })
    const { PUT } = await import('@/app/api/v1/forms/[id]/route')
    const res = await PUT(req, routeCtx('form-x'))
    expect(res.status).toBe(404)
  })
})

// ---------------------------------------------------------------------------
// DELETE /api/v1/forms/[id]
// ---------------------------------------------------------------------------

describe('DELETE /api/v1/forms/[id]', () => {
  beforeEach(() => jest.clearAllMocks())

  it('admin DELETE default → soft-delete with updatedByRef', async () => {
    const admin = seedOrgMember('org-1', 'uid-a', { role: 'admin', firstName: 'Ada', lastName: 'Min' })
    const captured = jest.fn().mockResolvedValue(undefined)
    stageAuth(admin, {
      existingForm: {
        id: 'form-1',
        data: { orgId: 'org-1', name: 'Form A', deleted: false },
      },
      capturedUpdate: captured,
    })
    const req = callAsMember(admin, 'DELETE', '/api/v1/forms/form-1')
    const { DELETE } = await import('@/app/api/v1/forms/[id]/route')
    const res = await DELETE(req, routeCtx('form-1'))
    expect(res.status).toBeLessThan(300)
    const patch = captured.mock.calls[0][0]
    expect(patch.deleted).toBe(true)
    expect(patch.active).toBe(false)
    expect(patch.updatedByRef).toBeDefined()
    expect(patch.updatedByRef.displayName).toBe('Ada Min')
  })

  it('admin DELETE ?force=true → hard delete', async () => {
    const admin = seedOrgMember('org-1', 'uid-a', { role: 'admin' })
    const capturedDelete = jest.fn().mockResolvedValue(undefined)
    stageAuth(admin, {
      existingForm: {
        id: 'form-1',
        data: { orgId: 'org-1', name: 'Form A', deleted: false },
      },
      capturedDelete,
    })
    const req = callAsMember(admin, 'DELETE', '/api/v1/forms/form-1?force=true')
    const { DELETE } = await import('@/app/api/v1/forms/[id]/route')
    const res = await DELETE(req, routeCtx('form-1'))
    expect(res.status).toBeLessThan(300)
    expect(capturedDelete).toHaveBeenCalled()
  })

  it('viewer cannot DELETE → 403', async () => {
    const viewer = seedOrgMember('org-1', 'uid-v', { role: 'viewer' })
    stageAuth(viewer, {
      existingForm: { id: 'form-1', data: { orgId: 'org-1', deleted: false } },
    })
    const req = callAsMember(viewer, 'DELETE', '/api/v1/forms/form-1')
    const { DELETE } = await import('@/app/api/v1/forms/[id]/route')
    const res = await DELETE(req, routeCtx('form-1'))
    expect(res.status).toBe(403)
  })

  it('member cannot DELETE → 403', async () => {
    const member = seedOrgMember('org-1', 'uid-1', { role: 'member' })
    stageAuth(member, {
      existingForm: { id: 'form-1', data: { orgId: 'org-1', deleted: false } },
    })
    const req = callAsMember(member, 'DELETE', '/api/v1/forms/form-1')
    const { DELETE } = await import('@/app/api/v1/forms/[id]/route')
    const res = await DELETE(req, routeCtx('form-1'))
    expect(res.status).toBe(403)
  })

  it('cross-org DELETE → 404', async () => {
    const admin = seedOrgMember('org-1', 'uid-a', { role: 'admin' })
    stageAuth(admin, {
      existingForm: { id: 'form-x', data: { orgId: 'org-2', deleted: false } },
    })
    const req = callAsMember(admin, 'DELETE', '/api/v1/forms/form-x')
    const { DELETE } = await import('@/app/api/v1/forms/[id]/route')
    const res = await DELETE(req, routeCtx('form-x'))
    expect(res.status).toBe(404)
  })
})
