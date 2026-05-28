// app/api/v1/crm/cron/process-automations/route.ts
// Runs every 5 minutes via Vercel cron.
// Processes pending_automations where scheduledAt <= now and status === 'pending'.
// Budget: up to 100 per run, 55s wall-clock limit.

import { NextRequest } from 'next/server'
import { apiSuccess, apiError } from '@/lib/api/response'
import { getPendingDue, markExecuted, markFailed } from '@/lib/automations/store'
import { executeActions } from '@/lib/automations/executor'
import { runWithFirestoreReadAudit } from '@/lib/firebase/read-audit'

export const dynamic = 'force-dynamic'

const BATCH_SIZE = 100
const TIME_BUDGET_MS = 55_000

export async function GET(req: NextRequest) {
  // ── Auth ────────────────────────────────────────────────────────────────────
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) return apiError('CRON_SECRET not configured', 500)

  const provided = req.headers.get('authorization')
  if (provided !== `Bearer ${cronSecret}`) return apiError('Unauthorized', 401)

  return runWithFirestoreReadAudit('api/v1/crm/cron/process-automations', async () => {
  // ── Init ─────────────────────────────────────────────────────────────────────
  const startedAt = Date.now()
  let processed = 0
  let succeeded = 0
  let failed = 0
  const errors: string[] = []

  const pending = await getPendingDue(BATCH_SIZE)

  for (const item of pending) {
    if (Date.now() - startedAt > TIME_BUDGET_MS) break

    const context = {
      orgId: item.orgId,
      dealId: item.contextDealId,
      contactId: item.contextContactId,
      contactEmail: item.contextContactEmail,
      ownerEmail: item.contextOwnerEmail,
    }

    try {
      const result = await executeActions(item.actions, context)
      await markExecuted(item.id)
      succeeded += result.succeeded
      if (result.errors.length) errors.push(...result.errors)
    } catch (err) {
      const msg = `pending/${item.id}: ${(err as Error).message}`
      errors.push(msg)
      await markFailed(item.id, msg).catch(() => {})
      failed++
    }
    processed++
  }

  return apiSuccess({ processed, succeeded, failed, errors })
  })
}
