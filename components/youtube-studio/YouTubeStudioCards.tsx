'use client'

import type { ReactNode } from 'react'
import type { YouTubeChannelWorkspace, YouTubeVideoProject } from '@/lib/youtube-studio/types'

function label(value?: string) {
  return value ? value.replace(/_/g, ' ') : 'not set'
}

function clientStatusLabel(value?: string) {
  if (!value) return 'Not set'
  const labels: Record<string, string> = {
    intake: 'Requested',
    briefing: 'Briefing',
    production: 'PiB producing',
    internal_review: 'PiB checking',
    client_review: 'Your review',
    changes_requested: 'Changes requested',
    publish_ready: 'Ready to publish',
    scheduled: 'Scheduled',
    live: 'Live',
  }
  return labels[value] ?? label(value)
}

function maybeText(value?: string) {
  return value && value.trim() ? value.trim() : null
}

function statusPillTone(status?: string): 'success' | 'danger' | 'rose' {
  if (status === 'live') return 'success'
  if (status === 'changes_requested') return 'danger'
  return 'rose'
}

export function StatusPill({ status }: { status?: string }) {
  const tone = statusPillTone(status)
  const toneClassName = tone === 'success' ? 'pib-pill-success' : tone === 'danger' ? 'pib-pill-danger' : 'pib-pill-rose'
  return (
    <span className={`pib-pill ${toneClassName} shrink-0 whitespace-nowrap`}>
      {clientStatusLabel(status)}
    </span>
  )
}

type ConnectionState = 'connected' | 'needs_reauth' | 'not_connected'

function connectionState(channel: YouTubeChannelWorkspace): ConnectionState {
  const accountStatus = channel.publishingReadiness?.accountStatus
  if (accountStatus === 'connected') return 'connected'
  if (accountStatus === 'needs_reauth' || accountStatus === 'revoked' || accountStatus === 'blocked') return 'needs_reauth'
  if (!accountStatus && channel.connectedAccountId) return 'connected'
  return 'not_connected'
}

const CONNECTION_CHIP: Record<ConnectionState, { label: string; className: string }> = {
  connected: { label: 'Connected', className: 'border-emerald-500/40 text-emerald-300' },
  needs_reauth: { label: 'Needs reconnect', className: 'border-amber-500/40 text-[var(--sc-ink-soft)]' },
  not_connected: { label: 'Not connected', className: 'border-[var(--color-pib-line)] text-[var(--color-pib-text-muted)]' },
}

export function ConnectionChip({ channel }: { channel: YouTubeChannelWorkspace }) {
  const state = connectionState(channel)
  const chip = CONNECTION_CHIP[state]
  return (
    <span className={`shrink-0 whitespace-nowrap rounded border px-2 py-1 text-[11px] font-label uppercase tracking-widest ${chip.className}`}>
      {chip.label}
    </span>
  )
}

export function channelNeedsReconnect(channel: YouTubeChannelWorkspace): boolean {
  return connectionState(channel) === 'needs_reauth'
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
    <article className="pib-card-section min-w-0 space-y-3 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="break-words font-headline text-lg text-[var(--color-pib-text)]">{channel.title}</h3>
          <p className="break-words text-sm text-[var(--color-pib-text-muted)]">{handle}</p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <StatusPill status={channel.status} />
          <ConnectionChip channel={channel} />
        </div>
      </div>
      {channel.contentPillars?.length ? (
        <div className="flex flex-wrap gap-2">
          {channel.contentPillars.slice(0, 4).map((pillar) => (
            <span key={pillar} className="pib-pill pib-pill-rose max-w-full break-words">
              {pillar}
            </span>
          ))}
        </div>
      ) : null}
      {channel.publishingReadiness ? (
        <div className="grid grid-cols-2 gap-2 text-xs text-[var(--color-pib-text-muted)] sm:grid-cols-4">
          <span className="min-w-0 break-words">Publishing: {label(channel.publishingReadiness.readiness)}</span>
          <span className="min-w-0 break-words">Account: {label(channel.publishingReadiness.accountStatus)}</span>
          <span className="min-w-0 break-words">API: {label(channel.publishingReadiness.apiProjectStatus)}</span>
          <span className="min-w-0 break-words">Privacy: {label(channel.publishingReadiness.defaultUploadPrivacy)}</span>
        </div>
      ) : null}
      {channel.clientNotes ? <p className="break-words text-sm text-[var(--color-pib-text-muted)]">{channel.clientNotes}</p> : null}
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
    <article className="pib-card-section min-w-0 space-y-4 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="break-words font-headline text-base leading-snug text-[var(--color-pib-text)]">{video.title}</h3>
          <p className="mt-1 break-words text-sm leading-relaxed text-[var(--color-pib-text-muted)]">{video.objective || label(video.videoType)}</p>
        </div>
        <StatusPill status={video.status} />
      </div>
      <div className="grid gap-2 text-xs leading-relaxed text-[var(--color-pib-text-muted)] sm:grid-cols-2">
        <span className="min-w-0 break-words">Format: {label(video.videoType)}</span>
        <span className="min-w-0 break-words">Approval: {clientStatusLabel(video.clientReview?.status)}</span>
        <span className="min-w-0 break-words">Input: {label(video.source?.intakeType)}</span>
        <span className="min-w-0 break-words">Length: {video.targetDurationSeconds ? `${video.targetDurationSeconds}s` : 'Open'}</span>
      </div>
      {video.clientNotes ? <p className="break-words rounded-[6px] bg-white/[0.04] p-3 text-sm text-[var(--color-pib-text)]">{video.clientNotes}</p> : null}
      {children ? <div className="flex flex-wrap gap-2 pt-1">{children}</div> : null}
    </article>
  )
}
