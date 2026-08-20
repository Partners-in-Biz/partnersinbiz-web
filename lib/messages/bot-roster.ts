import type { VisibleBotComputer } from './bot-computers'
import { computersForBot } from './bot-computers'
import { canShareAgentAsGrokBot } from './bot-shares'

export type BotRosterKind = 'custom' | 'marketplace' | 'specialist'

export type BotRosterTimestamp = { seconds?: number; _seconds?: number } | string | null | undefined

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
  conversations: Array<{
    title?: string | null
    lastMessagePreview?: string | null
    lastMessageAt?: BotRosterTimestamp
  }>
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
  lastPreview?: string | null
  lastAt?: BotRosterTimestamp
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

function timestampSeconds(ts: BotRosterTimestamp): number {
  if (!ts) return 0
  if (typeof ts === 'string') {
    const parsed = Date.parse(ts)
    return Number.isFinite(parsed) ? parsed / 1000 : 0
  }
  return ts.seconds ?? ts._seconds ?? 0
}

export function botRosterRelativeTime(ts: BotRosterTimestamp, nowMs = Date.now()): string {
  const secs = timestampSeconds(ts)
  if (!secs) return ''
  const diff = Math.floor(nowMs / 1000 - secs)
  if (diff < 86400 && diff >= 0) {
    return new Date(secs * 1000).toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit', hour12: false })
  }
  if (diff < 604800) return `${Math.floor(diff / 86400)}d`
  return new Date(secs * 1000).toLocaleDateString('en-ZA', { day: '2-digit', month: 'short' })
}

function latestConversation(conversations: BotRosterChannelGroup['conversations']) {
  if (conversations.length === 0) return null
  return [...conversations].sort((left, right) => timestampSeconds(right.lastMessageAt) - timestampSeconds(left.lastMessageAt))[0] ?? conversations[0]
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
      const latest = latestConversation(group?.conversations ?? [])
      const botComputers = computersForBot(computers, agent.agentId)
      return {
        id: agent.agentId,
        name: agent.name?.trim() || agent.agentId,
        role: agent.role?.trim() || 'Specialist Bot',
        iconKey: agent.iconKey,
        colorKey: agent.colorKey,
        defaultModel: agent.defaultModel,
        channelCount: group?.conversations.length ?? 0,
        lastChannelTitle: latest?.title ?? group?.conversations[0]?.title ?? null,
        lastPreview: latest?.lastMessagePreview?.trim() || latest?.title || null,
        lastAt: latest?.lastMessageAt ?? null,
        onlineComputerCount: botComputers.filter((computer) => computer.online).length,
        kind: resolveBotRosterKind(agent),
        shareable: canShareAgentAsGrokBot(agent),
      }
    })
}
