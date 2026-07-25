/** @jest-environment node */
import fs from 'node:fs'
import path from 'node:path'
import { MappingRegistry } from '../../runtime-installers/runtime/bridge'
import {
  __resetWorkbenchBrowsersForTests,
  __setWorkbenchBrowserDependenciesForTests,
  activeWorkbenchBrowserSessionIds,
  handleWorkbenchBrowserCreate,
  linkedRuntimeWorkbenchBrowserClaimBody,
  pollWorkbenchBrowserForever,
  runWorkbenchBrowserClaim,
  type BrowserChildProcess,
  type BrowserWebSocket,
  type WorkbenchBrowserClaim,
} from '../../runtime-installers/runtime/workbench-browser'

const LEASE_TOKEN = 'lease-token-1234567890'

function createClaim(overrides: Partial<Extract<WorkbenchBrowserClaim, { kind: 'create' }>> = {}): WorkbenchBrowserClaim {
  return {
    kind: 'create',
    sessionId: 'browser-session-a',
    startUrl: 'https://example.com/start',
    viewport: { width: 1280, height: 720 },
    workspaceId: 'workspace-a',
    mappingId: 'mapping-a',
    relativeFolder: '',
    attempt: 1,
    leaseToken: LEASE_TOKEN,
    ...overrides,
  }
}

function controlClaim(
  control: Extract<WorkbenchBrowserClaim, { kind: 'control' }>['control'],
  overrides: Partial<Extract<WorkbenchBrowserClaim, { kind: 'control' }>> = {},
): WorkbenchBrowserClaim {
  return {
    kind: 'control',
    sessionId: 'browser-session-a',
    control,
    attempt: 1,
    leaseToken: LEASE_TOKEN,
    ...overrides,
  }
}

class FakeChild implements BrowserChildProcess {
  pid = 4242
  killed = false
  private listeners = new Map<string, Array<(...args: unknown[]) => void>>()

  once(event: 'error' | 'exit', listener: (...args: unknown[]) => void): void {
    const existing = this.listeners.get(event) ?? []
    existing.push(listener)
    this.listeners.set(event, existing)
  }

  kill(): void {
    if (this.killed) return
    this.killed = true
    queueMicrotask(() => this.emit('exit', 0, 'SIGTERM'))
  }

  emit(event: 'error' | 'exit', ...args: unknown[]): void {
    for (const listener of this.listeners.get(event) ?? []) listener(...args)
  }
}

type Listener = (event: unknown) => void

class FakeWebSocket implements BrowserWebSocket {
  readonly sent: Array<Record<string, unknown>> = []
  readonly readyState = 1
  closed = false
  captureCount = 0
  pageUrl = 'about:blank'
  pageTitle = ''
  private listeners = new Map<string, Listener[]>()

  addEventListener(event: string, listener: Listener): void {
    this.listeners.set(event, [...(this.listeners.get(event) ?? []), listener])
  }

  removeEventListener(event: string, listener: Listener): void {
    this.listeners.set(event, (this.listeners.get(event) ?? []).filter((candidate) => candidate !== listener))
  }

  send(data: string): void {
    const message = JSON.parse(data) as Record<string, unknown>
    this.sent.push(message)
    const id = Number(message.id)
    const method = String(message.method)
    const params = (message.params ?? {}) as Record<string, unknown>
    let result: Record<string, unknown> = {}
    if (method === 'Target.createTarget') result = { targetId: 'target-a' }
    if (method === 'Target.attachToTarget') result = { sessionId: 'cdp-session-a' }
    if (method === 'Page.navigate') {
      this.pageUrl = String(params.url)
      this.pageTitle = this.pageUrl.includes('next') ? 'Next page' : 'Start page'
    }
    if (method === 'Runtime.evaluate') result = { result: { value: { url: this.pageUrl, title: this.pageTitle } } }
    if (method === 'Page.captureScreenshot') {
      this.captureCount += 1
      const quality = Number(params.quality)
      const bytes = quality >= 80 && this.captureCount > 1
        ? Buffer.alloc(1_500_001, 1)
        : Buffer.from(`jpeg-${this.captureCount}`)
      result = { data: bytes.toString('base64') }
    }
    queueMicrotask(() => {
      this.emit('message', { data: JSON.stringify({ id, result }) })
      if (method === 'Page.navigate') {
        this.emit('message', { data: JSON.stringify({ method: 'Page.loadEventFired', sessionId: 'cdp-session-a', params: {} }) })
      }
    })
  }

  close(): void {
    this.closed = true
  }

  private emit(event: string, value: unknown): void {
    for (const listener of this.listeners.get(event) ?? []) listener(value)
  }
}

function registry(): MappingRegistry {
  return new MappingRegistry(path.join(process.cwd(), '.nonexistent-browser-test-mappings.json'))
}

function installFakeBrowser() {
  const child = new FakeChild()
  const socket = new FakeWebSocket()
  const urls: string[] = []
  const launches: Array<{ executable: string; args: string[] }> = []
  __setWorkbenchBrowserDependenciesForTests({
    chromePath: '/fixed/Google Chrome',
    spawnChrome: (executable, args) => {
      launches.push({ executable, args })
      const profileArg = args.find((arg) => arg.startsWith('--user-data-dir='))
      if (!profileArg) throw new Error('missing profile argument')
      const profile = profileArg.slice('--user-data-dir='.length)
      fs.writeFileSync(path.join(profile, 'DevToolsActivePort'), '43123\n/devtools/browser/browser-a\n')
      return child
    },
    createWebSocket: (url) => {
      urls.push(url)
      return socket
    },
    wait: async () => undefined,
  })
  return { child, socket, urls, launches }
}

async function flushAsyncWork(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve))
}

afterEach(() => {
  __resetWorkbenchBrowsersForTests()
  __setWorkbenchBrowserDependenciesForTests(undefined)
})

describe('linked-computer headless Chrome workbench browser runtime', () => {
  it('advertises the browser claim protocol and is wired into the runtime CLI pollers', () => {
    expect(linkedRuntimeWorkbenchBrowserClaimBody()).toEqual({
      runtimeVersion: expect.any(String),
      workbenchBrowserSessionsProtocolVersion: 1,
    })
    const cli = fs.readFileSync(path.join(process.cwd(), 'runtime-installers/runtime/cli.ts'), 'utf8')
    expect(cli).toContain("from './workbench-browser'")
    expect(cli).toContain('/workbench/browser/sessions/claim')
    expect(cli).toContain('pollWorkbenchBrowserForever')
  })

  it('launches a fixed Chrome binary with an isolated loopback CDP profile, navigates, captures, uploads, and posts frame progress', async () => {
    const { child, socket, urls, launches } = installFakeBrowser()
    const posts: Array<[string, Record<string, unknown>]> = []
    const post = jest.fn(async (endpoint: string, body: Record<string, unknown>) => {
      posts.push([endpoint, body])
      if (endpoint.endsWith('/frames')) {
        return Response.json({ success: true, data: { imageUrl: 'https://frames.example/frame.jpg', contentType: 'image/jpeg' } })
      }
      return Response.json({ success: true, data: { accepted: true } })
    })

    const result = await handleWorkbenchBrowserCreate(createClaim(), registry(), post)

    expect(result).toEqual({ sessionId: 'browser-session-a', pid: 4242 })
    expect(activeWorkbenchBrowserSessionIds()).toEqual(['browser-session-a'])
    expect(launches).toHaveLength(1)
    expect(launches[0].executable).toBe('/fixed/Google Chrome')
    expect(launches[0].args).toEqual(expect.arrayContaining([
      '--headless=new',
      '--remote-debugging-port=0',
      '--remote-debugging-address=127.0.0.1',
      '--window-size=1280,720',
    ]))
    expect(launches[0].args).not.toContain('--no-sandbox')
    expect(launches[0].args.some((arg) => arg.startsWith('--user-data-dir='))).toBe(true)
    expect(urls).toEqual(['ws://127.0.0.1:43123/devtools/browser/browser-a'])
    expect(socket.sent).toEqual(expect.arrayContaining([
      expect.objectContaining({ method: 'Target.createTarget' }),
      expect.objectContaining({ method: 'Target.attachToTarget' }),
      expect.objectContaining({ method: 'Emulation.setDeviceMetricsOverride' }),
      expect.objectContaining({ method: 'Page.navigate', params: { url: 'https://example.com/start' } }),
      expect.objectContaining({ method: 'Page.captureScreenshot' }),
    ]))
    expect(socket.sent.find((message) => message.method === 'Target.createTarget')?.params).toEqual({ url: 'about:blank' })

    const upload = posts.find(([endpoint]) => endpoint.endsWith('/frames'))
    expect(upload?.[0]).toBe('/workbench/browser/sessions/browser-session-a/frames')
    expect(upload?.[1]).toEqual(expect.objectContaining({
      attempt: 1,
      leaseToken: LEASE_TOKEN,
      seq: 1,
      contentType: 'image/jpeg',
      dataBase64: expect.any(String),
    }))
    expect(Buffer.from(String(upload?.[1].dataBase64), 'base64').byteLength).toBeLessThanOrEqual(1_500_000)

    const frameProgress = posts.find(([endpoint, body]) => endpoint.endsWith('/progress') && (body.chunk as { stream?: string }).stream === 'frame')
    expect(frameProgress?.[1]).toEqual({
      attempt: 1,
      leaseToken: LEASE_TOKEN,
      chunk: {
        seq: 1,
        stream: 'frame',
        imageUrl: 'https://frames.example/frame.jpg',
        contentType: 'image/jpeg',
        pageUrl: 'https://example.com/start',
        title: 'Start page',
        atMs: expect.any(Number),
      },
    })
    expect(child.killed).toBe(false)
  })

  it('dispatches navigate and capture controls, retries an oversized JPEG at lower quality, then kills and completes the browser', async () => {
    const { child, socket, launches } = installFakeBrowser()
    const posts: Array<[string, Record<string, unknown>]> = []
    const post = jest.fn(async (endpoint: string, body: Record<string, unknown>) => {
      posts.push([endpoint, body])
      if (endpoint.endsWith('/frames')) {
        return Response.json({ success: true, data: { imageUrl: `https://frames.example/${posts.length}.jpg`, contentType: 'image/jpeg' } })
      }
      return Response.json({ success: true, data: { accepted: true } })
    })
    await runWorkbenchBrowserClaim(createClaim(), registry(), post)

    await runWorkbenchBrowserClaim(controlClaim({ kind: 'navigate', url: 'https://example.com/next' }), registry(), post)
    await runWorkbenchBrowserClaim(controlClaim({ kind: 'capture' }), registry(), post)

    const captureQualities = socket.sent
      .filter((message) => message.method === 'Page.captureScreenshot')
      .map((message) => Number((message.params as Record<string, unknown>).quality))
    expect(captureQualities).toEqual(expect.arrayContaining([80, 60]))
    const uploads = posts.filter(([endpoint]) => endpoint.endsWith('/frames'))
    expect(uploads).toHaveLength(3)
    expect(uploads.every(([, body]) => Buffer.from(String(body.dataBase64), 'base64').byteLength <= 1_500_000)).toBe(true)
    expect(posts.some(([endpoint, body]) => endpoint.endsWith('/progress') && (body.chunk as { pageUrl?: string }).pageUrl === 'https://example.com/next')).toBe(true)

    const profileArg = launches[0].args.find((arg) => arg.startsWith('--user-data-dir='))!
    const profile = profileArg.slice('--user-data-dir='.length)
    expect(fs.existsSync(profile)).toBe(true)

    await runWorkbenchBrowserClaim(controlClaim({ kind: 'kill' }), registry(), post)
    await flushAsyncWork()

    expect(child.killed).toBe(true)
    expect(socket.closed).toBe(true)
    expect(activeWorkbenchBrowserSessionIds()).toEqual([])
    expect(fs.existsSync(profile)).toBe(false)
    const completion = posts.find(([endpoint]) => endpoint.endsWith('/complete'))
    expect(completion?.[1]).toEqual({ attempt: 1, leaseToken: LEASE_TOKEN, outcome: 'killed' })
  })

  it('rejects malformed claims before launching Chrome and reports a clear unavailable-browser failure', async () => {
    const spawnChrome = jest.fn()
    __setWorkbenchBrowserDependenciesForTests({ chromePath: '/fixed/chrome', spawnChrome })
    const post = jest.fn(async () => Response.json({ success: true }))

    await expect(handleWorkbenchBrowserCreate(createClaim({ viewport: { width: 100, height: 720 } }), registry(), post)).rejects.toThrow(/invalid workbench browser claim/i)
    await expect(handleWorkbenchBrowserCreate(createClaim({ startUrl: 'file:///etc/passwd' }), registry(), post)).rejects.toThrow(/invalid workbench browser claim/i)
    await expect(runWorkbenchBrowserClaim(controlClaim({ kind: 'navigate', url: 'javascript:alert(1)' }), registry(), post)).rejects.toThrow(/invalid workbench browser/i)
    expect(spawnChrome).not.toHaveBeenCalled()

    __setWorkbenchBrowserDependenciesForTests({ chromePath: null })
    await expect(handleWorkbenchBrowserCreate(createClaim(), registry(), post)).rejects.toThrow(/Chrome.*not found/i)
    expect(post).toHaveBeenCalledWith('/workbench/browser/sessions/browser-session-a/complete', expect.objectContaining({ outcome: 'failed' }))
  })

  it('cleans up and posts exactly one failed completion when the initial frame cannot be published', async () => {
    const { child } = installFakeBrowser()
    const posts: Array<[string, Record<string, unknown>]> = []
    const post = jest.fn(async (endpoint: string, body: Record<string, unknown>) => {
      posts.push([endpoint, body])
      return endpoint.endsWith('/frames')
        ? Response.json({ success: false }, { status: 413 })
        : Response.json({ success: true })
    })

    await expect(handleWorkbenchBrowserCreate(createClaim(), registry(), post)).rejects.toThrow(/frame upload rejected/i)
    await flushAsyncWork()

    expect(child.killed).toBe(true)
    expect(activeWorkbenchBrowserSessionIds()).toEqual([])
    const completions = posts.filter(([endpoint]) => endpoint.endsWith('/complete'))
    expect(completions).toHaveLength(1)
    expect(completions[0][1]).toEqual(expect.objectContaining({ outcome: 'failed' }))
  })

  it('polls browser claims independently with bounded idle backoff', async () => {
    const claimed = controlClaim({ kind: 'kill' })
    const run = jest.fn(async () => undefined)
    let claims = 0
    await pollWorkbenchBrowserForever(
      async () => (++claims === 1 ? claimed : null),
      run,
      () => claims > 1,
      async () => undefined,
    )
    expect(run).toHaveBeenCalledWith(claimed)
  })
})
