/**
 * GET  /api/v1/admin/agents/[agentId]/skills  — list installed skills
 * POST /api/v1/admin/agents/[agentId]/skills  — install a skill (multipart zip)
 *
 * Tries the Hermes native /api/skills endpoint first (used by the new per-agent
 * profiles: pip, theo, maya, sage, nora). Falls back to the legacy Python sidecar
 * at /admin/skills (used by the old partners-main profile).
 *
 * Both endpoints return skills in a compatible shape; the native one wraps them in
 * { skills: [...] }, the sidecar wraps them in { data: { skills: [...] } }.
 * We normalise to { skills: [...] } before returning.
 */
import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { apiError, apiSuccess } from '@/lib/api/response'
import { callAgentPath } from '@/lib/agents/team'
import { isValidAgentId, type AgentId } from '@/lib/agents/types'
import { isSuperAdmin } from '@/lib/api/platformAdmin'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ agentId: string }> }

async function listSkills(agentId: AgentId) {
  // Try native Hermes gateway endpoint first
  const native = await callAgentPath(agentId, '/api/skills')
  if (native.response.ok) {
    const d = native.data as Record<string, unknown>
    // Normalise: native may return array directly, or { skills: [] }, or { data: { skills: [] } }
    const skills = Array.isArray(d) ? d
      : Array.isArray(d?.skills) ? d.skills
      : Array.isArray((d?.data as Record<string, unknown>)?.skills) ? (d?.data as Record<string, unknown>)?.skills
      : []
    return { skills }
  }
  // Fall back to Python sidecar path
  const sidecar = await callAgentPath(agentId, '/admin/skills')
  if (sidecar.response.ok) {
    const d = sidecar.data as Record<string, unknown>
    const skills = Array.isArray(d?.skills) ? d.skills
      : Array.isArray((d?.data as Record<string, unknown>)?.skills) ? (d?.data as Record<string, unknown>)?.skills
      : []
    return { skills }
  }
  return null
}

export const GET = withAuth('admin', async (_req: NextRequest, _user, ctx) => {
  const { agentId } = await (ctx as Ctx).params
  if (!isValidAgentId(agentId)) return apiError('Invalid agentId', 400)
  try {
    const result = await listSkills(agentId as AgentId)
    if (!result) return apiError('Failed to list skills from agent', 502)
    return apiSuccess(result)
  } catch (err) {
    return apiError(err instanceof Error ? err.message : 'Failed to reach agent', 502)
  }
})

export const POST = withAuth('admin', async (req: NextRequest, user, ctx) => {
  if (!isSuperAdmin(user)) return apiError('Only super admins can install agent skills', 403)

  const { agentId } = await (ctx as Ctx).params
  if (!isValidAgentId(agentId)) return apiError('Invalid agentId', 400)
  const formData = await req.formData()
  const file = formData.get('file')
  if (!file || typeof file === 'string') return apiError('file is required', 400)
  const upstreamForm = new FormData()
  upstreamForm.append('file', file)
  try {
    // Try native endpoint first, then sidecar
    const native = await callAgentPath(agentId as AgentId, '/api/skills', { method: 'POST', body: upstreamForm })
    if (native.response.ok) return apiSuccess(native.data)
    const sidecar = await callAgentPath(agentId as AgentId, '/admin/skills', { method: 'POST', body: upstreamForm })
    if (sidecar.response.ok) return apiSuccess(sidecar.data)
    return apiError('Skill upload failed', 502, { upstream: sidecar.data })
  } catch (err) {
    return apiError(err instanceof Error ? err.message : 'Failed to reach agent', 502)
  }
})
