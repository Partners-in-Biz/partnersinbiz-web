// __tests__/api/cron-sequences.test.ts
import { NextRequest } from 'next/server'
import { buildWorkflowVersion } from '@/lib/sequences/workflow-version'
import type { Sequence } from '@/lib/sequences/types'

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
const mockSendSmsToContact = jest.fn()

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
jest.mock('@/lib/sms/send', () => ({
  sendSmsToContact: (...args: unknown[]) => mockSendSmsToContact(...args),
}))

process.env.CRON_SECRET = 'cron-secret'

beforeEach(() => {
  jest.clearAllMocks()
  mockGet.mockReset()
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
  mockSendSmsToContact.mockResolvedValue({ status: 'sent', smsId: 'sms-1' })
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
      status: 'active',
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

  it('validates and sends the enrollment-pinned v1 approval after the sequence activates v2', async () => {
    jest.resetModules()
    const approvalV1 = { status: 'approved' as const, approvedBy: 'human-1', approvedByType: 'user' as const, approvalTaskId: 'task-v1', approvedSnapshotHash: 'hash-v1' }
    const base = {
      id: 'seq1', orgId: 'org1', name: 'Welcome', description: '', status: 'active' as const,
      steps: [{ stepNumber: 0, delayDays: 0, subject: 'V1 subject', bodyHtml: '<p>V1</p>', bodyText: 'V1' }],
      approvalState: approvalV1, createdAt: null, updatedAt: null,
    } satisfies Sequence
    const v1 = buildWorkflowVersion(base, { activatedAtIso: '2026-07-13T08:00:00.000Z', version: 1 })
    const dueEnrollment = {
      id: 'e-v1', ref: { update: mockUpdate }, data: () => ({
        sequenceId: 'seq1', contactId: 'c1', orgId: 'org1', campaignId: '', currentStep: 0,
        status: 'active', nextSendAt: { toDate: () => new Date(Date.now() - 1000) },
        workflowVersionId: v1.id, workflowVersion: 1, workflowContentHash: v1.contentHash, workflowSnapshot: v1,
      }),
    }
    mockGet
      .mockResolvedValueOnce({ docs: [dueEnrollment] })
      .mockResolvedValueOnce({ exists: true, data: () => ({
        ...base, id: undefined,
        steps: [{ ...base.steps[0], subject: 'V2 subject', bodyHtml: '<p>V2</p>', bodyText: 'V2' }],
        approvalState: { ...approvalV1, approvalTaskId: 'task-v2', approvedSnapshotHash: 'hash-v2' },
        activeWorkflowVersion: 2,
      }) })
      .mockResolvedValueOnce({ exists: true, data: () => ({ orgId: 'org1', name: 'Alice', email: 'alice@example.com' }) })
      .mockResolvedValueOnce({ exists: true, data: () => ({ name: 'Test Org' }) })
    mockAdd.mockResolvedValue({ id: 'email-v1' })

    const { GET } = await import('@/app/api/cron/sequences/route')
    await GET(new NextRequest('http://localhost/api/cron/sequences', { headers: { Authorization: 'Bearer cron-secret' } }))

    expect(mockAssertEmailMarketingDispatchApproval).toHaveBeenCalledWith(
      expect.objectContaining({ steps: expect.arrayContaining([expect.objectContaining({ subject: 'V1 subject' })]), approvalState: expect.objectContaining({ approvalTaskId: 'task-v1' }) }),
      expect.objectContaining({ resourceId: 'seq1' }),
    )
    expect(mockSendCampaignEmail).toHaveBeenCalledWith(expect.objectContaining({ subject: 'V1 subject' }))
  })

  it('pauses and audits a malformed claimed workflow pin instead of falling back to mutable steps', async () => {
    jest.resetModules()
    const dueEnrollment = {
      id: 'e-bad-pin', ref: { update: mockUpdate }, data: () => ({
        sequenceId: 'seq1', contactId: 'c1', orgId: 'org1', campaignId: '', currentStep: 0,
        status: 'active', nextSendAt: { toDate: () => new Date(Date.now() - 1000) }, workflowVersionId: 'claimed-v1',
      }),
    }
    mockGet
      .mockResolvedValueOnce({ docs: [dueEnrollment] })
      .mockResolvedValueOnce({ exists: true, data: () => ({ orgId: 'org1', status: 'active', steps: [{ stepNumber: 0, subject: 'Mutable' }] }) })
    mockAdd.mockResolvedValue({ id: 'audit-1' })

    const { GET } = await import('@/app/api/cron/sequences/route')
    await GET(new NextRequest('http://localhost/api/cron/sequences', { headers: { Authorization: 'Bearer cron-secret' } }))

    expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({
      status: 'paused', pausedReason: 'invalid-workflow-pin', nextSendAt: null,
      workflowValidationError: expect.stringMatching(/workflow pin/i),
    }))
    expect(mockAssertEmailMarketingDispatchApproval).not.toHaveBeenCalled()
    expect(mockSendCampaignEmail).not.toHaveBeenCalled()
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
      status: 'active',
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
        status: 'active',
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
          status: 'active',
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
        status: 'active',
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

  it.each([
    ['failed', 'Twilio unavailable'],
    ['skipped', 'contact has no phone'],
  ] as const)('does not advance an SMS step when dispatch is %s', async (status, reason) => {
    jest.resetModules()
    const dueEnrollment = {
      id: `e-sms-${status}`, ref: { update: mockUpdate }, data: () => ({
        sequenceId: 'seq1', contactId: 'c1', orgId: 'org1', campaignId: '', currentStep: 0,
        status: 'active', deliveryAttempts: 0, nextSendAt: { toDate: () => new Date(Date.now() - 1000) },
      }),
    }
    mockGet
      .mockResolvedValueOnce({ docs: [dueEnrollment] })
      .mockResolvedValueOnce({ exists: true, data: () => ({
        orgId: 'org1', name: 'SMS journey',
        status: 'active',
        steps: [
          { stepNumber: 0, delayDays: 0, channel: 'sms', smsBody: 'Hello', subject: '', bodyHtml: '', bodyText: '' },
          { stepNumber: 1, delayDays: 1, subject: 'Next', bodyHtml: '<p>Next</p>', bodyText: 'Next' },
        ],
      }) })
      .mockResolvedValueOnce({ exists: true, data: () => ({ orgId: 'org1', name: 'Alice', email: 'alice@example.com' }) })
      .mockResolvedValueOnce({ exists: true, data: () => ({ name: 'Test Org' }) })
    mockSendSmsToContact.mockResolvedValueOnce({ status, reason })

    const { GET } = await import('@/app/api/cron/sequences/route')
    await GET(new NextRequest('http://localhost/api/cron/sequences', { headers: { Authorization: 'Bearer cron-secret' } }))

    expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({
      status: 'active', deliveryAttempts: 1, lastDeliveryError: reason,
    }))
    expect(mockUpdate).not.toHaveBeenCalledWith(expect.objectContaining({ currentStep: 1 }))
  })

  it('dead-letters an SMS after its final failed attempt', async () => {
    jest.resetModules()
    const dueEnrollment = {
      id: 'e-sms-dead', ref: { update: mockUpdate }, data: () => ({
        sequenceId: 'seq1', contactId: 'c1', orgId: 'org1', campaignId: '', currentStep: 0,
        status: 'active', deliveryAttempts: 4, nextSendAt: { toDate: () => new Date(Date.now() - 1000) },
      }),
    }
    mockGet
      .mockResolvedValueOnce({ docs: [dueEnrollment] })
      .mockResolvedValueOnce({ exists: true, data: () => ({ orgId: 'org1', status: 'active', steps: [{ stepNumber: 0, delayDays: 0, channel: 'sms', smsBody: 'Hello' }] }) })
      .mockResolvedValueOnce({ exists: true, data: () => ({ orgId: 'org1', name: 'Alice', email: 'alice@example.com' }) })
      .mockResolvedValueOnce({ exists: true, data: () => ({ name: 'Test Org' }) })
    mockSendSmsToContact.mockResolvedValueOnce({ status: 'failed', reason: 'Twilio unavailable' })

    const { GET } = await import('@/app/api/cron/sequences/route')
    await GET(new NextRequest('http://localhost/api/cron/sequences', { headers: { Authorization: 'Bearer cron-secret' } }))
    expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({
      status: 'dead_letter', nextSendAt: null,
      deadLetter: expect.objectContaining({ channel: 'sms', attempts: 5, replayable: true }),
    }))
  })
})
