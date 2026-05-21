import { runAndPoll } from '../../../services/agent-watcher/src/hermes'

const cfg = { baseUrl: 'https://hermes.local/', apiKey: 'secret', enabled: true }

describe('agent watcher Hermes dispatch', () => {
  const originalFetch = global.fetch

  afterEach(() => {
    global.fetch = originalFetch
    jest.restoreAllMocks()
  })

  it('awaits the live run-id persistence callback before polling', async () => {
    const events: string[] = []
    const fetchMock = jest.fn(async (url: string | URL) => {
      const urlText = String(url)
      if (urlText.endsWith('/v1/runs')) {
        events.push('post')
        return new Response(JSON.stringify({ run_id: 'run-live-1' }), { status: 200 })
      }
      events.push(`poll:${events.includes('callback-done')}`)
      return new Response(JSON.stringify({ status: 'completed', output: 'finished' }), { status: 200 })
    })
    global.fetch = fetchMock as unknown as typeof fetch

    const result = await runAndPoll(cfg, {
      taskId: 'task-1',
      orgId: 'org-1',
      agentId: 'theo',
      spec: 'Do the work',
    }, async (runId) => {
      events.push(`callback:${runId}`)
      await new Promise((resolve) => setTimeout(resolve, 5))
      events.push('callback-done')
    })

    expect(result).toEqual({ runId: 'run-live-1', output: 'finished', error: null })
    expect(events).toEqual(['post', 'callback:run-live-1', 'callback-done', 'poll:true'])
  })

  it('returns the run id when a terminal Hermes run fails', async () => {
    global.fetch = jest.fn(async (url: string | URL) => {
      const urlText = String(url)
      if (urlText.endsWith('/v1/runs')) {
        return new Response(JSON.stringify({ id: 'run-failed-1' }), { status: 200 })
      }
      return new Response(JSON.stringify({ status: 'failed', error: 'boom' }), { status: 200 })
    }) as unknown as typeof fetch

    await expect(runAndPoll(cfg, {
      taskId: 'task-1',
      orgId: 'org-1',
      agentId: 'theo',
      spec: 'Do the work',
    })).resolves.toEqual({ runId: 'run-failed-1', output: null, error: 'boom' })
  })
})
