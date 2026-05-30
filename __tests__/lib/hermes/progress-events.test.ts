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

  it('keeps command input and output fields for inline consoles', () => {
    const events = normalizeHermesEvent({
      event: 'tool.completed',
      tool: 'terminal',
      input: 'npm test',
      stdout: 'PASS',
      stderr: 'warn only',
      exit_code: 0,
      duration_ms: 127,
      timestamp: 123,
    })

    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      event: 'tool.completed',
      tool: 'terminal',
      input: 'npm test',
      stdout: 'PASS',
      stderr: 'warn only',
      exitCode: 0,
      durationMs: 127,
    })
  })
})
