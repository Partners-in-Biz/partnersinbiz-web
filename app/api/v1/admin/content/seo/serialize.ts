import type { SeoArticle, SeoBlock, SeoArticleStatus } from '@/lib/content/types'

/** Coerce a Firestore timestamp (or string/Date) into an ISO string or null. */
export function tsToIso(value: unknown): string | null {
  if (!value) return null
  if (typeof value === 'string') {
    const ms = Date.parse(value)
    return Number.isFinite(ms) ? new Date(ms).toISOString() : null
  }
  if (value instanceof Date) return value.toISOString()
  const v = value as { toDate?: () => Date; seconds?: number; _seconds?: number }
  if (typeof v.toDate === 'function') {
    try { return v.toDate().toISOString() } catch { return null }
  }
  const s = v.seconds ?? v._seconds
  return typeof s === 'number' ? new Date(s * 1000).toISOString() : null
}

function normBlocks(input: unknown): SeoBlock[] {
  if (!Array.isArray(input)) return []
  return input.flatMap((raw, idx): SeoBlock[] => {
    if (!raw || typeof raw !== 'object') return []
    const b = raw as Record<string, unknown>
    const type = b.type
    if (type !== 'heading' && type !== 'paragraph' && type !== 'image' && type !== 'quote' && type !== 'list') {
      return []
    }
    const block: SeoBlock = {
      id: typeof b.id === 'string' && b.id ? b.id : `b_${idx}`,
      type,
    }
    if (typeof b.text === 'string') block.text = b.text
    if (type === 'heading') block.level = b.level === 3 ? 3 : 2
    if (type === 'image') {
      block.src = typeof b.src === 'string' ? b.src : ''
      block.alt = typeof b.alt === 'string' ? b.alt : ''
    }
    if (type === 'list') {
      block.items = Array.isArray(b.items) ? b.items.filter((x): x is string => typeof x === 'string') : []
      block.ordered = Boolean(b.ordered)
    }
    return [block]
  })
}

export function serializeArticle(id: string, data: FirebaseFirestore.DocumentData): SeoArticle {
  const status = data.status
  const validStatus: SeoArticleStatus =
    status === 'published' || status === 'scheduled' ? status : 'draft'
  return {
    id,
    title: typeof data.title === 'string' ? data.title : 'Untitled article',
    slug: typeof data.slug === 'string' ? data.slug : '',
    status: validStatus,
    body: normBlocks(data.body),
    metaTitle: typeof data.metaTitle === 'string' ? data.metaTitle : '',
    metaDescription: typeof data.metaDescription === 'string' ? data.metaDescription : '',
    keyword: typeof data.keyword === 'string' ? data.keyword : '',
    views: typeof data.views === 'number' ? data.views : 0,
    publishedAt: tsToIso(data.publishedAt),
    scheduledFor: tsToIso(data.scheduledFor),
    createdAt: tsToIso(data.createdAt),
    updatedAt: tsToIso(data.updatedAt),
    createdBy: typeof data.createdBy === 'string' ? data.createdBy : undefined,
    createdByType: typeof data.createdByType === 'string' ? data.createdByType : undefined,
    updatedBy: typeof data.updatedBy === 'string' ? data.updatedBy : undefined,
    updatedByType: typeof data.updatedByType === 'string' ? data.updatedByType : undefined,
  }
}

/** Validate + normalize a blocks payload coming in over PATCH. */
export function sanitizeBlocks(input: unknown): SeoBlock[] {
  return normBlocks(input)
}
