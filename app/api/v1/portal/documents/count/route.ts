import { NextRequest } from 'next/server'

import { withAuth } from '@/lib/api/auth'
import { resolveOrgScope } from '@/lib/api/orgScope'
import { apiError, apiSuccess } from '@/lib/api/response'
import type { ApiUser } from '@/lib/api/types'
import { CLIENT_DOCUMENTS_COLLECTION } from '@/lib/client-documents/store'
import type { ClientDocumentStatus } from '@/lib/client-documents/types'
import { adminDb } from '@/lib/firebase/admin'

export const dynamic = 'force-dynamic'

const CLIENT_VISIBLE_STATUSES = new Set<ClientDocumentStatus>([
  'client_review',
  'changes_requested',
  'approved',
  'accepted',
])

export const GET = withAuth('client', async (req: NextRequest, user: ApiUser) => {
  const { searchParams } = new URL(req.url)
  const scope = resolveOrgScope(user, searchParams.get('orgId'))
  if (!scope.ok) return apiError(scope.error, scope.status)

  const docsSnap = await adminDb
    .collection(CLIENT_DOCUMENTS_COLLECTION)
    .where('orgId', '==', scope.orgId)
    .get()

  const count = docsSnap.docs.filter((doc) => {
    const data = doc.data() as { deleted?: boolean; status?: ClientDocumentStatus }
    return data.deleted !== true && data.status !== undefined && CLIENT_VISIBLE_STATUSES.has(data.status)
  }).length

  return apiSuccess({ count })
})
