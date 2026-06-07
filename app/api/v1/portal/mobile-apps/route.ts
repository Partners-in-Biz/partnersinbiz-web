import { NextRequest } from 'next/server'
import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import { apiError, apiSuccess } from '@/lib/api/response'
import { withPortalAuthAndRole } from '@/lib/auth/portal-middleware'
import { clientSafeMobileApp, serializeMobileApp } from '@/lib/mobile-apps/sanitize'
import { isPortalModuleEnabled } from '@/lib/organizations/portal-modules'

export const dynamic = 'force-dynamic'

async function mobileAppsModuleGuard(orgId: string) {
  const orgDoc = await adminDb.collection('organizations').doc(orgId).get()
  if (!orgDoc.exists) return apiError('Organisation not found', 404)
  if (!isPortalModuleEnabled(orgDoc.data()?.settings, 'mobileApps')) {
    return apiError('Mobile Apps module is disabled for this client portal', 403, {
      moduleDisabled: true,
      module: 'mobileApps',
    })
  }
  return null
}

export const GET = withPortalAuthAndRole('viewer', async (_req: NextRequest, _uid, orgId) => {
  const disabled = await mobileAppsModuleGuard(orgId)
  if (disabled) return disabled

  const snap = await adminDb
    .collection('mobile_apps')
    .where('orgId', '==', orgId)
    .get()

  const apps = snap.docs
    .map((doc) => clientSafeMobileApp(serializeMobileApp(doc.id, doc.data())))
    .filter((app) => app.visibility?.showInClientPortal !== false)
    .sort((a, b) => String(a.name ?? '').localeCompare(String(b.name ?? '')))

  return apiSuccess({ apps })
})

export const PUT = withPortalAuthAndRole('member', async (req: NextRequest, uid, orgId) => {
  const disabled = await mobileAppsModuleGuard(orgId)
  if (disabled) return disabled

  const body = await req.json().catch(() => ({}))
  const appId = typeof body.id === 'string' ? body.id.trim() : ''
  if (!appId) return apiError('id is required', 400)

  const ref = adminDb.collection('mobile_apps').doc(appId)
  const doc = await ref.get()
  if (!doc.exists) return apiError('Mobile app not found', 404)
  const app = serializeMobileApp(doc.id, doc.data()!)
  if (app.orgId !== orgId) return apiError('Forbidden', 403)

  const listing = app.listing ?? {}
  await ref.set({
    clientNotes: typeof body.clientNotes === 'string' ? body.clientNotes.trim() : app.clientNotes ?? '',
    listing: {
      ...listing,
      clientFeedback: typeof body.clientFeedback === 'string' ? body.clientFeedback.trim() : listing.clientFeedback ?? '',
    },
    updatedBy: uid,
    updatedByType: 'user',
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true })

  return apiSuccess({ id: appId, updated: true })
})
