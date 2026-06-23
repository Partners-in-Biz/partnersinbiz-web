/**
 * Firestore-backed blog post loader.
 *
 * The legacy hardcoded `POSTS` array in `posts.ts` covers a static set of
 * historical insights. New posts go through the SEO content engine and live
 * in Firestore as `seo_content` rows with hydrated bodies in `seo_drafts`.
 *
 * This module bridges the two: when a slug isn't in the static array, fall
 * back to Firestore where `status === 'live'` and `slug` matches.
 *
 * Design decisions:
 *  - Pure server-side (uses adminDb). Don't import this from client components.
 *  - Returns the canonical `Post` shape so existing renderers don't change.
 *  - Slug derivation: prefer the persisted `slug` field on seo_content; fall
 *    back to deriving from `targetUrl` path segment for backfill.
 */
import { adminDb } from '@/lib/firebase/admin'
import { blocksToPlainText, type SeoBlock } from './types'
import type { Post } from './posts'

type AnyObj = any

export function slugFromTargetUrl(targetUrl: string | undefined): string | null {
  if (!targetUrl) return null
  try {
    const u = new URL(targetUrl)
    const last = u.pathname.replace(/\/+$/, '').split('/').filter(Boolean).pop()
    return last ? decodeURIComponent(last) : null
  } catch {
    // not a URL — assume it's already a slug or path
    const last = targetUrl.replace(/\/+$/, '').split('/').filter(Boolean).pop()
    return last ?? null
  }
}

const VALID_CATEGORIES: ReadonlyArray<Post['category']> = [
  'Build Notes',
  'Case Studies',
  'Industry POV',
  'Tools',
]

function clampCategory(value: unknown): Post['category'] {
  if (typeof value === 'string') {
    const match = VALID_CATEGORIES.find(
      c => c.toLowerCase() === value.toLowerCase(),
    )
    if (match) return match
  }
  return 'Industry POV'
}

function ensureLeadingSlash(path: string | undefined | null): string {
  if (!path) return '/images/insight-pricing-za.jpg' // fallback cover
  return path.startsWith('http') || path.startsWith('/') ? path : `/${path}`
}

function readingTimeFromWordCount(wc?: number): string {
  if (!wc || wc <= 0) return '6 min'
  return `${Math.max(1, Math.round(wc / 220))} min`
}

interface SeoContentDoc {
  id: string
  data: AnyObj
}

async function fetchLiveSeoContent(slug: string): Promise<SeoContentDoc | null> {
  // First try persisted slug
  const bySlug = await adminDb
    .collection('seo_content')
    .where('slug', '==', slug)
    .where('status', '==', 'live')
    .limit(1)
    .get()
  if (!bySlug.empty) {
    const d = bySlug.docs[0]
    return { id: d.id, data: d.data() }
  }
  // Fallback: scan live content + match derived slug from targetUrl
  // (only for backfill — new publishes persist `slug` directly)
  const live = await adminDb
    .collection('seo_content')
    .where('status', '==', 'live')
    .limit(50)
    .get()
  for (const d of live.docs) {
    const data = d.data()
    if (data.slug === slug) return { id: d.id, data }
    const derived = slugFromTargetUrl(data.targetUrl)
    if (derived === slug) return { id: d.id, data }
  }
  return null
}

interface PublishedAdminSeoDoc {
  id: string
  data: AnyObj
}

function isoDateOnly(value: string | null | undefined): string {
  if (!value) return new Date().toISOString().slice(0, 10)
  return value.slice(0, 10)
}

function excerpt(text: string, limit = 200): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, limit)
}

function wordsToReadingTime(text: string): string {
  const wc = text.trim() ? text.trim().split(/\s+/).length : 0
  return readingTimeFromWordCount(wc)
}

function blockToMarkdown(block: SeoBlock): string {
  if (block.type === 'heading') {
    const hashes = block.level === 3 ? '###' : '##'
    return `${hashes} ${block.text ?? ''}`.trim()
  }
  if (block.type === 'paragraph' || block.type === 'quote') {
    return (block.text ?? '').trim()
  }
  if (block.type === 'image') {
    const alt = block.alt ?? block.text ?? 'Insight image'
    const src = block.src ?? ''
    return src ? `![${alt}](${src})` : alt
  }
  if (block.type === 'list') {
    return (block.items ?? []).map((item) => `- ${item}`).join('\n')
  }
  return ''
}

function adminBlocksToMarkdown(blocks: SeoBlock[]): string {
  return blocks
    .map((block) => blockToMarkdown(block))
    .filter(Boolean)
    .join('\n\n')
    .trim()
}

async function fetchPublishedAdminSeoContent(slug: string): Promise<PublishedAdminSeoDoc | null> {
  const snap = await adminDb
    .collection('admin_seo_articles')
    .where('slug', '==', slug)
    .where('status', '==', 'published')
    .limit(1)
    .get()
  if (snap.empty) return null
  const doc = snap.docs[0]
  return { id: doc.id, data: doc.data() }
}

function buildAdminArticlePost(id: string, raw: AnyObj): Post | null {
  const title = typeof raw.title === 'string' ? raw.title.trim() : ''
  const slug = typeof raw.slug === 'string' ? raw.slug.trim() : ''
  if (!title || !slug) return null

  const blocks = Array.isArray(raw.body) ? raw.body as SeoBlock[] : []
  const plainText = blocksToPlainText(blocks)
  const body = adminBlocksToMarkdown(blocks)
  if (!body) return null

  const updatedAt =
    typeof raw.updatedAt === 'string'
      ? raw.updatedAt
      : raw.updatedAt?.toDate?.()?.toISOString?.() ?? null
  const publishedAt =
    typeof raw.publishedAt === 'string'
      ? raw.publishedAt
      : raw.publishedAt?.toDate?.()?.toISOString?.() ?? null

  const tags = Array.isArray(raw.tags)
    ? (raw.tags.filter((tag: unknown): tag is string => typeof tag === 'string' && tag.trim().length > 0))
    : (typeof raw.keyword === 'string' && raw.keyword.trim() ? [raw.keyword.trim()] : [])

  return {
    slug,
    title,
    description:
      typeof raw.metaDescription === 'string' && raw.metaDescription.trim()
        ? raw.metaDescription.trim()
        : excerpt(plainText),
    category: clampCategory(raw.category),
    readingTime: wordsToReadingTime(plainText),
    datePublished: isoDateOnly(publishedAt ?? updatedAt),
    dateModified: updatedAt ? isoDateOnly(updatedAt) : undefined,
    cover: ensureLeadingSlash(raw.heroImageUrl as string | undefined),
    tags,
    body,
  }
}

function buildSeoContentPost(slug: string, data: AnyObj, draft: { body: string; wordCount?: number; meta?: string } | null): Post | null {
  if (!draft || !draft.body) return null

  const publishedAtIso =
    data.publishedAt && (data.publishedAt._seconds ?? data.publishedAt.seconds)
      ? new Date((data.publishedAt._seconds ?? data.publishedAt.seconds) * 1000).toISOString()
      : null
  const dateRaw = (data.publishDate as string | undefined)
    ?? isoDateOnly(publishedAtIso ?? undefined)

  return {
    slug,
    title: typeof data.title === 'string' ? data.title : 'Untitled',
    description: draft.meta || excerpt(draft.body),
    category: clampCategory(data.type ?? data.category),
    readingTime: readingTimeFromWordCount(draft.wordCount),
    datePublished: dateRaw,
    cover: ensureLeadingSlash(data.heroImageUrl as string | undefined),
    tags: Array.isArray(data.tags) ? (data.tags as string[]) : [],
    body: draft.body,
  }
}

async function hydrateBody(draftPostId: string | undefined): Promise<{ body: string; wordCount?: number; meta?: string } | null> {
  if (!draftPostId) return null
  const snap = await adminDb.collection('seo_drafts').doc(draftPostId).get()
  if (!snap.exists) return null
  const d = snap.data() as AnyObj
  return {
    body: typeof d.body === 'string' ? d.body : '',
    wordCount: typeof d.wordCount === 'number' ? d.wordCount : undefined,
    meta: typeof d.metaDescription === 'string' ? d.metaDescription : undefined,
  }
}

/**
 * Look up a `live` blog post in Firestore by slug, then hydrate its body
 * from `seo_drafts`. Returns the canonical `Post` shape ready for the
 * existing /insights/[slug] renderer. Returns null if no match.
 */
export async function getFirestorePostBySlug(slug: string): Promise<Post | null> {
  const doc = await fetchLiveSeoContent(slug)
  if (doc) {
    const { data } = doc
    const draft = await hydrateBody(data.draftPostId as string | undefined)
    const post = buildSeoContentPost(slug, data, draft)
    if (post) return post
  }

  const adminArticle = await fetchPublishedAdminSeoContent(slug)
  if (!adminArticle) return null
  return buildAdminArticlePost(adminArticle.id, adminArticle.data)
}

/**
 * List slugs of all currently-live `seo_content` rows. Used to extend
 * `generateStaticParams` so SSG covers Firestore-backed posts too.
 */
export async function listLiveSlugs(): Promise<string[]> {
  const snap = await adminDb
    .collection('seo_content')
    .where('status', '==', 'live')
    .limit(200)
    .get()
  const slugs = new Set<string>()
  for (const d of snap.docs) {
    const data = d.data() as AnyObj
    const persistedSlug = typeof data.slug === 'string' ? data.slug : null
    const derived = persistedSlug ?? slugFromTargetUrl(data.targetUrl as string | undefined)
    if (derived) slugs.add(derived)
  }
  const adminSnap = await adminDb
    .collection('admin_seo_articles')
    .where('status', '==', 'published')
    .limit(200)
    .get()
  for (const d of adminSnap.docs) {
    const slug = d.data()?.slug
    if (typeof slug === 'string' && slug.trim()) slugs.add(slug.trim())
  }
  return Array.from(slugs)
}

export async function listLiveInsightEntries(): Promise<Array<{ slug: string; lastModified: string | null }>> {
  const entries = new Map<string, { slug: string; lastModified: string | null }>()

  const seoSnap = await adminDb
    .collection('seo_content')
    .where('status', '==', 'live')
    .limit(200)
    .get()
  for (const doc of seoSnap.docs) {
    const data = doc.data() as AnyObj
    const slug = typeof data.slug === 'string' ? data.slug : slugFromTargetUrl(data.targetUrl as string | undefined)
    if (!slug) continue
    const lastModified =
      data.updatedAt?.toDate?.()?.toISOString?.()
      ?? (data.publishedAt && (data.publishedAt._seconds ?? data.publishedAt.seconds)
        ? new Date((data.publishedAt._seconds ?? data.publishedAt.seconds) * 1000).toISOString()
        : null)
    entries.set(slug, { slug, lastModified })
  }

  const adminSnap = await adminDb
    .collection('admin_seo_articles')
    .where('status', '==', 'published')
    .limit(200)
    .get()
  for (const doc of adminSnap.docs) {
    const data = doc.data() as AnyObj
    const slug = typeof data.slug === 'string' ? data.slug.trim() : ''
    if (!slug) continue
    const lastModified =
      typeof data.updatedAt === 'string'
        ? data.updatedAt
        : data.updatedAt?.toDate?.()?.toISOString?.()
          ?? (typeof data.publishedAt === 'string'
            ? data.publishedAt
            : data.publishedAt?.toDate?.()?.toISOString?.() ?? null)
    entries.set(slug, { slug, lastModified })
  }

  return Array.from(entries.values())
}

export async function listLivePosts(): Promise<Post[]> {
  const posts: Post[] = []
  const seoSnap = await adminDb
    .collection('seo_content')
    .where('status', '==', 'live')
    .limit(50)
    .get()

  for (const doc of seoSnap.docs) {
    const data = doc.data() as AnyObj
    const slug = typeof data.slug === 'string' ? data.slug : slugFromTargetUrl(data.targetUrl as string | undefined)
    if (!slug) continue
    const draft = await hydrateBody(data.draftPostId as string | undefined)
    const post = buildSeoContentPost(slug, data, draft)
    if (post) posts.push(post)
  }

  const adminSnap = await adminDb
    .collection('admin_seo_articles')
    .where('status', '==', 'published')
    .limit(50)
    .get()
  for (const doc of adminSnap.docs) {
    const post = buildAdminArticlePost(doc.id, doc.data() as AnyObj)
    if (post) posts.push(post)
  }

  posts.sort((a, b) => {
    const aMs = Date.parse(a.dateModified ?? a.datePublished)
    const bMs = Date.parse(b.dateModified ?? b.datePublished)
    return bMs - aMs
  })

  return posts
}
