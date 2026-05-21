'use client'

import React from 'react'
import type { PreviewSocialPost, PreviewBrand } from './types'
import {
  PreviewImage,
  getFirstImage,
  getFirstVideo,
  HighlightedText,
  readableAccentOnDark,
  withHashtags,
  relativeTime,
  compactCount,
} from './utils'

export interface TwitterPostCardProps {
  post: PreviewSocialPost
  brand?: PreviewBrand
}

function Tweet({
  body,
  index,
  total,
  showMedia,
  image,
  video,
  accent,
  name,
  handle,
  avatar,
  time,
  post,
}: {
  body: string
  index?: number
  total?: number
  showMedia: boolean
  image: ReturnType<typeof getFirstImage>
  video: ReturnType<typeof getFirstVideo>
  accent: string
  name: string
  handle: string
  avatar?: string
  time: string
  post: PreviewSocialPost
}) {
  const numbered = index !== undefined && total !== undefined && total > 1 ? `${body}\n\n${index + 1}/${total}` : body
  return (
    <div style={{ padding: '12px 16px', borderBottom: '1px solid #2f3336', display: 'flex', gap: 12 }}>
      <div
        style={{
          width: 40,
          height: 40,
          borderRadius: '50%',
          background: '#333',
          flexShrink: 0,
          overflow: 'hidden',
        }}
      >
        <PreviewImage src={avatar} alt={name} style={{ width: '100%', height: '100%' }} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 15 }}>
          <strong style={{ fontWeight: 700 }}>{name}</strong>
          <span style={{ color: '#71767B' }}>@{handle}</span>
          <span style={{ color: '#71767B' }}>·</span>
          <span style={{ color: '#71767B' }}>{time}</span>
          <span style={{ flex: 1 }} />
          <span style={{ color: '#71767B' }}>···</span>
        </div>
        <div style={{ marginTop: 4, fontSize: 15, lineHeight: 1.4, whiteSpace: 'pre-wrap' }}>
          <HighlightedText text={numbered} linkColor={accent} />
        </div>
        {showMedia && (video || image) && (
          <div style={{ marginTop: 10, borderRadius: 16, overflow: 'hidden', border: '1px solid #2f3336' }}>
            {video ? (
              <video
                src={video.url}
                poster={video.thumbnailUrl}
                controls
                style={{ width: '100%', display: 'block', background: '#000' }}
              />
            ) : image ? (
              <PreviewImage src={image.url} alt={image.alt} style={{ width: '100%', maxHeight: 500 }} />
            ) : null}
          </div>
        )}
        <div
          style={{
            marginTop: 10,
            display: 'flex',
            justifyContent: 'space-between',
            color: '#71767B',
            fontSize: 13,
            maxWidth: 420,
          }}
        >
          <span>💬 {compactCount(post.commentCount ?? 12)}</span>
          <span>🔁 {compactCount(post.shareCount ?? 8)}</span>
          <span>♡ {compactCount(post.likeCount ?? 142)}</span>
          <span>📊 {compactCount(post.viewCount ?? 4200)}</span>
          <span>↗</span>
        </div>
      </div>
    </div>
  )
}

export function TwitterPostCard({ post, brand }: TwitterPostCardProps) {
  const image = getFirstImage(post.media)
  const video = getFirstVideo(post.media)
  const name = post.authorName || brand?.name || 'Your Brand'
  const handle = post.authorHandle || brand?.name?.toLowerCase().replace(/\s+/g, '') || 'yourbrand'
  const avatar = post.authorAvatarUrl || brand?.logoUrl
  const time = relativeTime(post.scheduledFor)
  const accent = readableAccentOnDark(brand?.palette.accent, '#1D9BF0')
  const fullCaption = withHashtags(post.content, post.hashtags)
  const isThread = Array.isArray(post.thread) && post.thread.length > 1
  const tweets = isThread ? post.thread! : [fullCaption]

  return (
    <div
      style={{
        width: '100%',
        background: '#000',
        color: '#E7E9EA',
        borderRadius: 16,
        border: '1px solid #2f3336',
        overflow: 'hidden',
        fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
      }}
    >
      {tweets.map((body, i) => (
        <Tweet
          key={i}
          body={body}
          index={isThread ? i : undefined}
          total={isThread ? tweets.length : undefined}
          showMedia={i === 0}
          image={image}
          video={video}
          accent={accent}
          name={name}
          handle={handle}
          avatar={avatar}
          time={time}
          post={post}
        />
      ))}
    </div>
  )
}

export default TwitterPostCard
