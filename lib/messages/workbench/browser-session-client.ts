/**
 * Client-safe helpers for the Messages workbench agent browser sessions
 * (Phase 4b) — a live, controllable browser on the linked computer, distinct
 * from `browser-client.ts`'s Design Mode URL validation and the read-only
 * screenshot targets derived from conversation events. Mirrors
 * `session-client.ts`'s create/get/kill pattern, plus an approval step and
 * navigate/capture actions:
 *
 *   POST /api/v1/conversations/{id}/workbench/browser/sessions            { startUrl?, viewport? }
 *   GET  /api/v1/conversations/{id}/workbench/browser/sessions/{sessionId}
 *   POST /api/v1/conversations/{id}/workbench/browser/sessions/{sessionId}/approve
 *   POST /api/v1/conversations/{id}/workbench/browser/sessions/{sessionId}/navigate  { url }
 *   POST /api/v1/conversations/{id}/workbench/browser/sessions/{sessionId}/capture
 *   POST /api/v1/conversations/{id}/workbench/browser/sessions/{sessionId}/kill
 *
 * These routes are being built by a parallel workstream — every helper here
 * throws a readable `Error` on a non-2xx response (including a 404/501
 * while the route doesn't exist yet), so the UI layer can render an inline
 * error instead of crashing.
 */

export type WorkbenchBrowserSessionStatus =
  | 'queued'
  | 'awaiting_approval'
  | 'starting'
  | 'running'
  | 'closed'
  | 'failed'
  | 'expired'

/** One captured frame, ordered by `seq` (mirrors `WorkbenchJobProgressChunk`'s seq-ordered ring buffer). */
export interface WorkbenchBrowserSessionFrame {
  id: string
  seq: number
  imageUrl: string
  url?: string
  title?: string
  capturedAt?: string
}

export interface PublicWorkbenchBrowserSession {
  sessionId: string
  status: WorkbenchBrowserSessionStatus
  startUrl?: string
  currentUrl?: string
  viewport?: { width: number; height: number }
  /** Ring buffer of recently captured frames — accumulate client-side via `appendWorkbenchBrowserSessionFrames`. */
  frames?: WorkbenchBrowserSessionFrame[]
  error?: string
  createdAt: string
  updatedAt: string
}

/** Statuses where the session is fully done and can't be resumed. */
export const WORKBENCH_BROWSER_SESSION_TERMINAL_STATUSES: ReadonlySet<WorkbenchBrowserSessionStatus> = new Set(['closed', 'failed', 'expired'])
/** Statuses where Start is disallowed and Kill is meaningful. */
export const WORKBENCH_BROWSER_SESSION_ACTIVE_STATUSES: ReadonlySet<WorkbenchBrowserSessionStatus> = new Set(['queued', 'awaiting_approval', 'starting', 'running'])
/** Statuses worth stopping a poll loop on: either a decision point (approval) or a settled/terminal state. */
export const WORKBENCH_BROWSER_SESSION_SETTLED_STATUSES: ReadonlySet<WorkbenchBrowserSessionStatus> = new Set([
  'awaiting_approval', 'running', 'closed', 'failed', 'expired',
])
/** Statuses where navigate/capture can be sent (matches the server's expected running-session check). */
export const WORKBENCH_BROWSER_SESSION_CONTROL_STATUSES: ReadonlySet<WorkbenchBrowserSessionStatus> = new Set(['running'])

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
  /** Statuses that stop the poll loop. Defaults to `WORKBENCH_BROWSER_SESSION_SETTLED_STATUSES`. */
  settledStatuses?: ReadonlySet<WorkbenchBrowserSessionStatus>
}

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

/** Starts a new agent browser session on the linked computer, optionally navigating to `startUrl` immediately. */
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

/** Reads the current state (status + any newly captured frames) of a browser session. */
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

/** Approves a browser session that is `awaiting_approval`, allowing the linked computer to launch it. */
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

/** Closes the session's browser. A `queued` session closes immediately; a running one may briefly report its pre-kill status. */
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
  const settled = options.settledStatuses ?? WORKBENCH_BROWSER_SESSION_SETTLED_STATUSES
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

/** Local, incrementally-accumulated frame state — see `appendWorkbenchBrowserSessionFrames`. */
export interface WorkbenchBrowserSessionFrameState {
  frames: WorkbenchBrowserSessionFrame[]
  lastSeq: number
}

export const EMPTY_WORKBENCH_BROWSER_SESSION_FRAMES: WorkbenchBrowserSessionFrameState = { frames: [], lastSeq: -1 }

/**
 * Merges only the frames newer than `state.lastSeq` into the running list.
 * The server's `frames` field is expected to be a capped ring buffer (same
 * pattern as job/session progress chunks), so a full replace on every poll
 * would silently drop history once a session has captured enough frames to
 * overflow that buffer — accumulating client-side avoids that.
 */
export function appendWorkbenchBrowserSessionFrames(
  state: WorkbenchBrowserSessionFrameState,
  session: Pick<PublicWorkbenchBrowserSession, 'frames'>,
): WorkbenchBrowserSessionFrameState {
  const incoming = (Array.isArray(session.frames) ? session.frames : [])
    .filter((frame) => frame.seq > state.lastSeq)
    .sort((left, right) => left.seq - right.seq)
  if (incoming.length === 0) return state
  return {
    frames: [...state.frames, ...incoming],
    lastSeq: incoming[incoming.length - 1].seq,
  }
}
