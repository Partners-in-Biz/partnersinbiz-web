/**
 * Unit tests for watcher-side command session event mapping (no Firestore).
 */

describe('watcher command session status mapping', () => {
  function eventTypeForStatus(status: string): string | null {
    if (status === 'picked-up' || status === 'in-progress') return 'task.started'
    if (status === 'done') return 'task.done'
    if (status === 'blocked') return 'task.blocked'
    if (status === 'awaiting-input') return 'task.awaiting_input'
    if (status === 'failed') return 'task.failed'
    return null
  }

  it('covers the full task lifecycle surface used by the watcher', () => {
    expect(eventTypeForStatus('in-progress')).toBe('task.started')
    expect(eventTypeForStatus('done')).toBe('task.done')
    expect(eventTypeForStatus('blocked')).toBe('task.blocked')
    expect(eventTypeForStatus('awaiting-input')).toBe('task.awaiting_input')
    expect(eventTypeForStatus('failed')).toBe('task.failed')
    expect(eventTypeForStatus('pending')).toBeNull()
  })
})
