import type { ApiUser } from '@/lib/api/types'
import { loadPlatformStaffMembership } from '@/lib/orgMembers/platform-staff'

type ApproverUser = Pick<
  ApiUser,
  'role' | 'authKind' | 'uid' | 'actingForUserId' | 'agentId' | 'delegationId'
>

const ADMIN_ONLY_APPROVAL_GATES = new Set([
  'production-deploy',
  'secret-config',
  'secrets-config',
  'destructive',
  'destructive-action',
  'destructive-data',
])

const BOOK_APPROVAL_GATES = new Set([
  'finance',
  'client-visible',
  'public-publishing',
  'paid-spend',
  'human-review',
  'client-approval',
  'human-required',
])

function cleanGate(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : ''
}

export function isAdminOnlyApprovalGate(gate: unknown): boolean {
  return ADMIN_ONLY_APPROVAL_GATES.has(cleanGate(gate))
}

export function isBookApprovalGate(gate: unknown): boolean {
  const value = cleanGate(gate)
  if (!value || value === 'none') return true
  if (isAdminOnlyApprovalGate(value)) return false
  return BOOK_APPROVAL_GATES.has(value) || value.includes('client') || value.includes('finance')
}

function isCompleteHumanApprover(user: ApproverUser): boolean {
  const kind = user.authKind
  if (kind === 'agent_api_key' || kind === 'legacy_ai_key') return false

  if (kind === 'user_delegation') {
    if (!user.delegationId?.trim()) return false
    if (!user.actingForUserId?.trim() || user.actingForUserId !== user.uid) return false
    if (!user.agentId?.trim()) return false
    return true
  }

  return kind === 'session' || kind === 'firebase' || kind === undefined
}

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
 * Book-of-business staff approval uses `canApproveProjectGate`.
 */
export function isAuthorizedAdminApprover(user: ApproverUser): boolean {
  if (user.role !== 'admin') return false
  return isCompleteHumanApprover(user)
}

/**
 * PiB staff members may approve book-of-business gates (finance, client
 * messages, drafts) on work they can already write. Production, secrets, and
 * destructive gates stay admin-only.
 */
export async function isAuthorizedBookApprover(user: ApproverUser, gate?: unknown): Promise<boolean> {
  if (!isCompleteHumanApprover(user)) return false
  if (isAdminOnlyApprovalGate(gate)) return false
  if (!isBookApprovalGate(gate)) return false
  const staff = await loadPlatformStaffMembership(user.uid)
  return Boolean(staff)
}

export async function canApproveProjectGate(user: ApproverUser, gate?: unknown): Promise<boolean> {
  if (isAuthorizedAdminApprover(user)) return true
  return isAuthorizedBookApprover(user, gate)
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
