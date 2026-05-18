const AGENT_ALIASES: Record<string, string> = {
  'partners-in-biz': 'partners',
}

export function resolveKnowledgeAgent(agent: string | undefined) {
  if (!agent) return undefined
  return AGENT_ALIASES[agent] ?? agent
}

export const SAFE_KNOWLEDGE_AGENT = /^[a-z0-9][a-z0-9-]{0,63}$/
