'use client'

import type { YouTubeChannelWorkspace } from '@/lib/youtube-studio/types'
import { channelNeedsReconnect, ConnectionChip } from '@/components/youtube-studio/YouTubeStudioCards'

interface YouTubeStudioChannelHeaderProps {
  channels: YouTubeChannelWorkspace[]
  /** null = all channels */
  selectedChannelId: string | null
  onSelect: (channelId: string | null) => void
  oauthHref: string
  linkAnotherChannelHref: string
}

export function YouTubeStudioChannelHeader({
  channels,
  selectedChannelId,
  onSelect,
  oauthHref,
  linkAnotherChannelHref,
}: YouTubeStudioChannelHeaderProps) {
  const selected = channels.find((channel) => channel.id === selectedChannelId) ?? null

  if (channels.length === 0) {
    return (
      <section className="pib-card-section flex flex-wrap items-center justify-between gap-3 p-4">
        <p className="text-sm text-[var(--color-pib-text-muted)]">No YouTube channel is connected yet. Linking a channel unlocks requests, edits, and publishing.</p>
        <a href={oauthHref} className="pib-btn-primary text-sm">Link YouTube channel</a>
      </section>
    )
  }

  return (
    <section className="pib-card-section flex flex-wrap items-center gap-3 p-4">
      <label className="flex min-w-0 items-center gap-2 text-sm text-[var(--color-pib-text-muted)]">
        <span className="pib-label">Channel</span>
        <select
          aria-label="Channel"
          value={selectedChannelId ?? ''}
          onChange={(event) => onSelect(event.target.value || null)}
          className="pib-select"
        >
          <option value="">All channels ({channels.length})</option>
          {channels.map((channel) => (
            <option key={channel.id} value={channel.id ?? ''}>
              {channel.title || channel.youtubeHandle || 'YouTube channel'}
            </option>
          ))}
        </select>
      </label>
      {selected ? (
        <div className="flex min-w-0 items-center gap-2">
          <ConnectionChip channel={selected} />
          {selected.youtubeHandle ? (
            <span className="truncate text-xs text-[var(--color-pib-text-muted)]">{selected.youtubeHandle}</span>
          ) : null}
          {channelNeedsReconnect(selected) ? (
            <a href={oauthHref} className="pib-btn-primary text-sm">Reconnect</a>
          ) : null}
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          {channels.map((channel) => (
            <span key={channel.id} className="flex items-center gap-1 text-xs text-[var(--color-pib-text-muted)]">
              <span className="max-w-[10rem] truncate">{channel.title}</span>
              <ConnectionChip channel={channel} />
            </span>
          ))}
        </div>
      )}
      <a href={linkAnotherChannelHref} className="pib-btn-ghost ml-auto text-sm">Link another channel</a>
    </section>
  )
}
