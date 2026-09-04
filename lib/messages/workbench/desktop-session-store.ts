/**
 * Lightweight Mac desktop session store (Phase 2).
 * Mirrors browser session lifecycle at a smaller surface: create → approve →
 * claim → follow frames → control → kill.
 */
import crypto from 'node:crypto'
import { FieldValue, Timestamp } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import { storeWorkbenchBrowserFrame } from '@/lib/messages/workbench/browser-frame-storage'
import {
  assertDesktopSessionComplete,
  assertLiveDesktopLease,
  isDesktopDrivingControl,
  isTerminalDesktopSessionStatus,
  type DesktopSession,
  type DesktopSessionActorKind,
  type DesktopSessionDriver,
  type DesktopSessionStatus,
} from '@/lib/messages/workbench/desktop-session'

export {
  assertDesktopSessionComplete,
  assertLiveDesktopLease,
  isDesktopDrivingControl,
  isTerminalDesktopSessionStatus,
  TERMINAL_DESKTOP_SESSION_STATUSES,
  DESKTOP_DRIVING_CONTROL_KINDS,
  type DesktopSession,
  type DesktopSessionActorKind,
  type DesktopSessionDriver,
  type DesktopSessionStatus,
} from '@/lib/messages/workbench/desktop-session'

export const WORKBENCH_DESKTOP_SESSIONS_PROTOCOL_VERSION = 2

export const WORKBENCH_DESKTOP_SESSIONS_COLLECTION = 'conversation_workbench_desktop_sessions'
export const WORKBENCH_DESKTOP_SESSION_QUEUES_COLLECTION = 'linked_device_workbench_desktop_session_queues'

const TTL_MS = 30 * 60 * 1000

function sessionRef(sessionId: string) {
  return adminDb.collection(WORKBENCH_DESKTOP_SESSIONS_COLLECTION).doc(sessionId)
}

function queueRef(deviceId: string) {
  return adminDb.collection(WORKBENCH_DESKTOP_SESSION_QUEUES_COLLECTION).doc(deviceId)
}

export async function createWorkbenchDesktopSession(input: {
  conversationId: string
  orgId: string
  deviceId: string
  runtimeTargetId: string
  credentialVersion: number
  actorUserId: string
}): Promise<DesktopSession> {
  const sessionId = `desk_${crypto.randomBytes(12).toString('hex')}`
  const now = Date.now()
  const session: DesktopSession = {
    sessionId,
    conversationId: input.conversationId,
    orgId: input.orgId,
    deviceId: input.deviceId,
    runtimeTargetId: input.runtimeTargetId,
    credentialVersion: input.credentialVersion,
    status: 'awaiting_approval',
    driver: 'agent',
    latestFrameUrl: null,
    frameCount: 0,
    screenWidth: 1440,
    screenHeight: 900,
    leaseToken: null,
    pendingControls: [],
    createdAtMs: now,
    updatedAtMs: now,
    ttlExpiresAtMs: now + TTL_MS,
  }
  await sessionRef(sessionId).set({
    ...session,
    actorUserId: input.actorUserId,
    createdAt: Timestamp.fromMillis(now),
    updatedAt: Timestamp.fromMillis(now),
    ttlExpiresAt: Timestamp.fromMillis(session.ttlExpiresAtMs),
  })
  return session
}

export async function approveWorkbenchDesktopSession(sessionId: string): Promise<DesktopSession> {
  const ref = sessionRef(sessionId)
  await adminDb.runTransaction(async (tx) => {
    const snap = await tx.get(ref)
    if (!snap.exists) throw new Error('desktop session not found')
    const data = snap.data() as DesktopSession
    if (data.status !== 'awaiting_approval') return
    tx.update(ref, {
      status: 'queued',
      updatedAt: FieldValue.serverTimestamp(),
    })
    const q = queueRef(data.deviceId)
    tx.set(q, {
      sessionIds: FieldValue.arrayUnion(sessionId),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true })
  })
  return getWorkbenchDesktopSession(sessionId)
}

export async function getWorkbenchDesktopSession(sessionId: string): Promise<DesktopSession> {
  const snap = await sessionRef(sessionId).get()
  if (!snap.exists) throw new Error('desktop session not found')
  const data = snap.data() as Record<string, unknown>
  return {
    ...(data as unknown as DesktopSession),
    sessionId,
    pendingControls: Array.isArray(data.pendingControls) ? data.pendingControls as Array<Record<string, unknown>> : [],
  }
}

export type DesktopSessionClaim =
  | {
    kind: 'create'
    sessionId: string
    attempt: number
    leaseToken: string
    screenWidth: number
    screenHeight: number
    driver: DesktopSessionDriver
  }
  | {
    kind: 'control'
    sessionId: string
    control: Record<string, unknown>
    attempt: number
    leaseToken: string
    driver: DesktopSessionDriver
  }

export async function claimWorkbenchDesktopSession(input: {
  deviceId: string
  credentialVersion: number
  /** Runtime protocol; 2+ receives `driver` (always included for both). */
  protocolVersion?: number
}): Promise<DesktopSessionClaim | null> {
  const qSnap = await queueRef(input.deviceId).get()
  const sessionIds = Array.isArray(qSnap.data()?.sessionIds) ? qSnap.data()!.sessionIds as string[] : []
  for (const sessionId of sessionIds) {
    const session = await getWorkbenchDesktopSession(sessionId).catch(() => null)
    if (!session) continue
    if (session.status === 'queued') {
      const leaseToken = crypto.randomBytes(16).toString('hex')
      await sessionRef(sessionId).update({
        status: 'claimed',
        leaseToken,
        updatedAt: FieldValue.serverTimestamp(),
      })
      return {
        kind: 'create',
        sessionId,
        attempt: 1,
        leaseToken,
        screenWidth: session.screenWidth,
        screenHeight: session.screenHeight,
        driver: session.driver,
      }
    }
    if ((session.status === 'claimed' || session.status === 'running') && session.pendingControls.length > 0) {
      // While the human drives, skip agent-style driving controls so protocol-1
      // runtimes never execute them. Leave them queued until hand-back.
      let claimIndex = 0
      while (claimIndex < session.pendingControls.length) {
        const candidate = session.pendingControls[claimIndex]!
        if (session.driver === 'user' && isDesktopDrivingControl(candidate)) {
          claimIndex += 1
          continue
        }
        break
      }
      if (claimIndex >= session.pendingControls.length) continue
      const control = session.pendingControls[claimIndex]!
      const rest = [
        ...session.pendingControls.slice(0, claimIndex),
        ...session.pendingControls.slice(claimIndex + 1),
      ]
      const leaseToken = session.leaseToken || crypto.randomBytes(16).toString('hex')
      await sessionRef(sessionId).update({
        pendingControls: rest,
        leaseToken,
        status: 'running',
        updatedAt: FieldValue.serverTimestamp(),
      })
      return {
        kind: 'control',
        sessionId,
        control,
        attempt: 1,
        leaseToken,
        driver: session.driver,
      }
    }
  }
  return null
}

export async function enqueueDesktopControl(
  sessionId: string,
  control: Record<string, unknown>,
  options: { actorKind?: DesktopSessionActorKind } = {},
): Promise<DesktopSession> {
  const actorKind: DesktopSessionActorKind = options.actorKind ?? 'user'
  const session = await getWorkbenchDesktopSession(sessionId)
  if (isDesktopDrivingControl(control) && session.driver !== actorKind) {
    const owner = session.driver === 'agent' ? 'the agent' : 'the user'
    throw new Error(
      actorKind === 'agent' && session.driver === 'user'
        ? 'workbench: desktop session is being driven by the user'
        : `workbench: desktop session is being driven by ${owner} — take control first`,
    )
  }
  await sessionRef(sessionId).update({
    pendingControls: FieldValue.arrayUnion(control),
    updatedAt: FieldValue.serverTimestamp(),
  })
  return getWorkbenchDesktopSession(sessionId)
}

/**
 * Hands the wheel to `driver`. Humans may always set either side; an agent
 * cannot seize control while the human is driving (409).
 */
export async function setDesktopDriver(
  sessionId: string,
  driver: DesktopSessionDriver,
  options: { actorKind?: DesktopSessionActorKind } = {},
): Promise<DesktopSession> {
  const actorKind: DesktopSessionActorKind = options.actorKind ?? 'user'
  if (driver !== 'user' && driver !== 'agent') throw new Error('workbench: invalid desktop session driver')
  const session = await getWorkbenchDesktopSession(sessionId)
  if (actorKind === 'agent' && driver === 'agent' && session.driver === 'user') {
    throw new Error('workbench: desktop session is being driven by the user')
  }
  await sessionRef(sessionId).update({ driver, updatedAt: FieldValue.serverTimestamp() })
  return getWorkbenchDesktopSession(sessionId)
}

export async function storeDesktopFrame(input: {
  sessionId: string
  deviceId: string
  leaseToken: string
  seq: number
  contentType: 'image/jpeg' | 'image/png'
  bytes: Buffer
  screenWidth?: number
  screenHeight?: number
  credentialVersion?: number
}): Promise<DesktopSession> {
  const session = await getWorkbenchDesktopSession(input.sessionId)
  assertLiveDesktopLease(session, {
    deviceId: input.deviceId,
    leaseToken: input.leaseToken,
    credentialVersion: input.credentialVersion,
  })
  const stored = await storeWorkbenchBrowserFrame({
    orgId: session.orgId,
    conversationId: session.conversationId,
    sessionId: input.sessionId,
    seq: input.seq,
    contentType: input.contentType,
    bytes: input.bytes,
  })
  // Rewrite path conceptually — storage helper still uses browser prefix; OK for Phase 2.
  await sessionRef(input.sessionId).update({
    status: 'running',
    latestFrameUrl: stored.imageUrl,
    frameCount: FieldValue.increment(1),
    ...(input.screenWidth ? { screenWidth: input.screenWidth } : {}),
    ...(input.screenHeight ? { screenHeight: input.screenHeight } : {}),
    updatedAt: FieldValue.serverTimestamp(),
  })
  // Skipped setAgentPresence(working, "Using the computer"): desktop sessions
  // carry orgId but not a durable agentId. ComputerActivityChip uses live
  // workbench session props from UnifiedChat instead.
  return getWorkbenchDesktopSession(input.sessionId)
}

async function markDesktopSessionTerminal(session: DesktopSession, status: DesktopSessionStatus): Promise<DesktopSession> {
  if (isTerminalDesktopSessionStatus(session.status)) return session
  await sessionRef(session.sessionId).update({
    status,
    leaseToken: null,
    pendingControls: [],
    updatedAt: FieldValue.serverTimestamp(),
  })
  await queueRef(session.deviceId).set({
    sessionIds: FieldValue.arrayRemove(session.sessionId),
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true })
  return getWorkbenchDesktopSession(session.sessionId)
}

export async function completeDesktopSession(input: {
  sessionId: string
  deviceId: string
  credentialVersion: number
  leaseToken?: string
  status?: DesktopSessionStatus
}): Promise<DesktopSession> {
  const session = await getWorkbenchDesktopSession(input.sessionId)
  assertDesktopSessionComplete(session, {
    deviceId: input.deviceId,
    credentialVersion: input.credentialVersion,
    leaseToken: input.leaseToken,
  })
  const status = input.status && isTerminalDesktopSessionStatus(input.status) ? input.status : 'killed'
  return markDesktopSessionTerminal(session, status)
}

/** Conversation-auth kill path: caller already proved they own the chat. */
export async function finalizeDesktopSessionForConversation(input: {
  sessionId: string
  conversationId: string
  status?: DesktopSessionStatus
}): Promise<DesktopSession> {
  const session = await getWorkbenchDesktopSession(input.sessionId)
  if (session.conversationId !== input.conversationId) throw new Error('desktop session not found')
  const status = input.status && isTerminalDesktopSessionStatus(input.status) ? input.status : 'killed'
  return markDesktopSessionTerminal(session, status)
}

export function publicDesktopSession(session: DesktopSession) {
  return {
    sessionId: session.sessionId,
    conversationId: session.conversationId,
    status: session.status,
    driver: session.driver,
    latestFrameUrl: session.latestFrameUrl,
    frameCount: session.frameCount,
    screenWidth: session.screenWidth,
    screenHeight: session.screenHeight,
    sessionKind: 'desktop' as const,
  }
}
