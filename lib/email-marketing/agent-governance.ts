import type { ApiUser } from '@/lib/api/types'
import {
  AgentCapabilityError,
  assertAgentCapability,
} from '@/lib/agents/capabilities'
import type { AgentCapability } from '@/lib/agents/skill-policy'
import { adminDb } from '@/lib/firebase/admin'

export interface EmailMarketingApprovalEvidence {
  status?: string | null
  approvedBy?: string | null
  approvedByType?: string | null
  approvalTaskId?: string | null
}

interface ApprovalTaskLike {
  orgId?: string | null
  status?: string | null
  approvalStatus?: string | null
  deleted?: boolean
  linkedResource?: { type?: string | null; id?: string | null } | null
}

export interface EmailMarketingApprovalContext {
  orgId: string
  resourceType: 'email_broadcast' | 'email_campaign' | 'email_sequence' | 'email_automation'
  resourceId: string
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

export function validateEmailMarketingApprovalTask(
  evidence: EmailMarketingApprovalEvidence | null | undefined,
  task: ApprovalTaskLike | null | undefined,
  context: EmailMarketingApprovalContext,
): EmailMarketingApprovalEvidence {
  approvalContext(evidence)
  if (!task || task.deleted || task.orgId !== context.orgId) {
    throw new EmailMarketingApprovalError('Approval task must exist in the same organisation as the email resource.')
  }
  if (task.status !== 'done' || task.approvalStatus !== 'approved') {
    throw new EmailMarketingApprovalError('Approval task must be completed with an approved human decision.')
  }
  if (task.linkedResource?.type !== context.resourceType || task.linkedResource?.id !== context.resourceId) {
    throw new EmailMarketingApprovalError('Approval task must be linked to this exact email resource.')
  }
  return evidence!
}

export async function assertEmailMarketingAgentActionWithTask(
  user: Pick<ApiUser, 'uid' | 'role' | 'authKind' | 'agentId'>,
  capability: Extract<AgentCapability, 'email_marketing_send'>,
  evidence: EmailMarketingApprovalEvidence | null | undefined,
  context: EmailMarketingApprovalContext,
): Promise<{ ok: true; gateRequired: boolean }> {
  if (user.authKind !== 'agent_api_key' && user.authKind !== 'legacy_ai_key') {
    return { ok: true, gateRequired: false }
  }
  if (user.authKind === 'legacy_ai_key') {
    return assertEmailMarketingAgentAction(user, capability, evidence)
  }
  const taskId = evidence?.approvalTaskId?.trim()
  if (!taskId) throw new EmailMarketingApprovalError('Agent email launch/send requires a linked approval task as evidence.')
  const taskSnap = await adminDb.collection('tasks').doc(taskId).get()
  const verified = validateEmailMarketingApprovalTask(
    evidence,
    taskSnap.exists ? taskSnap.data() as ApprovalTaskLike : null,
    context,
  )
  return assertEmailMarketingAgentAction(user, capability, verified)
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
