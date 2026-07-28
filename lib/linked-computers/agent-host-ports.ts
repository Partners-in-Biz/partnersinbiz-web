import { createHash } from 'node:crypto'
import { AGENT_IDS, isValidAgentId, type AgentId } from '@/lib/agents/types'
import { MANAGED_AGENT_PORTS } from '@/lib/linked-computers/agent-jobs'

const CUSTOM_PORT_BASE = 8800
const CUSTOM_PORT_SPAN = 1000

/** Stable preferred loopback port for managed + custom agents. */
export function resolvePreferredAgentPort(agentId: string): number {
  if (MANAGED_AGENT_PORTS[agentId]) return MANAGED_AGENT_PORTS[agentId]
  const digest = createHash('sha256').update(`agent-port:${agentId}`).digest()
  const offset = digest.readUInt16BE(0) % CUSTOM_PORT_SPAN
  return CUSTOM_PORT_BASE + offset
}

export function allocatePreferredAgentPort(
  agentId: string,
  assignments: Record<string, number>,
): number {
  if (MANAGED_AGENT_PORTS[agentId]) return MANAGED_AGENT_PORTS[agentId]
  const existing = assignments[agentId]
  if (Number.isInteger(existing) && existing >= CUSTOM_PORT_BASE && existing < CUSTOM_PORT_BASE + CUSTOM_PORT_SPAN) {
    return existing
  }
  const used = new Set(Object.entries(assignments)
    .filter(([assignedAgentId]) => assignedAgentId !== agentId)
    .map(([, port]) => port)
    .filter((port) => Number.isInteger(port)))
  const preferred = resolvePreferredAgentPort(agentId)
  for (let offset = 0; offset < CUSTOM_PORT_SPAN; offset += 1) {
    const candidate = CUSTOM_PORT_BASE + ((preferred - CUSTOM_PORT_BASE + offset) % CUSTOM_PORT_SPAN)
    if (!used.has(candidate)) return candidate
  }
  throw new Error('agent-host: no custom agent ports are available on this computer')
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
