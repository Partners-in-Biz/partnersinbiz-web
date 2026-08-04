import type { Firestore, WriteBatch } from 'firebase-admin/firestore'

/** Firestore batch write limit is 500; stay under with headroom. */
export const FIRESTORE_BATCH_OP_SOFT_LIMIT = 400

export type ChunkedBatchWriter = {
  set: (collection: string, id: string, value: FirebaseFirestore.DocumentData, merge?: boolean) => Promise<void>
  /** Commit any pending ops. Safe to call when empty. */
  flush: () => Promise<void>
  readonly pendingOps: number
}

/**
 * Chunked writer so large statement/journal-adjacent saves do not hit the 500-op batch ceiling.
 */
export function createChunkedBatchWriter(
  db: Firestore,
  softLimit: number = FIRESTORE_BATCH_OP_SOFT_LIMIT,
): ChunkedBatchWriter {
  let batch: WriteBatch = db.batch()
  let ops = 0

  const flush = async () => {
    if (ops === 0) return
    await batch.commit()
    batch = db.batch()
    ops = 0
  }

  return {
    get pendingOps() {
      return ops
    },
    async set(collection, id, value, merge = true) {
      batch.set(db.collection(collection).doc(id), value, { merge })
      ops++
      if (ops >= softLimit) await flush()
    },
    flush,
  }
}
