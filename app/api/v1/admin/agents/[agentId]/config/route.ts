/**
 * GET /api/v1/admin/agents/[agentId]/config
 *
 * Returns or updates the agent's live Hermes config through the admin sidecar,
 * plus the Firestore agent record and best-effort /v1/models probe.
 */
import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { apiError, apiSuccess } from '@/lib/api/response'
import { getAgent, callAgentPath } from '@/lib/agents/team'
import { isValidAgentId, type AgentId } from '@/lib/agents/types'
import { isSuperAdmin } from '@/lib/api/platformAdmin'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ agentId: string }> }

export const GET = withAuth('admin', async (_req: NextRequest, _user, ctx) => {
  const { agentId } = await (ctx as Ctx).params
  if (!isValidAgentId(agentId)) return apiError('Invalid agentId', 400)

  const agent = await getAgent(agentId as AgentId)
  if (!agent) return apiError(`agent_team/${agentId} not found`, 404)

  // Best-effort: probe the Hermes gateway /v1/models to get live model info.
  let models: unknown = null
  try {
    const { response, data } = await callAgentPath(agentId as AgentId, '/v1/models')
    if (response.ok) models = data
  } catch { /* not all gateways expose /v1/models — ignore */ }

  let liveConfig: unknown = null
  try {
    const { response, data } = await callAgentPath(agentId as AgentId, '/admin/config')
    if (response.ok) liveConfig = data
  } catch { /* sidecar may be unavailable locally; keep Firestore fallback */ }

  return apiSuccess({
    agentId: agent.agentId,
    name: agent.name,
    role: agent.role,
    enabled: agent.enabled,
    defaultModel: agent.defaultModel,
    baseUrl: agent.baseUrl,
    lastHealthStatus: agent.lastHealthStatus ?? null,
    lastHealthCheck: agent.lastHealthCheck ?? null,
    persona: agent.persona,
    models,
    liveConfig,
  })
})

export const PUT = withAuth('admin', async (req: NextRequest, user, ctx) => {
  if (!isSuperAdmin(user)) return apiError('Only super admins can edit agent config', 403)

  const { agentId } = await (ctx as Ctx).params
  if (!isValidAgentId(agentId)) return apiError('Invalid agentId', 400)
  let body: unknown
  try { body = await req.json() } catch { return apiError('Invalid JSON body', 400) }
  try {
    const { response, data } = await callAgentPath(agentId as AgentId, '/admin/config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!response.ok) return apiError('Failed to update agent config', 502, { upstream: data })
    return apiSuccess(data)
  } catch (err) {
    return apiError(err instanceof Error ? err.message : 'Failed to reach agent', 502)
  }
})
