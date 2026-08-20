export type BotComputerKind = 'vps' | 'computer' | 'unknown'

export interface VisibleBotComputer {
  id: string
  label: string
  kind: BotComputerKind
  online: boolean
  mappingLabel?: string | null
  availableAgentIds: string[]
}

export interface BotComputerRuntimeLike {
  id?: string | null
  label?: string | null
  kind?: string | null
  deviceKind?: string | null
  selectable?: boolean
  isFresh?: boolean
  isHealthy?: boolean
  mappingLabel?: string | null
  availableAgentIds?: string[] | null
}

function computerKind(runtime: BotComputerRuntimeLike): BotComputerKind {
  const raw = String(runtime.deviceKind || runtime.kind || '').toLowerCase()
  if (raw === 'vps') return 'vps'
  if (raw === 'computer' || raw === 'mac' || raw === 'local') return 'computer'
  return 'unknown'
}

export function uniqueBotComputers(
  runtimes: Iterable<BotComputerRuntimeLike>,
  activeId?: string | null,
): VisibleBotComputer[] {
  const chosen = new Map<string, VisibleBotComputer>()
  for (const runtime of runtimes) {
    const id = typeof runtime.id === 'string' ? runtime.id.trim() : ''
    if (!id) continue
    const online = Boolean(runtime.selectable && runtime.isFresh && runtime.isHealthy)
    const next: VisibleBotComputer = {
      id,
      label: runtime.label?.trim() || 'Computer',
      kind: computerKind(runtime),
      online,
      mappingLabel: runtime.mappingLabel ?? null,
      availableAgentIds: Array.isArray(runtime.availableAgentIds)
        ? runtime.availableAgentIds.filter((agentId): agentId is string => typeof agentId === 'string' && agentId.length > 0)
        : [],
    }
    const existing = chosen.get(id)
    if (!existing || (next.online && !existing.online)) chosen.set(id, next)
  }
  const list = Array.from(chosen.values())
  list.sort((a, b) => {
    if (a.id === activeId) return -1
    if (b.id === activeId) return 1
    if (a.online !== b.online) return a.online ? -1 : 1
    return a.label.localeCompare(b.label)
  })
  return list
}

export function computersForBot(computers: VisibleBotComputer[], agentId?: string | null): VisibleBotComputer[] {
  if (!agentId) return computers
  const matching = computers.filter((computer) =>
    computer.availableAgentIds.length === 0 || computer.availableAgentIds.includes(agentId),
  )
  return matching.length > 0 ? matching : computers
}
