'use client'

import { Icon } from '@/components/studio'
import { briefingWorkLane, type BriefingWorkKind } from '@/lib/briefing/workKind'

export type LaneEmptyCopy = { title: string; body: string }

const LANE_EMPTY_COPY: Record<BriefingWorkKind, LaneEmptyCopy> = {
  meeting: { title: 'No calls to prepare', body: 'Booked calls and meeting prep land here.' },
  reply: { title: 'Inbox is clear', body: 'Emails, social DMs, tickets and forms waiting on you land here.' },
  approval: { title: 'Nothing to approve', body: 'Posts, documents, quotes and agent output waiting for sign-off land here.' },
  agent: { title: 'Agents are quiet', body: 'Running and queued agent work lands here.' },
  blocked: { title: 'Nothing is blocked', body: 'Stuck tasks, failed runs and overdue items land here.' },
}

/** Pure lookup so the desk and tests can reuse the copy without rendering. */
export function laneEmptyCopy(kind: BriefingWorkKind): LaneEmptyCopy {
  return LANE_EMPTY_COPY[kind] ?? LANE_EMPTY_COPY.reply
}

/** Compact, centred empty state for a work lane with nothing waiting. */
export function LaneEmptyState({ kind }: { kind: BriefingWorkKind }) {
  const lane = briefingWorkLane(kind)
  const copy = laneEmptyCopy(kind)
  return (
    <div
      role="status"
      data-testid="lane-empty-state"
      data-work-kind={kind}
      className="flex flex-col items-center justify-center gap-1 px-4 py-6 text-center"
    >
      <span className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-500">
        <Icon name={lane.icon} className="text-[18px]" />
      </span>
      <p className="text-[12px] font-medium text-[var(--color-pib-text)]">{copy.title}</p>
      <p className="max-w-64 text-[11px] leading-snug text-[var(--color-pib-text-muted)]">{copy.body}</p>
    </div>
  )
}
