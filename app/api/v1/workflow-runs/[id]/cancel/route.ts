/**
 * POST /api/v1/workflow-runs/[id]/cancel
 */
import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { apiError, apiSuccess } from '@/lib/api/response'
import type { ApiUser } from '@/lib/api/types'
import { canAccessOrg } from '@/lib/api/platformAdmin'
import { cancelWorkflowRun, getWorkflowRun } from '@/lib/workflow-graph'

function cleanString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

export const POST = withAuth('admin', async (req: NextRequest, user: ApiUser, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params
  const existing = await getWorkflowRun(id)
  if (!existing) return apiError('Workflow run not found', 404)
  if (user.role !== 'ai' && !canAccessOrg(user, existing.orgId)) return apiError('Forbidden', 403)

  const body = await req.json().catch(() => ({})) as Record<string, unknown>
  const reason = cleanString(body.reason) || 'cancelled_by_operator'
  const result = await cancelWorkflowRun(id, user.uid, reason)
  if (!result.ok) return apiError(result.error, result.status)
  return apiSuccess({ run: result.run, inspect: result.inspect })
})
