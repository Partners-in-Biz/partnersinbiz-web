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
import {
  presenceFromRunStatus,
  publishAgentPresence,
} from '@/lib/messages/agent-presence'
import type { ChatEvent } from '@/lib/hermes/types'

export const LINKED_RUN_JOBS = 'linked_device_run_jobs'
export const LINKED_RUN_QUEUES = 'linked_device_run_queues'
export const LINKED_RUN_AGENT_LEASES = 'linked_device_run_agent_leases'
const DEFAULT_LEASE_MS = 90_000
const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000
export const LINKED_RUN_QUEUE_START_DEADLINE_MS = 45 * 60 * 1000
const LINKED_RUN_CLAIM_SCAN_LIMIT = 64
const CLAIM_AGENT_ID = /^[a-z][a-z0-9._-]{0,39}$/
export const LINKED_RUN_MAX_CONCURRENCY_PER_AGENT = 10
const AGENT_LEASE_JOB_ID = /^[A-Za-z0-9_-]{1,128}$/

export type LinkedRunClaimOptions = {
  nowMs?: number
  leaseMs?: number
  /** Local Hermes profiles already at their bounded session capacity. */
  saturatedAgentIds?: readonly string[]
}

function normalizedSaturatedAgentIds(agentIds: readonly string[] | undefined): Set<string> {
  return new Set((agentIds ?? []).flatMap((value) => {
    const agentId = typeof value === 'string' ? value.trim().toLowerCase() : ''
    return CLAIM_AGENT_ID.test(agentId) ? [agentId] : []
  }))
}

function normalizedAgentLeaseAgentId(value: unknown): string {
  const agentId = typeof value === 'string' ? value.trim().toLowerCase() : ''
  if (!CLAIM_AGENT_ID.test(agentId)) throw new Error('linked computers: invalid run agent')
  return agentId
}

export function linkedRunAgentLeaseDocumentId(deviceId: string, agentId: string): string {
  return crypto.createHash('sha256').update(`linked-run-agent-lease:v1\n${deviceId}\n${agentId}`).digest('base64url')
}

type AgentMaintenanceLease = {
  agentHostJobId: string
  leaseTokenHash: string
  expiresAtMs: number
}

type AgentLeaseState = {
  ref: FirebaseFirestore.DocumentReference
  deviceId: string
  agentId: string
  leases: Map<string, number>
  maintenance?: AgentMaintenanceLease
  exists: boolean
  dirty: boolean
}

type AgentLeaseBootstrap = Pick<LinkedRunJob, 'jobId' | 'agentId' | 'status' | 'leaseExpiresAtMs'>

function parseAgentLeaseEntries(value: unknown, nowMs: number): { leases: Map<string, number>; dirty: boolean } {
  const row = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
  const leases = new Map<string, number>()
  let dirty = false
  for (const [jobId, rawExpiry] of Object.entries(row)) {
    const expiry = Number(rawExpiry)
    if (!AGENT_LEASE_JOB_ID.test(jobId) || !Number.isSafeInteger(expiry) || expiry <= nowMs) {
      dirty = true
      continue
    }
    leases.set(jobId, expiry)
  }
  return { leases, dirty }
}

function parseAgentMaintenanceLease(value: unknown, nowMs: number): { maintenance?: AgentMaintenanceLease; dirty: boolean } {
  if (!value) return { dirty: false }
  if (typeof value !== 'object' || Array.isArray(value)) return { dirty: true }
  const row = value as Record<string, unknown>
  const agentHostJobId = typeof row.agentHostJobId === 'string' ? row.agentHostJobId : ''
  const leaseTokenHash = typeof row.leaseTokenHash === 'string' ? row.leaseTokenHash : ''
  const expiresAtMs = Number(row.expiresAtMs)
  if (!AGENT_LEASE_JOB_ID.test(agentHostJobId)
    || !/^[a-f0-9]{64}$/i.test(leaseTokenHash)
    || !Number.isSafeInteger(expiresAtMs)
    || expiresAtMs <= nowMs) {
    return { dirty: true }
  }
  return { maintenance: { agentHostJobId, leaseTokenHash, expiresAtMs }, dirty: false }
}

function activeBootstrapLeases(agentId: string, jobs: readonly AgentLeaseBootstrap[], nowMs: number): Map<string, number> {
  const leases = new Map<string, number>()
  for (const job of jobs) {
    if (normalizedAgentLeaseAgentId(job.agentId) !== agentId) continue
    const expiry = Number(job.leaseExpiresAtMs)
    if (!['claimed', 'running'].includes(job.status) || !AGENT_LEASE_JOB_ID.test(job.jobId)
      || !Number.isSafeInteger(expiry) || expiry <= nowMs) continue
    leases.set(job.jobId, expiry)
  }
  return leases
}

async function loadAgentLeaseState(
  tx: FirebaseFirestore.Transaction,
  states: Map<string, AgentLeaseState>,
  deviceId: string,
  rawAgentId: unknown,
  nowMs: number,
  bootstrap: readonly AgentLeaseBootstrap[] = [],
): Promise<AgentLeaseState> {
  const agentId = normalizedAgentLeaseAgentId(rawAgentId)
  const key = `${deviceId}\n${agentId}`
  const cached = states.get(key)
  if (cached) return cached
  const ref = adminDb.collection(LINKED_RUN_AGENT_LEASES).doc(linkedRunAgentLeaseDocumentId(deviceId, agentId))
  const snapshot = await tx.get(ref)
  const data = snapshot.exists ? snapshot.data() as Record<string, unknown> : {}
  const hasLeaseMap = data.leases && typeof data.leases === 'object' && !Array.isArray(data.leases)
  const parsed = parseAgentLeaseEntries(data.leases, nowMs)
  const maintenance = parseAgentMaintenanceLease(data.maintenance, nowMs)
  // On first deployment there is no ledger. Active leases are kept at the
  // head of the bounded queue scan, which allows the first claim to seed the
  // counter without granting extra slots to an already-running profile.
  if (!snapshot.exists || !hasLeaseMap) {
    for (const [jobId, expiry] of activeBootstrapLeases(agentId, bootstrap, nowMs)) {
      if (!parsed.leases.has(jobId)) parsed.leases.set(jobId, expiry)
    }
  }
  const state: AgentLeaseState = {
    ref,
    deviceId,
    agentId,
    leases: parsed.leases,
    maintenance: maintenance.maintenance,
    exists: snapshot.exists,
    dirty: parsed.dirty || maintenance.dirty || !snapshot.exists || !hasLeaseMap,
  }
  states.set(key, state)
  return state
}

function reserveAgentLease(state: AgentLeaseState, jobId: string, expiresAtMs: number): boolean {
  if (state.leases.size >= LINKED_RUN_MAX_CONCURRENCY_PER_AGENT) return false
  state.leases.set(jobId, expiresAtMs)
  state.dirty = true
  return true
}

function renewAgentLease(state: AgentLeaseState, jobId: string, expiresAtMs: number): void {
  state.leases.set(jobId, expiresAtMs)
  state.dirty = true
}

function releaseAgentLease(state: AgentLeaseState, jobId: string): void {
  if (state.leases.delete(jobId)) state.dirty = true
}

function persistAgentLeaseStates(tx: FirebaseFirestore.Transaction, states: Iterable<AgentLeaseState>): void {
  for (const state of states) {
    if (!state.dirty) continue
    const stored = {
      deviceId: state.deviceId,
      agentId: state.agentId,
      // Update the map as one top-level field. A Firestore `{ merge: true }`
      // map merge keeps omitted nested keys, which would otherwise retain
      // released leases forever while another chat is active.
      leases: Object.fromEntries(state.leases),
      ...(state.maintenance ? { maintenance: state.maintenance } : { maintenance: FieldValue.delete() }),
      updatedAt: FieldValue.serverTimestamp(),
    }
    if (state.exists) tx.update(state.ref, stored)
    else tx.set(state.ref, {
      deviceId: state.deviceId,
      agentId: state.agentId,
      leases: Object.fromEntries(state.leases),
      ...(state.maintenance ? { maintenance: state.maintenance } : {}),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: false })
  }
}

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

function currentStepFromChatEvents(events: ChatEvent[]): string | undefined {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (event?.event !== 'tool.started') continue
    if (typeof event.activity === 'string' && event.activity.trim()) return event.activity.trim()
    if (typeof event.tool === 'string' && event.tool.trim()) return `Using ${event.tool.trim()}`
  }
  return undefined
}

function publishPresenceForLinkedJob(
  job: Pick<LinkedRunJob, 'orgId' | 'agentId' | 'conversationId' | 'deviceId'>,
  status: string,
  currentStep?: string,
): void {
  const mapped = presenceFromRunStatus(status, currentStep)
  if (!mapped) return
  publishAgentPresence({
    orgId: job.orgId,
    agentId: job.agentId,
    conversationId: job.conversationId,
    deviceId: job.deviceId,
    state: mapped.state,
    currentStep: mapped.currentStep,
  })
}

export async function enqueueLinkedRun(input: {
  requestId: string; deviceId: string; runtimeTargetId: string; orgId: string; actorUserId: string; workspaceId: string; projectId?: string; projectReplicaId?: string
  mappingId: string; relativeFolder: string; workingDirectory?: string; credentialVersion: number; payload: LinkedRunPayload
  /** Internal watcher task identity only; never supplied by ordinary chat clients. */
  kanbanTaskId?: string
  conversationId: string; assistantMessageId: string; agentId: string; delegationId?: string
  queuedReason?: 'runtime_restarting'
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
      ...(input.queuedReason ? { queuedReason: input.queuedReason } : {}),
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
      ...(input.queuedReason ? { queuedReason: input.queuedReason } : {}),
      createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
    })
  })
  publishPresenceForLinkedJob(job, 'queued')
  return job
}

export async function claimOldestLinkedRun(input: { deviceId: string; ownerUserId: string; credentialVersion: number }, options: LinkedRunClaimOptions = {}) {
  const nowMs = options.nowMs ?? Date.now()
  const saturatedAgentIds = normalizedSaturatedAgentIds(options.saturatedAgentIds)
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
    const agentLeaseStates = new Map<string, AgentLeaseState>()
    const observedActiveLeases: AgentLeaseBootstrap[] = []
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
      if (['claimed', 'running'].includes(current.status) && (current.leaseExpiresAtMs ?? 0) > nowMs) {
        observedActiveLeases.push(current)
      }
      if (current.expiresAtMs <= nowMs) {
        expiredRefs.push({ ref, job: current, reason: 'ttl' })
        continue
      }
      if (linkedRunQueueStartExpired(current, nowMs)) {
        expiredRefs.push({ ref, job: current, reason: 'queue_start' })
        continue
      }
      // Do not lease an eleventh conversation to a profile that the signed
      // runtime has already reserved to its local Hermes limit. Preserve this
      // job in order and continue the fair scan so another healthy profile can
      // work instead of being blocked behind it.
      if (saturatedAgentIds.has(String(current.agentId ?? '').trim().toLowerCase())) {
        candidateSurvivors.push(id)
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
        const device = authorization.device ?? {}
        const credential = authorization.credential ?? {}
        // The current runtime request has already proven possession of the
        // device key and current credential. If every durable authorization
        // boundary still matches, an interrupted job may be reclaimed by that
        // same device even after more than one legitimate credential rotation.
        // This preserves the saved local Hermes run id for reattachment; it
        // does not accept work from an old credential or a changed device.
        const credentialRebindAuthorized = current.credentialVersion !== input.credentialVersion
          && Number(device.credentialVersion) === input.credentialVersion
          && Number(credential.credentialVersion) === input.credentialVersion
          && !credential.revokedAt
          && isLinkedRunAccessAuthorized({
            authenticatedDeviceUserId: input.ownerUserId,
            credentialVersion: input.credentialVersion,
            ...authorization,
            job: current,
          })
        if (current.credentialVersion !== input.credentialVersion && !credentialRotationContinued && !credentialRebindAuthorized) {
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
        const agentLeaseState = await loadAgentLeaseState(
          tx,
          agentLeaseStates,
          input.deviceId,
          current.agentId,
          nowMs,
          observedActiveLeases,
        )
        // A credential rotation holds an atomic, short-lived maintenance
        // lease only after this profile is truly idle. Do not race a newly
        // arriving chat into a profile while that targeted reload is pending.
        if (agentLeaseState.maintenance) {
          candidateSurvivors.push(id)
          continue
        }
        if (!reserveAgentLease(agentLeaseState, current.jobId, nowMs + (options.leaseMs ?? DEFAULT_LEASE_MS))) {
          candidateSurvivors.push(id)
          continue
        }
        selectedIsRetry = current.attempt > 0
        const claimable = credentialRotationContinued || credentialRebindAuthorized
          ? { ...current, credentialVersion: input.credentialVersion }
          : current
        if (credentialRotationContinued || credentialRebindAuthorized) selectedContinuedCredentialVersion = current.credentialVersion
        selected = transitionLinkedRun(claimable, { type: 'claim', ...input, nowMs, leaseMs: options.leaseMs ?? DEFAULT_LEASE_MS })
        selectedRef = ref
      } else candidateSurvivors.push(id)
    }
    const remaining = selected
      ? [...candidateSurvivors, ...recoveringCandidates, ...untouchedTail]
      : [...candidateSurvivors, ...untouchedTail, ...recoveringCandidates]
    const queueOrderChanged = remaining.length !== ids.length || remaining.some((id, index) => id !== ids[index])
    // Terminal expiry and runtime-recovery transitions can happen while a
    // lease still has time left. Free that profile slot in this transaction
    // rather than making the next chat wait for an obsolete 90-second lease.
    for (const job of [...expiredRefs, ...recoveryRefs].map((entry) => entry.job)) {
      if (!['claimed', 'running'].includes(job.status)) continue
      const agentLeaseState = await loadAgentLeaseState(
        tx,
        agentLeaseStates,
        job.deviceId,
        job.agentId,
        nowMs,
        [job],
      )
      releaseAgentLease(agentLeaseState, job.jobId)
    }
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
      persistAgentLeaseStates(tx, agentLeaseStates.values())
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
    persistAgentLeaseStates(tx, agentLeaseStates.values())
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
    const agentLeaseStates = new Map<string, AgentLeaseState>()
    const agentLeaseState = await loadAgentLeaseState(
      tx,
      agentLeaseStates,
      input.deviceId,
      job.agentId,
      nowMs,
      [job],
    )
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
      releaseAgentLease(agentLeaseState, job.jobId)
      persistAgentLeaseStates(tx, agentLeaseStates.values())
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
    const queuedReason = input.receipt.queueReason
      ? { queuedReason: input.receipt.queueReason }
      : { queuedReason: FieldValue.delete() }
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
    if (input.event === 'complete') releaseAgentLease(agentLeaseState, job.jobId)
    else renewAgentLease(agentLeaseState, job.jobId, next.leaseExpiresAtMs ?? (nowMs + DEFAULT_LEASE_MS))
    persistAgentLeaseStates(tx, agentLeaseStates.values())
    if (input.event === 'queue') {
      tx.set(adminDb.collection('conversations').doc(job.conversationId).collection('messages').doc(job.assistantMessageId), {
        status: 'queued',
        ...queuedReason,
        runId: job.jobId,
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true })
      tx.set(adminDb.collection('hermes_runs').doc(job.jobId), {
        status: 'queued', ...queuedReason, updatedAt: FieldValue.serverTimestamp(),
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
  const toolStep = input.event === 'progress' ? currentStepFromChatEvents(incomingEvents) : undefined
  publishPresenceForLinkedJob(result, result.status, toolStep)
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
    const agentLeaseStates = new Map<string, AgentLeaseState>()
    const agentLeaseState = ['claimed', 'running'].includes(job.status)
      ? await loadAgentLeaseState(tx, agentLeaseStates, job.deviceId, job.agentId, Date.now(), [job])
      : null
    const error = sanitizeLinkedResult(reason.slice(0, 500))
    tx.update(ref, { status: 'cancelled', encryptedPayload: null, error, finalizationState: 'complete', completedAt: FieldValue.serverTimestamp(), cleanupAt: Timestamp.fromMillis(Date.now() + DEFAULT_TTL_MS), updatedAt: FieldValue.serverTimestamp() })
    tx.set(queueRef, { pendingJobIds: ids.filter((id) => id !== jobIdValue), updatedAt: FieldValue.serverTimestamp() }, { merge: true })
    if (agentLeaseState) {
      releaseAgentLease(agentLeaseState, job.jobId)
      persistAgentLeaseStates(tx, agentLeaseStates.values())
    }
    tx.set(adminDb.collection('conversations').doc(job.conversationId).collection('messages').doc(job.assistantMessageId), { content: '', status: 'failed', error: 'The linked computer run was cancelled.', runId: job.jobId, updatedAt: FieldValue.serverTimestamp() }, { merge: true })
    tx.set(adminDb.collection('hermes_runs').doc(job.jobId), { status: 'cancelled', error: 'The linked computer run was cancelled.', updatedAt: FieldValue.serverTimestamp(), completedAt: FieldValue.serverTimestamp() }, { merge: true })
    return { won: true, status: 'cancelled' as const }
  })
}
