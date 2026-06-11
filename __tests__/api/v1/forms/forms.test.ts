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

const VALID_FIELDS = [
  { id: 'email', type: 'email', label: 'Email', required: true },
]

function stageAuth(
  member: { uid: string; orgId: string; role: string; firstName?: string; lastName?: string },
  opts?: {
    existingForms?: Array<{ id: string; data: Record<string, unknown> }>
    slugConflict?: boolean
    capturedAdd?: jest.Mock
  },
) {
  ;(adminAuth.verifySessionCookie as jest.Mock).mockResolvedValue({ uid: member.uid })
  const authCollections = makePortalAuthCollections(member)
  ;(adminDb.collection as jest.Mock).mockImplementation((name: string) => {
    if (name in authCollections) return authCollections[name as keyof typeof authCollections]
    if (name === 'forms') {
      const docs = (opts?.existingForms ?? []).map((f) => ({ id: f.id, data: () => f.data }))
      // Slug conflict check: when searching for slug, return a doc or empty
      const slugDocs = opts?.slugConflict
        ? [{ id: 'existing-form', data: () => ({ deleted: false }) }]
        : []
      const addFn =
        opts?.capturedAdd ??
        jest.fn().mockImplementation(() => {
          const id = 'auto-form'
          return Promise.resolve({
            id,
            get: () =>
              Promise.resolve({
                exists: true,
                id,
                data: () => ({
                  orgId: member.orgId,
                  name: 'Test Form',
                  slug: 'test-form',
                  createdByRef: {
                    uid: member.uid,
                    displayName: `${member.firstName ?? 'Test'} ${member.lastName ?? member.uid}`,
                    kind: 'human',
                  },
                  updatedByRef: {
                    uid: member.uid,
                    displayName: `${member.firstName ?? 'Test'} ${member.lastName ?? member.uid}`,
                    kind: 'human',
                  },
                  createContact: true,
                  rateLimitPerMinute: 10,
                }),
              }),
          })
        })
      return {
        doc: jest.fn().mockReturnValue({
          get: () => Promise.resolve({ exists: false }),
        }),
        where: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        offset: jest.fn().mockReturnThis(),
        get: jest.fn().mockResolvedValue({ docs: slugDocs.length ? slugDocs : docs, size: docs.length }),
        add: addFn,
      }
    }
    return { doc: () => ({ get: () => Promise.resolve({ exists: false }) }) }
  })
}

// ---------------------------------------------------------------------------
// GET /api/v1/forms
// ---------------------------------------------------------------------------

describe('GET /api/v1/forms', () => {
  beforeEach(() => jest.clearAllMocks())

  it('viewer can GET list (own org scoped)', async () => {
    const viewer = seedOrgMember('org-1', 'uid-v', { role: 'viewer' })
    stageAuth(viewer, {
      existingForms: [
        { id: 'form-1', data: { orgId: 'org-1', name: 'Form A', deleted: false } },
        { id: 'form-2', data: { orgId: 'org-1', name: 'Form B', deleted: false } },
      ],
    })
    const req = callAsMember(viewer, 'GET', '/api/v1/forms')
    const { GET } = await import('@/app/api/v1/forms/route')
    const res = await GET(req)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(Array.isArray(body.data)).toBe(true)
  })

  it('returns 401 without auth', async () => {
    const req = new NextRequest('http://localhost/api/v1/forms')
    const { GET } = await import('@/app/api/v1/forms/route')
    const res = await GET(req)
    expect(res.status).toBe(401)
  })
})

// ---------------------------------------------------------------------------
// POST /api/v1/forms
// ---------------------------------------------------------------------------

describe('POST /api/v1/forms', () => {
  beforeEach(() => jest.clearAllMocks())

  it('viewer cannot POST → 403', async () => {
    const viewer = seedOrgMember('org-1', 'uid-v', { role: 'viewer' })
    stageAuth(viewer)
    const req = callAsMember(viewer, 'POST', '/api/v1/forms', {
      name: 'Test',
      slug: 'test',
      fields: VALID_FIELDS,
    })
    const { POST } = await import('@/app/api/v1/forms/route')
    const res = await POST(req)
    expect(res.status).toBe(403)
  })

  it('admin POST creates form with createdByRef.displayName + defaults', async () => {
    const admin = seedOrgMember('org-1', 'uid-a', { role: 'admin', firstName: 'Ada', lastName: 'Min' })
    stageAuth(admin)
    const req = callAsMember(admin, 'POST', '/api/v1/forms', {
      name: 'Test Form',
      slug: 'test-form',
      fields: VALID_FIELDS,
    })
    const { POST } = await import('@/app/api/v1/forms/route')
    const res = await POST(req)
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.data.createdByRef).toBeDefined()
    expect(body.data.createdByRef.displayName).toBe('Ada Min')
    expect(body.data.createContact).toBe(true)
    expect(body.data.rateLimitPerMinute).toBe(10)
  })

  it('agent POST uses AGENT_PIP_REF', async () => {
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
        return {
          where: jest.fn().mockReturnThis(),
          limit: jest.fn().mockReturnThis(),
          get: jest.fn().mockResolvedValue({ docs: [] }),
          add: jest.fn().mockImplementation(() => {
            return Promise.resolve({
              id: 'agent-form',
              get: () =>
                Promise.resolve({
                  exists: true,
                  id: 'agent-form',
                  data: () => ({
                    orgId: 'org-1',
                    name: 'Agent Form',
                    slug: 'agent-form',
                    createdByRef: { uid: 'agent:pip', kind: 'agent', displayName: 'Pip' },
                    updatedByRef: { uid: 'agent:pip', kind: 'agent', displayName: 'Pip' },
                    createContact: true,
                    rateLimitPerMinute: 10,
                  }),
                }),
            })
          }),
        }
      }
      return { doc: () => ({ get: () => Promise.resolve({ exists: false }) }) }
    })
    const req = callAsAgent('org-1', 'POST', '/api/v1/forms', {
      name: 'Agent Form',
      slug: 'agent-form',
      fields: VALID_FIELDS,
    }, AI_API_KEY)
    const { POST } = await import('@/app/api/v1/forms/route')
    const res = await POST(req)
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.data.createdByRef.uid).toBe('agent:pip')
    expect(body.data.createdByRef.kind).toBe('agent')
    expect(body.data.createdBy).toBeUndefined()
  })

  it('POST validation: name required → 400', async () => {
    const admin = seedOrgMember('org-1', 'uid-a', { role: 'admin' })
    stageAuth(admin)
    const req = callAsMember(admin, 'POST', '/api/v1/forms', {
      slug: 'test',
      fields: VALID_FIELDS,
    })
    const { POST } = await import('@/app/api/v1/forms/route')
    const res = await POST(req)
    expect(res.status).toBe(400)
  })

  it('POST validation: slug required → 400', async () => {
    const admin = seedOrgMember('org-1', 'uid-a', { role: 'admin' })
    stageAuth(admin)
    const req = callAsMember(admin, 'POST', '/api/v1/forms', {
      name: 'Test',
      fields: VALID_FIELDS,
    })
    const { POST } = await import('@/app/api/v1/forms/route')
    const res = await POST(req)
    expect(res.status).toBe(400)
  })
})
