import { NextRequest } from 'next/server'

import { withPortalAuthAndRole } from '@/lib/auth/portal-middleware'
import { apiSuccess } from '@/lib/api/response'
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

export const GET = withPortalAuthAndRole('viewer', async (_req: NextRequest, _uid, orgId) => {
  const docsSnap = await adminDb
    .collection(CLIENT_DOCUMENTS_COLLECTION)
    .where('orgId', '==', orgId)
    .get()

  const count = docsSnap.docs.filter((doc) => {
    const data = doc.data() as { deleted?: boolean; status?: ClientDocumentStatus }
    return data.deleted !== true && data.status !== undefined && CLIENT_VISIBLE_STATUSES.has(data.status)
  }).length

  return apiSuccess({ count })
})
