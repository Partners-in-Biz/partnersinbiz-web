import { createHash } from 'crypto'
import { adminDb } from '@/lib/firebase/admin'

interface RefLike { id: string }
interface SnapshotLike { exists: boolean; data(): Record<string, unknown> | undefined }
interface TxLike {
  get(ref: RefLike): Promise<SnapshotLike>
  create(ref: RefLike, value: Record<string, unknown>): void
  update(ref: RefLike, value: Record<string, unknown>): void
}
interface DbLike {
  collection(name: string): { doc(id: string): RefLike }
  runTransaction<T>(fn: (tx: TxLike) => Promise<T>): Promise<T>
}

const effectDocId = (eventId: string, effectId: string) =>
  `${eventId}_${createHash('sha256').update(effectId).digest('hex').slice(0, 24)}`

/** Atomically applies a Firestore projection mutation and its completion marker. */
export async function applyFirestoreProjectionEffect(input: {
  eventId: string
  effectId: string
  targetRef: RefLike
  update: Record<string, unknown>
  db?: DbLike
}): Promise<boolean> {
  const db = input.db ?? (adminDb as unknown as DbLike)
  const marker = db.collection('email_event_projection_effects').doc(effectDocId(input.eventId, input.effectId))
  return db.runTransaction(async (tx) => {
    if ((await tx.get(marker)).exists) return false
    tx.update(input.targetRef, input.update)
    tx.create(marker, { eventId: input.eventId, effectId: input.effectId, status: 'completed', schemaVersion: 1 })
    return true
  })
}
