import { NextRequest } from 'next/server'
import { adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { apiError, apiSuccess } from '@/lib/api/response'
import { ensureOrgAccess, loadScopedRecord } from '@/lib/youtube-studio/api'
import { VIDEO_EDITOR_COLLECTIONS } from '@/lib/video-editor/api'
import { serializeVideoEditorRecord } from '@/lib/video-editor/sanitize'
import type { VideoEditorRenderJob } from '@/lib/video-editor/types'

export const dynamic = 'force-dynamic'

function createdAtSeconds(job: VideoEditorRenderJob & { id: string }): number {
  const value = job.createdAt as { _seconds?: number } | undefined
  return typeof value?._seconds === 'number' ? value._seconds : 0
}

export const GET = withAuth('client', async (req: NextRequest, user) => {
  const url = new URL(req.url)
  const projectId = url.searchParams.get('projectId')?.trim() ?? ''
  if (!projectId) return apiError('projectId is required', 400)

  const project = await loadScopedRecord(VIDEO_EDITOR_COLLECTIONS.projects, projectId)
  if (!project || project.data.deleted === true) return apiError('Video editor project not found', 404)
  const denied = await ensureOrgAccess(user, String(project.data.orgId ?? ''))
  if (denied) return denied

  const snap = await adminDb.collection(VIDEO_EDITOR_COLLECTIONS.renderJobs)
    .where('projectId', '==', projectId)
    .get()
  const jobs = snap.docs
    .filter((doc) => doc.data()?.deleted !== true)
    .map((doc) => serializeVideoEditorRecord<VideoEditorRenderJob>(doc.id, doc.data() as Record<string, unknown>))
    .sort((a, b) => createdAtSeconds(b) - createdAtSeconds(a))

  return apiSuccess({ jobs })
})
