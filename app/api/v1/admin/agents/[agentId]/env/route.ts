/**
 * GET /api/v1/admin/agents/[agentId]/env
 *
 * Returns or updates the agent's environment variable manifest through the
 * Hermes admin sidecar. Reads are redacted; writes accept explicit key/value
 * changes and restart the profile gateway on the VPS.
 */
import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { apiError, apiSuccess } from '@/lib/api/response'
import { enforceAgentCapability } from '@/lib/api/capabilityGate'
import { callAgentPath } from '@/lib/agents/team'
import { isValidAgentId, type AgentId } from '@/lib/agents/types'
import { isSuperAdmin } from '@/lib/api/platformAdmin'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ agentId: string }> }

export const GET = withAuth('admin', async (_req: NextRequest, _user, ctx) => {
  const { agentId } = await (ctx as Ctx).params
  if (!isValidAgentId(agentId)) return apiError('Invalid agentId', 400)
  try {
    const { response, data } = await callAgentPath(agentId as AgentId, '/admin/env')
    if (response.status === 404) return apiSuccess({ env: {}, supported: false })
    if (!response.ok) return apiError('Failed to fetch env from agent', 502, { upstream: data })
    return apiSuccess({ ...(data as Record<string, unknown>), supported: true })
  } catch (err) {
    return apiError(err instanceof Error ? err.message : 'Failed to reach agent', 502)
  }
})

export const PATCH = withAuth('admin', async (req: NextRequest, user, ctx) => {
  if (!isSuperAdmin(user)) return apiError('Only super admins can edit agent environment keys', 403)

  const { agentId } = await (ctx as Ctx).params
  if (!isValidAgentId(agentId)) return apiError('Invalid agentId', 400)
  let body: unknown
  try { body = await req.json() } catch { return apiError('Invalid JSON body', 400) }
  const capabilityError = enforceAgentCapability(user, 'access_secret', req, body && typeof body === 'object' && !Array.isArray(body) ? body as Record<string, unknown> : null)
  if (capabilityError) return capabilityError
  try {
    const { response, data } = await callAgentPath(agentId as AgentId, '/admin/env', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!response.ok) return apiError('Failed to update env on agent', 502, { upstream: data })
    return apiSuccess(data)
  } catch (err) {
    return apiError(err instanceof Error ? err.message : 'Failed to reach agent', 502)
  }
})
