/**
 * Single platform email template — `admin_email_templates/{id}`.
 *
 * GET    /api/v1/admin/email/templates/[id]  — full template incl. version history.
 * PATCH  /api/v1/admin/email/templates/[id]  — edit. Any change to subject/
 *          content/contentType bumps `version` and pushes the PRIOR content onto
 *          versions[]. `restoreVersion: <n>` restores a prior version's content
 *          (also a versioned change). `name`/`locale` edits don't bump version.
 * DELETE /api/v1/admin/email/templates/[id]  — delete the template.
 *
 * Next.js 15+: route params is a Promise — await it.
 */
import { NextRequest } from 'next/server'
import { adminDb } from '@/lib/firebase/admin'
import { FieldValue, Timestamp } from 'firebase-admin/firestore'
import { withAuth } from '@/lib/api/auth'
import { apiSuccess, apiError } from '@/lib/api/response'
import { lastActorFrom } from '@/lib/api/actor'
import type { ApiUser } from '@/lib/api/types'
import { COLLECTION, serializeTemplate, type TemplateContentType } from '../route'

export const dynamic = 'force-dynamic'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Ctx = { params: Promise<{ id: string }> }

async function getId(context: Ctx): Promise<string> {
  const { id } = await context.params
  return (id ?? '').trim()
}

export const GET = withAuth('admin', async (_req: NextRequest, _user: ApiUser, context: Ctx) => {
  const id = await getId(context)
  if (!id) return apiError('id is required')
  const snap = await adminDb.collection(COLLECTION).doc(id).get()
  if (!snap.exists) return apiError('Template not found', 404)
  return apiSuccess(serializeTemplate(snap))
})

export const PATCH = withAuth('admin', async (req: NextRequest, user: ApiUser, context: Ctx) => {
  const id = await getId(context)
  if (!id) return apiError('id is required')
  const ref = adminDb.collection(COLLECTION).doc(id)
  const snap = await ref.get()
  if (!snap.exists) return apiError('Template not found', 404)
  const current = snap.data() ?? {}

  const body = await req.json().catch(() => ({}))

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const patch: Record<string, any> = { ...lastActorFrom(user) }

  // Non-versioned metadata edits.
  if (typeof body.name === 'string' && body.name.trim()) patch.name = body.name.trim()
  if (typeof body.locale === 'string' && body.locale.trim()) patch.locale = body.locale.trim()

  // Resolve the next content (either an explicit edit or a version restore).
  let nextSubject: string | undefined
  let nextContent: string | undefined
  let nextType: TemplateContentType | undefined

  if (typeof body.restoreVersion === 'number') {
    const versions = Array.isArray(current.versions) ? current.versions : []
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const target = versions.find((v: any) => v.version === body.restoreVersion)
    if (!target) return apiError(`Version ${body.restoreVersion} not found`, 404)
    nextSubject = target.subject ?? current.subject ?? ''
    nextContent = target.content ?? current.content ?? ''
    nextType = (target.contentType === 'mjml' ? 'mjml' : 'html') as TemplateContentType
  } else {
    if (typeof body.subject === 'string' && body.subject.trim() !== (current.subject ?? '')) {
      nextSubject = body.subject.trim()
    }
    if (typeof body.content === 'string' && body.content !== (current.content ?? '')) {
      nextContent = body.content
    }
    if (
      (body.contentType === 'html' || body.contentType === 'mjml') &&
      body.contentType !== (current.contentType ?? 'html')
    ) {
      nextType = body.contentType
    }
  }

  const contentChanged =
    nextSubject !== undefined || nextContent !== undefined || nextType !== undefined

  if (contentChanged) {
    const priorVersion = typeof current.version === 'number' ? current.version : 1
    // Snapshot the CURRENT (pre-edit) content onto versions[] before mutating.
    const snapshot = {
      version: priorVersion,
      subject: current.subject ?? '',
      content: current.content ?? '',
      contentType: current.contentType ?? 'html',
      savedAt: Timestamp.now(),
      savedBy: user.uid,
    }
    patch.versions = FieldValue.arrayUnion(snapshot)
    patch.version = priorVersion + 1
    if (nextSubject !== undefined) patch.subject = nextSubject
    if (nextContent !== undefined) patch.content = nextContent
    if (nextType !== undefined) patch.contentType = nextType
  }

  await ref.update(patch)
  const fresh = await ref.get()
  return apiSuccess(serializeTemplate(fresh))
})

export const DELETE = withAuth('admin', async (_req: NextRequest, _user: ApiUser, context: Ctx) => {
  const id = await getId(context)
  if (!id) return apiError('id is required')
  const ref = adminDb.collection(COLLECTION).doc(id)
  const snap = await ref.get()
  if (!snap.exists) return apiError('Template not found', 404)
  await ref.delete()
  return apiSuccess({ id, deleted: true })
})
