import { NextRequest } from 'next/server'

const mockGetConversation = jest.fn()
const mockMarkConversationRead = jest.fn()
const mockAuthorizeConversationProject = jest.fn()

jest.mock('@/lib/api/auth', () => ({
  withAuth: (_role: string, handler: (...args: unknown[]) => unknown) =>
    (request: NextRequest, context?: unknown) => handler(request, {
      uid: 'member-1',
      role: 'client',
      authKind: 'session',
      orgId: 'org-1',
      orgIds: ['org-1'],
    }, context),
}))

jest.mock('@/lib/conversations/conversations', () => {
  const actual = jest.requireActual('@/lib/conversations/conversations')
  return {
    ...actual,
    getConversation: (...args: unknown[]) => mockGetConversation(...args),
    markConversationRead: (...args: unknown[]) => mockMarkConversationRead(...args),
  }
})

jest.mock('@/lib/conversations/access', () => {
  const actual = jest.requireActual('@/lib/conversations/access')
  return {
    ...actual,
    authorizeConversationProject: (...args: unknown[]) => mockAuthorizeConversationProject(...args),
  }
})

import { ConversationReadConflictError } from '@/lib/conversations/conversations'
import { POST } from '@/app/api/v1/conversations/[convId]/read/route'

const conversation = {
  id: 'conv-1',
  orgId: 'org-1',
  title: 'Team chat',
  startedBy: 'member-1',
  participants: [{ kind: 'user', uid: 'member-1', role: 'client' }],
  participantUids: ['member-1'],
  participantAgentIds: [],
  lastMessageId: 'message-2',
  unreadCounts: { 'member-1': 2, 'member-2': 9 },
  messageCount: 2,
  archived: false,
}

describe('POST /api/v1/conversations/[convId]/read', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockGetConversation.mockResolvedValue(conversation)
    mockMarkConversationRead.mockResolvedValue(undefined)
    mockAuthorizeConversationProject.mockResolvedValue({ ok: true, projectId: null })
  })

  it('marks only the authenticated member through the exact latest message', async () => {
    mockGetConversation
      .mockResolvedValueOnce(conversation)
      .mockResolvedValueOnce({
        ...conversation,
        unreadCounts: { 'member-1': 0, 'member-2': 9 },
        readStateByUser: {
          'member-1': { lastReadMessageId: 'message-2', lastReadMessageCount: 2 },
        },
      })
    const response = await POST(new NextRequest('https://test.local/api/v1/conversations/conv-1/read', {
      method: 'POST',
      body: JSON.stringify({ lastMessageId: 'message-2' }),
    }), { params: Promise.resolve({ convId: 'conv-1' }) })

    expect(response.status).toBe(200)
    expect(mockMarkConversationRead).toHaveBeenCalledWith({
      convId: 'conv-1',
      userId: 'member-1',
      lastMessageId: 'message-2',
    })
    const body = await response.json()
    expect(body.data.conversation.unreadCount).toBe(0)
    expect(body.data.conversation).not.toHaveProperty('unreadCounts')
  })

  it('returns a retryable conflict when a newer message wins the race', async () => {
    mockMarkConversationRead.mockRejectedValue(new ConversationReadConflictError('message-3'))
    const response = await POST(new NextRequest('https://test.local/api/v1/conversations/conv-1/read', {
      method: 'POST',
      body: JSON.stringify({ lastMessageId: 'message-2' }),
    }), { params: Promise.resolve({ convId: 'conv-1' }) })

    expect(response.status).toBe(409)
    expect(await response.json()).toEqual(expect.objectContaining({
      currentLastMessageId: 'message-3',
    }))
  })
})
