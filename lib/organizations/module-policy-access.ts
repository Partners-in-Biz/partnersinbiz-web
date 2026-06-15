import { adminDb } from '@/lib/firebase/admin'
import type { ApiUser } from '@/lib/api/types'
import {
  canRolePerformModuleAction,
  resolveOrganizationModulePolicies,
  type OrganizationModulePolicyKey,
} from '@/lib/organizations/module-policies'

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

export async function assertUserCanPerformOrganizationModuleAction(
  user: ApiUser,
  orgId: string,
  moduleKey: OrganizationModulePolicyKey,
  actionId: string,
  deniedMessage: string,
  orgData?: Record<string, unknown>,
): Promise<ModulePolicyAccessResult> {
  if (user.role !== 'client') return { ok: true }

  const loadedOrgData = orgData ?? await getDocumentData('organizations', orgId)

  if (!loadedOrgData) return { ok: false, status: 404, error: 'Organisation not found' }

  const role = await resolveOrganizationPolicyRole(orgId, user.uid, loadedOrgData)
  const policies = resolveOrganizationModulePolicies(loadedOrgData.settings)
  if (!canRolePerformModuleAction(policies, moduleKey, actionId, role)) {
    return { ok: false, status: 403, error: deniedMessage }
  }

  return { ok: true }
}
