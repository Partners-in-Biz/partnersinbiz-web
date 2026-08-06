import {
  planConversationRealtimeRefresh,
  shouldUseConversationLiveFallback,
} from '@/lib/conversations/realtime-invalidation'

describe('conversation realtime invalidation', () => {
  it('keeps the legacy live feed only until an enabled gateway is ready', () => {
    expect(shouldUseConversationLiveFallback({ pageVisible: true, transport: 'enabled', gatewayReady: false })).toBe(true)
    expect(shouldUseConversationLiveFallback({ pageVisible: true, transport: 'enabled', gatewayReady: true })).toBe(false)
    expect(shouldUseConversationLiveFallback({ pageVisible: true, transport: 'shadow', gatewayReady: true })).toBe(true)
    expect(shouldUseConversationLiveFallback({ pageVisible: false, transport: 'enabled', gatewayReady: false })).toBe(false)
  })

  it('refreshes only the invalidated conversation and its active transcript', () => {
    expect(planConversationRealtimeRefresh({
      eventId: 'evt:v1:conv-active:7',
      conversationId: 'conv-active',
    }, 'conv-active')).toEqual({
      conversationId: 'conv-active',
      refreshMessages: true,
    })
  })

  it('does not request a transcript for an invalidated background conversation', () => {
    expect(planConversationRealtimeRefresh({
      eventId: 'evt:v1:conv-background:8',
      conversationId: 'conv-background',
    }, 'conv-active')).toEqual({
      conversationId: 'conv-background',
      refreshMessages: false,
    })
  })

  it('rejects malformed gateway invalidations before any API work is scheduled', () => {
    expect(planConversationRealtimeRefresh({
      eventId: 'evt:v1:conv-active:7',
      conversationId: 'bad/id',
    }, 'conv-active')).toBeNull()
  })
})
