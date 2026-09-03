'use client'

import type { ReactNode } from 'react'
import { WORK_QUEUE_GROUPS, type WorkQueueGroups, type WorkQueueItem } from '@/lib/youtube-studio/work-queue'
import { StatusPill, YouTubeVideoCard } from '@/components/youtube-studio/YouTubeStudioCards'

interface YouTubeStudioWorkQueueProps {
  groups: WorkQueueGroups
  renderItemActions: (item: WorkQueueItem) => ReactNode
}

const KIND_LABEL: Record<WorkQueueItem['kind'], string> = {
  video: 'Video',
  packet: 'Publishing packet',
  production_draft: 'Production draft',
  render_job: 'Video cut',
}

function itemStatus(item: WorkQueueItem): string | undefined {
  return item.video?.status ?? item.packet?.status ?? item.draft?.status ?? item.renderJob?.status
}

function WorkQueueItemCard({ item, actions }: { item: WorkQueueItem; actions: ReactNode }) {
  if (item.kind === 'video' && item.video) {
    return <YouTubeVideoCard video={item.video}>{actions}</YouTubeVideoCard>
  }
  const previewUrl = item.renderJob?.output?.previewUrl || item.renderJob?.output?.downloadUrl
  return (
    <article className="pib-card-section min-w-0 space-y-3 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-label uppercase tracking-widest text-[var(--color-pib-text-muted)]">{KIND_LABEL[item.kind]}</p>
          <h4 className="break-words font-headline text-base text-[var(--color-pib-text)]">{item.title}</h4>
        </div>
        <StatusPill status={itemStatus(item)} />
      </div>
      {previewUrl ? (
        <a href={previewUrl} target="_blank" rel="noreferrer" className="pib-btn-ghost text-sm">Watch preview</a>
      ) : null}
      {actions ? <div className="flex flex-wrap gap-2 pt-1">{actions}</div> : null}
    </article>
  )
}

export function YouTubeStudioWorkQueue({ groups, renderItemActions }: YouTubeStudioWorkQueueProps) {
  const totalItems = WORK_QUEUE_GROUPS.reduce((sum, group) => sum + groups[group.key].length, 0)

  if (totalItems === 0) {
    return (
      <div className="pib-card-section p-6 text-sm text-[var(--color-pib-text-muted)]">
        No video work yet. Create a video edit or request a PiB video to start the workflow.
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {WORK_QUEUE_GROUPS.map((group) => {
        const items = groups[group.key]
        return (
          <section key={group.key} className="space-y-3">
            <h3 className="flex items-center gap-2 font-headline text-lg text-[var(--color-pib-text)]">
              {group.label}
              <span className="text-sm font-normal text-[var(--color-pib-text-muted)]">({items.length})</span>
            </h3>
            {items.length === 0 ? (
              <p className="rounded-lg border border-dashed border-[var(--color-pib-line)] p-3 text-xs text-[var(--color-pib-text-muted)]">
                {group.emptyHint}
              </p>
            ) : (
              <div className="grid gap-3 lg:grid-cols-2">
                {items.map((item) => (
                  <WorkQueueItemCard key={item.key} item={item} actions={renderItemActions(item)} />
                ))}
              </div>
            )}
          </section>
        )
      })}
    </div>
  )
}
