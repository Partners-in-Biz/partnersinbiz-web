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
    label: 'Requested',
    statuses: ['intake', 'briefing'],
    emptyHint: 'Requested videos appear here first.',
  },
  {
    key: 'production',
    label: 'PiB producing',
    statuses: ['production', 'internal_review'],
    emptyHint: 'PiB is not producing a video right now.',
  },
  {
    key: 'review',
    label: 'Your review',
    statuses: ['client_review', 'changes_requested'],
    emptyHint: 'Drafts waiting for your decision appear here.',
  },
  {
    key: 'ready',
    label: 'Ready to publish',
    statuses: ['publish_ready', 'scheduled'],
    emptyHint: 'Approved videos queue here before publishing.',
  },
  {
    key: 'live',
    label: 'Live',
    statuses: ['live'],
    emptyHint: 'Published videos land here with repurpose actions.',
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
  return <span className="text-xs text-on-surface-variant">PiB is preparing this</span>
}

export function YouTubeStudioPipelineBoard({ videos, onReview, onRepurpose }: YouTubeStudioPipelineBoardProps) {
  if (videos.length === 0) {
    return (
      <div className="pib-card-section p-6 text-sm text-on-surface-variant">
        No active video work yet. Request a PiB video or create an edit project to start the workflow.
      </div>
    )
  }

  return (
    <div className="grid gap-4 overflow-x-auto xl:grid-cols-5">
      {COLUMNS.map((column) => {
        const columnVideos = videos.filter((video) => column.statuses.includes(video.status))
        return (
          <section key={column.key} className="min-w-[280px] space-y-3">
            <h3 className="flex items-center justify-between gap-3 text-xs font-label uppercase tracking-widest text-on-surface-variant">
              <span>{column.label}</span>
              <span aria-label={`${column.label} count`}>({columnVideos.length})</span>
            </h3>
            {columnVideos.length === 0 ? (
              <div className="rounded-lg border border-dashed border-[var(--color-pib-line)] p-4 text-xs leading-relaxed text-on-surface-variant">
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
