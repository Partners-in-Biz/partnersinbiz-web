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
/** Accessibility-tree snapshot text cap — matches Hermes' browser_snapshot budget; the agent reads the page as text. */
const MAX_SNAPSHOT_AX_CHARS = 12_000
const MAX_SNAPSHOT_REFS = 400
const MAX_SNAPSHOT_FRAMES = 50
/** Snapshot chunks embed a short console tail so the agent sees recent errors in one call; full ring via the console stream. */
const MAX_SNAPSHOT_CONSOLE_ENTRIES = 8
const MAX_CONSOLE_ENTRIES = 50
const MAX_CONSOLE_ENTRY_CHARS = 300
const MAX_CLICK_REF_LENGTH = 32
const MAX_DIALOG_PROMPT_TEXT_LENGTH = 1_000

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
  | { kind: 'click_ref'; ref: string }
  | { kind: 'type'; text: string }
  | { kind: 'press'; key: WorkbenchBrowserKey }
  | { kind: 'scroll'; x: number; y: number; deltaX?: number; deltaY: number }
  | { kind: 'snapshot' }
  | { kind: 'console' }
  | { kind: 'dialog'; accept: boolean; promptText?: string }
  | { kind: 'follow_start'; intervalMs?: number }
  | { kind: 'follow_stop' }
  | { kind: 'kill' }

/**
 * Who enqueued a control: the human in Messages (`user`) or an agent
 * (`agent`, signalled via the `X-Agent-Actor` header on API calls). Drives
 * both the private-network guard and slice-2 driver arbitration — the user
 * and the agent must never click/type the same live page at the same time.
 */
export type WorkbenchBrowserActorKind = 'user' | 'agent'

/** A single browser-originated console message captured by the CDP supervisor. */
export interface WorkbenchBrowserConsoleEntry {
  level: string
  text: string
  url?: string
  line?: number
}

/** Accessibility-tree snapshot payload produced by the device's `snapshot` control. */
export interface WorkbenchBrowserSnapshotPayload {
  url?: string
  title?: string
  /** Text rendering of the page's accessibility tree with stable refs (@e1, @e2…) — the agent reads the page as text. */
  ax: string
  /** @eN -> backend DOM node id + label, used to resolve click_ref controls to real coordinates. */
  refs: Record<string, { backendDOMNodeId?: number; role?: string; name?: string }>
  pendingDialog?: { type?: string; message?: string } | null
  frames?: Array<{ frameId: string; parentId?: string | null; url?: string; name?: string }>
  console?: WorkbenchBrowserConsoleEntry[]
}

/** A single not-yet-delivered control, FIFO-ordered by `seq`. */
export interface WorkbenchBrowserSessionQueuedControl {
  seq: number
  control: Exclude<WorkbenchBrowserSessionControl, { kind: 'create' }>
  actorUserId: string
  actorKind: WorkbenchBrowserActorKind
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
  /** Who created the session: the human in Messages or an agent (via X-Agent-Actor). */
  initiator: WorkbenchBrowserActorKind
  /** Last actor to drive the page (navigate/click/type/…); 'idle' until the first driving control. */
  driver: WorkbenchBrowserActorKind | 'idle'
  driverSinceMs?: number
  /**
   * When true, agent navigation/interaction may target private/internal
   * hosts (e.g. the user's own dev server). Default false for agent-created
   * sessions; default true for user-created sessions so the existing
   * localhost dev-preview flow keeps working. The human can flip it with the
   * allow-private route — an agent can never self-grant.
   */
  allowPrivateNetwork: boolean
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
  stream: 'frame' | 'status' | 'stderr' | 'snapshot' | 'console'
  imageUrl?: string
  contentType?: string
  pageUrl?: string
  title?: string
  text?: string
  /** `stream === 'snapshot'`: accessibility-tree payload (see WorkbenchBrowserSnapshotPayload). */
  snapshot?: WorkbenchBrowserSnapshotPayload | null
  /** `stream === 'console'`: console ring tail. */
  entries?: WorkbenchBrowserConsoleEntry[] | null
  atMs: number
}

export interface PublicWorkbenchBrowserSession {
  sessionId: string
  status: WorkbenchBrowserSessionStatus
  startUrl: string | null
  viewport: WorkbenchBrowserViewport
  initiator: WorkbenchBrowserActorKind
  driver: WorkbenchBrowserActorKind | 'idle'
  allowPrivateNetwork: boolean
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

/** Validates a dialog response: `accept` must be a boolean; `promptText` optional, bounded, and text-safe. */
export function sanitizeWorkbenchBrowserDialog(value: unknown): { accept: boolean; promptText?: string } | null {
  const input = record(value)
  if (!input || typeof input.accept !== 'boolean') return null
  if (input.promptText === undefined) return { accept: input.accept }
  if (typeof input.promptText !== 'string' || input.promptText.length > MAX_DIALOG_PROMPT_TEXT_LENGTH) return null
  if (/[\u0000-\u0008\u000B-\u001F\u007F]/.test(input.promptText)) return null
  return { accept: input.accept, promptText: input.promptText }
}

/** Validates a click-by-ref target: a short @eN-style ref (allowlist of [A-Za-z0-9_-], no slashes or dots). */
export function sanitizeWorkbenchBrowserClickRef(value: unknown): string | null {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_CLICK_REF_LENGTH) return null
  if (!/^@?[A-Za-z0-9_-]+$/.test(value)) return null
  return value.startsWith('@') ? value : `@${value}`
}

/**
 * True when a URL targets a private/internal host — localhost, .local,
 * RFC1918 ranges, link-local, CGNAT, loopback, multicast, etc. Mirrors the
 * observer panel's `privateHostname` guard in WorkbenchBrowserPanel.tsx.
 * Used by the agent private-network guard: an agent may not navigate or
 * click inside a private network unless the human allowed it.
 */
export function isPrivateWorkbenchBrowserUrl(value: string): boolean {
  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    return true
  }
  const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '')
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host === '::' || host === '::1' || host === '0.0.0.0') return true
  // Literal IPv6 addresses are conservatively treated as private.
  if (host.includes(':')) return true
  const ipv4 = host.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/)?.slice(1).map(Number)
  if (!ipv4) return false
  const [a, b, c] = ipv4
  return a === 0
    || a === 10
    || a === 127
    || (a === 100 && b >= 64 && b <= 127)
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 0 && (c === 0 || c === 2))
    || (a === 192 && b === 168)
    || (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100)))
    || (a === 203 && b === 0 && c === 113)
    || a >= 224
}

/** Controls that visibly drive the page — subject to driver arbitration. */
export function isWorkbenchBrowserDrivingControl(control: Exclude<WorkbenchBrowserSessionControl, { kind: 'create' }>): boolean {
  return control.kind === 'navigate'
    || control.kind === 'click'
    || control.kind === 'click_ref'
    || control.kind === 'type'
    || control.kind === 'press'
    || control.kind === 'scroll'
    || control.kind === 'dialog'
}

/**
 * Resolves the acting side from the `X-Agent-Actor` header. UI calls from
 * Messages never send it -> 'user'. The agent skill always sends it -> 'agent'.
 * Any non-empty value counts; the value is the agent id (never trusted as an
 * identity claim — authorization still comes from the delegation token).
 */
export function workbenchBrowserActorKindFromHeader(header: string | null | undefined): WorkbenchBrowserActorKind | undefined {
  return header && header.trim().length > 0 ? 'agent' : undefined
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
    case 'click_ref': {
      if (!exactKeys(input, ['kind', 'ref'])) throw new Error('workbench: invalid browser session control')
      const ref = sanitizeWorkbenchBrowserClickRef(input.ref)
      if (!ref) throw new Error('workbench: invalid browser session control')
      return { kind: 'click_ref', ref }
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
    case 'snapshot':
      if (!exactKeys(input, ['kind'])) throw new Error('workbench: invalid browser session control')
      return { kind: 'snapshot' }
    case 'console':
      if (!exactKeys(input, ['kind'])) throw new Error('workbench: invalid browser session control')
      return { kind: 'console' }
    case 'dialog': {
      if (!exactKeys(input, ['kind', 'accept', 'promptText'])) throw new Error('workbench: invalid browser session control')
      const dialog = sanitizeWorkbenchBrowserDialog({ accept: input.accept, promptText: input.promptText })
      if (!dialog) throw new Error('workbench: invalid browser session control')
      return { kind: 'dialog', ...dialog }
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
    || typeof input.stream !== 'string' || !['frame', 'status', 'stderr', 'snapshot', 'console'].includes(input.stream)
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
  if (input.stream === 'snapshot') {
    if (input.snapshot === undefined || !parseWorkbenchBrowserSnapshotPayload(input.snapshot)) {
      throw new Error('workbench: invalid browser progress chunk')
    }
  }
  if (input.stream === 'console') {
    if (input.entries === undefined || !Array.isArray(input.entries) || !input.entries.every(parseWorkbenchBrowserConsoleEntry)) {
      throw new Error('workbench: invalid browser progress chunk')
    }
  }
  return {
    seq: Number(input.seq),
    stream: input.stream as WorkbenchBrowserProgressChunk['stream'],
    ...(input.imageUrl ? { imageUrl: input.imageUrl as string } : {}),
    ...(input.contentType ? { contentType: input.contentType as string } : {}),
    ...(input.pageUrl ? { pageUrl: input.pageUrl as string } : {}),
    ...(input.title ? { title: input.title as string } : {}),
    ...(typeof input.text === 'string' ? { text: truncateProgressText(input.text, MAX_PROGRESS_TEXT_BYTES) } : {}),
    ...(input.snapshot ? { snapshot: input.snapshot as WorkbenchBrowserSnapshotPayload } : {}),
    ...(input.entries ? { entries: input.entries as WorkbenchBrowserConsoleEntry[] } : {}),
    atMs: Number(input.atMs),
  }
}

/** Validates a console entry: bounded text, optional url/line, level is a short string. */
function parseWorkbenchBrowserConsoleEntry(value: unknown): value is WorkbenchBrowserConsoleEntry {
  const entry = record(value)
  if (!entry || typeof entry.text !== 'string' || entry.text.length > MAX_CONSOLE_ENTRY_CHARS) return false
  if (typeof entry.level !== 'string' || entry.level.length > 64) return false
  if (entry.url !== undefined && (typeof entry.url !== 'string' || entry.url.length > MAX_URL_LENGTH)) return false
  if (entry.line !== undefined && (typeof entry.line !== 'number' || !Number.isSafeInteger(entry.line) || entry.line < 0)) return false
  return true
}

/** Validates a snapshot payload: bounded ax text, ref map, frame list, console tail. */
function parseWorkbenchBrowserSnapshotPayload(value: unknown): value is WorkbenchBrowserSnapshotPayload {
  const payload = record(value)
  if (!payload || typeof payload.ax !== 'string' || payload.ax.length > MAX_SNAPSHOT_AX_CHARS) return false
  if (payload.url !== undefined && (typeof payload.url !== 'string' || payload.url.length > MAX_URL_LENGTH)) return false
  if (payload.title !== undefined && (typeof payload.title !== 'string' || payload.title.length > MAX_TITLE_LENGTH)) return false
  if (payload.refs !== undefined) {
    if (!record(payload.refs)) return false
    const refs = payload.refs as Record<string, unknown>
    const refKeys = Object.keys(refs)
    if (refKeys.length > MAX_SNAPSHOT_REFS) return false
    for (const key of refKeys) {
      if (key.length === 0 || key.length > MAX_CLICK_REF_LENGTH || !/^@?[A-Za-z0-9_-]+$/.test(key)) return false
      const ref = record(refs[key])
      if (!ref) return false
      if (ref.backendDOMNodeId !== undefined && (typeof ref.backendDOMNodeId !== 'number' || !Number.isSafeInteger(ref.backendDOMNodeId))) return false
      if (ref.role !== undefined && (typeof ref.role !== 'string' || ref.role.length > 128)) return false
      if (ref.name !== undefined && (typeof ref.name !== 'string' || ref.name.length > 500)) return false
    }
  }
  if (payload.pendingDialog !== undefined && payload.pendingDialog !== null) {
    const dialog = record(payload.pendingDialog)
    if (!dialog) return false
    if (dialog.type !== undefined && (typeof dialog.type !== 'string' || dialog.type.length > 64)) return false
    if (dialog.message !== undefined && (typeof dialog.message !== 'string' || dialog.message.length > 1_000)) return false
  }
  if (payload.frames !== undefined) {
    if (!Array.isArray(payload.frames) || payload.frames.length > MAX_SNAPSHOT_FRAMES) return false
    for (const frame of payload.frames) {
      const row = record(frame)
      if (!row || typeof row.frameId !== 'string' || row.frameId.length === 0 || row.frameId.length > 256) return false
      if (row.parentId !== undefined && row.parentId !== null && (typeof row.parentId !== 'string' || row.parentId.length > 256)) return false
      if (row.url !== undefined && (typeof row.url !== 'string' || row.url.length > MAX_URL_LENGTH)) return false
      if (row.name !== undefined && (typeof row.name !== 'string' || row.name.length > 500)) return false
    }
  }
  if (payload.console !== undefined) {
    if (!Array.isArray(payload.console) || payload.console.length > MAX_SNAPSHOT_CONSOLE_ENTRIES) return false
    if (!payload.console.every(parseWorkbenchBrowserConsoleEntry)) return false
  }
  return true
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
    initiator: session.initiator,
    driver: session.driver,
    allowPrivateNetwork: session.allowPrivateNetwork,
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
