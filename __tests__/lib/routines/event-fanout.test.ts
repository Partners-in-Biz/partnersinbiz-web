import { eventMatchesFilter, matchEventRoutines } from '@/lib/routines/event-fanout'
import type { RoutineEventPayload } from '@/lib/routines/types'

describe('eventMatchesFilter / matchEventRoutines', () => {
  const event: RoutineEventPayload = {
    source: 'pib',
    eventId: 'e1',
    summary: 'Won',
    filter: { type: 'deal.stage_changed', stage: 'won', pipeline: 'sales' },
  }

  it('matches when every filter key equals the event value', () => {
    expect(eventMatchesFilter({ type: 'deal.stage_changed', stage: 'won' }, event)).toBe(true)
  })

  it('rejects mismatched filters', () => {
    expect(eventMatchesFilter({ type: 'deal.stage_changed', stage: 'lost' }, event)).toBe(false)
  })

  it('filters routines by source and filter map', () => {
    const routines = [
      { trigger: { kind: 'event' as const, source: 'pib' as const, filter: { stage: 'won' } } },
      { trigger: { kind: 'event' as const, source: 'github' as const, filter: { stage: 'won' } } },
      { trigger: { kind: 'schedule' as const } },
    ]
    expect(matchEventRoutines(routines, event)).toHaveLength(1)
  })
})
