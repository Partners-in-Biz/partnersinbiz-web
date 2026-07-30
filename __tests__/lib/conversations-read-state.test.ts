import {
  advanceConversationUnreadCounts,
  retainConversationReadState,
} from '@/lib/conversations/read-state'

describe('conversation read state', () => {
  it('resets the human author and increments every other current member', () => {
    expect(advanceConversationUnreadCounts({
      participantUids: ['member-1', 'member-2', 'member-3'],
      current: { 'member-1': 4, 'member-2': 1, removed: 99 },
      authorUserId: 'member-1',
    })).toEqual({
      'member-1': 0,
      'member-2': 2,
      'member-3': 1,
    })
  })

  it('increments all human members for agent and system messages', () => {
    expect(advanceConversationUnreadCounts({
      participantUids: ['member-1', 'member-2'],
      current: { 'member-1': -4, 'member-2': Number.NaN },
    })).toEqual({
      'member-1': 1,
      'member-2': 1,
    })
  })

  it('drops read markers for removed members', () => {
    const state = {
      'member-1': { lastReadMessageId: 'message-1' },
      removed: { lastReadMessageId: 'message-old' },
    }
    expect(retainConversationReadState(['member-1', 'member-2'], state)).toEqual({
      'member-1': { lastReadMessageId: 'message-1' },
    })
  })
})
