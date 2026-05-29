/**
 * Tests for:
 *   GET    /api/v1/crm/saved-views
 *   POST   /api/v1/crm/saved-views
 *   DELETE /api/v1/crm/saved-views/[id]
 */

jest.mock('@/lib/firebase/admin', () => ({
  adminAuth: { verifySessionCookie: jest.fn() },
  adminDb: { collection: jest.fn() },
}))

import { adminAuth, adminDb } from '@/lib/firebase/admin'
import { GET, POST } from '@/app/api/v1/crm/saved-views/route'
import { DELETE } from '@/app/api/v1/crm/saved-views/[id]/route'
import { seedOrgMember, callAsMember, callAsAgent } from '../../../helpers/crm'

const AI_API_KEY = 'test-ai-key-saved-views'
process.env.AI_API_KEY = AI_API_KEY
process.env.SESSION_COOKIE_NAME = '__session'

// ---------------------------------------------------------------------------
// Auth staging helpers
// ---------------------------------------------------------------------------

interface ViewDoc {
  id: string
  orgId: string
  uid: string
  resourceKind: string
  name: string
  filters: Record<string, unknown>
}

interface StageOpts {
  viewDocs?: ViewDoc[]
  capturedSet?: jest.Mock
  capturedDelete?: jest.Mock
}

function stageAuth(
  member: { uid: string; orgId: string; role: string },
  opts: StageOpts = {},
) {
  ;(adminAuth.verifySessionCookie as jest.Mock).mockResolvedValue({ uid: member.uid })

  const viewDocs = opts.viewDocs ?? []
  const capturedSet = opts.capturedSet ?? jest.fn().mockResolvedValue(undefined)
  const capturedDelete = opts.capturedDelete ?? jest.fn().mockResolvedValue(undefined)

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
            Promise.resolve({ exists: true, data: () => member }),
        }),
        where: (_field: string, _op: string, value: string) => ({
          get: () =>
            Promise.resolve({
              docs: value === member.uid
                ? [{ id: `${member.orgId}_${member.uid}`, data: () => member }]
                : [],
            }),
        }),
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
    if (name === 'saved_views') {
      const chain = {
        where: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        get: jest.fn().mockResolvedValue({
          docs: viewDocs.map((v) => ({ id: v.id, data: () => v })),
        }),
        doc: jest.fn().mockImplementation((docId?: string) => ({
          id: docId ?? 'new-view-id',
          set: capturedSet,
          delete: capturedDelete,
          get: jest.fn().mockResolvedValue({
            exists: viewDocs.some((v) => v.id === docId),
            data: () => viewDocs.find((v) => v.id === docId) ?? {},
          }),
        })),
      }
      return chain
    }
    return { doc: () => ({ get: () => Promise.resolve({ exists: false }) }) }
  })
}

// ---------------------------------------------------------------------------
// Helper: stage with a custom saved_views implementation that captures wheres
// ---------------------------------------------------------------------------
function stageAuthWithWhereCapture(
  member: { uid: string; orgId: string; role: string },
  capturedWheres: Array<[string, string, unknown]>,
) {
  ;(adminAuth.verifySessionCookie as jest.Mock).mockResolvedValue({ uid: member.uid })
  ;(adminDb.collection as jest.Mock).mockImplementation((name: string) => {
    if (name === 'users') {
      return { doc: () => ({ get: () => Promise.resolve({ exists: true, data: () => ({ activeOrgId: member.orgId }) }) }) }
    }
    if (name === 'orgMembers') {
      return {
        doc: () => ({ get: () => Promise.resolve({ exists: true, data: () => member }) }),
        where: (_field: string, _op: string, value: string) => ({
          get: () =>
            Promise.resolve({
              docs: value === member.uid
                ? [{ id: `${member.orgId}_${member.uid}`, data: () => member }]
                : [],
            }),
        }),
      }
    }
    if (name === 'organizations') {
      return { doc: () => ({ get: () => Promise.resolve({ exists: true, data: () => ({ settings: {} }) }) }) }
    }
    if (name === 'saved_views') {
      const chain = {
        where: jest.fn().mockImplementation((field: string, op: string, val: unknown) => {
          capturedWheres.push([field, op, val])
          return chain
        }),
        orderBy: jest.fn().mockReturnThis(),
        get: jest.fn().mockResolvedValue({ docs: [] }),
      }
      return chain
    }
    return { doc: () => ({ get: () => Promise.resolve({ exists: false }) }) }
  })
}

// ---------------------------------------------------------------------------
// GET — viewer+ sees only own views
// ---------------------------------------------------------------------------

describe('GET /api/v1/crm/saved-views', () => {
  it('returns own views for viewer', async () => {
    const member = seedOrgMember('org-a', 'uid-viewer-1', { role: 'viewer' })
    stageAuth(member, {
      viewDocs: [
        {
          id: 'view-1',
          orgId: 'org-a',
          uid: 'uid-viewer-1',
          resourceKind: 'contacts',
          name: 'My leads',
          filters: { stage: 'new' },
        },
      ],
    })
    const req = callAsMember(member, 'GET', '/api/v1/crm/saved-views?resourceKind=contacts')
    const res = await GET(req)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.data.views).toHaveLength(1)
    expect(body.data.views[0].name).toBe('My leads')
  })

  it('keeps Firestore uid filtering out of the list query', async () => {
    const member = seedOrgMember('org-a', 'uid-user-2', { role: 'viewer' })
    const capturedWheres: Array<[string, string, unknown]> = []
    stageAuthWithWhereCapture(member, capturedWheres)

    const req = callAsMember(member, 'GET', '/api/v1/crm/saved-views?resourceKind=contacts')
    await GET(req)

    expect(capturedWheres).toEqual([['orgId', '==', 'org-a']])
  })

  it('keeps Firestore resourceKind filtering out of the list query', async () => {
    const member = seedOrgMember('org-a', 'uid-rk', { role: 'viewer' })
    const capturedWheres: Array<[string, string, unknown]> = []
    stageAuthWithWhereCapture(member, capturedWheres)

    const req = callAsMember(member, 'GET', '/api/v1/crm/saved-views?resourceKind=deals')
    await GET(req)

    expect(capturedWheres).toEqual([['orgId', '==', 'org-a']])
  })
})

// ---------------------------------------------------------------------------
// POST — member+ creates a view
// ---------------------------------------------------------------------------

describe('POST /api/v1/crm/saved-views', () => {
  it('creates a saved view with uid + orgId set correctly', async () => {
    const member = seedOrgMember('org-b', 'uid-member-1', { role: 'member' })
    const capturedSet = jest.fn().mockResolvedValue(undefined)
    stageAuth(member, { capturedSet })

    const req = callAsMember(member, 'POST', '/api/v1/crm/saved-views', {
      name: 'My open leads',
      resourceKind: 'contacts',
      filters: { stage: 'new', type: 'lead' },
    })
    const res = await POST(req)
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.data.id).toBeDefined()

    expect(capturedSet).toHaveBeenCalledTimes(1)
    const written = capturedSet.mock.calls[0][0]
    expect(written.uid).toBe('uid-member-1')
    expect(written.orgId).toBe('org-b')
    expect(written.name).toBe('My open leads')
    expect(written.filters).toEqual({ stage: 'new', type: 'lead' })
  })

  it('returns 400 for empty name', async () => {
    const member = seedOrgMember('org-b', 'uid-member-2', { role: 'member' })
    stageAuth(member)

    const req = callAsMember(member, 'POST', '/api/v1/crm/saved-views', {
      name: '   ',
      resourceKind: 'contacts',
      filters: {},
    })
    const res = await POST(req)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.success).toBe(false)
  })

  it('returns 400 for missing name', async () => {
    const member = seedOrgMember('org-b', 'uid-member-3', { role: 'member' })
    stageAuth(member)

    const req = callAsMember(member, 'POST', '/api/v1/crm/saved-views', {
      resourceKind: 'contacts',
      filters: {},
    })
    const res = await POST(req)
    expect(res.status).toBe(400)
  })

  it('agent Bearer POST creates view with success', async () => {
    const capturedSet = jest.fn().mockResolvedValue(undefined)
    ;(adminDb.collection as jest.Mock).mockImplementation((name: string) => {
      if (name === 'organizations') {
        return { doc: () => ({ get: () => Promise.resolve({ exists: true, data: () => ({ settings: {} }) }) }) }
      }
      if (name === 'saved_views') {
        return {
          doc: jest.fn().mockReturnValue({ id: 'agent-view-id', set: capturedSet }),
        }
      }
      return { doc: () => ({ get: () => Promise.resolve({ exists: false }) }) }
    })

    const req = callAsAgent('org-c', 'POST', '/api/v1/crm/saved-views', {
      name: 'Agent view',
      resourceKind: 'contacts',
      filters: { stage: 'new' },
    })
    const res = await POST(req)
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.success).toBe(true)
    // Agent uid is 'agent:pip'
    expect(capturedSet.mock.calls[0][0].uid).toBe('agent:pip')
  })

  it('returns 403 for viewer trying to POST', async () => {
    const member = seedOrgMember('org-b', 'uid-viewer-post', { role: 'viewer' })
    stageAuth(member)

    const req = callAsMember(member, 'POST', '/api/v1/crm/saved-views', {
      name: 'Should fail',
      resourceKind: 'contacts',
      filters: {},
    })
    const res = await POST(req)
    expect(res.status).toBe(403)
  })
})

// ---------------------------------------------------------------------------
// DELETE — member+ own view
// ---------------------------------------------------------------------------

describe('DELETE /api/v1/crm/saved-views/[id]', () => {
  it('deletes own view and returns 200', async () => {
    const member = seedOrgMember('org-d', 'uid-del-1', { role: 'member' })
    const capturedDelete = jest.fn().mockResolvedValue(undefined)

    stageAuth(member, {
      viewDocs: [
        { id: 'view-own', orgId: 'org-d', uid: 'uid-del-1', resourceKind: 'contacts', name: 'Mine', filters: {} },
      ],
      capturedDelete,
    })

    const req = callAsMember(member, 'DELETE', '/api/v1/crm/saved-views/view-own')
    const res = await DELETE(req, { params: Promise.resolve({ id: 'view-own' }) })
    expect(res.status).toBe(200)
    expect(capturedDelete).toHaveBeenCalledTimes(1)
  })

  it('returns 404 when deleting another user\'s view (same org)', async () => {
    const member = seedOrgMember('org-d', 'uid-del-2', { role: 'member' })

    stageAuth(member, {
      viewDocs: [
        { id: 'view-other', orgId: 'org-d', uid: 'uid-other-user', resourceKind: 'contacts', name: 'Theirs', filters: {} },
      ],
    })

    const req = callAsMember(member, 'DELETE', '/api/v1/crm/saved-views/view-other')
    const res = await DELETE(req, { params: Promise.resolve({ id: 'view-other' }) })
    expect(res.status).toBe(404)
  })

  it('returns 404 for cross-org view', async () => {
    const member = seedOrgMember('org-d', 'uid-del-3', { role: 'member' })

    stageAuth(member, {
      viewDocs: [
        { id: 'view-cross', orgId: 'org-other', uid: 'uid-del-3', resourceKind: 'contacts', name: 'Cross', filters: {} },
      ],
    })

    const req = callAsMember(member, 'DELETE', '/api/v1/crm/saved-views/view-cross')
    const res = await DELETE(req, { params: Promise.resolve({ id: 'view-cross' }) })
    expect(res.status).toBe(404)
  })

  it('returns 404 for non-existent view', async () => {
    const member = seedOrgMember('org-d', 'uid-del-4', { role: 'member' })
    stageAuth(member, { viewDocs: [] })

    const req = callAsMember(member, 'DELETE', '/api/v1/crm/saved-views/does-not-exist')
    const res = await DELETE(req, { params: Promise.resolve({ id: 'does-not-exist' }) })
    expect(res.status).toBe(404)
  })
})
