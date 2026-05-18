/**
 * Consolidated tenant-isolation suite for /api/v1/crm/custom-fields (A2 W3-H)
 *
 * 7 endpoints × 1 cross-tenant assertion each. Uses store-mock pattern:
 * `loadDefinition` returns null when actor.orgId !== def.orgId, mirroring
 * the production helper. A route that forgets to call `loadDefinition` for
 * tenant isolation would fail one or more of these tests.
 *
 *  1  GET    /custom-fields?resource=         — list scoped to ctx.orgId
 *  2  POST   /custom-fields                    — body.orgId override is stripped (NEVER_FROM_BODY)
 *  3  GET    /custom-fields/[id]               — 404 cross-org
 *  4  PUT    /custom-fields/[id]               — 404 cross-org
 *  5  PATCH  /custom-fields/[id]               — 404 cross-org
 *  6  DELETE /custom-fields/[id]               — 404 cross-org
 *  7  POST   /custom-fields/reorder            — rejects cross-org id (400 or 404)
 */

import { NextRequest } from 'next/server'

jest.mock('@/lib/firebase/admin', () => ({
  adminAuth: { verifySessionCookie: jest.fn() },
  adminDb: { collection: jest.fn(), batch: jest.fn() },
  getAdminApp: jest.fn().mockReturnValue({}),
}))

jest.mock('@/lib/customFields/store', () => ({
  loadDefinition: jest.fn(),
  getDefinitionsForResource: jest.fn(),
  assertKeyUnique: jest.fn().mockResolvedValue(true),
  sanitizeDefinitionForWrite: jest.fn((input: Record<string, unknown>) => {
    // Mimic real sanitize: strip orgId + id + attribution keys (NEVER_FROM_BODY)
    const out: Record<string, unknown> = {}
    const block = new Set(['id', 'orgId', 'createdBy', 'createdByRef', 'createdAt', 'updatedBy', 'updatedByRef', 'updatedAt', 'deleted'])
    for (const [k, v] of Object.entries(input)) {
      if (v === undefined) continue
      if (block.has(k)) continue
      out[k] = v
    }
    return out
  }),
  CustomFieldKeyError: class CustomFieldKeyError extends Error {},
}))

import { adminAuth, adminDb } from '@/lib/firebase/admin'
import * as cfStore from '@/lib/customFields/store'
import { uidFor } from './custom-fields/_fixtures'
import { seedOrgMember, callAsMember } from '../../../helpers/crm'

process.env.SESSION_COOKIE_NAME = '__session'

// Distinct UIDs — avoid substring-collision (uid-a vs uid-admin-a)
const orgAUid = uidFor('orgA-iso-admin')
const orgBUid = uidFor('orgB-iso-admin')
const adminA = seedOrgMember('org-a', orgAUid, { role: 'admin', firstName: 'Admin', lastName: 'A' })
const adminB = seedOrgMember('org-b', orgBUid, { role: 'admin', firstName: 'Admin', lastName: 'B' })

const defA = {
  id: 'def-a-1',
  orgId: 'org-a',
  resource: 'contact' as const,
  key: 'tier_a',
  label: 'Tier A',
  type: 'text' as const,
  required: false,
  order: 0,
  createdAt: null,
  updatedAt: null,
  deleted: false,
}
const defB = {
  id: 'def-b-1',
  orgId: 'org-b',
  resource: 'contact' as const,
  key: 'tier_b',
  label: 'Tier B',
  type: 'text' as const,
  required: false,
  order: 0,
  createdAt: null,
  updatedAt: null,
  deleted: false,
}

beforeEach(() => {
  jest.clearAllMocks()
  ;(adminAuth.verifySessionCookie as jest.Mock).mockImplementation((cookie: string) => {
    if (cookie.endsWith(adminA.uid)) return Promise.resolve({ uid: adminA.uid })
    if (cookie.endsWith(adminB.uid)) return Promise.resolve({ uid: adminB.uid })
    return Promise.reject(new Error('invalid'))
  })

  // loadDefinition returns null when cross-tenant — production behaviour
  ;(cfStore.loadDefinition as jest.Mock).mockImplementation(async (id: string, orgId: string) => {
    const all = [defA, defB]
    const hit = all.find((d) => d.id === id)
    if (!hit) return null
    if (hit.orgId !== orgId) return null  // tenant guard
    return { ref: { id, update: jest.fn().mockResolvedValue(undefined) }, data: hit }
  })

  // getDefinitionsForResource returns only defs matching orgId
  ;(cfStore.getDefinitionsForResource as jest.Mock).mockImplementation(async (orgId: string, resource: string) => {
    return [defA, defB].filter((d) => d.orgId === orgId && d.resource === resource && !d.deleted)
  })

  // Set up a baseline adminDb.collection mock that supports orgMembers (for middleware role lookup)
  ;(adminDb.collection as jest.Mock).mockImplementation((name: string) => {
    if (name === 'orgMembers') {
      return {
        doc: (key: string) => ({
          get: () =>
            Promise.resolve({
              exists: key === `${adminA.orgId}_${adminA.uid}` || key === `${adminB.orgId}_${adminB.uid}`,
              data: () =>
                key === `${adminA.orgId}_${adminA.uid}`
                  ? { ...adminA, role: 'admin' }
                  : { ...adminB, role: 'admin' },
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
    if (name === 'users') {
      return {
        doc: (uid: string) => ({
          get: () =>
            Promise.resolve({
              exists: true,
              data: () => ({ activeOrgId: uid === adminA.uid ? 'org-a' : 'org-b' }),
            }),
        }),
      }
    }
    if (name === 'customFieldDefinitions') {
      // POST handler writes here via .doc().set()
      return {
        doc: jest.fn().mockReturnValue({
          id: 'new-def-id',
          set: jest.fn().mockResolvedValue(undefined),
        }),
        where: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        get: () => Promise.resolve({ docs: [] }),
      }
    }
    return {
      doc: () => ({ get: () => Promise.resolve({ exists: false }) }),
      where: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      get: () => Promise.resolve({ docs: [] }),
    }
  })
})

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('custom-fields tenant isolation', () => {
  it('GET /custom-fields lists only ctx.orgId definitions', async () => {
    const req = callAsMember(adminA, 'GET', '/api/v1/crm/custom-fields?resource=contact')
    const { GET } = await import('@/app/api/v1/crm/custom-fields/route')
    const res = await GET(req as NextRequest)
    expect(res.status).toBe(200)
    const body = await res.json()
    const defs = body.data?.definitions ?? body.definitions ?? []
    expect(defs).toHaveLength(1)
    expect(defs[0].orgId).toBe('org-a')
    expect(defs[0].id).toBe('def-a-1')
  })

  it('POST /custom-fields strips body.orgId override (NEVER_FROM_BODY)', async () => {
    const captured: Record<string, unknown>[] = []
    ;(adminDb.collection as jest.Mock).mockImplementation((name: string) => {
      if (name === 'orgMembers' || name === 'organizations' || name === 'users') {
        // Re-use the beforeEach implementations by re-deriving here for this test
        if (name === 'orgMembers') {
          return {
            doc: (key: string) => ({
              get: () =>
                Promise.resolve({
                  exists: key === `${adminA.orgId}_${adminA.uid}`,
                  data: () => ({ ...adminA, role: 'admin' }),
                }),
            }),
          }
        }
        if (name === 'organizations') {
          return { doc: () => ({ get: () => Promise.resolve({ exists: true, data: () => ({ settings: { permissions: {} } }) }) }) }
        }
        return { doc: () => ({ get: () => Promise.resolve({ exists: true, data: () => ({ activeOrgId: 'org-a' }) }) }) }
      }
      if (name === 'customFieldDefinitions') {
        return {
          doc: jest.fn().mockReturnValue({
            id: 'new-def-id',
            set: jest.fn((data: Record<string, unknown>) => {
              captured.push(data)
              return Promise.resolve(undefined)
            }),
          }),
          where: jest.fn().mockReturnThis(),
          orderBy: jest.fn().mockReturnThis(),
          limit: jest.fn().mockReturnThis(),
          get: () => Promise.resolve({ docs: [] }),
        }
      }
      return { doc: () => ({ get: () => Promise.resolve({ exists: false }) }) }
    })

    const req = callAsMember(adminA, 'POST', '/api/v1/crm/custom-fields', {
      orgId: 'org-b', // attempted override — must be ignored
      resource: 'contact',
      key: 'evil_field',
      label: 'Evil',
      type: 'text',
    })
    const { POST } = await import('@/app/api/v1/crm/custom-fields/route')
    const res = await POST(req as NextRequest)
    expect([200, 201]).toContain(res.status)
    // The persisted doc must always carry ctx.orgId, never body.orgId
    expect(captured.length).toBeGreaterThan(0)
    expect(captured[0].orgId).toBe('org-a')
  })

  it('GET /custom-fields/[id] → 404 for cross-org id', async () => {
    const req = callAsMember(adminA, 'GET', '/api/v1/crm/custom-fields/def-b-1')
    const { GET } = await import('@/app/api/v1/crm/custom-fields/[id]/route')
    const routeCtx = { params: Promise.resolve({ id: 'def-b-1' }) }
    const res = await GET(req as NextRequest, routeCtx)
    expect(res.status).toBe(404)
  })

  it('PUT /custom-fields/[id] → 404 for cross-org id', async () => {
    const req = callAsMember(adminA, 'PUT', '/api/v1/crm/custom-fields/def-b-1', { label: 'Renamed' })
    const { PUT } = await import('@/app/api/v1/crm/custom-fields/[id]/route')
    const routeCtx = { params: Promise.resolve({ id: 'def-b-1' }) }
    const res = await PUT(req as NextRequest, routeCtx)
    expect(res.status).toBe(404)
  })

  it('PATCH /custom-fields/[id] → 404 for cross-org id', async () => {
    const req = callAsMember(adminA, 'PATCH', '/api/v1/crm/custom-fields/def-b-1', { label: 'Renamed' })
    const { PATCH } = await import('@/app/api/v1/crm/custom-fields/[id]/route')
    const routeCtx = { params: Promise.resolve({ id: 'def-b-1' }) }
    const res = await PATCH(req as NextRequest, routeCtx)
    expect(res.status).toBe(404)
  })

  it('DELETE /custom-fields/[id] → 404 for cross-org id', async () => {
    const req = callAsMember(adminA, 'DELETE', '/api/v1/crm/custom-fields/def-b-1')
    const { DELETE } = await import('@/app/api/v1/crm/custom-fields/[id]/route')
    const routeCtx = { params: Promise.resolve({ id: 'def-b-1' }) }
    const res = await DELETE(req as NextRequest, routeCtx)
    expect(res.status).toBe(404)
  })

  it('POST /custom-fields/reorder rejects cross-org id (400 or 404)', async () => {
    const req = callAsMember(adminA, 'POST', '/api/v1/crm/custom-fields/reorder', {
      resource: 'contact',
      ids: ['def-a-1', 'def-b-1'], // def-b-1 is cross-org
    })
    const { POST } = await import('@/app/api/v1/crm/custom-fields/reorder/route')
    const res = await POST(req as NextRequest)
    expect([400, 404]).toContain(res.status)
  })
})
