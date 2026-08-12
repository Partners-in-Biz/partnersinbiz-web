import { FieldValue } from 'firebase-admin/firestore'
import { NextRequest } from 'next/server'

import { withAuth } from '@/lib/api/auth'
import { apiError, apiSuccess } from '@/lib/api/response'
import type { ApiUser } from '@/lib/api/types'
import { getAccessibleClientDocument } from '@/lib/client-documents/access'
import { CLIENT_DOCUMENTS_COLLECTION } from '@/lib/client-documents/store'
import { adminDb } from '@/lib/firebase/admin'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ id: string; suggestionId: string }> }

export const POST = withAuth('admin', async (_req: NextRequest, user: ApiUser, ctx: RouteContext) => {
  const { id, suggestionId } = await ctx.params
  const access = await getAccessibleClientDocument(id, user, 'write')
  if (!access.ok) return access.response

  const ref = adminDb.collection(CLIENT_DOCUMENTS_COLLECTION).doc(id).collection('suggestions').doc(suggestionId)
  const snap = await ref.get()
  if (!snap.exists) return apiError('Suggestion not found', 404)

  await ref.update({
    status: 'rejected',
    resolvedBy: user.uid,
    resolvedAt: FieldValue.serverTimestamp(),
  })

  return apiSuccess({ id: suggestionId, status: 'rejected' })
})
