/**
 * Tests for GET /api/v1/crm/pipelines/default
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
    now: () => ({ seconds: 4000, nanoseconds: 0, toDate: () => new Date() }),
  },
}))

jest.mock('@/lib/pipelines/store', () => ({
  getDefaultPipelineForOrg: jest.fn(),
  bootstrapDefaultPipeline: jest.fn(),
  loadPipeline: jest.fn(),
  assertStagesValid: jest.fn(),
  sanitizePipelineForWrite: jest.fn(),
  clearOtherDefaults: jest.fn(),
}))

import { adminAuth, adminDb } from '@/lib/firebase/admin'
import * as pipelineStore from '@/lib/pipelines/store'
import { seedOrgMember } from '../../../../helpers/crm'
import { uidFor, buildPipeline, sampleDefaultPipeline } from './_fixtures'

const AI_API_KEY = 'test-ai-key-default-route'
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let routeModule: any
beforeAll(async () => {
  routeModule = await import('@/app/api/v1/crm/pipelines/default/route')
})

beforeEach(() => {
  jest.clearAllMocks()
  ;(pipelineStore.bootstrapDefaultPipeline as jest.Mock).mockResolvedValue(sampleDefaultPipeline)
})

// ── GET ───────────────────────────────────────────────────────────────────────

describe('GET /api/v1/crm/pipelines/default', () => {
  it('returns existing default pipeline', async () => {
    const uid = uidFor('viewer')
    const member = seedOrgMember('org-a', uid, { role: 'viewer' })
    stageAuth(member)
    ;(pipelineStore.getDefaultPipelineForOrg as jest.Mock).mockResolvedValue(sampleDefaultPipeline)

    const req = new NextRequest('http://localhost/api/v1/crm/pipelines/default', {
      headers: { cookie: `__session=test-session-${uid}` },
    })
    const res = await routeModule.GET(req)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data.pipeline.isDefault).toBe(true)
    expect(body.data.pipeline.id).toBe('pipe_default_a')
    // bootstrapDefaultPipeline should NOT have been called
    expect(pipelineStore.bootstrapDefaultPipeline).not.toHaveBeenCalled()
  })

  it('bootstraps and returns new default when none exists (member role)', async () => {
    const uid = uidFor('member')
    const member = seedOrgMember('org-b', uid, { role: 'member' })
    stageAuth(member)
    ;(pipelineStore.getDefaultPipelineForOrg as jest.Mock).mockResolvedValue(null)
    const bootstrapped = buildPipeline({ id: 'pipe-new-default', orgId: 'org-b', isDefault: true })
    ;(pipelineStore.bootstrapDefaultPipeline as jest.Mock).mockResolvedValue(bootstrapped)

    const req = new NextRequest('http://localhost/api/v1/crm/pipelines/default', {
      headers: { cookie: `__session=test-session-${uid}` },
    })
    const res = await routeModule.GET(req)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data.pipeline.id).toBe('pipe-new-default')
    expect(pipelineStore.bootstrapDefaultPipeline).toHaveBeenCalledWith('org-b', expect.any(Object))
  })

  it('returns 404 when no default and caller is viewer (read-only)', async () => {
    const uid = uidFor('viewer2')
    const member = seedOrgMember('org-c', uid, { role: 'viewer' })
    stageAuth(member)
    ;(pipelineStore.getDefaultPipelineForOrg as jest.Mock).mockResolvedValue(null)

    const req = new NextRequest('http://localhost/api/v1/crm/pipelines/default', {
      headers: { cookie: `__session=test-session-${uid}` },
    })
    const res = await routeModule.GET(req)
    expect(res.status).toBe(404)
    expect(pipelineStore.bootstrapDefaultPipeline).not.toHaveBeenCalled()
  })

  it('bootstraps when admin calls and no default exists', async () => {
    const uid = uidFor('admin')
    const member = seedOrgMember('org-d', uid, { role: 'admin' })
    stageAuth(member)
    ;(pipelineStore.getDefaultPipelineForOrg as jest.Mock).mockResolvedValue(null)
    const bootstrapped = buildPipeline({ id: 'pipe-admin-boot', orgId: 'org-d', isDefault: true })
    ;(pipelineStore.bootstrapDefaultPipeline as jest.Mock).mockResolvedValue(bootstrapped)

    const req = new NextRequest('http://localhost/api/v1/crm/pipelines/default', {
      headers: { cookie: `__session=test-session-${uid}` },
    })
    const res = await routeModule.GET(req)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data.pipeline.id).toBe('pipe-admin-boot')
  })

  it('returns 401 when unauthenticated', async () => {
    const req = new NextRequest('http://localhost/api/v1/crm/pipelines/default', {
      headers: {},
    })
    ;(adminAuth.verifySessionCookie as jest.Mock).mockRejectedValue(new Error('no session'))
    ;(adminDb.collection as jest.Mock).mockReturnValue({
      doc: () => ({ get: () => Promise.resolve({ exists: false }) }),
    })
    const res = await routeModule.GET(req)
    expect(res.status).toBe(401)
  })
})
