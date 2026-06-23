import type { FunnelStep, FunnelWindow, FunnelResults } from './types'
import { WINDOW_MS as WMS } from './types'

interface RawEvent {
  event: string
  distinctId: string
  sessionId: string
  timestamp: number
  /** event properties — used for step property-filter matching */
  properties?: Record<string, unknown>
  /** session attributes — used for segment filtering */
  device?: string | null
  utmSource?: string | null
  /** whether the distinctId is a returning visitor (>1 session in window) */
  returning?: boolean
}

export interface FunnelSegment {
  visitorType?: 'all' | 'new' | 'returning'
  device?: string | null
  source?: string | null
}

/** Does an event's properties satisfy a step's filter map (exact match)? */
function matchesStepFilters(ev: RawEvent, filters?: Record<string, unknown>): boolean {
  if (!filters) return true
  const props = ev.properties ?? {}
  for (const [k, v] of Object.entries(filters)) {
    if (props[k] !== v) return false
  }
  return true
}

/** Does an event (via its session attributes) satisfy the segment filter? */
function matchesSegment(ev: RawEvent, segment?: FunnelSegment | null): boolean {
  if (!segment) return true
  if (segment.device && ev.device !== segment.device) return false
  if (segment.source && (ev.utmSource ?? '(direct)') !== segment.source) return false
  if (segment.visitorType && segment.visitorType !== 'all') {
    const isReturning = ev.returning === true
    if (segment.visitorType === 'returning' && !isReturning) return false
    if (segment.visitorType === 'new' && isReturning) return false
  }
  return true
}

export function computeFunnelResults(
  events: RawEvent[],
  steps: FunnelStep[],
  window: FunnelWindow,
  segment?: FunnelSegment | null,
): FunnelResults {
  if (steps.length === 0) {
    return { steps: [], totalEntered: 0, totalConverted: 0 }
  }

  // US-133: enforce an 8-step cap defensively (UI also enforces it).
  const cappedSteps = steps.slice(0, 8)

  // Apply segment filter up-front so only qualifying events are considered.
  const filtered = segment ? events.filter(e => matchesSegment(e, segment)) : events

  // Group events by distinctId, sorted by timestamp
  const byUser = new Map<string, RawEvent[]>()
  for (const e of filtered) {
    const arr = byUser.get(e.distinctId) ?? []
    arr.push(e)
    byUser.set(e.distinctId, arr)
  }
  for (const arr of byUser.values()) arr.sort((a, b) => a.timestamp - b.timestamp)

  const windowMs = window !== 'session' ? WMS[window] : Infinity

  const stepCounts = new Array(cappedSteps.length).fill(0)

  for (const userEvents of byUser.values()) {
    let stepIdx = 0
    let lastStepTime = 0
    let lastSessionId = ''

    for (const ev of userEvents) {
      if (stepIdx >= cappedSteps.length) break
      const step = cappedSteps[stepIdx]
      // US-133: step property filters now applied.
      if (ev.event !== step.event) continue
      if (!matchesStepFilters(ev, step.filters)) continue

      if (stepIdx === 0) {
        lastStepTime = ev.timestamp
        lastSessionId = ev.sessionId
        stepCounts[0]++
        stepIdx++
      } else if (window === 'session') {
        if (ev.sessionId === lastSessionId) {
          lastStepTime = ev.timestamp
          stepCounts[stepIdx]++
          stepIdx++
        }
      } else {
        if (ev.timestamp - lastStepTime <= windowMs) {
          lastStepTime = ev.timestamp
          lastSessionId = ev.sessionId
          stepCounts[stepIdx]++
          stepIdx++
        }
      }
    }
  }

  const resultSteps = cappedSteps.map((s, i) => ({
    event: s.event,
    count: stepCounts[i],
    conversionFromPrev: i === 0
      ? null
      : stepCounts[i - 1] > 0
        ? Math.round((stepCounts[i] / stepCounts[i - 1]) * 10000) / 100
        : 0,
  }))

  return {
    steps: resultSteps,
    totalEntered: stepCounts[0],
    totalConverted: stepCounts[cappedSteps.length - 1],
  }
}
