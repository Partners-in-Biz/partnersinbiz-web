/**
 * Lightweight Mac desktop session store (Phase 2).
 * Mirrors browser session lifecycle at a smaller surface: create → approve →
 * claim → follow frames → control → kill.
 */
import crypto from 'node:crypto'
import { FieldValue, Timestamp } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import { storeWorkbenchBrowserFrame } from '@/lib/messages/workbench/browser-frame-storage'

export const WORKBENCH_DESKTOP_SESSIONS_COLLECTION = 'conversation_workbench_desktop_sessions'
export const WORKBENCH_DESKTOP_SESSION_QUEUES_COLLECTION = 'linked_device_workbench_desktop_session_queues'

export type DesktopSessionStatus =
  | 'awaiting_approval'
  | 'queued'
  | 'claimed'
  | 'running'
  | 'exited'
  | 'killed'
  | 'expired'
  | 'failed'

export type DesktopSessionDriver = 'agent' | 'user'

export type DesktopSession = {
  sessionId: string
  conversationId: string
  orgId: string
  deviceId: string
  runtimeTargetId: string
  credentialVersion: number
  status: DesktopSessionStatus
  driver: DesktopSessionDriver
  latestFrameUrl: string | null
  frameCount: number
  screenWidth: number
  screenHeight: number
  leaseToken: string | null
  pendingControls: Array<Record<string, unknown>>
  createdAtMs: number
  updatedAtMs: number
  ttlExpiresAtMs: number
}

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

export async function claimWorkbenchDesktopSession(input: {
  deviceId: string
  credentialVersion: number
}): Promise<
  | { kind: 'create'; sessionId: string; attempt: number; leaseToken: string; screenWidth: number; screenHeight: number }
  | { kind: 'control'; sessionId: string; control: Record<string, unknown>; attempt: number; leaseToken: string }
  | null
> {
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
      }
    }
    if ((session.status === 'claimed' || session.status === 'running') && session.pendingControls.length > 0) {
      const control = session.pendingControls[0]!
      const rest = session.pendingControls.slice(1)
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
      }
    }
  }
  return null
}

export async function enqueueDesktopControl(sessionId: string, control: Record<string, unknown>): Promise<DesktopSession> {
  await sessionRef(sessionId).update({
    pendingControls: FieldValue.arrayUnion(control),
    updatedAt: FieldValue.serverTimestamp(),
  })
  return getWorkbenchDesktopSession(sessionId)
}

export async function setDesktopDriver(sessionId: string, driver: DesktopSessionDriver): Promise<DesktopSession> {
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
}): Promise<DesktopSession> {
  const session = await getWorkbenchDesktopSession(input.sessionId)
  if (session.deviceId !== input.deviceId) throw new Error('device mismatch')
  if (session.leaseToken && session.leaseToken !== input.leaseToken) throw new Error('lease mismatch')
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
  return getWorkbenchDesktopSession(input.sessionId)
}

export async function completeDesktopSession(sessionId: string, status: DesktopSessionStatus = 'killed'): Promise<void> {
  const session = await getWorkbenchDesktopSession(sessionId)
  await sessionRef(sessionId).update({
    status,
    leaseToken: null,
    pendingControls: [],
    updatedAt: FieldValue.serverTimestamp(),
  })
  await queueRef(session.deviceId).set({
    sessionIds: FieldValue.arrayRemove(sessionId),
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true })
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
