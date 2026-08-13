/**
 * Client-safe helpers for the Messages workbench interactive Session mode
 * (Phase 3b). Mirrors `browser-client.ts`'s one-shot job helpers, but talks
 * to the real session endpoints built in `session-store.ts` / the
 * `app/api/v1/conversations/[convId]/workbench/sessions/**` routes:
 *
 *   POST   /api/v1/conversations/{id}/workbench/sessions            { cols?, rows?, cwd? }
 *   GET    /api/v1/conversations/{id}/workbench/sessions/{sessionId}
 *   POST   /api/v1/conversations/{id}/workbench/sessions/{sessionId}/approve
 *   POST   /api/v1/conversations/{id}/workbench/sessions/{sessionId}/stdin   { data, mode }
 *   POST   /api/v1/conversations/{id}/workbench/sessions/{sessionId}/resize { cols, rows }
 *   POST   /api/v1/conversations/{id}/workbench/sessions/{sessionId}/kill
 *
 * A session is a real interactive shell (server-chosen bash/zsh — a client
 * can never request a specific shell or initial command), not a one-shot
 * job. It always starts `awaiting_approval` — a full shell is strictly more
 * powerful than the allowlisted one-shot jobs — so the caller must `approve`
 * it before a device will spawn the pty.
 * `PublicWorkbenchSession`/`WorkbenchSessionStatus` are re-exported
 * type-only from `./sessions` (the server module) so the client and server
 * never drift; the `import type` is fully erased at build time, so nothing
 * server-only (Firestore, `node:crypto`) ends up in the browser bundle —
 * same pattern `browser-client.ts` already uses for `PublicWorkbenchJob`.
 *
 * These helpers throw a readable `Error` whenever a call fails (e.g. a 404
 * while this route is still being deployed, or a 409 when the session isn't
 * running yet), so the UI layer can render an inline error instead of
 * crashing.
 */
import type { WorkbenchJobProgressChunk } from './jobs'
import type {
  PublicWorkbenchSession as ServerPublicWorkbenchSession,
  WorkbenchSessionStatus as ServerWorkbenchSessionStatus,
} from './sessions'

export type WorkbenchSessionStatus = ServerWorkbenchSessionStatus
export type WorkbenchSessionOutputChunk = WorkbenchJobProgressChunk
export type PublicWorkbenchSession = ServerPublicWorkbenchSession

export const WORKBENCH_SESSION_TERMINAL_STATUSES: ReadonlySet<WorkbenchSessionStatus> = new Set([
  'exited', 'killed', 'expired', 'failed',
])

/** Statuses where the session is alive enough to accept stdin (matches `enqueueControl`'s server-side check). */
export const WORKBENCH_SESSION_INPUT_STATUSES: ReadonlySet<WorkbenchSessionStatus> = new Set(['claimed', 'running'])

/** Statuses where Approve is meaningful (still waiting on the caller). */
export const WORKBENCH_SESSION_APPROVAL_STATUSES: ReadonlySet<WorkbenchSessionStatus> = new Set(['awaiting_approval'])

/** Statuses where Start is disallowed and Kill is meaningful (awaiting approval, queued, or alive). */
export const WORKBENCH_SESSION_ACTIVE_STATUSES: ReadonlySet<WorkbenchSessionStatus> = new Set([
  'awaiting_approval', 'queued', 'claimed', 'running',
])

export interface WorkbenchSessionCreateOptions {
  cols?: number
  rows?: number
  /** Relative to the conversation's bound workspace folder. Omit to use the workspace root. */
  cwd?: string
  signal?: AbortSignal
}

export interface WorkbenchSessionPollOptions {
  /** Total time budget (ms) before giving up. Default 10 minutes — sessions are long-lived by design. */
  timeoutMs?: number
  /** Delay (ms) between polls. Default 750ms. */
  intervalMs?: number
  signal?: AbortSignal
  onProgress?: (session: PublicWorkbenchSession) => void
  /** Statuses that stop the poll loop. Defaults to terminal ∪ `awaiting_approval` (a decision point). */
  settledStatuses?: ReadonlySet<WorkbenchSessionStatus>
}

const DEFAULT_SETTLED_STATUSES: ReadonlySet<WorkbenchSessionStatus> = new Set([
  'awaiting_approval', 'exited', 'killed', 'expired', 'failed',
])

function workbenchSessionsBase(conversationId: string): string {
  return `/api/v1/conversations/${encodeURIComponent(conversationId)}/workbench/sessions`
}

function workbenchSessionBase(conversationId: string, sessionId: string): string {
  return `${workbenchSessionsBase(conversationId)}/${encodeURIComponent(sessionId)}`
}

async function readWorkbenchSessionResponse(response: Response): Promise<PublicWorkbenchSession> {
  const body = await response.json().catch(() => null) as { data?: PublicWorkbenchSession; error?: string } | null
  if (!response.ok || !body?.data) {
    throw new Error(body?.error || `Workbench session request failed (${response.status})`)
  }
  return body.data
}

function isTransientNetworkError(error: unknown): boolean {
  if (!error || (error instanceof DOMException && error.name === 'AbortError')) return false
  const raw = error instanceof Error ? error.message : String(error)
  const lower = raw.toLowerCase()
  return (
    lower.includes('failed to fetch')
    || lower.includes('networkerror')
    || lower.includes('network request failed')
    || lower.includes('load failed')
    || lower.includes('fetch failed')
    || lower.includes('network glitch')
    || (error instanceof TypeError && lower.includes('fetch'))
  )
}

function humanizeWorkbenchSessionError(error: unknown, fallback: string): Error {
  if (error instanceof DOMException && error.name === 'AbortError') return error
  if (isTransientNetworkError(error)) {
    return new Error('Network glitch talking to the terminal session. Retry — the linked computer may still be starting the shell.')
  }
  if (error instanceof Error) return error
  return new Error(fallback)
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

/** Low-level GET that preserves raw network errors so callers can retry. */
async function getWorkbenchSessionRaw(
  conversationId: string,
  sessionId: string,
  options: { signal?: AbortSignal } = {},
): Promise<PublicWorkbenchSession> {
  const response = await fetch(workbenchSessionBase(conversationId, sessionId), {
    cache: 'no-store',
    signal: options.signal,
  })
  return readWorkbenchSessionResponse(response)
}

async function fetchWorkbenchSessionWithRetry(
  conversationId: string,
  sessionId: string,
  options: { signal?: AbortSignal } = {},
  retries = 3,
): Promise<PublicWorkbenchSession> {
  let lastError: unknown
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await getWorkbenchSessionRaw(conversationId, sessionId, options)
    } catch (error) {
      lastError = error
      if (!isTransientNetworkError(error) || attempt >= retries) break
      await wait(300 * (attempt + 1), options.signal)
    }
  }
  throw humanizeWorkbenchSessionError(lastError, 'Unable to read workbench session')
}

/** Starts a new interactive shell session on the linked computer (server-chosen shell binary). Always starts `awaiting_approval`. */
export async function createWorkbenchSession(
  conversationId: string,
  options: WorkbenchSessionCreateOptions = {},
): Promise<PublicWorkbenchSession> {
  const { signal, ...body } = options
  try {
    const response = await fetch(workbenchSessionsBase(conversationId), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    })
    return await readWorkbenchSessionResponse(response)
  } catch (error) {
    throw humanizeWorkbenchSessionError(error, 'Failed to start the session.')
  }
}

/** Reads the current state (status + any newly buffered progress chunks) of a session. */
export async function getWorkbenchSession(
  conversationId: string,
  sessionId: string,
  options: { signal?: AbortSignal } = {},
): Promise<PublicWorkbenchSession> {
  try {
    return await getWorkbenchSessionRaw(conversationId, sessionId, options)
  } catch (error) {
    throw humanizeWorkbenchSessionError(error, 'Unable to read workbench session')
  }
}

/**
 * Lists this user's own, context-bound, still-active sessions for a
 * conversation. Used to rehydrate the terminal panel after a tab switch or
 * remount — the server durably persists live sessions, so returning to a
 * conversation should bring the active session back instead of resetting to
 * "Not started".
 */
export async function listWorkbenchSessions(
  conversationId: string,
  options: { signal?: AbortSignal } = {},
): Promise<PublicWorkbenchSession[]> {
  try {
    const response = await fetch(workbenchSessionsBase(conversationId), {
      cache: 'no-store',
      signal: options.signal,
    })
    const body = await response.json().catch(() => null) as { data?: PublicWorkbenchSession[]; error?: string } | null
    if (!response.ok || !Array.isArray(body?.data)) {
      throw new Error(body?.error || `Workbench session list request failed (${response.status})`)
    }
    return body.data
  } catch (error) {
    throw humanizeWorkbenchSessionError(error, 'Unable to list workbench sessions')
  }
}

/** Approves an `awaiting_approval` session so a device will spawn the pty. */
export async function approveWorkbenchSession(
  conversationId: string,
  sessionId: string,
  options: { signal?: AbortSignal } = {},
): Promise<PublicWorkbenchSession> {
  try {
    const response = await fetch(`${workbenchSessionBase(conversationId, sessionId)}/approve`, {
      method: 'POST',
      signal: options.signal,
    })
    return await readWorkbenchSessionResponse(response)
  } catch (error) {
    throw humanizeWorkbenchSessionError(error, 'Failed to approve the session.')
  }
}

/** Polls a session until it reaches a settled status (approval needed, or terminal), or `timeoutMs` elapses. */
export async function pollWorkbenchSession(
  conversationId: string,
  sessionId: string,
  options: WorkbenchSessionPollOptions = {},
): Promise<PublicWorkbenchSession> {
  const timeoutMs = options.timeoutMs ?? 10 * 60_000
  const intervalMs = options.intervalMs ?? 750
  const settled = options.settledStatuses ?? DEFAULT_SETTLED_STATUSES
  const deadline = Date.now() + timeoutMs

  let session = await fetchWorkbenchSessionWithRetry(conversationId, sessionId, { signal: options.signal })
  options.onProgress?.(session)
  while (!settled.has(session.status)) {
    if (Date.now() >= deadline) throw new Error('Workbench session timed out waiting for the linked computer')
    await wait(intervalMs, options.signal)
    session = await fetchWorkbenchSessionWithRetry(conversationId, sessionId, { signal: options.signal })
    options.onProgress?.(session)
  }
  return session
}

/** Writes a chunk of stdin to a claimed/running session. `mode: 'line'` appends a trailing newline server-side. */
export async function writeWorkbenchSessionStdin(
  conversationId: string,
  sessionId: string,
  data: string,
  mode: 'line' | 'raw' = 'line',
  options: { signal?: AbortSignal } = {},
): Promise<PublicWorkbenchSession> {
  const response = await fetch(`${workbenchSessionBase(conversationId, sessionId)}/stdin`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ data, mode }),
    signal: options.signal,
  })
  return readWorkbenchSessionResponse(response)
}

/** Resizes the PTY to match the xterm grid reported by `WorkbenchXterm`'s fit/resize observer. */
export async function resizeWorkbenchSession(
  conversationId: string,
  sessionId: string,
  cols: number,
  rows: number,
  options: { signal?: AbortSignal } = {},
): Promise<PublicWorkbenchSession> {
  const response = await fetch(`${workbenchSessionBase(conversationId, sessionId)}/resize`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cols, rows }),
    signal: options.signal,
  })
  return readWorkbenchSessionResponse(response)
}

/**
 * Kills a session. An `awaiting_approval`/`queued` session (never claimed by
 * a device) transitions straight to `killed`; a `claimed`/`running` session gets a kill control
 * enqueued for its owning device — the returned session may still show
 * `running` until the device reports the final outcome, so callers should
 * keep polling after kill rather than treating this response as terminal.
 */
export async function killWorkbenchSession(
  conversationId: string,
  sessionId: string,
  options: { signal?: AbortSignal } = {},
): Promise<PublicWorkbenchSession> {
  const response = await fetch(`${workbenchSessionBase(conversationId, sessionId)}/kill`, {
    method: 'POST',
    signal: options.signal,
  })
  return readWorkbenchSessionResponse(response)
}

/** Local, incrementally-accumulated transcript state — see `appendWorkbenchSessionOutput`. */
export interface WorkbenchSessionTranscriptState {
  text: string
  lastSeq: number
}

export const EMPTY_WORKBENCH_SESSION_TRANSCRIPT: WorkbenchSessionTranscriptState = { text: '', lastSeq: -1 }

/**
 * Merges only the progress chunks newer than `state.lastSeq` into the
 * running transcript. The server's `progress` field is a capped 64-entry
 * ring buffer (see `appendWorkbenchProgressChunk` in `jobs.ts`), so a full
 * replace on every poll would silently drop history once a session has
 * been running long enough to overflow that buffer — accumulating
 * client-side avoids that.
 */
export function appendWorkbenchSessionOutput(
  state: WorkbenchSessionTranscriptState,
  session: Pick<PublicWorkbenchSession, 'progress'>,
): WorkbenchSessionTranscriptState {
  const chunks = (Array.isArray(session.progress) ? session.progress : [])
    .filter((chunk) => chunk.seq > state.lastSeq)
    .sort((left, right) => left.seq - right.seq)
  if (chunks.length === 0) return state
  const appended = chunks.map((chunk) => chunk.text).join('')
  return { text: state.text + appended, lastSeq: chunks[chunks.length - 1].seq }
}
