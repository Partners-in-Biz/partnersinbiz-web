import { NextRequest } from 'next/server'
import { adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { apiError, apiSuccess } from '@/lib/api/response'
import { actorFields, ensureOrgAccess, listByOrg, loadScopedRecord } from '@/lib/youtube-studio/api'
import { YOUTUBE_COLLECTIONS } from '@/lib/youtube-studio/api'
import { CREATIVE_CANVAS_COLLECTION, VIDEO_EDITOR_COLLECTIONS, validateTimelineMediaRefs } from '@/lib/video-editor/api'
import { sanitizeVideoEditorProjectInput, serializeVideoEditorRecord, validateEditorTimeline } from '@/lib/video-editor/sanitize'
import type { VideoEditorProject } from '@/lib/video-editor/types'
import { authorizeMarketingStudioMutation } from '@/lib/chat-context/marketingMutationAccess'
import {
  clientVisibilityFieldsForWrite,
  recordVisibleForWorkScope,
  resolveWorkScopeFromRequest,
  resolveWorkScopeFromSearchParams,
  workScopeFieldsForWrite,
} from '@/lib/work-scope'

export const dynamic = 'force-dynamic'

function cleanString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function cleanObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

async function validateLinkage(orgId: string, data: Omit<VideoEditorProject, 'id'>) {
  if (data.channelWorkspaceId) {
    const channel = await loadScopedRecord(YOUTUBE_COLLECTIONS.channels, data.channelWorkspaceId)
    if (!channel || channel.data.deleted === true) return apiError('YouTube channel workspace not found', 404)
    if (channel.data.orgId !== orgId) return apiError('channelWorkspaceId does not belong to organisation', 400)
  }
  if (data.videoProjectId) {
    const video = await loadScopedRecord(YOUTUBE_COLLECTIONS.videos, data.videoProjectId)
    if (!video || video.data.deleted === true) return apiError('Video project not found', 404)
    if (video.data.orgId !== orgId) return apiError('videoProjectId does not belong to organisation', 400)
  }
  if (data.canvasId) {
    const canvas = await loadScopedRecord(CREATIVE_CANVAS_COLLECTION, data.canvasId)
    if (!canvas || canvas.data.deleted === true) return apiError('Canvas not found', 404)
    if (canvas.data.orgId !== orgId) return apiError('canvasId does not belong to organisation', 400)
  }
  return null
}

export const GET = withAuth('client', async (req: NextRequest, user) => {
  const url = new URL(req.url)
  const orgId = url.searchParams.get('orgId')?.trim() ?? ''
  const status = url.searchParams.get('status')?.trim() ?? ''
  const denied = await ensureOrgAccess(user, orgId)
  if (denied) return denied

  const workScope = resolveWorkScopeFromSearchParams(url.searchParams, user.uid)
  const docs = await listByOrg(VIDEO_EDITOR_COLLECTIONS.projects, orgId)
  const projects = docs
    .filter((doc) => recordVisibleForWorkScope(doc.data() as Record<string, unknown>, workScope))
    .map((doc) => serializeVideoEditorRecord<VideoEditorProject>(doc.id, doc.data()))
    .filter((project) => !status || project.status === status)
    .sort((a, b) => a.title.localeCompare(b.title))

  return apiSuccess({ projects })
})

export const POST = withAuth('client', async (req: NextRequest, user) => {
  const body = cleanObject(await req.json().catch(() => ({})))
  const orgId = cleanString(body.orgId) ?? ''
  const denied = await ensureOrgAccess(user, orgId)
  if (denied) return denied
  const policyAccess = await authorizeMarketingStudioMutation(user, orgId, 'create')
  if (!policyAccess.ok) return apiError(policyAccess.error, policyAccess.status)

  const data = sanitizeVideoEditorProjectInput({ ...body, orgId })
  if (!data.title) return apiError('title is required', 400)

  const linkageError = await validateLinkage(orgId, data)
  if (linkageError) return linkageError

  const issues = validateEditorTimeline(data.timeline)
  if (issues.length) return apiError('Timeline is invalid', 400, { details: issues })
  const refIssues = await validateTimelineMediaRefs(data.timeline, orgId)
  if (refIssues.length) return apiError('Timeline references invalid media', 400, { details: refIssues })

  const ref = await adminDb.collection(VIDEO_EDITOR_COLLECTIONS.projects).add({
    ...data,
    ...workScopeFieldsForWrite(resolveWorkScopeFromRequest({ searchParams: new URL(req.url).searchParams, body, uid: user.uid })),
    ...clientVisibilityFieldsForWrite(body.clientVisibility),
    status: 'draft',
    deleted: false,
    ...actorFields(user),
  })

  return apiSuccess({ id: ref.id }, 201)
})
