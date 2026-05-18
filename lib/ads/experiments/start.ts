// lib/ads/experiments/start.ts
import { adminDb } from '@/lib/firebase/admin'
import { Timestamp } from 'firebase-admin/firestore'
import type { AdExperiment } from './types'
import crypto from 'crypto'

/** Duplicate the source entity (ad-set or ad) for each variant. Applies overrides
 *  + traffic-percent budget scaling. Returns the experiment with variant.entityId populated. */
export async function generateVariantEntities(args: {
  experiment: AdExperiment
}): Promise<AdExperiment> {
  const sourceCollection = args.experiment.level === 'adset' ? 'ad_sets' : 'ads'
  const sourceRef = adminDb.collection(sourceCollection).doc(args.experiment.sourceEntityId)
  const sourceSnap = await sourceRef.get()
  if (!sourceSnap.exists) throw new Error(`Source entity ${args.experiment.sourceEntityId} not found in ${sourceCollection}`)
  const source = sourceSnap.data() as Record<string, unknown>

  // For each variant beyond the first (control), duplicate the source.
  // The control (variant index 0) reuses the source entity — its entityId is the source's id.
  const updatedVariants = await Promise.all(args.experiment.variants.map(async (v, idx) => {
    if (idx === 0) {
      return { ...v, entityId: args.experiment.sourceEntityId }
    }
    const newId = sourceCollection === 'ad_sets'
      ? `as_${crypto.randomBytes(8).toString('hex')}`
      : `ad_${crypto.randomBytes(8).toString('hex')}`

    // Compose duplicate doc — strip id, override fields, scale budget by trafficPercent
    const dup: Record<string, unknown> = {
      ...source,
      id: newId,
      // Tag with experiment id for traceability
      experimentId: args.experiment.id,
      experimentVariantId: v.id,
      status: source.status,  // mirror parent status
      updatedAt: Timestamp.now(),
      createdAt: Timestamp.now(),
    }
    // Apply variant-level overrides
    if (v.overrides) {
      for (const [k, val] of Object.entries(v.overrides)) dup[k] = val
    }
    // Scale budget proportionally by traffic percent
    // For ad_sets the budget field varies per platform — apply a generic split rule
    // via a top-level `dailyBudgetCents` field if it exists on the source.
    const sourceBudget = (source as { dailyBudgetCents?: number }).dailyBudgetCents
    if (typeof sourceBudget === 'number') {
      dup.dailyBudgetCents = Math.round(sourceBudget * (v.trafficPercent / 100))
    }
    await adminDb.collection(sourceCollection).doc(newId).set(dup)
    return { ...v, entityId: newId }
  }))

  // Update the source entity (variant a / control) traffic-percent budget if applicable
  if (updatedVariants[0]) {
    const controlPercent = args.experiment.variants[0].trafficPercent
    const sourceBudget = (source as { dailyBudgetCents?: number }).dailyBudgetCents
    if (typeof sourceBudget === 'number' && controlPercent < 100) {
      const scaled = Math.round(sourceBudget * (controlPercent / 100))
      await sourceRef.update({ dailyBudgetCents: scaled, experimentId: args.experiment.id, experimentVariantId: updatedVariants[0].id, updatedAt: Timestamp.now() })
    }
  }

  return { ...args.experiment, variants: updatedVariants }
}
