import type { AgentId, AgentSkillPolicyState } from '@/lib/agents/types'

export interface AgentSkillSource {
  agentId?: AgentId
  name?: string
  skills?: string[]
  skillPolicy?: Partial<AgentSkillPolicyState> | null
}

function unique(values: Array<string | undefined | null>): string[] {
  return Array.from(new Set(values.map((value) => value?.trim()).filter((value): value is string => Boolean(value))))
}

const PIB_SKILL_PREFIX = 'partnersinbiz/'

/** Collapse `partnersinbiz/foo` onto `foo` so the Messages index does not double. */
export function normalizeAgentSkillName(value: string): string {
  const trimmed = value.trim()
  return trimmed.startsWith(PIB_SKILL_PREFIX) ? trimmed.slice(PIB_SKILL_PREFIX.length) : trimmed
}

export function collectAgentSkillNames(agent?: AgentSkillSource | null): string[] {
  if (!agent) return []
  const policy = agent.skillPolicy
  return unique(
    [
      ...(policy?.runtimeSkills ?? []),
      ...(policy?.pibSkills ?? []),
      ...(policy?.globalSkills ?? []),
      ...(agent.skills ?? []),
    ].map((value) => (value ? normalizeAgentSkillName(value) : value)),
  )
}

export function collectAgentCapabilities(agent?: AgentSkillSource | null): string[] {
  return unique(agent?.skillPolicy?.capabilities ?? [])
}

export function collectAgentApprovalGates(agent?: AgentSkillSource | null): string[] {
  return unique(agent?.skillPolicy?.approvalGates ?? [])
}

export function buildAgentSkillsPromptBlock(agent: AgentSkillSource, fallbackAgentId: AgentId): string {
  const skills = collectAgentSkillNames(agent)
  const capabilities = collectAgentCapabilities(agent)
  const approvalGates = collectAgentApprovalGates(agent)
  if (skills.length === 0 && capabilities.length === 0 && approvalGates.length === 0) return ''

  return [
    '[Selected agent skills]',
    `agent: ${agent.name ?? fallbackAgentId} (${agent.agentId ?? fallbackAgentId})`,
    skills.length ? `available-skills: ${skills.join(', ')}` : '',
    capabilities.length ? `capabilities: ${capabilities.join(', ')}` : '',
    approvalGates.length ? `approval-gates: ${approvalGates.join(', ')}` : '',
    'Use these skills intentionally. If the user asks for work outside this list, say which specialist or skill is missing instead of pretending you have it.',
    '---',
    '',
  ].filter(Boolean).join('\n')
}
