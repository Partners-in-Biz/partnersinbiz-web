'use client'

import React from 'react'
import type { PreviewSocialPost, PreviewBrand } from './types'
import { PreviewImage, getFirstVideo, getFirstImage, getPostText } from './utils'

export interface InstagramStoriesCardProps {
  post: PreviewSocialPost
  brand?: PreviewBrand
}

export function InstagramStoriesCard({ post, brand }: InstagramStoriesCardProps) {
  const video = getFirstVideo(post.media)
  const image = getFirstImage(post.media)
  const handle = post.authorHandle || brand?.name || 'yourbrand'
  const text = getPostText(post.content)
  const showSticker = text.length > 0 && text.length <= 80
  const accent = brand?.palette.accent || 'var(--sc-accent)'

  return (
    <div
      style={{
        width: '100%',
        aspectRatio: '9 / 16',
        position: 'relative',
        background: '#000',
        color: '#fff',
        borderRadius: 12,
        overflow: 'hidden',
        fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
      }}
    >
      {video ? (
        <video
          src={video.urlStories || video.url}
          poster={video.thumbnailUrl}
          autoPlay
          muted
          loop
          playsInline
          controls
          style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
        />
      ) : (
        <PreviewImage src={image?.url} alt={image?.alt} style={{ width: '100%', height: '100%' }} />
      )}

      {/* progress bar */}
      <div
        style={{
          position: 'absolute',
          top: 8,
          left: 8,
          right: 8,
          height: 3,
          background: 'rgba(255,255,255,0.3)',
          borderRadius: 999,
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            width: '40%',
            height: '100%',
            background: '#fff',
            borderRadius: 999,
          }}
        />
      </div>

      {/* header */}
      <div
        style={{
          position: 'absolute',
          top: 18,
          left: 12,
          right: 12,
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          fontSize: 13,
        }}
      >
        <div
          style={{
            width: 30,
            height: 30,
            borderRadius: '50%',
            background: '#222',
            border: '1.5px solid #fff',
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
        <span style={{ opacity: 0.85 }}>1m</span>
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: 18, lineHeight: 1 }}>···</span>
        <span style={{ fontSize: 18, lineHeight: 1 }}>×</span>
      </div>

      {/* sticker overlay if short caption */}
      {showSticker && (
        <div
          style={{
            position: 'absolute',
            top: '38%',
            left: '50%',
            transform: 'translate(-50%, -50%) rotate(-3deg)',
            background: '#fff',
            color: '#111',
            padding: '8px 14px',
            borderRadius: 8,
            fontWeight: 700,
            fontSize: 16,
            maxWidth: '80%',
            textAlign: 'center',
            boxShadow: '0 6px 16px rgba(0,0,0,0.35)',
            borderLeft: `4px solid ${accent}`,
          }}
        >
          {text}
        </div>
      )}

      {/* footer reply field */}
      <div
        style={{
          position: 'absolute',
          left: 12,
          right: 12,
          bottom: 14,
          display: 'flex',
          gap: 8,
          alignItems: 'center',
        }}
      >
        <div
          style={{
            flex: 1,
            border: '1px solid rgba(255,255,255,0.6)',
            borderRadius: 999,
            padding: '8px 14px',
            color: 'rgba(255,255,255,0.85)',
            fontSize: 13,
          }}
        >
          Send message
        </div>
        <span style={{ fontSize: 22 }}>♡</span>
        <span style={{ fontSize: 22 }}>↗</span>
      </div>
    </div>
  )
}

export default InstagramStoriesCard
