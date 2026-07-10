import { FieldValue } from 'firebase-admin/firestore'
import { NextRequest } from 'next/server'

import { withAuth } from '@/lib/api/auth'
import { apiSuccess } from '@/lib/api/response'
import type { ApiUser } from '@/lib/api/types'
import { getAccessibleClientDocument } from '@/lib/client-documents/access'
import { getRecentDocumentRows } from '@/lib/client-documents/indexed-query'
import { adminDb } from '@/lib/firebase/admin'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ id: string }> }

export const GET = withAuth('client', async (req: NextRequest, user: ApiUser, ctx: RouteContext) => {
  const { id } = await ctx.params
  const access = await getAccessibleClientDocument(id, user)
  if (!access.ok) return access.response

  const limitParam = req.nextUrl.searchParams.get('limit')
  const parsed = limitParam ? parseInt(limitParam, 10) : 20
  const limit = Math.max(1, Math.min(Number.isFinite(parsed) ? parsed : 20, 100))

  const events = await getRecentDocumentRows({
    collectionName: 'document_access_log',
    documentId: id,
    orderField: 'accessedAt',
    limit,
  })
  return apiSuccess({ events })
})

export const POST = withAuth('client', async (req: NextRequest, user: ApiUser, ctx: RouteContext) => {
  const { id } = await ctx.params
  const access = await getAccessibleClientDocument(id, user)
  if (!access.ok) return access.response

  const userAgent = req.headers.get('user-agent') ?? ''
  const orgId = access.document.orgId ?? ''

  const ref = adminDb.collection('document_access_log').doc()
  await ref.set({
    documentId: id,
    userId: user.uid,
    orgId,
    userAgent,
    accessedAt: FieldValue.serverTimestamp(),
  })

  return apiSuccess({ id: ref.id }, 201)
})
