import { FieldValue } from 'firebase-admin/firestore'
import { NextRequest } from 'next/server'

import { withAuth } from '@/lib/api/auth'
import { apiError, apiSuccess } from '@/lib/api/response'
import type { ApiUser } from '@/lib/api/types'
import { getAccessibleClientDocument } from '@/lib/client-documents/access'
import { CLIENT_DOCUMENTS_COLLECTION } from '@/lib/client-documents/store'
import { adminDb } from '@/lib/firebase/admin'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ id: string; commentId: string }> }

export const PATCH = withAuth('client', async (req: NextRequest, user: ApiUser, ctx: RouteContext) => {
  const { id, commentId } = await ctx.params
  const access = await getAccessibleClientDocument(id, user, 'comment')
  if (!access.ok) return access.response

  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object' || Array.isArray(body)) return apiError('Invalid JSON', 400)
  if (body.status !== 'open' && body.status !== 'resolved') return apiError('status must be open or resolved', 400)

  const ref = adminDb.collection(CLIENT_DOCUMENTS_COLLECTION).doc(id).collection('comments').doc(commentId)
  const snap = await ref.get()
  if (!snap.exists) return apiError('Comment not found', 404)

  await ref.update({
    status: body.status,
    resolvedAt: body.status === 'resolved' ? FieldValue.serverTimestamp() : null,
    resolvedBy: body.status === 'resolved' ? user.uid : null,
  })

  return apiSuccess({ id: commentId, status: body.status })
})
