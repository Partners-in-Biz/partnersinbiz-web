// lib/analytics/goal-compute.ts (US-128 / US-142)
//
// Compute goal completions over real ingested data. A completion is counted
// once per session that satisfies the goal definition.

import type { EventRow, SessionRow, DateRange } from './query'
import { dailyBuckets, dayLabel, sessionDurationSec, channelOf } from './query'
import type { AnalyticsGoal } from './types'

export interface GoalCompletion {
  sessionId: string
  distinctId: string
  timestamp: number
  channel: string
}

/** Match a goal against the property's events/sessions; return completions. */
export function computeGoalCompletions(
  goal: Pick<AnalyticsGoal, 'type' | 'target' | 'minDuration'>,
  events: EventRow[],
  sessions: SessionRow[],
): GoalCompletion[] {
  const sessionById = new Map(sessions.map(s => [s.id, s]))
  const completed = new Set<string>()
  const out: GoalCompletion[] = []

  function channelFor(sessionId: string): string {
    const s = sessionById.get(sessionId)
    return s ? channelOf(s) : 'Direct'
  }

  if (goal.type === 'event') {
    for (const e of events) {
      if (e.event !== goal.target) continue
      if (completed.has(e.sessionId)) continue
      completed.add(e.sessionId)
      out.push({ sessionId: e.sessionId, distinctId: e.distinctId, timestamp: e.timestamp, channel: channelFor(e.sessionId) })
    }
  } else if (goal.type === 'pageview') {
    for (const e of events) {
      if (e.event !== '$pageview') continue
      const url = e.pageUrl ?? (e.properties?.['$current_url'] as string) ?? ''
      if (!url.includes(goal.target)) continue
      if (completed.has(e.sessionId)) continue
      completed.add(e.sessionId)
      out.push({ sessionId: e.sessionId, distinctId: e.distinctId, timestamp: e.timestamp, channel: channelFor(e.sessionId) })
    }
  } else if (goal.type === 'duration') {
    const min = goal.minDuration ?? 0
    for (const s of sessions) {
      if (sessionDurationSec(s) < min) continue
      out.push({ sessionId: s.id, distinctId: s.distinctId, timestamp: s.startedAt, channel: channelOf(s) })
    }
  }
  return out
}

export interface GoalSeriesPoint { date: string; completions: number; value: number }

export function goalTimeSeries(
  completions: GoalCompletion[],
  range: DateRange,
  goalValue: number,
): GoalSeriesPoint[] {
  const buckets = dailyBuckets(range)
  const counts = new Map<string, number>(buckets.map(b => [b, 0]))
  for (const c of completions) {
    const d = dayLabel(c.timestamp)
    if (counts.has(d)) counts.set(d, (counts.get(d) ?? 0) + 1)
  }
  return buckets.map(d => ({ date: d, completions: counts.get(d) ?? 0, value: (counts.get(d) ?? 0) * goalValue }))
}

export interface ChannelRevenue { channel: string; completions: number; value: number }

export function revenueByChannel(completions: GoalCompletion[], goalValue: number): ChannelRevenue[] {
  const m = new Map<string, number>()
  for (const c of completions) m.set(c.channel, (m.get(c.channel) ?? 0) + 1)
  return [...m.entries()]
    .map(([channel, n]) => ({ channel, completions: n, value: n * goalValue }))
    .sort((a, b) => b.value - a.value)
}
