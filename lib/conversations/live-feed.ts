import type { Conversation, ConversationMessage, ConversationScope } from './types'
import type { ConversationPresence } from '@/lib/conversations/presence-shared'

// The live feed is a bounded server poll, not a Firestore listener. Keep the
// cadence responsive without re-reading the entire Messages rail and thread
// hundreds of times per minute for every open browser tab.
export const CONVERSATION_LIVE_REFRESH_MS = 60_000
export const CONVERSATION_LIVE_STREAM_TTL_MS = 55_000
export const CONVERSATION_LIVE_MESSAGE_LIMIT = 20

const VALID_SCOPES = new Set<ConversationScope>([
  'general',
  'project',
  'workspace',
  'task',
  'campaign',
  'company',
  'contact',
])

export interface ConversationLiveQuery {
  orgId: string | null
  limit: number
  scope?: ConversationScope
  scopeRefId?: string
  projectId?: string
  includeAllScopes?: boolean
  conversationId?: string
}

export interface ConversationLiveSnapshot {
  type: 'snapshot'
  conversations: Conversation[]
  conversation: Conversation | null
  messages: ConversationMessage[] | null
  presence: ConversationPresence[] | null
  emittedAtMs: number
}

function clean(value: string | null): string | undefined {
  const normalized = value?.trim()
  return normalized || undefined
}

export function parseConversationLiveQuery(url: string): ConversationLiveQuery {
  const searchParams = new URL(url).searchParams
  const includeAllScopes = clean(searchParams.get('includeAllScopes'))?.toLowerCase() === 'true'
    || clean(searchParams.get('includeAllScopes')) === '1'
  const defaultLimit = includeAllScopes ? 100 : 30
  const rawLimit = Number.parseInt(searchParams.get('limit') ?? String(defaultLimit), 10)
  const requestedScope = clean(searchParams.get('scope'))

  return {
    orgId: clean(searchParams.get('orgId')) ?? null,
    limit: Number.isFinite(rawLimit) ? Math.max(1, Math.min(rawLimit, 100)) : defaultLimit,
    ...(requestedScope && VALID_SCOPES.has(requestedScope as ConversationScope)
      ? { scope: requestedScope as ConversationScope }
      : {}),
    ...(clean(searchParams.get('scopeRefId'))
      ? { scopeRefId: clean(searchParams.get('scopeRefId')) }
      : {}),
    ...(includeAllScopes ? { includeAllScopes } : {}),
    ...(clean(searchParams.get('projectId'))
      ? { projectId: clean(searchParams.get('projectId')) }
      : {}),
    ...(clean(searchParams.get('conversationId'))
      ? { conversationId: clean(searchParams.get('conversationId')) }
      : {}),
  }
}

export function conversationLiveSnapshotSignature(
  snapshot: ConversationLiveSnapshot | Omit<ConversationLiveSnapshot, 'type' | 'emittedAtMs'>,
): string {
  const source = snapshot as ConversationLiveSnapshot
  const stable = {
    conversations: source.conversations,
    conversation: source.conversation,
    messages: source.messages,
    presence: source.presence,
  }
  return JSON.stringify(stable)
}

export function encodeConversationLiveEvent(payload: ConversationLiveSnapshot | {
  type: 'error'
  error: string
}): Uint8Array {
  return new TextEncoder().encode(`data: ${JSON.stringify(payload)}\n\n`)
}
