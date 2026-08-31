import type { PromptProfile } from '@/lib/hermes-features/prompt-budget'

export interface MessagesPromptIntent {
  profile: PromptProfile
  needsCanvas: boolean
  needsMailbox: boolean
  needsStudio: boolean
  needsCeoDecisionRules: boolean
  needsProjectOrchestration: boolean
  needsWorkspaceWriteContext: boolean
  needsDelegation: boolean
}

const EXECUTION = /\b(create|update|edit|change|delete|archive|run|build|implement|fix|deploy|publish|schedule|send|upload|connect|reconnect|approve|reject|assign|move|start|stop)\b/i
const DRAFT = /\b(draft|preview|proposal|propose|plan|spec|design|review|prepare|outline)\b/i
const EMAIL = /\b(email|mailbox|inbox|gmail|smtp)\b/i
const CANVAS = /\b(draft|preview|proposal|quote|invoice|campaign|social post|document|report|spec|design audit|design this page)\b/i
const STUDIO = /\b(campaign|social post|image|video|creative|design audit|design this page)\b/i
const DECISION = /\b(analytics|dashboard|report|growth|pipeline|approval|spend|publish|schedule|invoice|finance|deploy|production)\b/i

/** Deterministic profile selection; unknown requests remain read-only. */
export function classifyMessagesPromptIntent(input: {
  content: string
  hasAttachments?: boolean
  slashExecutorKind?: string | null
  hasProject?: boolean
}): MessagesPromptIntent {
  const value = input.content.trim()
  const execution = EXECUTION.test(value) || input.slashExecutorKind === 'hermes_goal' || input.slashExecutorKind === 'design_command'
  const draft = !execution && (DRAFT.test(value) || Boolean(input.hasAttachments))
  const profile: PromptProfile = execution ? 'execution' : draft ? 'draft' : 'read_only'
  const needsMailbox = EMAIL.test(value)
  const needsCanvas = CANVAS.test(value) || input.slashExecutorKind === 'design_command'
  const needsStudio = STUDIO.test(value) || input.slashExecutorKind === 'design_command'
  const needsWorkspaceWriteContext = /\b(build|implement|fix|refactor|edit\s+(?:file|code)|write\s+(?:file|code)|run\s+tests?)\b/i.test(value)

  return {
    profile,
    needsCanvas,
    needsMailbox,
    needsStudio,
    needsCeoDecisionRules: DECISION.test(value),
    needsProjectOrchestration: Boolean(input.hasProject) && profile !== 'read_only',
    needsWorkspaceWriteContext,
    // Every human-triggered Messages turn mints a fresh user-delegation token.
    // Mailbox and other /api/v1/* calls must not reuse a stale pib_dlg_.
    needsDelegation: true,
  }
}
