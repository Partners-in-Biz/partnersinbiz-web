import crypto from 'node:crypto'
import { FieldValue, Timestamp } from 'firebase-admin/firestore'
import { conversationProjectId } from '@/lib/conversations/access'
import type { Conversation } from '@/lib/conversations/types'
import { adminDb } from '@/lib/firebase/admin'
import { isLinkedRunClaimAuthorized } from '@/lib/linked-computers/run-queue-store'
import { sanitizeLinkedResult } from '@/lib/linked-computers/run-queue'
import { projectOrganizationDocId } from '@/lib/projects/collaboration'
import {
  appendWorkbenchProgressChunk,
  canonicalWorkbenchWorkspaceRelativePath,
  decryptWorkbenchValue,
  encryptWorkbenchValue,
  parseWorkbenchProgressChunk,
  parseWorkbenchResult,
  transitionWorkbenchJob,
  workbenchJobId,
  workbenchRequestFingerprint,
  type WorkbenchJob,
  type WorkbenchJobProgressChunk,
  type WorkbenchOperation,
  type WorkbenchResult,
} from './jobs'

export const WORKBENCH_JOBS_COLLECTION = 'conversation_workbench_jobs'
export const WORKBENCH_QUEUES_COLLECTION = 'linked_device_workbench_queues'
const DEFAULT_LEASE_MS = 90_000
const DEFAULT_TTL_MS = 60 * 60 * 1000
const CLEANUP_RETENTION_MS = 24 * 60 * 60 * 1000

function timestampMs(value: unknown): number {
  if (value && typeof (value as { toMillis?: () => number }).toMillis === 'function') {
    return (value as { toMillis(): number }).toMillis()
  }
  const number = Number(value)
  return Number.isFinite(number) ? number : 0
}

function fromStored(jobId: string, row: Record<string, unknown>): WorkbenchJob {
  return {
    ...row,
    jobId,
    createdAtMs: timestampMs(row.createdAt),
    updatedAtMs: timestampMs(row.updatedAt),
    expiresAtMs: timestampMs(row.expiresAt),
    ...(row.leaseExpiresAt ? { leaseExpiresAtMs: timestampMs(row.leaseExpiresAt) } : {}),
    ...(row.claimedAt ? { claimedAtMs: timestampMs(row.claimedAt) } : {}),
    ...(row.approvedAt ? { approvedAtMs: timestampMs(row.approvedAt) } : {}),
    ...(row.completedAt ? { completedAtMs: timestampMs(row.completedAt) } : {}),
  } as unknown as WorkbenchJob
}

function toStored(job: WorkbenchJob): Record<string, unknown> {
  const {
    createdAtMs, updatedAtMs, expiresAtMs, leaseExpiresAtMs, claimedAtMs,
    approvedAtMs, completedAtMs, operation: _operation, result: _result, progressChunks: _progressChunks, ...row
  } = job
  return {
    ...row,
    createdAt: Timestamp.fromMillis(createdAtMs),
    updatedAt: Timestamp.fromMillis(updatedAtMs),
    expiresAt: Timestamp.fromMillis(expiresAtMs),
    cleanupAt: Timestamp.fromMillis(expiresAtMs + CLEANUP_RETENTION_MS),
    ...(leaseExpiresAtMs ? { leaseExpiresAt: Timestamp.fromMillis(leaseExpiresAtMs) } : {}),
    ...(claimedAtMs ? { claimedAt: Timestamp.fromMillis(claimedAtMs) } : {}),
    ...(approvedAtMs ? { approvedAt: Timestamp.fromMillis(approvedAtMs) } : {}),
    ...(completedAtMs ? { completedAt: Timestamp.fromMillis(completedAtMs) } : {}),
  }
}

function hydrate(job: WorkbenchJob): WorkbenchJob {
  const operation = job.encryptedOperation
    ? decryptWorkbenchValue<WorkbenchOperation>(job.encryptedOperation, job.deviceId, job.jobId, 'operation')
    : undefined
  const result = job.encryptedResult
    ? decryptWorkbenchValue<WorkbenchResult>(job.encryptedResult, job.deviceId, job.jobId, 'result')
    : undefined
  const progressChunks = job.encryptedProgress
    ? decryptWorkbenchValue<WorkbenchJobProgressChunk[]>(job.encryptedProgress, job.deviceId, job.jobId, 'progress')
    : undefined
  return {
    ...job,
    ...(operation ? { operation } : {}),
    ...(result ? { result } : {}),
    ...(progressChunks ? { progressChunks } : {}),
  } as WorkbenchJob
}

export interface EnqueueWorkbenchJobInput {
  idempotencyKey: string
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
  kind: WorkbenchOperation['kind']
  operation: WorkbenchOperation
}

export async function enqueueWorkbenchJob(
  input: EnqueueWorkbenchJobInput,
  options: { nowMs?: number; ttlMs?: number } = {},
): Promise<WorkbenchJob> {
  if (input.kind !== input.operation.kind) throw new Error('workbench: operation kind mismatch')
  if (Boolean(input.projectId) !== Boolean(input.projectReplicaId)) throw new Error('workbench: project replica required')
  const nowMs = options.nowMs ?? Date.now()
  const id = workbenchJobId(input)
  const requestFingerprint = workbenchRequestFingerprint({ ...input, operation: input.operation })
  const job: WorkbenchJob = {
    ...input,
    jobId: id,
    requestFingerprint,
    status: input.kind === 'fs.write' ? 'awaiting_approval' : 'queued',
    attempt: 0,
    encryptedOperation: encryptWorkbenchValue(input.operation, input.deviceId, id, 'operation'),
    encryptedResult: null,
    createdAtMs: nowMs,
    updatedAtMs: nowMs,
    expiresAtMs: nowMs + (options.ttlMs ?? DEFAULT_TTL_MS),
  }

  return adminDb.runTransaction(async (transaction) => {
    const jobRef = adminDb.collection(WORKBENCH_JOBS_COLLECTION).doc(id)
    const queueRef = adminDb.collection(WORKBENCH_QUEUES_COLLECTION).doc(input.deviceId)
    const [existingSnapshot, queueSnapshot] = await Promise.all([
      transaction.get(jobRef), transaction.get(queueRef),
    ])
    if (existingSnapshot.exists) {
      const existing = fromStored(existingSnapshot.id, existingSnapshot.data() ?? {})
      if (existing.requestFingerprint !== requestFingerprint
        || existing.conversationId !== input.conversationId
        || existing.actorUserId !== input.actorUserId) {
        throw new Error('workbench: idempotency key reused with different request')
      }
      return hydrate(existing)
    }

    const pendingJobIds = Array.isArray(queueSnapshot.data()?.pendingJobIds)
      ? queueSnapshot.data()!.pendingJobIds as string[]
      : []
    if (pendingJobIds.length >= 500) throw new Error('workbench: device queue full')
    transaction.create(jobRef, toStored(job))
    if (job.status === 'queued') {
      transaction.set(queueRef, {
        deviceId: input.deviceId,
        pendingJobIds: [...pendingJobIds, id],
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true })
    }
    return { ...job, operation: input.operation } as WorkbenchJob
  })
}

export async function getWorkbenchJob(jobId: string): Promise<WorkbenchJob | null> {
  const snapshot = await adminDb.collection(WORKBENCH_JOBS_COLLECTION).doc(jobId).get()
  if (!snapshot.exists) return null
  return hydrate(fromStored(snapshot.id, snapshot.data() ?? {}))
}

export interface ApproveWorkbenchJobInput {
  jobId: string
  approverUserId: string
  conversationId: string
  orgId: string
  deviceId: string
  runtimeTargetId: string
  credentialVersion: number
  workspaceId: string
  mappingId: string
  projectId?: string
  projectReplicaId?: string
  relativeFolder: string
}

function approvalBindingMatches(job: WorkbenchJob, input: ApproveWorkbenchJobInput): boolean {
  return job.conversationId === input.conversationId
    && job.orgId === input.orgId
    && job.actorUserId === input.approverUserId
    && job.deviceId === input.deviceId
    && job.runtimeTargetId === input.runtimeTargetId
    && job.credentialVersion === input.credentialVersion
    && job.workspaceId === input.workspaceId
    && job.mappingId === input.mappingId
    && (job.projectId ?? null) === (input.projectId ?? null)
    && (job.projectReplicaId ?? null) === (input.projectReplicaId ?? null)
    && job.relativeFolder === input.relativeFolder
}

export async function approveWorkbenchJob(input: ApproveWorkbenchJobInput, options: { nowMs?: number } = {}): Promise<WorkbenchJob> {
  const nowMs = options.nowMs ?? Date.now()
  return adminDb.runTransaction(async (transaction) => {
    const jobRef = adminDb.collection(WORKBENCH_JOBS_COLLECTION).doc(input.jobId)
    const queueRef = adminDb.collection(WORKBENCH_QUEUES_COLLECTION).doc(input.deviceId)
    const [jobSnapshot, queueSnapshot] = await Promise.all([
      transaction.get(jobRef), transaction.get(queueRef),
    ])
    if (!jobSnapshot.exists) throw new Error('workbench: job not found')
    const job = fromStored(jobSnapshot.id, jobSnapshot.data() ?? {})
    if (!approvalBindingMatches(job, input)) throw new Error('workbench: job binding mismatch')
    if (job.status === 'queued' && job.approvedByUserId === input.approverUserId) return hydrate(job)
    const approved = transitionWorkbenchJob(job, { type: 'approve', approverUserId: input.approverUserId, nowMs })
    const ids = Array.isArray(queueSnapshot.data()?.pendingJobIds)
      ? queueSnapshot.data()!.pendingJobIds as string[]
      : []
    if (ids.length >= 500) throw new Error('workbench: device queue full')
    transaction.update(jobRef, toStored(approved))
    transaction.set(queueRef, {
      deviceId: input.deviceId,
      pendingJobIds: ids.includes(input.jobId) ? ids : [...ids, input.jobId],
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true })
    return hydrate(approved)
  })
}

export interface WorkbenchStoredAuthorization {
  device?: Record<string, unknown>
  grant?: Record<string, unknown>
  mapping?: Record<string, unknown>
  deviceMember?: Record<string, unknown>
  actorMember?: Record<string, unknown>
  conversation?: Record<string, unknown>
  project?: Record<string, unknown>
  projectOrganization?: Record<string, unknown>
  projectReplica?: Record<string, unknown>
}

function activeMembership(row: Record<string, unknown> | undefined, orgId: string, userId: string): boolean {
  if (!row || row.orgId !== orgId || (row.uid !== userId && row.userId !== userId)) return false
  return row.status === undefined || row.status === 'active' || row.active === true
}

export function isWorkbenchClaimAuthorized(input: {
  authenticatedDeviceUserId: string
  credentialVersion: number
  authorization: WorkbenchStoredAuthorization
  job: WorkbenchJob
}): boolean {
  const { authorization, job } = input
  const conversation = authorization.conversation
  if (!conversation || String(conversation.id ?? '') !== job.conversationId || conversation.orgId !== job.orgId) return false
  if (!activeMembership(authorization.actorMember, job.orgId, job.actorUserId)) return false
  const participantUids = Array.isArray(conversation.participantUids) ? conversation.participantUids : []
  const workspaceContext = conversation.workspaceContext && typeof conversation.workspaceContext === 'object'
    ? conversation.workspaceContext as Record<string, unknown>
    : undefined
  if (!participantUids.includes(job.actorUserId) && workspaceContext?.shareMode !== 'org') return false
  if (workspaceContext?.orgId !== job.orgId
    || workspaceContext?.workspaceId !== job.workspaceId
    || workspaceContext?.mappingId !== job.mappingId) return false
  if (workspaceContext?.runtimeTarget !== job.runtimeTargetId && workspaceContext?.runtimeTarget !== job.deviceId) return false
  if ((conversationProjectId(conversation as unknown as Conversation) ?? null) !== (job.projectId ?? null)) return false
  if (!job.projectId) {
    const currentRelativeFolder = canonicalWorkbenchWorkspaceRelativePath(workspaceContext?.folderRelativePath)
    if (currentRelativeFolder !== job.relativeFolder) return false
  }
  if (job.kind === 'fs.write' && (!job.approvedAtMs || job.approvedByUserId !== job.actorUserId)) return false

  return isLinkedRunClaimAuthorized({
    authenticatedDeviceUserId: input.authenticatedDeviceUserId,
    credentialVersion: input.credentialVersion,
    device: authorization.device,
    grant: authorization.grant,
    mapping: authorization.mapping,
    deviceMember: authorization.deviceMember,
    actorMember: authorization.actorMember,
    project: authorization.project,
    projectOrganization: authorization.projectOrganization,
    projectReplica: authorization.projectReplica,
    job,
  })
}

async function loadAuthorization(
  transaction: FirebaseFirestore.Transaction,
  job: WorkbenchJob,
): Promise<WorkbenchStoredAuthorization> {
  const refs: Array<Promise<FirebaseFirestore.DocumentSnapshot>> = [
    transaction.get(adminDb.collection('linked_devices').doc(job.deviceId)),
    transaction.get(adminDb.collection('linked_device_grants').doc(`${job.orgId}_${job.deviceId}`)),
    transaction.get(adminDb.collection('linked_device_workspace_mappings').doc(job.mappingId)),
    transaction.get(adminDb.collection('orgMembers').doc(`${job.orgId}_${job.actorUserId}`)),
    transaction.get(adminDb.collection('conversations').doc(job.conversationId)),
  ]
  // Device membership is keyed by the signed device actor, not device id. It is
  // loaded separately below once the caller identity is available.
  const [device, grant, mapping, actorMember, conversation] = await Promise.all(refs)
  let project: FirebaseFirestore.DocumentSnapshot | null = null
  let projectOrganization: FirebaseFirestore.DocumentSnapshot | null = null
  let projectReplica: FirebaseFirestore.DocumentSnapshot | null = null
  if (job.projectId && job.projectReplicaId) {
    ;[project, projectOrganization, projectReplica] = await Promise.all([
      transaction.get(adminDb.collection('projects').doc(job.projectId)),
      transaction.get(adminDb.collection('projectOrganizations').doc(projectOrganizationDocId(job.projectId, job.orgId))),
      transaction.get(adminDb.collection('project_location_replicas').doc(job.projectReplicaId)),
    ])
  }
  return {
    device: device.exists ? { id: device.id, ...(device.data() ?? {}) } : undefined,
    grant: grant.exists ? grant.data() ?? {} : undefined,
    mapping: mapping.exists ? mapping.data() ?? {} : undefined,
    actorMember: actorMember.exists ? actorMember.data() ?? {} : undefined,
    conversation: conversation.exists ? { id: conversation.id, ...(conversation.data() ?? {}) } : undefined,
    project: project?.exists ? project.data() ?? {} : undefined,
    projectOrganization: projectOrganization?.exists ? projectOrganization.data() ?? {} : undefined,
    projectReplica: projectReplica?.exists ? projectReplica.data() ?? {} : undefined,
  }
}

async function withDeviceMembership(
  transaction: FirebaseFirestore.Transaction,
  authorization: WorkbenchStoredAuthorization,
  orgId: string,
  deviceActorUserId: string,
): Promise<WorkbenchStoredAuthorization> {
  const snapshot = await transaction.get(adminDb.collection('orgMembers').doc(`${orgId}_${deviceActorUserId}`))
  return { ...authorization, deviceMember: snapshot.exists ? snapshot.data() ?? {} : undefined }
}

export async function claimOldestWorkbenchJob(
  input: { deviceId: string; ownerUserId: string; credentialVersion: number },
  options: { nowMs?: number; leaseMs?: number } = {},
) {
  const nowMs = options.nowMs ?? Date.now()
  return adminDb.runTransaction(async (transaction) => {
    const queueRef = adminDb.collection(WORKBENCH_QUEUES_COLLECTION).doc(input.deviceId)
    const queueSnapshot = await transaction.get(queueRef)
    const ids = Array.isArray(queueSnapshot.data()?.pendingJobIds)
      ? queueSnapshot.data()!.pendingJobIds as string[]
      : []
    const candidates = ids.slice(0, 12)
    const tail = ids.slice(12)
    const survivors: string[] = []
    const expired: Array<{ ref: FirebaseFirestore.DocumentReference; job: WorkbenchJob }> = []
    let selected: { ref: FirebaseFirestore.DocumentReference; job: WorkbenchJob } | null = null

    for (const id of candidates) {
      const ref = adminDb.collection(WORKBENCH_JOBS_COLLECTION).doc(id)
      const snapshot = await transaction.get(ref)
      if (!snapshot.exists) continue
      const job = fromStored(snapshot.id, snapshot.data() ?? {})
      if (job.deviceId !== input.deviceId || ['completed', 'failed', 'cancelled', 'expired'].includes(job.status)) continue
      if (job.status === 'awaiting_approval') { survivors.push(id); continue }
      if (job.expiresAtMs <= nowMs) { expired.push({ ref, job }); continue }
      const claimable = job.status === 'queued' || (job.status === 'claimed' && (job.leaseExpiresAtMs ?? 0) <= nowMs)
      if (!selected && claimable) {
        const baseAuthorization = await loadAuthorization(transaction, job)
        const authorization = await withDeviceMembership(transaction, baseAuthorization, job.orgId, input.ownerUserId)
        if (!isWorkbenchClaimAuthorized({
          authenticatedDeviceUserId: input.ownerUserId,
          credentialVersion: input.credentialVersion,
          authorization,
          job,
        })) {
          expired.push({ ref, job })
          continue
        }
        selected = {
          ref,
          job: transitionWorkbenchJob(job, {
            type: 'claim', deviceId: input.deviceId, credentialVersion: input.credentialVersion,
            nowMs, leaseMs: options.leaseMs ?? DEFAULT_LEASE_MS,
          }),
        }
      } else survivors.push(id)
    }

    for (const row of expired) {
      transaction.update(row.ref, {
        status: 'expired', encryptedOperation: null, encryptedResult: null,
        error: 'Workbench job expired or is no longer authorized.',
        completedAt: Timestamp.fromMillis(nowMs), updatedAt: Timestamp.fromMillis(nowMs),
        cleanupAt: Timestamp.fromMillis(nowMs + CLEANUP_RETENTION_MS),
      })
    }
    const remaining = [...survivors, ...tail]
    if (!selected) {
      if (remaining.length !== ids.length) transaction.set(queueRef, { pendingJobIds: remaining, updatedAt: FieldValue.serverTimestamp() }, { merge: true })
      return null
    }
    transaction.update(selected.ref, toStored(selected.job))
    transaction.set(queueRef, { pendingJobIds: [selected.job.jobId, ...remaining], updatedAt: FieldValue.serverTimestamp() }, { merge: true })
    const operation = decryptWorkbenchValue<WorkbenchOperation>(selected.job.encryptedOperation!, selected.job.deviceId, selected.job.jobId, 'operation')
    return {
      jobId: selected.job.jobId,
      kind: selected.job.kind,
      operation,
      workspaceId: selected.job.workspaceId,
      mappingId: selected.job.mappingId,
      relativeFolder: selected.job.relativeFolder,
      attempt: selected.job.attempt,
      leaseToken: selected.job.leaseToken!,
    }
  })
}

export interface CompleteWorkbenchJobInput {
  deviceId: string
  ownerUserId: string
  credentialVersion: number
  jobId: string
  attempt: number
  leaseToken: string
  outcome: 'completed' | 'failed' | 'cancelled'
  result?: unknown
  error?: string
}

export async function completeWorkbenchJob(input: CompleteWorkbenchJobInput, options: { nowMs?: number } = {}): Promise<WorkbenchJob> {
  const nowMs = options.nowMs ?? Date.now()
  return adminDb.runTransaction(async (transaction) => {
    const jobRef = adminDb.collection(WORKBENCH_JOBS_COLLECTION).doc(input.jobId)
    const jobSnapshot = await transaction.get(jobRef)
    if (!jobSnapshot.exists) throw new Error('workbench: job not found')
    const job = fromStored(jobSnapshot.id, jobSnapshot.data() ?? {})
    const baseAuthorization = await loadAuthorization(transaction, job)
    const authorization = await withDeviceMembership(transaction, baseAuthorization, job.orgId, input.ownerUserId)
    if (!isWorkbenchClaimAuthorized({
      authenticatedDeviceUserId: input.ownerUserId,
      credentialVersion: input.credentialVersion,
      authorization,
      job,
    })) throw new Error('workbench: job authorization revoked')

    const parsedResult = input.outcome === 'completed' ? parseWorkbenchResult(job.kind, input.result) : undefined
    const safeError = input.outcome === 'completed' ? '' : sanitizeLinkedResult(String(input.error ?? '')).slice(0, 2_000)
    const resultFingerprint = crypto.createHash('sha256')
      .update(JSON.stringify({ outcome: input.outcome, result: parsedResult, error: safeError }))
      .digest('hex')
    if (['completed', 'failed', 'cancelled'].includes(job.status)) {
      if (job.status !== input.outcome || job.resultFingerprint !== resultFingerprint) {
        throw new Error('workbench: immutable terminal result mismatch')
      }
      return hydrate(job)
    }

    const completed = transitionWorkbenchJob(job, {
      type: 'complete', deviceId: input.deviceId, credentialVersion: input.credentialVersion,
      attempt: input.attempt, leaseToken: input.leaseToken, outcome: input.outcome, nowMs,
    })
    const encryptedResult = parsedResult
      ? encryptWorkbenchValue(parsedResult, job.deviceId, job.jobId, 'result')
      : null
    const next: WorkbenchJob = {
      ...completed,
      encryptedResult,
      resultFingerprint,
      ...(safeError ? { error: safeError } : {}),
      ...(parsedResult ? { result: parsedResult } : {}),
    }
    const queueRef = adminDb.collection(WORKBENCH_QUEUES_COLLECTION).doc(input.deviceId)
    const queueSnapshot = await transaction.get(queueRef)
    const ids = Array.isArray(queueSnapshot.data()?.pendingJobIds)
      ? queueSnapshot.data()!.pendingJobIds as string[]
      : []
    transaction.update(jobRef, toStored(next))
    transaction.set(queueRef, { pendingJobIds: ids.filter((id) => id !== input.jobId), updatedAt: FieldValue.serverTimestamp() }, { merge: true })
    return next
  })
}

export interface AppendWorkbenchJobProgressInput {
  deviceId: string
  ownerUserId: string
  credentialVersion: number
  jobId: string
  attempt: number
  leaseToken: string
  /** Validated internally via `parseWorkbenchProgressChunk` before it is persisted. */
  chunk: unknown
}

/**
 * Phase 3 MVP `shell.exec` streaming: a device worker calls this while a
 * claimed job is still running to report incremental stdout/stderr and to
 * renew its lease (the same way `workspace.execute` progress renews the
 * linked-computer run-queue lease). Re-verifies claim authorization on every
 * call so a revoked grant/mapping stops progress from a job already in
 * flight, not just future claims.
 */
export async function appendWorkbenchJobProgress(
  input: AppendWorkbenchJobProgressInput,
  options: { nowMs?: number; leaseMs?: number } = {},
): Promise<{ jobId: string; leaseExpiresAtMs: number }> {
  const nowMs = options.nowMs ?? Date.now()
  const chunk = parseWorkbenchProgressChunk(input.chunk)
  return adminDb.runTransaction(async (transaction) => {
    const jobRef = adminDb.collection(WORKBENCH_JOBS_COLLECTION).doc(input.jobId)
    const jobSnapshot = await transaction.get(jobRef)
    if (!jobSnapshot.exists) throw new Error('workbench: job not found')
    const job = fromStored(jobSnapshot.id, jobSnapshot.data() ?? {})
    const baseAuthorization = await loadAuthorization(transaction, job)
    const authorization = await withDeviceMembership(transaction, baseAuthorization, job.orgId, input.ownerUserId)
    if (!isWorkbenchClaimAuthorized({
      authenticatedDeviceUserId: input.ownerUserId,
      credentialVersion: input.credentialVersion,
      authorization,
      job,
    })) throw new Error('workbench: job authorization revoked')

    const renewed = transitionWorkbenchJob(job, {
      type: 'progress', deviceId: input.deviceId, credentialVersion: input.credentialVersion,
      attempt: input.attempt, leaseToken: input.leaseToken, nowMs, leaseMs: options.leaseMs ?? DEFAULT_LEASE_MS,
    })
    const existingChunks = job.encryptedProgress
      ? decryptWorkbenchValue<WorkbenchJobProgressChunk[]>(job.encryptedProgress, job.deviceId, job.jobId, 'progress')
      : []
    const nextChunks = appendWorkbenchProgressChunk(existingChunks, chunk)
    const next: WorkbenchJob = {
      ...renewed,
      encryptedProgress: encryptWorkbenchValue(nextChunks, job.deviceId, job.jobId, 'progress'),
      progressChunks: nextChunks,
    }
    transaction.update(jobRef, toStored(next))
    return { jobId: next.jobId, leaseExpiresAtMs: next.leaseExpiresAtMs ?? nowMs }
  })
}
