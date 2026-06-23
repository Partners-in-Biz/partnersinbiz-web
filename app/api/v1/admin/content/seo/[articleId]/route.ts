/**
 * GET    /api/v1/admin/content/seo/[articleId]  — fetch one article.
 * PATCH  /api/v1/admin/content/seo/[articleId]  — update (auto-save, publish, schedule).
 * DELETE /api/v1/admin/content/seo/[articleId]  — delete the article.
 */
import { adminDb } from '@/lib/firebase/admin'
import { FieldValue, Timestamp } from 'firebase-admin/firestore'
import { withAuth } from '@/lib/api/auth'
import { apiSuccess, apiError, apiErrorFromException } from '@/lib/api/response'
import { lastActorFrom } from '@/lib/api/actor'
import { slugify } from '@/lib/content/types'
import { serializeArticle, sanitizeBlocks } from '../serialize'

export const dynamic = 'force-dynamic'

const COLLECTION = 'admin_seo_articles'

function articleIdFrom(context: unknown): string | null {
  const params = (context as { params?: { articleId?: string } })?.params
  // Next 15: params may be a Promise in some contexts, but withAuth passes the
  // resolved route context object here. Support both shapes defensively.
  if (params && typeof params === 'object' && 'articleId' in params) {
    const id = (params as { articleId?: string }).articleId
    return typeof id === 'string' ? id : null
  }
  return null
}

async function resolveId(context: unknown): Promise<string | null> {
  const raw = (context as { params?: unknown })?.params
  if (raw && typeof (raw as Promise<unknown>).then === 'function') {
    const resolved = await (raw as Promise<{ articleId?: string }>)
    return typeof resolved?.articleId === 'string' ? resolved.articleId : null
  }
  return articleIdFrom(context)
}

export const GET = withAuth('admin', async (_req, _user, context) => {
  try {
    const id = await resolveId(context)
    if (!id) return apiError('Missing articleId', 400)
    const doc = await adminDb.collection(COLLECTION).doc(id).get()
    if (!doc.exists) return apiError('Article not found', 404)
    return apiSuccess(serializeArticle(doc.id, doc.data() ?? {}))
  } catch (err) {
    return apiErrorFromException(err)
  }
})

export const PATCH = withAuth('admin', async (req, user, context) => {
  try {
    const id = await resolveId(context)
    if (!id) return apiError('Missing articleId', 400)
    const ref = adminDb.collection(COLLECTION).doc(id)
    const existing = await ref.get()
    if (!existing.exists) return apiError('Article not found', 404)

    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
    if (!body) return apiError('Invalid JSON body', 400)

    const update: Record<string, unknown> = { ...lastActorFrom(user) }

    if (typeof body.title === 'string') update.title = body.title
    if (typeof body.metaTitle === 'string') update.metaTitle = body.metaTitle
    if (typeof body.metaDescription === 'string') update.metaDescription = body.metaDescription
    if (typeof body.keyword === 'string') update.keyword = body.keyword
    if (Array.isArray(body.body)) update.body = sanitizeBlocks(body.body)

    if (typeof body.slug === 'string' && body.slug.trim()) {
      const next = slugify(body.slug)
      const cur = existing.data()?.slug
      if (next !== cur) {
        const dup = await adminDb.collection(COLLECTION).where('slug', '==', next).limit(1).get()
        if (!dup.empty && dup.docs[0].id !== id) {
          return apiError(`Slug "${next}" is already in use`, 409)
        }
        update.slug = next
      }
    }

    // Status transitions: publish / schedule / unpublish (back to draft).
    if (body.status === 'published') {
      update.status = 'published'
      update.publishedAt = FieldValue.serverTimestamp()
      update.scheduledFor = null
    } else if (body.status === 'scheduled') {
      const when = typeof body.scheduledFor === 'string' ? Date.parse(body.scheduledFor) : NaN
      if (!Number.isFinite(when)) return apiError('scheduledFor must be a valid datetime', 400)
      update.status = 'scheduled'
      update.scheduledFor = Timestamp.fromMillis(when)
      update.publishedAt = null
    } else if (body.status === 'draft') {
      update.status = 'draft'
      update.publishedAt = null
      update.scheduledFor = null
    }

    await ref.update(update)
    const fresh = await ref.get()
    return apiSuccess(serializeArticle(fresh.id, fresh.data() ?? {}))
  } catch (err) {
    return apiErrorFromException(err)
  }
})

export const DELETE = withAuth('admin', async (_req, _user, context) => {
  try {
    const id = await resolveId(context)
    if (!id) return apiError('Missing articleId', 400)
    const ref = adminDb.collection(COLLECTION).doc(id)
    const existing = await ref.get()
    if (!existing.exists) return apiError('Article not found', 404)
    await ref.delete()
    return apiSuccess({ id, deleted: true })
  } catch (err) {
    return apiErrorFromException(err)
  }
})
