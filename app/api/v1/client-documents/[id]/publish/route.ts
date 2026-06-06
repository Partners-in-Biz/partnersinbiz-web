import { NextRequest } from 'next/server'

import { withAuth } from '@/lib/api/auth'
import { resolveOrgScope } from '@/lib/api/orgScope'
import { apiError, apiSuccess } from '@/lib/api/response'
import type { ApiUser } from '@/lib/api/types'
import { sendDocumentPublishedEmail } from '@/lib/client-documents/notifications'
import { getClientDocument, publishClientDocument } from '@/lib/client-documents/store'
import { adminDb } from '@/lib/firebase/admin'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ id: string }> }

export const POST = withAuth('admin', async (req: NextRequest, user: ApiUser, ctx: RouteContext) => {
  const { id } = await ctx.params
  const document = await getClientDocument(id)

  if (!document) {
    return apiError('Document not found', 404)
  }

  if (!document.orgId) {
    if (user.role === 'client') {
      return apiError('Forbidden', 403)
    }
  } else {
    const scope = resolveOrgScope(user, document.orgId)
    if (!scope.ok) return apiError(scope.error, scope.status)
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
            await sendDocumentPublishedEmail(document, email.trim(), name)
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
