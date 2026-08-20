import type { VisibleBotComputer } from './bot-computers'
import { computersForBot } from './bot-computers'
import { canShareAgentAsGrokBot } from './bot-shares'

export type BotRosterKind = 'custom' | 'marketplace' | 'specialist'

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

export interface BotRosterItem {
  id: string
  name: string
  role: string
  iconKey?: string
  colorKey?: string
  defaultModel?: string
  channelCount: number
  lastChannelTitle?: string | null
  onlineComputerCount: number
  kind?: BotRosterKind
  shareable?: boolean
}

function resolveBotRosterKind(agent: BotRosterSourceAgent): BotRosterKind {
  if (agent.agentKind === 'marketplace' || Boolean(agent.marketplaceTemplateId)) return 'marketplace'
  if (agent.agentKind === 'custom' || (Boolean(agent.scopeOrgId) && agent.provisioningMode === 'linked_device')) {
    return 'custom'
  }
  return 'specialist'
}

export function buildBotRosterItems(
  agents: BotRosterSourceAgent[],
  groups: BotRosterChannelGroup[],
  computers: VisibleBotComputer[],
): BotRosterItem[] {
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
        kind: resolveBotRosterKind(agent),
        shareable: canShareAgentAsGrokBot(agent),
      }
    })
}
