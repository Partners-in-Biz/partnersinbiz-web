import type { ApiUser } from '@/lib/api/types'
import {
  AgentCapabilityError,
  assertAgentCapability,
} from '@/lib/agents/capabilities'
import type { AgentCapability } from '@/lib/agents/skill-policy'

export interface EmailMarketingApprovalEvidence {
  status?: string | null
  approvedBy?: string | null
  approvedByType?: string | null
  approvalTaskId?: string | null
}

export class EmailMarketingApprovalError extends AgentCapabilityError {
  constructor(message: string) {
    super(message)
    this.name = 'EmailMarketingApprovalError'
  }
}

function approvalContext(evidence: EmailMarketingApprovalEvidence | null | undefined) {
  if (evidence?.status?.trim().toLowerCase() !== 'approved') {
    throw new EmailMarketingApprovalError('Agent email launch/send requires human approval before execution.')
  }
  if (evidence.approvedByType !== 'user' || !evidence.approvedBy?.trim()) {
    throw new EmailMarketingApprovalError('Agent email launch/send requires human approval recorded by an authenticated user.')
  }
  if (!evidence.approvalTaskId?.trim()) {
    throw new EmailMarketingApprovalError('Agent email launch/send requires a linked approval task as evidence.')
  }

  return {
    approvalStatus: evidence.status,
    approvalGateTaskId: evidence.approvalTaskId,
  }
}

/**
 * Enforces the named-agent capability manifest for email-marketing operations.
 *
 * Callers must resolve and verify the resource's organisation scope before
 * invoking this guard. Launch/send actions additionally require approval
 * evidence loaded from the same server-side resource; request booleans and
 * headers are never accepted as evidence.
 */
export function assertEmailMarketingAgentAction(
  user: Pick<ApiUser, 'uid' | 'role' | 'authKind' | 'agentId'>,
  capability: Extract<AgentCapability,
    | 'email_marketing_read'
    | 'email_marketing_draft'
    | 'email_marketing_manage_audience'
    | 'email_marketing_manage_sender'
    | 'email_marketing_preflight'
    | 'email_marketing_request_approval'
    | 'email_marketing_analyze'
    | 'email_marketing_send'>,
  evidence?: EmailMarketingApprovalEvidence | null,
): { ok: true; gateRequired: boolean } {
  if (user.authKind !== 'agent_api_key' && user.authKind !== 'legacy_ai_key') {
    return { ok: true, gateRequired: false }
  }
  if (user.authKind === 'legacy_ai_key') {
    throw new EmailMarketingApprovalError('Email-marketing agent actions require a named agent API key; legacy shared AI keys cannot bypass policy.')
  }

  const context = capability === 'email_marketing_send'
    ? approvalContext(evidence)
    : {}
  return assertAgentCapability(user, capability, context)
}
