import { NextRequest } from 'next/server'
import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { apiError, apiSuccess } from '@/lib/api/response'
import { ensureOrgAccess, loadScopedRecord, updateActorFields } from '@/lib/youtube-studio/api'
import { sanitizeMediaPreviewReportInput } from '@/lib/video-editor/media-previews'
import { serializeVideoEditorRecord } from '@/lib/video-editor/sanitize'
import { VIDEO_EDITOR_PREVIEW_COLLECTIONS } from '@/lib/video-editor/types'
import type { VideoEditorMediaPreview } from '@/lib/video-editor/types'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ id: string }> }

export const GET = withAuth('client', async (_req: NextRequest, user, context) => {
  const { id } = await (context as RouteContext).params
  const loaded = await loadScopedRecord(VIDEO_EDITOR_PREVIEW_COLLECTIONS.mediaPreviews, id)
  if (!loaded || loaded.data.deleted === true) return apiError('Media preview not found', 404)
  const denied = await ensureOrgAccess(user, String(loaded.data.orgId ?? ''))
  if (denied) return denied
  return apiSuccess({ preview: serializeVideoEditorRecord<VideoEditorMediaPreview>(loaded.id, loaded.data) })
})

export const PUT = withAuth('client', async (req: NextRequest, user, context) => {
  const { id } = await (context as RouteContext).params
  const loaded = await loadScopedRecord(VIDEO_EDITOR_PREVIEW_COLLECTIONS.mediaPreviews, id)
  if (!loaded || loaded.data.deleted === true) return apiError('Media preview not found', 404)
  const orgId = String(loaded.data.orgId ?? '')
  const denied = await ensureOrgAccess(user, orgId)
  if (denied) return denied

  const body = await req.json().catch(() => ({}))
  const patch = sanitizeMediaPreviewReportInput(body)
  if (!patch.status && !patch.waveform && !patch.filmstrip && !patch.proxy) {
    return apiError('A valid status or artifact payload is required', 400)
  }

  await loaded.ref.set({
    ...(patch.status ? { status: patch.status } : {}),
    ...(patch.waveform ? { waveform: patch.waveform } : {}),
    ...(patch.filmstrip ? { filmstrip: patch.filmstrip } : {}),
    ...(patch.proxy ? { proxy: patch.proxy } : {}),
    ...(patch.error ? { error: patch.error } : {}),
    ...updateActorFields(user),
  }, { merge: true })

  if (patch.proxy) {
    await adminDb.collection(VIDEO_EDITOR_PREVIEW_COLLECTIONS.proxyLedger).doc(id).set({
      orgId,
      mediaKey: String(loaded.data.mediaKey ?? ''),
      previewId: id,
      storagePath: patch.proxy.storagePath,
      sizeBytes: patch.proxy.sizeBytes,
      lastAccessAt: FieldValue.serverTimestamp(),
      createdAt: FieldValue.serverTimestamp(),
    }, { merge: true })
  }
  return apiSuccess({ id, status: patch.status ?? String(loaded.data.status ?? '') })
})
