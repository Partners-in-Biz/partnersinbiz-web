/**
 * Consolidated tenant-isolation suite for /api/v1/crm/pipelines (A3 W3-J)
 *
 * 8 endpoints × 1 cross-tenant assertion each. Uses store-mock pattern:
 * `loadPipeline` returns null when actor.orgId !== pipeline.orgId, mirroring
 * the production helper. A route that forgets to call `loadPipeline` for
 * tenant isolation would fail one or more of these tests.
 *
 *  1  GET    /pipelines                     — list scoped to ctx.orgId
 *  2  POST   /pipelines                     — body.orgId override is stripped (NEVER_FROM_BODY)
 *  3  GET    /pipelines/[id]               — 404 cross-org
 *  4  PUT    /pipelines/[id]               — 404 cross-org
 *  5  PATCH  /pipelines/[id]               — 404 cross-org
 *  6  DELETE /pipelines/[id]               — 404 cross-org
 *  7  POST   /pipelines/[id]/set-default   — 404 cross-org
 *  8  GET    /pipelines/default            — only ctx.orgId's default
 */

import { NextRequest } from 'next/server'

jest.mock('@/lib/firebase/admin', () => ({
  adminAuth: { verifySessionCookie: jest.fn() },
  adminDb: { collection: jest.fn(), batch: jest.fn() },
  getAdminApp: jest.fn().mockReturnValue({}),
}))

jest.mock('@/lib/pipelines/store', () => ({
  loadPipeline: jest.fn(),
  getDefaultPipelineForOrg: jest.fn(),
  bootstrapDefaultPipeline: jest.fn(),
  clearOtherDefaults: jest.fn().mockResolvedValue(undefined),
  sanitizePipelineForWrite: jest.fn((input: Record<string, unknown>) => {
    // Mimic real sanitize: strip NEVER_FROM_BODY fields
    const out: Record<string, unknown> = {}
    const block = new Set([
      'id', 'orgId',
      'createdBy', 'createdByRef', 'createdAt',
      'updatedBy', 'updatedByRef', 'updatedAt',
      'deleted',
    ])
    for (const [k, v] of Object.entries(input)) {
      if (v === undefined) continue
      if (block.has(k)) continue
      out[k] = v
    }
    return out
  }),
  assertStagesValid: jest.fn(), // no-op — not under test here
}))

import { adminAuth, adminDb } from '@/lib/firebase/admin'
import * as pipelineStore from '@/lib/pipelines/store'
import { uidFor } from './pipelines/_fixtures'
import { seedOrgMember, callAsMember } from '../../../helpers/crm'
import { makePortalAuthCollectionsForMembers } from '../../../helpers/firebase-admin'

process.env.SESSION_COOKIE_NAME = '__session'

// Distinct UIDs — avoid substring-collision (uid-a vs uid-admin-a)
const orgAUid = uidFor('orgA-iso-admin')
const orgBUid = uidFor('orgB-iso-admin')
const adminA = seedOrgMember('org-a', orgAUid, { role: 'admin', firstName: 'Admin', lastName: 'A' })
const adminB = seedOrgMember('org-b', orgBUid, { role: 'admin', firstName: 'Admin', lastName: 'B' })

const defaultStages = [
  { id: 'discovery',   label: 'Discovery',   kind: 'open', order: 0, probability: 10 },
  { id: 'proposal',    label: 'Proposal',    kind: 'open', order: 1, probability: 30 },
  { id: 'negotiation', label: 'Negotiation', kind: 'open', order: 2, probability: 60 },
  { id: 'won',         label: 'Won',         kind: 'won',  order: 3, probability: 100 },
  { id: 'lost',        label: 'Lost',        kind: 'lost', order: 4, probability: 0 },
]

const pipeA = {
  id: 'pipe-a-1',
  orgId: 'org-a',
  name: 'Sales A',
  stages: defaultStages,
  isDefault: true,
  archived: false,
  deleted: false,
  createdAt: null,
  updatedAt: null,
}

const pipeB = {
  id: 'pipe-b-1',
  orgId: 'org-b',
  name: 'Sales B',
  stages: defaultStages,
  isDefault: true,
  archived: false,
  deleted: false,
  createdAt: null,
  updatedAt: null,
}

/** Build an adminDb.collection mock supporting orgMembers / organizations / users / pipelines */
function buildCollectionMock(opts: {
  actor: typeof adminA
  capturedDocSet?: jest.Mock
} = { actor: adminA }) {
  const { capturedDocSet } = opts
  const authCollections = makePortalAuthCollectionsForMembers([adminA, adminB])
  return (name: string) => {
    if (name in authCollections) return authCollections[name as keyof typeof authCollections]
    if (name === 'orgMembers') {
      return {
        doc: (key: string) => ({
          get: () =>
            Promise.resolve({
              exists:
                key === `${adminA.orgId}_${adminA.uid}` ||
                key === `${adminB.orgId}_${adminB.uid}`,
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
          get: () =>
            Promise.resolve({
              exists: true,
              data: () => ({ settings: { permissions: {} } }),
            }),
        }),
      }
    }
    if (name === 'users') {
      return {
        doc: (uid: string) => ({
          get: () =>
            Promise.resolve({
              exists: true,
              data: () => ({
                activeOrgId: uid === adminA.uid ? 'org-a' : 'org-b',
              }),
            }),
        }),
      }
    }
    if (name === 'pipelines') {
      const setFn = capturedDocSet ?? jest.fn().mockResolvedValue(undefined)
      return {
        doc: jest.fn().mockReturnValue({
          id: 'new-pipe-id',
          set: setFn,
        }),
        where: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        get: () =>
          Promise.resolve({
            empty: true,
            docs: [],
          }),
      }
    }
    if (name === 'deals') {
      return {
        where: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        get: () => Promise.resolve({ empty: true, docs: [], size: 0 }),
      }
    }
    return {
      doc: () => ({ get: () => Promise.resolve({ exists: false }) }),
      where: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      get: () => Promise.resolve({ empty: true, docs: [] }),
    }
  }
}

beforeEach(() => {
  jest.clearAllMocks()

  ;(adminAuth.verifySessionCookie as jest.Mock).mockImplementation((cookie: string) => {
    if (cookie.endsWith(adminA.uid)) return Promise.resolve({ uid: adminA.uid })
    if (cookie.endsWith(adminB.uid)) return Promise.resolve({ uid: adminB.uid })
    return Promise.reject(new Error('invalid'))
  })

  // loadPipeline returns null when cross-tenant — production behaviour
  ;(pipelineStore.loadPipeline as jest.Mock).mockImplementation(
    async (id: string, orgId: string) => {
      const all = [pipeA, pipeB]
      const hit = all.find((p) => p.id === id)
      if (!hit) return null
      if (hit.orgId !== orgId) return null // tenant guard
      if (hit.deleted) return null
      return {
        ref: { id, update: jest.fn().mockResolvedValue(undefined) },
        data: hit,
      }
    },
  )

  // getDefaultPipelineForOrg returns only the default for the given org
  ;(pipelineStore.getDefaultPipelineForOrg as jest.Mock).mockImplementation(
    async (orgId: string) => {
      if (orgId === 'org-a') return pipeA
      if (orgId === 'org-b') return pipeB
      return null
    },
  )

  ;(pipelineStore.bootstrapDefaultPipeline as jest.Mock).mockResolvedValue(pipeA)

  ;(adminDb.collection as jest.Mock).mockImplementation(buildCollectionMock({ actor: adminA }))
})

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('pipelines tenant isolation', () => {
  it('GET /pipelines lists only ctx.orgId pipelines', async () => {
    // The GET handler queries Firestore with where('orgId','==',ctx.orgId).
    // Mock the collection so only org-a's pipeline appears in the result.
    ;(adminDb.collection as jest.Mock).mockImplementation((name: string) => {
      const base = buildCollectionMock({ actor: adminA })(name)
      if (name === 'pipelines') {
        return {
          ...base,
          where: jest.fn().mockReturnThis(),
          orderBy: jest.fn().mockReturnThis(),
          limit: jest.fn().mockReturnThis(),
          get: () =>
            Promise.resolve({
              empty: false,
              docs: [
                {
                  id: pipeA.id,
                  data: () => pipeA,
                },
              ],
            }),
        }
      }
      return base
    })

    const req = callAsMember(adminA, 'GET', '/api/v1/crm/pipelines')
    const { GET } = await import('@/app/api/v1/crm/pipelines/route')
    const res = await GET(req as NextRequest)
    expect(res.status).toBe(200)
    const body = await res.json()
    const pipelines = body.data?.pipelines ?? body.pipelines ?? []
    expect(pipelines).toHaveLength(1)
    expect(pipelines[0].orgId).toBe('org-a')
    expect(pipelines[0].id).toBe('pipe-a-1')
  })

  it('POST /pipelines strips body.orgId override (NEVER_FROM_BODY)', async () => {
    const captured: Record<string, unknown>[] = []
    ;(adminDb.collection as jest.Mock).mockImplementation((name: string) => {
      const base = buildCollectionMock({ actor: adminA })(name)
      if (name === 'pipelines') {
        return {
          ...base,
          doc: jest.fn().mockReturnValue({
            id: 'new-pipe-id',
            set: jest.fn((data: Record<string, unknown>) => {
              captured.push(data)
              return Promise.resolve(undefined)
            }),
          }),
          where: jest.fn().mockReturnThis(),
          orderBy: jest.fn().mockReturnThis(),
          limit: jest.fn().mockReturnThis(),
          // Return empty for dup-name check
          get: () => Promise.resolve({ empty: true, docs: [] }),
        }
      }
      return base
    })

    const req = callAsMember(adminA, 'POST', '/api/v1/crm/pipelines', {
      orgId: 'org-b', // attempted override — must be stripped
      name: 'Evil Pipeline',
      stages: defaultStages,
    })
    const { POST } = await import('@/app/api/v1/crm/pipelines/route')
    const res = await POST(req as NextRequest)
    expect([200, 201]).toContain(res.status)
    // The persisted doc must always carry ctx.orgId (org-a), never body.orgId (org-b)
    expect(captured.length).toBeGreaterThan(0)
    expect(captured[0].orgId).toBe('org-a')
    expect(captured[0].orgId).not.toBe('org-b')
  })

  it('GET /pipelines/[id] → 404 for cross-org id', async () => {
    const req = callAsMember(adminA, 'GET', '/api/v1/crm/pipelines/pipe-b-1')
    const { GET } = await import('@/app/api/v1/crm/pipelines/[id]/route')
    const routeCtx = { params: Promise.resolve({ id: 'pipe-b-1' }) }
    const res = await GET(req as NextRequest, routeCtx)
    expect(res.status).toBe(404)
  })

  it('PUT /pipelines/[id] → 404 for cross-org id', async () => {
    const req = callAsMember(adminA, 'PUT', '/api/v1/crm/pipelines/pipe-b-1', {
      name: 'Hijacked',
      stages: defaultStages,
    })
    const { PUT } = await import('@/app/api/v1/crm/pipelines/[id]/route')
    const routeCtx = { params: Promise.resolve({ id: 'pipe-b-1' }) }
    const res = await PUT(req as NextRequest, routeCtx)
    expect(res.status).toBe(404)
  })

  it('PATCH /pipelines/[id] → 404 for cross-org id', async () => {
    const req = callAsMember(adminA, 'PATCH', '/api/v1/crm/pipelines/pipe-b-1', {
      name: 'Renamed',
    })
    const { PATCH } = await import('@/app/api/v1/crm/pipelines/[id]/route')
    const routeCtx = { params: Promise.resolve({ id: 'pipe-b-1' }) }
    const res = await PATCH(req as NextRequest, routeCtx)
    expect(res.status).toBe(404)
  })

  it('DELETE /pipelines/[id] → 404 for cross-org id', async () => {
    const req = callAsMember(adminA, 'DELETE', '/api/v1/crm/pipelines/pipe-b-1')
    const { DELETE } = await import('@/app/api/v1/crm/pipelines/[id]/route')
    const routeCtx = { params: Promise.resolve({ id: 'pipe-b-1' }) }
    const res = await DELETE(req as NextRequest, routeCtx)
    expect(res.status).toBe(404)
  })

  it('POST /pipelines/[id]/set-default → 404 for cross-org id', async () => {
    const req = callAsMember(adminA, 'POST', '/api/v1/crm/pipelines/pipe-b-1/set-default')
    const { POST } = await import('@/app/api/v1/crm/pipelines/[id]/set-default/route')
    const routeCtx = { params: Promise.resolve({ id: 'pipe-b-1' }) }
    const res = await POST(req as NextRequest, routeCtx)
    expect(res.status).toBe(404)
  })

  it('GET /pipelines/default returns only ctx.orgId default', async () => {
    // org-a actor → should get org-a's default, never org-b's
    const req = callAsMember(adminA, 'GET', '/api/v1/crm/pipelines/default')
    const { GET } = await import('@/app/api/v1/crm/pipelines/default/route')
    const res = await GET(req as NextRequest)
    expect(res.status).toBe(200)
    const body = await res.json()
    const pipeline = body.data?.pipeline ?? body.pipeline
    expect(pipeline).toBeDefined()
    expect(pipeline.orgId).toBe('org-a')
    expect(pipeline.id).toBe('pipe-a-1')
    // Confirm org-b's pipeline was not returned
    expect(pipeline.id).not.toBe('pipe-b-1')
    expect(pipeline.orgId).not.toBe('org-b')
  })
})
