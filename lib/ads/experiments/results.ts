// lib/ads/experiments/results.ts
import { adminDb } from '@/lib/firebase/admin'
import { Timestamp } from 'firebase-admin/firestore'
import type { AdExperiment, AdExperimentResult } from './types'

/** Sum metric value across the date range for a single dimensionId. */
async function sumMetric(args: {
  orgId: string
  platform: string
  dimensionId: string
  metric: string  // 'impressions'|'clicks'|'conversions'|'spend_cents'
  level: 'campaign' | 'adset' | 'ad'
  fromDate: string
  toDate: string
}): Promise<number> {
  const source = `${args.platform}_ads`
  const q = adminDb.collection('metrics')
    .where('orgId', '==', args.orgId)
    .where('source', '==', source)
    .where('level', '==', args.level)
    .where('dimensionId', '==', args.dimensionId)
    .where('metric', '==', args.metric)
  const snap = await q.get()
  let total = 0
  for (const doc of snap.docs) {
    const data = doc.data() as { date?: string; value?: number }
    if (typeof data.date !== 'string') continue
    if (data.date < args.fromDate || data.date > args.toDate) continue
    if (typeof data.value === 'number') total += data.value
  }
  return total
}

/** Compute aggregated result for a single variant. */
export async function aggregateVariantResult(args: {
  experiment: AdExperiment
  variantId: string
  fromDate: string
  toDate: string
}): Promise<AdExperimentResult> {
  const variant = args.experiment.variants.find((v) => v.id === args.variantId)
  if (!variant || !variant.entityId) {
    throw new Error(`Variant ${args.variantId} has no entityId — experiment not started?`)
  }

  const level = args.experiment.level === 'adset' ? 'adset' : 'ad'
  const common = {
    orgId: args.experiment.orgId,
    platform: args.experiment.platform,
    dimensionId: variant.entityId,
    level: level as 'adset' | 'ad',
    fromDate: args.fromDate, toDate: args.toDate,
  }

  const [impressions, clicks, conversions, spendCents] = await Promise.all([
    sumMetric({ ...common, metric: 'impressions' }),
    sumMetric({ ...common, metric: 'clicks' }),
    sumMetric({ ...common, metric: 'conversions' }),
    sumMetric({ ...common, metric: 'spend_cents' }),
  ])

  const ctr = impressions > 0 ? clicks / impressions : 0
  const cpc = clicks > 0 ? spendCents / clicks : undefined
  const cpa = conversions > 0 ? spendCents / conversions : undefined
  const convRate = clicks > 0 ? conversions / clicks : 0

  return {
    id: `r_${args.variantId}_${args.fromDate}_${args.toDate}`,
    experimentId: args.experiment.id,
    variantId: args.variantId,
    fromDate: args.fromDate, toDate: args.toDate,
    impressions, clicks, conversions, spendCents,
    ctr, cpc, cpa, convRate,
    computedAt: Timestamp.now(),
  }
}

/** Aggregate ALL variants for an experiment. */
export async function aggregateAllVariants(args: {
  experiment: AdExperiment
  fromDate: string
  toDate: string
}): Promise<AdExperimentResult[]> {
  return Promise.all(args.experiment.variants.map((v) =>
    aggregateVariantResult({ experiment: args.experiment, variantId: v.id, fromDate: args.fromDate, toDate: args.toDate })
  ))
}
