// app/api/v1/crm/cron/process-automations/route.ts
// Runs every 5 minutes via Vercel cron.
// Processes pending_automations where scheduledAt <= now and status === 'pending'.
// Budget: up to 100 per run, 55s wall-clock limit.

import { NextRequest } from 'next/server'
import { apiSuccess, apiError } from '@/lib/api/response'
import { getPendingDue, markExecuted, markFailed, requeueRemainingActions } from '@/lib/automations/store'
import { executeActions } from '@/lib/automations/executor'
import type { AutomationAction } from '@/lib/automations/types'
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
      // Per-step wait (US-074): run leading steps until a step requests a delay,
      // then re-queue the remainder for a later cron pass. The first step's wait
      // was already honored by this item's scheduledAt, so only delays on steps
      // after index 0 split the batch.
      const actions = Array.isArray(item.actions) ? (item.actions as AutomationAction[]) : []
      let splitIndex = -1
      for (let i = 1; i < actions.length; i++) {
        const delay = actions[i]?.delayMinutes
        if (typeof delay === 'number' && delay > 0) {
          splitIndex = i
          break
        }
      }

      const toRunNow = splitIndex === -1 ? actions : actions.slice(0, splitIndex)
      const result = await executeActions(toRunNow, context)
      succeeded += result.succeeded
      if (result.errors.length) errors.push(...result.errors)

      if (splitIndex !== -1) {
        const remaining = actions.slice(splitIndex)
        const delayMinutes = remaining[0]?.delayMinutes ?? 0
        await requeueRemainingActions(item, remaining, delayMinutes)
      }

      await markExecuted(item.id)
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
