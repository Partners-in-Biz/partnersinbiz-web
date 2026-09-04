import { listEnabledEventRoutines } from './store'
import { fireRoutineForEvent } from './service'
import type { RoutineEventPayload } from './types'

type EventMatchTrigger = {
  kind: string
  source?: string
  filter?: Record<string, string>
}

/**
 * Match event filter keys — every key in `filter` must equal the corresponding
 * value in `event.filter` (or `event.data` string fields as fallback).
 */
export function eventMatchesFilter(
  filter: Record<string, string>,
  event: RoutineEventPayload,
): boolean {
  const keys = Object.keys(filter)
  if (keys.length === 0) return true
  for (const key of keys) {
    const expected = filter[key]
    const fromFilter = event.filter?.[key]
    const fromData = event.data && typeof event.data[key] === 'string'
      ? (event.data[key] as string)
      : undefined
    const actual = fromFilter ?? fromData
    if (actual !== expected) return false
  }
  return true
}

export function matchEventRoutines<T extends { trigger: EventMatchTrigger }>(
  routines: T[],
  event: RoutineEventPayload,
): T[] {
  return routines.filter((routine) => {
    if (routine.trigger.kind !== 'event') return false
    if (routine.trigger.source !== event.source) return false
    return eventMatchesFilter(routine.trigger.filter ?? {}, event)
  })
}

/**
 * Best-effort fan-out: match enabled event routines for the org and fire them.
 * Never throws to callers — logs and swallows so webhook/API paths stay up.
 */
export async function fanoutRoutineEvent(
  orgId: string,
  event: RoutineEventPayload,
): Promise<{ matched: number; fired: number }> {
  try {
    const candidates = await listEnabledEventRoutines(orgId, event.source)
    const matched = matchEventRoutines(candidates, event)
    let fired = 0
    for (const routine of matched) {
      try {
        const run = await fireRoutineForEvent(routine, event)
        if (run) fired += 1
      } catch (err) {
        console.error('[routines-fanout]', routine.routineId, err)
      }
    }
    return { matched: matched.length, fired }
  } catch (err) {
    console.error('[routines-fanout]', orgId, err)
    return { matched: 0, fired: 0 }
  }
}
