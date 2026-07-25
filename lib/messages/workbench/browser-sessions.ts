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

const MAX_TYPE_TEXT_LENGTH = 2_000
/** Generous ceiling on a single wheel event; anything larger is a caller bug, not a scroll. */
const MAX_SCROLL_DELTA = 100_000
const MIN_FOLLOW_INTERVAL_MS = 500
const MAX_FOLLOW_INTERVAL_MS = 5_000

export const WORKBENCH_BROWSER_DEFAULT_FOLLOW_INTERVAL_MS = 1_000

export type WorkbenchBrowserMouseButton = 'left' | 'right' | 'middle'
const MOUSE_BUTTONS: ReadonlySet<string> = new Set<WorkbenchBrowserMouseButton>(['left', 'right', 'middle'])

/**
 * Keys a caller may press. Deliberately an allowlist of navigation/editing
 * keys with no modifier combinations: printable characters go through
 * `type` (CDP `Input.insertText`), and a chord like Cmd+Q or Ctrl+Shift+I
 * would let a caller drive Chrome's own UI rather than the page.
 */
export const WORKBENCH_BROWSER_ALLOWED_KEYS = [
  'Enter', 'Escape', 'Tab', 'Backspace', 'Delete',
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
  'Home', 'End', 'PageUp', 'PageDown',
] as const

export type WorkbenchBrowserKey = typeof WORKBENCH_BROWSER_ALLOWED_KEYS[number]
const ALLOWED_KEYS: ReadonlySet<string> = new Set<string>(WORKBENCH_BROWSER_ALLOWED_KEYS)

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
 * connects over CDP); every other control is delivered one at a time to a
 * device that already owns that session's running browser. See
 * `WorkbenchBrowserSessionClaim` in `browser-session-store.ts` for the exact
 * claim response envelope (sessionId, attempt, leaseToken, etc.) wrapping
 * one of these controls.
 *
 * Phase 5 adds interaction (`click`/`type`/`press`/`scroll`) and a
 * device-side capture loop (`follow_start`/`follow_stop`). Interaction
 * coordinates are CSS pixels in the session viewport with the origin at the
 * top-left, matching what the Browser panel's frame `<img>` reports for a
 * click, so the panel can forward a click position unchanged.
 * `parseWorkbenchBrowserSessionControl` resolves the optional fields
 * (`button`, `deltaX`, `intervalMs`) to concrete defaults, so a device never
 * has to guess.
 */
export type WorkbenchBrowserSessionControl =
  | { kind: 'create'; startUrl: string | null; viewport: WorkbenchBrowserViewport }
  | { kind: 'navigate'; url: string }
  | { kind: 'capture' }
  | { kind: 'click'; x: number; y: number; button?: WorkbenchBrowserMouseButton }
  | { kind: 'type'; text: string }
  | { kind: 'press'; key: WorkbenchBrowserKey }
  | { kind: 'scroll'; x: number; y: number; deltaX?: number; deltaY: number }
  | { kind: 'follow_start'; intervalMs?: number }
  | { kind: 'follow_stop' }
  | { kind: 'kill' }

/** A single not-yet-delivered control, FIFO-ordered by `seq`. */
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

/**
 * Validates an interaction point in viewport CSS pixels. Out-of-range
 * coordinates are rejected rather than clamped: a click 4000px to the right
 * of a 1280px-wide viewport is a caller bug, and silently retargeting it to
 * the viewport edge would click something the caller never asked for. The
 * bound is the maximum *allowed* viewport (1920x1200) rather than this
 * session's own size, which this module does not know here — the device
 * clamps to its real viewport when dispatching.
 */
export function sanitizeWorkbenchBrowserPoint(x: unknown, y: unknown): { x: number; y: number } | null {
  if (typeof x !== 'number' || !Number.isFinite(x) || typeof y !== 'number' || !Number.isFinite(y)) return null
  const pointX = Math.trunc(x)
  const pointY = Math.trunc(y)
  if (pointX < 0 || pointX > MAX_VIEWPORT_WIDTH || pointY < 0 || pointY > MAX_VIEWPORT_HEIGHT) return null
  return { x: pointX, y: pointY }
}

/** Defaults an omitted mouse button to `left`; rejects anything outside left/right/middle. */
export function sanitizeWorkbenchBrowserMouseButton(value: unknown): WorkbenchBrowserMouseButton | null {
  if (value === undefined) return 'left'
  if (typeof value !== 'string' || !MOUSE_BUTTONS.has(value)) return null
  return value as WorkbenchBrowserMouseButton
}

function sanitizeScrollDelta(value: unknown, whenOmitted: number | null): number | null {
  if (value === undefined) return whenOmitted
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  const delta = Math.trunc(value)
  return Math.abs(delta) > MAX_SCROLL_DELTA ? null : delta
}

/** Validates a wheel delta pair: `deltaY` is required, `deltaX` defaults to 0 (vertical-only scroll). */
export function sanitizeWorkbenchBrowserScrollDeltas(deltaX: unknown, deltaY: unknown): { deltaX: number; deltaY: number } | null {
  const resolvedX = sanitizeScrollDelta(deltaX, 0)
  const resolvedY = sanitizeScrollDelta(deltaY, null)
  if (resolvedX === null || resolvedY === null) return null
  return { deltaX: resolvedX, deltaY: resolvedY }
}

/**
 * Validates text for `Input.insertText`. Tab and newline are kept (they are
 * meaningful inside a textarea), but every other C0/DEL control character is
 * rejected so a caller cannot smuggle terminal escapes through a field that
 * ends up echoed in progress text or logs.
 */
export function sanitizeWorkbenchBrowserTypeText(value: unknown): string | null {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_TYPE_TEXT_LENGTH) return null
  if (/[\u0000-\u0008\u000B-\u001F\u007F]/.test(value)) return null
  return value
}

/** Validates a key against `WORKBENCH_BROWSER_ALLOWED_KEYS`. */
export function sanitizeWorkbenchBrowserKey(value: unknown): WorkbenchBrowserKey | null {
  if (typeof value !== 'string' || !ALLOWED_KEYS.has(value)) return null
  return value as WorkbenchBrowserKey
}

/** Clamps a follow-loop interval into 500-5000ms, defaulting to 1000ms when omitted. */
export function sanitizeWorkbenchBrowserFollowIntervalMs(value: unknown): number | null {
  if (value === undefined) return WORKBENCH_BROWSER_DEFAULT_FOLLOW_INTERVAL_MS
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  return clamp(value, MIN_FOLLOW_INTERVAL_MS, MAX_FOLLOW_INTERVAL_MS)
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
    case 'click': {
      if (!exactKeys(input, ['kind', 'x', 'y', 'button'])) throw new Error('workbench: invalid browser session control')
      const point = sanitizeWorkbenchBrowserPoint(input.x, input.y)
      const button = sanitizeWorkbenchBrowserMouseButton(input.button)
      if (!point || !button) throw new Error('workbench: invalid browser session control')
      return { kind: 'click', ...point, button }
    }
    case 'type': {
      if (!exactKeys(input, ['kind', 'text'])) throw new Error('workbench: invalid browser session control')
      const text = sanitizeWorkbenchBrowserTypeText(input.text)
      if (text === null) throw new Error('workbench: invalid browser session control')
      return { kind: 'type', text }
    }
    case 'press': {
      if (!exactKeys(input, ['kind', 'key'])) throw new Error('workbench: invalid browser session control')
      const key = sanitizeWorkbenchBrowserKey(input.key)
      if (!key) throw new Error('workbench: invalid browser session control')
      return { kind: 'press', key }
    }
    case 'scroll': {
      if (!exactKeys(input, ['kind', 'x', 'y', 'deltaX', 'deltaY'])) throw new Error('workbench: invalid browser session control')
      const point = sanitizeWorkbenchBrowserPoint(input.x, input.y)
      const deltas = sanitizeWorkbenchBrowserScrollDeltas(input.deltaX, input.deltaY)
      if (!point || !deltas) throw new Error('workbench: invalid browser session control')
      return { kind: 'scroll', ...point, ...deltas }
    }
    case 'follow_start': {
      if (!exactKeys(input, ['kind', 'intervalMs'])) throw new Error('workbench: invalid browser session control')
      const intervalMs = sanitizeWorkbenchBrowserFollowIntervalMs(input.intervalMs)
      if (intervalMs === null) throw new Error('workbench: invalid browser session control')
      return { kind: 'follow_start', intervalMs }
    }
    case 'follow_stop':
      if (!exactKeys(input, ['kind'])) throw new Error('workbench: invalid browser session control')
      return { kind: 'follow_stop' }
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
