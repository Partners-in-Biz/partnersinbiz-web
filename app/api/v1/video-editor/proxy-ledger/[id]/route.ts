import { NextRequest } from 'next/server'
import { FieldValue } from 'firebase-admin/firestore'
import { getStorage } from 'firebase-admin/storage'
import { adminDb } from '@/lib/firebase/admin'
import { getAdminApp } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { apiError, apiSuccess } from '@/lib/api/response'
import { ensureOrgAccess, loadScopedRecord } from '@/lib/youtube-studio/api'
import { VIDEO_EDITOR_PREVIEW_COLLECTIONS } from '@/lib/video-editor/types'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ id: string }> }

export const DELETE = withAuth('client', async (_req: NextRequest, user, context) => {
  const { id } = await (context as RouteContext).params
  const loaded = await loadScopedRecord(VIDEO_EDITOR_PREVIEW_COLLECTIONS.proxyLedger, id)
  if (!loaded) return apiError('Proxy ledger entry not found', 404)
  const orgId = String(loaded.data.orgId ?? '')
  const denied = await ensureOrgAccess(user, orgId)
  if (denied) return denied

  const storagePath = String(loaded.data.storagePath ?? '')
  if (storagePath) {
    try {
      await getStorage(getAdminApp()).bucket().file(storagePath).delete({ ignoreNotFound: true })
    } catch (error) {
      console.error('[video-editor] proxy storage delete failed:', error)
    }
  }
  const previewId = String(loaded.data.previewId ?? id)
  await adminDb.collection(VIDEO_EDITOR_PREVIEW_COLLECTIONS.mediaPreviews).doc(previewId)
    .set({ proxy: FieldValue.delete(), updatedAt: FieldValue.serverTimestamp() }, { merge: true })
    .catch(() => {})
  await loaded.ref.delete()
  return apiSuccess({ id, evicted: true })
})
