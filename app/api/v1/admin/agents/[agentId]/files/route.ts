/**
 * GET /api/v1/admin/agents/[agentId]/files
 *
 * Lists safe profile files exposed by the Hermes admin sidecar.
 */
import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { apiError, apiSuccess } from '@/lib/api/response'
import { callAgentPath } from '@/lib/agents/team'
import { isValidAgentId, type AgentId } from '@/lib/agents/types'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ agentId: string }> }

export const GET = withAuth('admin', async (_req: NextRequest, _user, ctx) => {
  const { agentId } = await (ctx as Ctx).params
  if (!isValidAgentId(agentId)) return apiError('Invalid agentId', 400)
  try {
    const { response, data } = await callAgentPath(agentId as AgentId, '/admin/files')
    if (!response.ok) return apiError('Failed to list profile files', 502, { upstream: data })
    return apiSuccess(data)
  } catch (err) {
    return apiError(err instanceof Error ? err.message : 'Failed to reach agent', 502)
  }
})
