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
  parseWorkbenchProgressChunk,
  sanitizeWorkbenchRelativePath,
  type WorkbenchJobProgressChunk,
} from './jobs'
import {
  appendWorkbenchSessionControl,
  decryptWorkbenchSessionValue,
  encryptWorkbenchSessionValue,
  isTerminalWorkbenchSessionStatus,
  transitionWorkbenchSession,
  type WorkbenchSession,
  type WorkbenchSessionControl,
  type WorkbenchSessionQueuedControl,
  type WorkbenchSessionShell,
  type WorkbenchSessionStatus,
  type WorkbenchSessionStdinMode,
} from './sessions'

export const WORKBENCH_SESSIONS_COLLECTION = 'conversation_workbench_sessions'
export const WORKBENCH_SESSION_QUEUES_COLLECTION = 'linked_device_workbench_session_queues'
const DEFAULT_LEASE_MS = 90_000
const DEFAULT_TTL_MS = 30 * 60 * 1000
const CLEANUP_RETENTION_MS = 24 * 60 * 60 * 1000
const MAX_DEVICE_SESSION_QUEUE = 50
const MAX_SESSION_CONTROL_QUEUE = 200

function timestampMs(value: unknown): number {
  if (value && typeof (value as { toMillis?: () => number }).toMillis === 'function') {
    return (value as { toMillis(): number }).toMillis()
  }
  const number = Number(value)
  return Number.isFinite(number) ? number : 0
}

function fromStored(sessionId: string, row: Record<string, unknown>): WorkbenchSession {
  return {
    ...row,
    sessionId,
    createdAtMs: timestampMs(row.createdAt),
    updatedAtMs: timestampMs(row.updatedAt),
    ttlExpiresAtMs: timestampMs(row.ttlExpiresAt),
    ...(row.leaseExpiresAt ? { leaseExpiresAtMs: timestampMs(row.leaseExpiresAt) } : {}),
    ...(row.claimedAt ? { claimedAtMs: timestampMs(row.claimedAt) } : {}),
    ...(row.completedAt ? { completedAtMs: timestampMs(row.completedAt) } : {}),
  } as unknown as WorkbenchSession
}

function toStored(session: WorkbenchSession): Record<string, unknown> {
  const {
    createdAtMs, updatedAtMs, ttlExpiresAtMs, leaseExpiresAtMs, claimedAtMs, completedAtMs,
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
    ...(completedAtMs ? { completedAt: Timestamp.fromMillis(completedAtMs) } : {}),
  }
}

function hydrate(session: WorkbenchSession): WorkbenchSession {
  const pendingControls = session.encryptedControls
    ? decryptWorkbenchSessionValue<WorkbenchSessionQueuedControl[]>(session.encryptedControls, session.deviceId, session.sessionId, 'control')
    : undefined
  const progressChunks = session.encryptedProgress
    ? decryptWorkbenchSessionValue<WorkbenchJobProgressChunk[]>(session.encryptedProgress, session.deviceId, session.sessionId, 'progress')
    : undefined
  return {
    ...session,
    ...(pendingControls ? { pendingControls } : {}),
    ...(progressChunks ? { progressChunks } : {}),
  }
}

function sessionRef(sessionId: string) {
  return adminDb.collection(WORKBENCH_SESSIONS_COLLECTION).doc(sessionId)
}

function queueRef(deviceId: string) {
  return adminDb.collection(WORKBENCH_SESSION_QUEUES_COLLECTION).doc(deviceId)
}

/**
 * Pointer doc tracking "the currently active session" per conversation,
 * stored in the same collection as sessions under a `pointer:` prefixed id
 * (session ids are always prefixed `wbs_`, so there is no collision). This
 * avoids needing a Firestore composite index just to enforce "one active
 * session per conversation".
 */
function pointerRef(conversationId: string) {
  return adminDb.collection(WORKBENCH_SESSIONS_COLLECTION).doc(`pointer:${conversationId}`)
}

export interface CreateWorkbenchSessionInput {
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
  /** Server-resolved (never client-supplied) — see `resolveWorkbenchSessionShell`. */
  shell: WorkbenchSessionShell
  cols: number
  rows: number
  cwd: string
}

export async function createWorkbenchSession(
  input: CreateWorkbenchSessionInput,
  options: { nowMs?: number; ttlMs?: number } = {},
): Promise<WorkbenchSession> {
  const nowMs = options.nowMs ?? Date.now()
  const ttlMs = options.ttlMs ?? DEFAULT_TTL_MS
  const sessionId = `wbs_${crypto.randomBytes(18).toString('base64url')}`

  return adminDb.runTransaction(async (transaction) => {
    const pRef = pointerRef(input.conversationId)
    const qRef = queueRef(input.deviceId)
    const [pointerSnapshot, queueSnapshot] = await Promise.all([transaction.get(pRef), transaction.get(qRef)])

    const activeSessionId = typeof pointerSnapshot.data()?.activeSessionId === 'string'
      ? pointerSnapshot.data()!.activeSessionId as string
      : null
    if (activeSessionId) {
      const activeSnapshot = await transaction.get(sessionRef(activeSessionId))
      if (activeSnapshot.exists) {
        const active = fromStored(activeSnapshot.id, activeSnapshot.data() ?? {})
        if (!isTerminalWorkbenchSessionStatus(active.status) && active.ttlExpiresAtMs > nowMs) {
          throw new Error('workbench: session already active')
        }
      }
    }

    const pendingSessionIds = Array.isArray(queueSnapshot.data()?.pendingSessionIds)
      ? queueSnapshot.data()!.pendingSessionIds as string[]
      : []
    if (pendingSessionIds.length >= MAX_DEVICE_SESSION_QUEUE) throw new Error('workbench: device session queue full')

    const session: WorkbenchSession = {
      ...input,
      sessionId,
      status: 'queued',
      attempt: 0,
      encryptedCreateControl: encryptWorkbenchSessionValue(
        { kind: 'create', cols: input.cols, rows: input.rows, cwd: input.cwd, shell: input.shell },
        input.deviceId, sessionId, 'create',
      ),
      createdAtMs: nowMs,
      updatedAtMs: nowMs,
      ttlExpiresAtMs: nowMs + ttlMs,
    }
    transaction.create(sessionRef(sessionId), toStored(session))
    transaction.set(qRef, {
      deviceId: input.deviceId,
      pendingSessionIds: [...pendingSessionIds, sessionId],
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true })
    transaction.set(pRef, {
      conversationId: input.conversationId, activeSessionId: sessionId, updatedAt: FieldValue.serverTimestamp(),
    })
    return { ...session, pendingControls: [] }
  })
}

export async function getWorkbenchSession(sessionId: string): Promise<WorkbenchSession | null> {
  if (sessionId.startsWith('pointer:')) return null
  const snapshot = await sessionRef(sessionId).get()
  if (!snapshot.exists) return null
  return hydrate(fromStored(snapshot.id, snapshot.data() ?? {}))
}

/** Reads the conversation's active-session pointer; returns `[]` if none, terminal, or expired. */
export async function listActiveSessionsForConversation(conversationId: string): Promise<WorkbenchSession[]> {
  const snapshot = await pointerRef(conversationId).get()
  const activeSessionId = typeof snapshot.data()?.activeSessionId === 'string' ? snapshot.data()!.activeSessionId as string : null
  if (!activeSessionId) return []
  const session = await getWorkbenchSession(activeSessionId)
  if (!session || session.conversationId !== conversationId || isTerminalWorkbenchSessionStatus(session.status)) return []
  return [session]
}

/** Exact durable binding every session mutation re-checks, mirroring `ApproveWorkbenchJobInput` in `job-store.ts`. */
export interface WorkbenchSessionBinding {
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

function sessionBindingMatches(session: WorkbenchSession, input: WorkbenchSessionBinding): boolean {
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

async function enqueueControl(
  binding: WorkbenchSessionBinding & { sessionId: string },
  control: Exclude<WorkbenchSessionControl, { kind: 'create' }>,
  options: { nowMs?: number } = {},
): Promise<WorkbenchSession> {
  const nowMs = options.nowMs ?? Date.now()
  return adminDb.runTransaction(async (transaction) => {
    const sRef = sessionRef(binding.sessionId)
    const qRef = queueRef(binding.deviceId)
    const [snapshot, queueSnapshot] = await Promise.all([transaction.get(sRef), transaction.get(qRef)])
    if (!snapshot.exists) throw new Error('workbench: session not found')
    const session = fromStored(snapshot.id, snapshot.data() ?? {})
    if (!sessionBindingMatches(session, binding)) throw new Error('workbench: session binding mismatch')
    const pendingSessionIds = Array.isArray(queueSnapshot.data()?.pendingSessionIds)
      ? queueSnapshot.data()!.pendingSessionIds as string[]
      : []

    if (control.kind === 'kill' && session.status === 'queued') {
      const killed = transitionWorkbenchSession(session, { type: 'killQueued', nowMs })
      transaction.update(sRef, toStored(killed))
      transaction.set(qRef, {
        pendingSessionIds: pendingSessionIds.filter((id) => id !== session.sessionId),
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true })
      return hydrate(killed)
    }
    if (session.status !== 'claimed' && session.status !== 'running') throw new Error('workbench: session not running')

    const existingControls = session.encryptedControls
      ? decryptWorkbenchSessionValue<WorkbenchSessionQueuedControl[]>(session.encryptedControls, session.deviceId, session.sessionId, 'control')
      : []
    if (existingControls.length >= MAX_SESSION_CONTROL_QUEUE) throw new Error('workbench: session control queue full')
    const nextSeq = (existingControls.at(-1)?.seq ?? -1) + 1
    const nextControls = appendWorkbenchSessionControl(existingControls, {
      seq: nextSeq, control, actorUserId: binding.actorUserId, enqueuedAtMs: nowMs,
    })
    const resized = control.kind === 'resize'
      ? transitionWorkbenchSession(session, { type: 'resize', cols: control.cols, rows: control.rows, nowMs })
      : session
    const next: WorkbenchSession = {
      ...resized,
      encryptedControls: encryptWorkbenchSessionValue(nextControls, session.deviceId, session.sessionId, 'control'),
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

export interface EnqueueSessionStdinInput extends WorkbenchSessionBinding {
  sessionId: string
  data: string
  mode: WorkbenchSessionStdinMode
}

export async function enqueueSessionStdin(input: EnqueueSessionStdinInput, options: { nowMs?: number } = {}): Promise<WorkbenchSession> {
  return enqueueControl(input, { kind: 'stdin', data: input.data, mode: input.mode }, options)
}

export interface EnqueueSessionResizeInput extends WorkbenchSessionBinding {
  sessionId: string
  cols: number
  rows: number
}

export async function enqueueSessionResize(input: EnqueueSessionResizeInput, options: { nowMs?: number } = {}): Promise<WorkbenchSession> {
  return enqueueControl(input, { kind: 'resize', cols: input.cols, rows: input.rows }, options)
}

export interface EnqueueSessionKillInput extends WorkbenchSessionBinding {
  sessionId: string
}

export async function enqueueSessionKill(input: EnqueueSessionKillInput, options: { nowMs?: number } = {}): Promise<WorkbenchSession> {
  return enqueueControl(input, { kind: 'kill' }, options)
}

export interface WorkbenchSessionStoredAuthorization {
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
 * Same shape/checks as `isWorkbenchClaimAuthorized` in `job-store.ts` (minus
 * the jobs-only `fs.write` approval branch, which has no session analog) —
 * re-verified before every claim/progress/complete call so a revoked
 * grant/mapping/membership stops an in-flight session immediately.
 */
export function isWorkbenchSessionClaimAuthorized(input: {
  authenticatedDeviceUserId: string
  credentialVersion: number
  authorization: WorkbenchSessionStoredAuthorization
  session: WorkbenchSession
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
    const currentRelativeFolder = sanitizeWorkbenchRelativePath(
      typeof workspaceContext?.folderRelativePath === 'string' ? workspaceContext.folderRelativePath : '.',
      { allowRoot: true },
    )
    if (currentRelativeFolder !== session.relativeFolder) return false
  }

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
  session: WorkbenchSession,
): Promise<WorkbenchSessionStoredAuthorization> {
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
  authorization: WorkbenchSessionStoredAuthorization,
  orgId: string,
  deviceActorUserId: string,
): Promise<WorkbenchSessionStoredAuthorization> {
  const snapshot = await transaction.get(adminDb.collection('orgMembers').doc(`${orgId}_${deviceActorUserId}`))
  return { ...authorization, deviceMember: snapshot.exists ? snapshot.data() ?? {} : undefined }
}

/**
 * Claim payload returned to a device worker's `POST .../workbench/sessions/claim`
 * poll. `kind: 'create'` is returned at most once per session (spawns a new
 * pty); `kind: 'control'` delivers exactly one queued stdin/resize/kill
 * control for a session the device already owns and is running. The
 * node-pty runtime host (built separately) should treat `sessionId` +
 * `attempt` + `leaseToken` as the binding key for its subsequent
 * progress/complete calls, exactly like `shell.exec` jobs.
 */
export type WorkbenchSessionClaim =
  | {
      kind: 'create'
      sessionId: string
      shell: WorkbenchSessionShell
      cols: number
      rows: number
      cwd: string
      workspaceId: string
      mappingId: string
      relativeFolder: string
      attempt: number
      leaseToken: string
    }
  | {
      kind: 'control'
      sessionId: string
      control: Exclude<WorkbenchSessionControl, { kind: 'create' }>
      attempt: number
      leaseToken: string
    }

export async function claimOldestWorkbenchSessionWork(
  input: { deviceId: string; ownerUserId: string; credentialVersion: number },
  options: { nowMs?: number; leaseMs?: number } = {},
): Promise<WorkbenchSessionClaim | null> {
  const nowMs = options.nowMs ?? Date.now()
  const leaseMs = options.leaseMs ?? DEFAULT_LEASE_MS
  return adminDb.runTransaction(async (transaction) => {
    const qRef = queueRef(input.deviceId)
    const queueSnapshot = await transaction.get(qRef)
    const ids = Array.isArray(queueSnapshot.data()?.pendingSessionIds) ? queueSnapshot.data()!.pendingSessionIds as string[] : []
    const candidates = ids.slice(0, 12)
    const tail = ids.slice(12)
    const survivors: string[] = []
    const expired: Array<{ ref: FirebaseFirestore.DocumentReference; session: WorkbenchSession }> = []
    let claim: WorkbenchSessionClaim | null = null
    let claimedRef: FirebaseFirestore.DocumentReference | null = null
    let claimedSession: WorkbenchSession | null = null

    for (const id of candidates) {
      const ref = sessionRef(id)
      const snapshot = await transaction.get(ref)
      if (!snapshot.exists) continue
      const session = fromStored(snapshot.id, snapshot.data() ?? {})
      if (session.deviceId !== input.deviceId || isTerminalWorkbenchSessionStatus(session.status)) continue
      if (session.ttlExpiresAtMs <= nowMs) { expired.push({ ref, session }); continue }
      if (claim) { survivors.push(id); continue }

      if (session.status === 'queued') {
        const baseAuthorization = await loadAuthorization(transaction, session)
        const authorization = await withDeviceMembership(transaction, baseAuthorization, session.orgId, input.ownerUserId)
        if (!isWorkbenchSessionClaimAuthorized({
          authenticatedDeviceUserId: input.ownerUserId, credentialVersion: input.credentialVersion, authorization, session,
        })) {
          expired.push({ ref, session })
          continue
        }
        const createControl = decryptWorkbenchSessionValue<Extract<WorkbenchSessionControl, { kind: 'create' }>>(
          session.encryptedCreateControl!, session.deviceId, session.sessionId, 'create',
        )
        const claimed = transitionWorkbenchSession(session, {
          type: 'claimCreate', deviceId: input.deviceId, credentialVersion: input.credentialVersion, nowMs, leaseMs,
        })
        claim = {
          kind: 'create', sessionId: claimed.sessionId, shell: createControl.shell, cols: createControl.cols,
          rows: createControl.rows, cwd: createControl.cwd, workspaceId: claimed.workspaceId, mappingId: claimed.mappingId,
          relativeFolder: claimed.relativeFolder, attempt: claimed.attempt, leaseToken: claimed.leaseToken!,
        }
        claimedRef = ref
        claimedSession = claimed
        survivors.push(id)
        continue
      }

      // claimed or running: only deliver a queued control if the device's grant is still authorized.
      if ((session.leaseExpiresAtMs ?? 0) <= nowMs) { expired.push({ ref, session }); continue }
      const baseAuthorization = await loadAuthorization(transaction, session)
      const authorization = await withDeviceMembership(transaction, baseAuthorization, session.orgId, input.ownerUserId)
      if (!isWorkbenchSessionClaimAuthorized({
        authenticatedDeviceUserId: input.ownerUserId, credentialVersion: input.credentialVersion, authorization, session,
      })) {
        expired.push({ ref, session })
        continue
      }
      const existingControls = session.encryptedControls
        ? decryptWorkbenchSessionValue<WorkbenchSessionQueuedControl[]>(session.encryptedControls, session.deviceId, session.sessionId, 'control')
        : []
      if (existingControls.length === 0) { survivors.push(id); continue }
      const [popped, ...rest] = existingControls
      claim = { kind: 'control', sessionId: session.sessionId, control: popped.control, attempt: session.attempt, leaseToken: session.leaseToken! }
      claimedRef = ref
      claimedSession = {
        ...session,
        encryptedControls: rest.length ? encryptWorkbenchSessionValue(rest, session.deviceId, session.sessionId, 'control') : null,
      }
      survivors.push(id)
    }

    for (const row of expired) {
      const next = transitionWorkbenchSession(row.session, { type: 'expire', nowMs })
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

export interface AppendWorkbenchSessionProgressInput {
  deviceId: string
  ownerUserId: string
  credentialVersion: number
  sessionId: string
  attempt: number
  leaseToken: string
  /** Validated internally via `parseWorkbenchProgressChunk` before it is persisted. */
  chunk: unknown
}

/**
 * A device worker calls this while a session's pty is alive to stream
 * stdout/stderr, renew its lease, and (on the first call after `claimed`)
 * flip the session to `running`. Mirrors `appendWorkbenchJobProgress`.
 */
export async function appendWorkbenchSessionProgress(
  input: AppendWorkbenchSessionProgressInput,
  options: { nowMs?: number; leaseMs?: number } = {},
): Promise<{ sessionId: string; leaseExpiresAtMs: number; status: WorkbenchSessionStatus }> {
  const nowMs = options.nowMs ?? Date.now()
  const leaseMs = options.leaseMs ?? DEFAULT_LEASE_MS
  const chunk = parseWorkbenchProgressChunk(input.chunk)
  return adminDb.runTransaction(async (transaction) => {
    const sRef = sessionRef(input.sessionId)
    const snapshot = await transaction.get(sRef)
    if (!snapshot.exists) throw new Error('workbench: session not found')
    const session = fromStored(snapshot.id, snapshot.data() ?? {})
    const baseAuthorization = await loadAuthorization(transaction, session)
    const authorization = await withDeviceMembership(transaction, baseAuthorization, session.orgId, input.ownerUserId)
    if (!isWorkbenchSessionClaimAuthorized({
      authenticatedDeviceUserId: input.ownerUserId, credentialVersion: input.credentialVersion, authorization, session,
    })) throw new Error('workbench: session authorization revoked')

    const renewed = transitionWorkbenchSession(session, {
      type: 'progress', deviceId: input.deviceId, credentialVersion: input.credentialVersion,
      attempt: input.attempt, leaseToken: input.leaseToken, nowMs, leaseMs,
    })
    const existingChunks = session.encryptedProgress
      ? decryptWorkbenchSessionValue<WorkbenchJobProgressChunk[]>(session.encryptedProgress, session.deviceId, session.sessionId, 'progress')
      : []
    const nextChunks = appendWorkbenchProgressChunk(existingChunks, chunk)
    const next: WorkbenchSession = {
      ...renewed,
      encryptedProgress: encryptWorkbenchSessionValue(nextChunks, session.deviceId, session.sessionId, 'progress'),
    }
    transaction.update(sRef, toStored(next))
    return { sessionId: next.sessionId, leaseExpiresAtMs: next.leaseExpiresAtMs ?? nowMs, status: next.status }
  })
}

export interface CompleteWorkbenchSessionInput {
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

export async function completeWorkbenchSession(
  input: CompleteWorkbenchSessionInput,
  options: { nowMs?: number } = {},
): Promise<WorkbenchSession> {
  const nowMs = options.nowMs ?? Date.now()
  return adminDb.runTransaction(async (transaction) => {
    const sRef = sessionRef(input.sessionId)
    const snapshot = await transaction.get(sRef)
    if (!snapshot.exists) throw new Error('workbench: session not found')
    const session = fromStored(snapshot.id, snapshot.data() ?? {})
    const baseAuthorization = await loadAuthorization(transaction, session)
    const authorization = await withDeviceMembership(transaction, baseAuthorization, session.orgId, input.ownerUserId)
    if (!isWorkbenchSessionClaimAuthorized({
      authenticatedDeviceUserId: input.ownerUserId, credentialVersion: input.credentialVersion, authorization, session,
    })) throw new Error('workbench: session authorization revoked')

    const safeExitCode = Number.isSafeInteger(input.exitCode) ? Number(input.exitCode) : undefined
    const safeError = input.outcome === 'exited' ? '' : sanitizeLinkedResult(String(input.error ?? '')).slice(0, 2_000)
    const resultFingerprint = crypto.createHash('sha256')
      .update(JSON.stringify({ outcome: input.outcome, exitCode: safeExitCode, error: safeError }))
      .digest('hex')
    if (isTerminalWorkbenchSessionStatus(session.status)) {
      if (session.status !== input.outcome || session.resultFingerprint !== resultFingerprint) {
        throw new Error('workbench: immutable terminal session mismatch')
      }
      return hydrate(session)
    }

    const completed = transitionWorkbenchSession(session, {
      type: 'complete', deviceId: input.deviceId, credentialVersion: input.credentialVersion,
      attempt: input.attempt, leaseToken: input.leaseToken, outcome: input.outcome, nowMs,
    })
    const next: WorkbenchSession = {
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
