'use client'

import type { ReactNode } from 'react'
import type { YouTubeChannelWorkspace, YouTubeSeries, YouTubeVideoProject } from '@/lib/youtube-studio/types'

type YouTubeStudioWorkspaceShellSurface = 'admin' | 'portal'

interface YouTubeStudioWorkspaceShellProps {
  channels: YouTubeChannelWorkspace[]
  videos: YouTubeVideoProject[]
  series: YouTubeSeries[]
  surface: YouTubeStudioWorkspaceShellSurface
  eyebrow: string
  title?: string
  description: string
  notice?: string
  loading?: boolean
  className?: string
  children?: ReactNode
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="pib-card-section px-4 py-3 text-center">
      <p className="text-xs text-on-surface-variant">{label}</p>
      <p className="text-xl font-bold text-on-surface">{value}</p>
    </div>
  )
}

export function YouTubeStudioWorkspaceShell({
  channels,
  videos,
  series,
  surface,
  eyebrow,
  title = 'YouTube Studio',
  description,
  notice = '',
  loading = false,
  className = '',
  children,
}: YouTubeStudioWorkspaceShellProps) {
  const reviewCount = videos.filter(
    (video) => video.status === 'client_review' || video.clientReview?.status === 'requested'
  ).length
  const publishReady = videos.filter((video) => video.status === 'publish_ready').length
  const liveCount = videos.filter((video) => video.status === 'live').length

  if (loading) {
    return (
      <main className={['mx-auto max-w-7xl space-y-6', className].filter(Boolean).join(' ')}>
        <div className="pib-skeleton h-96" />
      </main>
    )
  }

  return (
    <main className={['mx-auto max-w-7xl space-y-6', className].filter(Boolean).join(' ')}>
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="eyebrow">{eyebrow}</p>
          <h1 className="text-3xl font-headline font-bold text-[var(--color-pib-text)]">{title}</h1>
          <p className="mt-2 max-w-3xl text-sm text-[var(--color-pib-text-muted)]">{description}</p>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <StatCard label="Channels" value={channels.length} />
          <StatCard label="Series" value={series.length} />
          <StatCard label={surface === 'admin' ? 'Review' : 'To review'} value={reviewCount} />
          <StatCard label={surface === 'admin' ? 'Publish' : 'Live'} value={surface === 'admin' ? publishReady : liveCount} />
        </div>
      </div>

      {notice ? (
        <div className="rounded-2xl border border-[var(--color-pib-line)] bg-[var(--color-pib-card)] p-4 text-sm text-[var(--color-pib-text)]">
          {notice}
        </div>
      ) : null}

      {children}
    </main>
  )
}
