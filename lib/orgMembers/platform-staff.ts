import type { AgentId } from '@/lib/agents/types'
import { adminDb } from '@/lib/firebase/admin'
import { isActiveOrgMembershipRow, isOrgRole } from '@/lib/orgMembers/active-membership'
import {
  normalizeMemberAccessPolicy,
  resolveMemberAccessPolicy,
  type MemberAccessPolicy,
} from '@/lib/orgMembers/access-policy'
import { loadOrgMemberAccessPolicy } from '@/lib/orgMembers/org-access-policy'
import type { OrgRole } from '@/lib/organizations/types'
import { PIB_PLATFORM_ORG_ID } from '@/lib/platform/constants'

const STAFF_ROLES: ReadonlySet<OrgRole> = new Set(['owner', 'admin', 'member'])

export type PlatformStaffMembership = {
  platformOrgId: string
  uid: string
  role: OrgRole
  policy: MemberAccessPolicy
}

export function isPlatformStaffOrgRole(role: unknown): role is OrgRole {
  return isOrgRole(role) && STAFF_ROLES.has(role)
}

/**
 * Active Partners in Biz staff membership (owner/admin/member on the
 * platform-owner org). Viewers and inactive rows are not staff.
 */
export async function loadPlatformStaffMembership(uid: string): Promise<PlatformStaffMembership | null> {
  const trimmed = uid.trim()
  if (!trimmed) return null
  const platformOrgId = PIB_PLATFORM_ORG_ID
  try {
    const memberDoc = await adminDb.collection('orgMembers').doc(`${platformOrgId}_${trimmed}`).get()
    if (!memberDoc.exists) return null
    const data = memberDoc.data() ?? {}
    if (!isActiveOrgMembershipRow(data)) return null
    const role = (data.role as OrgRole | undefined) ?? 'viewer'
    if (!isPlatformStaffOrgRole(role)) return null
    return {
      platformOrgId,
      uid: trimmed,
      role,
      policy: resolveMemberAccessPolicy({
        role,
        accessScope: data.accessScope,
        accessPolicy: data.accessPolicy,
      }),
    }
  } catch {
    return null
  }
}

export function mergeAgentRuntimeAccess(
  local: Record<string, AgentId[]>,
  staff: Record<string, AgentId[]>,
): Record<string, AgentId[]> {
  const merged: Record<string, AgentId[]> = { ...local }
  for (const [runtimeTargetId, agentIds] of Object.entries(staff)) {
    const next = new Set<AgentId>([...(merged[runtimeTargetId] ?? []), ...agentIds])
    if (next.size > 0) merged[runtimeTargetId] = Array.from(next)
  }
  return merged
}

/**
 * Conversation-org policy plus PiB staff specialist grants. Members chatting
 * in a client workspace keep their local module policy, but can start the
 * specialists granted on Partners in Biz Team access.
 */
export async function loadEffectiveMemberAgentPolicy(
  orgId: string,
  uid: string,
  fallback?: MemberAccessPolicy | null,
): Promise<MemberAccessPolicy | null> {
  const local = (await loadOrgMemberAccessPolicy(orgId, uid)) ?? fallback ?? null
  const staff = await loadPlatformStaffMembership(uid)
  if (!staff) return local
  if (!local) return staff.policy
  if (orgId === staff.platformOrgId) return local
  const localNorm = normalizeMemberAccessPolicy(local)
  const staffNorm = normalizeMemberAccessPolicy(staff.policy)
  return {
    ...localNorm,
    agentRuntimeAccess: mergeAgentRuntimeAccess(
      localNorm.agentRuntimeAccess,
      staffNorm.agentRuntimeAccess,
    ),
  }
}

export function grantedAgentIdsFromPolicy(policy: MemberAccessPolicy | null | undefined): AgentId[] {
  if (!policy) return []
  const grants = normalizeMemberAccessPolicy(policy).agentRuntimeAccess
  const ids = new Set<AgentId>()
  for (const agentIds of Object.values(grants)) {
    for (const agentId of agentIds) ids.add(agentId)
  }
  return Array.from(ids)
}
