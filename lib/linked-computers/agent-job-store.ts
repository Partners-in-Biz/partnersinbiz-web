import crypto from 'node:crypto'
import { FieldValue, Timestamp, type DocumentReference } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import {
  agentHostJobId,
  agentHostRequestFingerprint,
  credentialDeliveryApplyMode,
  parseAgentHostJobPayload,
  toPublicAgentHostJob,
  transitionAgentHostJob,
  type AgentHostJob,
  type AgentHostJobKind,
  type AgentHostJobPayload,
  type PublicAgentHostJob,
} from './agent-jobs'
import {
  LINKED_RUN_AGENT_LEASES,
  LINKED_RUN_JOBS,
  LINKED_RUN_QUEUES,
  linkedRunAgentLeaseDocumentId,
} from './run-queue-store'

export const AGENT_HOST_JOBS = 'linked_device_agent_jobs'
export const AGENT_HOST_QUEUES = 'linked_device_agent_queues'
const DEFAULT_LEASE_MS = 5 * 60_000
const DEFAULT_TTL_MS = 6 * 60 * 60 * 1000
const CLEANUP_RETENTION_MS = 24 * 60 * 60 * 1000
const ACTIVE_LINKED_RUN_STATUSES = new Set(['claimed', 'running'])
const AGENT_HOST_MAINTENANCE_AGENT_ID = /^[a-z][a-z0-9._-]{0,39}$/
const AGENT_HOST_MAINTENANCE_JOB_ID = /^[A-Za-z0-9_-]{1,128}$/

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

function requiresQuietProfile(job: AgentHostJob): boolean {
  // OAuth credential replacement changes the target profile's provider state
  // and needs a restart. Env-var/API-key providers (DeepSeek, xAI key, ...)
  // are applied live to the already-running gateway with no restart, so a busy
  // profile must not block claiming those jobs — that is the whole point of
  // the env-only path. Other maintenance actions have their own explicit
  // semantics, so do not silently defer a revoke or uninstall here.
  if (job.kind !== 'sync-credential') return false
  return credentialDeliveryApplyMode(job.payload.credentialDelivery) === 'restart'
}

function maintenanceLeaseTokenHash(leaseToken: string): string {
  return crypto.createHash('sha256').update(`linked-run-maintenance:v1\n${leaseToken}`).digest('hex')
}

function hasLiveMaintenanceLease(row: Record<string, unknown> | undefined, nowMs: number): boolean {
  const maintenance = row?.maintenance
  if (!maintenance || typeof maintenance !== 'object' || Array.isArray(maintenance)) return false
  const lock = maintenance as Record<string, unknown>
  return typeof lock.agentHostJobId === 'string'
    && AGENT_HOST_MAINTENANCE_JOB_ID.test(lock.agentHostJobId)
    && typeof lock.leaseTokenHash === 'string'
    && /^[a-f0-9]{64}$/i.test(lock.leaseTokenHash)
    && Number.isSafeInteger(Number(lock.expiresAtMs))
    && Number(lock.expiresAtMs) > nowMs
}

function hasLiveRunLease(row: Record<string, unknown> | undefined, nowMs: number): boolean {
  const leases = row?.leases
  if (!leases || typeof leases !== 'object' || Array.isArray(leases)) return false
  return Object.entries(leases as Record<string, unknown>).some(([jobId, expiry]) => (
    AGENT_HOST_MAINTENANCE_JOB_ID.test(jobId)
    && Number.isSafeInteger(Number(expiry))
    && Number(expiry) > nowMs
  ))
}

function hasActiveBootstrapRun(row: Record<string, unknown> | undefined, agentId: string): boolean {
  return Boolean(
    row
    && row.agentId === agentId
    && ACTIVE_LINKED_RUN_STATUSES.has(String(row.status ?? '')),
  )
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

export function agentHostJobToStored(job: AgentHostJob): Record<string, unknown> {
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
    ...(job.leaseToken ? { leaseToken: job.leaseToken } : {}),
    createdAt: Timestamp.fromMillis(job.createdAtMs),
    updatedAt: Timestamp.fromMillis(job.updatedAtMs),
    expiresAt: Timestamp.fromMillis(job.expiresAtMs),
    cleanupAt: Timestamp.fromMillis(job.expiresAtMs + CLEANUP_RETENTION_MS),
    ...(job.leaseExpiresAtMs ? { leaseExpiresAt: Timestamp.fromMillis(job.leaseExpiresAtMs) } : {}),
    ...(job.claimedAtMs ? { claimedAt: Timestamp.fromMillis(job.claimedAtMs) } : {}),
    ...(job.completedAtMs ? { completedAt: Timestamp.fromMillis(job.completedAtMs) } : {}),
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
    profileConfig: input.payload.profileConfig ?? null,
    credentialDelivery: input.payload.credentialDelivery ?? null,
    catalogAgentId: input.payload.catalogAgentId ?? null,
    managedProfile: input.payload.managedProfile ?? null,
    modelDefault: input.payload.modelDefault ?? null,
    apiServer: input.payload.apiServer ?? null,
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
      transaction.set(jobRef, agentHostJobToStored(reset), { merge: false })
      transaction.set(queueRef, {
        deviceId: input.deviceId,
        pendingJobIds: pendingJobIds.includes(id) ? pendingJobIds : [...pendingJobIds, id],
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true })
      return reset
    }

    if (pendingJobIds.length >= 200) throw new Error('agent-host: device queue full')
    transaction.create(jobRef, agentHostJobToStored(job))
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
  options: {
    nowMs?: number
    leaseMs?: number
    skip?: (job: AgentHostJob) => boolean
  } = {},
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

    // Firestore transactions forbid reads after the first write. Load every
    // queued document up front so expiring one stale row cannot make the next
    // transaction.get fail and permanently block the device queue.
    const queuedSnapshots = await Promise.all(ids.map((jobId) =>
      transaction.get(adminDb.collection(AGENT_HOST_JOBS).doc(jobId)),
    ))
    // Claiming a credential update must be atomic with reserving the target
    // Hermes profile. Read all relevant execution state before any possible
    // expiration write below (Firestore transactions prohibit read-after-write).
    const quietProfileAgentIds = [...new Set(queuedSnapshots.flatMap((snapshot) => {
      if (!snapshot.exists) return []
      const job = fromStored(snapshot.id, snapshot.data() ?? {})
      const agentId = job.payload.agentId
      return job.deviceId === input.deviceId
        && job.credentialVersion === input.credentialVersion
        && requiresQuietProfile(job)
        && AGENT_HOST_MAINTENANCE_AGENT_ID.test(agentId)
        ? [agentId]
        : []
    }))]
    const linkedRunQueueRef = adminDb.collection(LINKED_RUN_QUEUES).doc(input.deviceId)
    const preflightSnapshots = await Promise.all([
      transaction.get(linkedRunQueueRef),
      ...quietProfileAgentIds.map((agentId) => transaction.get(
        adminDb.collection(LINKED_RUN_AGENT_LEASES).doc(linkedRunAgentLeaseDocumentId(input.deviceId, agentId)),
      )),
    ])
    const linkedRunQueueSnapshot = preflightSnapshots[0]
    const maintenanceSnapshots = new Map(quietProfileAgentIds.map((agentId, index) => [agentId, preflightSnapshots[index + 1]]))
    const linkedRunIds = Array.isArray(linkedRunQueueSnapshot.data()?.pendingJobIds)
      ? linkedRunQueueSnapshot.data()!.pendingJobIds as string[]
      : []
    // The execution queue is bounded at 500 entries. Unlike normal claims,
    // this maintenance operation is rare and must inspect the entire bounded
    // queue: completed rows can remain ahead of a live pre-ledger run until a
    // later execution claim prunes them.
    const linkedRunSnapshots = await Promise.all(linkedRunIds.map((jobId) =>
      transaction.get(adminDb.collection(LINKED_RUN_JOBS).doc(jobId)),
    ))
    const busyQuietProfiles = new Set(quietProfileAgentIds.filter((agentId) => {
      const leaseRow = maintenanceSnapshots.get(agentId)?.exists
        ? maintenanceSnapshots.get(agentId)?.data() as Record<string, unknown>
        : undefined
      if (hasLiveMaintenanceLease(leaseRow, nowMs) || hasLiveRunLease(leaseRow, nowMs)) return true
      // Pre-ledger installations have no counter document. A claimed/running
      // job anywhere in the bounded execution queue is still active and must prevent a
      // credential restart until the execution worker has recovered it.
      return linkedRunSnapshots.some((snapshot) => snapshot.exists
        && hasActiveBootstrapRun(snapshot.data() ?? {}, agentId))
    }))
    let selected: AgentHostJob | null = null
    let selectedRef: DocumentReference | null = null
    let selectedMaintenanceRef: DocumentReference | null = null
    const survivors: string[] = []

    for (let index = 0; index < ids.length; index += 1) {
      const jobId = ids[index]
      const jobRef = adminDb.collection(AGENT_HOST_JOBS).doc(jobId)
      const jobSnapshot = queuedSnapshots[index]
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
        if (options.skip?.(job)) {
          survivors.push(jobId)
          continue
        }
        if (requiresQuietProfile(job) && (!AGENT_HOST_MAINTENANCE_AGENT_ID.test(job.payload.agentId)
          || busyQuietProfiles.has(job.payload.agentId))) {
          survivors.push(jobId)
          continue
        }
        const leaseToken = crypto.randomBytes(16).toString('hex')
        selected = transitionAgentHostJob(job, {
          type: 'claim',
          leaseToken,
          leaseExpiresAtMs: nowMs + leaseMs,
          nowMs,
        })
        selectedRef = jobRef
        if (requiresQuietProfile(job)) {
          selectedMaintenanceRef = adminDb.collection(LINKED_RUN_AGENT_LEASES)
            .doc(linkedRunAgentLeaseDocumentId(input.deviceId, job.payload.agentId))
        }
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

    transaction.set(selectedRef, agentHostJobToStored(selected), { merge: false })
    if (selectedMaintenanceRef && requiresQuietProfile(selected)) {
      transaction.set(selectedMaintenanceRef, {
        deviceId: input.deviceId,
        agentId: selected.payload.agentId,
        maintenance: {
          agentHostJobId: selected.jobId,
          leaseTokenHash: maintenanceLeaseTokenHash(selected.leaseToken || ''),
          expiresAtMs: selected.leaseExpiresAtMs,
        },
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true })
    }
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
    const maintenanceRef = requiresQuietProfile(job) && AGENT_HOST_MAINTENANCE_AGENT_ID.test(job.payload.agentId)
      ? adminDb.collection(LINKED_RUN_AGENT_LEASES).doc(linkedRunAgentLeaseDocumentId(input.deviceId, job.payload.agentId))
      : null
    const maintenanceSnapshot = maintenanceRef ? await transaction.get(maintenanceRef) : null
    const next = input.ok
      ? transitionAgentHostJob(job, { type: 'complete', result: input.result, nowMs })
      : transitionAgentHostJob(job, { type: 'fail', error: input.error || 'agent job failed', nowMs })
    transaction.set(jobRef, agentHostJobToStored(next), { merge: false })
    const maintenance = maintenanceSnapshot?.exists && maintenanceSnapshot.data()?.maintenance
    if (maintenanceRef
      && maintenance
      && typeof maintenance === 'object'
      && !Array.isArray(maintenance)
      && (maintenance as Record<string, unknown>).agentHostJobId === job.jobId
      && (maintenance as Record<string, unknown>).leaseTokenHash === maintenanceLeaseTokenHash(input.leaseToken)) {
      transaction.set(maintenanceRef, {
        maintenance: FieldValue.delete(),
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true })
    }

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
