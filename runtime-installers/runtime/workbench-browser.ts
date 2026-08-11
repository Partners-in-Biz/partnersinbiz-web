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
  | { kind: 'click_ref'; ref: string }
  | { kind: 'type'; text: string }
  | { kind: 'press'; key: string }
  | { kind: 'scroll'; x: number; y: number; deltaX?: number; deltaY: number }
  | { kind: 'snapshot' }
  | { kind: 'console' }
  | { kind: 'extract' }
  | { kind: 'dialog'; accept: boolean; promptText?: string }
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
// Keep in lockstep with workbench idle claim cap (nonce write cost).
const BROWSER_MAX_POLL_DELAY_MS = 5_000
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
  if (input.kind === 'capture' || input.kind === 'kill' || input.kind === 'follow_stop'
    || input.kind === 'snapshot' || input.kind === 'console' || input.kind === 'extract') {
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
    input.kind === 'click_ref' && exactKeys(input, ['kind', 'ref'])
    && typeof input.ref === 'string' && input.ref.length > 0 && input.ref.length <= 32 && /^@?[A-Za-z0-9_-]+$/.test(input.ref)
  ) {
    return { kind: 'click_ref', ref: input.ref.startsWith('@') ? input.ref : `@${input.ref}` }
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
  if (
    input.kind === 'dialog' && exactKeys(input, ['kind', 'accept', 'promptText'])
    && typeof input.accept === 'boolean'
    && (input.promptText === undefined || (typeof input.promptText === 'string' && input.promptText.length <= 1_000 && !UNSAFE_TEXT.test(input.promptText)))
  ) {
    return {
      kind: 'dialog',
      accept: input.accept as boolean,
      ...(input.promptText !== undefined ? { promptText: input.promptText as string } : {}),
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
  private readonly eventHandlers = new Map<string, Set<(event: Record<string, unknown>, sessionId?: string) => void>>()

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

  /** Persistent CDP event subscription (supervisor state: dialogs, console, frames, targets). */
  onEvent(method: string, handler: (event: Record<string, unknown>, sessionId?: string) => void): () => void {
    let handlers = this.eventHandlers.get(method)
    if (!handlers) {
      handlers = new Set()
      this.eventHandlers.set(method, handlers)
    }
    handlers.add(handler)
    return () => { handlers?.delete(handler) }
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
        const sessionId = typeof message.sessionId === 'string' ? message.sessionId : undefined
        for (const waiter of this.eventWaiters) {
          if (waiter.method === message.method && (!waiter.sessionId || waiter.sessionId === sessionId)) waiter.resolve()
        }
        const handlers = this.eventHandlers.get(message.method)
        if (handlers && handlers.size > 0) {
          const event = record(message.params) ?? {}
          for (const handler of handlers) {
            try { handler(event, sessionId) } catch { /* supervisor handlers must never break the CDP loop */ }
          }
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
    this.eventHandlers.clear()
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
  // ---- CDP supervisor state (the "agent is aware" layer) ----
  /** Sessions already wired with supervisor event subscriptions (top page + OOPIF children). */
  supervisedSessions: Set<string>
  /** Cross-origin iframe child sessions discovered via Target.setAutoAttach. */
  childSessions: Map<string, { sessionId: string; targetId: string; targetInfo?: Record<string, unknown> }>
  /** Native JS dialogs currently blocking the page (alert/confirm/prompt/beforeunload). */
  pendingDialog: { type?: string; message?: string } | null
  /** CDP session that owns the pending dialog — Page.handleJavaScriptDialog must target it. */
  dialogSessionId?: string
  /** Ring buffer of recent console messages/errors (capped MAX_CONSOLE_RING). */
  consoleRing: SupervisorConsoleEntry[]
  /** Frame tree from Page.frameAttached/frameNavigated/frameDetached. */
  frames: Map<string, SupervisorFrame>
  /** @eN refs from the most recent accessibility snapshot, used to resolve click_ref. */
  lastRefs: Record<string, SupervisorRef>
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

// ---------------------------------------------------------------------------
// CDP Supervisor — the "agent is aware" layer. A persistent per-session
// subscription set tracks native dialogs, the frame tree (including
// cross-origin OOPIF children) and a console ring, and merges that state
// into every accessibility snapshot. This mirrors Hermes' browser_supervisor
// pattern: without it the agent goes blind on alert()/confirm()/prompt()
// (which block the page's JS thread) and cannot see inside cross-origin
// iframes or read console errors that explain a broken page.
// ---------------------------------------------------------------------------

const MAX_CONSOLE_RING = 50
const MAX_SNAPSHOT_AX_CHARS = 12_000
const MAX_SNAPSHOT_REFS = 400
const MAX_SNAPSHOT_FRAMES = 50
const MAX_SNAPSHOT_CONSOLE_ENTRIES = 8
const MAX_CONSOLE_ENTRY_CHARS = 300
const MAX_FRAME_TREE = 50

/** Roles worth surfacing to the agent as clickable/typeable refs. */
const AX_INTERESTING_ROLES = new Set([
  'button', 'link', 'textbox', 'combobox', 'checkbox', 'radio', 'menuitem', 'menuitemcheckbox',
  'menuitemradio', 'tab', 'switch', 'searchbox', 'spinbutton', 'slider', 'option', 'listboxoption',
  'heading', 'banner', 'main', 'navigation', 'complementary', 'img', 'image', 'form', 'dialog',
  'alertdialog', 'alert', 'status', 'timer', 'progressbar', 'meter', 'treeitem', 'listitem',
  'gridcell', 'columnheader', 'rowheader', 'tabpanel', 'tooltip', 'article', 'section', 'region',
  'contentinfo', 'search', 'textbox', 'statictext',
])

function truncateChars(value: string, max: number): string {
  if (value.length <= max) return value
  // Budget-aware: reserve room for the marker so the TOTAL never exceeds
  // `max`. The server validator rejects snapshot ax text longer than
  // MAX_SNAPSHOT_AX_CHARS (12,000); appending "\n… truncated" after a
  // 12,000-char slice would emit 12,012 chars, the chunk would be rejected,
  // and the device's run loop swallows the error — the agent goes blind on
  // dense pages. This is the second half of the dense-page fix: refs are
  // capped at MAX_SNAPSHOT_REFS and the ax text now fits the contract.
  const marker = '\n… truncated'
  const budget = Math.max(0, max - marker.length)
  return `${value.slice(0, budget).trimEnd()}${marker}`
}

/** Scrubs likely secrets from browser-originated text before it reaches the agent (Hermes' redact_sensitive_text). */
export function redactWorkbenchBrowserText(value: string): string {
  return value
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[email]')
    .replace(/\b(sk-[A-Za-z0-9_-]{8,}|ghp_[A-Za-z0-9]{20,}|gho_[A-Za-z0-9]{20,}|xox[baprs]-[A-Za-z0-9-]{10,}|AIza[0-9A-Za-z_-]{20,}|AKIA[0-9A-Z]{16})\b/g, '[key]')
    // Bearer tokens first: the generic key-value rule below stops its value at
    // whitespace, so "Authorization: Bearer <jwt>" would otherwise consume just
    // "Bearer" and let the credential through.
    .replace(/\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi, 'Bearer [redacted]')
    // `$1$3[redacted]` keeps the key and the separator, and only drops the
    // secret VALUE — `password=…` becomes `password=[redacted]`. The
    // `(?!Bearer\b)` guard stops the generic rule from swallowing the word
    // "Bearer" as a value after the token rule already scrubbed it, so the
    // whole pass stays idempotent.
    .replace(/(pass(word)?|pwd|token|secret|api[_-]?key|authorization|bearer)(["'\s:=]+)((?!Bearer\b)[^&\s"'<>]{6,})/gi, '$1$3[redacted]')
}

type SupervisorConsoleEntry = { level: string; text: string; url?: string; line?: number }
type SupervisorFrame = { frameId: string; parentId?: string | null; url?: string; name?: string }
type SupervisorRef = { backendDOMNodeId?: number; sessionId?: string; role?: string; name?: string }

function consoleMessageText(entry: Record<string, unknown>): string {
  const args = Array.isArray(entry.args) ? entry.args : []
  const parts: string[] = []
  for (const arg of args.slice(0, 8)) {
    const row = record(arg)
    if (!row) continue
    const value = row.value
    if (typeof value === 'string') { parts.push(value); continue }
    if (typeof value === 'number' || typeof value === 'boolean') { parts.push(String(value)); continue }
    if (row.description && typeof row.description === 'string') { parts.push(row.description); continue }
    if (typeof row.type === 'string') parts.push(`<${row.type}>`)
  }
  return parts.join(' ').slice(0, MAX_CONSOLE_ENTRY_CHARS)
}

function exceptionText(entry: Record<string, unknown>): string {
  const details = record(entry.exceptionDetails)
  if (!details) return 'Uncaught exception'
  const text = typeof details.text === 'string' ? details.text : 'Uncaught exception'
  const exception = record(details.exception)
  const description = typeof exception?.description === 'string'
    ? exception.description
    : typeof exception?.value === 'string' ? exception.value : ''
  const firstLine = description.split('\n')[0] ?? ''
  const combined = [text, firstLine].filter(Boolean).join(': ').slice(0, MAX_CONSOLE_ENTRY_CHARS)
  return combined
}

/** Registers the supervisor's event subscriptions on the CDP connection for one page session. */
function superviseSession(entry: BrowserEntry, sessionId: string): void {
  const cdp = entry.cdp
  if (entry.supervisedSessions.has(sessionId)) return
  entry.supervisedSessions.add(sessionId)
  void cdp.send('Runtime.enable', {}, sessionId).catch(() => undefined)
  void cdp.send('Page.enable', {}, sessionId).catch(() => undefined)
  // A dialog belongs to the session that opened it; handleJavaScriptDialog must target that session.
  cdp.onEvent('Page.javascriptDialogOpening', (event, eventSessionId) => {
    const active = eventSessionId ?? sessionId
    entry.pendingDialog = {
      type: typeof event.type === 'string' ? event.type : 'alert',
      message: typeof event.message === 'string' ? redactWorkbenchBrowserText(event.message).slice(0, 1_000) : '',
    }
    entry.dialogSessionId = active
  })
  cdp.onEvent('Page.javascriptDialogClosed', () => {
    entry.pendingDialog = null
    entry.dialogSessionId = undefined
  })
  cdp.onEvent('Runtime.consoleAPICalled', (event) => {
    const level = typeof event.type === 'string' ? event.type : 'log'
    entry.consoleRing.push({
      level,
      text: redactWorkbenchBrowserText(consoleMessageText(event)),
      ...(typeof event.url === 'string' ? { url: event.url.slice(0, MAX_URL_LENGTH) } : {}),
      ...(typeof event.lineNumber === 'number' ? { line: event.lineNumber + 1 } : {}),
    })
    if (entry.consoleRing.length > MAX_CONSOLE_RING) entry.consoleRing.splice(0, entry.consoleRing.length - MAX_CONSOLE_RING)
  })
  cdp.onEvent('Runtime.exceptionThrown', (event) => {
    entry.consoleRing.push({
      level: 'exception',
      text: redactWorkbenchBrowserText(exceptionText(event)),
      ...(typeof record(event.exceptionDetails)?.url === 'string' ? { url: String(record(event.exceptionDetails)?.url).slice(0, MAX_URL_LENGTH) } : {}),
    })
    if (entry.consoleRing.length > MAX_CONSOLE_RING) entry.consoleRing.splice(0, entry.consoleRing.length - MAX_CONSOLE_RING)
  })
  cdp.onEvent('Page.frameAttached', (event) => {
    const frameId = typeof event.frameId === 'string' ? event.frameId : ''
    if (!frameId) return
    entry.frames.set(frameId, {
      frameId,
      parentId: typeof event.parentFrameId === 'string' ? event.parentFrameId : null,
    })
    trimFrames(entry)
  })
  cdp.onEvent('Page.frameNavigated', (event) => {
    const frame = record(event.frame)
    if (!frame || typeof frame.id !== 'string') return
    entry.frames.set(frame.id, {
      frameId: frame.id,
      parentId: typeof frame.parentId === 'string' ? frame.parentId : null,
      url: typeof frame.url === 'string' ? redactWorkbenchBrowserText(frame.url).slice(0, MAX_URL_LENGTH) : undefined,
      name: typeof frame.name === 'string' ? frame.name.slice(0, 500) : undefined,
    })
    trimFrames(entry)
  })
  cdp.onEvent('Page.frameDetached', (event) => {
    const frameId = typeof event.frameId === 'string' ? event.frameId : ''
    if (frameId) entry.frames.delete(frameId)
  })
}

function trimFrames(entry: BrowserEntry): void {
  if (entry.frames.size <= MAX_FRAME_TREE) return
  const sorted = [...entry.frames.entries()].sort((a, b) => (a[1].url ? 0 : 1) - (b[1].url ? 0 : 1))
  while (entry.frames.size > MAX_FRAME_TREE) {
    const oldest = sorted.shift()
    if (!oldest) break
    entry.frames.delete(oldest[0])
  }
}

interface AxNodeShape {
  nodeId: string
  role?: { value?: string }
  name?: { value?: string }
  value?: { value?: string }
  backendDOMNodeId?: number
  childIds?: string[]
}

/** Builds the accessibility-tree text snapshot with stable @eN refs, merged across the top page and OOPIF children. */
async function buildAccessibilitySnapshot(entry: BrowserEntry): Promise<{
  ax: string
  refs: Record<string, SupervisorRef>
  pendingDialog: { type?: string; message?: string } | null
  frames: SupervisorFrame[]
  console: SupervisorConsoleEntry[]
  url?: string
  title?: string
}> {
  const refs: Record<string, SupervisorRef> = {}
  const lines: string[] = []
  let refCounter = 0
  const sessionsToVisit = [
    { sessionId: entry.targetSessionId, label: '' },
    ...[...entry.childSessions.values()].map((child) => ({ sessionId: child.sessionId, label: child.targetInfo?.type === 'iframe' ? '[iframe] ' : '[frame] ' })),
  ]
  const seenNodeIds = new Set<string>()

  for (const { sessionId, label } of sessionsToVisit) {
    let result: Record<string, unknown>
    try {
      result = await entry.cdp.send('Accessibility.getFullAXTree', {}, sessionId)
    } catch {
      continue // a child frame may have navigated away mid-snapshot
    }
    const nodes = Array.isArray(result.nodes) ? result.nodes as AxNodeShape[] : []
    const byId = new Map(nodes.map((node) => [node.nodeId, node]))
    const roots = nodes.filter((node) => !node.childIds || node.childIds.length === 0 || true)
    void roots
    const visit = (node: AxNodeShape, depth: number): void => {
      if (seenNodeIds.has(`${sessionId}:${node.nodeId}`)) return
      seenNodeIds.add(`${sessionId}:${node.nodeId}`)
      const role = node.role?.value ?? ''
      const name = typeof node.name?.value === 'string' ? node.name.value : ''
      const value = typeof node.value?.value === 'string' && node.value.value !== name ? node.value.value : ''
      const interesting = (AX_INTERESTING_ROLES.has(role) && (name || value || role === 'statictext'))
        || (role !== '' && name !== '')
      if (interesting && refCounter < MAX_SNAPSHOT_REFS) {
        refCounter += 1
        const ref = `@e${refCounter}`
        refs[ref] = {
          ...(typeof node.backendDOMNodeId === 'number' ? { backendDOMNodeId: node.backendDOMNodeId } : {}),
          ...(sessionId !== entry.targetSessionId ? { sessionId } : {}),
          ...(role ? { role } : {}),
          ...(name ? { name: redactWorkbenchBrowserText(name) } : {}),
        }
        const roleText = role || 'element'
        const nameText = name ? redactWorkbenchBrowserText(name).slice(0, 200) : ''
        const valueText = value && role !== 'statictext' ? ` value="${redactWorkbenchBrowserText(value).slice(0, 200)}"` : ''
        const indent = '  '.repeat(Math.min(depth, 4))
        lines.push(`${indent}[${ref}] ${label}${roleText}${nameText ? ` "${nameText}"` : ''}${valueText}`)
      }
      if (lines.join('\n').length >= MAX_SNAPSHOT_AX_CHARS || refCounter >= MAX_SNAPSHOT_REFS) return
      if (node.childIds) {
        for (const childId of node.childIds.slice(0, 64)) {
          const child = byId.get(childId)
          if (child) visit(child, depth + 1)
          if (lines.join('\n').length >= MAX_SNAPSHOT_AX_CHARS || refCounter >= MAX_SNAPSHOT_REFS) return
        }
      }
    }
    for (const node of nodes) {
      // Visit every top-level node (AX roots aren't strictly ordered).
      if (![...seenNodeIds].some((id) => id === `${sessionId}:${node.nodeId}`)) visit(node, 0)
      if (lines.join('\n').length >= MAX_SNAPSHOT_AX_CHARS || refCounter >= MAX_SNAPSHOT_REFS) break
    }
  }

  const ax = truncateChars(lines.join('\n') || '(page has no accessible content)', MAX_SNAPSHOT_AX_CHARS)
  const frames = [...entry.frames.values()].slice(0, MAX_SNAPSHOT_FRAMES)
  const console = entry.consoleRing.slice(-MAX_SNAPSHOT_CONSOLE_ENTRIES)
  const page = evaluatedPage(await entry.cdp.send('Runtime.evaluate', {
    expression: '({url: location.href, title: document.title})',
    returnByValue: true,
  }, entry.targetSessionId))
  return {
    ax,
    refs,
    pendingDialog: entry.pendingDialog,
    frames,
    console,
    ...(page.pageUrl ? { url: redactWorkbenchBrowserText(page.pageUrl) } : {}),
    ...(page.title ? { title: redactWorkbenchBrowserText(page.title) } : {}),
  }
}

async function snapshotAndPost(sessionId: string, entry: BrowserEntry): Promise<void> {
  const snapshot = await buildAccessibilitySnapshot(entry)
  entry.lastRefs = snapshot.refs
  const chunk = {
    stream: 'snapshot',
    snapshot: {
      ...snapshot,
      ...(Object.keys(snapshot.refs).length ? { refs: snapshot.refs } : {}),
    } as Record<string, unknown>,
  }
  await postProgress(sessionId, entry, chunk)
}

async function consoleAndPost(sessionId: string, entry: BrowserEntry): Promise<void> {
  await postProgress(sessionId, entry, {
    stream: 'console',
    entries: entry.consoleRing.slice(-MAX_CONSOLE_RING),
  })
}

const EXTRACT_HTML_MAX_CHARS = 500_000
const EXTRACT_COMPUTED_STYLES_MAX = 400
const EXTRACT_COMPUTED_PROPS_MAX = 20

/**
 * Design-audit extraction — serializes the live page for the T1 rule engine.
 * Runs a bounded page-side script that returns `document.documentElement.
 * outerHTML` plus a computed-style map keyed by CSS-ish element path for the
 * element types the detector cares about (headings, links, buttons, cards,
 * hero/gradient/glass surfaces, inputs). Console error/warning tail is merged
 * in so the engine's browser-mode hooks (runtimeErrors + computedStyles) run
 * against the real rendered page — the PiB equivalent of the Impeccable
 * Chrome extension scan. The result is posted as an `extract` progress chunk
 * and read back by the caller.
 */
async function extractAndPost(sessionId: string, entry: BrowserEntry): Promise<void> {
  const expression = `(() => {
    const SELECTORS = 'h1,h2,h3,h4,h5,h6,p,a,button,input,select,textarea,img,section,article,main,nav,header,footer,div[class*="card"],div[class*="hero"],div[class*="gradient"],div[class*="glass"],div[class*="banner"],div[class*="kicker"],div[class*="eyebrow"]';
    const PROPS = ['font-size','font-family','color','background-color','background-image','border-radius','letter-spacing','line-height','text-align','padding','border','box-shadow','display','position'];
    const els = Array.from(document.querySelectorAll(SELECTORS)).slice(0, 600);
    const out = {};
    let count = 0;
    const pathOf = (el) => {
      const parts = [];
      let node = el;
      while (node && node.nodeType === 1 && parts.length < 6) {
        let part = node.tagName.toLowerCase();
        if (node.id) { part += '#' + node.id; }
        else if (node.className && typeof node.className === 'string') {
          const cls = node.className.split(/\\s+/).filter(Boolean)[0];
          if (cls) part += '.' + cls;
        }
        const parent = node.parentElement;
        if (parent) {
          const same = Array.from(parent.children).filter((c) => c.tagName === node.tagName);
          if (same.length > 1) part += ':nth-of-type(' + (same.indexOf(node) + 1) + ')';
        }
        parts.unshift(part);
        node = parent;
      }
      return parts.join(' > ') || el.tagName.toLowerCase();
    };
    for (const el of els) {
      if (count >= ${EXTRACT_COMPUTED_STYLES_MAX}) break;
      const cs = window.getComputedStyle(el);
      const styles = {};
      for (const prop of PROPS) {
        const v = cs.getPropertyValue(prop);
        if (v && v !== 'none' && v !== 'normal' && v !== 'auto') styles[prop] = v;
      }
      const path = pathOf(el);
      if (!out[path] || Object.keys(styles).length > Object.keys(out[path]).length) {
        out[path] = styles;
        count += 1;
      }
    }
    let html = document.documentElement ? document.documentElement.outerHTML : '';
    const truncated = html.length > ${EXTRACT_HTML_MAX_CHARS};
    if (truncated) html = html.slice(0, ${EXTRACT_HTML_MAX_CHARS});
    return { html, computedStyles: out, truncated };
  })()`

  const result = await entry.cdp.send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: false,
  }, entry.targetSessionId)
  const remoteResult = record(result.result)
  const value = record(remoteResult?.value)
  const html = typeof value?.html === 'string' ? value.html : ''
  const truncated = value?.truncated === true
  const computedStyles = record(value?.computedStyles)
    ? Object.fromEntries(
        Object.entries(value?.computedStyles as Record<string, unknown>)
          .slice(0, EXTRACT_COMPUTED_STYLES_MAX)
          .map(([path, styles]) => {
            const rec = record(styles)
            if (!rec) return [path, {}] as const
            const clean: Record<string, string> = {}
            for (const [prop, val] of Object.entries(rec).slice(0, EXTRACT_COMPUTED_PROPS_MAX)) {
              if (typeof val === 'string' && val.length <= 500) clean[prop] = val
            }
            return [path, clean] as const
          }),
      )
    : {}

  const page = evaluatedPage(await entry.cdp.send('Runtime.evaluate', {
    expression: '({url: location.href, title: document.title})',
    returnByValue: true,
  }, entry.targetSessionId))

  const runtimeErrors = entry.consoleRing
    .filter((entryRow) => entryRow.level === 'error' || entryRow.level === 'warning')
    .slice(-20)
    .map((entryRow) => ({
      level: entryRow.level,
      text: entryRow.text.slice(0, 300),
      ...(entryRow.url ? { url: entryRow.url } : {}),
      ...(typeof entryRow.line === 'number' ? { line: entryRow.line } : {}),
    }))

  const seq = entry.seq + 1
  entry.seq = seq
  const progress = await entry.post(`/workbench/browser/sessions/${sessionId}/progress`, {
    attempt: entry.attempt,
    leaseToken: entry.leaseToken,
    chunk: {
      seq,
      stream: 'extract',
      extract: {
        ...(page.pageUrl ? { url: redactWorkbenchBrowserText(page.pageUrl) } : {}),
        ...(page.title ? { title: redactWorkbenchBrowserText(page.title) } : {}),
        html: redactWorkbenchBrowserText(html),
        computedStyles,
        runtimeErrors,
        truncated,
      } as Record<string, unknown>,
      atMs: Date.now(),
    },
  })
  if (!progress.ok) throw new Error(`browser extract progress rejected (${progress.status})`)
}

async function respondDialog(entry: BrowserEntry, accept: boolean, promptText?: string): Promise<void> {
  if (!entry.pendingDialog) throw new Error('no pending browser dialog')
  await entry.cdp.send('Page.handleJavaScriptDialog', {
    accept,
    ...(typeof promptText === 'string' ? { promptText } : {}),
  }, entry.dialogSessionId ?? entry.targetSessionId)
  entry.pendingDialog = null
  entry.dialogSessionId = undefined
}

/** Resolves an @eN ref from the last snapshot to real viewport coordinates and clicks there. */
async function clickRef(entry: BrowserEntry, ref: string): Promise<void> {
  const target = entry.lastRefs[ref]
  if (!target || typeof target.backendDOMNodeId !== 'number') {
    throw new Error(`browser ref ${ref} is not in the last snapshot — take a new snapshot first`)
  }
  const sessionId = target.sessionId ?? entry.targetSessionId
  await entry.cdp.send('DOM.scrollIntoViewIfNeeded', { backendNodeId: target.backendDOMNodeId }, sessionId).catch(() => undefined)
  const box = await entry.cdp.send('DOM.getBoxModel', { backendNodeId: target.backendDOMNodeId }, sessionId).catch(() => null)
  const model = record(box?.model)
  const quad = Array.isArray(model?.content) ? model.content as number[] : null
  if (!quad || quad.length < 4) throw new Error(`browser ref ${ref} has no clickable box`)
  const x = Math.round((quad[0] + quad[2]) / 2)
  const y = Math.round((quad[1] + quad[7]) / 2)
  await click(entry, x, y, 'left')
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
      supervisedSessions: new Set(),
      childSessions: new Map(),
      pendingDialog: null,
      consoleRing: [],
      frames: new Map(),
      lastRefs: {},
    }
    createdEntry = entry
    browsers.set(claim.sessionId, entry)

    // ---- CDP supervisor wiring: dialogs, console, frames, cross-origin iframes ----
    superviseSession(entry, entry.targetSessionId)
    await cdp.send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true }).catch(() => undefined)
    cdp.onEvent('Target.attachedToTarget', (event, eventSessionId) => {
      const targetInfo = record(event.targetInfo) ?? undefined
      const childSessionId = typeof eventSessionId === 'string' ? eventSessionId : typeof event.sessionId === 'string' ? event.sessionId : ''
      const targetId = typeof targetInfo?.targetId === 'string' ? targetInfo.targetId : ''
      const type = typeof targetInfo?.type === 'string' ? targetInfo.type : ''
      if (!childSessionId || !targetId) return
      if (type === 'iframe' || type === 'page' || type === 'webview') {
        entry.childSessions.set(targetId, { sessionId: childSessionId, targetId, targetInfo })
        superviseSession(entry, childSessionId)
      }
    })
    cdp.onEvent('Target.detachedFromTarget', (event) => {
      const targetId = typeof event.targetId === 'string' ? event.targetId : ''
      if (!targetId) return
      const child = entry.childSessions.get(targetId)
      if (child) entry.childSessions.delete(targetId)
    })
    // ----
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
  if (control.kind === 'click_ref') await clickRef(entry, control.ref)
  if (control.kind === 'type') await insertText(entry, control.text)
  if (control.kind === 'press') await pressKey(entry, control.key)
  if (control.kind === 'scroll') await scroll(entry, control.x, control.y, control.deltaX ?? 0, control.deltaY)
  if (control.kind === 'snapshot') {
    await snapshotAndPost(claim.sessionId, entry)
    return undefined
  }
  if (control.kind === 'console') {
    await consoleAndPost(claim.sessionId, entry)
    return undefined
  }
  if (control.kind === 'extract') {
    await extractAndPost(claim.sessionId, entry)
    return undefined
  }
  if (control.kind === 'dialog') {
    await respondDialog(entry, control.accept, control.promptText)
    return undefined
  }
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
    runtimeVersion: process.env.PIB_RUNTIME_VERSION || '1.1.27',
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
