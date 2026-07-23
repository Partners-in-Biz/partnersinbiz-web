import type { PreviewMedia, PreviewSocialPost } from '@/components/campaign-preview/types'

function cleanString(value: unknown, max = 4000): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : ''
}

function getPostText(content: unknown): string {
  if (typeof content === 'string') return content
  if (content && typeof content === 'object' && !Array.isArray(content)) {
    const text = (content as { text?: unknown }).text
    if (typeof text === 'string') return text
  }
  return ''
}

function dateLikeToIso(value: unknown): string | undefined {
  if (typeof value === 'string' && Number.isFinite(Date.parse(value))) return new Date(value).toISOString()
  if (value instanceof Date && Number.isFinite(value.getTime())) return value.toISOString()
  if (value && typeof value === 'object') {
    const raw = value as { toDate?: () => Date; seconds?: number; _seconds?: number }
    try {
      if (typeof raw.toDate === 'function') {
        const date = raw.toDate()
        if (date instanceof Date && Number.isFinite(date.getTime())) return date.toISOString()
      }
    } catch {
      // ignore invalid timestamp helpers
    }
    const seconds = typeof raw.seconds === 'number' ? raw.seconds : raw._seconds
    if (typeof seconds === 'number' && Number.isFinite(seconds)) {
      return new Date(seconds * 1000).toISOString()
    }
  }
  return undefined
}

export function primaryPlatformOf(raw: Record<string, unknown>): string {
  const platforms = Array.isArray(raw.platforms)
    ? raw.platforms.map((item) => cleanString(item, 40).toLowerCase()).filter(Boolean)
    : []
  const singular = cleanString(raw.platform, 40).toLowerCase()
  return singular || platforms[0] || 'linkedin'
}

function toPreviewMedia(value: unknown): PreviewMedia[] | undefined {
  if (!Array.isArray(value)) return undefined
  const media = value.flatMap((item): PreviewMedia[] => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return []
    const raw = item as Record<string, unknown>
    const type = cleanString(raw.type, 20).toLowerCase()
    const url = cleanString(raw.url, 2000) || cleanString(raw.originalUrl, 2000)
    if (!url) return []
    if (type === 'video') {
      return [{
        type: 'video',
        url,
        ...(cleanString(raw.thumbnailUrl, 2000) ? { thumbnailUrl: cleanString(raw.thumbnailUrl, 2000) } : {}),
        ...(typeof raw.durationSec === 'number' && Number.isFinite(raw.durationSec) ? { durationSec: raw.durationSec } : {}),
        ...(cleanString(raw.urlYoutube, 2000) ? { urlYoutube: cleanString(raw.urlYoutube, 2000) } : {}),
        ...(cleanString(raw.urlStories, 2000) ? { urlStories: cleanString(raw.urlStories, 2000) } : {}),
      }]
    }
    return [{
      type: 'image',
      url,
      ...(cleanString(raw.alt, 240) || cleanString(raw.altText, 240)
        ? { alt: cleanString(raw.alt, 240) || cleanString(raw.altText, 240) }
        : {}),
    }]
  })
  return media.length > 0 ? media : undefined
}

/**
 * Normalize Firestore / API social post shapes into the campaign-preview card contract.
 * Accepts both legacy (`content: string`, `platform`) and enhanced (`content.text`, `platforms[]`) posts.
 */
export function toPreviewSocialPost(
  rawInput: Record<string, unknown>,
  defaults?: { authorName?: string; authorHandle?: string },
): PreviewSocialPost {
  const id = cleanString(rawInput.id, 200) || 'post'
  const content = getPostText(rawInput.content)
  const platform = primaryPlatformOf(rawInput)
  const hashtags = Array.isArray(rawInput.hashtags)
    ? rawInput.hashtags.map((tag) => cleanString(tag, 80)).filter(Boolean).slice(0, 40)
    : undefined
  const threadParts = Array.isArray(rawInput.threadParts)
    ? rawInput.threadParts.map((part) => cleanString(part, 2000)).filter(Boolean)
    : Array.isArray(rawInput.thread)
      ? rawInput.thread.map((part) => cleanString(part, 2000)).filter(Boolean)
      : []
  const media = toPreviewMedia(rawInput.media)
  const scheduledFor = dateLikeToIso(
    rawInput.scheduledFor ?? rawInput.scheduledAt ?? rawInput.publishedAt ?? rawInput.approvedAt ?? rawInput.createdAt,
  )
  const campaignId = cleanString(rawInput.campaignId, 200) || cleanString(rawInput.campaign, 200) || undefined
  const format = cleanString(rawInput.format, 40).toLowerCase() || undefined
  const status = cleanString(rawInput.status, 80) || undefined
  const videoTitle = cleanString(rawInput.videoTitle, 240) || cleanString(rawInput.title, 240) || undefined

  return {
    id,
    content,
    platform,
    ...(hashtags && hashtags.length > 0 ? { hashtags } : {}),
    ...(status ? { status } : {}),
    ...(scheduledFor ? { scheduledFor } : {}),
    ...(media ? { media } : {}),
    ...(campaignId ? { campaignId } : {}),
    ...(format ? { format } : {}),
    ...(threadParts.length > 0 ? { thread: threadParts } : {}),
    ...(videoTitle ? { videoTitle } : {}),
    ...(defaults?.authorName ? { authorName: defaults.authorName } : {}),
    ...(defaults?.authorHandle ? { authorHandle: defaults.authorHandle } : {}),
    ...(cleanString(rawInput.authorName, 120) ? { authorName: cleanString(rawInput.authorName, 120) } : {}),
    ...(cleanString(rawInput.authorHandle, 120) ? { authorHandle: cleanString(rawInput.authorHandle, 120) } : {}),
    ...(cleanString(rawInput.authorHeadline, 240) ? { authorHeadline: cleanString(rawInput.authorHeadline, 240) } : {}),
    ...(cleanString(rawInput.authorAvatarUrl, 2000) ? { authorAvatarUrl: cleanString(rawInput.authorAvatarUrl, 2000) } : {}),
    ...(cleanString(rawInput.channelName, 120) ? { channelName: cleanString(rawInput.channelName, 120) } : {}),
    ...(cleanString(rawInput.channelAvatarUrl, 2000) ? { channelAvatarUrl: cleanString(rawInput.channelAvatarUrl, 2000) } : {}),
  }
}

export function toPreviewBlog(rawInput: Record<string, unknown>): {
  id: string
  title: string
  type?: string
  publishDate?: string
  targetUrl?: string
  status?: string
  draft?: { body?: string; metaDescription?: string; wordCount?: number }
  heroImageUrl?: string
  authorName?: string
  authorAvatarUrl?: string
  readTimeMinutes?: number
} {
  const draftRaw = rawInput.draft && typeof rawInput.draft === 'object' && !Array.isArray(rawInput.draft)
    ? rawInput.draft as Record<string, unknown>
    : undefined
  return {
    id: cleanString(rawInput.id, 200) || 'blog',
    title: cleanString(rawInput.title, 240) || 'Untitled blog',
    ...(cleanString(rawInput.type, 80) ? { type: cleanString(rawInput.type, 80) } : {}),
    ...(dateLikeToIso(rawInput.publishDate ?? rawInput.publishedAt) ? { publishDate: dateLikeToIso(rawInput.publishDate ?? rawInput.publishedAt) } : {}),
    ...(cleanString(rawInput.targetUrl, 2000) ? { targetUrl: cleanString(rawInput.targetUrl, 2000) } : {}),
    ...(cleanString(rawInput.status, 80) ? { status: cleanString(rawInput.status, 80) } : {}),
    ...(draftRaw ? {
      draft: {
        ...(typeof draftRaw.body === 'string' ? { body: draftRaw.body } : {}),
        ...(typeof draftRaw.metaDescription === 'string' ? { metaDescription: draftRaw.metaDescription } : {}),
        ...(typeof draftRaw.wordCount === 'number' && Number.isFinite(draftRaw.wordCount) ? { wordCount: draftRaw.wordCount } : {}),
      },
    } : {}),
    ...(cleanString(rawInput.heroImageUrl, 2000) ? { heroImageUrl: cleanString(rawInput.heroImageUrl, 2000) } : {}),
    ...(cleanString(rawInput.authorName, 120) ? { authorName: cleanString(rawInput.authorName, 120) } : {}),
    ...(cleanString(rawInput.authorAvatarUrl, 2000) ? { authorAvatarUrl: cleanString(rawInput.authorAvatarUrl, 2000) } : {}),
    ...(typeof rawInput.readTimeMinutes === 'number' && Number.isFinite(rawInput.readTimeMinutes)
      ? { readTimeMinutes: rawInput.readTimeMinutes }
      : {}),
  }
}
