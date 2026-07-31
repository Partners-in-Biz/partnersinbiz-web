/**
 * Client-safe conversation presence types and pure format helpers.
 * Must not import firebase-admin — used by UnifiedChat (browser bundle).
 */

export type ConversationPresenceActorType = 'user' | 'agent'
export type ConversationPresenceState = 'typing' | 'viewing' | 'active'

export interface ConversationPresence {
  id: string
  orgId: string
  conversationId: string
  actorUid: string
  actorType: ConversationPresenceActorType
  state: ConversationPresenceState
  displayName?: string
  lastMessageId?: string
  lastSeenAt?: string | { toISOString: () => string }
  lastSeenAtMs: number
  expiresAtMs: number
}

/** Human-readable typing/viewing line for collaborators excluding the current viewer. */
export function formatConversationPresenceLine(
  presence: Array<Pick<ConversationPresence, 'actorUid' | 'actorType' | 'state' | 'displayName'>>,
  currentUserUid?: string | null,
): string | null {
  const others = presence.filter((row) => row.actorUid && row.actorUid !== currentUserUid)
  if (others.length === 0) return null

  const labelFor = (row: Pick<ConversationPresence, 'actorUid' | 'actorType' | 'displayName'>) => {
    const name = typeof row.displayName === 'string' ? row.displayName.trim() : ''
    if (name) return name
    if (row.actorType === 'agent') return row.actorUid
    return 'Someone'
  }

  const typing = others.filter((row) => row.state === 'typing')
  if (typing.length === 1) return `${labelFor(typing[0])} is typing…`
  if (typing.length === 2) return `${labelFor(typing[0])} and ${labelFor(typing[1])} are typing…`
  if (typing.length > 2) return `${typing.length} people are typing…`

  const viewing = others.filter((row) => row.state === 'viewing' || row.state === 'active')
  if (viewing.length === 1) return `${labelFor(viewing[0])} is here`
  if (viewing.length > 1) return `${viewing.length} others are here`
  return null
}
