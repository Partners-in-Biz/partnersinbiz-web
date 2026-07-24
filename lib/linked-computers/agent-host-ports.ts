import { createHash } from 'node:crypto'
import { AGENT_IDS, isValidAgentId, type AgentId } from '@/lib/agents/types'
import { MANAGED_AGENT_PORTS } from '@/lib/linked-computers/agent-jobs'

const CUSTOM_PORT_BASE = 8800
const CUSTOM_PORT_SPAN = 100

/** Stable preferred loopback port for managed + custom agents. */
export function resolvePreferredAgentPort(agentId: string): number {
  if (MANAGED_AGENT_PORTS[agentId]) return MANAGED_AGENT_PORTS[agentId]
  const digest = createHash('sha256').update(`agent-port:${agentId}`).digest()
  const offset = digest.readUInt16BE(0) % CUSTOM_PORT_SPAN
  return CUSTOM_PORT_BASE + offset
}

export async function listPullableAgentIds(
  listEnabled: () => Promise<Array<{ agentId: string; enabled?: boolean }>>,
): Promise<AgentId[]> {
  const fromTeam = await listEnabled().catch(() => [])
  const ids = new Set<string>(AGENT_IDS)
  for (const row of fromTeam) {
    if (!isValidAgentId(row.agentId)) continue
    if (row.enabled === false) continue
    ids.add(row.agentId)
  }
  return Array.from(ids).sort() as AgentId[]
}
