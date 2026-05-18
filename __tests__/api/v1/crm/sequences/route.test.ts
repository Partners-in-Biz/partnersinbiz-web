/**
 * Tests for GET /api/v1/crm/sequences and POST /api/v1/crm/sequences
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

jest.mock('@/lib/sequences/store', () => ({
  listSequences: jest.fn(),
  getSequence: jest.fn(),
  createSequence: jest.fn(),
  updateSequence: jest.fn(),
  deleteSequence: jest.fn(),
}))

jest.mock('@/lib/sequences/enrollment', () => ({
  listEnrollments: jest.fn(),
  enrollContact: jest.fn(),
  unenrollContact: jest.fn(),
}))

import { adminAuth, adminDb } from '@/lib/firebase/admin'
import * as sequenceStore from '@/lib/sequences/store'
import { seedOrgMember, callAsMember } from '../../../../helpers/crm'

const AI_API_KEY = 'test-ai-key-sequences-root'
process.env.AI_API_KEY = AI_API_KEY
process.env.SESSION_COOKIE_NAME = '__session'

// ── helpers ───────────────────────────────────────────────────────────────────

function uidFor(label: string) {
  return `uid-sequences-${label}`
}

function buildSequence(overrides: Record<string, unknown> = {}) {
  return {
    id: 'seq-1',
    orgId: 'org-1',
    name: 'Welcome Series',
    description: 'Onboarding sequence',
    status: 'draft',
    steps: [
      { stepNumber: 0, delayDays: 0, subject: 'Welcome!', bodyHtml: '<p>Hi</p>', bodyText: 'Hi' },
    ],
    createdAt: { seconds: 1000, nanoseconds: 0 },
    updatedAt: { seconds: 1000, nanoseconds: 0 },
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

beforeEach(() => {
  jest.clearAllMocks()
})

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let routeModule: any
beforeAll(async () => {
  routeModule = await import('@/app/api/v1/crm/sequences/route')
})

// ── GET ───────────────────────────────────────────────────────────────────────

describe('GET /api/v1/crm/sequences', () => {
  it('returns 200 with sequences array', async () => {
    const uid = uidFor('member-get')
    const member = seedOrgMember('org-1', uid, { role: 'member' })
    stageAuth(member)
    ;(sequenceStore.listSequences as jest.Mock).mockResolvedValue([buildSequence()])

    const req = callAsMember(member, 'GET', '/api/v1/crm/sequences')
    const res = await routeModule.GET(req)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(Array.isArray(body.data.sequences)).toBe(true)
    expect(body.data.sequences).toHaveLength(1)
    expect(body.data.sequences[0].name).toBe('Welcome Series')
  })

  it('returns 200 with empty array when no sequences', async () => {
    const uid = uidFor('member-get-empty')
    const member = seedOrgMember('org-1', uid, { role: 'member' })
    stageAuth(member)
    ;(sequenceStore.listSequences as jest.Mock).mockResolvedValue([])

    const req = callAsMember(member, 'GET', '/api/v1/crm/sequences')
    const res = await routeModule.GET(req)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data.sequences).toHaveLength(0)
  })

  it('returns 401 when unauthenticated', async () => {
    ;(adminAuth.verifySessionCookie as jest.Mock).mockRejectedValue(new Error('no session'))
    ;(adminDb.collection as jest.Mock).mockReturnValue({
      doc: () => ({ get: () => Promise.resolve({ exists: false }) }),
    })
    const req = new NextRequest('http://localhost/api/v1/crm/sequences')
    const res = await routeModule.GET(req)
    expect(res.status).toBe(401)
  })
})

// ── POST ──────────────────────────────────────────────────────────────────────

describe('POST /api/v1/crm/sequences', () => {
  it('returns 201 and creates sequence', async () => {
    const uid = uidFor('admin-post')
    const member = seedOrgMember('org-1', uid, { role: 'admin', firstName: 'Alice', lastName: 'A' })
    stageAuth(member)
    const created = buildSequence({ name: 'Nurture Series' })
    ;(sequenceStore.createSequence as jest.Mock).mockResolvedValue(created)

    const req = callAsMember(member, 'POST', '/api/v1/crm/sequences', {
      name: 'Nurture Series',
      steps: [{ stepNumber: 0, delayDays: 1, subject: 'Hello', bodyHtml: '<p>Hi</p>', bodyText: 'Hi' }],
    })
    const res = await routeModule.POST(req)
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.data.sequence.name).toBe('Nurture Series')
  })

  it('returns 400 when name is missing', async () => {
    const uid = uidFor('admin-no-name')
    const member = seedOrgMember('org-1', uid, { role: 'admin' })
    stageAuth(member)

    const req = callAsMember(member, 'POST', '/api/v1/crm/sequences', {
      steps: [{ stepNumber: 0, delayDays: 0, subject: 'Hi', bodyHtml: '', bodyText: '' }],
    })
    const res = await routeModule.POST(req)
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/name/i)
  })

  it('returns 400 when steps is missing', async () => {
    const uid = uidFor('admin-no-steps')
    const member = seedOrgMember('org-1', uid, { role: 'admin' })
    stageAuth(member)

    const req = callAsMember(member, 'POST', '/api/v1/crm/sequences', {
      name: 'No Steps Sequence',
    })
    const res = await routeModule.POST(req)
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/steps/i)
  })

  it('returns 400 when steps is empty array', async () => {
    const uid = uidFor('admin-empty-steps')
    const member = seedOrgMember('org-1', uid, { role: 'admin' })
    stageAuth(member)

    const req = callAsMember(member, 'POST', '/api/v1/crm/sequences', {
      name: 'Empty Steps',
      steps: [],
    })
    const res = await routeModule.POST(req)
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/steps/i)
  })

  it('returns 403 when member (not admin) tries to POST', async () => {
    const uid = uidFor('member-post')
    const member = seedOrgMember('org-1', uid, { role: 'member' })
    stageAuth(member)

    const req = callAsMember(member, 'POST', '/api/v1/crm/sequences', {
      name: 'Test',
      steps: [{ stepNumber: 0, delayDays: 0, subject: 'Hi', bodyHtml: '', bodyText: '' }],
    })
    const res = await routeModule.POST(req)
    expect(res.status).toBe(403)
  })

  it('ignores id/orgId/createdAt/createdByRef/updatedByRef from body', async () => {
    const uid = uidFor('admin-denylist')
    const member = seedOrgMember('org-safe', uid, { role: 'admin' })
    stageAuth(member)
    const created = buildSequence({ orgId: 'org-safe' })
    ;(sequenceStore.createSequence as jest.Mock).mockResolvedValue(created)

    const req = callAsMember(member, 'POST', '/api/v1/crm/sequences', {
      name: 'Safe Sequence',
      steps: [{ stepNumber: 0, delayDays: 0, subject: 'Hi', bodyHtml: '', bodyText: '' }],
      id: 'injected-id',
      orgId: 'evil-org',
      createdAt: 'injected-ts',
      updatedAt: 'injected-ts',
      createdByRef: { uid: 'evil' },
      updatedByRef: { uid: 'evil' },
    })
    const res = await routeModule.POST(req)
    expect(res.status).toBe(201)

    const [calledOrgId, calledInput] = (sequenceStore.createSequence as jest.Mock).mock.calls[0]
    expect(calledOrgId).toBe('org-safe')
    expect(calledInput).not.toHaveProperty('id')
    expect(calledInput).not.toHaveProperty('orgId')
    expect(calledInput).not.toHaveProperty('createdAt')
    expect(calledInput).not.toHaveProperty('updatedAt')
    expect(calledInput).not.toHaveProperty('createdByRef')
    expect(calledInput).not.toHaveProperty('updatedByRef')
  })

  it('returns 400 for empty body', async () => {
    const uid = uidFor('admin-empty')
    const member = seedOrgMember('org-1', uid, { role: 'admin' })
    stageAuth(member)

    const req = callAsMember(member, 'POST', '/api/v1/crm/sequences', {})
    const res = await routeModule.POST(req)
    expect(res.status).toBe(400)
  })

  it('returns 500 when store throws unexpected error', async () => {
    const uid = uidFor('admin-store-err')
    const member = seedOrgMember('org-1', uid, { role: 'admin' })
    stageAuth(member)
    ;(sequenceStore.createSequence as jest.Mock).mockRejectedValue(new Error('DB connection lost'))

    const req = callAsMember(member, 'POST', '/api/v1/crm/sequences', {
      name: 'Failing Sequence',
      steps: [{ stepNumber: 0, delayDays: 0, subject: 'Hi', bodyHtml: '', bodyText: '' }],
    })
    const res = await routeModule.POST(req)
    expect(res.status).toBe(500)
  })

  it('passes actor to createSequence', async () => {
    const uid = uidFor('admin-actor')
    const member = seedOrgMember('org-actor', uid, { role: 'admin', firstName: 'Bob', lastName: 'B' })
    stageAuth(member)
    ;(sequenceStore.createSequence as jest.Mock).mockResolvedValue(buildSequence())

    const req = callAsMember(member, 'POST', '/api/v1/crm/sequences', {
      name: 'Actor Sequence',
      steps: [{ stepNumber: 0, delayDays: 0, subject: 'Hi', bodyHtml: '', bodyText: '' }],
    })
    await routeModule.POST(req)
    const [, , actor] = (sequenceStore.createSequence as jest.Mock).mock.calls[0]
    expect(actor.uid).toBe(uid)
    expect(actor.kind).toBe('human')
  })
})
