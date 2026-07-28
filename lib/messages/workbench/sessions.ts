import * as crypto from 'node:crypto'
import { sanitizeWorkbenchRelativePath, type EncryptedWorkbenchValue, type WorkbenchJobProgressChunk } from './jobs'

/**
 * Phase 3b: real interactive shell sessions (create -> stream stdout -> stdin
 * -> resize -> kill -> TTL), separate from the allowlisted one-shot
 * `shell.exec` workbench jobs in `jobs.ts` (both coexist). This module only
 * has pure types/helpers — Firestore persistence lives in `session-store.ts`
 * and the actual node-pty runtime host is out of scope here (see the
 * `WorkbenchSessionClaim` union in `session-store.ts` for the exact payload
 * shape the device-side runtime worker should expect over the wire).
 *
 * Every create starts `awaiting_approval` (matching `tunnel-sessions.ts` and
 * `browser-sessions.ts`): an unrestricted interactive shell on the linked
 * computer is strictly more powerful than the allowlisted one-shot
 * `shell.exec` jobs, so it always needs an explicit approval step before the
 * create control is ever enqueued for a device, regardless of actor role.
 */

const ENVELOPE_CONTEXT = 'conversation-workbench-session:v1'
const MAX_STDIN_BYTES = 8_000
const MIN_DIMENSION = 1
const MAX_DIMENSION = 300
const MAX_PENDING_CONTROLS = 64

export const WORKBENCH_SESSION_DEFAULT_COLS = 120
export const WORKBENCH_SESSION_DEFAULT_ROWS = 40
/** Absolute session lifetime — a session is force-expired after this regardless of activity. */
export const WORKBENCH_SESSION_TTL_MS = 30 * 60 * 1000
/** Renewable claim/heartbeat lease, matching the `shell.exec` job lease in `job-store.ts`. */
export const WORKBENCH_SESSION_LEASE_MS = 90_000

export type WorkbenchSessionStatus =
  | 'awaiting_approval'
  | 'queued'
  | 'claimed'
  | 'running'
  | 'exited'
  | 'killed'
  | 'expired'
  | 'failed'
export type WorkbenchSessionShell = 'bash' | 'zsh' | 'sh'
export type WorkbenchSessionStdinMode = 'line' | 'raw'

/**
 * Work a device worker consumes from its per-device pending-work queue.
 * `create` is claimed exactly once per session (spawns the pty); `stdin` /
 * `resize` / `kill` are delivered one at a time to a device that already
 * owns that session's running pty. See `WorkbenchSessionClaim` in
 * `session-store.ts` for the exact claim response envelope (sessionId,
 * attempt, leaseToken, etc.) wrapping one of these controls.
 */
export type WorkbenchSessionControl =
  | { kind: 'create'; cols: number; rows: number; cwd: string; shell: WorkbenchSessionShell }
  | { kind: 'stdin'; data: string; mode: WorkbenchSessionStdinMode }
  | { kind: 'resize'; cols: number; rows: number }
  | { kind: 'kill' }

/** A single not-yet-delivered stdin/resize/kill control, FIFO-ordered by `seq`. */
export interface WorkbenchSessionQueuedControl {
  seq: number
  control: Exclude<WorkbenchSessionControl, { kind: 'create' }>
  actorUserId: string
  enqueuedAtMs: number
}

export interface WorkbenchSession {
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
  /** Stable company-workspace identity; never a host filesystem path. Mirrors workbench jobs. */
  rootBindingId?: string
  /** Server-bound relative workspace folder; never exposed via `publicWorkbenchSession`. */
  relativeFolder: string
  shell: WorkbenchSessionShell
  cols: number
  rows: number
  status: WorkbenchSessionStatus
  attempt: number
  leaseToken?: string
  leaseExpiresAtMs?: number
  claimedAtMs?: number
  approvedByUserId?: string
  approvedAtMs?: number
  exitCode?: number
  error?: string
  /** Encrypted `{ kind: 'create'; ... }` control; cleared once a device claims it. */
  encryptedCreateControl: EncryptedWorkbenchValue | null
  /** Encrypted, capped FIFO of not-yet-delivered stdin/resize/kill controls. */
  encryptedControls?: EncryptedWorkbenchValue | null
  /** Encrypted, capped ring buffer of streamed stdout/stderr/status chunks. */
  encryptedProgress?: EncryptedWorkbenchValue | null
  /** Decrypted transient values; never persisted by the store. */
  pendingControls?: WorkbenchSessionQueuedControl[]
  progressChunks?: WorkbenchJobProgressChunk[]
  resultFingerprint?: string
  createdAtMs: number
  updatedAtMs: number
  ttlExpiresAtMs: number
  completedAtMs?: number
}

export interface PublicWorkbenchSession {
  sessionId: string
  status: WorkbenchSessionStatus
  cols: number
  rows: number
  shell: WorkbenchSessionShell
  approvalRequired: boolean
  progress?: WorkbenchJobProgressChunk[]
  exitCode?: number
  error?: string
  createdAt: string
  updatedAt: string
  ttlExpiresAt: string
  approvedAt?: string
}

const TERMINAL_SESSION_STATUSES: ReadonlySet<WorkbenchSessionStatus> = new Set(['exited', 'killed', 'expired', 'failed'])

export function isTerminalWorkbenchSessionStatus(status: WorkbenchSessionStatus): boolean {
  return TERMINAL_SESSION_STATUSES.has(status)
}

export function generateWorkbenchSessionId(): string {
  return `wbs_${crypto.randomBytes(18).toString('base64url')}`
}

/**
 * Server-chosen shell binary — the client never supplies (and this module
 * never trusts) a shell name or argv[0]. Darwin devices get `zsh` (the
 * platform default since macOS Catalina); everything else gets `bash`.
 */
export function resolveWorkbenchSessionShell(platformHint: string | undefined): WorkbenchSessionShell {
  return platformHint === 'macos' ? 'zsh' : 'bash'
}

function clampDimension(value: number): number {
  return Math.min(MAX_DIMENSION, Math.max(MIN_DIMENSION, Math.trunc(value)))
}

/** Sanitizes optional cols/rows, defaulting to 120x40 and clamping to 1..300. */
export function sanitizeWorkbenchSessionDimensions(
  cols: unknown,
  rows: unknown,
): { cols: number; rows: number } | null {
  if (cols !== undefined && (typeof cols !== 'number' || !Number.isFinite(cols))) return null
  if (rows !== undefined && (typeof rows !== 'number' || !Number.isFinite(rows))) return null
  return {
    cols: cols === undefined ? WORKBENCH_SESSION_DEFAULT_COLS : clampDimension(cols),
    rows: rows === undefined ? WORKBENCH_SESSION_DEFAULT_ROWS : clampDimension(rows),
  }
}

/** Sanitizes an optional relative `cwd`, defaulting to the bound workspace root. */
export function sanitizeWorkbenchSessionCwd(cwd: unknown): string | null {
  if (cwd === undefined) return '.'
  if (typeof cwd !== 'string') return null
  return sanitizeWorkbenchRelativePath(cwd, { allowRoot: true })
}

/** Sanitizes stdin: non-empty, max 8KB, rejects null bytes, defaults mode to `line`. */
export function sanitizeWorkbenchSessionStdin(
  data: unknown,
  mode: unknown,
): { data: string; mode: WorkbenchSessionStdinMode } | null {
  if (typeof data !== 'string' || data.length === 0 || Buffer.byteLength(data, 'utf8') > MAX_STDIN_BYTES) return null
  if (data.includes('\u0000')) return null
  if (mode !== undefined && mode !== 'line' && mode !== 'raw') return null
  return { data, mode: mode === 'raw' ? 'raw' : 'line' }
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
export function parseWorkbenchSessionControl(value: unknown): WorkbenchSessionControl {
  const input = record(value)
  if (!input || typeof input.kind !== 'string') throw new Error('workbench: invalid session control')
  switch (input.kind) {
    case 'create': {
      if (!exactKeys(input, ['kind', 'cols', 'rows', 'cwd', 'shell'])
        || typeof input.cwd !== 'string' || !['bash', 'zsh', 'sh'].includes(String(input.shell))) {
        throw new Error('workbench: invalid session control')
      }
      const dims = sanitizeWorkbenchSessionDimensions(input.cols, input.rows)
      const cwd = sanitizeWorkbenchSessionCwd(input.cwd)
      if (!dims || cwd === null) throw new Error('workbench: invalid session control')
      return { kind: 'create', cols: dims.cols, rows: dims.rows, cwd, shell: input.shell as WorkbenchSessionShell }
    }
    case 'stdin': {
      if (!exactKeys(input, ['kind', 'data', 'mode'])) throw new Error('workbench: invalid session control')
      const stdin = sanitizeWorkbenchSessionStdin(input.data, input.mode)
      if (!stdin) throw new Error('workbench: invalid session control')
      return { kind: 'stdin', ...stdin }
    }
    case 'resize': {
      if (!exactKeys(input, ['kind', 'cols', 'rows'])) throw new Error('workbench: invalid session control')
      const dims = sanitizeWorkbenchSessionDimensions(input.cols, input.rows)
      if (!dims || input.cols === undefined || input.rows === undefined) throw new Error('workbench: invalid session control')
      return { kind: 'resize', ...dims }
    }
    case 'kill':
      if (!exactKeys(input, ['kind'])) throw new Error('workbench: invalid session control')
      return { kind: 'kill' }
    default:
      throw new Error('workbench: invalid session control')
  }
}

function masterKey(): Buffer {
  const value = process.env.SOCIAL_TOKEN_MASTER_KEY?.trim()
  if (!value) throw new Error('Missing env var: SOCIAL_TOKEN_MASTER_KEY')
  return value.length === 64 && /^[0-9a-f]+$/i.test(value)
    ? Buffer.from(value, 'hex')
    : crypto.createHash('sha256').update(value).digest()
}

export type WorkbenchSessionEncryptionPurpose = 'create' | 'control' | 'progress'

function envelopeKey(deviceId: string, sessionId: string, purpose: WorkbenchSessionEncryptionPurpose): Buffer {
  return crypto.createHmac('sha256', masterKey()).update(`${ENVELOPE_CONTEXT}:${deviceId}:${sessionId}:${purpose}`).digest()
}

/** Same envelope-encryption pattern as `encryptWorkbenchValue` in `jobs.ts`, namespaced for sessions. */
export function encryptWorkbenchSessionValue(
  value: unknown,
  deviceId: string,
  sessionId: string,
  purpose: WorkbenchSessionEncryptionPurpose,
): EncryptedWorkbenchValue {
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', envelopeKey(deviceId, sessionId, purpose), iv)
  cipher.setAAD(Buffer.from(`${deviceId}\n${sessionId}\n${purpose}`))
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()])
  return { ciphertext: ciphertext.toString('base64'), iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64') }
}

export function decryptWorkbenchSessionValue<T>(
  value: EncryptedWorkbenchValue,
  deviceId: string,
  sessionId: string,
  purpose: WorkbenchSessionEncryptionPurpose,
): T {
  const decipher = crypto.createDecipheriv('aes-256-gcm', envelopeKey(deviceId, sessionId, purpose), Buffer.from(value.iv, 'base64'))
  decipher.setAAD(Buffer.from(`${deviceId}\n${sessionId}\n${purpose}`))
  decipher.setAuthTag(Buffer.from(value.tag, 'base64'))
  return JSON.parse(Buffer.concat([decipher.update(Buffer.from(value.ciphertext, 'base64')), decipher.final()]).toString('utf8')) as T
}

/** Appends a queued control to the FIFO, capped at 64 entries (oldest dropped first). */
export function appendWorkbenchSessionControl(
  existing: WorkbenchSessionQueuedControl[] | undefined,
  entry: WorkbenchSessionQueuedControl,
): WorkbenchSessionQueuedControl[] {
  const next = [...(existing ?? []), entry]
  return next.length > MAX_PENDING_CONTROLS ? next.slice(next.length - MAX_PENDING_CONTROLS) : next
}

export function publicWorkbenchSession(session: WorkbenchSession): PublicWorkbenchSession {
  return {
    sessionId: session.sessionId,
    status: session.status,
    cols: session.cols,
    rows: session.rows,
    shell: session.shell,
    approvalRequired: session.status === 'awaiting_approval',
    ...(session.progressChunks?.length ? { progress: session.progressChunks } : {}),
    ...(session.exitCode !== undefined ? { exitCode: session.exitCode } : {}),
    ...(session.error ? { error: session.error } : {}),
    createdAt: new Date(session.createdAtMs).toISOString(),
    updatedAt: new Date(session.updatedAtMs).toISOString(),
    ttlExpiresAt: new Date(session.ttlExpiresAtMs).toISOString(),
    ...(session.approvedAtMs ? { approvedAt: new Date(session.approvedAtMs).toISOString() } : {}),
  }
}

/**
 * Pure state machine mirroring `transitionWorkbenchJob` in `jobs.ts`, adapted
 * for a session's longer-lived pty lifecycle: `awaiting_approval` (create
 * control set, but never enqueued to the device) -> `approve` -> `queued`
 * -> `claimed` (device claimed the create control, spawning the pty) ->
 * `running` (device confirmed the pty is alive via its first progress call)
 * -> a terminal status. `resize` is applied optimistically (before device
 * delivery) so the public view reflects intent immediately; `killQueued`
 * short-circuits a session that was killed before any device ever claimed
 * it (whether still awaiting approval or already approved/queued), since
 * there is no live pty to tear down remotely in either case.
 */
export function transitionWorkbenchSession(session: WorkbenchSession, event:
  | { type: 'approve'; approverUserId: string; nowMs: number }
  | { type: 'claimCreate'; deviceId: string; credentialVersion: number; nowMs: number; leaseMs: number }
  | { type: 'progress'; deviceId: string; credentialVersion: number; attempt: number; leaseToken: string; nowMs: number; leaseMs: number }
  | { type: 'resize'; cols: number; rows: number; nowMs: number }
  | { type: 'killQueued'; nowMs: number }
  | { type: 'complete'; deviceId: string; credentialVersion: number; attempt: number; leaseToken: string; outcome: 'exited' | 'killed' | 'failed'; nowMs: number }
  | { type: 'expire'; nowMs: number }
): WorkbenchSession {
  if (event.type === 'approve') {
    if (session.status !== 'awaiting_approval') throw new Error('workbench: session is not awaiting approval')
    if (event.approverUserId !== session.actorUserId) throw new Error('workbench: session approval owner mismatch')
    if (event.nowMs >= session.ttlExpiresAtMs) throw new Error('workbench: session expired')
    return { ...session, status: 'queued', approvedByUserId: event.approverUserId, approvedAtMs: event.nowMs, updatedAtMs: event.nowMs }
  }
  if (event.type === 'resize') {
    if (isTerminalWorkbenchSessionStatus(session.status)) throw new Error('workbench: session already final')
    return { ...session, cols: event.cols, rows: event.rows, updatedAtMs: event.nowMs }
  }
  if (event.type === 'killQueued') {
    if (session.status !== 'awaiting_approval' && session.status !== 'queued') throw new Error('workbench: session already claimed')
    return { ...session, status: 'killed', encryptedCreateControl: null, completedAtMs: event.nowMs, updatedAtMs: event.nowMs }
  }
  if (event.type === 'expire') {
    if (isTerminalWorkbenchSessionStatus(session.status)) return session
    return {
      ...session, status: 'expired', encryptedCreateControl: null, encryptedControls: null,
      completedAtMs: event.nowMs, updatedAtMs: event.nowMs,
    }
  }
  if (session.deviceId !== event.deviceId) throw new Error('workbench: device mismatch')
  if (session.credentialVersion !== event.credentialVersion) throw new Error('workbench: credential mismatch')
  if (event.type === 'claimCreate') {
    if (session.status !== 'queued') throw new Error('workbench: session already claimed')
    if (event.nowMs >= session.ttlExpiresAtMs) throw new Error('workbench: session expired')
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
    if (session.status !== 'claimed' && session.status !== 'running') throw new Error('workbench: session not claimed')
    if (event.attempt !== session.attempt || event.leaseToken !== session.leaseToken) throw new Error('workbench: lease mismatch')
    if ((session.leaseExpiresAtMs ?? 0) < event.nowMs) throw new Error('workbench: lease expired')
    if (event.nowMs >= session.ttlExpiresAtMs) throw new Error('workbench: session expired')
    return { ...session, status: 'running', leaseExpiresAtMs: event.nowMs + event.leaseMs, updatedAtMs: event.nowMs }
  }
  // complete
  if (session.status === event.outcome) return session
  if (session.status !== 'claimed' && session.status !== 'running') throw new Error('workbench: session not claimed')
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
