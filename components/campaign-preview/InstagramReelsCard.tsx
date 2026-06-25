'use client'

import React from 'react'
import type { PreviewSocialPost, PreviewBrand } from './types'
import { PreviewImage, getFirstVideo, getFirstImage, compactCount, HighlightedText, readableAccentOnDark, withHashtags } from './utils'

export interface InstagramReelsCardProps {
  post: PreviewSocialPost
  brand?: PreviewBrand
}

export function InstagramReelsCard({ post, brand }: InstagramReelsCardProps) {
  const video = getFirstVideo(post.media)
  const image = getFirstImage(post.media)
  const handle = post.authorHandle || brand?.name || 'yourbrand'
  const fullCaption = withHashtags(post.content, post.hashtags)
  const accent = readableAccentOnDark(brand?.palette.accent, '#fff')
  const hasVideo = Boolean(video)
  const chromeBottomOffset = hasVideo ? 64 : 14

  return (
    <div
      style={{
        width: '100%',
        aspectRatio: '9 / 16',
        position: 'relative',
        background: '#000',
        color: '#fff',
        borderRadius: 14,
        overflow: 'hidden',
        fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
      }}
    >
      {/* media */}
      {video ? (
        <video
          src={video.urlStories || video.url}
          poster={video.thumbnailUrl}
          aria-label="Instagram reel video preview"
          controls
          playsInline
          style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
        />
      ) : (
        <PreviewImage src={image?.url} alt={image?.alt} style={{ width: '100%', height: '100%' }} />
      )}

      {/* dark gradient overlays for legibility */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background:
            'linear-gradient(180deg, rgba(0,0,0,.45) 0%, rgba(0,0,0,0) 25%, rgba(0,0,0,0) 60%, rgba(0,0,0,.7) 100%)',
          pointerEvents: 'none',
        }}
      />

      {/* top row: handle + reels label */}
      <div
        style={{
          position: 'absolute',
          top: 12,
          left: 12,
          right: 12,
          display: 'flex',
          alignItems: 'center',
          fontSize: 14,
          fontWeight: 600,
          gap: 8,
          pointerEvents: 'none',
        }}
      >
        <span style={{ fontSize: 16 }}>Reels</span>
      </div>

      {/* right rail icons */}
      <div
        data-testid="instagram-reels-right-rail"
        style={{
          position: 'absolute',
          right: 10,
          bottom: hasVideo ? 128 : 80,
          display: 'flex',
          flexDirection: 'column',
          gap: 18,
          fontSize: 22,
          alignItems: 'center',
          pointerEvents: 'none',
        }}
      >
        <div style={{ textAlign: 'center' }}>
          <div>♡</div>
          <div style={{ fontSize: 11, marginTop: 2 }}>{compactCount(post.likeCount ?? 12300)}</div>
        </div>
        <div style={{ textAlign: 'center' }}>
          <div>💬</div>
          <div style={{ fontSize: 11, marginTop: 2 }}>{compactCount(post.commentCount ?? 84)}</div>
        </div>
        <div style={{ textAlign: 'center' }}>
          <div>↗</div>
          <div style={{ fontSize: 11, marginTop: 2 }}>{compactCount(post.shareCount ?? 22)}</div>
        </div>
        <div style={{ textAlign: 'center' }}>
          <div>🔖</div>
        </div>
        <div style={{ textAlign: 'center' }}>
          <div>···</div>
        </div>
      </div>

      {/* bottom: handle + caption + audio */}
      <div
        data-testid="instagram-reels-caption-overlay"
        style={{
          position: 'absolute',
          left: 12,
          right: 70,
          bottom: chromeBottomOffset,
          fontSize: 13,
          maxHeight: hasVideo ? '46%' : undefined,
          overflow: 'hidden',
          pointerEvents: 'none',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
          <div
            style={{
              width: 28,
              height: 28,
              borderRadius: '50%',
              background: '#333',
              border: '1px solid #fff',
              overflow: 'hidden',
            }}
          >
            <PreviewImage
              src={post.authorAvatarUrl || brand?.logoUrl}
              alt={handle}
              style={{ width: '100%', height: '100%' }}
            />
          </div>
          <strong style={{ fontWeight: 600 }}>{handle}</strong>
          <span
            style={{
              border: '1px solid #fff',
              padding: '1px 8px',
              borderRadius: 4,
              fontSize: 11,
              fontWeight: 600,
            }}
          >
            Follow
          </span>
        </div>
        <div style={{ lineHeight: 1.35, fontSize: 13, marginBottom: 6, overflow: 'hidden' }}>
          <HighlightedText text={fullCaption} linkColor={accent} />
        </div>
        <div style={{ fontSize: 12, opacity: 0.95, display: 'flex', alignItems: 'center', gap: 6 }}>
          <span>♪</span>
          <span>{handle} · Original audio</span>
        </div>
      </div>
    </div>
  )
}

export default InstagramReelsCard
