/**
 * Transactional claim, heartbeat, and stale-task sweeper.
 *
 * Claim: CAS from agentStatus='pending' → 'picked-up' + sets agentHeartbeatAt.
 *   Two replicas can never grab the same task — Firestore transaction guarantees that.
 *
 * Heartbeat: bumps agentHeartbeatAt every 30s while the watcher is actively running a task.
 *
 * Stale sweeper: every 60s, scans tasks in (picked-up | in-progress) whose heartbeat is
 *   older than 5 minutes and resets them to 'pending' so they can be re-claimed.
 */
import type { DocumentReference, Firestore } from 'firebase-admin/firestore'
import { db, FieldValue } from './firestore'
import { logger } from './logger'
import { agentStatusUpdate } from './task-updates'
import { getUnresolvedDependencyIds, hasPendingApprovalGate, hasPendingScheduledRelease } from './eligibility'

const STALE_THRESHOLD_MS = 5 * 60 * 1_000
const SWEEP_INTERVAL_MS = 60 * 1_000
const MAX_STALE_SWEEP_DOCS = 100
export const HEARTBEAT_INTERVAL_MS = 30 * 1_000

export async function claimTask(taskRef: DocumentReference, expectedAgentId: string): Promise<boolean> {
  try {
    return await (db as Firestore).runTransaction(async (tx) => {
      const snap = await tx.get(taskRef)
      if (!snap.exists) return false
      const data = snap.data() ?? {}
      if (data.assigneeAgentId !== expectedAgentId) return false
      if (data.agentStatus !== 'pending') return false
      if (data.columnId !== 'todo') return false
      if (data.deleted === true) return false
      if (data.status === 'cancelled' || data.status === 'canceled') return false
      if (hasPendingScheduledRelease(data)) return false
      if (hasPendingApprovalGate(data)) return false

      const dependsOn = Array.isArray(data.dependsOn) ? data.dependsOn.filter(Boolean) : []
      if (dependsOn.length > 0) {
        const dependenciesById: Record<string, { agentStatus?: string | null; columnId?: string | null } | null> = {}
        for (const dependencyId of dependsOn) {
          const depSnap = await tx.get(taskRef.parent.doc(String(dependencyId)))
          dependenciesById[String(dependencyId)] = depSnap.exists ? (depSnap.data() ?? {}) : null
        }
        if (getUnresolvedDependencyIds(dependsOn.map(String), dependenciesById).length > 0) return false
      }

      tx.update(taskRef, {
        ...agentStatusUpdate('picked-up'),
        agentHeartbeatAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      })
      return true
    })
  } catch (err) {
    logger.warn('claimTask transaction failed', {
      path: taskRef.path,
      error: err instanceof Error ? err.message : String(err),
    })
    return false
  }
}

export async function claimReviewTask(taskRef: DocumentReference, reviewerAgentId: string): Promise<boolean> {
  try {
    return await (db as Firestore).runTransaction(async (tx) => {
      const snap = await tx.get(taskRef)
      if (!snap.exists) return false
      const data = snap.data() ?? {}
      if (data.columnId !== 'review') return false
      if (data.reviewStatus !== 'pending') return false
      if (data.agentStatus !== 'done') return false
      if (data.reviewerAgentId !== reviewerAgentId) return false

      tx.update(taskRef, {
        reviewStatus: 'in-progress',
        updatedAt: FieldValue.serverTimestamp(),
      })
      return true
    })
  } catch (err) {
    logger.warn('claimReviewTask transaction failed', {
      path: taskRef.path,
      error: err instanceof Error ? err.message : String(err),
    })
    return false
  }
}

export async function heartbeat(taskRef: DocumentReference): Promise<void> {
  try {
    await taskRef.update({
      agentHeartbeatAt: FieldValue.serverTimestamp(),
    })
  } catch (err) {
    logger.warn('heartbeat update failed', {
      path: taskRef.path,
      error: err instanceof Error ? err.message : String(err),
    })
  }
}

export function startHeartbeat(taskRef: DocumentReference): () => void {
  const handle = setInterval(() => {
    void heartbeat(taskRef)
  }, HEARTBEAT_INTERVAL_MS)
  return () => clearInterval(handle)
}

let sweeperHandle: NodeJS.Timeout | null = null
let staleSweeperDisabled = false

function heartbeatMillis(value: unknown): number | null {
  if (!value) return null
  if (typeof value === 'object' && value !== null && 'toMillis' in value && typeof (value as { toMillis: () => number }).toMillis === 'function') {
    try { return (value as { toMillis: () => number }).toMillis() } catch { return null }
  }
  if (typeof value === 'object' && value !== null && 'toDate' in value && typeof (value as { toDate: () => Date }).toDate === 'function') {
    try { return (value as { toDate: () => Date }).toDate().getTime() } catch { return null }
  }
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const millis = Date.parse(value)
    return Number.isFinite(millis) ? millis : null
  }
  return null
}

export async function sweepStaleTasks(now = Date.now()): Promise<number> {
  const cutoffMillis = now - STALE_THRESHOLD_MS
  const snap = await db
    .collectionGroup('tasks')
    .where('agentStatus', 'in', ['picked-up', 'in-progress'])
    .limit(MAX_STALE_SWEEP_DOCS)
    .get()

  if (snap.empty) return 0

  let reclaimed = 0
  const batchSize = 400
  let batch = db.batch()
  let opsInBatch = 0
  for (const doc of snap.docs) {
    const data = doc.data() ?? {}
    const heartbeat = heartbeatMillis(data.agentHeartbeatAt)
    if (heartbeat !== null && heartbeat >= cutoffMillis) continue

    batch.update(doc.ref, {
      ...agentStatusUpdate('pending'),
      agentHeartbeatAt: FieldValue.delete(),
      updatedAt: FieldValue.serverTimestamp(),
    })
    opsInBatch++
    reclaimed++
    if (opsInBatch >= batchSize) {
      await batch.commit()
      batch = db.batch()
      opsInBatch = 0
    }
  }
  if (opsInBatch > 0) {
    await batch.commit()
  }

  return reclaimed
}

export function startStaleSweeper(): () => void {
  async function sweepOnce() {
    if (staleSweeperDisabled) return
    try {
      const reclaimed = await sweepStaleTasks()
      if (reclaimed > 0) {
        logger.info('stale sweeper reclaimed tasks', { count: reclaimed })
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      if (message.includes('FAILED_PRECONDITION')) {
        staleSweeperDisabled = true
        logger.error('stale sweeper disabled until the tasks collection-group index exists', { error: message })
        return
      }
      logger.error('stale sweeper failed', {
        error: message,
      })
    }
  }

  // Initial run after a short delay so we don't slam Firestore during boot,
  // then on a fixed interval.
  const kickoff = setTimeout(() => {
    void sweepOnce()
    sweeperHandle = setInterval(() => void sweepOnce(), SWEEP_INTERVAL_MS)
  }, 5_000)

  return () => {
    clearTimeout(kickoff)
    if (sweeperHandle) {
      clearInterval(sweeperHandle)
      sweeperHandle = null
    }
  }
}
