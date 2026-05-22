/**
 * Firestore helpers for the `conversations` collection.
 *
 * Collection layout:
 *   conversations/{convId}            — Conversation doc
 *   conversations/{convId}/messages/  — ConversationMessage subcollection
 */
import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import { AGENT_IDS } from '@/lib/agents/types'
import type { AgentId, Conversation, ConversationMessage, Participant } from './types'
import {
  CONVERSATION_RUN_DISPATCH_GRACE_MS,
} from './run-policy'

export const CONVERSATIONS_COLLECTION = 'conversations'

// ---------------------------------------------------------------------------
// Document / collection refs
// ---------------------------------------------------------------------------

export function convDoc(convId: string) {
  return adminDb.collection(CONVERSATIONS_COLLECTION).doc(convId)
}

export function messagesCollection(convId: string) {
  return convDoc(convId).collection('messages')
}

// ---------------------------------------------------------------------------
// Conversation CRUD
// ---------------------------------------------------------------------------

export async function createConversation(input: {
  orgId: string
  startedBy: string
  participants: Participant[]
  orchestration?: Conversation['orchestration']
  title?: string
  scope?: Conversation['scope']
  scopeRefId?: string
}): Promise<Conversation> {
  const ref = adminDb.collection(CONVERSATIONS_COLLECTION).doc()

  const participantUids = input.participants
    .filter((p): p is Extract<Participant, { kind: 'user' }> => p.kind === 'user')
    .map((p) => p.uid)

  const participantAgentIds = input.participants
    .filter((p): p is Extract<Participant, { kind: 'agent' }> => p.kind === 'agent')
    .map((p) => p.agentId)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data: Record<string, any> = {
    orgId: input.orgId,
    participants: input.participants,
    participantUids,
    participantAgentIds,
    ...(input.orchestration ? { orchestration: input.orchestration } : {}),
    startedBy: input.startedBy,
    title: input.title?.trim() || 'New conversation',
    messageCount: 0,
    archived: false,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  }

  if (input.scope) data.scope = input.scope
  if (input.scopeRefId) data.scopeRefId = input.scopeRefId

  await ref.set(data)
  return { id: ref.id, ...data } as Conversation
}

export async function getConversation(convId: string): Promise<Conversation | null> {
  const doc = await convDoc(convId).get()
  if (!doc.exists) return null
  return { id: doc.id, ...doc.data() } as Conversation
}

/**
 * List conversations for a user within an org, ordered by most-recently-updated.
 * Requires a composite index on: orgId ASC + participantUids ARRAY_CONTAINS + updatedAt DESC.
 */
export async function listConversations(
  orgId: string,
  uid: string,
  limit = 30,
  filters?: {
    scope?: Conversation['scope']
    scopeRefId?: string
    projectId?: string
  },
): Promise<Conversation[]> {
  const readLimit = filters?.scope || filters?.scopeRefId || filters?.projectId
    ? Math.max(limit, 100)
    : limit
  const snap = await adminDb
    .collection(CONVERSATIONS_COLLECTION)
    .where('orgId', '==', orgId)
    .where('participantUids', 'array-contains', uid)
    .orderBy('updatedAt', 'desc')
    .limit(readLimit)
    .get()

  return snap.docs
    .map((d) => ({ id: d.id, ...d.data() }) as Conversation)
    .filter((conversation) => {
      if (filters?.scope && conversation.scope !== filters.scope) return false
      if (filters?.scopeRefId && conversation.scopeRefId !== filters.scopeRefId) return false
      if (filters?.projectId && conversation.scopeRefId !== filters.projectId) return false
      return true
    })
    .slice(0, limit)
}

// ---------------------------------------------------------------------------
// Message helpers
// ---------------------------------------------------------------------------

export async function createMessage(
  convId: string,
  msg: Omit<ConversationMessage, 'id'>,
): Promise<ConversationMessage> {
  const ref = messagesCollection(convId).doc()
  const data = {
    ...msg,
    createdAt: FieldValue.serverTimestamp(),
  }
  await ref.set(data)
  return { id: ref.id, ...data } as ConversationMessage
}

export async function listMessages(convId: string, limit = 200): Promise<ConversationMessage[]> {
  const snap = await messagesCollection(convId)
    .orderBy('createdAt', 'asc')
    .limit(limit)
    .get()
  const now = Date.now()
  const messages: ConversationMessage[] = []
  const staleUpdates: Promise<unknown>[] = []

  for (const doc of snap.docs) {
    const data = doc.data()
    const message = { id: doc.id, ...data } as ConversationMessage
    const status = message.status
    const createdAtMs = data.createdAt?.toMillis?.() ?? 0
    const ageMs = createdAtMs ? now - createdAtMs : 0
    const isPending = status === 'pending' || status === 'streaming'
    const missingRun = isPending && !message.runId && ageMs > CONVERSATION_RUN_DISPATCH_GRACE_MS

    if (missingRun) {
      const error = 'Agent run was not started on the gateway'
      message.status = 'failed'
      message.error = error
      message.content = ''
      staleUpdates.push(doc.ref.update({
        content: '',
        status: 'failed',
        error,
      }))
    }

    messages.push(message)
  }

  if (staleUpdates.length > 0) await Promise.allSettled(staleUpdates)
  return messages
}

// ---------------------------------------------------------------------------
// Conversation mutation helpers
// ---------------------------------------------------------------------------

/** Update conversation metadata (title, archived) and bump updatedAt. */
export async function patchConversation(
  convId: string,
  patch: { title?: string; archived?: boolean },
): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const updates: Record<string, any> = { updatedAt: FieldValue.serverTimestamp() }
  if (patch.title !== undefined) updates.title = patch.title.trim()
  if (patch.archived !== undefined) updates.archived = patch.archived
  await convDoc(convId).update(updates)
}

/** Delete a conversation and its message subcollection. */
export async function deleteConversation(convId: string): Promise<void> {
  const ref = convDoc(convId)
  while (true) {
    const messagesSnap = await messagesCollection(convId).limit(500).get()
    if (messagesSnap.empty) break
    const batch = adminDb.batch()
    messagesSnap.docs.forEach((doc) => batch.delete(doc.ref))
    await batch.commit()
  }
  await ref.delete()
}

/** Bump lastMessage* denorm fields and increment messageCount after a new message. */
export async function touchConversation(
  convId: string,
  preview: string,
  role: ConversationMessage['role'],
): Promise<void> {
  await convDoc(convId).update({
    lastMessagePreview: preview.slice(0, 200),
    lastMessageRole: role,
    lastMessageAt: FieldValue.serverTimestamp(),
    messageCount: FieldValue.increment(1),
    updatedAt: FieldValue.serverTimestamp(),
  })
}

// ---------------------------------------------------------------------------
// Chat config helpers
// ---------------------------------------------------------------------------

export const ORG_CHAT_CONFIG_COLLECTION = 'org_chat_config'

export function orgChatConfigDoc(orgId: string) {
  return adminDb.collection(ORG_CHAT_CONFIG_COLLECTION).doc(orgId)
}

export async function getOrgChatConfig(orgId: string) {
  const doc = await orgChatConfigDoc(orgId).get()
  if (!doc.exists) return null
  return doc.data() as Record<string, unknown>
}

/** Return visible agent ids for a given role, sourced from config or defaults. */
export function resolveVisibleAgents(
  config: { visibleAgents?: { admin?: AgentId[]; client?: AgentId[] } } | null,
  role: 'admin' | 'client',
): AgentId[] {
  const defaults: Record<'admin' | 'client', AgentId[]> = {
    admin: [...AGENT_IDS],
    client: ['pip'],
  }
  return config?.visibleAgents?.[role] ?? defaults[role]
}
