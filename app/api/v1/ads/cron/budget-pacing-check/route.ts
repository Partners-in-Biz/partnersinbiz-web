import { NextRequest } from 'next/server'
import { apiSuccess, apiError } from '@/lib/api/response'
import { adminDb } from '@/lib/firebase/admin'
import { computeWindowStart, updateBudgetTracking, appendEvent, resetBudgetForNewPeriod } from '@/lib/ads/budgets/store'
import { sumSpendInScope, computeCheck } from '@/lib/ads/budgets/pacing'
import { autoPauseCampaignsInScope } from '@/lib/ads/budgets/auto-pause'
import { Timestamp } from 'firebase-admin/firestore'
import type { AdBudget } from '@/lib/ads/budgets/types'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  // Auth via CRON_SECRET header (Vercel cron pattern)
  const expected = process.env.CRON_SECRET
  if (expected) {
    const provided = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
    if (provided !== expected) return apiError('Unauthorized', 401)
  }

  const snap = await adminDb.collection('ad_budgets').get()
  const budgets = snap.docs.map((d) => d.data() as AdBudget).filter((b) => !b.archivedAt)

  const results: Array<{
    budgetId: string
    orgId: string
    percent: number
    alerts: number
    paused: number
    rollover?: boolean
    error?: string
  }> = []

  for (const budget of budgets) {
    try {
      // Period rollover detection
      const currentWindowStart = computeWindowStart(budget.period)
      const budgetWindowStart = budget.periodStart.toDate
        ? budget.periodStart.toDate()
        : new Date((budget.periodStart as unknown as { _seconds: number })._seconds * 1000)
      const cwsDate = currentWindowStart.toDate
        ? currentWindowStart.toDate()
        : new Date((currentWindowStart as unknown as { _seconds: number })._seconds * 1000)

      if (cwsDate.getTime() > budgetWindowStart.getTime()) {
        // New period — reset
        await resetBudgetForNewPeriod({ budgetId: budget.id, newPeriodStart: currentWindowStart })
        await appendEvent({ budgetId: budget.id, type: 'reset', spendCents: 0, percent: 0 })
        results.push({ budgetId: budget.id, orgId: budget.orgId, percent: 0, alerts: 0, paused: 0, rollover: true })
        continue
      }

      const spendCents = await sumSpendInScope(budget, budget.periodStart)
      const check = computeCheck(budget, spendCents)

      for (const t of check.newThresholds) {
        await appendEvent({
          budgetId: budget.id, type: 'threshold_alert',
          spendCents: check.spendCents, percent: check.percent, threshold: t,
        })
      }

      let pausedCampaignIds: string[] | undefined
      if (check.shouldAutoPause) {
        pausedCampaignIds = await autoPauseCampaignsInScope({ budget })
        await appendEvent({
          budgetId: budget.id, type: 'auto_paused',
          spendCents: check.spendCents, percent: check.percent, pausedCampaignIds,
        })
      }

      if (check.newThresholds.length === 0 && !pausedCampaignIds) {
        await appendEvent({
          budgetId: budget.id, type: 'pacing_check',
          spendCents: check.spendCents, percent: check.percent,
        })
      }

      const nextFired = [...new Set([...(budget.firedThresholds ?? []), ...check.newThresholds])]
      await updateBudgetTracking(budget.id, {
        currentSpendCents: check.spendCents,
        currentSpendPercent: check.percent,
        lastCheckedAt: Timestamp.now(),
        firedThresholds: nextFired,
        pausedCampaignIds: pausedCampaignIds ?? budget.pausedCampaignIds,
      })

      results.push({
        budgetId: budget.id,
        orgId: budget.orgId,
        percent: check.percent,
        alerts: check.newThresholds.length,
        paused: pausedCampaignIds?.length ?? 0,
      })
    } catch (err) {
      results.push({
        budgetId: budget.id,
        orgId: budget.orgId,
        percent: 0,
        alerts: 0,
        paused: 0,
        error: (err as Error).message,
      })
    }
  }

  return apiSuccess({ processed: budgets.length, results })
}
