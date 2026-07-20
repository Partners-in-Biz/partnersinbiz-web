'use client'

import type { ReactNode } from 'react'
import type { YouTubeChannelWorkspace, YouTubeSeries, YouTubeVideoProject } from '@/lib/youtube-studio/types'
import { PageHeader, Surface } from '@/components/ui/AppFoundation'
import { StatCard } from '@/components/ui/StatCard'

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
      <main className={['mx-auto max-w-7xl space-y-4', className].filter(Boolean).join(' ')}>
        <div className="pib-skeleton h-96" />
      </main>
    )
  }

  return (
    <main className={['mx-auto max-w-7xl space-y-4', className].filter(Boolean).join(' ')} data-module-accent="rose">
      <PageHeader
        accent="rose"
        eyebrow={eyebrow}
        title={title}
        description={description}
        meta={(
          <div className="grid w-full max-w-xl grid-cols-2 gap-2 sm:grid-cols-4">
            <StatCard accent="rose" icon="subscriptions" label="Channels" value={channels.length} />
            <StatCard accent="rose" icon="video_library" label="Series" value={series.length} />
            <StatCard accent="rose" icon="rate_review" label={surface === 'admin' ? 'Review' : 'To review'} value={reviewCount} />
            <StatCard accent="rose" icon="play_circle" label={surface === 'admin' ? 'Publish' : 'Live'} value={surface === 'admin' ? publishReady : liveCount} />
          </div>
        )}
      />

      {notice ? (
        <Surface className="p-3 text-sm text-[var(--color-pib-text)]">{notice}</Surface>
      ) : null}

      {children}
    </main>
  )
}
