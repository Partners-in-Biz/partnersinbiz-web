// __tests__/api/v1/email/send.test.ts
import { POST } from '@/app/api/v1/email/send/route'
import { NextRequest } from 'next/server'

jest.mock('@/lib/firebase/admin', () => ({
  adminAuth: { verifyIdToken: jest.fn(), verifySessionCookie: jest.fn() },
  adminDb: { collection: jest.fn() },
}))

jest.mock('@/lib/email/resend', () => ({
  sendCampaignEmail: jest.fn().mockResolvedValue({
    ok: true,
    resendId: 'resend-id-1',
    provider: 'resend',
  }),
  FROM_ADDRESS: 'peet@partnersinbiz.online',
  plainTextToHtml: jest.fn((t: string) => `<p>${t}</p>`),
  htmlToPlainText: jest.fn((h: string) => h.replace(/<[^>]+>/g, '')),
}))

jest.mock('@/lib/email/suppressions', () => ({
  isSuppressed: jest.fn().mockResolvedValue(false),
  addSuppression: jest.fn().mockResolvedValue(undefined),
  temporaryExpiryFromNow: jest.fn().mockReturnValue(null),
}))

jest.mock('@/lib/preferences/store', () => ({
  shouldSendToContact: jest.fn().mockResolvedValue({ allowed: true }),
}))

jest.mock('@/lib/email/frequency', () => ({
  isWithinFrequencyCap: jest.fn().mockResolvedValue({ allowed: true }),
  logFrequencySkip: jest.fn().mockResolvedValue(undefined),
}))

jest.mock('@/lib/platform/quotas', () => ({
  checkQuota: jest.fn().mockResolvedValue(undefined),
}))

jest.mock('@/lib/email/unsubscribeToken', () => ({
  signUnsubscribeToken: jest.fn().mockReturnValue('tok-abc'),
}))

const mockAssertOutboundEmailAllowed = jest.fn().mockResolvedValue({ allowed: true })

jest.mock('@/lib/email/policy', () => ({
  assertOutboundEmailAllowed: (...args: unknown[]) => mockAssertOutboundEmailAllowed(...args),
}))

import { adminDb } from '@/lib/firebase/admin'
import { isWithinFrequencyCap, logFrequencySkip } from '@/lib/email/frequency'
process.env.AI_API_KEY = 'test-key'

const mockAdd = jest.fn().mockResolvedValue({ id: 'email-doc-1' })
const mockDocUpdate = jest.fn().mockResolvedValue(undefined)
const mockActivitiesAdd = jest.fn().mockResolvedValue({ id: 'act-1' })
const mockContactGet = jest.fn()

function mockCollections() {
  ;(adminDb.collection as jest.Mock).mockImplementation((col: string) => {
    if (col === 'contacts') {
      return {
        doc: jest.fn().mockReturnValue({
          get: mockContactGet,
        }),
      }
    }
    if (col === 'emails') {
      return {
        add: mockAdd,
        doc: jest.fn().mockReturnValue({ update: mockDocUpdate }),
      }
    }
    if (col === 'activities') {
      return { add: mockActivitiesAdd }
    }
    return {}
  })
}

function makeReq(body: object) {
  return new NextRequest('http://localhost/api/v1/email/send', {
    method: 'POST',
    headers: { authorization: 'Bearer test-key', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

const validPayload = {
  orgId: 'org-test',
  to: 'client@example.com',
  subject: 'Hello from PiB',
  bodyText: 'This is the email body.',
  contactId: '',
}

describe('POST /api/v1/email/send', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockAssertOutboundEmailAllowed.mockResolvedValue({ allowed: true })
    mockContactGet.mockResolvedValue({
      exists: true,
      data: () => ({ orgId: 'org-from-contact', email: 'client@example.com' }),
    })
    mockCollections()
  })

  it('returns 401 without auth', async () => {
    const req = new NextRequest('http://localhost/api/v1/email/send', { method: 'POST' })
    const res = await POST(req)
    expect(res.status).toBe(401)
  })

  it('returns 400 when to is missing', async () => {
    const res = await POST(makeReq({ ...validPayload, to: '' }))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/to/i)
  })

  it('returns 400 when subject is missing', async () => {
    const res = await POST(makeReq({ ...validPayload, subject: '' }))
    expect(res.status).toBe(400)
  })

  it('returns 400 when both bodyText and bodyHtml are missing', async () => {
    const res = await POST(makeReq({ to: 'a@b.com', subject: 'Hi' }))
    expect(res.status).toBe(400)
  })

  it('returns 409 when outbound email is paused platform-wide', async () => {
    mockAssertOutboundEmailAllowed.mockResolvedValueOnce({
      allowed: false,
      status: 409,
      error: 'Outbound email is paused platform-wide.',
    })

    const res = await POST(makeReq(validPayload))

    expect(res.status).toBe(409)
    expect(mockAdd).not.toHaveBeenCalled()
  })

  it('returns 403 when the recipient domain is blocked by platform policy', async () => {
    mockAssertOutboundEmailAllowed.mockResolvedValueOnce({
      allowed: false,
      status: 403,
      error: 'Recipient domain is blocked by platform policy.',
    })

    const res = await POST(makeReq(validPayload))

    expect(res.status).toBe(403)
    expect(mockAdd).not.toHaveBeenCalled()
  })

  it('sends email and returns 201 with id', async () => {
    const res = await POST(makeReq(validPayload))
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.data.id).toBe('email-doc-1')
  })

  it('accepts rendered email builder html and text aliases', async () => {
    const res = await POST(makeReq({
      orgId: 'org-test',
      to: 'client@example.com',
      subject: 'Rendered template',
      html: '<p>Rendered body</p>',
      text: 'Rendered body',
    }))

    expect(res.status).toBe(201)
    expect(mockAdd).toHaveBeenCalledWith(expect.objectContaining({
      bodyHtml: expect.stringContaining('Rendered body'),
      bodyText: 'Rendered body',
    }))
  })

  it('creates a Firestore doc with status sent', async () => {
    await POST(makeReq(validPayload))
    expect(mockAdd).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'draft', direction: 'outbound' }),
    )
    expect(mockDocUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'sent', resendId: 'resend-id-1' }),
    )
  })

  it('logs email_sent activity when contactId is provided', async () => {
    await POST(makeReq({ ...validPayload, contactId: 'contact-abc' }))
    expect(mockActivitiesAdd).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'email_sent', contactId: 'contact-abc' }),
    )
  })

  it('derives org scope from contactId when orgId is not supplied', async () => {
    const payloadWithoutOrg = {
      to: validPayload.to,
      subject: validPayload.subject,
      bodyText: validPayload.bodyText,
      contactId: validPayload.contactId,
    }

    const res = await POST(makeReq({ ...payloadWithoutOrg, contactId: 'contact-abc' }))

    expect(res.status).toBe(201)
    expect(mockContactGet).toHaveBeenCalledTimes(1)
    expect(mockAdd).toHaveBeenCalledWith(expect.objectContaining({
      orgId: 'org-from-contact',
      contactId: 'contact-abc',
    }))
    expect(mockActivitiesAdd).toHaveBeenCalledWith(expect.objectContaining({
      orgId: 'org-from-contact',
      contactId: 'contact-abc',
    }))
  })

  it('does not log activity when contactId is empty', async () => {
    await POST(makeReq(validPayload))
    expect(mockActivitiesAdd).not.toHaveBeenCalled()
  })

  it('blocks non-transactional one-off sends when the contact frequency cap is exceeded', async () => {
    ;(isWithinFrequencyCap as jest.Mock).mockResolvedValueOnce({
      allowed: false,
      reason: 'daily cap exceeded',
    })

    const res = await POST(
      makeReq({ ...validPayload, contactId: 'contact-abc', topicId: 'newsletter' }),
    )

    expect(res.status).toBe(422)
    expect(isWithinFrequencyCap).toHaveBeenCalledWith('org-test', 'contact-abc', 'newsletter')
    expect(logFrequencySkip).toHaveBeenCalledWith(expect.objectContaining({
      orgId: 'org-test',
      contactId: 'contact-abc',
      topicId: 'newsletter',
      source: 'transactional',
      reason: 'daily cap exceeded',
    }))
    expect(mockAdd).not.toHaveBeenCalled()
  })

  it('marks email as failed when the provider returns an error', async () => {
    const resendModule = jest.requireMock('@/lib/email/resend') as {
      sendCampaignEmail: jest.Mock
    }
    resendModule.sendCampaignEmail.mockResolvedValueOnce({
      ok: false,
      resendId: '',
      provider: 'resend',
      error: 'Bad API key',
    })
    const res = await POST(makeReq(validPayload))
    expect(res.status).toBe(502)
    expect(mockDocUpdate).toHaveBeenCalledWith(expect.objectContaining({ status: 'failed' }))
  })
})
