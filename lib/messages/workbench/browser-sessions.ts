import * as crypto from 'node:crypto'
import { decryptWorkbenchValue, encryptWorkbenchValue, type EncryptedWorkbenchValue } from './jobs'

/**
 * Phase 4b: long-lived headless Chrome "browser control" sessions — navigate
 * + capture screenshots on the linked computer, streamed into workbench
 * progress as frames. This module clones the pty session pattern in
 * `sessions.ts` (types/pure-state-machine only; Firestore persistence lives
 * in `browser-session-store.ts`), with one structural difference: every
 * create always starts `awaiting_approval` (mirroring the `fs.write`
 * self-approval gate in `jobs.ts`/`job-store.ts`) rather than going straight
 * to `queued` — a real browser reaching the open internet from the linked
 * computer is at least as sensitive as an unattended file write, so this
 * always requires an explicit approval step, regardless of actor role.
 *
 * Encryption reuses `encryptWorkbenchValue`/`decryptWorkbenchValue` from
 * `jobs.ts` rather than adding a third envelope-encryption implementation —
 * those helpers only key off `(deviceId, id, purpose)`, so passing this
 * session's id in place of a job id is safe as long as ids never collide
 * across the two collections, which the `wbbs_` id prefix guarantees.
 */

const MAX_PENDING_CONTROLS = 64
/** Progress ring buffer is smaller than the pty session's 64 — signed image URLs are far heavier than a line of stdout. */
const MAX_PROGRESS_CHUNKS = 30
const MAX_PROGRESS_TEXT_BYTES = 2_000
const MAX_URL_LENGTH = 2_048
const MAX_TITLE_LENGTH = 500

const MIN_VIEWPORT_WIDTH = 320
const MAX_VIEWPORT_WIDTH = 1920
const MIN_VIEWPORT_HEIGHT = 240
const MAX_VIEWPORT_HEIGHT = 1200

export const WORKBENCH_BROWSER_DEFAULT_VIEWPORT = { width: 1280, height: 720 } as const
/** Absolute session lifetime, matching the pty session's `WORKBENCH_SESSION_TTL_MS`. */
export const WORKBENCH_BROWSER_SESSION_TTL_MS = 30 * 60 * 1000
/** Renewable claim/heartbeat lease, matching the pty session's `WORKBENCH_SESSION_LEASE_MS`. */
export const WORKBENCH_BROWSER_SESSION_LEASE_MS = 90_000

export type WorkbenchBrowserSessionStatus =
  | 'awaiting_approval'
  | 'queued'
  | 'claimed'
  | 'running'
  | 'exited'
  | 'killed'
  | 'expired'
  | 'failed'

export interface WorkbenchBrowserViewport {
  width: number
  height: number
}

/**
 * Work a device worker consumes from its per-device pending-work queue.
 * `create` is claimed exactly once per session (spawns headless Chrome and
 * connects over CDP); `navigate` / `capture` / `kill` are delivered one at a
 * time to a device that already owns that session's running browser. See
 * `WorkbenchBrowserSessionClaim` in `browser-session-store.ts` for the exact
 * claim response envelope (sessionId, attempt, leaseToken, etc.) wrapping
 * one of these controls.
 */
export type WorkbenchBrowserSessionControl =
  | { kind: 'create'; startUrl: string | null; viewport: WorkbenchBrowserViewport }
  | { kind: 'navigate'; url: string }
  | { kind: 'capture' }
  | { kind: 'kill' }

/** A single not-yet-delivered navigate/capture/kill control, FIFO-ordered by `seq`. */
export interface WorkbenchBrowserSessionQueuedControl {
  seq: number
  control: Exclude<WorkbenchBrowserSessionControl, { kind: 'create' }>
  actorUserId: string
  enqueuedAtMs: number
}

export interface WorkbenchBrowserSession {
  sessionId: string
  conversationId: string
  orgId: string
  actorUserId: string
  actorRole: 'admin' | 'client'
  deviceId: string
  runtimeTargetId: string
  credentialVersion: number
  workspaceId: string
  mappingId: string
  projectId?: string
  projectReplicaId?: string
  /** Server-bound relative workspace folder; never exposed via `publicWorkbenchBrowserSession`. */
  relativeFolder: string
  startUrl: string | null
  viewport: WorkbenchBrowserViewport
  status: WorkbenchBrowserSessionStatus
  attempt: number
  leaseToken?: string
  leaseExpiresAtMs?: number
  claimedAtMs?: number
  approvedByUserId?: string
  approvedAtMs?: number
  /** Denormalized from the most recent `frame`/`status` progress chunk, for cheap UI display without decrypting the whole ring buffer. */
  currentPageUrl?: string
  currentPageTitle?: string
  error?: string
  /** Encrypted `{ kind: 'create'; ... }` control; cleared once a device claims it. */
  encryptedCreateControl: EncryptedWorkbenchValue | null
  /** Encrypted, capped FIFO of not-yet-delivered navigate/capture/kill controls. */
  encryptedControls?: EncryptedWorkbenchValue | null
  /** Encrypted, capped ring buffer of streamed frame/status/stderr chunks. */
  encryptedProgress?: EncryptedWorkbenchValue | null
  /** Decrypted transient values; never persisted by the store. */
  pendingControls?: WorkbenchBrowserSessionQueuedControl[]
  progressChunks?: WorkbenchBrowserProgressChunk[]
  resultFingerprint?: string
  createdAtMs: number
  updatedAtMs: number
  ttlExpiresAtMs: number
  completedAtMs?: number
}

/** Progress chunk streamed by a device worker while a browser session runs. */
export interface WorkbenchBrowserProgressChunk {
  seq: number
  stream: 'frame' | 'status' | 'stderr'
  imageUrl?: string
  contentType?: string
  pageUrl?: string
  title?: string
  text?: string
  atMs: number
}

export interface PublicWorkbenchBrowserSession {
  sessionId: string
  status: WorkbenchBrowserSessionStatus
  startUrl: string | null
  viewport: WorkbenchBrowserViewport
  progress?: WorkbenchBrowserProgressChunk[]
  currentPageUrl?: string
  currentPageTitle?: string
  error?: string
  createdAt: string
  updatedAt: string
  ttlExpiresAt: string
  approvedAt?: string
}

const TERMINAL_BROWSER_SESSION_STATUSES: ReadonlySet<WorkbenchBrowserSessionStatus> = new Set(['exited', 'killed', 'expired', 'failed'])

export function isTerminalWorkbenchBrowserSessionStatus(status: WorkbenchBrowserSessionStatus): boolean {
  return TERMINAL_BROWSER_SESSION_STATUSES.has(status)
}

export function generateWorkbenchBrowserSessionId(): string {
  return `wbbs_${crypto.randomBytes(18).toString('base64url')}`
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.trunc(value)))
}

/** Sanitizes an optional viewport, defaulting to 1280x720 and clamping to 320-1920 x 240-1200. */
export function sanitizeWorkbenchBrowserViewport(width: unknown, height: unknown): WorkbenchBrowserViewport | null {
  if (width !== undefined && (typeof width !== 'number' || !Number.isFinite(width))) return null
  if (height !== undefined && (typeof height !== 'number' || !Number.isFinite(height))) return null
  return {
    width: width === undefined ? WORKBENCH_BROWSER_DEFAULT_VIEWPORT.width : clamp(width, MIN_VIEWPORT_WIDTH, MAX_VIEWPORT_WIDTH),
    height: height === undefined ? WORKBENCH_BROWSER_DEFAULT_VIEWPORT.height : clamp(height, MIN_VIEWPORT_HEIGHT, MAX_VIEWPORT_HEIGHT),
  }
}

/**
 * Validates a navigation target. Unlike the observer-mode iframe panel
 * (`WorkbenchBrowserPanel.tsx`), which blocks private/local hostnames to
 * protect *this server's* users from SSRF into an internal network, this
 * headless Chrome instance runs entirely on the linked computer itself —
 * navigating it to `http://localhost:3000` just points it at that same
 * machine's own dev server, which is the whole point of the feature. So the
 * only server-side rules are protocol (http/https only — this alone already
 * rejects `file:`, `javascript:`, `data:`, etc.) and no embedded credentials.
 */
export function sanitizeWorkbenchBrowserUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed || trimmed.length > MAX_URL_LENGTH) return null
  let parsed: URL
  try {
    parsed = new URL(trimmed)
  } catch {
    return null
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null
  if (parsed.username || parsed.password) return null
  return parsed.toString()
}

/** Sanitizes the optional `startUrl` on create: omitted/null opens a blank tab; otherwise must pass `sanitizeWorkbenchBrowserUrl`. */
export function sanitizeWorkbenchBrowserStartUrl(value: unknown): { ok: true; url: string | null } | { ok: false } {
  if (value === undefined || value === null) return { ok: true, url: null }
  const url = sanitizeWorkbenchBrowserUrl(value)
  return url ? { ok: true, url } : { ok: false }
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function exactKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key))
}

/**
 * Defensively re-validates a control payload, including ones this module
 * encrypted and decrypted itself — cheap insurance against a future bug
 * writing a malformed control into Firestore.
 */
export function parseWorkbenchBrowserSessionControl(value: unknown): WorkbenchBrowserSessionControl {
  const input = record(value)
  if (!input || typeof input.kind !== 'string') throw new Error('workbench: invalid browser session control')
  switch (input.kind) {
    case 'create': {
      if (!exactKeys(input, ['kind', 'startUrl', 'viewport'])) throw new Error('workbench: invalid browser session control')
      const viewportInput = record(input.viewport)
      if (
        !viewportInput
        || !exactKeys(viewportInput, ['width', 'height'])
        || typeof viewportInput.width !== 'number'
        || typeof viewportInput.height !== 'number'
      ) throw new Error('workbench: invalid browser session control')
      const viewport = sanitizeWorkbenchBrowserViewport(viewportInput.width, viewportInput.height)
      if (!viewport) throw new Error('workbench: invalid browser session control')
      const startUrlResult = sanitizeWorkbenchBrowserStartUrl(input.startUrl)
      if (!startUrlResult.ok) throw new Error('workbench: invalid browser session control')
      return { kind: 'create', startUrl: startUrlResult.url, viewport }
    }
    case 'navigate': {
      if (!exactKeys(input, ['kind', 'url'])) throw new Error('workbench: invalid browser session control')
      const url = sanitizeWorkbenchBrowserUrl(input.url)
      if (!url) throw new Error('workbench: invalid browser session control')
      return { kind: 'navigate', url }
    }
    case 'capture':
      if (!exactKeys(input, ['kind'])) throw new Error('workbench: invalid browser session control')
      return { kind: 'capture' }
    case 'kill':
      if (!exactKeys(input, ['kind'])) throw new Error('workbench: invalid browser session control')
      return { kind: 'kill' }
    default:
      throw new Error('workbench: invalid browser session control')
  }
}

function truncateProgressText(text: string, maxBytes: number): string {
  if (Buffer.byteLength(text, 'utf8') <= maxBytes) return text
  return Buffer.from(text, 'utf8').subarray(0, maxBytes).toString('utf8')
}

/** Validates a single progress chunk reported by a device worker: `frame` requires `imageUrl`; `status`/`stderr` carry free text. */
export function parseWorkbenchBrowserProgressChunk(value: unknown): WorkbenchBrowserProgressChunk {
  const input = record(value)
  if (!input || !Number.isSafeInteger(input.seq) || Number(input.seq) < 0
    || typeof input.stream !== 'string' || !['frame', 'status', 'stderr'].includes(input.stream)
    || !Number.isSafeInteger(input.atMs) || Number(input.atMs) < 0) {
    throw new Error('workbench: invalid browser progress chunk')
  }
  if (input.imageUrl !== undefined && (typeof input.imageUrl !== 'string' || input.imageUrl.length === 0 || input.imageUrl.length > MAX_URL_LENGTH)) {
    throw new Error('workbench: invalid browser progress chunk')
  }
  if (input.contentType !== undefined && input.contentType !== 'image/jpeg' && input.contentType !== 'image/png') {
    throw new Error('workbench: invalid browser progress chunk')
  }
  if (input.pageUrl !== undefined && (typeof input.pageUrl !== 'string' || input.pageUrl.length > MAX_URL_LENGTH)) {
    throw new Error('workbench: invalid browser progress chunk')
  }
  if (input.title !== undefined && (typeof input.title !== 'string' || input.title.length > MAX_TITLE_LENGTH)) {
    throw new Error('workbench: invalid browser progress chunk')
  }
  if (input.text !== undefined && (typeof input.text !== 'string' || Buffer.byteLength(input.text, 'utf8') > 1_000_000)) {
    throw new Error('workbench: invalid browser progress chunk')
  }
  if (input.stream === 'frame' && !input.imageUrl) throw new Error('workbench: invalid browser progress chunk')
  return {
    seq: Number(input.seq),
    stream: input.stream as WorkbenchBrowserProgressChunk['stream'],
    ...(input.imageUrl ? { imageUrl: input.imageUrl as string } : {}),
    ...(input.contentType ? { contentType: input.contentType as string } : {}),
    ...(input.pageUrl ? { pageUrl: input.pageUrl as string } : {}),
    ...(input.title ? { title: input.title as string } : {}),
    ...(typeof input.text === 'string' ? { text: truncateProgressText(input.text, MAX_PROGRESS_TEXT_BYTES) } : {}),
    atMs: Number(input.atMs),
  }
}

/** Appends a queued control to the FIFO, capped at 64 entries (oldest dropped first). */
export function appendWorkbenchBrowserSessionControl(
  existing: WorkbenchBrowserSessionQueuedControl[] | undefined,
  entry: WorkbenchBrowserSessionQueuedControl,
): WorkbenchBrowserSessionQueuedControl[] {
  const next = [...(existing ?? []), entry]
  return next.length > MAX_PENDING_CONTROLS ? next.slice(next.length - MAX_PENDING_CONTROLS) : next
}

/** Appends a chunk to the in-memory progress ring buffer, capped at 30 entries. */
export function appendWorkbenchBrowserProgressChunk(
  existing: WorkbenchBrowserProgressChunk[] | undefined,
  chunk: WorkbenchBrowserProgressChunk,
): WorkbenchBrowserProgressChunk[] {
  const next = [...(existing ?? []), chunk]
  return next.length > MAX_PROGRESS_CHUNKS ? next.slice(next.length - MAX_PROGRESS_CHUNKS) : next
}

export function publicWorkbenchBrowserSession(session: WorkbenchBrowserSession): PublicWorkbenchBrowserSession {
  return {
    sessionId: session.sessionId,
    status: session.status,
    startUrl: session.startUrl,
    viewport: session.viewport,
    ...(session.progressChunks?.length ? { progress: session.progressChunks } : {}),
    ...(session.currentPageUrl ? { currentPageUrl: session.currentPageUrl } : {}),
    ...(session.currentPageTitle ? { currentPageTitle: session.currentPageTitle } : {}),
    ...(session.error ? { error: session.error } : {}),
    createdAt: new Date(session.createdAtMs).toISOString(),
    updatedAt: new Date(session.updatedAtMs).toISOString(),
    ttlExpiresAt: new Date(session.ttlExpiresAtMs).toISOString(),
    ...(session.approvedAtMs ? { approvedAt: new Date(session.approvedAtMs).toISOString() } : {}),
  }
}

export type WorkbenchBrowserSessionEncryptionPurpose = 'create' | 'control' | 'progress'

/**
 * `create`/`control`/`progress` map 1:1 onto jobs.ts's
 * `operation`/`result`/`progress` purposes purely to get a distinct derived
 * key per field (jobs.ts never reuses a `result` envelope for a browser
 * session, so there is no cross-purpose collision).
 */
function jobsPurpose(purpose: WorkbenchBrowserSessionEncryptionPurpose): 'operation' | 'result' | 'progress' {
  return purpose === 'create' ? 'operation' : purpose === 'control' ? 'result' : 'progress'
}

export function encryptWorkbenchBrowserSessionValue(
  value: unknown,
  deviceId: string,
  sessionId: string,
  purpose: WorkbenchBrowserSessionEncryptionPurpose,
): EncryptedWorkbenchValue {
  return encryptWorkbenchValue(value, deviceId, sessionId, jobsPurpose(purpose))
}

export function decryptWorkbenchBrowserSessionValue<T>(
  value: EncryptedWorkbenchValue,
  deviceId: string,
  sessionId: string,
  purpose: WorkbenchBrowserSessionEncryptionPurpose,
): T {
  return decryptWorkbenchValue<T>(value, deviceId, sessionId, jobsPurpose(purpose))
}

/**
 * Pure state machine mirroring `transitionWorkbenchSession` in `sessions.ts`,
 * with one extra state up front: `awaiting_approval` (create control set,
 * but never enqueued to the device) -> `approve` -> `queued` -> `claimCreate`
 * (device claims the create control, spawning headless Chrome) -> `running`
 * (device confirmed the browser is alive via its first progress call) -> a
 * terminal status. `killQueued` short-circuits a session that was killed
 * before any device ever claimed it (whether still awaiting approval or
 * already approved/queued), since there is no live browser to tear down
 * remotely in either case.
 */
export function transitionWorkbenchBrowserSession(session: WorkbenchBrowserSession, event:
  | { type: 'approve'; approverUserId: string; nowMs: number }
  | { type: 'claimCreate'; deviceId: string; credentialVersion: number; nowMs: number; leaseMs: number }
  | { type: 'progress'; deviceId: string; credentialVersion: number; attempt: number; leaseToken: string; nowMs: number; leaseMs: number }
  | { type: 'killQueued'; nowMs: number }
  | { type: 'complete'; deviceId: string; credentialVersion: number; attempt: number; leaseToken: string; outcome: 'exited' | 'killed' | 'failed'; nowMs: number }
  | { type: 'expire'; nowMs: number }
): WorkbenchBrowserSession {
  if (event.type === 'approve') {
    if (session.status !== 'awaiting_approval') throw new Error('workbench: browser session is not awaiting approval')
    if (event.approverUserId !== session.actorUserId) throw new Error('workbench: browser session approval owner mismatch')
    if (event.nowMs >= session.ttlExpiresAtMs) throw new Error('workbench: browser session expired')
    return { ...session, status: 'queued', approvedByUserId: event.approverUserId, approvedAtMs: event.nowMs, updatedAtMs: event.nowMs }
  }
  if (event.type === 'killQueued') {
    if (session.status !== 'awaiting_approval' && session.status !== 'queued') throw new Error('workbench: browser session already claimed')
    return { ...session, status: 'killed', encryptedCreateControl: null, completedAtMs: event.nowMs, updatedAtMs: event.nowMs }
  }
  if (event.type === 'expire') {
    if (isTerminalWorkbenchBrowserSessionStatus(session.status)) return session
    return {
      ...session, status: 'expired', encryptedCreateControl: null, encryptedControls: null,
      completedAtMs: event.nowMs, updatedAtMs: event.nowMs,
    }
  }
  if (session.deviceId !== event.deviceId) throw new Error('workbench: device mismatch')
  if (session.credentialVersion !== event.credentialVersion) throw new Error('workbench: credential mismatch')
  if (event.type === 'claimCreate') {
    if (session.status !== 'queued') throw new Error('workbench: browser session already claimed')
    if (event.nowMs >= session.ttlExpiresAtMs) throw new Error('workbench: browser session expired')
    return {
      ...session,
      status: 'claimed',
      attempt: session.attempt + 1,
      leaseToken: crypto.randomBytes(24).toString('base64url'),
      claimedAtMs: event.nowMs,
      leaseExpiresAtMs: event.nowMs + event.leaseMs,
      encryptedCreateControl: null,
      updatedAtMs: event.nowMs,
    }
  }
  if (event.type === 'progress') {
    if (session.status !== 'claimed' && session.status !== 'running') throw new Error('workbench: browser session not claimed')
    if (event.attempt !== session.attempt || event.leaseToken !== session.leaseToken) throw new Error('workbench: lease mismatch')
    if ((session.leaseExpiresAtMs ?? 0) < event.nowMs) throw new Error('workbench: lease expired')
    if (event.nowMs >= session.ttlExpiresAtMs) throw new Error('workbench: browser session expired')
    return { ...session, status: 'running', leaseExpiresAtMs: event.nowMs + event.leaseMs, updatedAtMs: event.nowMs }
  }
  // complete
  if (session.status === event.outcome) return session
  if (session.status !== 'claimed' && session.status !== 'running') throw new Error('workbench: browser session not claimed')
  if (event.attempt !== session.attempt || event.leaseToken !== session.leaseToken) throw new Error('workbench: lease mismatch')
  return {
    ...session,
    status: event.outcome,
    encryptedCreateControl: null,
    encryptedControls: null,
    completedAtMs: event.nowMs,
    updatedAtMs: event.nowMs,
  }
}
