import {
  appendWorkbenchSessionOutput,
  createWorkbenchSession,
  EMPTY_WORKBENCH_SESSION_TRANSCRIPT,
  getWorkbenchSession,
  approveWorkbenchSession,
  killWorkbenchSession,
  pollWorkbenchSession,
  resizeWorkbenchSession,
  writeWorkbenchSessionStdin,
} from '@/lib/messages/workbench/session-client'
import type { PublicWorkbenchSession } from '@/lib/messages/workbench/session-client'

function session(overrides: Partial<PublicWorkbenchSession> = {}): PublicWorkbenchSession {
  return {
    sessionId: 'sess-1',
    status: 'running',
    cols: 120,
    rows: 40,
    shell: 'bash',
    approvalRequired: false,
    createdAt: '',
    updatedAt: '',
    ttlExpiresAt: '',
    ...overrides,
  }
}

describe('createWorkbenchSession', () => {
  afterEach(() => jest.restoreAllMocks())

  it('POSTs to the sessions route with the given cwd (server chooses the shell) and comes back awaiting approval', async () => {
    const fetchMock = jest.spyOn(global, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({
        data: session({ status: 'awaiting_approval', approvalRequired: true }),
      }), { status: 202 }))

    const created = await createWorkbenchSession('conv-1', { cwd: 'src' })

    expect(created.status).toBe('awaiting_approval')
    expect(created.approvalRequired).toBe(true)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/v1/conversations/conv-1/workbench/sessions')
    expect((init as RequestInit).method).toBe('POST')
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({ cwd: 'src' })
  })

  it('throws a readable error when the route 404s (server/runtime not built yet)', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValueOnce(new Response(JSON.stringify({ error: 'Not found' }), { status: 404 }))
    await expect(createWorkbenchSession('conv-1')).rejects.toThrow('Not found')
  })

  it('throws a generic error when a 404 has no JSON body at all', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValueOnce(new Response('<html>not found</html>', { status: 404 }))
    await expect(createWorkbenchSession('conv-1')).rejects.toThrow(/404/)
  })
})

describe('getWorkbenchSession / pollWorkbenchSession', () => {
  afterEach(() => jest.restoreAllMocks())

  it('GETs the session by id', async () => {
    const fetchMock = jest.spyOn(global, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: session() }), { status: 200 }))

    const result = await getWorkbenchSession('conv-1', 'sess-1')

    expect(result.sessionId).toBe('sess-1')
    expect(fetchMock.mock.calls[0][0]).toBe('/api/v1/conversations/conv-1/workbench/sessions/sess-1')
  })

  it('polls, invoking onProgress each time, until a terminal status is reached', async () => {
    const onProgress = jest.fn()
    jest.spyOn(global, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: session({ status: 'queued' }) }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: session({ status: 'running' }) }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: session({ status: 'exited', exitCode: 0 }) }), { status: 200 }))

    const result = await pollWorkbenchSession('conv-1', 'sess-1', { intervalMs: 0, onProgress })

    expect(result.status).toBe('exited')
    expect(onProgress).toHaveBeenCalledTimes(3)
  })

  it('stops immediately on awaiting_approval — approval is a decision point, not a wait state', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ data: session({ status: 'awaiting_approval' }) }), { status: 200 }))

    const result = await pollWorkbenchSession('conv-1', 'sess-1', { intervalMs: 0 })

    expect(result.status).toBe('awaiting_approval')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('can be told to poll through approval into a running pty (post-approve wait)', async () => {
    jest.spyOn(global, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: session({ status: 'queued' }) }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: session({ status: 'running' }) }), { status: 200 }))

    const result = await pollWorkbenchSession('conv-1', 'sess-1', {
      intervalMs: 0,
      settledStatuses: new Set(['running', 'exited', 'killed', 'expired', 'failed']),
    })

    expect(result.status).toBe('running')
  })

  it('times out waiting for a session stuck in a non-terminal status', async () => {
    jest.spyOn(global, 'fetch').mockImplementation(async () =>
      new Response(JSON.stringify({ data: session({ status: 'running' }) }), { status: 200 }))

    await expect(pollWorkbenchSession('conv-1', 'sess-1', { timeoutMs: 5, intervalMs: 0 })).rejects.toThrow(/timed out/i)
  })
})

describe('approveWorkbenchSession', () => {
  afterEach(() => jest.restoreAllMocks())

  it('POSTs to the approve route and returns the queued session', async () => {
    const fetchMock = jest.spyOn(global, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({
        data: session({ status: 'queued', approvedAt: '2026-07-25T06:00:00.000Z' }),
      }), { status: 200 }))

    const approved = await approveWorkbenchSession('conv-1', 'sess-1')

    expect(approved.status).toBe('queued')
    expect(approved.approvedAt).toBe('2026-07-25T06:00:00.000Z')
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/v1/conversations/conv-1/workbench/sessions/sess-1/approve')
    expect((init as RequestInit).method).toBe('POST')
  })

  it('throws a readable error when the session is no longer awaiting approval', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'Workbench session is no longer awaiting approval' }), { status: 409 }))
    await expect(approveWorkbenchSession('conv-1', 'sess-1')).rejects.toThrow('no longer awaiting approval')
  })
})

describe('resizeWorkbenchSession', () => {
  afterEach(() => jest.restoreAllMocks())

  it('POSTs the xterm grid size to the resize route', async () => {
    const fetchMock = jest.spyOn(global, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: session({ cols: 80, rows: 24 }) }), { status: 200 }))

    const result = await resizeWorkbenchSession('conv-1', 'sess-1', 80, 24)

    expect(result.cols).toBe(80)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/v1/conversations/conv-1/workbench/sessions/sess-1/resize')
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({ cols: 80, rows: 24 })
  })
})

describe('writeWorkbenchSessionStdin', () => {
  afterEach(() => jest.restoreAllMocks())

  it('POSTs { data, mode } to the stdin route, defaulting mode to "line", and returns the updated session', async () => {
    const fetchMock = jest.spyOn(global, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: session() }), { status: 200 }))

    const result = await writeWorkbenchSessionStdin('conv-1', 'sess-1', 'ls -la')

    expect(result.sessionId).toBe('sess-1')
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/v1/conversations/conv-1/workbench/sessions/sess-1/stdin')
    expect((init as RequestInit).method).toBe('POST')
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({ data: 'ls -la', mode: 'line' })
  })

  it('supports raw mode', async () => {
    const fetchMock = jest.spyOn(global, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: session() }), { status: 200 }))
    await writeWorkbenchSessionStdin('conv-1', 'sess-1', '\u0003', 'raw')
    expect(JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body))).toEqual({ data: '\u0003', mode: 'raw' })
  })

  it('throws a readable error on failure', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValueOnce(new Response(JSON.stringify({ error: 'Session is not running' }), { status: 409 }))
    await expect(writeWorkbenchSessionStdin('conv-1', 'sess-1', 'x')).rejects.toThrow('Session is not running')
  })
})

describe('killWorkbenchSession', () => {
  afterEach(() => jest.restoreAllMocks())

  it('POSTs to the kill route and returns the updated session', async () => {
    const fetchMock = jest.spyOn(global, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: session({ status: 'killed' }) }), { status: 200 }))

    const result = await killWorkbenchSession('conv-1', 'sess-1')

    expect(result.status).toBe('killed')
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/v1/conversations/conv-1/workbench/sessions/sess-1/kill')
    expect((init as RequestInit).method).toBe('POST')
  })
})

describe('appendWorkbenchSessionOutput', () => {
  it('appends only chunks newer than the last-seen seq, in seq order', () => {
    const state = appendWorkbenchSessionOutput(EMPTY_WORKBENCH_SESSION_TRANSCRIPT, session({
      progress: [
        { seq: 0, stream: 'stdout', text: 'hello ', atMs: 1 },
        { seq: 1, stream: 'stdout', text: 'world\n', atMs: 2 },
      ],
    }))
    expect(state).toEqual({ text: 'hello world\n', lastSeq: 1 })

    const next = appendWorkbenchSessionOutput(state, session({
      progress: [
        { seq: 1, stream: 'stdout', text: 'world\n', atMs: 2 },
        { seq: 2, stream: 'stdout', text: 'again\n', atMs: 3 },
      ],
    }))
    expect(next).toEqual({ text: 'hello world\nagain\n', lastSeq: 2 })
  })

  it('returns the same state when there are no new chunks', () => {
    const state = { text: 'existing', lastSeq: 5 }
    expect(appendWorkbenchSessionOutput(state, session({ progress: [{ seq: 5, stream: 'stdout', text: 'stale', atMs: 1 }] }))).toBe(state)
    expect(appendWorkbenchSessionOutput(state, session({ progress: [] }))).toBe(state)
    expect(appendWorkbenchSessionOutput(state, session({}))).toBe(state)
  })

  it('is resilient to a capped ring buffer that no longer contains fully-seen chunks', () => {
    // Even if the server only returns the last 2 chunks and seq 0 has fallen out of the buffer,
    // client-side accumulation keeps the already-seen prefix instead of dropping it.
    const state = appendWorkbenchSessionOutput(EMPTY_WORKBENCH_SESSION_TRANSCRIPT, session({
      progress: [{ seq: 0, stream: 'stdout', text: 'first\n', atMs: 1 }],
    }))
    const next = appendWorkbenchSessionOutput(state, session({
      progress: [{ seq: 1, stream: 'stdout', text: 'second\n', atMs: 2 }],
    }))
    expect(next.text).toBe('first\nsecond\n')
  })
})
