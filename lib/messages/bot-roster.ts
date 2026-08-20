import type { VisibleBotComputer } from './bot-computers'
import { computersForBot } from './bot-computers'
import { canShareAgentAsGrokBot } from './bot-shares'

export interface BotRosterSourceAgent {
  agentId: string
  name?: string
  role?: string
  iconKey?: string
  colorKey?: string
  defaultModel?: string
  enabled?: boolean
  agentKind?: string
  marketplaceTemplateId?: string
  provisioningMode?: string
  scopeOrgId?: string
}

export interface BotRosterChannelGroup {
  id: string
  conversations: Array<{ title?: string | null }>
}

export function buildBotRosterItems(
  agents: BotRosterSourceAgent[],
  groups: BotRosterChannelGroup[],
  computers: VisibleBotComputer[],
) {
  const groupById = new Map(groups.map((group) => [group.id, group]))
  return agents
    .filter((agent) => agent.enabled !== false)
    .map((agent) => {
      const group = groupById.get(agent.agentId)
      const botComputers = computersForBot(computers, agent.agentId)
      return {
        id: agent.agentId,
        name: agent.name?.trim() || agent.agentId,
        role: agent.role?.trim() || 'Specialist Bot',
        iconKey: agent.iconKey,
        colorKey: agent.colorKey,
        defaultModel: agent.defaultModel,
        channelCount: group?.conversations.length ?? 0,
        lastChannelTitle: group?.conversations[0]?.title ?? null,
        onlineComputerCount: botComputers.filter((computer) => computer.online).length,
        kind: agent.agentKind === 'marketplace' || agent.marketplaceTemplateId
          ? 'marketplace'
          : agent.agentKind === 'custom' || (Boolean(agent.scopeOrgId) && agent.provisioningMode === 'linked_device')
            ? 'custom'
            : 'specialist',
        shareable: canShareAgentAsGrokBot(agent),
      }
    })
}
