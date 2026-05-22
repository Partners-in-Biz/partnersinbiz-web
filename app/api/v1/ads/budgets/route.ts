import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { apiSuccess, apiError } from '@/lib/api/response'
import { enforceAgentCapability } from '@/lib/api/capabilityGate'
import { listBudgets, createBudget } from '@/lib/ads/budgets/store'
import type { BudgetScope, CreateBudgetInput } from '@/lib/ads/budgets/types'
import type { AdPlatform } from '@/lib/ads/types'
import { isAdPlatform } from '@/lib/ads/types'
import type { ApiUser } from '@/lib/api/types'

export const dynamic = 'force-dynamic'

export const GET = withAuth('admin', async (req: NextRequest) => {
  const orgId = req.headers.get('X-Org-Id')
  if (!orgId) return apiError('Missing X-Org-Id header', 400)
  const url = new URL(req.url)
  const scope = url.searchParams.get('scope') as BudgetScope | null
  const platform = url.searchParams.get('platform')
  const campaignId = url.searchParams.get('campaignId')
  const includeArchived = url.searchParams.get('includeArchived') === '1'

  const budgets = await listBudgets({
    orgId,
    scope: scope ?? undefined,
    platform: platform && isAdPlatform(platform) ? (platform as AdPlatform) : undefined,
    campaignId: campaignId ?? undefined,
    includeArchived,
  })
  return apiSuccess(budgets)
})

export const POST = withAuth('admin', async (req: NextRequest, user: ApiUser) => {
  const orgId = req.headers.get('X-Org-Id')
  if (!orgId) return apiError('Missing X-Org-Id header', 400)
  let body: { input?: CreateBudgetInput }
  try { body = await req.json() } catch { return apiError('Invalid JSON body', 400) }
  const capabilityError = enforceAgentCapability(user, 'spend', req, body as Record<string, unknown>)
  if (capabilityError) return capabilityError
  if (!body.input) return apiError('Missing input', 400)
  if (!body.input.name || !body.input.scope || !body.input.period || !body.input.capCents) {
    return apiError('Missing required fields: name, scope, period, capCents', 400)
  }
  try {
    const budget = await createBudget({
      orgId,
      createdBy: (user as { uid?: string }).uid ?? 'unknown',
      input: body.input,
    })
    return apiSuccess(budget, 201)
  } catch (err) {
    return apiError((err as Error).message ?? 'Create failed', 400)
  }
})
