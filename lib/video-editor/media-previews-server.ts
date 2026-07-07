import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import type { ApiUser } from '@/lib/api/types'
import { actorFields } from '@/lib/youtube-studio/api'
import {
  buildMediaPreviewManifest,
  dispatchMediaPreviewJob,
  videoEditorRuntimeConfigFromEnv,
} from './dispatch'
import { mediaKeyForRef } from './media-previews'
import { VIDEO_EDITOR_PREVIEW_COLLECTIONS } from './types'
import type { MediaRef, VideoEditorMediaPreview } from './types'

/**
 * Idempotently make sure a preview record exists (and a preview job is running)
 * for every media ref. Image refs are marked 'skipped' (nothing to generate).
 * Dispatch failures mark the record 'failed' — the editor still works, it just
 * shows originals without waveforms/filmstrips/proxies.
 */
export async function ensureMediaPreviews(
  orgId: string,
  refs: MediaRef[],
  user: ApiUser,
): Promise<Array<VideoEditorMediaPreview & { id: string }>> {
  const collection = adminDb.collection(VIDEO_EDITOR_PREVIEW_COLLECTIONS.mediaPreviews)
  const results: Array<VideoEditorMediaPreview & { id: string }> = []
  const seen = new Set<string>()

  for (const media of refs) {
    const mediaKey = mediaKeyForRef(media)
    if (seen.has(mediaKey)) continue
    seen.add(mediaKey)

    const existing = await collection
      .where('orgId', '==', orgId)
      .where('mediaKey', '==', mediaKey)
      .limit(1)
      .get()
    if (!existing.empty) {
      const doc = existing.docs[0]
      results.push({ id: doc.id, ...(doc.data() as VideoEditorMediaPreview) })
      continue
    }

    const record: VideoEditorMediaPreview = {
      orgId,
      mediaKey,
      sourceUrl: media.url,
      mediaKind: media.mediaKind,
      status: media.mediaKind === 'image' ? 'skipped' : 'pending',
      deleted: false,
    }
    const ref = await collection.add({
      ...record,
      ...actorFields(user),
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    })

    if (record.status === 'pending') {
      try {
        await dispatchMediaPreviewJob(
          buildMediaPreviewManifest({ previewId: ref.id, orgId, mediaKey, url: media.url, mediaKind: media.mediaKind }),
          videoEditorRuntimeConfigFromEnv(),
        )
      } catch (error) {
        record.status = 'failed'
        record.error = { code: 'dispatch_failed', message: error instanceof Error ? error.message : 'dispatch failed' }
        await ref.set({ status: 'failed', error: record.error, updatedAt: FieldValue.serverTimestamp() }, { merge: true })
      }
    }
    results.push({ id: ref.id, ...record })
  }
  return results
}
