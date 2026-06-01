/**
 * Tests for:
 *   GET  /api/v1/crm/sequences/:id/enrollments
 *   POST /api/v1/crm/sequences/:id/enrollments
 *   DELETE /api/v1/crm/sequences/:id/enrollments/:enrollmentId
 *   GET  /api/v1/crm/contacts/:id/enrollments
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

jest.mock('@/lib/sequences/enrollment', () => {
  class MockSequenceEnrollmentError extends Error {
    status: number

    constructor(message: string, status: number) {
      super(message)
      this.name = 'SequenceEnrollmentError'
      this.status = status
    }
  }

  return {
    listEnrollments: jest.fn(),
    enrollContact: jest.fn(),
    unenrollContact: jest.fn(),
    SequenceEnrollmentError: MockSequenceEnrollmentError,
  }
})

import { adminAuth, adminDb } from '@/lib/firebase/admin'
import * as sequenceStore from '@/lib/sequences/store'
import * as enrollmentModule from '@/lib/sequences/enrollment'
import { seedOrgMember, callAsMember } from '../../../../helpers/crm'

const AI_API_KEY = 'test-ai-key-enrollments'
process.env.AI_API_KEY = AI_API_KEY
process.env.SESSION_COOKIE_NAME = '__session'

function uidFor(label: string) {
  return `uid-enrollments-${label}`
}

function buildSequence(overrides: Record<string, unknown> = {}) {
  return {
    id: 'seq-1',
    orgId: 'org-1',
    name: 'Welcome Series',
    description: '',
    status: 'active',
    steps: [
      { stepNumber: 0, delayDays: 3, subject: 'Welcome!', bodyHtml: '<p>Hi</p>', bodyText: 'Hi' },
    ],
    createdAt: { seconds: 1000, nanoseconds: 0 },
    updatedAt: { seconds: 1000, nanoseconds: 0 },
    ...overrides,
  }
}

function buildEnrollment(overrides: Record<string, unknown> = {}) {
  return {
    id: 'enr-1',
    orgId: 'org-1',
    campaignId: '',
    sequenceId: 'seq-1',
    contactId: 'contact-1',
    status: 'active',
    currentStep: 0,
    enrolledAt: { seconds: 1000, nanoseconds: 0 },
    nextSendAt: { seconds: 2000, nanoseconds: 0 },
    ...overrides,
  }
}

function stageAuth(member: { uid: string; orgId: string; role: string; firstName?: string; lastName?: string }) {
  ;(adminAuth.verifySessionCookie as jest.Mock).mockResolvedValue({ uid: member.uid })
  ;(adminDb.collection as jest.Mock).mockImplementation((name: string) => {
    if (name === 'users') {
      return {
        doc: () => ({
          get: () => Promise.resolve({ exists: true, data: () => ({ activeOrgId: member.orgId, orgIds: [member.orgId] }) }),
        }),
      }
    }
    if (name === 'orgMembers') {
      return {
        where: () => ({
          get: () =>
            Promise.resolve({
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
})

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let seqEnrollmentsRoute: any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let enrollmentDeleteRoute: any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let contactEnrollmentsRoute: any

beforeAll(async () => {
  seqEnrollmentsRoute = await import('@/app/api/v1/crm/sequences/[id]/enrollments/route')
  enrollmentDeleteRoute = await import('@/app/api/v1/crm/sequences/[id]/enrollments/[enrollmentId]/route')
  contactEnrollmentsRoute = await import('@/app/api/v1/crm/contacts/[id]/enrollments/route')
})

// ── GET sequence enrollments ──────────────────────────────────────────────────

describe('GET /api/v1/crm/sequences/:id/enrollments', () => {
  it('returns 200 with enrollments for the sequence', async () => {
    const uid = uidFor('member-get')
    const member = seedOrgMember('org-1', uid, { role: 'member' })
    stageAuth(member)
    ;(enrollmentModule.listEnrollments as jest.Mock).mockResolvedValue([buildEnrollment()])

    const req = callAsMember(member, 'GET', '/api/v1/crm/sequences/seq-1/enrollments')
    const res = await seqEnrollmentsRoute.GET(req, { params: Promise.resolve({ id: 'seq-1' }) })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(Array.isArray(body.data.enrollments)).toBe(true)
    expect(body.data.enrollments).toHaveLength(1)
    expect(enrollmentModule.listEnrollments).toHaveBeenCalledWith('org-1', { sequenceId: 'seq-1' })
  })

  it('returns empty array when no enrollments', async () => {
    const uid = uidFor('member-get-empty')
    const member = seedOrgMember('org-1', uid, { role: 'member' })
    stageAuth(member)
    ;(enrollmentModule.listEnrollments as jest.Mock).mockResolvedValue([])

    const req = callAsMember(member, 'GET', '/api/v1/crm/sequences/seq-1/enrollments')
    const res = await seqEnrollmentsRoute.GET(req, { params: Promise.resolve({ id: 'seq-1' }) })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data.enrollments).toHaveLength(0)
  })
})

// ── POST enroll contact ───────────────────────────────────────────────────────

describe('POST /api/v1/crm/sequences/:id/enrollments', () => {
  it('returns 201 and enrolls contact, using firstStepDelayDays from sequence', async () => {
    const uid = uidFor('member-enroll')
    const member = seedOrgMember('org-1', uid, { role: 'member' })
    stageAuth(member)
    ;(sequenceStore.getSequence as jest.Mock).mockResolvedValue(buildSequence())
    ;(enrollmentModule.enrollContact as jest.Mock).mockResolvedValue(buildEnrollment())

    const req = callAsMember(member, 'POST', '/api/v1/crm/sequences/seq-1/enrollments', {
      contactId: 'contact-1',
    })
    const res = await seqEnrollmentsRoute.POST(req, { params: Promise.resolve({ id: 'seq-1' }) })
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.data.enrollment.id).toBe('enr-1')

    // Verify firstStepDelayDays was pulled from sequence.steps[0].delayDays (3)
    expect(enrollmentModule.enrollContact).toHaveBeenCalledWith(
      'org-1',
      'seq-1',
      'contact-1',
      expect.any(Object),
      3,
    )
  })

  it('returns 400 when contactId is missing', async () => {
    const uid = uidFor('member-enroll-no-contact')
    const member = seedOrgMember('org-1', uid, { role: 'member' })
    stageAuth(member)

    const req = callAsMember(member, 'POST', '/api/v1/crm/sequences/seq-1/enrollments', {
      // no contactId
    })
    const res = await seqEnrollmentsRoute.POST(req, { params: Promise.resolve({ id: 'seq-1' }) })
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/contactId/i)
  })

  it('returns 404 when sequence not found', async () => {
    const uid = uidFor('member-enroll-404')
    const member = seedOrgMember('org-1', uid, { role: 'member' })
    stageAuth(member)
    ;(sequenceStore.getSequence as jest.Mock).mockResolvedValue(null)

    const req = callAsMember(member, 'POST', '/api/v1/crm/sequences/seq-missing/enrollments', {
      contactId: 'contact-1',
    })
    const res = await seqEnrollmentsRoute.POST(req, { params: Promise.resolve({ id: 'seq-missing' }) })
    expect(res.status).toBe(404)
  })

  it('returns 500 when enrollContact throws', async () => {
    const uid = uidFor('member-enroll-err')
    const member = seedOrgMember('org-1', uid, { role: 'member' })
    stageAuth(member)
    ;(sequenceStore.getSequence as jest.Mock).mockResolvedValue(buildSequence())
    ;(enrollmentModule.enrollContact as jest.Mock).mockRejectedValue(new Error('DB error'))

    const req = callAsMember(member, 'POST', '/api/v1/crm/sequences/seq-1/enrollments', {
      contactId: 'contact-1',
    })
    const res = await seqEnrollmentsRoute.POST(req, { params: Promise.resolve({ id: 'seq-1' }) })
    expect(res.status).toBe(500)
  })

  it('returns the typed enrollment error status when the contact is not enrollable', async () => {
    const uid = uidFor('member-enroll-wrong-org-contact')
    const member = seedOrgMember('org-1', uid, { role: 'member' })
    stageAuth(member)
    ;(sequenceStore.getSequence as jest.Mock).mockResolvedValue(buildSequence())
    ;(enrollmentModule.enrollContact as jest.Mock).mockRejectedValue(
      new enrollmentModule.SequenceEnrollmentError('Contact not found', 404),
    )

    const req = callAsMember(member, 'POST', '/api/v1/crm/sequences/seq-1/enrollments', {
      contactId: 'contact-other-org',
    })
    const res = await seqEnrollmentsRoute.POST(req, { params: Promise.resolve({ id: 'seq-1' }) })
    const body = await res.json()

    expect(res.status).toBe(404)
    expect(body.error).toBe('Contact not found')
  })
})

// ── DELETE unenroll ───────────────────────────────────────────────────────────

describe('DELETE /api/v1/crm/sequences/:id/enrollments/:enrollmentId', () => {
  it('returns 200 with unenrolled:true', async () => {
    const uid = uidFor('member-unenroll')
    const member = seedOrgMember('org-1', uid, { role: 'member' })
    stageAuth(member)
    ;(enrollmentModule.unenrollContact as jest.Mock).mockResolvedValue(undefined)

    const req = callAsMember(member, 'DELETE', '/api/v1/crm/sequences/seq-1/enrollments/enr-1')
    const res = await enrollmentDeleteRoute.DELETE(req, {
      params: Promise.resolve({ id: 'seq-1', enrollmentId: 'enr-1' }),
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.data.unenrolled).toBe(true)
    expect(enrollmentModule.unenrollContact).toHaveBeenCalledWith('org-1', 'enr-1', expect.any(Object))
  })

  it('returns 404 when enrollment not found', async () => {
    const uid = uidFor('member-unenroll-404')
    const member = seedOrgMember('org-1', uid, { role: 'member' })
    stageAuth(member)
    ;(enrollmentModule.unenrollContact as jest.Mock).mockRejectedValue(new Error('Enrollment not found'))

    const req = callAsMember(member, 'DELETE', '/api/v1/crm/sequences/seq-1/enrollments/enr-missing')
    const res = await enrollmentDeleteRoute.DELETE(req, {
      params: Promise.resolve({ id: 'seq-1', enrollmentId: 'enr-missing' }),
    })
    expect(res.status).toBe(404)
  })
})

// ── GET contact enrollments ───────────────────────────────────────────────────

describe('GET /api/v1/crm/contacts/:id/enrollments', () => {
  it('returns 200 with enrollments for the contact', async () => {
    const uid = uidFor('member-contact-enrollments')
    const member = seedOrgMember('org-1', uid, { role: 'member' })
    stageAuth(member)
    ;(enrollmentModule.listEnrollments as jest.Mock).mockResolvedValue([
      buildEnrollment({ contactId: 'contact-1' }),
      buildEnrollment({ id: 'enr-2', contactId: 'contact-1', sequenceId: 'seq-2' }),
    ])

    const req = callAsMember(member, 'GET', '/api/v1/crm/contacts/contact-1/enrollments')
    const res = await contactEnrollmentsRoute.GET(req, { params: Promise.resolve({ id: 'contact-1' }) })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(Array.isArray(body.data.enrollments)).toBe(true)
    expect(body.data.enrollments).toHaveLength(2)
    expect(enrollmentModule.listEnrollments).toHaveBeenCalledWith('org-1', { contactId: 'contact-1' })
  })
})
