import type { PublishOptions } from '@/lib/social/providers'

function cleanString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function cleanStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  const cleaned = value
    .map((item) => cleanString(item))
    .filter((item): item is string => Boolean(item))
  return cleaned.length > 0 ? cleaned : undefined
}

function cleanVisibility(value: unknown): 'private' | 'unlisted' | 'public' | undefined {
  return value === 'private' || value === 'unlisted' || value === 'public' ? value : undefined
}

function cleanBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined
}

export function buildProviderPublishOptions(opts: {
  post: FirebaseFirestore.DocumentData
  text: string
  mediaUrls?: string[]
  shareType?: 'profile' | 'organization'
}): PublishOptions {
  const { post, text, mediaUrls, shareType } = opts
  const platformOverrides = typeof post.content === 'object' && post.content
    ? post.content.platformOverrides
    : undefined
  const youtubeOverride = platformOverrides && typeof platformOverrides === 'object'
    ? (platformOverrides.youtube as Record<string, unknown> | undefined)
    : undefined

  const targetVisibility = cleanVisibility(post.targetVisibility) ?? cleanVisibility(post.privacyStatus) ?? 'private'
  const privacyStatus = cleanVisibility(post.privacyStatus) ?? targetVisibility

  return {
    text,
    mediaUrls,
    shareType,
    title: cleanString(post.title) ?? cleanString(youtubeOverride?.title),
    tags: cleanStringArray(post.tags) ?? cleanStringArray(post.hashtags),
    privacyStatus,
    targetVisibility,
    categoryId: cleanString(post.categoryId),
    publishAt: cleanString(post.publishAt) ?? cleanString(post.scheduledAt) ?? cleanString(post.scheduledFor),
    selfDeclaredMadeForKids: cleanBoolean(post.selfDeclaredMadeForKids),
    containsSyntheticMedia: cleanBoolean(post.containsSyntheticMedia),
    aiDisclosureNotes: cleanString(post.aiDisclosureNotes),
  }
}
