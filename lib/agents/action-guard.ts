import type { CrmAuthContext } from '@/lib/auth/crm-middleware'

export type AgentCrmActionKind =
  | 'draft'
  | 'link'
  | 'create_task'
  | 'create_document'
  | 'client_visible'
  | 'destructive'
  | 'billing'
  | 'sharing'

export interface AgentCrmActionInput {
  action: AgentCrmActionKind
  visibility?: string
  approvalState?: string
  clientVisible?: boolean
  destructive?: boolean
  billing?: boolean
  sharing?: boolean
}

export type AgentCrmActionGuard =
  | { allowed: true; approvalRequired: false }
  | { allowed: false; approvalRequired: true; reason: string }

function isAgentContext(ctx: Pick<CrmAuthContext, 'isAgent' | 'actor'>): boolean {
  return ctx.isAgent || ctx.actor.kind === 'agent' || ctx.actor.uid.startsWith('agent:')
}

export function guardAgentCrmAction(
  ctx: Pick<CrmAuthContext, 'isAgent' | 'actor'>,
  input: AgentCrmActionInput,
): AgentCrmActionGuard {
  if (!isAgentContext(ctx)) return { allowed: true, approvalRequired: false }
  if (input.approvalState === 'approved') return { allowed: true, approvalRequired: false }

  const requiresApproval =
    input.action === 'client_visible' ||
    input.action === 'destructive' ||
    input.action === 'billing' ||
    input.action === 'sharing' ||
    input.clientVisible === true ||
    input.destructive === true ||
    input.billing === true ||
    input.sharing === true ||
    input.visibility === 'client_visible'

  if (requiresApproval) {
    return {
      allowed: false,
      approvalRequired: true,
      reason: 'Approval required before an agent can make client-visible, billing, sharing, or destructive CRM OS changes.',
    }
  }

  return { allowed: true, approvalRequired: false }
}
