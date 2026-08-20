/**
 * Messages vs Bot Mode — product mapping from OpenBot, GrokBot, and Hermes.
 *
 * OpenBot (CopilotKit): two surfaces — channels (message a coworker) vs `/bot`
 * (direct Bot chat). Each Bot has a computer (browser, files, workspace). The
 * live screen sits beside the conversation; a person can take the wheel.
 * Answers prefer components/canvas over prose.
 *
 * Hermes Desktop Bot Mode (Nous Research, 2026-08-17): agent profiles become
 * named Bots. Each Bot has a role, model, memory, skills, and picture. Bots
 * can use any model and talk to each other. Build a specialist once, reuse it.
 *
 * GrokBot (x.ai/bot): a Bot is a durable identity (instructions, personality,
 * shareable), not an ephemeral thread. Switching into Bot Mode is switching
 * from "a chat log" to "a roster of coworkers you can hand work to".
 *
 * PiB mapping:
 * - Messages mode = existing session catalogue (projects, companies, threads).
 * - Bot mode = named specialists as Bots, channels per Bot, visible computers,
 *   workbench + intelligent Context Dock canvas beside the thread.
 * - Bot-to-Bot inbox = Hermes Agent Inbox as ordinary conversations with
 *   channelKind=bot_inbox (human observes; recipient Bot is dispatched).
 * - Isolated computers = OpenBot container/volume/profile mapped to
 *   bots/{agentId} + browser profile on the existing linked Mac/VPS.
 * - Custom GrokBots = linked custom agents that can be created, shared, and
 *   cloned beyond the org specialist roster.
 */
export const MESSAGES_EXPERIENCE_MODES = ['messages', 'bot'] as const

export type MessagesExperienceMode = (typeof MESSAGES_EXPERIENCE_MODES)[number]

export const MESSAGES_EXPERIENCE_MODE_PARAM = 'mode'
export const MESSAGES_EXPERIENCE_MODE_STORAGE_FIELD = 'experienceMode'

export function isMessagesExperienceMode(value: unknown): value is MessagesExperienceMode {
  return value === 'messages' || value === 'bot'
}

export function parseMessagesExperienceMode(value: unknown): MessagesExperienceMode {
  return value === 'bot' ? 'bot' : 'messages'
}

export function resolveMessagesExperienceMode(input: {
  searchParam?: string | null
  stored?: unknown
}): MessagesExperienceMode {
  if (isMessagesExperienceMode(input.searchParam)) return input.searchParam
  return parseMessagesExperienceMode(input.stored)
}

export function experienceModeSearchValue(mode: MessagesExperienceMode): string | null {
  return mode === 'bot' ? 'bot' : null
}

export function applyExperienceModeToSearch(search: string, mode: MessagesExperienceMode): string {
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search)
  const next = experienceModeSearchValue(mode)
  if (next) params.set(MESSAGES_EXPERIENCE_MODE_PARAM, next)
  else params.delete(MESSAGES_EXPERIENCE_MODE_PARAM)
  const encoded = params.toString()
  return encoded ? `?${encoded}` : ''
}

export const BOT_MODE_COPY = {
  title: 'Bot mode',
  description: 'Named specialist Bots with their own channels, computers, and canvas.',
  railLabel: 'Bots',
  channelsLabel: 'Channels',
  computersLabel: 'Computers',
  landingEyebrow: 'Bot mode',
  landingTitle: 'Start a channel with a Bot',
  landingBody: 'Each Bot is a specialist with a role, model, and computer. Watch the machine work, take the wheel, and review artifacts on the canvas instead of scrolling a transcript.',
  inboxLabel: 'Bot inbox',
  inboxEmpty: 'No Bot-to-Bot threads yet. Send work from one Bot to another.',
  createBotLabel: 'Create a Bot',
  importBotLabel: 'Import a shared Bot',
} as const
