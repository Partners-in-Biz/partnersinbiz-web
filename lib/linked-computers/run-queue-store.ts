import crypto from 'node:crypto'
import { FieldValue, Timestamp } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import {
  decryptLinkedRunPayload,
  encryptLinkedRunPayload,
  publicClaimedLinkedRun,
  requireLinkedRunReceipt,
  transitionLinkedRun,
  type LinkedRunJob,
  type LinkedRunPayload,
  type LinkedRunReceipt,
} from './run-queue'

export const LINKED_RUN_JOBS = 'linked_device_run_jobs'
export const LINKED_RUN_QUEUES = 'linked_device_run_queues'
const DEFAULT_LEASE_MS = 90_000
const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000

function jobId(deviceId: string, requestId: string): string {
  return crypto.createHash('sha256').update(`${deviceId}\n${requestId}`).digest('base64url')
}

function fromStored(row: Record<string, unknown>): LinkedRunJob {
  const ms = (value: unknown) => value && typeof (value as { toMillis?: () => number }).toMillis === 'function'
    ? (value as { toMillis(): number }).toMillis() : Number(value)
  return {
    ...row,
    createdAtMs: ms(row.createdAt), updatedAtMs: ms(row.updatedAt), expiresAtMs: ms(row.expiresAt),
    ...(row.leaseExpiresAt ? { leaseExpiresAtMs: ms(row.leaseExpiresAt) } : {}),
    ...(row.claimedAt ? { claimedAtMs: ms(row.claimedAt) } : {}),
    ...(row.completedAt ? { completedAtMs: ms(row.completedAt) } : {}),
  } as unknown as LinkedRunJob
}

function toStored(job: LinkedRunJob): Record<string, unknown> {
  const { createdAtMs, updatedAtMs, expiresAtMs, leaseExpiresAtMs, claimedAtMs, completedAtMs, ...row } = job
  return {
    ...row, createdAt: Timestamp.fromMillis(createdAtMs), updatedAt: Timestamp.fromMillis(updatedAtMs),
    expiresAt: Timestamp.fromMillis(expiresAtMs),
    ...(leaseExpiresAtMs ? { leaseExpiresAt: Timestamp.fromMillis(leaseExpiresAtMs) } : {}),
    ...(claimedAtMs ? { claimedAt: Timestamp.fromMillis(claimedAtMs) } : {}),
    ...(completedAtMs ? { completedAt: Timestamp.fromMillis(completedAtMs) } : {}),
    cleanupAt: Timestamp.fromMillis(expiresAtMs + DEFAULT_TTL_MS),
  }
}

export async function enqueueLinkedRun(input: {
  requestId: string; deviceId: string; runtimeTargetId: string; orgId: string; workspaceId: string; projectId?: string
  mappingId: string; relativeFolder: string; credentialVersion: number; payload: LinkedRunPayload
  conversationId: string; assistantMessageId: string; agentId: string
}, options: { nowMs?: number; ttlMs?: number } = {}): Promise<LinkedRunJob> {
  const nowMs = options.nowMs ?? Date.now()
  const id = jobId(input.deviceId, input.requestId)
  const job: LinkedRunJob = {
    ...input, jobId: id, status: 'queued', attempt: 0,
    encryptedPayload: encryptLinkedRunPayload(input.payload, input.deviceId, id),
    createdAtMs: nowMs, updatedAtMs: nowMs, expiresAtMs: nowMs + (options.ttlMs ?? DEFAULT_TTL_MS),
  }
  await adminDb.runTransaction(async (tx) => {
    const ref = adminDb.collection(LINKED_RUN_JOBS).doc(id)
    const queueRef = adminDb.collection(LINKED_RUN_QUEUES).doc(input.deviceId)
    const [existing, queue] = await Promise.all([tx.get(ref), tx.get(queueRef)])
    if (existing.exists) {
      const row = fromStored(existing.data() ?? {})
      if (row.deviceId !== input.deviceId || row.requestId !== input.requestId) throw new Error('linked computers: run identity collision')
      return
    }
    tx.create(ref, toStored(job))
    const ids = Array.isArray(queue.data()?.pendingJobIds) ? queue.data()!.pendingJobIds as string[] : []
    tx.set(queueRef, { deviceId: input.deviceId, pendingJobIds: [...ids, id].slice(-500), updatedAt: FieldValue.serverTimestamp() }, { merge: true })
  })
  await adminDb.collection('hermes_runs').doc(id).set({
    hermesRunId: id, runId: id, status: 'pending', orgId: input.orgId, profile: input.agentId,
    conversationId: input.conversationId, messageId: input.assistantMessageId,
    runtimeKind: 'linked-computer', linkedDeviceId: input.deviceId, linkedDeviceMappingId: input.mappingId,
    createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true })
  return job
}

export async function claimOldestLinkedRun(input: { deviceId: string; credentialVersion: number }, options: { nowMs?: number; leaseMs?: number } = {}) {
  const nowMs = options.nowMs ?? Date.now()
  return adminDb.runTransaction(async (tx) => {
    const queueRef = adminDb.collection(LINKED_RUN_QUEUES).doc(input.deviceId)
    const queue = await tx.get(queueRef)
    const ids = Array.isArray(queue.data()?.pendingJobIds) ? queue.data()!.pendingJobIds as string[] : []
    let selected: LinkedRunJob | null = null
    let selectedRef: ReturnType<typeof adminDb.collection> extends never ? never : FirebaseFirestore.DocumentReference | null = null
    const remaining: string[] = []
    const expiredRefs: FirebaseFirestore.DocumentReference[] = []
    for (const id of ids) {
      const ref = adminDb.collection(LINKED_RUN_JOBS).doc(id)
      const snap = await tx.get(ref)
      if (!snap.exists) continue
      const current = fromStored(snap.data() ?? {})
      if (current.deviceId !== input.deviceId || ['completed', 'failed', 'cancelled', 'expired'].includes(current.status)) continue
      if (current.expiresAtMs <= nowMs) { expiredRefs.push(ref); continue }
      if (!selected && (current.status === 'queued' || (current.status === 'claimed' && (current.leaseExpiresAtMs ?? 0) <= nowMs))) {
        selected = transitionLinkedRun(current, { type: 'claim', ...input, nowMs, leaseMs: options.leaseMs ?? DEFAULT_LEASE_MS })
        selectedRef = ref
      } else remaining.push(id)
    }
    for (const ref of expiredRefs) tx.update(ref, { status: 'expired', encryptedPayload: null, updatedAt: Timestamp.fromMillis(nowMs) })
    if (!selected || !selectedRef) return null
    tx.update(selectedRef, toStored(selected))
    tx.set(queueRef, { pendingJobIds: [selected.jobId, ...remaining], updatedAt: FieldValue.serverTimestamp() }, { merge: true })
    return publicClaimedLinkedRun(selected, decryptLinkedRunPayload(selected.encryptedPayload!, selected.deviceId, selected.jobId))
  })
}

export async function updateLinkedRunFromDevice(input: {
  deviceId: string; credentialVersion: number; jobId: string; receipt: LinkedRunReceipt
  event: 'progress' | 'complete'; outcome?: 'completed' | 'failed' | 'cancelled'; output?: string; error?: string
}, options: { nowMs?: number } = {}) {
  const nowMs = options.nowMs ?? Date.now()
  const expectedReceiptEvent = input.event === 'progress' ? 'progress' : input.outcome
  if (input.receipt.event !== expectedReceiptEvent) throw new Error('linked computers: run receipt event mismatch')
  const result = await adminDb.runTransaction(async (tx) => {
    const jobRef = adminDb.collection(LINKED_RUN_JOBS).doc(input.jobId)
    const deviceRef = adminDb.collection('linked_devices').doc(input.deviceId)
    const [jobSnap, deviceSnap] = await Promise.all([tx.get(jobRef), tx.get(deviceRef)])
    if (!jobSnap.exists || !deviceSnap.exists) throw new Error('linked computers: run not found')
    const job = fromStored(jobSnap.data() ?? {})
    const device = deviceSnap.data() ?? {}
    requireLinkedRunReceipt(job, input.receipt, String(device.publicKey ?? ''), nowMs)
    const next = input.event === 'progress'
      ? transitionLinkedRun(job, { type: 'progress', deviceId: input.deviceId, credentialVersion: input.credentialVersion, nowMs })
      : transitionLinkedRun(job, { type: 'complete', deviceId: input.deviceId, credentialVersion: input.credentialVersion, nowMs, outcome: input.outcome ?? 'completed' })
    tx.update(jobRef, { ...toStored(next), receipt: input.receipt, ...(input.output ? { output: input.output.slice(0, 1_000_000) } : {}), ...(input.error ? { error: input.error.slice(0, 10_000) } : {}) })
    return next
  })
  if (input.event === 'complete') await finalizeLinkedRun(result, input)
  return result
}

async function finalizeLinkedRun(job: LinkedRunJob, result: { outcome?: string; output?: string; error?: string; receipt: LinkedRunReceipt }) {
  const msgRef = adminDb.collection('conversations').doc(job.conversationId).collection('messages').doc(job.assistantMessageId)
  const status = result.outcome === 'completed' ? 'completed' : 'failed'
  const content = status === 'completed' ? (result.output ?? '') : (result.error ?? `Linked computer run ${result.outcome ?? 'failed'}`)
  await msgRef.set({ content, status, runId: job.jobId, acceptedDevice: { deviceId: job.deviceId, runtimeTargetId: job.runtimeTargetId, acceptedAt: result.receipt.timestamp }, linkedRunReceipt: result.receipt, updatedAt: FieldValue.serverTimestamp() }, { merge: true })
  await adminDb.collection('hermes_runs').doc(job.jobId).set({ hermesRunId: job.jobId, status, output: content, orgId: job.orgId, profile: job.agentId, conversationId: job.conversationId, messageId: job.assistantMessageId, runtimeKind: 'linked-computer', linkedDeviceId: job.deviceId, linkedDeviceMappingId: job.mappingId, response: { status, receipt: result.receipt }, updatedAt: FieldValue.serverTimestamp(), completedAt: FieldValue.serverTimestamp() }, { merge: true })
}

export async function waitForLinkedRunClaim(job: LinkedRunJob, options: { timeoutMs?: number; pollMs?: number } = {}) {
  const deadline = Date.now() + Math.min(options.timeoutMs ?? 8_000, 15_000)
  while (Date.now() < deadline) {
    const snap = await adminDb.collection(LINKED_RUN_JOBS).doc(job.jobId).get()
    const row = snap.exists ? fromStored(snap.data() ?? {}) : null
    if (row?.status === 'claimed' || row?.status === 'running') return row
    await new Promise((resolve) => setTimeout(resolve, Math.max(50, options.pollMs ?? 200)))
  }
  throw new Error('linked computers: claim timeout')
}

export async function cancelLinkedRun(jobIdValue: string, reason = 'cancelled') {
  const ref = adminDb.collection(LINKED_RUN_JOBS).doc(jobIdValue)
  await adminDb.runTransaction(async (tx) => {
    const snap = await tx.get(ref)
    if (!snap.exists) return
    const job = fromStored(snap.data() ?? {})
    if (['completed', 'failed', 'cancelled', 'expired'].includes(job.status)) return
    tx.update(ref, { status: 'cancelled', encryptedPayload: null, error: reason.slice(0, 500), completedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() })
  })
}
