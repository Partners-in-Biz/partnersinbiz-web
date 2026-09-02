import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { apiError, apiSuccess } from '@/lib/api/response'
import {
  ensureOrgAccess,
  loadScopedRecord,
  mergePatchForSanitizer,
  stripUndefinedDeep,
  updateActorFields,
} from '@/lib/youtube-studio/api'
import { VIDEO_EDITOR_COLLECTIONS, validateTimelineMediaRefs } from '@/lib/video-editor/api'
import { sanitizeVideoEditorProjectInput, serializeVideoEditorRecord, validateEditorTimeline } from '@/lib/video-editor/sanitize'
import type { VideoEditorProject } from '@/lib/video-editor/types'
import { clientVisibilityFieldsForWrite } from '@/lib/work-scope'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ id: string }> }

function cleanObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

async function loadProject(id: string) {
  const loaded = await loadScopedRecord(VIDEO_EDITOR_COLLECTIONS.projects, id)
  if (!loaded || loaded.data.deleted === true) return null
  return loaded
}

export const GET = withAuth('client', async (_req: NextRequest, user, context) => {
  const { id } = await (context as RouteContext).params
  const loaded = await loadProject(id)
  if (!loaded) return apiError('Video editor project not found', 404)
  const denied = await ensureOrgAccess(user, String(loaded.data.orgId ?? ''))
  if (denied) return denied
  return apiSuccess({ project: serializeVideoEditorRecord<VideoEditorProject>(loaded.id, loaded.data) })
})

export const PUT = withAuth('client', async (req: NextRequest, user, context) => {
  const { id } = await (context as RouteContext).params
  const loaded = await loadProject(id)
  if (!loaded) return apiError('Video editor project not found', 404)
  const orgId = String(loaded.data.orgId ?? '')
  const denied = await ensureOrgAccess(user, orgId)
  if (denied) return denied

  const body = cleanObject(await req.json().catch(() => ({})))
  const merged = mergePatchForSanitizer(loaded.data, body, { orgId })
  if (body.timeline !== undefined) merged.timeline = body.timeline
  if (body.settings !== undefined) merged.settings = body.settings
  const data = sanitizeVideoEditorProjectInput(merged)
  if (!data.title) return apiError('title is required', 400)

  const issues = validateEditorTimeline(data.timeline)
  if (issues.length) return apiError('Timeline is invalid', 400, { details: issues })
  const refIssues = await validateTimelineMediaRefs(data.timeline, orgId)
  if (refIssues.length) return apiError('Timeline references invalid media', 400, { details: refIssues })

  await loaded.ref.set(stripUndefinedDeep({
    ...data,
    ...('clientVisibility' in body ? clientVisibilityFieldsForWrite(body.clientVisibility) : {}),
    deleted: loaded.data.deleted === true,
    ...updateActorFields(user),
  }), { merge: true })

  return apiSuccess({ id, updated: true })
})

export const DELETE = withAuth('client', async (_req: NextRequest, user, context) => {
  const { id } = await (context as RouteContext).params
  const loaded = await loadProject(id)
  if (!loaded) return apiError('Video editor project not found', 404)
  const denied = await ensureOrgAccess(user, String(loaded.data.orgId ?? ''))
  if (denied) return denied

  await loaded.ref.set({ deleted: true, ...updateActorFields(user) }, { merge: true })
  return apiSuccess({ id, deleted: true })
})
