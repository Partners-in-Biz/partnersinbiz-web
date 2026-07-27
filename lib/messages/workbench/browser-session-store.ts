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
  appendWorkbenchBrowserProgressChunk,
  appendWorkbenchBrowserSessionControl,
  decryptWorkbenchBrowserSessionValue,
  encryptWorkbenchBrowserSessionValue,
  isTerminalWorkbenchBrowserSessionStatus,
  parseWorkbenchBrowserProgressChunk,
  transitionWorkbenchBrowserSession,
  WORKBENCH_BROWSER_DEFAULT_FOLLOW_INTERVAL_MS,
  type WorkbenchBrowserKey,
  type WorkbenchBrowserMouseButton,
  type WorkbenchBrowserProgressChunk,
  type WorkbenchBrowserSession,
  type WorkbenchBrowserSessionControl,
  type WorkbenchBrowserSessionQueuedControl,
  type WorkbenchBrowserViewport,
} from './browser-sessions'

export const WORKBENCH_BROWSER_SESSIONS_COLLECTION = 'conversation_workbench_browser_sessions'
export const WORKBENCH_BROWSER_SESSION_QUEUES_COLLECTION = 'linked_device_workbench_browser_session_queues'
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

function fromStored(sessionId: string, row: Record<string, unknown>): WorkbenchBrowserSession {
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
  } as unknown as WorkbenchBrowserSession
}

function toStored(session: WorkbenchBrowserSession): Record<string, unknown> {
  const {
    createdAtMs, updatedAtMs, ttlExpiresAtMs, leaseExpiresAtMs, claimedAtMs, approvedAtMs, completedAtMs,
    pendingControls: _pendingControls, progressChunks: _progressChunks, ...row
  } = session
  void _pendingControls
  void _progressChunks
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

function hydrate(session: WorkbenchBrowserSession): WorkbenchBrowserSession {
  const pendingControls = session.encryptedControls
    ? decryptWorkbenchBrowserSessionValue<WorkbenchBrowserSessionQueuedControl[]>(session.encryptedControls, session.deviceId, session.sessionId, 'control')
    : undefined
  const progressChunks = session.encryptedProgress
    ? decryptWorkbenchBrowserSessionValue<WorkbenchBrowserProgressChunk[]>(session.encryptedProgress, session.deviceId, session.sessionId, 'progress')
    : undefined
  return {
    ...session,
    ...(pendingControls ? { pendingControls } : {}),
    ...(progressChunks ? { progressChunks } : {}),
  }
}

function sessionRef(sessionId: string) {
  return adminDb.collection(WORKBENCH_BROWSER_SESSIONS_COLLECTION).doc(sessionId)
}

function queueRef(deviceId: string) {
  return adminDb.collection(WORKBENCH_BROWSER_SESSION_QUEUES_COLLECTION).doc(deviceId)
}

/**
 * Pointer doc tracking "the currently active browser session" per
 * conversation, stored in the same collection as sessions under a
 * `pointer:` prefixed id (session ids are always prefixed `wbbs_`, so there
 * is no collision). Mirrors the pty session's `pointerRef` in
 * `session-store.ts` — this is what enforces "one active browser session
 * per conversation", including while a session is merely `awaiting_approval`
 * (an unapproved pending session still blocks a second create).
 */
function pointerRef(conversationId: string) {
  return adminDb.collection(WORKBENCH_BROWSER_SESSIONS_COLLECTION).doc(`pointer:${conversationId}`)
}

export interface CreateWorkbenchBrowserSessionInput {
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
  startUrl: string | null
  viewport: WorkbenchBrowserViewport
}

/**
 * Creates a browser session in `awaiting_approval` — unlike the pty
 * session's `createWorkbenchSession`, this never touches the device's
 * pending-work queue at creation time (mirroring `enqueueWorkbenchJob`'s
 * `fs.write` gate in `job-store.ts`): the create control is encrypted and
 * stored, but only reaches the device once `approveWorkbenchBrowserSession`
 * is called.
 */
export async function createWorkbenchBrowserSession(
  input: CreateWorkbenchBrowserSessionInput,
  options: { nowMs?: number; ttlMs?: number } = {},
): Promise<WorkbenchBrowserSession> {
  const nowMs = options.nowMs ?? Date.now()
  const ttlMs = options.ttlMs ?? DEFAULT_TTL_MS
  const sessionId = `wbbs_${crypto.randomBytes(18).toString('base64url')}`

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
        if (!isTerminalWorkbenchBrowserSessionStatus(active.status) && active.ttlExpiresAtMs > nowMs) {
          throw new Error('workbench: browser session already active')
        }
      }
    }

    const session: WorkbenchBrowserSession = {
      ...input,
      sessionId,
      status: 'awaiting_approval',
      attempt: 0,
      encryptedCreateControl: encryptWorkbenchBrowserSessionValue(
        { kind: 'create', startUrl: input.startUrl, viewport: input.viewport },
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

export async function getWorkbenchBrowserSession(sessionId: string): Promise<WorkbenchBrowserSession | null> {
  if (sessionId.startsWith('pointer:')) return null
  const snapshot = await sessionRef(sessionId).get()
  if (!snapshot.exists) return null
  return hydrate(fromStored(snapshot.id, snapshot.data() ?? {}))
}

/** Reads the conversation's active-session pointer; returns `[]` if none, terminal, or expired. */
export async function listActiveBrowserSessionsForConversation(conversationId: string): Promise<WorkbenchBrowserSession[]> {
  const snapshot = await pointerRef(conversationId).get()
  const activeSessionId = typeof snapshot.data()?.activeSessionId === 'string' ? snapshot.data()!.activeSessionId as string : null
  if (!activeSessionId) return []
  const session = await getWorkbenchBrowserSession(activeSessionId)
  if (!session || session.conversationId !== conversationId || isTerminalWorkbenchBrowserSessionStatus(session.status)) return []
  return [session]
}

/** Exact durable binding every session mutation re-checks, mirroring `WorkbenchSessionBinding` in `session-store.ts`. */
export interface WorkbenchBrowserSessionBinding {
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

function sessionBindingMatches(session: WorkbenchBrowserSession, input: WorkbenchBrowserSessionBinding): boolean {
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

export interface ApproveWorkbenchBrowserSessionInput extends WorkbenchBrowserSessionBinding {
  sessionId: string
  approverUserId: string
}

/**
 * Approves a browser session awaiting approval, moving it to `queued` and
 * — for the first time — adding it to the device's pending-work queue.
 * Mirrors `approveWorkbenchJob` in `job-store.ts`. For MVP, the only
 * approver accepted is the session's own actor (self-approval, exactly like
 * `fs.write` job approval); there is no separate admin-review queue yet.
 */
export async function approveWorkbenchBrowserSession(
  input: ApproveWorkbenchBrowserSessionInput,
  options: { nowMs?: number } = {},
): Promise<WorkbenchBrowserSession> {
  const nowMs = options.nowMs ?? Date.now()
  return adminDb.runTransaction(async (transaction) => {
    const sRef = sessionRef(input.sessionId)
    const qRef = queueRef(input.deviceId)
    const [snapshot, queueSnapshot] = await Promise.all([transaction.get(sRef), transaction.get(qRef)])
    if (!snapshot.exists) throw new Error('workbench: browser session not found')
    const session = fromStored(snapshot.id, snapshot.data() ?? {})
    if (!sessionBindingMatches(session, input)) throw new Error('workbench: browser session binding mismatch')
    if (session.status === 'queued' && session.approvedByUserId === input.approverUserId) return hydrate(session)
    const approved = transitionWorkbenchBrowserSession(session, { type: 'approve', approverUserId: input.approverUserId, nowMs })
    const pendingSessionIds = Array.isArray(queueSnapshot.data()?.pendingSessionIds)
      ? queueSnapshot.data()!.pendingSessionIds as string[]
      : []
    if (pendingSessionIds.length >= MAX_DEVICE_SESSION_QUEUE) throw new Error('workbench: device browser session queue full')
    transaction.update(sRef, toStored(approved))
    transaction.set(qRef, {
      deviceId: input.deviceId,
      pendingSessionIds: pendingSessionIds.includes(input.sessionId) ? pendingSessionIds : [...pendingSessionIds, input.sessionId],
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true })
    return hydrate(approved)
  })
}

async function enqueueControl(
  binding: WorkbenchBrowserSessionBinding & { sessionId: string },
  control: Exclude<WorkbenchBrowserSessionControl, { kind: 'create' }>,
  options: { nowMs?: number } = {},
): Promise<WorkbenchBrowserSession> {
  const nowMs = options.nowMs ?? Date.now()
  return adminDb.runTransaction(async (transaction) => {
    const sRef = sessionRef(binding.sessionId)
    const qRef = queueRef(binding.deviceId)
    const [snapshot, queueSnapshot] = await Promise.all([transaction.get(sRef), transaction.get(qRef)])
    if (!snapshot.exists) throw new Error('workbench: browser session not found')
    const session = fromStored(snapshot.id, snapshot.data() ?? {})
    if (!sessionBindingMatches(session, binding)) throw new Error('workbench: browser session binding mismatch')
    const pendingSessionIds = Array.isArray(queueSnapshot.data()?.pendingSessionIds)
      ? queueSnapshot.data()!.pendingSessionIds as string[]
      : []

    if (control.kind === 'kill' && (session.status === 'awaiting_approval' || session.status === 'queued')) {
      const killed = transitionWorkbenchBrowserSession(session, { type: 'killQueued', nowMs })
      transaction.update(sRef, toStored(killed))
      if (session.status === 'queued') {
        transaction.set(qRef, {
          pendingSessionIds: pendingSessionIds.filter((id) => id !== session.sessionId),
          updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true })
      }
      return hydrate(killed)
    }
    if (session.status !== 'claimed' && session.status !== 'running') throw new Error('workbench: browser session not running')

    const existingControls = session.encryptedControls
      ? decryptWorkbenchBrowserSessionValue<WorkbenchBrowserSessionQueuedControl[]>(session.encryptedControls, session.deviceId, session.sessionId, 'control')
      : []
    if (existingControls.length >= MAX_SESSION_CONTROL_QUEUE) throw new Error('workbench: browser session control queue full')
    const nextSeq = (existingControls.at(-1)?.seq ?? -1) + 1
    const nextControls = appendWorkbenchBrowserSessionControl(existingControls, {
      seq: nextSeq, control, actorUserId: binding.actorUserId, enqueuedAtMs: nowMs,
    })
    const next: WorkbenchBrowserSession = {
      ...session,
      encryptedControls: encryptWorkbenchBrowserSessionValue(nextControls, session.deviceId, session.sessionId, 'control'),
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

export interface EnqueueBrowserSessionNavigateInput extends WorkbenchBrowserSessionBinding {
  sessionId: string
  url: string
}

export async function enqueueBrowserSessionNavigate(input: EnqueueBrowserSessionNavigateInput, options: { nowMs?: number } = {}): Promise<WorkbenchBrowserSession> {
  return enqueueControl(input, { kind: 'navigate', url: input.url }, options)
}

export interface EnqueueBrowserSessionCaptureInput extends WorkbenchBrowserSessionBinding {
  sessionId: string
}

export async function enqueueBrowserSessionCapture(input: EnqueueBrowserSessionCaptureInput, options: { nowMs?: number } = {}): Promise<WorkbenchBrowserSession> {
  return enqueueControl(input, { kind: 'capture' }, options)
}

export interface EnqueueBrowserSessionClickInput extends WorkbenchBrowserSessionBinding {
  sessionId: string
  x: number
  y: number
  button?: WorkbenchBrowserMouseButton
}

export async function enqueueBrowserSessionClick(input: EnqueueBrowserSessionClickInput, options: { nowMs?: number } = {}): Promise<WorkbenchBrowserSession> {
  return enqueueControl(input, { kind: 'click', x: input.x, y: input.y, ...(input.button ? { button: input.button } : {}) }, options)
}

export interface EnqueueBrowserSessionTypeInput extends WorkbenchBrowserSessionBinding {
  sessionId: string
  text: string
}

export async function enqueueBrowserSessionType(input: EnqueueBrowserSessionTypeInput, options: { nowMs?: number } = {}): Promise<WorkbenchBrowserSession> {
  return enqueueControl(input, { kind: 'type', text: input.text }, options)
}

export interface EnqueueBrowserSessionPressInput extends WorkbenchBrowserSessionBinding {
  sessionId: string
  key: WorkbenchBrowserKey
}

export async function enqueueBrowserSessionPress(input: EnqueueBrowserSessionPressInput, options: { nowMs?: number } = {}): Promise<WorkbenchBrowserSession> {
  return enqueueControl(input, { kind: 'press', key: input.key }, options)
}

export interface EnqueueBrowserSessionScrollInput extends WorkbenchBrowserSessionBinding {
  sessionId: string
  x: number
  y: number
  deltaX?: number
  deltaY: number
}

export async function enqueueBrowserSessionScroll(input: EnqueueBrowserSessionScrollInput, options: { nowMs?: number } = {}): Promise<WorkbenchBrowserSession> {
  return enqueueControl(
    input,
    { kind: 'scroll', x: input.x, y: input.y, deltaX: input.deltaX ?? 0, deltaY: input.deltaY },
    options,
  )
}

export interface EnqueueBrowserSessionFollowStartInput extends WorkbenchBrowserSessionBinding {
  sessionId: string
  intervalMs?: number
}

/**
 * Starts the device-side capture loop. The interval lives on the device's
 * browser entry rather than as repeated `capture` controls, so a follow that
 * outlives its enqueue call cannot fill the 200-entry control queue.
 */
export async function enqueueBrowserSessionFollowStart(
  input: EnqueueBrowserSessionFollowStartInput,
  options: { nowMs?: number } = {},
): Promise<WorkbenchBrowserSession> {
  return enqueueControl(
    input,
    { kind: 'follow_start', intervalMs: input.intervalMs ?? WORKBENCH_BROWSER_DEFAULT_FOLLOW_INTERVAL_MS },
    options,
  )
}

export interface EnqueueBrowserSessionFollowStopInput extends WorkbenchBrowserSessionBinding {
  sessionId: string
}

export async function enqueueBrowserSessionFollowStop(input: EnqueueBrowserSessionFollowStopInput, options: { nowMs?: number } = {}): Promise<WorkbenchBrowserSession> {
  return enqueueControl(input, { kind: 'follow_stop' }, options)
}

export interface EnqueueBrowserSessionKillInput extends WorkbenchBrowserSessionBinding {
  sessionId: string
}

export async function enqueueBrowserSessionKill(input: EnqueueBrowserSessionKillInput, options: { nowMs?: number } = {}): Promise<WorkbenchBrowserSession> {
  return enqueueControl(input, { kind: 'kill' }, options)
}

export interface WorkbenchBrowserSessionStoredAuthorization {
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
 * `session-store.ts` — re-verified before every claim/progress/complete/
 * frame-upload call so a revoked grant/mapping/membership stops an
 * in-flight browser session immediately.
 */
export function isWorkbenchBrowserSessionClaimAuthorized(input: {
  authenticatedDeviceUserId: string
  credentialVersion: number
  authorization: WorkbenchBrowserSessionStoredAuthorization
  session: WorkbenchBrowserSession
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
  session: WorkbenchBrowserSession,
): Promise<WorkbenchBrowserSessionStoredAuthorization> {
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
  authorization: WorkbenchBrowserSessionStoredAuthorization,
  orgId: string,
  deviceActorUserId: string,
): Promise<WorkbenchBrowserSessionStoredAuthorization> {
  const snapshot = await transaction.get(adminDb.collection('orgMembers').doc(`${orgId}_${deviceActorUserId}`))
  return { ...authorization, deviceMember: snapshot.exists ? snapshot.data() ?? {} : undefined }
}

/**
 * Claim payload returned to a device worker's
 * `POST .../workbench/browser/sessions/claim` poll. `kind: 'create'` is
 * returned at most once per session (spawns headless Chrome + connects over
 * CDP); `kind: 'control'` delivers exactly one queued control (navigate,
 * capture, click/type/press/scroll, follow start/stop, or kill) for a session
 * the device already owns and is running.
 */
export type WorkbenchBrowserSessionClaim =
  | {
      kind: 'create'
      sessionId: string
      startUrl: string | null
      viewport: WorkbenchBrowserViewport
      workspaceId: string
      mappingId: string
      relativeFolder: string
      attempt: number
      leaseToken: string
    }
  | {
      kind: 'control'
      sessionId: string
      control: Exclude<WorkbenchBrowserSessionControl, { kind: 'create' }>
      attempt: number
      leaseToken: string
    }

export async function claimOldestWorkbenchBrowserSessionWork(
  input: { deviceId: string; ownerUserId: string; credentialVersion: number },
  options: { nowMs?: number; leaseMs?: number } = {},
): Promise<WorkbenchBrowserSessionClaim | null> {
  const nowMs = options.nowMs ?? Date.now()
  const leaseMs = options.leaseMs ?? DEFAULT_LEASE_MS
  return adminDb.runTransaction(async (transaction) => {
    const qRef = queueRef(input.deviceId)
    const queueSnapshot = await transaction.get(qRef)
    const ids = Array.isArray(queueSnapshot.data()?.pendingSessionIds) ? queueSnapshot.data()!.pendingSessionIds as string[] : []
    const candidates = ids.slice(0, 12)
    const tail = ids.slice(12)
    const survivors: string[] = []
    const expired: Array<{ ref: FirebaseFirestore.DocumentReference; session: WorkbenchBrowserSession }> = []
    let claim: WorkbenchBrowserSessionClaim | null = null
    let claimedRef: FirebaseFirestore.DocumentReference | null = null
    let claimedSession: WorkbenchBrowserSession | null = null

    for (const id of candidates) {
      const ref = sessionRef(id)
      const snapshot = await transaction.get(ref)
      if (!snapshot.exists) continue
      const session = fromStored(snapshot.id, snapshot.data() ?? {})
      if (session.deviceId !== input.deviceId || isTerminalWorkbenchBrowserSessionStatus(session.status)) continue
      if (session.ttlExpiresAtMs <= nowMs) { expired.push({ ref, session }); continue }
      if (claim) { survivors.push(id); continue }

      if (session.status === 'queued') {
        const baseAuthorization = await loadAuthorization(transaction, session)
        const authorization = await withDeviceMembership(transaction, baseAuthorization, session.orgId, input.ownerUserId)
        if (!isWorkbenchBrowserSessionClaimAuthorized({
          authenticatedDeviceUserId: input.ownerUserId, credentialVersion: input.credentialVersion, authorization, session,
        })) {
          expired.push({ ref, session })
          continue
        }
        const createControl = decryptWorkbenchBrowserSessionValue<Extract<WorkbenchBrowserSessionControl, { kind: 'create' }>>(
          session.encryptedCreateControl!, session.deviceId, session.sessionId, 'create',
        )
        const claimed = transitionWorkbenchBrowserSession(session, {
          type: 'claimCreate', deviceId: input.deviceId, credentialVersion: input.credentialVersion, nowMs, leaseMs,
        })
        claim = {
          kind: 'create', sessionId: claimed.sessionId, startUrl: createControl.startUrl, viewport: createControl.viewport,
          workspaceId: claimed.workspaceId, mappingId: claimed.mappingId, relativeFolder: claimed.relativeFolder,
          attempt: claimed.attempt, leaseToken: claimed.leaseToken!,
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
      if (!isWorkbenchBrowserSessionClaimAuthorized({
        authenticatedDeviceUserId: input.ownerUserId, credentialVersion: input.credentialVersion, authorization, session,
      })) {
        expired.push({ ref, session })
        continue
      }
      const existingControls = session.encryptedControls
        ? decryptWorkbenchBrowserSessionValue<WorkbenchBrowserSessionQueuedControl[]>(session.encryptedControls, session.deviceId, session.sessionId, 'control')
        : []
      if (existingControls.length === 0) { survivors.push(id); continue }
      const [popped, ...rest] = existingControls
      claim = { kind: 'control', sessionId: session.sessionId, control: popped.control, attempt: session.attempt, leaseToken: session.leaseToken! }
      claimedRef = ref
      claimedSession = {
        ...session,
        encryptedControls: rest.length ? encryptWorkbenchBrowserSessionValue(rest, session.deviceId, session.sessionId, 'control') : null,
      }
      survivors.push(id)
    }

    for (const row of expired) {
      const next = transitionWorkbenchBrowserSession(row.session, { type: 'expire', nowMs })
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

export interface AppendWorkbenchBrowserSessionProgressInput {
  deviceId: string
  ownerUserId: string
  credentialVersion: number
  sessionId: string
  attempt: number
  leaseToken: string
  /** Validated internally via `parseWorkbenchBrowserProgressChunk` before it is persisted. */
  chunk: unknown
}

/**
 * A device worker calls this while a claimed/running browser session is
 * alive to stream frame/status/stderr chunks, renew its lease, and (on the
 * first call after `claimed`) flip the session to `running`. Mirrors
 * `appendWorkbenchSessionProgress` in `session-store.ts`; additionally
 * denormalizes `currentPageUrl`/`currentPageTitle` from the chunk so the
 * public view can show "where the browser currently is" without decrypting
 * the whole progress ring buffer.
 */
export async function appendWorkbenchBrowserSessionProgress(
  input: AppendWorkbenchBrowserSessionProgressInput,
  options: { nowMs?: number; leaseMs?: number } = {},
): Promise<{ sessionId: string; leaseExpiresAtMs: number; status: WorkbenchBrowserSession['status'] }> {
  const nowMs = options.nowMs ?? Date.now()
  const leaseMs = options.leaseMs ?? DEFAULT_LEASE_MS
  const chunk = parseWorkbenchBrowserProgressChunk(input.chunk)
  return adminDb.runTransaction(async (transaction) => {
    const sRef = sessionRef(input.sessionId)
    const snapshot = await transaction.get(sRef)
    if (!snapshot.exists) throw new Error('workbench: browser session not found')
    const session = fromStored(snapshot.id, snapshot.data() ?? {})
    const baseAuthorization = await loadAuthorization(transaction, session)
    const authorization = await withDeviceMembership(transaction, baseAuthorization, session.orgId, input.ownerUserId)
    if (!isWorkbenchBrowserSessionClaimAuthorized({
      authenticatedDeviceUserId: input.ownerUserId, credentialVersion: input.credentialVersion, authorization, session,
    })) throw new Error('workbench: browser session authorization revoked')

    const renewed = transitionWorkbenchBrowserSession(session, {
      type: 'progress', deviceId: input.deviceId, credentialVersion: input.credentialVersion,
      attempt: input.attempt, leaseToken: input.leaseToken, nowMs, leaseMs,
    })
    const existingChunks = session.encryptedProgress
      ? decryptWorkbenchBrowserSessionValue<WorkbenchBrowserProgressChunk[]>(session.encryptedProgress, session.deviceId, session.sessionId, 'progress')
      : []
    const nextChunks = appendWorkbenchBrowserProgressChunk(existingChunks, chunk)
    const next: WorkbenchBrowserSession = {
      ...renewed,
      encryptedProgress: encryptWorkbenchBrowserSessionValue(nextChunks, session.deviceId, session.sessionId, 'progress'),
      ...(chunk.pageUrl ? { currentPageUrl: chunk.pageUrl } : {}),
      ...(chunk.title ? { currentPageTitle: chunk.title } : {}),
    }
    transaction.update(sRef, toStored(next))
    return { sessionId: next.sessionId, leaseExpiresAtMs: next.leaseExpiresAtMs ?? nowMs, status: next.status }
  })
}

export interface CompleteWorkbenchBrowserSessionInput {
  deviceId: string
  ownerUserId: string
  credentialVersion: number
  sessionId: string
  attempt: number
  leaseToken: string
  outcome: 'exited' | 'killed' | 'failed'
  error?: string
}

export async function completeWorkbenchBrowserSession(
  input: CompleteWorkbenchBrowserSessionInput,
  options: { nowMs?: number } = {},
): Promise<WorkbenchBrowserSession> {
  const nowMs = options.nowMs ?? Date.now()
  return adminDb.runTransaction(async (transaction) => {
    const sRef = sessionRef(input.sessionId)
    const snapshot = await transaction.get(sRef)
    if (!snapshot.exists) throw new Error('workbench: browser session not found')
    const session = fromStored(snapshot.id, snapshot.data() ?? {})
    const baseAuthorization = await loadAuthorization(transaction, session)
    const authorization = await withDeviceMembership(transaction, baseAuthorization, session.orgId, input.ownerUserId)
    if (!isWorkbenchBrowserSessionClaimAuthorized({
      authenticatedDeviceUserId: input.ownerUserId, credentialVersion: input.credentialVersion, authorization, session,
    })) throw new Error('workbench: browser session authorization revoked')

    const safeError = input.outcome === 'exited' ? '' : sanitizeLinkedResult(String(input.error ?? '')).slice(0, 2_000)
    const resultFingerprint = crypto.createHash('sha256')
      .update(JSON.stringify({ outcome: input.outcome, error: safeError }))
      .digest('hex')
    if (isTerminalWorkbenchBrowserSessionStatus(session.status)) {
      if (session.status !== input.outcome || session.resultFingerprint !== resultFingerprint) {
        throw new Error('workbench: immutable terminal browser session mismatch')
      }
      return hydrate(session)
    }

    const completed = transitionWorkbenchBrowserSession(session, {
      type: 'complete', deviceId: input.deviceId, credentialVersion: input.credentialVersion,
      attempt: input.attempt, leaseToken: input.leaseToken, outcome: input.outcome, nowMs,
    })
    const next: WorkbenchBrowserSession = {
      ...completed,
      resultFingerprint,
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

export interface VerifyWorkbenchBrowserSessionClaimInput {
  deviceId: string
  ownerUserId: string
  credentialVersion: number
  sessionId: string
  attempt: number
  leaseToken: string
}

/**
 * Read-only claim verification used by the frames-upload device route:
 * confirms the calling device currently owns this session's live lease
 * (claimed/running, matching attempt + leaseToken, not lease-expired) and
 * re-runs the same authorization check as claim/progress/complete, without
 * mutating the session. Returns the hydrated session so the frames route can
 * read `orgId`/`conversationId` for the storage object path.
 */
export async function verifyWorkbenchBrowserSessionClaim(
  input: VerifyWorkbenchBrowserSessionClaimInput,
  options: { nowMs?: number } = {},
): Promise<WorkbenchBrowserSession> {
  const nowMs = options.nowMs ?? Date.now()
  return adminDb.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(sessionRef(input.sessionId))
    if (!snapshot.exists) throw new Error('workbench: browser session not found')
    const session = fromStored(snapshot.id, snapshot.data() ?? {})
    if (session.deviceId !== input.deviceId || session.credentialVersion !== input.credentialVersion) throw new Error('workbench: device mismatch')
    if (session.status !== 'claimed' && session.status !== 'running') throw new Error('workbench: browser session not claimed')
    if (session.attempt !== input.attempt || session.leaseToken !== input.leaseToken) throw new Error('workbench: lease mismatch')
    if ((session.leaseExpiresAtMs ?? 0) < nowMs) throw new Error('workbench: lease expired')
    const baseAuthorization = await loadAuthorization(transaction, session)
    const authorization = await withDeviceMembership(transaction, baseAuthorization, session.orgId, input.ownerUserId)
    if (!isWorkbenchBrowserSessionClaimAuthorized({
      authenticatedDeviceUserId: input.ownerUserId, credentialVersion: input.credentialVersion, authorization, session,
    })) throw new Error('workbench: browser session authorization revoked')
    return hydrate(session)
  })
}
