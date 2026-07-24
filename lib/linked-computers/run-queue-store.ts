import crypto from 'node:crypto'
import { FieldValue, Timestamp } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import { projectLinkedOrgIds } from '@/lib/project-locations/model'
import { projectOrganizationDocId } from '@/lib/projects/collaboration'
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
import { assertDeviceOrgAccess, isActiveOrgMembershipRow, linkedDeviceActorUserId, linkedDeviceOwnerType } from './policy'
import type { ActiveOrgMembership, LinkedDevice, LinkedDeviceGrant } from './types'
import { sanitizeLinkedRunChatEvents } from './run-events'

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

type ClaimAuthorizationRow = Record<string, unknown> | undefined

export function isLinkedRunClaimAuthorized(input: {
  authenticatedDeviceUserId: string
  credentialVersion: number
  device: ClaimAuthorizationRow
  grant: ClaimAuthorizationRow
  mapping: ClaimAuthorizationRow
  deviceMember: ClaimAuthorizationRow
  actorMember: ClaimAuthorizationRow
  project?: ClaimAuthorizationRow
  projectOrganization?: ClaimAuthorizationRow
  projectReplica?: ClaimAuthorizationRow
  job: Pick<LinkedRunJob, 'deviceId' | 'orgId' | 'actorUserId' | 'workspaceId' | 'mappingId' | 'projectId' | 'projectReplicaId' | 'relativeFolder'> | Record<string, unknown>
}): boolean {
  const device = input.device ?? {}
  const grant = input.grant ?? {}
  const mapping = input.mapping ?? {}
  const job = input.job
  try {
    const typedDevice = device as unknown as LinkedDevice
    if (device.deviceId !== job.deviceId || device.status !== 'active' || Number(device.credentialVersion) !== input.credentialVersion
      || linkedDeviceActorUserId(typedDevice) !== input.authenticatedDeviceUserId
      || !Array.isArray(device.capabilities) || !device.capabilities.includes('workspace.execute')) return false
    if (grant.status !== 'active' || grant.orgId !== job.orgId || grant.deviceId !== job.deviceId
      || !Array.isArray(grant.capabilities) || !grant.capabilities.includes('workspace.execute')) return false
    if (mapping.status !== 'active' || mapping.deviceId !== job.deviceId || mapping.orgId !== job.orgId
      || mapping.workspaceId !== job.workspaceId || mapping.mappingId !== job.mappingId
      || (job.projectId && mapping.projectId && mapping.projectId !== job.projectId)) return false
    const projectId = typeof job.projectId === 'string' ? job.projectId.trim() : ''
    const projectReplicaId = typeof job.projectReplicaId === 'string' ? job.projectReplicaId.trim() : ''
    if (!projectId && projectReplicaId) return false
    if (projectId) {
      const project = input.project
      const projectOrganization = input.projectOrganization
      const projectReplica = input.projectReplica
      if (!project || !projectReplicaId || !projectReplica) return false
      const organizationLinked = projectOrganization !== undefined
        ? projectOrganization.projectId === projectId
          && projectOrganization.orgId === job.orgId
          && projectOrganization.status === 'active'
        : projectLinkedOrgIds(project).includes(String(job.orgId))
      if (!organizationLinked
        || projectReplica.replicaId !== projectReplicaId
        || projectReplica.active !== true
        || projectReplica.projectId !== projectId
        || projectReplica.orgId !== job.orgId
        || projectReplica.workspaceId !== job.workspaceId
        || projectReplica.mappingId !== job.mappingId
        || projectReplica.locationId !== `linked-device:${String(job.deviceId)}`
        || projectReplica.relativePath !== job.relativeFolder) return false
    }
    const actorMember = input.actorMember
    const actorIdentityMatches = Boolean(actorMember && (actorMember.uid === job.actorUserId || actorMember.userId === job.actorUserId))
    const actorMembership: ActiveOrgMembership = {
      orgId: String(job.orgId), userId: String(job.actorUserId),
      active: isActiveOrgMembershipRow(actorMember) && actorMember?.orgId === job.orgId
        && actorIdentityMatches,
      role: typeof actorMember?.role === 'string' ? actorMember.role : undefined,
    }
    if (linkedDeviceOwnerType(typedDevice) === 'user') {
      const member = input.deviceMember
      const ownerIdentityMatches = Boolean(member && (member.uid === typedDevice.ownerUserId || member.userId === typedDevice.ownerUserId))
      if (!isActiveOrgMembershipRow(member) || member?.orgId !== job.orgId
        || !ownerIdentityMatches) return false
    }
    assertDeviceOrgAccess({ actorUserId: String(job.actorUserId), orgId: String(job.orgId), device: typedDevice, grant: grant as unknown as LinkedDeviceGrant, membership: actorMembership })
    return true
  } catch { return false }
}

async function loadLinkedRunAuthorization(
  tx: FirebaseFirestore.Transaction,
  job: LinkedRunJob,
  authenticatedDeviceUserId: string,
): Promise<Omit<Parameters<typeof isLinkedRunClaimAuthorized>[0], 'authenticatedDeviceUserId' | 'credentialVersion' | 'job'>> {
  const [device, grant, mapping, deviceMember, actorMember] = await Promise.all([
    tx.get(adminDb.collection('linked_devices').doc(job.deviceId)),
    tx.get(adminDb.collection('linked_device_grants').doc(`${job.orgId}_${job.deviceId}`)),
    tx.get(adminDb.collection('linked_device_workspace_mappings').doc(job.mappingId)),
    tx.get(adminDb.collection('orgMembers').doc(`${job.orgId}_${authenticatedDeviceUserId}`)),
    tx.get(adminDb.collection('orgMembers').doc(`${job.orgId}_${job.actorUserId}`)),
  ])
  const projectId = typeof job.projectId === 'string' ? job.projectId.trim() : ''
  const projectReplicaId = typeof job.projectReplicaId === 'string' ? job.projectReplicaId.trim() : ''
  const [project, projectOrganization, projectReplica] = projectId && projectReplicaId
    ? await Promise.all([
        tx.get(adminDb.collection('projects').doc(projectId)),
        tx.get(adminDb.collection('projectOrganizations').doc(projectOrganizationDocId(projectId, job.orgId))),
        tx.get(adminDb.collection('project_location_replicas').doc(projectReplicaId)),
      ])
    : [null, null, null]
  return {
    device: device.exists ? device.data() ?? {} : undefined,
    grant: grant.exists ? grant.data() ?? {} : undefined,
    mapping: mapping.exists ? mapping.data() ?? {} : undefined,
    deviceMember: deviceMember.exists ? deviceMember.data() ?? {} : undefined,
    actorMember: actorMember.exists ? actorMember.data() ?? {} : undefined,
    project: project?.exists ? project.data() ?? {} : undefined,
    projectOrganization: projectOrganization?.exists ? projectOrganization.data() ?? {} : undefined,
    projectReplica: projectReplica?.exists ? projectReplica.data() ?? {} : undefined,
  }
}

export async function enqueueLinkedRun(input: {
  requestId: string; deviceId: string; runtimeTargetId: string; orgId: string; actorUserId: string; workspaceId: string; projectId?: string; projectReplicaId?: string
  mappingId: string; relativeFolder: string; workingDirectory?: string; credentialVersion: number; payload: LinkedRunPayload
  conversationId: string; assistantMessageId: string; agentId: string
}, options: { nowMs?: number; ttlMs?: number } = {}): Promise<LinkedRunJob> {
  if (Boolean(input.projectId?.trim()) !== Boolean(input.projectReplicaId?.trim())) {
    throw new Error('linked computers: project runs require an active replica')
  }
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
        const authorization = await loadLinkedRunAuthorization(tx, current, input.ownerUserId)
        if (!isLinkedRunClaimAuthorized({
          authenticatedDeviceUserId: input.ownerUserId, credentialVersion: input.credentialVersion,
          ...authorization, job: current,
        })) {
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
  deviceId: string; ownerUserId: string; credentialVersion: number; jobId: string; receipt: LinkedRunReceipt
  event: 'progress' | 'complete'; outcome?: 'completed' | 'failed' | 'cancelled'; output?: string; error?: string
  events?: unknown
}, options: { nowMs?: number } = {}) {
  const nowMs = options.nowMs ?? Date.now()
  const validReceiptEvent = input.event === 'progress'
    ? input.receipt.event === 'accepted' || input.receipt.event === 'progress'
    : input.receipt.event === input.outcome
  if (!validReceiptEvent) throw new Error('linked computers: run receipt event mismatch')
  const incomingEvents = input.event === 'progress'
    ? sanitizeLinkedRunChatEvents(input.events, input.jobId)
    : []
  const result = await adminDb.runTransaction(async (tx) => {
    const jobRef = adminDb.collection(LINKED_RUN_JOBS).doc(input.jobId)
    const credentialRef = adminDb.collection('linked_device_credentials').doc(input.deviceId)
    const [jobSnap, credentialSnap] = await Promise.all([tx.get(jobRef), tx.get(credentialRef)])
    if (!jobSnap.exists || !credentialSnap.exists) throw new Error('linked computers: run not found')
    const storedJob = fromStored(jobSnap.data() ?? {})
    const authorization = await loadLinkedRunAuthorization(tx, storedJob, input.ownerUserId)
    if (!isLinkedRunClaimAuthorized({
      authenticatedDeviceUserId: input.ownerUserId,
      credentialVersion: input.credentialVersion,
      ...authorization,
      job: storedJob,
    })) throw new Error('linked computers: run grant or project access revoked')
    const device = authorization.device ?? {}
    const credential = credentialSnap.data() ?? {}
    const issuedMs = timestampMs(credential.issuedAt)
    const acceptedMs = Date.parse(String(storedJob.acceptanceReceipt?.acceptedAt ?? ''))
    const rotationContinuity = storedJob.credentialVersion !== input.credentialVersion
      && Number(credential.previousCredentialVersion) === storedJob.credentialVersion
      && Number(device.credentialVersion) === input.credentialVersion
      && Number.isFinite(acceptedMs) && issuedMs != null && acceptedMs < issuedMs
    const job = rotationContinuity ? { ...storedJob, credentialVersion: input.credentialVersion } : storedJob
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
    const existingEvents = Array.isArray((jobSnap.data() ?? {}).chatEvents)
      ? (jobSnap.data() as { chatEvents: unknown[] }).chatEvents
      : []
    const chatEvents = incomingEvents.length > 0
      ? [...existingEvents, ...incomingEvents].slice(-200)
      : undefined
    tx.update(jobRef, {
      ...toStored(next),
      ...(rotationContinuity ? { rotationContinuedFromCredentialVersion: storedJob.credentialVersion } : {}),
      ...(!job.acceptedRuntimeVersion && input.receipt.event === 'accepted' ? { acceptedRuntimeVersion, acceptedMachineLabel } : {}),
      ...(input.event === 'progress' ? { acceptanceReceipt: input.receipt } : { receipt: input.receipt, finalizationState: 'complete' }),
      output: safeOutput,
      error: safeError,
      ...(chatEvents ? { chatEvents } : {}),
    })
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

function timestampMs(value: unknown): number | null {
  if (value && typeof (value as { toMillis?: () => number }).toMillis === 'function') return (value as { toMillis(): number }).toMillis()
  const ms = Date.parse(String(value ?? ''))
  return Number.isFinite(ms) ? ms : null
}

/** Default acceptance wait. Caps high enough to survive a single rolling Hermes restart. */
export const LINKED_RUN_CLAIM_DEFAULT_TIMEOUT_MS = 15_000
export const LINKED_RUN_CLAIM_MAX_TIMEOUT_MS = 25_000

export async function waitForLinkedRunClaim(job: LinkedRunJob, options: { timeoutMs?: number; pollMs?: number } = {}) {
  const requested = options.timeoutMs ?? LINKED_RUN_CLAIM_DEFAULT_TIMEOUT_MS
  const timeoutMs = Math.min(
    Math.max(1_000, Number.isFinite(requested) ? requested : LINKED_RUN_CLAIM_DEFAULT_TIMEOUT_MS),
    LINKED_RUN_CLAIM_MAX_TIMEOUT_MS,
  )
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const snap = await adminDb.collection(LINKED_RUN_JOBS).doc(job.jobId).get()
    const row = snap.exists ? fromStored(snap.data() ?? {}) : null
    const stored = snap.data() ?? {}
    if (row && ['running', 'completed', 'failed', 'cancelled'].includes(row.status) && (stored.acceptanceReceipt || stored.receipt)) return row
    await new Promise((resolve) => setTimeout(resolve, Math.max(50, options.pollMs ?? 200)))
  }
  throw new Error(`linked computers: claim timeout after ${Math.round(timeoutMs / 1000)}s`)
}

export type LinkedRunResult = {
  status: 'running' | 'completed' | 'failed'
  runId: string
  linkedStatus: LinkedRunJob['status']
  content?: string
  error?: string
}

/**
 * Read linked-computer run state only after the caller has authorized access to
 * the containing conversation. Every durable binding is checked so a message
 * can never be finalized from an unrelated device job with a reused id.
 */
export async function getLinkedRunResult(input: {
  jobId: string
  deviceId: string
  conversationId: string
  assistantMessageId: string
}): Promise<LinkedRunResult | null> {
  const snapshot = await adminDb.collection(LINKED_RUN_JOBS).doc(input.jobId).get()
  if (!snapshot.exists) return null
  const job = fromStored(snapshot.data() ?? {})
  if (job.jobId !== input.jobId
    || job.deviceId !== input.deviceId
    || job.conversationId !== input.conversationId
    || job.assistantMessageId !== input.assistantMessageId) {
    throw new Error('linked computers: run binding mismatch')
  }

  const stored = snapshot.data() ?? {}
  const content = typeof stored.output === 'string' ? stored.output : ''
  const error = typeof stored.error === 'string' ? stored.error : ''
  if (job.status === 'completed') {
    return { status: 'completed', runId: job.jobId, linkedStatus: job.status, content }
  }
  if (job.status === 'failed' || job.status === 'cancelled' || job.status === 'expired') {
    const fallback = job.status === 'cancelled'
      ? 'The linked computer run was cancelled.'
      : job.status === 'expired'
        ? 'The linked computer run expired.'
        : 'The linked computer run failed.'
    return {
      status: 'failed',
      runId: job.jobId,
      linkedStatus: job.status,
      content: '',
      error: error || fallback,
    }
  }
  return { status: 'running', runId: job.jobId, linkedStatus: job.status }
}

export interface LinkedRunCancellationBinding {
  deviceId: string
  conversationId: string
  assistantMessageId: string
}

export function isLinkedRunCancellationBound(
  job: Pick<LinkedRunJob, 'deviceId' | 'conversationId' | 'assistantMessageId'>,
  binding: LinkedRunCancellationBinding,
): boolean {
  return job.deviceId === binding.deviceId
    && job.conversationId === binding.conversationId
    && job.assistantMessageId === binding.assistantMessageId
}

export async function cancelLinkedRun(
  jobIdValue: string,
  reason = 'cancelled',
  binding?: LinkedRunCancellationBinding,
) {
  const ref = adminDb.collection(LINKED_RUN_JOBS).doc(jobIdValue)
  return adminDb.runTransaction(async (tx) => {
    const snap = await tx.get(ref)
    if (!snap.exists) return { won: false, status: 'missing' as const }
    const job = fromStored(snap.data() ?? {})
    if (binding && !isLinkedRunCancellationBound(job, binding)) {
      return { won: false, status: 'binding_mismatch' as const }
    }
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
