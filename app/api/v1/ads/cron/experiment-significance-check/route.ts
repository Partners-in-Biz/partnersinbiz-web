// app/api/v1/ads/cron/experiment-significance-check/route.ts
import { NextRequest } from 'next/server'
import { apiSuccess, apiError } from '@/lib/api/response'
import { adminDb } from '@/lib/firebase/admin'
import { appendResult, updateExperimentStatus } from '@/lib/ads/experiments/store'
import { aggregateAllVariants } from '@/lib/ads/experiments/results'
import { computeSignificance } from '@/lib/ads/experiments/significance'
import { Timestamp } from 'firebase-admin/firestore'
import type { AdExperiment } from '@/lib/ads/experiments/types'
import type { SignificanceInput } from '@/lib/ads/experiments/significance'

export const dynamic = 'force-dynamic'

function toDateString(ts: { seconds: number } | undefined): string {
  if (!ts) return new Date().toISOString().slice(0, 10)
  return new Date(ts.seconds * 1000).toISOString().slice(0, 10)
}

function daysSince(ts: { seconds: number } | undefined): number {
  if (!ts) return 0
  const msElapsed = Date.now() - ts.seconds * 1000
  return Math.floor(msElapsed / (1000 * 60 * 60 * 24))
}

export async function GET(req: NextRequest) {
  // Auth via CRON_SECRET header (Vercel cron pattern)
  const expected = process.env.CRON_SECRET
  if (expected) {
    const provided = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
    if (provided !== expected) return apiError('Unauthorized', 401)
  }

  // Fetch all running experiments
  const snap = await adminDb
    .collection('ad_experiments')
    .where('status', '==', 'running')
    .get()

  const experiments = snap.docs.map((d) => d.data() as AdExperiment)

  const results: Array<{
    experimentId: string
    pValue?: number
    confident?: boolean
    declared?: boolean
    skipped?: boolean
    error?: string
  }> = []

  for (const experiment of experiments) {
    try {
      const elapsed = daysSince(experiment.startedAt as { seconds: number } | undefined)

      // Aggregate and compute regardless (so we persist fresh significance)
      const fromDate = toDateString(experiment.startedAt as { seconds: number } | undefined)
      const toDate = new Date().toISOString().slice(0, 10)

      const variantResults = await aggregateAllVariants({ experiment, fromDate, toDate })

      const sigInput: SignificanceInput = {
        metric: experiment.successMetric,
        variants: variantResults.map((r) => ({
          id: r.variantId,
          impressions: r.impressions,
          clicks: r.clicks,
          conversions: r.conversions,
          spendCents: r.spendCents,
        })),
      }

      const significance = computeSignificance({ input: sigInput, threshold: experiment.significanceThreshold })

      // Persist results per variant
      await Promise.all(variantResults.map((r) => appendResult({ experimentId: experiment.id, result: r })))

      // Persist significance on experiment
      const sigWithTimestamp = {
        pValue: significance.pValue,
        confident: significance.confident,
        winnerVariantId: significance.winnerVariantId,
        computedAt: Timestamp.now(),
      }
      await updateExperimentStatus(experiment.id, 'running', { significance: sigWithTimestamp })

      // Skip winner declaration if minDays not yet elapsed
      if (elapsed < experiment.minDays) {
        results.push({ experimentId: experiment.id, pValue: significance.pValue, confident: significance.confident, skipped: true })
        continue
      }

      let declared = false

      // Auto-declare winner if confident and autoWinner enabled
      if (significance.confident && experiment.autoWinner && significance.winnerVariantId) {
        const entityCollection = experiment.level === 'adset' ? 'ad_sets' : 'ads'
        const pauseOps = experiment.variants
          .filter((v) => v.id !== significance.winnerVariantId && v.entityId)
          .map((v) =>
            adminDb.collection(entityCollection).doc(v.entityId!).update({
              status: 'PAUSED',
              updatedAt: Timestamp.now(),
            })
          )
        await Promise.all(pauseOps)

        await updateExperimentStatus(experiment.id, 'winner_declared', {
          declaredWinnerVariantId: significance.winnerVariantId,
          endedAt: Timestamp.now(),
        })
        declared = true
      }

      results.push({ experimentId: experiment.id, pValue: significance.pValue, confident: significance.confident, declared })
    } catch (err) {
      results.push({ experimentId: experiment.id, error: (err as Error).message })
    }
  }

  return apiSuccess({ processed: experiments.length, results })
}
