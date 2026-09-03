// Local view-types for campaign-preview cards.
// These are intentionally a SUBSET of what the platform APIs return  - 
// cards must not crash on missing optional fields.

export type PreviewMediaImage = { type: 'image'; url: string; alt?: string }
export type PreviewMediaVideo = {
  type: 'video'
  url: string
  urlYoutube?: string
  urlStories?: string
  thumbnailUrl?: string
  durationSec?: number
}
export type PreviewMedia = PreviewMediaImage | PreviewMediaVideo

export interface PreviewSocialPost {
  id: string
  content: string
  hashtags?: string[]
  platform: string
  scheduledFor?: string
  status?: string
  media?: PreviewMedia[]
  campaignId?: string
  /** Instagram story / reel / feed hint used by card pickers. */
  format?: string
  // Optional convenience fields used for chrome  -  cards fall back gracefully if absent.
  authorName?: string
  authorHandle?: string
  authorAvatarUrl?: string
  authorHeadline?: string
  // Twitter / X  -  when present, render as a numbered thread instead of a single tweet.
  thread?: string[]
  // Engagement counts (purely cosmetic).
  likeCount?: number
  commentCount?: number
  shareCount?: number
  viewCount?: number
  // YouTube extras.
  videoTitle?: string
  channelName?: string
  channelAvatarUrl?: string
}

export interface PreviewBlog {
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
}

export interface PreviewBrand {
  name?: string
  palette: {
    bg: string
    accent: string
    alert: string
    text: string
    muted?: string
  }
  typography?: {
    heading?: string
    body?: string
  }
  logoUrl?: string
}

export interface AssetActionsProps {
  assetId: string
  type: 'social_post' | 'seo_content' | 'video'
  status: string
  onApprove: () => Promise<void> | void
  onRequestChanges: (feedback: string) => Promise<void> | void
  onEdit: () => void
  busy?: boolean
}
