import {
  approveWorkbenchTunnel,
  createWorkbenchTunnel,
  getWorkbenchTunnel,
  killWorkbenchTunnel,
  pollWorkbenchTunnel,
} from '@/lib/messages/workbench/tunnel-client'
import type { PublicWorkbenchTunnel } from '@/lib/messages/workbench/tunnel-client'

function tunnel(overrides: Partial<PublicWorkbenchTunnel> = {}): PublicWorkbenchTunnel {
  return {
    sessionId: 'tun-1',
    status: 'queued',
    port: 3000,
    createdAt: '',
    updatedAt: '',
    ...overrides,
  }
}

describe('createWorkbenchTunnel', () => {
  afterEach(() => jest.restoreAllMocks())

  it('POSTs the port to the tunnel sessions route', async () => {
    const fetchMock = jest.spyOn(global, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: tunnel() }), { status: 201 }))

    const created = await createWorkbenchTunnel('conv-1', 3000)

    expect(created.status).toBe('queued')
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/v1/conversations/conv-1/workbench/tunnel/sessions')
    expect((init as RequestInit).method).toBe('POST')
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({ port: 3000 })
  })

  it('throws a readable error when the route 404s (server/runtime not built yet)', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValueOnce(new Response(JSON.stringify({ error: 'Not found' }), { status: 404 }))
    await expect(createWorkbenchTunnel('conv-1', 3000)).rejects.toThrow('Not found')
  })

  it('throws a generic error when a 501 has no JSON body at all', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValueOnce(new Response('<html>not implemented</html>', { status: 501 }))
    await expect(createWorkbenchTunnel('conv-1', 3000)).rejects.toThrow(/501/)
  })
})

describe('getWorkbenchTunnel / pollWorkbenchTunnel', () => {
  afterEach(() => jest.restoreAllMocks())

  it('GETs the tunnel session by id', async () => {
    const fetchMock = jest.spyOn(global, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: tunnel() }), { status: 200 }))

    const result = await getWorkbenchTunnel('conv-1', 'tun-1')

    expect(result.sessionId).toBe('tun-1')
    expect(fetchMock.mock.calls[0][0]).toBe('/api/v1/conversations/conv-1/workbench/tunnel/sessions/tun-1')
  })

  it('polls, invoking onProgress each time, until a settled status is reached (awaiting_approval)', async () => {
    const onProgress = jest.fn()
    jest.spyOn(global, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: tunnel({ status: 'queued' }) }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: tunnel({ status: 'awaiting_approval' }) }), { status: 200 }))

    const result = await pollWorkbenchTunnel('conv-1', 'tun-1', { intervalMs: 0, onProgress })

    expect(result.status).toBe('awaiting_approval')
    expect(onProgress).toHaveBeenCalledTimes(2)
  })

  it('polls through to running once a publicUrl is opened', async () => {
    jest.spyOn(global, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: tunnel({ status: 'starting' }) }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: tunnel({ status: 'running', publicUrl: 'https://abcd.tunnel.example.com' }) }), { status: 200 }))

    const result = await pollWorkbenchTunnel('conv-1', 'tun-1', { intervalMs: 0 })

    expect(result.status).toBe('running')
    expect(result.publicUrl).toBe('https://abcd.tunnel.example.com')
  })

  it('times out waiting for a tunnel stuck in a non-settled status', async () => {
    jest.spyOn(global, 'fetch').mockImplementation(async () =>
      new Response(JSON.stringify({ data: tunnel({ status: 'starting' }) }), { status: 200 }))

    await expect(pollWorkbenchTunnel('conv-1', 'tun-1', { timeoutMs: 5, intervalMs: 0 })).rejects.toThrow(/timed out/i)
  })
})

describe('approveWorkbenchTunnel', () => {
  afterEach(() => jest.restoreAllMocks())

  it('POSTs to the approve route and returns the updated tunnel', async () => {
    const fetchMock = jest.spyOn(global, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: tunnel({ status: 'running' }) }), { status: 200 }))

    const result = await approveWorkbenchTunnel('conv-1', 'tun-1')

    expect(result.status).toBe('running')
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/v1/conversations/conv-1/workbench/tunnel/sessions/tun-1/approve')
    expect((init as RequestInit).method).toBe('POST')
  })
})

describe('killWorkbenchTunnel', () => {
  afterEach(() => jest.restoreAllMocks())

  it('POSTs to the kill route and returns the updated tunnel', async () => {
    const fetchMock = jest.spyOn(global, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: tunnel({ status: 'closed' }) }), { status: 200 }))

    const result = await killWorkbenchTunnel('conv-1', 'tun-1')

    expect(result.status).toBe('closed')
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/v1/conversations/conv-1/workbench/tunnel/sessions/tun-1/kill')
    expect((init as RequestInit).method).toBe('POST')
  })
})
