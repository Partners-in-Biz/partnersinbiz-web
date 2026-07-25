import * as crypto from 'node:crypto'
import { decryptWorkbenchValue, encryptWorkbenchValue, type EncryptedWorkbenchValue } from './jobs'

/**
 * Phase 4b: outbound public tunnels — a device opens an outbound-only tunnel
 * (cloudflared quick tunnel, currently the only supported provider) from a
 * localhost port on the linked computer to a public HTTPS URL, so the
 * Browser panel can iframe that public URL instead of a `localhost`
 * address the browser's own network stack can never reach. This mirrors the
 * `queued -> claimed -> running -> terminal` interactive-session lifecycle in
 * `sessions.ts`/`session-store.ts`, plus the `awaiting_approval -> queued`
 * gate `jobs.ts` uses for `fs.write` (a tunnel always requires approval,
 * since it briefly exposes a local port to the public internet). Firestore
 * persistence lives in `tunnel-session-store.ts`; the cloudflared process
 * host is `runtime-installers/runtime/workbench-tunnel.ts`.
 *
 * Encryption reuses `encryptWorkbenchValue`/`decryptWorkbenchValue` from
 * `jobs.ts` rather than adding a third envelope-encryption implementation —
 * those helpers only key off `(deviceId, id, purpose)`, so passing this
 * session's id in place of a job id is safe as long as ids never collide
 * across the two collections, which the `wbt_` id prefix guarantees.
 */

const MIN_TUNNEL_PORT = 1024
const MAX_TUNNEL_PORT = 65535
const MAX_PROGRESS_TEXT_BYTES = 2_000
const MAX_PROGRESS_CHUNKS = 32
const MAX_PUBLIC_URL_LENGTH = 512
const MAX_LOCAL_URL_LENGTH = 128

/** Absolute session lifetime — a tunnel is force-expired after this regardless of activity. */
export const WORKBENCH_TUNNEL_TTL_MS = 30 * 60 * 1000
/** Renewable claim/heartbeat lease, matching the interactive session lease in `sessions.ts`. */
export const WORKBENCH_TUNNEL_LEASE_MS = 90_000

export type WorkbenchTunnelStatus =
  | 'awaiting_approval'
  | 'queued'
  | 'claimed'
  | 'running'
  | 'exited'
  | 'killed'
  | 'expired'
  | 'failed'

/** Only `cloudflared` is implemented today; kept as its own union for a future provider. */
export type WorkbenchTunnelProvider = 'cloudflared'

export const WORKBENCH_TUNNEL_DEFAULT_PROVIDER: WorkbenchTunnelProvider = 'cloudflared'
/** Server-forced; a tunnel must never advertise (let alone bind) a non-loopback address. */
export const WORKBENCH_TUNNEL_BIND_HOST = '127.0.0.1' as const

export type WorkbenchTunnelProgressStream = 'tunnel' | 'status' | 'stderr'

/** Progress chunk streamed by a device worker while a tunnel process runs. */
export interface WorkbenchTunnelProgressChunk {
  seq: number
  stream: WorkbenchTunnelProgressStream
  /** Present once the provider has printed its public HTTPS URL (`stream: 'tunnel'`). */
  publicUrl?: string
  /** The local address the tunnel forwards to, e.g. `http://127.0.0.1:5173`. */
  localUrl?: string
  text?: string
  provider?: WorkbenchTunnelProvider
  atMs: number
}

/**
 * Work a device worker consumes from its per-device pending-work queue.
 * `create` is claimed exactly once per tunnel (spawns the provider process);
 * `kill` is delivered once to a device that already owns that tunnel's
 * running process. See `WorkbenchTunnelClaim` in `tunnel-session-store.ts`
 * for the exact claim response envelope.
 */
export type WorkbenchTunnelControl =
  | { kind: 'create'; port: number; bindHost: typeof WORKBENCH_TUNNEL_BIND_HOST; provider: WorkbenchTunnelProvider }
  | { kind: 'kill' }

/** A single not-yet-delivered kill control (a tunnel only ever has one queued control kind). */
export interface WorkbenchTunnelQueuedControl {
  seq: number
  control: Exclude<WorkbenchTunnelControl, { kind: 'create' }>
  actorUserId: string
  enqueuedAtMs: number
}

export interface WorkbenchTunnelSession {
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
  /** Server-bound relative workspace folder; never exposed via `publicWorkbenchTunnelSession`. */
  relativeFolder: string
  port: number
  bindHost: typeof WORKBENCH_TUNNEL_BIND_HOST
  provider: WorkbenchTunnelProvider
  status: WorkbenchTunnelStatus
  attempt: number
  leaseToken?: string
  leaseExpiresAtMs?: number
  claimedAtMs?: number
  approvedByUserId?: string
  approvedAtMs?: number
  publicUrl?: string
  exitCode?: number
  error?: string
  /** Encrypted `{ kind: 'create'; ... }` control; cleared once a device claims it. */
  encryptedCreateControl: EncryptedWorkbenchValue | null
  /** Encrypted, capped FIFO of not-yet-delivered kill controls. */
  encryptedControls?: EncryptedWorkbenchValue | null
  /** Encrypted, capped ring buffer of streamed tunnel/status/stderr chunks. */
  encryptedProgress?: EncryptedWorkbenchValue | null
  /** Decrypted transient values; never persisted by the store. */
  pendingControls?: WorkbenchTunnelQueuedControl[]
  progressChunks?: WorkbenchTunnelProgressChunk[]
  resultFingerprint?: string
  createdAtMs: number
  updatedAtMs: number
  ttlExpiresAtMs: number
  completedAtMs?: number
}

export interface PublicWorkbenchTunnelSession {
  sessionId: string
  status: WorkbenchTunnelStatus
  port: number
  provider: WorkbenchTunnelProvider
  approvalRequired: boolean
  publicUrl?: string
  progress?: WorkbenchTunnelProgressChunk[]
  exitCode?: number
  error?: string
  createdAt: string
  updatedAt: string
  ttlExpiresAt: string
  approvedAt?: string
  completedAt?: string
}

const TERMINAL_TUNNEL_STATUSES: ReadonlySet<WorkbenchTunnelStatus> = new Set(['exited', 'killed', 'expired', 'failed'])

export function isTerminalWorkbenchTunnelStatus(status: WorkbenchTunnelStatus): boolean {
  return TERMINAL_TUNNEL_STATUSES.has(status)
}

export function generateWorkbenchTunnelSessionId(): string {
  return `wbt_${crypto.randomBytes(18).toString('base64url')}`
}

/** Sanitizes the client-requested localhost port: an integer in the 1024..65535 range. */
export function sanitizeWorkbenchTunnelPort(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) return null
  if (value < MIN_TUNNEL_PORT || value > MAX_TUNNEL_PORT) return null
  return value
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
export function parseWorkbenchTunnelControl(value: unknown): WorkbenchTunnelControl {
  const input = record(value)
  if (!input || typeof input.kind !== 'string') throw new Error('workbench: invalid tunnel control')
  switch (input.kind) {
    case 'create': {
      if (!exactKeys(input, ['kind', 'port', 'bindHost', 'provider'])
        || input.bindHost !== WORKBENCH_TUNNEL_BIND_HOST || input.provider !== WORKBENCH_TUNNEL_DEFAULT_PROVIDER) {
        throw new Error('workbench: invalid tunnel control')
      }
      const port = sanitizeWorkbenchTunnelPort(input.port)
      if (port === null) throw new Error('workbench: invalid tunnel control')
      return { kind: 'create', port, bindHost: WORKBENCH_TUNNEL_BIND_HOST, provider: WORKBENCH_TUNNEL_DEFAULT_PROVIDER }
    }
    case 'kill':
      if (!exactKeys(input, ['kind'])) throw new Error('workbench: invalid tunnel control')
      return { kind: 'kill' }
    default:
      throw new Error('workbench: invalid tunnel control')
  }
}

/** Validates a single progress chunk reported by a device worker's tunnel process. */
export function parseWorkbenchTunnelProgressChunk(value: unknown): WorkbenchTunnelProgressChunk {
  const input = record(value)
  if (!input || !Number.isSafeInteger(input.seq) || Number(input.seq) < 0
    || typeof input.stream !== 'string' || !['tunnel', 'status', 'stderr'].includes(input.stream)
    || !Number.isSafeInteger(input.atMs) || Number(input.atMs) < 0) {
    throw new Error('workbench: invalid tunnel progress chunk')
  }
  if (input.publicUrl !== undefined && (typeof input.publicUrl !== 'string'
    || input.publicUrl.length > MAX_PUBLIC_URL_LENGTH || !/^https:\/\/[a-z0-9.-]+(?::\d+)?(?:\/.*)?$/i.test(input.publicUrl))) {
    throw new Error('workbench: invalid tunnel progress chunk')
  }
  if (input.localUrl !== undefined && (typeof input.localUrl !== 'string'
    || input.localUrl.length > MAX_LOCAL_URL_LENGTH || !/^http:\/\/127\.0\.0\.1:\d{1,5}$/.test(input.localUrl))) {
    throw new Error('workbench: invalid tunnel progress chunk')
  }
  if (input.text !== undefined && typeof input.text !== 'string') throw new Error('workbench: invalid tunnel progress chunk')
  if (input.provider !== undefined && input.provider !== WORKBENCH_TUNNEL_DEFAULT_PROVIDER) {
    throw new Error('workbench: invalid tunnel progress chunk')
  }
  const text = typeof input.text === 'string'
    ? Buffer.byteLength(input.text, 'utf8') > MAX_PROGRESS_TEXT_BYTES
      ? Buffer.from(input.text, 'utf8').subarray(0, MAX_PROGRESS_TEXT_BYTES).toString('utf8')
      : input.text
    : undefined
  return {
    seq: Number(input.seq),
    stream: input.stream as WorkbenchTunnelProgressStream,
    ...(typeof input.publicUrl === 'string' ? { publicUrl: input.publicUrl } : {}),
    ...(typeof input.localUrl === 'string' ? { localUrl: input.localUrl } : {}),
    ...(text !== undefined ? { text } : {}),
    ...(input.provider === WORKBENCH_TUNNEL_DEFAULT_PROVIDER ? { provider: input.provider } : {}),
    atMs: Number(input.atMs),
  }
}

/** Appends a chunk to the in-memory progress ring buffer, capped at 32 entries. */
export function appendWorkbenchTunnelProgressChunk(
  existing: WorkbenchTunnelProgressChunk[] | undefined,
  chunk: WorkbenchTunnelProgressChunk,
): WorkbenchTunnelProgressChunk[] {
  const next = [...(existing ?? []), chunk]
  return next.length > MAX_PROGRESS_CHUNKS ? next.slice(next.length - MAX_PROGRESS_CHUNKS) : next
}

/** Appends a queued control to the FIFO, capped at 8 entries (oldest dropped first; only `kill` is ever queued). */
export function appendWorkbenchTunnelControl(
  existing: WorkbenchTunnelQueuedControl[] | undefined,
  entry: WorkbenchTunnelQueuedControl,
): WorkbenchTunnelQueuedControl[] {
  const MAX_PENDING = 8
  const next = [...(existing ?? []), entry]
  return next.length > MAX_PENDING ? next.slice(next.length - MAX_PENDING) : next
}

export type WorkbenchTunnelEncryptionPurpose = 'create' | 'control' | 'progress'

/**
 * Thin, tunnel-namespaced wrapper over `jobs.ts`'s envelope encryption — see
 * the module docstring. `create`/`control`/`progress` map 1:1 onto jobs.ts's
 * `operation`/`result`/`progress` purposes purely to get a distinct derived
 * key per field (jobs.ts never reuses a `result` envelope for a tunnel job,
 * so there is no cross-purpose collision).
 */
function jobsPurpose(purpose: WorkbenchTunnelEncryptionPurpose): 'operation' | 'result' | 'progress' {
  return purpose === 'create' ? 'operation' : purpose === 'control' ? 'result' : 'progress'
}

export function encryptWorkbenchTunnelValue(
  value: unknown,
  deviceId: string,
  sessionId: string,
  purpose: WorkbenchTunnelEncryptionPurpose,
): EncryptedWorkbenchValue {
  return encryptWorkbenchValue(value, deviceId, sessionId, jobsPurpose(purpose))
}

export function decryptWorkbenchTunnelValue<T>(
  value: EncryptedWorkbenchValue,
  deviceId: string,
  sessionId: string,
  purpose: WorkbenchTunnelEncryptionPurpose,
): T {
  return decryptWorkbenchValue<T>(value, deviceId, sessionId, jobsPurpose(purpose))
}

export function publicWorkbenchTunnelSession(session: WorkbenchTunnelSession): PublicWorkbenchTunnelSession {
  return {
    sessionId: session.sessionId,
    status: session.status,
    port: session.port,
    provider: session.provider,
    approvalRequired: session.status === 'awaiting_approval',
    ...(session.publicUrl ? { publicUrl: session.publicUrl } : {}),
    ...(session.progressChunks?.length ? { progress: session.progressChunks } : {}),
    ...(session.exitCode !== undefined ? { exitCode: session.exitCode } : {}),
    ...(session.error ? { error: session.error } : {}),
    createdAt: new Date(session.createdAtMs).toISOString(),
    updatedAt: new Date(session.updatedAtMs).toISOString(),
    ttlExpiresAt: new Date(session.ttlExpiresAtMs).toISOString(),
    ...(session.approvedAtMs ? { approvedAt: new Date(session.approvedAtMs).toISOString() } : {}),
    ...(session.completedAtMs ? { completedAt: new Date(session.completedAtMs).toISOString() } : {}),
  }
}

/**
 * Pure state machine combining `transitionWorkbenchJob`'s `awaiting_approval
 * -> queued` approval gate with `transitionWorkbenchSession`'s
 * `queued -> claimed -> running -> terminal` lifecycle: `tunnel.create`
 * always starts `awaiting_approval` (a tunnel briefly exposes a local port
 * to the public internet, so it is never auto-approved like a plain
 * `shell.exec`/session create); `approve` flips it to `queued` (create
 * control pending); `claimCreate` -> `claimed` (device claimed the create
 * control, spawning the provider process); `progress` -> `running` (device
 * confirmed the process is alive via its first progress call, optionally
 * carrying the resolved public URL); then a terminal status. `killQueued`
 * short-circuits a tunnel that was killed before any device ever claimed it
 * (including while still `awaiting_approval`), since there is no live
 * process to tear down remotely.
 */
export function transitionWorkbenchTunnelSession(session: WorkbenchTunnelSession, event:
  | { type: 'approve'; approverUserId: string; nowMs: number }
  | { type: 'claimCreate'; deviceId: string; credentialVersion: number; nowMs: number; leaseMs: number }
  | { type: 'progress'; deviceId: string; credentialVersion: number; attempt: number; leaseToken: string; nowMs: number; leaseMs: number; publicUrl?: string }
  | { type: 'killQueued'; nowMs: number }
  | { type: 'complete'; deviceId: string; credentialVersion: number; attempt: number; leaseToken: string; outcome: 'exited' | 'killed' | 'failed'; nowMs: number }
  | { type: 'expire'; nowMs: number }
): WorkbenchTunnelSession {
  if (event.type === 'approve') {
    if (session.status !== 'awaiting_approval') throw new Error('workbench: tunnel is not awaiting approval')
    if (event.approverUserId !== session.actorUserId) throw new Error('workbench: tunnel approval owner mismatch')
    if (event.nowMs >= session.ttlExpiresAtMs) throw new Error('workbench: tunnel expired')
    return {
      ...session, status: 'queued', approvedByUserId: event.approverUserId, approvedAtMs: event.nowMs, updatedAtMs: event.nowMs,
    }
  }
  if (event.type === 'killQueued') {
    if (session.status !== 'awaiting_approval' && session.status !== 'queued') throw new Error('workbench: tunnel already claimed')
    return { ...session, status: 'killed', encryptedCreateControl: null, completedAtMs: event.nowMs, updatedAtMs: event.nowMs }
  }
  if (event.type === 'expire') {
    if (isTerminalWorkbenchTunnelStatus(session.status)) return session
    return {
      ...session, status: 'expired', encryptedCreateControl: null, encryptedControls: null,
      completedAtMs: event.nowMs, updatedAtMs: event.nowMs,
    }
  }
  if (session.deviceId !== event.deviceId) throw new Error('workbench: device mismatch')
  if (session.credentialVersion !== event.credentialVersion) throw new Error('workbench: credential mismatch')
  if (event.type === 'claimCreate') {
    if (session.status !== 'queued') throw new Error('workbench: tunnel already claimed')
    if (event.nowMs >= session.ttlExpiresAtMs) throw new Error('workbench: tunnel expired')
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
    if (session.status !== 'claimed' && session.status !== 'running') throw new Error('workbench: tunnel not claimed')
    if (event.attempt !== session.attempt || event.leaseToken !== session.leaseToken) throw new Error('workbench: lease mismatch')
    if ((session.leaseExpiresAtMs ?? 0) < event.nowMs) throw new Error('workbench: lease expired')
    if (event.nowMs >= session.ttlExpiresAtMs) throw new Error('workbench: tunnel expired')
    return {
      ...session,
      status: 'running',
      leaseExpiresAtMs: event.nowMs + event.leaseMs,
      updatedAtMs: event.nowMs,
      ...(event.publicUrl ? { publicUrl: event.publicUrl } : {}),
    }
  }
  // complete
  if (session.status === event.outcome) return session
  if (session.status !== 'claimed' && session.status !== 'running') throw new Error('workbench: tunnel not claimed')
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
