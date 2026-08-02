/**
 * GET /api/cron/workflow-graph
 * Hermes/Vercel cron: evaluate stuck SLAs on recent runs + start due cron-triggered templates.
 * Auth: x-vercel-cron or Bearer CRON_SECRET (same as project-playbooks).
 */
import { NextRequest } from 'next/server'
import { adminDb } from '@/lib/firebase/admin'
import { apiError, apiSuccess } from '@/lib/api/response'
import {
  applyStuckEvaluation,
  handleCronTriggerTick,
  listOpsWorkflowRuns,
  saveWorkflowRun,
  type WorkflowRun,
} from '@/lib/workflow-graph'

export const dynamic = 'force-dynamic'

function authorized(req: NextRequest): boolean {
  const auth = req.headers.get('authorization')
  const vercelCron = req.headers.get('x-vercel-cron')
  return Boolean(vercelCron) || (Boolean(process.env.CRON_SECRET) && auth === `Bearer ${process.env.CRON_SECRET}`)
}

function cleanString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) return apiError('Unauthorized', 401)

  const url = new URL(req.url)
  const orgId = cleanString(url.searchParams.get('orgId')) || 'pib-platform-owner'
  const limit = Math.min(Math.max(Number(url.searchParams.get('limit') || 40), 1), 100)
  const nowIso = new Date().toISOString()

  // 1) Cron template starts (idempotent per hour bucket)
  const cronResult = await handleCronTriggerTick({ orgId, actorUid: 'cron', now: new Date() })

  // 2) Stuck SLA pass on non-terminal-ish runs for org
  const snap = await adminDb
    .collection('workflow_runs')
    .where('orgId', '==', orgId)
    .limit(limit)
    .get()
    .catch(() => null)

  const stuckUpdates: Array<{ runId: string; stuckReasonCode?: string }> = []
  if (snap) {
    for (const doc of snap.docs) {
      const run = { id: doc.id, ...(doc.data() as WorkflowRun) }
      if (['succeeded', 'failed', 'cancelled', 'abandoned_candidate'].includes(run.status)) continue
      const evaluated = applyStuckEvaluation(run, nowIso)
      if (
        evaluated.stuckReasonCode !== run.stuckReasonCode
        || evaluated.stuckAt !== run.stuckAt
      ) {
        await saveWorkflowRun({ ...evaluated, updatedAt: nowIso })
        stuckUpdates.push({ runId: evaluated.id!, stuckReasonCode: evaluated.stuckReasonCode })
      }
    }
  }

  const ops = await listOpsWorkflowRuns({ orgId, limit }).catch(() => ({
    items: [],
    facts: [],
    counts: { stuck: 0, blocked: 0, paused_budget: 0 },
  }))

  return apiSuccess({
    orgId,
    cron: cronResult,
    stuckUpdates,
    counts: ops.counts,
    topStuck: ops.items.filter((i) => i.bucket === 'stuck').slice(0, 10),
    topBlocked: ops.items.filter((i) => i.bucket === 'blocked').slice(0, 10),
    topPausedBudget: ops.items.filter((i) => i.bucket === 'paused_budget').slice(0, 10),
  })
}
