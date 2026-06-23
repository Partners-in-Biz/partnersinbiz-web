import { randomUUID } from 'crypto'
import { FieldValue } from 'firebase-admin/firestore'
import { NextRequest } from 'next/server'

import { withAuth } from '@/lib/api/auth'
import { resolveOrgScope } from '@/lib/api/orgScope'
import { apiError, apiSuccess } from '@/lib/api/response'
import type { ApiUser } from '@/lib/api/types'
import { promoteCrmContextRefsToDocumentLinks } from '@/lib/client-documents/context-reference-links'
import { sendDocumentReplyEmail } from '@/lib/client-documents/notifications'
import { resolveCommentAuthorRecipient, resolveUserRecipient } from '@/lib/client-documents/recipients'
import { CLIENT_DOCUMENTS_COLLECTION, getClientDocument } from '@/lib/client-documents/store'
import type { ClientDocument, DocumentComment, DocumentCommentReply } from '@/lib/client-documents/types'
import { resolveContextReferences } from '@/lib/context-references/registry'
import { sanitizeContextReferenceSeeds, type ContextReferenceSeed } from '@/lib/context-references/types'
import { adminDb } from '@/lib/firebase/admin'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ id: string; commentId: string }> }

function userRole(user: ApiUser) {
  return user.role === 'ai' ? 'agent' : user.role
}

type DocumentAccessResult =
  | { ok: true; document: ClientDocument & { id: string } }
  | { ok: false; response: Response }

type DocumentDataAccessResult = { ok: true } | { ok: false; response: Response }

function assertDocumentDataAccess(document: Partial<ClientDocument>, user: ApiUser): DocumentDataAccessResult {
  if (!document.orgId) {
    if (user.role === 'client') return { ok: false, response: apiError('Forbidden', 403) }
    return { ok: true }
  }

  const scope = resolveOrgScope(user, document.orgId)
  if (!scope.ok) return { ok: false, response: apiError(scope.error, scope.status) }

  return { ok: true }
}

async function assertDocumentAccess(id: string, user: ApiUser): Promise<DocumentAccessResult> {
  const document = await getClientDocument(id)
  if (!document) return { ok: false, response: apiError('Document not found', 404) }

  const access = assertDocumentDataAccess(document, user)
  if (access.ok === false) return access

  return { ok: true, document }
}

function documentContextSeed(id: string, document: ClientDocument): ContextReferenceSeed {
  return {
    type: 'document',
    id,
    ...(document.orgId ? { orgId: document.orgId } : {}),
    ...(document.title ? { label: document.title } : {}),
    origin: 'current_page',
  }
}

export const POST = withAuth('client', async (req: NextRequest, user: ApiUser, ctx: RouteContext) => {
  const { id, commentId } = await ctx.params
  const access = await assertDocumentAccess(id, user)
  if (access.ok === false) return access.response

  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object' || Array.isArray(body)) return apiError('Invalid JSON', 400)

  const text = typeof body.text === 'string' ? body.text.trim() : ''
  if (!text) return apiError('text is required', 400)
  if (body.userName !== undefined && typeof body.userName !== 'string') {
    return apiError('userName must be a string', 400)
  }

  const ref = adminDb.collection(CLIENT_DOCUMENTS_COLLECTION).doc(id).collection('comments').doc(commentId)
  const snap = await ref.get()
  if (!snap.exists) return apiError('Comment not found', 404)

  const contextRefs = await resolveContextReferences(
    [
      documentContextSeed(id, access.document),
      ...sanitizeContextReferenceSeeds((body as Record<string, unknown>).contextRefs),
    ],
    user,
    access.document.orgId,
  )

  if ((body as Record<string, unknown>).alsoLinkToDocument === true) {
    await promoteCrmContextRefsToDocumentLinks(id, contextRefs)
  }

  const userName = typeof body.userName === 'string' && body.userName.trim() ? body.userName.trim() : user.uid
  // Note: array elements cannot contain serverTimestamp sentinels — use Date.
  const reply: DocumentCommentReply = {
    id: randomUUID(),
    text,
    userId: user.uid,
    userName,
    userRole: userRole(user),
    createdAt: new Date(),
    ...(contextRefs.length > 0 ? { contextRefs } : {}),
  }

  await ref.update({ replies: FieldValue.arrayUnion(reply) })

  // Fire-and-forget: notify the parent comment author at their real email (US-173).
  // Skip when the replier is the same person as the parent author.
  void (async () => {
    try {
      const parent = { id: commentId, ...snap.data() } as DocumentComment
      const recipient = await resolveCommentAuthorRecipient(access.document, parent)
      const replier = await resolveUserRecipient(user.uid)
      if (replier && replier.email === recipient.email) return
      await sendDocumentReplyEmail(access.document, parent, reply, recipient.email, recipient.name)
    } catch (err) {
      console.error('[client-documents/comments/replies] Email notification failed:', err)
    }
  })()

  return apiSuccess({ id: reply.id, comment: { id: commentId } }, 201)
})
