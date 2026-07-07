import { NextRequest } from 'next/server'
import { adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { apiError, apiSuccess } from '@/lib/api/response'
import { actorFields, ensureOrgAccess } from '@/lib/youtube-studio/api'
import { collectTimelineMediaRefs, validateTimelineMediaRefs, VIDEO_EDITOR_COLLECTIONS } from '@/lib/video-editor/api'
import { PLATFORM_TEMPLATE_ORG, sanitizeVideoEditorTemplateInput } from '@/lib/video-editor/templates'

export const dynamic = 'force-dynamic'

function serialize(id: string, data: Record<string, unknown>): Record<string, unknown> & { id: string } {
  return { id, ...(JSON.parse(JSON.stringify(data)) as Record<string, unknown>) }
}

function platformMediaRefError(fragment: ReturnType<typeof sanitizeVideoEditorTemplateInput>['fragment']) {
  return collectTimelineMediaRefs(fragment).length ? apiError('Platform templates cannot reference tenant media', 400) : null
}

export const GET = withAuth('client', async (req: NextRequest, user) => {
  const url = new URL(req.url)
  const orgId = url.searchParams.get('orgId')?.trim() ?? ''
  const category = url.searchParams.get('category')?.trim() ?? ''
  const denied = await ensureOrgAccess(user, orgId)
  if (denied) return denied

  const collection = adminDb.collection(VIDEO_EDITOR_COLLECTIONS.templates)
  const [orgSnap, platformSnap] = await Promise.all([
    collection.where('orgId', '==', orgId).get(),
    collection.where('orgId', '==', PLATFORM_TEMPLATE_ORG).get(),
  ])
  const templates = [...orgSnap.docs, ...platformSnap.docs]
    .map((doc) => serialize(doc.id, doc.data() as Record<string, unknown>))
    .filter((template) => template.deleted !== true)
    .filter((template) => !category || template.category === category)
    .sort((a, b) => String(a.title ?? '').localeCompare(String(b.title ?? '')))

  return apiSuccess({ templates })
})

export const POST = withAuth('client', async (req: NextRequest, user) => {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const orgId = typeof body.orgId === 'string' ? body.orgId.trim() : ''
  if (orgId === PLATFORM_TEMPLATE_ORG) {
    if (user.role !== 'admin') return apiError('Only platform admins can create platform templates', 403)
  } else {
    const denied = await ensureOrgAccess(user, orgId)
    if (denied) return denied
  }

  let data
  try {
    data = sanitizeVideoEditorTemplateInput({ ...body, orgId })
  } catch (error) {
    return apiError(error instanceof Error ? error.message : 'Invalid template', 400)
  }
  if (orgId === PLATFORM_TEMPLATE_ORG) {
    const mediaError = platformMediaRefError(data.fragment)
    if (mediaError) return mediaError
  } else {
    const refIssues = await validateTimelineMediaRefs(data.fragment, orgId)
    if (refIssues.length) return apiError('Template fragment references invalid media', 400, { details: refIssues })
  }

  const ref = await adminDb.collection(VIDEO_EDITOR_COLLECTIONS.templates).add({
    ...data,
    ...actorFields(user),
  })
  return apiSuccess({ id: ref.id }, 201)
})
