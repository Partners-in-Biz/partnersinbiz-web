/**
 * Tests for GET /api/v1/crm/automations and POST /api/v1/crm/automations
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
    now: () => ({ seconds: 1000, nanoseconds: 0, toDate: () => new Date() }),
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

jest.mock('@/lib/sequences/store', () => ({
  getSequence: jest.fn(),
}))

import { adminAuth, adminDb } from '@/lib/firebase/admin'
import * as automationStore from '@/lib/automations/store'
import * as sequenceStore from '@/lib/sequences/store'
import { seedOrgMember, callAsMember } from '../../../../helpers/crm'

const AI_API_KEY = 'test-ai-key-automations-root'
process.env.AI_API_KEY = AI_API_KEY
process.env.SESSION_COOKIE_NAME = '__session'

// ── helpers ───────────────────────────────────────────────────────────────────

function uidFor(label: string) {
  return `uid-automations-${label}`
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
    updatedAt: { seconds: 1000, nanoseconds: 0 },
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
        where: () => ({
          get: () => Promise.resolve({
            docs: [
              {
                id: `${member.orgId}_${member.uid}`,
                data: () => member,
              },
            ],
          }),
        }),
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

beforeEach(() => {
  jest.clearAllMocks()
  ;(sequenceStore.getSequence as jest.Mock).mockResolvedValue({
    id: 'seq-active',
    orgId: 'org-1',
    name: 'Active welcome',
    status: 'active',
    steps: [{ stepNumber: 0, delayDays: 0, subject: 'Hi', bodyHtml: '<p>Hi</p>', bodyText: 'Hi' }],
  })
})

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let routeModule: any
beforeAll(async () => {
  routeModule = await import('@/app/api/v1/crm/automations/route')
})

// ── GET ───────────────────────────────────────────────────────────────────────

describe('GET /api/v1/crm/automations', () => {
  it('returns 200 with rules array', async () => {
    const uid = uidFor('member-get')
    const member = seedOrgMember('org-1', uid, { role: 'member' })
    stageAuth(member)
    ;(automationStore.listRules as jest.Mock).mockResolvedValue([buildRule()])

    const req = callAsMember(member, 'GET', '/api/v1/crm/automations')
    const res = await routeModule.GET(req)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(Array.isArray(body.data.rules)).toBe(true)
    expect(body.data.rules).toHaveLength(1)
    expect(body.data.rules[0].name).toBe('Welcome Email')
  })

  it('member role can access GET', async () => {
    const uid = uidFor('member-get-role')
    const member = seedOrgMember('org-1', uid, { role: 'member' })
    stageAuth(member)
    ;(automationStore.listRules as jest.Mock).mockResolvedValue([])

    const req = callAsMember(member, 'GET', '/api/v1/crm/automations')
    const res = await routeModule.GET(req)
    expect(res.status).toBe(200)
  })
})

// ── POST ──────────────────────────────────────────────────────────────────────

describe('POST /api/v1/crm/automations', () => {
  it('returns 201 and creates rule with name + trigger + actions', async () => {
    const uid = uidFor('admin-post')
    const member = seedOrgMember('org-1', uid, { role: 'admin', firstName: 'Alice', lastName: 'A' })
    stageAuth(member)
    const created = buildRule()
    ;(automationStore.createRule as jest.Mock).mockResolvedValue(created)

    const req = callAsMember(member, 'POST', '/api/v1/crm/automations', {
      name: 'Welcome Email',
      trigger: { event: 'contact.created' },
      actions: [{ type: 'send_email', templateId: 'tmpl-welcome' }],
    })
    const res = await routeModule.POST(req)
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.data.rule.name).toBe('Welcome Email')
  })

  it('returns 400 when name is missing', async () => {
    const uid = uidFor('admin-no-name')
    const member = seedOrgMember('org-1', uid, { role: 'admin' })
    stageAuth(member)

    const req = callAsMember(member, 'POST', '/api/v1/crm/automations', {
      trigger: { event: 'contact.created' },
      actions: [{ type: 'send_email' }],
    })
    const res = await routeModule.POST(req)
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/name/i)
  })

  it('returns 400 when trigger is missing', async () => {
    const uid = uidFor('admin-no-trigger')
    const member = seedOrgMember('org-1', uid, { role: 'admin' })
    stageAuth(member)

    const req = callAsMember(member, 'POST', '/api/v1/crm/automations', {
      name: 'My Rule',
      actions: [{ type: 'send_email' }],
    })
    const res = await routeModule.POST(req)
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/trigger/i)
  })

  it('returns 400 when actions is empty array', async () => {
    const uid = uidFor('admin-empty-actions')
    const member = seedOrgMember('org-1', uid, { role: 'admin' })
    stageAuth(member)

    const req = callAsMember(member, 'POST', '/api/v1/crm/automations', {
      name: 'My Rule',
      trigger: { event: 'contact.created' },
      actions: [],
    })
    const res = await routeModule.POST(req)
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/actions/i)
  })

  it('returns 400 when trigger.event is invalid', async () => {
    const uid = uidFor('admin-bad-event')
    const member = seedOrgMember('org-1', uid, { role: 'admin' })
    stageAuth(member)

    const req = callAsMember(member, 'POST', '/api/v1/crm/automations', {
      name: 'My Rule',
      trigger: { event: 'invalid.event' },
      actions: [{ type: 'send_email' }],
    })
    const res = await routeModule.POST(req)
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/trigger\.event/i)
  })

  it('returns 403 when role is member', async () => {
    const uid = uidFor('member-post')
    const member = seedOrgMember('org-1', uid, { role: 'member' })
    stageAuth(member)

    const req = callAsMember(member, 'POST', '/api/v1/crm/automations', {
      name: 'My Rule',
      trigger: { event: 'contact.created' },
      actions: [{ type: 'send_email' }],
    })
    const res = await routeModule.POST(req)
    expect(res.status).toBe(403)
  })

  it('ignores id/orgId from body', async () => {
    const uid = uidFor('admin-denylist')
    const member = seedOrgMember('org-safe', uid, { role: 'admin' })
    stageAuth(member)
    const created = buildRule({ orgId: 'org-safe' })
    ;(automationStore.createRule as jest.Mock).mockResolvedValue(created)

    const req = callAsMember(member, 'POST', '/api/v1/crm/automations', {
      name: 'Safe Rule',
      trigger: { event: 'deal.created' },
      actions: [{ type: 'notify_slack' }],
      id: 'injected-id',
      orgId: 'evil-org',
      createdAt: 'injected-ts',
      updatedAt: 'injected-ts',
      createdByRef: { uid: 'evil' },
      updatedByRef: { uid: 'evil' },
    })
    const res = await routeModule.POST(req)
    expect(res.status).toBe(201)

    const [calledOrgId, calledInput] = (automationStore.createRule as jest.Mock).mock.calls[0]
    expect(calledOrgId).toBe('org-safe')
    expect(calledInput).not.toHaveProperty('id')
    expect(calledInput).not.toHaveProperty('orgId')
    expect(calledInput).not.toHaveProperty('createdAt')
    expect(calledInput).not.toHaveProperty('updatedAt')
    expect(calledInput).not.toHaveProperty('createdByRef')
    expect(calledInput).not.toHaveProperty('updatedByRef')
  })

  it('enabled defaults to true when not provided', async () => {
    const uid = uidFor('admin-enabled-default')
    const member = seedOrgMember('org-1', uid, { role: 'admin' })
    stageAuth(member)
    ;(automationStore.createRule as jest.Mock).mockResolvedValue(buildRule())

    const req = callAsMember(member, 'POST', '/api/v1/crm/automations', {
      name: 'My Rule',
      trigger: { event: 'deal.won' },
      actions: [{ type: 'send_email' }],
    })
    await routeModule.POST(req)

    const [, calledInput] = (automationStore.createRule as jest.Mock).mock.calls[0]
    expect(calledInput.enabled).toBe(true)
  })

  it('returns 400 when a sequence enrollment action targets an inactive sequence', async () => {
    const uid = uidFor('admin-inactive-sequence')
    const member = seedOrgMember('org-1', uid, { role: 'admin' })
    stageAuth(member)
    ;(sequenceStore.getSequence as jest.Mock).mockResolvedValueOnce({
      id: 'seq-draft',
      orgId: 'org-1',
      name: 'Draft welcome',
      status: 'draft',
      steps: [{ stepNumber: 0, delayDays: 0, subject: 'Hi', bodyHtml: '<p>Hi</p>', bodyText: 'Hi' }],
    })

    const req = callAsMember(member, 'POST', '/api/v1/crm/automations', {
      name: 'Enroll new contact',
      trigger: { event: 'contact.created' },
      actions: [{ type: 'enroll_in_sequence', sequenceId: 'seq-draft' }],
    })
    const res = await routeModule.POST(req)

    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/active sequence/i)
    expect(automationStore.createRule).not.toHaveBeenCalled()
  })

  it('returns 400 for empty body', async () => {
    const uid = uidFor('admin-empty')
    const member = seedOrgMember('org-1', uid, { role: 'admin' })
    stageAuth(member)

    const req = callAsMember(member, 'POST', '/api/v1/crm/automations', {})
    const res = await routeModule.POST(req)
    expect(res.status).toBe(400)
  })

  it('returns 500 when store throws unexpected error', async () => {
    const uid = uidFor('admin-store-err')
    const member = seedOrgMember('org-1', uid, { role: 'admin' })
    stageAuth(member)
    ;(automationStore.createRule as jest.Mock).mockRejectedValue(new Error('DB connection lost'))

    const req = callAsMember(member, 'POST', '/api/v1/crm/automations', {
      name: 'My Rule',
      trigger: { event: 'contact.created' },
      actions: [{ type: 'send_email' }],
    })
    const res = await routeModule.POST(req)
    expect(res.status).toBe(500)
  })
})
