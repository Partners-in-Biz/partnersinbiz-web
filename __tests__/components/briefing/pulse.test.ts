import { computePulseCounts, computeSinceLastLooked } from '@/components/briefing/cockpit/pulse'
import type { BriefingCard, BriefingFeed } from '@/components/briefing/cockpit/cockpitTypes'

function card(p: Partial<BriefingCard>): BriefingCard {
  return { id: 'x', orgId: 'o', priority: 'fyi', title: 't', summary: 's', source: { type: 'task', id: '1' }, actor: { id: 'a' }, context: { orgId: 'o' }, occurredAt: '2026-06-18T08:00:00Z', ...p } as BriefingCard
}

describe('computePulseCounts', () => {
  it('counts needs-peet, approvals, review, and auto-moving lanes', () => {
    const feed: BriefingFeed = { items: [
      card({ id: '1', requiresAction: true, priority: 'needs-peet' }),
      card({ id: '2', priority: 'review' }),
      card({ id: '3', priority: 'progress' }),
    ], total: 3, hasMore: false, generatedAt: '2026-06-18T08:00:00Z' }
    const counts = computePulseCounts(feed)
    expect(counts.needsPeet).toBe(1)
    expect(counts.review).toBe(1)
    expect(counts.autoMoving).toBe(1)
  })
})

describe('computeSinceLastLooked', () => {
  it('lists items that occurred after the last-viewed timestamp', () => {
    const feed: BriefingFeed = { items: [
      card({ id: 'new', occurredAt: '2026-06-18T09:00:00Z', title: 'New thing' }),
      card({ id: 'old', occurredAt: '2026-06-18T06:00:00Z', title: 'Old thing' }),
    ], total: 2, hasMore: false, generatedAt: '2026-06-18T09:00:00Z' }
    const result = computeSinceLastLooked(feed, '2026-06-18T08:00:00Z')
    expect(result.changedCount).toBe(1)
    expect(result.changed.map((c) => c.id)).toEqual(['new'])
  })
  it('treats a null last-viewed as everything being new', () => {
    const feed: BriefingFeed = { items: [card({ id: 'a' })], total: 1, hasMore: false, generatedAt: '2026-06-18T09:00:00Z' }
    expect(computeSinceLastLooked(feed, null).changedCount).toBe(1)
  })
})
