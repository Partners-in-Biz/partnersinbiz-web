import { adminDb } from '@/lib/firebase/admin'
import { YOUTUBE_COLLECTIONS } from '@/lib/youtube-studio/api'
import type { TimelineValidationIssue } from './sanitize'
import type { EditorTimeline, MediaRef } from './types'

export const VIDEO_EDITOR_COLLECTIONS = {
  projects: 'video_editor_projects',
  renderJobs: 'video_editor_render_jobs',
  transcripts: 'video_editor_transcripts',
  ttsJobs: 'video_editor_tts_jobs',
} as const

export const CREATIVE_CANVAS_COLLECTION = 'creative_canvases'
export const UPLOADS_COLLECTION = 'uploads'

export function collectTimelineMediaRefs(timeline: EditorTimeline): Array<{ trackId: string; clipId: string; media: MediaRef }> {
  const refs: Array<{ trackId: string; clipId: string; media: MediaRef }> = []
  for (const track of timeline.tracks ?? []) {
    for (const clip of track.clips ?? []) {
      if (clip.media) refs.push({ trackId: track.id, clipId: clip.id, media: clip.media })
    }
  }
  return refs
}

export async function validateTimelineMediaRefs(
  timeline: EditorTimeline,
  orgId: string,
): Promise<TimelineValidationIssue[]> {
  const issues: TimelineValidationIssue[] = []
  const refs = collectTimelineMediaRefs(timeline)
  const docCache = new Map<string, { exists: boolean; orgId?: string; deleted?: boolean }>()

  async function loadDoc(collection: string, id: string) {
    const key = `${collection}/${id}`
    const cached = docCache.get(key)
    if (cached) return cached
    const snap = await adminDb.collection(collection).doc(id).get()
    const data = snap.exists ? (snap.data() as Record<string, unknown>) : undefined
    const entry = {
      exists: snap.exists,
      orgId: typeof data?.orgId === 'string' ? data.orgId : undefined,
      deleted: data?.deleted === true,
    }
    docCache.set(key, entry)
    return entry
  }

  for (const { trackId, clipId, media } of refs) {
    if (media.type === 'upload') {
      const doc = await loadDoc(UPLOADS_COLLECTION, media.fileId)
      if (!doc.exists || doc.deleted) {
        issues.push({ trackId, clipId, message: `Upload '${media.fileId}' was not found.` })
      } else if (doc.orgId !== orgId) {
        issues.push({ trackId, clipId, message: `Upload '${media.fileId}' belongs to another organisation.` })
      }
    } else if (media.type === 'youtube_source_asset') {
      const doc = await loadDoc(YOUTUBE_COLLECTIONS.sourceAssets, media.sourceAssetId)
      if (!doc.exists || doc.deleted) {
        issues.push({ trackId, clipId, message: `Source asset '${media.sourceAssetId}' was not found.` })
      } else if (doc.orgId !== orgId) {
        issues.push({ trackId, clipId, message: `Source asset '${media.sourceAssetId}' belongs to another organisation.` })
      }
    } else if (media.type === 'canvas_output') {
      const doc = await loadDoc(CREATIVE_CANVAS_COLLECTION, media.canvasId)
      if (!doc.exists || doc.deleted) {
        issues.push({ trackId, clipId, message: `Canvas '${media.canvasId}' was not found.` })
      } else if (doc.orgId !== orgId) {
        issues.push({ trackId, clipId, message: `Canvas '${media.canvasId}' belongs to another organisation.` })
      }
    }
  }
  return issues
}
