/**
 * Client-safe helpers for the Messages workbench Browser control sessions
 * (Phase 4b) — a live, controllable headless Chrome on the linked computer,
 * distinct from `browser-client.ts`'s Design Mode URL validation and the
 * read-only screenshot targets derived from conversation events. Mirrors
 * `tunnel-client.ts`'s fetch-flavored helpers, but talks to the browser
 * session endpoints built in `browser-session-store.ts` / the
 * `app/api/v1/conversations/[convId]/workbench/browser/sessions/**` routes:
 *
 *   POST   /api/v1/conversations/{id}/workbench/browser/sessions            { startUrl?, viewport? }
 *   GET    /api/v1/conversations/{id}/workbench/browser/sessions/{sessionId}
 *   POST   /api/v1/conversations/{id}/workbench/browser/sessions/{sessionId}/approve
 *   POST   /api/v1/conversations/{id}/workbench/browser/sessions/{sessionId}/navigate  { url }
 *   POST   /api/v1/conversations/{id}/workbench/browser/sessions/{sessionId}/capture
 *   POST   /api/v1/conversations/{id}/workbench/browser/sessions/{sessionId}/click     { x, y, button? }
 *   POST   /api/v1/conversations/{id}/workbench/browser/sessions/{sessionId}/type      { text }
 *   POST   /api/v1/conversations/{id}/workbench/browser/sessions/{sessionId}/press     { key }
 *   POST   /api/v1/conversations/{id}/workbench/browser/sessions/{sessionId}/scroll    { x, y, deltaX?, deltaY }
 *   POST   /api/v1/conversations/{id}/workbench/browser/sessions/{sessionId}/follow    { action, intervalMs? }
 *   POST   /api/v1/conversations/{id}/workbench/browser/sessions/{sessionId}/kill
 *
 * A browser session always starts `awaiting_approval` — a real browser
 * reaching the open internet from the linked computer is at least as
 * sensitive as an unattended file write — so the caller must `approve` it
 * before a device will spawn headless Chrome. `PublicWorkbenchBrowserSession`
 * / `WorkbenchBrowserSessionStatus` / `WorkbenchBrowserProgressChunk` are
 * re-exported type-only from `./browser-sessions` (the server module) so the
 * client and server never drift; the `import type` is fully erased at build
 * time, so nothing server-only (Firestore, `node:crypto`) ends up in the
 * browser bundle — same pattern `tunnel-client.ts`/`session-client.ts`
 * already use.
 *
 * These helpers throw a readable `Error` whenever a call fails, so the UI
 * layer (the Browser panel) can render an inline error/approval prompt
 * instead of crashing.
 */
import type {
  PublicWorkbenchBrowserSession as ServerPublicWorkbenchBrowserSession,
  WorkbenchBrowserProgressChunk as ServerWorkbenchBrowserProgressChunk,
  WorkbenchBrowserSessionStatus as ServerWorkbenchBrowserSessionStatus,
  WorkbenchBrowserViewport as ServerWorkbenchBrowserViewport,
} from './browser-sessions'

export type WorkbenchBrowserSessionStatus = ServerWorkbenchBrowserSessionStatus
export type PublicWorkbenchBrowserSession = ServerPublicWorkbenchBrowserSession
export type WorkbenchBrowserProgressChunk = ServerWorkbenchBrowserProgressChunk
export type WorkbenchBrowserViewport = ServerWorkbenchBrowserViewport

export const WORKBENCH_BROWSER_SESSION_TERMINAL_STATUSES: ReadonlySet<WorkbenchBrowserSessionStatus> = new Set([
  'exited', 'killed', 'expired', 'failed',
])

/** Statuses where Approve is meaningful (still waiting on the caller). */
export const WORKBENCH_BROWSER_SESSION_APPROVAL_STATUSES: ReadonlySet<WorkbenchBrowserSessionStatus> = new Set(['awaiting_approval'])

/** Statuses where Kill is meaningful (awaiting approval, or alive). */
export const WORKBENCH_BROWSER_SESSION_ACTIVE_STATUSES: ReadonlySet<WorkbenchBrowserSessionStatus> = new Set([
  'awaiting_approval', 'queued', 'claimed', 'running',
])

/** Statuses where navigate/capture/interaction/follow can be sent (matches the server's "browser session not running" check). */
export const WORKBENCH_BROWSER_SESSION_CONTROL_STATUSES: ReadonlySet<WorkbenchBrowserSessionStatus> = new Set(['claimed', 'running'])

export interface WorkbenchBrowserSessionCreateOptions {
  startUrl?: string
  viewport?: { width: number; height: number }
  signal?: AbortSignal
}

export interface WorkbenchBrowserSessionRequestOptions {
  signal?: AbortSignal
}

export interface WorkbenchBrowserSessionPollOptions extends WorkbenchBrowserSessionRequestOptions {
  /** Total time budget (ms) before giving up. Default 60s. */
  timeoutMs?: number
  /** Delay (ms) between polls. Default 1200ms. */
  intervalMs?: number
  onProgress?: (session: PublicWorkbenchBrowserSession) => void
  /** Statuses that stop the poll loop. Defaults to terminal ∪ `running` ∪ `awaiting_approval` (a decision point). */
  settledStatuses?: ReadonlySet<WorkbenchBrowserSessionStatus>
}

const DEFAULT_SETTLED_STATUSES: ReadonlySet<WorkbenchBrowserSessionStatus> = new Set([
  'awaiting_approval', 'running', 'exited', 'killed', 'expired', 'failed',
])

function workbenchBrowserSessionsBase(conversationId: string): string {
  return `/api/v1/conversations/${encodeURIComponent(conversationId)}/workbench/browser/sessions`
}

function workbenchBrowserSessionBase(conversationId: string, sessionId: string): string {
  return `${workbenchBrowserSessionsBase(conversationId)}/${encodeURIComponent(sessionId)}`
}

async function readWorkbenchBrowserSessionResponse(response: Response): Promise<PublicWorkbenchBrowserSession> {
  const body = await response.json().catch(() => null) as { data?: PublicWorkbenchBrowserSession; error?: string } | null
  if (!response.ok || !body?.data) {
    throw new Error(body?.error || `Workbench browser session request failed (${response.status})`)
  }
  return body.data
}

function wait(delayMs: number, signal?: AbortSignal): Promise<void> {
  if (delayMs <= 0) return Promise.resolve()
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, delayMs)
    signal?.addEventListener('abort', () => {
      clearTimeout(timer)
      reject(new DOMException('Aborted', 'AbortError'))
    }, { once: true })
  })
}

/** Requests a new browser control session, optionally navigating to `startUrl` immediately. Always starts `awaiting_approval`. */
export async function createWorkbenchBrowserSession(
  conversationId: string,
  options: WorkbenchBrowserSessionCreateOptions = {},
): Promise<PublicWorkbenchBrowserSession> {
  const { signal, ...body } = options
  const response = await fetch(workbenchBrowserSessionsBase(conversationId), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  })
  return readWorkbenchBrowserSessionResponse(response)
}

/** Reads the current state (status + any newly streamed progress chunks) of a browser session. */
export async function getWorkbenchBrowserSession(
  conversationId: string,
  sessionId: string,
  options: WorkbenchBrowserSessionRequestOptions = {},
): Promise<PublicWorkbenchBrowserSession> {
  const response = await fetch(workbenchBrowserSessionBase(conversationId, sessionId), {
    cache: 'no-store',
    signal: options.signal,
  })
  return readWorkbenchBrowserSessionResponse(response)
}

/** Approves an `awaiting_approval` browser session so a device will spawn headless Chrome. */
export async function approveWorkbenchBrowserSession(
  conversationId: string,
  sessionId: string,
  options: WorkbenchBrowserSessionRequestOptions = {},
): Promise<PublicWorkbenchBrowserSession> {
  const response = await fetch(`${workbenchBrowserSessionBase(conversationId, sessionId)}/approve`, {
    method: 'POST',
    signal: options.signal,
  })
  return readWorkbenchBrowserSessionResponse(response)
}

/** Navigates the running session's browser to `url`. */
export async function navigateWorkbenchBrowserSession(
  conversationId: string,
  sessionId: string,
  url: string,
  options: WorkbenchBrowserSessionRequestOptions = {},
): Promise<PublicWorkbenchBrowserSession> {
  const response = await fetch(`${workbenchBrowserSessionBase(conversationId, sessionId)}/navigate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url }),
    signal: options.signal,
  })
  return readWorkbenchBrowserSessionResponse(response)
}

/** Requests a fresh screenshot frame from the session's current page. */
export async function captureWorkbenchBrowserSession(
  conversationId: string,
  sessionId: string,
  options: WorkbenchBrowserSessionRequestOptions = {},
): Promise<PublicWorkbenchBrowserSession> {
  const response = await fetch(`${workbenchBrowserSessionBase(conversationId, sessionId)}/capture`, {
    method: 'POST',
    signal: options.signal,
  })
  return readWorkbenchBrowserSessionResponse(response)
}

export type WorkbenchBrowserMouseButton = 'left' | 'right' | 'middle'

export interface WorkbenchBrowserClickInput {
  /** CSS pixel offset inside the session viewport, origin top-left — not a percentage of the rendered frame. */
  x: number
  y: number
  button?: WorkbenchBrowserMouseButton
}

export interface WorkbenchBrowserTypeInput {
  /** Max 2000 characters; inserted at the page's current focus. */
  text: string
}

export interface WorkbenchBrowserPressInput {
  /** One allowlisted key: Enter, Escape, Tab, Backspace, Delete, arrows, Home/End, PageUp/PageDown. */
  key: string
}

export interface WorkbenchBrowserScrollInput {
  x: number
  y: number
  deltaX?: number
  deltaY: number
}

export interface WorkbenchBrowserFollowInput {
  action: 'start' | 'stop'
  /** Device-side capture cadence, clamped server-side to 500-5000ms. Ignored for `stop`. */
  intervalMs?: number
}

async function postWorkbenchBrowserSessionControl(
  conversationId: string,
  sessionId: string,
  action: string,
  body: unknown,
  options: WorkbenchBrowserSessionRequestOptions = {},
): Promise<PublicWorkbenchBrowserSession> {
  const response = await fetch(`${workbenchBrowserSessionBase(conversationId, sessionId)}/${action}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: options.signal,
  })
  return readWorkbenchBrowserSessionResponse(response)
}

/** Clicks at a viewport pixel coordinate in the running session's browser. */
export async function clickWorkbenchBrowserSession(
  conversationId: string,
  sessionId: string,
  input: WorkbenchBrowserClickInput,
  options: WorkbenchBrowserSessionRequestOptions = {},
): Promise<PublicWorkbenchBrowserSession> {
  return postWorkbenchBrowserSessionControl(conversationId, sessionId, 'click', input, options)
}

/** Types text into whatever the running session's browser currently has focused. */
export async function typeWorkbenchBrowserSession(
  conversationId: string,
  sessionId: string,
  input: WorkbenchBrowserTypeInput,
  options: WorkbenchBrowserSessionRequestOptions = {},
): Promise<PublicWorkbenchBrowserSession> {
  return postWorkbenchBrowserSessionControl(conversationId, sessionId, 'type', input, options)
}

/** Presses a single named key (e.g. `Enter`, `Escape`, `Tab`) in the running session's browser. */
export async function pressWorkbenchBrowserSession(
  conversationId: string,
  sessionId: string,
  input: WorkbenchBrowserPressInput,
  options: WorkbenchBrowserSessionRequestOptions = {},
): Promise<PublicWorkbenchBrowserSession> {
  return postWorkbenchBrowserSessionControl(conversationId, sessionId, 'press', input, options)
}

/** Scrolls by a wheel delta anchored at a viewport pixel coordinate. */
export async function scrollWorkbenchBrowserSession(
  conversationId: string,
  sessionId: string,
  input: WorkbenchBrowserScrollInput,
  options: WorkbenchBrowserSessionRequestOptions = {},
): Promise<PublicWorkbenchBrowserSession> {
  return postWorkbenchBrowserSessionControl(conversationId, sessionId, 'scroll', input, options)
}

/**
 * Starts or stops device-side frame following. While started, the device
 * captures frames on its own cadence instead of only on explicit `capture`
 * calls, so the panel can render a near-live view of the agent's browser.
 */
export async function followWorkbenchBrowserSession(
  conversationId: string,
  sessionId: string,
  input: WorkbenchBrowserFollowInput,
  options: WorkbenchBrowserSessionRequestOptions = {},
): Promise<PublicWorkbenchBrowserSession> {
  return postWorkbenchBrowserSessionControl(conversationId, sessionId, 'follow', input, options)
}

/**
 * Kills a browser session. An `awaiting_approval`/`queued` session (never
 * claimed by a device) transitions straight to `killed`; a `claimed`/
 * `running` session gets a kill control enqueued for its owning device —
 * the returned session may still show `running` until the device reports
 * the final outcome, so callers should keep polling after kill rather than
 * treating this response as terminal.
 */
export async function killWorkbenchBrowserSession(
  conversationId: string,
  sessionId: string,
  options: WorkbenchBrowserSessionRequestOptions = {},
): Promise<PublicWorkbenchBrowserSession> {
  const response = await fetch(`${workbenchBrowserSessionBase(conversationId, sessionId)}/kill`, {
    method: 'POST',
    signal: options.signal,
  })
  return readWorkbenchBrowserSessionResponse(response)
}

/** Polls a browser session until it reaches a settled status (approval needed, running, or terminal), or times out. */
export async function pollWorkbenchBrowserSession(
  conversationId: string,
  sessionId: string,
  options: WorkbenchBrowserSessionPollOptions = {},
): Promise<PublicWorkbenchBrowserSession> {
  const timeoutMs = options.timeoutMs ?? 60_000
  const intervalMs = options.intervalMs ?? 1200
  const settled = options.settledStatuses ?? DEFAULT_SETTLED_STATUSES
  const deadline = Date.now() + timeoutMs

  let session = await getWorkbenchBrowserSession(conversationId, sessionId, { signal: options.signal })
  options.onProgress?.(session)
  while (!settled.has(session.status)) {
    if (Date.now() >= deadline) throw new Error('Workbench browser session timed out waiting for the linked computer')
    await wait(intervalMs, options.signal)
    session = await getWorkbenchBrowserSession(conversationId, sessionId, { signal: options.signal })
    options.onProgress?.(session)
  }
  return session
}

/** Local, incrementally-accumulated progress state — see `appendWorkbenchBrowserSessionProgress`. */
export interface WorkbenchBrowserSessionProgressState {
  chunks: WorkbenchBrowserProgressChunk[]
  lastSeq: number
}

export const EMPTY_WORKBENCH_BROWSER_SESSION_PROGRESS: WorkbenchBrowserSessionProgressState = { chunks: [], lastSeq: -1 }

/**
 * Merges only the chunks newer than `state.lastSeq` into the running list.
 * The server's `progress` field is a capped ring buffer (same pattern as
 * job/pty-session progress chunks), so a full replace on every poll would
 * silently drop history once a session streams enough frames to overflow
 * that buffer — accumulating client-side avoids that.
 */
export function appendWorkbenchBrowserSessionProgress(
  state: WorkbenchBrowserSessionProgressState,
  session: Pick<PublicWorkbenchBrowserSession, 'progress'>,
): WorkbenchBrowserSessionProgressState {
  const incoming = (Array.isArray(session.progress) ? session.progress : [])
    .filter((chunk) => chunk.seq > state.lastSeq)
    .sort((left, right) => left.seq - right.seq)
  if (incoming.length === 0) return state
  return {
    chunks: [...state.chunks, ...incoming],
    lastSeq: incoming[incoming.length - 1].seq,
  }
}

/** Convenience: the most recent `frame` chunk's `imageUrl`, if any have streamed in yet. */
export function latestWorkbenchBrowserSessionFrameUrl(chunks: readonly WorkbenchBrowserProgressChunk[]): string | undefined {
  for (let index = chunks.length - 1; index >= 0; index -= 1) {
    const chunk = chunks[index]
    if (chunk.stream === 'frame' && chunk.imageUrl) return chunk.imageUrl
  }
  return undefined
}
