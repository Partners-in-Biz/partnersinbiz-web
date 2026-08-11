import { buildDesignCommandGuidance, DESIGN_COMMANDS } from '@/lib/chat/design-commands'

export type SlashCommandExecutorKind =
  | 'context_attachment'
  | 'agent_intent'
  | 'hermes_goal'
  | 'hermes_features'
  | 'design_command'

export type SlashCommandId =
  | 'use-current-page'
  | 'task'
  | 'route'
  | 'council'
  | 'briefing'
  | 'search'
  | 'skills'
  | 'hire'
  | 'goal'
  | 'subgoal'
  | 'toolsets'
  | 'memory'
  | 'rollback'
  | 'personality'
  | 'context'
  | 'compress'
  | 'hermes-features'
  | 'help'
  | 'polish'
  | 'typeset'
  | 'layout'
  | 'colorize'
  | 'bolder'
  | 'quieter'
  | 'distill'
  | 'clarify'
  | 'harden'
  | 'audit'
  | 'critique'

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
    aliases: ['/page', '/attach-current-page'],
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
    id: 'council',
    token: '/council',
    label: 'Council mode',
    description: 'Ask Pip to convene a structured specialist council, debate trade-offs, and return a synthesized recommendation.',
    aliases: ['/debate', '/panel', '/roundtable'],
    icon: 'groups',
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
    id: 'skills',
    token: '/skills',
    label: 'Show agent skills',
    description: 'Show the selected agent skills, capabilities, and the best skill for this request.',
    aliases: ['/agent-skills', '/capabilities'],
    icon: 'psychology',
    executorKind: 'agent_intent',
  },
  {
    id: 'hire',
    token: '/hire',
    label: 'Hire agent',
    description:
      'Design org-chart seats and optionally provision live Hermes profiles (chart + machine hire). Chart save alone never creates profiles.',
    aliases: ['/agent-hire', '/provision-agent'],
    icon: 'person_add',
    executorKind: 'agent_intent',
  },
  {
    id: 'goal',
    token: '/goal',
    label: 'Standing goal',
    description: 'Set a Hermes standing goal that auto-continues until done (Ralph loop). Subcommands: status, pause, resume, clear, draft.',
    aliases: ['/goals', '/ralph'],
    icon: 'flag',
    executorKind: 'hermes_goal',
  },
  {
    id: 'subgoal',
    token: '/subgoal',
    label: 'Goal criterion',
    description: 'Add, list, or remove extra acceptance criteria on the active Hermes goal without resetting the loop.',
    aliases: ['/criteria'],
    icon: 'playlist_add_check',
    executorKind: 'hermes_goal',
  },
  {
    id: 'toolsets',
    token: '/toolsets',
    label: 'Toolsets',
    description: 'List or change Hermes toolsets enabled for this agent/chat (enable, disable, set).',
    aliases: ['/toolset'],
    icon: 'build',
    executorKind: 'hermes_features',
  },
  {
    id: 'memory',
    token: '/memory',
    label: 'Agent memory',
    description: 'Show or update curated MEMORY.md / USER.md for the active agent.',
    aliases: [],
    icon: 'psychology_alt',
    executorKind: 'hermes_features',
  },
  {
    id: 'rollback',
    token: '/rollback',
    label: 'Checkpoint rollback',
    description: 'List checkpoints, save a snapshot, or restore workspace files with /rollback.',
    aliases: ['/checkpoint'],
    icon: 'history',
    executorKind: 'hermes_features',
  },
  {
    id: 'personality',
    token: '/personality',
    label: 'Personality',
    description: 'List or apply Hermes SOUL personality presets for the active agent.',
    aliases: ['/soul'],
    icon: 'face',
    executorKind: 'hermes_features',
  },
  {
    id: 'context',
    token: '/context',
    label: 'Context usage',
    description: 'Show what is consuming this conversation context window and how close it is to the history limit.',
    aliases: ['/ctx'],
    icon: 'speed',
    executorKind: 'hermes_features',
  },
  {
    id: 'compress',
    token: '/compress',
    label: 'Compress context',
    description: 'Summarize older messages and keep the latest exchanges in full (/compress here 5, /compress focus <topic>).',
    aliases: ['/compact'],
    icon: 'compress',
    executorKind: 'hermes_features',
  },
  {
    id: 'hermes-features',
    token: '/hermes-features',
    label: 'Hermes features status',
    description: 'Show PiB Hermes Features Overview control-plane readiness (toolsets, media, MCP, plugins).',
    aliases: ['/hermes-features-status'],
    icon: 'tune',
    executorKind: 'hermes_features',
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
  ...DESIGN_COMMANDS.map((designCommand) => ({
    id: designCommand.id,
    token: designCommand.token,
    label: designCommand.label,
    description: designCommand.description,
    aliases: designCommand.aliases,
    icon: designCommand.icon,
    executorKind: 'design_command' as const,
  })),
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

/** Access-aware menu filter — see `slash-command-access.ts`. Re-exported for call sites. */
export { listSlashCommandsForAccess, filterSlashCommandsByAccess, evaluateSlashCommandAccess } from '@/lib/chat/slash-command-access'

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

export function councilModeGuidanceLines(trigger: 'slash-command' | 'multi-agent-chat' = 'slash-command'): string[] {
  const opening = trigger === 'multi-agent-chat'
    ? 'Council-style multi-agent orchestration requirements:'
    : 'Council mode requirements:'

  return [
    opening,
    '- Select the relevant PiB specialist perspectives for the question before answering. Use role fit: Theo=engineering, Maya=content/brand/social, Sage=research/strategy, Vera=data/analytics, Nora=ops/billing/admin, Quinn=QA/release, Ari=paid media, Silas=SEO, Luca=support, Iris=documents, Blake=sales.',
    '- Prefer real independent perspectives when supported: use Hermes subagents for bounded one-off analysis, or Projects/Kanban task-bus handoffs when the work needs durable ownership, evidence, approvals, or review.',
    '- Default to gathering 2-3 read-only perspectives in parallel (subagent batch or task-bus handoffs) before synthesizing; cap the fan-out at ~3 to bound cost.',
    '- For high-stakes decisions (pricing, positioning, build-vs-buy), run the same question through 2+ model families in parallel and aggregate. Hermes subagents inherit the parent model by default, so for genuine model diversity prefer Projects/Kanban task fan-out with per-task agentModel overrides (e.g. claude-sonnet-4-6 + gpt-5.5); no new credentials needed.',
    '- If you cannot actually call a subagent/specialist in this run, simulate only the clearly relevant perspectives and label them as perspective analysis, not as completed agent execution.',
    '- Include challenge/debate: key disagreements, risks, approval gates, and what evidence would change the recommendation.',
    '- Run an explicit verification/cross-check pass before consensus: check each material claim against evidence (source, test, API read-back) and flag unverified items.',
    '- Sharpen the evidence-that-would-change-recommendation check into an adversarial question list: what would disprove this, who loses, and what breaks at 10x scale.',
    '- Name where perspectives diverged and state why consensus chose X over Y.',
    '- Finish with a clear consensus/recommendation, minority objections if any, confidence level, and the owner for next execution.',
    '- Do not perform client-visible, spend, deploy, finance, secret/config, or destructive actions without the normal approval gate.',
  ]
}

export function hermesGoalCommandLine(payload: SlashCommandPayload): string {
  const args = payload.args.trim()
  if (payload.id === 'subgoal') return args ? `/subgoal ${args}` : '/subgoal'
  return args ? `/goal ${args}` : '/goal'
}

export function hermesGoalGuidanceLines(payload: SlashCommandPayload): string[] {
  const native = hermesGoalCommandLine(payload)
  return [
    'Hermes Persistent Goal mode (Ralph loop):',
    `- Native command line: ${native}`,
    '- Keep working across automatic continuations until the standing goal is verifiably complete.',
    '- Prefer tool evidence (tests, commands, file diffs). Do not claim done without proof.',
    '- If blocked on human approval, secrets, deploy, spend, finance, or destructive actions, stop and report clearly.',
    '- End with exactly one line: GOAL_STATUS: done|continue|blocked — <reason>.',
    '- Docs: https://hermes-agent.nousresearch.com/docs/user-guide/features/goals',
  ]
}

export function hermesFeaturesCommandLine(payload: SlashCommandPayload): string {
  const args = payload.args.trim()
  return args ? `${payload.token} ${args}` : payload.token
}

function hireCommandGuidanceLines(payload: SlashCommandPayload): string[] {
  const args = payload.args.trim()
  return [
    'HIRE MODE (/hire). Design org-chart seats and optionally provision live Hermes agent profiles.',
    '1) Load skill pib-agent-org-setup first. Use agent-runtime-ops only when a real profile must be created/linked.',
    '2) Resolve orgId (current workspace org or explicit). Never invent client orgIds.',
    '3) Separate layers always:',
    '   - Chart seats (Firestore org chart): titles, reportsTo, capabilities, defaults, bind agentId.',
    '   - Live brains (Hermes profiles on machines): only with explicit hire/provision intent.',
    '4) Chart-only by default. Do NOT create machine profiles unless the user clearly wants a live hire',
    '   (words like provision, create profile, make live, hire on Mac/VPS). Binding without a profile = role seat.',
    '5) Recommended PiB shape for development + marketing companies:',
    '   Coordinator/Pip → Engineering lead (Theo) with optional FE/BE seats + Quinn QA;',
    '   Marketing lead (Maya) with Ari paid / Silas SEO / Vera analytics;',
    '   peers under coordinator: Sage research, Blake sales, Iris docs, Nora ops, Luca support.',
    '6) For each role: pick agentId, soul voice, skill pack (pib-agent-org-setup recommended packs),',
    '   default model/effort, machine target (Mac mini linked-device vs VPS), and bind after profile exists.',
    '7) Confirm plan briefly, then execute: seed/patch chart → (optional) provision profile + skills → bind agentId → verify.',
    '8) Never auto-send client messages, never production-deploy, never spend ads as part of hire.',
    args
      ? `User hire brief: ${args}`
      : 'User opened /hire with no args — ask org, roles/hierarchy, chart-only vs live provision, and machine target.',
  ]
}

export function slashCommandInstruction(payload: SlashCommandPayload): string {
  const commandGuidance = payload.id === 'council'
    ? councilModeGuidanceLines('slash-command')
    : payload.id === 'hire'
      ? hireCommandGuidanceLines(payload)
      : payload.executorKind === 'design_command'
      ? buildDesignCommandGuidance(payload)
      : payload.executorKind === 'hermes_goal'
        ? hermesGoalGuidanceLines(payload)
        : payload.executorKind === 'hermes_features'
          ? [
            'Hermes Features control plane (PiB adapter on /v1/runs):',
            '- Prefer /toolsets, /memory, /rollback, /personality, /context, /compress over free-form config edits.',
            '- /context shows what is consuming the context window; /compress here 5 or /compress focus <topic> shrinks it. For /compress, summarize the older-message block and reply with only the summary text.',
            '- Architecture remains Firestore + /v1/runs, not SessionDB slash.exec.',
          ]
          : []

  return [
    '[Slash command]',
    `id: ${payload.id}`,
    `token: ${payload.token}`,
    `label: ${payload.label}`,
    `executor: ${payload.executorKind}`,
    payload.args ? `args: ${payload.args}` : 'args: ',
    payload.executorKind === 'design_command'
      ? ''
      : payload.executorKind === 'hermes_goal'
        ? `native: ${hermesGoalCommandLine(payload)}`
        : payload.executorKind === 'hermes_features'
          ? `control: ${hermesFeaturesCommandLine(payload)}`
          : 'Treat this as structured command intent from the composer, not as decorative message text. If it maps to a platform operation, use the relevant typed API/workflow rather than guessing from prose.',
    ...commandGuidance,
    '---',
    '',
  ].join('\n')
}
