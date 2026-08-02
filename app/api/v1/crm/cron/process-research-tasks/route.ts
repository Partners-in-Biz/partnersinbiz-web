// app/api/v1/crm/cron/process-research-tasks/route.ts
//
// Cron endpoint — leases due CRM research tasks across tenants and processes
// payload-backed enrichment (observations / mailbox body). Multi-machine safe.
// Pattern: GET, Bearer CRON_SECRET, ~55s budget.

import { NextRequest } from 'next/server'
import { apiSuccess, apiError } from '@/lib/api/response'
import { runWithFirestoreReadAudit } from '@/lib/firebase/read-audit'
import { runResearchTaskWorkerBatch } from '@/lib/crm/facts/research-worker'

export const dynamic = 'force-dynamic'

const TIME_BUDGET_MS = 55_000
const BATCH_SIZE = 25

export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) {
    return apiError('CRON_SECRET not configured', 500)
  }

  const provided = req.headers.get('authorization')
  if (provided !== `Bearer ${cronSecret}`) {
    return apiError('Unauthorized', 401)
  }

  return runWithFirestoreReadAudit('api/v1/crm/cron/process-research-tasks', async () => {
    const url = new URL(req.url)
    const maxTasksRaw = Number(url.searchParams.get('limit') ?? BATCH_SIZE)
    const maxTasks = Number.isFinite(maxTasksRaw)
      ? Math.min(Math.max(Math.floor(maxTasksRaw), 1), 100)
      : BATCH_SIZE

    const hostname =
      typeof process !== 'undefined' && typeof process.env.HOSTNAME === 'string'
        ? process.env.HOSTNAME
        : 'vercel'
    const workerId = `cron-research@${hostname}`.slice(0, 120)

    const batch = await runResearchTaskWorkerBatch({
      workerId,
      maxTasks,
      timeBudgetMs: TIME_BUDGET_MS,
      leaseSeconds: 300,
    })

    return apiSuccess({
      processed: batch.processed,
      succeeded: batch.succeeded,
      failed: batch.failed,
      skipped: batch.skipped,
      errors: batch.errors.slice(0, 20),
      workerId,
    })
  }, { logEveryRun: true })
}
