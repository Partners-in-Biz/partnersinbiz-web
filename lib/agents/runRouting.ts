import {
  agentTaskModelIds,
  agentTaskModelOptions,
  cleanAgentTaskModel,
  isAgentTaskModel,
} from '@/lib/llm-providers/model-registry'

export { resolveAgentTaskModelEligibility } from '@/lib/llm-providers/model-registry'

export const VALID_AGENT_EFFORTS = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh'] as const

export type AgentEffort = (typeof VALID_AGENT_EFFORTS)[number]

export const AGENT_EFFORT_OPTIONS: Array<{ value: AgentEffort; label: string }> = [
  { value: 'minimal', label: 'Minimal' },
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'xhigh', label: 'XHigh' },
]

/**
 * Agent-task model allowlist, derived from the canonical model registry
 * (lib/llm-providers/model-registry.ts). Do NOT add models here — add them to
 * the registry so Messages and agent-task routing share one source of truth.
 */
export const VALID_AGENT_MODELS = agentTaskModelIds()

export type AgentModel = (typeof VALID_AGENT_MODELS)[number]

export const AGENT_MODEL_OPTIONS = agentTaskModelOptions()

export function cleanAgentEffort(value: unknown): AgentEffort | null {
  if (value === undefined || value === null || value === '') return null
  if (typeof value !== 'string') return null
  const cleaned = value.trim().toLowerCase()
  return VALID_AGENT_EFFORTS.includes(cleaned as AgentEffort) ? cleaned as AgentEffort : null
}

export function cleanAgentModel(value: unknown): AgentModel | null {
  const cleaned = cleanAgentTaskModel(value)
  return cleaned !== null && isAgentTaskModel(cleaned) ? cleaned as AgentModel : null
}
