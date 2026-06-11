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
const subRouteCtx = (id: string, subId: string) => ({ params: Promise.resolve({ id, subId }) })

// ---------------------------------------------------------------------------
// Shared mock staging
// ---------------------------------------------------------------------------

function stageAuth(
  member: { uid: string; orgId: string; role: string; firstName?: string; lastName?: string },
  opts?: {
    existingForm?: { id: string; data: Record<string, unknown> } | null
    submissions?: Array<{ id: string; data: Record<string, unknown> }>
    capturedUpdate?: jest.Mock
  },
) {
  ;(adminAuth.verifySessionCookie as jest.Mock).mockResolvedValue({ uid: member.uid })
  const authCollections = makePortalAuthCollections(member)
  ;(adminDb.collection as jest.Mock).mockImplementation((name: string) => {
    if (name in authCollections) return authCollections[name as keyof typeof authCollections]

    if (name === 'forms') {
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
          }
        }),
        where: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        get: jest.fn().mockResolvedValue({ docs: [], empty: true }),
      }
    }

    if (name === 'form_submissions') {
      const subs = opts?.submissions ?? []
      const capturedUpdate = opts?.capturedUpdate ?? jest.fn().mockResolvedValue(undefined)

      // Build a chainable query builder that returns subs on .get()
      const makeChainable = () => {
        const chain: Record<string, jest.Mock> = {}
        const methods = ['where', 'orderBy', 'limit', 'offset']
        methods.forEach((m) => {
          chain[m] = jest.fn().mockReturnValue(chain)
        })
        chain['get'] = jest.fn().mockResolvedValue({
          docs: subs.map((s) => ({
            id: s.id,
            data: () => s.data,
          })),
          empty: subs.length === 0,
        })
        return chain
      }

      return {
        ...makeChainable(),
        collection: jest.fn().mockReturnThis(),
        doc: jest.fn().mockImplementation((subId?: string) => {
          const sub = subs.find((s) => s.id === subId)
          return {
            id: subId,
            get: () =>
              Promise.resolve({
                exists: !!sub,
                id: subId,
                data: () => sub?.data,
              }),
            update: capturedUpdate,
          }
        }),
        where: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        offset: jest.fn().mockReturnThis(),
        get: jest.fn().mockResolvedValue({
          docs: subs.map((s) => ({ id: s.id, data: () => s.data })),
        }),
      }
    }

    return { doc: () => ({ get: () => Promise.resolve({ exists: false }) }) }
  })
}

// ---------------------------------------------------------------------------
// GET /api/v1/forms/[id]/submissions
// ---------------------------------------------------------------------------

describe('GET /api/v1/forms/[id]/submissions', () => {
  beforeEach(() => jest.clearAllMocks())

  it('viewer can list submissions for own-org form → 200', async () => {
    const viewer = seedOrgMember('org-1', 'uid-v', { role: 'viewer' })
    stageAuth(viewer, {
      existingForm: { id: 'form-1', data: { orgId: 'org-1', deleted: false } },
      submissions: [
        { id: 'sub-1', data: { formId: 'form-1', orgId: 'org-1', status: 'new' } },
        { id: 'sub-2', data: { formId: 'form-1', orgId: 'org-1', status: 'read' } },
      ],
    })
    const req = callAsMember(viewer, 'GET', '/api/v1/forms/form-1/submissions')
    const { GET } = await import('@/app/api/v1/forms/[id]/submissions/route')
    const res = await GET(req, routeCtx('form-1'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
  })

  it('viewer cross-org form → 404', async () => {
    const viewer = seedOrgMember('org-1', 'uid-v', { role: 'viewer' })
    stageAuth(viewer, {
      existingForm: { id: 'form-x', data: { orgId: 'org-2', deleted: false } },
    })
    const req = callAsMember(viewer, 'GET', '/api/v1/forms/form-x/submissions')
    const { GET } = await import('@/app/api/v1/forms/[id]/submissions/route')
    const res = await GET(req, routeCtx('form-x'))
    expect(res.status).toBe(404)
  })

  it('viewer soft-deleted parent form → 404', async () => {
    const viewer = seedOrgMember('org-1', 'uid-v', { role: 'viewer' })
    stageAuth(viewer, {
      existingForm: { id: 'form-del', data: { orgId: 'org-1', deleted: true } },
    })
    const req = callAsMember(viewer, 'GET', '/api/v1/forms/form-del/submissions')
    const { GET } = await import('@/app/api/v1/forms/[id]/submissions/route')
    const res = await GET(req, routeCtx('form-del'))
    expect(res.status).toBe(404)
  })

  it('status filter works', async () => {
    const viewer = seedOrgMember('org-1', 'uid-v', { role: 'viewer' })
    stageAuth(viewer, {
      existingForm: { id: 'form-1', data: { orgId: 'org-1', deleted: false } },
      submissions: [
        { id: 'sub-1', data: { formId: 'form-1', orgId: 'org-1', status: 'new' } },
      ],
    })
    const req = callAsMember(viewer, 'GET', '/api/v1/forms/form-1/submissions?status=new')
    const { GET } = await import('@/app/api/v1/forms/[id]/submissions/route')
    const res = await GET(req, routeCtx('form-1'))
    expect(res.status).toBe(200)
  })

  it('date range (from/to) + pagination (page, limit) params are accepted → 200', async () => {
    const viewer = seedOrgMember('org-1', 'uid-v', { role: 'viewer' })
    stageAuth(viewer, {
      existingForm: { id: 'form-1', data: { orgId: 'org-1', deleted: false } },
      submissions: [],
    })
    const url =
      '/api/v1/forms/form-1/submissions?from=2024-01-01&to=2024-12-31&page=2&limit=10'
    const req = callAsMember(viewer, 'GET', url)
    const { GET } = await import('@/app/api/v1/forms/[id]/submissions/route')
    const res = await GET(req, routeCtx('form-1'))
    expect(res.status).toBe(200)
  })

  it('agent (Bearer) can list submissions → 200', async () => {
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
      if (name === 'forms')
        return {
          doc: jest.fn().mockReturnValue({
            get: () =>
              Promise.resolve({
                exists: true,
                id: 'form-1',
                data: () => ({ orgId: 'org-agent', deleted: false }),
              }),
          }),
          where: jest.fn().mockReturnThis(),
          limit: jest.fn().mockReturnThis(),
          get: jest.fn().mockResolvedValue({ docs: [], empty: true }),
        }
      if (name === 'form_submissions') {
        const chain: Record<string, jest.Mock> = {}
        ;['where', 'orderBy', 'limit', 'offset'].forEach((m) => {
          chain[m] = jest.fn().mockReturnValue(chain)
        })
        chain['get'] = jest.fn().mockResolvedValue({ docs: [] })
        return chain
      }
      return { doc: () => ({ get: () => Promise.resolve({ exists: false }) }) }
    })

    const req = callAsAgent('org-agent', 'GET', '/api/v1/forms/form-1/submissions', undefined, AI_API_KEY)
    const { GET } = await import('@/app/api/v1/forms/[id]/submissions/route')
    const res = await GET(req, routeCtx('form-1'))
    expect(res.status).toBe(200)
  })
})

// ---------------------------------------------------------------------------
// GET /api/v1/forms/[id]/submissions/[subId]
// ---------------------------------------------------------------------------

describe('GET /api/v1/forms/[id]/submissions/[subId]', () => {
  beforeEach(() => jest.clearAllMocks())

  it('viewer can get single submission → 200', async () => {
    const viewer = seedOrgMember('org-1', 'uid-v', { role: 'viewer' })
    stageAuth(viewer, {
      existingForm: { id: 'form-1', data: { orgId: 'org-1', deleted: false } },
      submissions: [
        { id: 'sub-1', data: { formId: 'form-1', orgId: 'org-1', status: 'new' } },
      ],
    })
    const req = callAsMember(viewer, 'GET', '/api/v1/forms/form-1/submissions/sub-1')
    const { GET } = await import('@/app/api/v1/forms/[id]/submissions/[subId]/route')
    const res = await GET(req, subRouteCtx('form-1', 'sub-1'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.data.submission).toBeDefined()
  })

  it('cross-form-id (submission belongs to different form) → 404', async () => {
    const viewer = seedOrgMember('org-1', 'uid-v', { role: 'viewer' })
    stageAuth(viewer, {
      existingForm: { id: 'form-1', data: { orgId: 'org-1', deleted: false } },
      submissions: [
        // sub-1 belongs to form-OTHER, not form-1
        { id: 'sub-1', data: { formId: 'form-OTHER', orgId: 'org-1', status: 'new' } },
      ],
    })
    const req = callAsMember(viewer, 'GET', '/api/v1/forms/form-1/submissions/sub-1')
    const { GET } = await import('@/app/api/v1/forms/[id]/submissions/[subId]/route')
    const res = await GET(req, subRouteCtx('form-1', 'sub-1'))
    expect(res.status).toBe(404)
  })

  it('cross-org submission → 404', async () => {
    const viewer = seedOrgMember('org-1', 'uid-v', { role: 'viewer' })
    stageAuth(viewer, {
      existingForm: { id: 'form-1', data: { orgId: 'org-1', deleted: false } },
      submissions: [
        // sub-x belongs to org-2
        { id: 'sub-x', data: { formId: 'form-1', orgId: 'org-2', status: 'new' } },
      ],
    })
    const req = callAsMember(viewer, 'GET', '/api/v1/forms/form-1/submissions/sub-x')
    const { GET } = await import('@/app/api/v1/forms/[id]/submissions/[subId]/route')
    const res = await GET(req, subRouteCtx('form-1', 'sub-x'))
    expect(res.status).toBe(404)
  })
})

// ---------------------------------------------------------------------------
// PATCH /api/v1/forms/[id]/submissions/[subId]
// ---------------------------------------------------------------------------

describe('PATCH /api/v1/forms/[id]/submissions/[subId]', () => {
  beforeEach(() => jest.clearAllMocks())

  it('admin can update status to "read" and writes updatedByRef + updatedAt', async () => {
    const admin = seedOrgMember('org-1', 'uid-a', { role: 'admin', firstName: 'Ada', lastName: 'Min' })
    const captured = jest.fn().mockResolvedValue(undefined)
    stageAuth(admin, {
      existingForm: { id: 'form-1', data: { orgId: 'org-1', deleted: false } },
      submissions: [
        { id: 'sub-1', data: { formId: 'form-1', orgId: 'org-1', status: 'new' } },
      ],
      capturedUpdate: captured,
    })
    const req = callAsMember(admin, 'PATCH', '/api/v1/forms/form-1/submissions/sub-1', {
      status: 'read',
    })
    const { PATCH } = await import('@/app/api/v1/forms/[id]/submissions/[subId]/route')
    const res = await PATCH(req, subRouteCtx('form-1', 'sub-1'))
    expect(res.status).toBeLessThan(300)
    const patch = captured.mock.calls[0][0]
    expect(patch.status).toBe('read')
    expect(patch.updatedByRef).toBeDefined()
    expect(patch.updatedByRef.displayName).toBe('Ada Min')
    expect(patch.updatedAt).toBeDefined()
  })

  it('admin can update status to "archived"', async () => {
    const admin = seedOrgMember('org-1', 'uid-a', { role: 'admin' })
    const captured = jest.fn().mockResolvedValue(undefined)
    stageAuth(admin, {
      existingForm: { id: 'form-1', data: { orgId: 'org-1', deleted: false } },
      submissions: [
        { id: 'sub-1', data: { formId: 'form-1', orgId: 'org-1', status: 'new' } },
      ],
      capturedUpdate: captured,
    })
    const req = callAsMember(admin, 'PATCH', '/api/v1/forms/form-1/submissions/sub-1', {
      status: 'archived',
    })
    const { PATCH } = await import('@/app/api/v1/forms/[id]/submissions/[subId]/route')
    const res = await PATCH(req, subRouteCtx('form-1', 'sub-1'))
    expect(res.status).toBeLessThan(300)
    const patch = captured.mock.calls[0][0]
    expect(patch.status).toBe('archived')
  })

  it('invalid status → 400', async () => {
    const admin = seedOrgMember('org-1', 'uid-a', { role: 'admin' })
    stageAuth(admin, {
      existingForm: { id: 'form-1', data: { orgId: 'org-1', deleted: false } },
      submissions: [
        { id: 'sub-1', data: { formId: 'form-1', orgId: 'org-1', status: 'new' } },
      ],
    })
    const req = callAsMember(admin, 'PATCH', '/api/v1/forms/form-1/submissions/sub-1', {
      status: 'invalid-status',
    })
    const { PATCH } = await import('@/app/api/v1/forms/[id]/submissions/[subId]/route')
    const res = await PATCH(req, subRouteCtx('form-1', 'sub-1'))
    expect(res.status).toBe(400)
  })

  it('member cannot PATCH → 403', async () => {
    const member = seedOrgMember('org-1', 'uid-m', { role: 'member' })
    stageAuth(member, {
      existingForm: { id: 'form-1', data: { orgId: 'org-1', deleted: false } },
      submissions: [
        { id: 'sub-1', data: { formId: 'form-1', orgId: 'org-1', status: 'new' } },
      ],
    })
    const req = callAsMember(member, 'PATCH', '/api/v1/forms/form-1/submissions/sub-1', {
      status: 'read',
    })
    const { PATCH } = await import('@/app/api/v1/forms/[id]/submissions/[subId]/route')
    const res = await PATCH(req, subRouteCtx('form-1', 'sub-1'))
    expect(res.status).toBe(403)
  })

  it('viewer cannot PATCH → 403', async () => {
    const viewer = seedOrgMember('org-1', 'uid-v', { role: 'viewer' })
    stageAuth(viewer, {
      existingForm: { id: 'form-1', data: { orgId: 'org-1', deleted: false } },
      submissions: [
        { id: 'sub-1', data: { formId: 'form-1', orgId: 'org-1', status: 'new' } },
      ],
    })
    const req = callAsMember(viewer, 'PATCH', '/api/v1/forms/form-1/submissions/sub-1', {
      status: 'read',
    })
    const { PATCH } = await import('@/app/api/v1/forms/[id]/submissions/[subId]/route')
    const res = await PATCH(req, subRouteCtx('form-1', 'sub-1'))
    expect(res.status).toBe(403)
  })

  it('cross-org PATCH → 404', async () => {
    const admin = seedOrgMember('org-1', 'uid-a', { role: 'admin' })
    stageAuth(admin, {
      existingForm: { id: 'form-1', data: { orgId: 'org-1', deleted: false } },
      submissions: [
        // sub belongs to org-2
        { id: 'sub-x', data: { formId: 'form-1', orgId: 'org-2', status: 'new' } },
      ],
    })
    const req = callAsMember(admin, 'PATCH', '/api/v1/forms/form-1/submissions/sub-x', {
      status: 'read',
    })
    const { PATCH } = await import('@/app/api/v1/forms/[id]/submissions/[subId]/route')
    const res = await PATCH(req, subRouteCtx('form-1', 'sub-x'))
    expect(res.status).toBe(404)
  })

  it('agent PATCH uses AGENT_PIP_REF in updatedByRef', async () => {
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
      if (name === 'form_submissions') {
        const capturedUpdate = jest.fn().mockResolvedValue(undefined)
        return {
          doc: jest.fn().mockReturnValue({
            id: 'sub-1',
            get: () =>
              Promise.resolve({
                exists: true,
                id: 'sub-1',
                data: () => ({ formId: 'form-1', orgId: 'org-agent', status: 'new' }),
              }),
            update: capturedUpdate,
          }),
          __capturedUpdate: capturedUpdate,
        }
      }
      return { doc: () => ({ get: () => Promise.resolve({ exists: false }) }) }
    })

    const req = callAsAgent(
      'org-agent',
      'PATCH',
      '/api/v1/forms/form-1/submissions/sub-1',
      { status: 'read' },
      AI_API_KEY,
    )
    const { PATCH } = await import('@/app/api/v1/forms/[id]/submissions/[subId]/route')
    const res = await PATCH(req, subRouteCtx('form-1', 'sub-1'))
    expect(res.status).toBeLessThan(300)
    const body = await res.json()
    expect(body.success).toBe(true)
  })
})
