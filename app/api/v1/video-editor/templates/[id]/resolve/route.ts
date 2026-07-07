import { NextRequest } from 'next/server'
import { adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { apiError, apiSuccess } from '@/lib/api/response'
import { ensureOrgAccess } from '@/lib/youtube-studio/api'
import { VIDEO_EDITOR_COLLECTIONS } from '@/lib/video-editor/api'
import { PLATFORM_TEMPLATE_ORG, resolveTemplateVariables } from '@/lib/video-editor/templates'
import { sanitizeEditorTimeline, validateEditorTimeline } from '@/lib/video-editor/sanitize'
import type { BrandProfile, OrgSettings } from '@/lib/organizations/types'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ id: string }> }

export const POST = withAuth('client', async (req: NextRequest, user, context) => {
  const { id } = await (context as RouteContext).params
  const orgId = new URL(req.url).searchParams.get('orgId')?.trim() ?? ''
  const denied = await ensureOrgAccess(user, orgId)
  if (denied) return denied
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>

  const snap = await adminDb.collection(VIDEO_EDITOR_COLLECTIONS.templates).doc(id).get()
  const template = snap.exists ? snap.data() as Record<string, unknown> : undefined
  if (!template || template.deleted === true) return apiError('Template not found', 404)
  const templateOrg = String(template.orgId ?? '')
  if (templateOrg !== orgId && templateOrg !== PLATFORM_TEMPLATE_ORG) return apiError('Template not found', 404)

  const orgSnap = await adminDb.collection('organizations').doc(orgId).get()
  const org = orgSnap.exists ? orgSnap.data() as Record<string, unknown> : {}
  const brand = (org?.brandProfile ?? {}) as BrandProfile
  const settings = (org?.settings ?? {}) as OrgSettings
  const orgName = typeof org?.name === 'string' ? org.name : ''

  let channelTitle: string | undefined
  const channelWorkspaceId = typeof body.channelWorkspaceId === 'string' ? body.channelWorkspaceId.trim() : ''
  if (channelWorkspaceId) {
    const channelSnap = await adminDb.collection('youtube_channel_workspaces').doc(channelWorkspaceId).get()
    const channel = channelSnap.exists ? channelSnap.data() as Record<string, unknown> : undefined
    if (!channel || channel.deleted === true || channel.orgId !== orgId) return apiError('Channel workspace not found', 404)
    if (typeof channel.title === 'string') channelTitle = channel.title
  }

  const sanitized = sanitizeEditorTimeline(template.fragment)
  const issues = validateEditorTimeline(sanitized)
  if (issues.length) return apiError('Stored template fragment is invalid', 500, { details: issues })
  const fragment = resolveTemplateVariables(
    sanitized,
    { brand, brandColors: settings.brandColors, channelTitle, orgName },
  )
  return apiSuccess({ fragment })
})
