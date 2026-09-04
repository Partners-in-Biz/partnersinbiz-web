import {
  applyConversationLifecycle,
  clearTabActivity,
  messageIndicatesInFlightRun,
  messagesIndicateInFlightRun,
  nextTabActivity,
  shouldUseBackgroundRunPolling,
} from '@/lib/messages/tab-activity'

describe('tab activity state machine', () => {
  it('uses the polling fallback only while the realtime gateway is unavailable', () => {
    expect(shouldUseBackgroundRunPolling(false)).toBe(true)
    expect(shouldUseBackgroundRunPolling(true)).toBe(false)
  })

  it('keeps running while focused so background pulse works after leave', () => {
    expect(nextTabActivity(undefined, 'running', true)).toBe('running')
    expect(nextTabActivity('running', 'running', false)).toBe('running')
  })

  it('marks computer activity on background tabs', () => {
    expect(nextTabActivity(undefined, 'computer', false)).toBe('computer')
    expect(nextTabActivity('computer', 'completed', false)).toBe('unread')
  })

  it('marks unread when a background turn completes', () => {
    expect(nextTabActivity('running', 'completed', false)).toBe('unread')
  })

  it('clears to idle when a focused turn completes', () => {
    expect(nextTabActivity('running', 'completed', true)).toBe('idle')
  })

  it('applyConversationLifecycle writes and clears map entries', () => {
    const focused = new Set<string>(['conv-a'])
    let state = applyConversationLifecycle({}, { conversationId: 'conv-a', phase: 'running' }, focused)
    expect(state).toEqual({ 'conv-a': 'running' })

    state = applyConversationLifecycle(state, { conversationId: 'conv-a', phase: 'completed' }, focused)
    expect(state).toEqual({})

    state = applyConversationLifecycle(
      { 'conv-b': 'running' },
      { conversationId: 'conv-b', phase: 'completed' },
      new Set(),
    )
    expect(state).toEqual({ 'conv-b': 'unread' })
  })

  it('clearTabActivity drops attention for an opened tab', () => {
    expect(clearTabActivity({ 'conv-1': 'unread', 'conv-2': 'running' }, 'conv-1')).toEqual({
      'conv-2': 'running',
    })
  })

  it('detects in-flight assistant runs', () => {
    expect(messageIndicatesInFlightRun({
      role: 'assistant',
      runId: 'run-1',
      status: 'streaming',
    })).toBe(true)
    expect(messageIndicatesInFlightRun({
      role: 'assistant',
      runId: 'run-1',
      status: 'completed',
    })).toBe(false)
    expect(messagesIndicateInFlightRun([
      { role: 'user', status: 'completed' },
      { role: 'assistant', runId: 'run-1', status: 'queued' },
    ])).toBe(true)
  })
})
