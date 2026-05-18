/**
 * GET /api/v1/crm/reports/pipeline-velocity
 * Returns average time-in-stage by pipeline/stage for the active workspace.
 * Auth: member+
 */
import { adminDb } from '@/lib/firebase/admin'
import { withCrmAuth } from '@/lib/auth/crm-middleware'
import { apiSuccess, apiErrorFromException } from '@/lib/api/response'
import type { Deal, DealStageHistoryEntry } from '@/lib/crm/types'

export const dynamic = 'force-dynamic'

interface StageVelocityAccumulator {
  pipelineId: string
  stageId: string
  dealCount: number
  totalDays: number
  maxDays: number
}

function toDate(value: unknown): Date | null {
  if (!value) return null
  if (value instanceof Date) return value
  const maybeTimestamp = value as { toDate?: () => Date; _seconds?: number; seconds?: number }
  if (typeof maybeTimestamp.toDate === 'function') return maybeTimestamp.toDate()
  const seconds = maybeTimestamp._seconds ?? maybeTimestamp.seconds
  if (typeof seconds === 'number') return new Date(seconds * 1000)
  const parsed = new Date(value as string)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

function daysBetween(from: Date, to: Date): number {
  const ms = Math.max(0, to.getTime() - from.getTime())
  return ms / (1000 * 60 * 60 * 24)
}

function stageStartForDeal(deal: Deal): Date | null {
  const history = Array.isArray(deal.stageHistory) ? deal.stageHistory : []
  const matching = history
    .filter((entry: DealStageHistoryEntry) =>
      entry.pipelineId === deal.pipelineId && entry.stageId === deal.stageId,
    )
    .map((entry) => toDate(entry.enteredAt))
    .filter((date): date is Date => date !== null)
    .sort((a, b) => b.getTime() - a.getTime())

  if (matching[0]) return matching[0]
  return toDate(deal.updatedAt) ?? toDate(deal.createdAt)
}

export const GET = withCrmAuth('member', async (_req, ctx) => {
  try {
    const snap = await adminDb.collection('deals')
      .where('orgId', '==', ctx.orgId)
      .limit(2000)
      .get()

    const now = new Date()
    const accumulators = new Map<string, StageVelocityAccumulator>()

    const deals = snap.docs
      .map((doc) => ({ id: doc.id, ...doc.data() }) as Deal)
      .filter((deal) => deal.deleted !== true)

    for (const deal of deals) {
      if (!deal.pipelineId || !deal.stageId) continue
      if (deal.lostReason || (deal.probability ?? 50) >= 100) continue

      const enteredAt = stageStartForDeal(deal)
      if (!enteredAt) continue

      const key = `${deal.pipelineId}:${deal.stageId}`
      const durationDays = daysBetween(enteredAt, now)
      const acc = accumulators.get(key) ?? {
        pipelineId: deal.pipelineId,
        stageId: deal.stageId,
        dealCount: 0,
        totalDays: 0,
        maxDays: 0,
      }
      acc.dealCount += 1
      acc.totalDays += durationDays
      acc.maxDays = Math.max(acc.maxDays, durationDays)
      accumulators.set(key, acc)
    }

    const stages = [...accumulators.values()]
      .map((stage) => {
        const avgDays = stage.dealCount > 0 ? stage.totalDays / stage.dealCount : 0
        return {
          pipelineId: stage.pipelineId,
          stageId: stage.stageId,
          dealCount: stage.dealCount,
          avgDays,
          maxDays: stage.maxDays,
          bottleneck: avgDays >= 14 || stage.maxDays >= 30,
        }
      })
      .sort((a, b) => b.avgDays - a.avgDays)

    const summary = {
      stageCount: stages.length,
      bottleneckCount: stages.filter((stage) => stage.bottleneck).length,
      slowestStage: stages[0] ?? null,
    }

    return apiSuccess({ stages, summary })
  } catch (err) {
    return apiErrorFromException(err)
  }
})
