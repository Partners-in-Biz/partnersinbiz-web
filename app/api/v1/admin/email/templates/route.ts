/**
 * Platform email templates — `admin_email_templates`.
 *
 * GET  /api/v1/admin/email/templates   — list templates (newest first).
 * POST /api/v1/admin/email/templates   — create a template.
 *   Body: { name, subject, content, contentType?: 'html'|'mjml',
 *           locale?, cloneFrom? }
 *
 * Versioning: each template starts at version 1. PATCH (in [id]/route.ts) bumps
 * the version and pushes the prior content onto versions[]. `cloneFrom` clones
 * an existing template's content into a new template (used for localisation —
 * pass a different `locale`).
 */
import { NextRequest } from 'next/server'
import { adminDb } from '@/lib/firebase/admin'
import { FieldValue } from 'firebase-admin/firestore'
import { withAuth } from '@/lib/api/auth'
import { apiSuccess, apiError } from '@/lib/api/response'
import { actorFrom } from '@/lib/api/actor'
import type { ApiUser } from '@/lib/api/types'

export const dynamic = 'force-dynamic'

export const COLLECTION = 'admin_email_templates'

export type TemplateContentType = 'html' | 'mjml'

function tsToIso(v: unknown): string | null {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const d = (v as any)?.toDate?.()
  if (d instanceof Date) return d.toISOString()
  if (typeof v === 'string') return v
  return null
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function serializeTemplate(d: any, includeContent = true) {
  const data = d.data() ?? {}
  const base = {
    id: d.id,
    name: data.name ?? '',
    subject: data.subject ?? '',
    contentType: (data.contentType === 'mjml' ? 'mjml' : 'html') as TemplateContentType,
    locale: data.locale ?? 'en',
    version: typeof data.version === 'number' ? data.version : 1,
    versionCount: Array.isArray(data.versions) ? data.versions.length : 0,
    createdBy: data.createdBy ?? '',
    createdByType: data.createdByType ?? '',
    updatedAt: tsToIso(data.updatedAt),
    createdAt: tsToIso(data.createdAt),
  }
  if (!includeContent) return base
  return {
    ...base,
    content: data.content ?? '',
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    versions: (Array.isArray(data.versions) ? data.versions : []).map((v: any) => ({
      version: v.version ?? 0,
      subject: v.subject ?? '',
      content: v.content ?? '',
      contentType: v.contentType ?? 'html',
      savedAt: tsToIso(v.savedAt) ?? (typeof v.savedAt === 'string' ? v.savedAt : null),
      savedBy: v.savedBy ?? '',
    })),
  }
}

export const GET = withAuth('admin', async () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let snap: any
  try {
    snap = await adminDb.collection(COLLECTION).orderBy('updatedAt', 'desc').get()
  } catch {
    snap = await adminDb.collection(COLLECTION).get()
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows = snap.docs.map((d: any) => serializeTemplate(d, false))
  return apiSuccess(rows)
})

export const POST = withAuth('admin', async (req: NextRequest, user: ApiUser) => {
  const body = await req.json().catch(() => ({}))
  const name = (typeof body.name === 'string' ? body.name : '').trim()
  if (!name) return apiError('name is required')

  const actor = actorFrom(user)
  const locale = (typeof body.locale === 'string' && body.locale.trim()) || 'en'

  // Clone path — copy content/subject/contentType from an existing template.
  let subject = (typeof body.subject === 'string' ? body.subject : '').trim()
  let content = typeof body.content === 'string' ? body.content : ''
  let contentType: TemplateContentType = body.contentType === 'mjml' ? 'mjml' : 'html'

  if (typeof body.cloneFrom === 'string' && body.cloneFrom.trim()) {
    const src = await adminDb.collection(COLLECTION).doc(body.cloneFrom.trim()).get()
    if (!src.exists) return apiError('cloneFrom template not found', 404)
    const sd = src.data() ?? {}
    subject = subject || (sd.subject ?? '')
    content = content || (sd.content ?? '')
    contentType = (sd.contentType === 'mjml' ? 'mjml' : 'html') as TemplateContentType
  }

  if (!subject) return apiError('subject is required')
  if (!content.trim()) return apiError('content is required')

  const ref = await adminDb.collection(COLLECTION).add({
    name,
    subject,
    content,
    contentType,
    locale,
    version: 1,
    versions: [],
    ...actor,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  })

  const fresh = await ref.get()
  return apiSuccess(serializeTemplate(fresh), 201)
})
