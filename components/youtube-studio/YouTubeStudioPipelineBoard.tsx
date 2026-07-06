'use client'

import type { YouTubeVideoProject, YouTubeVideoStatus } from '@/lib/youtube-studio/types'
import { YouTubeVideoCard } from '@/components/youtube-studio/YouTubeStudioCards'

interface PipelineColumn {
  key: string
  label: string
  statuses: YouTubeVideoStatus[]
  emptyHint: string
}

const COLUMNS: PipelineColumn[] = [
  {
    key: 'idea',
    label: 'Idea & scripting',
    statuses: ['intake', 'briefing'],
    emptyHint: 'Nothing here yet — request a video to start the pipeline.',
  },
  {
    key: 'production',
    label: 'Production',
    statuses: ['production', 'internal_review'],
    emptyHint: 'Nothing here yet — approved briefs move into production automatically.',
  },
  {
    key: 'review',
    label: 'Client review',
    statuses: ['client_review', 'changes_requested'],
    emptyHint: 'Nothing here yet — drafts appear here when they are ready for your review.',
  },
  {
    key: 'ready',
    label: 'Publish ready',
    statuses: ['publish_ready', 'scheduled'],
    emptyHint: 'Nothing here yet — approved videos queue here before publishing.',
  },
  {
    key: 'live',
    label: 'Live',
    statuses: ['live'],
    emptyHint: 'Nothing here yet — published videos land here with repurpose actions.',
  },
]

interface YouTubeStudioPipelineBoardProps {
  videos: YouTubeVideoProject[]
  /** Jump to / open the review UI for a video in client review. */
  onReview: (videoId: string) => void
  /** Create social drafts from a live video (Task 10 endpoint). */
  onRepurpose: (videoId: string) => void
}

function nextAction(video: YouTubeVideoProject, onReview: (id: string) => void, onRepurpose: (id: string) => void) {
  if (!video.id) return null
  if (video.status === 'client_review' || video.status === 'changes_requested') {
    return (
      <button type="button" onClick={() => onReview(video.id!)} className="pib-btn-primary text-sm">
        Review &amp; approve
      </button>
    )
  }
  if (video.status === 'live') {
    return (
      <button type="button" onClick={() => onRepurpose(video.id!)} className="pib-btn-ghost text-sm">
        Repurpose to social
      </button>
    )
  }
  if (video.status === 'publish_ready' || video.status === 'scheduled') {
    return <span className="text-xs text-on-surface-variant">Awaiting PiB publish</span>
  }
  return <span className="text-xs text-on-surface-variant">PiB is working on this</span>
}

export function YouTubeStudioPipelineBoard({ videos, onReview, onRepurpose }: YouTubeStudioPipelineBoardProps) {
  return (
    <div className="grid gap-4 overflow-x-auto lg:grid-cols-5">
      {COLUMNS.map((column) => {
        const columnVideos = videos.filter((video) => column.statuses.includes(video.status))
        return (
          <section key={column.key} className="min-w-[240px] space-y-3">
            <h3 className="flex items-center justify-between gap-2 text-xs font-label uppercase tracking-widest text-on-surface-variant">
              <span>{column.label}</span>
              <span aria-label={`${column.label} count`}>({columnVideos.length})</span>
            </h3>
            {columnVideos.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-[var(--color-pib-line)] p-4 text-xs text-on-surface-variant">
                {column.emptyHint}
              </div>
            ) : (
              columnVideos.map((video) => (
                <YouTubeVideoCard key={video.id ?? video.title} video={video}>
                  {nextAction(video, onReview, onRepurpose)}
                </YouTubeVideoCard>
              ))
            )}
          </section>
        )
      })}
    </div>
  )
}
