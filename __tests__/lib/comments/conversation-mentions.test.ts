const mockBatchSet = jest.fn()
const mockBatchCommit = jest.fn()
const mockCollection = jest.fn()
const mockSendPush = jest.fn()
const mockResolveOrgSlug = jest.fn()

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: {
    batch: () => ({ set: mockBatchSet, commit: mockBatchCommit }),
    collection: (...args: unknown[]) => mockCollection(...args),
  },
}))

jest.mock('@/lib/projects/links', () => ({
  resolveOrgSlugForLink: (...args: unknown[]) => mockResolveOrgSlug(...args),
}))

jest.mock('@/lib/notifications/push', () => ({
  sendPushToUser: (...args: unknown[]) => mockSendPush(...args),
}))

import { notifyConversationMentions } from '@/lib/comments/conversation-mentions'

describe('notifyConversationMentions', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockBatchCommit.mockResolvedValue(undefined)
    mockCollection.mockReturnValue({ doc: () => ({ id: 'notif-1' }) })
    mockResolveOrgSlug.mockResolvedValue('partners-in-biz')
    mockSendPush.mockResolvedValue({ attempted: 1, delivered: 1, pruned: 0 })
  })

  it('writes in-app notifications with Messages deep links and sends push for user mentions', async () => {
    const result = await notifyConversationMentions({
      orgId: 'org-1',
      conversationId: 'conv-1',
      messageId: 'msg-9',
      actorName: 'Peet',
      snippet: 'Hey @user:member-2 can you review?',
      mentions: [
        { type: 'user', id: 'member-2', raw: '@user:member-2' },
        { type: 'agent', id: 'maya', raw: '@agent:maya' },
      ],
    })

    expect(result.notifiedUserIds).toEqual(['member-2'])
    expect(result.pushAttempted).toBe(1)
    expect(mockBatchSet).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        userId: 'member-2',
        type: 'mention',
        link: '/admin/org/partners-in-biz/messages?convId=conv-1&messageId=msg-9',
        data: expect.objectContaining({
          conversationId: 'conv-1',
          messageId: 'msg-9',
          surface: 'messages',
        }),
      }),
    )
    expect(mockSendPush).toHaveBeenCalledWith('member-2', expect.objectContaining({
      title: 'Peet mentioned you',
      link: '/admin/org/partners-in-biz/messages?convId=conv-1&messageId=msg-9',
      data: expect.objectContaining({ type: 'mention', conversationId: 'conv-1' }),
    }))
  })

  it('skips agent-only mentions without writing user notifications', async () => {
    const result = await notifyConversationMentions({
      orgId: 'org-1',
      conversationId: 'conv-1',
      messageId: 'msg-9',
      actorName: 'Peet',
      snippet: '@agent:maya please handle',
      mentions: [{ type: 'agent', id: 'maya', raw: '@agent:maya' }],
    })
    expect(result.notifiedUserIds).toEqual([])
    expect(mockBatchSet).not.toHaveBeenCalled()
    expect(mockSendPush).not.toHaveBeenCalled()
  })
})
