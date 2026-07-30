import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { MappingRegistry } from './bridge'
import { sanitizedShellEnv, workbenchPollDelay } from './workbench'

/** Runtime mirror of lib/messages/workbench/browser-session-store.ts. */
export interface WorkbenchBrowserViewport {
  width: number
  height: number
}

export type WorkbenchBrowserMouseButton = 'left' | 'right' | 'middle'

export type WorkbenchBrowserControl =
  | { kind: 'navigate'; url: string }
  | { kind: 'capture' }
  | { kind: 'click'; x: number; y: number; button?: WorkbenchBrowserMouseButton }
  | { kind: 'type'; text: string }
  | { kind: 'press'; key: string }
  | { kind: 'scroll'; x: number; y: number; deltaX?: number; deltaY: number }
  | { kind: 'follow_start'; intervalMs?: number }
  | { kind: 'follow_stop' }
  | { kind: 'kill' }

export type WorkbenchBrowserClaim =
  | {
    kind: 'create'
    sessionId: string
    startUrl: string | null
    viewport: WorkbenchBrowserViewport
    workspaceId: string
    mappingId: string
    relativeFolder: string
    attempt: number
    leaseToken: string
  }
  | {
    kind: 'control'
    sessionId: string
    control: WorkbenchBrowserControl
    attempt: number
    leaseToken: string
  }

export type PostFn = (path: string, body: Record<string, unknown>) => Promise<Response>

export interface BrowserChildProcess {
  pid?: number
  stderr?: { on: (event: 'data', listener: (chunk: Buffer | string) => void) => void } | null
  once: (event: 'error' | 'exit', listener: (...args: unknown[]) => void) => void
  kill: (signal?: string) => void
}

export interface BrowserWebSocket {
  readonly readyState: number
  addEventListener: (event: string, listener: (event: unknown) => void) => void
  removeEventListener: (event: string, listener: (event: unknown) => void) => void
  send: (data: string) => void
  close: () => void
}

export type SpawnChrome = (executable: string, args: string[]) => BrowserChildProcess
export type CreateWebSocket = (url: string) => BrowserWebSocket

const IDENTIFIER = /^[A-Za-z0-9_-]{1,128}$/
const LEASE_TOKEN = /^[A-Za-z0-9_-]{16,128}$/
const MIN_VIEWPORT_WIDTH = 320
const MAX_VIEWPORT_WIDTH = 1920
const MIN_VIEWPORT_HEIGHT = 240
const MAX_VIEWPORT_HEIGHT = 1200
const MAX_URL_LENGTH = 2_048
const MAX_TYPE_TEXT_LENGTH = 2_000
const MAX_SCROLL_DELTA = 100_000
const MIN_FOLLOW_INTERVAL_MS = 500
const MAX_FOLLOW_INTERVAL_MS = 5_000
const DEFAULT_FOLLOW_INTERVAL_MS = 1_000
const UNSAFE_TEXT = /[\u0000-\u0008\u000B-\u001F\u007F]/
const MOUSE_BUTTONS: ReadonlySet<string> = new Set<WorkbenchBrowserMouseButton>(['left', 'right', 'middle'])

/**
 * Mirrors `WORKBENCH_BROWSER_ALLOWED_KEYS` in
 * lib/messages/workbench/browser-sessions.ts, adding the CDP payload each key
 * needs. `text` is set only where Chrome expects the key to also insert a
 * character, so Enter submits a form and Tab moves focus while the arrows and
 * Escape stay non-inserting.
 */
const KEY_EVENTS: Record<string, { code: string; keyCode: number; text?: string }> = {
  Enter: { code: 'Enter', keyCode: 13, text: '\r' },
  Escape: { code: 'Escape', keyCode: 27 },
  Tab: { code: 'Tab', keyCode: 9, text: '\t' },
  Backspace: { code: 'Backspace', keyCode: 8 },
  Delete: { code: 'Delete', keyCode: 46 },
  ArrowUp: { code: 'ArrowUp', keyCode: 38 },
  ArrowDown: { code: 'ArrowDown', keyCode: 40 },
  ArrowLeft: { code: 'ArrowLeft', keyCode: 37 },
  ArrowRight: { code: 'ArrowRight', keyCode: 39 },
  Home: { code: 'Home', keyCode: 36 },
  End: { code: 'End', keyCode: 35 },
  PageUp: { code: 'PageUp', keyCode: 33 },
  PageDown: { code: 'PageDown', keyCode: 34 },
}
// Stay below the route's 1.5 MiB ceiling even when "MB" is interpreted as
// decimal by callers/proxies.
const MAX_FRAME_BYTES = 1_500_000
const DEVTOOLS_START_TIMEOUT_MS = 15_000
const DEVTOOLS_POLL_INTERVAL_MS = 50
const PAGE_LOAD_TIMEOUT_MS = 10_000
const HEARTBEAT_INTERVAL_MS = 30_000
const BROWSER_SESSION_TTL_MS = 30 * 60 * 1_000
const BROWSER_MAX_POLL_DELAY_MS = 1_000
const JPEG_QUALITIES = [80, 60, 40, 20] as const
const CHROME_MISSING_MESSAGE = 'Google Chrome or Chromium was not found on this computer. Install Chrome in a standard location or set PIB_CHROME_PATH.'

const CHROME_PATHS: Record<'darwin' | 'linux', readonly string[]> = {
  darwin: [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  ],
  linux: [
    '/usr/bin/google-chrome-stable',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/opt/google/chrome/chrome',
  ],
}

function windowsChromePaths(env: NodeJS.ProcessEnv): string[] {
  return [
    env.PROGRAMFILES && path.join(env.PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    env['PROGRAMFILES(X86)'] && path.join(env['PROGRAMFILES(X86)'], 'Google', 'Chrome', 'Application', 'chrome.exe'),
    env.LOCALAPPDATA && path.join(env.LOCALAPPDATA, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    env.PROGRAMFILES && path.join(env.PROGRAMFILES, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
  ].filter((candidate): candidate is string => Boolean(candidate))
}

/** Resolves one fixed executable path; Chrome is never launched through a shell or PATH lookup. */
export function discoverChromeExecutable(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
  exists: (candidate: string) => boolean = fs.existsSync,
): string | null {
  const configured = env.PIB_CHROME_PATH?.trim()
  if (configured) return path.resolve(configured)
  const candidates = platform === 'win32'
    ? windowsChromePaths(env)
    : platform === 'darwin'
      ? CHROME_PATHS.darwin
      : CHROME_PATHS.linux
  return candidates.find((candidate) => exists(candidate)) ?? null
}

function defaultSpawnChrome(executable: string, args: string[]): BrowserChildProcess {
  return spawn(executable, args, {
    env: sanitizedShellEnv(),
    stdio: ['ignore', 'ignore', 'pipe'],
    windowsHide: true,
  }) as unknown as BrowserChildProcess
}

function defaultCreateWebSocket(url: string): BrowserWebSocket {
  if (typeof WebSocket !== 'function') throw new Error('workbench browser requires Node.js 22 WebSocket support')
  return new WebSocket(url) as unknown as BrowserWebSocket
}

const defaultWait = (milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds))

type BrowserDependencies = {
  chromePath?: string | null
  spawnChrome: SpawnChrome
  createWebSocket: CreateWebSocket
  wait: (milliseconds: number) => Promise<unknown>
}

let dependencyOverrides: Partial<BrowserDependencies> = {}

/** Test-only dependency seam; production uses child_process.spawn and Node 22's built-in WebSocket. */
export function __setWorkbenchBrowserDependenciesForTests(overrides: Partial<BrowserDependencies> | undefined): void {
  dependencyOverrides = overrides ?? {}
}

function dependencies(): BrowserDependencies {
  return {
    chromePath: Object.prototype.hasOwnProperty.call(dependencyOverrides, 'chromePath')
      ? dependencyOverrides.chromePath
      : discoverChromeExecutable(),
    spawnChrome: dependencyOverrides.spawnChrome ?? defaultSpawnChrome,
    createWebSocket: dependencyOverrides.createWebSocket ?? defaultCreateWebSocket,
    wait: dependencyOverrides.wait ?? defaultWait,
  }
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function exactKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key))
}

function validUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_URL_LENGTH) return false
  try {
    const parsed = new URL(value)
    return (parsed.protocol === 'http:' || parsed.protocol === 'https:') && !parsed.username && !parsed.password
  } catch {
    return false
  }
}

function validPoint(x: unknown, y: unknown): boolean {
  return typeof x === 'number' && Number.isSafeInteger(x) && x >= 0 && x <= MAX_VIEWPORT_WIDTH
    && typeof y === 'number' && Number.isSafeInteger(y) && y >= 0 && y <= MAX_VIEWPORT_HEIGHT
}

function validDelta(value: unknown, required: boolean): boolean {
  if (value === undefined) return !required
  return typeof value === 'number' && Number.isSafeInteger(value) && Math.abs(value) <= MAX_SCROLL_DELTA
}

function assertValidControl(value: unknown): WorkbenchBrowserControl {
  const input = record(value)
  if (!input || typeof input.kind !== 'string') throw new Error('invalid workbench browser control')
  if (input.kind === 'capture' || input.kind === 'kill' || input.kind === 'follow_stop') {
    if (!exactKeys(input, ['kind'])) throw new Error('invalid workbench browser control')
    return { kind: input.kind }
  }
  if (input.kind === 'navigate' && exactKeys(input, ['kind', 'url']) && validUrl(input.url)) {
    return { kind: 'navigate', url: input.url }
  }
  if (
    input.kind === 'click' && exactKeys(input, ['kind', 'x', 'y', 'button'])
    && validPoint(input.x, input.y)
    && (input.button === undefined || (typeof input.button === 'string' && MOUSE_BUTTONS.has(input.button)))
  ) {
    return {
      kind: 'click',
      x: input.x as number,
      y: input.y as number,
      button: (input.button as WorkbenchBrowserMouseButton | undefined) ?? 'left',
    }
  }
  if (
    input.kind === 'type' && exactKeys(input, ['kind', 'text'])
    && typeof input.text === 'string' && input.text.length > 0 && input.text.length <= MAX_TYPE_TEXT_LENGTH
    && !UNSAFE_TEXT.test(input.text)
  ) {
    return { kind: 'type', text: input.text }
  }
  if (
    input.kind === 'press' && exactKeys(input, ['kind', 'key'])
    && typeof input.key === 'string' && Object.prototype.hasOwnProperty.call(KEY_EVENTS, input.key)
  ) {
    return { kind: 'press', key: input.key }
  }
  if (
    input.kind === 'scroll' && exactKeys(input, ['kind', 'x', 'y', 'deltaX', 'deltaY'])
    && validPoint(input.x, input.y) && validDelta(input.deltaX, false) && validDelta(input.deltaY, true)
  ) {
    return {
      kind: 'scroll',
      x: input.x as number,
      y: input.y as number,
      deltaX: (input.deltaX as number | undefined) ?? 0,
      deltaY: input.deltaY as number,
    }
  }
  if (input.kind === 'follow_start' && exactKeys(input, ['kind', 'intervalMs'])) {
    if (input.intervalMs === undefined) return { kind: 'follow_start', intervalMs: DEFAULT_FOLLOW_INTERVAL_MS }
    if (
      typeof input.intervalMs === 'number' && Number.isSafeInteger(input.intervalMs)
      && input.intervalMs >= MIN_FOLLOW_INTERVAL_MS && input.intervalMs <= MAX_FOLLOW_INTERVAL_MS
    ) {
      return { kind: 'follow_start', intervalMs: input.intervalMs }
    }
    throw new Error('invalid workbench browser control')
  }
  throw new Error('invalid workbench browser control')
}

function assertValidClaim(claim: WorkbenchBrowserClaim): void {
  if (
    !claim || typeof claim !== 'object'
    || !IDENTIFIER.test(claim.sessionId)
    || !Number.isSafeInteger(claim.attempt) || claim.attempt < 1
    || !LEASE_TOKEN.test(claim.leaseToken)
  ) throw new Error('invalid workbench browser claim')

  if (claim.kind === 'create') {
    if (
      !Number.isSafeInteger(claim.viewport?.width)
      || claim.viewport.width < MIN_VIEWPORT_WIDTH || claim.viewport.width > MAX_VIEWPORT_WIDTH
      || !Number.isSafeInteger(claim.viewport?.height)
      || claim.viewport.height < MIN_VIEWPORT_HEIGHT || claim.viewport.height > MAX_VIEWPORT_HEIGHT
      || (claim.startUrl !== null && !validUrl(claim.startUrl))
      || !IDENTIFIER.test(claim.mappingId)
      || typeof claim.workspaceId !== 'string' || claim.workspaceId.length === 0
      || typeof claim.relativeFolder !== 'string'
    ) throw new Error('invalid workbench browser claim')
    return
  }
  if (claim.kind === 'control') {
    assertValidControl(claim.control)
    return
  }
  throw new Error('invalid workbench browser claim')
}

type PendingCommand = { resolve: (value: Record<string, unknown>) => void; reject: (error: Error) => void }
type EventWaiter = {
  method: string
  sessionId?: string
  resolve: () => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
}

class CdpConnection {
  private nextId = 0
  private pending = new Map<number, PendingCommand>()
  private eventWaiters = new Set<EventWaiter>()

  private constructor(private readonly socket: BrowserWebSocket) {
    socket.addEventListener('message', this.onMessage)
    socket.addEventListener('close', this.onClose)
    socket.addEventListener('error', this.onClose)
  }

  static async connect(url: string, createWebSocket: CreateWebSocket): Promise<CdpConnection> {
    const socket = createWebSocket(url)
    if (socket.readyState !== 1) {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => finish(new Error('timed out connecting to Chrome DevTools')), DEVTOOLS_START_TIMEOUT_MS)
        const onOpen = () => finish()
        const onError = () => finish(new Error('failed to connect to Chrome DevTools'))
        const finish = (error?: Error) => {
          clearTimeout(timer)
          socket.removeEventListener('open', onOpen)
          socket.removeEventListener('error', onError)
          if (error) reject(error); else resolve()
        }
        socket.addEventListener('open', onOpen)
        socket.addEventListener('error', onError)
      })
    }
    return new CdpConnection(socket)
  }

  send(method: string, params: Record<string, unknown> = {}, sessionId?: string): Promise<Record<string, unknown>> {
    const id = ++this.nextId
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }))
    })
  }

  waitForEvent(method: string, sessionId?: string, timeoutMs = PAGE_LOAD_TIMEOUT_MS): Promise<void> {
    return new Promise((resolve, reject) => {
      const waiter: EventWaiter = {
        method,
        sessionId,
        resolve: () => { clearTimeout(waiter.timer); this.eventWaiters.delete(waiter); resolve() },
        reject: (error) => { clearTimeout(waiter.timer); this.eventWaiters.delete(waiter); reject(error) },
        timer: setTimeout(() => waiter.reject(new Error(`timed out waiting for ${method}`)), timeoutMs),
      }
      this.eventWaiters.add(waiter)
    })
  }

  close(): void {
    this.socket.removeEventListener('message', this.onMessage)
    this.socket.removeEventListener('close', this.onClose)
    this.socket.removeEventListener('error', this.onClose)
    try { this.socket.close() } catch { /* already closed */ }
    this.failPending(new Error('Chrome DevTools connection closed'))
  }

  private onMessage = (event: unknown) => {
    try {
      const raw = (event as { data?: unknown })?.data
      const message = JSON.parse(typeof raw === 'string' ? raw : Buffer.from(raw as ArrayBuffer).toString('utf8')) as Record<string, unknown>
      if (Number.isSafeInteger(message.id)) {
        const id = Number(message.id)
        const pending = this.pending.get(id)
        if (!pending) return
        this.pending.delete(id)
        const cdpError = record(message.error)
        if (cdpError) pending.reject(new Error(typeof cdpError.message === 'string' ? cdpError.message : 'Chrome DevTools command failed'))
        else pending.resolve(record(message.result) ?? {})
        return
      }
      if (typeof message.method === 'string') {
        for (const waiter of this.eventWaiters) {
          if (waiter.method === message.method && (!waiter.sessionId || waiter.sessionId === message.sessionId)) waiter.resolve()
        }
      }
    } catch {
      // Ignore malformed browser messages; only responses matching an outstanding command are trusted.
    }
  }

  private onClose = () => this.failPending(new Error('Chrome DevTools connection closed'))

  private failPending(error: Error): void {
    for (const pending of this.pending.values()) pending.reject(error)
    this.pending.clear()
    for (const waiter of this.eventWaiters) waiter.reject(error)
    this.eventWaiters.clear()
  }
}

function chromeArguments(profile: string, viewport: WorkbenchBrowserViewport): string[] {
  return [
    '--headless=new',
    '--remote-debugging-port=0',
    '--remote-debugging-address=127.0.0.1',
    `--user-data-dir=${profile}`,
    `--window-size=${viewport.width},${viewport.height}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--mute-audio',
    'about:blank',
  ]
}

async function readDevToolsEndpoint(
  profile: string,
  failure: () => Error | null,
  wait: (milliseconds: number) => Promise<unknown>,
): Promise<string> {
  const activePortPath = path.join(profile, 'DevToolsActivePort')
  const deadline = Date.now() + DEVTOOLS_START_TIMEOUT_MS
  while (Date.now() < deadline) {
    const processFailure = failure()
    if (processFailure) throw processFailure
    try {
      const [portLine, browserPath] = fs.readFileSync(activePortPath, 'utf8').trim().split(/\r?\n/)
      const port = Number(portLine)
      if (Number.isSafeInteger(port) && port > 0 && port <= 65_535 && /^\/devtools\/browser\/[A-Za-z0-9_-]+$/.test(browserPath ?? '')) {
        return `ws://127.0.0.1:${port}${browserPath}`
      }
    } catch {
      // Chrome writes the file atomically after the debugging socket is listening.
    }
    await wait(DEVTOOLS_POLL_INTERVAL_MS)
  }
  throw new Error('timed out waiting for Chrome DevToolsActivePort')
}

type BrowserEntry = {
  child: BrowserChildProcess
  cdp: CdpConnection
  targetSessionId: string
  post: PostFn
  attempt: number
  leaseToken: string
  seq: number
  killRequested: boolean
  finished: boolean
  startedAtMs: number
  profile: string
  heartbeatTimer: ReturnType<typeof setInterval> | null
  /** Periodic `captureAndUpload` loop started by `follow_start`; cleared by `follow_stop`, kill, and expiry. */
  followTimer: ReturnType<typeof setInterval> | null
  /** Guards the follow loop against overlapping captures when one tick outlives its interval. */
  followCapturing: boolean
}

const browsers = new Map<string, BrowserEntry>()

export function activeWorkbenchBrowserSessionIds(): string[] {
  return [...browsers.keys()]
}

function stopFollow(entry: BrowserEntry): void {
  if (entry.followTimer) clearInterval(entry.followTimer)
  entry.followTimer = null
}

function removeBrowser(sessionId: string, entry: BrowserEntry): void {
  if (entry.heartbeatTimer) clearInterval(entry.heartbeatTimer)
  stopFollow(entry)
  browsers.delete(sessionId)
  entry.cdp.close()
  try { fs.rmSync(entry.profile, { recursive: true, force: true }) } catch { /* best effort */ }
}

async function completeBrowser(
  sessionId: string,
  entry: BrowserEntry,
  outcome: 'exited' | 'killed' | 'failed',
  error?: string,
): Promise<void> {
  if (entry.finished) return
  entry.finished = true
  removeBrowser(sessionId, entry)
  await entry.post(`/workbench/browser/sessions/${sessionId}/complete`, {
    attempt: entry.attempt,
    leaseToken: entry.leaseToken,
    outcome,
    ...(error ? { error: error.slice(0, 2_000) } : {}),
  }).catch(() => undefined)
}

async function postProgress(sessionId: string, entry: BrowserEntry, chunk: Record<string, unknown>): Promise<void> {
  entry.seq += 1
  const response = await entry.post(`/workbench/browser/sessions/${sessionId}/progress`, {
    attempt: entry.attempt,
    leaseToken: entry.leaseToken,
    chunk: { seq: entry.seq, atMs: Date.now(), ...chunk },
  })
  if (!response.ok) throw new Error(`browser progress rejected (${response.status})`)
}

function requireBrowser(claim: Extract<WorkbenchBrowserClaim, { kind: 'control' }>): BrowserEntry {
  const entry = browsers.get(claim.sessionId)
  if (!entry) throw new Error('workbench browser session not found')
  if (entry.attempt !== claim.attempt || entry.leaseToken !== claim.leaseToken) throw new Error('workbench browser lease mismatch')
  return entry
}

async function navigate(entry: BrowserEntry, url: string): Promise<void> {
  const loaded = entry.cdp.waitForEvent('Page.loadEventFired', entry.targetSessionId)
  await entry.cdp.send('Page.navigate', { url }, entry.targetSessionId)
  await loaded.catch(() => undefined)
}

async function click(entry: BrowserEntry, x: number, y: number, button: WorkbenchBrowserMouseButton): Promise<void> {
  const base = { x, y, button, clickCount: 1, buttons: button === 'left' ? 1 : button === 'right' ? 2 : 4 }
  await entry.cdp.send('Input.dispatchMouseEvent', { ...base, type: 'mousePressed' }, entry.targetSessionId)
  await entry.cdp.send('Input.dispatchMouseEvent', { ...base, type: 'mouseReleased' }, entry.targetSessionId)
}

async function scroll(entry: BrowserEntry, x: number, y: number, deltaX: number, deltaY: number): Promise<void> {
  await entry.cdp.send('Input.dispatchMouseEvent', {
    type: 'mouseWheel', x, y, deltaX, deltaY, button: 'none', buttons: 0,
  }, entry.targetSessionId)
}

async function insertText(entry: BrowserEntry, text: string): Promise<void> {
  await entry.cdp.send('Input.insertText', { text }, entry.targetSessionId)
}

async function pressKey(entry: BrowserEntry, key: string): Promise<void> {
  const mapped = KEY_EVENTS[key]
  if (!mapped) throw new Error('invalid workbench browser control')
  const base = {
    key,
    code: mapped.code,
    windowsVirtualKeyCode: mapped.keyCode,
    nativeVirtualKeyCode: mapped.keyCode,
    ...(mapped.text ? { text: mapped.text, unmodifiedText: mapped.text } : {}),
  }
  await entry.cdp.send('Input.dispatchKeyEvent', { ...base, type: 'keyDown' }, entry.targetSessionId)
  await entry.cdp.send('Input.dispatchKeyEvent', { ...base, type: 'keyUp' }, entry.targetSessionId)
}

function evaluatedPage(result: Record<string, unknown>): { pageUrl?: string; title?: string } {
  const remoteResult = record(result.result)
  const value = record(remoteResult?.value)
  return {
    ...(typeof value?.url === 'string' ? { pageUrl: value.url.slice(0, MAX_URL_LENGTH) } : {}),
    ...(typeof value?.title === 'string' ? { title: value.title.slice(0, 500) } : {}),
  }
}

async function captureAndUpload(sessionId: string, entry: BrowserEntry): Promise<void> {
  let dataBase64: string | null = null
  for (const quality of JPEG_QUALITIES) {
    const result = await entry.cdp.send('Page.captureScreenshot', {
      format: 'jpeg', quality, fromSurface: true, captureBeyondViewport: false,
    }, entry.targetSessionId)
    if (typeof result.data !== 'string') throw new Error('Chrome returned an invalid screenshot')
    const bytes = Buffer.from(result.data, 'base64')
    if (bytes.byteLength > 0 && bytes.byteLength <= MAX_FRAME_BYTES) {
      dataBase64 = result.data
      break
    }
  }
  if (!dataBase64) throw new Error('captured frame exceeds the 1.5MB upload limit')

  const page = evaluatedPage(await entry.cdp.send('Runtime.evaluate', {
    expression: '({url: location.href, title: document.title})',
    returnByValue: true,
  }, entry.targetSessionId))
  const frameSeq = entry.seq + 1
  const upload = await entry.post(`/workbench/browser/sessions/${sessionId}/frames`, {
    attempt: entry.attempt,
    leaseToken: entry.leaseToken,
    seq: frameSeq,
    contentType: 'image/jpeg',
    dataBase64,
  })
  if (!upload.ok) throw new Error(`browser frame upload rejected (${upload.status})`)
  const uploadBody = record(await upload.json())
  const frame = record(uploadBody?.data)
  if (typeof frame?.imageUrl !== 'string' || frame.imageUrl.length === 0) throw new Error('browser frame upload returned no imageUrl')
  const contentType = frame.contentType === 'image/png' ? 'image/png' : 'image/jpeg'
  entry.seq = frameSeq
  const progress = await entry.post(`/workbench/browser/sessions/${sessionId}/progress`, {
    attempt: entry.attempt,
    leaseToken: entry.leaseToken,
    chunk: {
      seq: frameSeq,
      stream: 'frame',
      imageUrl: frame.imageUrl,
      contentType,
      ...page,
      atMs: Date.now(),
    },
  })
  if (!progress.ok) throw new Error(`browser frame progress rejected (${progress.status})`)
}

/**
 * Streams a frame every `intervalMs` until `follow_stop`/kill/expiry. Ticks
 * are dropped rather than queued while a capture is still in flight, so a slow
 * page cannot build up an unbounded backlog of screenshot uploads, and a
 * failing capture ends the loop instead of retrying forever.
 */
function startFollow(sessionId: string, entry: BrowserEntry, intervalMs: number): void {
  stopFollow(entry)
  entry.followTimer = setInterval(() => {
    if (entry.finished) {
      stopFollow(entry)
      return
    }
    if (entry.followCapturing) return
    entry.followCapturing = true
    captureAndUpload(sessionId, entry)
      .catch(() => stopFollow(entry))
      .finally(() => { entry.followCapturing = false })
  }, intervalMs)
}

/** Launches Chrome, parses DevToolsActivePort, drives the page over raw CDP, and publishes an initial frame. */
export async function handleWorkbenchBrowserCreate(
  claim: WorkbenchBrowserClaim,
  _registry: MappingRegistry,
  post: PostFn,
): Promise<{ sessionId: string; pid?: number }> {
  assertValidClaim(claim)
  if (claim.kind !== 'create') throw new Error('workbench browser claim kind mismatch')
  if (browsers.has(claim.sessionId)) throw new Error('workbench browser session already active')

  const deps = dependencies()
  let profile: string | null = null
  let child: BrowserChildProcess | null = null
  let cdp: CdpConnection | null = null
  let createdEntry: BrowserEntry | null = null
  let launchFailure: Error | null = null
  try {
    if (!deps.chromePath) throw new Error(CHROME_MISSING_MESSAGE)
    profile = fs.mkdtempSync(path.join(os.tmpdir(), 'pib-workbench-browser-'))
    child = deps.spawnChrome(deps.chromePath, chromeArguments(profile, claim.viewport))
    child.once('error', (error) => { launchFailure = error instanceof Error ? error : new Error('Chrome process error') })
    child.once('exit', (code, signal) => {
      if (!cdp) launchFailure = new Error(`Chrome exited before DevTools was ready (${String(code ?? signal ?? 'unknown')})`)
    })

    const endpoint = await readDevToolsEndpoint(profile, () => launchFailure, deps.wait)
    cdp = await CdpConnection.connect(endpoint, deps.createWebSocket)
    const target = await cdp.send('Target.createTarget', { url: 'about:blank' })
    if (typeof target.targetId !== 'string') throw new Error('Chrome did not create a page target')
    const attached = await cdp.send('Target.attachToTarget', { targetId: target.targetId, flatten: true })
    if (typeof attached.sessionId !== 'string') throw new Error('Chrome did not attach to the page target')
    const targetSessionId = attached.sessionId
    await cdp.send('Page.enable', {}, targetSessionId)
    await cdp.send('Runtime.enable', {}, targetSessionId)
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: claim.viewport.width, height: claim.viewport.height, deviceScaleFactor: 1, mobile: false,
    }, targetSessionId)

    const entry: BrowserEntry = {
      child,
      cdp,
      targetSessionId,
      post,
      attempt: claim.attempt,
      leaseToken: claim.leaseToken,
      seq: 0,
      killRequested: false,
      finished: false,
      startedAtMs: Date.now(),
      profile,
      heartbeatTimer: null,
      followTimer: null,
      followCapturing: false,
    }
    createdEntry = entry
    browsers.set(claim.sessionId, entry)
    child.stderr?.on('data', (raw) => {
      const text = raw.toString().trim()
      if (text) postProgress(claim.sessionId, entry, { stream: 'stderr', text: text.slice(0, 2_000) }).catch(() => undefined)
    })
    child.once('error', (error) => {
      completeBrowser(claim.sessionId, entry, 'failed', error instanceof Error ? error.message : 'Chrome process error').catch(() => undefined)
    })
    child.once('exit', (code, signal) => {
      const failed = !entry.killRequested && code !== 0
      completeBrowser(
        claim.sessionId,
        entry,
        entry.killRequested ? 'killed' : failed ? 'failed' : 'exited',
        failed ? `Chrome exited abnormally (${String(code ?? signal ?? 'unknown')})` : undefined,
      ).catch(() => undefined)
    })
    entry.heartbeatTimer = setInterval(() => {
      postProgress(claim.sessionId, entry, { stream: 'status', text: 'browser session active' }).catch(() => undefined)
    }, HEARTBEAT_INTERVAL_MS)

    if (claim.startUrl) await navigate(entry, claim.startUrl)
    await captureAndUpload(claim.sessionId, entry)
    return { sessionId: claim.sessionId, ...(typeof child.pid === 'number' ? { pid: child.pid } : {}) }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'workbench browser failed to start'
    if (createdEntry) {
      await completeBrowser(claim.sessionId, createdEntry, 'failed', message)
    } else if (cdp) {
      cdp.close()
    }
    if (child) {
      try { child.kill('SIGTERM') } catch { /* already exited */ }
    }
    if (profile && !createdEntry) {
      try { fs.rmSync(profile, { recursive: true, force: true }) } catch { /* best effort */ }
    }
    if (!createdEntry) {
      await post(`/workbench/browser/sessions/${claim.sessionId}/complete`, {
        attempt: claim.attempt,
        leaseToken: claim.leaseToken,
        outcome: 'failed',
        error: message.slice(0, 2_000),
      }).catch(() => undefined)
    }
    throw new Error(`workbench browser failed to start: ${message}`)
  }
}

export async function runWorkbenchBrowserClaim(
  claim: WorkbenchBrowserClaim,
  registry: MappingRegistry,
  post: PostFn,
): Promise<unknown> {
  assertValidClaim(claim)
  if (claim.kind === 'create') return handleWorkbenchBrowserCreate(claim, registry, post)
  const control = assertValidControl(claim.control)
  const entry = requireBrowser(claim)
  if (control.kind === 'kill') {
    entry.killRequested = true
    stopFollow(entry)
    entry.cdp.close()
    try { entry.child.kill('SIGTERM') } catch { /* process already exited */ }
    return undefined
  }
  if (control.kind === 'follow_start') {
    startFollow(claim.sessionId, entry, control.intervalMs ?? DEFAULT_FOLLOW_INTERVAL_MS)
    return undefined
  }
  if (control.kind === 'follow_stop') {
    stopFollow(entry)
    return undefined
  }
  if (control.kind === 'navigate') await navigate(entry, control.url)
  if (control.kind === 'click') await click(entry, control.x, control.y, control.button ?? 'left')
  if (control.kind === 'type') await insertText(entry, control.text)
  if (control.kind === 'press') await pressKey(entry, control.key)
  if (control.kind === 'scroll') await scroll(entry, control.x, control.y, control.deltaX ?? 0, control.deltaY)
  await captureAndUpload(claim.sessionId, entry)
  return undefined
}

export function handleBrowserKill(sessionId: string): void {
  if (!IDENTIFIER.test(sessionId)) throw new Error('invalid workbench browser session id')
  const entry = browsers.get(sessionId)
  if (!entry) return
  entry.killRequested = true
  stopFollow(entry)
  entry.cdp.close()
  try { entry.child.kill('SIGTERM') } catch { /* process already exited */ }
}

export function sweepExpiredWorkbenchBrowserSessions(now = Date.now(), ttlMs = BROWSER_SESSION_TTL_MS): void {
  for (const [sessionId, entry] of browsers) {
    if (!entry.killRequested && now - entry.startedAtMs >= ttlMs) handleBrowserKill(sessionId)
  }
}

/** Test-only hard cleanup without producing server completion calls. */
export function __resetWorkbenchBrowsersForTests(): void {
  for (const [sessionId, entry] of browsers) {
    entry.finished = true
    removeBrowser(sessionId, entry)
    try { entry.child.kill('SIGTERM') } catch { /* already exited */ }
  }
  browsers.clear()
}

export function linkedRuntimeWorkbenchBrowserClaimBody() {
  return {
    runtimeVersion: process.env.PIB_RUNTIME_VERSION || '1.1.20',
    workbenchBrowserSessionsProtocolVersion: 1 as const,
  }
}

export async function pollWorkbenchBrowserForever(
  claim: () => Promise<WorkbenchBrowserClaim | null>,
  run: (claim: WorkbenchBrowserClaim) => Promise<unknown>,
  stop: () => boolean = () => false,
  wait: (milliseconds: number) => Promise<unknown> = defaultWait,
): Promise<void> {
  let delay = 250
  while (!stop()) {
    sweepExpiredWorkbenchBrowserSessions()
    const claimed = await claim().catch(() => null)
    if (claimed) {
      delay = 250
      await run(claimed).catch(() => undefined)
    } else {
      await wait(workbenchPollDelay(delay))
      delay = Math.min(delay * 2, BROWSER_MAX_POLL_DELAY_MS)
    }
  }
}
