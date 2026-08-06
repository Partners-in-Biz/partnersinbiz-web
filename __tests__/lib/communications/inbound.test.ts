const mockGetWebhookRouteBySender = jest.fn()
const mockGetOrgTwilioCredentials = jest.fn()
const mockListRoutingRules = jest.fn()
const mockUpdateConversation = jest.fn()
const mockRecordCommunicationEvent = jest.fn()

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: { collection: jest.fn(() => ({ doc: jest.fn(), where: jest.fn(), get: jest.fn() })) },
}))

jest.mock('@/lib/communications/store', () => ({
  getWebhookRouteBySender: (...args: unknown[]) => mockGetWebhookRouteBySender(...args),
  getOrgTwilioCredentials: (...args: unknown[]) => mockGetOrgTwilioCredentials(...args),
  addConversationMessage: jest.fn(),
  createConversation: jest.fn(),
  getConversation: jest.fn(),
  listRoutingRules: (...args: unknown[]) => mockListRoutingRules(...args),
  recordCommunicationEvent: (...args: unknown[]) => mockRecordCommunicationEvent(...args),
  updateConversation: (...args: unknown[]) => mockUpdateConversation(...args),
  updateMessageDeliveryStatus: jest.fn(),
  COMMUNICATION_COLLECTIONS: {
    conversations: 'communication_conversations',
    messages: 'communication_messages',
    events: 'communication_events',
    routingRules: 'communication_routing_rules',
  },
}))

jest.mock('@/lib/communications/send', () => ({
  createPendingAutoReply: jest.fn(),
}))

import {
  applyInboundRouting,
  isStatusCallback,
  parseInboundMessage,
  parseTwilioFormParams,
  resolveValidationAuthToken,
  resolveWebhookOrg,
} from '@/lib/communications/inbound'
import { classifyInboundMessage } from '@/lib/communications/automation'

describe('communications inbound webhook parsing', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('parses Twilio form-encoded webhook params', () => {
    const params = parseTwilioFormParams('From=whatsapp%3A%2B27821234567&To=whatsapp%3A%2B27612345678&Body=Hello&MessageSid=SM123')
    expect(params.From).toBe('whatsapp:+27821234567')
    expect(params.Body).toBe('Hello')
    expect(params.MessageSid).toBe('SM123')
  })

  it('detects status callbacks vs inbound messages', () => {
    expect(isStatusCallback({ MessageStatus: 'delivered' })).toBe(true)
    expect(isStatusCallback({ SmsStatus: 'failed' })).toBe(true)
    expect(isStatusCallback({ Body: 'hello', MessageSid: 'SM1' })).toBe(false)
  })

  it('extracts inbound message details including media and profile name', () => {
    const inbound = parseInboundMessage({
      From: 'whatsapp:+27821234567',
      To: 'whatsapp:+27612345678',
      Body: 'Send me the image',
      MessageSid: 'SM123',
      NumMedia: '2',
      MediaUrl0: 'https://media.example.com/a.jpg',
      MediaUrl1: 'https://media.example.com/b.jpg',
      ProfileName: 'Sarah M',
      WaId: '27821234567',
    })
    expect(inbound.from).toBe('whatsapp:+27821234567')
    expect(inbound.profileName).toBe('Sarah M')
    expect(inbound.mediaUrls).toHaveLength(2)
  })

  it('resolves org by query orgId first', async () => {
    const resolved = await resolveWebhookOrg('org-query', 'whatsapp:+27612345678')
    expect(resolved).toEqual({ orgId: 'org-query', source: 'query' })
    expect(mockGetWebhookRouteBySender).not.toHaveBeenCalled()
  })

  it('resolves org from the sender webhook route when no query orgId', async () => {
    mockGetWebhookRouteBySender.mockResolvedValue({ orgId: 'org-route', accountId: 'acc-1', providerId: 'twilio', channel: 'whatsapp', sender: 'whatsapp:+27612345678' })
    const resolved = await resolveWebhookOrg(null, 'whatsapp:+27612345678')
    expect(resolved).toEqual({ orgId: 'org-route', source: 'route' })
    expect(mockGetWebhookRouteBySender).toHaveBeenCalledWith('whatsapp:+27612345678')
  })

  it('falls back to the platform env account for the platform sender number', async () => {
    mockGetWebhookRouteBySender.mockResolvedValue(null)
    process.env.TWILIO_WHATSAPP_FROM = 'whatsapp:+27612345678'
    const resolved = await resolveWebhookOrg(null, 'whatsapp:+27612345678')
    expect(resolved).toEqual({ orgId: 'pib-platform-owner', source: 'platform' })
    delete process.env.TWILIO_WHATSAPP_FROM
  })

  it('returns null when no org can be resolved', async () => {
    mockGetWebhookRouteBySender.mockResolvedValue(null)
    delete process.env.TWILIO_WHATSAPP_FROM
    const resolved = await resolveWebhookOrg(null, 'whatsapp:+27999999999')
    expect(resolved).toBeNull()
  })

  it('resolves the signature auth token from org credentials before platform env', async () => {
    mockGetOrgTwilioCredentials.mockResolvedValue({ accountSid: 'AC1', authToken: 'org-token', whatsappFrom: 'whatsapp:+27612345678' })
    process.env.TWILIO_AUTH_TOKEN = 'platform-token'
    expect(await resolveValidationAuthToken('org-1')).toBe('org-token')
    process.env.TWILIO_AUTH_TOKEN = 'platform-token'
    mockGetOrgTwilioCredentials.mockResolvedValue(null)
    expect(await resolveValidationAuthToken('org-1')).toBe('platform-token')
    delete process.env.TWILIO_AUTH_TOKEN
  })
})

describe('communications inbound routing rules', () => {
  const baseConversation = {
    id: 'conv-1',
    orgId: 'org-1',
    channel: 'whatsapp' as const,
    status: 'open' as const,
    priority: 'normal' as const,
    contactId: null,
    contactSnapshot: { name: 'Sarah', phone: '+27821234567' },
    queueId: null,
    assigneeAgentId: null,
    assigneeUserId: null,
    labels: [],
    campaignId: null,
    lastMessageAt: null,
    snoozedUntil: null,
    createdAt: null,
    updatedAt: null,
  }

  beforeEach(() => {
    jest.clearAllMocks()
    mockUpdateConversation.mockResolvedValue(baseConversation)
    mockRecordCommunicationEvent.mockResolvedValue('event-1')
  })

  it('applies queue/priority actions from a matching active rule', async () => {
    mockListRoutingRules.mockResolvedValue({
      items: [
        {
          id: 'rule-1',
          orgId: 'org-1',
          name: 'Balance queue',
          status: 'active',
          priority: 10,
          channels: ['whatsapp'],
          conditions: [{ field: 'body', operator: 'contains', value: 'balance' }],
          actions: [
            { type: 'assign_queue', value: 'support' },
            { type: 'set_priority', value: 'high' },
            { type: 'add_label', value: 'loyalty' },
          ],
        },
      ],
      total: 1,
    })

    const classification = classifyInboundMessage('What is my balance?', 'whatsapp')
    const routing = await applyInboundRouting('org-1', {
      conversation: baseConversation,
      messageId: 'msg-1',
      body: 'What is my balance?',
      channel: 'whatsapp',
      classification,
    })

    expect(routing.ruleMatched).toBe(true)
    expect(routing.ruleName).toBe('Balance queue')
    expect(mockUpdateConversation).toHaveBeenCalledWith('org-1', 'conv-1', { queueId: 'support' })
    expect(mockUpdateConversation).toHaveBeenCalledWith('org-1', 'conv-1', { priority: 'high' })
    expect(mockUpdateConversation).toHaveBeenCalledWith('org-1', 'conv-1', { labels: ['loyalty'] })
  })

  it('does not apply a rule whose body condition does not match', async () => {
    mockListRoutingRules.mockResolvedValue({
      items: [
        {
          id: 'rule-1',
          orgId: 'org-1',
          name: 'Balance queue',
          status: 'active',
          priority: 10,
          channels: ['whatsapp'],
          conditions: [{ field: 'body', operator: 'contains', value: 'balance' }],
          actions: [{ type: 'assign_queue', value: 'support' }],
        },
      ],
      total: 1,
    })

    const classification = classifyInboundMessage('Can you help me?', 'whatsapp')
    const routing = await applyInboundRouting('org-1', {
      conversation: baseConversation,
      messageId: 'msg-1',
      body: 'Can you help me?',
      channel: 'whatsapp',
      classification,
    })

    expect(routing.ruleMatched).toBe(false)
    expect(mockUpdateConversation).not.toHaveBeenCalled()
  })

  it('escalates urgent classification when no rule overrides priority', async () => {
    mockListRoutingRules.mockResolvedValue({ items: [], total: 0 })
    const classification = classifyInboundMessage('URGENT, my OTP is not working', 'whatsapp')
    const routing = await applyInboundRouting('org-1', {
      conversation: baseConversation,
      messageId: 'msg-1',
      body: 'URGENT, my OTP is not working',
      channel: 'whatsapp',
      classification,
    })
    expect(routing.ruleMatched).toBe(false)
    expect(mockUpdateConversation).toHaveBeenCalledWith('org-1', 'conv-1', { priority: 'urgent' })
  })

  it('records opt-out compliance handling', async () => {
    mockListRoutingRules.mockResolvedValue({ items: [], total: 0 })
    const classification = classifyInboundMessage('STOP', 'whatsapp')
    const routing = await applyInboundRouting('org-1', {
      conversation: baseConversation,
      messageId: 'msg-1',
      body: 'STOP',
      channel: 'whatsapp',
      classification,
    })
    expect(mockUpdateConversation).toHaveBeenCalledWith('org-1', 'conv-1', { labels: ['compliance'] })
    expect(mockUpdateConversation).toHaveBeenCalledWith('org-1', 'conv-1', { status: 'resolved' })
    expect(mockRecordCommunicationEvent).toHaveBeenCalledWith('org-1', expect.objectContaining({ type: 'opt_out.recorded' }))
  })
})
