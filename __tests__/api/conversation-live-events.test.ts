import { NextRequest } from 'next/server'
import {
  CONVERSATION_LIVE_REFRESH_MS,
  CONVERSATION_LIVE_STREAM_TTL_MS,
} from '@/lib/conversations/live-feed'

const mockListConversations = jest.fn()
const mockGetConversation = jest.fn()
const mockListMessages = jest.fn()
const mockAuthorizeConversationProject = jest.fn()
const mockListConversationPresence = jest.fn()

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

jest.mock('@/lib/conversations/conversations', () => ({
  listConversations: (...args: unknown[]) => mockListConversations(...args),
  getConversation: (...args: unknown[]) => mockGetConversation(...args),
  listMessages: (...args: unknown[]) => mockListMessages(...args),
}))

jest.mock('@/lib/conversations/access', () => {
  const actual = jest.requireActual('@/lib/conversations/access')
  return {
    ...actual,
    authorizeConversationProject: (...args: unknown[]) => mockAuthorizeConversationProject(...args),
  }
})
jest.mock('@/lib/conversations/presence', () => ({
  listConversationPresence: (...args: unknown[]) => mockListConversationPresence(...args),
}))

import { GET } from '@/app/api/v1/conversations/live/route'

describe('GET /api/v1/conversations/live', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockListConversations.mockResolvedValue([])
    mockGetConversation.mockResolvedValue(null)
    mockListMessages.mockResolvedValue([])
    mockAuthorizeConversationProject.mockResolvedValue({ ok: true, projectId: null })
    mockListConversationPresence.mockResolvedValue([])
  })

  it('streams a browser-safe active group conversation and its messages', async () => {
    const conversation = {
      id: 'conv-1',
      orgId: 'org-1',
      title: 'Sales team',
      startedBy: 'member-1',
      participants: [
        { kind: 'user', uid: 'member-1', role: 'client', displayName: 'Member One', email: 'one@example.com' },
        { kind: 'user', uid: 'member-2', role: 'client', displayName: 'Member Two', email: 'two@example.com' },
      ],
      participantUids: ['member-1', 'member-2'],
      participantAgentIds: [],
      unreadCounts: { 'member-1': 2, 'member-2': 8 },
      readStateByUser: {
        'member-1': { lastReadMessageId: 'message-old' },
        'member-2': { lastReadMessageId: 'message-private' },
      },
      messageCount: 1,
      archived: false,
      workspaceContext: {
        workspaceId: 'workspace-1',
        orgId: 'org-1',
        orgSlug: 'org-1',
        orgName: 'Org One',
        agentDomain: 'org-one',
        sourceOfTruth: 'vps',
        runtimeTarget: 'vps',
        runtimeLabel: 'Organisation VPS',
        shareMode: 'shared',
        ownerUserId: 'member-1',
        companyId: null,
        contactIds: [],
        vpsPath: '/srv/private',
      },
    }
    mockListConversations.mockResolvedValue([conversation])
    mockListMessages.mockResolvedValue([{
      id: 'message-1',
      conversationId: 'conv-1',
      role: 'user',
      content: 'Quarterly target updated',
      authorKind: 'user',
      authorId: 'member-2',
      authorDisplayName: 'Member Two',
      status: 'completed',
      events: [{ private: true }],
    }])

    const response = await GET(new NextRequest(
      'https://partnersinbiz.online/api/v1/conversations/live?orgId=org-1&conversationId=conv-1',
    ))

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('text/event-stream')
    const reader = response.body!.getReader()
    const first = await reader.read()
    const second = await reader.read()
    await reader.cancel()

    expect(new TextDecoder().decode(first.value)).toBe('retry: 1500\n\n')
    const frame = new TextDecoder().decode(second.value)
    expect(frame).toContain('"type":"snapshot"')
    expect(frame).toContain('"Quarterly target updated"')
    expect(frame).not.toContain('one@example.com')
    expect(frame).not.toContain('/srv/private')
    expect(frame).not.toContain('"events"')
    expect(frame).toContain('"unreadCount":2')
    expect(frame).not.toContain('"unreadCounts"')
    expect(frame).not.toContain('message-private')
  })

  it('permission-checks a focused conversation outside the current rail filter', async () => {
    const conversation = {
      id: 'conv-focused',
      orgId: 'org-1',
      title: 'Focused',
      startedBy: 'member-1',
      participants: [{ kind: 'user', uid: 'member-1', role: 'client' }],
      participantUids: ['member-1'],
      participantAgentIds: [],
      messageCount: 0,
      archived: false,
    }
    mockGetConversation.mockResolvedValue(conversation)

    const response = await GET(new NextRequest(
      'https://partnersinbiz.online/api/v1/conversations/live?orgId=org-1&scope=project&scopeRefId=other&conversationId=conv-focused',
    ))
    const reader = response.body!.getReader()
    await reader.read()
    const snapshot = await reader.read()
    await reader.cancel()

    expect(mockGetConversation).toHaveBeenCalledWith('conv-focused')
    expect(mockAuthorizeConversationProject).toHaveBeenCalledWith(
      expect.objectContaining({ uid: 'member-1' }),
      conversation,
    )
    expect(mockListMessages).toHaveBeenCalledWith('conv-focused', 20)
    expect(new TextDecoder().decode(snapshot.value)).toContain('"id":"conv-focused"')
  })

  it('does not reread an unchanged active thread inside a bounded fallback stream', async () => {
    jest.useFakeTimers()
    const conversation = {
      id: 'conv-stable',
      orgId: 'org-1',
      title: 'Stable thread',
      startedBy: 'member-1',
      participants: [{ kind: 'user', uid: 'member-1', role: 'client' }],
      participantUids: ['member-1'],
      participantAgentIds: [],
      messageCount: 1,
      archived: false,
      updatedAt: { toMillis: () => 1_000 },
    }
    mockListConversations.mockResolvedValue([conversation])
    mockListMessages.mockResolvedValue([{
      id: 'message-stable',
      conversationId: 'conv-stable',
      role: 'user',
      content: 'No change',
      status: 'completed',
    }])

    const response = await GET(new NextRequest(
      'https://partnersinbiz.online/api/v1/conversations/live?orgId=org-1&conversationId=conv-stable',
    ))
    const reader = response.body!.getReader()
    await reader.read()
    await reader.read()

    expect(mockListMessages).toHaveBeenCalledTimes(1)
    expect(CONVERSATION_LIVE_REFRESH_MS).toBeGreaterThanOrEqual(CONVERSATION_LIVE_STREAM_TTL_MS)
    await jest.advanceTimersByTimeAsync(CONVERSATION_LIVE_STREAM_TTL_MS)
    expect(mockListConversations).toHaveBeenCalledTimes(1)
    expect(mockListMessages).toHaveBeenCalledTimes(1)

    await reader.cancel()
    jest.useRealTimers()
  })
})
