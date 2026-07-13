import { createHash, randomUUID } from 'node:crypto'

import { adminDb } from '@/lib/firebase/admin'
import { canAccessConversation } from '@/lib/conversations/access'
import type { ApiUser } from '@/lib/api/types'
import type { Conversation } from '@/lib/conversations/types'
import { buildIdempotencyKey, normalizeConversationOrigin } from './lineage'
import type { ConversationOrigin } from './types'

type MessageIdentity = { conversationId?: unknown; role?: unknown } | null

export class StudioArtifactOriginError extends Error {
  constructor(message: string, public readonly status = 400) { super(message) }
}

export async function validateStudioArtifactOrigin(input: {
  value: unknown
  orgId: string
  targetDomain: string
  conversation: Conversation | null
  user: ApiUser
  loadMessage: (id: string) => Promise<MessageIdentity>
}): Promise<ConversationOrigin> {
  const origin = normalizeConversationOrigin({ conversationOrigin: input.value })
  if (!origin) throw new StudioArtifactOriginError('Invalid conversationOrigin')
  const conversation = input.conversation
  if (!conversation || conversation.id !== origin.conversationId) throw new StudioArtifactOriginError('Conversation not found', 404)
  if (conversation.orgId !== input.orgId || !canAccessConversation(input.user, conversation)) {
    throw new StudioArtifactOriginError('Conversation unavailable', 404)
  }
  const attached = conversation.contextRefs?.some((ref) =>
    ref.orgId === input.orgId && (
      (ref.type === 'studio' && ref.id === input.targetDomain)
      || (ref.type === 'studio_artifact' && ref.id.startsWith(`${input.targetDomain}:`))
    ),
  ) || conversation.scopeRefId === input.targetDomain
  if (!attached) throw new StudioArtifactOriginError('Target Studio context is not attached to this conversation', 403)
  const [requestMessage, responseMessage] = await Promise.all([
    input.loadMessage(origin.requestMessageId), input.loadMessage(origin.responseMessageId),
  ])
  if (requestMessage?.conversationId !== origin.conversationId || responseMessage?.conversationId !== origin.conversationId) {
    throw new StudioArtifactOriginError('Origin message does not belong to this conversation')
  }
  if (requestMessage.role !== 'user' || responseMessage.role !== 'assistant') {
    throw new StudioArtifactOriginError('Origin message roles must be user then assistant')
  }
  return origin
}

const COLLECTION = 'studio_artifact_origins'
const CLAIM_LEASE_MS = 5 * 60 * 1000
function originDocId(targetDomain: string, orgId: string, origin: ConversationOrigin): string {
  return createHash('sha256').update(`${orgId.length}:${orgId}${buildIdempotencyKey(targetDomain, origin)}`).digest('hex')
}

export async function claimStudioArtifactOrigin(targetDomain: string, orgId: string, origin: ConversationOrigin): Promise<{ claimed: boolean; artifactId?: string; claimNonce?: string }> {
  const id = originDocId(targetDomain, orgId, origin)
  const ref = adminDb.collection(COLLECTION).doc(id)
  const reservedArtifactId = `chat-${id.slice(0, 32)}`
  return adminDb.runTransaction(async (transaction) => {
    const existing = await transaction.get(ref)
    const data = existing.data() ?? {}
    const artifactId = typeof data.artifactId === 'string' ? data.artifactId : undefined
    const existingNonce = typeof data.claimNonce === 'string' ? data.claimNonce : undefined
    if (artifactId && data.status === 'complete') return { claimed: false, artifactId, ...(existingNonce ? { claimNonce: existingNonce } : {}) }
    const expiresAt = data.expiresAt instanceof Date ? data.expiresAt : data.expiresAt?.toDate?.()
    if (existing.exists && expiresAt instanceof Date && expiresAt.getTime() > Date.now()) return { claimed: false, ...(artifactId ? { artifactId } : {}), ...(existingNonce ? { claimNonce: existingNonce } : {}) }
    const claimNonce = randomUUID()
    transaction.set(ref, { targetDomain, orgId, conversationOrigin: origin, artifactId: reservedArtifactId, claimNonce, status: 'claimed', createdAt: new Date(), expiresAt: new Date(Date.now() + CLAIM_LEASE_MS) })
    return { claimed: true, artifactId: reservedArtifactId, claimNonce }
  })
}

export async function completeStudioArtifactOrigin(targetDomain: string, orgId: string, origin: ConversationOrigin, artifactId: string, claimNonce?: string): Promise<void> {
  const ref = adminDb.collection(COLLECTION).doc(originDocId(targetDomain, orgId, origin))
  await adminDb.runTransaction(async (transaction) => {
    const snap = await transaction.get(ref)
    if (!snap.exists || (claimNonce && snap.data()?.claimNonce !== claimNonce)) throw new StudioArtifactOriginError('Artifact origin claim is stale', 409)
    transaction.set(ref, { status: 'complete', artifactId, completedAt: new Date(), expiresAt: null }, { merge: true })
  })
}

export async function releaseStudioArtifactOrigin(targetDomain: string, orgId: string, origin: ConversationOrigin, claimNonce?: string): Promise<void> {
  const ref = adminDb.collection(COLLECTION).doc(originDocId(targetDomain, orgId, origin))
  await adminDb.runTransaction(async (transaction) => {
    const snap = await transaction.get(ref)
    if (snap.exists && (!claimNonce || snap.data()?.claimNonce === claimNonce)) transaction.delete(ref)
  }).catch(() => undefined)
}
