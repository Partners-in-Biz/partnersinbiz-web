import crypto, { verify } from 'node:crypto'
import {
  encodeRevealRedaction,
  isSecretShapedToken,
} from '@/lib/linked-computers/reveal-redaction'

const CONTEXT = 'linked-computer-run-queue:v1'
const MAX_RECEIPT_SKEW_MS = 5 * 60 * 1000

export type LinkedRunStatus = 'queued' | 'claimed' | 'running' | 'completed' | 'failed' | 'cancelled' | 'expired'
export interface EncryptedLinkedRunPayload { ciphertext: string; iv: string; tag: string }
export interface LinkedRunImage { url: string; contentType: string }
export interface LinkedRunPayload {
  prompt: string
  images?: LinkedRunImage[]
  model?: string
  provider?: string
  /** Skip dangerous-command prompts for this linked run (Hermes YOLO). */
  yolo?: boolean
}
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
  /** A queued run must be accepted by Hermes before this deadline. */
  queueExpiresAtMs: number
  leaseExpiresAtMs?: number
  leaseToken?: string
  claimedAtMs?: number
  completedAtMs?: number
  acceptedRuntimeVersion?: string
  acceptedMachineLabel?: string
  acceptanceReceipt?: LinkedRunReceipt
  queueReceipt?: LinkedRunReceipt
  /** Authenticated local Hermes run identity used for restart reattachment. */
  localHermesRunId?: string
  /**
   * Platform-side automatic recoveries after recoverable infrastructure/browser
   * failures. Distinct from `attempt` (lease claims).
   */
  recoveryCount?: number
  conversationId: string
  assistantMessageId: string
  agentId: string
  /** Watcher task correlation; enables task-scoped repository isolation on the runtime. */
  kanbanTaskId?: string
  kanbanTaskPath?: string
  /** Immutable approval/delegation namespace bound when the message was dispatched. */
  delegationId?: string
}

export interface LinkedRunReceipt {
  jobId: string
  requestId: string
  deviceId: string
  mappingId: string
  credentialVersion: number
  attempt: number
  leaseToken: string
  event: 'queued' | 'accepted' | 'progress' | 'completed' | 'failed' | 'cancelled'
  outcome: 'queued' | 'accepted' | 'running' | 'completed' | 'failed' | 'cancelled'
  queueReason?: 'runtime_capacity' | 'agent_capacity' | 'gateway_draining' | 'runtime_restarting'
  localHermesRunId?: string
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

const LINKED_RUN_QUEUE_REASONS = new Set<NonNullable<LinkedRunReceipt['queueReason']>>([
  'runtime_capacity',
  'agent_capacity',
  'gateway_draining',
  'runtime_restarting',
])

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
  // Keep under Firestore doc + AES practical limits; prefer a usable run over hard fail.
  const MAX_PROMPT = 700_000
  if (!payload.prompt) throw new Error('linked computers: invalid run prompt')
  if (payload.prompt.length > MAX_PROMPT) {
    payload = { ...payload, prompt: `${payload.prompt.slice(0, MAX_PROMPT)}\n\n…[prompt truncated for linked dispatch]` }
  }
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
  | { type: 'queue'; deviceId: string; credentialVersion: number; nowMs: number; attempt: number; leaseToken: string; leaseMs: number }
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
  if (event.type === 'queue') return { ...job, status: 'claimed', leaseExpiresAtMs: event.nowMs + event.leaseMs, updatedAtMs: event.nowMs }
  if (event.type === 'progress') return { ...job, status: 'running', leaseExpiresAtMs: event.nowMs + event.leaseMs, updatedAtMs: event.nowMs }
  return { ...job, status: event.outcome, encryptedPayload: null, completedAtMs: event.nowMs, updatedAtMs: event.nowMs }
}

const LINKED_URL_KEEP_MARKER = '\u0000PIB_KEEP_URL_'
const SENSITIVE_URL_QUERY =
  /(?:^|[?&#])(?:api[_-]?key|token|access[_-]?token|refresh[_-]?token|id[_-]?token|secret|password|passwd|auth|credential|signature|sig|session|cookie|jwt|bearer|key|X-Amz-Signature|X-Goog-Signature)=/i

function isPrivateOrLocalHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '0.0.0.0') return true
  if (host.endsWith('.local') || host.endsWith('.internal') || host.endsWith('.lan') || host.endsWith('.localhost')) return true
  const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (!ipv4) return false
  const [a, b] = [Number(ipv4[1]), Number(ipv4[2])]
  return a === 10
    || a === 127
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168)
    || (a === 169 && b === 254)
}

/** Redact credentialed, signed, or private-network URLs; keep ordinary public links readable in chat. */
export function shouldRedactLinkedUrl(rawUrl: string): boolean {
  const trimmed = rawUrl.trim().replace(/[.,;:!?)}\]]+$/g, '')
  let parsed: URL
  try {
    parsed = new URL(trimmed)
  } catch {
    return true
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return true
  if (parsed.username || parsed.password) return true
  if (isPrivateOrLocalHost(parsed.hostname)) return true
  if (SENSITIVE_URL_QUERY.test(parsed.search) || SENSITIVE_URL_QUERY.test(parsed.hash)) return true
  return false
}

/**
 * Scrub linked-computer chat output before multi-tenant storage.
 *
 * Operator-first policy (2026-07-29):
 * - **Never** replace the whole message with `[redacted output]` — that made chat unusable.
 * - Keep paths, public/private host URLs, and API endpoints fully readable.
 * - Only scrub true secrets **inline**: private keys, bearer/auth headers, connection URIs
 *   with embedded credentials, password/token/secret assignments, and JWT-shaped blobs.
 * - Credentialed URLs (`user:pass@…`) stay click-to-reveal; everything else stays visible.
 */
export function sanitizeLinkedResult(value: string): string {
  const keptUrls: string[] = []
  // Preserve ordinary URLs (including localhost/private hosts) through token scrubbers.
  // Only hide URLs that embed credentials or signed query secrets — and only as
  // click-to-reveal, never as a full-message wipe.
  const withUrlMarkers = value.replace(/(?:https?:\/\/)[^\s)\]}]+/gi, (url) => {
    const needsHide = (() => {
      try {
        const parsed = new URL(url.trim().replace(/[.,;:!?)}\]]+$/g, ''))
        if (parsed.username || parsed.password) return true
        if (SENSITIVE_URL_QUERY.test(parsed.search) || SENSITIVE_URL_QUERY.test(parsed.hash)) return true
        return false
      } catch {
        return false
      }
    })()
    if (needsHide) return encodeRevealRedaction('url', url)
    const index = keptUrls.length
    keptUrls.push(url)
    return `${LINKED_URL_KEEP_MARKER}${index}\u0000`
  })
  const redacted = withUrlMarkers
    // Permanent secret scrubbers (inline only — never wipe the whole reply).
    .replace(/-----BEGIN[^\r\n]*PRIVATE KEY-----[\s\S]*?(?:-----END[^\r\n]*PRIVATE KEY-----|$)/gi, '[redacted-private-key]')
    .replace(/(?:-----BEGIN\s*)?PRIVATE KEY-----[\s\S]*$/gi, '[redacted-private-key]')
    .replace(/\bAuthorization\s*:\s*(?:Bearer\s+)?[^\s,;\n]+/gi, 'Authorization: [redacted]')
    .replace(/\bBearer\s+[A-Za-z0-9._~+\/-]+=*/gi, 'Bearer [redacted]')
    .replace(/\b[A-Za-z][A-Za-z0-9+.-]*:\/\/[^\s/@:]+:[^\s/@]+@[^\s]+/gi, '[redacted-connection-uri]')
    .replace(/\b(?:DB_PASS|DATABASE_URL|[A-Z0-9_]*(?:PASSWORD|SECRET|TOKEN|KEY|CREDENTIAL|AUTH)[A-Z0-9_]*)\s*=\s*"(?:\\.|[^"\\])*"/gi, '[redacted-assignment]')
    .replace(/\b(?:DB_PASS|DATABASE_URL|[A-Z0-9_]*(?:PASSWORD|SECRET|TOKEN|KEY|CREDENTIAL|AUTH)[A-Z0-9_]*)\s*=\s*[^\s,;]+/gi, '[redacted-assignment]')
    .replace(/(["'](?:api[_-]?key|token|secret|password|credential)["']\s*:\s*["'])((?:\\.|(?!\1)[^"'\\])*)(["'])/gi, '$1[redacted]$3')
    .replace(/(["']?(?:api[_-]?key|token|secret|password|credential)["']?\s*[:=]\s*["']?)[^"'\s,;}\n]+/gi, '$1[redacted]')
  // Filesystem paths stay fully visible so operators can work from chat.

  // Shield click-to-reveal markers so the long-token scrubber cannot eat their payload.
  const revealMarkers: string[] = []
  const withRevealMarkers = redacted.replace(
    /\[\[pib-reveal:(?:path|url|token)\|[A-Za-z0-9_-]{1,12000}\]\]/g,
    (marker) => {
      const index = revealMarkers.length
      revealMarkers.push(marker)
      return `${LINKED_URL_KEEP_MARKER}R${index}\u0000`
    },
  )
  const afterTokens = withRevealMarkers.replace(/\b[A-Za-z0-9_+\/.=-]{40,}\b/g, (match) => {
    if (match.includes(LINKED_URL_KEEP_MARKER)) return match
    if (!isSecretShapedToken(match)) return match
    // JWTs stay permanent (no click-to-reveal for credentials).
    if (/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(match)) {
      return '[redacted-token]'
    }
    // High-entropy blobs: permanent scrub (not whole-message wipe).
    return '[redacted-token]'
  })
  let safe = afterTokens.slice(0, 1_000_000)
  for (let i = 0; i < revealMarkers.length; i += 1) {
    safe = safe.split(`${LINKED_URL_KEEP_MARKER}R${i}\u0000`).join(revealMarkers[i]!)
  }
  for (let i = 0; i < keptUrls.length; i += 1) {
    safe = safe.split(`${LINKED_URL_KEEP_MARKER}${i}\u0000`).join(keptUrls[i]!)
  }
  // Residual secret-shaped fragments → inline scrub only. Never wipe the reply.
  safe = safe
    .replace(/Authorization\s*:(?!\s*\[redacted\])[^\n]*/gi, 'Authorization: [redacted]')
    .replace(/\bBearer\s+[A-Za-z0-9._~+\/=-]{8,}/gi, 'Bearer [redacted]')
    .replace(/\b(?:password|passwd|secret|api[_-]?key|access[_-]?token|refresh[_-]?token)\s*[:=]\s*(?!\[redacted\])[^\s,;\n]+/gi, (match) => {
      const sep = match.includes('=') ? '=' : ':'
      const key = match.split(/[:=]/)[0]!.trim()
      return `${key}${sep} [redacted]`
    })
  return safe
}

export function linkedRunReceiptPayload(receipt: Omit<LinkedRunReceipt, 'signature'> | LinkedRunReceipt): string {
  const legacy = [receipt.jobId, receipt.requestId, receipt.deviceId, receipt.mappingId, String(receipt.credentialVersion), String(receipt.attempt), receipt.leaseToken,
    receipt.event, receipt.outcome, receipt.timestamp, receipt.acceptedAt, receipt.toolStartedAt, receipt.runtimeVersion, receipt.machineLabel,
    receipt.outputSha256, String(receipt.outputBytes), receipt.errorSha256, String(receipt.errorBytes)]
  if (receipt.queueReason !== undefined || receipt.localHermesRunId !== undefined) {
    legacy.push(receipt.queueReason ?? '', receipt.localHermesRunId ?? '')
  }
  return legacy.join('\n')
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
    || (receipt.localHermesRunId !== undefined && !/^[A-Za-z0-9_-]{1,128}$/.test(receipt.localHermesRunId))
    || (receipt.queueReason !== undefined && !LINKED_RUN_QUEUE_REASONS.has(receipt.queueReason))
    || (receipt.event === 'accepted' && receipt.localHermesRunId !== undefined && !receipt.localHermesRunId)
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
    actorUserId: job.actorUserId, orgId: job.orgId,
    ...(job.projectId ? { projectId: job.projectId } : {}), mappingId: job.mappingId,
    relativeFolder: job.relativeFolder,
    ...(job.workingDirectory ? { workingDirectory: job.workingDirectory } : {}),
    ...(job.kanbanTaskId ? { kanbanTaskId: job.kanbanTaskId } : {}),
    attempt: job.attempt, leaseToken: job.leaseToken, ...(payload.model ? { model: payload.model } : {}),
    ...(payload.images?.length ? { images: payload.images } : {}),
    ...(payload.provider ? { provider: payload.provider } : {}),
    ...(payload.yolo ? { yolo: true } : {}),
    ...(job.localHermesRunId ? { localHermesRunId: job.localHermesRunId } : {}),
  }
}
