/**
 * GET  /api/v1/admin/content/seo  — list SEO articles (newest first).
 * POST /api/v1/admin/content/seo  — create a draft article.
 *
 * Backed by the platform-owned `admin_seo_articles` Firestore collection.
 */
import { adminDb } from '@/lib/firebase/admin'
import { FieldValue } from 'firebase-admin/firestore'
import { withAuth } from '@/lib/api/auth'
import { apiSuccess, apiError, apiErrorFromException } from '@/lib/api/response'
import { actorFrom } from '@/lib/api/actor'
import { slugify, type SeoArticle, type SeoBlock } from '@/lib/content/types'
import { serializeArticle } from './serialize'

export const dynamic = 'force-dynamic'

const COLLECTION = 'admin_seo_articles'

export const GET = withAuth('admin', async () => {
  try {
    const snap = await adminDb.collection(COLLECTION).get()
    const articles: SeoArticle[] = snap.docs
      .map((doc) => serializeArticle(doc.id, doc.data()))
      .sort((a, b) => {
        const at = a.updatedAt ?? a.createdAt ?? ''
        const bt = b.updatedAt ?? b.createdAt ?? ''
        return bt.localeCompare(at)
      })
    return apiSuccess(articles)
  } catch (err) {
    return apiErrorFromException(err)
  }
})

export const POST = withAuth('admin', async (req, user) => {
  try {
    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
    const title = typeof body?.title === 'string' && body.title.trim() ? body.title.trim() : 'Untitled article'

    // Ensure a unique slug.
    const baseSlug = typeof body?.slug === 'string' && body.slug.trim() ? slugify(body.slug) : slugify(title)
    const slug = await uniqueSlug(baseSlug)

    const firstBlock: SeoBlock = {
      id: `b_${Date.now().toString(36)}`,
      type: 'paragraph',
      text: '',
    }

    const actor = actorFrom(user)
    const doc = {
      title,
      slug,
      status: 'draft' as const,
      body: [firstBlock],
      metaTitle: title.slice(0, 60),
      metaDescription: '',
      keyword: '',
      views: 0,
      publishedAt: null,
      scheduledFor: null,
      ...actor,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    }

    const ref = await adminDb.collection(COLLECTION).add(doc)
    const created = await ref.get()
    return apiSuccess(serializeArticle(ref.id, created.data() ?? {}), 201)
  } catch (err) {
    return apiErrorFromException(err)
  }
})

async function uniqueSlug(base: string): Promise<string> {
  let candidate = base
  let n = 1
  // Bounded loop — won't run away.
  for (let i = 0; i < 25; i++) {
    const snap = await adminDb.collection(COLLECTION).where('slug', '==', candidate).limit(1).get()
    if (snap.empty) return candidate
    n += 1
    candidate = `${base}-${n}`
  }
  return `${base}-${Date.now().toString(36)}`
}
