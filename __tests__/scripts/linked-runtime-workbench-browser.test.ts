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
  redactWorkbenchBrowserText,
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
  /** Accessibility.getFullAXTree payload served to the supervisor. */
  axTree: Array<Record<string, unknown>> = []
  /** DOM.getBoxModel `content` quads keyed by backendDOMNodeId. */
  boxModels = new Map<number, number[]>()
  private listeners = new Map<string, Listener[]>()

  addEventListener(event: string, listener: Listener): void {
    this.listeners.set(event, [...(this.listeners.get(event) ?? []), listener])
  }

  removeEventListener(event: string, listener: Listener): void {
    this.listeners.set(event, (this.listeners.get(event) ?? []).filter((candidate) => candidate !== listener))
  }

  /** Simulates Chrome pushing a CDP event (dialogs, console, frames, …). */
  emitCdpEvent(method: string, params: Record<string, unknown>, sessionId?: string): void {
    this.emit('message', { data: JSON.stringify({ method, params, ...(sessionId ? { sessionId } : {}) }) })
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
    if (method === 'Accessibility.getFullAXTree') result = { nodes: this.axTree }
    if (method === 'DOM.getBoxModel') {
      const content = this.boxModels.get(Number(params.backendNodeId))
      if (content) result = { model: { content } }
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

  it('dispatches click/type/press/scroll over CDP against the attached page and publishes a frame after each', async () => {
    const { socket } = installFakeBrowser()
    const posts: Array<[string, Record<string, unknown>]> = []
    const post = jest.fn(async (endpoint: string, body: Record<string, unknown>) => {
      posts.push([endpoint, body])
      if (endpoint.endsWith('/frames')) {
        return Response.json({ success: true, data: { imageUrl: `https://frames.example/${posts.length}.jpg`, contentType: 'image/jpeg' } })
      }
      return Response.json({ success: true, data: { accepted: true } })
    })
    await runWorkbenchBrowserClaim(createClaim(), registry(), post)

    await runWorkbenchBrowserClaim(controlClaim({ kind: 'click', x: 100, y: 200, button: 'left' }), registry(), post)
    await runWorkbenchBrowserClaim(controlClaim({ kind: 'type', text: 'hello@example.com' }), registry(), post)
    await runWorkbenchBrowserClaim(controlClaim({ kind: 'press', key: 'Enter' }), registry(), post)
    await runWorkbenchBrowserClaim(controlClaim({ kind: 'scroll', x: 10, y: 20, deltaX: 0, deltaY: 400 }), registry(), post)

    const clicks = socket.sent.filter((message) =>
      message.method === 'Input.dispatchMouseEvent' && (message.params as Record<string, unknown>).type !== 'mouseWheel')
    expect(clicks.map((message) => (message.params as Record<string, unknown>).type)).toEqual(['mousePressed', 'mouseReleased'])
    expect(clicks[0].params).toMatchObject({ x: 100, y: 200, button: 'left', clickCount: 1 })
    expect(clicks.every((message) => message.sessionId === 'cdp-session-a')).toBe(true)

    expect(socket.sent.find((message) => message.method === 'Input.insertText')?.params).toEqual({ text: 'hello@example.com' })

    const keys = socket.sent.filter((message) => message.method === 'Input.dispatchKeyEvent')
    expect(keys.map((message) => (message.params as Record<string, unknown>).type)).toEqual(['keyDown', 'keyUp'])
    expect(keys[0].params).toMatchObject({ key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' })

    const wheel = socket.sent.find((message) =>
      message.method === 'Input.dispatchMouseEvent' && (message.params as Record<string, unknown>).type === 'mouseWheel')
    expect(wheel?.params).toMatchObject({ x: 10, y: 20, deltaX: 0, deltaY: 400 })

    // One frame from create plus one after each of the four interactions.
    expect(posts.filter(([endpoint]) => endpoint.endsWith('/frames'))).toHaveLength(5)
  })

  it('captures on an interval while following and stops on follow_stop and on kill', async () => {
    const { socket } = installFakeBrowser()
    const posts: Array<[string, Record<string, unknown>]> = []
    const post = jest.fn(async (endpoint: string, body: Record<string, unknown>) => {
      posts.push([endpoint, body])
      if (endpoint.endsWith('/frames')) {
        return Response.json({ success: true, data: { imageUrl: `https://frames.example/${posts.length}.jpg`, contentType: 'image/jpeg' } })
      }
      return Response.json({ success: true, data: { accepted: true } })
    })
    const frameCount = () => posts.filter(([endpoint]) => endpoint.endsWith('/frames')).length
    // `Response.json()` consumes a stream through setImmediate, so that timer
    // stays real; only the follow interval itself is virtualized here.
    const tick = async (milliseconds: number) => {
      await jest.advanceTimersByTimeAsync(milliseconds)
      for (let index = 0; index < 5; index += 1) await new Promise<void>((resolve) => setImmediate(resolve))
    }

    await runWorkbenchBrowserClaim(createClaim(), registry(), post)
    jest.useFakeTimers({ doNotFake: ['setImmediate', 'queueMicrotask', 'nextTick'] })
    try {
      const afterCreate = frameCount()
      await runWorkbenchBrowserClaim(controlClaim({ kind: 'follow_start', intervalMs: 500 }), registry(), post)
      expect(frameCount()).toBe(afterCreate)

      await tick(500)
      expect(frameCount()).toBe(afterCreate + 1)

      await tick(500)
      await tick(500)
      expect(frameCount()).toBe(afterCreate + 3)

      await runWorkbenchBrowserClaim(controlClaim({ kind: 'follow_stop' }), registry(), post)
      const afterStop = frameCount()
      await tick(2_000)
      expect(frameCount()).toBe(afterStop)

      // A restarted follow must also stop when the session is killed.
      await runWorkbenchBrowserClaim(controlClaim({ kind: 'follow_start', intervalMs: 500 }), registry(), post)
      await tick(500)
      expect(frameCount()).toBe(afterStop + 1)

      await runWorkbenchBrowserClaim(controlClaim({ kind: 'kill' }), registry(), post)
      const afterKill = frameCount()
      await tick(5_000)
      expect(frameCount()).toBe(afterKill)
      expect(socket.closed).toBe(true)
    } finally {
      jest.useRealTimers()
    }
  })

  it('rejects out-of-range, unsafe, or unknown interaction controls before touching CDP', async () => {
    const { socket } = installFakeBrowser()
    const post = jest.fn(async (endpoint: string) => (endpoint.endsWith('/frames')
      ? Response.json({ success: true, data: { imageUrl: 'https://frames.example/f.jpg', contentType: 'image/jpeg' } })
      : Response.json({ success: true })))
    await runWorkbenchBrowserClaim(createClaim(), registry(), post)
    const sentBefore = socket.sent.length

    for (const control of [
      { kind: 'click', x: 5_000, y: 10 },
      { kind: 'click', x: -1, y: 10 },
      { kind: 'click', x: 10, y: 10, button: 'back' },
      { kind: 'type', text: '' },
      { kind: 'type', text: 'red \u001b[31mtext' },
      { kind: 'type', text: 'x'.repeat(2_001) },
      { kind: 'press', key: 'F12' },
      { kind: 'scroll', x: 10, y: 10 },
      { kind: 'scroll', x: 10, y: 10, deltaY: 100_001 },
      { kind: 'follow_start', intervalMs: 10 },
      { kind: 'follow_stop', extra: true },
    ] as unknown as Array<Extract<WorkbenchBrowserClaim, { kind: 'control' }>['control']>) {
      await expect(runWorkbenchBrowserClaim(controlClaim(control), registry(), post))
        .rejects.toThrow(/invalid workbench browser/i)
    }
    expect(socket.sent).toHaveLength(sentBefore)
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

  it('redacts passwords, tokens, api keys, bearer tokens, and emails while leaving plain text and short values intact', () => {
    // The generic key-value rule keeps the key and separator (`$1$3[redacted]`)
    // and drops only the secret VALUE, so `password=…` becomes
    // `password=[redacted]`. Bearer tokens are scrubbed first so
    // "Authorization: Bearer <jwt>" cannot leak the credential past the
    // whitespace-stopping generic rule.
    expect(redactWorkbenchBrowserText('password=hunter2')).toBe('password=[redacted]')
    expect(redactWorkbenchBrowserText('pass=hunter2')).toBe('pass=[redacted]')
    expect(redactWorkbenchBrowserText('pwd: abc123def456ghi')).toBe('pwd: [redacted]')
    expect(redactWorkbenchBrowserText('token=abcdef123456')).toBe('token=[redacted]')
    expect(redactWorkbenchBrowserText('secret 0123456789abcdef')).toBe('secret [redacted]')
    expect(redactWorkbenchBrowserText('api_key = 0123456789abcdef')).toBe('api_key = [redacted]')
    expect(redactWorkbenchBrowserText('apiKey=0123456789abcdef')).toBe('apiKey=[redacted]')
    expect(redactWorkbenchBrowserText('authorization: abcdefghijkl')).toBe('authorization: [redacted]')
    expect(redactWorkbenchBrowserText('Bearer abc.def.ghi')).toBe('Bearer [redacted]')
    // Regression: a JWT after "Authorization: Bearer " must never reach the agent.
    expect(redactWorkbenchBrowserText('Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.abc.def')).toBe('Authorization: Bearer [redacted]')
    expect(redactWorkbenchBrowserText('Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.abc.def')).not.toContain('eyJhbGciOiJIUzI1NiJ9')
    expect(redactWorkbenchBrowserText('sk-abcdefghijklmnopqrstuvwxyz')).toBe('[key]')
    expect(redactWorkbenchBrowserText('ghp_1234567890123456789012345678901234567890')).toBe('[key]')
    expect(redactWorkbenchBrowserText('AIzaSyA12345678901234567890')).toBe('[key]')
    expect(redactWorkbenchBrowserText('AKIAABCDEFGHIJKLMNOP')).toBe('[key]')
    expect(redactWorkbenchBrowserText('contact alice@example.com now')).toBe('contact [email] now')
    // The secret value is gone no matter the separator quirk.
    expect(redactWorkbenchBrowserText('password=hunter2')).not.toContain('hunter2')
    // Plain text and secrets shorter than the 6-char minimum stay untouched.
    expect(redactWorkbenchBrowserText('plain text')).toBe('plain text')
    expect(redactWorkbenchBrowserText('pwd=short')).toBe('pwd=short')
    expect(redactWorkbenchBrowserText('no secrets here')).toBe('no secrets here')
  })

  it('validates the new agent-aware control kinds (snapshot/console/dialog/click_ref) before touching CDP', async () => {
    const post = jest.fn(async () => Response.json({ success: true }))
    // Valid controls pass claim/control validation and only fail on the missing session.
    for (const control of [
      { kind: 'snapshot' },
      { kind: 'console' },
      { kind: 'dialog', accept: true },
      { kind: 'dialog', accept: false, promptText: 'yes' },
      { kind: 'click_ref', ref: '@e1' },
      { kind: 'click_ref', ref: 'e1' }, // bare refs are normalized to @eN
    ] as Array<Extract<WorkbenchBrowserClaim, { kind: 'control' }>['control']>) {
      await expect(runWorkbenchBrowserClaim(controlClaim(control), registry(), post)).rejects.toThrow(/session not found/)
    }
    for (const control of [
      { kind: 'snapshot', extra: true },
      { kind: 'console', extra: true },
      { kind: 'dialog' },
      { kind: 'dialog', accept: 'yes' },
      { kind: 'dialog', accept: true, promptText: 'bad\u0001text' },
      { kind: 'click_ref' },
      { kind: 'click_ref', ref: 'bad ref!' },
      { kind: 'click_ref', ref: 'x'.repeat(33) },
      { kind: 'click_ref', ref: '@e1', extra: true },
      { kind: 'unknown-kind' },
    ] as unknown as Array<Extract<WorkbenchBrowserClaim, { kind: 'control' }>['control']>) {
      await expect(runWorkbenchBrowserClaim(controlClaim(control), registry(), post)).rejects.toThrow(/invalid workbench browser/i)
    }
  })

  it('publishes an accessibility snapshot with @eN refs resolved to backendDOMNodeIds and truncates huge trees', async () => {
    const { socket } = installFakeBrowser()
    const posts: Array<[string, Record<string, unknown>]> = []
    const post = jest.fn(async (endpoint: string, body: Record<string, unknown>) => {
      posts.push([endpoint, body])
      if (endpoint.endsWith('/frames')) {
        return Response.json({ success: true, data: { imageUrl: `https://frames.example/${posts.length}.jpg`, contentType: 'image/jpeg' } })
      }
      return Response.json({ success: true, data: { accepted: true } })
    })
    socket.axTree = [
      { nodeId: 'n1', role: { value: 'button' }, name: { value: 'Search' }, backendDOMNodeId: 42, childIds: [] },
      { nodeId: 'n2', role: { value: 'textbox' }, name: { value: 'Query' }, value: { value: 'cats' }, backendDOMNodeId: 43, childIds: [] },
      { nodeId: 'n3', role: { value: 'statictext' }, name: { value: 'Hello world' }, backendDOMNodeId: 44, childIds: [] },
    ]
    await runWorkbenchBrowserClaim(createClaim(), registry(), post)
    await runWorkbenchBrowserClaim(controlClaim({ kind: 'snapshot' }), registry(), post)

    const snapshotPosts = posts.filter(([endpoint, body]) => endpoint.endsWith('/progress') && (body.chunk as { stream?: string }).stream === 'snapshot')
    const snapshot = (snapshotPosts[0][1].chunk as { snapshot: { ax: string; refs: Record<string, unknown>; url?: string } }).snapshot
    expect(snapshot.ax).toContain('[@e1] button "Search"')
    expect(snapshot.ax).toContain('[@e2] textbox "Query" value="cats"')
    expect(snapshot.ax).toContain('[@e3] statictext "Hello world"')
    expect(snapshot.refs).toMatchObject({
      '@e1': { backendDOMNodeId: 42, role: 'button', name: 'Search' },
      '@e2': { backendDOMNodeId: 43, role: 'textbox', name: 'Query' },
      '@e3': { backendDOMNodeId: 44, role: 'statictext', name: 'Hello world' },
    })
    expect((snapshot.refs['@e1'] as { backendDOMNodeId?: number }).backendDOMNodeId).toBe(42)
    expect(snapshot.url).toBe('https://example.com/start')

    // A huge tree must be capped with a truncation marker, not shipped whole.
    const hugeTree: Array<Record<string, unknown>> = []
    for (let index = 1; index <= 1_200; index += 1) {
      hugeTree.push({
        nodeId: `h${index}`,
        role: { value: 'button' },
        name: { value: `Item number ${index} ${'x'.repeat(30)}` },
        backendDOMNodeId: 1_000 + index,
        childIds: [],
      })
    }
    socket.axTree = hugeTree
    await runWorkbenchBrowserClaim(controlClaim({ kind: 'snapshot' }), registry(), post)
    const allSnapshotPosts = posts.filter(([endpoint, body]) => endpoint.endsWith('/progress') && (body.chunk as { stream?: string }).stream === 'snapshot')
    const truncatedChunk = allSnapshotPosts[allSnapshotPosts.length - 1][1].chunk as { snapshot: { ax: string; refs: Record<string, unknown> } }
    const truncated = truncatedChunk.snapshot.ax
    expect(truncated).toMatch(/… truncated$/)
    expect(truncated.length).toBeGreaterThan(10_000)
    expect(truncated.length).toBeLessThan(12_100)
    expect(truncated).not.toContain('Item number 1200')
    // The server validator rejects snapshots with more than MAX_SNAPSHOT_REFS
    // (400) refs, so the ref map must be capped too — a dense page like the
    // HN front page generates thousands of interesting AX nodes.
    expect(Object.keys(truncatedChunk.snapshot.refs).length).toBeLessThanOrEqual(400)
  })

  it('caps the snapshot ref map at MAX_SNAPSHOT_REFS even when every node is interesting', async () => {
    const { socket } = installFakeBrowser()
    const posts: Array<[string, Record<string, unknown>]> = []
    const post = jest.fn(async (endpoint: string, body: Record<string, unknown>) => {
      posts.push([endpoint, body])
      if (endpoint.endsWith('/frames')) {
        return Response.json({ success: true, data: { imageUrl: `https://frames.example/${posts.length}.jpg`, contentType: 'image/jpeg' } })
      }
      return Response.json({ success: true, data: { accepted: true } })
    })
    // Short names keep each AX line small so the 12,000-char cap would allow
    // far more than 400 refs — this is the HN-front-page shape that previously
    // shipped a >400-ref snapshot and got rejected by the server validator.
    socket.axTree = Array.from({ length: 1_200 }, (_, index) => ({
      nodeId: `n${index + 1}`,
      role: { value: 'link' },
      name: { value: `L${index + 1}` },
      backendDOMNodeId: 500 + index,
      childIds: [],
    }))
    await runWorkbenchBrowserClaim(createClaim(), registry(), post)
    await runWorkbenchBrowserClaim(controlClaim({ kind: 'snapshot' }), registry(), post)
    const snapshotPosts = posts.filter(([endpoint, body]) => endpoint.endsWith('/progress') && (body.chunk as { stream?: string }).stream === 'snapshot')
    const snapshot = (snapshotPosts[snapshotPosts.length - 1][1].chunk as { snapshot: { ax: string; refs: Record<string, unknown> } }).snapshot
    expect(Object.keys(snapshot.refs).length).toBe(400)
    expect(snapshot.refs['@e400']).toMatchObject({ role: 'link', name: 'L400' })
    expect(snapshot.refs['@e401']).toBeUndefined()
    expect(snapshot.ax).toContain('[@e400] link "L400"')
    expect(snapshot.ax).not.toContain('[@e401]')
  })

  it('tracks native JS dialogs, includes them in snapshots, and answers them via Page.handleJavaScriptDialog', async () => {
    const { socket } = installFakeBrowser()
    const posts: Array<[string, Record<string, unknown>]> = []
    const post = jest.fn(async (endpoint: string, body: Record<string, unknown>) => {
      posts.push([endpoint, body])
      if (endpoint.endsWith('/frames')) {
        return Response.json({ success: true, data: { imageUrl: `https://frames.example/${posts.length}.jpg`, contentType: 'image/jpeg' } })
      }
      return Response.json({ success: true, data: { accepted: true } })
    })
    await runWorkbenchBrowserClaim(createClaim(), registry(), post)

    socket.emitCdpEvent('Page.javascriptDialogOpening', { type: 'confirm', message: 'Are you sure?' }, 'cdp-session-a')
    await flushAsyncWork()

    await runWorkbenchBrowserClaim(controlClaim({ kind: 'snapshot' }), registry(), post)
    const snapshotPost = posts.find(([endpoint, body]) => endpoint.endsWith('/progress') && (body.chunk as { stream?: string }).stream === 'snapshot')
    expect((snapshotPost?.[1].chunk as { snapshot: { pendingDialog: unknown } }).snapshot.pendingDialog)
      .toEqual({ type: 'confirm', message: 'Are you sure?' })

    await runWorkbenchBrowserClaim(controlClaim({ kind: 'dialog', accept: true }), registry(), post)
    const handled = socket.sent.filter((message) => message.method === 'Page.handleJavaScriptDialog')
    expect(handled).toHaveLength(1)
    expect(handled[0].params).toEqual({ accept: true })
    expect(handled[0].sessionId).toBe('cdp-session-a')

    // prompt dialogs forward promptText to the browser.
    socket.emitCdpEvent('Page.javascriptDialogOpening', { type: 'prompt', message: 'Enter your age' }, 'cdp-session-a')
    await runWorkbenchBrowserClaim(controlClaim({ kind: 'dialog', accept: false, promptText: '42' }), registry(), post)
    const handledMessages = socket.sent.filter((message) => message.method === 'Page.handleJavaScriptDialog')
    expect(handledMessages[handledMessages.length - 1].params).toEqual({ accept: false, promptText: '42' })

    // Answering a dialog that is not open is a supervised error.
    await expect(runWorkbenchBrowserClaim(controlClaim({ kind: 'dialog', accept: true }), registry(), post))
      .rejects.toThrow(/no pending browser dialog/)
  })

  it('resolves click_ref from the last snapshot to viewport coordinates and clicks the box center', async () => {
    const { socket } = installFakeBrowser()
    const posts: Array<[string, Record<string, unknown>]> = []
    const post = jest.fn(async (endpoint: string, body: Record<string, unknown>) => {
      posts.push([endpoint, body])
      if (endpoint.endsWith('/frames')) {
        return Response.json({ success: true, data: { imageUrl: `https://frames.example/${posts.length}.jpg`, contentType: 'image/jpeg' } })
      }
      return Response.json({ success: true, data: { accepted: true } })
    })
    await runWorkbenchBrowserClaim(createClaim(), registry(), post)

    // No snapshot yet: every ref is unknown.
    await expect(runWorkbenchBrowserClaim(controlClaim({ kind: 'click_ref', ref: '@e1' }), registry(), post))
      .rejects.toThrow(/not in the last snapshot/)

    socket.axTree = [
      { nodeId: 'n1', role: { value: 'button' }, name: { value: 'Search' }, backendDOMNodeId: 42, childIds: [] },
    ]
    socket.boxModels.set(42, [100, 200, 300, 200, 300, 400, 100, 400])
    await runWorkbenchBrowserClaim(controlClaim({ kind: 'snapshot' }), registry(), post)

    await runWorkbenchBrowserClaim(controlClaim({ kind: 'click_ref', ref: '@e1' }), registry(), post)
    const clicks = socket.sent.filter((message) =>
      message.method === 'Input.dispatchMouseEvent' && (message.params as Record<string, unknown>).type !== 'mouseWheel')
    expect(clicks.map((message) => (message.params as Record<string, unknown>).type)).toEqual(['mousePressed', 'mouseReleased'])
    expect(clicks[0].params).toMatchObject({ x: 200, y: 300, button: 'left', clickCount: 1 })
    expect(clicks.every((message) => message.sessionId === 'cdp-session-a')).toBe(true)
    expect(socket.sent.find((message) => message.method === 'DOM.getBoxModel')?.params).toEqual({ backendNodeId: 42 })

    // A ref that is not in the last snapshot must be rejected.
    await expect(runWorkbenchBrowserClaim(controlClaim({ kind: 'click_ref', ref: '@e99' }), registry(), post))
      .rejects.toThrow(/not in the last snapshot/)
  })

  it('keeps a capped console ring from consoleAPICalled and exceptionThrown and streams it on demand', async () => {
    const { socket } = installFakeBrowser()
    const posts: Array<[string, Record<string, unknown>]> = []
    const post = jest.fn(async (endpoint: string, body: Record<string, unknown>) => {
      posts.push([endpoint, body])
      if (endpoint.endsWith('/frames')) {
        return Response.json({ success: true, data: { imageUrl: `https://frames.example/${posts.length}.jpg`, contentType: 'image/jpeg' } })
      }
      return Response.json({ success: true, data: { accepted: true } })
    })
    await runWorkbenchBrowserClaim(createClaim(), registry(), post)

    for (let index = 1; index <= 55; index += 1) {
      socket.emitCdpEvent('Runtime.consoleAPICalled', {
        type: 'error',
        args: [{ type: 'string', value: `msg-${index}` }],
        executionContextId: 1,
        timestamp: 1,
      }, 'cdp-session-a')
    }
    socket.emitCdpEvent('Runtime.exceptionThrown', {
      exceptionDetails: {
        text: 'Uncaught',
        exception: { description: 'TypeError: boom is not a function\n    at <anonymous>:1:1' },
        url: 'https://example.com/app.js',
      },
    }, 'cdp-session-a')
    await flushAsyncWork()

    await runWorkbenchBrowserClaim(controlClaim({ kind: 'console' }), registry(), post)
    const consolePost = posts.find(([endpoint, body]) => endpoint.endsWith('/progress') && (body.chunk as { stream?: string }).stream === 'console')
    const entries = (consolePost?.[1].chunk as { entries: Array<{ level: string; text: string; url?: string }> }).entries
    expect(entries).toHaveLength(50)
    expect(entries[0]).toEqual({ level: 'error', text: 'msg-7' })
    expect(entries[48]).toEqual({ level: 'error', text: 'msg-55' })
    expect(entries[49]).toEqual({ level: 'exception', text: 'Uncaught: TypeError: boom is not a function', url: 'https://example.com/app.js' })
    expect(entries.some((entry) => entry.text === 'msg-6')).toBe(false)
  })

  it('redacts secrets in snapshot names and console entries before they reach the agent', async () => {
    const { socket } = installFakeBrowser()
    const posts: Array<[string, Record<string, unknown>]> = []
    const post = jest.fn(async (endpoint: string, body: Record<string, unknown>) => {
      posts.push([endpoint, body])
      if (endpoint.endsWith('/frames')) {
        return Response.json({ success: true, data: { imageUrl: `https://frames.example/${posts.length}.jpg`, contentType: 'image/jpeg' } })
      }
      return Response.json({ success: true, data: { accepted: true } })
    })
    socket.axTree = [
      { nodeId: 'n1', role: { value: 'button' }, name: { value: 'Login password=secret123' }, backendDOMNodeId: 42, childIds: [] },
    ]
    await runWorkbenchBrowserClaim(createClaim(), registry(), post)

    socket.emitCdpEvent('Runtime.consoleAPICalled', {
      type: 'error',
      args: [{ type: 'string', value: 'login failed password=secret123' }],
      executionContextId: 1,
      timestamp: 1,
    }, 'cdp-session-a')
    await flushAsyncWork()

    await runWorkbenchBrowserClaim(controlClaim({ kind: 'snapshot' }), registry(), post)
    await runWorkbenchBrowserClaim(controlClaim({ kind: 'console' }), registry(), post)

    const snapshotPost = posts.find(([endpoint, body]) => endpoint.endsWith('/progress') && (body.chunk as { stream?: string }).stream === 'snapshot')
    const snapshot = (snapshotPost?.[1].chunk as { snapshot: { ax: string; refs: Record<string, unknown> } }).snapshot
    // The secret value is scrubbed from both the AX line and the refs map.
    expect(snapshot.ax).toContain('[redacted]')
    expect(snapshot.ax).not.toContain('secret123')
    expect(snapshot.ax).not.toContain('password=secret123')
    expect((snapshot.refs['@e1'] as { name: string }).name).toBe('Login password=[redacted]')

    const consolePost = posts.find(([endpoint, body]) => endpoint.endsWith('/progress') && (body.chunk as { stream?: string }).stream === 'console')
    const entries = (consolePost?.[1].chunk as { entries: Array<{ text: string }> }).entries
    expect(entries[0].text).toBe('login failed password=[redacted]')
    expect(entries[0].text).not.toContain('secret123')
  })
})
