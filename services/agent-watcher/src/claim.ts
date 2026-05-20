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
import { db, FieldValue, Timestamp } from './firestore'
import { logger } from './logger'
import { agentStatusUpdate } from './task-updates'

const STALE_THRESHOLD_MS = 5 * 60 * 1_000
const SWEEP_INTERVAL_MS = 60 * 1_000
export const HEARTBEAT_INTERVAL_MS = 30 * 1_000

export async function claimTask(taskRef: DocumentReference): Promise<boolean> {
  try {
    return await (db as Firestore).runTransaction(async (tx) => {
      const snap = await tx.get(taskRef)
      if (!snap.exists) return false
      const data = snap.data() ?? {}
      if (data.agentStatus !== 'pending') return false

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

export function startStaleSweeper(): () => void {
  async function sweepOnce() {
    const cutoff = Timestamp.fromMillis(Date.now() - STALE_THRESHOLD_MS)
    try {
      const snap = await db
        .collectionGroup('tasks')
        .where('agentStatus', 'in', ['picked-up', 'in-progress'])
        .where('agentHeartbeatAt', '<', cutoff)
        .get()

      if (snap.empty) return

      let reclaimed = 0
      const batchSize = 400
      let batch = db.batch()
      let opsInBatch = 0
      for (const doc of snap.docs) {
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

      if (reclaimed > 0) {
        logger.info('stale sweeper reclaimed tasks', { count: reclaimed })
      }
    } catch (err) {
      logger.error('stale sweeper failed', {
        error: err instanceof Error ? err.message : String(err),
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
