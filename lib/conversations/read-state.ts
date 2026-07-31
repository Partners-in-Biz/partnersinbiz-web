import type { ConversationReadState } from './types'

function safeUnreadCount(value: unknown): number {
  return Number.isFinite(value) ? Math.max(0, Math.floor(Number(value))) : 0
}

/** Advance unread counters for one newly visible conversation message. */
export function advanceConversationUnreadCounts(input: {
  participantUids: string[]
  current?: Record<string, number>
  authorUserId?: string
}): Record<string, number> {
  return Object.fromEntries(input.participantUids.map((uid) => [
    uid,
    uid === input.authorUserId ? 0 : safeUnreadCount(input.current?.[uid]) + 1,
  ]))
}

/** Remove read metadata for members who no longer participate. */
export function retainConversationReadState(
  participantUids: string[],
  current?: Record<string, ConversationReadState>,
): Record<string, ConversationReadState> {
  return Object.fromEntries(participantUids.flatMap((uid) => {
    const state = current?.[uid]
    return state ? [[uid, state] as const] : []
  }))
}
