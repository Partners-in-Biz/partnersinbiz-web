import { FieldValue } from 'firebase-admin/firestore'

/**
 * Durable, server-only source for the GCP realtime delivery pipeline.
 *
 * The browser never reads this collection. Events intentionally contain no
 * message body, tool output, attachment URL, credential, or Hermes payload.
 * They only invalidate the recipient's canonical HTTP view.
 */
export const REALTIME_OUTBOX_COLLECTION = 'realtime_outbox'
export const REALTIME_EVENT_SCHEMA_VERSION = 1 as const

export type RealtimeOutboxKind =
  | 'conversation.created'
  | 'conversation.updated'
  | 'conversation.access_changed'
  | 'conversation.deleted'
  | 'message.created'
  | 'message.updated'
  | 'conversation.read_changed'
  | 'run.updated'

export type RealtimeOutboxSubject = {
  messageId?: string
  runId?: string
  runDocId?: string
}

export type RealtimeOutboxEvent = {
  schemaVersion: typeof REALTIME_EVENT_SCHEMA_VERSION
  eventId: string
  aggregateType: 'conversation'
  conversationId: string
  orgId: string
  sequence: number
  kind: RealtimeOutboxKind
  subject?: RealtimeOutboxSubject
  /**
   * Recipients are server-only delivery targets. The gateway strips every
   * other field before broadcasting an opaque invalidation frame.
   */
  recipientUserIds: string[]
  accessVersion: number
  occurredAt: FirebaseFirestore.FieldValue
}

export function realtimeOutboxEnabled(): boolean {
  const mode = process.env.CONVERSATION_REALTIME_TRANSPORT?.trim().toLowerCase()
  return mode === 'shadow' || mode === 'enabled'
}

function safeRecipientUserIds(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return Array.from(new Set(value.filter((uid): uid is string => (
    typeof uid === 'string' && uid.trim().length > 0
  )))).sort()
}

/**
 * Appends an event in the same transaction as the canonical conversation
 * mutation. The monotonically increasing sequence lets Pub/Sub consumers
 * discard duplicates and force a canonical resync after a gap.
 */
export function appendConversationRealtimeOutboxEvent(input: {
  transaction: FirebaseFirestore.Transaction
  conversationRef: FirebaseFirestore.DocumentReference
  conversation: {
    orgId?: unknown
    participantUids?: unknown
    accessVersion?: unknown
    realtimeSequence?: unknown
  }
  conversationId: string
  kind: RealtimeOutboxKind
  subject?: RealtimeOutboxSubject
  recipientUserIds?: string[]
  accessVersion?: number
  /** Performs the one canonical conversation write for this transaction. */
  writeConversation: (realtimeSequence?: number) => void
}): number {
  if (!realtimeOutboxEnabled()) {
    input.writeConversation()
    return 0
  }

  const orgId = typeof input.conversation.orgId === 'string' ? input.conversation.orgId.trim() : ''
  if (!orgId) throw new Error('Realtime outbox requires a conversation organisation')

  const currentSequence = Number.isInteger(input.conversation.realtimeSequence)
    ? Math.max(0, Number(input.conversation.realtimeSequence))
    : 0
  const sequence = currentSequence + 1
  const accessVersion = Number.isInteger(input.accessVersion)
    ? Math.max(0, Number(input.accessVersion))
    : Number.isInteger(input.conversation.accessVersion)
    ? Math.max(0, Number(input.conversation.accessVersion))
    : 0
  const recipientUserIds = safeRecipientUserIds(
    input.recipientUserIds ?? input.conversation.participantUids,
  )
  const eventId = `evt:v1:${input.conversationId}:${sequence}`
  const event: RealtimeOutboxEvent = {
    schemaVersion: REALTIME_EVENT_SCHEMA_VERSION,
    eventId,
    aggregateType: 'conversation',
    conversationId: input.conversationId,
    orgId,
    sequence,
    kind: input.kind,
    ...(input.subject ? { subject: input.subject } : {}),
    recipientUserIds,
    accessVersion,
    occurredAt: FieldValue.serverTimestamp(),
  }

  input.writeConversation(sequence)
  input.transaction.create(
    input.conversationRef.firestore.collection(REALTIME_OUTBOX_COLLECTION).doc(eventId),
    event,
  )
  return sequence
}

/** A minimal, browser-safe Pub/Sub delivery shape produced by Functions. */
export type RealtimeGatewayDelivery = {
  schemaVersion: typeof REALTIME_EVENT_SCHEMA_VERSION
  eventId: string
  recipientUserIds: string[]
}

export function toRealtimeGatewayDelivery(event: RealtimeOutboxEvent): RealtimeGatewayDelivery {
  return {
    schemaVersion: REALTIME_EVENT_SCHEMA_VERSION,
    eventId: event.eventId,
    recipientUserIds: safeRecipientUserIds(event.recipientUserIds),
  }
}
