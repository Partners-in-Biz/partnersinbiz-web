import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { apiSuccess, apiError } from '@/lib/api/response'
import { enforceAgentCapability } from '@/lib/api/capabilityGate'
import { getBudget, updateBudget, archiveBudget, listEvents } from '@/lib/ads/budgets/store'
import type { UpdateBudgetInput } from '@/lib/ads/budgets/types'
import { getCampaign } from '@/lib/ads/campaigns/store'
import type { ApiUser } from '@/lib/api/types'
import {
  approvalOverrideErrorMessage,
  findUntrustedApprovalOverride,
  requireApprovedCampaignForAdsAction,
} from '@/lib/ads/approval-gates'

export const dynamic = 'force-dynamic'

async function requireBudgetCampaignApproval(
  existing: { scope?: string; campaignId?: string; orgId: string },
  action: 'budget' | 'delete',
) {
  if (existing.scope !== 'campaign') return null
  if (!existing.campaignId) return 'Campaign-scoped budgets require campaignId'
  const campaign = await getCampaign(existing.campaignId)
  if (!campaign || campaign.orgId !== existing.orgId) return 'Campaign not found'
  return requireApprovedCampaignForAdsAction(campaign, action)
}

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
  async (req: NextRequest, user: ApiUser, ctx: { params: Promise<{ id: string }> }) => {
    const orgId = req.headers.get('X-Org-Id')
    if (!orgId) return apiError('Missing X-Org-Id header', 400)
    const { id } = await ctx.params
    const existing = await getBudget(id)
    if (!existing || existing.orgId !== orgId) return apiError('Budget not found', 404)
    let body: UpdateBudgetInput
    try { body = (await req.json()) as UpdateBudgetInput } catch { return apiError('Invalid JSON body', 400) }
    const approvalOverridePath = findUntrustedApprovalOverride(body)
    if (approvalOverridePath) return apiError(approvalOverrideErrorMessage(approvalOverridePath), 400)
    const approvalError = await requireBudgetCampaignApproval(existing, 'budget')
    if (approvalError === 'Campaign not found') return apiError(approvalError, 404)
    if (approvalError) return apiError(approvalError, 403)
    const capabilityError = enforceAgentCapability(user, 'spend', req, body as Record<string, unknown>)
    if (capabilityError) return capabilityError
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
  async (req: NextRequest, user: ApiUser, ctx: { params: Promise<{ id: string }> }) => {
    const orgId = req.headers.get('X-Org-Id')
    if (!orgId) return apiError('Missing X-Org-Id header', 400)
    const { id } = await ctx.params
    const existing = await getBudget(id)
    if (!existing || existing.orgId !== orgId) return apiError('Budget not found', 404)
    const approvalError = await requireBudgetCampaignApproval(existing, 'delete')
    if (approvalError === 'Campaign not found') return apiError(approvalError, 404)
    if (approvalError) return apiError(approvalError, 403)
    const capabilityError = enforceAgentCapability(user, 'delete', req)
    if (capabilityError) return capabilityError
    await archiveBudget(id)
    return apiSuccess({ archived: true })
  },
)
