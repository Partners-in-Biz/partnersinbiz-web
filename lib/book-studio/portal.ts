import { FieldValue } from 'firebase-admin/firestore'
import { apiError } from '@/lib/api/response'
import { adminDb } from '@/lib/firebase/admin'
import { isPortalModuleEnabled } from '@/lib/organizations/portal-modules'

export async function portalBookStudioGuard(orgId: string) {
  const orgSnap = await adminDb.collection('organizations').doc(orgId).get()
  if (!orgSnap.exists) return { error: apiError('Organisation not found', 404) }
  const settings = orgSnap.data()?.settings
  if (!isPortalModuleEnabled(settings, 'bookStudio')) {
    return {
      error: apiError('Book Studio module is disabled for this client portal', 403, {
        moduleDisabled: true,
        module: 'bookStudio',
      }),
    }
  }
  return { settings }
}

export function portalActorFields(uid: string) {
  return {
    createdBy: uid,
    createdByType: 'user',
    updatedBy: uid,
    updatedByType: 'user',
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  }
}
