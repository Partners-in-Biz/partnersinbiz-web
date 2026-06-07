'use client'

import type { ReactNode } from 'react'
import type { YouTubeChannelWorkspace, YouTubeVideoProject } from '@/lib/youtube-studio/types'

function label(value?: string) {
  return value ? value.replace(/_/g, ' ') : 'not set'
}

function maybeText(value?: string) {
  return value && value.trim() ? value.trim() : null
}

export function StatusPill({ status }: { status?: string }) {
  return (
    <span className="rounded-full border border-[var(--color-pib-line)] px-2 py-1 text-[11px] font-label uppercase tracking-widest text-[var(--color-pib-text-muted)]">
      {label(status)}
    </span>
  )
}

export function YouTubeChannelCard({
  channel,
  children,
}: {
  channel: YouTubeChannelWorkspace
  children?: ReactNode
}) {
  const handle = maybeText(channel.youtubeHandle) ?? maybeText(channel.youtubeChannelId) ?? 'Channel connection pending'

  return (
    <article className="pib-card-section space-y-3 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-headline text-lg font-semibold text-on-surface">{channel.title}</h3>
          <p className="text-sm text-on-surface-variant">{handle}</p>
        </div>
        <StatusPill status={channel.status} />
      </div>
      {channel.contentPillars?.length ? (
        <div className="flex flex-wrap gap-2">
          {channel.contentPillars.slice(0, 4).map((pillar) => (
            <span key={pillar} className="rounded-full bg-white/[0.04] px-2 py-1 text-xs text-on-surface-variant">
              {pillar}
            </span>
          ))}
        </div>
      ) : null}
      {channel.clientNotes ? <p className="text-sm text-on-surface-variant">{channel.clientNotes}</p> : null}
      {children ? <div className="flex flex-wrap gap-2 pt-1">{children}</div> : null}
    </article>
  )
}

export function YouTubeVideoCard({
  video,
  children,
}: {
  video: YouTubeVideoProject
  children?: ReactNode
}) {
  return (
    <article className="pib-card-section space-y-3 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-headline text-lg font-semibold text-on-surface">{video.title}</h3>
          <p className="text-sm text-on-surface-variant">{video.objective || label(video.videoType)}</p>
        </div>
        <StatusPill status={video.status} />
      </div>
      <div className="grid grid-cols-2 gap-2 text-xs text-on-surface-variant sm:grid-cols-4">
        <span>Type: {label(video.videoType)}</span>
        <span>Review: {label(video.clientReview?.status)}</span>
        <span>Source: {label(video.source?.intakeType)}</span>
        <span>Target: {video.targetDurationSeconds ? `${video.targetDurationSeconds}s` : 'open'}</span>
      </div>
      {video.clientNotes ? <p className="rounded-xl bg-white/[0.04] p-3 text-sm text-on-surface">{video.clientNotes}</p> : null}
      {children ? <div className="flex flex-wrap gap-2 pt-1">{children}</div> : null}
    </article>
  )
}
