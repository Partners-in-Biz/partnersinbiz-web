/**
 * Firestore helpers for the `conversations` collection.
 *
 * Collection layout:
 *   conversations/{convId}            — Conversation doc
 *   conversations/{convId}/messages/  — ConversationMessage subcollection
 */
import { FieldValue } from 'firebase-admin/firestore'
import { getStorage } from 'firebase-admin/storage'
import { adminDb, getAdminApp } from '@/lib/firebase/admin'
import { AGENT_IDS } from '@/lib/agents/types'
import { resolveWorkforceBlueprint } from '@/lib/agents/role-blueprints'
import type { AgentId, Conversation, ConversationMessage, Participant } from './types'
import type { ContextReference } from '@/lib/context-references/types'
import type { ConversationWorkspaceContext } from '@/lib/client-provisioning/workspace-context'
import type { ApiUser } from '@/lib/api/types'
import { authorizeConversationProject, canAccessConversation } from './access'
import {
  CONVERSATION_RUN_DISPATCH_GRACE_MS,
} from './run-policy'
import {
  advanceConversationUnreadCounts,
  retainConversationReadState,
} from './read-state'
import {
  appendConversationRealtimeOutboxEvent,
  realtimeOutboxEnabled,
} from '@/lib/realtime/outbox'

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
  lineage?: Conversation['lineage']
  title?: string
  scope?: Conversation['scope']
  scopeRefId?: string
  workspaceContext?: ConversationWorkspaceContext | null
  contextRefs?: ContextReference[]
}): Promise<Conversation> {
  const ref = adminDb.collection(CONVERSATIONS_COLLECTION).doc()

  const participantUids = input.participants
    .filter((p): p is Extract<Participant, { kind: 'user' }> => p.kind === 'user')
    .map((p) => p.uid)

  const participantAgentIds = input.participants
    .filter((p): p is Extract<Participant, { kind: 'agent' }> => p.kind === 'agent')
    .map((p) => p.agentId)

  const data: Record<string, unknown> = {
    orgId: input.orgId,
    participants: input.participants,
    participantUids,
    participantAgentIds,
    accessVersion: 0,
    ...(input.orchestration ? { orchestration: input.orchestration } : {}),
    ...(input.lineage ? { lineage: input.lineage } : {}),
    startedBy: input.startedBy,
    title: input.title?.trim() || 'New conversation',
    messageCount: 0,
    unreadCounts: Object.fromEntries(participantUids.map((uid) => [uid, 0])),
    archived: false,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  }

  if (input.scope) data.scope = input.scope
  if (input.scopeRefId) data.scopeRefId = input.scopeRefId
  if (input.workspaceContext) data.workspaceContext = input.workspaceContext
  if (input.contextRefs?.length) data.contextRefs = input.contextRefs

  if (realtimeOutboxEnabled()) {
    await adminDb.runTransaction(async (transaction) => {
      appendConversationRealtimeOutboxEvent({
        transaction,
        conversationRef: ref,
        conversation: data,
        conversationId: ref.id,
        kind: 'conversation.created',
        writeConversation: (realtimeSequence) => transaction.create(ref, { ...data, realtimeSequence }),
      })
    })
  } else {
    await ref.set(data)
  }
  return { id: ref.id, ...data } as Conversation
}

export async function getConversation(convId: string): Promise<Conversation | null> {
  const doc = await convDoc(convId).get()
  if (!doc.exists) return null
  return { id: doc.id, ...doc.data() } as Conversation
}

/**
 * List conversations visible to a user within an org, ordered by most-recently-updated.
 * Participant-only private/shared chats and org-visible Workspace chats are filtered server-side.
 */
function conversationMatchesEntityScope(
  conversation: Conversation,
  scope: Conversation['scope'],
  scopeRefId: string,
): boolean {
  const hardScoped = conversation.scope === scope && conversation.scopeRefId === scopeRefId
  if (hardScoped) return true
  return Boolean(
    conversation.contextRefs?.some((ref) => ref.type === scope && ref.id === scopeRefId),
  )
}

export async function listConversations(
  orgId: string,
  user: ApiUser,
  limit = 30,
  filters?: {
    scope?: Conversation['scope']
    scopeRefId?: string
    projectId?: string
    includeAllScopes?: boolean
  },
): Promise<Conversation[]> {
  // Contact embeds must surface hard-scoped contact workspaces AND ordinary
  // Messages threads where that contact was attached as context. A Firestore
  // scopeRefId equality query would drop the context-linked set, so scan the
  // recent org page and filter in memory (same rule as UnifiedChat client).
  const contactContextScan = Boolean(
    !filters?.includeAllScopes
    && filters?.scope === 'contact'
    && filters?.scopeRefId,
  )
  const scopedRefId = filters?.includeAllScopes || contactContextScan
    ? undefined
    : (filters?.scopeRefId ?? filters?.projectId)
  const readLimit = contactContextScan
    ? Math.max(limit * 4, 100)
    : scopedRefId
      ? Math.max(limit * 2, 30)
      : Math.max(limit * 4, filters?.scope ? 100 : limit)
  const baseOrgQuery = adminDb.collection(CONVERSATIONS_COLLECTION).where('orgId', '==', orgId)
  // Project and other scoped Messages views previously read up to 100-120
  // organisation-wide conversations on every refresh, then discarded nearly
  // all of them in memory. Apply the most selective stable scope in Firestore
  // so billed reads track the conversations in this project instead.
  const orgQuery = scopedRefId
    ? baseOrgQuery.where('scopeRefId', '==', scopedRefId)
    : baseOrgQuery
  let snap: FirebaseFirestore.QuerySnapshot
  try {
    snap = await orgQuery
      .orderBy('updatedAt', 'desc')
      .limit(readLimit)
      .get()
  } catch (error) {
    const firestoreError = error as { code?: unknown; details?: unknown; message?: unknown }
    const description = `${String(firestoreError.details ?? '')} ${String(firestoreError.message ?? '')}`.toLowerCase()
    const missingIndex = firestoreError.code === 9 || firestoreError.code === 'failed-precondition' || description.includes('requires an index')
    if (!missingIndex) throw error

    // Keep messaging available while a newly declared composite index is still building.
    // Read the whole org set before sorting so an unordered limit cannot hide newer rows.
    snap = await baseOrgQuery.get()
  }

  const candidates = snap.docs
    .map((d) => ({ id: d.id, ...d.data() }) as Conversation)
    .sort((left, right) => {
      const leftMs = left.updatedAt?.toMillis?.() ?? 0
      const rightMs = right.updatedAt?.toMillis?.() ?? 0
      return rightMs - leftMs
    })
    .filter((conversation) => {
      if (!canAccessConversation(user, conversation)) return false
      if (filters?.includeAllScopes) return true
      if (filters?.scope && filters?.scopeRefId) {
        return conversationMatchesEntityScope(conversation, filters.scope, filters.scopeRefId)
      }
      if (filters?.scope && conversation.scope !== filters.scope) return false
      if (filters?.scopeRefId && conversation.scopeRefId !== filters.scopeRefId) return false
      if (filters?.projectId && conversation.scopeRefId !== filters.projectId) return false
      return true
    })

  const projectAuthorizations = await Promise.all(
    candidates.map((conversation) => authorizeConversationProject(user, conversation)),
  )

  return candidates
    .filter((_conversation, index) => projectAuthorizations[index]?.ok)
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
  if (realtimeOutboxEnabled()) {
    const conversationRef = convDoc(convId)
    await adminDb.runTransaction(async (transaction) => {
      const conversationSnapshot = await transaction.get(conversationRef)
      if (!conversationSnapshot.exists) throw new Error('Conversation not found')
      transaction.create(ref, data)
      appendConversationRealtimeOutboxEvent({
        transaction,
        conversationRef,
        conversation: conversationSnapshot.data() as Conversation,
        conversationId: convId,
        kind: 'message.created',
        subject: { messageId: ref.id },
        writeConversation: (realtimeSequence) => transaction.update(conversationRef, { realtimeSequence }),
      })
    })
  } else {
    await ref.set(data)
  }
  return { id: ref.id, ...data } as ConversationMessage
}

export async function listMessages(convId: string, limit = 200): Promise<ConversationMessage[]> {
  const snap = await messagesCollection(convId)
    .orderBy('createdAt', 'desc')
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
  return messages.reverse()
}

// ---------------------------------------------------------------------------
// Conversation mutation helpers
// ---------------------------------------------------------------------------

/** Update conversation metadata and bump updatedAt. */
export async function patchConversation(
  convId: string,
  patch: {
    title?: string
    archived?: boolean
    participants?: Conversation['participants']
    participantUids?: string[]
    workspaceContext?: Conversation['workspaceContext']
    goalState?: Conversation['goalState']
  },
): Promise<void> {
  const updates: Record<string, unknown> = { updatedAt: FieldValue.serverTimestamp() }
  if (patch.title !== undefined) updates.title = patch.title.trim()
  if (patch.archived !== undefined) updates.archived = patch.archived
  if (patch.participants !== undefined) updates.participants = patch.participants
  if (patch.participantUids !== undefined) updates.participantUids = patch.participantUids
  if (patch.workspaceContext !== undefined) updates.workspaceContext = patch.workspaceContext
  if (patch.goalState !== undefined) {
    updates.goalState = patch.goalState === null ? FieldValue.delete() : patch.goalState
  }
  const ref = convDoc(convId)
  if (!realtimeOutboxEnabled()) {
    await ref.update(updates)
    return
  }
  await adminDb.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref)
    if (!snapshot.exists) throw new Error('Conversation not found')
    appendConversationRealtimeOutboxEvent({
      transaction,
      conversationRef: ref,
      conversation: snapshot.data() as Conversation,
      conversationId: convId,
      kind: 'conversation.updated',
      writeConversation: (realtimeSequence) => transaction.update(ref, { ...updates, realtimeSequence }),
    })
  })
}

export class ConversationAccessConflictError extends Error {
  constructor(public readonly currentVersion: number) {
    super('Conversation access changed since it was loaded')
    this.name = 'ConversationAccessConflictError'
  }
}

/** Atomically update access fields and append a durable access-history record. */
export async function updateConversationAccess(input: {
  convId: string
  expectedOrgId: string
  expectedVersion: number
  /** Workspace visibility mode. Omitted for participant-only direct/group chats. */
  shareMode?: NonNullable<Conversation['workspaceContext']>['shareMode']
  participants: Conversation['participants']
  participantUids: string[]
  participantAgentIds: Conversation['participantAgentIds']
  actor: { uid: string; role: ApiUser['role'] }
}): Promise<number> {
  const ref = convDoc(input.convId)
  return adminDb.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref)
    if (!snapshot.exists) throw new Error('Conversation not found')
    const current = snapshot.data() as Conversation
    if (current.orgId !== input.expectedOrgId) throw new Error('Conversation organisation changed')
    const currentOwnerUid = current.workspaceContext?.ownerUserId ?? current.startedBy
    if (input.actor.role !== 'admin' && input.actor.uid !== currentOwnerUid) {
      throw new Error('Conversation access manager changed')
    }
    const currentVersion = Number.isInteger(current.accessVersion) ? Number(current.accessVersion) : 0
    if (currentVersion !== input.expectedVersion) {
      throw new ConversationAccessConflictError(currentVersion)
    }
    const nextVersion = currentVersion + 1
    const changedAt = FieldValue.serverTimestamp()
    const unreadCounts = Object.fromEntries(input.participantUids.map((uid) => [
      uid,
      Number.isFinite(current.unreadCounts?.[uid])
        ? Math.max(0, Math.floor(current.unreadCounts?.[uid] ?? 0))
        : 0,
    ]))
    const readStateByUser = retainConversationReadState(
      input.participantUids,
      current.readStateByUser,
    )
    const conversationUpdate: Record<string, unknown> = {
      participants: input.participants,
      participantUids: input.participantUids,
      participantAgentIds: input.participantAgentIds,
      unreadCounts,
      readStateByUser,
      accessVersion: nextVersion,
      accessUpdatedAt: changedAt,
      accessUpdatedBy: input.actor.uid,
      updatedAt: changedAt,
    }
    if (input.shareMode) conversationUpdate['workspaceContext.shareMode'] = input.shareMode
    transaction.set(ref.collection('access_history').doc(), {
      accessVersion: nextVersion,
      ...(input.shareMode ? { shareMode: input.shareMode } : { accessMode: 'participants' }),
      participantUids: input.participantUids,
      participantAgentIds: input.participantAgentIds,
      actorUid: input.actor.uid,
      actorRole: input.actor.role,
      createdAt: changedAt,
    })
    appendConversationRealtimeOutboxEvent({
      transaction,
      conversationRef: ref,
      conversation: current,
      conversationId: input.convId,
      kind: 'conversation.access_changed',
      accessVersion: nextVersion,
      recipientUserIds: Array.from(new Set([
        ...(current.participantUids ?? []),
        ...input.participantUids,
      ])),
      writeConversation: (realtimeSequence) => transaction.update(ref, {
        ...conversationUpdate,
        ...(realtimeSequence !== undefined ? { realtimeSequence } : {}),
      }),
    })
    return nextVersion
  })
}

function attachmentStoragePathsFromMessage(message: FirebaseFirestore.DocumentData): string[] {
  if (!Array.isArray(message.attachments)) return []
  return message.attachments
    .map((attachment) => {
      if (!attachment || typeof attachment !== 'object') return ''
      const storagePath = (attachment as { storagePath?: unknown }).storagePath
      return typeof storagePath === 'string' && storagePath.trim() ? storagePath.trim() : ''
    })
    .filter(Boolean)
}

async function deleteConversationStoragePaths(storagePaths: Iterable<string>): Promise<void> {
  const uniquePaths = Array.from(new Set(storagePaths)).filter(Boolean)
  if (uniquePaths.length === 0) return

  const bucket = getStorage(getAdminApp()).bucket()
  await Promise.all(
    uniquePaths.map((path) =>
      (bucket.file(path) as { delete: (options?: { ignoreNotFound?: boolean }) => Promise<unknown> })
        .delete({ ignoreNotFound: true }),
    ),
  )
}

async function deleteConversationAttachmentDocs(convId: string): Promise<void> {
  while (true) {
    const attachmentsSnap = await adminDb.collection('conversation_attachments')
      .where('conversationId', '==', convId)
      .limit(500)
      .get()
    if (attachmentsSnap.empty) break

    const storagePaths = attachmentsSnap.docs
      .map((doc) => {
        const storagePath = doc.data().storagePath
        return typeof storagePath === 'string' && storagePath.trim() ? storagePath.trim() : ''
      })
      .filter(Boolean)

    await deleteConversationStoragePaths(storagePaths)

    const batch = adminDb.batch()
    attachmentsSnap.docs.forEach((doc) => batch.delete(doc.ref))
    await batch.commit()
  }
}

/** Delete a conversation, its messages, attachment metadata, and attachment blobs. */
export async function deleteConversation(convId: string): Promise<void> {
  const ref = convDoc(convId)
  if (realtimeOutboxEnabled()) {
    await adminDb.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(ref)
      if (!snapshot.exists) return
      const conversation = snapshot.data() as Conversation
      appendConversationRealtimeOutboxEvent({
        transaction,
        conversationRef: ref,
        conversation,
        conversationId: convId,
        kind: 'conversation.deleted',
        writeConversation: (realtimeSequence) => transaction.update(ref, {
          realtimeDeletedAt: FieldValue.serverTimestamp(),
          realtimeSequence,
        }),
      })
    })
  }
  await deleteConversationAttachmentDocs(convId)

  while (true) {
    const messagesSnap = await messagesCollection(convId).limit(500).get()
    if (messagesSnap.empty) break
    const messageAttachmentPaths = messagesSnap.docs.flatMap((doc) =>
      attachmentStoragePathsFromMessage(doc.data()),
    )
    await deleteConversationStoragePaths(messageAttachmentPaths)

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
  messageId?: string,
  authorUserId?: string,
): Promise<void> {
  const ref = convDoc(convId)
  await adminDb.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref)
    if (!snapshot.exists) throw new Error('Conversation not found')
    const conversation = snapshot.data() as Conversation
    const unreadCounts = advanceConversationUnreadCounts({
      participantUids: conversation.participantUids ?? [],
      current: conversation.unreadCounts,
      authorUserId,
    })
    const update: Record<string, unknown> = {
      lastMessagePreview: preview.slice(0, 200),
      lastMessageRole: role,
      lastMessageAt: FieldValue.serverTimestamp(),
      messageCount: Math.max(0, Math.floor(conversation.messageCount ?? 0)) + 1,
      unreadCounts,
      updatedAt: FieldValue.serverTimestamp(),
    }
    if (messageId) update.lastMessageId = messageId
    appendConversationRealtimeOutboxEvent({
      transaction,
      conversationRef: ref,
      conversation,
      conversationId: convId,
      kind: 'conversation.updated',
      ...(messageId ? { subject: { messageId } } : {}),
      writeConversation: (realtimeSequence) => transaction.update(ref, {
        ...update,
        ...(realtimeSequence !== undefined ? { realtimeSequence } : {}),
      }),
    })
  })
}

export class ConversationReadConflictError extends Error {
  constructor(public readonly currentLastMessageId: string | null) {
    super('Conversation changed before it could be marked read')
    this.name = 'ConversationReadConflictError'
  }
}

/** Mark exactly the latest message seen by one human participant as read. */
export async function markConversationRead(input: {
  convId: string
  userId: string
  lastMessageId: string | null
}): Promise<void> {
  const ref = convDoc(input.convId)
  await adminDb.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref)
    if (!snapshot.exists) throw new Error('Conversation not found')
    const conversation = snapshot.data() as Conversation
    const currentLastMessageId = conversation.lastMessageId?.trim() || null
    if (currentLastMessageId !== input.lastMessageId) {
      throw new ConversationReadConflictError(currentLastMessageId)
    }
    if (!(conversation.participantUids ?? []).includes(input.userId)
      && conversation.workspaceContext?.shareMode !== 'org') {
      throw new Error('User is not a conversation participant')
    }
    const readStateUpdate = {
      unreadCounts: {
        ...(conversation.unreadCounts ?? {}),
        [input.userId]: 0,
      },
      readStateByUser: {
        ...(conversation.readStateByUser ?? {}),
        [input.userId]: {
          ...(currentLastMessageId ? { lastReadMessageId: currentLastMessageId } : {}),
          lastReadMessageCount: Math.max(0, Math.floor(conversation.messageCount ?? 0)),
          lastReadAt: FieldValue.serverTimestamp(),
        },
      },
    }
    appendConversationRealtimeOutboxEvent({
      transaction,
      conversationRef: ref,
      conversation,
      conversationId: input.convId,
      kind: 'conversation.read_changed',
      recipientUserIds: [input.userId],
      writeConversation: (realtimeSequence) => transaction.update(ref, {
        ...readStateUpdate,
        ...(realtimeSequence !== undefined ? { realtimeSequence } : {}),
      }),
    })
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
  profile?: {
    department?: string | null
    jobTitle?: string | null
  },
): AgentId[] {
  const defaults: Record<'admin' | 'client', AgentId[]> = {
    admin: [...AGENT_IDS],
    client: ['pip'],
  }
  if (role === 'admin') return config?.visibleAgents?.admin ?? defaults.admin
  return config?.visibleAgents?.client ?? resolveWorkforceBlueprint({
    department: profile?.department?.trim() || null,
    jobTitle: profile?.jobTitle?.trim() || null,
  }).blueprint.recommendedAgentIds
}
