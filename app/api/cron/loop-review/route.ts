import { NextRequest } from 'next/server'
import { apiError, apiSuccess } from '@/lib/api/response'
import { measureBusinessInsightOutcomes } from '@/lib/loop-engine/business-insight-outcomes'
import { collectLoopReviewSignals } from '@/lib/loop-engine/live-signal-collector'
import { buildConservativeReviewTaskDrafts } from '@/lib/loop-engine/review-evaluator'
import { persistConservativeReviewTaskDrafts } from '@/lib/loop-engine/review-task-persistence'

export const dynamic = 'force-dynamic'

function authorized(req: NextRequest): boolean {
  const auth = req.headers.get('authorization')
  const vercelCron = req.headers.get('x-vercel-cron')
  return Boolean(vercelCron) || (Boolean(process.env.CRON_SECRET) && auth === `Bearer ${process.env.CRON_SECRET}`)
}

function cleanString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function cleanBool(value: unknown): boolean {
  if (typeof value !== 'string') return false
  return ['1', 'true', 'yes'].includes(value.trim().toLowerCase())
}

function queryLimit(req: NextRequest): number {
  const requested = Number(req.nextUrl.searchParams.get('limit') || 100)
  if (!Number.isFinite(requested)) return 100
  return Math.max(1, Math.min(250, Math.floor(requested)))
}

function mode(req: NextRequest): 'collect' | 'measure' | 'both' {
  const requested = cleanString(req.nextUrl.searchParams.get('mode'))
  if (requested === 'measure' || requested === 'both') return requested
  return 'collect'
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) return apiError('Unauthorized', 401)

  const orgId = cleanString(req.nextUrl.searchParams.get('orgId'))
  if (!orgId) return apiError('orgId is required', 400)

  const projectId = cleanString(req.nextUrl.searchParams.get('projectId'))
  const persist = cleanBool(req.nextUrl.searchParams.get('persist'))
  const runMode = mode(req)
  const outcomeMeasurement = runMode === 'measure' || runMode === 'both'
    ? await measureBusinessInsightOutcomes({
      orgId,
      projectId,
      limit: queryLimit(req),
    })
    : null
  if (runMode === 'measure') {
    return apiSuccess({
      mode: runMode,
      outcomeMeasurement,
    })
  }

  const collection = await collectLoopReviewSignals({
    orgId,
    projectId,
    limit: queryLimit(req),
  })
  const reviewDrafts = buildConservativeReviewTaskDrafts({
    orgId,
    projectId,
    sourceWindow: collection.sourceWindow,
    agentSignals: collection.agentSignals,
    businessSignals: collection.businessSignals,
    existingSuppressionKeys: collection.existingSuppressionKeys,
  })
  const reviewTaskPersistence = persist
    ? await persistConservativeReviewTaskDrafts({
      drafts: reviewDrafts,
      projectId,
      actorId: 'cron',
      createdByType: 'system',
    })
    : { created: [], skipped: [] }

  return apiSuccess({
    mode: runMode,
    scanned: collection.scanned,
    sourceWindow: collection.sourceWindow,
    agentSignalCount: collection.agentSignals.length,
    businessSignalCount: collection.businessSignals.length,
    draftCount: reviewDrafts.length,
    persisted: persist,
    reviewDrafts,
    reviewTaskPersistence,
    outcomeMeasurement,
  })
}
