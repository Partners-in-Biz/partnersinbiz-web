import { NextRequest } from 'next/server'

import { withAuth } from '@/lib/api/auth'
import { apiError, apiSuccess } from '@/lib/api/response'
import type { ApiUser } from '@/lib/api/types'
import { getAccessibleClientDocument } from '@/lib/client-documents/access'
import { deserializeBlocksFromFirestore } from '@/lib/client-documents/firestore-blocks'
import { CLIENT_DOCUMENTS_COLLECTION } from '@/lib/client-documents/store'
import { adminDb } from '@/lib/firebase/admin'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ id: string; versionId: string }> }

export const GET = withAuth('client', async (_req: NextRequest, user: ApiUser, ctx: RouteContext) => {
  const { id, versionId } = await ctx.params
  const access = await getAccessibleClientDocument(id, user, 'versions', { item: versionId })
  if (!access.ok) return access.response

  const snap = await adminDb.collection(CLIENT_DOCUMENTS_COLLECTION).doc(id).collection('versions').doc(versionId).get()
  if (!snap.exists) return apiError('Version not found', 404)

  const data = snap.data()!
  return apiSuccess({ id: snap.id, ...data, blocks: deserializeBlocksFromFirestore(data.blocks) })
})
