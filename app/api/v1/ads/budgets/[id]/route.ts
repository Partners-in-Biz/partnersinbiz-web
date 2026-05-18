import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { apiSuccess, apiError } from '@/lib/api/response'
import { getBudget, updateBudget, archiveBudget, listEvents } from '@/lib/ads/budgets/store'
import type { UpdateBudgetInput } from '@/lib/ads/budgets/types'

export const dynamic = 'force-dynamic'

export const GET = withAuth(
  'admin',
  async (req: NextRequest, _user: unknown, ctx: { params: Promise<{ id: string }> }) => {
    const orgId = req.headers.get('X-Org-Id')
    if (!orgId) return apiError('Missing X-Org-Id header', 400)
    const { id } = await ctx.params
    const budget = await getBudget(id)
    if (!budget || budget.orgId !== orgId) return apiError('Budget not found', 404)
    const events = await listEvents({ budgetId: id, limit: 100 })
    return apiSuccess({ budget, events })
  },
)

export const PATCH = withAuth(
  'admin',
  async (req: NextRequest, _user: unknown, ctx: { params: Promise<{ id: string }> }) => {
    const orgId = req.headers.get('X-Org-Id')
    if (!orgId) return apiError('Missing X-Org-Id header', 400)
    const { id } = await ctx.params
    const existing = await getBudget(id)
    if (!existing || existing.orgId !== orgId) return apiError('Budget not found', 404)
    let body: UpdateBudgetInput
    try { body = (await req.json()) as UpdateBudgetInput } catch { return apiError('Invalid JSON body', 400) }
    try {
      await updateBudget(id, body)
      const updated = await getBudget(id)
      return apiSuccess(updated)
    } catch (err) {
      return apiError((err as Error).message ?? 'Update failed', 400)
    }
  },
)

export const DELETE = withAuth(
  'admin',
  async (req: NextRequest, _user: unknown, ctx: { params: Promise<{ id: string }> }) => {
    const orgId = req.headers.get('X-Org-Id')
    if (!orgId) return apiError('Missing X-Org-Id header', 400)
    const { id } = await ctx.params
    const existing = await getBudget(id)
    if (!existing || existing.orgId !== orgId) return apiError('Budget not found', 404)
    await archiveBudget(id)
    return apiSuccess({ archived: true })
  },
)
