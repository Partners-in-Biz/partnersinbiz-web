'use client'

import {
  InstagramReelsCard,
  InstagramStoriesCard,
  YouTubeCard,
  type PreviewSocialPost,
  type PreviewBrand,
} from '@/components/campaign-preview'

interface Props {
  post: PreviewSocialPost
  brand?: PreviewBrand
}

/**
 * Renders one video asset in all three formats side-by-side: vertical Reel,
 * 16:9 YouTube horizontal, and 15-second Stories cut. Mirrors the old
 * client-content-engine preview-site layout so a client sees every
 * platform at once before approving.
 *
 * The post record carries all three URLs on a single media[0] entry —
 * { type: 'video', url: <Reel>, urlYoutube: <16:9>, urlStories: <15s> }.
 */
export function VideoTriptych({ post, brand }: Props) {
  const video = post.media?.[0]
  const hasReel = video?.type === 'video' && !!video.url
  const hasYouTube = video?.type === 'video' && !!video.urlYoutube
  const hasStories = video?.type === 'video' && !!video.urlStories

  // Build per-format projections so each card renders the right URL as its primary
  const reelPost: PreviewSocialPost = {
    ...post,
    platform: 'instagram',
    media:
      video?.type === 'video'
        ? [{ ...video, url: video.url }]
        : post.media,
  }

  const storiesPost: PreviewSocialPost = {
    ...post,
    platform: 'instagram',
    media:
      video?.type === 'video' && video.urlStories
        ? [{ ...video, url: video.urlStories }]
        : post.media,
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-start">
        {hasReel && (
          <FormatColumn label="Reel · 9:16">
            <InstagramReelsCard post={reelPost} brand={brand} />
          </FormatColumn>
        )}
        {hasYouTube && (
          <FormatColumn label="YouTube · 16:9">
            <YouTubeCard post={post} brand={brand} />
          </FormatColumn>
        )}
        {hasStories && (
          <FormatColumn label="Stories · 15s">
            <InstagramStoriesCard post={storiesPost} brand={brand} />
          </FormatColumn>
        )}
      </div>
    </div>
  )
}

function FormatColumn({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2 min-w-0 overflow-hidden">
      <p className="text-xs uppercase tracking-wide text-[var(--color-pib-text-muted)]">
        {label}
      </p>
      <div className="min-w-0 overflow-hidden">
        {children}
      </div>
    </div>
  )
}
