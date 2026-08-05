import { adminDb } from '@/lib/firebase/admin'
import type { ApiUser } from '@/lib/api/types'
import {
  canRolePerformModuleAction,
  resolveOrganizationModulePolicies,
  type OrganizationModulePolicyKey,
} from '@/lib/organizations/module-policies'
import {
  canAccessModule,
  memberCanPerformModuleAction,
  type MemberModuleActionKey,
  type WorkspaceModuleKey,
} from '@/lib/orgMembers/access-policy'
import { loadOrgMemberAccessPolicy } from '@/lib/orgMembers/org-access-policy'

type OrgMemberLike = { uid?: unknown; userId?: unknown; role?: unknown }

export type ModulePolicyAccessResult =
  | { ok: true }
  | { ok: false; status: 403 | 404; error: string }

function cleanString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

async function getDocumentData(collection: string, id: string): Promise<Record<string, unknown> | null> {
  try {
    const snap = await adminDb.collection(collection).doc(id).get()
    return snap?.exists ? snap.data() ?? null : null
  } catch {
    return null
  }
}

export function clientLinkedOrgIdForUser(
  linked: { clientOrgId?: string; clientOrgIds?: string[] } | undefined,
  user: Pick<ApiUser, 'orgId' | 'orgIds'>,
  fallbackOrgId: string | undefined,
) {
  const allowedOrgIds = new Set([...(user.orgIds ?? []), ...(user.orgId ? [user.orgId] : [])].filter(Boolean))
  const primary = cleanString(linked?.clientOrgId)
  if (primary && (allowedOrgIds.size === 0 || allowedOrgIds.has(primary))) return primary
  for (const orgId of linked?.clientOrgIds ?? []) {
    const cleaned = cleanString(orgId)
    if (cleaned && (allowedOrgIds.size === 0 || allowedOrgIds.has(cleaned))) return cleaned
  }
  return cleanString(fallbackOrgId)
}

export async function resolveOrganizationPolicyRole(
  orgId: string,
  uid: string,
  orgData: Record<string, unknown>,
): Promise<unknown> {
  const members = Array.isArray(orgData.members) ? orgData.members as OrgMemberLike[] : []
  const fallback = members.find((member) => cleanString(member.uid) === uid || cleanString(member.userId) === uid)
  const memberData = await getDocumentData('orgMembers', `${orgId}_${uid}`) ?? {}
  return memberData.role ?? fallback?.role ?? 'member'
}

const ORG_POLICY_TO_WORKSPACE: Record<OrganizationModulePolicyKey, WorkspaceModuleKey> = {
  projects: 'projects',
  documents: 'documents',
  research: 'research',
  mobileApps: 'mobileApps',
  youtubeStudio: 'youtubeStudio',
  bookStudio: 'bookStudio',
  marketing: 'marketing',
  messages: 'messages',
}

/** Map an organisation matrix action to the member action flag(s) it gates. */
const ORG_ACTION_TO_MEMBER_ACTIONS: Record<string, MemberModuleActionKey[]> = {
  create: ['create'],
  edit: ['edit'],
  delete: ['delete', 'archiveDelete'],
  archiveDelete: ['delete', 'archiveDelete'],
  export: ['export'],
  approve: ['approve'],
  approvePublish: ['approve', 'send'],
  reviewApproval: ['approve'],
  publishApprovals: ['approve'],
  send: ['send'],
  start: ['send'],
  reply: ['send'],
  shareLinks: ['share'],
}

/**
 * Assert the user may perform an organisation module action.
 *
 * Platform admins/AI bypass. Members with an explicit per-member access policy
 * are gated by that policy (module toggle + per-action grant), with the org
 * modulePolicies role matrix as the default when the member policy has no
 * explicit flag. Members without an explicit policy use the org role matrix
 * directly (modulePolicies are the default).
 */
export async function assertUserCanPerformOrganizationModuleAction(
  user: ApiUser,
  orgId: string,
  moduleKey: OrganizationModulePolicyKey,
  actionId: string,
  deniedMessage: string,
  orgData?: Record<string, unknown>,
): Promise<ModulePolicyAccessResult> {
  if (user.role === 'admin' || user.role === 'ai') return { ok: true }

  const loadedOrgData = orgData ?? await getDocumentData('organizations', orgId)

  if (!loadedOrgData) return { ok: false, status: 404, error: 'Organisation not found' }

  const role = await resolveOrganizationPolicyRole(orgId, user.uid, loadedOrgData)
  const policies = resolveOrganizationModulePolicies(loadedOrgData.settings)
  const roleMatrixDefault = canRolePerformModuleAction(policies, moduleKey, actionId, role)

  const memberPolicy = await loadOrgMemberAccessPolicy(orgId, user.uid)
  if (memberPolicy) {
    const workspaceKey = ORG_POLICY_TO_WORKSPACE[moduleKey]
    if (!canAccessModule(memberPolicy, workspaceKey)) {
      return { ok: false, status: 403, error: deniedMessage }
    }
    const memberActions = ORG_ACTION_TO_MEMBER_ACTIONS[actionId] ?? [actionId as MemberModuleActionKey]
    for (const memberAction of memberActions) {
      if (!memberCanPerformModuleAction(memberPolicy, workspaceKey, memberAction, roleMatrixDefault)) {
        return { ok: false, status: 403, error: deniedMessage }
      }
    }
    return { ok: true }
  }

  if (!roleMatrixDefault) {
    return { ok: false, status: 403, error: deniedMessage }
  }

  return { ok: true }
}
