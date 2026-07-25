import {
  appendWorkbenchBrowserSessionProgress,
  approveWorkbenchBrowserSession,
  captureWorkbenchBrowserSession,
  clickWorkbenchBrowserSession,
  createWorkbenchBrowserSession,
  EMPTY_WORKBENCH_BROWSER_SESSION_PROGRESS,
  followWorkbenchBrowserSession,
  getWorkbenchBrowserSession,
  killWorkbenchBrowserSession,
  latestWorkbenchBrowserSessionFrameUrl,
  navigateWorkbenchBrowserSession,
  pollWorkbenchBrowserSession,
  pressWorkbenchBrowserSession,
  scrollWorkbenchBrowserSession,
  typeWorkbenchBrowserSession,
} from '@/lib/messages/workbench/browser-session-client'
import type { PublicWorkbenchBrowserSession } from '@/lib/messages/workbench/browser-session-client'

function session(overrides: Partial<PublicWorkbenchBrowserSession> = {}): PublicWorkbenchBrowserSession {
  return {
    sessionId: 'wbbs_a',
    status: 'queued',
    startUrl: null,
    viewport: { width: 1280, height: 720 },
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ttlExpiresAt: '2026-01-01T00:30:00.000Z',
    ...overrides,
  }
}

describe('createWorkbenchBrowserSession', () => {
  afterEach(() => jest.restoreAllMocks())

  it('POSTs the optional startUrl/viewport to the browser sessions route', async () => {
    const fetchMock = jest.spyOn(global, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: session({ status: 'awaiting_approval' }) }), { status: 202 }))

    const created = await createWorkbenchBrowserSession('conv-1', { startUrl: 'https://example.com' })

    expect(created.status).toBe('awaiting_approval')
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/v1/conversations/conv-1/workbench/browser/sessions')
    expect((init as RequestInit).method).toBe('POST')
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({ startUrl: 'https://example.com' })
  })

  it('throws a readable error when the route fails', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValueOnce(new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 }))
    await expect(createWorkbenchBrowserSession('conv-1')).rejects.toThrow('Forbidden')
  })

  it('throws a generic error when a failure response has no JSON body at all', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValueOnce(new Response('<html>error</html>', { status: 500 }))
    await expect(createWorkbenchBrowserSession('conv-1')).rejects.toThrow(/500/)
  })
})

describe('getWorkbenchBrowserSession / pollWorkbenchBrowserSession', () => {
  afterEach(() => jest.restoreAllMocks())

  it('GETs the browser session by id', async () => {
    const fetchMock = jest.spyOn(global, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: session() }), { status: 200 }))

    const result = await getWorkbenchBrowserSession('conv-1', 'wbbs_a')

    expect(result.sessionId).toBe('wbbs_a')
    expect(fetchMock.mock.calls[0][0]).toBe('/api/v1/conversations/conv-1/workbench/browser/sessions/wbbs_a')
  })

  it('polls, invoking onProgress each time, until a settled status is reached (awaiting_approval)', async () => {
    const onProgress = jest.fn()
    jest.spyOn(global, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: session({ status: 'queued' }) }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: session({ status: 'awaiting_approval' }) }), { status: 200 }))

    const result = await pollWorkbenchBrowserSession('conv-1', 'wbbs_a', { intervalMs: 0, onProgress })

    expect(result.status).toBe('awaiting_approval')
    expect(onProgress).toHaveBeenCalledTimes(2)
  })

  it('times out waiting for a session stuck in a non-settled status', async () => {
    jest.spyOn(global, 'fetch').mockImplementation(async () =>
      new Response(JSON.stringify({ data: session({ status: 'claimed' }) }), { status: 200 }))

    await expect(pollWorkbenchBrowserSession('conv-1', 'wbbs_a', { timeoutMs: 5, intervalMs: 0 })).rejects.toThrow(/timed out/i)
  })
})

describe('approveWorkbenchBrowserSession / navigateWorkbenchBrowserSession / captureWorkbenchBrowserSession / killWorkbenchBrowserSession', () => {
  afterEach(() => jest.restoreAllMocks())

  it('approve POSTs to the approve route', async () => {
    const fetchMock = jest.spyOn(global, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: session({ status: 'queued' }) }), { status: 200 }))

    const result = await approveWorkbenchBrowserSession('conv-1', 'wbbs_a')

    expect(result.status).toBe('queued')
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/v1/conversations/conv-1/workbench/browser/sessions/wbbs_a/approve')
    expect((init as RequestInit).method).toBe('POST')
  })

  it('navigate POSTs { url } to the navigate route', async () => {
    const fetchMock = jest.spyOn(global, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: session({ status: 'running', currentPageUrl: 'https://example.com/next' }) }), { status: 200 }))

    const result = await navigateWorkbenchBrowserSession('conv-1', 'wbbs_a', 'https://example.com/next')

    expect(result.currentPageUrl).toBe('https://example.com/next')
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/v1/conversations/conv-1/workbench/browser/sessions/wbbs_a/navigate')
    expect((init as RequestInit).method).toBe('POST')
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({ url: 'https://example.com/next' })
  })

  it('capture POSTs to the capture route and returns the updated session (with new progress chunks)', async () => {
    const fetchMock = jest.spyOn(global, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({
        data: session({ status: 'running', progress: [{ seq: 0, stream: 'frame', imageUrl: 'https://cdn.example.com/f1.png', atMs: 1_000 }] }),
      }), { status: 200 }))

    const result = await captureWorkbenchBrowserSession('conv-1', 'wbbs_a')

    expect(result.progress).toHaveLength(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/v1/conversations/conv-1/workbench/browser/sessions/wbbs_a/capture')
    expect((init as RequestInit).method).toBe('POST')
  })

  it('kill POSTs to the kill route and returns the updated session', async () => {
    const fetchMock = jest.spyOn(global, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: session({ status: 'killed' }) }), { status: 200 }))

    const result = await killWorkbenchBrowserSession('conv-1', 'wbbs_a')

    expect(result.status).toBe('killed')
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/v1/conversations/conv-1/workbench/browser/sessions/wbbs_a/kill')
    expect((init as RequestInit).method).toBe('POST')
  })

  it('throws a readable error on failure', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValueOnce(new Response(JSON.stringify({ error: 'Workbench browser session is not running' }), { status: 409 }))
    await expect(navigateWorkbenchBrowserSession('conv-1', 'wbbs_a', 'https://example.com')).rejects.toThrow('Workbench browser session is not running')
  })
})

describe('interaction and follow helpers', () => {
  afterEach(() => jest.restoreAllMocks())

  function mockRunningSession() {
    return jest.spyOn(global, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: session({ status: 'running' }) }), { status: 200 }))
  }

  it('click POSTs viewport pixel coordinates to the click route', async () => {
    const fetchMock = mockRunningSession()

    const result = await clickWorkbenchBrowserSession('conv-1', 'wbbs_a', { x: 120, y: 340 })

    expect(result.status).toBe('running')
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/v1/conversations/conv-1/workbench/browser/sessions/wbbs_a/click')
    expect((init as RequestInit).method).toBe('POST')
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({ x: 120, y: 340 })
  })

  it('click forwards an explicit button', async () => {
    const fetchMock = mockRunningSession()
    await clickWorkbenchBrowserSession('conv-1', 'wbbs_a', { x: 1, y: 2, button: 'right' })
    expect(JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body))).toEqual({ x: 1, y: 2, button: 'right' })
  })

  it('type POSTs { text } to the type route', async () => {
    const fetchMock = mockRunningSession()
    await typeWorkbenchBrowserSession('conv-1', 'wbbs_a', { text: 'hello@example.com' })
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/v1/conversations/conv-1/workbench/browser/sessions/wbbs_a/type')
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({ text: 'hello@example.com' })
  })

  it('press POSTs { key } to the press route', async () => {
    const fetchMock = mockRunningSession()
    await pressWorkbenchBrowserSession('conv-1', 'wbbs_a', { key: 'Enter' })
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/v1/conversations/conv-1/workbench/browser/sessions/wbbs_a/press')
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({ key: 'Enter' })
  })

  it('scroll POSTs the anchor point and wheel delta to the scroll route', async () => {
    const fetchMock = mockRunningSession()
    await scrollWorkbenchBrowserSession('conv-1', 'wbbs_a', { x: 10, y: 20, deltaY: 400 })
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/v1/conversations/conv-1/workbench/browser/sessions/wbbs_a/scroll')
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({ x: 10, y: 20, deltaY: 400 })
  })

  it('follow POSTs start with an interval and stop without one', async () => {
    const fetchMock = jest.spyOn(global, 'fetch')
      .mockImplementation(async () => new Response(JSON.stringify({ data: session({ status: 'running' }) }), { status: 200 }))

    await followWorkbenchBrowserSession('conv-1', 'wbbs_a', { action: 'start', intervalMs: 1_000 })
    await followWorkbenchBrowserSession('conv-1', 'wbbs_a', { action: 'stop' })

    expect(fetchMock.mock.calls[0][0]).toBe('/api/v1/conversations/conv-1/workbench/browser/sessions/wbbs_a/follow')
    expect(JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body))).toEqual({ action: 'start', intervalMs: 1_000 })
    expect(JSON.parse(String((fetchMock.mock.calls[1][1] as RequestInit).body))).toEqual({ action: 'stop' })
  })

  it('surfaces a server rejection as a readable error', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValueOnce(new Response(
      JSON.stringify({ error: 'x and y must be viewport pixel coordinates within 0-1920 x 0-1200' }),
      { status: 400 },
    ))
    await expect(clickWorkbenchBrowserSession('conv-1', 'wbbs_a', { x: 9_999, y: 1 }))
      .rejects.toThrow(/viewport pixel coordinates/)
  })
})

describe('appendWorkbenchBrowserSessionProgress', () => {
  it('appends only chunks newer than the last-seen seq, in seq order', () => {
    const state = appendWorkbenchBrowserSessionProgress(EMPTY_WORKBENCH_BROWSER_SESSION_PROGRESS, session({
      progress: [
        { seq: 0, stream: 'frame', imageUrl: 'https://cdn.example.com/f0.png', atMs: 1_000 },
        { seq: 1, stream: 'frame', imageUrl: 'https://cdn.example.com/f1.png', atMs: 2_000 },
      ],
    }))
    expect(state.chunks.map((chunk) => chunk.seq)).toEqual([0, 1])
    expect(state.lastSeq).toBe(1)

    const next = appendWorkbenchBrowserSessionProgress(state, session({
      progress: [
        { seq: 1, stream: 'frame', imageUrl: 'https://cdn.example.com/f1.png', atMs: 2_000 },
        { seq: 2, stream: 'status', text: 'ok', atMs: 3_000 },
      ],
    }))
    expect(next.chunks.map((chunk) => chunk.seq)).toEqual([0, 1, 2])
    expect(next.lastSeq).toBe(2)
  })

  it('returns the same state when there are no new chunks', () => {
    const state = { chunks: [{ seq: 0, stream: 'status' as const, text: 'ok', atMs: 1_000 }], lastSeq: 0 }
    expect(appendWorkbenchBrowserSessionProgress(state, session({ progress: state.chunks }))).toBe(state)
    expect(appendWorkbenchBrowserSessionProgress(state, session({ progress: [] }))).toBe(state)
    expect(appendWorkbenchBrowserSessionProgress(state, session({}))).toBe(state)
  })
})

describe('latestWorkbenchBrowserSessionFrameUrl', () => {
  it('returns the most recent frame chunk\'s imageUrl, skipping status/stderr chunks', () => {
    expect(latestWorkbenchBrowserSessionFrameUrl([
      { seq: 0, stream: 'frame', imageUrl: 'https://cdn.example.com/f0.png', atMs: 1_000 },
      { seq: 1, stream: 'status', text: 'ok', atMs: 2_000 },
      { seq: 2, stream: 'frame', imageUrl: 'https://cdn.example.com/f2.png', atMs: 3_000 },
      { seq: 3, stream: 'stderr', text: 'oops', atMs: 4_000 },
    ])).toBe('https://cdn.example.com/f2.png')
    expect(latestWorkbenchBrowserSessionFrameUrl([])).toBeUndefined()
  })
})
