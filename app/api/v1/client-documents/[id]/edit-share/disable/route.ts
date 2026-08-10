import { NextRequest } from 'next/server'
import { FieldValue } from 'firebase-admin/firestore'

import { withAuth } from '@/lib/api/auth'
import { resolveOrgScope } from '@/lib/api/orgScope'
import { apiError, apiSuccess } from '@/lib/api/response'
import type { ApiUser } from '@/lib/api/types'
import { revokeDocumentSignedArtifactAccess } from '@/lib/client-documents/artifact-revocation'
import { adminDb } from '@/lib/firebase/admin'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ id: string }> }

export const POST = withAuth('admin', async (req: NextRequest, user: ApiUser, ctx: RouteContext) => {
  const { id } = await ctx.params
  const docRef = adminDb.collection('client_documents').doc(id)
  const snap = await docRef.get()
  if (!snap.exists) return apiError('Document not found', 404)
  const doc = snap.data() as { orgId?: string; deleted?: boolean } | undefined
  if (!doc || doc.deleted) return apiError('Document not found', 404)

  if (doc.orgId) {
    const scope = resolveOrgScope(user, doc.orgId)
    if (!scope.ok) return apiError(scope.error, scope.status)
  }

  await docRef.update({
    editShareEnabled: false,
    updatedAt: FieldValue.serverTimestamp(),
    updatedBy: user.uid,
    updatedByType: user.role === 'ai' ? 'agent' : 'user',
  })

  // Disable is a grant-lifecycle event: rotate any durable signed-copy tokens and
  // clear cached download URLs so old public/edit context cannot keep resolving.
  await revokeDocumentSignedArtifactAccess(id).catch(() => undefined)

  return apiSuccess({ editShareEnabled: false })
})
