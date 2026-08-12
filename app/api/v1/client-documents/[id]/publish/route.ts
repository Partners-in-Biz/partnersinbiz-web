import { NextRequest } from 'next/server'

import { withAuth } from '@/lib/api/auth'
import { resolveOrgScope } from '@/lib/api/orgScope'
import { apiError, apiSuccess } from '@/lib/api/response'
import type { ApiUser } from '@/lib/api/types'
import {
  assertClientDocumentDataAccess,
  canManageClientDocument,
} from '@/lib/client-documents/access'
import { sendDocumentPublishedEmail } from '@/lib/client-documents/notifications'
import {
  getClientDocument,
  publishClientDocument,
  CLIENT_DOCUMENTS_COLLECTION,
} from '@/lib/client-documents/store'
import { syncPublishedDocumentGrants } from '@/lib/client-documents/canonical-grants'
import { adminDb } from '@/lib/firebase/admin'
import { lastActorFrom } from '@/lib/api/actor'
import { FieldValue } from 'firebase-admin/firestore'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ id: string }> }

function userOrgIds(user: ApiUser): string[] {
  return user.orgIds?.length ? user.orgIds : (user.orgId ? [user.orgId] : [])
}

/**
 * Publish moves internal_draft/internal_review → client_review.
 * - Staff (admin/ai): any document they can scope to
 * - Client: only documents they created (full CRUD on own docs includes publish)
 */
export const POST = withAuth('client', async (req: NextRequest, user: ApiUser, ctx: RouteContext) => {
  const { id } = await ctx.params
  let document = await getClientDocument(id)

  if (!document) {
    return apiError('Document not found', 404)
  }

  const access = assertClientDocumentDataAccess(document, user)
  if (!access.ok) return access.response

  if (!canManageClientDocument(document, user)) {
    return apiError('Only the document creator can publish this document', 403)
  }

  if (!document.orgId) {
    if (user.role === 'client') {
      return apiError('Forbidden', 403)
    }
  } else if (user.role === 'admin' || user.role === 'ai') {
    const scope = resolveOrgScope(user, document.orgId)
    if (!scope.ok) return apiError(scope.error, scope.status)
  } else if (user.role === 'client') {
    // Creator clients may publish even when the holder org is platform,
    // as long as they own the document and can access it.
    const allowed = new Set(userOrgIds(user))
    const holderOk = allowed.has(document.orgId)
    const creatorOk = document.createdBy === user.uid
    if (!holderOk && !creatorOk) {
      return apiError('Forbidden', 403)
    }
  }

  // Ensure a real recipient client org before publish when the holder is platform.
  // Prefer company.linkedOrgId, then client creator home org. Store validates the rest.
  {
    const { sanitizeRecipientClientOrgIds } = await import('@/lib/client-documents/holder')
    const holderOrgId = (document.orgId || '').trim()
    const existingLinked = sanitizeRecipientClientOrgIds(holderOrgId, [
      ...(document.linked?.clientOrgId ? [document.linked.clientOrgId] : []),
      ...(document.linked?.clientOrgIds ?? []),
    ])

    if (existingLinked.length === 0) {
      let preferred: string | undefined
      const companyId = (document.linked?.companyId || document.linked?.companyIds?.[0] || '').trim()
      if (companyId) {
        const companySnap = await adminDb.collection('companies').doc(companyId).get()
        const linkedOrgId = companySnap.exists
          ? String((companySnap.data() as { linkedOrgId?: string }).linkedOrgId || '').trim()
          : ''
        if (linkedOrgId && linkedOrgId !== holderOrgId) preferred = linkedOrgId
      }
      if (!preferred && user.role === 'client') {
        preferred =
          (user.orgId && user.orgId.trim() && user.orgId.trim() !== holderOrgId ? user.orgId.trim() : undefined)
          || userOrgIds(user).find((orgId) => orgId && orgId !== holderOrgId)
      }
      if (preferred) {
        await adminDb.collection(CLIENT_DOCUMENTS_COLLECTION).doc(id).update({
          'linked.clientOrgId': preferred,
          'linked.clientOrgIds': FieldValue.arrayUnion(preferred),
          ...lastActorFrom(user),
        })
        document = await getClientDocument(id)
        if (!document) return apiError('Document not found', 404)
      }
    }
  }

  const body = await req.json().catch(() => ({}))
  const acknowledgeMultiOrgPublish = Boolean(
    body &&
    typeof body === 'object' &&
    !Array.isArray(body) &&
    (body as { acknowledgeMultiOrgPublish?: unknown }).acknowledgeMultiOrgPublish === true,
  )

  try {
    const result = await publishClientDocument(id, user, document.orgId ?? null, { acknowledgeMultiOrgPublish })
    const publishedDocument = await getClientDocument(id)
    if (!publishedDocument) return apiError('Document not found', 404)
    await syncPublishedDocumentGrants(publishedDocument, user)

    // Fire-and-forget: notify primary contact if org has one
    if (document.orgId) {
      void (async () => {
        try {
          const orgSnap = await adminDb.collection('organizations').doc(document.orgId!).get()
          const orgData = orgSnap.data()
          const email = orgData?.primaryContactEmail
          if (typeof email === 'string' && email.trim()) {
            const name = typeof orgData?.primaryContactName === 'string' && orgData.primaryContactName.trim()
              ? orgData.primaryContactName.trim()
              : 'there'
            await sendDocumentPublishedEmail(document!, email.trim(), name)
          }
        } catch (err) {
          console.error('[client-documents/publish] Email notification failed:', err)
        }
      })()
    }

    return apiSuccess(result)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unable to publish document'
    const status = message === 'Publishing to multiple client orgs requires explicit acknowledgement' ? 409 : 400
    return apiError(message, status)
  }
})
