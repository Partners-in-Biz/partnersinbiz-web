/**
 * Slash-command visibility and enforcement for Messages.
 *
 * Operator commands change agent runtime policy, durable memory, personality, or
 * workspace files — only machine owners / org managers / platform super-admins.
 * Goal loops require dispatch rights on the conversation, not bare client observers.
 */
import type { SlashCommandDefinition, SlashCommandId } from '@/lib/chat/slash-commands'
import { SLASH_COMMANDS } from '@/lib/chat/slash-commands'

export type SlashAccessTier =
  | 'public'
  | 'dispatch'
  | 'operator_read'
  | 'operator_write'

export interface SlashAccessActor {
  uid: string
  /** ApiRole or portal member role string */
  role?: string | null
  isSuperAdmin?: boolean
  /** Org owner/admin or platform admin acting in org Messages */
  isOrgManager?: boolean
}

export interface SlashAccessAgent {
  agentId: string
  ownerUserId?: string | null
  accessScope?: string | null
  provisioningMode?: string | null
  scopeOrgId?: string | null
}

export interface SlashAccessConversation {
  startedBy?: string | null
  ownerUserId?: string | null
}

export interface SlashAccessEvaluation {
  allowed: boolean
  tier: SlashAccessTier
  reason: string
}

/** Classify command + args into an access tier. */
export function slashCommandAccessTier(
  commandId: SlashCommandId | string,
  args = '',
): SlashAccessTier {
  switch (commandId) {
    case 'toolsets':
    case 'rollback':
    case 'personality':
      return 'operator_write'
    case 'memory': {
      const t = args.trim().toLowerCase()
      if (!t || t === 'show' || t === 'list' || t === 'status') return 'operator_read'
      if (t.startsWith('add ') || t.startsWith('user add ') || t.startsWith('set ')) {
        return 'operator_write'
      }
      // Unknown subcommand — treat as write to fail closed on server
      return 'operator_write'
    }
    case 'hermes-features':
      return 'operator_read'
    case 'context':
      // Read-only context usage — any conversation participant may inspect.
      return 'public'
    case 'compress':
      // Triggers a Hermes run and durably rewrites the conversation context.
      return 'dispatch'
    case 'goal':
    case 'subgoal':
      return 'dispatch'
    case 'hire':
      // Org design + optional machine provision. Participants may request; Pip still
      // gates real profile creation behind explicit intent + runtime operator skills.
      return 'dispatch'
    case 'use-current-page':
    case 'task':
    case 'route':
    case 'council':
    case 'briefing':
    case 'search':
    case 'skills':
    case 'help':
    case 'polish':
    case 'typeset':
    case 'layout':
    case 'colorize':
    case 'bolder':
    case 'quieter':
    case 'distill':
    case 'clarify':
    case 'harden':
    case 'audit':
    case 'critique':
    default:
      return 'public'
  }
}

export function isAgentOwner(actor: SlashAccessActor, agent?: SlashAccessAgent | null): boolean {
  if (!agent?.ownerUserId) return false
  return agent.ownerUserId === actor.uid
}

/**
 * Operator for this agent = may change runtime policy / memory / personality / rollback.
 * - Platform super-admin: always
 * - Personal linked agent: owning member only
 * - Org linked agent: org managers (owner/admin)
 * - Platform VPS fleet agents: super-admin only (not ordinary clients)
 */
export function canOperateAgentRuntime(
  actor: SlashAccessActor,
  agent?: SlashAccessAgent | null,
): boolean {
  if (actor.isSuperAdmin) return true
  if (!agent) {
    // No agent context: only super-admins (or org managers on admin surface treated as managers)
    return Boolean(actor.isOrgManager && actor.role === 'admin')
  }

  const linked = agent.provisioningMode === 'linked_device'
  if (linked) {
    if (agent.accessScope === 'personal') {
      return isAgentOwner(actor, agent)
    }
    // organization-scoped linked agent
    return Boolean(actor.isOrgManager) || isAgentOwner(actor, agent)
  }

  // Platform VPS / fleet named agents (pip, theo, …)
  return Boolean(actor.isSuperAdmin)
}

/**
 * May run standing goals / subgoals that drive Hermes dispatch.
 * Conversation starter, workspace owner, agent operator, or super-admin.
 * Not bare client observers on someone else's session.
 */
export function canDispatchStandingGoals(
  actor: SlashAccessActor,
  conversation?: SlashAccessConversation | null,
  agent?: SlashAccessAgent | null,
): boolean {
  if (actor.isSuperAdmin) return true
  if (canOperateAgentRuntime(actor, agent)) return true
  if (conversation?.startedBy && conversation.startedBy === actor.uid) return true
  if (conversation?.ownerUserId && conversation.ownerUserId === actor.uid) return true
  // Platform admins and org managers may drive goals in org chats they can access
  if (actor.isOrgManager && actor.role === 'admin') return true
  if (actor.isOrgManager && agent?.accessScope === 'organization') return true
  return false
}

export function evaluateSlashCommandAccess(input: {
  commandId: SlashCommandId | string
  args?: string
  actor: SlashAccessActor
  conversation?: SlashAccessConversation | null
  agent?: SlashAccessAgent | null
}): SlashAccessEvaluation {
  const tier = slashCommandAccessTier(input.commandId, input.args ?? '')
  if (tier === 'public') {
    return { allowed: true, tier, reason: 'public slash command' }
  }

  if (tier === 'dispatch') {
    const ok = canDispatchStandingGoals(input.actor, input.conversation, input.agent)
    return {
      allowed: ok,
      tier,
      reason: ok
        ? 'dispatch allowed'
        : 'Standing goals require conversation ownership or agent operator rights',
    }
  }

  if (tier === 'operator_read' || tier === 'operator_write') {
    const ok = canOperateAgentRuntime(input.actor, input.agent)
    return {
      allowed: ok,
      tier,
      reason: ok
        ? 'operator allowed'
        : tier === 'operator_write'
          ? 'This command changes agent runtime policy, memory, personality, or files — agent owner / org manager / platform admin only'
          : 'Agent runtime status is limited to the agent owner, org managers, and platform admins',
    }
  }

  return { allowed: false, tier, reason: 'Unknown slash access tier' }
}

/** Filter slash definitions for the composer autocomplete. */
export function filterSlashCommandsByAccess(
  commands: SlashCommandDefinition[],
  input: {
    actor: SlashAccessActor
    conversation?: SlashAccessConversation | null
    agent?: SlashAccessAgent | null
  },
): SlashCommandDefinition[] {
  return commands.filter((command) => {
    // Menu shows read-tier for memory (empty args) so owners see the command;
    // write subcommands are still enforced server-side.
    const args = command.id === 'memory' ? '' : ''
    return evaluateSlashCommandAccess({
      commandId: command.id,
      args,
      actor: input.actor,
      conversation: input.conversation,
      agent: input.agent,
    }).allowed
  })
}

export function listSlashCommandsForAccess(input: {
  actor: SlashAccessActor
  conversation?: SlashAccessConversation | null
  agent?: SlashAccessAgent | null
  query?: string
}): SlashCommandDefinition[] {
  const q = (input.query || '').trim().replace(/^\//, '').toLowerCase()
  const base = !q
    ? SLASH_COMMANDS
    : SLASH_COMMANDS.filter((command) => {
        const searchable = [command.token, command.label, command.description, ...command.aliases]
          .join(' ')
          .toLowerCase()
        return searchable.includes(q)
      })
  return filterSlashCommandsByAccess(base, input)
}
