import {
  appendWorkbenchBrowserSessionFrames,
  approveWorkbenchBrowserSession,
  captureWorkbenchBrowserSession,
  createWorkbenchBrowserSession,
  EMPTY_WORKBENCH_BROWSER_SESSION_FRAMES,
  getWorkbenchBrowserSession,
  killWorkbenchBrowserSession,
  navigateWorkbenchBrowserSession,
  pollWorkbenchBrowserSession,
} from '@/lib/messages/workbench/browser-session-client'
import type { PublicWorkbenchBrowserSession } from '@/lib/messages/workbench/browser-session-client'

function session(overrides: Partial<PublicWorkbenchBrowserSession> = {}): PublicWorkbenchBrowserSession {
  return {
    sessionId: 'bsess-1',
    status: 'queued',
    createdAt: '',
    updatedAt: '',
    ...overrides,
  }
}

describe('createWorkbenchBrowserSession', () => {
  afterEach(() => jest.restoreAllMocks())

  it('POSTs the optional startUrl/viewport to the browser sessions route', async () => {
    const fetchMock = jest.spyOn(global, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: session() }), { status: 201 }))

    const created = await createWorkbenchBrowserSession('conv-1', { startUrl: 'https://example.com' })

    expect(created.status).toBe('queued')
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/v1/conversations/conv-1/workbench/browser/sessions')
    expect((init as RequestInit).method).toBe('POST')
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({ startUrl: 'https://example.com' })
  })

  it('throws a readable error when the route 404s (server/runtime not built yet)', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValueOnce(new Response(JSON.stringify({ error: 'Not found' }), { status: 404 }))
    await expect(createWorkbenchBrowserSession('conv-1')).rejects.toThrow('Not found')
  })

  it('throws a generic error when a 501 has no JSON body at all', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValueOnce(new Response('<html>not implemented</html>', { status: 501 }))
    await expect(createWorkbenchBrowserSession('conv-1')).rejects.toThrow(/501/)
  })
})

describe('getWorkbenchBrowserSession / pollWorkbenchBrowserSession', () => {
  afterEach(() => jest.restoreAllMocks())

  it('GETs the browser session by id', async () => {
    const fetchMock = jest.spyOn(global, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: session() }), { status: 200 }))

    const result = await getWorkbenchBrowserSession('conv-1', 'bsess-1')

    expect(result.sessionId).toBe('bsess-1')
    expect(fetchMock.mock.calls[0][0]).toBe('/api/v1/conversations/conv-1/workbench/browser/sessions/bsess-1')
  })

  it('polls, invoking onProgress each time, until a settled status is reached (awaiting_approval)', async () => {
    const onProgress = jest.fn()
    jest.spyOn(global, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: session({ status: 'queued' }) }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: session({ status: 'awaiting_approval' }) }), { status: 200 }))

    const result = await pollWorkbenchBrowserSession('conv-1', 'bsess-1', { intervalMs: 0, onProgress })

    expect(result.status).toBe('awaiting_approval')
    expect(onProgress).toHaveBeenCalledTimes(2)
  })

  it('times out waiting for a session stuck in a non-settled status', async () => {
    jest.spyOn(global, 'fetch').mockImplementation(async () =>
      new Response(JSON.stringify({ data: session({ status: 'starting' }) }), { status: 200 }))

    await expect(pollWorkbenchBrowserSession('conv-1', 'bsess-1', { timeoutMs: 5, intervalMs: 0 })).rejects.toThrow(/timed out/i)
  })
})

describe('approveWorkbenchBrowserSession / navigateWorkbenchBrowserSession / captureWorkbenchBrowserSession / killWorkbenchBrowserSession', () => {
  afterEach(() => jest.restoreAllMocks())

  it('approve POSTs to the approve route', async () => {
    const fetchMock = jest.spyOn(global, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: session({ status: 'running' }) }), { status: 200 }))

    const result = await approveWorkbenchBrowserSession('conv-1', 'bsess-1')

    expect(result.status).toBe('running')
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/v1/conversations/conv-1/workbench/browser/sessions/bsess-1/approve')
    expect((init as RequestInit).method).toBe('POST')
  })

  it('navigate POSTs { url } to the navigate route', async () => {
    const fetchMock = jest.spyOn(global, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: session({ status: 'running', currentUrl: 'https://example.com/next' }) }), { status: 200 }))

    const result = await navigateWorkbenchBrowserSession('conv-1', 'bsess-1', 'https://example.com/next')

    expect(result.currentUrl).toBe('https://example.com/next')
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/v1/conversations/conv-1/workbench/browser/sessions/bsess-1/navigate')
    expect((init as RequestInit).method).toBe('POST')
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({ url: 'https://example.com/next' })
  })

  it('capture POSTs to the capture route and returns the updated session (with new frames)', async () => {
    const fetchMock = jest.spyOn(global, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({
        data: session({ status: 'running', frames: [{ id: 'f1', seq: 0, imageUrl: 'https://cdn.example.com/f1.png' }] }),
      }), { status: 200 }))

    const result = await captureWorkbenchBrowserSession('conv-1', 'bsess-1')

    expect(result.frames).toHaveLength(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/v1/conversations/conv-1/workbench/browser/sessions/bsess-1/capture')
    expect((init as RequestInit).method).toBe('POST')
  })

  it('kill POSTs to the kill route and returns the updated session', async () => {
    const fetchMock = jest.spyOn(global, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: session({ status: 'closed' }) }), { status: 200 }))

    const result = await killWorkbenchBrowserSession('conv-1', 'bsess-1')

    expect(result.status).toBe('closed')
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/v1/conversations/conv-1/workbench/browser/sessions/bsess-1/kill')
    expect((init as RequestInit).method).toBe('POST')
  })

  it('throws a readable error on failure', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValueOnce(new Response(JSON.stringify({ error: 'Session is not running' }), { status: 409 }))
    await expect(navigateWorkbenchBrowserSession('conv-1', 'bsess-1', 'https://example.com')).rejects.toThrow('Session is not running')
  })
})

describe('appendWorkbenchBrowserSessionFrames', () => {
  it('appends only frames newer than the last-seen seq, in seq order', () => {
    const state = appendWorkbenchBrowserSessionFrames(EMPTY_WORKBENCH_BROWSER_SESSION_FRAMES, session({
      frames: [
        { id: 'f0', seq: 0, imageUrl: 'https://cdn.example.com/f0.png' },
        { id: 'f1', seq: 1, imageUrl: 'https://cdn.example.com/f1.png' },
      ],
    }))
    expect(state.frames.map((frame) => frame.id)).toEqual(['f0', 'f1'])
    expect(state.lastSeq).toBe(1)

    const next = appendWorkbenchBrowserSessionFrames(state, session({
      frames: [
        { id: 'f1', seq: 1, imageUrl: 'https://cdn.example.com/f1.png' },
        { id: 'f2', seq: 2, imageUrl: 'https://cdn.example.com/f2.png' },
      ],
    }))
    expect(next.frames.map((frame) => frame.id)).toEqual(['f0', 'f1', 'f2'])
    expect(next.lastSeq).toBe(2)
  })

  it('returns the same state when there are no new frames', () => {
    const state = { frames: [{ id: 'f0', seq: 0, imageUrl: 'x' }], lastSeq: 0 }
    expect(appendWorkbenchBrowserSessionFrames(state, session({ frames: [{ id: 'f0', seq: 0, imageUrl: 'x' }] }))).toBe(state)
    expect(appendWorkbenchBrowserSessionFrames(state, session({ frames: [] }))).toBe(state)
    expect(appendWorkbenchBrowserSessionFrames(state, session({}))).toBe(state)
  })
})
