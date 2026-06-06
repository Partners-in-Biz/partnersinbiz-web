import { FieldValue } from 'firebase-admin/firestore'
import { NextRequest } from 'next/server'

import { withAuth } from '@/lib/api/auth'
import { apiError, apiSuccess } from '@/lib/api/response'
import type { ApiUser } from '@/lib/api/types'
import { getAccessibleClientDocument } from '@/lib/client-documents/access'
import { promoteCrmContextRefsToDocumentLinks } from '@/lib/client-documents/context-reference-links'
import { sendDocumentCommentEmail } from '@/lib/client-documents/notifications'
import { CLIENT_DOCUMENTS_COLLECTION } from '@/lib/client-documents/store'
import type { ClientDocument, DocumentComment } from '@/lib/client-documents/types'
import { resolveContextReferences } from '@/lib/context-references/registry'
import { sanitizeContextReferenceSeeds, type ContextReferenceSeed } from '@/lib/context-references/types'
import { adminDb } from '@/lib/firebase/admin'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ id: string }> }

function userRole(user: ApiUser) {
  return user.role === 'ai' ? 'agent' : user.role
}

function validateAnchor(value: unknown): { ok: true; value: unknown } | { ok: false; error: string } {
  if (value === undefined || value === null) return { ok: true, value: null }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { ok: false, error: 'anchor must be an object' }

  const anchor = value as Record<string, unknown>
  if (anchor.type === 'text') {
    if (typeof anchor.text !== 'string' || anchor.text.trim().length === 0) {
      return { ok: false, error: 'anchor.text must be a non-empty string' }
    }
    const offset = anchor.offset
    if (offset !== undefined && (typeof offset !== 'number' || !Number.isInteger(offset) || offset < 0)) {
      return { ok: false, error: 'anchor.offset must be a non-negative integer' }
    }
    return {
      ok: true,
      value: {
        type: 'text',
        text: anchor.text.trim(),
        ...(offset === undefined ? {} : { offset }),
      },
    }
  }

  if (anchor.type === 'image') {
    if (typeof anchor.mediaUrl !== 'string' || anchor.mediaUrl.trim().length === 0) {
      return { ok: false, error: 'anchor.mediaUrl must be a non-empty string' }
    }
    return { ok: true, value: { type: 'image', mediaUrl: anchor.mediaUrl.trim() } }
  }

  return { ok: false, error: 'anchor.type must be text or image' }
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

export const GET = withAuth('client', async (_req: NextRequest, user: ApiUser, ctx: RouteContext) => {
  const { id } = await ctx.params
  const access = await getAccessibleClientDocument(id, user)
  if (!access.ok) return access.response

  const snap = await adminDb.collection(CLIENT_DOCUMENTS_COLLECTION).doc(id).collection('comments').get()
  return apiSuccess(snap.docs.map((doc) => ({ id: doc.id, ...doc.data() })))
})

export const POST = withAuth('client', async (req: NextRequest, user: ApiUser, ctx: RouteContext) => {
  const { id } = await ctx.params
  const access = await getAccessibleClientDocument(id, user)
  if (!access.ok) return access.response

  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object' || Array.isArray(body)) return apiError('Invalid JSON', 400)

  const text = typeof body.text === 'string' ? body.text.trim() : ''
  if (!text) return apiError('text is required', 400)

  if (body.blockId !== undefined && typeof body.blockId !== 'string') {
    return apiError('blockId must be a string', 400)
  }
  if (body.versionId !== undefined && typeof body.versionId !== 'string') {
    return apiError('versionId must be a string', 400)
  }
  if (body.userName !== undefined && typeof body.userName !== 'string') {
    return apiError('userName must be a string', 400)
  }

  const anchor = validateAnchor(body.anchor)
  if (!anchor.ok) return apiError(anchor.error, 400)

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

  const ref = adminDb.collection(CLIENT_DOCUMENTS_COLLECTION).doc(id).collection('comments').doc()
  const userName = typeof body.userName === 'string' && body.userName.trim() ? body.userName.trim() : user.uid
  await ref.set({
    documentId: id,
    versionId: body.versionId ?? access.document.currentVersionId,
    blockId: typeof body.blockId === 'string' && body.blockId.trim() ? body.blockId.trim() : null,
    text,
    anchor: anchor.value,
    userId: user.uid,
    userName,
    userRole: userRole(user),
    status: 'open',
    agentPickedUp: false,
    ...(contextRefs.length > 0 ? { contextRefs } : {}),
    createdAt: FieldValue.serverTimestamp(),
  })

  // Fire-and-forget: notify PiB team inbox of new client comment
  void (async () => {
    try {
      const comment: DocumentComment = {
        id: ref.id,
        documentId: id,
        versionId: body.versionId ?? access.document.currentVersionId,
        blockId: typeof body.blockId === 'string' && body.blockId.trim() ? body.blockId.trim() : undefined,
        text,
        anchor: anchor.value as DocumentComment['anchor'],
        userId: user.uid,
        userName,
        userRole: userRole(user),
        status: 'open',
        agentPickedUp: false,
        ...(contextRefs.length > 0 ? { contextRefs } : {}),
      }
      await sendDocumentCommentEmail(access.document, comment, 'notifications@partnersinbiz.online', 'Partners in Biz Team')
    } catch (err) {
      console.error('[client-documents/comments] Email notification failed:', err)
    }
  })()

  return apiSuccess({ id: ref.id }, 201)
})
