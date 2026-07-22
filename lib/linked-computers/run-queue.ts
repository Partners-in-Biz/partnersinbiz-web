import crypto, { verify } from 'node:crypto'

const CONTEXT = 'linked-computer-run-queue:v1'
const MAX_RECEIPT_SKEW_MS = 5 * 60 * 1000

export type LinkedRunStatus = 'queued' | 'claimed' | 'running' | 'completed' | 'failed' | 'cancelled' | 'expired'
export interface EncryptedLinkedRunPayload { ciphertext: string; iv: string; tag: string }
export interface LinkedRunImage { url: string; contentType: string }
export interface LinkedRunPayload { prompt: string; images?: LinkedRunImage[]; model?: string; provider?: string }
export interface LinkedRunJob {
  jobId: string
  requestId: string
  deviceId: string
  runtimeTargetId: string
  orgId: string
  actorUserId: string
  workspaceId: string
  projectId?: string
  projectReplicaId?: string
  mappingId: string
  relativeFolder: string
  /** Absolute or ~/ portable path for company Cowork folders outside the org mapping root. */
  workingDirectory?: string
  credentialVersion: number
  status: LinkedRunStatus
  attempt: number
  encryptedPayload: EncryptedLinkedRunPayload | null
  createdAtMs: number
  updatedAtMs: number
  expiresAtMs: number
  leaseExpiresAtMs?: number
  leaseToken?: string
  claimedAtMs?: number
  completedAtMs?: number
  acceptedRuntimeVersion?: string
  acceptedMachineLabel?: string
  acceptanceReceipt?: LinkedRunReceipt
  conversationId: string
  assistantMessageId: string
  agentId: string
}

export interface LinkedRunReceipt {
  jobId: string
  requestId: string
  deviceId: string
  mappingId: string
  credentialVersion: number
  attempt: number
  leaseToken: string
  event: 'accepted' | 'progress' | 'completed' | 'failed' | 'cancelled'
  outcome: 'accepted' | 'running' | 'completed' | 'failed' | 'cancelled'
  timestamp: string
  acceptedAt: string
  toolStartedAt: string
  runtimeVersion: string
  machineLabel: string
  outputSha256: string
  outputBytes: number
  errorSha256: string
  errorBytes: number
  signature: string
}

function masterKey(): Buffer {
  const value = process.env.SOCIAL_TOKEN_MASTER_KEY?.trim()
  if (!value) throw new Error('Missing env var: SOCIAL_TOKEN_MASTER_KEY')
  return value.length === 64 && /^[0-9a-f]+$/i.test(value)
    ? Buffer.from(value, 'hex')
    : crypto.createHash('sha256').update(value).digest()
}

function jobKey(deviceId: string, jobId: string): Buffer {
  return crypto.createHmac('sha256', masterKey()).update(`${CONTEXT}:${deviceId}:${jobId}`).digest()
}

export function encryptLinkedRunPayload(payload: LinkedRunPayload, deviceId: string, jobId: string): EncryptedLinkedRunPayload {
  if (!payload.prompt || payload.prompt.length > 1_000_000) throw new Error('linked computers: invalid run prompt')
  if (payload.images && (payload.images.length > 5 || payload.images.some((image) => (
    !/^image\/(?:png|jpeg|gif|webp)$/i.test(image.contentType)
    || !/^https:\/\//i.test(image.url)
    || image.url.length > 8_192
  )))) throw new Error('linked computers: invalid run images')
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', jobKey(deviceId, jobId), iv)
  cipher.setAAD(Buffer.from(`${deviceId}\n${jobId}`))
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(payload), 'utf8'), cipher.final()])
  return { ciphertext: ciphertext.toString('base64'), iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64') }
}

export function decryptLinkedRunPayload(value: EncryptedLinkedRunPayload, deviceId: string, jobId: string): LinkedRunPayload {
  const decipher = crypto.createDecipheriv('aes-256-gcm', jobKey(deviceId, jobId), Buffer.from(value.iv, 'base64'))
  decipher.setAAD(Buffer.from(`${deviceId}\n${jobId}`))
  decipher.setAuthTag(Buffer.from(value.tag, 'base64'))
  return JSON.parse(Buffer.concat([decipher.update(Buffer.from(value.ciphertext, 'base64')), decipher.final()]).toString('utf8')) as LinkedRunPayload
}

function assertIdentity(job: LinkedRunJob, event: { deviceId: string; credentialVersion: number }) {
  if (job.deviceId !== event.deviceId) throw new Error('linked computers: run device mismatch')
  if (job.credentialVersion !== event.credentialVersion) throw new Error('linked computers: run credential mismatch')
}

export function transitionLinkedRun(job: LinkedRunJob, event:
  | { type: 'claim'; deviceId: string; credentialVersion: number; nowMs: number; leaseMs: number }
  | { type: 'progress'; deviceId: string; credentialVersion: number; nowMs: number; attempt: number; leaseToken: string; leaseMs: number }
  | { type: 'complete'; deviceId: string; credentialVersion: number; nowMs: number; outcome: 'completed' | 'failed' | 'cancelled'; attempt: number; leaseToken: string }
): LinkedRunJob {
  assertIdentity(job, event)
  if (event.type === 'complete' && job.status === event.outcome) return job
  if (['completed', 'failed', 'cancelled', 'expired'].includes(job.status)) throw new Error('linked computers: run already final')
  if (event.nowMs >= job.expiresAtMs) throw new Error('linked computers: run expired')
  if (event.type === 'claim') {
    if (job.status !== 'queued' && !(['claimed', 'running'].includes(job.status) && (job.leaseExpiresAtMs ?? 0) <= event.nowMs)) {
      throw new Error('linked computers: run lease active')
    }
    return { ...job, status: 'claimed', attempt: job.attempt + 1, leaseToken: crypto.randomBytes(24).toString('base64url'), claimedAtMs: event.nowMs, leaseExpiresAtMs: event.nowMs + event.leaseMs, updatedAtMs: event.nowMs }
  }
  if (!['claimed', 'running'].includes(job.status)) throw new Error('linked computers: run not claimed')
  if (event.attempt !== job.attempt || event.leaseToken !== job.leaseToken) throw new Error('linked computers: run lease mismatch')
  if ((job.leaseExpiresAtMs ?? 0) < event.nowMs) throw new Error('linked computers: run lease expired')
  if (event.type === 'progress') return { ...job, status: 'running', leaseExpiresAtMs: event.nowMs + event.leaseMs, updatedAtMs: event.nowMs }
  return { ...job, status: event.outcome, encryptedPayload: null, completedAtMs: event.nowMs, updatedAtMs: event.nowMs }
}

export function sanitizeLinkedResult(value: string): string {
  const redacted = value
    .replace(/-----BEGIN[^\r\n]*PRIVATE KEY-----[\s\S]*?(?:-----END[^\r\n]*PRIVATE KEY-----|$)/gi, '[redacted-private-key]')
    .replace(/(?:-----BEGIN\s*)?PRIVATE KEY-----[\s\S]*$/gi, '[redacted-private-key]')
    .replace(/\bAuthorization\s*:\s*(?:Bearer\s+)?[^\s,;]+/gi, 'Authorization: [redacted]')
    .replace(/\bBearer\s+[A-Za-z0-9._~+\/-]+=*/gi, 'Bearer [redacted]')
    .replace(/\b[A-Za-z][A-Za-z0-9+.-]*:\/\/[^\s/@:]+:[^\s/@]+@[^\s]+/gi, '[redacted-connection-uri]')
    .replace(/\b(?:DB_PASS|DATABASE_URL|[A-Z0-9_]*(?:PASSWORD|SECRET|TOKEN|KEY|CREDENTIAL|AUTH)[A-Z0-9_]*)\s*=\s*"(?:\\.|[^"\\])*"/gi, '[redacted-assignment]')
    .replace(/\b(?:DB_PASS|DATABASE_URL|[A-Z0-9_]*(?:PASSWORD|SECRET|TOKEN|KEY|CREDENTIAL|AUTH)[A-Z0-9_]*)\s*=\s*[^\s,;]+/gi, '[redacted-assignment]')
    .replace(/(["'](?:api[_-]?key|token|secret|password|credential)["']\s*:\s*["'])((?:\\.|(?!\1)[^"'\\])*)(["'])/gi, '$1[redacted]$3')
    .replace(/(["']?(?:api[_-]?key|token|secret|password|credential)["']?\s*[:=]\s*["']?)[^"'\s,;}]+/gi, '$1[redacted]')
    .replace(/\\\\[^\\\s]+\\[^\s)\]}]+/g, '[redacted-path]')
    .replace(/\b[A-Za-z]:\\[^\s)\]}]+/g, '[redacted-path]')
    .replace(/(^|[\s("'])\/(?!\/)[^\s)\]}"']+/gm, '$1[redacted-path]')
    .replace(/(?:https?:\/\/)[^\s)\]}]+/gi, '[redacted-url]')
    .replace(/\b[A-Za-z0-9_+\/.=-]{40,}\b/g, '[redacted-token]')
  const safe = redacted.slice(0, 1_000_000)
  if (/PRIVATE KEY|Authorization\s*:|Bearer\s+[A-Za-z0-9]|(?:token|secret|password|api[_-]?key)\s*[:=]\s*(?!\[redacted\])/i.test(safe)) return '[redacted output]'
  return safe
}

export function linkedRunReceiptPayload(receipt: Omit<LinkedRunReceipt, 'signature'> | LinkedRunReceipt): string {
  return [receipt.jobId, receipt.requestId, receipt.deviceId, receipt.mappingId, String(receipt.credentialVersion), String(receipt.attempt), receipt.leaseToken,
    receipt.event, receipt.outcome, receipt.timestamp, receipt.acceptedAt, receipt.toolStartedAt, receipt.runtimeVersion, receipt.machineLabel,
    receipt.outputSha256, String(receipt.outputBytes), receipt.errorSha256, String(receipt.errorBytes)].join('\n')
}

export function requireLinkedRunReceipt(job: LinkedRunJob, receipt: LinkedRunReceipt, publicKey: string, nowMs = Date.now(), body: { output?: string; error?: string } = {}): LinkedRunReceipt {
  if (receipt.jobId !== job.jobId || receipt.requestId !== job.requestId || receipt.deviceId !== job.deviceId
    || receipt.mappingId !== job.mappingId || receipt.credentialVersion !== job.credentialVersion
    || receipt.attempt !== Math.max(1, job.attempt) || receipt.leaseToken !== job.leaseToken) throw new Error('linked computers: run receipt mismatch')
  const receiptMs = Date.parse(receipt.timestamp)
  const acceptedMs = Date.parse(receipt.acceptedAt)
  const toolMs = Date.parse(receipt.toolStartedAt)
  if (!Number.isFinite(receiptMs) || !Number.isFinite(acceptedMs) || !Number.isFinite(toolMs)
    || Math.abs(nowMs - receiptMs) > MAX_RECEIPT_SKEW_MS || acceptedMs > toolMs || toolMs > receiptMs
    || acceptedMs < (job.claimedAtMs ?? job.createdAtMs) - 60_000 || !receipt.runtimeVersion || !receipt.machineLabel
    || receipt.event !== receipt.outcome && !(receipt.event === 'progress' && receipt.outcome === 'running')
    || !/^[A-Za-z0-9_-]{16,1024}$/.test(receipt.signature)) throw new Error('linked computers: invalid run receipt')
  const output = body.output ?? ''
  const error = body.error ?? ''
  const digest = (value: string) => crypto.createHash('sha256').update(value).digest('hex')
  if (receipt.outputBytes !== Buffer.byteLength(output) || receipt.errorBytes !== Buffer.byteLength(error)
    || receipt.outputSha256 !== digest(output) || receipt.errorSha256 !== digest(error)) throw new Error('linked computers: run receipt body mismatch')
  let valid = false
  try { valid = verify(null, Buffer.from(linkedRunReceiptPayload(receipt)), publicKey, Buffer.from(receipt.signature, 'base64url')) } catch { valid = false }
  if (!valid) throw new Error('linked computers: invalid run receipt signature')
  return receipt
}

export function publicClaimedLinkedRun(job: LinkedRunJob, payload: LinkedRunPayload) {
  return {
    jobId: job.jobId, requestId: job.requestId, prompt: payload.prompt, workspaceId: job.workspaceId, agentId: job.agentId,
    ...(job.projectId ? { projectId: job.projectId } : {}), mappingId: job.mappingId,
    relativeFolder: job.relativeFolder,
    ...(job.workingDirectory ? { workingDirectory: job.workingDirectory } : {}),
    attempt: job.attempt, leaseToken: job.leaseToken, ...(payload.model ? { model: payload.model } : {}),
    ...(payload.images?.length ? { images: payload.images } : {}),
    ...(payload.provider ? { provider: payload.provider } : {}),
  }
}
