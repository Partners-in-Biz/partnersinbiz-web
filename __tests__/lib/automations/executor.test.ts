// __tests__/lib/automations/executor.test.ts

const mockSendEmail = jest.fn()
const mockAdd = jest.fn()
const mockDoc = jest.fn()
const mockCollection = jest.fn()
const mockWhere = jest.fn()
const mockGet = jest.fn()
const mockUpdate = jest.fn()
const mockFetch = jest.fn()
const mockGetSequence = jest.fn()
const mockEnrollContact = jest.fn()

jest.mock('@/lib/email/send', () => ({
  sendEmail: mockSendEmail,
}))

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: { collection: mockCollection },
}))

jest.mock('@/lib/sequences/store', () => ({
  getSequence: mockGetSequence,
}))

jest.mock('@/lib/sequences/enrollment', () => ({
  enrollContact: mockEnrollContact,
}))

jest.mock('@/lib/orgMembers/memberRef', () => ({
  AGENT_PIP_REF: { kind: 'agent', id: 'pip', displayName: 'Pip' },
}))

jest.mock('firebase-admin/firestore', () => ({
  FieldValue: { serverTimestamp: jest.fn(() => 'SERVER_TIMESTAMP') },
}))

global.fetch = mockFetch as unknown as typeof fetch

import { executeActions } from '@/lib/automations/executor'
import type { AutomationAction, TriggerContext } from '@/lib/automations/types'

const CTX: TriggerContext = {
  orgId: 'org-a',
  dealId: 'deal-1',
  contactId: 'contact-1',
  contactEmail: 'contact@example.com',
  ownerEmail: 'owner@example.com',
}

function makeQueryChain() {
  return { where: mockWhere, get: mockGet }
}

beforeEach(() => {
  jest.clearAllMocks()
  const chain = makeQueryChain()
  mockWhere.mockReturnValue(chain)
  const docRef = { update: mockUpdate }
  mockDoc.mockReturnValue(docRef)
  mockCollection.mockReturnValue({
    doc: mockDoc,
    where: mockWhere,
    add: mockAdd,
  })
  mockAdd.mockResolvedValue({ id: 'notif-1' })
  mockSendEmail.mockResolvedValue({ success: true })
  mockFetch.mockResolvedValue({ ok: true, status: 200, statusText: 'OK' })
  mockUpdate.mockResolvedValue(undefined)
  mockGetSequence.mockResolvedValue({
    id: 'seq-1',
    orgId: 'org-a',
    name: 'Welcome',
    status: 'active',
    steps: [{ stepNumber: 0, delayDays: 3, subject: 'Hi', bodyHtml: '<p>Hi</p>', bodyText: 'Hi' }],
  })
  mockEnrollContact.mockResolvedValue({ id: 'enrollment-1' })
})

// ── send_email ────────────────────────────────────────────────────────────

describe('send_email action', () => {
  it('resolves "contact" emailTo to context.contactEmail', async () => {
    const action: AutomationAction = {
      type: 'send_email',
      emailTo: 'contact',
      emailSubject: 'Hello',
      emailBody: '<p>Hi</p>',
    }
    const result = await executeActions([action], CTX)
    expect(mockSendEmail).toHaveBeenCalledWith({
      to: 'contact@example.com',
      subject: 'Hello',
      html: '<p>Hi</p>',
    })
    expect(result.succeeded).toBe(1)
    expect(result.failed).toBe(0)
  })

  it('resolves "owner" emailTo to context.ownerEmail', async () => {
    const action: AutomationAction = {
      type: 'send_email',
      emailTo: 'owner',
      emailSubject: 'FYI',
      emailBody: '<p>Hey</p>',
    }
    const result = await executeActions([action], CTX)
    expect(mockSendEmail).toHaveBeenCalledWith({
      to: 'owner@example.com',
      subject: 'FYI',
      html: '<p>Hey</p>',
    })
    expect(result.succeeded).toBe(1)
  })

  it('uses literal email address when emailTo is not "contact" or "owner"', async () => {
    const action: AutomationAction = {
      type: 'send_email',
      emailTo: 'custom@example.com',
      emailSubject: 'Custom',
      emailBody: '<p>Custom</p>',
    }
    const result = await executeActions([action], CTX)
    expect(mockSendEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'custom@example.com' }),
    )
    expect(result.succeeded).toBe(1)
  })

  it('skips send_email when no email can be resolved', async () => {
    const action: AutomationAction = {
      type: 'send_email',
      emailTo: 'contact',
    }
    const ctx: TriggerContext = { orgId: 'org-a' } // no contactEmail
    const result = await executeActions([action], ctx)
    expect(mockSendEmail).not.toHaveBeenCalled()
    // Skip is not a failure — succeeded count is still 1 (action ran without error)
    expect(result.failed).toBe(0)
  })
})

// ── assign_owner ──────────────────────────────────────────────────────────

describe('assign_owner action', () => {
  it('updates deal doc when dealId is in context', async () => {
    const action: AutomationAction = {
      type: 'assign_owner',
      ownerUid: 'uid-99',
      ownerDisplayName: 'New Owner',
    }
    const result = await executeActions([action], CTX)
    expect(mockDoc).toHaveBeenCalledWith('deal-1')
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerUid: 'uid-99',
        ownerDisplayName: 'New Owner',
        updatedAt: 'SERVER_TIMESTAMP',
      }),
    )
    expect(result.succeeded).toBe(1)
  })

  it('updates contact doc when only contactId is in context', async () => {
    const action: AutomationAction = {
      type: 'assign_owner',
      ownerUid: 'uid-99',
      ownerDisplayName: 'New Owner',
    }
    const ctxNoD: TriggerContext = { orgId: 'org-a', contactId: 'contact-1' }
    await executeActions([action], ctxNoD)
    expect(mockDoc).toHaveBeenCalledWith('contact-1')
    expect(mockUpdate).toHaveBeenCalled()
  })
})

// ── dispatch_webhook ──────────────────────────────────────────────────────

describe('dispatch_webhook action', () => {
  it('POSTs context as JSON to webhookUrl', async () => {
    const action: AutomationAction = {
      type: 'dispatch_webhook',
      webhookUrl: 'https://hooks.example.com/trigger',
    }
    const result = await executeActions([action], CTX)
    expect(mockFetch).toHaveBeenCalledWith('https://hooks.example.com/trigger', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(CTX),
    })
    expect(result.succeeded).toBe(1)
  })
})

// ── enroll_in_sequence ────────────────────────────────────────────────────

describe('enroll_in_sequence action', () => {
  it('enrolls the contact into an active sequence using the first step delay', async () => {
    const action: AutomationAction = {
      type: 'enroll_in_sequence',
      sequenceId: 'seq-1',
      sequenceName: 'Welcome',
    }

    const result = await executeActions([action], CTX)

    expect(mockGetSequence).toHaveBeenCalledWith('org-a', 'seq-1')
    expect(mockEnrollContact).toHaveBeenCalledWith(
      'org-a',
      'seq-1',
      'contact-1',
      expect.objectContaining({ id: 'pip', displayName: 'Pip' }),
      3,
    )
    expect(result.succeeded).toBe(1)
    expect(result.failed).toBe(0)
  })

  it('fails clearly when the action has no contact context', async () => {
    const result = await executeActions(
      [{ type: 'enroll_in_sequence', sequenceId: 'seq-1' }],
      { orgId: 'org-a' },
    )

    expect(mockGetSequence).not.toHaveBeenCalled()
    expect(mockEnrollContact).not.toHaveBeenCalled()
    expect(result.succeeded).toBe(0)
    expect(result.failed).toBe(1)
    expect(result.errors).toEqual(['Contact is required to enroll in a sequence'])
  })

  it('fails clearly when the selected sequence does not exist in the org', async () => {
    mockGetSequence.mockResolvedValueOnce(null)

    const result = await executeActions(
      [{ type: 'enroll_in_sequence', sequenceId: 'missing-seq' }],
      CTX,
    )

    expect(mockGetSequence).toHaveBeenCalledWith('org-a', 'missing-seq')
    expect(mockEnrollContact).not.toHaveBeenCalled()
    expect(result.succeeded).toBe(0)
    expect(result.failed).toBe(1)
    expect(result.errors).toEqual(['Sequence not found'])
  })

  it('does not enroll contacts into draft or paused sequences', async () => {
    mockGetSequence.mockResolvedValueOnce({
      id: 'seq-1',
      orgId: 'org-a',
      name: 'Draft welcome',
      status: 'draft',
      steps: [{ stepNumber: 0, delayDays: 0, subject: 'Hi', bodyHtml: '<p>Hi</p>', bodyText: 'Hi' }],
    })

    const result = await executeActions(
      [{ type: 'enroll_in_sequence', sequenceId: 'seq-1' }],
      CTX,
    )

    expect(mockEnrollContact).not.toHaveBeenCalled()
    expect(result.succeeded).toBe(0)
    expect(result.failed).toBe(1)
    expect(result.errors).toEqual(['Sequence must be active before automation enrollment'])
  })
})

// ── error isolation ───────────────────────────────────────────────────────

describe('error isolation', () => {
  it('individual action failure does not abort other actions', async () => {
    mockSendEmail.mockRejectedValueOnce(new Error('SMTP down'))

    const actions: AutomationAction[] = [
      { type: 'send_email', emailTo: 'contact', emailSubject: 'Fail' },
      { type: 'dispatch_webhook', webhookUrl: 'https://hooks.example.com/ok' },
    ]
    const result = await executeActions(actions, CTX)
    expect(result.failed).toBe(1)
    expect(result.succeeded).toBe(1)
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]).toBe('SMTP down')
  })

  it('returns correct succeeded/failed counts across mixed results', async () => {
    mockSendEmail.mockResolvedValue({ success: false, error: 'Bounced' })
    const actions: AutomationAction[] = [
      { type: 'send_email', emailTo: 'contact', emailSubject: 'A' },
      { type: 'dispatch_webhook', webhookUrl: 'https://hooks.example.com/ok' },
      { type: 'dispatch_webhook', webhookUrl: 'https://hooks.example.com/ok2' },
    ]
    const result = await executeActions(actions, CTX)
    // send_email throws because success:false
    expect(result.failed).toBe(1)
    expect(result.succeeded).toBe(2)
  })
})
