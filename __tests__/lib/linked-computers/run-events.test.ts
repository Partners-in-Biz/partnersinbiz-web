import {
  createLinkedComputerRunSseStream,
  sanitizeLinkedRunChatEvents,
} from '@/lib/linked-computers/run-events'

describe('linked computer run events', () => {
  it('sanitizes forwarded Hermes tool events for browser streaming', () => {
    const events = sanitizeLinkedRunChatEvents([
      { event: 'tool.started', tool: 'terminal', input: 'ls', timestamp: 1 },
      { event: 'tool.completed', tool: 'terminal', output: 'ok', timestamp: 2 },
    ], 'job-1')
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({ event: 'tool.started', tool: 'terminal', runId: 'job-1' }),
      expect.objectContaining({ event: 'tool.completed', tool: 'terminal', runId: 'job-1' }),
    ]))
  })

  it('streams linked job activity instead of stream.unavailable', async () => {
    let polls = 0
    const stream = createLinkedComputerRunSseStream('job-mac', {
      pollMs: 10,
      getSnapshot: async () => {
        polls += 1
        if (polls === 1) {
          return {
            exists: true,
            status: 'running',
            machineLabel: 'PEETS-MAC-MINI.LOCAL',
            chatEvents: [],
          }
        }
        return {
          exists: true,
          status: 'completed',
          machineLabel: 'PEETS-MAC-MINI.LOCAL',
          chatEvents: [
            { event: 'tool.started', tool: 'read_file', timestamp: 10, runId: 'job-mac' },
          ],
        }
      },
    })

    const reader = stream.getReader()
    const decoder = new TextDecoder()
    let text = ''
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      text += decoder.decode(value, { stream: true })
      if (text.includes('run.completed')) break
    }

    expect(text).toContain('Running on PEETS-MAC-MINI.LOCAL')
    expect(text).toContain('read_file')
    expect(text).toContain('run.completed')
    expect(text).not.toContain('stream.unavailable')
  })

  it('emits the terminal error directly instead of a final still-working heartbeat', async () => {
    const stream = createLinkedComputerRunSseStream('job-failed', {
      pollMs: 10,
      getSnapshot: async () => ({
        exists: true,
        status: 'expired',
        error: 'The linked computer authorization changed while this run was active. Please retry.',
        chatEvents: [],
      }),
    })
    const reader = stream.getReader()
    const { value } = await reader.read()
    const event = JSON.parse(new TextDecoder().decode(value).replace(/^data: /, '').trim())

    expect(event).toEqual(expect.objectContaining({
      event: 'run.failed',
      error: 'The linked computer authorization changed while this run was active. Please retry.',
    }))
    expect(event.activity).not.toMatch(/still working/i)
  })
})
