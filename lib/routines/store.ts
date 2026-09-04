import { adminDb } from '@/lib/firebase/admin'
import {
  BOT_ROUTINES_COLLECTION,
  BOT_ROUTINE_RUNS_COLLECTION,
  BOT_ROUTINE_EVENT_DEDUPE_COLLECTION,
  ORG_INTEGRATIONS_COLLECTION,
  type BotRoutine,
  type BotRoutineRun,
  type OrgIntegration,
  type OrgIntegrationProvider,
} from './types'

function routinesCol() {
  return adminDb.collection(BOT_ROUTINES_COLLECTION)
}

function runsCol() {
  return adminDb.collection(BOT_ROUTINE_RUNS_COLLECTION)
}

function dedupeCol() {
  return adminDb.collection(BOT_ROUTINE_EVENT_DEDUPE_COLLECTION)
}

function integrationsCol() {
  return adminDb.collection(ORG_INTEGRATIONS_COLLECTION)
}

export function integrationDocId(orgId: string, provider: OrgIntegrationProvider): string {
  return `${orgId}_${provider}`
}

export async function getRoutine(routineId: string): Promise<BotRoutine | null> {
  const snap = await routinesCol().doc(routineId).get()
  if (!snap.exists) return null
  return { routineId: snap.id, ...snap.data() } as BotRoutine
}

export async function listRoutinesForAgent(orgId: string, agentId: string): Promise<BotRoutine[]> {
  const snap = await routinesCol()
    .where('orgId', '==', orgId)
    .where('agentId', '==', agentId)
    .where('status', '==', 'active')
    .limit(100)
    .get()
  return snap.docs.map((doc) => ({ routineId: doc.id, ...doc.data() } as BotRoutine))
}

export async function listDueScheduleRoutines(nowMs: number, limit = 40): Promise<BotRoutine[]> {
  const snap = await routinesCol()
    .where('enabled', '==', true)
    .where('status', '==', 'active')
    .where('triggerKind', '==', 'schedule')
    .where('nextRunAt', '<=', nowMs)
    .limit(limit)
    .get()
  return snap.docs.map((doc) => ({ routineId: doc.id, ...doc.data() } as BotRoutine))
}

export async function listEnabledEventRoutines(
  orgId: string,
  source: string,
): Promise<BotRoutine[]> {
  const snap = await routinesCol()
    .where('orgId', '==', orgId)
    .where('enabled', '==', true)
    .where('status', '==', 'active')
    .where('triggerKind', '==', 'event')
    .limit(100)
    .get()
  return snap.docs
    .map((doc) => ({ routineId: doc.id, ...doc.data() } as BotRoutine))
    .filter((r) => r.trigger.kind === 'event' && r.trigger.source === source)
}

export async function createRoutineDoc(routine: BotRoutine): Promise<BotRoutine> {
  await routinesCol().doc(routine.routineId).set(routine)
  return routine
}

export async function updateRoutineDoc(
  routineId: string,
  patch: Partial<BotRoutine>,
): Promise<void> {
  await routinesCol().doc(routineId).update(patch)
}

export async function createRunDoc(run: BotRoutineRun): Promise<BotRoutineRun> {
  await runsCol().doc(run.runId).set(run)
  return run
}

export async function updateRunDoc(runId: string, patch: Partial<BotRoutineRun>): Promise<void> {
  await runsCol().doc(runId).update(patch)
}

export async function listRunsForRoutine(
  routineId: string,
  limit = 30,
): Promise<BotRoutineRun[]> {
  const snap = await runsCol()
    .where('routineId', '==', routineId)
    .orderBy('startedAtMs', 'desc')
    .limit(limit)
    .get()
  return snap.docs.map((doc) => ({ runId: doc.id, ...doc.data() } as BotRoutineRun))
}

export async function tryClaimEventDedupe(
  routineId: string,
  eventId: string,
  expiresAtMs: number,
): Promise<boolean> {
  const id = `${routineId}_${eventId}`
  const ref = dedupeCol().doc(id)
  try {
    await adminDb.runTransaction(async (tx) => {
      const existing = await tx.get(ref)
      if (existing.exists) throw new Error('dedupe_hit')
      tx.set(ref, { id, expiresAtMs })
    })
    return true
  } catch {
    return false
  }
}

/**
 * Atomically claim a due schedule routine: bump nextRunAt so concurrent cron ticks skip it.
 * Returns the pre-claim snapshot when the lock succeeds, otherwise null.
 */
export async function claimDueScheduleRoutine(
  routineId: string,
  nowMs: number,
  nextRunAtMs: number,
): Promise<BotRoutine | null> {
  const ref = routinesCol().doc(routineId)
  try {
    return await adminDb.runTransaction(async (tx) => {
      const snap = await tx.get(ref)
      if (!snap.exists) return null
      const data = { routineId: snap.id, ...snap.data() } as BotRoutine
      if (!data.enabled || data.status !== 'active') return null
      if (data.triggerKind !== 'schedule') return null
      if (data.nextRunAt == null || data.nextRunAt > nowMs) return null
      tx.update(ref, {
        nextRunAt: nextRunAtMs,
        lastRunAt: nowMs,
        runCount: (data.runCount ?? 0) + 1,
        updatedAtMs: nowMs,
      })
      return data
    })
  } catch {
    return null
  }
}

export async function getOrgIntegration(
  orgId: string,
  provider: OrgIntegrationProvider,
): Promise<OrgIntegration | null> {
  const snap = await integrationsCol().doc(integrationDocId(orgId, provider)).get()
  if (!snap.exists) return null
  return snap.data() as OrgIntegration
}

export async function upsertOrgIntegration(row: OrgIntegration): Promise<OrgIntegration> {
  await integrationsCol().doc(integrationDocId(row.orgId, row.provider)).set(row, { merge: true })
  return row
}

export async function listOrgIntegrations(orgId: string): Promise<OrgIntegration[]> {
  const snap = await integrationsCol().where('orgId', '==', orgId).limit(20).get()
  return snap.docs.map((doc) => doc.data() as OrgIntegration)
}

export async function getRoutineByHookId(hookId: string): Promise<BotRoutine | null> {
  const snap = await routinesCol().where('hookId', '==', hookId).limit(1).get()
  if (snap.empty) return null
  const doc = snap.docs[0]
  return { routineId: doc.id, ...doc.data() } as BotRoutine
}

