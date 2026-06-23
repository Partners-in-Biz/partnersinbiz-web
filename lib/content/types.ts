// Shared types for the admin Content control plane (SEO articles, sitemap,
// content analytics, API docs). All collections are platform-scoped (operator
// owns them); writes carry actor fields per the platform convention.

export type SeoArticleStatus = 'draft' | 'scheduled' | 'published'

export type SeoBlockType = 'heading' | 'paragraph' | 'image' | 'quote' | 'list'

export interface SeoBlock {
  id: string
  type: SeoBlockType
  /** Text content for heading/paragraph/quote; caption for image. */
  text?: string
  /** Heading level (2 or 3) when type === 'heading'. */
  level?: 2 | 3
  /** Image source URL when type === 'image'. */
  src?: string
  /** Alt text when type === 'image'. */
  alt?: string
  /** List items when type === 'list'. */
  items?: string[]
  /** Ordered vs unordered when type === 'list'. */
  ordered?: boolean
}

export interface SeoArticle {
  id: string
  title: string
  slug: string
  status: SeoArticleStatus
  body: SeoBlock[]
  metaTitle: string
  metaDescription: string
  keyword: string
  views: number
  publishedAt: string | null
  scheduledFor: string | null
  createdAt: string | null
  updatedAt: string | null
  createdBy?: string
  createdByType?: string
  updatedBy?: string
  updatedByType?: string
}

export const SEO_BLOCK_TYPES: SeoBlockType[] = ['heading', 'paragraph', 'image', 'quote', 'list']

/** Generate a URL-safe slug from a title. */
export function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/['"]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'untitled'
}

/** Extract the plain text of a body (blocks) for readability / keyword checks. */
export function blocksToPlainText(blocks: SeoBlock[]): string {
  return blocks
    .map((b) => {
      if (b.type === 'list') return (b.items ?? []).join('. ')
      if (b.type === 'image') return b.alt ?? ''
      return b.text ?? ''
    })
    .filter(Boolean)
    .join('\n\n')
}
