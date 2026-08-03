/**
 * GET /api/cron/workflow-graph
 * Hermes/Vercel cron: evaluate stuck SLAs on recent runs + start due cron-triggered templates.
 * Auth: x-vercel-cron or Bearer CRON_SECRET (same as project-playbooks).
 */
import { NextRequest } from 'next/server'
import { adminDb } from '@/lib/firebase/admin'
import { apiError, apiSuccess } from '@/lib/api/response'
import {
  finalizeOpsSideEffects,
  handleCronTriggerTick,
  listOpsWorkflowRuns,
  processWorkflowWritebackOutbox,
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

  // 0) Drain watcher outbox so live agent terminal states advance the ledger
  const writeback = await processWorkflowWritebackOutbox({ limit: 40, actorUid: 'cron' }).catch((err) => ({
    processed: 0,
    applied: 0,
    failed: 0,
    errors: [err instanceof Error ? err.message : String(err)],
  }))

  // 1) Cron template starts (idempotent per hour bucket)
  const cronResult = await handleCronTriggerTick({ orgId, actorUid: 'cron', now: new Date() })

  // 2) Stuck SLA pass on non-terminal-ish runs for org
  const snap = await adminDb
    .collection('workflow_runs')
    .where('orgId', '==', orgId)
    .limit(limit)
    .get()
    .catch(() => null)

  const stuckUpdates: Array<{ runId: string; stuckReasonCode?: string; factDedupeKey?: string }> = []
  if (snap) {
    for (const doc of snap.docs) {
      const run = { id: doc.id, ...(doc.data() as WorkflowRun) }
      if (['succeeded', 'failed', 'cancelled', 'abandoned_candidate'].includes(run.status)) continue
      // Stuck SLA + alert-on-block facts share finalizeOpsSideEffects with advance path
      // so heartbeat-stale runs that never advance still get workflow_ops_facts.
      const finalized = await finalizeOpsSideEffects(run, run, nowIso)
      const stuckChanged =
        finalized.stuckReasonCode !== run.stuckReasonCode
        || finalized.stuckAt !== run.stuckAt
      const alertChanged =
        finalized.blockRevision !== run.blockRevision
        || finalized.lastAlertDedupeKey !== run.lastAlertDedupeKey
      if (stuckChanged || alertChanged) {
        await saveWorkflowRun({ ...finalized, updatedAt: nowIso })
        if (stuckChanged || finalized.stuckReasonCode) {
          stuckUpdates.push({
            runId: finalized.id!,
            stuckReasonCode: finalized.stuckReasonCode,
            factDedupeKey: finalized.lastAlertDedupeKey,
          })
        }
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
    writeback,
    cron: cronResult,
    stuckUpdates,
    counts: ops.counts,
    topStuck: ops.items.filter((i) => i.bucket === 'stuck').slice(0, 10),
    topBlocked: ops.items.filter((i) => i.bucket === 'blocked').slice(0, 10),
    topPausedBudget: ops.items.filter((i) => i.bucket === 'paused_budget').slice(0, 10),
  })
}
