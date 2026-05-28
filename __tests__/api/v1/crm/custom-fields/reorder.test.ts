/**
 * Tests for POST /api/v1/crm/custom-fields/reorder
 */
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
    now: () => ({ seconds: 3000, nanoseconds: 0, toDate: () => new Date() }),
  },
}))

jest.mock('@/lib/customFields/store', () => ({
  loadDefinition: jest.fn(),
  getDefinitionsForResource: jest.fn(),
  assertKeyUnique: jest.fn(),
  sanitizeDefinitionForWrite: jest.fn(),
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

const AI_API_KEY = 'test-ai-key-cf-reorder'
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
          get: () => Promise.resolve({ exists: true, data: () => ({ settings: { permissions: {} } }) }),
        }),
      }
    }
    return { doc: () => ({ get: () => Promise.resolve({ exists: false }) }) }
  })
}

function makeLoadedDef(
  def: ReturnType<typeof buildDefinition>,
  updateFn = jest.fn().mockResolvedValue(undefined),
) {
  return {
    ref: { update: updateFn, id: def.id },
    data: def,
  }
}

beforeEach(() => jest.clearAllMocks())

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let routeModule: any
beforeAll(async () => {
  routeModule = await import('@/app/api/v1/crm/custom-fields/reorder/route')
})

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('POST /api/v1/crm/custom-fields/reorder', () => {
  it('reorders 3 definitions and returns { reordered: 3 }', async () => {
    const uid = uidFor('admin')
    const member = seedOrgMember('org-a', uid, { role: 'admin' })
    stageAuth(member)

    const def1 = buildDefinition({ id: 'def-c', orgId: 'org-a', resource: 'contact', order: 2 })
    const def2 = buildDefinition({ id: 'def-a', orgId: 'org-a', resource: 'contact', order: 0 })
    const def3 = buildDefinition({ id: 'def-b', orgId: 'org-a', resource: 'contact', order: 1 })

    const updateFns = [
      jest.fn().mockResolvedValue(undefined),
      jest.fn().mockResolvedValue(undefined),
      jest.fn().mockResolvedValue(undefined),
    ]

    ;(cfStore.loadDefinition as jest.Mock)
      .mockResolvedValueOnce(makeLoadedDef(def1, updateFns[0]))
      .mockResolvedValueOnce(makeLoadedDef(def2, updateFns[1]))
      .mockResolvedValueOnce(makeLoadedDef(def3, updateFns[2]))

    // New desired order: def-c, def-a, def-b
    const req = callAsMember(member, 'POST', '/api/v1/crm/custom-fields/reorder', {
      resource: 'contact',
      ids: ['def-c', 'def-a', 'def-b'],
    })
    const res = await routeModule.POST(req)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data.reordered).toBe(3)
    expect(updateFns[0]).toHaveBeenCalledWith(expect.objectContaining({ order: 0 }))
    expect(updateFns[1]).toHaveBeenCalledWith(expect.objectContaining({ order: 1 }))
    expect(updateFns[2]).toHaveBeenCalledWith(expect.objectContaining({ order: 2 }))
  })

  it('returns 400 for invalid resource', async () => {
    const uid = uidFor('admin2')
    const member = seedOrgMember('org-a', uid, { role: 'admin' })
    stageAuth(member)

    const req = callAsMember(member, 'POST', '/api/v1/crm/custom-fields/reorder', {
      resource: 'invoice',
      ids: ['def-1'],
    })
    const res = await routeModule.POST(req)
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/resource/i)
  })

  it('returns 400 when id belongs to a different org (cross-tenant blocked)', async () => {
    const uid = uidFor('admin3')
    const member = seedOrgMember('org-a', uid, { role: 'admin' })
    stageAuth(member)

    // loadDefinition returns null for cross-tenant ids
    ;(cfStore.loadDefinition as jest.Mock).mockResolvedValue(null)

    const req = callAsMember(member, 'POST', '/api/v1/crm/custom-fields/reorder', {
      resource: 'contact',
      ids: ['cross-tenant-id'],
    })
    const res = await routeModule.POST(req)
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/not found/i)
  })

  it('returns 400 when id belongs to a different resource than body.resource', async () => {
    const uid = uidFor('admin4')
    const member = seedOrgMember('org-a', uid, { role: 'admin' })
    stageAuth(member)

    const dealDef = buildDefinition({ id: 'def-deal', orgId: 'org-a', resource: 'deal' })
    ;(cfStore.loadDefinition as jest.Mock).mockResolvedValue(makeLoadedDef(dealDef))

    // Trying to reorder it under 'contact' resource
    const req = callAsMember(member, 'POST', '/api/v1/crm/custom-fields/reorder', {
      resource: 'contact',
      ids: ['def-deal'],
    })
    const res = await routeModule.POST(req)
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/resource/i)
  })

  it('returns 403 for non-admin', async () => {
    const uid = uidFor('viewer')
    const member = seedOrgMember('org-a', uid, { role: 'viewer' })
    stageAuth(member)

    const req = callAsMember(member, 'POST', '/api/v1/crm/custom-fields/reorder', {
      resource: 'contact',
      ids: ['def-1'],
    })
    const res = await routeModule.POST(req)
    expect(res.status).toBe(403)
  })
})
