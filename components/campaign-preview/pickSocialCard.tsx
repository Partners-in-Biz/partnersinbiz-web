'use client'

import {
  InstagramFeedCard,
  InstagramReelsCard,
  InstagramStoriesCard,
  FacebookFeedCard,
  LinkedInPostCard,
  TwitterPostCard,
  YouTubeCard,
  type PreviewSocialPost,
  type PreviewBrand,
} from '@/components/campaign-preview'
import type { ComponentType } from 'react'

export type SocialPreviewCardProps = {
  post: PreviewSocialPost
  brand?: PreviewBrand
}

export function pickSocialCard(post: PreviewSocialPost): ComponentType<SocialPreviewCardProps> {
  const platform = (post.platform || '').toLowerCase()
  const format = (post.format || '').toLowerCase()
  const hasVideo = (post.media ?? []).some((m) => m.type === 'video')
  const hasStoriesUrl = (post.media ?? []).some((m) => m.type === 'video' && Boolean(m.urlStories))

  if (platform === 'instagram') {
    if (format === 'story' || hasStoriesUrl) return InstagramStoriesCard
    if (hasVideo || format === 'reel' || format === 'reels') return InstagramReelsCard
    return InstagramFeedCard
  }
  if (platform === 'linkedin') return LinkedInPostCard
  if (platform === 'twitter' || platform === 'x') return TwitterPostCard
  if (platform === 'facebook') return FacebookFeedCard
  if (platform === 'youtube') return YouTubeCard

  return LinkedInPostCard
}

export function SocialPlatformCard({ post, brand }: SocialPreviewCardProps) {
  const Card = pickSocialCard(post)
  return <Card post={post} brand={brand} />
}
