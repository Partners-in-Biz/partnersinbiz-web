import { NextRequest } from 'next/server'
import { adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { apiError, apiSuccess } from '@/lib/api/response'
import { actorFields, ensureOrgAccess, loadScopedRecord, stripUndefinedDeep } from '@/lib/youtube-studio/api'
import { UPLOADS_COLLECTION, VIDEO_EDITOR_COLLECTIONS } from '@/lib/video-editor/api'
import { reframeSettingsTo916, reframeTimelineTo916 } from '@/lib/video-editor/reframe'
import { serializeVideoEditorRecord } from '@/lib/video-editor/sanitize'
import type { FocusSample } from '@/lib/video-editor/reframe'
import type { EditorTimeline, VideoEditorProject } from '@/lib/video-editor/types'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ id: string }> }

function cleanFocusTrack(value: unknown): FocusSample[] {
  return (Array.isArray(value) ? value : [])
    .map((entry) => entry && typeof entry === 'object' ? entry as Record<string, unknown> : null)
    .filter((entry): entry is Record<string, unknown> => Boolean(entry))
    .map((entry) => ({
      atSeconds: typeof entry.atSeconds === 'number' && Number.isFinite(entry.atSeconds) ? Math.max(0, entry.atSeconds) : 0,
      x: typeof entry.x === 'number' && Number.isFinite(entry.x) ? Math.min(Math.max(entry.x, 0), 1) : 0.5,
    }))
    .slice(0, 500)
}

async function loadFocusTracks(timeline: EditorTimeline, orgId: string): Promise<Record<string, FocusSample[]>> {
  const uploadIds = new Set<string>()
  for (const track of timeline.tracks) {
    for (const clip of track.clips) {
      if (clip.media?.type === 'upload' && clip.media.mediaKind !== 'audio') uploadIds.add(clip.media.fileId)
    }
  }
  const focusByFileId: Record<string, FocusSample[]> = {}
  for (const uploadId of uploadIds) {
    const snap = await adminDb.collection(UPLOADS_COLLECTION).doc(uploadId).get()
    const data = snap.exists ? snap.data() as Record<string, unknown> : undefined
    if (!data || data.deleted === true || data.orgId !== orgId) continue
    const focus = cleanFocusTrack(data.focusTrack)
    if (focus.length) focusByFileId[uploadId] = focus
  }
  return focusByFileId
}

export const POST = withAuth('client', async (_req: NextRequest, user, context) => {
  const { id } = await (context as RouteContext).params
  const loaded = await loadScopedRecord(VIDEO_EDITOR_COLLECTIONS.projects, id)
  if (!loaded || loaded.data.deleted === true) return apiError('Video editor project not found', 404)
  const project = serializeVideoEditorRecord<VideoEditorProject>(loaded.id, loaded.data)
  const denied = await ensureOrgAccess(user, project.orgId)
  if (denied) return denied
  if (project.settings.aspect === '9:16' || (project.settings.width === 1080 && project.settings.height === 1920)) {
    return apiError('Project is already a 9:16 variant', 400)
  }

  const focusByFileId = await loadFocusTracks(project.timeline, project.orgId)
  const settings = reframeSettingsTo916(project.settings)
  const timeline = reframeTimelineTo916(project.timeline, project.settings, focusByFileId)
  const duplicate = {
    orgId: project.orgId,
    title: `${project.title} - 9:16`,
    status: 'draft',
    settings,
    timeline,
    channelWorkspaceId: project.channelWorkspaceId,
    videoProjectId: project.videoProjectId,
    canvasId: project.canvasId,
    sourceProjectId: project.id,
    deleted: false,
  }
  const ref = await adminDb.collection(VIDEO_EDITOR_COLLECTIONS.projects).add(stripUndefinedDeep({
    ...duplicate,
    ...actorFields(user),
  }))

  return apiSuccess({ id: ref.id, projectId: ref.id, settings }, 201)
})
