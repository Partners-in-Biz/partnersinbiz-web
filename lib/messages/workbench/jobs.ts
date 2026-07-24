import crypto from 'node:crypto'

const ENVELOPE_CONTEXT = 'conversation-workbench-job:v1'
const MAX_PATH_LENGTH = 512
const MAX_WRITE_BYTES = 1_000_000
const MAX_RESULT_BYTES = 2_000_000

export type WorkbenchJobKind = 'fs.list' | 'fs.read' | 'fs.write' | 'git.status' | 'git.diff'
export type WorkbenchJobStatus =
  | 'awaiting_approval'
  | 'queued'
  | 'claimed'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'expired'

export type WorkbenchOperation =
  | { kind: 'fs.list'; path: string }
  | { kind: 'fs.read'; path: string }
  | { kind: 'fs.write'; path: string; content: string; expectedSha256?: string }
  | { kind: 'git.status' }
  | { kind: 'git.diff'; path?: string; staged?: boolean }

export type WorkbenchResult =
  | { entries: Array<{ path: string; type: 'file' | 'directory'; size?: number }> }
  | { content: string; sha256?: string; truncated?: boolean }
  | { bytesWritten: number; sha256: string }
  | { branch?: string; changes: Array<{ path: string; status: string }> }
  | { diff: string; truncated?: boolean }
  | Record<string, unknown>

export interface EncryptedWorkbenchValue {
  ciphertext: string
  iv: string
  tag: string
}

export interface WorkbenchJob {
  jobId: string
  idempotencyKey: string
  requestFingerprint: string
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
  relativeFolder: string
  kind: WorkbenchJobKind
  status: WorkbenchJobStatus
  attempt: number
  leaseToken?: string
  leaseExpiresAtMs?: number
  claimedAtMs?: number
  approvedByUserId?: string
  approvedAtMs?: number
  completedAtMs?: number
  encryptedOperation: EncryptedWorkbenchValue | null
  encryptedResult: EncryptedWorkbenchValue | null
  /** Decrypted transient value; never persisted by the store. */
  operation?: WorkbenchOperation
  result?: WorkbenchResult
  error?: string
  resultFingerprint?: string
  createdAtMs: number
  updatedAtMs: number
  expiresAtMs: number
}

export interface PublicWorkbenchJob {
  jobId: string
  kind: WorkbenchJobKind
  status: WorkbenchJobStatus
  approvalRequired: boolean
  operation?: Exclude<WorkbenchOperation, { kind: 'fs.write' }> | { kind: 'fs.write'; path: string; expectedSha256?: string }
  result?: WorkbenchResult
  error?: string
  createdAt: string
  updatedAt: string
  approvedAt?: string
  completedAt?: string
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function exactKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key))
}

export function sanitizeWorkbenchRelativePath(
  path: string,
  options: { allowRoot?: boolean } = {},
): string | null {
  const raw = path.trim()
  if (options.allowRoot && raw === '.') return '.'
  if (!raw || raw === '.' || raw.length > MAX_PATH_LENGTH
    || raw.startsWith('/') || raw.startsWith('~') || /^[A-Za-z]:[\\/]/.test(raw)
    || raw.includes('\\') || /[\u0000-\u001f]/.test(raw)) return null
  const segments = raw.split('/').filter(Boolean)
  if (!segments.length || segments.some((segment) => segment === '.' || segment === '..')) return null
  return segments.join('/')
}

function invalidOperation(): never {
  throw new Error('workbench: invalid operation')
}

export function parseWorkbenchOperation(value: unknown): WorkbenchOperation {
  const input = record(value)
  if (!input || typeof input.kind !== 'string') return invalidOperation()
  switch (input.kind) {
    case 'fs.list': {
      if (!exactKeys(input, ['kind', 'path']) || typeof input.path !== 'string') return invalidOperation()
      const path = sanitizeWorkbenchRelativePath(input.path, { allowRoot: true })
      if (!path) return invalidOperation()
      return { kind: 'fs.list', path }
    }
    case 'fs.read': {
      if (!exactKeys(input, ['kind', 'path']) || typeof input.path !== 'string') return invalidOperation()
      const path = sanitizeWorkbenchRelativePath(input.path)
      if (!path) return invalidOperation()
      return { kind: 'fs.read', path }
    }
    case 'fs.write': {
      if (!exactKeys(input, ['kind', 'path', 'content', 'expectedSha256'])
        || typeof input.path !== 'string' || typeof input.content !== 'string'
        || Buffer.byteLength(input.content, 'utf8') > MAX_WRITE_BYTES) return invalidOperation()
      const path = sanitizeWorkbenchRelativePath(input.path)
      const expectedSha256 = input.expectedSha256
      if (!path || (expectedSha256 !== undefined
        && (typeof expectedSha256 !== 'string' || !/^[a-f0-9]{64}$/i.test(expectedSha256)))) return invalidOperation()
      return {
        kind: 'fs.write', path, content: input.content,
        ...(typeof expectedSha256 === 'string' ? { expectedSha256: expectedSha256.toLowerCase() } : {}),
      }
    }
    case 'git.status':
      if (!exactKeys(input, ['kind'])) return invalidOperation()
      return { kind: 'git.status' }
    case 'git.diff': {
      if (!exactKeys(input, ['kind', 'path', 'staged'])) return invalidOperation()
      if (input.staged !== undefined && typeof input.staged !== 'boolean') return invalidOperation()
      let path: string | undefined
      if (input.path !== undefined) {
        if (typeof input.path !== 'string') return invalidOperation()
        path = sanitizeWorkbenchRelativePath(input.path) ?? undefined
        if (!path) return invalidOperation()
      }
      return {
        kind: 'git.diff',
        ...(path ? { path } : {}),
        ...(typeof input.staged === 'boolean' ? { staged: input.staged } : {}),
      }
    }
    default:
      return invalidOperation()
  }
}

export function parseWorkbenchResult(kind: WorkbenchJobKind, value: unknown): WorkbenchResult {
  let serialized: string
  try { serialized = JSON.stringify(value) } catch { throw new Error('workbench: invalid result') }
  if (serialized === undefined || Buffer.byteLength(serialized, 'utf8') > MAX_RESULT_BYTES) {
    throw new Error('workbench: invalid result')
  }
  const input = record(value)
  if (!input) throw new Error('workbench: invalid result')
  if (kind === 'fs.list') {
    if (!Array.isArray(input.entries) || input.entries.length > 10_000) throw new Error('workbench: invalid result')
    const entries = input.entries.map((entry) => {
      const row = record(entry)
      const path = typeof row?.path === 'string' ? sanitizeWorkbenchRelativePath(row.path) : null
      if (!row || !path || !['file', 'directory'].includes(String(row.type))
        || (row.size !== undefined && (!Number.isSafeInteger(row.size) || Number(row.size) < 0))) {
        throw new Error('workbench: invalid result')
      }
      return { path, type: row.type as 'file' | 'directory', ...(row.size !== undefined ? { size: Number(row.size) } : {}) }
    })
    return { entries }
  }
  if (kind === 'fs.read') {
    if (typeof input.content !== 'string' || (input.sha256 !== undefined && !/^[a-f0-9]{64}$/i.test(String(input.sha256)))) {
      throw new Error('workbench: invalid result')
    }
    return { content: input.content, ...(typeof input.sha256 === 'string' ? { sha256: input.sha256.toLowerCase() } : {}), ...(input.truncated === true ? { truncated: true } : {}) }
  }
  if (kind === 'fs.write') {
    if (!Number.isSafeInteger(input.bytesWritten) || Number(input.bytesWritten) < 0 || !/^[a-f0-9]{64}$/i.test(String(input.sha256 ?? ''))) {
      throw new Error('workbench: invalid result')
    }
    return { bytesWritten: Number(input.bytesWritten), sha256: String(input.sha256).toLowerCase() }
  }
  if (kind === 'git.status') {
    if (!Array.isArray(input.changes) || input.changes.length > 10_000) throw new Error('workbench: invalid result')
    const changes = input.changes.map((change) => {
      const row = record(change)
      const path = typeof row?.path === 'string' ? sanitizeWorkbenchRelativePath(row.path) : null
      if (!row || !path || typeof row.status !== 'string' || row.status.length > 32) throw new Error('workbench: invalid result')
      return { path, status: row.status }
    })
    return { ...(typeof input.branch === 'string' ? { branch: input.branch.slice(0, 256) } : {}), changes }
  }
  if (typeof input.diff !== 'string') throw new Error('workbench: invalid result')
  return { diff: input.diff, ...(input.truncated === true ? { truncated: true } : {}) }
}

function masterKey(): Buffer {
  const value = process.env.SOCIAL_TOKEN_MASTER_KEY?.trim()
  if (!value) throw new Error('Missing env var: SOCIAL_TOKEN_MASTER_KEY')
  return value.length === 64 && /^[0-9a-f]+$/i.test(value)
    ? Buffer.from(value, 'hex')
    : crypto.createHash('sha256').update(value).digest()
}

function envelopeKey(deviceId: string, jobId: string, purpose: 'operation' | 'result'): Buffer {
  return crypto.createHmac('sha256', masterKey()).update(`${ENVELOPE_CONTEXT}:${deviceId}:${jobId}:${purpose}`).digest()
}

export function encryptWorkbenchValue(
  value: unknown,
  deviceId: string,
  jobId: string,
  purpose: 'operation' | 'result',
): EncryptedWorkbenchValue {
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', envelopeKey(deviceId, jobId, purpose), iv)
  cipher.setAAD(Buffer.from(`${deviceId}\n${jobId}\n${purpose}`))
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()])
  return { ciphertext: ciphertext.toString('base64'), iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64') }
}

export function decryptWorkbenchValue<T>(
  value: EncryptedWorkbenchValue,
  deviceId: string,
  jobId: string,
  purpose: 'operation' | 'result',
): T {
  const decipher = crypto.createDecipheriv('aes-256-gcm', envelopeKey(deviceId, jobId, purpose), Buffer.from(value.iv, 'base64'))
  decipher.setAAD(Buffer.from(`${deviceId}\n${jobId}\n${purpose}`))
  decipher.setAuthTag(Buffer.from(value.tag, 'base64'))
  return JSON.parse(Buffer.concat([decipher.update(Buffer.from(value.ciphertext, 'base64')), decipher.final()]).toString('utf8')) as T
}

export function workbenchRequestFingerprint(input: {
  conversationId: string
  orgId: string
  actorUserId: string
  deviceId: string
  mappingId: string
  operation: WorkbenchOperation
}): string {
  return crypto.createHash('sha256').update(JSON.stringify(input)).digest('hex')
}

export function workbenchJobId(input: { conversationId: string; actorUserId: string; idempotencyKey: string }): string {
  return crypto.createHash('sha256')
    .update(`${input.conversationId}\n${input.actorUserId}\n${input.idempotencyKey}`)
    .digest('base64url')
}

export function transitionWorkbenchJob(job: WorkbenchJob, event:
  | { type: 'approve'; approverUserId: string; nowMs: number }
  | { type: 'claim'; deviceId: string; credentialVersion: number; nowMs: number; leaseMs: number }
  | { type: 'complete'; deviceId: string; credentialVersion: number; attempt: number; leaseToken: string; outcome: 'completed' | 'failed' | 'cancelled'; nowMs: number }
): WorkbenchJob {
  if (event.type === 'approve') {
    if (job.kind !== 'fs.write' || job.status !== 'awaiting_approval') throw new Error('workbench: job is not awaiting approval')
    if (event.approverUserId !== job.actorUserId) throw new Error('workbench: approval owner mismatch')
    if (event.nowMs >= job.expiresAtMs) throw new Error('workbench: job expired')
    return { ...job, status: 'queued', approvedByUserId: event.approverUserId, approvedAtMs: event.nowMs, updatedAtMs: event.nowMs }
  }
  if (job.deviceId !== event.deviceId) throw new Error('workbench: device mismatch')
  if (job.credentialVersion !== event.credentialVersion) throw new Error('workbench: credential mismatch')
  if (event.type === 'claim') {
    if (job.status === 'awaiting_approval') throw new Error('workbench: approval required')
    if (['completed', 'failed', 'cancelled', 'expired'].includes(job.status)) throw new Error('workbench: job already final')
    if (event.nowMs >= job.expiresAtMs) throw new Error('workbench: job expired')
    if (job.status !== 'queued' && !(job.status === 'claimed' && (job.leaseExpiresAtMs ?? 0) <= event.nowMs)) {
      throw new Error('workbench: lease active')
    }
    return {
      ...job,
      status: 'claimed',
      attempt: job.attempt + 1,
      leaseToken: crypto.randomBytes(24).toString('base64url'),
      claimedAtMs: event.nowMs,
      leaseExpiresAtMs: event.nowMs + event.leaseMs,
      updatedAtMs: event.nowMs,
    }
  }
  if (job.status === event.outcome) return job
  if (job.status !== 'claimed') throw new Error('workbench: job not claimed')
  if (event.attempt !== job.attempt || event.leaseToken !== job.leaseToken) throw new Error('workbench: lease mismatch')
  if ((job.leaseExpiresAtMs ?? 0) < event.nowMs) throw new Error('workbench: lease expired')
  return {
    ...job,
    status: event.outcome,
    encryptedOperation: null,
    completedAtMs: event.nowMs,
    updatedAtMs: event.nowMs,
  }
}

export function publicWorkbenchJob(job: WorkbenchJob): PublicWorkbenchJob {
  const operation = job.operation
    ? job.operation.kind === 'fs.write'
      ? { kind: 'fs.write' as const, path: job.operation.path, ...(job.operation.expectedSha256 ? { expectedSha256: job.operation.expectedSha256 } : {}) }
      : job.operation
    : undefined
  return {
    jobId: job.jobId,
    kind: job.kind,
    status: job.status,
    approvalRequired: job.kind === 'fs.write' && !job.approvedAtMs,
    ...(operation ? { operation } : {}),
    ...(job.result !== undefined ? { result: job.result } : {}),
    ...(job.error ? { error: job.error } : {}),
    createdAt: new Date(job.createdAtMs).toISOString(),
    updatedAt: new Date(job.updatedAtMs).toISOString(),
    ...(job.approvedAtMs ? { approvedAt: new Date(job.approvedAtMs).toISOString() } : {}),
    ...(job.completedAtMs ? { completedAt: new Date(job.completedAtMs).toISOString() } : {}),
  }
}
