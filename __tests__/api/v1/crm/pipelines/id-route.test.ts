/**
 * Tests for GET/PUT/PATCH/DELETE /api/v1/crm/pipelines/:id
 */
jest.mock('@/lib/firebase/admin', () => ({
  adminAuth: { verifySessionCookie: jest.fn() },
  adminDb: { collection: jest.fn(), batch: jest.fn() },
}))

jest.mock('firebase-admin/firestore', () => ({
  FieldValue: {
    serverTimestamp: () => ({ _type: 'serverTimestamp' }),
    delete: () => ({ _type: 'deleteField' }),
  },
  Timestamp: {
    now: () => ({ seconds: 2000, nanoseconds: 0, toDate: () => new Date() }),
  },
}))

jest.mock('@/lib/pipelines/store', () => ({
  loadPipeline: jest.fn(),
  assertStagesValid: jest.fn(),
  sanitizePipelineForWrite: jest.fn(),
  clearOtherDefaults: jest.fn(),
  getDefaultPipelineForOrg: jest.fn(),
  bootstrapDefaultPipeline: jest.fn(),
}))

import { adminAuth, adminDb } from '@/lib/firebase/admin'
import * as pipelineStore from '@/lib/pipelines/store'
import { seedOrgMember, callAsMember } from '../../../../helpers/crm'
import { uidFor, buildPipeline, defaultStages } from './_fixtures'

const AI_API_KEY = 'test-ai-key-pipeline-id'
process.env.AI_API_KEY = AI_API_KEY
process.env.SESSION_COOKIE_NAME = '__session'

// ── helpers ───────────────────────────────────────────────────────────────────

function stageAuth(
  member: { uid: string; orgId: string; role: string; firstName?: string; lastName?: string },
  opts: {
    dealsSnap?: { empty: boolean; size?: number; docs?: unknown[] }
  } = {},
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
      return { doc: () => ({ get: () => Promise.resolve({ exists: true, data: () => ({ settings: { permissions: {} } }) }) }) }
    }
    if (name === 'deals') {
      const snap = opts.dealsSnap ?? { empty: true, size: 0, docs: [] }
      return {
        where: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        get: jest.fn().mockResolvedValue(snap),
      }
    }
    return { doc: () => ({ get: () => Promise.resolve({ exists: false }) }) }
  })
}

function routeCtx(id: string) {
  return { params: Promise.resolve({ id }) }
}

const updateFn = jest.fn().mockResolvedValue(undefined)

function makeLoadedPipeline(pipeline: ReturnType<typeof buildPipeline>) {
  updateFn.mockResolvedValue(undefined)
  return {
    ref: { update: updateFn, id: pipeline.id },
    data: pipeline,
  }
}

beforeEach(() => {
  jest.clearAllMocks()
  ;(pipelineStore.assertStagesValid as jest.Mock).mockImplementation(() => undefined)
  ;(pipelineStore.sanitizePipelineForWrite as jest.Mock).mockImplementation(
    (input: Record<string, unknown>) => {
      const { id, orgId, createdBy, createdByRef, createdAt, updatedBy, updatedByRef, updatedAt, deleted, ...rest } =
        input as Record<string, unknown>
      void id; void orgId; void createdBy; void createdByRef; void createdAt
      void updatedBy; void updatedByRef; void updatedAt; void deleted
      return rest
    },
  )
})

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let routeModule: any
beforeAll(async () => {
  routeModule = await import('@/app/api/v1/crm/pipelines/[id]/route')
})

// ── GET ───────────────────────────────────────────────────────────────────────

describe('GET /api/v1/crm/pipelines/[id]', () => {
  it('returns 200 and pipeline for a valid id', async () => {
    const uid = uidFor('viewer')
    const member = seedOrgMember('org-a', uid, { role: 'viewer' })
    stageAuth(member)
    const pipe = buildPipeline({ id: 'pipe-1', orgId: 'org-a' })
    ;(pipelineStore.loadPipeline as jest.Mock).mockResolvedValue(makeLoadedPipeline(pipe))

    const req = callAsMember(member, 'GET', '/api/v1/crm/pipelines/pipe-1')
    const res = await routeModule.GET(req, routeCtx('pipe-1'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data.pipeline.id).toBe('pipe-1')
  })

  it('returns 404 for cross-tenant id', async () => {
    const uid = uidFor('viewer2')
    const member = seedOrgMember('org-a', uid, { role: 'viewer' })
    stageAuth(member)
    ;(pipelineStore.loadPipeline as jest.Mock).mockResolvedValue(null)

    const req = callAsMember(member, 'GET', '/api/v1/crm/pipelines/other-org-pipe')
    const res = await routeModule.GET(req, routeCtx('other-org-pipe'))
    expect(res.status).toBe(404)
  })

  it('returns 404 for soft-deleted pipeline', async () => {
    const uid = uidFor('viewer3')
    const member = seedOrgMember('org-a', uid, { role: 'viewer' })
    stageAuth(member)
    ;(pipelineStore.loadPipeline as jest.Mock).mockResolvedValue(null)

    const req = callAsMember(member, 'GET', '/api/v1/crm/pipelines/deleted-pipe')
    const res = await routeModule.GET(req, routeCtx('deleted-pipe'))
    expect(res.status).toBe(404)
  })
})

// ── PUT ───────────────────────────────────────────────────────────────────────

describe('PUT /api/v1/crm/pipelines/[id]', () => {
  it('updates successfully and returns 200', async () => {
    const uid = uidFor('admin')
    const member = seedOrgMember('org-a', uid, { role: 'admin' })
    stageAuth(member)
    const pipe = buildPipeline({ id: 'pipe-put', orgId: 'org-a' })
    ;(pipelineStore.loadPipeline as jest.Mock).mockResolvedValue(makeLoadedPipeline(pipe))

    const req = callAsMember(member, 'PUT', '/api/v1/crm/pipelines/pipe-put', {
      name: 'Updated Name',
      stages: defaultStages(),
    })
    const res = await routeModule.PUT(req, routeCtx('pipe-put'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data.pipeline.id).toBe('pipe-put')
    expect(updateFn).toHaveBeenCalled()
  })

  it('returns 403 for viewer', async () => {
    const uid = uidFor('viewer4')
    const member = seedOrgMember('org-a', uid, { role: 'viewer' })
    stageAuth(member)

    const req = callAsMember(member, 'PUT', '/api/v1/crm/pipelines/pipe-x', { name: 'X' })
    const res = await routeModule.PUT(req, routeCtx('pipe-x'))
    expect(res.status).toBe(403)
  })

  it('returns 400 for empty body', async () => {
    const uid = uidFor('admin2')
    const member = seedOrgMember('org-a', uid, { role: 'admin' })
    stageAuth(member)

    const req = callAsMember(member, 'PUT', '/api/v1/crm/pipelines/pipe-y', {})
    const res = await routeModule.PUT(req, routeCtx('pipe-y'))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/empty body/i)
  })

  it('returns 404 when pipeline not found', async () => {
    const uid = uidFor('admin3')
    const member = seedOrgMember('org-a', uid, { role: 'admin' })
    stageAuth(member)
    ;(pipelineStore.loadPipeline as jest.Mock).mockResolvedValue(null)

    const req = callAsMember(member, 'PUT', '/api/v1/crm/pipelines/nonexistent', { name: 'X', stages: defaultStages() })
    const res = await routeModule.PUT(req, routeCtx('nonexistent'))
    expect(res.status).toBe(404)
  })

  it('returns 400 when stage validation fails', async () => {
    const uid = uidFor('admin4')
    const member = seedOrgMember('org-a', uid, { role: 'admin' })
    stageAuth(member)
    const pipe = buildPipeline({ id: 'pipe-v', orgId: 'org-a' })
    ;(pipelineStore.loadPipeline as jest.Mock).mockResolvedValue(makeLoadedPipeline(pipe))
    const { PipelineValidationError } = await import('@/lib/pipelines/types')
    ;(pipelineStore.assertStagesValid as jest.Mock).mockImplementationOnce(() => {
      throw new PipelineValidationError([{ field: 'stages', message: 'Must have 1 won stage' }])
    })

    const req = callAsMember(member, 'PUT', '/api/v1/crm/pipelines/pipe-v', {
      stages: [{ id: 'open1', label: 'Open', kind: 'open', order: 0, probability: 50 }],
    })
    const res = await routeModule.PUT(req, routeCtx('pipe-v'))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.details).toBeDefined()
  })

  it('returns 400 when removing a stage that has live deals', async () => {
    const uid = uidFor('admin5')
    const member = seedOrgMember('org-a', uid, { role: 'admin' })
    // Simulate 2 deals in the removed stage
    stageAuth(member, { dealsSnap: { empty: false, size: 2, docs: [{}, {}] } })
    const pipe = buildPipeline({ id: 'pipe-r', orgId: 'org-a', stages: defaultStages() })
    ;(pipelineStore.loadPipeline as jest.Mock).mockResolvedValue(makeLoadedPipeline(pipe))

    // Send stages without 'discovery' — removing it
    const newStages = defaultStages().filter((s) => s.id !== 'discovery')
    const req = callAsMember(member, 'PUT', '/api/v1/crm/pipelines/pipe-r', {
      stages: newStages,
    })
    const res = await routeModule.PUT(req, routeCtx('pipe-r'))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.stageId).toBe('discovery')
    expect(typeof body.dealCount).toBe('number')
  })

  it('returns 400 when name exceeds 100 chars', async () => {
    const uid = uidFor('admin6')
    const member = seedOrgMember('org-a', uid, { role: 'admin' })
    stageAuth(member)
    const pipe = buildPipeline({ id: 'pipe-n', orgId: 'org-a' })
    ;(pipelineStore.loadPipeline as jest.Mock).mockResolvedValue(makeLoadedPipeline(pipe))

    const req = callAsMember(member, 'PUT', '/api/v1/crm/pipelines/pipe-n', {
      name: 'A'.repeat(101),
    })
    const res = await routeModule.PUT(req, routeCtx('pipe-n'))
    expect(res.status).toBe(400)
  })
})

// ── PATCH ──────────────────────────────────────────────────────────────────────

describe('PATCH /api/v1/crm/pipelines/[id]', () => {
  it('partial update works (name only)', async () => {
    const uid = uidFor('admin7')
    const member = seedOrgMember('org-a', uid, { role: 'admin' })
    stageAuth(member)
    const pipe = buildPipeline({ id: 'pipe-patch', orgId: 'org-a' })
    ;(pipelineStore.loadPipeline as jest.Mock).mockResolvedValue(makeLoadedPipeline(pipe))

    const req = callAsMember(member, 'PATCH', '/api/v1/crm/pipelines/pipe-patch', {
      name: 'Patched Name',
    })
    const res = await routeModule.PATCH(req, routeCtx('pipe-patch'))
    expect(res.status).toBe(200)
    expect(updateFn).toHaveBeenCalled()
  })

  it('returns 403 for viewer', async () => {
    const uid = uidFor('viewer5')
    const member = seedOrgMember('org-a', uid, { role: 'viewer' })
    stageAuth(member)

    const req = callAsMember(member, 'PATCH', '/api/v1/crm/pipelines/pipe-x', { name: 'X' })
    const res = await routeModule.PATCH(req, routeCtx('pipe-x'))
    expect(res.status).toBe(403)
  })

  it('returns 400 for empty body', async () => {
    const uid = uidFor('admin8')
    const member = seedOrgMember('org-a', uid, { role: 'admin' })
    stageAuth(member)

    const req = callAsMember(member, 'PATCH', '/api/v1/crm/pipelines/pipe-z', {})
    const res = await routeModule.PATCH(req, routeCtx('pipe-z'))
    expect(res.status).toBe(400)
  })

  it('returns 404 cross-tenant', async () => {
    const uid = uidFor('admin9')
    const member = seedOrgMember('org-a', uid, { role: 'admin' })
    stageAuth(member)
    ;(pipelineStore.loadPipeline as jest.Mock).mockResolvedValue(null)

    const req = callAsMember(member, 'PATCH', '/api/v1/crm/pipelines/other-org-pipe', { name: 'X' })
    const res = await routeModule.PATCH(req, routeCtx('other-org-pipe'))
    expect(res.status).toBe(404)
  })
})

// ── DELETE ────────────────────────────────────────────────────────────────────

describe('DELETE /api/v1/crm/pipelines/[id]', () => {
  it('soft deletes when no live deals', async () => {
    const uid = uidFor('admin10')
    const member = seedOrgMember('org-a', uid, { role: 'admin' })
    stageAuth(member, { dealsSnap: { empty: true, size: 0, docs: [] } })
    const pipe = buildPipeline({ id: 'pipe-del', orgId: 'org-a' })
    ;(pipelineStore.loadPipeline as jest.Mock).mockResolvedValue(makeLoadedPipeline(pipe))

    const req = callAsMember(member, 'DELETE', '/api/v1/crm/pipelines/pipe-del')
    const res = await routeModule.DELETE(req, routeCtx('pipe-del'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data.id).toBe('pipe-del')
    expect(updateFn).toHaveBeenCalledWith(expect.objectContaining({ deleted: true }))
  })

  it('returns 400 when live deals are attached', async () => {
    const uid = uidFor('admin11')
    const member = seedOrgMember('org-a', uid, { role: 'admin' })
    stageAuth(member, { dealsSnap: { empty: false, size: 3, docs: [{}, {}, {}] } })
    const pipe = buildPipeline({ id: 'pipe-deals', orgId: 'org-a' })
    ;(pipelineStore.loadPipeline as jest.Mock).mockResolvedValue(makeLoadedPipeline(pipe))

    const req = callAsMember(member, 'DELETE', '/api/v1/crm/pipelines/pipe-deals')
    const res = await routeModule.DELETE(req, routeCtx('pipe-deals'))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/live deals/i)
    expect(body.dealCount).toBeGreaterThan(0)
  })

  it('returns 404 for cross-tenant delete', async () => {
    const uid = uidFor('admin12')
    const member = seedOrgMember('org-a', uid, { role: 'admin' })
    stageAuth(member)
    ;(pipelineStore.loadPipeline as jest.Mock).mockResolvedValue(null)

    const req = callAsMember(member, 'DELETE', '/api/v1/crm/pipelines/other-pipe')
    const res = await routeModule.DELETE(req, routeCtx('other-pipe'))
    expect(res.status).toBe(404)
  })

  it('returns 403 for viewer trying to delete', async () => {
    const uid = uidFor('viewer6')
    const member = seedOrgMember('org-a', uid, { role: 'viewer' })
    stageAuth(member)

    const req = callAsMember(member, 'DELETE', '/api/v1/crm/pipelines/pipe-x')
    const res = await routeModule.DELETE(req, routeCtx('pipe-x'))
    expect(res.status).toBe(403)
  })
})
