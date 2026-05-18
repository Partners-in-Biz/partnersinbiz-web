/**
 * GET /api/v1/admin/agents/[agentId]/health
 *
 * Pings the agent's /v1/health endpoint, writes the result back to
 * agent_team/{agentId} (lastHealthCheck + lastHealthStatus), and returns
 * the result immediately.
 *
 * Auth: admin.
 */

import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { apiError, apiSuccess } from '@/lib/api/response'
import { pingAgentHealth } from '@/lib/agents/team'
import { isValidAgentId, type AgentId } from '@/lib/agents/types'

export const dynamic = 'force-dynamic'

export const GET = withAuth(
  'admin',
  async (_req: NextRequest, _user, context?: { params?: Promise<{ agentId?: string }> | { agentId?: string } }) => {
    const params = context?.params ? await context.params : {}
    const agentId = (params as { agentId?: string }).agentId as string | undefined
    if (!agentId || !isValidAgentId(agentId)) {
      return apiError('Invalid agentId', 400)
    }

    const result = await pingAgentHealth(agentId as AgentId)
    return apiSuccess({ agentId, ...result })
  },
)
