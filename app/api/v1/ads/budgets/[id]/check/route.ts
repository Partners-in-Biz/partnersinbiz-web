import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { apiSuccess, apiError } from '@/lib/api/response'
import { getBudget, computeWindowStart, updateBudgetTracking, appendEvent } from '@/lib/ads/budgets/store'
import { sumSpendInScope, computeCheck } from '@/lib/ads/budgets/pacing'
import { autoPauseCampaignsInScope } from '@/lib/ads/budgets/auto-pause'
import { Timestamp } from 'firebase-admin/firestore'

export const dynamic = 'force-dynamic'

export const POST = withAuth(
  'admin',
  async (req: NextRequest, _user: unknown, ctx: { params: Promise<{ id: string }> }) => {
    const orgId = req.headers.get('X-Org-Id')
    if (!orgId) return apiError('Missing X-Org-Id header', 400)
    const { id } = await ctx.params
    const budget = await getBudget(id)
    if (!budget || budget.orgId !== orgId) return apiError('Budget not found', 404)

    const windowStart = budget.periodStart ?? computeWindowStart(budget.period)
    const spendCents = await sumSpendInScope(budget, windowStart)
    const check = computeCheck(budget, spendCents)

    // Fire threshold alert events
    for (const t of check.newThresholds) {
      await appendEvent({
        budgetId: id, type: 'threshold_alert',
        spendCents: check.spendCents, percent: check.percent, threshold: t,
      })
    }

    let pausedCampaignIds: string[] | undefined
    if (check.shouldAutoPause) {
      pausedCampaignIds = await autoPauseCampaignsInScope({ budget })
      await appendEvent({
        budgetId: id, type: 'auto_paused',
        spendCents: check.spendCents, percent: check.percent, pausedCampaignIds,
      })
    }

    if (check.newThresholds.length === 0 && !pausedCampaignIds) {
      await appendEvent({
        budgetId: id, type: 'pacing_check',
        spendCents: check.spendCents, percent: check.percent,
      })
    }

    const nextFired = [...new Set([...(budget.firedThresholds ?? []), ...check.newThresholds])]
    await updateBudgetTracking(id, {
      currentSpendCents: check.spendCents,
      currentSpendPercent: check.percent,
      lastCheckedAt: Timestamp.now(),
      firedThresholds: nextFired,
      pausedCampaignIds: pausedCampaignIds ?? budget.pausedCampaignIds,
    })

    return apiSuccess({
      spendCents: check.spendCents,
      percent: check.percent,
      newThresholds: check.newThresholds,
      exhausted: check.exhausted,
      pausedCampaignIds,
    })
  },
)
