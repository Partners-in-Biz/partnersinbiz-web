// __tests__/lib/automations/executor.test.ts

const mockSendEmail = jest.fn()
const mockAdd = jest.fn()
const mockDoc = jest.fn()
const mockCollection = jest.fn()
const mockWhere = jest.fn()
const mockGet = jest.fn()
const mockUpdate = jest.fn()
const mockFetch = jest.fn()

jest.mock('@/lib/email/send', () => ({
  sendEmail: mockSendEmail,
}))

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: { collection: mockCollection },
}))

jest.mock('firebase-admin/firestore', () => ({
  FieldValue: { serverTimestamp: jest.fn(() => 'SERVER_TIMESTAMP') },
}))

global.fetch = mockFetch as unknown as typeof fetch

// eslint-disable-next-line import/first
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
