/**
 * Tests for GET/PUT/PATCH/DELETE /api/v1/crm/custom-fields/:id
 */
import { NextRequest } from 'next/server'

jest.mock('@/lib/firebase/admin', () => ({
  adminAuth: { verifySessionCookie: jest.fn() },
  adminDb: { collection: jest.fn(), batch: jest.fn() },
}))

jest.mock('firebase-admin/firestore', () => ({
  FieldValue: {
    serverTimestamp: () => ({ _type: 'serverTimestamp' }),
    delete: () => ({ _type: 'deleteField' }),
    arrayUnion: (...vals: unknown[]) => ({ _type: 'arrayUnion', vals }),
    arrayRemove: (...vals: unknown[]) => ({ _type: 'arrayRemove', vals }),
  },
  Timestamp: {
    now: () => ({ seconds: 2000, nanoseconds: 0, toDate: () => new Date() }),
  },
}))

jest.mock('@/lib/customFields/store', () => ({
  loadDefinition: jest.fn(),
  sanitizeDefinitionForWrite: jest.fn(),
  assertKeyUnique: jest.fn(),
  CustomFieldKeyError: class CustomFieldKeyError extends Error {
    constructor(message: string) {
      super(message)
      this.name = 'CustomFieldKeyError'
    }
  },
}))

import { adminAuth, adminDb } from '@/lib/firebase/admin'
import * as cfStore from '@/lib/customFields/store'
import { seedOrgMember, callAsMember } from '../../../../helpers/crm'
import { buildDefinition, uidFor } from './_fixtures'

const AI_API_KEY = 'test-ai-key-cf-id'
process.env.AI_API_KEY = AI_API_KEY
process.env.SESSION_COOKIE_NAME = '__session'

// ── stageAuth ────────────────────────────────────────────────────────────────

function stageAuth(
  member: { uid: string; orgId: string; role: string; firstName?: string; lastName?: string },
) {
  ;(adminAuth.verifySessionCookie as jest.Mock).mockResolvedValue({ uid: member.uid })
  ;(adminDb.collection as jest.Mock).mockImplementation((name: string) => {
    if (name === 'users') {
      return {
        doc: () => ({
          get: () => Promise.resolve({ exists: true, data: () => ({ activeOrgId: member.orgId }) }),
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
          get: () => Promise.resolve({ exists: true, data: () => ({ settings: { permissions: {} } }) }),
        }),
      }
    }
    return { doc: () => ({ get: () => Promise.resolve({ exists: false }) }) }
  })
}

function routeCtx(id: string) {
  return { params: Promise.resolve({ id }) }
}

const updateFn = jest.fn().mockResolvedValue(undefined)

function makeLoadedDef(def: ReturnType<typeof buildDefinition>) {
  updateFn.mockResolvedValue(undefined)
  return {
    ref: { update: updateFn, id: def.id },
    data: def,
  }
}

beforeEach(() => {
  jest.clearAllMocks()
  ;(cfStore.sanitizeDefinitionForWrite as jest.Mock).mockImplementation(
    (input: Record<string, unknown>) => {
      const { id, orgId, createdBy, createdByRef, createdAt, updatedBy, updatedByRef, updatedAt, deleted, ...rest } = input as Record<string, unknown>
      void id; void orgId; void createdBy; void createdByRef; void createdAt
      void updatedBy; void updatedByRef; void updatedAt; void deleted
      if (typeof rest.key === 'string') {
        rest.key = rest.key.toLowerCase().trim()
      }
      return rest
    },
  )
})

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let routeModule: any
beforeAll(async () => {
  routeModule = await import('@/app/api/v1/crm/custom-fields/[id]/route')
})

// ── GET ───────────────────────────────────────────────────────────────────────

describe('GET /api/v1/crm/custom-fields/[id]', () => {
  it('returns 200 and definition for a valid id', async () => {
    const uid = uidFor('viewer')
    const member = seedOrgMember('org-a', uid, { role: 'viewer' })
    stageAuth(member)
    const def = buildDefinition({ id: 'def-1', orgId: 'org-a' })
    ;(cfStore.loadDefinition as jest.Mock).mockResolvedValue(makeLoadedDef(def))

    const req = callAsMember(member, 'GET', '/api/v1/crm/custom-fields/def-1')
    const res = await routeModule.GET(req, routeCtx('def-1'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data.definition.id).toBe('def-1')
  })

  it('returns 404 for cross-tenant id', async () => {
    const uid = uidFor('viewer2')
    const member = seedOrgMember('org-a', uid, { role: 'viewer' })
    stageAuth(member)
    // loadDefinition returns null for cross-tenant
    ;(cfStore.loadDefinition as jest.Mock).mockResolvedValue(null)

    const req = callAsMember(member, 'GET', '/api/v1/crm/custom-fields/other-def')
    const res = await routeModule.GET(req, routeCtx('other-def'))
    expect(res.status).toBe(404)
  })

  it('returns 404 for soft-deleted definition', async () => {
    const uid = uidFor('viewer3')
    const member = seedOrgMember('org-a', uid, { role: 'viewer' })
    stageAuth(member)
    // loadDefinition already filters deleted=true — returns null
    ;(cfStore.loadDefinition as jest.Mock).mockResolvedValue(null)

    const req = callAsMember(member, 'GET', '/api/v1/crm/custom-fields/deleted-def')
    const res = await routeModule.GET(req, routeCtx('deleted-def'))
    expect(res.status).toBe(404)
  })
})

// ── PUT ───────────────────────────────────────────────────────────────────────

describe('PUT /api/v1/crm/custom-fields/[id]', () => {
  it('updates successfully', async () => {
    const uid = uidFor('admin')
    const member = seedOrgMember('org-a', uid, { role: 'admin' })
    stageAuth(member)
    const def = buildDefinition({ id: 'def-put', orgId: 'org-a', type: 'text' })
    ;(cfStore.loadDefinition as jest.Mock).mockResolvedValue(makeLoadedDef(def))

    const req = callAsMember(member, 'PUT', '/api/v1/crm/custom-fields/def-put', {
      label: 'Updated Label',
    })
    const res = await routeModule.PUT(req, routeCtx('def-put'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data.definition.id).toBe('def-put')
    expect(updateFn).toHaveBeenCalled()
  })

  it('returns 403 for viewer', async () => {
    const uid = uidFor('viewer4')
    const member = seedOrgMember('org-a', uid, { role: 'viewer' })
    stageAuth(member)

    const req = callAsMember(member, 'PUT', '/api/v1/crm/custom-fields/def-x', { label: 'X' })
    const res = await routeModule.PUT(req, routeCtx('def-x'))
    expect(res.status).toBe(403)
  })

  it('returns 400 for empty body', async () => {
    const uid = uidFor('admin2')
    const member = seedOrgMember('org-a', uid, { role: 'admin' })
    stageAuth(member)

    const req = callAsMember(member, 'PUT', '/api/v1/crm/custom-fields/def-y', {})
    const res = await routeModule.PUT(req, routeCtx('def-y'))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/empty body/i)
  })

  it('returns 400 when type change is attempted', async () => {
    const uid = uidFor('admin3')
    const member = seedOrgMember('org-a', uid, { role: 'admin' })
    stageAuth(member)
    const def = buildDefinition({ id: 'def-t', orgId: 'org-a', type: 'text' })
    ;(cfStore.loadDefinition as jest.Mock).mockResolvedValue(makeLoadedDef(def))

    const req = callAsMember(member, 'PUT', '/api/v1/crm/custom-fields/def-t', {
      type: 'number',
    })
    const res = await routeModule.PUT(req, routeCtx('def-t'))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/immutable/i)
  })

  it('returns 400 when key change is attempted', async () => {
    const uid = uidFor('admin4')
    const member = seedOrgMember('org-a', uid, { role: 'admin' })
    stageAuth(member)
    const def = buildDefinition({ id: 'def-k', orgId: 'org-a', key: 'original_key' })
    ;(cfStore.loadDefinition as jest.Mock).mockResolvedValue(makeLoadedDef(def))

    const req = callAsMember(member, 'PUT', '/api/v1/crm/custom-fields/def-k', {
      key: 'new_key',
    })
    const res = await routeModule.PUT(req, routeCtx('def-k'))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/immutable/i)
  })
})

// ── PATCH ─────────────────────────────────────────────────────────────────────

describe('PATCH /api/v1/crm/custom-fields/[id]', () => {
  it('patches successfully', async () => {
    const uid = uidFor('admin5')
    const member = seedOrgMember('org-a', uid, { role: 'admin' })
    stageAuth(member)
    const def = buildDefinition({ id: 'def-patch', orgId: 'org-a', type: 'text' })
    ;(cfStore.loadDefinition as jest.Mock).mockResolvedValue(makeLoadedDef(def))

    const req = callAsMember(member, 'PATCH', '/api/v1/crm/custom-fields/def-patch', {
      helpText: 'This is helpful',
    })
    const res = await routeModule.PATCH(req, routeCtx('def-patch'))
    expect(res.status).toBe(200)
    expect(updateFn).toHaveBeenCalled()
  })

  it('returns 403 for member role', async () => {
    const uid = uidFor('member1')
    const member = seedOrgMember('org-a', uid, { role: 'member' })
    stageAuth(member)

    const req = callAsMember(member, 'PATCH', '/api/v1/crm/custom-fields/def-z', { helpText: 'x' })
    const res = await routeModule.PATCH(req, routeCtx('def-z'))
    expect(res.status).toBe(403)
  })

  it('returns 400 for empty body', async () => {
    const uid = uidFor('admin6')
    const member = seedOrgMember('org-a', uid, { role: 'admin' })
    stageAuth(member)

    const req = callAsMember(member, 'PATCH', '/api/v1/crm/custom-fields/def-p', {})
    const res = await routeModule.PATCH(req, routeCtx('def-p'))
    expect(res.status).toBe(400)
  })

  it('returns 400 when type change is attempted', async () => {
    const uid = uidFor('admin7')
    const member = seedOrgMember('org-a', uid, { role: 'admin' })
    stageAuth(member)
    const def = buildDefinition({ id: 'def-tp', orgId: 'org-a', type: 'text' })
    ;(cfStore.loadDefinition as jest.Mock).mockResolvedValue(makeLoadedDef(def))

    const req = callAsMember(member, 'PATCH', '/api/v1/crm/custom-fields/def-tp', {
      type: 'dropdown',
    })
    const res = await routeModule.PATCH(req, routeCtx('def-tp'))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/immutable/i)
  })

  it('returns 400 when key change is attempted', async () => {
    const uid = uidFor('admin8')
    const member = seedOrgMember('org-a', uid, { role: 'admin' })
    stageAuth(member)
    const def = buildDefinition({ id: 'def-kp', orgId: 'org-a', key: 'old_key' })
    ;(cfStore.loadDefinition as jest.Mock).mockResolvedValue(makeLoadedDef(def))

    const req = callAsMember(member, 'PATCH', '/api/v1/crm/custom-fields/def-kp', {
      key: 'new_key',
    })
    const res = await routeModule.PATCH(req, routeCtx('def-kp'))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/immutable/i)
  })

  it('returns 400 for invalid options (empty array) on dropdown', async () => {
    const uid = uidFor('admin9')
    const member = seedOrgMember('org-a', uid, { role: 'admin' })
    stageAuth(member)
    const def = buildDefinition({
      id: 'def-opts',
      orgId: 'org-a',
      type: 'dropdown',
      options: [{ value: 'a', label: 'A' }],
    })
    ;(cfStore.loadDefinition as jest.Mock).mockResolvedValue(makeLoadedDef(def))

    const req = callAsMember(member, 'PATCH', '/api/v1/crm/custom-fields/def-opts', {
      options: [],
    })
    const res = await routeModule.PATCH(req, routeCtx('def-opts'))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/options/i)
  })
})

// ── DELETE ────────────────────────────────────────────────────────────────────

describe('DELETE /api/v1/crm/custom-fields/[id]', () => {
  it('soft-deletes and returns { id }', async () => {
    const uid = uidFor('admin10')
    const member = seedOrgMember('org-a', uid, { role: 'admin' })
    stageAuth(member)
    const def = buildDefinition({ id: 'def-del', orgId: 'org-a' })
    ;(cfStore.loadDefinition as jest.Mock).mockResolvedValue(makeLoadedDef(def))

    const req = callAsMember(member, 'DELETE', '/api/v1/crm/custom-fields/def-del')
    const res = await routeModule.DELETE(req, routeCtx('def-del'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data.id).toBe('def-del')
    expect(updateFn).toHaveBeenCalledWith(expect.objectContaining({ deleted: true }))
  })

  it('returns 403 for non-admin', async () => {
    const uid = uidFor('viewer5')
    const member = seedOrgMember('org-a', uid, { role: 'viewer' })
    stageAuth(member)

    const req = callAsMember(member, 'DELETE', '/api/v1/crm/custom-fields/def-d2')
    const res = await routeModule.DELETE(req, routeCtx('def-d2'))
    expect(res.status).toBe(403)
  })

  it('returns 404 for cross-tenant id', async () => {
    const uid = uidFor('admin11')
    const member = seedOrgMember('org-a', uid, { role: 'admin' })
    stageAuth(member)
    ;(cfStore.loadDefinition as jest.Mock).mockResolvedValue(null)

    const req = callAsMember(member, 'DELETE', '/api/v1/crm/custom-fields/cross-tenant-def')
    const res = await routeModule.DELETE(req, routeCtx('cross-tenant-def'))
    expect(res.status).toBe(404)
  })
})
