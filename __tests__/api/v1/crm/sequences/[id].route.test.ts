/**
 * Tests for GET/PUT/DELETE /api/v1/crm/sequences/:id
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

const AI_API_KEY = 'test-ai-key-sequences-id'
process.env.AI_API_KEY = AI_API_KEY
process.env.SESSION_COOKIE_NAME = '__session'

function uidFor(label: string) {
  return `uid-sequences-id-${label}`
}

function buildSequence(overrides: Record<string, unknown> = {}) {
  return {
    id: 'seq-1',
    orgId: 'org-1',
    name: 'Welcome Series',
    description: '',
    status: 'draft',
    steps: [
      { stepNumber: 0, delayDays: 2, subject: 'Welcome!', bodyHtml: '<p>Hi</p>', bodyText: 'Hi' },
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
  routeModule = await import('@/app/api/v1/crm/sequences/[id]/route')
})

const routeCtx = { params: Promise.resolve({ id: 'seq-1' }) }

// ── GET ───────────────────────────────────────────────────────────────────────

describe('GET /api/v1/crm/sequences/:id', () => {
  it('returns 200 with sequence', async () => {
    const uid = uidFor('member-get')
    const member = seedOrgMember('org-1', uid, { role: 'member' })
    stageAuth(member)
    ;(sequenceStore.getSequence as jest.Mock).mockResolvedValue(buildSequence())

    const req = callAsMember(member, 'GET', '/api/v1/crm/sequences/seq-1')
    const res = await routeModule.GET(req, routeCtx)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.data.sequence.id).toBe('seq-1')
    expect(body.data.sequence.name).toBe('Welcome Series')
  })

  it('returns 404 when sequence not found', async () => {
    const uid = uidFor('member-get-404')
    const member = seedOrgMember('org-1', uid, { role: 'member' })
    stageAuth(member)
    ;(sequenceStore.getSequence as jest.Mock).mockResolvedValue(null)

    const req = callAsMember(member, 'GET', '/api/v1/crm/sequences/seq-missing')
    const res = await routeModule.GET(req, { params: Promise.resolve({ id: 'seq-missing' }) })
    expect(res.status).toBe(404)
  })
})

// ── PUT ───────────────────────────────────────────────────────────────────────

describe('PUT /api/v1/crm/sequences/:id', () => {
  it('returns 200 and updates sequence', async () => {
    const uid = uidFor('admin-put')
    const member = seedOrgMember('org-1', uid, { role: 'admin' })
    stageAuth(member)
    const updated = buildSequence({ name: 'Updated Series', status: 'active' })
    ;(sequenceStore.updateSequence as jest.Mock).mockResolvedValue(updated)

    const req = callAsMember(member, 'PUT', '/api/v1/crm/sequences/seq-1', {
      name: 'Updated Series',
      status: 'active',
    })
    const res = await routeModule.PUT(req, routeCtx)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.data.sequence.name).toBe('Updated Series')
  })

  it('returns 404 when sequence not found', async () => {
    const uid = uidFor('admin-put-404')
    const member = seedOrgMember('org-1', uid, { role: 'admin' })
    stageAuth(member)
    ;(sequenceStore.updateSequence as jest.Mock).mockRejectedValue(new Error('Sequence not found'))

    const req = callAsMember(member, 'PUT', '/api/v1/crm/sequences/seq-missing', {
      name: 'Should Fail',
    })
    const res = await routeModule.PUT(req, { params: Promise.resolve({ id: 'seq-missing' }) })
    expect(res.status).toBe(404)
  })

  it('returns 403 when member (not admin) tries to PUT', async () => {
    const uid = uidFor('member-put')
    const member = seedOrgMember('org-1', uid, { role: 'member' })
    stageAuth(member)

    const req = callAsMember(member, 'PUT', '/api/v1/crm/sequences/seq-1', {
      name: 'Unauthorized Update',
    })
    const res = await routeModule.PUT(req, routeCtx)
    expect(res.status).toBe(403)
  })
})

// ── DELETE ────────────────────────────────────────────────────────────────────

describe('DELETE /api/v1/crm/sequences/:id', () => {
  it('returns 200 with deleted:true', async () => {
    const uid = uidFor('admin-delete')
    const member = seedOrgMember('org-1', uid, { role: 'admin' })
    stageAuth(member)
    ;(sequenceStore.deleteSequence as jest.Mock).mockResolvedValue(undefined)

    const req = callAsMember(member, 'DELETE', '/api/v1/crm/sequences/seq-1')
    const res = await routeModule.DELETE(req, routeCtx)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.data.deleted).toBe(true)
  })

  it('returns 404 when sequence not found', async () => {
    const uid = uidFor('admin-delete-404')
    const member = seedOrgMember('org-1', uid, { role: 'admin' })
    stageAuth(member)
    ;(sequenceStore.deleteSequence as jest.Mock).mockRejectedValue(new Error('Sequence not found'))

    const req = callAsMember(member, 'DELETE', '/api/v1/crm/sequences/seq-missing')
    const res = await routeModule.DELETE(req, { params: Promise.resolve({ id: 'seq-missing' }) })
    expect(res.status).toBe(404)
  })
})
