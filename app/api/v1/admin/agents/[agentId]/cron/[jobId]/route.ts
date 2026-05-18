/**
 * DELETE /api/v1/admin/agents/[agentId]/cron/[jobId]         — delete a job
 * POST   /api/v1/admin/agents/[agentId]/cron/[jobId]?action= — pause | resume | trigger
 */
import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { apiError, apiSuccess } from '@/lib/api/response'
import { callAgentPath } from '@/lib/agents/team'
import { isValidAgentId, type AgentId } from '@/lib/agents/types'
import { isSuperAdmin } from '@/lib/api/platformAdmin'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ agentId: string; jobId: string }> }

const VALID_ACTIONS = ['pause', 'resume', 'trigger'] as const

export const DELETE = withAuth('admin', async (_req: NextRequest, user, ctx) => {
  if (!isSuperAdmin(user)) return apiError('Only super admins can delete agent cron jobs', 403)

  const { agentId, jobId } = await (ctx as Ctx).params
  if (!isValidAgentId(agentId)) return apiError('Invalid agentId', 400)
  try {
    const { response, data } = await callAgentPath(agentId as AgentId, `/admin/cron/${encodeURIComponent(jobId)}`, { method: 'DELETE' })
    if (!response.ok) return apiError('Failed to delete cron job', 502, { upstream: data })
    return apiSuccess(data)
  } catch (err) {
    return apiError(err instanceof Error ? err.message : 'Failed to reach agent', 502)
  }
})

export const POST = withAuth('admin', async (req: NextRequest, user, ctx) => {
  if (!isSuperAdmin(user)) return apiError('Only super admins can update agent cron jobs', 403)

  const { agentId, jobId } = await (ctx as Ctx).params
  if (!isValidAgentId(agentId)) return apiError('Invalid agentId', 400)
  const action = req.nextUrl.searchParams.get('action') as typeof VALID_ACTIONS[number] | null
  if (!action || !VALID_ACTIONS.includes(action)) return apiError(`action must be one of: ${VALID_ACTIONS.join(', ')}`, 400)
  try {
    const { response, data } = await callAgentPath(agentId as AgentId, `/admin/cron/${encodeURIComponent(jobId)}/${action}`, { method: 'POST' })
    if (!response.ok) return apiError(`Failed to ${action} cron job`, 502, { upstream: data })
    return apiSuccess(data)
  } catch (err) {
    return apiError(err instanceof Error ? err.message : 'Failed to reach agent', 502)
  }
})
