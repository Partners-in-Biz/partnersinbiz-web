/**
 * Bot-mode conversation kinds — Hermes Agent Inbox on PiB conversations.
 *
 * Messages mode stays a human chat log. Bot mode adds:
 * - `bot`: a human channel with one named Bot
 * - `bot_inbox`: a durable Bot-to-Bot thread the human can observe
 *
 * Inbox is not @agent delegation (that remains an isolated child goal).
 * It is a standing conversation both Bots can return to with work.
 */

export const BOT_CHANNEL_KINDS = ['messages', 'bot', 'bot_inbox'] as const
export type BotChannelKind = (typeof BOT_CHANNEL_KINDS)[number]

export const BOT_INBOX_STATUSES = ['open', 'working', 'returned', 'closed'] as const
export type BotInboxStatus = (typeof BOT_INBOX_STATUSES)[number]

export interface BotInboxMeta {
  fromAgentId: string
  toAgentId: string
  parentConversationId?: string | null
  status: BotInboxStatus
}

export interface BotInboxConversationLike {
  id?: string
  title?: string | null
  channelKind?: string | null
  botInbox?: Partial<BotInboxMeta> | null
  participantAgentIds?: string[] | null
  lastMessagePreview?: string | null
  archived?: boolean
}

export interface BotInboxThread {
  id: string
  title: string
  fromAgentId: string
  toAgentId: string
  status: BotInboxStatus
  parentConversationId?: string | null
  preview?: string | null
}

export function isBotChannelKind(value: unknown): value is BotChannelKind {
  return value === 'messages' || value === 'bot' || value === 'bot_inbox'
}

export function parseBotChannelKind(value: unknown): BotChannelKind {
  return isBotChannelKind(value) ? value : 'messages'
}

export function usesBotComputerIsolation(channelKind: unknown): boolean {
  const kind = parseBotChannelKind(channelKind)
  return kind === 'bot' || kind === 'bot_inbox'
}

export function isBotInboxStatus(value: unknown): value is BotInboxStatus {
  return value === 'open' || value === 'working' || value === 'returned' || value === 'closed'
}

export function parseBotInboxStatus(value: unknown): BotInboxStatus {
  return isBotInboxStatus(value) ? value : 'open'
}

function cleanAgentId(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

export function parseBotInboxMeta(value: unknown): BotInboxMeta | null {
  if (!value || typeof value !== 'object') return null
  const row = value as Record<string, unknown>
  const fromAgentId = cleanAgentId(row.fromAgentId)
  const toAgentId = cleanAgentId(row.toAgentId)
  if (!fromAgentId || !toAgentId || fromAgentId === toAgentId) return null
  const parent = typeof row.parentConversationId === 'string' ? row.parentConversationId.trim() : ''
  return {
    fromAgentId,
    toAgentId,
    status: parseBotInboxStatus(row.status),
    ...(parent ? { parentConversationId: parent } : {}),
  }
}

export function isBotInboxConversation(conversation: BotInboxConversationLike | null | undefined): boolean {
  if (!conversation) return false
  if (parseBotChannelKind(conversation.channelKind) === 'bot_inbox') return true
  return Boolean(parseBotInboxMeta(conversation.botInbox))
}

/** Recipient first so conversation dispatch lands on the Bot that should do the work. */
export function orderedInboxAgentIds(fromAgentId: string, toAgentId: string): [string, string] {
  return [toAgentId.trim(), fromAgentId.trim()]
}

export function botInboxTitle(fromName: string, toName: string): string {
  const from = fromName.trim() || 'Bot'
  const to = toName.trim() || 'Bot'
  return `Inbox · ${from} → ${to}`
}

export function listBotInboxThreads(
  conversations: BotInboxConversationLike[],
  names: Record<string, string> = {},
): BotInboxThread[] {
  return conversations
    .filter((conversation) => !conversation.archived && isBotInboxConversation(conversation))
    .map((conversation) => {
      const meta = parseBotInboxMeta(conversation.botInbox)
      const agents = (conversation.participantAgentIds ?? []).filter((id) => typeof id === 'string' && id.trim())
      const fromAgentId = meta?.fromAgentId || agents[1] || agents[0] || ''
      const toAgentId = meta?.toAgentId || agents[0] || ''
      const fromName = names[fromAgentId] || fromAgentId
      const toName = names[toAgentId] || toAgentId
      return {
        id: String(conversation.id || ''),
        title: conversation.title?.trim() || botInboxTitle(fromName, toName),
        fromAgentId,
        toAgentId,
        status: meta?.status ?? 'open',
        parentConversationId: meta?.parentConversationId ?? null,
        preview: conversation.lastMessagePreview ?? null,
      }
    })
    .filter((thread) => thread.id && thread.fromAgentId && thread.toAgentId)
}

export function findOpenBotInboxThread(
  conversations: BotInboxConversationLike[],
  fromAgentId: string,
  toAgentId: string,
): BotInboxConversationLike | null {
  const from = fromAgentId.trim()
  const to = toAgentId.trim()
  if (!from || !to) return null
  return conversations.find((conversation) => {
    if (conversation.archived || !isBotInboxConversation(conversation)) return false
    const meta = parseBotInboxMeta(conversation.botInbox)
    return meta?.fromAgentId === from && meta?.toAgentId === to && (meta.status === 'open' || meta.status === 'working')
  }) ?? null
}
