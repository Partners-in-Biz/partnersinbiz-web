/**
 * Resolves which agents the New Conversation picker may offer.
 *
 * Order of decisions (product rule):
 *   1. Conversation context
 *   2. Machine / runtime when the context needs one
 *   3. Agents available on that runtime (intersected with org-visible agents by the caller)
 *
 * Security stays on the existing org-scoped APIs:
 *   - `/visible-agents` still enforces org chat config + role
 *   - `/contacts` still returns this-org members + platform super-admins only
 *   - Linked runtimes already come from authorize/discover for this user+org
 */

export type ConversationAgentGateScope = 'general' | 'workspace' | 'company' | 'project' | string

export type NewConversationAgentGate =
  | {
      mode: 'platform'
      /** null = do not filter beyond org-visible agents */
      allowedAgentIds: null
      reason: null
    }
  | {
      mode: 'awaiting-runtime'
      allowedAgentIds: []
      reason: string
    }
  | {
      mode: 'runtime'
      allowedAgentIds: string[]
      reason: null
    }
  | {
      mode: 'runtime-empty'
      allowedAgentIds: []
      reason: string
    }

export function resolveNewConversationAgentGate(input: {
  scope: ConversationAgentGateScope
  runtimeRequired: boolean
  runtimeSelected: boolean
  /** Agent ids reported healthy on the selected linked computer. Empty/missing = unknown inventory. */
  runtimeAvailableAgentIds?: readonly string[] | null
}): NewConversationAgentGate {
  if (!input.runtimeRequired) {
    return { mode: 'platform', allowedAgentIds: null, reason: null }
  }

  if (!input.runtimeSelected) {
    return {
      mode: 'awaiting-runtime',
      allowedAgentIds: [],
      reason: 'Select a computer first to see which agents are available there.',
    }
  }

  const ids = (input.runtimeAvailableAgentIds ?? [])
    .map((id) => (typeof id === 'string' ? id.trim() : ''))
    .filter(Boolean)

  // A selected machine with unknown or empty inventory is empty — never the
  // full org roster. Compatibility VPS targets used to omit availableAgentIds
  // and leak every agent_team row (including bots not hosted on that box).
  if (input.runtimeAvailableAgentIds == null) {
    return {
      mode: 'runtime-empty',
      allowedAgentIds: [],
      reason: 'No agents are running on this computer yet. Install or start Hermes agents on it, then retry.',
    }
  }

  if (ids.length === 0) {
    return {
      mode: 'runtime-empty',
      allowedAgentIds: [],
      reason: 'No agents are running on this computer yet. Install or start Hermes agents on it, then retry.',
    }
  }

  return {
    mode: 'runtime',
    allowedAgentIds: Array.from(new Set(ids)),
    reason: null,
  }
}

export function filterAgentsByGate<T extends { agentId: string }>(
  agents: readonly T[],
  allowedAgentIds: readonly string[] | null,
): T[] {
  if (allowedAgentIds == null) return [...agents]
  const allowed = new Set(allowedAgentIds)
  return agents.filter((agent) => allowed.has(agent.agentId))
}
