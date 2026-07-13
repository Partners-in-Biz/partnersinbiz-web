import { createHash } from 'crypto'
import { adminDb } from '@/lib/firebase/admin'
import { FieldValue } from 'firebase-admin/firestore'
import type { VariantStatField } from '@/lib/ab-testing/cronHelpers'

interface RefLike { id: string }
interface SnapshotLike { exists: boolean; data(): Record<string, unknown> | undefined }
interface TxLike {
  get(ref: RefLike): Promise<SnapshotLike>
  create(ref: RefLike, value: Record<string, unknown>): void
  update(ref: RefLike, value: Record<string, unknown>): void
}

export async function applyVariantProjectionEffect(input: {
  eventId: string
  targetCollection: 'broadcasts' | 'sequences'
  targetId: string
  stepNumber?: number
  variantId: string
  field: VariantStatField
  db?: DbLike
}): Promise<boolean> {
  const db = input.db ?? (adminDb as unknown as DbLike)
  const targetRef = db.collection(input.targetCollection).doc(input.targetId)
  const effectId = `variant:${input.targetCollection}:${input.targetId}:${input.stepNumber ?? '-'}:${input.variantId}:${input.field}`
  const marker = db.collection('email_event_projection_effects').doc(effectDocId(input.eventId, effectId))
  return db.runTransaction(async (tx) => {
    if ((await tx.get(marker)).exists) return false
    const snapshot = await tx.get(targetRef)
    if (!snapshot.exists) return false
    const data = snapshot.data() ?? {}
    let path = ''
    if (input.targetCollection === 'broadcasts') {
      const variants = ((data.ab as { variants?: Array<{ id: string }> } | undefined)?.variants) ?? []
      const index = variants.findIndex((variant) => variant.id === input.variantId)
      if (index < 0) return false
      path = `ab.variants.${index}.${input.field}`
    } else {
      if (typeof input.stepNumber !== 'number') return false
      const steps = (data.steps as Array<{ ab?: { variants?: Array<{ id: string }> } }> | undefined) ?? []
      const variants = steps[input.stepNumber]?.ab?.variants ?? []
      const index = variants.findIndex((variant) => variant.id === input.variantId)
      if (index < 0) return false
      path = `steps.${input.stepNumber}.ab.variants.${index}.${input.field}`
    }
    tx.update(targetRef, { [path]: FieldValue.increment(1), updatedAt: FieldValue.serverTimestamp() })
    tx.create(marker, { eventId: input.eventId, effectId, status: 'completed', schemaVersion: 1 })
    return true
  })
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
