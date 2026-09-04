/**
 * Workspace tab activity for Hermes Messages.
 *
 * - running: agent turn in flight on a tab the user is not viewing → pulse border
 * - computer: desktop/browser session live on a background tab → computer accent
 * - unread: turn finished while the tab was not focused → solid bottom border
 * - idle: focused, or no pending attention
 */

export type TabActivityPhase = 'idle' | 'running' | 'unread' | 'computer'

export type ConversationLifecyclePhase = 'running' | 'completed' | 'idle' | 'computer'

export type ConversationLifecycleEvent = {
  conversationId: string
  phase: ConversationLifecyclePhase
}

/**
 * The gateway supplies an invalidation exactly when a background run changes.
 * Keep the old timer only as a resilience path while that connection is down.
 */
export function shouldUseBackgroundRunPolling(realtimeGatewayReady: boolean): boolean {
  return !realtimeGatewayReady
}

/**
 * Pure state transition for one conversation tab.
 *
 * Running is retained even while focused so leaving mid-turn still pulses the
 * background tab. UI chrome only renders for non-focused tabs.
 */
export function nextTabActivity(
  current: TabActivityPhase | undefined,
  event: ConversationLifecyclePhase,
  isFocused: boolean,
): TabActivityPhase {
  if (event === 'running') return 'running'
  if (event === 'computer') return 'computer'
  if (event === 'completed') return isFocused ? 'idle' : 'unread'
  // Explicit idle: keep unread on background tabs; clear running/computer.
  if (isFocused) return 'idle'
  if (current === 'unread') return 'unread'
  return 'idle'
}

export function applyConversationLifecycle(
  activityByConversationId: Record<string, TabActivityPhase>,
  event: ConversationLifecycleEvent,
  focusedConversationIds: ReadonlySet<string>,
): Record<string, TabActivityPhase> {
  const conversationId = event.conversationId.trim()
  if (!conversationId) return activityByConversationId
  const isFocused = focusedConversationIds.has(conversationId)
  const next = nextTabActivity(activityByConversationId[conversationId], event.phase, isFocused)
  if (next === 'idle') {
    if (!(conversationId in activityByConversationId)) return activityByConversationId
    const { [conversationId]: _removed, ...rest } = activityByConversationId
    return rest
  }
  if (activityByConversationId[conversationId] === next) return activityByConversationId
  return { ...activityByConversationId, [conversationId]: next }
}

/** Clear attention when the user opens a tab. */
export function clearTabActivity(
  activityByConversationId: Record<string, TabActivityPhase>,
  conversationId: string,
): Record<string, TabActivityPhase> {
  const id = conversationId.trim()
  if (!id || !(id in activityByConversationId)) return activityByConversationId
  const { [id]: _removed, ...rest } = activityByConversationId
  return rest
}

const IN_FLIGHT_STATUSES = new Set(['queued', 'pending', 'streaming', 'waiting_approval'])

export function messageIndicatesInFlightRun(message: {
  role?: string
  runId?: string | null
  status?: string | null
}): boolean {
  if (message.role !== 'assistant' || !message.runId) return false
  return IN_FLIGHT_STATUSES.has(String(message.status ?? ''))
}

export function messagesIndicateInFlightRun(
  messages: Array<{ role?: string; runId?: string | null; status?: string | null }>,
): boolean {
  return messages.some(messageIndicatesInFlightRun)
}
