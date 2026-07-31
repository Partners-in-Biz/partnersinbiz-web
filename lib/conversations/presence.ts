import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'

export const CONVERSATION_PRESENCE_COLLECTION = 'conversation_presence'
const PRESENCE_TTL_MS = 12_000

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

interface UnknownRecord {
  [key: string]: unknown
}

function asRecord(value: unknown): UnknownRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as UnknownRecord : {}
}

function sanitizeString(value: unknown, max = 160): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  if (!trimmed) return undefined
  return trimmed.slice(0, max)
}

function serializePresence(id: string, data: UnknownRecord): ConversationPresence {
  return {
    id,
    orgId: String(data.orgId ?? ''),
    conversationId: String(data.conversationId ?? ''),
    actorUid: String(data.actorUid ?? ''),
    actorType: data.actorType === 'agent' ? 'agent' : 'user',
    state: data.state === 'typing' || data.state === 'active' || data.state === 'viewing'
      ? data.state
      : 'active',
    displayName: sanitizeString(data.displayName, 80),
    lastMessageId: sanitizeString(data.lastMessageId, 120),
    lastSeenAt: data.lastSeenAt,
    lastSeenAtMs: typeof data.lastSeenAtMs === 'number' ? data.lastSeenAtMs : 0,
    expiresAtMs: typeof data.expiresAtMs === 'number' ? data.expiresAtMs : 0,
  }
}

export async function listConversationPresence(
  conversationId: string,
  orgId: string,
  nowMs = Date.now(),
): Promise<ConversationPresence[]> {
  const snap = await adminDb
    .collection(CONVERSATION_PRESENCE_COLLECTION)
    .where('conversationId', '==', conversationId)
    .where('orgId', '==', orgId)
    .get()

  return snap.docs
    .map((doc) => serializePresence(doc.id, doc.data() as UnknownRecord))
    .filter((presence) => presence.expiresAtMs > nowMs)
    .sort((a, b) => b.lastSeenAtMs - a.lastSeenAtMs)
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

export async function heartbeatConversationPresence(
  conversationId: string,
  orgId: string,
  input: unknown,
  actor: { uid: string; type: ConversationPresenceActorType },
  nowMs = Date.now(),
): Promise<ConversationPresence> {
  const body = asRecord(input)
  const candidateState = sanitizeString(body.state)?.toLowerCase()
  const state = candidateState === 'typing' || candidateState === 'viewing'
    ? candidateState
    : 'active'
  const payload = {
    orgId,
    conversationId,
    actorUid: actor.uid,
    actorType: actor.type,
    state: state as ConversationPresenceState,
    displayName: sanitizeString(body.displayName, 80),
    lastMessageId: sanitizeString(body.lastMessageId, 120),
    lastSeenAt: FieldValue.serverTimestamp(),
    lastSeenAtMs: nowMs,
    expiresAtMs: nowMs + PRESENCE_TTL_MS,
  }
  const cleanedPayload = Object.fromEntries(
    Object.entries(payload).filter(([, value]) => value !== undefined),
  )
  const presenceId = `${conversationId}:${actor.uid}`.replace(/[^a-zA-Z0-9_-]/g, '_')
  await adminDb.collection(CONVERSATION_PRESENCE_COLLECTION).doc(presenceId).set(cleanedPayload, { merge: true })
  const serialized = await listConversationPresence(conversationId, orgId, nowMs + 1)
  const current = serialized.find((item) => item.id === presenceId)
  return current ?? {
    id: presenceId,
    ...payload,
    lastSeenAt: new Date(nowMs).toISOString(),
  }
}

