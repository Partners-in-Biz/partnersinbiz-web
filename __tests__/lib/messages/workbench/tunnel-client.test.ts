import {
  approveTunnelSession,
  createTunnelSession,
  getTunnelSession,
  killTunnelSession,
  pollTunnelSession,
} from '@/lib/messages/workbench/tunnel-client'
import type { PublicWorkbenchTunnelSession } from '@/lib/messages/workbench/tunnel-client'

function tunnel(overrides: Partial<PublicWorkbenchTunnelSession> = {}): PublicWorkbenchTunnelSession {
  return {
    sessionId: 'tun-1',
    status: 'awaiting_approval',
    port: 3000,
    provider: 'cloudflared',
    approvalRequired: true,
    createdAt: '',
    updatedAt: '',
    ttlExpiresAt: '',
    ...overrides,
  }
}

describe('createTunnelSession', () => {
  afterEach(() => jest.restoreAllMocks())

  it('POSTs the port to the tunnel sessions route', async () => {
    const fetchMock = jest.spyOn(global, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: tunnel() }), { status: 201 }))

    const created = await createTunnelSession('conv-1', 3000)

    expect(created.status).toBe('awaiting_approval')
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/v1/conversations/conv-1/workbench/tunnel/sessions')
    expect((init as RequestInit).method).toBe('POST')
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({ port: 3000 })
  })

  it('throws a readable error when the route 404s (server/runtime not built yet)', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValueOnce(new Response(JSON.stringify({ error: 'Not found' }), { status: 404 }))
    await expect(createTunnelSession('conv-1', 3000)).rejects.toThrow('Not found')
  })

  it('throws a generic error when a 501 has no JSON body at all', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValueOnce(new Response('<html>not implemented</html>', { status: 501 }))
    await expect(createTunnelSession('conv-1', 3000)).rejects.toThrow(/501/)
  })
})

describe('getTunnelSession / pollTunnelSession', () => {
  afterEach(() => jest.restoreAllMocks())

  it('GETs the tunnel session by id', async () => {
    const fetchMock = jest.spyOn(global, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: tunnel() }), { status: 200 }))

    const result = await getTunnelSession('conv-1', 'tun-1')

    expect(result.sessionId).toBe('tun-1')
    expect(fetchMock.mock.calls[0][0]).toBe('/api/v1/conversations/conv-1/workbench/tunnel/sessions/tun-1')
  })

  it('polls, invoking onProgress each time, until a terminal status is reached', async () => {
    const onProgress = jest.fn()
    jest.spyOn(global, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: tunnel({ status: 'claimed', approvalRequired: false }) }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: tunnel({ status: 'expired', approvalRequired: false }) }), { status: 200 }))

    const result = await pollTunnelSession('conv-1', 'tun-1', { intervalMs: 0, onProgress })

    expect(result.status).toBe('expired')
    expect(onProgress).toHaveBeenCalledTimes(2)
  })

  it('polls through claimed to running once a publicUrl is opened', async () => {
    jest.spyOn(global, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: tunnel({ status: 'claimed', approvalRequired: false }) }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        data: tunnel({ status: 'running', approvalRequired: false, publicUrl: 'https://abcd.tunnel.example.com' }),
      }), { status: 200 }))

    const result = await pollTunnelSession('conv-1', 'tun-1', { intervalMs: 0 })

    expect(result.status).toBe('running')
    expect(result.publicUrl).toBe('https://abcd.tunnel.example.com')
  })

  it('times out waiting for a tunnel stuck running with no publicUrl yet', async () => {
    jest.spyOn(global, 'fetch').mockImplementation(async () =>
      new Response(JSON.stringify({ data: tunnel({ status: 'running', approvalRequired: false }) }), { status: 200 }))

    await expect(pollTunnelSession('conv-1', 'tun-1', { timeoutMs: 5, intervalMs: 0 })).rejects.toThrow(/timed out/i)
  })
})

describe('approveTunnelSession', () => {
  afterEach(() => jest.restoreAllMocks())

  it('POSTs to the approve route and returns the updated tunnel', async () => {
    const fetchMock = jest.spyOn(global, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: tunnel({ status: 'queued', approvalRequired: false }) }), { status: 200 }))

    const result = await approveTunnelSession('conv-1', 'tun-1')

    expect(result.status).toBe('queued')
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/v1/conversations/conv-1/workbench/tunnel/sessions/tun-1/approve')
    expect((init as RequestInit).method).toBe('POST')
  })
})

describe('killTunnelSession', () => {
  afterEach(() => jest.restoreAllMocks())

  it('POSTs to the kill route and returns the updated tunnel', async () => {
    const fetchMock = jest.spyOn(global, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: tunnel({ status: 'killed', approvalRequired: false }) }), { status: 200 }))

    const result = await killTunnelSession('conv-1', 'tun-1')

    expect(result.status).toBe('killed')
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/v1/conversations/conv-1/workbench/tunnel/sessions/tun-1/kill')
    expect((init as RequestInit).method).toBe('POST')
  })
})
