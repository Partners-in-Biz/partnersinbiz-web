/**
 * Tests for PUT /api/v1/crm/automations/:id and DELETE /api/v1/crm/automations/:id
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

jest.mock('@/lib/automations/store', () => ({
  listRules: jest.fn(),
  getRule: jest.fn(),
  createRule: jest.fn(),
  updateRule: jest.fn(),
  deleteRule: jest.fn(),
  getMatchingRules: jest.fn(),
  queuePendingAutomation: jest.fn(),
  getPendingDue: jest.fn(),
  markExecuted: jest.fn(),
  markFailed: jest.fn(),
}))

import { adminAuth, adminDb } from '@/lib/firebase/admin'
import * as automationStore from '@/lib/automations/store'
import { seedOrgMember, callAsMember } from '../../../../helpers/crm'

const AI_API_KEY = 'test-ai-key-automations-id'
process.env.AI_API_KEY = AI_API_KEY
process.env.SESSION_COOKIE_NAME = '__session'

// ── helpers ───────────────────────────────────────────────────────────────────

function uidFor(label: string) {
  return `uid-automations-id-${label}`
}

function buildRule(overrides: Record<string, unknown> = {}) {
  return {
    id: 'rule-1',
    orgId: 'org-1',
    name: 'Welcome Email',
    trigger: { event: 'contact.created' },
    actions: [{ type: 'send_email', templateId: 'tmpl-welcome' }],
    enabled: true,
    createdAt: { seconds: 1000, nanoseconds: 0 },
    updatedAt: { seconds: 2000, nanoseconds: 0 },
    createdByRef: { uid: 'u1', displayName: 'Test User', kind: 'human' },
    updatedByRef: { uid: 'u1', displayName: 'Test User', kind: 'human' },
    ...overrides,
  }
}

function stageAuth(member: { uid: string; orgId: string; role: string; firstName?: string; lastName?: string }) {
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

// ── routeCtx helper ──────────────────────────────────────────────────────────

function makeCtx(id: string) {
  return { params: Promise.resolve({ id }) }
}

beforeEach(() => {
  jest.clearAllMocks()
})

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let routeModule: any
beforeAll(async () => {
  routeModule = await import('@/app/api/v1/crm/automations/[id]/route')
})

// ── PUT ───────────────────────────────────────────────────────────────────────

describe('PUT /api/v1/crm/automations/:id', () => {
  it('returns 200 and updated rule', async () => {
    const uid = uidFor('admin-put')
    const member = seedOrgMember('org-1', uid, { role: 'admin' })
    stageAuth(member)
    const updated = buildRule({ name: 'Updated Rule', enabled: false })
    ;(automationStore.updateRule as jest.Mock).mockResolvedValue(updated)

    const req = callAsMember(member, 'PUT', '/api/v1/crm/automations/rule-1', {
      name: 'Updated Rule',
      enabled: false,
    })
    const res = await routeModule.PUT(req, makeCtx('rule-1'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.data.rule.name).toBe('Updated Rule')
  })

  it('returns 404 when store throws not-found error', async () => {
    const uid = uidFor('admin-put-404')
    const member = seedOrgMember('org-1', uid, { role: 'admin' })
    stageAuth(member)
    ;(automationStore.updateRule as jest.Mock).mockRejectedValue(new Error('Rule not found'))

    const req = callAsMember(member, 'PUT', '/api/v1/crm/automations/missing', {
      name: 'Ghost Rule',
    })
    const res = await routeModule.PUT(req, makeCtx('missing'))
    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body.error).toMatch(/not found/i)
  })

  it('returns 403 when member tries to PUT', async () => {
    const uid = uidFor('member-put')
    const member = seedOrgMember('org-1', uid, { role: 'member' })
    stageAuth(member)

    const req = callAsMember(member, 'PUT', '/api/v1/crm/automations/rule-1', {
      name: 'Updated',
    })
    const res = await routeModule.PUT(req, makeCtx('rule-1'))
    expect(res.status).toBe(403)
  })

  it('ignores id/orgId from body', async () => {
    const uid = uidFor('admin-denylist')
    const member = seedOrgMember('org-safe', uid, { role: 'admin' })
    stageAuth(member)
    ;(automationStore.updateRule as jest.Mock).mockResolvedValue(buildRule())

    const req = callAsMember(member, 'PUT', '/api/v1/crm/automations/rule-1', {
      name: 'Safe Update',
      id: 'injected-id',
      orgId: 'evil-org',
      createdAt: 'injected-ts',
      updatedAt: 'injected-ts',
      createdByRef: { uid: 'evil' },
      updatedByRef: { uid: 'evil' },
    })
    const res = await routeModule.PUT(req, makeCtx('rule-1'))
    expect(res.status).toBe(200)

    const [calledOrgId, calledId, calledPatch] = (automationStore.updateRule as jest.Mock).mock.calls[0]
    expect(calledOrgId).toBe('org-safe')
    expect(calledId).toBe('rule-1')
    expect(calledPatch).not.toHaveProperty('id')
    expect(calledPatch).not.toHaveProperty('orgId')
    expect(calledPatch).not.toHaveProperty('createdAt')
    expect(calledPatch).not.toHaveProperty('updatedAt')
    expect(calledPatch).not.toHaveProperty('createdByRef')
    expect(calledPatch).not.toHaveProperty('updatedByRef')
  })
})

// ── DELETE ────────────────────────────────────────────────────────────────────

describe('DELETE /api/v1/crm/automations/:id', () => {
  it('returns 200 with deleted: true', async () => {
    const uid = uidFor('admin-delete')
    const member = seedOrgMember('org-1', uid, { role: 'admin' })
    stageAuth(member)
    ;(automationStore.deleteRule as jest.Mock).mockResolvedValue(undefined)

    const req = callAsMember(member, 'DELETE', '/api/v1/crm/automations/rule-1')
    const res = await routeModule.DELETE(req, makeCtx('rule-1'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.data.deleted).toBe(true)
  })

  it('returns 404 when store throws not-found error', async () => {
    const uid = uidFor('admin-delete-404')
    const member = seedOrgMember('org-1', uid, { role: 'admin' })
    stageAuth(member)
    ;(automationStore.deleteRule as jest.Mock).mockRejectedValue(new Error('Rule not found'))

    const req = callAsMember(member, 'DELETE', '/api/v1/crm/automations/missing')
    const res = await routeModule.DELETE(req, makeCtx('missing'))
    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body.error).toMatch(/not found/i)
  })

  it('returns 403 when member tries to DELETE', async () => {
    const uid = uidFor('member-delete')
    const member = seedOrgMember('org-1', uid, { role: 'member' })
    stageAuth(member)

    const req = callAsMember(member, 'DELETE', '/api/v1/crm/automations/rule-1')
    const res = await routeModule.DELETE(req, makeCtx('rule-1'))
    expect(res.status).toBe(403)
  })
})
