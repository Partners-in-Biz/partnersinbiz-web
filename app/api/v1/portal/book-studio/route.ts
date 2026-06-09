import { NextRequest } from 'next/server'

import { withPortalAuthAndRole } from '@/lib/auth/portal-middleware'
import { apiError, apiSuccess } from '@/lib/api/response'
import { adminDb } from '@/lib/firebase/admin'
import { isPortalModuleEnabled } from '@/lib/organizations/portal-modules'

export const dynamic = 'force-dynamic'

async function bookStudioModuleGuard(orgId: string) {
  const orgSnap = await adminDb.collection('organizations').doc(orgId).get()
  if (!orgSnap.exists) return apiError('Organisation not found', 404)
  const org = orgSnap.data() ?? {}
  if (!isPortalModuleEnabled(org.settings, 'bookStudio')) {
    return apiError('Book Studio module is disabled for this client portal', 403, {
      moduleDisabled: true,
      module: 'bookStudio',
    })
  }
  return null
}

export const GET = withPortalAuthAndRole('viewer', async (_req: NextRequest, _uid: string, orgId: string) => {
  const guard = await bookStudioModuleGuard(orgId)
  if (guard) return guard

  const snap = await adminDb.collection('book_studio_projects').where('orgId', '==', orgId).get()
  const projects = snap.docs.map((doc: { id: string; data: () => Record<string, unknown> }) => {
    const data = doc.data()
    return {
      id: doc.id,
      title: typeof data.title === 'string' ? data.title : 'Untitled book project',
      status: typeof data.status === 'string' ? data.status : 'draft',
    }
  })

  return apiSuccess({ portalModule: 'bookStudio', projects })
})
