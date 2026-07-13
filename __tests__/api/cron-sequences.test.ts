// __tests__/api/cron-sequences.test.ts
import { NextRequest } from 'next/server'

const mockGet = jest.fn()
const mockAdd = jest.fn()
const mockUpdate = jest.fn()
const mockDoc = jest.fn()
const mockCollection = jest.fn()
const mockWhere = jest.fn()
const mockOrderBy = jest.fn()
const mockLimit = jest.fn()
const mockTransactionUpdate = jest.fn()
let activeLeaseToken: string | undefined
const mockResendSend = jest.fn()
const mockSendCampaignEmail = jest.fn()
const mockResolveFrom = jest.fn()
const mockResolveCanonicalEmailConsent = jest.fn()
const mockAssertEmailMarketingDispatchApproval = jest.fn()

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: {
    collection: mockCollection,
    runTransaction: jest.fn(async (callback: (transaction: unknown) => unknown) => callback({
      get: jest.fn(async () => ({
        exists: true,
        data: () => ({
          status: 'active',
          nextSendAt: { toMillis: () => Date.now() - 1000 },
          processingLeaseToken: activeLeaseToken,
        }),
      })),
      update: (ref: unknown, patch: Record<string, unknown>) => {
        mockTransactionUpdate(ref, patch)
        if (typeof patch.processingLeaseToken === 'string') activeLeaseToken = patch.processingLeaseToken
      },
    })),
  },
}))
jest.mock('@/lib/email/resend', () => ({
  getResendClient: jest.fn(() => ({ emails: { send: mockResendSend } })),
  sendCampaignEmail: (...args: unknown[]) => mockSendCampaignEmail(...args),
  FROM_ADDRESS: 'peet@partnersinbiz.online',
}))
jest.mock('@/lib/email/resolveFrom', () => ({
  resolveFrom: (...args: unknown[]) => mockResolveFrom(...args),
}))
jest.mock('@/lib/email/suppressions', () => ({
  isSuppressed: jest.fn().mockResolvedValue(false),
}))
jest.mock('@/lib/preferences/store', () => ({
  shouldSendToContact: jest.fn().mockResolvedValue({ allowed: true }),
}))
jest.mock('@/lib/email/frequency', () => ({
  isWithinFrequencyCap: jest.fn().mockResolvedValue({ allowed: true }),
  logFrequencySkip: jest.fn().mockResolvedValue(undefined),
}))
jest.mock('@/lib/consent-ledger/decision', () => ({
  resolveCanonicalEmailConsent: (...args: unknown[]) => mockResolveCanonicalEmailConsent(...args),
}))
jest.mock('@/lib/email-marketing/agent-governance', () => ({
  assertEmailMarketingDispatchApproval: (...args: unknown[]) => mockAssertEmailMarketingDispatchApproval(...args),
}))

process.env.CRON_SECRET = 'cron-secret'

beforeEach(() => {
  jest.clearAllMocks()
  mockAssertEmailMarketingDispatchApproval.mockResolvedValue(undefined)
  activeLeaseToken = undefined
  const query = { where: mockWhere, orderBy: mockOrderBy, limit: mockLimit, get: mockGet }
  mockWhere.mockReturnValue(query)
  mockOrderBy.mockReturnValue(query)
  mockLimit.mockReturnValue(query)
  mockDoc.mockReturnValue({ get: mockGet, update: mockUpdate })
  mockCollection.mockImplementation(() => ({
    where: mockWhere,
    orderBy: mockOrderBy,
    limit: mockLimit,
    get: mockGet,
    add: mockAdd,
    doc: mockDoc,
  }))
  mockResolveFrom.mockResolvedValue({
    from: 'Test Org <campaigns@partnersinbiz.online>',
    fromDomainId: '',
    fromDomain: 'partnersinbiz.online',
    isFallback: true,
  })
  mockSendCampaignEmail.mockResolvedValue({ ok: true, resendId: 'resend-1' })
  mockResolveCanonicalEmailConsent.mockResolvedValue({ allowed: true, precedence: 'default-allow' })
})

describe('GET /api/cron/sequences', () => {
  it('rejects missing CRON_SECRET', async () => {
    jest.resetModules()
    const { GET } = await import('@/app/api/cron/sequences/route')
    const req = new NextRequest('http://localhost/api/cron/sequences')
    const res = await GET(req)
    expect(res.status).toBe(401)
  })

  it('processes due enrollments and sends emails', async () => {
    jest.resetModules()
    const dueEnrollment = {
      id: 'e1',
      ref: { update: mockUpdate },
      data: () => ({
        sequenceId: 'seq1',
        contactId: 'c1',
        orgId: 'org1',
        campaignId: '',
        currentStep: 0,
        status: 'active',
        nextSendAt: { toDate: () => new Date(Date.now() - 1000) },
      }),
    }
    const seqData = {
      orgId: 'org1',
      name: 'Welcome',
      steps: [
        { stepNumber: 1, delayDays: 0, subject: 'Step 1', bodyHtml: '<p>Hello</p>', bodyText: 'Hello' },
        { stepNumber: 2, delayDays: 3, subject: 'Step 2', bodyHtml: '<p>Follow</p>', bodyText: 'Follow' },
      ],
    }
    const contactData = { orgId: 'org1', name: 'Alice', email: 'alice@example.com' }
    const orgData = { name: 'Test Org' }

    // Order: snapshot, sequence, contact, org (no campaign because campaignId is "")
    mockGet
      .mockResolvedValueOnce({ docs: [dueEnrollment] })
      .mockResolvedValueOnce({ exists: true, data: () => seqData })
      .mockResolvedValueOnce({ exists: true, data: () => contactData })
      .mockResolvedValueOnce({ exists: true, data: () => orgData })

    mockAdd.mockResolvedValue({ id: 'email-doc-1' })
    mockUpdate.mockResolvedValue({})

    const { GET } = await import('@/app/api/cron/sequences/route')
    const req = new NextRequest('http://localhost/api/cron/sequences', {
      headers: { Authorization: 'Bearer cron-secret' },
    })
    const res = await GET(req)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data.processed).toBe(1)
    expect(mockSendCampaignEmail).toHaveBeenCalledTimes(1)
  })

  it('marks enrollment completed when on last step', async () => {
    jest.resetModules()
    const dueEnrollment = {
      id: 'e1',
      ref: { update: mockUpdate },
      data: () => ({
        sequenceId: 'seq1',
        contactId: 'c1',
        orgId: 'org1',
        campaignId: '',
        currentStep: 0,
        status: 'active',
        nextSendAt: { toDate: () => new Date(Date.now() - 1000) },
      }),
    }
    const seqData = {
      orgId: 'org1',
      name: 'Welcome',
      steps: [{ stepNumber: 1, delayDays: 0, subject: 'Only Step', bodyHtml: '<p>Done</p>', bodyText: 'Done' }],
    }
    const contactData = { orgId: 'org1', name: 'Bob', email: 'bob@example.com' }
    const orgData = { name: 'Test Org' }

    mockGet
      .mockResolvedValueOnce({ docs: [dueEnrollment] })
      .mockResolvedValueOnce({ exists: true, data: () => seqData })
      .mockResolvedValueOnce({ exists: true, data: () => contactData })
      .mockResolvedValueOnce({ exists: true, data: () => orgData })

    mockAdd.mockResolvedValue({ id: 'email-doc-2' })
    mockUpdate.mockResolvedValue({})

    const { GET } = await import('@/app/api/cron/sequences/route')
    const req = new NextRequest('http://localhost/api/cron/sequences', {
      headers: { Authorization: 'Bearer cron-secret' },
    })
    await GET(req)
    expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({ status: 'completed' }))
  })

  it('does not process a sequence from another organisation', async () => {
    jest.resetModules()
    const dueEnrollment = {
      id: 'e-cross-org',
      ref: { update: mockUpdate },
      data: () => ({
        sequenceId: 'seq-other',
        contactId: 'c1',
        orgId: 'org1',
        campaignId: '',
        currentStep: 0,
        status: 'active',
        nextSendAt: { toDate: () => new Date(Date.now() - 1000) },
      }),
    }
    mockGet
      .mockResolvedValueOnce({ docs: [dueEnrollment] })
      .mockResolvedValueOnce({ exists: true, data: () => ({ orgId: 'org2', steps: [] }) })

    const { GET } = await import('@/app/api/cron/sequences/route')
    const req = new NextRequest('http://localhost/api/cron/sequences', {
      headers: { Authorization: 'Bearer cron-secret' },
    })
    const res = await GET(req)
    expect(res.status).toBe(200)
    expect(mockSendCampaignEmail).not.toHaveBeenCalled()
  })

  it('retries a failed provider send without advancing the sequence', async () => {
    jest.resetModules()
    const dueEnrollment = {
      id: 'e-retry',
      ref: { update: mockUpdate },
      data: () => ({
        sequenceId: 'seq1',
        contactId: 'c1',
        orgId: 'org1',
        campaignId: '',
        currentStep: 0,
        status: 'active',
        deliveryAttempts: 0,
        nextSendAt: { toDate: () => new Date(Date.now() - 1000) },
      }),
    }
    mockGet
      .mockResolvedValueOnce({ docs: [dueEnrollment] })
      .mockResolvedValueOnce({ exists: true, data: () => ({
        orgId: 'org1',
        name: 'Welcome',
        steps: [{ stepNumber: 1, delayDays: 0, subject: 'Only step', bodyHtml: '<p>Hi</p>', bodyText: 'Hi' }],
      }) })
      .mockResolvedValueOnce({ exists: true, data: () => ({ orgId: 'org1', name: 'Alice', email: 'alice@example.com' }) })
      .mockResolvedValueOnce({ exists: true, data: () => ({ name: 'Test Org' }) })
    mockAdd.mockResolvedValue({ id: 'email-failed' })
    mockUpdate.mockResolvedValue({})
    mockSendCampaignEmail.mockResolvedValueOnce({ ok: false, resendId: '', error: 'provider timeout' })

    const { GET } = await import('@/app/api/cron/sequences/route')
    const req = new NextRequest('http://localhost/api/cron/sequences', {
      headers: { Authorization: 'Bearer cron-secret' },
    })
    await GET(req)
    expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({
      status: 'active',
      deliveryAttempts: 1,
      lastDeliveryError: 'provider timeout',
    }))
    expect(mockUpdate).not.toHaveBeenCalledWith(expect.objectContaining({ status: 'completed' }))
  })

  it('defers a due send until recipient-local quiet hours end', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-01-05T04:30:00.000Z'))
    try {
      jest.resetModules()
      const dueEnrollment = {
        id: 'e-quiet', ref: { update: mockUpdate }, data: () => ({
          sequenceId: 'seq1', contactId: 'c1', orgId: 'org1', campaignId: '', currentStep: 0,
          status: 'active', nextSendAt: { toDate: () => new Date('2026-01-05T04:00:00.000Z') },
        }),
      }
      mockGet
        .mockResolvedValueOnce({ docs: [dueEnrollment] })
        .mockResolvedValueOnce({ exists: true, data: () => ({
          orgId: 'org1', name: 'Welcome',
          quietHours: { enabled: true, startMinuteLocal: 20 * 60, endMinuteLocal: 8 * 60, timezoneMode: 'recipient' },
          steps: [{ stepNumber: 0, delayDays: 0, subject: 'Hi', bodyHtml: '<p>Hi</p>', bodyText: 'Hi' }],
        }) })
        .mockResolvedValueOnce({ exists: true, data: () => ({ orgId: 'org1', name: 'Alice', email: 'alice@example.com', timezone: 'America/New_York' }) })
        .mockResolvedValueOnce({ exists: true, data: () => ({ name: 'Test Org', settings: { timezone: 'Africa/Johannesburg' } }) })

      const { GET } = await import('@/app/api/cron/sequences/route')
      await GET(new NextRequest('http://localhost/api/cron/sequences', { headers: { Authorization: 'Bearer cron-secret' } }))

      expect(mockSendCampaignEmail).not.toHaveBeenCalled()
      expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({
        nextSendAt: expect.objectContaining({ _seconds: Date.parse('2026-01-05T13:00:00.000Z') / 1000 }),
        lastScheduleDecision: expect.objectContaining({ reason: 'quiet-hours', timezone: 'America/New_York' }),
      }))
    } finally {
      jest.useRealTimers()
    }
  })

  it('moves the final provider failure to a structured dead letter', async () => {
    jest.resetModules()
    const dueEnrollment = {
      id: 'e-dead', ref: { update: mockUpdate }, data: () => ({
        sequenceId: 'seq1', contactId: 'c1', orgId: 'org1', campaignId: '', currentStep: 0,
        status: 'active', deliveryAttempts: 4, nextSendAt: { toDate: () => new Date(Date.now() - 1000) },
      }),
    }
    mockGet
      .mockResolvedValueOnce({ docs: [dueEnrollment] })
      .mockResolvedValueOnce({ exists: true, data: () => ({
        orgId: 'org1', name: 'Welcome',
        steps: [{ stepNumber: 0, delayDays: 0, subject: 'Hi', bodyHtml: '<p>Hi</p>', bodyText: 'Hi' }],
      }) })
      .mockResolvedValueOnce({ exists: true, data: () => ({ orgId: 'org1', name: 'Alice', email: 'alice@example.com' }) })
      .mockResolvedValueOnce({ exists: true, data: () => ({ name: 'Test Org' }) })
    mockAdd.mockResolvedValue({ id: 'email-failed-final' })
    mockSendCampaignEmail.mockResolvedValueOnce({ ok: false, resendId: '', error: 'provider rejected' })

    const { GET } = await import('@/app/api/cron/sequences/route')
    await GET(new NextRequest('http://localhost/api/cron/sequences', { headers: { Authorization: 'Bearer cron-secret' } }))

    expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({
      status: 'dead_letter', exitReason: 'delivery-failed', deliveryAttempts: 5, nextSendAt: null,
      deadLetter: expect.objectContaining({ attempts: 5, reason: 'provider rejected', stepNumber: 0, replayable: true }),
    }))
  })
})
