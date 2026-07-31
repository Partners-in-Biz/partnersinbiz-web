import { NextRequest } from 'next/server'

const mockListConversations = jest.fn()
const mockGetConversation = jest.fn()
const mockListConversationMessages = jest.fn()

jest.mock('@/lib/api/auth', () => ({
  withAuth: (_role: string, handler: (...args: unknown[]) => Promise<Response>) =>
    (req: NextRequest) =>
      handler(req, {
        uid: 'member-1',
        role: 'client',
        authKind: 'session',
        orgId: 'org-1',
        orgIds: ['org-1'],
      }),
}))

const resolveOrgScopeMock = jest.fn((_: unknown, requestedOrgId: string | null) => {
  if (requestedOrgId === 'denied-org') return { ok: false, status: 403, error: 'Forbidden' }
  return { ok: true, orgId: requestedOrgId ?? 'org-1' }
})

jest.mock('@/lib/api/orgScope', () => ({
  resolveOrgScope: (user: unknown, requestedOrgId: string | null) => resolveOrgScopeMock(user, requestedOrgId),
}))

jest.mock('@/lib/communications/store', () => ({
  listConversations: (...args: unknown[]) => mockListConversations(...args),
  getConversation: (...args: unknown[]) => mockGetConversation(...args),
  listConversationMessages: (...args: unknown[]) => mockListConversationMessages(...args),
}))

import { GET } from '@/app/api/v1/communications/live/route'

describe('GET /api/v1/communications/live', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockListConversations.mockResolvedValue({
      items: [],
      total: 0,
    })
    mockGetConversation.mockResolvedValue(null)
    mockListConversationMessages.mockResolvedValue([])
  })

  it('streams a communication snapshot with matching conversation messages', async () => {
    mockListConversations.mockResolvedValue({
      items: [{
        id: 'conv-1',
        orgId: 'org-1',
        channel: 'whatsapp',
        status: 'open',
        priority: 'normal',
        contactSnapshot: { name: 'Ada', phone: '+27 000', email: 'ada@example.com' },
        queueId: null,
        assigneeAgentId: null,
        assigneeUserId: null,
        labels: [],
        campaignId: null,
        campaignReplySource: null,
        subject: 'Inbound support',
        lastMessagePreview: 'Need help',
        lastInboundMessageAt: '2026-07-31T00:00:00.000Z',
        lastOutboundMessageAt: null,
        lastMessageAt: '2026-07-31T00:00:00.000Z',
        snoozedUntil: null,
        createdAt: '2026-07-30T00:00:00.000Z',
        updatedAt: '2026-07-31T00:00:00.000Z',
        createdBy: 'member-1',
        createdByType: 'user',
        deleted: false,
      }],
      total: 1,
    })

    mockListConversationMessages.mockResolvedValue([
      {
        id: 'msg-1',
        orgId: 'org-1',
        conversationId: 'conv-1',
        channel: 'whatsapp',
        direction: 'inbound',
        body: 'How can I reset my password?',
        status: 'received',
        subject: 'Inbound support',
        contactId: null,
        templateId: null,
        campaignId: null,
        createdBy: 'contact-1',
        createdByType: 'user',
        createdAt: '2026-07-31T00:00:00.000Z',
        updatedAt: '2026-07-31T00:00:00.000Z',
        deleted: false,
      },
    ])

    const response = await GET(new NextRequest(
      'https://partnersinbiz.online/api/v1/communications/live?orgId=org-1&conversationId=conv-1&status=open',
    ))

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('text/event-stream')

    const reader = response.body!.getReader()
    const retryFrame = await reader.read()
    const snapshotFrame = await reader.read()
    await reader.cancel()

    expect(new TextDecoder().decode(retryFrame.value)).toBe('retry: 2000\n\n')

    const snapshotText = new TextDecoder().decode(snapshotFrame.value)
    expect(snapshotText).toContain('event: snapshot')
    expect(snapshotText).toContain('"id":"conv-1"')
    expect(snapshotText).toContain('How can I reset my password?')
    expect(mockListConversations).toHaveBeenCalledWith('org-1', expect.objectContaining({
      status: 'open',
      channel: null,
      assignee: null,
      campaignId: null,
      queueId: null,
      priority: null,
      label: null,
      limit: 100,
    }))
    expect(mockListConversationMessages).toHaveBeenCalledWith('org-1', 'conv-1')
  })

  it('loads the focused conversation directly when it is outside the current filter', async () => {
    const focused = {
      id: 'conv-focused',
      orgId: 'org-1',
      channel: 'sms',
      status: 'pending',
      priority: 'high',
      contactSnapshot: { name: 'Jordan' },
      queueId: 'support',
      assigneeAgentId: null,
      assigneeUserId: null,
      labels: ['vip'],
      campaignId: null,
      campaignReplySource: null,
      subject: 'Password reset',
      lastMessagePreview: 'Need help',
      lastInboundMessageAt: '2026-07-31T00:00:00.000Z',
      lastOutboundMessageAt: null,
      lastMessageAt: '2026-07-31T00:00:00.000Z',
      snoozedUntil: null,
      createdAt: '2026-07-30T00:00:00.000Z',
      updatedAt: '2026-07-31T00:00:00.000Z',
      createdBy: 'member-1',
      createdByType: 'user',
      deleted: false,
    }

    mockGetConversation.mockResolvedValue(focused)
    mockListConversationMessages.mockResolvedValue([{
      id: 'msg-focused',
      orgId: 'org-1',
      conversationId: 'conv-focused',
      channel: 'sms',
      direction: 'inbound',
      body: 'Can I change my email?',
      status: 'received',
      subject: 'Password reset',
      contactId: null,
      templateId: null,
      campaignId: null,
      createdBy: 'contact-1',
      createdByType: 'user',
      createdAt: '2026-07-31T00:00:00.000Z',
      updatedAt: '2026-07-31T00:00:00.000Z',
      deleted: false,
    }])

    const response = await GET(new NextRequest(
      'https://partnersinbiz.online/api/v1/communications/live?orgId=org-1&status=resolved&conversationId=conv-focused',
    ))
    const reader = response.body!.getReader()
    await reader.read()
    const snapshot = await reader.read()
    await reader.cancel()

    expect(mockGetConversation).toHaveBeenCalledWith('org-1', 'conv-focused')
    expect(new TextDecoder().decode(snapshot.value)).toContain('"id":"conv-focused"')
    expect(new TextDecoder().decode(snapshot.value)).toContain('Can I change my email?')
  })
})
