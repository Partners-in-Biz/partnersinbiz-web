import { NextRequest } from 'next/server'
import { Timestamp } from 'firebase-admin/firestore'

import { withAuth } from '@/lib/api/auth'
import { apiError, apiSuccess } from '@/lib/api/response'
import type { ApiUser } from '@/lib/api/types'
import {
  canonicalResponseEvidence,
  chatActionReceiptId,
  chatContextModelVersion,
  findAuthoritativeChatContextAction,
  parseSubmittedChatContextAction,
  parseSubmittedChatContextReference,
  publicChatActionReceipt,
  validateCanonicalActionTarget,
} from '@/lib/chat-context/action-registry'
import { isChatContextKind, isOpaqueContextId } from '@/lib/chat-context/access'
import { chatContextRegistry } from '@/lib/chat-context/registry'
import type { ChatContextActionReceipt } from '@/lib/chat-context/types'
import {
  authorizeConversationProject,
  canReplyConversation,
} from '@/lib/conversations/access'
import { getConversation } from '@/lib/conversations/conversations'
import type { Conversation } from '@/lib/conversations/types'
import { sanitizeContextReferenceSeeds } from '@/lib/context-references/types'
import { adminDb } from '@/lib/firebase/admin'

export const dynamic = 'force-dynamic'

const RECEIPTS_COLLECTION = 'chat_action_receipts'
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9._:-]{12,200}$/
const RUNNING_STALE_MS = 2 * 60_000
type Params = { params: Promise<{ convId: string }> }

function safeError(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback
  return value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 240) || fallback
}

function responseError(body: unknown, status: number): string {
  if (body && typeof body === 'object') {
    const error = (body as Record<string, unknown>).error
    if (typeof error === 'string') return safeError(error, `Action failed (${status})`)
  }
  return `Action failed (${status})`
}

type AuthorizedConversation =
  | { response: Response; conversation?: never; projectAuthorization?: never }
  | {
      response?: never
      conversation: Conversation
      projectAuthorization: { ok: true; projectId: string | null }
    }

async function resolveAuthorizedConversation(user: ApiUser, convId: string): Promise<AuthorizedConversation> {
  if (!isOpaqueContextId(convId)) return { response: apiError('Invalid conversation id', 400) }
  const conversation = await getConversation(convId)
  if (!conversation) return { response: apiError('Conversation not found', 404) }
  if (!canReplyConversation(user, conversation)) return { response: apiError('Forbidden', 403) }
  const projectAuthorization = await authorizeConversationProject(user, conversation)
  if (!projectAuthorization.ok) {
    return { response: apiError(projectAuthorization.error, projectAuthorization.status) }
  }
  return { conversation, projectAuthorization }
}

export const GET = withAuth('client', async (req: NextRequest, user: ApiUser, context?: unknown) => {
  const { convId } = await (context as Params).params
  const authorized = await resolveAuthorizedConversation(user, convId)
  if (authorized.response) return authorized.response
  const receiptId = req.nextUrl.searchParams.get('receiptId')?.trim() ?? ''
  if (!/^[a-f0-9]{64}$/.test(receiptId)) return apiError('Invalid receipt id', 400)
  const snapshot = await adminDb.collection(RECEIPTS_COLLECTION).doc(receiptId).get()
  if (!snapshot.exists) return apiError('Action receipt not found', 404)
  const receipt = snapshot.data() ?? {}
  if (receipt.conversationId !== convId || receipt.orgId !== authorized.conversation.orgId) {
    return apiError('Action receipt not found', 404)
  }
  return apiSuccess({ receipt: publicChatActionReceipt({ id: snapshot.id, ...receipt }) })
})

export const POST = withAuth('client', async (req: NextRequest, user: ApiUser, context?: unknown) => {
  const { convId } = await (context as Params).params
  const authorized = await resolveAuthorizedConversation(user, convId)
  if (authorized.response) return authorized.response
  const { conversation } = authorized
  const idempotencyKey = req.headers.get('idempotency-key')?.trim() ?? ''
  if (!IDEMPOTENCY_KEY_PATTERN.test(idempotencyKey)) {
    return apiError('A valid Idempotency-Key header is required', 400)
  }

  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object' || Array.isArray(body)) return apiError('Invalid JSON body', 400)
  const raw = body as Record<string, unknown>
  const contextReference = parseSubmittedChatContextReference(raw.context)
  const submittedAction = parseSubmittedChatContextAction(raw.action)
  if (!contextReference || !isChatContextKind(contextReference.kind) || !isOpaqueContextId(contextReference.id)) {
    return apiError('Invalid context reference', 400)
  }
  if (contextReference.projectId && !isOpaqueContextId(contextReference.projectId)) {
    return apiError('Invalid project id', 400)
  }
  if (contextReference.projectId && contextReference.kind !== 'task') {
    return apiError('Project id is only valid for task context', 400)
  }
  if (!submittedAction) return apiError('Invalid context action', 400)

  const attachedReference = (conversation.contextRefs ?? [])
    .flatMap((reference) => sanitizeContextReferenceSeeds([reference]))
    .find((reference) => {
      if (reference.type !== contextReference.kind || reference.id !== contextReference.id) return false
      if (reference.orgId && reference.orgId !== conversation.orgId) return false
      if (contextReference.kind !== 'task') return true
      const attachedProjectId = typeof reference.metadata?.projectId === 'string'
        ? reference.metadata.projectId.trim()
        : ''
      return contextReference.projectId
        ? attachedProjectId === contextReference.projectId
        : !attachedProjectId
    })
  // Projects can also be bound as conversation.scope without a contextRef pin.
  const scopedProjectAttached = contextReference.kind === 'project'
    && conversation.scope === 'project'
    && conversation.scopeRefId === contextReference.id
  if (!attachedReference && !scopedProjectAttached) return apiError('Context unavailable', 404)

  const resolved = await chatContextRegistry.resolve({
    ...contextReference,
    conversationId: convId,
    ...(attachedReference ? { contextReference: attachedReference } : {}),
    user,
  })
  if (!resolved.ok) return apiError('Context unavailable', 404)
  if (resolved.model.context.orgId !== conversation.orgId) return apiError('Context unavailable', 404)
  const action = findAuthoritativeChatContextAction(resolved.model, submittedAction)
  if (!action) return apiError('Action is no longer available', 409)
  const canonicalTarget = validateCanonicalActionTarget(action)
  if (!canonicalTarget) return apiError('Action target is not allowed', 400)
  if ((action.destructive || action.requiresApproval) && raw.confirmed !== true) {
    return apiError('Action confirmation is required', 428)
  }

  const receiptId = chatActionReceiptId({
    orgId: conversation.orgId,
    uid: user.uid,
    conversationId: convId,
    idempotencyKey,
  })
  const receiptRef = adminDb.collection(RECEIPTS_COLLECTION).doc(receiptId)
  const now = new Date()
  const initialReceipt: ChatContextActionReceipt & {
    idempotencyKey: string
    expiresAt: Timestamp
  } = {
    id: receiptId,
    idempotencyKey,
    conversationId: convId,
    orgId: conversation.orgId,
    actor: {
      uid: user.uid,
      role: user.role,
      ...(user.agentId ? { agentId: user.agentId } : {}),
    },
    context: contextReference,
    action,
    status: 'running',
    beforeVersion: chatContextModelVersion(resolved.model),
    createdAt: now.toISOString(),
    expiresAt: Timestamp.fromMillis(now.getTime() + 90 * 24 * 60 * 60_000),
  }

  const claim = await adminDb.runTransaction(async (transaction) => {
    const existing = await transaction.get(receiptRef)
    if (existing.exists) return { created: false, value: { id: existing.id, ...(existing.data() ?? {}) } }
    transaction.create(receiptRef, initialReceipt)
    return { created: true, value: initialReceipt as unknown as Record<string, unknown> }
  })
  if (!claim.created) {
    const existing = claim.value as Record<string, unknown>
    if (existing.status === 'running') {
      const createdAt = typeof existing.createdAt === 'string' ? Date.parse(existing.createdAt) : Number.NaN
      if (Number.isFinite(createdAt) && Date.now() - createdAt > RUNNING_STALE_MS) {
        const completedAt = new Date().toISOString()
        await receiptRef.update({
          status: 'indeterminate',
          completedAt,
          error: 'Execution result is unknown. Check the live record before trying another action.',
        })
        return apiSuccess({
          receipt: publicChatActionReceipt({
            ...existing,
            status: 'indeterminate',
            completedAt,
            error: 'Execution result is unknown. Check the live record before trying another action.',
          }),
        }, 202)
      }
    }
    return apiSuccess({ receipt: publicChatActionReceipt(existing) }, existing.status === 'running' ? 202 : 200)
  }

  const dispatchUrl = new URL(`${canonicalTarget.pathname}${canonicalTarget.search}`, req.nextUrl.origin)
  const headers = new Headers({
    'x-org-id': conversation.orgId,
    'Idempotency-Key': `chat-action:${receiptId}`,
  })
  const authorization = req.headers.get('authorization')
  const cookie = req.headers.get('cookie')
  if (authorization) headers.set('authorization', authorization)
  if (cookie) headers.set('cookie', cookie)
  if (action.body !== undefined) headers.set('content-type', 'application/json')

  let canonicalResponse: Response
  try {
    canonicalResponse = await fetch(dispatchUrl, {
      method: action.method,
      headers,
      body: action.body === undefined ? undefined : JSON.stringify(action.body),
      cache: 'no-store',
    })
  } catch {
    const completedAt = new Date().toISOString()
    const error = 'Execution result is unknown. Check the live record before retrying.'
    await receiptRef.update({ status: 'indeterminate', completedAt, error })
    return apiSuccess({
      receipt: publicChatActionReceipt({ ...initialReceipt, status: 'indeterminate', completedAt, error }),
    }, 202)
  }

  const responseText = await canonicalResponse.text()
  let responseBody: unknown = null
  try { responseBody = responseText ? JSON.parse(responseText) : null } catch { responseBody = null }
  const evidence = canonicalResponseEvidence({
    responseText,
    responseBody,
    location: canonicalResponse.headers.get('location'),
  })
  const completedAt = new Date().toISOString()
  if (!canonicalResponse.ok) {
    const error = responseError(responseBody, canonicalResponse.status)
    const failedReceipt = {
      ...initialReceipt,
      ...evidence,
      status: 'failed' as const,
      canonicalStatus: canonicalResponse.status,
      completedAt,
      error,
    }
    await receiptRef.update(failedReceipt)
    return apiError(error, canonicalResponse.status, {
      receipt: publicChatActionReceipt(failedReceipt),
    })
  }

  const refreshed = await chatContextRegistry.resolve({
    ...contextReference,
    conversationId: convId,
    ...(attachedReference ? { contextReference: attachedReference } : {}),
    user,
  })
  const succeededReceipt = {
    ...initialReceipt,
    ...evidence,
    status: 'succeeded' as const,
    canonicalStatus: canonicalResponse.status,
    ...(refreshed.ok ? { afterVersion: chatContextModelVersion(refreshed.model) } : {}),
    completedAt,
  }
  await receiptRef.update(succeededReceipt)
  return apiSuccess({ receipt: publicChatActionReceipt(succeededReceipt) })
})
