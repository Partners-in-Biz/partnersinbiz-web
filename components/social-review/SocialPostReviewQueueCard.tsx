'use client'

import Link from 'next/link'
import {
  fmtRelative,
  fmtScheduled,
  getMedia,
  getPostPlatforms,
  getPostText,
  mediaUrl,
  PlatformChip,
  type SocialPostReviewPost,
} from './SocialPostReviewWorkspace'

export type SocialPostReviewQueueTone = 'neutral' | 'warning' | 'info' | 'success'
export type SocialPostReviewQueueLayout = 'row' | 'card'

interface SocialPostReviewQueueCardProps {
  post: SocialPostReviewPost
  href: string
  actionLabel: string
  statusLabel?: string
  statusTone?: SocialPostReviewQueueTone
  layout?: SocialPostReviewQueueLayout
  showCreatedBy?: boolean
  showMediaCount?: boolean
  showMediaThumbs?: boolean
  emptyPlatformsLabel?: string
}

const STATUS_TONES: Record<SocialPostReviewQueueTone, string> = {
  neutral: 'bg-surface-container-high text-on-surface-variant',
  warning: 'bg-amber-500/10 text-amber-400',
  info: 'bg-indigo-500/10 text-indigo-400',
  success: 'bg-green-500/10 text-green-400',
}

function truncate(text: string, limit: number): string {
  if (text.length <= limit) return text
  return `${text.slice(0, limit)}...`
}

function getMediaCount(post: SocialPostReviewPost): number {
  if (typeof post.mediaCount === 'number') return post.mediaCount
  return getMedia(post).length
}

function hasAgentHandoff(post: SocialPostReviewPost): boolean {
  return Array.isArray(post.comments) && post.comments.some(comment => comment.kind === 'agent_handoff')
}

function StatusBadge({
  label,
  tone = 'neutral',
}: {
  label?: string
  tone?: SocialPostReviewQueueTone
}) {
  if (!label) return null
  return (
    <span className={`text-[10px] uppercase tracking-wider px-2 py-1 rounded ${STATUS_TONES[tone]}`}>
      {label}
    </span>
  )
}

function RevisionBadge({ post }: { post: SocialPostReviewPost }) {
  const regenerationCount = post.approval?.regenerationCount ?? 0
  if (!hasAgentHandoff(post) && regenerationCount <= 0) return null

  return (
    <span
      className="text-[10px] font-label uppercase tracking-widest border px-2 py-0.5 flex-shrink-0"
      style={{
        borderColor: 'rgba(245, 158, 11, 0.4)',
        color: 'var(--color-accent-v2, var(--color-pib-accent))',
        background: 'rgba(245, 158, 11, 0.08)',
      }}
    >
      Revised{regenerationCount > 0 ? ` x${regenerationCount}` : ''}
    </span>
  )
}

function MediaThumbs({ post }: { post: SocialPostReviewPost }) {
  const media = getMedia(post)
  if (!media.length) return null

  const visible = media.slice(0, 4)
  return (
    <div className="flex gap-1.5">
      {visible.map((item, index) => {
        const url = mediaUrl(item)
        if (!url) {
          return (
            <div
              key={index}
              className="w-12 h-12 rounded border border-outline-variant/40 bg-surface-container-high flex items-center justify-center text-[10px] text-on-surface-variant"
            >
              media
            </div>
          )
        }

        return (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            key={`${url}-${index}`}
            src={url}
            alt=""
            className="w-12 h-12 rounded border border-outline-variant/40 object-cover"
          />
        )
      })}
      {media.length > visible.length ? (
        <div className="w-12 h-12 rounded border border-outline-variant/40 bg-surface-container-high flex items-center justify-center text-[10px] text-on-surface-variant">
          +{media.length - visible.length}
        </div>
      ) : null}
    </div>
  )
}

export function SocialPostReviewQueueCard({
  post,
  href,
  actionLabel,
  statusLabel,
  statusTone = 'neutral',
  layout = 'card',
  showCreatedBy = false,
  showMediaCount = false,
  showMediaThumbs = false,
  emptyPlatformsLabel = 'No platforms',
}: SocialPostReviewQueueCardProps) {
  const text = getPostText(post)
  const platforms = getPostPlatforms(post)
  const mediaCount = getMediaCount(post)
  const scheduled = post.scheduledAt ?? post.scheduledFor
  const author = post.createdByName || post.createdBy || 'unknown'
  const preview = truncate(text, 200)

  const topRow = (
    <div className="flex items-center gap-2 flex-wrap">
      {platforms.length === 0 ? (
        <span className="text-[10px] uppercase tracking-wide text-on-surface-variant">
          {emptyPlatformsLabel}
        </span>
      ) : (
        platforms.map(platform => <PlatformChip key={platform} platform={platform} />)
      )}
      <StatusBadge label={statusLabel} tone={statusTone} />
      <RevisionBadge post={post} />
    </div>
  )

  const body = (
    <>
      {topRow}
      <p className="text-sm text-on-surface leading-relaxed whitespace-pre-wrap break-words line-clamp-3">
        {preview ? preview : <span className="text-on-surface-variant italic">(empty content)</span>}
      </p>
      {showMediaThumbs ? <MediaThumbs post={post} /> : null}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-on-surface-variant">
        {showCreatedBy ? (
          <>
            <span>
              by <span className="text-on-surface">{author}</span>
            </span>
            <span>-</span>
          </>
        ) : null}
        {scheduled ? <span>Scheduled: {fmtScheduled(scheduled)}</span> : null}
        {scheduled ? <span>-</span> : null}
        <span>Created {fmtRelative(post.createdAt)}</span>
        {showMediaCount && mediaCount > 0 ? (
          <>
            <span>-</span>
            <span>
              {mediaCount} {mediaCount === 1 ? 'media item' : 'media items'}
            </span>
          </>
        ) : null}
      </div>
    </>
  )

  if (layout === 'row') {
    return (
      <div className="pib-card pib-card-hover flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex-1 min-w-0 space-y-3">{body}</div>
        <div className="shrink-0 flex sm:items-center">
          <Link href={href} className="pib-btn-primary text-sm">
            {actionLabel}
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="pib-card p-5 space-y-3">
      {body}
      <div className="flex justify-end pt-1">
        <Link href={href} className="pib-btn-primary text-xs px-3 py-1.5">
          {actionLabel}
        </Link>
      </div>
    </div>
  )
}
