import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { resolveOrgScope } from '@/lib/api/orgScope'
import { apiError, apiSuccess } from '@/lib/api/response'
import type { ApiUser } from '@/lib/api/types'
import { adminDb } from '@/lib/firebase/admin'
import {
  resolveWorkforceBlueprint,
  type WorkforceBlueprint,
} from '@/lib/agents/role-blueprints'
import {
  AGENT_SKILL_POLICY,
  getAgentSkillPolicy,
} from '@/lib/agents/skill-policy'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ orgId: string }> }

function buildPolicyEvidence(blueprint: WorkforceBlueprint) {
  const agents = blueprint.recommendedAgentIds.map((agentId) => {
    const policy = getAgentSkillPolicy(agentId)
    return {
      agentId,
      policyDefined: Boolean(policy),
      policyLabel: policy?.label ?? agentId,
      expectedSkillCount: policy?.runtimeSkills.length ?? 0,
      approvalGates: policy?.approvalGates ?? [],
    }
  })

  const skillCoverage = blueprint.requiredSkillIds.map((skillId) => ({
    skillId,
    coveredByAgentIds: blueprint.recommendedAgentIds.filter((agentId) => {
      const policy = getAgentSkillPolicy(agentId)
      return Boolean(policy && (
        policy.pibSkills.includes(skillId)
        || policy.runtimeSkills.includes(skillId)
        || policy.globalSkills.includes(skillId)
      ))
    }),
  }))

  return {
    agents,
    skillCoverage,
    policyVersion: AGENT_SKILL_POLICY.version,
    policyReady: agents.every((agent) => agent.policyDefined)
      && skillCoverage.every((skill) => skill.coveredByAgentIds.length > 0),
  }
}

export const GET = withAuth('client', async (
  _req: NextRequest,
  user: ApiUser,
  context?: unknown,
) => {
  const { orgId: requestedOrgId } = await (context as Params).params
  const scope = resolveOrgScope(user, requestedOrgId)
  if (!scope.ok) return apiError(scope.error, scope.status)

  const memberSnap = await adminDb.collection('orgMembers').doc(`${scope.orgId}_${user.uid}`).get()
  const member = memberSnap.exists ? memberSnap.data() ?? {} : {}
  const jobTitle = typeof member.jobTitle === 'string' ? member.jobTitle.trim() : ''
  const department = typeof member.department === 'string' ? member.department.trim() : ''
  const match = resolveWorkforceBlueprint({ jobTitle, department })
  const evidence = buildPolicyEvidence(match.blueprint)

  return apiSuccess({
    orgId: scope.orgId,
    member: {
      jobTitle: jobTitle || null,
      department: department || null,
    },
    matchSource: match.source,
    blueprint: match.blueprint,
    policyEvidence: evidence,
    recommendationStatus: 'ready_for_owner_review' as const,
    requiresOwnerApproval: true,
    note: 'Recommendations never grant agent, runtime, module, or data access.',
  })
})
