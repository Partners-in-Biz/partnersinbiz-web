import { NextRequest } from 'next/server'

const validateRequestMock = jest.fn()

jest.mock('twilio', () => ({
  validateRequest: (...args: unknown[]) => validateRequestMock(...args),
}))

const ingestInboundMessageMock = jest.fn()
const resolveWebhookOrgMock = jest.fn()
const resolveValidationAuthTokenMock = jest.fn()
const parseInboundMessageMock = jest.fn()
const isStatusCallbackMock = jest.fn()
const parseTwilioFormParamsMock = jest.fn((raw: string) =>
  Object.fromEntries(new URLSearchParams(raw).entries()),
)

jest.mock('@/lib/communications/inbound', () => ({
  ingestInboundMessage: (...args: unknown[]) => ingestInboundMessageMock(...args),
  resolveWebhookOrg: (...args: unknown[]) => resolveWebhookOrgMock(...args),
  resolveValidationAuthToken: (...args: unknown[]) => resolveValidationAuthTokenMock(...args),
  parseInboundMessage: (...args: unknown[]) => parseInboundMessageMock(...args),
  isStatusCallback: (...args: unknown[]) => isStatusCallbackMock(...args),
  parseTwilioFormParams: (...args: unknown[]) => parseTwilioFormParamsMock(...args),
}))

const getWebhookRouteBySenderMock = jest.fn()
const getChannelAccountMock = jest.fn()
const updateMessageDeliveryStatusMock = jest.fn()

jest.mock('@/lib/communications/store', () => ({
  getWebhookRouteBySender: (...args: unknown[]) => getWebhookRouteBySenderMock(...args),
  getChannelAccount: (...args: unknown[]) => getChannelAccountMock(...args),
  updateMessageDeliveryStatus: (...args: unknown[]) => updateMessageDeliveryStatusMock(...args),
}))

import { POST } from '@/app/api/v1/communications/webhooks/twilio/route'

const WEBHOOK_URL = 'https://partnersinbiz.online/api/v1/communications/webhooks/twilio?orgId=org-1'

function formRequest(body: Record<string, string>, url = WEBHOOK_URL, signature = 'valid-sig'): NextRequest {
  const params = new URLSearchParams(body).toString()
  return new NextRequest(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Twilio-Signature': signature },
    body: params,
  })
}

describe('POST /api/v1/communications/webhooks/twilio', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    resolveWebhookOrgMock.mockResolvedValue({ orgId: 'org-1', source: 'route' })
    resolveValidationAuthTokenMock.mockResolvedValue('auth-token-1')
    validateRequestMock.mockReturnValue(true)
    isStatusCallbackMock.mockReturnValue(false)
    parseInboundMessageMock.mockReturnValue({
      from: 'whatsapp:+27821234567',
      to: 'whatsapp:+27612345678',
      body: 'What is my balance?',
      messageSid: 'SM1234567890abcdef',
      numMedia: 0,
      mediaUrls: [],
      profileName: 'Sarah',
      waId: '27821234567',
    })
    ingestInboundMessageMock.mockResolvedValue({
      conversation: { id: 'conv-1', orgId: 'org-1', channel: 'whatsapp', status: 'open' },
      conversationCreated: true,
      messageId: 'msg-1',
      duplicate: false,
      classification: { intent: 'balance_request', channel: 'whatsapp', confidence: 0.82, priority: 'normal', recommendedActions: [] },
      routing: { ruleMatched: false, actionsApplied: [] },
    })
  })

  it('verifies the Twilio signature before handling a status callback', async () => {
    isStatusCallbackMock.mockReturnValue(true)
    updateMessageDeliveryStatusMock.mockResolvedValue({ found: true, messageId: 'msg-1' })
    const response = await POST(formRequest({
      MessageSid: 'SM1234567890abcdef',
      MessageStatus: 'delivered',
      To: 'whatsapp:+27612345678',
    }))
    expect(response.status).toBe(200)
    expect(validateRequestMock).toHaveBeenCalledWith('auth-token-1', 'valid-sig', WEBHOOK_URL, expect.objectContaining({ MessageSid: 'SM1234567890abcdef' }))
    expect(updateMessageDeliveryStatusMock).toHaveBeenCalledWith('org-1', 'SM1234567890abcdef', expect.objectContaining({ status: 'delivered' }))
    expect(ingestInboundMessageMock).not.toHaveBeenCalled()
  })

  it('rejects a callback with an invalid signature (403, no side effects)', async () => {
    validateRequestMock.mockReturnValue(false)
    isStatusCallbackMock.mockReturnValue(true)
    const response = await POST(formRequest({
      MessageSid: 'SM1234567890abcdef',
      MessageStatus: 'failed',
      To: 'whatsapp:+27612345678',
    }))
    expect(response.status).toBe(403)
    expect(updateMessageDeliveryStatusMock).not.toHaveBeenCalled()
    expect(ingestInboundMessageMock).not.toHaveBeenCalled()
  })

  it('ingests an inbound WhatsApp message into the resolved org', async () => {
    const response = await POST(formRequest({
      From: 'whatsapp:+27821234567',
      To: 'whatsapp:+27612345678',
      Body: 'What is my balance?',
      MessageSid: 'SM1234567890abcdef',
      ProfileName: 'Sarah',
      WaId: '27821234567',
    }))
    expect(response.status).toBe(200)
    expect(ingestInboundMessageMock).toHaveBeenCalledWith(
      'org-1',
      expect.objectContaining({ body: 'What is my balance?', messageSid: 'SM1234567890abcdef' }),
      expect.anything(),
    )
  })

  it('acks unknown orgs without ingesting (no org, no side effects)', async () => {
    resolveWebhookOrgMock.mockResolvedValue(null)
    const response = await POST(formRequest({
      From: 'whatsapp:+27821234567',
      To: 'whatsapp:+27612345678',
      Body: 'hello',
      MessageSid: 'SMunknown',
    }))
    expect(response.status).toBe(200)
    expect(ingestInboundMessageMock).not.toHaveBeenCalled()
  })
})
