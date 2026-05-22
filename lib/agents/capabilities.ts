import type { ApiUser } from '@/lib/api/types'
import {
  AGENT_SKILL_POLICY,
  type AgentCapability,
  type AgentCapabilityGate,
} from './skill-policy'

export type { AgentCapability }

export interface CapabilityContext {
  approvalStatus?: string | null
  approvalGateTaskId?: string | null
  allowLegacySuperKey?: boolean
}

export class AgentCapabilityError extends Error {
  status = 403

  constructor(message: string) {
    super(message)
    this.name = 'AgentCapabilityError'
  }
}

const APPROVED = new Set(['approved', 'accepted', 'resolved'])

export function getAgentCapabilityGate(agentId: string, capability: AgentCapability): AgentCapabilityGate | null {
  const policy = AGENT_SKILL_POLICY.agents[agentId]
  if (!policy || !policy.capabilities.includes(capability)) return null
  if (!policy.approvalGates.includes(capability)) return { requiresApproval: false, reason: '' }
  return AGENT_SKILL_POLICY.approvalGates[capability] ?? {
    requiresApproval: true,
    reason: `${capability} requires approval.`,
  }
}

export function agentHasCapability(agentId: string, capability: AgentCapability): boolean {
  return AGENT_SKILL_POLICY.agents[agentId]?.capabilities.includes(capability) ?? false
}

function isApproved(context?: CapabilityContext): boolean {
  const status = context?.approvalStatus?.trim().toLowerCase()
  return !!status && APPROVED.has(status) && !!context?.approvalGateTaskId?.trim()
}

export function assertAgentCapability(
  user: Pick<ApiUser, 'uid' | 'role' | 'authKind' | 'agentId'>,
  capability: AgentCapability,
  context: CapabilityContext = {},
): { ok: true; gateRequired: boolean } {
  if (user.authKind === 'legacy_ai_key' && context.allowLegacySuperKey === true) {
    return { ok: true, gateRequired: false }
  }

  const agentId = user.agentId
  if (!agentId) {
    throw new AgentCapabilityError(`Capability '${capability}' requires an authenticated agent identity.`)
  }
  if (!agentHasCapability(agentId, capability)) {
    throw new AgentCapabilityError(`Agent '${agentId}' is not allowed to perform '${capability}'.`)
  }

  const gate = getAgentCapabilityGate(agentId, capability)
  if (gate?.requiresApproval && !isApproved(context)) {
    throw new AgentCapabilityError(`Agent '${agentId}' cannot perform '${capability}' until approval is recorded: ${gate.reason}`)
  }

  return { ok: true, gateRequired: gate?.requiresApproval === true }
}

export function assertAgentCapabilityForApiUser(
  user: Pick<ApiUser, 'uid' | 'role' | 'authKind' | 'agentId'>,
  capability: AgentCapability,
  context: CapabilityContext = {},
): { ok: true; gateRequired: boolean } {
  if (user.authKind !== 'agent_api_key' && user.authKind !== 'legacy_ai_key') {
    return { ok: true, gateRequired: false }
  }
  if (user.authKind === 'legacy_ai_key') {
    return { ok: true, gateRequired: false }
  }

  return assertAgentCapability(user, capability, context)
}
