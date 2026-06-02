import { NextRequest } from 'next/server'

jest.mock('@/lib/firebase/admin', () => ({
  adminAuth: { verifySessionCookie: jest.fn() },
  adminDb: { collection: jest.fn() },
}))

import { adminAuth, adminDb } from '@/lib/firebase/admin'
import { seedOrgMember, callAsMember, callAsAgent } from '../../../helpers/crm'

const AI_API_KEY = 'test-ai-key'
process.env.AI_API_KEY = AI_API_KEY
process.env.SESSION_COOKIE_NAME = '__session'

const routeCtx = (id: string) => ({ params: Promise.resolve({ id }) })

function stageAuth(
  member: { uid: string; orgId: string; role: string; firstName?: string; lastName?: string },
  opts?: {
    existingSource?: { id: string; data: Record<string, unknown> } | null
    capturedSet?: jest.Mock
    capturedUpdate?: jest.Mock
    existingSources?: Array<{ id: string; data: Record<string, unknown> }>
  },
) {
  ;(adminAuth.verifySessionCookie as jest.Mock).mockResolvedValue({ uid: member.uid })
  ;(adminDb.collection as jest.Mock).mockImplementation((name: string) => {
    if (name === 'users')
      return {
        doc: () => ({
          get: () => Promise.resolve({ exists: true, data: () => ({ activeOrgId: member.orgId }) }),
        }),
      }
    if (name === 'orgMembers')
      return {
        doc: () => ({
          get: () => Promise.resolve({ exists: true, data: () => member }),
        }),
        where: (_field: string, _op: string, value: string) => ({
          get: () =>
            Promise.resolve({
              docs:
                value === member.uid
                  ? [{ id: `${member.orgId}_${member.uid}`, data: () => member }]
                  : [],
            }),
        }),
      }
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
    if (name === 'capture_sources') {
      const setFn = opts?.capturedSet ?? jest.fn().mockResolvedValue(undefined)
      const updateFn = opts?.capturedUpdate ?? jest.fn().mockResolvedValue(undefined)
      const docs = (opts?.existingSources ?? []).map((s) => ({ id: s.id, data: () => s.data }))
      return {
        doc: jest.fn().mockImplementation((id?: string) => ({
          id: id ?? 'auto-src',
          get: () =>
            Promise.resolve({
              exists: opts?.existingSource != null && (id === opts.existingSource?.id || id === undefined),
              id: opts?.existingSource?.id ?? id ?? 'auto-src',
              data: () => opts?.existingSource?.data,
              ref: {
                update: updateFn,
              },
            }),
          set: setFn,
          update: updateFn,
          ref: {
            update: updateFn,
          },
        })),
        where: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        get: jest.fn().mockResolvedValue({ docs, size: docs.length }),
        add: jest.fn().mockImplementation(() => {
          const id = 'auto-src'
          return Promise.resolve({
            id,
            get: () =>
              Promise.resolve({
                exists: true,
                id,
                data: () => ({
                  orgId: member.orgId,
                  name: 'Test',
                  type: 'form',
                  publicKey: 'abc123',
                  createdByRef: { uid: member.uid, displayName: `${member.firstName ?? 'Test'} ${member.lastName ?? member.uid}`, kind: 'human' },
                  updatedByRef: { uid: member.uid, displayName: `${member.firstName ?? 'Test'} ${member.lastName ?? member.uid}`, kind: 'human' },
                }),
              }),
          })
        }),
      }
    }
    return { doc: () => ({ get: () => Promise.resolve({ exists: false }) }) }
  })
}

// ---------------------------------------------------------------------------
// GET /api/v1/crm/capture-sources
// ---------------------------------------------------------------------------

describe('GET /api/v1/crm/capture-sources', () => {
  beforeEach(() => jest.clearAllMocks())

  it('viewer can GET list scoped to own org', async () => {
    const viewer = seedOrgMember('org-1', 'uid-v', { role: 'viewer' })
    stageAuth(viewer, {
      existingSources: [
        { id: 'src-1', data: { orgId: 'org-1', name: 'Form A', deleted: false } },
        { id: 'src-2', data: { orgId: 'org-1', name: 'Form B', deleted: false } },
      ],
    })
    const req = callAsMember(viewer, 'GET', '/api/v1/crm/capture-sources')
    const { GET } = await import('@/app/api/v1/crm/capture-sources/route')
    const res = await GET(req)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(Array.isArray(body.data)).toBe(true)
  })

  it('returns 401 without auth', async () => {
    const req = new NextRequest('http://localhost/api/v1/crm/capture-sources')
    const { GET } = await import('@/app/api/v1/crm/capture-sources/route')
    const res = await GET(req)
    expect(res.status).toBe(401)
  })

  it('agent (Bearer) can list capture sources', async () => {
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
      if (name === 'capture_sources')
        return {
          where: jest.fn().mockReturnThis(),
          orderBy: jest.fn().mockReturnThis(),
          get: jest.fn().mockResolvedValue({ docs: [] }),
        }
      return { doc: () => ({ get: () => Promise.resolve({ exists: false }) }) }
    })
    const req = callAsAgent('org-1', 'GET', '/api/v1/crm/capture-sources', undefined, AI_API_KEY)
    const { GET } = await import('@/app/api/v1/crm/capture-sources/route')
    const res = await GET(req)
    expect(res.status).toBe(200)
  })
})

// ---------------------------------------------------------------------------
// GET /api/v1/crm/capture-sources/[id]
// ---------------------------------------------------------------------------

describe('GET /api/v1/crm/capture-sources/[id]', () => {
  beforeEach(() => jest.clearAllMocks())

  it('viewer can GET by id (own org)', async () => {
    const viewer = seedOrgMember('org-1', 'uid-v', { role: 'viewer' })
    stageAuth(viewer, {
      existingSource: { id: 'src-1', data: { orgId: 'org-1', name: 'Form A', deleted: false } },
    })
    const req = callAsMember(viewer, 'GET', '/api/v1/crm/capture-sources/src-1')
    const { GET } = await import('@/app/api/v1/crm/capture-sources/[id]/route')
    const res = await GET(req, routeCtx('src-1'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
  })

  it('GET cross-org → 404', async () => {
    const viewer = seedOrgMember('org-1', 'uid-v', { role: 'viewer' })
    stageAuth(viewer, {
      existingSource: { id: 'src-x', data: { orgId: 'org-2', name: 'Other', deleted: false } },
    })
    const req = callAsMember(viewer, 'GET', '/api/v1/crm/capture-sources/src-x')
    const { GET } = await import('@/app/api/v1/crm/capture-sources/[id]/route')
    const res = await GET(req, routeCtx('src-x'))
    expect(res.status).toBe(404)
  })

  it('GET soft-deleted source → 404', async () => {
    const viewer = seedOrgMember('org-1', 'uid-v', { role: 'viewer' })
    stageAuth(viewer, {
      existingSource: { id: 'src-del', data: { orgId: 'org-1', name: 'Gone', deleted: true } },
    })
    const req = callAsMember(viewer, 'GET', '/api/v1/crm/capture-sources/src-del')
    const { GET } = await import('@/app/api/v1/crm/capture-sources/[id]/route')
    const res = await GET(req, routeCtx('src-del'))
    expect(res.status).toBe(404)
  })
})

// ---------------------------------------------------------------------------
// POST /api/v1/crm/capture-sources
// ---------------------------------------------------------------------------

describe('POST /api/v1/crm/capture-sources', () => {
  beforeEach(() => jest.clearAllMocks())

  it('admin POST writes createdByRef + generates publicKey', async () => {
    const admin = seedOrgMember('org-1', 'uid-a', { role: 'admin', firstName: 'A', lastName: 'A' })
    stageAuth(admin)
    const req = callAsMember(admin, 'POST', '/api/v1/crm/capture-sources', {
      name: 'Test',
      type: 'form',
    })
    const { POST } = await import('@/app/api/v1/crm/capture-sources/route')
    const res = await POST(req)
    expect(res.status).toBeLessThan(300)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.data.createdByRef).toBeDefined()
    expect(body.data.createdByRef.displayName).toBe('A A')
    expect(typeof body.data.publicKey).toBe('string')
    expect(body.data.publicKey.length).toBeGreaterThan(0)
    expect(body.data.orgId).toBe('org-1')
  })

  it('admin POST stores direct sequence auto-enrollment targets', async () => {
    const admin = seedOrgMember('org-1', 'uid-a', { role: 'admin', firstName: 'A', lastName: 'A' })
    const add = jest.fn().mockImplementation((doc) => Promise.resolve({
      id: 'auto-src',
      get: () => Promise.resolve({
        exists: true,
        id: 'auto-src',
        data: () => doc,
      }),
    }))
    ;(adminAuth.verifySessionCookie as jest.Mock).mockResolvedValue({ uid: admin.uid })
    ;(adminDb.collection as jest.Mock).mockImplementation((name: string) => {
      if (name === 'users') return { doc: () => ({ get: () => Promise.resolve({ exists: true, data: () => ({ activeOrgId: admin.orgId }) }) }) }
      if (name === 'orgMembers') return {
        doc: () => ({ get: () => Promise.resolve({ exists: true, data: () => admin }) }),
        where: () => ({ get: () => Promise.resolve({ docs: [{ id: `${admin.orgId}_${admin.uid}`, data: () => admin }] }) }),
      }
      if (name === 'organizations') return { doc: () => ({ get: () => Promise.resolve({ exists: true, data: () => ({ settings: { permissions: {} } }) }) }) }
      if (name === 'capture_sources') return { add }
      return { doc: () => ({ get: () => Promise.resolve({ exists: false }) }) }
    })

    const req = callAsMember(admin, 'POST', '/api/v1/crm/capture-sources', {
      name: 'Landing page form',
      type: 'form',
      autoSequenceIds: ['seq-1', '', 'seq-2'],
    })
    const { POST } = await import('@/app/api/v1/crm/capture-sources/route')

    const res = await POST(req)

    expect(res.status).toBe(201)
    expect(add).toHaveBeenCalledWith(expect.objectContaining({
      autoSequenceIds: ['seq-1', 'seq-2'],
    }))
  })

  it('member cannot POST (403)', async () => {
    const member = seedOrgMember('org-1', 'uid-1', { role: 'member' })
    stageAuth(member)
    const req = callAsMember(member, 'POST', '/api/v1/crm/capture-sources', {
      name: 'Test',
      type: 'form',
    })
    const { POST } = await import('@/app/api/v1/crm/capture-sources/route')
    const res = await POST(req)
    expect(res.status).toBe(403)
  })

  it('viewer cannot POST (403)', async () => {
    const viewer = seedOrgMember('org-1', 'uid-v', { role: 'viewer' })
    stageAuth(viewer)
    const req = callAsMember(viewer, 'POST', '/api/v1/crm/capture-sources', {
      name: 'Test',
      type: 'form',
    })
    const { POST } = await import('@/app/api/v1/crm/capture-sources/route')
    const res = await POST(req)
    expect(res.status).toBe(403)
  })

  it('POST without name returns 400', async () => {
    const admin = seedOrgMember('org-1', 'uid-a', { role: 'admin' })
    stageAuth(admin)
    const req = callAsMember(admin, 'POST', '/api/v1/crm/capture-sources', { type: 'form' })
    const { POST } = await import('@/app/api/v1/crm/capture-sources/route')
    const res = await POST(req)
    expect(res.status).toBe(400)
  })

  it('POST with invalid type returns 400', async () => {
    const admin = seedOrgMember('org-1', 'uid-a', { role: 'admin' })
    stageAuth(admin)
    const req = callAsMember(admin, 'POST', '/api/v1/crm/capture-sources', {
      name: 'Test',
      type: 'invalid-type',
    })
    const { POST } = await import('@/app/api/v1/crm/capture-sources/route')
    const res = await POST(req)
    expect(res.status).toBe(400)
  })

  it('agent (Bearer) POST uses AGENT_PIP_REF', async () => {
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
      if (name === 'capture_sources') {
        return {
          add: jest.fn().mockImplementation(() => {
            return Promise.resolve({
              id: 'agent-src',
              get: () =>
                Promise.resolve({
                  exists: true,
                  id: 'agent-src',
                  data: () => ({
                    orgId: 'org-1',
                    name: 'Agent Form',
                    type: 'api',
                    publicKey: 'deadbeef',
                    createdByRef: { uid: 'agent:pip', kind: 'agent', displayName: 'Pip' },
                    updatedByRef: { uid: 'agent:pip', kind: 'agent', displayName: 'Pip' },
                  }),
                }),
            })
          }),
        }
      }
      return { doc: () => ({ get: () => Promise.resolve({ exists: false }) }) }
    })
    const req = callAsAgent('org-1', 'POST', '/api/v1/crm/capture-sources', {
      name: 'Agent Form',
      type: 'api',
    }, AI_API_KEY)
    const { POST } = await import('@/app/api/v1/crm/capture-sources/route')
    const res = await POST(req)
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.data.createdByRef.uid).toBe('agent:pip')
    expect(body.data.createdByRef.kind).toBe('agent')
    expect(body.data.createdBy).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// PUT /api/v1/crm/capture-sources/[id]
// ---------------------------------------------------------------------------

describe('PUT /api/v1/crm/capture-sources/[id]', () => {
  beforeEach(() => jest.clearAllMocks())

  it('admin can update name', async () => {
    const admin = seedOrgMember('org-1', 'uid-a', { role: 'admin', firstName: 'Ada', lastName: 'Min' })
    const captured = jest.fn().mockResolvedValue(undefined)
    stageAuth(admin, {
      existingSource: { id: 'src-1', data: { orgId: 'org-1', deleted: false, name: 'Old name', publicKey: 'key123' } },
      capturedUpdate: captured,
    })
    const req = callAsMember(admin, 'PUT', '/api/v1/crm/capture-sources/src-1', { name: 'New name' })
    const { PUT } = await import('@/app/api/v1/crm/capture-sources/[id]/route')
    const res = await PUT(req, routeCtx('src-1'))
    expect(res.status).toBeLessThan(300)
    const patch = captured.mock.calls[0][0]
    expect(patch.name).toBe('New name')
    expect(patch.updatedByRef).toBeDefined()
    expect(patch.updatedByRef.displayName).toBe('Ada Min')
  })

  it('admin can update direct sequence auto-enrollment targets', async () => {
    const admin = seedOrgMember('org-1', 'uid-a', { role: 'admin', firstName: 'Ada', lastName: 'Min' })
    const captured = jest.fn().mockResolvedValue(undefined)
    stageAuth(admin, {
      existingSource: { id: 'src-1', data: { orgId: 'org-1', deleted: false, name: 'Old name', publicKey: 'key123' } },
      capturedUpdate: captured,
    })
    const req = callAsMember(admin, 'PUT', '/api/v1/crm/capture-sources/src-1', {
      autoSequenceIds: ['seq-1', '', 'seq-2'],
    })
    const { PUT } = await import('@/app/api/v1/crm/capture-sources/[id]/route')

    const res = await PUT(req, routeCtx('src-1'))

    expect(res.status).toBeLessThan(300)
    const patch = captured.mock.calls[0][0]
    expect(patch.autoSequenceIds).toEqual(['seq-1', 'seq-2'])
  })

  it('admin PUT with rotateKey:true regenerates publicKey', async () => {
    const admin = seedOrgMember('org-1', 'uid-a', { role: 'admin' })
    const captured = jest.fn().mockResolvedValue(undefined)
    stageAuth(admin, {
      existingSource: { id: 's1', data: { orgId: 'org-1', deleted: false, publicKey: 'old-key' } },
      capturedUpdate: captured,
    })
    const req = callAsMember(admin, 'PUT', '/api/v1/crm/capture-sources/s1', { rotateKey: true })
    const { PUT } = await import('@/app/api/v1/crm/capture-sources/[id]/route')
    const res = await PUT(req, routeCtx('s1'))
    expect(res.status).toBeLessThan(300)
    const patch = captured.mock.calls[0][0]
    expect(typeof patch.publicKey).toBe('string')
    expect(patch.publicKey).not.toBe('old-key')
    expect(patch.updatedByRef).toBeDefined()
  })

  it('PUT cross-org → 404', async () => {
    const admin = seedOrgMember('org-1', 'uid-a', { role: 'admin' })
    stageAuth(admin, {
      existingSource: { id: 'src-x', data: { orgId: 'org-2', deleted: false, name: 'X' } },
    })
    const req = callAsMember(admin, 'PUT', '/api/v1/crm/capture-sources/src-x', { name: 'Y' })
    const { PUT } = await import('@/app/api/v1/crm/capture-sources/[id]/route')
    const res = await PUT(req, routeCtx('src-x'))
    expect(res.status).toBe(404)
  })

  it('PUT soft-deleted → 404', async () => {
    const admin = seedOrgMember('org-1', 'uid-a', { role: 'admin' })
    stageAuth(admin, {
      existingSource: { id: 'src-del', data: { orgId: 'org-1', deleted: true, name: 'Gone' } },
    })
    const req = callAsMember(admin, 'PUT', '/api/v1/crm/capture-sources/src-del', { name: 'New' })
    const { PUT } = await import('@/app/api/v1/crm/capture-sources/[id]/route')
    const res = await PUT(req, routeCtx('src-del'))
    expect(res.status).toBe(404)
  })

  it('member cannot PUT (403)', async () => {
    const member = seedOrgMember('org-1', 'uid-1', { role: 'member' })
    stageAuth(member, {
      existingSource: { id: 'src-1', data: { orgId: 'org-1', deleted: false, name: 'X' } },
    })
    const req = callAsMember(member, 'PUT', '/api/v1/crm/capture-sources/src-1', { name: 'Y' })
    const { PUT } = await import('@/app/api/v1/crm/capture-sources/[id]/route')
    const res = await PUT(req, routeCtx('src-1'))
    expect(res.status).toBe(403)
  })
})

// ---------------------------------------------------------------------------
// DELETE /api/v1/crm/capture-sources/[id]
// ---------------------------------------------------------------------------

describe('DELETE /api/v1/crm/capture-sources/[id]', () => {
  beforeEach(() => jest.clearAllMocks())

  it('admin DELETE soft-deletes with updatedByRef', async () => {
    const admin = seedOrgMember('org-1', 'uid-a', { role: 'admin', firstName: 'Ada', lastName: 'Min' })
    const captured = jest.fn().mockResolvedValue(undefined)
    stageAuth(admin, {
      existingSource: { id: 'src-1', data: { orgId: 'org-1', deleted: false, name: 'Form A' } },
      capturedUpdate: captured,
    })
    const req = callAsMember(admin, 'DELETE', '/api/v1/crm/capture-sources/src-1')
    const { DELETE } = await import('@/app/api/v1/crm/capture-sources/[id]/route')
    const res = await DELETE(req, routeCtx('src-1'))
    expect(res.status).toBeLessThan(300)
    const patch = captured.mock.calls[0][0]
    expect(patch.deleted).toBe(true)
    expect(patch.updatedByRef).toBeDefined()
    expect(patch.updatedByRef.displayName).toBe('Ada Min')
  })

  it('DELETE cross-org → 404', async () => {
    const admin = seedOrgMember('org-1', 'uid-a', { role: 'admin' })
    stageAuth(admin, {
      existingSource: { id: 'src-x', data: { orgId: 'org-2', deleted: false, name: 'X' } },
    })
    const req = callAsMember(admin, 'DELETE', '/api/v1/crm/capture-sources/src-x')
    const { DELETE } = await import('@/app/api/v1/crm/capture-sources/[id]/route')
    const res = await DELETE(req, routeCtx('src-x'))
    expect(res.status).toBe(404)
  })

  it('member cannot DELETE (403)', async () => {
    const member = seedOrgMember('org-1', 'uid-1', { role: 'member' })
    stageAuth(member, {
      existingSource: { id: 'src-1', data: { orgId: 'org-1', deleted: false, name: 'X' } },
    })
    const req = callAsMember(member, 'DELETE', '/api/v1/crm/capture-sources/src-1')
    const { DELETE } = await import('@/app/api/v1/crm/capture-sources/[id]/route')
    const res = await DELETE(req, routeCtx('src-1'))
    expect(res.status).toBe(403)
  })
})
