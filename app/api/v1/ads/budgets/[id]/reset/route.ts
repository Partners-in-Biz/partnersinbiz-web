import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { apiSuccess, apiError } from '@/lib/api/response'
import { getBudget, resetBudgetForNewPeriod, computeWindowStart, appendEvent } from '@/lib/ads/budgets/store'

export const dynamic = 'force-dynamic'

export const POST = withAuth(
  'admin',
  async (req: NextRequest, _user: unknown, ctx: { params: Promise<{ id: string }> }) => {
    const orgId = req.headers.get('X-Org-Id')
    if (!orgId) return apiError('Missing X-Org-Id header', 400)
    const { id } = await ctx.params
    const budget = await getBudget(id)
    if (!budget || budget.orgId !== orgId) return apiError('Budget not found', 404)

    const newPeriodStart = computeWindowStart(budget.period)
    await resetBudgetForNewPeriod({ budgetId: id, newPeriodStart })
    await appendEvent({
      budgetId: id, type: 'reset',
      spendCents: 0, percent: 0,
    })
    return apiSuccess({ reset: true, periodStart: newPeriodStart })
  },
)
