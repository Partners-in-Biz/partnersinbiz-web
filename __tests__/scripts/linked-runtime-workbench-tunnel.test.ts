/** @jest-environment node */
import { EventEmitter } from 'node:events'
import net from 'node:net'
import { MappingRegistry } from '../../runtime-installers/runtime/bridge'
import {
  __resetWorkbenchTunnelsForTests,
  __setSpawnCloudflaredForTests,
  activeWorkbenchTunnelIds,
  handleTunnelCreate,
  handleTunnelKill,
  linkedRuntimeWorkbenchTunnelsClaimBody,
  pollWorkbenchTunnelsForever,
  probeLocalPortListening,
  runWorkbenchTunnelClaim,
  sweepExpiredWorkbenchTunnels,
  type CloudflaredChildProcess,
  type WorkbenchTunnelClaim,
} from '../../runtime-installers/runtime/workbench-tunnel'

class FakeCloudflaredProcess extends EventEmitter implements CloudflaredChildProcess {
  pid = 9999
  killed = false
  stdout = new EventEmitter()
  stderr = new EventEmitter()

  kill(_signal?: string) {
    this.killed = true
  }
}

function registry() {
  return new MappingRegistry('/tmp/pib-workbench-tunnel-tests-mappings.json')
}

function createClaim(overrides: Partial<Extract<WorkbenchTunnelClaim, { kind: 'create' }>> = {}): WorkbenchTunnelClaim {
  return {
    kind: 'create',
    sessionId: 'wbt_a',
    port: 5173,
    bindHost: '127.0.0.1',
    provider: 'cloudflared',
    workspaceId: 'workspace-a',
    mappingId: 'mapping-a',
    relativeFolder: '',
    attempt: 1,
    leaseToken: 'lease-token-1234567890',
    ...overrides,
  }
}

function controlClaim(overrides: Partial<Extract<WorkbenchTunnelClaim, { kind: 'control' }>> = {}): WorkbenchTunnelClaim {
  return {
    kind: 'control',
    sessionId: 'wbt_a',
    control: { kind: 'kill' },
    attempt: 1,
    leaseToken: 'lease-token-1234567890',
    ...overrides,
  }
}

afterEach(() => {
  __setSpawnCloudflaredForTests(undefined)
  __resetWorkbenchTunnelsForTests()
})

describe('linked-computer workbench tunnel runtime', () => {
  it('advertises the tunnels claim protocol', () => {
    expect(linkedRuntimeWorkbenchTunnelsClaimBody()).toEqual({
      runtimeVersion: expect.any(String),
      workbenchTunnelsProtocolVersion: 1,
    })
  })

  it('probes a real listening port as true and a closed port as false', async () => {
    const server = net.createServer()
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const port = (server.address() as net.AddressInfo).port

    await expect(probeLocalPortListening(port)).resolves.toBe(true)
    server.close()

    // Port 1 is a privileged, essentially-never-listening port on 127.0.0.1 in test sandboxes.
    await expect(probeLocalPortListening(1, '127.0.0.1', 200)).resolves.toBe(false)
  })

  it('spawns cloudflared and posts a completion with the process pid', async () => {
    const child = new FakeCloudflaredProcess()
    __setSpawnCloudflaredForTests(() => child)
    const post = jest.fn(async () => new Response('', { status: 200 }))

    const result = await handleTunnelCreate(createClaim(), registry(), post)

    expect(result).toEqual({ sessionId: 'wbt_a', pid: 9999 })
    expect(activeWorkbenchTunnelIds()).toContain('wbt_a')
  })

  it('scans stdout/stderr for the resolved trycloudflare URL and posts it exactly once as a tunnel chunk', async () => {
    const child = new FakeCloudflaredProcess()
    __setSpawnCloudflaredForTests(() => child)
    const posts: Array<[string, Record<string, unknown>]> = []
    const post = jest.fn(async (endpoint: string, body: Record<string, unknown>) => {
      posts.push([endpoint, body])
      return new Response('', { status: 200 })
    })

    await handleTunnelCreate(createClaim(), registry(), post)

    child.stderr.emit('data', 'Your quick tunnel has been created! Visit it at:\n')
    child.stderr.emit('data', 'https://random-words-here.trycloudflare.com\n')

    const tunnelChunks = posts.filter(([endpoint, body]) => endpoint.endsWith('/progress') && (body.chunk as Record<string, unknown>).stream === 'tunnel')
    expect(tunnelChunks).toHaveLength(1)
    expect(tunnelChunks[0][1].chunk).toMatchObject({
      stream: 'tunnel', publicUrl: 'https://random-words-here.trycloudflare.com', localUrl: 'http://127.0.0.1:5173', provider: 'cloudflared',
    })

    // Emitting the same URL again must not post a second tunnel chunk.
    child.stderr.emit('data', 'https://random-words-here.trycloudflare.com\n')
    const tunnelChunksAfter = posts.filter(([endpoint, body]) => endpoint.endsWith('/progress') && (body.chunk as Record<string, unknown>).stream === 'tunnel')
    expect(tunnelChunksAfter).toHaveLength(1)
  })

  it('tags raw stdout as status and stderr as stderr progress chunks', async () => {
    const child = new FakeCloudflaredProcess()
    __setSpawnCloudflaredForTests(() => child)
    const posts: Array<[string, Record<string, unknown>]> = []
    const post = jest.fn(async (endpoint: string, body: Record<string, unknown>) => {
      posts.push([endpoint, body])
      return new Response('', { status: 200 })
    })

    await handleTunnelCreate(createClaim(), registry(), post)
    child.stdout.emit('data', 'some stdout line\n')
    child.stderr.emit('data', 'some stderr line\n')

    const streams = posts.map(([, body]) => (body.chunk as Record<string, unknown>).stream)
    expect(streams).toContain('status')
    expect(streams).toContain('stderr')
  })

  it('posts an exited completion with the exit code when the process exits naturally', async () => {
    const child = new FakeCloudflaredProcess()
    __setSpawnCloudflaredForTests(() => child)
    const posts: Array<[string, Record<string, unknown>]> = []
    const post = jest.fn(async (endpoint: string, body: Record<string, unknown>) => {
      posts.push([endpoint, body])
      return new Response('', { status: 200 })
    })

    await handleTunnelCreate(createClaim(), registry(), post)
    child.emit('exit', 0, null)

    expect(activeWorkbenchTunnelIds()).not.toContain('wbt_a')
    const completion = posts.find(([endpoint]) => endpoint.endsWith('/complete'))
    expect(completion?.[1]).toEqual(expect.objectContaining({ outcome: 'exited', exitCode: 0 }))
  })

  it('kills the process and posts a killed completion via the exit handler', async () => {
    const child = new FakeCloudflaredProcess()
    __setSpawnCloudflaredForTests(() => child)
    const posts: Array<[string, Record<string, unknown>]> = []
    const post = jest.fn(async (endpoint: string, body: Record<string, unknown>) => {
      posts.push([endpoint, body])
      return new Response('', { status: 200 })
    })

    await handleTunnelCreate(createClaim(), registry(), post)
    handleTunnelKill('wbt_a')
    expect(child.killed).toBe(true)
    child.emit('exit', null, 'SIGTERM')

    const completion = posts.find(([endpoint]) => endpoint.endsWith('/complete'))
    expect(completion?.[1]).toEqual(expect.objectContaining({ outcome: 'killed' }))
    expect(activeWorkbenchTunnelIds()).not.toContain('wbt_a')

    // Killing an already-gone tunnel is a no-op, not an error.
    expect(() => handleTunnelKill('wbt_a')).not.toThrow()
  })

  it('posts a failed completion with a clear message when cloudflared is missing (ENOENT)', async () => {
    __setSpawnCloudflaredForTests(() => {
      const error = new Error('spawn cloudflared ENOENT')
      throw error
    })
    const post = jest.fn(async () => new Response('', { status: 200 }))

    await expect(handleTunnelCreate(createClaim(), registry(), post)).rejects.toThrow(/cloudflared.*binary/i)
  })

  it('posts a failed completion when the process errors after spawning', async () => {
    const child = new FakeCloudflaredProcess()
    __setSpawnCloudflaredForTests(() => child)
    const posts: Array<[string, Record<string, unknown>]> = []
    const post = jest.fn(async (endpoint: string, body: Record<string, unknown>) => {
      posts.push([endpoint, body])
      return new Response('', { status: 200 })
    })

    await handleTunnelCreate(createClaim(), registry(), post)
    child.emit('error', new Error('EACCES'))

    const completion = posts.find(([endpoint]) => endpoint.endsWith('/complete'))
    expect(completion?.[1]).toEqual(expect.objectContaining({ outcome: 'failed' }))
    expect(activeWorkbenchTunnelIds()).not.toContain('wbt_a')
  })

  it('rejects malformed tunnel claims before spawning cloudflared', async () => {
    const spawn = jest.fn(() => new FakeCloudflaredProcess())
    __setSpawnCloudflaredForTests(spawn)
    const post = jest.fn(async () => new Response('', { status: 200 }))

    await expect(handleTunnelCreate(createClaim({ leaseToken: 'short' }), registry(), post)).rejects.toThrow(/invalid workbench tunnel claim/i)
    await expect(handleTunnelCreate(createClaim({ port: 80 }), registry(), post)).rejects.toThrow(/invalid workbench tunnel claim/i)
    await expect(handleTunnelCreate(createClaim({ bindHost: '0.0.0.0' as never }), registry(), post)).rejects.toThrow(/invalid workbench tunnel claim/i)
    await expect(handleTunnelCreate(createClaim({ provider: 'ngrok' as never }), registry(), post)).rejects.toThrow(/invalid workbench tunnel claim/i)
    expect(spawn).not.toHaveBeenCalled()
  })

  it('rejects a duplicate create claim for a tunnel that is already active', async () => {
    __setSpawnCloudflaredForTests(() => new FakeCloudflaredProcess())
    const post = jest.fn(async () => new Response('', { status: 200 }))

    await handleTunnelCreate(createClaim(), registry(), post)
    await expect(handleTunnelCreate(createClaim(), registry(), post)).rejects.toThrow(/already active/i)
  })

  it('dispatches create and control(kill) claim kinds through runWorkbenchTunnelClaim', async () => {
    const child = new FakeCloudflaredProcess()
    __setSpawnCloudflaredForTests(() => child)
    const post = jest.fn(async () => new Response('', { status: 200 }))

    await runWorkbenchTunnelClaim(createClaim(), registry(), post)
    expect(activeWorkbenchTunnelIds()).toContain('wbt_a')

    await runWorkbenchTunnelClaim(controlClaim(), registry(), post)
    expect(child.killed).toBe(true)
  })

  it('sweeps tunnels running past the TTL and reports a killed completion', async () => {
    const child = new FakeCloudflaredProcess()
    __setSpawnCloudflaredForTests(() => child)
    const posts: Array<[string, Record<string, unknown>]> = []
    const post = jest.fn(async (endpoint: string, body: Record<string, unknown>) => {
      posts.push([endpoint, body])
      return new Response('', { status: 200 })
    })
    const startedAt = Date.now()
    await handleTunnelCreate(createClaim(), registry(), post)

    sweepExpiredWorkbenchTunnels(startedAt + 10 * 60_000, 30 * 60_000)
    expect(child.killed).toBe(false)

    sweepExpiredWorkbenchTunnels(startedAt + 31 * 60_000, 30 * 60_000)
    expect(child.killed).toBe(true)
    child.emit('exit', null, 'SIGTERM')
    const completion = posts.find(([endpoint]) => endpoint.endsWith('/complete'))
    expect(completion?.[1]).toEqual(expect.objectContaining({ outcome: 'killed' }))
  })

  it('polls tunnel claims independently with the shared idle-backoff shape', async () => {
    const claimed = controlClaim()
    const run = jest.fn(async () => undefined)
    let claims = 0
    await pollWorkbenchTunnelsForever(
      async () => (++claims === 1 ? claimed : null),
      run,
      () => claims > 1,
      async () => undefined,
    )
    expect(run).toHaveBeenCalledWith(claimed)
  })
})
