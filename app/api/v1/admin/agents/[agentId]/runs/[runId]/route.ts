import { NextRequest, NextResponse } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { apiError } from '@/lib/api/response'
import { callAgentPath } from '@/lib/agents/team'
import { isValidAgentId, type AgentId } from '@/lib/agents/types'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ agentId: string; runId: string }> }

export const GET = withAuth('admin', async (_req: NextRequest, _user, ctx) => {
  const { agentId, runId } = await (ctx as Ctx).params
  if (!isValidAgentId(agentId)) return apiError('Invalid agentId', 400)

  try {
    const { response, data } = await callAgentPath(
      agentId as AgentId,
      `/v1/runs/${encodeURIComponent(runId)}`,
      { method: 'GET' },
    )

    if (!response.ok) {
      return apiError(
        data && typeof data === 'object' && 'error' in data
          ? String((data as Record<string, unknown>).error)
          : `Agent gateway returned ${response.status}`,
        response.status,
      )
    }

    return NextResponse.json(data)
  } catch (err) {
    return apiError(err instanceof Error ? err.message : 'Failed to load agent run', 502)
  }
})
