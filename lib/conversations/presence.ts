/**
 * Server-only conversation presence store (Firestore Admin).
 * Client UI must import from `./presence-shared` — never this file.
 */
import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import type {
  ConversationPresence,
  ConversationPresenceActorType,
  ConversationPresenceState,
} from './presence-shared'

export {
  formatConversationPresenceLine,
  type ConversationPresence,
  type ConversationPresenceActorType,
  type ConversationPresenceState,
} from './presence-shared'

export const CONVERSATION_PRESENCE_COLLECTION = 'conversation_presence'
// Longer TTL lets the client heartbeat less often without flapping chips.
// Live transport still owns collaborator freshness; this is only the doc lease.
const PRESENCE_TTL_MS = 45_000

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

function serializeLastSeenAt(value: unknown): ConversationPresence['lastSeenAt'] {
  if (typeof value === 'string' && value.trim()) return value
  if (value && typeof value === 'object' && typeof (value as { toISOString?: unknown }).toISOString === 'function') {
    return value as { toISOString: () => string }
  }
  return undefined
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
    lastSeenAt: serializeLastSeenAt(data.lastSeenAt),
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
    .limit(40)
    .get()

  return snap.docs
    .map((doc) => serializePresence(doc.id, doc.data() as UnknownRecord))
    .filter((presence) => presence.expiresAtMs > nowMs)
    .sort((a, b) => b.lastSeenAtMs - a.lastSeenAtMs)
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
  // The caller only needs an acknowledgement for its own heartbeat. Re-listing
  // every collaborator here turns each presence write into an avoidable
  // collection read; the live transport owns collaborator updates.
  return {
    id: presenceId,
    ...payload,
    lastSeenAt: new Date(nowMs).toISOString(),
  }
}
