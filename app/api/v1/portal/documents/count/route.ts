import { NextRequest } from 'next/server'

import { withPortalAuthAndRole } from '@/lib/auth/portal-middleware'
import { apiSuccess } from '@/lib/api/response'
import { isClientVisibleClientDocument } from '@/lib/client-documents/access'
import { CLIENT_DOCUMENTS_COLLECTION } from '@/lib/client-documents/store'
import type { ClientDocument } from '@/lib/client-documents/types'
import { adminDb } from '@/lib/firebase/admin'
import { PIB_PLATFORM_ORG_ID } from '@/lib/platform/constants'

export const dynamic = 'force-dynamic'

export const GET = withPortalAuthAndRole('viewer', async (_req: NextRequest, _uid, orgId) => {
  async function listForOrg(targetOrgId: string): Promise<ClientDocument[]> {
    const docsSnap = await adminDb
      .collection(CLIENT_DOCUMENTS_COLLECTION)
      .where('orgId', '==', targetOrgId)
      .get()
    return docsSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() } as ClientDocument))
  }

  const documents = await listForOrg(orgId)
  if (orgId !== PIB_PLATFORM_ORG_ID) {
    const platformDocuments = await listForOrg(PIB_PLATFORM_ORG_ID)
    documents.push(...platformDocuments.filter((doc) => doc.linked?.clientOrgId === orgId))
  }

  const count = documents.filter((doc) => (
    doc.deleted !== true && isClientVisibleClientDocument(doc)
  )).length

  return apiSuccess({ count })
})
