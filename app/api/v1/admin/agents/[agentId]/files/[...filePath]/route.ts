/**
 * GET/PUT /api/v1/admin/agents/[agentId]/files/[...filePath]
 *
 * Reads or updates a safe profile file exposed by the Hermes admin sidecar.
 */
import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { apiError, apiSuccess } from '@/lib/api/response'
import { enforceAgentCapability } from '@/lib/api/capabilityGate'
import { callAgentPath } from '@/lib/agents/team'
import { isValidAgentId, type AgentId } from '@/lib/agents/types'
import { isSuperAdmin } from '@/lib/api/platformAdmin'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ agentId: string; filePath: string[] }> }

function encodePath(parts: string[]) {
  return parts.map((part) => encodeURIComponent(part)).join('/')
}

export const GET = withAuth('admin', async (_req: NextRequest, _user, ctx) => {
  const { agentId, filePath } = await (ctx as Ctx).params
  if (!isValidAgentId(agentId)) return apiError('Invalid agentId', 400)
  try {
    const { response, data } = await callAgentPath(agentId as AgentId, `/admin/files/${encodePath(filePath)}`)
    if (!response.ok) return apiError('Failed to read profile file', 502, { upstream: data })
    return apiSuccess(data)
  } catch (err) {
    return apiError(err instanceof Error ? err.message : 'Failed to reach agent', 502)
  }
})

export const PUT = withAuth('admin', async (req: NextRequest, user, ctx) => {
  if (!isSuperAdmin(user)) return apiError('Only super admins can edit agent profile files', 403)

  const { agentId, filePath } = await (ctx as Ctx).params
  if (!isValidAgentId(agentId)) return apiError('Invalid agentId', 400)
  let body: unknown
  try { body = await req.json() } catch { return apiError('Invalid JSON body', 400) }
  const capabilityError = enforceAgentCapability(user, 'access_secret', req, body && typeof body === 'object' && !Array.isArray(body) ? body as Record<string, unknown> : null)
  if (capabilityError) return capabilityError
  try {
    const { response, data } = await callAgentPath(agentId as AgentId, `/admin/files/${encodePath(filePath)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!response.ok) return apiError('Failed to update profile file', 502, { upstream: data })
    return apiSuccess(data)
  } catch (err) {
    return apiError(err instanceof Error ? err.message : 'Failed to reach agent', 502)
  }
})
