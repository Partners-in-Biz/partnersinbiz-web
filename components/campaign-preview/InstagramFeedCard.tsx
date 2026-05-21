'use client'

import React, { useState } from 'react'
import type { PreviewSocialPost, PreviewBrand } from './types'
import { PreviewImage, getFirstImage, compactCount, HighlightedText, readableAccentOnDark, withHashtags } from './utils'

export interface InstagramFeedCardProps {
  post: PreviewSocialPost
  brand?: PreviewBrand
}

export function InstagramFeedCard({ post, brand }: InstagramFeedCardProps) {
  const [expanded, setExpanded] = useState(false)
  const image = getFirstImage(post.media)
  const handle = post.authorHandle || brand?.name || 'yourbrand'
  const avatar = post.authorAvatarUrl || brand?.logoUrl
  const fullCaption = withHashtags(post.content, post.hashtags)
  const isLong = fullCaption.length > 90
  const caption = !expanded && isLong ? fullCaption.slice(0, 90).trimEnd() : fullCaption
  const accent = readableAccentOnDark(brand?.palette.accent, '#0095F6')

  return (
    <div
      style={{
        width: '100%',
        background: '#000',
        color: '#fff',
        borderRadius: 8,
        border: '1px solid #262626',
        overflow: 'hidden',
        fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
        fontSize: 14,
      }}
    >
      {/* header */}
      <div style={{ display: 'flex', alignItems: 'center', padding: '10px 12px', gap: 10 }}>
        <div
          style={{
            width: 32,
            height: 32,
            borderRadius: '50%',
            background: 'linear-gradient(45deg,#feda75,#fa7e1e,#d62976,#962fbf,#4f5bd5)',
            padding: 2,
          }}
        >
          <div
            style={{
              width: '100%',
              height: '100%',
              borderRadius: '50%',
              background: '#000',
              padding: 2,
              boxSizing: 'border-box',
            }}
          >
            <PreviewImage
              src={avatar}
              alt={handle}
              style={{ width: '100%', height: '100%', borderRadius: '50%' }}
            />
          </div>
        </div>
        <div style={{ flex: 1, fontWeight: 600, fontSize: 13 }}>{handle}</div>
        <div style={{ fontSize: 18, lineHeight: 1, color: '#fff' }}>···</div>
      </div>

      {/* media */}
      <div style={{ width: '100%', aspectRatio: '1 / 1', background: '#111' }}>
        <PreviewImage
          src={image?.url}
          alt={image?.alt}
          style={{ width: '100%', height: '100%', display: 'block' }}
        />
      </div>

      {/* action row */}
      <div style={{ display: 'flex', gap: 14, padding: '10px 12px 4px', alignItems: 'center', fontSize: 22 }}>
        <span aria-label="like">♡</span>
        <span aria-label="comment">💬</span>
        <span aria-label="share">↗</span>
        <span style={{ flex: 1 }} />
        <span aria-label="save">🔖</span>
      </div>

      {/* like count */}
      <div style={{ padding: '2px 12px', fontWeight: 600, fontSize: 13 }}>
        {compactCount(post.likeCount ?? 1234)} likes
      </div>

      {/* caption */}
      <div style={{ padding: '4px 12px 6px', fontSize: 13, lineHeight: 1.4 }}>
        <span style={{ fontWeight: 600, marginRight: 6 }}>{handle}</span>
        <HighlightedText text={caption} linkColor={accent} />
        {!expanded && isLong && (
          <>
            …{' '}
            <button
              onClick={() => setExpanded(true)}
              style={{
                background: 'none',
                border: 'none',
                padding: 0,
                color: '#8e8e8e',
                cursor: 'pointer',
                font: 'inherit',
              }}
            >
              more
            </button>
          </>
        )}
      </div>

      {/* comments preview */}
      <div style={{ padding: '0 12px 6px', color: '#8e8e8e', fontSize: 13 }}>
        View all {compactCount(post.commentCount ?? 42)} comments
      </div>
      <div style={{ padding: '0 12px 12px', color: '#8e8e8e', fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5 }}>
        2 hours ago
      </div>
    </div>
  )
}

export default InstagramFeedCard
