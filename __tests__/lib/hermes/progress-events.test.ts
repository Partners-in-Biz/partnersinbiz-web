import { normalizeHermesEvent } from '@/lib/hermes/progress-events'

describe('normalizeHermesEvent', () => {
  it('preserves assistant delta whitespace exactly', () => {
    const events = normalizeHermesEvent({
      event: 'message.delta',
      run_id: 'run_1',
      delta: ' hello ',
      timestamp: 123,
    })

    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      event: 'assistant.text_delta',
      runId: 'run_1',
      run_id: 'run_1',
      delta: ' hello ',
      text: ' hello ',
      preview: ' hello ',
    })
  })

  it('preserves whitespace-only assistant deltas', () => {
    const events = normalizeHermesEvent({
      event: 'message.delta',
      delta: ' ',
      timestamp: 123,
    })

    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      event: 'assistant.text_delta',
      delta: ' ',
      text: ' ',
      preview: ' ',
    })
  })
})
