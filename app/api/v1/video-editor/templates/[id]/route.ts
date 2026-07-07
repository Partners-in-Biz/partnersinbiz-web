import { NextRequest } from 'next/server'
import { adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { apiError, apiSuccess } from '@/lib/api/response'
import { ensureOrgAccess, updateActorFields } from '@/lib/youtube-studio/api'
import { collectTimelineMediaRefs, validateTimelineMediaRefs, VIDEO_EDITOR_COLLECTIONS } from '@/lib/video-editor/api'
import { PLATFORM_TEMPLATE_ORG, sanitizeVideoEditorTemplateInput } from '@/lib/video-editor/templates'
import type { ApiUser } from '@/lib/api/types'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ id: string }> }

async function loadTemplate(id: string) {
  const ref = adminDb.collection(VIDEO_EDITOR_COLLECTIONS.templates).doc(id)
  const snap = await ref.get()
  const data = snap.exists ? snap.data() as Record<string, unknown> : undefined
  if (!data || data.deleted === true) return null
  return { ref, data }
}

function platformMediaRefError(fragment: ReturnType<typeof sanitizeVideoEditorTemplateInput>['fragment']) {
  return collectTimelineMediaRefs(fragment).length ? apiError('Platform templates cannot reference tenant media', 400) : null
}

async function guard(req: NextRequest, user: ApiUser, id: string, write: boolean) {
  const orgId = new URL(req.url).searchParams.get('orgId')?.trim() ?? ''
  const denied = await ensureOrgAccess(user, orgId)
  if (denied) return { error: denied }
  const template = await loadTemplate(id)
  if (!template) return { error: apiError('Template not found', 404) }
  const templateOrg = String(template.data.orgId ?? '')
  if (templateOrg !== orgId && templateOrg !== PLATFORM_TEMPLATE_ORG) return { error: apiError('Template not found', 404) }
  if (write && templateOrg === PLATFORM_TEMPLATE_ORG && user.role !== 'admin') {
    return { error: apiError('Only platform admins can modify platform templates', 403) }
  }
  return { template, orgId }
}

export const GET = withAuth('client', async (req: NextRequest, user, context) => {
  const { id } = await (context as RouteContext).params
  const result = await guard(req, user, id, false)
  if (result.error) return result.error
  return apiSuccess({ template: { id, ...(JSON.parse(JSON.stringify(result.template.data)) as Record<string, unknown>) } })
})

export const PUT = withAuth('client', async (req: NextRequest, user, context) => {
  const { id } = await (context as RouteContext).params
  const result = await guard(req, user, id, true)
  if (result.error) return result.error
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  let data
  try {
    data = sanitizeVideoEditorTemplateInput({ ...body, orgId: result.template.data.orgId })
  } catch (error) {
    return apiError(error instanceof Error ? error.message : 'Invalid template', 400)
  }
  const templateOrg = String(result.template.data.orgId ?? '')
  if (templateOrg === PLATFORM_TEMPLATE_ORG) {
    const mediaError = platformMediaRefError(data.fragment)
    if (mediaError) return mediaError
  } else {
    const refIssues = await validateTimelineMediaRefs(data.fragment, templateOrg)
    if (refIssues.length) return apiError('Template fragment references invalid media', 400, { details: refIssues })
  }
  await result.template.ref.set({ ...data, ...updateActorFields(user) }, { merge: true })
  return apiSuccess({ id })
})

export const DELETE = withAuth('client', async (req: NextRequest, user, context) => {
  const { id } = await (context as RouteContext).params
  const result = await guard(req, user, id, true)
  if (result.error) return result.error
  await result.template.ref.set({ deleted: true, ...updateActorFields(user) }, { merge: true })
  return apiSuccess({ id })
})
