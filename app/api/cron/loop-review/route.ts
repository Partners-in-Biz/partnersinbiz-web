import { NextRequest } from 'next/server'
import { FieldValue } from 'firebase-admin/firestore'
import { apiError, apiSuccess } from '@/lib/api/response'
import { adminDb } from '@/lib/firebase/admin'
import { measureBusinessInsightOutcomes } from '@/lib/loop-engine/business-insight-outcomes'
import { collectLoopReviewSignals } from '@/lib/loop-engine/live-signal-collector'
import { getLoopById } from '@/lib/loop-engine/registry'
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

function safeDocKey(value: string): string {
  return value.replace(/\//g, '-')
}

function cronRunTelemetry(input: {
  source: string
  mode: 'collect' | 'both'
  startedAtMs: number
  startedAt: string
  scanned: number
  agentSignalCount: number
  businessSignalCount: number
  reviewDraftCount: number
  persistedReviewTaskCount: number
  skippedReviewTaskCount: number
  measuredOutcomeCount: number
}) {
  const completedAtMs = Date.now()
  const durationMs = Math.max(0, completedAtMs - input.startedAtMs)
  const completedAt = new Date(completedAtMs).toISOString()
  return {
    usage: {
      durationMs,
      retryCount: 0,
      toolCallCount: 0,
    },
    runtime: {
      source: input.source,
      mode: input.mode,
      startedAt: input.startedAt,
      completedAt,
      durationMs,
      scanned: input.scanned,
      agentSignalCount: input.agentSignalCount,
      businessSignalCount: input.businessSignalCount,
      reviewDraftCount: input.reviewDraftCount,
      persistedReviewTaskCount: input.persistedReviewTaskCount,
      skippedReviewTaskCount: input.skippedReviewTaskCount,
      measuredOutcomeCount: input.measuredOutcomeCount,
    },
    telemetry: {
      source: input.source,
      mode: input.mode,
      startedAt: input.startedAt,
      completedAt,
      durationMs,
      operationCount: input.scanned + input.reviewDraftCount + input.persistedReviewTaskCount + input.measuredOutcomeCount,
    },
  }
}

export async function GET(req: NextRequest) {
  const startedAtMs = Date.now()
  const startedAt = new Date(startedAtMs).toISOString()
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
  if (persist) {
    const loop = getLoopById('business-insight-review')
    const runId = `business-insight-review:cron:${safeDocKey(orgId)}:${safeDocKey(projectId ?? 'all')}:${startedAt.slice(0, 16)}`
    await adminDb.collection('loop_engine_runs').doc(runId).set({
      id: runId,
      loopId: 'business-insight-review',
      loopName: loop?.name ?? 'Business Insight Review Loop',
      orgId,
      projectId,
      status: reviewTaskPersistence.created.length > 0 ? 'executed' : reviewDrafts.length > 0 ? 'proposed' : 'evaluated',
      dryRun: false,
      ownerAgentId: loop?.ownerAgentId ?? 'pip',
      reviewerAgentId: loop?.reviewerAgentId ?? 'qa-release',
      trigger: { kind: 'cron', source: 'loop-review-cron' },
      sourceWindow: collection.sourceWindow,
      candidateSummary: `${collection.scanned} source item${collection.scanned === 1 ? '' : 's'} scanned; ${reviewDrafts.length} review draft${reviewDrafts.length === 1 ? '' : 's'} produced.`,
      observability: {
        lastMeaningfulAction: reviewTaskPersistence.created.length > 0
          ? `${reviewTaskPersistence.created.length} review task${reviewTaskPersistence.created.length === 1 ? '' : 's'} persisted.`
          : reviewDrafts.length > 0
            ? `${reviewDrafts.length} review draft${reviewDrafts.length === 1 ? '' : 's'} produced.`
            : 'Collected loop-review signals without producing review drafts.',
        noOpStreak: reviewDrafts.length > 0 ? 0 : 1,
        verificationFailures: [],
        budgetStatus: 'within-budget',
        needsHumanJudgment: reviewDrafts.length > 0,
        progressSignal: reviewTaskPersistence.created.length > 0 ? 'advanced' : reviewDrafts.length > 0 ? 'awaiting-approval' : 'no-op',
      },
      ...cronRunTelemetry({
        source: 'loop-review-cron',
        mode: runMode,
        startedAtMs,
        startedAt,
        scanned: collection.scanned,
        agentSignalCount: collection.agentSignals.length,
        businessSignalCount: collection.businessSignals.length,
        reviewDraftCount: reviewDrafts.length,
        persistedReviewTaskCount: reviewTaskPersistence.created.length,
        skippedReviewTaskCount: reviewTaskPersistence.skipped.length,
        measuredOutcomeCount: outcomeMeasurement?.measured ?? 0,
      }),
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: 'loop-review-cron',
      updatedByType: 'system',
    }, { merge: true })
  }

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
