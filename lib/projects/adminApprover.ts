import type { ApiUser } from '@/lib/api/types'

type ApproverUser = Pick<
  ApiUser,
  'role' | 'authKind' | 'uid' | 'actingForUserId' | 'agentId' | 'delegationId'
>

/**
 * Returns true when the caller may set human approval-gate fields
 * (`approvalStatus`, gate metadata, and approval execution state).
 *
 * Allowed:
 * - Direct human admin session / Firebase ID token
 * - Active user-delegation token minted for an admin human (agent acts for Peet)
 *
 * Rejected:
 * - Non-admin roles
 * - Agent API keys and legacy system keys (cannot impersonate human approval)
 * - Malformed or incomplete user-delegation projections
 *
 * Org scope and project write access are enforced by the route separately.
 */
export function isAuthorizedAdminApprover(user: ApproverUser): boolean {
  if (user.role !== 'admin') return false

  const kind = user.authKind
  if (kind === 'agent_api_key' || kind === 'legacy_ai_key') return false

  if (kind === 'user_delegation') {
    // ResolveDelegationTokenUser sets uid = actingForUserId (the human).
    if (!user.delegationId?.trim()) return false
    if (!user.actingForUserId?.trim() || user.actingForUserId !== user.uid) return false
    if (!user.agentId?.trim()) return false
    return true
  }

  // Direct human browser/session auth (or legacy callers without authKind).
  return kind === 'session' || kind === 'firebase' || kind === undefined
}

/**
 * Audit fields for an approval decision. Distinguishes direct human approval
 * from agent-mediated delegated approval without changing the acting human uid.
 */
export function approvalActorAuditFields(user: ApproverUser): {
  approvedBy: string
  approvedByType: 'user' | 'delegated_user'
  approvedByAgentId?: string
  approvalDelegationId?: string
} {
  if (user.authKind === 'user_delegation' && user.agentId) {
    return {
      approvedBy: user.uid,
      approvedByType: 'delegated_user',
      approvedByAgentId: user.agentId,
      ...(user.delegationId ? { approvalDelegationId: user.delegationId } : {}),
    }
  }
  return {
    approvedBy: user.uid,
    approvedByType: 'user',
  }
}
