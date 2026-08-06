export type ConversationRealtimeInvalidation = {
  eventId: string
  conversationId: string
}

export type ConversationRealtimeRefreshPlan = {
  conversationId: string
  refreshMessages: boolean
}

const CONVERSATION_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/

export function shouldUseConversationLiveFallback(input: {
  pageVisible: boolean
  transport: string
  gatewayReady: boolean
}): boolean {
  return input.pageVisible && !(input.transport === 'enabled' && input.gatewayReady)
}

/**
 * Gateway frames contain no conversation data. This helper only decides which
 * canonical, permission-checked HTTP resource may be refreshed for a valid
 * invalidation. It deliberately never falls back to a full conversation list.
 */
export function planConversationRealtimeRefresh(
  invalidation: ConversationRealtimeInvalidation,
  activeConversationId: string | null | undefined,
): ConversationRealtimeRefreshPlan | null {
  const conversationId = invalidation.conversationId.trim()
  const eventId = invalidation.eventId.trim()
  if (!eventId || !CONVERSATION_ID_PATTERN.test(conversationId)) return null
  return {
    conversationId,
    refreshMessages: activeConversationId === conversationId,
  }
}
