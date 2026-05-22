import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { apiError, apiSuccess } from '@/lib/api/response'
import { enforceAgentCapability } from '@/lib/api/capabilityGate'
import { isSuperAdmin } from '@/lib/api/platformAdmin'
import { callAgentPath, getAgent, recordAgentSkillPolicyApplied } from '@/lib/agents/team'
import { isValidAgentId, type AgentId } from '@/lib/agents/types'
import {
  AGENT_SKILL_POLICY,
  computeAgentSkillDrift,
  extractHermesExternalDirs,
  getAgentSkillPolicy,
  normalizeInstalledSkillNames,
  withAgentPolicyExternalDir,
} from '@/lib/agents/skill-policy'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ agentId: string }> }

function skillBasename(skill: string): string {
  return skill.split('/').filter(Boolean).at(-1) ?? skill
}

function classifyInstalledSkills(installed: string[]): { pib: string[]; global: string[] } {
  const catalogPaths = new Set(Object.keys(AGENT_SKILL_POLICY.skillCatalog))
  const catalogByBase = new Map(Object.keys(AGENT_SKILL_POLICY.skillCatalog).map((skill) => [skillBasename(skill), skill]))
  const pib: string[] = []
  const global: string[] = []

  for (const skill of installed) {
    const base = skillBasename(skill)
    const catalogSkill = catalogPaths.has(skill) ? skill : catalogByBase.get(base)
    if (catalogSkill) {
      pib.push(catalogSkill)
    } else {
      global.push(skill)
    }
  }

  return {
    pib: Array.from(new Set(pib)).sort(),
    global: Array.from(new Set(global)).sort(),
  }
}

function extractSkillListPayload(payload: unknown): unknown {
  if (Array.isArray(payload)) return payload
  if (!payload || typeof payload !== 'object') return []
  const source = payload as Record<string, unknown>
  if (Array.isArray(source.skills)) return source.skills
  if (source.data && typeof source.data === 'object' && Array.isArray((source.data as Record<string, unknown>).skills)) {
    return (source.data as Record<string, unknown>).skills
  }
  return []
}

async function loadPolicyView(agentId: AgentId) {
  const agent = await getAgent(agentId)
  if (!agent) throw new Error(`agent_team/${agentId} not found`)
  const policy = getAgentSkillPolicy(agentId)
  if (!policy) throw new Error(`No skill policy defined for '${agentId}'`)

  let installed: string[] = []
  let liveConfig: unknown = null

  try {
    const native = await callAgentPath(agentId, '/api/skills')
    if (native.response.ok) {
      installed = normalizeInstalledSkillNames(extractSkillListPayload(native.data))
    }
  } catch {
    // A missing skill endpoint should not hide the policy preview.
  }

  try {
    const cfg = await callAgentPath(agentId, '/admin/config')
    if (cfg.response.ok) liveConfig = cfg.data
  } catch {
    // Sidecar may be temporarily unavailable. The caller still gets the manifest.
  }

  const classified = classifyInstalledSkills(installed)
  const drift = computeAgentSkillDrift({
    agentId,
    installedPibSkills: classified.pib,
    installedGlobalSkills: classified.global,
    configExternalDirs: extractHermesExternalDirs(liveConfig),
  })

  return {
    policyVersion: AGENT_SKILL_POLICY.version,
    mode: AGENT_SKILL_POLICY.mode,
    futureAgentCandidates: AGENT_SKILL_POLICY.futureAgentCandidates,
    agent: {
      agentId: agent.agentId,
      name: agent.name,
      role: agent.role,
      skillPolicy: agent.skillPolicy ?? null,
    },
    policy,
    installed: classified,
    drift,
  }
}

export const GET = withAuth('admin', async (_req: NextRequest, _user, ctx) => {
  const { agentId } = await (ctx as Ctx).params
  if (!isValidAgentId(agentId)) return apiError('Invalid agentId', 400)

  try {
    return apiSuccess(await loadPolicyView(agentId as AgentId))
  } catch (err) {
    return apiError(err instanceof Error ? err.message : 'Failed to load skill policy', 404)
  }
})

export const POST = withAuth('admin', async (req: NextRequest, user, ctx) => {
  if (!isSuperAdmin(user)) return apiError('Only super admins can apply agent skill policy', 403)

  const { agentId } = await (ctx as Ctx).params
  if (!isValidAgentId(agentId)) return apiError('Invalid agentId', 400)
  const policy = getAgentSkillPolicy(agentId as AgentId)
  if (!policy) return apiError(`No skill policy defined for '${agentId}'`, 404)

  let body: Record<string, unknown> = {}
  try { body = await req.json() as Record<string, unknown> } catch { body = {} }
  const applyConfig = body.applyConfig !== false
  const capabilityError = enforceAgentCapability(user, 'access_secret', req, body)
  if (capabilityError) return capabilityError

  try {
    let configApplied = false
    if (applyConfig) {
      const current = await callAgentPath(agentId as AgentId, '/admin/config')
      if (!current.response.ok) return apiError('Failed to read live agent config', 502, { upstream: current.data })
      const nextConfig = withAgentPolicyExternalDir(current.data, agentId as AgentId)
      if (!nextConfig) return apiError(`No skill policy defined for '${agentId}'`, 404)
      const updated = await callAgentPath(agentId as AgentId, '/admin/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(nextConfig),
      })
      if (!updated.response.ok) return apiError('Failed to update live agent config', 502, { upstream: updated.data })
      configApplied = true
    }

    const updatedAgent = await recordAgentSkillPolicyApplied(agentId as AgentId, user.uid, configApplied ? 'in_sync' : 'not_applied')
    const view = await loadPolicyView(agentId as AgentId)
    return apiSuccess({ ...view, agent: updatedAgent, configApplied })
  } catch (err) {
    return apiError(err instanceof Error ? err.message : 'Failed to apply skill policy', 500)
  }
})
