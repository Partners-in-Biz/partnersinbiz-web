/**
 * DELETE /api/v1/admin/agents/[agentId]/skills/[skillName]  — remove a skill
 */
import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { apiError, apiSuccess } from '@/lib/api/response'
import { callAgentPath } from '@/lib/agents/team'
import { isValidAgentId, type AgentId } from '@/lib/agents/types'
import { isSuperAdmin } from '@/lib/api/platformAdmin'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ agentId: string; skillName: string }> }

export const DELETE = withAuth('admin', async (_req: NextRequest, user, ctx) => {
  if (!isSuperAdmin(user)) return apiError('Only super admins can remove agent skills', 403)

  const { agentId, skillName } = await (ctx as Ctx).params
  if (!isValidAgentId(agentId)) return apiError('Invalid agentId', 400)
  if (!/^[A-Za-z0-9._-]+$/.test(skillName)) return apiError('Invalid skill name', 400)
  const encoded = encodeURIComponent(skillName)
  try {
    // Try native Hermes endpoint first, then sidecar
    const native = await callAgentPath(agentId as AgentId, `/api/skills/${encoded}`, { method: 'DELETE' })
    if (native.response.ok) return apiSuccess(native.data)
    const sidecar = await callAgentPath(agentId as AgentId, `/admin/skills/${encoded}`, { method: 'DELETE' })
    if (sidecar.response.ok) return apiSuccess(sidecar.data)
    return apiError('Failed to delete skill', 502, { upstream: sidecar.data })
  } catch (err) {
    return apiError(err instanceof Error ? err.message : 'Failed to reach agent', 502)
  }
})
