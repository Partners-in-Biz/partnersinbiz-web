import { adminDb } from '@/lib/firebase/admin'
import type { AgentId, Conversation } from './types'

export interface ConversationDispatchSelection {
  participantAgentIds: AgentId[]
  orchestration?: Conversation['orchestration']
}

interface DispatchAgentResolutionOptions {
  isAgentEnabled?: (agentId: AgentId) => Promise<boolean>
}

async function isAgentEnabled(agentId: AgentId): Promise<boolean> {
  const snapshot = await adminDb.collection('agent_team').doc(agentId).get()
  return snapshot.exists && snapshot.data()?.enabled === true
}

/** Canonical dispatch-agent selection shared by every runtime-binding lifecycle path. */
export async function resolveConversationDispatchAgentId(
  input: ConversationDispatchSelection,
  options: DispatchAgentResolutionOptions = {},
): Promise<AgentId | null> {
  const agentIds = Array.from(new Set(input.participantAgentIds.filter((agentId) => agentId.trim())))
  if (agentIds.length === 0) return null
  if (agentIds.length === 1) return agentIds[0]

  const orchestrator = input.orchestration?.dispatcherAgentId ?? 'pip'
  if (agentIds.includes(orchestrator)
    && await (options.isAgentEnabled ?? isAgentEnabled)(orchestrator)) return orchestrator
  return agentIds[0]
}
