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
import {
  CONVERSATION_RUN_MAX_AUTO_RECOVERIES,
  humanizeConversationRunError,
  isRecoverableConversationRunError,
} from '@/lib/conversations/run-policy'
import { assertDeviceOrgAccess, isActiveOrgMembershipRow, linkedDeviceActorUserId, linkedDeviceOwnerType } from './policy'
import type { ActiveOrgMembership, LinkedDevice, LinkedDeviceGrant } from './types'
import { sanitizeLinkedRunChatEvents } from './run-events'

export const LINKED_RUN_JOBS = 'linked_device_run_jobs'
export const LINKED_RUN_QUEUES = 'linked_device_run_queues'
const DEFAULT_LEASE_MS = 90_000
const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000
export const LINKED_RUN_QUEUE_START_DEADLINE_MS = 45 * 60 * 1000
const LINKED_RUN_CLAIM_SCAN_LIMIT = 64

export function linkedRunQueueStartExpired(
  job: Pick<LinkedRunJob, 'acceptanceReceipt' | 'localHermesRunId' | 'queueExpiresAtMs'>,
  nowMs = Date.now(),
): boolean {
  return !job.acceptanceReceipt && !job.localHermesRunId && job.queueExpiresAtMs <= nowMs
}

function jobId(deviceId: string, requestId: string): string {
  return crypto.createHash('sha256').update(`${deviceId}\n${requestId}`).digest('base64url')
}

function fromStored(row: Record<string, unknown>): LinkedRunJob {
  const ms = (value: unknown) => value && typeof (value as { toMillis?: () => number }).toMillis === 'function'
    ? (value as { toMillis(): number }).toMillis() : Number(value)
  return {
    ...row,
    createdAtMs: ms(row.createdAt), updatedAtMs: ms(row.updatedAt), expiresAtMs: ms(row.expiresAt),
    queueExpiresAtMs: row.queueExpiresAt ? ms(row.queueExpiresAt) : ms(row.createdAt) + LINKED_RUN_QUEUE_START_DEADLINE_MS,
    ...(row.leaseExpiresAt ? { leaseExpiresAtMs: ms(row.leaseExpiresAt) } : {}),
    ...(row.claimedAt ? { claimedAtMs: ms(row.claimedAt) } : {}),
    ...(row.completedAt ? { completedAtMs: ms(row.completedAt) } : {}),
  } as unknown as LinkedRunJob
}

function toStored(job: LinkedRunJob): Record<string, unknown> {
  const { createdAtMs, updatedAtMs, expiresAtMs, queueExpiresAtMs, leaseExpiresAtMs, claimedAtMs, completedAtMs, ...row } = job
  return {
    ...row, createdAt: Timestamp.fromMillis(createdAtMs), updatedAt: Timestamp.fromMillis(updatedAtMs),
    expiresAt: Timestamp.fromMillis(expiresAtMs),
    queueExpiresAt: Timestamp.fromMillis(queueExpiresAtMs),
    ...(leaseExpiresAtMs ? { leaseExpiresAt: Timestamp.fromMillis(leaseExpiresAtMs) } : {}),
    ...(claimedAtMs ? { claimedAt: Timestamp.fromMillis(claimedAtMs) } : {}),
    ...(completedAtMs ? { completedAt: Timestamp.fromMillis(completedAtMs) } : {}),
    cleanupAt: Timestamp.fromMillis(expiresAtMs + DEFAULT_TTL_MS),
  }
}

type ClaimAuthorizationRow = Record<string, unknown> | undefined

export type LinkedRunClaimEligibility = 'authorized' | 'execution_unavailable' | 'authorization_changed'

type LinkedRunAuthorizationInput = {
  authenticatedDeviceUserId: string
  credentialVersion: number
  device: ClaimAuthorizationRow
  credential?: ClaimAuthorizationRow
  grant: ClaimAuthorizationRow
  mapping: ClaimAuthorizationRow
  deviceMember: ClaimAuthorizationRow
  actorMember: ClaimAuthorizationRow
  project?: ClaimAuthorizationRow
  projectOrganization?: ClaimAuthorizationRow
  projectReplica?: ClaimAuthorizationRow
  delegation?: ClaimAuthorizationRow
  job: (
    Pick<LinkedRunJob, 'deviceId' | 'orgId' | 'actorUserId' | 'workspaceId' | 'mappingId' | 'projectId' | 'projectReplicaId' | 'relativeFolder'>
    & Partial<Pick<LinkedRunJob, 'conversationId' | 'agentId' | 'delegationId'>>
  ) | Record<string, unknown>
}

/**
 * Revalidate the durable security binding separately from live Hermes readiness.
 *
 * A runtime heartbeat intentionally removes workspace.execute / agent inventory
 * while local Hermes is restarting. Those fields must keep new work from
 * starting, but they must never be mistaken for a revoked device, grant, or
 * delegation and permanently destroy an otherwise recoverable job.
 */
export function linkedRunClaimEligibility(input: LinkedRunAuthorizationInput): LinkedRunClaimEligibility {
  const device = input.device ?? {}
  const grant = input.grant ?? {}
  const mapping = input.mapping ?? {}
  const job = input.job
  try {
    const typedDevice = device as unknown as LinkedDevice
    if (device.deviceId !== job.deviceId || device.status !== 'active' || Number(device.credentialVersion) !== input.credentialVersion
      || linkedDeviceActorUserId(typedDevice) !== input.authenticatedDeviceUserId) return 'authorization_changed'
    if (grant.status !== 'active' || grant.orgId !== job.orgId || grant.deviceId !== job.deviceId
      || !Array.isArray(grant.capabilities) || !grant.capabilities.includes('workspace.execute')) return 'authorization_changed'
    if (mapping.status !== 'active' || mapping.deviceId !== job.deviceId || mapping.orgId !== job.orgId
      || mapping.workspaceId !== job.workspaceId || mapping.mappingId !== job.mappingId
      || (job.projectId && mapping.projectId && mapping.projectId !== job.projectId)) return 'authorization_changed'
    const projectId = typeof job.projectId === 'string' ? job.projectId.trim() : ''
    const projectReplicaId = typeof job.projectReplicaId === 'string' ? job.projectReplicaId.trim() : ''
    if (!projectId && projectReplicaId) return 'authorization_changed'
    if (projectId) {
      const project = input.project
      const projectOrganization = input.projectOrganization
      const projectReplica = input.projectReplica
      if (!project || !projectReplicaId || !projectReplica) return 'authorization_changed'
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
        || projectReplica.relativePath !== job.relativeFolder) return 'authorization_changed'
    }
    if (job.delegationId) {
      const delegation = input.delegation
      const expiresAt = Date.parse(String(delegation?.expiresAt ?? ''))
      if (!delegation
        || delegation.status !== 'active'
        || delegation.revokedAt
        || delegation.orgId !== job.orgId
        || delegation.actingForUserId !== job.actorUserId
        || delegation.agentId !== job.agentId
        || delegation.conversationId !== job.conversationId
        || !Number.isFinite(expiresAt)
        || expiresAt <= Date.now()) return 'authorization_changed'
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
        || !ownerIdentityMatches) return 'authorization_changed'
    }
    assertDeviceOrgAccess({ actorUserId: String(job.actorUserId), orgId: String(job.orgId), device: typedDevice, grant: grant as unknown as LinkedDeviceGrant, membership: actorMembership })
    if (!Array.isArray(device.capabilities) || !device.capabilities.includes('workspace.execute')) return 'execution_unavailable'
    if (typeof job.agentId === 'string'
      && (!Array.isArray(device.availableAgentIds) || !device.availableAgentIds.includes(job.agentId))) return 'execution_unavailable'
    return 'authorized'
  } catch { return 'authorization_changed' }
}

export function isLinkedRunClaimAuthorized(input: LinkedRunAuthorizationInput): boolean {
  return linkedRunClaimEligibility(input) === 'authorized'
}

/** Security-only check for updates from a job that is already in flight. */
export function isLinkedRunAccessAuthorized(input: LinkedRunAuthorizationInput): boolean {
  const device = input.device ?? {}
  const agentId = typeof (input.job as { agentId?: unknown }).agentId === 'string'
    ? (input.job as { agentId: string }).agentId
    : undefined
  const capabilities = Array.isArray(device.capabilities) ? device.capabilities : []
  const availableAgentIds = Array.isArray(device.availableAgentIds) ? device.availableAgentIds : []
  return linkedRunClaimEligibility({
    ...input,
    device: {
      ...device,
      capabilities: capabilities.includes('workspace.execute') ? capabilities : [...capabilities, 'workspace.execute'],
      ...(agentId ? { availableAgentIds: availableAgentIds.includes(agentId) ? availableAgentIds : [...availableAgentIds, agentId] } : {}),
    },
  }) !== 'authorization_changed'
}

async function loadLinkedRunAuthorization(
  tx: FirebaseFirestore.Transaction,
  job: LinkedRunJob,
  authenticatedDeviceUserId: string,
): Promise<Omit<Parameters<typeof isLinkedRunClaimAuthorized>[0], 'authenticatedDeviceUserId' | 'credentialVersion' | 'job'>> {
  const [device, credential, grant, mapping, deviceMember, actorMember, delegation] = await Promise.all([
    tx.get(adminDb.collection('linked_devices').doc(job.deviceId)),
    tx.get(adminDb.collection('linked_device_credentials').doc(job.deviceId)),
    tx.get(adminDb.collection('linked_device_grants').doc(`${job.orgId}_${job.deviceId}`)),
    tx.get(adminDb.collection('linked_device_workspace_mappings').doc(job.mappingId)),
    tx.get(adminDb.collection('orgMembers').doc(`${job.orgId}_${authenticatedDeviceUserId}`)),
    tx.get(adminDb.collection('orgMembers').doc(`${job.orgId}_${job.actorUserId}`)),
    job.delegationId
      ? tx.get(adminDb.collection('agent_delegations').doc(job.delegationId))
      : Promise.resolve(null),
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
    credential: credential.exists ? credential.data() ?? {} : undefined,
    grant: grant.exists ? grant.data() ?? {} : undefined,
    mapping: mapping.exists ? mapping.data() ?? {} : undefined,
    deviceMember: deviceMember.exists ? deviceMember.data() ?? {} : undefined,
    actorMember: actorMember.exists ? actorMember.data() ?? {} : undefined,
    delegation: delegation?.exists ? delegation.data() ?? {} : undefined,
    project: project?.exists ? project.data() ?? {} : undefined,
    projectOrganization: projectOrganization?.exists ? projectOrganization.data() ?? {} : undefined,
    projectReplica: projectReplica?.exists ? projectReplica.data() ?? {} : undefined,
  }
}

export function hasLinkedRunCredentialRotationContinuity(input: {
  job: Pick<LinkedRunJob, 'credentialVersion'>
  credentialVersion: number
  device: ClaimAuthorizationRow
  credential: ClaimAuthorizationRow
}): boolean {
  const device = input.device ?? {}
  const credential = input.credential ?? {}
  return input.job.credentialVersion !== input.credentialVersion
    && Number(device.credentialVersion) === input.credentialVersion
    && Number(credential.credentialVersion) === input.credentialVersion
    && Number(credential.previousCredentialVersion) === input.job.credentialVersion
    && !credential.revokedAt
}

function requeueLinkedRunForRuntimeRecovery(job: LinkedRunJob, nowMs: number): LinkedRunJob {
  return {
    ...job,
    status: 'queued',
    leaseExpiresAtMs: 0,
    leaseToken: undefined,
    claimedAtMs: undefined,
    completedAtMs: undefined,
    updatedAtMs: nowMs,
  }
}

export async function enqueueLinkedRun(input: {
  requestId: string; deviceId: string; runtimeTargetId: string; orgId: string; actorUserId: string; workspaceId: string; projectId?: string; projectReplicaId?: string
  mappingId: string; relativeFolder: string; workingDirectory?: string; credentialVersion: number; payload: LinkedRunPayload
  conversationId: string; assistantMessageId: string; agentId: string; delegationId?: string
}, options: { nowMs?: number; ttlMs?: number; queueStartDeadlineMs?: number } = {}): Promise<LinkedRunJob> {
  if (Boolean(input.projectId?.trim()) !== Boolean(input.projectReplicaId?.trim())) {
    throw new Error('linked computers: project runs require an active replica')
  }
  const nowMs = options.nowMs ?? Date.now()
  const id = jobId(input.deviceId, input.requestId)
  const job: LinkedRunJob = {
    ...input, jobId: id, status: 'queued', attempt: 0,
    encryptedPayload: encryptLinkedRunPayload(input.payload, input.deviceId, id),
    createdAtMs: nowMs, updatedAtMs: nowMs,
    queueExpiresAtMs: nowMs + (options.queueStartDeadlineMs ?? LINKED_RUN_QUEUE_START_DEADLINE_MS),
    expiresAtMs: nowMs + (options.ttlMs ?? DEFAULT_TTL_MS),
  }
  await adminDb.runTransaction(async (tx) => {
    const ref = adminDb.collection(LINKED_RUN_JOBS).doc(id)
    const queueRef = adminDb.collection(LINKED_RUN_QUEUES).doc(input.deviceId)
    const messageRef = adminDb.collection('conversations').doc(input.conversationId).collection('messages').doc(input.assistantMessageId)
    const queuedMessage = {
      status: 'queued',
      runId: id,
      dispatchAgentId: input.agentId,
      dispatchRuntimeTargetId: input.runtimeTargetId,
      dispatchRuntimeKind: 'linked-computer',
      linkedDeviceId: input.deviceId,
      linkedDeviceMappingId: input.mappingId,
      linkedDeviceCredentialVersion: input.credentialVersion,
      ...(input.delegationId ? { delegationId: input.delegationId } : {}),
      updatedAt: FieldValue.serverTimestamp(),
    }
    const [existing, queue] = await Promise.all([tx.get(ref), tx.get(queueRef)])
    if (existing.exists) {
      const row = fromStored(existing.data() ?? {})
      if (row.deviceId !== input.deviceId || row.requestId !== input.requestId) throw new Error('linked computers: run identity collision')
      if (!['completed', 'failed', 'cancelled', 'expired'].includes(row.status)) {
        tx.set(messageRef, queuedMessage, { merge: true })
      }
      return
    }
    const ids = Array.isArray(queue.data()?.pendingJobIds) ? queue.data()!.pendingJobIds as string[] : []
    if (ids.length >= 500) throw new Error('linked computers: device run queue full')
    tx.create(ref, toStored(job))
    tx.set(messageRef, queuedMessage, { merge: true })
    tx.set(queueRef, { deviceId: input.deviceId, pendingJobIds: [...ids, id], updatedAt: FieldValue.serverTimestamp() }, { merge: true })
    tx.set(adminDb.collection('hermes_runs').doc(id), {
      hermesRunId: id, runId: id, status: 'queued', orgId: input.orgId, profile: input.agentId,
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
    // A recovering agent must not head-of-line block healthy profiles on the
    // same machine. Inspect a bounded fair window, then rotate unavailable
    // work behind untouched jobs when there is nothing runnable in that pass.
    const candidates = ids.slice(0, LINKED_RUN_CLAIM_SCAN_LIMIT)
    const candidateSurvivors: string[] = []
    const recoveringCandidates: string[] = []
    const untouchedTail = ids.slice(LINKED_RUN_CLAIM_SCAN_LIMIT)
    const expiredRefs: Array<{
      ref: FirebaseFirestore.DocumentReference
      job: LinkedRunJob
      reason: 'ttl' | 'queue_start' | 'authorization_changed'
    }> = []
    const recoveryRefs: Array<{
      ref: FirebaseFirestore.DocumentReference
      job: LinkedRunJob
    }> = []
    let selectedIsRetry = false
    let selectedContinuedCredentialVersion: number | undefined
    for (const id of candidates) {
      const ref = adminDb.collection(LINKED_RUN_JOBS).doc(id)
      const snap = await tx.get(ref)
      if (!snap.exists) continue
      const current = fromStored(snap.data() ?? {})
      if (current.deviceId !== input.deviceId || ['completed', 'failed', 'cancelled', 'expired'].includes(current.status)) continue
      if (current.expiresAtMs <= nowMs) {
        expiredRefs.push({ ref, job: current, reason: 'ttl' })
        continue
      }
      if (linkedRunQueueStartExpired(current, nowMs)) {
        expiredRefs.push({ ref, job: current, reason: 'queue_start' })
        continue
      }
      if (!selected && (current.status === 'queued' || (['claimed', 'running'].includes(current.status) && (current.leaseExpiresAtMs ?? 0) <= nowMs))) {
        const authorization = await loadLinkedRunAuthorization(tx, current, input.ownerUserId)
        const credentialRotationContinued = hasLinkedRunCredentialRotationContinuity({
          job: current,
          credentialVersion: input.credentialVersion,
          device: authorization.device,
          credential: authorization.credential,
        })
        // Readiness loss never overrides the credential chain. A device that
        // has rotated beyond this job without its exact predecessor proof is
        // still a terminal authorization change.
        if (current.credentialVersion !== input.credentialVersion && !credentialRotationContinued) {
          expiredRefs.push({ ref, job: current, reason: 'authorization_changed' })
          continue
        }
        const eligibility = linkedRunClaimEligibility({
          authenticatedDeviceUserId: input.ownerUserId, credentialVersion: input.credentialVersion,
          ...authorization, job: current,
        })
        if (eligibility === 'authorization_changed') {
          expiredRefs.push({ ref, job: current, reason: 'authorization_changed' })
          continue
        }
        if (eligibility === 'execution_unavailable') {
          // The signed runtime is still the same device and every durable
          // binding remains valid; local Hermes simply has not recovered yet.
          // Preserve the encrypted job and any local run id for reattachment.
          if (current.status !== 'queued') recoveryRefs.push({ ref, job: current })
          recoveringCandidates.push(id)
          continue
        }
        selectedIsRetry = current.attempt > 0
        const claimable = credentialRotationContinued
          ? { ...current, credentialVersion: input.credentialVersion }
          : current
        if (credentialRotationContinued) selectedContinuedCredentialVersion = current.credentialVersion
        selected = transitionLinkedRun(claimable, { type: 'claim', ...input, nowMs, leaseMs: options.leaseMs ?? DEFAULT_LEASE_MS })
        selectedRef = ref
      } else candidateSurvivors.push(id)
    }
    const remaining = selected
      ? [...candidateSurvivors, ...recoveringCandidates, ...untouchedTail]
      : [...candidateSurvivors, ...untouchedTail, ...recoveringCandidates]
    const queueOrderChanged = remaining.length !== ids.length || remaining.some((id, index) => id !== ids[index])
    for (const expired of expiredRefs) {
      const error = expired.reason === 'ttl'
        ? 'The linked computer run expired before it could finish. Please retry.'
        : expired.reason === 'queue_start'
          ? 'This run could not start within the 45-minute capacity window. Please retry.'
        : 'The linked computer authorization changed while this run was active. Please retry.'
      tx.update(expired.ref, { status: 'expired', encryptedPayload: null, error, finalizationState: 'complete', completedAt: Timestamp.fromMillis(nowMs), cleanupAt: Timestamp.fromMillis(nowMs + DEFAULT_TTL_MS), updatedAt: Timestamp.fromMillis(nowMs) })
      tx.set(adminDb.collection('conversations').doc(expired.job.conversationId).collection('messages').doc(expired.job.assistantMessageId), { content: '', status: 'failed', error, runId: expired.job.jobId, updatedAt: FieldValue.serverTimestamp() }, { merge: true })
      tx.set(adminDb.collection('hermes_runs').doc(expired.job.jobId), { status: 'expired', error, completedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() }, { merge: true })
    }
    for (const recovery of recoveryRefs) {
      const requeued = requeueLinkedRunForRuntimeRecovery(recovery.job, nowMs)
      tx.update(recovery.ref, {
        ...toStored(requeued),
        leaseExpiresAt: Timestamp.fromMillis(0),
        leaseToken: FieldValue.delete(),
        claimedAt: FieldValue.delete(),
        completedAt: FieldValue.delete(),
        lastRecoverableError: 'Local Hermes is temporarily unavailable; the runtime will reconnect automatically.',
      })
      tx.set(adminDb.collection('conversations').doc(recovery.job.conversationId).collection('messages').doc(recovery.job.assistantMessageId), {
        content: '',
        status: 'queued',
        queuedReason: 'runtime_restarting',
        error: FieldValue.delete(),
        runId: recovery.job.jobId,
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true })
      tx.set(adminDb.collection('hermes_runs').doc(recovery.job.jobId), {
        status: 'queued',
        queuedReason: 'runtime_restarting',
        error: FieldValue.delete(),
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true })
    }
    if (!selected || !selectedRef) {
      if (queueOrderChanged) tx.set(queueRef, { pendingJobIds: remaining, updatedAt: FieldValue.serverTimestamp() }, { merge: true })
      return null
    }
    tx.update(selectedRef, {
      ...toStored(selected),
      // Acceptance identity and receipts belong to one lease attempt. A
      // runtime can legitimately upgrade or restart before reclaiming an
      // expired lease, so the new attempt must establish its own identity.
      ...(selectedIsRetry ? {
        acceptedRuntimeVersion: FieldValue.delete(),
        acceptedMachineLabel: FieldValue.delete(),
        acceptanceReceipt: FieldValue.delete(),
        queueReceipt: FieldValue.delete(),
      } : {}),
      ...(selectedContinuedCredentialVersion !== undefined
        ? { rotationContinuedFromCredentialVersion: selectedContinuedCredentialVersion }
        : {}),
      lastRecoverableError: FieldValue.delete(),
    })
    if (selectedContinuedCredentialVersion !== undefined) {
      tx.set(adminDb.collection('conversations').doc(selected.conversationId).collection('messages').doc(selected.assistantMessageId), {
        linkedDeviceCredentialVersion: selected.credentialVersion,
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true })
    }
    tx.set(queueRef, { pendingJobIds: [selected.jobId, ...remaining], updatedAt: FieldValue.serverTimestamp() }, { merge: true })
    return publicClaimedLinkedRun(selected, decryptLinkedRunPayload(selected.encryptedPayload!, selected.deviceId, selected.jobId))
  })
}

export async function updateLinkedRunFromDevice(input: {
  deviceId: string; ownerUserId: string; credentialVersion: number; jobId: string; receipt: LinkedRunReceipt
  event: 'queue' | 'progress' | 'complete'; outcome?: 'completed' | 'failed' | 'cancelled'; output?: string; error?: string
  events?: unknown
}, options: { nowMs?: number } = {}) {
  const nowMs = options.nowMs ?? Date.now()
  const validReceiptEvent = input.event === 'queue'
    ? input.receipt.event === 'queued'
    : input.event === 'progress'
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
    if (!isLinkedRunAccessAuthorized({
      authenticatedDeviceUserId: input.ownerUserId,
      credentialVersion: input.credentialVersion,
      ...authorization,
      job: storedJob,
    })) throw new Error('linked computers: run grant or project access revoked')
    const device = authorization.device ?? {}
    const credential = credentialSnap.data() ?? {}
    const issuedMs = timestampMs(credential.issuedAt)
    const acceptedMs = Date.parse(String(storedJob.acceptanceReceipt?.acceptedAt ?? ''))
    const rotationContinuity = hasLinkedRunCredentialRotationContinuity({
      job: storedJob,
      credentialVersion: input.credentialVersion,
      device,
      credential,
    })
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
    const safeOutput = sanitizeLinkedResult(output)
    const rawError = sanitizeLinkedResult(error)
    const recoveryCount = Number(job.recoveryCount ?? 0)
    // Safety net: never permanently fail a chat on recoverable infrastructure /
    // browser interruptions. Re-queue the same encrypted job for reclaim.
    if (
      input.event === 'complete'
      && input.outcome === 'failed'
      && isRecoverableConversationRunError(rawError)
      && recoveryCount < CONVERSATION_RUN_MAX_AUTO_RECOVERIES
      && job.encryptedPayload
    ) {
      const requeued: LinkedRunJob = {
        ...job,
        status: 'queued',
        recoveryCount: recoveryCount + 1,
        leaseExpiresAtMs: 0,
        leaseToken: undefined,
        claimedAtMs: undefined,
        completedAtMs: undefined,
        localHermesRunId: undefined,
        acceptanceReceipt: undefined,
        acceptedRuntimeVersion: undefined,
        acceptedMachineLabel: undefined,
        updatedAtMs: nowMs,
        // Keep queue start deadline open for the recovery attempt.
        queueExpiresAtMs: Math.max(job.queueExpiresAtMs, nowMs + LINKED_RUN_QUEUE_START_DEADLINE_MS),
        expiresAtMs: Math.max(job.expiresAtMs, nowMs + DEFAULT_TTL_MS),
      }
      const queueRef = adminDb.collection(LINKED_RUN_QUEUES).doc(input.deviceId)
      const queueSnap = await tx.get(queueRef)
      const pending = Array.isArray(queueSnap.data()?.pendingJobIds)
        ? (queueSnap.data()!.pendingJobIds as string[]).filter((id) => id !== job.jobId)
        : []
      tx.update(jobRef, {
        ...toStored(requeued),
        // Force reclaimable lease state (toStored omits zero/undefined lease fields).
        leaseExpiresAt: Timestamp.fromMillis(0),
        leaseToken: FieldValue.delete(),
        claimedAt: FieldValue.delete(),
        completedAt: FieldValue.delete(),
        acceptanceReceipt: FieldValue.delete(),
        acceptedRuntimeVersion: FieldValue.delete(),
        acceptedMachineLabel: FieldValue.delete(),
        localHermesRunId: FieldValue.delete(),
        receipt: FieldValue.delete(),
        finalizationState: FieldValue.delete(),
        lastRecoverableError: rawError.slice(0, 400),
        ...(rotationContinuity ? { rotationContinuedFromCredentialVersion: storedJob.credentialVersion } : {}),
      })
      tx.set(queueRef, {
        pendingJobIds: [job.jobId, ...pending],
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true })
      tx.set(adminDb.collection('conversations').doc(job.conversationId).collection('messages').doc(job.assistantMessageId), {
        content: '',
        status: 'queued',
        queuedReason: 'runtime_restarting',
        error: FieldValue.delete(),
        runId: job.jobId,
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true })
      tx.set(adminDb.collection('hermes_runs').doc(job.jobId), {
        status: 'queued',
        queuedReason: 'runtime_restarting',
        recoveryCount: requeued.recoveryCount,
        error: FieldValue.delete(),
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true })
      return requeued
    }

    const transitioned = input.event === 'queue'
      ? transitionLinkedRun(job, { type: 'queue', deviceId: input.deviceId, credentialVersion: input.credentialVersion, nowMs, attempt: input.receipt.attempt, leaseToken: input.receipt.leaseToken, leaseMs: DEFAULT_LEASE_MS })
      : input.event === 'progress'
      ? transitionLinkedRun(job, { type: 'progress', deviceId: input.deviceId, credentialVersion: input.credentialVersion, nowMs, attempt: input.receipt.attempt, leaseToken: input.receipt.leaseToken, leaseMs: DEFAULT_LEASE_MS })
      : transitionLinkedRun(job, { type: 'complete', deviceId: input.deviceId, credentialVersion: input.credentialVersion, nowMs, outcome: input.outcome ?? 'completed', attempt: input.receipt.attempt, leaseToken: input.receipt.leaseToken })
    const next = input.receipt.event === 'accepted' && !job.acceptanceReceipt
      ? { ...transitioned, expiresAtMs: nowMs + DEFAULT_TTL_MS }
      : transitioned
    const safeError = humanizeConversationRunError(rawError)
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
      ...(input.receipt.event === 'queued'
        ? { queueReceipt: input.receipt }
        : input.event === 'progress'
          ? {
              ...(input.receipt.event === 'accepted' ? { acceptanceReceipt: input.receipt } : {}),
              ...(input.receipt.localHermesRunId ? { localHermesRunId: input.receipt.localHermesRunId } : {}),
            }
          : { receipt: input.receipt, finalizationState: 'complete' }),
      output: safeOutput,
      error: safeError,
      ...(chatEvents ? { chatEvents } : {}),
    })
    if (input.event === 'queue') {
      tx.set(adminDb.collection('conversations').doc(job.conversationId).collection('messages').doc(job.assistantMessageId), {
        status: 'queued',
        queuedReason: input.receipt.queueReason,
        runId: job.jobId,
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true })
      tx.set(adminDb.collection('hermes_runs').doc(job.jobId), {
        status: 'queued', queuedReason: input.receipt.queueReason, updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true })
    } else if (input.event === 'progress') {
      tx.set(adminDb.collection('conversations').doc(job.conversationId).collection('messages').doc(job.assistantMessageId), {
        status: 'pending',
        runId: job.jobId,
        acceptedDevice: {
          deviceId: job.deviceId,
          runtimeTargetId: job.runtimeTargetId,
          acceptedAt: input.receipt.acceptedAt,
          runtimeVersion: input.receipt.runtimeVersion,
          machineLabel: input.receipt.machineLabel,
        },
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true })
      tx.set(adminDb.collection('hermes_runs').doc(job.jobId), {
        status: 'running',
        ...(input.receipt.localHermesRunId ? { localHermesRunId: input.receipt.localHermesRunId } : {}),
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true })
    } else if (input.event === 'complete') {
      const status = input.outcome === 'completed' ? 'completed' : 'failed'
      const content = status === 'completed'
        ? safeOutput
        : (safeError || `Linked computer run ${input.outcome ?? 'failed'}`)
      const messageError = status === 'failed' ? safeError : undefined
      tx.set(adminDb.collection('conversations').doc(job.conversationId).collection('messages').doc(job.assistantMessageId), {
        content: status === 'completed' ? content : '',
        status,
        ...(messageError ? { error: messageError } : { error: FieldValue.delete() }),
        runId: job.jobId,
        acceptedDevice: {
          deviceId: job.deviceId,
          runtimeTargetId: job.runtimeTargetId,
          acceptedAt: input.receipt.acceptedAt,
          runtimeVersion: input.receipt.runtimeVersion,
          machineLabel: input.receipt.machineLabel,
        },
        linkedRunReceipt: input.receipt,
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true })
      tx.set(adminDb.collection('hermes_runs').doc(job.jobId), {
        status,
        output: status === 'completed' ? content : '',
        ...(messageError ? { error: messageError } : {}),
        response: { status, receipt: input.receipt },
        updatedAt: FieldValue.serverTimestamp(),
        completedAt: FieldValue.serverTimestamp(),
      }, { merge: true })
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

export type LinkedRunResult = {
  status: 'queued' | 'running' | 'completed' | 'failed'
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
  return {
    status: job.status === 'queued' || (job.status === 'claimed' && !job.acceptanceReceipt && !job.localHermesRunId) ? 'queued' : 'running',
    runId: job.jobId,
    linkedStatus: job.status,
  }
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
