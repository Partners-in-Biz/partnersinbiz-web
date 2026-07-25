/**
 * Client-safe helpers for the Messages workbench Tunnel mode (Phase 4b).
 * Mirrors `session-client.ts`'s fetch-flavored helpers, but talks to the
 * tunnel endpoints built in `tunnel-session-store.ts` / the
 * `app/api/v1/conversations/[convId]/workbench/tunnel/sessions/**` routes:
 *
 *   POST   /api/v1/conversations/{id}/workbench/tunnel/sessions            { port }
 *   GET    /api/v1/conversations/{id}/workbench/tunnel/sessions/{sessionId}
 *   POST   /api/v1/conversations/{id}/workbench/tunnel/sessions/{sessionId}/approve
 *   POST   /api/v1/conversations/{id}/workbench/tunnel/sessions/{sessionId}/kill
 *
 * A tunnel always starts `awaiting_approval` — creating one briefly exposes
 * a local port to the public internet — so the caller must `approve` it
 * before a device will spawn the provider process. `PublicWorkbenchTunnelSession`
 * / `WorkbenchTunnelStatus` are re-exported type-only from `./tunnel-sessions`
 * (the server module) so the client and server never drift; the `import
 * type` is fully erased at build time, so nothing server-only (Firestore,
 * `node:crypto`) ends up in the browser bundle — same pattern
 * `session-client.ts` already uses for `PublicWorkbenchSession`.
 *
 * These helpers throw a readable `Error` whenever a call fails, so the UI
 * layer (the Browser panel) can render an inline error/approval prompt
 * instead of crashing.
 */
import type {
  PublicWorkbenchTunnelSession as ServerPublicWorkbenchTunnelSession,
  WorkbenchTunnelStatus as ServerWorkbenchTunnelStatus,
} from './tunnel-sessions'

export type WorkbenchTunnelStatus = ServerWorkbenchTunnelStatus
export type PublicWorkbenchTunnelSession = ServerPublicWorkbenchTunnelSession

export const WORKBENCH_TUNNEL_TERMINAL_STATUSES: ReadonlySet<WorkbenchTunnelStatus> = new Set([
  'exited', 'killed', 'expired', 'failed',
])

/** Statuses where Approve is meaningful (still waiting on the caller). */
export const WORKBENCH_TUNNEL_APPROVAL_STATUSES: ReadonlySet<WorkbenchTunnelStatus> = new Set(['awaiting_approval'])

/** Statuses where Kill is meaningful (awaiting approval, or alive). */
export const WORKBENCH_TUNNEL_ACTIVE_STATUSES: ReadonlySet<WorkbenchTunnelStatus> = new Set([
  'awaiting_approval', 'queued', 'claimed', 'running',
])

export interface WorkbenchTunnelCreateOptions {
  signal?: AbortSignal
}

export interface WorkbenchTunnelPollOptions {
  /** Total time budget (ms) before giving up. Default 2 minutes — waiting on cloudflared to resolve a URL. */
  timeoutMs?: number
  /** Delay (ms) between polls. Default 750ms. */
  intervalMs?: number
  signal?: AbortSignal
  onProgress?: (session: PublicWorkbenchTunnelSession) => void
}

function workbenchTunnelSessionsBase(conversationId: string): string {
  return `/api/v1/conversations/${encodeURIComponent(conversationId)}/workbench/tunnel/sessions`
}

function workbenchTunnelSessionBase(conversationId: string, sessionId: string): string {
  return `${workbenchTunnelSessionsBase(conversationId)}/${encodeURIComponent(sessionId)}`
}

async function readWorkbenchTunnelResponse(response: Response): Promise<PublicWorkbenchTunnelSession> {
  const body = await response.json().catch(() => null) as { data?: PublicWorkbenchTunnelSession; error?: string } | null
  if (!response.ok || !body?.data) {
    throw new Error(body?.error || `Workbench tunnel request failed (${response.status})`)
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

/** Requests a new outbound tunnel to `port` on the linked computer. Always starts `awaiting_approval`. */
export async function createTunnelSession(
  conversationId: string,
  port: number,
  options: WorkbenchTunnelCreateOptions = {},
): Promise<PublicWorkbenchTunnelSession> {
  const response = await fetch(workbenchTunnelSessionsBase(conversationId), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ port }),
    signal: options.signal,
  })
  return readWorkbenchTunnelResponse(response)
}

/** Reads the current state (status, publicUrl once resolved, progress) of a tunnel. */
export async function getTunnelSession(
  conversationId: string,
  sessionId: string,
  options: { signal?: AbortSignal } = {},
): Promise<PublicWorkbenchTunnelSession> {
  const response = await fetch(workbenchTunnelSessionBase(conversationId, sessionId), {
    cache: 'no-store',
    signal: options.signal,
  })
  return readWorkbenchTunnelResponse(response)
}

/** Approves an `awaiting_approval` tunnel so a device will spawn the provider process. */
export async function approveTunnelSession(
  conversationId: string,
  sessionId: string,
  options: { signal?: AbortSignal } = {},
): Promise<PublicWorkbenchTunnelSession> {
  const response = await fetch(`${workbenchTunnelSessionBase(conversationId, sessionId)}/approve`, {
    method: 'POST',
    signal: options.signal,
  })
  return readWorkbenchTunnelResponse(response)
}

/**
 * Kills a tunnel. An `awaiting_approval`/`queued` tunnel (never claimed by a
 * device) transitions straight to `killed`; a `claimed`/`running` tunnel
 * gets a kill control enqueued for its owning device — the returned session
 * may still show `running` until the device reports the final outcome, so
 * callers should keep polling after kill rather than treating this response
 * as terminal.
 */
export async function killTunnelSession(
  conversationId: string,
  sessionId: string,
  options: { signal?: AbortSignal } = {},
): Promise<PublicWorkbenchTunnelSession> {
  const response = await fetch(`${workbenchTunnelSessionBase(conversationId, sessionId)}/kill`, {
    method: 'POST',
    signal: options.signal,
  })
  return readWorkbenchTunnelResponse(response)
}

/** Polls a tunnel until it reaches a terminal status or resolves a `publicUrl`, or `timeoutMs` elapses. */
export async function pollTunnelSession(
  conversationId: string,
  sessionId: string,
  options: WorkbenchTunnelPollOptions = {},
): Promise<PublicWorkbenchTunnelSession> {
  const timeoutMs = options.timeoutMs ?? 2 * 60_000
  const intervalMs = options.intervalMs ?? 750
  const deadline = Date.now() + timeoutMs

  let session = await getTunnelSession(conversationId, sessionId, { signal: options.signal })
  options.onProgress?.(session)
  while (!WORKBENCH_TUNNEL_TERMINAL_STATUSES.has(session.status) && !session.publicUrl) {
    if (Date.now() >= deadline) throw new Error('Workbench tunnel timed out waiting for the linked computer')
    await wait(intervalMs, options.signal)
    session = await getTunnelSession(conversationId, sessionId, { signal: options.signal })
    options.onProgress?.(session)
  }
  return session
}
