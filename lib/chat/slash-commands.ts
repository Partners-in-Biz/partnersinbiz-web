export type SlashCommandExecutorKind = 'context_attachment' | 'agent_intent'

export type SlashCommandId =
  | 'use-current-page'
  | 'task'
  | 'route'
  | 'briefing'
  | 'search'
  | 'help'

export interface SlashCommandDefinition {
  id: SlashCommandId
  token: string
  label: string
  description: string
  aliases: string[]
  icon: string
  executorKind: SlashCommandExecutorKind
  requiresCurrentPage?: boolean
  requiresProjectContext?: boolean
}

export interface ActiveSlashCommandPrompt {
  start: number
  end: number
  query: string
}

export interface SlashCommandPayload {
  id: SlashCommandId
  token: string
  label: string
  executorKind: SlashCommandExecutorKind
  args: string
}

export const SLASH_COMMANDS: SlashCommandDefinition[] = [
  {
    id: 'use-current-page',
    token: '/use-current-page',
    label: 'Use current page',
    description: 'Attach the current admin/portal page as structured chat context.',
    aliases: ['/page', '/context', '/attach-current-page'],
    icon: 'add_link',
    executorKind: 'context_attachment',
    requiresCurrentPage: true,
  },
  {
    id: 'task',
    token: '/task',
    label: 'Create task',
    description: 'Ask Pip to create or update a Projects/Kanban task from this message.',
    aliases: ['/todo'],
    icon: 'task_alt',
    executorKind: 'agent_intent',
  },
  {
    id: 'route',
    token: '/route',
    label: 'Route work',
    description: 'Route work to the right PiB specialist with structured task-bus intent.',
    aliases: ['/handoff', '/assign'],
    icon: 'alt_route',
    executorKind: 'agent_intent',
  },
  {
    id: 'briefing',
    token: '/briefing',
    label: 'Briefing',
    description: 'Ask for an operator briefing or briefing-report action with explicit intent.',
    aliases: ['/brief', '/report'],
    icon: 'campaign',
    executorKind: 'agent_intent',
  },
  {
    id: 'search',
    token: '/search',
    label: 'Search workspace',
    description: 'Search platform/project context and attach or summarise the right result.',
    aliases: ['/find'],
    icon: 'search',
    executorKind: 'agent_intent',
  },
  {
    id: 'help',
    token: '/help',
    label: 'Show commands',
    description: 'Ask Pip to explain available slash commands for this chat.',
    aliases: ['/commands'],
    icon: 'help',
    executorKind: 'agent_intent',
  },
]

export function findActiveSlashCommandPrompt(value: string, caret = value.length): ActiveSlashCommandPrompt | null {
  const safeCaret = Math.max(0, Math.min(caret, value.length))
  const beforeCaret = value.slice(0, safeCaret)
  const tokenMatch = beforeCaret.match(/(^|\s)(\/[\w-]*)$/)
  if (!tokenMatch || tokenMatch.index === undefined) return null
  const token = tokenMatch[2] ?? ''
  if (!token.startsWith('/')) return null
  const start = tokenMatch.index + (tokenMatch[1]?.length ?? 0)
  return {
    start,
    end: safeCaret,
    query: token.slice(1).toLowerCase(),
  }
}

export function filterSlashCommands(query: string): SlashCommandDefinition[] {
  const normalized = query.trim().replace(/^\//, '').toLowerCase()
  if (!normalized) return SLASH_COMMANDS
  return SLASH_COMMANDS.filter((command) => {
    const searchable = [command.token, command.label, command.description, ...command.aliases]
      .join(' ')
      .toLowerCase()
    return searchable.includes(normalized)
  })
}

export function getSlashCommandByToken(token: string): SlashCommandDefinition | null {
  const normalized = token.trim().toLowerCase()
  if (!normalized.startsWith('/')) return null
  return SLASH_COMMANDS.find((command) =>
    command.token === normalized || command.aliases.includes(normalized),
  ) ?? null
}

export function parseLeadingSlashCommand(value: string): { command: SlashCommandDefinition; args: string } | null {
  const trimmed = value.trimStart()
  if (!trimmed.startsWith('/')) return null
  const [rawToken = '', ...rest] = trimmed.split(/\s+/)
  const command = getSlashCommandByToken(rawToken)
  if (!command) return null
  return { command, args: rest.join(' ').trim() }
}

export function replaceSlashCommandToken(
  value: string,
  prompt: ActiveSlashCommandPrompt,
  command: SlashCommandDefinition,
): { value: string; caret: number } {
  const replacement = `${command.token} `
  const nextValue = `${value.slice(0, prompt.start)}${replacement}${value.slice(prompt.end)}`
  return {
    value: nextValue,
    caret: prompt.start + replacement.length,
  }
}

export function buildSlashCommandPayload(
  command: SlashCommandDefinition,
  args: string,
): SlashCommandPayload {
  return {
    id: command.id,
    token: command.token,
    label: command.label,
    executorKind: command.executorKind,
    args: args.trim(),
  }
}

export function slashCommandInstruction(payload: SlashCommandPayload): string {
  return [
    '[Slash command]',
    `id: ${payload.id}`,
    `token: ${payload.token}`,
    `label: ${payload.label}`,
    `executor: ${payload.executorKind}`,
    payload.args ? `args: ${payload.args}` : 'args: ',
    'Treat this as structured command intent from the composer, not as decorative message text. If it maps to a platform operation, use the relevant typed API/workflow rather than guessing from prose.',
    '---',
    '',
  ].join('\n')
}
