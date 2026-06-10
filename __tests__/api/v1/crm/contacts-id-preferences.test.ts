// __tests__/api/v1/crm/contacts-id-preferences.test.ts
//
// Tests for GET / PUT /api/v1/contacts/[id]/preferences
// Role matrix: GET → viewer, PUT → member

jest.mock('@/lib/firebase/admin', () => ({
  adminAuth: { verifySessionCookie: jest.fn() },
  adminDb: { collection: jest.fn() },
}))

// Preferences store reads from two collections (contacts + contact_preferences).
// We mock it so individual collection behaviour is controlled in stageAuth.
jest.mock('@/lib/preferences/store', () => ({
  getContactPreferences: jest.fn(),
  setContactPreferences: jest.fn(),
}))

import { adminAuth, adminDb } from '@/lib/firebase/admin'
import { getContactPreferences, setContactPreferences } from '@/lib/preferences/store'
import { seedOrgMember, callAsMember, callAsAgent } from '../../../helpers/crm'
import type { ContactPreferences } from '@/lib/preferences/types'
import { makePortalAuthCollections } from '../../../helpers/firebase-admin'

const AI_API_KEY = 'test-ai-key-prefs'
process.env.AI_API_KEY = AI_API_KEY
process.env.SESSION_COOKIE_NAME = '__session'

const routeCtx = (id: string) => ({ params: Promise.resolve({ id }) })

function makePrefs(orgId: string, overrides: Partial<ContactPreferences> = {}): ContactPreferences {
  return {
    contactId: 'c1',
    orgId,
    topics: { newsletter: true, 'product-updates': true },
    frequency: 'all',
    unsubscribeAllAt: null,
    updatedAt: null,
    updatedFrom: 'admin',
    ...overrides,
  } as ContactPreferences
}

/**
 * Stage auth mocks for the crm-middleware cookie path.
 * contacts collection is also mocked for the loadContact helper.
 */
function stageAuth(
  member: { uid: string; orgId: string; role: string; firstName?: string; lastName?: string },
  opts?: {
    contact?: { id: string; data: Record<string, unknown> } | null
  },
) {
  ;(adminAuth.verifySessionCookie as jest.Mock).mockResolvedValue({ uid: member.uid })
  const authCollections = makePortalAuthCollections(member)
  ;(adminDb.collection as jest.Mock).mockImplementation((name: string) => {
    if (name in authCollections) return authCollections[name as keyof typeof authCollections]
    if (name === 'users') {
      return {
        doc: () => ({
          get: () =>
            Promise.resolve({ exists: true, data: () => ({ activeOrgId: member.orgId }) }),
        }),
      }
    }
    if (name === 'orgMembers') {
      return {
        doc: () => ({
          get: () => Promise.resolve({ exists: true, data: () => member }),
        }),
      }
    }
    if (name === 'organizations') {
      return {
        doc: () => ({
          get: () =>
            Promise.resolve({
              exists: true,
              data: () => ({ settings: { permissions: {} } }),
            }),
        }),
      }
    }
    if (name === 'contacts') {
      const contact = opts?.contact
      return {
        doc: jest.fn().mockReturnValue({
          id: contact?.id ?? 'c1',
          get: jest.fn().mockResolvedValue({
            exists: contact != null,
            id: contact?.id ?? 'c1',
            data: () => contact?.data ?? {},
          }),
        }),
      }
    }
    return { doc: () => ({ get: () => Promise.resolve({ exists: false }) }) }
  })
}

// ---------------------------------------------------------------------------
// GET /api/v1/contacts/[id]/preferences
// ---------------------------------------------------------------------------

describe('GET /api/v1/contacts/[id]/preferences', () => {
  beforeEach(() => jest.clearAllMocks())

  it('viewer GET own org → 200', async () => {
    const viewer = seedOrgMember('org-1', 'uid-v', { role: 'viewer' })
    stageAuth(viewer, {
      contact: { id: 'c1', data: { orgId: 'org-1', deleted: false } },
    })
    const prefs = makePrefs('org-1')
    ;(getContactPreferences as jest.Mock).mockResolvedValue(prefs)

    const req = callAsMember(viewer, 'GET', '/api/v1/contacts/c1/preferences')
    const { GET } = await import('@/app/api/v1/contacts/[id]/preferences/route')
    const res = await GET(req, routeCtx('c1'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
  })

  it('viewer GET cross-org → 404', async () => {
    const viewer = seedOrgMember('org-1', 'uid-v', { role: 'viewer' })
    stageAuth(viewer, {
      // Contact belongs to org-2, caller is org-1
      contact: { id: 'c-other', data: { orgId: 'org-2', deleted: false } },
    })

    const req = callAsMember(viewer, 'GET', '/api/v1/contacts/c-other/preferences')
    const { GET } = await import('@/app/api/v1/contacts/[id]/preferences/route')
    const res = await GET(req, routeCtx('c-other'))
    expect(res.status).toBe(404)
  })

  it('viewer GET soft-deleted contact → 404', async () => {
    const viewer = seedOrgMember('org-1', 'uid-v', { role: 'viewer' })
    stageAuth(viewer, {
      contact: { id: 'c-del', data: { orgId: 'org-1', deleted: true } },
    })

    const req = callAsMember(viewer, 'GET', '/api/v1/contacts/c-del/preferences')
    const { GET } = await import('@/app/api/v1/contacts/[id]/preferences/route')
    const res = await GET(req, routeCtx('c-del'))
    expect(res.status).toBe(404)
  })
})

// ---------------------------------------------------------------------------
// PUT /api/v1/contacts/[id]/preferences
// ---------------------------------------------------------------------------

describe('PUT /api/v1/contacts/[id]/preferences', () => {
  beforeEach(() => jest.clearAllMocks())

  it('viewer cannot PUT → 403', async () => {
    const viewer = seedOrgMember('org-1', 'uid-v', { role: 'viewer' })
    stageAuth(viewer, {
      contact: { id: 'c1', data: { orgId: 'org-1', deleted: false } },
    })

    const req = callAsMember(viewer, 'PUT', '/api/v1/contacts/c1/preferences', {
      frequency: 'weekly',
    })
    const { PUT } = await import('@/app/api/v1/contacts/[id]/preferences/route')
    const res = await PUT(req, routeCtx('c1'))
    expect(res.status).toBe(403)
  })

  it('member PUT updates preferences → 200', async () => {
    const member = seedOrgMember('org-1', 'uid-m', { role: 'member' })
    stageAuth(member, {
      contact: { id: 'c1', data: { orgId: 'org-1', deleted: false } },
    })
    const updated = makePrefs('org-1', { frequency: 'weekly' })
    ;(setContactPreferences as jest.Mock).mockResolvedValue(updated)

    const req = callAsMember(member, 'PUT', '/api/v1/contacts/c1/preferences', {
      frequency: 'weekly',
    })
    const { PUT } = await import('@/app/api/v1/contacts/[id]/preferences/route')
    const res = await PUT(req, routeCtx('c1'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(setContactPreferences as jest.Mock).toHaveBeenCalledWith(
      expect.objectContaining({ contactId: 'c1', orgId: 'org-1', updatedFrom: 'admin' }),
    )
  })

  it('agent (Bearer) PUT → 200', async () => {
    // Wire up org+contacts for the Bearer path (no cookie)
    ;(adminDb.collection as jest.Mock).mockImplementation((name: string) => {
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
            id: 'c1',
            get: jest.fn().mockResolvedValue({
              exists: true,
              id: 'c1',
              data: () => ({ orgId: 'org-agent', deleted: false }),
            }),
          }),
        }
      }
      return { doc: () => ({ get: () => Promise.resolve({ exists: false }) }) }
    })
    const updated = makePrefs('org-agent', { frequency: 'monthly' })
    ;(setContactPreferences as jest.Mock).mockResolvedValue(updated)

    const req = callAsAgent('org-agent', 'PUT', '/api/v1/contacts/c1/preferences', {
      frequency: 'monthly',
    }, AI_API_KEY)
    const { PUT } = await import('@/app/api/v1/contacts/[id]/preferences/route')
    const res = await PUT(req, routeCtx('c1'))
    expect(res.status).toBe(200)
    expect(setContactPreferences as jest.Mock).toHaveBeenCalled()
  })

  it('empty body → 400', async () => {
    const member = seedOrgMember('org-1', 'uid-m', { role: 'member' })
    stageAuth(member, {
      contact: { id: 'c1', data: { orgId: 'org-1', deleted: false } },
    })

    // Send null/empty body that fails JSON parse
    const { NextRequest } = require('next/server')
    const req = new NextRequest('http://localhost/api/v1/contacts/c1/preferences', {
      method: 'PUT',
      headers: new Headers({ cookie: `__session=test-session-uid-m` }),
      body: null,
    })
    const { PUT } = await import('@/app/api/v1/contacts/[id]/preferences/route')
    const res = await PUT(req, routeCtx('c1'))
    expect(res.status).toBe(400)
  })

  it('invalid frequency value → 400', async () => {
    const member = seedOrgMember('org-1', 'uid-m', { role: 'member' })
    stageAuth(member, {
      contact: { id: 'c1', data: { orgId: 'org-1', deleted: false } },
    })

    const req = callAsMember(member, 'PUT', '/api/v1/contacts/c1/preferences', {
      frequency: 'INVALID_FREQUENCY',
    })
    const { PUT } = await import('@/app/api/v1/contacts/[id]/preferences/route')
    const res = await PUT(req, routeCtx('c1'))
    expect(res.status).toBe(400)
  })

  it('cross-org PUT → 404', async () => {
    const member = seedOrgMember('org-1', 'uid-m', { role: 'member' })
    stageAuth(member, {
      // Contact belongs to org-2
      contact: { id: 'c-other', data: { orgId: 'org-2', deleted: false } },
    })

    const req = callAsMember(member, 'PUT', '/api/v1/contacts/c-other/preferences', {
      frequency: 'weekly',
    })
    const { PUT } = await import('@/app/api/v1/contacts/[id]/preferences/route')
    const res = await PUT(req, routeCtx('c-other'))
    expect(res.status).toBe(404)
  })
})
