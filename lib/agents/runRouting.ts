export const VALID_AGENT_EFFORTS = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh'] as const

export type AgentEffort = (typeof VALID_AGENT_EFFORTS)[number]

export const AGENT_EFFORT_OPTIONS: Array<{ value: AgentEffort; label: string }> = [
  { value: 'minimal', label: 'Minimal' },
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'xhigh', label: 'XHigh' },
]

export const VALID_AGENT_MODELS = [
  'claude-sonnet-4-6',
  'gpt-5.5',
  'gpt-5.4',
  'gpt-5.4-mini',
  'gpt-5.3-codex-spark',
] as const

export type AgentModel = (typeof VALID_AGENT_MODELS)[number]

export const AGENT_MODEL_OPTIONS: Array<{ value: AgentModel; label: string }> = [
  { value: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6' },
  { value: 'gpt-5.5', label: 'GPT-5.5' },
  { value: 'gpt-5.4', label: 'GPT-5.4' },
  { value: 'gpt-5.4-mini', label: 'GPT-5.4 Mini' },
  { value: 'gpt-5.3-codex-spark', label: 'GPT-5.3 Spark' },
]

export function cleanAgentEffort(value: unknown): AgentEffort | null {
  if (value === undefined || value === null || value === '') return null
  if (typeof value !== 'string') return null
  const cleaned = value.trim().toLowerCase()
  return VALID_AGENT_EFFORTS.includes(cleaned as AgentEffort) ? cleaned as AgentEffort : null
}

export function cleanAgentModel(value: unknown): AgentModel | null {
  if (value === undefined || value === null || value === '') return null
  if (typeof value !== 'string') return null
  const cleaned = value.trim()
  return VALID_AGENT_MODELS.includes(cleaned as AgentModel) ? cleaned as AgentModel : null
}
