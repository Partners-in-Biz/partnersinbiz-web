/**
 * GET  /api/v1/admin/agents/[agentId]/cron  — list cron jobs
 * POST /api/v1/admin/agents/[agentId]/cron  — create a cron job
 *
 * Proxies to the Hermes admin sidecar. The profile gateways do not expose
 * native cron management, but the sidecar can safely edit each profile's
 * ~/.hermes/cron/jobs.json on the VPS.
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
    const { response, data } = await callAgentPath(agentId as AgentId, '/admin/cron')
    if (response.status === 404) return apiSuccess({ jobs: [], supported: false })
    if (!response.ok) return apiError('Failed to list cron jobs', 502, { upstream: data })
    return apiSuccess({ jobs: Array.isArray(data) ? data : (data as Record<string, unknown>)?.jobs ?? data, supported: true })
  } catch (err) {
    return apiError(err instanceof Error ? err.message : 'Failed to reach agent', 502)
  }
})

export const POST = withAuth('admin', async (req: NextRequest, _user, ctx) => {
  const { agentId } = await (ctx as Ctx).params
  if (!isValidAgentId(agentId)) return apiError('Invalid agentId', 400)
  let body: unknown
  try { body = await req.json() } catch { return apiError('Invalid JSON body', 400) }
  try {
    const { response, data } = await callAgentPath(agentId as AgentId, '/admin/cron', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!response.ok) return apiError('Failed to create cron job', 502, { upstream: data })
    return apiSuccess(data)
  } catch (err) {
    return apiError(err instanceof Error ? err.message : 'Failed to reach agent', 502)
  }
})
