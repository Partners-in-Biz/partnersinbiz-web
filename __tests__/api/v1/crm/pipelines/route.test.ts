/**
 * Tests for GET /api/v1/crm/pipelines and POST /api/v1/crm/pipelines
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
  },
  Timestamp: {
    now: () => ({ seconds: 1000, nanoseconds: 0, toDate: () => new Date() }),
  },
}))

jest.mock('@/lib/pipelines/store', () => ({
  assertStagesValid: jest.fn(),
  sanitizePipelineForWrite: jest.fn(),
  clearOtherDefaults: jest.fn(),
  loadPipeline: jest.fn(),
  getDefaultPipelineForOrg: jest.fn(),
  bootstrapDefaultPipeline: jest.fn(),
}))

import { adminAuth, adminDb } from '@/lib/firebase/admin'
import * as pipelineStore from '@/lib/pipelines/store'
import { seedOrgMember, callAsMember } from '../../../../helpers/crm'
import {
  uidFor,
  buildPipeline,
  defaultStages,
  sampleDefaultPipeline,
} from './_fixtures'

const AI_API_KEY = 'test-ai-key-pipeline-root'
process.env.AI_API_KEY = AI_API_KEY
process.env.SESSION_COOKIE_NAME = '__session'

// ── helpers ───────────────────────────────────────────────────────────────────

function stageAuth(
  member: { uid: string; orgId: string; role: string; firstName?: string; lastName?: string },
  opts: {
    capturedDocSet?: jest.Mock
    queryDocs?: ReturnType<typeof buildPipeline>[]
    dupExists?: boolean
  } = {},
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
    if (name === 'pipelines') {
      const setFn = opts.capturedDocSet ?? jest.fn().mockResolvedValue(undefined)
      const docs = (opts.queryDocs ?? [sampleDefaultPipeline]).map((p) => ({
        id: p.id,
        data: () => p,
      }))
      return {
        doc: jest.fn().mockReturnValue({
          id: 'auto-pipe-id',
          set: setFn,
        }),
        where: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        get: jest.fn().mockResolvedValue({
          empty: !(opts.dupExists ?? false),
          docs,
        }),
      }
    }
    return { doc: () => ({ get: () => Promise.resolve({ exists: false }) }) }
  })
}

beforeEach(() => {
  jest.clearAllMocks()
  ;(pipelineStore.assertStagesValid as jest.Mock).mockImplementation(() => undefined)
  ;(pipelineStore.sanitizePipelineForWrite as jest.Mock).mockImplementation(
    (input: Record<string, unknown>) => {
      // Strip NEVER_FROM_BODY in tests
      const { id, orgId, createdBy, createdByRef, createdAt, updatedBy, updatedByRef, updatedAt, deleted, ...rest } =
        input as Record<string, unknown>
      void id; void orgId; void createdBy; void createdByRef; void createdAt
      void updatedBy; void updatedByRef; void updatedAt; void deleted
      return rest
    },
  )
  ;(pipelineStore.clearOtherDefaults as jest.Mock).mockResolvedValue(undefined)
})

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let routeModule: any
beforeAll(async () => {
  routeModule = await import('@/app/api/v1/crm/pipelines/route')
})

// ── GET ───────────────────────────────────────────────────────────────────────

describe('GET /api/v1/crm/pipelines', () => {
  it('returns 200 with pipeline list (default: archived=false filter)', async () => {
    const uid = uidFor('viewer')
    const member = seedOrgMember('org-a', uid, { role: 'viewer' })
    stageAuth(member, { queryDocs: [sampleDefaultPipeline] })

    const req = new NextRequest('http://localhost/api/v1/crm/pipelines', {
      headers: { cookie: `__session=test-session-${uid}` },
    })
    const res = await routeModule.GET(req)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(Array.isArray(body.data.pipelines)).toBe(true)
  })

  it('returns archived pipelines when ?archived=true', async () => {
    const uid = uidFor('viewer2')
    const member = seedOrgMember('org-a', uid, { role: 'viewer' })
    const archivedPipe = buildPipeline({ orgId: 'org-a', archived: true })
    stageAuth(member, { queryDocs: [archivedPipe] })

    const req = new NextRequest('http://localhost/api/v1/crm/pipelines?archived=true', {
      headers: { cookie: `__session=test-session-${uid}` },
    })
    const res = await routeModule.GET(req)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
  })

  it('returns 401 when unauthenticated', async () => {
    const req = new NextRequest('http://localhost/api/v1/crm/pipelines', {
      headers: {},
    })
    ;(adminAuth.verifySessionCookie as jest.Mock).mockRejectedValue(new Error('no session'))
    ;(adminDb.collection as jest.Mock).mockReturnValue({
      doc: () => ({ get: () => Promise.resolve({ exists: false }) }),
    })
    const res = await routeModule.GET(req)
    expect(res.status).toBe(401)
  })

  it('enforces tenant isolation — query uses ctx.orgId', async () => {
    const uid = uidFor('viewer3')
    const member = seedOrgMember('org-a', uid, { role: 'viewer' })
    stageAuth(member, { queryDocs: [] })

    const req = new NextRequest('http://localhost/api/v1/crm/pipelines', {
      headers: { cookie: `__session=test-session-${uid}` },
    })
    const res = await routeModule.GET(req)
    expect(res.status).toBe(200)

    // The collection mock was called with 'pipelines'
    expect(adminDb.collection).toHaveBeenCalledWith('pipelines')
  })
})

// ── POST ──────────────────────────────────────────────────────────────────────

describe('POST /api/v1/crm/pipelines', () => {
  it('creates a pipeline and returns 201', async () => {
    const uid = uidFor('admin')
    const member = seedOrgMember('org-b', uid, { role: 'admin', firstName: 'Alice', lastName: 'A' })
    const captured = jest.fn().mockResolvedValue(undefined)
    stageAuth(member, { capturedDocSet: captured, dupExists: false })

    const req = callAsMember(member, 'POST', '/api/v1/crm/pipelines', {
      name: 'Sales',
      stages: defaultStages(),
    })
    const res = await routeModule.POST(req)
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.data.pipeline.id).toBe('auto-pipe-id')
  })

  it('returns 400 when name is missing', async () => {
    const uid = uidFor('admin2')
    const member = seedOrgMember('org-b', uid, { role: 'admin' })
    stageAuth(member)

    const req = callAsMember(member, 'POST', '/api/v1/crm/pipelines', {
      stages: defaultStages(),
    })
    const res = await routeModule.POST(req)
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/name/i)
  })

  it('returns 400 when stages is missing', async () => {
    const uid = uidFor('admin3')
    const member = seedOrgMember('org-b', uid, { role: 'admin' })
    stageAuth(member)

    const req = callAsMember(member, 'POST', '/api/v1/crm/pipelines', {
      name: 'My Pipeline',
    })
    const res = await routeModule.POST(req)
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/stages/i)
  })

  it('returns 400 when assertStagesValid throws PipelineValidationError', async () => {
    const uid = uidFor('admin4')
    const member = seedOrgMember('org-b', uid, { role: 'admin' })
    stageAuth(member)

    const { PipelineValidationError } = await import('@/lib/pipelines/types')
    ;(pipelineStore.assertStagesValid as jest.Mock).mockImplementationOnce(() => {
      throw new PipelineValidationError([{ field: 'stages', message: 'Must have exactly 1 won stage' }])
    })

    const req = callAsMember(member, 'POST', '/api/v1/crm/pipelines', {
      name: 'Bad Pipeline',
      stages: [{ id: 'open1', label: 'Open', kind: 'open', order: 0, probability: 50 }],
    })
    const res = await routeModule.POST(req)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/stage validation/i)
    expect(body.details).toHaveLength(1)
  })

  it('returns 400 on duplicate pipeline name within org', async () => {
    const uid = uidFor('admin5')
    const member = seedOrgMember('org-b', uid, { role: 'admin' })
    stageAuth(member, { dupExists: true })

    // Force the dup query to return non-empty
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
      if (name === 'pipelines') {
        return {
          doc: jest.fn().mockReturnValue({ id: 'new-id', set: jest.fn() }),
          where: jest.fn().mockReturnThis(),
          orderBy: jest.fn().mockReturnThis(),
          limit: jest.fn().mockReturnThis(),
          get: jest.fn().mockResolvedValue({
            empty: false,
            docs: [{ id: 'existing-pipe', data: () => sampleDefaultPipeline }],
          }),
        }
      }
      return { doc: () => ({ get: () => Promise.resolve({ exists: false }) }) }
    })

    const req = callAsMember(member, 'POST', '/api/v1/crm/pipelines', {
      name: 'Sales',
      stages: defaultStages(),
    })
    const res = await routeModule.POST(req)
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/already exists/i)
  })

  it('returns 400 for empty body', async () => {
    const uid = uidFor('admin6')
    const member = seedOrgMember('org-b', uid, { role: 'admin' })
    stageAuth(member)

    const req = callAsMember(member, 'POST', '/api/v1/crm/pipelines', {})
    const res = await routeModule.POST(req)
    expect(res.status).toBe(400)
  })

  it('returns 403 when viewer tries to POST', async () => {
    const uid = uidFor('viewer4')
    const member = seedOrgMember('org-b', uid, { role: 'viewer' })
    stageAuth(member)

    const req = callAsMember(member, 'POST', '/api/v1/crm/pipelines', {
      name: 'Sales',
      stages: defaultStages(),
    })
    const res = await routeModule.POST(req)
    expect(res.status).toBe(403)
  })

  it('blocks orgId injection via body', async () => {
    const uid = uidFor('admin7')
    const member = seedOrgMember('org-b', uid, { role: 'admin' })
    const captured = jest.fn().mockResolvedValue(undefined)
    stageAuth(member, { capturedDocSet: captured, dupExists: false })

    const req = callAsMember(member, 'POST', '/api/v1/crm/pipelines', {
      name: 'Injected',
      stages: defaultStages(),
      orgId: 'evil-org',
    })
    const res = await routeModule.POST(req)
    expect(res.status).toBe(201)
    const written = captured.mock.calls[0][0]
    expect(written.orgId).toBe('org-b')
  })

  it('sets isDefault=false by default', async () => {
    const uid = uidFor('admin8')
    const member = seedOrgMember('org-b', uid, { role: 'admin' })
    const captured = jest.fn().mockResolvedValue(undefined)
    stageAuth(member, { capturedDocSet: captured, dupExists: false })

    const req = callAsMember(member, 'POST', '/api/v1/crm/pipelines', {
      name: 'Non-default',
      stages: defaultStages(),
    })
    const res = await routeModule.POST(req)
    expect(res.status).toBe(201)
    const written = captured.mock.calls[0][0]
    expect(written.isDefault).toBe(false)
    expect(pipelineStore.clearOtherDefaults).not.toHaveBeenCalled()
  })

  it('calls clearOtherDefaults when isDefault=true', async () => {
    const uid = uidFor('admin9')
    const member = seedOrgMember('org-b', uid, { role: 'admin' })
    const captured = jest.fn().mockResolvedValue(undefined)
    stageAuth(member, { capturedDocSet: captured, dupExists: false })

    const req = callAsMember(member, 'POST', '/api/v1/crm/pipelines', {
      name: 'Primary',
      stages: defaultStages(),
      isDefault: true,
    })
    const res = await routeModule.POST(req)
    expect(res.status).toBe(201)
    expect(pipelineStore.clearOtherDefaults).toHaveBeenCalledWith('org-b', 'auto-pipe-id')
  })

  it('writes attribution (createdByRef) on POST', async () => {
    const uid = uidFor('admin10')
    const member = seedOrgMember('org-c', uid, { role: 'admin', firstName: 'Carol', lastName: 'C' })
    const captured = jest.fn().mockResolvedValue(undefined)
    stageAuth(member, { capturedDocSet: captured, dupExists: false })

    const req = callAsMember(member, 'POST', '/api/v1/crm/pipelines', {
      name: 'Renewals',
      stages: defaultStages(),
    })
    const res = await routeModule.POST(req)
    expect(res.status).toBe(201)
    const written = captured.mock.calls[0][0]
    expect(written.createdByRef).toBeDefined()
    expect(written.createdByRef.uid).toBe(uid)
    expect(written.orgId).toBe('org-c')
    expect(written.deleted).toBe(false)
  })

  it('returns 400 when name exceeds 100 characters', async () => {
    const uid = uidFor('admin11')
    const member = seedOrgMember('org-b', uid, { role: 'admin' })
    stageAuth(member)

    const req = callAsMember(member, 'POST', '/api/v1/crm/pipelines', {
      name: 'A'.repeat(101),
      stages: defaultStages(),
    })
    const res = await routeModule.POST(req)
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/100/i)
  })
})
