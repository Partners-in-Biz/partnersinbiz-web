// app/api/v1/ads/experiments/[id]/compute/route.ts
import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { apiSuccess, apiError } from '@/lib/api/response'
import { getExperiment, appendResult, updateExperimentStatus } from '@/lib/ads/experiments/store'
import { aggregateAllVariants } from '@/lib/ads/experiments/results'
import { computeSignificance } from '@/lib/ads/experiments/significance'
import { Timestamp } from 'firebase-admin/firestore'
import type { SignificanceInput } from '@/lib/ads/experiments/significance'

export const dynamic = 'force-dynamic'

function toDateString(ts: { seconds: number } | undefined): string {
  if (!ts) return new Date().toISOString().slice(0, 10)
  return new Date(ts.seconds * 1000).toISOString().slice(0, 10)
}

export const POST = withAuth(
  'admin',
  async (req: NextRequest, _user: unknown, ctx: { params: Promise<{ id: string }> }) => {
    const orgId = req.headers.get('X-Org-Id')
    if (!orgId) return apiError('Missing X-Org-Id header', 400)
    const { id } = await ctx.params

    const experiment = await getExperiment(id)
    if (!experiment || experiment.orgId !== orgId) return apiError('Experiment not found', 404)

    try {
      const fromDate = toDateString(experiment.startedAt as { seconds: number } | undefined)
      const toDate = new Date().toISOString().slice(0, 10)

      // Aggregate metrics per variant
      const results = await aggregateAllVariants({ experiment, fromDate, toDate })

      // Build significance input
      const sigInput: SignificanceInput = {
        metric: experiment.successMetric,
        variants: results.map((r) => ({
          id: r.variantId,
          impressions: r.impressions,
          clicks: r.clicks,
          conversions: r.conversions,
          spendCents: r.spendCents,
        })),
      }

      const significance = computeSignificance({ input: sigInput, threshold: experiment.significanceThreshold })

      // Persist result records per variant
      await Promise.all(results.map((r) => appendResult({ experimentId: id, result: r })))

      // Persist significance on experiment
      const sigWithTimestamp = {
        pValue: significance.pValue,
        confident: significance.confident,
        winnerVariantId: significance.winnerVariantId,
        computedAt: Timestamp.now(),
      }
      await updateExperimentStatus(id, experiment.status, { significance: sigWithTimestamp })

      return apiSuccess({ results, significance })
    } catch (err) {
      return apiError((err as Error).message ?? 'Compute failed', 500)
    }
  },
)
