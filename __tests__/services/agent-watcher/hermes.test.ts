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

    expect(result).toMatchObject({ runId: 'run-live-1', output: 'finished', error: null })
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
    })).resolves.toMatchObject({ runId: 'run-failed-1', output: null, error: 'boom' })
  })

  it('sends effort and model overrides as top-level run fields', async () => {
    let postedBody: Record<string, unknown> | null = null
    global.fetch = jest.fn(async (url: string | URL, init?: RequestInit) => {
      const urlText = String(url)
      if (urlText.endsWith('/v1/runs')) {
        postedBody = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
        return new Response(JSON.stringify({ id: 'run-routed-1' }), { status: 200 })
      }
      return new Response(JSON.stringify({ status: 'completed', output: 'done' }), { status: 200 })
    }) as unknown as typeof fetch

    await expect(runAndPoll(cfg, {
      taskId: 'task-1',
      orgId: 'org-1',
      agentId: 'theo',
      spec: 'Do the work',
      agentEffort: 'high',
      agentModel: 'claude-sonnet-4-6',
    })).resolves.toMatchObject({ runId: 'run-routed-1', output: 'done', error: null })

    expect(postedBody).toEqual(expect.objectContaining({
      reasoning_effort: 'high',
      model: 'claude-sonnet-4-6',
      metadata: expect.objectContaining({
        taskId: 'task-1',
        orgId: 'org-1',
        agentId: 'theo',
      }),
    }))
  })

  it('returns exact upstream model token and cost telemetry from terminal Hermes payloads', async () => {
    global.fetch = jest.fn(async (url: string | URL) => {
      const urlText = String(url)
      if (urlText.endsWith('/v1/runs')) {
        return new Response(JSON.stringify({ id: 'run-metered-1', model: 'openai/gpt-5.1' }), { status: 200 })
      }
      return new Response(JSON.stringify({
        status: 'completed',
        output: 'done',
        model: 'openai/gpt-5.1',
        usage: {
          input_tokens: 1200,
          output_tokens: 320,
          total_tokens: 1800,
          output_tokens_details: {
            reasoning_tokens: 280,
          },
        },
        billing: {
          cost_usd: 0.0425,
        },
      }), { status: 200 })
    }) as unknown as typeof fetch

    await expect(runAndPoll(cfg, {
      taskId: 'task-1',
      orgId: 'org-1',
      agentId: 'theo',
      spec: 'Do the work',
      agentModel: 'openai/gpt-5.1',
      agentEffort: 'high',
    })).resolves.toMatchObject({
      runId: 'run-metered-1',
      output: 'done',
      error: null,
      telemetry: {
        model: 'openai/gpt-5.1',
        reasoningEffort: 'high',
        inputTokens: 1200,
        outputTokens: 320,
        reasoningTokens: 280,
        totalTokens: 1800,
        costUsd: 0.0425,
        tokenSource: 'upstream',
        costSource: 'upstream',
        exactTokenUsageAvailable: true,
        exactCostAvailable: true,
        exactUsageAvailable: true,
      },
    })
  })

  it('marks exact token and cost telemetry unavailable when Hermes does not expose usage', async () => {
    global.fetch = jest.fn(async (url: string | URL) => {
      const urlText = String(url)
      if (urlText.endsWith('/v1/runs')) {
        return new Response(JSON.stringify({ id: 'run-unmetered-1' }), { status: 200 })
      }
      return new Response(JSON.stringify({ status: 'completed', output: 'done' }), { status: 200 })
    }) as unknown as typeof fetch

    await expect(runAndPoll(cfg, {
      taskId: 'task-1',
      orgId: 'org-1',
      agentId: 'theo',
      spec: 'Do the work',
      agentModel: 'claude-sonnet-4-6',
      agentEffort: 'medium',
    })).resolves.toMatchObject({
      runId: 'run-unmetered-1',
      output: 'done',
      error: null,
      telemetry: {
        model: 'claude-sonnet-4-6',
        reasoningEffort: 'medium',
        inputTokens: null,
        outputTokens: null,
        totalTokens: null,
        costUsd: null,
        tokenSource: 'unavailable',
        costSource: 'unavailable',
        exactTokenUsageAvailable: false,
        exactCostAvailable: false,
        exactUsageAvailable: false,
        missing: expect.arrayContaining(['token_usage', 'cost_usd']),
      },
    })
  })
})
