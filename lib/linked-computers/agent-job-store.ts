import crypto from 'node:crypto'
import { FieldValue, Timestamp, type DocumentReference } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import {
  agentHostJobId,
  agentHostRequestFingerprint,
  parseAgentHostJobPayload,
  toPublicAgentHostJob,
  transitionAgentHostJob,
  type AgentHostJob,
  type AgentHostJobKind,
  type AgentHostJobPayload,
  type PublicAgentHostJob,
} from './agent-jobs'

export const AGENT_HOST_JOBS = 'linked_device_agent_jobs'
export const AGENT_HOST_QUEUES = 'linked_device_agent_queues'
const DEFAULT_LEASE_MS = 120_000
const DEFAULT_TTL_MS = 6 * 60 * 60 * 1000
const CLEANUP_RETENTION_MS = 24 * 60 * 60 * 1000

function timestampMs(value: unknown): number {
  if (value && typeof (value as { toMillis?: () => number }).toMillis === 'function') {
    return (value as { toMillis(): number }).toMillis()
  }
  const number = Number(value)
  return Number.isFinite(number) ? number : 0
}

function isClaimable(job: AgentHostJob, nowMs: number): boolean {
  if (job.status === 'queued') return true
  if (job.status === 'claimed' && (job.leaseExpiresAtMs ?? 0) <= nowMs) return true
  return false
}

function fromStored(jobId: string, row: Record<string, unknown>): AgentHostJob {
  return {
    jobId,
    idempotencyKey: String(row.idempotencyKey ?? ''),
    requestFingerprint: String(row.requestFingerprint ?? ''),
    deviceId: String(row.deviceId ?? ''),
    orgId: String(row.orgId ?? ''),
    actorUserId: String(row.actorUserId ?? ''),
    credentialVersion: Number(row.credentialVersion ?? 0),
    kind: row.kind as AgentHostJobKind,
    status: row.status as AgentHostJob['status'],
    attempt: Number(row.attempt ?? 0),
    ...(typeof row.leaseToken === 'string' ? { leaseToken: row.leaseToken } : {}),
    ...(row.leaseExpiresAt ? { leaseExpiresAtMs: timestampMs(row.leaseExpiresAt) } : {}),
    ...(row.claimedAt ? { claimedAtMs: timestampMs(row.claimedAt) } : {}),
    ...(row.completedAt ? { completedAtMs: timestampMs(row.completedAt) } : {}),
    payload: parseAgentHostJobPayload(row.payload),
    ...(row.result && typeof row.result === 'object' ? { result: row.result as Record<string, unknown> } : {}),
    ...(typeof row.error === 'string' ? { error: row.error } : {}),
    createdAtMs: timestampMs(row.createdAt),
    updatedAtMs: timestampMs(row.updatedAt),
    expiresAtMs: timestampMs(row.expiresAt),
  }
}

function toStored(job: AgentHostJob): Record<string, unknown> {
  return {
    jobId: job.jobId,
    idempotencyKey: job.idempotencyKey,
    requestFingerprint: job.requestFingerprint,
    deviceId: job.deviceId,
    orgId: job.orgId,
    actorUserId: job.actorUserId,
    credentialVersion: job.credentialVersion,
    kind: job.kind,
    status: job.status,
    attempt: job.attempt,
    payload: job.payload,
    ...(job.result ? { result: job.result } : {}),
    ...(job.error ? { error: job.error } : {}),
    ...(job.leaseToken ? { leaseToken: job.leaseToken } : { leaseToken: FieldValue.delete() }),
    createdAt: Timestamp.fromMillis(job.createdAtMs),
    updatedAt: Timestamp.fromMillis(job.updatedAtMs),
    expiresAt: Timestamp.fromMillis(job.expiresAtMs),
    cleanupAt: Timestamp.fromMillis(job.expiresAtMs + CLEANUP_RETENTION_MS),
    ...(job.leaseExpiresAtMs
      ? { leaseExpiresAt: Timestamp.fromMillis(job.leaseExpiresAtMs) }
      : { leaseExpiresAt: FieldValue.delete() }),
    ...(job.claimedAtMs
      ? { claimedAt: Timestamp.fromMillis(job.claimedAtMs) }
      : { claimedAt: FieldValue.delete() }),
    ...(job.completedAtMs
      ? { completedAt: Timestamp.fromMillis(job.completedAtMs) }
      : { completedAt: FieldValue.delete() }),
  }
}

export interface EnqueueAgentHostJobInput {
  idempotencyKey: string
  deviceId: string
  orgId: string
  actorUserId: string
  credentialVersion: number
  kind: AgentHostJobKind
  payload: AgentHostJobPayload
}

export async function enqueueAgentHostJob(
  input: EnqueueAgentHostJobInput,
  options: { nowMs?: number; ttlMs?: number } = {},
): Promise<AgentHostJob> {
  const nowMs = options.nowMs ?? Date.now()
  const id = agentHostJobId({
    deviceId: input.deviceId,
    kind: input.kind,
    agentId: input.payload.agentId,
    policyVersion: input.payload.policyVersion,
    idempotencyKey: input.idempotencyKey,
  })
  const requestFingerprint = agentHostRequestFingerprint({
    deviceId: input.deviceId,
    kind: input.kind,
    agentId: input.payload.agentId,
    policyVersion: input.payload.policyVersion,
    keepInSync: input.payload.keepInSync,
    runtimeSkills: input.payload.runtimeSkills,
    pibSkills: input.payload.pibSkills,
    vpsExternalDir: input.payload.vpsExternalDir,
    preferredPort: input.payload.preferredPort,
    packSha256: input.payload.skillPack?.packSha256 ?? null,
  })
  const job: AgentHostJob = {
    jobId: id,
    idempotencyKey: input.idempotencyKey,
    requestFingerprint,
    deviceId: input.deviceId,
    orgId: input.orgId,
    actorUserId: input.actorUserId,
    credentialVersion: input.credentialVersion,
    kind: input.kind,
    status: 'queued',
    attempt: 0,
    payload: input.payload,
    createdAtMs: nowMs,
    updatedAtMs: nowMs,
    expiresAtMs: nowMs + (options.ttlMs ?? DEFAULT_TTL_MS),
  }

  return adminDb.runTransaction(async (transaction) => {
    const jobRef = adminDb.collection(AGENT_HOST_JOBS).doc(id)
    const queueRef = adminDb.collection(AGENT_HOST_QUEUES).doc(input.deviceId)
    const [existingSnapshot, queueSnapshot] = await Promise.all([
      transaction.get(jobRef),
      transaction.get(queueRef),
    ])
    const pendingJobIds = Array.isArray(queueSnapshot.data()?.pendingJobIds)
      ? queueSnapshot.data()!.pendingJobIds as string[]
      : []

    if (existingSnapshot.exists) {
      const existing = fromStored(existingSnapshot.id, existingSnapshot.data() ?? {})
      const terminal = ['completed', 'failed', 'cancelled', 'expired'].includes(existing.status)
      if (!terminal) {
        if (existing.requestFingerprint !== requestFingerprint
          || existing.actorUserId !== input.actorUserId
          || existing.orgId !== input.orgId) {
          throw new Error('agent-host: idempotency key reused with different request')
        }
        return existing
      }
      // Terminal jobs must be re-queued so heartbeat/reconcile can retry after failure
      // or after a previously successful install that later disappeared from the host.
      if (existing.actorUserId !== input.actorUserId || existing.orgId !== input.orgId) {
        throw new Error('agent-host: idempotency key reused with different request')
      }
      const reset: AgentHostJob = {
        ...job,
        createdAtMs: existing.createdAtMs,
        attempt: 0,
        status: 'queued',
      }
      if (pendingJobIds.length >= 200 && !pendingJobIds.includes(id)) {
        throw new Error('agent-host: device queue full')
      }
      transaction.set(jobRef, toStored(reset), { merge: false })
      transaction.set(queueRef, {
        deviceId: input.deviceId,
        pendingJobIds: pendingJobIds.includes(id) ? pendingJobIds : [...pendingJobIds, id],
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true })
      return reset
    }

    if (pendingJobIds.length >= 200) throw new Error('agent-host: device queue full')
    transaction.create(jobRef, toStored(job))
    transaction.set(queueRef, {
      deviceId: input.deviceId,
      pendingJobIds: [...pendingJobIds, id],
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true })
    return job
  })
}

/**
 * Claim the oldest claimable job. Claimed jobs stay at the head of the queue
 * until complete/fail so lease expiry can re-claim without losing order.
 */
export async function claimOldestAgentHostJob(
  input: { deviceId: string; ownerUserId: string; credentialVersion: number },
  options: { nowMs?: number; leaseMs?: number } = {},
): Promise<PublicAgentHostJob | null> {
  const nowMs = options.nowMs ?? Date.now()
  const leaseMs = options.leaseMs ?? DEFAULT_LEASE_MS
  return adminDb.runTransaction(async (transaction) => {
    const deviceRef = adminDb.collection('linked_devices').doc(input.deviceId)
    const queueRef = adminDb.collection(AGENT_HOST_QUEUES).doc(input.deviceId)
    const [deviceSnapshot, queueSnapshot] = await Promise.all([
      transaction.get(deviceRef),
      transaction.get(queueRef),
    ])
    if (!deviceSnapshot.exists) throw new Error('agent-host: device not found')
    const device = deviceSnapshot.data() ?? {}
    if (device.status !== 'active') throw new Error('agent-host: active device required')
    if (Number(device.credentialVersion) !== input.credentialVersion) {
      throw new Error('agent-host: credential mismatch')
    }

    const ids = Array.isArray(queueSnapshot.data()?.pendingJobIds)
      ? queueSnapshot.data()!.pendingJobIds as string[]
      : []
    if (ids.length === 0) return null

    let selected: AgentHostJob | null = null
    let selectedRef: DocumentReference | null = null
    const survivors: string[] = []

    for (const jobId of ids) {
      const jobRef = adminDb.collection(AGENT_HOST_JOBS).doc(jobId)
      const jobSnapshot = await transaction.get(jobRef)
      if (!jobSnapshot.exists) continue
      const job = fromStored(jobSnapshot.id, jobSnapshot.data() ?? {})
      if (job.deviceId !== input.deviceId) continue
      if (job.credentialVersion !== input.credentialVersion) {
        survivors.push(jobId)
        continue
      }
      if (job.expiresAtMs <= nowMs) {
        transaction.update(jobRef, {
          status: 'expired',
          updatedAt: Timestamp.fromMillis(nowMs),
          leaseToken: FieldValue.delete(),
          leaseExpiresAt: FieldValue.delete(),
        })
        continue
      }
      if (!selected && isClaimable(job, nowMs)) {
        const leaseToken = crypto.randomBytes(16).toString('hex')
        selected = transitionAgentHostJob(job, {
          type: 'claim',
          leaseToken,
          leaseExpiresAtMs: nowMs + leaseMs,
          nowMs,
        })
        selectedRef = jobRef
        continue
      }
      survivors.push(jobId)
    }

    if (!selected || !selectedRef) {
      if (survivors.length !== ids.length) {
        transaction.set(queueRef, {
          deviceId: input.deviceId,
          pendingJobIds: survivors,
          updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true })
      }
      return null
    }

    transaction.set(selectedRef, toStored(selected), { merge: false })
    // Keep claimed job at head until complete — mirrors run-queue lease semantics.
    transaction.set(queueRef, {
      deviceId: input.deviceId,
      pendingJobIds: [selected.jobId, ...survivors],
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true })
    return toPublicAgentHostJob(selected)
  })
}

export async function completeAgentHostJob(input: {
  deviceId: string
  jobId: string
  leaseToken: string
  credentialVersion: number
  ok: boolean
  result?: Record<string, unknown>
  error?: string
}, options: { nowMs?: number } = {}): Promise<AgentHostJob> {
  const nowMs = options.nowMs ?? Date.now()
  return adminDb.runTransaction(async (transaction) => {
    const jobRef = adminDb.collection(AGENT_HOST_JOBS).doc(input.jobId)
    const queueRef = adminDb.collection(AGENT_HOST_QUEUES).doc(input.deviceId)
    const [jobSnapshot, queueSnapshot] = await Promise.all([
      transaction.get(jobRef),
      transaction.get(queueRef),
    ])
    if (!jobSnapshot.exists) throw new Error('agent-host: job not found')
    const job = fromStored(jobSnapshot.id, jobSnapshot.data() ?? {})
    if (job.deviceId !== input.deviceId) throw new Error('agent-host: device mismatch')
    if (job.credentialVersion !== input.credentialVersion) throw new Error('agent-host: credential mismatch')
    if (job.leaseToken !== input.leaseToken) throw new Error('agent-host: lease mismatch')
    const next = input.ok
      ? transitionAgentHostJob(job, { type: 'complete', result: input.result, nowMs })
      : transitionAgentHostJob(job, { type: 'fail', error: input.error || 'agent job failed', nowMs })
    transaction.set(jobRef, toStored(next), { merge: false })

    const ids = Array.isArray(queueSnapshot.data()?.pendingJobIds)
      ? queueSnapshot.data()!.pendingJobIds as string[]
      : []
    if (ids.includes(input.jobId)) {
      transaction.set(queueRef, {
        deviceId: input.deviceId,
        pendingJobIds: ids.filter((id) => id !== input.jobId),
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true })
    }
    return next
  })
}

export async function getAgentHostJob(jobId: string): Promise<AgentHostJob | null> {
  const snapshot = await adminDb.collection(AGENT_HOST_JOBS).doc(jobId).get()
  if (!snapshot.exists) return null
  return fromStored(snapshot.id, snapshot.data() ?? {})
}
