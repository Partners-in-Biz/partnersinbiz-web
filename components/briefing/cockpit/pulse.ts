import type { BriefingCard, BriefingFeed } from './cockpitTypes'

export type PulseCounts = {
  needsPeet: number
  approvals: number
  review: number
  autoMoving: number
  followUp: number
  risk: number
}

export function computePulseCounts(feed: BriefingFeed | null): PulseCounts {
  const items = feed?.items ?? []
  const count = (pred: (c: BriefingCard) => boolean) => items.filter(pred).length
  return {
    needsPeet: count((c) => c.requiresAction === true || c.priority === 'needs-peet'),
    approvals: count((c) => c.userState?.status === 'pending-review' || c.priority === 'review'),
    review: count((c) => c.priority === 'review'),
    autoMoving: count((c) => c.priority === 'progress'),
    followUp: count((c) => c.priority === 'needs-peet' && !c.requiresAction),
    risk: count((c) => c.priority === 'client-risk' || c.priority === 'critical'),
  }
}

export function computeSinceLastLooked(feed: BriefingFeed | null, lastViewedAt: string | null) {
  const items = feed?.items ?? []
  if (!lastViewedAt) return { changedCount: items.length, changed: items }
  const cutoff = Date.parse(lastViewedAt)
  const changed = items.filter((c) => Date.parse(c.occurredAt) > cutoff)
  return { changedCount: changed.length, changed }
}
