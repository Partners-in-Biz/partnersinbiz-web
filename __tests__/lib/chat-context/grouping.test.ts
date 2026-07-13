import { classifyActivity, groupActivity } from '@/lib/chat-context/grouping'
import type { ContextActivitySummary } from '@/lib/chat-context/types'

const activity = (id: string, type: ContextActivitySummary['type']): ContextActivitySummary => ({
  id, type, label: id, occurredAt: '2026-07-13T10:00:00.000Z',
})

describe('chat context activity grouping', () => {
  it.each(['pickup', 'running', 'waiting', 'dependency_released'] as const)('treats %s as routine', type => {
    expect(classifyActivity(activity(type, type))).toBe('routine')
  })

  it.each(['failure', 'blocked', 'approval_required', 'input_required', 'review_required', 'verified_complete'] as const)('treats %s as interrupting', type => {
    expect(classifyActivity(activity(type, type))).toBe('interrupting')
  })

  it('partitions routine updates from visible interruptions', () => {
    expect(groupActivity([activity('progress', 'running'), activity('help', 'input_required')])).toEqual({
      routine: [activity('progress', 'running')],
      interrupting: [activity('help', 'input_required')],
    })
  })

  it('preserves order within groups and handles an empty feed', () => {
    expect(groupActivity([])).toEqual({ routine: [], interrupting: [] })
    expect(groupActivity([
      activity('first', 'running'), activity('interrupt-1', 'failure'),
      activity('second', 'waiting'), activity('interrupt-2', 'review_required'),
    ])).toEqual({
      routine: [activity('first', 'running'), activity('second', 'waiting')],
      interrupting: [activity('interrupt-1', 'failure'), activity('interrupt-2', 'review_required')],
    })
  })
})
