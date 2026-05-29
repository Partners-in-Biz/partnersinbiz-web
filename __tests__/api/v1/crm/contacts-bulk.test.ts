import { NextRequest } from 'next/server'

jest.mock('@/lib/firebase/admin', () => ({
  adminAuth: { verifySessionCookie: jest.fn() },
  adminDb: { collection: jest.fn(), batch: jest.fn() },
}))

// FieldValue operations need to be inspectable — use real stubs
jest.mock('firebase-admin/firestore', () => {
  const serverTimestampSentinel = { _type: 'serverTimestamp' }
  const deleteSentinel = { _type: 'deleteField' }
  const arrayUnionSentinel = (...vals: unknown[]) => ({ _type: 'arrayUnion', vals })
  const arrayRemoveSentinel = (...vals: unknown[]) => ({ _type: 'arrayRemove', vals })
  return {
    FieldValue: {
      serverTimestamp: () => serverTimestampSentinel,
      delete: () => deleteSentinel,
      arrayUnion: arrayUnionSentinel,
      arrayRemove: arrayRemoveSentinel,
    },
    Timestamp: {
      now: () => ({ seconds: 0, nanoseconds: 0, toDate: () => new Date() }),
    },
  }
})

import { adminAuth, adminDb } from '@/lib/firebase/admin'
import { seedOrgMember, callAsMember, callAsAgent } from '../../../helpers/crm'

const AI_API_KEY = 'test-ai-key-bulk'
process.env.AI_API_KEY = AI_API_KEY
process.env.SESSION_COOKIE_NAME = '__session'

// Suppress activity / webhook noise
jest.mock('@/lib/activity/log', () => ({ logActivity: jest.fn().mockResolvedValue(undefined) }))
jest.mock('@/lib/webhooks/dispatch', () => ({ dispatchWebhook: jest.fn().mockResolvedValue(undefined) }))

// ── Test double for a contact document ───────────────────────────────────────

function makeContactSnap(
  id: string,
  orgId: string,
  overrides: Record<string, unknown> = {},
) {
  const data = {
    orgId,
    name: `Contact ${id}`,
    email: `${id}@test.com`,
    stage: 'new',
    type: 'lead',
    tags: [] as string[],
    deleted: false,
    ...overrides,
  }
  return {
    exists: true,
    id,
    ref: { id, update: jest.fn().mockResolvedValue(undefined) },
    data: () => data,
  }
}

function missingSnap(id: string) {
  return { exists: false, id, ref: { id } }
}

// ── stageAuth helper ──────────────────────────────────────────────────────────
//
// Mirrors the pattern from contacts.test.ts and wires up per-test contact snaps.

type ContactDocMap = Record<string, ReturnType<typeof makeContactSnap> | ReturnType<typeof missingSnap>>

function stageAuth(
  member: { uid: string; orgId: string; role: string; firstName?: string; lastName?: string },
  contactDocs: ContactDocMap = {},
  orgMemberDocs: Record<string, unknown> = {},
) {
  ;(adminAuth.verifySessionCookie as jest.Mock).mockResolvedValue({ uid: member.uid })

  // Shared batch mock — captured so tests can inspect calls
  const batchUpdateMock = jest.fn()
  const batchCommitMock = jest.fn().mockResolvedValue(undefined)
  const batchMock = { update: batchUpdateMock, commit: batchCommitMock }
  ;(adminDb.batch as jest.Mock).mockReturnValue(batchMock)

  ;(adminDb.collection as jest.Mock).mockImplementation((name: string) => {
    if (name === 'users') {
      return {
        doc: () => ({
          get: () => Promise.resolve({ exists: true, data: () => ({ activeOrgId: member.orgId }) }),
        }),
      }
    }
    if (name === 'orgMembers') {
      const callerKey = `${member.orgId}_${member.uid}`
      const callerDoc = {
        id: callerKey,
        exists: true,
        data: () => ({ ...member, orgId: member.orgId, uid: member.uid }),
      }

      return {
        where: (field: string, op: string, value: string) => ({
          get: () => {
            if (field === 'uid' && op === '==' && value === member.uid) {
              return Promise.resolve({ docs: [callerDoc] })
            }
            return Promise.resolve({ docs: [] })
          },
        }),
        doc: (id: string) => ({
          get: () => {
            // Always resolve the caller's own member doc
            if (id === callerKey) {
              return Promise.resolve(callerDoc)
            }
            // Look up assignedTo resolutions
            const extra = orgMemberDocs[id]
            if (extra) return Promise.resolve({ exists: true, data: () => extra })
            return Promise.resolve({ exists: false })
          },
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
        doc: (id: string) => {
          const snap = contactDocs[id] ?? missingSnap(id)
          return { get: () => Promise.resolve(snap) }
        },
      }
    }
    return { doc: () => ({ get: () => Promise.resolve({ exists: false }) }) }
  })

  return { batchUpdateMock, batchCommitMock, batchMock }
}

// ── Helpers to build contacts in a given org ──────────────────────────────────

function orgContacts(
  orgId: string,
  ids: string[],
  overrides: Record<string, unknown> = {},
): ContactDocMap {
  return Object.fromEntries(ids.map((id) => [id, makeContactSnap(id, orgId, overrides)]))
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('POST /api/v1/crm/contacts/bulk', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  // ── Happy path: add tags ───────────────────────────────────────────────────

  it('bulk-updates tags (add) for 3 own-org contacts → updated: 3, skipped: 0', async () => {
    const member = seedOrgMember('org-A', 'uid-m1', { role: 'member' })
    const ids = ['c1', 'c2', 'c3']
    const { batchUpdateMock } = stageAuth(member, orgContacts('org-A', ids))

    const req = callAsMember(member, 'POST', '/api/v1/crm/contacts/bulk', {
      ids,
      patch: { tags: { add: ['hot', 'vip'] } },
    })
    const { POST } = await import('@/app/api/v1/crm/contacts/bulk/route')
    const res = await POST(req)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.data.updated).toBe(3)
    expect(body.data.skipped).toBe(0)
    expect(body.data.failed).toHaveLength(0)
    // batch.update should have been called 3 times
    expect(batchUpdateMock).toHaveBeenCalledTimes(3)
    // tags field should be arrayUnion sentinel
    const firstCallArgs = batchUpdateMock.mock.calls[0][1]
    expect(firstCallArgs.tags._type).toBe('arrayUnion')
    expect(firstCallArgs.tags.vals).toEqual(['hot', 'vip'])
  })

  // ── Cross-org ID → skipped ─────────────────────────────────────────────────

  it('skips a cross-org contact ID (not failed)', async () => {
    const member = seedOrgMember('org-A', 'uid-m2', { role: 'member' })
    const ownId = 'c-own'
    const crossId = 'c-cross'
    const docs: ContactDocMap = {
      [ownId]: makeContactSnap(ownId, 'org-A'),
      [crossId]: makeContactSnap(crossId, 'org-B'), // different org
    }
    stageAuth(member, docs)

    const req = callAsMember(member, 'POST', '/api/v1/crm/contacts/bulk', {
      ids: [ownId, crossId],
      patch: { stage: 'contacted' },
    })
    const { POST } = await import('@/app/api/v1/crm/contacts/bulk/route')
    const res = await POST(req)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data.updated).toBe(1)
    expect(body.data.skipped).toBe(1)
    expect(body.data.failed).toHaveLength(0)
  })

  // ── Non-existent ID → skipped ──────────────────────────────────────────────

  it('skips a non-existent contact ID', async () => {
    const member = seedOrgMember('org-A', 'uid-m3', { role: 'member' })
    const ownId = 'c-exists'
    const docs: ContactDocMap = {
      [ownId]: makeContactSnap(ownId, 'org-A'),
      'c-ghost': missingSnap('c-ghost'),
    }
    stageAuth(member, docs)

    const req = callAsMember(member, 'POST', '/api/v1/crm/contacts/bulk', {
      ids: [ownId, 'c-ghost'],
      patch: { type: 'prospect' },
    })
    const { POST } = await import('@/app/api/v1/crm/contacts/bulk/route')
    const res = await POST(req)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data.updated).toBe(1)
    expect(body.data.skipped).toBe(1)
  })

  // ── Soft-deleted contact → skipped ────────────────────────────────────────

  it('skips a soft-deleted contact', async () => {
    const member = seedOrgMember('org-A', 'uid-m4', { role: 'member' })
    const activeId = 'c-active'
    const deletedId = 'c-deleted'
    const docs: ContactDocMap = {
      [activeId]: makeContactSnap(activeId, 'org-A'),
      [deletedId]: makeContactSnap(deletedId, 'org-A', { deleted: true }),
    }
    stageAuth(member, docs)

    const req = callAsMember(member, 'POST', '/api/v1/crm/contacts/bulk', {
      ids: [activeId, deletedId],
      patch: { stage: 'won' },
    })
    const { POST } = await import('@/app/api/v1/crm/contacts/bulk/route')
    const res = await POST(req)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data.updated).toBe(1)
    expect(body.data.skipped).toBe(1)
  })

  // ── Validation: empty ids → 400 ───────────────────────────────────────────

  it('returns 400 for empty ids array', async () => {
    const member = seedOrgMember('org-A', 'uid-v1', { role: 'member' })
    stageAuth(member)

    const req = callAsMember(member, 'POST', '/api/v1/crm/contacts/bulk', {
      ids: [],
      patch: { stage: 'new' },
    })
    const { POST } = await import('@/app/api/v1/crm/contacts/bulk/route')
    const res = await POST(req)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/non-empty/i)
  })

  // ── Validation: 201 ids → 400 ─────────────────────────────────────────────

  it('returns 400 when ids array exceeds 200', async () => {
    const member = seedOrgMember('org-A', 'uid-v2', { role: 'member' })
    stageAuth(member)

    const ids = Array.from({ length: 201 }, (_, i) => `c${i}`)
    const req = callAsMember(member, 'POST', '/api/v1/crm/contacts/bulk', {
      ids,
      patch: { stage: 'new' },
    })
    const { POST } = await import('@/app/api/v1/crm/contacts/bulk/route')
    const res = await POST(req)
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/200/i)
  })

  // ── Validation: empty patch → 400 ────────────────────────────────────────

  it('returns 400 for empty patch', async () => {
    const member = seedOrgMember('org-A', 'uid-v3', { role: 'member' })
    stageAuth(member, orgContacts('org-A', ['c1']))

    const req = callAsMember(member, 'POST', '/api/v1/crm/contacts/bulk', {
      ids: ['c1'],
      patch: {},
    })
    const { POST } = await import('@/app/api/v1/crm/contacts/bulk/route')
    const res = await POST(req)
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/No editable fields/i)
  })

  // ── Validation: invalid stage → 400 ──────────────────────────────────────

  it('returns 400 for invalid stage value', async () => {
    const member = seedOrgMember('org-A', 'uid-v4', { role: 'member' })
    stageAuth(member, orgContacts('org-A', ['c1']))

    const req = callAsMember(member, 'POST', '/api/v1/crm/contacts/bulk', {
      ids: ['c1'],
      patch: { stage: 'not-a-stage' },
    })
    const { POST } = await import('@/app/api/v1/crm/contacts/bulk/route')
    const res = await POST(req)
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/Invalid stage/i)
  })

  // ── Validation: invalid type → 400 ───────────────────────────────────────

  it('returns 400 for invalid type value', async () => {
    const member = seedOrgMember('org-A', 'uid-v5', { role: 'member' })
    stageAuth(member, orgContacts('org-A', ['c1']))

    const req = callAsMember(member, 'POST', '/api/v1/crm/contacts/bulk', {
      ids: ['c1'],
      patch: { type: 'vip' },
    })
    const { POST } = await import('@/app/api/v1/crm/contacts/bulk/route')
    const res = await POST(req)
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/Invalid type/i)
  })

  // ── Validation: tags add + remove together → 400 ─────────────────────────

  it('returns 400 when tags.add and tags.remove are both present', async () => {
    const member = seedOrgMember('org-A', 'uid-v6', { role: 'member' })
    stageAuth(member, orgContacts('org-A', ['c1']))

    const req = callAsMember(member, 'POST', '/api/v1/crm/contacts/bulk', {
      ids: ['c1'],
      patch: { tags: { add: ['a'], remove: ['b'] } },
    })
    const { POST } = await import('@/app/api/v1/crm/contacts/bulk/route')
    const res = await POST(req)
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/tags\.add and tags\.remove/i)
  })

  // ── Agent (Bearer) can bulk-update ────────────────────────────────────────

  it('agent (Bearer) can bulk-update contacts → 200', async () => {
    const ids = ['ca1', 'ca2']
    // Wire org + contacts for the agent path
    ;(adminDb.collection as jest.Mock).mockImplementation((name: string) => {
      if (name === 'organizations') {
        return {
          doc: () => ({
            get: () => Promise.resolve({ exists: true, data: () => ({ settings: { permissions: {} } }) }),
          }),
        }
      }
      if (name === 'contacts') {
        return {
          doc: (id: string) => ({
            get: () => Promise.resolve(makeContactSnap(id, 'org-agent')),
          }),
        }
      }
      return { doc: () => ({ get: () => Promise.resolve({ exists: false }) }) }
    })
    const batchUpdateMock = jest.fn()
    const batchCommitMock = jest.fn().mockResolvedValue(undefined)
    ;(adminDb.batch as jest.Mock).mockReturnValue({ update: batchUpdateMock, commit: batchCommitMock })

    const req = callAsAgent('org-agent', 'POST', '/api/v1/crm/contacts/bulk', {
      ids,
      patch: { stage: 'contacted' },
    }, AI_API_KEY)
    const { POST } = await import('@/app/api/v1/crm/contacts/bulk/route')
    const res = await POST(req)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data.updated).toBe(2)
  })

  // ── Viewer cannot bulk-update → 403 ───────────────────────────────────────

  it('viewer gets 403', async () => {
    const member = seedOrgMember('org-A', 'uid-viewer', { role: 'viewer' })
    stageAuth(member, orgContacts('org-A', ['c1']))

    const req = callAsMember(member, 'POST', '/api/v1/crm/contacts/bulk', {
      ids: ['c1'],
      patch: { stage: 'contacted' },
    })
    const { POST } = await import('@/app/api/v1/crm/contacts/bulk/route')
    const res = await POST(req)
    expect(res.status).toBe(403)
  })

  // ── assignedTo writes assignedToRef snapshot ──────────────────────────────

  it('assignedTo update writes assignedToRef snapshot from orgMembers', async () => {
    const member = seedOrgMember('org-1', 'uid-admin', { role: 'admin', firstName: 'Admin', lastName: 'User' })
    const targetMember = { uid: 'uid-assign', firstName: 'Bob', lastName: 'Smith', role: 'member' }
    const ids = ['cx1']

    const batchUpdateMock = jest.fn()
    const batchCommitMock = jest.fn().mockResolvedValue(undefined)

    ;(adminAuth.verifySessionCookie as jest.Mock).mockResolvedValue({ uid: member.uid })
    ;(adminDb.batch as jest.Mock).mockReturnValue({ update: batchUpdateMock, commit: batchCommitMock })
    ;(adminDb.collection as jest.Mock).mockImplementation((name: string) => {
      if (name === 'users') {
        return {
          doc: () => ({ get: () => Promise.resolve({ exists: true, data: () => ({ activeOrgId: 'org-1' }) }) }),
        }
      }
      if (name === 'orgMembers') {
        const callerDoc = {
          id: 'org-1_uid-admin',
          exists: true,
          data: () => ({ ...member, orgId: 'org-1', uid: 'uid-admin' }),
        }
        return {
          where: (field: string, op: string, value: string) => ({
            get: () => {
              if (field === 'uid' && op === '==' && value === 'uid-admin') {
                return Promise.resolve({ docs: [callerDoc] })
              }
              return Promise.resolve({ docs: [] })
            },
          }),
          doc: (id: string) => ({
            get: () => {
              if (id === 'org-1_uid-admin') return Promise.resolve(callerDoc)
              if (id === 'org-1_uid-assign') return Promise.resolve({ exists: true, data: () => targetMember })
              return Promise.resolve({ exists: false })
            },
          }),
        }
      }
      if (name === 'organizations') {
        return {
          doc: () => ({ get: () => Promise.resolve({ exists: true, data: () => ({ settings: { permissions: {} } }) }) }),
        }
      }
      if (name === 'contacts') {
        return {
          doc: () => ({ get: () => Promise.resolve(makeContactSnap('cx1', 'org-1')) }),
        }
      }
      return { doc: () => ({ get: () => Promise.resolve({ exists: false }) }) }
    })

    const req = callAsMember(member, 'POST', '/api/v1/crm/contacts/bulk', {
      ids,
      patch: { assignedTo: 'uid-assign' },
    })
    const { POST } = await import('@/app/api/v1/crm/contacts/bulk/route')
    const res = await POST(req)
    expect(res.status).toBe(200)
    expect(batchUpdateMock).toHaveBeenCalledTimes(1)
    const written = batchUpdateMock.mock.calls[0][1]
    expect(written.assignedTo).toBe('uid-assign')
    expect(written.assignedToRef.displayName).toBe('Bob Smith')
    expect(written.assignedToRef.kind).toBe('human')
  })

  // ── tags.remove applies arrayRemove ────────────────────────────────────────

  it('tags remove uses arrayRemove sentinel', async () => {
    const member = seedOrgMember('org-A', 'uid-m5', { role: 'member' })
    const ids = ['c-tags']
    const { batchUpdateMock } = stageAuth(member, orgContacts('org-A', ids))

    const req = callAsMember(member, 'POST', '/api/v1/crm/contacts/bulk', {
      ids,
      patch: { tags: { remove: ['old-tag'] } },
    })
    const { POST } = await import('@/app/api/v1/crm/contacts/bulk/route')
    const res = await POST(req)
    expect(res.status).toBe(200)
    const written = batchUpdateMock.mock.calls[0][1]
    expect(written.tags._type).toBe('arrayRemove')
    expect(written.tags.vals).toEqual(['old-tag'])
  })

  // ── Unauthenticated → 401 ─────────────────────────────────────────────────

  it('returns 401 without auth', async () => {
    const req = new NextRequest('http://localhost/api/v1/crm/contacts/bulk', {
      method: 'POST',
      headers: new Headers({ 'content-type': 'application/json' }),
      body: JSON.stringify({ ids: ['c1'], patch: { stage: 'new' } }),
    })
    const { POST } = await import('@/app/api/v1/crm/contacts/bulk/route')
    const res = await POST(req)
    expect(res.status).toBe(401)
  })

  // ─────────────────────────────────────────────────────────────────────────────
  // DELETE action
  // ─────────────────────────────────────────────────────────────────────────────

  describe('DELETE action', () => {
    beforeEach(() => {
      jest.clearAllMocks()
    })

    it('soft-deletes all matching own-org contacts → updated: 3, skipped: 0', async () => {
      const member = seedOrgMember('org-A', 'uid-del1', { role: 'member' })
      const ids = ['d1', 'd2', 'd3']
      const { batchUpdateMock, batchCommitMock } = stageAuth(member, orgContacts('org-A', ids))

      const req = callAsMember(member, 'POST', '/api/v1/crm/contacts/bulk', {
        ids,
        patch: { delete: true },
      })
      const { POST } = await import('@/app/api/v1/crm/contacts/bulk/route')
      const res = await POST(req)
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.success).toBe(true)
      expect(body.data.updated).toBe(3)
      expect(body.data.skipped).toBe(0)
      expect(body.data.failed).toHaveLength(0)
      expect(batchUpdateMock).toHaveBeenCalledTimes(3)
      expect(batchCommitMock).toHaveBeenCalledTimes(1)
      // Each update should set deleted: true
      for (const call of batchUpdateMock.mock.calls) {
        expect(call[1].deleted).toBe(true)
        expect(call[1].updatedAt._type).toBe('serverTimestamp')
      }
    })

    it('skips contacts belonging to another org', async () => {
      const member = seedOrgMember('org-A', 'uid-del2', { role: 'member' })
      const ownId = 'd-own'
      const crossId = 'd-cross'
      const docs: ContactDocMap = {
        [ownId]: makeContactSnap(ownId, 'org-A'),
        [crossId]: makeContactSnap(crossId, 'org-B'),
      }
      const { batchUpdateMock } = stageAuth(member, docs)

      const req = callAsMember(member, 'POST', '/api/v1/crm/contacts/bulk', {
        ids: [ownId, crossId],
        patch: { delete: true },
      })
      const { POST } = await import('@/app/api/v1/crm/contacts/bulk/route')
      const res = await POST(req)
      const body = await res.json()
      expect(res.status).toBe(200)
      expect(body.data.updated).toBe(1)
      expect(body.data.skipped).toBe(1)
      expect(batchUpdateMock).toHaveBeenCalledTimes(1)
    })

    it('skips already-deleted contacts', async () => {
      const member = seedOrgMember('org-A', 'uid-del3', { role: 'member' })
      const activeId = 'd-active'
      const alreadyDelId = 'd-already-deleted'
      const docs: ContactDocMap = {
        [activeId]: makeContactSnap(activeId, 'org-A'),
        [alreadyDelId]: makeContactSnap(alreadyDelId, 'org-A', { deleted: true }),
      }
      const { batchUpdateMock } = stageAuth(member, docs)

      const req = callAsMember(member, 'POST', '/api/v1/crm/contacts/bulk', {
        ids: [activeId, alreadyDelId],
        patch: { delete: true },
      })
      const { POST } = await import('@/app/api/v1/crm/contacts/bulk/route')
      const res = await POST(req)
      const body = await res.json()
      expect(res.status).toBe(200)
      expect(body.data.updated).toBe(1)
      expect(body.data.skipped).toBe(1)
      expect(batchUpdateMock).toHaveBeenCalledTimes(1)
    })

    it('returns correct updated/skipped counts across mixed contacts', async () => {
      const member = seedOrgMember('org-A', 'uid-del4', { role: 'member' })
      const docs: ContactDocMap = {
        'dm1': makeContactSnap('dm1', 'org-A'),
        'dm2': makeContactSnap('dm2', 'org-A'),
        'dm3': makeContactSnap('dm3', 'org-B'),         // cross-org
        'dm4': makeContactSnap('dm4', 'org-A', { deleted: true }), // already deleted
        'dm5': missingSnap('dm5'),                       // missing
      }
      stageAuth(member, docs)

      const req = callAsMember(member, 'POST', '/api/v1/crm/contacts/bulk', {
        ids: ['dm1', 'dm2', 'dm3', 'dm4', 'dm5'],
        patch: { delete: true },
      })
      const { POST } = await import('@/app/api/v1/crm/contacts/bulk/route')
      const res = await POST(req)
      const body = await res.json()
      expect(res.status).toBe(200)
      expect(body.data.updated).toBe(2)   // dm1, dm2
      expect(body.data.skipped).toBe(3)   // dm3 (cross-org), dm4 (deleted), dm5 (missing)
    })

    it('returns 400 when delete is combined with stage', async () => {
      const member = seedOrgMember('org-A', 'uid-del5', { role: 'member' })
      stageAuth(member, orgContacts('org-A', ['d1']))

      const req = callAsMember(member, 'POST', '/api/v1/crm/contacts/bulk', {
        ids: ['d1'],
        patch: { delete: true, stage: 'won' },
      })
      const { POST } = await import('@/app/api/v1/crm/contacts/bulk/route')
      const res = await POST(req)
      expect(res.status).toBe(400)
      expect((await res.json()).error).toMatch(/cannot be combined/i)
    })

    it('returns 400 when delete is combined with assignedTo', async () => {
      const member = seedOrgMember('org-A', 'uid-del6', { role: 'member' })
      stageAuth(member, orgContacts('org-A', ['d1']))

      const req = callAsMember(member, 'POST', '/api/v1/crm/contacts/bulk', {
        ids: ['d1'],
        patch: { delete: true, assignedTo: 'uid-other' },
      })
      const { POST } = await import('@/app/api/v1/crm/contacts/bulk/route')
      const res = await POST(req)
      expect(res.status).toBe(400)
      expect((await res.json()).error).toMatch(/cannot be combined/i)
    })

    it('returns 400 for empty ids array with delete action', async () => {
      const member = seedOrgMember('org-A', 'uid-del7', { role: 'member' })
      stageAuth(member)

      const req = callAsMember(member, 'POST', '/api/v1/crm/contacts/bulk', {
        ids: [],
        patch: { delete: true },
      })
      const { POST } = await import('@/app/api/v1/crm/contacts/bulk/route')
      const res = await POST(req)
      expect(res.status).toBe(400)
      expect((await res.json()).error).toMatch(/non-empty/i)
    })

    it('viewer gets 403 for delete action', async () => {
      const viewer = seedOrgMember('org-A', 'uid-del-viewer', { role: 'viewer' })
      stageAuth(viewer, orgContacts('org-A', ['d1']))

      const req = callAsMember(viewer, 'POST', '/api/v1/crm/contacts/bulk', {
        ids: ['d1'],
        patch: { delete: true },
      })
      const { POST } = await import('@/app/api/v1/crm/contacts/bulk/route')
      const res = await POST(req)
      expect(res.status).toBe(403)
    })
  })
})
