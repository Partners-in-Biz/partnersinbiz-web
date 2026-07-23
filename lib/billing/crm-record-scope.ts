import { adminDb } from '@/lib/firebase/admin'
import type { CrmAuthContext } from '@/lib/auth/crm-middleware'
import type { ApiUser } from '@/lib/api/types'
import {
  type AssignableCrmRecord,
  crmActorCanReadRecord,
  crmRecordCompanyIds,
  crmRecordContactIds,
  filterCrmRowsForActor,
  isCrmPrivilegedActor,
  loadCompanyAssignmentMap,
  loadContactAssignmentMap,
} from '@/lib/crm/assignment-access'
import {
  FULL_ACCESS_POLICY,
  OWNED_OR_LINKED_DEFAULT_SCOPES,
  resolveMemberAccessPolicy,
  type MemberAccessPolicy,
} from '@/lib/orgMembers/access-policy'
import { isActiveOrgMembershipRow } from '@/lib/orgMembers/membership'
import type { OrgRole } from '@/lib/organizations/types'
import { AGENT_PIP_REF, buildHumanRef } from '@/lib/orgMembers/memberRef'

async function loadAccessPolicyForOrg(uid: string, orgId: string): Promise<{
  role: OrgRole
  accessPolicy: MemberAccessPolicy
} | null> {
  const memberDoc = await adminDb.collection('orgMembers').doc(`${orgId}_${uid}`).get()
  if (!memberDoc.exists) return null
  const data = memberDoc.data() ?? {}
  if (!isActiveOrgMembershipRow(data)) return null
  const role = (data.role as OrgRole | undefined) ?? 'viewer'
  return {
    role,
    accessPolicy: resolveMemberAccessPolicy({
      role,
      accessScope: data.accessScope,
      accessPolicy: data.accessPolicy,
    }),
  }
}

/**
 * Build a CRM auth context for billing list/detail routes that use withAuth
 * (invoices) rather than withCrmAuth (quotes / CRM).
 */
export async function resolveBillingCrmAuthContext(
  user: ApiUser,
  orgId: string,
): Promise<CrmAuthContext> {
  if (user.role === 'admin' || user.role === 'ai') {
    return {
      orgId,
      uid: user.uid,
      actor: user.role === 'ai' ? AGENT_PIP_REF : buildHumanRef({ uid: user.uid }),
      role: user.role === 'ai' ? 'system' : 'owner',
      isAgent: user.role === 'ai',
      permissions: {},
      accessPolicy: FULL_ACCESS_POLICY,
      user: {
        uid: user.uid,
        role: user.role,
        orgId: user.orgId,
        allowedOrgIds: user.allowedOrgIds,
      },
    }
  }

  const membership = await loadAccessPolicyForOrg(user.uid, orgId)
  const accessPolicy = membership?.accessPolicy
    ?? user.memberAccessPolicy
    ?? {
      preset: 'custom' as const,
      modules: { ...Object.fromEntries(
        (['crm', 'projects', 'documents', 'marketing', 'messages', 'email', 'reports', 'research', 'properties', 'billing', 'mobileApps', 'youtubeStudio', 'bookStudio'] as const)
          .map((key) => [key, false]),
      ) } as MemberAccessPolicy['modules'],
      recordScopes: { ...OWNED_OR_LINKED_DEFAULT_SCOPES },
    }

  // If we fell back without membership modules, prefer the caller's cached policy
  // when present; otherwise keep a fail-closed owned_or_linked policy.
  const resolvedPolicy = membership?.accessPolicy
    ?? user.memberAccessPolicy
    ?? resolveMemberAccessPolicy({ role: 'member', accessPolicy })

  return {
    orgId,
    uid: user.uid,
    actor: buildHumanRef({ uid: user.uid }),
    role: membership?.role ?? 'member',
    isAgent: false,
    permissions: {},
    accessPolicy: resolvedPolicy,
    user: {
      uid: user.uid,
      role: user.role,
      orgId: user.orgId,
      allowedOrgIds: user.allowedOrgIds,
    },
  }
}

export async function filterBillingRecordsForCrmActor<T extends AssignableCrmRecord>(
  ctx: CrmAuthContext,
  rows: T[],
): Promise<T[]> {
  if (isCrmPrivilegedActor(ctx)) return rows

  const companyIds = new Set<string>()
  const contactIds = new Set<string>()
  for (const row of rows) {
    for (const id of crmRecordCompanyIds(row)) companyIds.add(id)
    for (const id of crmRecordContactIds(row)) contactIds.add(id)
  }

  const [companies, contacts] = await Promise.all([
    loadCompanyAssignmentMap(ctx.orgId, companyIds),
    loadContactAssignmentMap(ctx.orgId, contactIds),
  ])

  return filterCrmRowsForActor(ctx, rows, { companies, contacts })
}

export async function crmActorCanReadBillingRecord(
  ctx: CrmAuthContext,
  record: AssignableCrmRecord,
): Promise<boolean> {
  if (isCrmPrivilegedActor(ctx)) return true

  const [companies, contacts] = await Promise.all([
    loadCompanyAssignmentMap(ctx.orgId, crmRecordCompanyIds(record)),
    loadContactAssignmentMap(ctx.orgId, crmRecordContactIds(record)),
  ])

  return crmActorCanReadRecord(ctx, record, { companies, contacts })
}
