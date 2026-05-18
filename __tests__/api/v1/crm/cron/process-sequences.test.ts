// __tests__/api/v1/crm/cron/process-sequences.test.ts
// 8 tests for the sequence-processing cron endpoint

// ─── Mocks ────────────────────────────────────────────────────────────────────
jest.mock('@/lib/sequences/enrollment', () => ({
  getDueEnrollments: jest.fn(),
  advanceEnrollment: jest.fn(),
}))

jest.mock('@/lib/sequences/store', () => ({
  getSequence: jest.fn(),
}))

jest.mock('@/lib/email/send', () => ({
  sendEmail: jest.fn(),
}))

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: { collection: jest.fn() },
}))

jest.mock('firebase-admin/firestore', () => ({
  Timestamp: {
    now: jest.fn(() => ({ seconds: 1234567890, nanoseconds: 0 })),
    fromMillis: jest.fn((ms: number) => ({ seconds: Math.floor(ms / 1000), nanoseconds: 0 })),
  },
}))

// ─── Imports after mocks ──────────────────────────────────────────────────────
import { NextRequest } from 'next/server'
import { GET } from '@/app/api/v1/crm/cron/process-sequences/route'
import { getDueEnrollments, advanceEnrollment } from '@/lib/sequences/enrollment'
import { getSequence } from '@/lib/sequences/store'
import { sendEmail } from '@/lib/email/send'
import { adminDb } from '@/lib/firebase/admin'

const mockGetDueEnrollments = getDueEnrollments as jest.Mock
const mockAdvanceEnrollment = advanceEnrollment as jest.Mock
const mockGetSequence = getSequence as jest.Mock
const mockSendEmail = sendEmail as jest.Mock
const mockCollection = adminDb.collection as jest.Mock

// ─── Helpers ─────────────────────────────────────────────────────────────────
function makeReq(authHeader?: string): NextRequest {
  const headers: Record<string, string> = {}
  if (authHeader !== undefined) headers['authorization'] = authHeader
  return new NextRequest('http://localhost/api/v1/crm/cron/process-sequences', { headers })
}

function makeEnrollment(overrides: Partial<{
  id: string
  orgId: string
  sequenceId: string
  contactId: string
  currentStep: number
  status: string
}> = {}) {
  return {
    id: 'enroll-1',
    orgId: 'org-a',
    sequenceId: 'seq-1',
    contactId: 'contact-1',
    currentStep: 0,
    status: 'active',
    ...overrides,
  }
}

function makeSequence(overrides: Partial<{
  status: string
  steps: Array<{ subject: string; bodyHtml: string; delayDays: number }>
}> = {}) {
  return {
    id: 'seq-1',
    orgId: 'org-a',
    name: 'Test Sequence',
    status: 'active',
    steps: [
      { subject: 'Hello!', bodyHtml: '<p>Hello</p>', delayDays: 1 },
      { subject: 'Follow up', bodyHtml: '<p>Follow up</p>', delayDays: 3 },
    ],
    ...overrides,
  }
}

function makeContactDocMock(contactData: Record<string, unknown>) {
  return {
    doc: jest.fn().mockReturnValue({
      get: jest.fn().mockResolvedValue({
        exists: true,
        data: () => contactData,
      }),
    }),
  }
}

// ─── Setup ────────────────────────────────────────────────────────────────────
beforeEach(() => {
  jest.clearAllMocks()
  process.env.CRON_SECRET = 'test-secret'

  mockGetDueEnrollments.mockResolvedValue([])
  mockAdvanceEnrollment.mockResolvedValue(undefined)
  mockSendEmail.mockResolvedValue({ success: true })
})

afterEach(() => {
  delete process.env.CRON_SECRET
})

// ─── Tests ────────────────────────────────────────────────────────────────────
describe('GET /api/v1/crm/cron/process-sequences', () => {
  it('returns 401 when authorization header is missing', async () => {
    const res = await GET(makeReq())
    expect(res.status).toBe(401)
  })

  it('returns 401 when authorization header is wrong', async () => {
    const res = await GET(makeReq('Bearer wrong-token'))
    expect(res.status).toBe(401)
  })

  it('returns 500 when CRON_SECRET is not configured', async () => {
    delete process.env.CRON_SECRET
    const res = await GET(makeReq('Bearer anything'))
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.error).toMatch(/CRON_SECRET not configured/i)
  })

  it('returns 200 with zero counts when no enrollments due', async () => {
    mockGetDueEnrollments.mockResolvedValue([])
    const res = await GET(makeReq('Bearer test-secret'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data).toEqual({ processed: 0, succeeded: 0, failed: 0, errors: [] })
  })

  it('sends email for due enrollment and advances to next step', async () => {
    const enrollment = makeEnrollment({ currentStep: 0 })
    const sequence = makeSequence()
    mockGetDueEnrollments.mockResolvedValue([enrollment])
    mockGetSequence.mockResolvedValue(sequence)
    mockCollection.mockReturnValue(
      makeContactDocMock({ email: 'test@example.com', orgId: 'org-a' })
    )

    const res = await GET(makeReq('Bearer test-secret'))
    expect(res.status).toBe(200)

    expect(mockSendEmail).toHaveBeenCalledWith({
      to: 'test@example.com',
      subject: 'Hello!',
      html: '<p>Hello</p>',
    })

    // Should advance to step 1
    expect(mockAdvanceEnrollment).toHaveBeenCalledWith('enroll-1', expect.objectContaining({
      currentStep: 1,
    }))

    const body = await res.json()
    expect(body.data.processed).toBe(1)
    expect(body.data.succeeded).toBe(1)
    expect(body.data.failed).toBe(0)
  })

  it('marks enrollment completed when no next step exists', async () => {
    const enrollment = makeEnrollment({ currentStep: 1 }) // step 1 is last
    const sequence = makeSequence() // 2 steps: index 0 and 1
    mockGetDueEnrollments.mockResolvedValue([enrollment])
    mockGetSequence.mockResolvedValue(sequence)
    mockCollection.mockReturnValue(
      makeContactDocMock({ email: 'test@example.com', orgId: 'org-a' })
    )

    const res = await GET(makeReq('Bearer test-secret'))
    const body = await res.json()

    expect(mockAdvanceEnrollment).toHaveBeenCalledWith('enroll-1', expect.objectContaining({
      status: 'completed',
      exitReason: 'completed',
    }))
    expect(body.data.succeeded).toBe(1)
  })

  it('exits enrollment when sequence is not active', async () => {
    const enrollment = makeEnrollment()
    mockGetDueEnrollments.mockResolvedValue([enrollment])
    mockGetSequence.mockResolvedValue(makeSequence({ status: 'paused' }))

    const res = await GET(makeReq('Bearer test-secret'))
    const body = await res.json()

    expect(mockAdvanceEnrollment).toHaveBeenCalledWith('enroll-1', {
      status: 'exited',
      exitReason: 'manual',
    })
    expect(mockSendEmail).not.toHaveBeenCalled()
    expect(body.data.processed).toBe(1)
    expect(body.data.succeeded).toBe(0)
  })

  it('records error and continues when email send fails', async () => {
    const enrollment = makeEnrollment()
    mockGetDueEnrollments.mockResolvedValue([enrollment])
    mockGetSequence.mockResolvedValue(makeSequence())
    mockCollection.mockReturnValue(
      makeContactDocMock({ email: 'test@example.com', orgId: 'org-a' })
    )
    mockSendEmail.mockRejectedValue(new Error('SMTP timeout'))

    const res = await GET(makeReq('Bearer test-secret'))
    const body = await res.json()

    expect(body.data.failed).toBe(1)
    expect(body.data.errors).toHaveLength(1)
    expect(body.data.errors[0]).toMatch(/SMTP timeout/)
    expect(res.status).toBe(200)
  })
})
