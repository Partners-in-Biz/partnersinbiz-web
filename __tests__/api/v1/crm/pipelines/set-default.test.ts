/**
 * Tests for POST /api/v1/crm/pipelines/:id/set-default
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
    now: () => ({ seconds: 3000, nanoseconds: 0, toDate: () => new Date() }),
  },
}))

jest.mock('@/lib/pipelines/store', () => ({
  loadPipeline: jest.fn(),
  clearOtherDefaults: jest.fn(),
  assertStagesValid: jest.fn(),
  sanitizePipelineForWrite: jest.fn(),
  getDefaultPipelineForOrg: jest.fn(),
  bootstrapDefaultPipeline: jest.fn(),
}))

import { adminAuth, adminDb } from '@/lib/firebase/admin'
import * as pipelineStore from '@/lib/pipelines/store'
import { seedOrgMember, callAsMember } from '../../../../helpers/crm'
import { uidFor, buildPipeline } from './_fixtures'

const AI_API_KEY = 'test-ai-key-set-default'
process.env.AI_API_KEY = AI_API_KEY
process.env.SESSION_COOKIE_NAME = '__session'

// ── helpers ───────────────────────────────────────────────────────────────────

function stageAuth(
  member: { uid: string; orgId: string; role: string; firstName?: string; lastName?: string },
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
    return { doc: () => ({ get: () => Promise.resolve({ exists: false }) }) }
  })
}

function routeCtx(id: string) {
  return { params: Promise.resolve({ id }) }
}

const updateFn = jest.fn().mockResolvedValue(undefined)

function makeLoaded(pipeline: ReturnType<typeof buildPipeline>) {
  updateFn.mockResolvedValue(undefined)
  return {
    ref: { update: updateFn, id: pipeline.id },
    data: pipeline,
  }
}

beforeEach(() => {
  jest.clearAllMocks()
  ;(pipelineStore.clearOtherDefaults as jest.Mock).mockResolvedValue(undefined)
})

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let routeModule: any
beforeAll(async () => {
  routeModule = await import('@/app/api/v1/crm/pipelines/[id]/set-default/route')
})

// ── POST ──────────────────────────────────────────────────────────────────────

describe('POST /api/v1/crm/pipelines/[id]/set-default', () => {
  it('sets this pipeline as default and clears others', async () => {
    const uid = uidFor('admin')
    const member = seedOrgMember('org-a', uid, { role: 'admin' })
    stageAuth(member)
    const pipe = buildPipeline({ id: 'pipe-sd', orgId: 'org-a', isDefault: false })
    ;(pipelineStore.loadPipeline as jest.Mock).mockResolvedValue(makeLoaded(pipe))

    const req = callAsMember(member, 'POST', '/api/v1/crm/pipelines/pipe-sd/set-default')
    const res = await routeModule.POST(req, routeCtx('pipe-sd'))
    expect(res.status).toBe(200)

    // clearOtherDefaults was called first
    expect(pipelineStore.clearOtherDefaults).toHaveBeenCalledWith('org-a', 'pipe-sd')

    // Then update was called with isDefault: true
    expect(updateFn).toHaveBeenCalledWith(expect.objectContaining({ isDefault: true }))

    const body = await res.json()
    expect(body.data.pipeline.isDefault).toBe(true)
  })

  it('returns 404 for cross-tenant pipeline', async () => {
    const uid = uidFor('admin2')
    const member = seedOrgMember('org-a', uid, { role: 'admin' })
    stageAuth(member)
    ;(pipelineStore.loadPipeline as jest.Mock).mockResolvedValue(null)

    const req = callAsMember(member, 'POST', '/api/v1/crm/pipelines/other-org-pipe/set-default')
    const res = await routeModule.POST(req, routeCtx('other-org-pipe'))
    expect(res.status).toBe(404)
    expect(pipelineStore.clearOtherDefaults).not.toHaveBeenCalled()
  })

  it('returns 403 for viewer', async () => {
    const uid = uidFor('viewer')
    const member = seedOrgMember('org-a', uid, { role: 'viewer' })
    stageAuth(member)

    const req = callAsMember(member, 'POST', '/api/v1/crm/pipelines/pipe-x/set-default')
    const res = await routeModule.POST(req, routeCtx('pipe-x'))
    expect(res.status).toBe(403)
  })

  it('correctly swaps default even when pipeline was already default', async () => {
    const uid = uidFor('admin3')
    const member = seedOrgMember('org-a', uid, { role: 'admin' })
    stageAuth(member)
    // Pipeline is already default — set-default should still work (idempotent)
    const pipe = buildPipeline({ id: 'pipe-already-default', orgId: 'org-a', isDefault: true })
    ;(pipelineStore.loadPipeline as jest.Mock).mockResolvedValue(makeLoaded(pipe))

    const req = callAsMember(member, 'POST', '/api/v1/crm/pipelines/pipe-already-default/set-default')
    const res = await routeModule.POST(req, routeCtx('pipe-already-default'))
    expect(res.status).toBe(200)
    expect(pipelineStore.clearOtherDefaults).toHaveBeenCalled()
    const body = await res.json()
    expect(body.data.pipeline.isDefault).toBe(true)
  })

  it('returns 404 for soft-deleted pipeline', async () => {
    const uid = uidFor('admin4')
    const member = seedOrgMember('org-a', uid, { role: 'admin' })
    stageAuth(member)
    ;(pipelineStore.loadPipeline as jest.Mock).mockResolvedValue(null)

    const req = callAsMember(member, 'POST', '/api/v1/crm/pipelines/deleted-pipe/set-default')
    const res = await routeModule.POST(req, routeCtx('deleted-pipe'))
    expect(res.status).toBe(404)
  })
})
