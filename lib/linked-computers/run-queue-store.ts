import crypto from 'node:crypto'
import { FieldValue, Timestamp } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import {
  decryptLinkedRunPayload,
  encryptLinkedRunPayload,
  publicClaimedLinkedRun,
  requireLinkedRunReceipt,
  sanitizeLinkedResult,
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
  requestId: string; deviceId: string; runtimeTargetId: string; orgId: string; actorUserId: string; workspaceId: string; projectId?: string
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
    const ids = Array.isArray(queue.data()?.pendingJobIds) ? queue.data()!.pendingJobIds as string[] : []
    if (ids.length >= 500) throw new Error('linked computers: device run queue full')
    tx.create(ref, toStored(job))
    tx.set(queueRef, { deviceId: input.deviceId, pendingJobIds: [...ids, id], updatedAt: FieldValue.serverTimestamp() }, { merge: true })
    tx.set(adminDb.collection('hermes_runs').doc(id), {
      hermesRunId: id, runId: id, status: 'pending', orgId: input.orgId, profile: input.agentId,
      conversationId: input.conversationId, messageId: input.assistantMessageId,
      runtimeKind: 'linked-computer', linkedDeviceId: input.deviceId, linkedDeviceMappingId: input.mappingId,
      createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
    })
  })
  return job
}

export async function claimOldestLinkedRun(input: { deviceId: string; ownerUserId: string; credentialVersion: number }, options: { nowMs?: number; leaseMs?: number } = {}) {
  const nowMs = options.nowMs ?? Date.now()
  return adminDb.runTransaction(async (tx) => {
    const queueRef = adminDb.collection(LINKED_RUN_QUEUES).doc(input.deviceId)
    const queue = await tx.get(queueRef)
    const ids = Array.isArray(queue.data()?.pendingJobIds) ? queue.data()!.pendingJobIds as string[] : []
    let selected: LinkedRunJob | null = null
    let selectedRef: ReturnType<typeof adminDb.collection> extends never ? never : FirebaseFirestore.DocumentReference | null = null
    const candidates = ids.slice(0, 12)
    const candidateSurvivors: string[] = []
    const untouchedTail = ids.slice(12)
    const expiredRefs: Array<{ ref: FirebaseFirestore.DocumentReference; job: LinkedRunJob }> = []
    for (const id of candidates) {
      const ref = adminDb.collection(LINKED_RUN_JOBS).doc(id)
      const snap = await tx.get(ref)
      if (!snap.exists) continue
      const current = fromStored(snap.data() ?? {})
      if (current.deviceId !== input.deviceId || ['completed', 'failed', 'cancelled', 'expired'].includes(current.status)) continue
      if (current.expiresAtMs <= nowMs) { expiredRefs.push({ ref, job: current }); continue }
      if (!selected && (current.status === 'queued' || (['claimed', 'running'].includes(current.status) && (current.leaseExpiresAtMs ?? 0) <= nowMs))) {
        const [device, grant, mapping, member, actorMember] = await Promise.all([
          tx.get(adminDb.collection('linked_devices').doc(current.deviceId)),
          tx.get(adminDb.collection('linked_device_grants').doc(`${current.orgId}_${current.deviceId}`)),
          tx.get(adminDb.collection('linked_device_workspace_mappings').doc(current.mappingId)),
          tx.get(adminDb.collection('orgMembers').doc(`${current.orgId}_${input.ownerUserId}`)),
          tx.get(adminDb.collection('orgMembers').doc(`${current.orgId}_${current.actorUserId}`)),
        ])
        const d = device.data() ?? {}; const g = grant.data() ?? {}; const m = mapping.data() ?? {}; const u = member.data() ?? {}; const a = actorMember.data() ?? {}
        if (!device.exists || d.status !== 'active' || Number(d.credentialVersion) !== input.credentialVersion
          || d.ownerUserId !== input.ownerUserId || !member.exists || u.status !== 'active' || u.orgId !== current.orgId
          || (u.uid !== input.ownerUserId && u.userId !== input.ownerUserId)
          || !actorMember.exists || a.status !== 'active' || a.orgId !== current.orgId
          || (a.uid !== current.actorUserId && a.userId !== current.actorUserId)
          || (current.actorUserId !== input.ownerUserId && (!Array.isArray(g.allowedUserIds) || !g.allowedUserIds.includes(current.actorUserId)))
          || !Array.isArray(d.capabilities) || !d.capabilities.includes('workspace.execute')
          || !grant.exists || g.status !== 'active' || g.orgId !== current.orgId || g.deviceId !== current.deviceId
          || !Array.isArray(g.capabilities) || !g.capabilities.includes('workspace.execute')
          || !mapping.exists || m.status !== 'active' || m.deviceId !== current.deviceId || m.orgId !== current.orgId
          || m.workspaceId !== current.workspaceId || (current.projectId && m.projectId && m.projectId !== current.projectId)) {
          expiredRefs.push({ ref, job: current }); continue
        }
        selected = transitionLinkedRun(current, { type: 'claim', ...input, nowMs, leaseMs: options.leaseMs ?? DEFAULT_LEASE_MS })
        selectedRef = ref
      } else candidateSurvivors.push(id)
    }
    const remaining = [...candidateSurvivors, ...untouchedTail]
    for (const expired of expiredRefs) {
      tx.update(expired.ref, { status: 'expired', encryptedPayload: null, finalizationState: 'complete', completedAt: Timestamp.fromMillis(nowMs), cleanupAt: Timestamp.fromMillis(nowMs + DEFAULT_TTL_MS), updatedAt: Timestamp.fromMillis(nowMs) })
      tx.set(adminDb.collection('conversations').doc(expired.job.conversationId).collection('messages').doc(expired.job.assistantMessageId), { content: '', status: 'failed', error: 'The linked computer run expired or is no longer authorized.', runId: expired.job.jobId, updatedAt: FieldValue.serverTimestamp() }, { merge: true })
      tx.set(adminDb.collection('hermes_runs').doc(expired.job.jobId), { status: 'expired', error: 'The linked computer run expired or is no longer authorized.', completedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() }, { merge: true })
    }
    if (!selected || !selectedRef) {
      if (remaining.length !== ids.length) tx.set(queueRef, { pendingJobIds: remaining, updatedAt: FieldValue.serverTimestamp() }, { merge: true })
      return null
    }
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
  const validReceiptEvent = input.event === 'progress'
    ? input.receipt.event === 'accepted' || input.receipt.event === 'progress'
    : input.receipt.event === input.outcome
  if (!validReceiptEvent) throw new Error('linked computers: run receipt event mismatch')
  const result = await adminDb.runTransaction(async (tx) => {
    const jobRef = adminDb.collection(LINKED_RUN_JOBS).doc(input.jobId)
    const deviceRef = adminDb.collection('linked_devices').doc(input.deviceId)
    const [jobSnap, deviceSnap] = await Promise.all([tx.get(jobRef), tx.get(deviceRef)])
    if (!jobSnap.exists || !deviceSnap.exists) throw new Error('linked computers: run not found')
    const job = fromStored(jobSnap.data() ?? {})
    const device = deviceSnap.data() ?? {}
    const output = typeof input.output === 'string' ? input.output : ''
    const error = typeof input.error === 'string' ? input.error : ''
    const acceptedRuntimeVersion = job.acceptedRuntimeVersion ?? String(device.runtimeVersion ?? '')
    const acceptedMachineLabel = job.acceptedMachineLabel ?? String(device.label ?? '')
    if (input.receipt.runtimeVersion !== acceptedRuntimeVersion || input.receipt.machineLabel !== acceptedMachineLabel) throw new Error('linked computers: registered runtime identity mismatch')
    if (['completed', 'failed', 'cancelled'].includes(job.status)) {
      const stored = jobSnap.data() ?? {}
      if (JSON.stringify(stored.receipt) !== JSON.stringify(input.receipt) || stored.output !== sanitizeLinkedResult(output) || stored.error !== sanitizeLinkedResult(error)) {
        throw new Error('linked computers: immutable terminal run mismatch')
      }
      requireLinkedRunReceipt(job, input.receipt, String(device.publicKey ?? ''), Date.parse(input.receipt.timestamp), { output, error })
      return job
    }
    requireLinkedRunReceipt(job, input.receipt, String(device.publicKey ?? ''), nowMs, { output, error })
    const next = input.event === 'progress'
      ? transitionLinkedRun(job, { type: 'progress', deviceId: input.deviceId, credentialVersion: input.credentialVersion, nowMs, attempt: input.receipt.attempt, leaseToken: input.receipt.leaseToken, leaseMs: DEFAULT_LEASE_MS })
      : transitionLinkedRun(job, { type: 'complete', deviceId: input.deviceId, credentialVersion: input.credentialVersion, nowMs, outcome: input.outcome ?? 'completed', attempt: input.receipt.attempt, leaseToken: input.receipt.leaseToken })
    const safeOutput = sanitizeLinkedResult(output); const safeError = sanitizeLinkedResult(error)
    tx.update(jobRef, { ...toStored(next), ...(!job.acceptedRuntimeVersion && input.receipt.event === 'accepted' ? { acceptedRuntimeVersion, acceptedMachineLabel } : {}), ...(input.event === 'progress' ? { acceptanceReceipt: input.receipt } : { receipt: input.receipt, finalizationState: 'complete' }), output: safeOutput, error: safeError })
    if (input.event === 'complete') {
      const status = input.outcome === 'completed' ? 'completed' : 'failed'
      const content = status === 'completed' ? safeOutput : (safeError || `Linked computer run ${input.outcome ?? 'failed'}`)
      tx.set(adminDb.collection('conversations').doc(job.conversationId).collection('messages').doc(job.assistantMessageId), { content, status, runId: job.jobId, acceptedDevice: { deviceId: job.deviceId, runtimeTargetId: job.runtimeTargetId, acceptedAt: input.receipt.acceptedAt, runtimeVersion: input.receipt.runtimeVersion, machineLabel: input.receipt.machineLabel }, linkedRunReceipt: input.receipt, updatedAt: FieldValue.serverTimestamp() }, { merge: true })
      tx.set(adminDb.collection('hermes_runs').doc(job.jobId), { status, output: content, response: { status, receipt: input.receipt }, updatedAt: FieldValue.serverTimestamp(), completedAt: FieldValue.serverTimestamp() }, { merge: true })
    }
    return next
  })
  return result
}

export async function waitForLinkedRunClaim(job: LinkedRunJob, options: { timeoutMs?: number; pollMs?: number } = {}) {
  const deadline = Date.now() + Math.min(options.timeoutMs ?? 8_000, 15_000)
  while (Date.now() < deadline) {
    const snap = await adminDb.collection(LINKED_RUN_JOBS).doc(job.jobId).get()
    const row = snap.exists ? fromStored(snap.data() ?? {}) : null
    const stored = snap.data() ?? {}
    if (row && ['running', 'completed', 'failed', 'cancelled'].includes(row.status) && (stored.acceptanceReceipt || stored.receipt)) return row
    await new Promise((resolve) => setTimeout(resolve, Math.max(50, options.pollMs ?? 200)))
  }
  throw new Error('linked computers: claim timeout')
}

export async function cancelLinkedRun(jobIdValue: string, reason = 'cancelled') {
  const ref = adminDb.collection(LINKED_RUN_JOBS).doc(jobIdValue)
  return adminDb.runTransaction(async (tx) => {
    const snap = await tx.get(ref)
    if (!snap.exists) return { won: false, status: 'missing' as const }
    const job = fromStored(snap.data() ?? {})
    if (['completed', 'failed', 'cancelled', 'expired'].includes(job.status)) return { won: false, status: job.status }
    const queueRef = adminDb.collection(LINKED_RUN_QUEUES).doc(job.deviceId)
    const queue = await tx.get(queueRef)
    const ids = Array.isArray(queue.data()?.pendingJobIds) ? queue.data()!.pendingJobIds as string[] : []
    const error = sanitizeLinkedResult(reason.slice(0, 500))
    tx.update(ref, { status: 'cancelled', encryptedPayload: null, error, finalizationState: 'complete', completedAt: FieldValue.serverTimestamp(), cleanupAt: Timestamp.fromMillis(Date.now() + DEFAULT_TTL_MS), updatedAt: FieldValue.serverTimestamp() })
    tx.set(queueRef, { pendingJobIds: ids.filter((id) => id !== jobIdValue), updatedAt: FieldValue.serverTimestamp() }, { merge: true })
    tx.set(adminDb.collection('conversations').doc(job.conversationId).collection('messages').doc(job.assistantMessageId), { content: '', status: 'failed', error: 'The linked computer run was cancelled.', runId: job.jobId, updatedAt: FieldValue.serverTimestamp() }, { merge: true })
    tx.set(adminDb.collection('hermes_runs').doc(job.jobId), { status: 'cancelled', error: 'The linked computer run was cancelled.', updatedAt: FieldValue.serverTimestamp(), completedAt: FieldValue.serverTimestamp() }, { merge: true })
    return { won: true, status: 'cancelled' as const }
  })
}
