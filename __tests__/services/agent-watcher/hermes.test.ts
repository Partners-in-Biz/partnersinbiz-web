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

  it('does not poll an accepted run when durable run-id persistence fails', async () => {
    global.fetch = jest.fn(async (url: string | URL) => {
      if (String(url).endsWith('/v1/runs')) {
        return new Response(JSON.stringify({ run_id: 'run-persist-failure-1' }), { status: 200 })
      }
      throw new Error('poll must not start before persistence')
    }) as unknown as typeof fetch

    const result = await runAndPoll(cfg, {
      taskId: 'task-1',
      orgId: 'org-1',
      agentId: 'theo',
      spec: 'Do the work',
      dispatchKey: 'pib-dispatch-v1-test-persist-failure-01',
    }, async () => {
      throw new Error('Firestore unavailable')
    })

    expect(result).toMatchObject({ runId: 'run-persist-failure-1', dispatchAcceptance: 'accepted' })
    expect(result.error).toContain('could not persist its run id before polling')
    expect(global.fetch).toHaveBeenCalledTimes(1)
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

  it('keeps polling an unset wall-clock timeout until the run completes', async () => {
    const previousTimeout = process.env.HERMES_RUN_TIMEOUT_MS
    delete process.env.HERMES_RUN_TIMEOUT_MS
    jest.useFakeTimers()
    jest.setSystemTime(0)
    let polls = 0
    global.fetch = jest.fn(async (url: string | URL) => {
      if (String(url).endsWith('/v1/runs')) {
        return new Response(JSON.stringify({ id: 'run-unlimited-1' }), { status: 200 })
      }
      polls += 1
      return new Response(JSON.stringify(polls === 1
        ? { status: 'running' }
        : { status: 'completed', output: 'eventually finished' }), { status: 200 })
    }) as unknown as typeof fetch

    try {
      const result = runAndPoll(cfg, {
        taskId: 'task-1',
        orgId: 'org-1',
        agentId: 'theo',
        spec: 'Long-running work',
      })
      await jest.advanceTimersByTimeAsync(0)
      jest.setSystemTime(3 * 60 * 60 * 1_000)
      await jest.advanceTimersByTimeAsync(2_000)
      await expect(result).resolves.toMatchObject({ runId: 'run-unlimited-1', output: 'eventually finished', error: null })
      expect(polls).toBe(2)
    } finally {
      jest.useRealTimers()
      if (previousTimeout === undefined) delete process.env.HERMES_RUN_TIMEOUT_MS
      else process.env.HERMES_RUN_TIMEOUT_MS = previousTimeout
    }
  })

  it('stops polling after repeated retryable gateway failures so the task can be durably retried', async () => {
    jest.useFakeTimers()
    global.fetch = jest.fn(async (url: string | URL) => {
      const urlText = String(url)
      if (urlText.endsWith('/v1/runs')) {
        return new Response(JSON.stringify({ id: 'run-gateway-1' }), { status: 200 })
      }
      return new Response('Bad Gateway', { status: 502 })
    }) as unknown as typeof fetch

    const resultPromise = runAndPoll(cfg, {
      taskId: 'task-1',
      orgId: 'org-1',
      agentId: 'theo',
      spec: 'Do the work',
    })
    await jest.runAllTimersAsync()

    await expect(resultPromise).resolves.toMatchObject({
      runId: 'run-gateway-1',
      output: null,
      error: expect.stringContaining('returned 502 repeatedly'),
    })
    // 1 POST /v1/runs + MAX_RETRYABLE_HTTP_POLLS (5) gateway polls before giving up.
    expect(global.fetch).toHaveBeenCalledTimes(6)
    jest.useRealTimers()
  })

  it('records gateway correlation headers on a pre-execution dispatch failure', async () => {
    global.fetch = jest.fn(async () => new Response('Bad Gateway', {
      status: 502,
      headers: {
        'x-request-id': 'req-502-trace',
        'x-correlation-id': 'corr-502-trace',
      },
    })) as unknown as typeof fetch

    await expect(runAndPoll(cfg, {
      taskId: 'task-1',
      orgId: 'org-1',
      agentId: 'theo',
      spec: 'Do the work',
    })).resolves.toMatchObject({
      runId: null,
      error: expect.stringContaining('Hermes /v1/runs returned 502'),
    })

    const result = await runAndPoll(cfg, {
      taskId: 'task-2',
      orgId: 'org-1',
      agentId: 'theo',
      spec: 'Do the work',
    })
    expect(result.error).toContain('x-request-id=req-502-trace')
    expect(result.error).toContain('x-correlation-id=corr-502-trace')
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

  it('sends provider when agentProvider is set for personal/org credential routing', async () => {
    let postedBody: Record<string, unknown> | null = null
    global.fetch = jest.fn(async (url: string | URL, init?: RequestInit) => {
      const urlText = String(url)
      if (urlText.endsWith('/v1/runs')) {
        postedBody = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
        return new Response(JSON.stringify({ id: 'run-provider-1' }), { status: 200 })
      }
      return new Response(JSON.stringify({ status: 'completed', output: 'done' }), { status: 200 })
    }) as unknown as typeof fetch

    await expect(runAndPoll(cfg, {
      taskId: 'task-1',
      orgId: 'org-1',
      agentId: 'theo',
      spec: 'Do the work',
      agentModel: 'gpt-5.4',
      agentProvider: 'openai-codex',
      llmCredentialSource: 'personal',
      llmResolvedSource: 'personal',
    })).resolves.toMatchObject({ runId: 'run-provider-1', output: 'done', error: null })

    expect(postedBody).toEqual(expect.objectContaining({
      model: 'gpt-5.4',
      provider: 'openai-codex',
      metadata: expect.objectContaining({
        llmCredentialSource: 'personal',
        llmResolvedSource: 'personal',
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
        provider: 'openai',
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
        provider: 'anthropic',
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

  it('reconciles an ambiguous POST through the dispatch-key lookup before polling', async () => {
    const key = 'pib-dispatch-v1-test-reconcile-0001'
    const events: string[] = []
    global.fetch = jest.fn(async (url: string | URL, init?: RequestInit) => {
      const urlText = String(url)
      if (urlText.endsWith('/v1/runs')) {
        events.push(`post:${new Headers(init?.headers).get('Idempotency-Key')}`)
        throw new TypeError('proxy response lost after acceptance')
      }
      if (urlText.endsWith('/v1/runs/dispatch-key')) {
        events.push(`lookup:${new Headers(init?.headers).get('Idempotency-Key')}`)
        return new Response(JSON.stringify({ run_id: 'run-reconciled-1', status: 'queued' }), { status: 200 })
      }
      events.push('poll')
      return new Response(JSON.stringify({ status: 'completed', output: 'done' }), { status: 200 })
    }) as unknown as typeof fetch

    const result = await runAndPoll(cfg, {
      taskId: 'task-1',
      orgId: 'org-1',
      agentId: 'theo',
      spec: 'Do the work',
      dispatchKey: key,
    }, async (runId) => {
      events.push(`persist:${runId}`)
    })

    expect(result).toMatchObject({ runId: 'run-reconciled-1', output: 'done', error: null, dispatchAcceptance: 'accepted' })
    expect(events).toEqual([`post:${key}`, `lookup:${key}`, 'persist:run-reconciled-1', 'poll'])
  })

  it('does not poll or retry a no-run-id dispatch when acceptance reconciliation stays ambiguous', async () => {
    const key = 'pib-dispatch-v1-test-unknown-0001'
    global.fetch = jest.fn(async (url: string | URL) => {
      const urlText = String(url)
      if (urlText.endsWith('/v1/runs')) {
        return new Response('Bad Gateway', { status: 502 })
      }
      if (urlText.endsWith('/v1/runs/dispatch-key')) {
        throw new TypeError('lookup unavailable')
      }
      throw new Error(`unexpected poll: ${urlText}`)
    }) as unknown as typeof fetch

    const result = await runAndPoll(cfg, {
      taskId: 'task-1',
      orgId: 'org-1',
      agentId: 'theo',
      spec: 'Do the work',
      dispatchKey: key,
    })

    expect(result).toMatchObject({ runId: null, dispatchAcceptance: 'unknown' })
    expect(result.error).toContain('dispatch acceptance is unknown')
    expect(global.fetch).toHaveBeenCalledTimes(2)
  })

  it('forwards working_directory to Hermes when the watcher has isolated a task worktree', async () => {
    let postedBody: Record<string, unknown> | null = null
    global.fetch = jest.fn(async (url: string | URL, init?: RequestInit) => {
      const urlText = String(url)
      if (urlText.endsWith('/v1/runs')) {
        postedBody = JSON.parse(String(init?.body)) as Record<string, unknown>
        return new Response(JSON.stringify({ run_id: 'run-worktree-1' }), { status: 200 })
      }
      return new Response(JSON.stringify({ status: 'completed', output: 'done' }), { status: 200 })
    }) as unknown as typeof fetch

    const isolatedDir = '/tmp/pib-agent-worktrees/repo/pib-task-test-worktree'
    const result = await runAndPoll(cfg, {
      taskId: 'task-worktree-1',
      orgId: 'org-1',
      agentId: 'theo',
      spec: 'Implement safely',
      workingDirectory: isolatedDir,
    })

    expect(result).toMatchObject({ runId: 'run-worktree-1', output: 'done' })
    expect(postedBody).not.toBeNull()
    expect(postedBody!['working_directory']).toBe(isolatedDir)
  })

  it('does not send working_directory when no isolation was performed', async () => {
    let postedBody: Record<string, unknown> | null = null
    global.fetch = jest.fn(async (url: string | URL, init?: RequestInit) => {
      const urlText = String(url)
      if (urlText.endsWith('/v1/runs')) {
        postedBody = JSON.parse(String(init?.body)) as Record<string, unknown>
        return new Response(JSON.stringify({ run_id: 'run-no-worktree' }), { status: 200 })
      }
      return new Response(JSON.stringify({ status: 'completed', output: 'done' }), { status: 200 })
    }) as unknown as typeof fetch

    await runAndPoll(cfg, {
      taskId: 'task-no-worktree',
      orgId: 'org-1',
      agentId: 'theo',
      spec: 'Do the work',
    })

    expect(postedBody).not.toBeNull()
    expect(postedBody).not.toHaveProperty('working_directory')
  })
})
