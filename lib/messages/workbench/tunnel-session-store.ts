import crypto from 'node:crypto'
import { FieldValue, Timestamp } from 'firebase-admin/firestore'
import { conversationProjectId } from '@/lib/conversations/access'
import type { Conversation } from '@/lib/conversations/types'
import { adminDb } from '@/lib/firebase/admin'
import { isLinkedRunClaimAuthorized } from '@/lib/linked-computers/run-queue-store'
import { sanitizeLinkedResult } from '@/lib/linked-computers/run-queue'
import { projectOrganizationDocId } from '@/lib/projects/collaboration'
import { canonicalWorkbenchWorkspaceRelativePath } from './jobs'
import {
  appendWorkbenchTunnelControl,
  appendWorkbenchTunnelProgressChunk,
  decryptWorkbenchTunnelValue,
  encryptWorkbenchTunnelValue,
  isTerminalWorkbenchTunnelStatus,
  parseWorkbenchTunnelProgressChunk,
  transitionWorkbenchTunnelSession,
  WORKBENCH_TUNNEL_BIND_HOST,
  WORKBENCH_TUNNEL_DEFAULT_PROVIDER,
  type WorkbenchTunnelControl,
  type WorkbenchTunnelProgressChunk,
  type WorkbenchTunnelProvider,
  type WorkbenchTunnelQueuedControl,
  type WorkbenchTunnelSession,
  type WorkbenchTunnelStatus,
} from './tunnel-sessions'

export const WORKBENCH_TUNNEL_SESSIONS_COLLECTION = 'conversation_workbench_tunnel_sessions'
export const WORKBENCH_TUNNEL_QUEUES_COLLECTION = 'linked_device_workbench_tunnel_queues'
const DEFAULT_LEASE_MS = 90_000
const DEFAULT_TTL_MS = 30 * 60 * 1000
const CLEANUP_RETENTION_MS = 24 * 60 * 60 * 1000
const MAX_DEVICE_TUNNEL_QUEUE = 20

function timestampMs(value: unknown): number {
  if (value && typeof (value as { toMillis?: () => number }).toMillis === 'function') {
    return (value as { toMillis(): number }).toMillis()
  }
  const number = Number(value)
  return Number.isFinite(number) ? number : 0
}

function fromStored(sessionId: string, row: Record<string, unknown>): WorkbenchTunnelSession {
  return {
    ...row,
    sessionId,
    createdAtMs: timestampMs(row.createdAt),
    updatedAtMs: timestampMs(row.updatedAt),
    ttlExpiresAtMs: timestampMs(row.ttlExpiresAt),
    ...(row.leaseExpiresAt ? { leaseExpiresAtMs: timestampMs(row.leaseExpiresAt) } : {}),
    ...(row.claimedAt ? { claimedAtMs: timestampMs(row.claimedAt) } : {}),
    ...(row.approvedAt ? { approvedAtMs: timestampMs(row.approvedAt) } : {}),
    ...(row.completedAt ? { completedAtMs: timestampMs(row.completedAt) } : {}),
  } as unknown as WorkbenchTunnelSession
}

function toStored(session: WorkbenchTunnelSession): Record<string, unknown> {
  const {
    createdAtMs, updatedAtMs, ttlExpiresAtMs, leaseExpiresAtMs, claimedAtMs, approvedAtMs, completedAtMs,
    pendingControls: _pendingControls, progressChunks: _progressChunks, ...row
  } = session
  return {
    ...row,
    createdAt: Timestamp.fromMillis(createdAtMs),
    updatedAt: Timestamp.fromMillis(updatedAtMs),
    ttlExpiresAt: Timestamp.fromMillis(ttlExpiresAtMs),
    cleanupAt: Timestamp.fromMillis(ttlExpiresAtMs + CLEANUP_RETENTION_MS),
    ...(leaseExpiresAtMs ? { leaseExpiresAt: Timestamp.fromMillis(leaseExpiresAtMs) } : {}),
    ...(claimedAtMs ? { claimedAt: Timestamp.fromMillis(claimedAtMs) } : {}),
    ...(approvedAtMs ? { approvedAt: Timestamp.fromMillis(approvedAtMs) } : {}),
    ...(completedAtMs ? { completedAt: Timestamp.fromMillis(completedAtMs) } : {}),
  }
}

function hydrate(session: WorkbenchTunnelSession): WorkbenchTunnelSession {
  const pendingControls = session.encryptedControls
    ? decryptWorkbenchTunnelValue<WorkbenchTunnelQueuedControl[]>(session.encryptedControls, session.deviceId, session.sessionId, 'control')
    : undefined
  const progressChunks = session.encryptedProgress
    ? decryptWorkbenchTunnelValue<WorkbenchTunnelProgressChunk[]>(session.encryptedProgress, session.deviceId, session.sessionId, 'progress')
    : undefined
  return {
    ...session,
    ...(pendingControls ? { pendingControls } : {}),
    ...(progressChunks ? { progressChunks } : {}),
  }
}

function sessionRef(sessionId: string) {
  return adminDb.collection(WORKBENCH_TUNNEL_SESSIONS_COLLECTION).doc(sessionId)
}

function queueRef(deviceId: string) {
  return adminDb.collection(WORKBENCH_TUNNEL_QUEUES_COLLECTION).doc(deviceId)
}

/**
 * Pointer doc tracking "the currently active tunnel" per conversation, same
 * `pointer:` prefix trick `session-store.ts` uses to enforce one active
 * session per conversation without a Firestore composite index. Tunnel ids
 * are always prefixed `wbt_`, so there is no collision with the pointer id.
 */
function pointerRef(conversationId: string) {
  return adminDb.collection(WORKBENCH_TUNNEL_SESSIONS_COLLECTION).doc(`pointer:${conversationId}`)
}

export interface CreateWorkbenchTunnelSessionInput {
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
  port: number
}

/** Always starts `awaiting_approval` — a tunnel briefly exposes a local port to the public internet. */
export async function createTunnelSession(
  input: CreateWorkbenchTunnelSessionInput,
  options: { nowMs?: number; ttlMs?: number } = {},
): Promise<WorkbenchTunnelSession> {
  const nowMs = options.nowMs ?? Date.now()
  const ttlMs = options.ttlMs ?? DEFAULT_TTL_MS
  const sessionId = `wbt_${crypto.randomBytes(18).toString('base64url')}`

  return adminDb.runTransaction(async (transaction) => {
    const pRef = pointerRef(input.conversationId)
    const pointerSnapshot = await transaction.get(pRef)

    const activeSessionId = typeof pointerSnapshot.data()?.activeSessionId === 'string'
      ? pointerSnapshot.data()!.activeSessionId as string
      : null
    if (activeSessionId) {
      const activeSnapshot = await transaction.get(sessionRef(activeSessionId))
      if (activeSnapshot.exists) {
        const active = fromStored(activeSnapshot.id, activeSnapshot.data() ?? {})
        if (!isTerminalWorkbenchTunnelStatus(active.status) && active.ttlExpiresAtMs > nowMs) {
          throw new Error('workbench: tunnel already active')
        }
      }
    }

    const session: WorkbenchTunnelSession = {
      ...input,
      sessionId,
      bindHost: WORKBENCH_TUNNEL_BIND_HOST,
      provider: WORKBENCH_TUNNEL_DEFAULT_PROVIDER,
      status: 'awaiting_approval',
      attempt: 0,
      encryptedCreateControl: encryptWorkbenchTunnelValue(
        { kind: 'create', port: input.port, bindHost: WORKBENCH_TUNNEL_BIND_HOST, provider: WORKBENCH_TUNNEL_DEFAULT_PROVIDER },
        input.deviceId, sessionId, 'create',
      ),
      createdAtMs: nowMs,
      updatedAtMs: nowMs,
      ttlExpiresAtMs: nowMs + ttlMs,
    }
    transaction.create(sessionRef(sessionId), toStored(session))
    transaction.set(pRef, {
      conversationId: input.conversationId, activeSessionId: sessionId, updatedAt: FieldValue.serverTimestamp(),
    })
    return { ...session, pendingControls: [] }
  })
}

export async function getTunnelSession(sessionId: string): Promise<WorkbenchTunnelSession | null> {
  if (sessionId.startsWith('pointer:')) return null
  const snapshot = await sessionRef(sessionId).get()
  if (!snapshot.exists) return null
  return hydrate(fromStored(snapshot.id, snapshot.data() ?? {}))
}

/** Exact durable binding every tunnel mutation re-checks, mirroring `WorkbenchSessionBinding` in `session-store.ts`. */
export interface WorkbenchTunnelSessionBinding {
  conversationId: string
  orgId: string
  actorUserId: string
  deviceId: string
  runtimeTargetId: string
  credentialVersion: number
  workspaceId: string
  mappingId: string
  projectId?: string
  projectReplicaId?: string
  relativeFolder: string
}

function tunnelBindingMatches(session: WorkbenchTunnelSession, input: WorkbenchTunnelSessionBinding): boolean {
  return session.conversationId === input.conversationId
    && session.orgId === input.orgId
    && session.actorUserId === input.actorUserId
    && session.deviceId === input.deviceId
    && session.runtimeTargetId === input.runtimeTargetId
    && session.credentialVersion === input.credentialVersion
    && session.workspaceId === input.workspaceId
    && session.mappingId === input.mappingId
    && (session.projectId ?? null) === (input.projectId ?? null)
    && (session.projectReplicaId ?? null) === (input.projectReplicaId ?? null)
    && session.relativeFolder === input.relativeFolder
}

export interface ApproveTunnelSessionInput extends WorkbenchTunnelSessionBinding {
  sessionId: string
  approverUserId: string
}

/** Approves an `awaiting_approval` tunnel, moving it to `queued` and enqueuing its create control for the device. */
export async function approveTunnelSession(
  input: ApproveTunnelSessionInput,
  options: { nowMs?: number } = {},
): Promise<WorkbenchTunnelSession> {
  const nowMs = options.nowMs ?? Date.now()
  return adminDb.runTransaction(async (transaction) => {
    const sRef = sessionRef(input.sessionId)
    const qRef = queueRef(input.deviceId)
    const [snapshot, queueSnapshot] = await Promise.all([transaction.get(sRef), transaction.get(qRef)])
    if (!snapshot.exists) throw new Error('workbench: tunnel not found')
    const session = fromStored(snapshot.id, snapshot.data() ?? {})
    if (!tunnelBindingMatches(session, input)) throw new Error('workbench: tunnel binding mismatch')
    if (session.status === 'queued' && session.approvedByUserId === input.approverUserId) return hydrate(session)

    const approved = transitionWorkbenchTunnelSession(session, { type: 'approve', approverUserId: input.approverUserId, nowMs })
    const pendingSessionIds = Array.isArray(queueSnapshot.data()?.pendingSessionIds)
      ? queueSnapshot.data()!.pendingSessionIds as string[]
      : []
    if (pendingSessionIds.length >= MAX_DEVICE_TUNNEL_QUEUE) throw new Error('workbench: device tunnel queue full')
    transaction.update(sRef, toStored(approved))
    transaction.set(qRef, {
      deviceId: input.deviceId,
      pendingSessionIds: pendingSessionIds.includes(input.sessionId) ? pendingSessionIds : [...pendingSessionIds, input.sessionId],
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true })
    return hydrate(approved)
  })
}

export interface EnqueueTunnelKillInput extends WorkbenchTunnelSessionBinding {
  sessionId: string
}

/**
 * Kills a tunnel. An `awaiting_approval`/`queued` tunnel (never claimed by a
 * device — no live process exists yet) transitions straight to `killed`; a
 * `claimed`/`running` tunnel gets a `kill` control enqueued for its owning
 * device to deliver to the provider process.
 */
export async function enqueueTunnelKill(input: EnqueueTunnelKillInput, options: { nowMs?: number } = {}): Promise<WorkbenchTunnelSession> {
  const nowMs = options.nowMs ?? Date.now()
  return adminDb.runTransaction(async (transaction) => {
    const sRef = sessionRef(input.sessionId)
    const qRef = queueRef(input.deviceId)
    const [snapshot, queueSnapshot] = await Promise.all([transaction.get(sRef), transaction.get(qRef)])
    if (!snapshot.exists) throw new Error('workbench: tunnel not found')
    const session = fromStored(snapshot.id, snapshot.data() ?? {})
    if (!tunnelBindingMatches(session, input)) throw new Error('workbench: tunnel binding mismatch')
    const pendingSessionIds = Array.isArray(queueSnapshot.data()?.pendingSessionIds)
      ? queueSnapshot.data()!.pendingSessionIds as string[]
      : []

    if (session.status === 'awaiting_approval' || session.status === 'queued') {
      const killed = transitionWorkbenchTunnelSession(session, { type: 'killQueued', nowMs })
      transaction.update(sRef, toStored(killed))
      transaction.set(qRef, {
        pendingSessionIds: pendingSessionIds.filter((id) => id !== session.sessionId),
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true })
      return hydrate(killed)
    }
    if (session.status !== 'claimed' && session.status !== 'running') throw new Error('workbench: tunnel not running')

    const existingControls = session.encryptedControls
      ? decryptWorkbenchTunnelValue<WorkbenchTunnelQueuedControl[]>(session.encryptedControls, session.deviceId, session.sessionId, 'control')
      : []
    const nextSeq = (existingControls.at(-1)?.seq ?? -1) + 1
    const nextControls = appendWorkbenchTunnelControl(existingControls, {
      seq: nextSeq, control: { kind: 'kill' }, actorUserId: input.actorUserId, enqueuedAtMs: nowMs,
    })
    const next: WorkbenchTunnelSession = {
      ...session,
      encryptedControls: encryptWorkbenchTunnelValue(nextControls, session.deviceId, session.sessionId, 'control'),
      updatedAtMs: nowMs,
    }
    transaction.update(sRef, toStored(next))
    transaction.set(qRef, {
      deviceId: session.deviceId,
      pendingSessionIds: pendingSessionIds.includes(session.sessionId) ? pendingSessionIds : [...pendingSessionIds, session.sessionId],
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true })
    return hydrate({ ...next, pendingControls: nextControls })
  })
}

export interface WorkbenchTunnelStoredAuthorization {
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

/**
 * Same shape/checks as `isWorkbenchSessionClaimAuthorized` in
 * `session-store.ts` — re-verified before every claim/progress/complete
 * call so a revoked grant/mapping/membership stops an in-flight tunnel
 * immediately.
 */
export function isWorkbenchTunnelClaimAuthorized(input: {
  authenticatedDeviceUserId: string
  credentialVersion: number
  authorization: WorkbenchTunnelStoredAuthorization
  session: WorkbenchTunnelSession
}): boolean {
  const { authorization, session } = input
  const conversation = authorization.conversation
  if (!conversation || String(conversation.id ?? '') !== session.conversationId || conversation.orgId !== session.orgId) return false
  if (!activeMembership(authorization.actorMember, session.orgId, session.actorUserId)) return false
  const participantUids = Array.isArray(conversation.participantUids) ? conversation.participantUids : []
  const workspaceContext = conversation.workspaceContext && typeof conversation.workspaceContext === 'object'
    ? conversation.workspaceContext as Record<string, unknown>
    : undefined
  if (!participantUids.includes(session.actorUserId) && workspaceContext?.shareMode !== 'org') return false
  if (workspaceContext?.orgId !== session.orgId
    || workspaceContext?.workspaceId !== session.workspaceId
    || workspaceContext?.mappingId !== session.mappingId) return false
  if (workspaceContext?.runtimeTarget !== session.runtimeTargetId && workspaceContext?.runtimeTarget !== session.deviceId) return false
  if ((conversationProjectId(conversation as unknown as Conversation) ?? null) !== (session.projectId ?? null)) return false
  if (!session.projectId) {
    const currentRelativeFolder = canonicalWorkbenchWorkspaceRelativePath(workspaceContext?.folderRelativePath)
    if (currentRelativeFolder !== session.relativeFolder) return false
  }
  if (!session.approvedAtMs || session.approvedByUserId !== session.actorUserId) return false

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
    job: session,
  })
}

async function loadAuthorization(
  transaction: FirebaseFirestore.Transaction,
  session: WorkbenchTunnelSession,
): Promise<WorkbenchTunnelStoredAuthorization> {
  const [device, grant, mapping, actorMember, conversation] = await Promise.all([
    transaction.get(adminDb.collection('linked_devices').doc(session.deviceId)),
    transaction.get(adminDb.collection('linked_device_grants').doc(`${session.orgId}_${session.deviceId}`)),
    transaction.get(adminDb.collection('linked_device_workspace_mappings').doc(session.mappingId)),
    transaction.get(adminDb.collection('orgMembers').doc(`${session.orgId}_${session.actorUserId}`)),
    transaction.get(adminDb.collection('conversations').doc(session.conversationId)),
  ])
  let project: FirebaseFirestore.DocumentSnapshot | null = null
  let projectOrganization: FirebaseFirestore.DocumentSnapshot | null = null
  let projectReplica: FirebaseFirestore.DocumentSnapshot | null = null
  if (session.projectId && session.projectReplicaId) {
    ;[project, projectOrganization, projectReplica] = await Promise.all([
      transaction.get(adminDb.collection('projects').doc(session.projectId)),
      transaction.get(adminDb.collection('projectOrganizations').doc(projectOrganizationDocId(session.projectId, session.orgId))),
      transaction.get(adminDb.collection('project_location_replicas').doc(session.projectReplicaId)),
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
  authorization: WorkbenchTunnelStoredAuthorization,
  orgId: string,
  deviceActorUserId: string,
): Promise<WorkbenchTunnelStoredAuthorization> {
  const snapshot = await transaction.get(adminDb.collection('orgMembers').doc(`${orgId}_${deviceActorUserId}`))
  return { ...authorization, deviceMember: snapshot.exists ? snapshot.data() ?? {} : undefined }
}

/**
 * Claim payload returned to a device worker's
 * `POST .../workbench/tunnel/sessions/claim` poll. `kind: 'create'` is
 * returned at most once per tunnel (spawns the provider process); `kind:
 * 'control'` delivers the queued `kill` control for a tunnel the device
 * already owns and is running.
 */
export type WorkbenchTunnelClaim =
  | {
      kind: 'create'
      sessionId: string
      port: number
      bindHost: typeof WORKBENCH_TUNNEL_BIND_HOST
      provider: WorkbenchTunnelProvider
      workspaceId: string
      mappingId: string
      relativeFolder: string
      attempt: number
      leaseToken: string
    }
  | {
      kind: 'control'
      sessionId: string
      control: Exclude<WorkbenchTunnelControl, { kind: 'create' }>
      attempt: number
      leaseToken: string
    }

export async function claimOldestWorkbenchTunnelWork(
  input: { deviceId: string; ownerUserId: string; credentialVersion: number },
  options: { nowMs?: number; leaseMs?: number } = {},
): Promise<WorkbenchTunnelClaim | null> {
  const nowMs = options.nowMs ?? Date.now()
  const leaseMs = options.leaseMs ?? DEFAULT_LEASE_MS
  return adminDb.runTransaction(async (transaction) => {
    const qRef = queueRef(input.deviceId)
    const queueSnapshot = await transaction.get(qRef)
    const ids = Array.isArray(queueSnapshot.data()?.pendingSessionIds) ? queueSnapshot.data()!.pendingSessionIds as string[] : []
    const candidates = ids.slice(0, 12)
    const tail = ids.slice(12)
    const survivors: string[] = []
    const expired: Array<{ ref: FirebaseFirestore.DocumentReference; session: WorkbenchTunnelSession }> = []
    let claim: WorkbenchTunnelClaim | null = null
    let claimedRef: FirebaseFirestore.DocumentReference | null = null
    let claimedSession: WorkbenchTunnelSession | null = null

    for (const id of candidates) {
      const ref = sessionRef(id)
      const snapshot = await transaction.get(ref)
      if (!snapshot.exists) continue
      const session = fromStored(snapshot.id, snapshot.data() ?? {})
      if (session.deviceId !== input.deviceId || isTerminalWorkbenchTunnelStatus(session.status)) continue
      if (session.ttlExpiresAtMs <= nowMs) { expired.push({ ref, session }); continue }
      if (claim) { survivors.push(id); continue }

      if (session.status === 'queued') {
        const baseAuthorization = await loadAuthorization(transaction, session)
        const authorization = await withDeviceMembership(transaction, baseAuthorization, session.orgId, input.ownerUserId)
        if (!isWorkbenchTunnelClaimAuthorized({
          authenticatedDeviceUserId: input.ownerUserId, credentialVersion: input.credentialVersion, authorization, session,
        })) {
          expired.push({ ref, session })
          continue
        }
        const createControl = decryptWorkbenchTunnelValue<Extract<WorkbenchTunnelControl, { kind: 'create' }>>(
          session.encryptedCreateControl!, session.deviceId, session.sessionId, 'create',
        )
        const claimed = transitionWorkbenchTunnelSession(session, {
          type: 'claimCreate', deviceId: input.deviceId, credentialVersion: input.credentialVersion, nowMs, leaseMs,
        })
        claim = {
          kind: 'create', sessionId: claimed.sessionId, port: createControl.port, bindHost: createControl.bindHost,
          provider: createControl.provider, workspaceId: claimed.workspaceId, mappingId: claimed.mappingId,
          relativeFolder: claimed.relativeFolder, attempt: claimed.attempt, leaseToken: claimed.leaseToken!,
        }
        claimedRef = ref
        claimedSession = claimed
        survivors.push(id)
        continue
      }

      // claimed or running: only deliver the queued kill control if the device's grant is still authorized.
      if ((session.leaseExpiresAtMs ?? 0) <= nowMs) { expired.push({ ref, session }); continue }
      const baseAuthorization = await loadAuthorization(transaction, session)
      const authorization = await withDeviceMembership(transaction, baseAuthorization, session.orgId, input.ownerUserId)
      if (!isWorkbenchTunnelClaimAuthorized({
        authenticatedDeviceUserId: input.ownerUserId, credentialVersion: input.credentialVersion, authorization, session,
      })) {
        expired.push({ ref, session })
        continue
      }
      const existingControls = session.encryptedControls
        ? decryptWorkbenchTunnelValue<WorkbenchTunnelQueuedControl[]>(session.encryptedControls, session.deviceId, session.sessionId, 'control')
        : []
      if (existingControls.length === 0) { survivors.push(id); continue }
      const [popped, ...rest] = existingControls
      claim = { kind: 'control', sessionId: session.sessionId, control: popped.control, attempt: session.attempt, leaseToken: session.leaseToken! }
      claimedRef = ref
      claimedSession = {
        ...session,
        encryptedControls: rest.length ? encryptWorkbenchTunnelValue(rest, session.deviceId, session.sessionId, 'control') : null,
      }
      survivors.push(id)
    }

    for (const row of expired) {
      const next = transitionWorkbenchTunnelSession(row.session, { type: 'expire', nowMs })
      transaction.update(row.ref, toStored(next))
    }
    const remaining = [...survivors, ...tail]
    if (!claim || !claimedRef || !claimedSession) {
      if (remaining.length !== ids.length) transaction.set(qRef, { pendingSessionIds: remaining, updatedAt: FieldValue.serverTimestamp() }, { merge: true })
      return null
    }
    transaction.update(claimedRef, toStored(claimedSession))
    transaction.set(qRef, { pendingSessionIds: remaining, updatedAt: FieldValue.serverTimestamp() }, { merge: true })
    return claim
  })
}

export interface AppendWorkbenchTunnelProgressInput {
  deviceId: string
  ownerUserId: string
  credentialVersion: number
  sessionId: string
  attempt: number
  leaseToken: string
  /** Validated internally via `parseWorkbenchTunnelProgressChunk` before it is persisted. */
  chunk: unknown
}

/**
 * A device worker calls this while a tunnel's provider process is alive to
 * stream status/stderr output (and its resolved public URL once known),
 * renew its lease, and (on the first call after `claimed`) flip the tunnel
 * to `running`. Mirrors `appendWorkbenchSessionProgress`.
 */
export async function appendWorkbenchTunnelProgress(
  input: AppendWorkbenchTunnelProgressInput,
  options: { nowMs?: number; leaseMs?: number } = {},
): Promise<{ sessionId: string; leaseExpiresAtMs: number; status: WorkbenchTunnelStatus; publicUrl?: string }> {
  const nowMs = options.nowMs ?? Date.now()
  const leaseMs = options.leaseMs ?? DEFAULT_LEASE_MS
  const chunk = parseWorkbenchTunnelProgressChunk(input.chunk)
  return adminDb.runTransaction(async (transaction) => {
    const sRef = sessionRef(input.sessionId)
    const snapshot = await transaction.get(sRef)
    if (!snapshot.exists) throw new Error('workbench: tunnel not found')
    const session = fromStored(snapshot.id, snapshot.data() ?? {})
    const baseAuthorization = await loadAuthorization(transaction, session)
    const authorization = await withDeviceMembership(transaction, baseAuthorization, session.orgId, input.ownerUserId)
    if (!isWorkbenchTunnelClaimAuthorized({
      authenticatedDeviceUserId: input.ownerUserId, credentialVersion: input.credentialVersion, authorization, session,
    })) throw new Error('workbench: tunnel authorization revoked')

    const resolvedPublicUrl = chunk.stream === 'tunnel' && chunk.publicUrl ? chunk.publicUrl : undefined
    const renewed = transitionWorkbenchTunnelSession(session, {
      type: 'progress', deviceId: input.deviceId, credentialVersion: input.credentialVersion,
      attempt: input.attempt, leaseToken: input.leaseToken, nowMs, leaseMs, publicUrl: resolvedPublicUrl,
    })
    const existingChunks = session.encryptedProgress
      ? decryptWorkbenchTunnelValue<WorkbenchTunnelProgressChunk[]>(session.encryptedProgress, session.deviceId, session.sessionId, 'progress')
      : []
    const nextChunks = appendWorkbenchTunnelProgressChunk(existingChunks, chunk)
    const next: WorkbenchTunnelSession = {
      ...renewed,
      encryptedProgress: encryptWorkbenchTunnelValue(nextChunks, session.deviceId, session.sessionId, 'progress'),
    }
    transaction.update(sRef, toStored(next))
    return {
      sessionId: next.sessionId, leaseExpiresAtMs: next.leaseExpiresAtMs ?? nowMs, status: next.status,
      ...(next.publicUrl ? { publicUrl: next.publicUrl } : {}),
    }
  })
}

export interface CompleteWorkbenchTunnelInput {
  deviceId: string
  ownerUserId: string
  credentialVersion: number
  sessionId: string
  attempt: number
  leaseToken: string
  outcome: 'exited' | 'killed' | 'failed'
  exitCode?: number
  error?: string
}

export async function completeTunnelSession(
  input: CompleteWorkbenchTunnelInput,
  options: { nowMs?: number } = {},
): Promise<WorkbenchTunnelSession> {
  const nowMs = options.nowMs ?? Date.now()
  return adminDb.runTransaction(async (transaction) => {
    const sRef = sessionRef(input.sessionId)
    const snapshot = await transaction.get(sRef)
    if (!snapshot.exists) throw new Error('workbench: tunnel not found')
    const session = fromStored(snapshot.id, snapshot.data() ?? {})
    const baseAuthorization = await loadAuthorization(transaction, session)
    const authorization = await withDeviceMembership(transaction, baseAuthorization, session.orgId, input.ownerUserId)
    if (!isWorkbenchTunnelClaimAuthorized({
      authenticatedDeviceUserId: input.ownerUserId, credentialVersion: input.credentialVersion, authorization, session,
    })) throw new Error('workbench: tunnel authorization revoked')

    const safeExitCode = Number.isSafeInteger(input.exitCode) ? Number(input.exitCode) : undefined
    const safeError = input.outcome === 'exited' ? '' : sanitizeLinkedResult(String(input.error ?? '')).slice(0, 2_000)
    const resultFingerprint = crypto.createHash('sha256')
      .update(JSON.stringify({ outcome: input.outcome, exitCode: safeExitCode, error: safeError }))
      .digest('hex')
    if (isTerminalWorkbenchTunnelStatus(session.status)) {
      if (session.status !== input.outcome || session.resultFingerprint !== resultFingerprint) {
        throw new Error('workbench: immutable terminal tunnel mismatch')
      }
      return hydrate(session)
    }

    const completed = transitionWorkbenchTunnelSession(session, {
      type: 'complete', deviceId: input.deviceId, credentialVersion: input.credentialVersion,
      attempt: input.attempt, leaseToken: input.leaseToken, outcome: input.outcome, nowMs,
    })
    const next: WorkbenchTunnelSession = {
      ...completed,
      resultFingerprint,
      ...(safeExitCode !== undefined ? { exitCode: safeExitCode } : {}),
      ...(safeError ? { error: safeError } : {}),
    }
    const qRef = queueRef(input.deviceId)
    const queueSnapshot = await transaction.get(qRef)
    const ids = Array.isArray(queueSnapshot.data()?.pendingSessionIds) ? queueSnapshot.data()!.pendingSessionIds as string[] : []
    transaction.update(sRef, toStored(next))
    transaction.set(qRef, { pendingSessionIds: ids.filter((id) => id !== input.sessionId), updatedAt: FieldValue.serverTimestamp() }, { merge: true })
    return next
  })
}
